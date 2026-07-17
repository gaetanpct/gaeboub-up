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
    const { BOARD, CHANCE_CARDS } = require("./board.js");
    module.exports = factory(BOARD, CHANCE_CARDS);
  } else {
    root.ReachUpEngine = factory(root.ReachUpBoard.BOARD, root.ReachUpBoard.CHANCE_CARDS);
  }
})(typeof window !== "undefined" ? window : globalThis, function (BOARD_TEMPLATE, CHANCE_CARDS) {

  const STARTING_MONEY = 1500;
  const SALARY = 200;
  const JAIL_POSITION = 10;
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
     */
    constructor(playerNames, options = {}) {
      // On clone le plateau à chaque partie : chaque partie a ses propres
      // propriétaires, sans jamais modifier le modèle partagé (BOARD_TEMPLATE).
      this.board = BOARD_TEMPLATE.map((tile) => ({ ...tile }));

      this.players = playerNames.map((name, id) => ({
        id,
        name,
        position: 0,
        money: STARTING_MONEY,
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
      const d1 = 1 + Math.floor(Math.random() * 6);
      const d2 = 1 + Math.floor(Math.random() * 6);
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
        this.pay(null, player, SALARY);
        this.addLog(`${player.name} passe par la case Départ et touche ${SALARY}.`);
      }
    }

    sendToJail(player) {
      player.position = JAIL_POSITION;
      player.inJail = true;
      player.jailTurns = 0;
      this.addLog(`${player.name} est envoyé en prison.`);
    }

    ownsFullSet(playerId, group) {
      const tilesOfGroup = this.board.filter((t) => t.type === "property" && t.group === group);
      return tilesOfGroup.every((t) => t.owner === playerId);
    }

    // Résout une case qui n'a besoin d'AUCUNE décision humaine
    // (loyer, taxe, carte destin, prison...). L'achat d'une case libre
    // est géré séparément par roll()/decide(), pas ici.
    resolveTile(player, tile, diceSum) {
      switch (tile.type) {
        case "property": {
          if (tile.owner === null) {
            this.addLog(`${player.name} n'a pas assez d'argent pour acheter ${tile.name}.`);
          } else if (tile.owner !== player.id) {
            let rent = tile.rent;
            if (this.ownsFullSet(tile.owner, tile.group)) rent *= 2;
            const owner = this.players[tile.owner];
            this.pay(player, owner, rent);
            this.addLog(`${player.name} paie ${rent} de loyer à ${owner.name} (${tile.name}).`);
          }
          break;
        }
        case "airport": {
          if (tile.owner === null) {
            this.addLog(`${player.name} n'a pas assez d'argent pour acheter ${tile.name}.`);
          } else if (tile.owner !== player.id) {
            const owner = this.players[tile.owner];
            const count = this.board.filter((t) => t.type === "airport" && t.owner === tile.owner).length;
            const rentTable = [25, 50, 100, 200];
            const rent = rentTable[count - 1];
            this.pay(player, owner, rent);
            this.addLog(`${player.name} paie ${rent} de loyer à ${owner.name} (${tile.name}).`);
          }
          break;
        }
        case "utility": {
          if (tile.owner === null) {
            this.addLog(`${player.name} n'a pas assez d'argent pour acheter ${tile.name}.`);
          } else if (tile.owner !== player.id) {
            const owner = this.players[tile.owner];
            const count = this.board.filter((t) => t.type === "utility" && t.owner === tile.owner).length;
            const multiplier = count === 1 ? 4 : 10;
            const rent = diceSum * multiplier;
            this.pay(player, owner, rent);
            this.addLog(`${player.name} paie ${rent} de loyer à ${owner.name} (${tile.name}, ${count === 1 ? "x4" : "x10"} le lancer de dés).`);
          }
          break;
        }
        case "tax": {
          this.pay(player, null, tile.amount);
          this.addLog(`${player.name} paie ${tile.amount} de taxe (${tile.name}).`);
          break;
        }
        case "chance": {
          const card = CHANCE_CARDS[Math.floor(Math.random() * CHANCE_CARDS.length)];
          this.addLog(`${player.name} tire une carte Destin : "${card.description}"`);
          card.effect(this, player);
          break;
        }
        case "go-to-jail": {
          this.sendToJail(player);
          break;
        }
        // "go", "jail" (simple visite), "vacation" : pas d'effet particulier ici
        default:
          break;
      }
    }

    // Une case "nécessite une décision" seulement si elle est achetable,
    // libre, ET que le joueur a les moyens de se la payer.
    _tileNeedsDecision(player, tile) {
      const ownableTypes = ["property", "airport", "utility"];
      return ownableTypes.includes(tile.type) && tile.owner === null && player.money >= tile.price;
    }

    checkBankruptcy(player) {
      if (player.money < 0 && !player.bankrupt) {
        player.bankrupt = true;
        // Ses propriétés redeviennent libres (pas d'enchère pour l'instant)
        this.board.forEach((tile) => {
          if (tile.owner === player.id) tile.owner = null;
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
      if (this.gameOver || this.pendingDecision) return;
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

      if (this._tileNeedsDecision(player, tile)) {
        this.pendingDecision = { type: "buy", tileIndex: player.position, playerId: player.id };
        this._pendingDiceWasDouble = isDouble;
        return; // on attend maintenant un appel à decide()
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
      } else {
        this.addLog(`${player.name} ne rachète pas ${tile.name}.`);
      }

      const wasDouble = this._pendingDiceWasDouble;
      this.pendingDecision = null;
      this._pendingDiceWasDouble = false;
      this._afterRollResolved(wasDouble);
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
        if (this.pendingDecision) {
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
