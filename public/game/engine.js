// ============================================================
// REACH UP — Moteur du jeu
// Phase 2 : règles principales (dés, achats, loyers, prison, victoire)
// Phase 3 : le moteur devient "pilotable pas à pas" (roll / decide),
//           pour pouvoir être contrôlé en direct par de vrais joueurs
//           humains via le serveur, au lieu de tourner tout seul.
//
// Ce moteur ne sait toujours RIEN du réseau ni de Socket.io — c'est le
// serveur (server.js) qui l'utilise et qui parle aux navigateurs.
//
// Non inclus pour l'instant (arrivera dans une phase ultérieure) :
//   - construction de maisons/hôtels
//   - hypothèque, vente, échanges entre joueurs
//   - enchères quand un joueur refuse d'acheter
// ============================================================

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    const { BOARD, CHANCE_CARDS, HOUSE_COST_BY_GROUP, RENT_MULTIPLIERS_BY_HOUSES } = require("./board.js");
    module.exports = factory(BOARD, CHANCE_CARDS, HOUSE_COST_BY_GROUP, RENT_MULTIPLIERS_BY_HOUSES);
  } else {
    const b = root.ReachUpBoard;
    root.ReachUpEngine = factory(b.BOARD, b.CHANCE_CARDS, b.HOUSE_COST_BY_GROUP, b.RENT_MULTIPLIERS_BY_HOUSES);
  }
})(typeof window !== "undefined" ? window : globalThis, function (BOARD_TEMPLATE, CHANCE_CARDS, HOUSE_COST_BY_GROUP, RENT_MULTIPLIERS_BY_HOUSES) {
  const STARTING_MONEY = 1500;
  const SALARY = 200;
  const JAIL_FINE = 50;
  const MAX_JAIL_TURNS = 3;

  class GameEngine {
    /**
     * @param {string[]} playerNames
     * @param {object} [options]
     * @param {function} [options.decideBuy] - (player, tile) => boolean.
     *   Utilisé uniquement par playTurn() (mode automatique/test).
     *   En mode interactif (Phase 3), c'est decide() qui reçoit le vrai
     *   choix du joueur humain, decideBuy n'est alors jamais appelé.
     * @param {number} [options.startingMoney] - Argent de départ (Phase 5).
     * @param {number} [options.salary] - Salaire à chaque passage par Départ (Phase 5).
     * @param {boolean} [options.vacationPot] - Règle maison : les taxes
     *   s'accumulent dans une cagnotte, redistribuée à qui tombe sur Vacances (Phase 5).
     * @param {number|null} [options.turnLimit] - Limite de tours (Phase 5).
     *   Si atteinte, la partie s'arrête et le joueur avec la plus grande
     *   valeur totale (argent + propriétés) gagne.
     */
    constructor(playerNames, options = {}) {
      // On clone le plateau à chaque partie : chaque partie a ses propres
      // propriétaires, sans jamais modifier le modèle partagé (BOARD_TEMPLATE).
      // Phase 8b : si un plateau généré est fourni (options.customBoard),
      // on l'utilise à la place du plateau fixe — le moteur ne fait aucune
      // différence entre les deux, un plateau est juste "un tableau de cases".
      const sourceBoard = options.customBoard || BOARD_TEMPLATE;
      this.board = sourceBoard.map((tile) => ({ ...tile }));

      this.salary = options.salary || SALARY;
      this.vacationPotEnabled = !!options.vacationPot;
      this.vacationPot = 0;
      this.turnLimit = options.turnLimit || null;
      this.diceSides = options.diceSides || 6;
      this.auctionMode = options.auctionMode === "classic" ? "classic" : "secret";
      this.tradeTaxPercent = options.tradeTaxPercent || 0;

      const startingMoney = options.startingMoney || STARTING_MONEY;
      this.players = playerNames.map((name, id) => ({
        id,
        name,
        position: 0,
        money: startingMoney,
        inJail: false,
        jailTurns: 0,
        jailFreeCards: 0,
        bankrupt: false,
      }));

      this.decideBuy =
        options.decideBuy ||
        ((player, tile) => player.money - tile.price >= 100);

      this.currentPlayerIndex = 0;
      this.turnNumber = 1;
      this.log = [];
      this.gameOver = false;
      this.winner = null;

      // État "pas à pas", utilisé par le mode interactif (Phase 3+)
      this.doublesStreak = 0;
      this.pendingDecision = null; // { type: "buy", tileIndex, playerId }
      this._pendingDiceWasDouble = false;
      this._turnBannerLogged = false;

      // Dernier lancer de dés effectué (Phase 4 : sert à afficher les dés
      // sur le plateau visuel). null tant qu'aucun dé n'a été lancé.
      this.lastRoll = null; // { playerId, d1, d2, isDouble, inJailRoll }

      // Enchère scellée en cours (Phase 7), déclenchée quand personne
      // n'achète une case au prix affiché.
      this.pendingAuction = null; // { tileIndex, bids: {playerId: montant}, pendingPlayers: [...] }

      // Propositions d'échange en cours (Phase 7). Contrairement aux achats
      // et enchères, les échanges ne bloquent jamais le jeu : n'importe qui
      // peut en proposer ou en accepter à tout moment.
      this.tradeOffers = [];
      this._nextTradeId = 1;
    }

    addLog(message) {
      this.log.push(message);
    }

    currentPlayer() {
      return this.players[this.currentPlayerIndex];
    }

    activePlayers() {
      return this.players.filter((p) => !p.bankrupt);
    }

    rollDice() {
      const d1 = 1 + Math.floor(Math.random() * this.diceSides);
      const d2 = 1 + Math.floor(Math.random() * this.diceSides);
      return [d1, d2];
    }

    // Transfert d'argent générique. from ou to peuvent être null (= la banque).
    pay(from, to, amount) {
      if (from) from.money -= amount;
      if (to) to.money += amount;
    }

    moveTo(player, index, collectSalaryIfPassed) {
      const passedGo = collectSalaryIfPassed && index <= player.position && !(player.position === 0);
      player.position = index;
      if (passedGo) {
        this.pay(null, player, this.salary);
        this.addLog(`${player.name} passe par la case Départ et touche ${this.salary}.`);
      }
    }

    sendToJail(player) {
      // La case Prison est toujours au premier quart du plateau (comme sur
      // le plateau fixe), quelle que soit la taille réelle de celui-ci.
      player.position = this.board.length / 4;
      player.inJail = true;
      player.jailTurns = 0;
      this.addLog(`${player.name} est envoyé en prison.`);
    }

    ownsFullSet(playerId, group) {
      const tilesOfGroup = this.board.filter((t) => t.type === "property" && t.group === group);
      return tilesOfGroup.every((t) => t.owner === playerId);
    }

    // ---- Construction (maisons/hôtel) — Phase 6 ----
    // Règle "Even Build" (comme dans le vrai Richup.io) : on ne peut
    // construire que sur la propriété du groupe qui a le MOINS de
    // maisons, pour garder une construction répartie équitablement.
    canBuildHouse(playerId, tileIndex) {
      const tile = this.board[tileIndex];
      if (!tile || tile.type !== "property") return { ok: false, reason: "Cette case n'est pas constructible." };
      if (tile.owner !== playerId) return { ok: false, reason: "Tu ne possèdes pas cette propriété." };
      if (tile.mortgaged) return { ok: false, reason: "Cette propriété est hypothéquée." };
      if (!this.ownsFullSet(playerId, tile.group)) return { ok: false, reason: "Il faut posséder tout le groupe pour construire." };
      if (tile.houses >= 5) return { ok: false, reason: "Cette propriété a déjà un hôtel." };

      const groupTiles = this.board.filter((t) => t.type === "property" && t.group === tile.group);
      const minHouses = Math.min(...groupTiles.map((t) => t.houses));
      if (tile.houses !== minHouses) {
        return { ok: false, reason: "Construis d'abord sur les propriétés moins bien loties du groupe (règle Even Build)." };
      }

      const cost = HOUSE_COST_BY_GROUP[tile.group];
      const player = this.players[playerId];
      if (player.money < cost) return { ok: false, reason: "Pas assez d'argent." };

      return { ok: true, cost };
    }

    buildHouse(playerId, tileIndex) {
      const check = this.canBuildHouse(playerId, tileIndex);
      if (!check.ok) return check;

      const tile = this.board[tileIndex];
      const player = this.players[playerId];
      this.pay(player, null, check.cost);
      tile.houses += 1;
      const label = tile.houses === 5 ? "un hôtel" : `${tile.houses} maison(s)`;
      this.addLog(`${player.name} construit sur ${tile.name} (${label}) pour ${check.cost}.`);
      return { ok: true };
    }

    // Vente d'une maison : symétrique de la construction (on vend d'abord
    // sur la propriété qui a le PLUS de maisons du groupe), remboursée à
    // la moitié du prix de construction.
    canSellHouse(playerId, tileIndex) {
      const tile = this.board[tileIndex];
      if (!tile || tile.type !== "property") return { ok: false, reason: "Cette case n'a pas de maisons." };
      if (tile.owner !== playerId) return { ok: false, reason: "Tu ne possèdes pas cette propriété." };
      if (tile.houses <= 0) return { ok: false, reason: "Aucune maison à vendre ici." };

      const groupTiles = this.board.filter((t) => t.type === "property" && t.group === tile.group);
      const maxHouses = Math.max(...groupTiles.map((t) => t.houses));
      if (tile.houses !== maxHouses) {
        return { ok: false, reason: "Vends d'abord les maisons des propriétés les mieux loties du groupe." };
      }

      const refund = Math.floor(HOUSE_COST_BY_GROUP[tile.group] / 2);
      return { ok: true, refund };
    }

    sellHouse(playerId, tileIndex) {
      const check = this.canSellHouse(playerId, tileIndex);
      if (!check.ok) return check;

      const tile = this.board[tileIndex];
      const player = this.players[playerId];
      tile.houses -= 1;
      this.pay(null, player, check.refund);
      this.addLog(`${player.name} vend une maison sur ${tile.name} pour ${check.refund}.`);
      return { ok: true };
    }

    // ---- Hypothèque — Phase 6 ----
    canMortgage(playerId, tileIndex) {
      const tile = this.board[tileIndex];
      if (!tile) return { ok: false, reason: "Case invalide." };
      if (!["property", "airport", "utility"].includes(tile.type)) return { ok: false, reason: "Cette case ne peut pas être hypothéquée." };
      if (tile.owner !== playerId) return { ok: false, reason: "Tu ne possèdes pas cette propriété." };
      if (tile.mortgaged) return { ok: false, reason: "Déjà hypothéquée." };
      if (tile.type === "property" && tile.houses > 0) return { ok: false, reason: "Vends d'abord les maisons avant d'hypothéquer." };

      const amount = Math.floor(tile.price / 2);
      return { ok: true, amount };
    }

    mortgage(playerId, tileIndex) {
      const check = this.canMortgage(playerId, tileIndex);
      if (!check.ok) return check;

      const tile = this.board[tileIndex];
      const player = this.players[playerId];
      tile.mortgaged = true;
      this.pay(null, player, check.amount);
      this.addLog(`${player.name} hypothèque ${tile.name} et reçoit ${check.amount}.`);
      return { ok: true };
    }

    canUnmortgage(playerId, tileIndex) {
      const tile = this.board[tileIndex];
      if (!tile) return { ok: false, reason: "Case invalide." };
      if (tile.owner !== playerId) return { ok: false, reason: "Tu ne possèdes pas cette propriété." };
      if (!tile.mortgaged) return { ok: false, reason: "Cette propriété n'est pas hypothéquée." };

      const cost = Math.ceil((tile.price / 2) * 1.1); // remboursement + 10% d'intérêt
      const player = this.players[playerId];
      if (player.money < cost) return { ok: false, reason: "Pas assez d'argent pour lever l'hypothèque." };

      return { ok: true, cost };
    }

    unmortgage(playerId, tileIndex) {
      const check = this.canUnmortgage(playerId, tileIndex);
      if (!check.ok) return check;

      const tile = this.board[tileIndex];
      const player = this.players[playerId];
      this.pay(player, null, check.cost);
      tile.mortgaged = false;
      this.addLog(`${player.name} lève l'hypothèque sur ${tile.name} pour ${check.cost}.`);
      return { ok: true };
    }

    // Résout une case qui n'a besoin d'AUCUNE décision humaine
    // (loyer, taxe, carte destin, prison...). L'achat d'une case libre
    // est géré séparément par roll()/decide(), pas ici.
    resolveTile(player, tile, diceSum) {
      switch (tile.type) {
        case "property": {
          if (tile.owner !== player.id) {
            if (tile.mortgaged) {
              this.addLog(`${player.name} ne paie rien : ${tile.name} est hypothéquée.`);
              break;
            }
            let rent;
            if (tile.houses > 0) {
              rent = tile.rent * RENT_MULTIPLIERS_BY_HOUSES[tile.houses];
            } else {
              rent = this.ownsFullSet(tile.owner, tile.group) ? tile.rent * 2 : tile.rent;
            }
            const owner = this.players[tile.owner];
            this.pay(player, owner, rent);
            const buildingNote = tile.houses === 5 ? " (hôtel)" : tile.houses > 0 ? ` (${tile.houses} maison(s))` : "";
            this.addLog(`${player.name} paie ${rent} de loyer à ${owner.name} (${tile.name}${buildingNote}).`);
          }
          break;
        }
        case "airport": {
          if (tile.owner !== player.id) {
            if (tile.mortgaged) {
              this.addLog(`${player.name} ne paie rien : ${tile.name} est hypothéquée.`);
              break;
            }
            const owner = this.players[tile.owner];
            const count = this.board.filter((t) => t.type === "airport" && t.owner === tile.owner && !t.mortgaged).length;
            const rentTable = [25, 50, 100, 200];
            const rent = rentTable[Math.max(count - 1, 0)];
            this.pay(player, owner, rent);
            this.addLog(`${player.name} paie ${rent} de loyer à ${owner.name} (${tile.name}).`);
          }
          break;
        }
        case "utility": {
          if (tile.owner !== player.id) {
            if (tile.mortgaged) {
              this.addLog(`${player.name} ne paie rien : ${tile.name} est hypothéquée.`);
              break;
            }
            const owner = this.players[tile.owner];
            const count = this.board.filter((t) => t.type === "utility" && t.owner === tile.owner && !t.mortgaged).length;
            const multiplier = count === 1 ? 4 : 10;
            const rent = diceSum * multiplier;
            this.pay(player, owner, rent);
            this.addLog(`${player.name} paie ${rent} de loyer à ${owner.name} (${tile.name}, ${count === 1 ? "x4" : "x10"} le lancer de dés).`);
          }
          break;
        }
        case "tax": {
          this.pay(player, null, tile.amount);
          if (this.vacationPotEnabled) {
            this.vacationPot += tile.amount;
            this.addLog(`${player.name} paie ${tile.amount} de taxe (${tile.name}) — cagnotte de Vacances : ${this.vacationPot}.`);
          } else {
            this.addLog(`${player.name} paie ${tile.amount} de taxe (${tile.name}).`);
          }
          break;
        }
        case "vacation": {
          if (this.vacationPotEnabled && this.vacationPot > 0) {
            this.pay(null, player, this.vacationPot);
            this.addLog(`🏖️ ${player.name} récupère la cagnotte de Vacances : ${this.vacationPot} !`);
            this.vacationPot = 0;
          }
          break;
        }
        case "chance":
        case "special": {
          const card = CHANCE_CARDS[Math.floor(Math.random() * CHANCE_CARDS.length)];
          const label = tile.type === "special" ? "Carte Spéciale" : "Carte Destin";
          this.addLog(`${player.name} tire une ${label} : "${card.description}"`);
          card.effect(this, player);
          break;
        }
        case "go-to-jail": {
          this.sendToJail(player);
          break;
        }
        // "go", "jail" (simple visite) : pas d'effet particulier ici
        default:
          break;
      }
    }

    checkBankruptcy(player) {
      if (player.money < 0 && !player.bankrupt) {
        player.bankrupt = true;
        // Ses propriétés redeviennent libres (pas d'enchère pour l'instant)
        this.board.forEach((tile) => {
          if (tile.owner === player.id) {
            tile.owner = null;
            if (tile.type === "property") tile.houses = 0;
            if ("mortgaged" in tile) tile.mortgaged = false;
          }
        });
        this.addLog(`💥 ${player.name} est en faillite et quitte la partie.`);
      }
    }

    checkVictory() {
      const active = this.activePlayers();
      if (active.length === 1) {
        this.gameOver = true;
        this.winner = active[0];
        this.addLog(`🏆 ${this.winner.name} remporte la partie !`);
      }
    }

    // Valeur totale d'un joueur : argent en poche + valeur de ses
    // propriétés (réduite de moitié si hypothéquées) + valeur des
    // maisons/hôtel construits dessus.
    _computeNetWorth(player) {
      let value = player.money;
      this.board.forEach((tile) => {
        if (tile.owner !== player.id) return;
        value += tile.mortgaged ? Math.floor((tile.price || 0) / 2) : tile.price || 0;
        if (tile.type === "property" && tile.houses > 0) {
          value += tile.houses * HOUSE_COST_BY_GROUP[tile.group];
        }
      });
      return value;
    }

    // Si une limite de tours est configurée (Phase 5) et qu'elle est
    // atteinte, la partie s'arrête : victoire au joueur de plus grande valeur.
    checkTurnLimit() {
      if (!this.turnLimit || this.gameOver) return;
      if (this.turnNumber < this.turnLimit) return;

      const active = this.activePlayers();
      let best = active[0];
      let bestValue = this._computeNetWorth(best);
      for (const p of active.slice(1)) {
        const value = this._computeNetWorth(p);
        if (value > bestValue) {
          best = p;
          bestValue = value;
        }
      }
      this.gameOver = true;
      this.winner = best;
      this.addLog(
        `⏱️ Limite de ${this.turnLimit} tours atteinte. 🏆 ${best.name} remporte la partie avec une valeur totale de ${bestValue} !`
      );
    }

    nextPlayer() {
      do {
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      } while (this.players[this.currentPlayerIndex].bankrupt);
      this.doublesStreak = 0;
      this.turnNumber += 1;
      this._turnBannerLogged = false;
    }

    // Tentative de sortie de prison (carte, double, ou 3e tour = amende).
    // Renvoie true si le joueur est maintenant libre de jouer ce tour,
    // false si son tour s'arrête ici (toujours en prison).
    _attemptJailExit(player) {
      if (player.jailFreeCards > 0) {
        player.jailFreeCards -= 1;
        player.inJail = false;
        this.addLog(`${player.name} utilise une carte "sortie de prison gratuite".`);
        return true;
      }
      const [d1, d2] = this.rollDice();
      this.lastRoll = { playerId: player.id, d1, d2, isDouble: d1 === d2, inJailRoll: true };
      this.addLog(`${player.name} lance les dés en prison : ${d1} et ${d2}.`);
      if (d1 === d2) {
        player.inJail = false;
        this.addLog(`Double ! ${player.name} sort de prison.`);
        return true;
      }
      player.jailTurns += 1;
      if (player.jailTurns >= MAX_JAIL_TURNS) {
        this.pay(player, null, JAIL_FINE);
        player.inJail = false;
        this.addLog(`${player.name} paie l'amende de ${JAIL_FINE} et sort de prison.`);
        return true;
      }
      this.addLog(`${player.name} reste en prison.`);
      return false;
    }

    // Ce qui se passe une fois qu'un lancer est totalement résolu
    // (achat décidé ou pas de décision nécessaire) : faillite, victoire,
    // puis "rejoue" (double) ou "tour suivant".
    _afterRollResolved(isDouble) {
      const player = this.currentPlayer();
      this.checkBankruptcy(player);
      this.checkVictory();
      if (!this.gameOver) this.checkTurnLimit();
      if (this.gameOver) return;

      if (isDouble && !player.inJail && !player.bankrupt) {
        // Le même joueur rejoue : on ne touche pas à currentPlayerIndex.
        return;
      }
      this.nextPlayer();
    }

    // ---- API "pas à pas", pilotée depuis l'extérieur (serveur ou test) ----

    // Fait jouer UN lancer de dés au joueur courant. À utiliser à chaque
    // clic sur "Lancer les dés". Peut se terminer en attente d'une
    // décision d'achat (this.pendingDecision devient non-null).
    roll() {
      if (this.gameOver || this.pendingDecision || this.pendingAuction) return;
      const player = this.currentPlayer();
      if (player.bankrupt) {
        this.nextPlayer();
        return;
      }

      if (!this._turnBannerLogged) {
        this.addLog(`--- Tour ${this.turnNumber} : ${player.name} ---`);
        this._turnBannerLogged = true;
      }

      if (player.inJail) {
        const freed = this._attemptJailExit(player);
        this.checkBankruptcy(player);
        this.checkVictory();
        if (!this.gameOver) this.checkTurnLimit();
        if (!this.gameOver && !freed) {
          this.nextPlayer();
        }
        // Si freed === true, le joueur garde son tour : il doit rappeler
        // roll() pour effectuer son déplacement (comportement volontaire,
        // cf. explications de la Phase 3).
        return;
      }

      const [d1, d2] = this.rollDice();
      const isDouble = d1 === d2;
      const sum = d1 + d2;
      this.lastRoll = { playerId: player.id, d1, d2, isDouble, inJailRoll: false };
      this.addLog(`${player.name} lance les dés : ${d1} et ${d2}${isDouble ? " (double !)" : ""}.`);

      this.doublesStreak = isDouble ? this.doublesStreak + 1 : 0;

      if (isDouble && this.doublesStreak >= 3) {
        this.addLog(`${player.name} fait trois doubles d'affilée : direction la prison !`);
        this.sendToJail(player);
        this.nextPlayer();
        return;
      }

      const newPosition = (player.position + sum) % this.board.length;
      this.moveTo(player, newPosition, true);
      const tile = this.board[player.position];
      this.addLog(`${player.name} arrive sur "${tile.name}".`);

      const ownableTypes = ["property", "airport", "utility"];
      if (ownableTypes.includes(tile.type) && tile.owner === null) {
        if (player.money >= tile.price) {
          this.pendingDecision = { type: "buy", tileIndex: player.position, playerId: player.id };
          this._pendingDiceWasDouble = isDouble;
        } else {
          this.addLog(`${player.name} n'a pas les moyens d'acheter ${tile.name}.`);
          this._pendingDiceWasDouble = isDouble;
          this.startAuction(player.position);
        }
        return; // on attend maintenant un achat, une enchère, ou les deux à la suite
      }

      this.resolveTile(player, tile, sum);
      this._afterRollResolved(isDouble);
    }

    // Répond à une décision d'achat en attente. playerId doit correspondre
    // au joueur concerné par pendingDecision (sécurité côté serveur en plus).
    decide(playerId, buy) {
      if (!this.pendingDecision || this.pendingDecision.playerId !== playerId) return;
      const tile = this.board[this.pendingDecision.tileIndex];
      const player = this.players[playerId];

      if (buy) {
        this.pay(player, null, tile.price);
        tile.owner = player.id;
        this.addLog(`${player.name} achète ${tile.name} pour ${tile.price}.`);

        const wasDouble = this._pendingDiceWasDouble;
        this.pendingDecision = null;
        this._pendingDiceWasDouble = false;
        this._afterRollResolved(wasDouble);
      } else {
        this.addLog(`${player.name} ne rachète pas ${tile.name} : mise aux enchères !`);
        const tileIndex = this.pendingDecision.tileIndex;
        this.pendingDecision = null;
        // _pendingDiceWasDouble reste en mémoire : utilisé une fois l'enchère résolue.
        this.startAuction(tileIndex);
      }
    }

    // ---- Enchères — Phase 7 (secrète) + Phase 8a (classique) ----
    startAuction(tileIndex) {
      const tile = this.board[tileIndex];
      const bidders = this.activePlayers().map((p) => p.id);
      if (bidders.length === 0) {
        this._afterRollResolved(this._pendingDiceWasDouble);
        return;
      }

      if (this.auctionMode === "classic") {
        this.pendingAuction = {
          mode: "classic",
          tileIndex,
          currentBid: 0,
          currentBidderId: null,
          activeBidders: bidders,
          turnIndex: 0,
        };
        this.addLog(`🔨 Enchère classique sur ${tile.name} ! Chacun mise à son tour ou passe.`);
      } else {
        this.pendingAuction = { mode: "secret", tileIndex, bids: {}, pendingPlayers: bidders };
        this.addLog(`🔨 Enchère scellée sur ${tile.name} ! Chaque joueur mise en secret (0 pour passer).`);
      }
    }

    // -- Enchère scellée (secret) --
    submitAuctionBid(playerId, amount) {
      if (!this.pendingAuction || this.pendingAuction.mode !== "secret") {
        return { ok: false, reason: "Aucune enchère scellée en cours." };
      }
      if (!this.pendingAuction.pendingPlayers.includes(playerId)) {
        return { ok: false, reason: "Tu as déjà misé, ou cette enchère ne te concerne pas." };
      }
      const player = this.players[playerId];
      const bid = Math.max(0, Math.floor(Number(amount) || 0));
      if (bid > player.money) return { ok: false, reason: "Tu n'as pas assez d'argent pour cette mise." };

      this.pendingAuction.bids[playerId] = bid;
      this.pendingAuction.pendingPlayers = this.pendingAuction.pendingPlayers.filter((id) => id !== playerId);
      this.addLog(`${player.name} a soumis sa mise scellée.`);

      if (this.pendingAuction.pendingPlayers.length === 0) {
        this._resolveSecretAuction();
      }
      return { ok: true };
    }

    _resolveSecretAuction() {
      const auction = this.pendingAuction;
      const tile = this.board[auction.tileIndex];

      let bestId = null;
      let bestBid = -1;
      this.activePlayers().forEach((p) => {
        const bid = auction.bids[p.id] || 0;
        if (bid > bestBid) {
          bestBid = bid;
          bestId = p.id;
        }
      });

      const summary = this.activePlayers().map((p) => `${p.name} : ${auction.bids[p.id] || 0}`).join(", ");
      this.addLog(`Résultats de l'enchère sur ${tile.name} — ${summary}.`);
      this._concludeAuction(bestId, bestBid);
    }

    // -- Enchère classique (à la criée, tour par tour) --
    currentAuctionBidderId() {
      if (!this.pendingAuction || this.pendingAuction.mode !== "classic") return null;
      const a = this.pendingAuction;
      return a.activeBidders[a.turnIndex % a.activeBidders.length];
    }

    raiseAuctionBid(playerId, amount) {
      if (!this.pendingAuction || this.pendingAuction.mode !== "classic") {
        return { ok: false, reason: "Aucune enchère classique en cours." };
      }
      if (this.currentAuctionBidderId() !== playerId) return { ok: false, reason: "Ce n'est pas ton tour d'enchérir." };

      const auction = this.pendingAuction;
      const player = this.players[playerId];
      const bid = Math.floor(Number(amount) || 0);
      if (bid <= auction.currentBid) return { ok: false, reason: "Ta mise doit être supérieure à la mise actuelle." };
      if (bid > player.money) return { ok: false, reason: "Tu n'as pas assez d'argent pour cette mise." };

      auction.currentBid = bid;
      auction.currentBidderId = playerId;
      auction.turnIndex = (auction.turnIndex + 1) % auction.activeBidders.length;
      this.addLog(`${player.name} enchérit à ${bid} sur ${this.board[auction.tileIndex].name}.`);
      return { ok: true };
    }

    passAuctionBid(playerId) {
      if (!this.pendingAuction || this.pendingAuction.mode !== "classic") {
        return { ok: false, reason: "Aucune enchère classique en cours." };
      }
      if (this.currentAuctionBidderId() !== playerId) return { ok: false, reason: "Ce n'est pas ton tour d'enchérir." };

      const auction = this.pendingAuction;
      const player = this.players[playerId];
      const removedTurnIndex = auction.turnIndex;
      auction.activeBidders.splice(removedTurnIndex, 1);
      this.addLog(`${player.name} passe sur l'enchère.`);

      if (auction.activeBidders.length <= 1) {
        const winnerId = auction.activeBidders.length === 1 ? auction.activeBidders[0] : null;
        const finalWinner = winnerId !== null && winnerId === auction.currentBidderId ? winnerId : null;
        this._concludeAuction(finalWinner, auction.currentBid);
        return { ok: true };
      }

      if (auction.turnIndex >= auction.activeBidders.length) auction.turnIndex = 0;
      return { ok: true };
    }

    // Conclut n'importe quelle enchère (secrète ou classique) : attribue
    // la propriété au gagnant s'il y en a un, sinon elle reste libre.
    _concludeAuction(winnerId, winningBid) {
      const tile = this.board[this.pendingAuction.tileIndex];

      if (winnerId !== null && winningBid > 0) {
        const winner = this.players[winnerId];
        this.pay(winner, null, winningBid);
        tile.owner = winner.id;
        this.addLog(`🔨 ${winner.name} remporte l'enchère sur ${tile.name} pour ${winningBid} !`);
      } else {
        this.addLog(`Personne n'a remporté l'enchère : ${tile.name} reste libre.`);
      }

      this.pendingAuction = null;
      const wasDouble = this._pendingDiceWasDouble;
      this._pendingDiceWasDouble = false;
      this._afterRollResolved(wasDouble);
    }

    // ---- Échanges entre joueurs — Phase 7 ----
    // Contrairement aux achats/enchères, un échange ne bloque jamais le
    // jeu : n'importe qui peut en proposer ou en accepter à tout moment,
    // même si ce n'est pas son tour.
    proposeTrade(fromId, toId, offerTiles, offerMoney, requestTiles, requestMoney) {
      const from = this.players[fromId];
      const to = this.players[toId];
      if (!from || !to || from.bankrupt || to.bankrupt || fromId === toId) {
        return { ok: false, reason: "Échange impossible avec ce joueur." };
      }

      const badOffer = (offerTiles || []).some((i) => {
        const t = this.board[i];
        return !t || t.owner !== fromId || t.mortgaged;
      });
      const badRequest = (requestTiles || []).some((i) => {
        const t = this.board[i];
        return !t || t.owner !== toId || t.mortgaged;
      });
      if (badOffer || badRequest) {
        return { ok: false, reason: "Une des propriétés choisies n'est plus valide (hypothéquée ou non possédée)." };
      }

      const money1 = Math.max(0, Math.floor(Number(offerMoney) || 0));
      const money2 = Math.max(0, Math.floor(Number(requestMoney) || 0));
      if (money1 > from.money) return { ok: false, reason: "Tu ne peux pas offrir plus d'argent que tu n'en as." };

      const trade = {
        id: this._nextTradeId++,
        fromId,
        toId,
        offerTiles: [...(offerTiles || [])],
        offerMoney: money1,
        requestTiles: [...(requestTiles || [])],
        requestMoney: money2,
      };
      this.tradeOffers.push(trade);
      this.addLog(`${from.name} propose un échange à ${to.name}.`);
      return { ok: true, tradeId: trade.id };
    }

    respondTrade(tradeId, playerId, accept) {
      const idx = this.tradeOffers.findIndex((t) => t.id === tradeId);
      if (idx === -1) return { ok: false, reason: "Cette proposition n'existe plus." };
      const trade = this.tradeOffers[idx];
      if (trade.toId !== playerId) return { ok: false, reason: "Cette proposition ne t'est pas destinée." };

      if (!accept) {
        this.tradeOffers.splice(idx, 1);
        this.addLog(`${this.players[playerId].name} refuse l'échange proposé par ${this.players[trade.fromId].name}.`);
        return { ok: true };
      }

      // On revérifie que tout est toujours valide au moment de l'acceptation
      // (une propriété a pu être vendue/hypothéquée entre-temps).
      const from = this.players[trade.fromId];
      const to = this.players[trade.toId];
      const offerStillValid = trade.offerTiles.every((i) => this.board[i].owner === trade.fromId && !this.board[i].mortgaged);
      const requestStillValid = trade.requestTiles.every((i) => this.board[i].owner === trade.toId && !this.board[i].mortgaged);

      if (!offerStillValid || !requestStillValid || from.money < trade.offerMoney || to.money < trade.requestMoney) {
        this.tradeOffers.splice(idx, 1);
        return { ok: false, reason: "L'échange n'est plus valide (une propriété ou l'argent a changé depuis la proposition)." };
      }

      trade.offerTiles.forEach((i) => { this.board[i].owner = trade.toId; });
      trade.requestTiles.forEach((i) => { this.board[i].owner = trade.fromId; });

      const offerTax = Math.floor((trade.offerMoney * this.tradeTaxPercent) / 100);
      const requestTax = Math.floor((trade.requestMoney * this.tradeTaxPercent) / 100);
      this.pay(from, null, offerTax); // la taxe part à la banque, pas à l'autre joueur
      this.pay(to, null, requestTax);
      this.pay(from, to, trade.offerMoney - offerTax);
      this.pay(to, from, trade.requestMoney - requestTax);

      this.tradeOffers.splice(idx, 1);
      const taxNote = this.tradeTaxPercent > 0 ? ` (taxe de ${this.tradeTaxPercent}% prélevée)` : "";
      this.addLog(`🤝 Échange conclu entre ${from.name} et ${to.name}${taxNote} !`);
      return { ok: true };
    }

    cancelTrade(tradeId, playerId) {
      const idx = this.tradeOffers.findIndex((t) => t.id === tradeId);
      if (idx === -1) return { ok: false, reason: "Cette proposition n'existe plus." };
      if (this.tradeOffers[idx].fromId !== playerId) return { ok: false, reason: "Tu ne peux annuler que tes propres propositions." };
      this.tradeOffers.splice(idx, 1);
      this.addLog(`${this.players[playerId].name} annule sa proposition d'échange.`);
      return { ok: true };
    }

    // Snapshot complet et public de l'état de la partie (aucune information
    // cachée dans ce jeu, donc pas besoin de vues différentes par joueur).
    getPublicState() {
      return {
        turnNumber: this.turnNumber,
        currentPlayerIndex: this.currentPlayerIndex,
        pendingDecision: this.pendingDecision,
        gameOver: this.gameOver,
        winner: this.winner ? { id: this.winner.id, name: this.winner.name } : null,
        lastRoll: this.lastRoll,
        vacationPot: this.vacationPotEnabled ? this.vacationPot : null,
        turnLimit: this.turnLimit,
        // Enchère secrète : on ne révèle jamais les montants avant la fin.
        // Enchère classique : tout est public (comme à la criée en vrai).
        pendingAuction: this.pendingAuction
          ? this.pendingAuction.mode === "classic"
            ? {
                mode: "classic",
                tileIndex: this.pendingAuction.tileIndex,
                currentBid: this.pendingAuction.currentBid,
                currentBidderId: this.pendingAuction.currentBidderId,
                activeBidders: [...this.pendingAuction.activeBidders],
                currentTurnPlayerId: this.currentAuctionBidderId(),
              }
            : {
                mode: "secret",
                tileIndex: this.pendingAuction.tileIndex,
                pendingPlayers: [...this.pendingAuction.pendingPlayers],
              }
          : null,
        tradeOffers: this.tradeOffers.map((t) => ({ ...t })),
        players: this.players.map((p) => ({
          id: p.id,
          name: p.name,
          position: p.position,
          money: p.money,
          inJail: p.inJail,
          jailTurns: p.jailTurns,
          jailFreeCards: p.jailFreeCards,
          bankrupt: p.bankrupt,
        })),
        board: this.board.map((t) => ({
          type: t.type,
          name: t.name,
          group: t.group || null,
          price: t.price || null,
          rent: t.rent || null,
          owner: t.owner === undefined ? null : t.owner,
          houses: t.houses || 0,
          mortgaged: !!t.mortgaged,
          houseCost: t.type === "property" ? HOUSE_COST_BY_GROUP[t.group] : null,
        })),
        log: this.log.slice(-80),
      };
    }

    // ---- Mode automatique (utilisé par la page de test solo, Phase 2) ----
    // Joue le tour complet du joueur courant, y compris les relances en cas
    // de double, en utilisant decideBuy() pour les achats au lieu d'attendre
    // un vrai humain. Repose entièrement sur roll()/decide() ci-dessus :
    // c'est la MÊME logique de règles que le mode interactif.
    playTurn() {
      if (this.gameOver) return;
      const startingIndex = this.currentPlayerIndex;
      do {
        if (this.pendingAuction) {
          const tile = this.board[this.pendingAuction.tileIndex];
          if (this.pendingAuction.mode === "classic") {
            // Chacun mise ou passe à son tour jusqu'à ce qu'il n'en reste qu'un.
            const bidderId = this.currentAuctionBidderId();
            const bidder = this.players[bidderId];
            const nextBid = this.pendingAuction.currentBid + Math.floor(tile.price * 0.1) + 5;
            const wantsIt = this.decideBuy(bidder, tile) && nextBid <= tile.price;
            if (wantsIt && nextBid <= bidder.money) {
              this.raiseAuctionBid(bidderId, nextBid);
            } else {
              this.passAuctionBid(bidderId);
            }
          } else {
            // Copie du tableau : on va le modifier pendant qu'on le parcourt.
            [...this.pendingAuction.pendingPlayers].forEach((pid) => {
              const bidder = this.players[pid];
              const wantsIt = this.decideBuy(bidder, tile);
              const amount = wantsIt ? Math.min(tile.price, Math.floor(bidder.money * 0.3)) : 0;
              this.submitAuctionBid(pid, amount);
            });
          }
        } else if (this.pendingDecision) {
          const tile = this.board[this.pendingDecision.tileIndex];
          const player = this.players[this.pendingDecision.playerId];
          const wantsToBuy = this.decideBuy(player, tile);
          this.decide(this.pendingDecision.playerId, wantsToBuy);
        } else {
          this.roll();
        }
      } while (!this.gameOver && this.currentPlayerIndex === startingIndex);
    }
  }

  return { GameEngine };
});
