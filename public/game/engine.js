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
    const { POWERS, STEAL_AMOUNT, DOUBLE_RENT_CAP, DISCOUNT_PURCHASE_PERCENT, BANK_LOAN_AMOUNT, randomPowerId } = require("./powers.js");
    const { WORLD_EVENTS, EVENT_DURATION_TURNS, FREQUENCY_PROBABILITY, randomEvent } = require("./world-events.js");
    const { INSURANCE_PLANS } = require("./insurance-plans.js");
    module.exports = factory(
      BOARD, CHANCE_CARDS, HOUSE_COST_BY_GROUP, RENT_MULTIPLIERS_BY_HOUSES,
      POWERS, STEAL_AMOUNT, DOUBLE_RENT_CAP, DISCOUNT_PURCHASE_PERCENT, BANK_LOAN_AMOUNT, randomPowerId,
      WORLD_EVENTS, EVENT_DURATION_TURNS, FREQUENCY_PROBABILITY, randomEvent,
      INSURANCE_PLANS
    );
  } else {
    const b = root.ReachUpBoard;
    const p = root.ReachUpPowers;
    const w = root.ReachUpWorldEvents;
    const ins = root.ReachUpInsurance;
    root.ReachUpEngine = factory(
      b.BOARD, b.CHANCE_CARDS, b.HOUSE_COST_BY_GROUP, b.RENT_MULTIPLIERS_BY_HOUSES,
      p.POWERS, p.STEAL_AMOUNT, p.DOUBLE_RENT_CAP, p.DISCOUNT_PURCHASE_PERCENT, p.BANK_LOAN_AMOUNT, p.randomPowerId,
      w.WORLD_EVENTS, w.EVENT_DURATION_TURNS, w.FREQUENCY_PROBABILITY, w.randomEvent,
      ins.INSURANCE_PLANS
    );
  }
})(typeof window !== "undefined" ? window : globalThis, function (
  BOARD_TEMPLATE, CHANCE_CARDS, HOUSE_COST_BY_GROUP, RENT_MULTIPLIERS_BY_HOUSES,
  POWERS, STEAL_AMOUNT, DOUBLE_RENT_CAP, DISCOUNT_PURCHASE_PERCENT, BANK_LOAN_AMOUNT, randomPowerId,
  WORLD_EVENTS, EVENT_DURATION_TURNS, FREQUENCY_PROBABILITY, randomEvent,
  INSURANCE_PLANS
) {
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
      this.forcedAuctionsPerGame = options.forcedAuctionsPerGame || 0;
      this.worldEventsEnabled = !!options.worldEventsEnabled;
      this.worldEventFrequency = options.worldEventFrequency || "normal";
      this.activeEvent = null; // { id, turnsRemaining }
      this.turnDirection = 1; // 1 = normal, -1 = inversé (événement "rank_reversal")
      this.loansEnabled = !!options.loansEnabled;
      this.insuranceEnabled = !!options.insuranceEnabled;
      this.insurancePrices = [
        options.insurancePlan1Price !== undefined ? options.insurancePlan1Price : 60,
        options.insurancePlan2Price !== undefined ? options.insurancePlan2Price : 100,
        options.insurancePlan3Price !== undefined ? options.insurancePlan3Price : 150,
      ];
      this.loans = []; // prêts actifs (acceptés) : { id, lenderId, borrowerId, principal, interestRate, totalOwed, turnsRemaining }
      this.loanOffers = []; // propositions de prêt en attente de réponse
      this._nextLoanId = 1;

      const startingMoney = options.startingMoney || STARTING_MONEY;
      this.powersEnabled = !!options.powersEnabled;
      this.players = playerNames.map((name, id) => ({
        id,
        name,
        position: 0,
        money: startingMoney,
        inJail: false,
        jailTurns: 0,
        jailFreeCards: 0,
        bankrupt: false,
        power: this.powersEnabled ? { id: randomPowerId(), used: false } : null,
        insurance: null, // { planId, planName, turnsRemaining, coveragePercent }
        forcedAuctionsUsed: 0,
        stats: {
          rentPaid: 0,
          rentReceived: 0,
          taxesPaid: 0,
          timesInJail: 0,
          propertiesBought: 0,
          auctionsWon: 0,
          housesBuilt: 0,
          tradesCompleted: 0,
          biggestRentPaid: 0,
          salaryCollected: 0,
        },
      }));

      this.decideBuy =
        options.decideBuy ||
        ((player, tile) => player.money - tile.price >= 100);

      this.currentPlayerIndex = 0;
      this.turnNumber = 1;
      this.log = [];
      this.gameOver = false;
      this.winner = null;

      if (this.powersEnabled) {
        this.players.forEach((p) => {
          const power = POWERS.find((pw) => pw.id === p.power.id);
          this.addLog(`${power.icon} ${p.name} reçoit le pouvoir "${power.name}" : ${power.description}`);
        });
      }

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
        const doubled = this.activeEvent && this.activeEvent.id === "double_salary";
        const salaryAmount = doubled ? this.salary * 2 : this.salary;
        this.pay(null, player, salaryAmount);
        player.stats.salaryCollected += salaryAmount;
        this.addLog(`${player.name} passe par la case Départ et touche ${salaryAmount}${doubled ? " (salaire doublé !)" : ""}.`);
      }
    }

    sendToJail(player) {
      if (player.power && player.power.id === "jail_skip" && !player.power.used) {
        player.power.used = true;
        this.addLog(`🕊️ ${player.name} utilise son pouvoir et évite la prison !`);
        return;
      }
      // La case Prison est toujours au premier quart du plateau (comme sur
      // le plateau fixe), quelle que soit la taille réelle de celui-ci.
      player.position = this.board.length / 4;
      player.inJail = true;
      player.jailTurns = 0;
      player.stats.timesInJail += 1;
      this.addLog(`${player.name} est envoyé en prison.`);
    }

    ownsFullSet(playerId, group) {
      const tilesOfGroup = this.board.filter((t) => t.type === "property" && t.group === group);
      return tilesOfGroup.every((t) => t.owner === playerId);
    }

    // ---- Pouvoirs — Phase 8c ----
    // Applique (et consomme) le pouvoir "loyer doublé" du propriétaire s'il
    // en a un disponible. Renvoie le loyer éventuellement doublé.
    _applyDoubleRentPower(owner, rent) {
      if (owner.power && owner.power.id === "double_rent" && !owner.power.used) {
        owner.power.used = true;
        const bonus = Math.min(rent, DOUBLE_RENT_CAP);
        this.addLog(`💰 ${owner.name} utilise son pouvoir : loyer majoré de ${bonus} (plafonné à ${DOUBLE_RENT_CAP}) !`);
        return rent + bonus;
      }
      return rent;
    }

    // Paie un loyer en tenant compte d'une éventuelle assurance active chez
    // le payeur (Phase 8e) : il paie moins, le propriétaire touche quand
    // même le plein montant, la différence est prise en charge par la banque.
    _payRentWithInsurance(payer, owner, rent) {
      if (payer.insurance && payer.insurance.turnsRemaining > 0) {
        const covered = Math.floor((rent * payer.insurance.coveragePercent) / 100);
        const payerShare = rent - covered;
        this.pay(payer, owner, payerShare);
        if (covered > 0) {
          this.pay(null, owner, covered);
          this.addLog(`🛡️ L'assurance de ${payer.name} prend en charge ${covered} sur ce loyer.`);
        }
        return;
      }
      this.pay(payer, owner, rent);
    }

    // Pouvoir actif "Téléportation" : utilisable à tout moment (pas
    // seulement à son tour), une seule fois par partie.
    useTeleportPower(playerId, tileIndex) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!player.power || player.power.id !== "teleport") return { ok: false, reason: "Tu n'as pas ce pouvoir." };
      if (player.power.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };
      if (tileIndex < 0 || tileIndex >= this.board.length) return { ok: false, reason: "Case invalide." };

      player.power.used = true;
      player.position = tileIndex;
      const tile = this.board[tileIndex];
      this.addLog(`🌀 ${player.name} utilise son pouvoir de téléportation et apparaît sur "${tile.name}" !`);
      return { ok: true };
    }

    // Pouvoir actif "Prêt bancaire" : reçoit un montant fixe de la banque,
    // utilisable à tout moment, une seule fois par partie.
    useBankLoanPower(playerId) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!player.power || player.power.id !== "bank_loan") return { ok: false, reason: "Tu n'as pas ce pouvoir." };
      if (player.power.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };

      player.power.used = true;
      this.pay(null, player, BANK_LOAN_AMOUNT);
      this.addLog(`🏦 ${player.name} utilise son pouvoir et reçoit ${BANK_LOAN_AMOUNT} de la banque !`);
      return { ok: true };
    }
    // Pouvoir actif "Vol" : vole jusqu'à STEAL_AMOUNT à un adversaire,
    // utilisable à tout moment, une seule fois par partie.
    useStealPower(playerId, targetId) {
      const player = this.players[playerId];
      const target = this.players[targetId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!target || target.bankrupt || targetId === playerId) return { ok: false, reason: "Cible invalide." };
      if (!player.power || player.power.id !== "theft") return { ok: false, reason: "Tu n'as pas ce pouvoir." };
      if (player.power.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };

      player.power.used = true;
      const amount = Math.min(STEAL_AMOUNT, target.money);
      this.pay(target, player, amount);
      this.addLog(`🗝️ ${player.name} utilise son pouvoir de vol et dérobe ${amount} à ${target.name} !`);
      return { ok: true };
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
      player.stats.housesBuilt += 1;
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
      const isFree = this.activeEvent && this.activeEvent.id === "free_sales";
      const refund = isFree ? HOUSE_COST_BY_GROUP[tile.group] : check.refund;
      this.pay(null, player, refund);
      this.addLog(`${player.name} vend une maison sur ${tile.name} pour ${refund}${isFree ? " (Ventes gratuites !)" : ""}.`);
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
            rent = this._applyDoubleRentPower(owner, rent);
            this._payRentWithInsurance(player, owner, rent);
            player.stats.rentPaid += rent;
            owner.stats.rentReceived += rent;
            player.stats.biggestRentPaid = Math.max(player.stats.biggestRentPaid, rent);
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
            let rent = rentTable[Math.max(count - 1, 0)];
            rent = this._applyDoubleRentPower(owner, rent);
            this._payRentWithInsurance(player, owner, rent);
            player.stats.rentPaid += rent;
            owner.stats.rentReceived += rent;
            player.stats.biggestRentPaid = Math.max(player.stats.biggestRentPaid, rent);
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
            let rent = diceSum * multiplier;
            rent = this._applyDoubleRentPower(owner, rent);
            this._payRentWithInsurance(player, owner, rent);
            player.stats.rentPaid += rent;
            owner.stats.rentReceived += rent;
            player.stats.biggestRentPaid = Math.max(player.stats.biggestRentPaid, rent);
            this.addLog(`${player.name} paie ${rent} de loyer à ${owner.name} (${tile.name}, ${count === 1 ? "x4" : "x10"} le lancer de dés).`);
          }
          break;
        }
        case "tax": {
          if (player.power && player.power.id === "tax_immunity" && !player.power.used) {
            player.power.used = true;
            this.addLog(`🛡️ ${player.name} utilise son immunité fiscale : ${tile.name} ne lui coûte rien !`);
            break;
          }
          this.pay(player, null, tile.amount);
          player.stats.taxesPaid += tile.amount;
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
          if (tile.type === "special" && this.worldEventsEnabled && !this.activeEvent) {
            this._startRandomWorldEvent();
            break;
          }
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
      this._tickPersonalTimers(this.currentPlayerIndex);
      do {
        this.currentPlayerIndex =
          (this.currentPlayerIndex + this.turnDirection + this.players.length) % this.players.length;
      } while (this.players[this.currentPlayerIndex].bankrupt);
      this.doublesStreak = 0;
      this.turnNumber += 1;
      this._turnBannerLogged = false;

      this._tickWorldEvent();
    }

    // ---- Événements mondiaux temporaires — Phase 8d ----
    _startRandomWorldEvent() {
      const event = randomEvent();
      this.activeEvent = { id: event.id, turnsRemaining: EVENT_DURATION_TURNS };
      if (event.id === "rank_reversal") this.turnDirection = -1;
      this.addLog(`${event.icon} Événement mondial : "${event.name}" ! ${event.description} (${EVENT_DURATION_TURNS} tours)`);
    }

    _tickWorldEvent() {
      if (this.activeEvent) {
        this.activeEvent.turnsRemaining -= 1;
        if (this.activeEvent.turnsRemaining <= 0) {
          const ended = WORLD_EVENTS.find((e) => e.id === this.activeEvent.id);
          this.addLog(`${ended.icon} L'événement "${ended.name}" est terminé.`);
          if (this.activeEvent.id === "rank_reversal") this.turnDirection = 1;
          this.activeEvent = null;
        }
        return;
      }
      if (!this.worldEventsEnabled) return;
      const probability = FREQUENCY_PROBABILITY[this.worldEventFrequency] || FREQUENCY_PROBABILITY.normal;
      if (Math.random() < probability) {
        this._startRandomWorldEvent();
      }
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
      let sum = d1 + d2;
      if (this.activeEvent && this.activeEvent.id === "double_movement") sum *= 2;
      this.lastRoll = { playerId: player.id, d1, d2, isDouble, inJailRoll: false };
      this.addLog(`${player.name} lance les dés : ${d1} et ${d2}${isDouble ? " (double !)" : ""}${this.activeEvent && this.activeEvent.id === "double_movement" ? " — déplacement doublé !" : ""}.`);

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
        const effectivePrice = this._effectivePrice(tile.price);
        if (player.money >= effectivePrice) {
          this.pendingDecision = { type: "buy", tileIndex: player.position, playerId: player.id, price: effectivePrice };
          this._pendingDiceWasDouble = isDouble;
        } else {
          this.addLog(`${player.name} n'a pas les moyens d'acheter ${tile.name}.`);
          this._pendingDiceWasDouble = isDouble;
          this.startAuction(player.position);
        }
        return; // on attend maintenant un achat, une enchère, ou les deux à la suite
      }

      this._pendingDiceWasDouble = isDouble;
      this.resolveTile(player, tile, sum);
      // Une carte Destin/Spéciale tirée ici a pu elle-même déplacer le
      // joueur vers une case achetable (ex: "avance de 3 cases") et donc
      // mettre une décision ou une enchère en attente : dans ce cas, on
      // ne conclut PAS encore ce lancer, on attend que ce soit réglé.
      if (!this.pendingDecision && !this.pendingAuction) {
        this._afterRollResolved(isDouble);
      }
    }

    // Utilisé par certaines cartes Destin/Spéciales qui déplacent le
    // joueur en cours de résolution (ex: "avance de 3 cases", "va à
    // l'aéroport le plus proche"). Reproduit la même logique que
    // l'arrivée normale sur une case (achat, enchère, loyer...), pour que
    // la case soit traitée exactement comme si le joueur y était arrivé
    // par les dés. Renvoie true si une décision/enchère est maintenant en
    // attente (le tour ne doit alors pas être conclu tout de suite).
    // Cherche la prochaine case d'un type donné en avançant depuis une
    // position (utilisé par les cartes "fonce vers l'aéroport/la compagnie
    // le·la plus proche"). Fonctionne quelle que soit la disposition du
    // plateau (fixe ou généré).
    _findNearestTileOfType(fromIndex, type) {
      const len = this.board.length;
      for (let step = 1; step <= len; step++) {
        const idx = (fromIndex + step) % len;
        if (this.board[idx].type === type) return idx;
      }
      return fromIndex; // filet de sécurité si ce type de case n'existe pas sur ce plateau
    }

    _landOnTile(player, newIndex) {
      player.position = newIndex;
      const tile = this.board[newIndex];
      this.addLog(`${player.name} est déplacé sur "${tile.name}".`);

      const ownableTypes = ["property", "airport", "utility"];
      if (ownableTypes.includes(tile.type) && tile.owner === null) {
        const effectivePrice = this._effectivePrice(tile.price);
        if (player.money >= effectivePrice) {
          this.pendingDecision = { type: "buy", tileIndex: newIndex, playerId: player.id, price: effectivePrice };
          return true;
        }
        this.addLog(`${player.name} n'a pas les moyens d'acheter ${tile.name}.`);
        this.startAuction(newIndex, { triggeredByRoll: true });
        return true;
      }

      // Le loyer d'une compagnie dépend d'un lancer de dés : on en tire un
      // petit spécifiquement pour ça (le déplacement lui-même vient de la carte).
      const diceSumForUtility = tile.type === "utility" ? this.rollDice().reduce((a, b) => a + b, 0) : 0;
      this.resolveTile(player, tile, diceSumForUtility);
      return false;
    }

    // Répond à une décision d'achat en attente. playerId doit correspondre
    // au joueur concerné par pendingDecision (sécurité côté serveur en plus).
    // Prix réellement payé pour une case, en tenant compte de l'événement
    // "Réduction des prix" (Phase 8d) s'il est actif.
    _effectivePrice(price) {
      if (this.activeEvent && this.activeEvent.id === "price_reduction") {
        return Math.floor(price * 0.75);
      }
      return price;
    }

    decide(playerId, buy) {
      if (!this.pendingDecision || this.pendingDecision.playerId !== playerId) return;
      const tile = this.board[this.pendingDecision.tileIndex];
      const player = this.players[playerId];

      if (buy) {
        let price = this.pendingDecision.price;
        const discounted = this.activeEvent && this.activeEvent.id === "price_reduction";
        let powerDiscountApplied = false;
        if (player.power && player.power.id === "discount_purchase" && !player.power.used) {
          player.power.used = true;
          price = Math.floor((price * (100 - DISCOUNT_PURCHASE_PERCENT)) / 100);
          powerDiscountApplied = true;
        }
        this.pay(player, null, price);
        tile.owner = player.id;
        player.stats.propertiesBought += 1;
        const note = powerDiscountApplied ? " (🏷️ remise Négociateur !)" : discounted ? " (prix réduit !)" : "";
        this.addLog(`${player.name} achète ${tile.name} pour ${price}${note}.`);

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
    startAuction(tileIndex, options = {}) {
      const triggeredByRoll = options.triggeredByRoll !== false;
      const tile = this.board[tileIndex];
      const bidders = this.activePlayers().map((p) => p.id);
      if (bidders.length === 0) {
        if (triggeredByRoll) this._afterRollResolved(this._pendingDiceWasDouble);
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
          triggeredByRoll,
        };
        this.addLog(`🔨 Enchère classique sur ${tile.name} ! Chacun mise à son tour ou passe.`);
      } else {
        this.pendingAuction = { mode: "secret", tileIndex, bids: {}, pendingPlayers: bidders, triggeredByRoll };
        this.addLog(`🔨 Enchère scellée sur ${tile.name} ! Chaque joueur mise en secret (0 pour passer).`);
      }
    }

    // Une enchère "forcée" : n'importe quel joueur peut, à tout moment (pas
    // seulement à son tour), déclencher une enchère sur une case libre de
    // son choix — un nombre limité de fois par partie (Phase 10).
    startForcedAuction(playerId, tileIndex) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this.forcedAuctionsPerGame || this.forcedAuctionsPerGame <= 0) {
        return { ok: false, reason: "Cette règle n'est pas activée pour cette partie." };
      }
      if (player.forcedAuctionsUsed >= this.forcedAuctionsPerGame) {
        return { ok: false, reason: "Tu as déjà utilisé toutes tes enchères forcées." };
      }
      if (this.pendingAuction || this.pendingDecision) {
        return { ok: false, reason: "Une autre enchère ou décision est déjà en cours." };
      }
      const tile = this.board[tileIndex];
      const ownableTypes = ["property", "airport", "utility"];
      if (!tile || !ownableTypes.includes(tile.type) || tile.owner !== null) {
        return { ok: false, reason: "Cette case n'est pas disponible pour une enchère forcée (déjà possédée ou non achetable)." };
      }

      player.forcedAuctionsUsed += 1;
      this.addLog(`🔨 ${player.name} déclenche une enchère forcée sur ${tile.name} (${player.forcedAuctionsUsed}/${this.forcedAuctionsPerGame}) !`);
      this.startAuction(tileIndex, { triggeredByRoll: false });
      return { ok: true };
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
      const triggeredByRoll = this.pendingAuction.triggeredByRoll;

      if (winnerId !== null && winningBid > 0) {
        const winner = this.players[winnerId];
        this.pay(winner, null, winningBid);
        tile.owner = winner.id;
        winner.stats.auctionsWon += 1;
        this.addLog(`🔨 ${winner.name} remporte l'enchère sur ${tile.name} pour ${winningBid} !`);
      } else {
        this.addLog(`Personne n'a remporté l'enchère : ${tile.name} reste libre.`);
      }

      this.pendingAuction = null;
      if (triggeredByRoll) {
        const wasDouble = this._pendingDiceWasDouble;
        this._pendingDiceWasDouble = false;
        this._afterRollResolved(wasDouble);
      }
    }

    // ---- Échanges entre joueurs — Phase 7 ----
    // Contrairement aux achats/enchères, un échange ne bloque jamais le
    // jeu : n'importe qui peut en proposer ou en accepter à tout moment,
    // même si ce n'est pas son tour.
    proposeTrade(fromId, toId, offerTiles, offerMoney, requestTiles, requestMoney) {
      if (this.activeEvent && this.activeEvent.id === "trade_freeze") {
        return { ok: false, reason: "Les échanges sont gelés pour le moment (événement mondial en cours)." };
      }
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

      if (this.activeEvent && this.activeEvent.id === "trade_freeze") {
        return { ok: false, reason: "Les échanges sont gelés pour le moment (événement mondial en cours)." };
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
      from.stats.tradesCompleted += 1;
      to.stats.tradesCompleted += 1;
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

    // ---- Prêts entre joueurs — Phase 8e ----
    // Le prêteur choisit librement le montant, le taux d'intérêt et la
    // durée. Contrairement aux échanges, un prêt ne bloque jamais le jeu.
    proposeLoan(lenderId, borrowerId, amount, interestRatePercent, durationTurns) {
      if (!this.loansEnabled) return { ok: false, reason: "Les prêts ne sont pas activés pour cette partie." };

      const lender = this.players[lenderId];
      const borrower = this.players[borrowerId];
      if (!lender || !borrower || lender.bankrupt || borrower.bankrupt || lenderId === borrowerId) {
        return { ok: false, reason: "Prêt impossible avec ce joueur." };
      }

      const principal = Math.max(1, Math.floor(Number(amount) || 0));
      if (principal > lender.money) return { ok: false, reason: "Tu ne peux pas prêter plus que ce que tu as." };

      const rate = Math.max(0, Math.min(200, Math.floor(Number(interestRatePercent) || 0)));
      const duration = Math.max(1, Math.min(20, Math.floor(Number(durationTurns) || 5)));
      // Calcul en entiers pour éviter les imprécisions flottantes
      // (ex: 200 * 1.1 peut donner 220.00000000000003 en JavaScript).
      const totalOwed = Math.ceil((principal * (100 + rate)) / 100);

      const offer = { id: this._nextLoanId++, lenderId, borrowerId, principal, interestRate: rate, duration, totalOwed };
      this.loanOffers.push(offer);
      this.addLog(
        `💳 ${lender.name} propose un prêt de ${principal} à ${borrower.name} (taux ${rate}%, à rembourser en ${duration} tours, total dû : ${totalOwed}).`
      );
      return { ok: true, offerId: offer.id };
    }

    respondLoan(offerId, playerId, accept) {
      const idx = this.loanOffers.findIndex((o) => o.id === offerId);
      if (idx === -1) return { ok: false, reason: "Cette proposition n'existe plus." };
      const offer = this.loanOffers[idx];
      if (offer.borrowerId !== playerId) return { ok: false, reason: "Cette proposition ne t'est pas destinée." };

      if (!accept) {
        this.loanOffers.splice(idx, 1);
        this.addLog(`${this.players[playerId].name} refuse le prêt proposé par ${this.players[offer.lenderId].name}.`);
        return { ok: true };
      }

      const lender = this.players[offer.lenderId];
      const borrower = this.players[offer.borrowerId];
      if (lender.money < offer.principal) {
        this.loanOffers.splice(idx, 1);
        return { ok: false, reason: "Le prêteur n'a plus assez d'argent pour ce prêt." };
      }

      this.pay(lender, borrower, offer.principal);
      this.loans.push({
        id: offer.id,
        lenderId: offer.lenderId,
        borrowerId: offer.borrowerId,
        principal: offer.principal,
        interestRate: offer.interestRate,
        totalOwed: offer.totalOwed,
        turnsRemaining: offer.duration,
      });
      this.loanOffers.splice(idx, 1);
      this.addLog(
        `💳 ${borrower.name} accepte le prêt de ${lender.name} : ${offer.principal} reçus maintenant, ${offer.totalOwed} à rembourser dans ${offer.duration} tours.`
      );
      return { ok: true };
    }

    cancelLoanOffer(offerId, playerId) {
      const idx = this.loanOffers.findIndex((o) => o.id === offerId);
      if (idx === -1) return { ok: false, reason: "Cette proposition n'existe plus." };
      if (this.loanOffers[idx].lenderId !== playerId) return { ok: false, reason: "Tu ne peux annuler que tes propres propositions." };
      this.loanOffers.splice(idx, 1);
      this.addLog(`${this.players[playerId].name} annule sa proposition de prêt.`);
      return { ok: true };
    }

    // Remboursement volontaire, avant l'échéance.
    repayLoanEarly(loanId, playerId) {
      const idx = this.loans.findIndex((l) => l.id === loanId);
      if (idx === -1) return { ok: false, reason: "Ce prêt n'existe plus." };
      const loan = this.loans[idx];
      if (loan.borrowerId !== playerId) return { ok: false, reason: "Ce n'est pas ta dette à rembourser." };
      const borrower = this.players[playerId];
      if (borrower.money < loan.totalOwed) return { ok: false, reason: "Pas assez d'argent pour rembourser maintenant." };

      const lender = this.players[loan.lenderId];
      this.pay(borrower, lender, loan.totalOwed);
      this.loans.splice(idx, 1);
      this.addLog(`💳 ${borrower.name} rembourse par anticipation son prêt à ${lender.name} (${loan.totalOwed}).`);
      return { ok: true };
    }

    // Échéance forcée d'un prêt arrivé à son terme (turnsRemaining à 0).
    _settleLoan(loan) {
      const borrower = this.players[loan.borrowerId];
      const lender = this.players[loan.lenderId];
      this.pay(borrower, lender, loan.totalOwed);
      this.addLog(
        `💳 Échéance du prêt : ${borrower.name} rembourse ${loan.totalOwed} à ${lender.name} (prêt de ${loan.principal} + intérêts).`
      );
    }

    // Fait avancer d'un tour les prêts ET l'assurance du joueur dont le
    // tour vient de se terminer. Appelé depuis nextPlayer().
    _tickPersonalTimers(playerId) {
      const dueLoans = [];
      this.loans.forEach((loan) => {
        if (loan.borrowerId !== playerId) return;
        loan.turnsRemaining -= 1;
        if (loan.turnsRemaining <= 0) dueLoans.push(loan);
      });
      dueLoans.forEach((loan) => this._settleLoan(loan));
      this.loans = this.loans.filter((loan) => loan.turnsRemaining > 0);
      if (dueLoans.length > 0) {
        const borrower = this.players[playerId];
        this.checkBankruptcy(borrower);
        this.checkVictory();
      }

      const player = this.players[playerId];
      if (player.insurance && player.insurance.turnsRemaining > 0) {
        player.insurance.turnsRemaining -= 1;
        if (player.insurance.turnsRemaining <= 0) {
          player.insurance = null;
          this.addLog(`🛡️ L'assurance de ${player.name} a expiré.`);
        }
      }
    }

    // ---- Assurance — Phase 8e (+ 3 formules au choix, Phase 10) ----
    buyInsurance(playerId, planId) {
      if (!this.insuranceEnabled) return { ok: false, reason: "L'assurance n'est pas activée pour cette partie." };
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (player.insurance && player.insurance.turnsRemaining > 0) {
        return { ok: false, reason: "Tu as déjà une assurance active." };
      }
      const plan = INSURANCE_PLANS.find((p) => p.id === Number(planId));
      if (!plan) return { ok: false, reason: "Formule d'assurance invalide." };
      const premium = this.insurancePrices[plan.id];
      if (player.money < premium) return { ok: false, reason: "Pas assez d'argent pour souscrire cette formule." };

      this.pay(player, null, premium);
      player.insurance = { planId: plan.id, planName: plan.name, turnsRemaining: plan.duration, coveragePercent: plan.coveragePercent };
      this.addLog(
        `🛡️ ${player.name} souscrit l'assurance ${plan.name} pour ${premium} (${plan.coveragePercent}% des loyers pris en charge pendant ${plan.duration} tours).`
      );
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
        activeEvent: this.activeEvent ? { ...this.activeEvent } : null,
        loansEnabled: this.loansEnabled,
        insuranceEnabled: this.insuranceEnabled,
        insurancePrices: this.insurancePrices,
        forcedAuctionsPerGame: this.forcedAuctionsPerGame,
        rentMultipliersByHouses: RENT_MULTIPLIERS_BY_HOUSES,
        airportRentTable: [25, 50, 100, 200],
        chanceCardDescriptions: CHANCE_CARDS.map((c) => c.description),
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
        loans: this.loans.map((l) => ({ ...l })),
        loanOffers: this.loanOffers.map((o) => ({ ...o })),
        players: this.players.map((p) => ({
          id: p.id,
          name: p.name,
          position: p.position,
          money: p.money,
          inJail: p.inJail,
          jailTurns: p.jailTurns,
          jailFreeCards: p.jailFreeCards,
          bankrupt: p.bankrupt,
          power: p.power ? { ...p.power } : null,
          insurance: p.insurance ? { ...p.insurance } : null,
          forcedAuctionsUsed: p.forcedAuctionsUsed,
          stats: { ...p.stats },
        })),
        board: this.board.map((t) => ({
          type: t.type,
          name: t.name,
          short: t.short,
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

  return { GameEngine, INSURANCE_PLANS };
});
