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
    const { POWERS, STEAL_AMOUNT, STEAL_MIN_TARGET_MONEY, DOUBLE_RENT_CAP, DISCOUNT_PURCHASE_PERCENT, BANK_LOAN_AMOUNT, RENT_COLLECTOR_DURATION_TURNS, HOUSE_WRECKER_COUNT, randomPowerId, APOCALYPSE_POWERS, findApocalypsePower } = require("./powers.js");
    const { WORLD_EVENTS, EVENT_DURATION_TURNS, FREQUENCY_PROBABILITY, randomEvent } = require("./world-events.js");
    const { INSURANCE_PLANS } = require("./insurance-plans.js");
    const CONTRACTS = require("./contracts.js");
    const FAMILY_LIB = require("./families.js");
    module.exports = factory(
      BOARD, CHANCE_CARDS, HOUSE_COST_BY_GROUP, RENT_MULTIPLIERS_BY_HOUSES,
      POWERS, STEAL_AMOUNT, STEAL_MIN_TARGET_MONEY, DOUBLE_RENT_CAP, DISCOUNT_PURCHASE_PERCENT, BANK_LOAN_AMOUNT, RENT_COLLECTOR_DURATION_TURNS, HOUSE_WRECKER_COUNT, randomPowerId, APOCALYPSE_POWERS, findApocalypsePower,
      WORLD_EVENTS, EVENT_DURATION_TURNS, FREQUENCY_PROBABILITY, randomEvent,
      INSURANCE_PLANS,
      CONTRACTS,
      FAMILY_LIB
    );
  } else {
    const b = root.ReachUpBoard;
    const p = root.ReachUpPowers;
    const w = root.ReachUpWorldEvents;
    const ins = root.ReachUpInsurance;
    root.ReachUpEngine = factory(
      b.BOARD, b.CHANCE_CARDS, b.HOUSE_COST_BY_GROUP, b.RENT_MULTIPLIERS_BY_HOUSES,
      p.POWERS, p.STEAL_AMOUNT, p.STEAL_MIN_TARGET_MONEY, p.DOUBLE_RENT_CAP, p.DISCOUNT_PURCHASE_PERCENT, p.BANK_LOAN_AMOUNT, p.RENT_COLLECTOR_DURATION_TURNS, p.HOUSE_WRECKER_COUNT, p.randomPowerId, p.APOCALYPSE_POWERS, p.findApocalypsePower,
      w.WORLD_EVENTS, w.EVENT_DURATION_TURNS, w.FREQUENCY_PROBABILITY, w.randomEvent,
      ins.INSURANCE_PLANS,
      root.ReachUpContracts,
      root.ReachUpFamilies
    );
  }
})(typeof window !== "undefined" ? window : globalThis, function (
  BOARD_TEMPLATE, CHANCE_CARDS, HOUSE_COST_BY_GROUP, RENT_MULTIPLIERS_BY_HOUSES,
  POWERS, STEAL_AMOUNT, STEAL_MIN_TARGET_MONEY, DOUBLE_RENT_CAP, DISCOUNT_PURCHASE_PERCENT, BANK_LOAN_AMOUNT, RENT_COLLECTOR_DURATION_TURNS, HOUSE_WRECKER_COUNT, randomPowerId, APOCALYPSE_POWERS, findApocalypsePower,
  WORLD_EVENTS, EVENT_DURATION_TURNS, FREQUENCY_PROBABILITY, randomEvent,
  INSURANCE_PLANS,
  CONTRACTS,
  FAMILY_LIB
) {
  const STARTING_MONEY = 2000;
  const SALARY = 200;
  const JAIL_FINE = 50;
  const MAX_JAIL_TURNS = 3;

  // Prêts — bornes des options (calibrées sur le salaire de 200 et les
  // loyers de 2 à 55 : un prêt indexé sur 30 % des loyers se rembourse
  // lentement mais sans risque d'échéance brutale).
  const LOAN_MAX_DURATION = 30;
  const LOAN_SHARE_MIN = 10;
  const LOAN_SHARE_MAX = 80;
  const LOAN_SHARE_DEFAULT = 30;
  const LOAN_MAX_INTEREST_FREE = 5;

  // Société Immobilière — paliers d'investissement (montant CUMULÉ à
  // investir pour atteindre ce multiplicateur). Rendement décroissant :
  // chaque palier suivant coûte proportionnellement plus cher pour +1x de
  // multiplicateur (le "+1" vaut maintenant +3 après triplement, sur
  // demande explicite : les loyers de base étant faibles sans maisons,
  // même x8 restait insuffisant). Calibré sur l'économie réelle (argent
  // de départ 1500, loyers de base 2 à 55) — modulaire et réajustable ici.
  // Aucun plafond réel : chaque palier suivant multiplie le loyer de +3,
  // pour un coût toujours croissant (rendement décroissant), selon la
  // même progression que les 8 premiers paliers d'origine (200, +300,
  // +400, +500...). Générée par formule plutôt qu'une liste figée pour ne
  // jamais imposer de maximum — 200 paliers représentent une somme totale
  // totalement irréaliste à atteindre en jeu, donc "sans plafond" en pratique.
  function generateRealEstateCompanyTiers(count) {
    const tiers = [];
    for (let n = 0; n <= count; n++) {
      tiers.push({ invested: 50 * n * (n + 3), multiplier: 3 * (n + 1) });
    }
    return tiers;
  }
  const REAL_ESTATE_COMPANY_TIERS = generateRealEstateCompanyTiers(200);

  // ---- Mode APOCALYPSE ----
  // Irréversible, cumulatif avec tout le reste (événements, pouvoirs,
  // Société Immobilière...). Chaque groupe reçoit un multiplicateur de
  // loyer chaotique, ré-évalué et intensifié à chaque tour complet — le
  // but n'est jamais de juste doubler les loyers, mais de créer une vraie
  // asymétrie (certains groupes explosent, d'autres s'effondrent), avec
  // des pouvoirs beaucoup plus puissants que la normale.
  // (Les pouvoirs APOCALYPSE_POWERS eux-mêmes sont définis dans
  // powers.js, au même endroit que les pouvoirs normaux, et importés
  // ci-dessus — client et moteur partagent ainsi la même source.)

  // Les cinq effets possibles d'une case mystère.
  const MYSTERY_KINDS = ["casino", "tax_office", "lottery", "bank", "hospital"];

  // Mélange Fisher-Yates — ne modifie pas le tableau d'origine.
  function shuffleArray(array) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

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

      // Cases mystère : chacune reçoit, pour CETTE partie, un des 5 effets
      // possibles (casino, bureau des impôts, loterie, banque, hôpital). On
      // pioche dans un jeu mélangé avant de recommencer, pour que les types
      // soient variés quand il y a plusieurs cases mystère.
      this.lotteryPot = 0;
      {
        let deck = [];
        this.board.forEach((tile) => {
          if (tile.type !== "mystery") return;
          if (deck.length === 0) deck = shuffleArray([...MYSTERY_KINDS]);
          tile.mysteryKind = deck.pop();
          tile.mysteryRevealed = false;
        });
      }

      this.salary = options.salary || SALARY;
      this.vacationPotEnabled = !!options.vacationPot;
      this.vacationPot = 0;
      this.turnLimit = options.turnLimit || null;
      this.diceSides = options.diceSides || 6;
      this.auctionMode = ["classic", "none"].includes(options.auctionMode) ? options.auctionMode : "secret";
      this.tradeTaxPercent = options.tradeTaxPercent || 0;
      this.forcedAuctionsPerGame = options.forcedAuctionsPerGame || 0;
      this.worldEventsEnabled = !!options.worldEventsEnabled;
      this.worldEventFrequency = options.worldEventFrequency || "normal";
      this.activeEvent = null; // { id, turnsRemaining }
      this.turnDirection = 1; // 1 = normal, -1 = inversé (événement "rank_reversal")
      this.loansEnabled = !!options.loansEnabled;
      this.insuranceEnabled = !!options.insuranceEnabled;
      this.insurancePrices = [
        options.insurancePlan1Price !== undefined ? options.insurancePlan1Price : 300,
        options.insurancePlan2Price !== undefined ? options.insurancePlan2Price : 550,
        options.insurancePlan3Price !== undefined ? options.insurancePlan3Price : 900,
      ];
      this.loans = []; // prêts actifs (acceptés) : { id, lenderId, borrowerId, principal, interestRate, totalOwed, turnsRemaining }
      this.loanOffers = []; // propositions de prêt en attente de réponse
      this._nextLoanId = 1;

      const startingMoney = options.startingMoney || STARTING_MONEY;
      this.powersEnabled = !!options.powersEnabled;
      this.powerRerollCost = 250;
      this.buildOnlyWhenSoldOut = !!options.buildOnlyWhenSoldOut;
      this.aiPlayerIds = new Set(options.aiPlayerIds || []);
      this.pendingAuctionVote = null; // { proposerId, votes: {playerId: true/false}, unsoldTiles: [...] }
      this._nextSplitGroupCounter = 0;
      this.soldOutReached = false; // vrai dès que TOUTES les propriétés ont été achetées une fois : la construction reste alors débloquée pour de bon
      this.contracts = []; // contrats actifs entre joueurs (clauses d'échange acceptées) — voir contracts.js
      this._nextContractId = 1;
      this._contractRoundCounter = 0;
      this._companySplits = {}; // playerId -> [{ baseKey, splitKey, coKey }] — pour pouvoir annuler une Société proprement

      // ---- Statistiques générales du plateau (toutes parties confondues) ----
      this.tileLandingCounts = new Array(this.board.length).fill(0);
      this.tileRentGenerated = new Array(this.board.length).fill(0);
      this.biggestAuctionWin = null; // { amount, tileIndex, playerId }
      this.propertyLiquidationQueue = null; // [...tileIndices] en cours de liquidation après un vote accepté

      this.apocalypseAllowed = !!options.apocalypseAllowed;
      this.apocalypseActive = false;
      this.apocalypseIntensity = 1;
      this.apocalypseGroupMultipliers = {}; // { groupName: { multiplier, turnsUntilReroll } }
      this.pendingApocalypseVote = null; // même forme que pendingAuctionVote
      this._apocalypseTurnsSinceRoundStart = 0;
      this.players = playerNames.map((name, id) => ({
        id,
        name,
        position: 0,
        money: startingMoney,
        inJail: false,
        jailTurns: 0,
        jailFreeCards: 0,
        realEstateCompany: null, // { totalInvested, multiplier } — voir formRealEstateCompany
        apocalypsePower: null, // { id, used, armed } — distribué uniquement si l'Apocalypse se déclenche
        hasRerolledPower: false,
        bankrupt: false,
        power: this.powersEnabled ? { id: randomPowerId(playerNames.length < 3 ? ["forced_swap"] : []), used: false, armed: false } : null,
        insurance: null, // { planId, planName, turnsRemaining, coveragePercent }
        forcedAuctionsUsed: 0,
        skipTurns: 0, // tours à passer (hôpital)
        bankDebt: 0, // prêt rapide de la case mystère « Banque », remboursé au prochain passage par Départ
        hospitalBaseline: 0, // pertes (loyers + taxes) déjà prises en compte lors d'un précédent passage à l'hôpital
        inDebt: false, // à découvert, doit vendre/hypothéquer/emprunter avant que la partie ne continue
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
          loansContracted: 0,
          insuranceBought: 0,
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
      this.pendingChanceDraw = null; // { playerId, tileType } — en attente d'un clic pour tirer la carte
      this.lastJailEvent = null; // { playerId, fromIndex } — pour l'animation de transition avant la prison
      this.pendingMoveChoice = null; // { playerId, maxDistance, isDouble } — pouvoir Libre arrêt
      this.rentCollectorEffect = null; // { playerId, turnsRemaining } — pouvoir Collecteur
      this._pendingTurnContinuation = null; // ce qu'il faudra reprendre une fois une dette réglée
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
      const landedExactlyOnGo = passedGo && index === 0;
      player.position = index;
      this.tileLandingCounts[index] = (this.tileLandingCounts[index] || 0) + 1;
      if (passedGo) {
        const doubled = this.activeEvent && this.activeEvent.id === "double_salary";
        let salaryAmount = doubled ? this.salary * 2 : this.salary;
        // Règle permanente (toujours active, pas un réglage à cocher) :
        // atterrir EXACTEMENT sur Départ rapporte 1.5x plus que le simple
        // passage devant.
        if (landedExactlyOnGo) salaryAmount = Math.floor(salaryAmount * 1.5);
        // Contrat de cession de salaire : le salaire part chez le bénéficiaire.
        const cession = this.contracts.find((c) => c.type === "salaryCession" && c.giverId === player.id && c.count > 0);
        const salaryRecipient = cession ? this.players[cession.receiverId] : player;
        this.pay(null, salaryRecipient, salaryAmount);
        if (!cession) player.stats.salaryCollected += salaryAmount;
        const landedNote = landedExactlyOnGo ? " (atterrissage exact : x1.5 !)" : "";
        this.addLog(
          `${player.name} ${landedExactlyOnGo ? "atterrit sur" : "passe par"} la case Départ et touche ${salaryAmount}${doubled ? " (salaire doublé !)" : ""}${landedNote}.`
        );
        if (player.bankDebt > 0 && !cession) {
          const repay = Math.min(player.bankDebt, salaryAmount);
          this.pay(player, null, repay);
          player.bankDebt -= repay;
          this.addLog(`🏦 ${player.name} rembourse ${repay} de son prêt rapide à la banque${player.bankDebt > 0 ? ` (reste ${player.bankDebt})` : ""}.`);
        }
        if (cession) {
          cession.count -= 1;
          this.addLog(`💵 Contrat de cession de salaire : ces ${salaryAmount} vont à ${salaryRecipient.name} (il en reste ${cession.count}).`);
          if (cession.count <= 0) this.contracts = this.contracts.filter((c) => c !== cession);
          this._recheckDebtStatus(salaryRecipient);
        }
      }
    }

    sendToJail(player) {
      // Retient la case sur laquelle le joueur se trouvait juste avant
      // d'être envoyé en prison (case "Aller en prison", carte Destin...)
      // — utilisé uniquement côté client pour faire transiter le pion par
      // cette case avant la prison, histoire qu'on comprenne d'où ça vient.
      this._jailEventSeq = (this._jailEventSeq || 0) + 1;
      this.lastJailEvent = { playerId: player.id, fromIndex: player.position, seq: this._jailEventSeq };

      // La case Prison est toujours au premier quart du plateau (comme sur
      // le plateau fixe), quelle que soit la taille réelle de celui-ci.
      player.position = this.board.length / 4;
      this.tileLandingCounts[player.position] = (this.tileLandingCounts[player.position] || 0) + 1;
      player.inJail = true;
      player.jailTurns = 0;
      player.stats.timesInJail += 1;
      this.addLog(`${player.name} est envoyé en prison.`);
    }

    // Clé de regroupement EFFECTIVE pour les besoins de monopole/construction
    // — normalement identique à tile.group (la couleur), sauf si la case a
    // été séparée dans un sous-groupe plus petit suite à l'extraction de
    // certaines cases par la Société Immobilière d'un autre joueur.
    effectiveGroupKey(tile) {
      return tile.groupKey || tile.group;
    }

    // "Toutes les propriétés achetées" : une fois atteint, cet état est
    // définitif. Sans ça, l'abandon d'un joueur (ses propriétés redeviennent
    // libres) rebloquerait la construction pour tout le monde.
    isBoardSoldOut() {
      if (this.soldOutReached) return true;
      const unsold = this.board.some((t) => ["property", "airport", "utility"].includes(t.type) && t.owner === null);
      if (!unsold) {
        this.soldOutReached = true;
        this.addLog("🏗️ Toutes les propriétés ont trouvé un propriétaire : la construction est débloquée pour de bon.");
      }
      return this.soldOutReached;
    }

    // Les cases mises en Société Immobilière portent une clé spéciale
    // ("<groupe>__co<idJoueur>") : elles ne forment jamais un groupe complet.
    isCompanyGroupKey(key) {
      return typeof key === "string" && key.includes("__co");
    }

    ownsFullSet(playerId, groupKeyOrTile) {
      const key = typeof groupKeyOrTile === "string" ? groupKeyOrTile : this.effectiveGroupKey(groupKeyOrTile);
      if (this.isCompanyGroupKey(key)) return false;
      const tilesOfGroup = this.board.filter((t) => t.type === "property" && this.effectiveGroupKey(t) === key);
      if (tilesOfGroup.length === 0) return false;
      return tilesOfGroup.every((t) => t.owner === playerId);
    }

    // ---- Pouvoirs — Phase 8c ----
    // Applique (et consomme) le pouvoir "loyer doublé" du propriétaire s'il
    // en a un disponible. Renvoie le loyer éventuellement doublé.
    _applyDoubleRentPower(owner, rent) {
      if (owner.power && owner.power.id === "double_rent" && owner.power.armed && !owner.power.used) {
        owner.power.used = true;
        owner.power.armed = false;
        const bonus = Math.min(rent, DOUBLE_RENT_CAP);
        this.addLog(`💰 ${owner.name} déclenche son pouvoir : loyer majoré de ${bonus} (plafonné à ${DOUBLE_RENT_CAP}) !`);
        return rent + bonus;
      }
      return rent;
    }

    // Bouclier de crise (pouvoir apocalyptique) : réduit de 75% le PROCHAIN
    // loyer payé par celui qui l'a activé, quel que soit le chaos ambiant —
    // s'applique après le multiplicateur Apocalypse, jamais avant.
    _applyApocalypseCrisisShield(payer, rent) {
      if (payer.apocalypsePower && payer.apocalypsePower.id === "apoc_crisis_shield" && payer.apocalypsePower.armed && !payer.apocalypsePower.used) {
        payer.apocalypsePower.used = true;
        payer.apocalypsePower.armed = false;
        const reduced = Math.round(rent * 0.25);
        this.addLog(`🛡️ ${payer.name} active son Bouclier de crise : loyer réduit de 75% (${rent} → ${reduced}) !`);
        return reduced;
      }
      return rent;
    }

    // Consomme l'immunité fiscale du joueur si elle est armée (et pas déjà
    // utilisée), et renvoie true si c'était le cas — couvre aussi bien une
    // taxe qu'un loyer à payer, au choix du premier qui se présente.
    _consumeTaxImmunityIfArmed(player) {
      if (player.power && player.power.id === "tax_immunity" && player.power.armed && !player.power.used) {
        player.power.used = true;
        player.power.armed = false;
        return true;
      }
      return false;
    }

    // Paie un loyer en tenant compte d'une éventuelle assurance active chez
    // le payeur (Phase 8e) : il paie moins, le propriétaire touche quand
    // même le plein montant, la différence est prise en charge par la banque.
    // Modifie le MONTANT d'un loyer selon l'événement mondial en cours
    // (récession = -25%, inflation = +25%). Un seul événement actif à la
    // fois, donc jamais de cumul à gérer.
    _applyEventRentModifiers(rent) {
      if (this.activeEvent && this.activeEvent.id === "rent_reduction") {
        return Math.floor(rent * 0.75);
      }
      if (this.activeEvent && this.activeEvent.id === "inflation") {
        return Math.ceil(rent * 1.25);
      }
      return rent;
    }

    // Applique les CONTRATS entre joueurs à un loyer sur le point d'être
    // payé : cession de loyers (le loyer part chez un autre bénéficiaire),
    // exemption de loyers, pacte de non-agression. Renvoie le loyer final
    // et le bénéficiaire effectif.
    _settleRentContracts(payer, owner, rent, tile) {
      let beneficiary = owner;
      const tileIndex = tile ? this.board.indexOf(tile) : -1;
      if (tileIndex >= 0) {
        const cession = this.contracts.find((c) => c.type === "rentCession" && c.tileIndex === tileIndex && c.giverId === owner.id);
        if (cession) {
          beneficiary = this.players[cession.receiverId];
          if (beneficiary.id !== payer.id) {
            this.addLog(`🏘️ Contrat de cession : le loyer de ${tile.name} revient à ${beneficiary.name} et non à ${owner.name}.`);
          }
        }
      }
      if (beneficiary.id === payer.id) {
        this.addLog(`🏘️ ${payer.name} bénéficie des loyers de cette propriété : il ne se doit rien à lui-même.`);
        return { rent: 0, beneficiary };
      }
      const pact = this.contracts.find(
        (c) =>
          c.type === "nonAggression" &&
          ((c.giverId === payer.id && c.receiverId === beneficiary.id) || (c.giverId === beneficiary.id && c.receiverId === payer.id))
      );
      if (pact) {
        this.addLog(`🕊️ Pacte de non-agression entre ${payer.name} et ${beneficiary.name} : aucun loyer à payer.`);
        return { rent: 0, beneficiary };
      }
      const waiver = this.contracts.find(
        (c) => c.type === "rentWaiver" && c.giverId === beneficiary.id && c.receiverId === payer.id && c.count > 0
      );
      if (waiver) {
        waiver.count -= 1;
        this.addLog(
          `🧾 Contrat d'exemption : ${beneficiary.name} renonce à ce loyer de ${rent} dû par ${payer.name} (il en reste ${waiver.count}).`
        );
        if (waiver.count <= 0) this.contracts = this.contracts.filter((c) => c !== waiver);
        return { rent: 0, beneficiary };
      }
      return { rent, beneficiary };
    }

    // Assurance ENTRE JOUEURS : l'assureur rembourse une part du loyer que
    // l'assuré doit payer, dans la limite du plafond restant ET de sa
    // propre trésorerie (il ne peut jamais être mis à découvert par ce
    // contrat — aucune situation bloquée).
    _applyPlayerInsurance(payer, amountDue) {
      const contract = this.contracts.find((c) => c.type === "insuranceCover" && c.receiverId === payer.id && c.capLeft > 0);
      if (!contract || amountDue <= 0) return { amount: 0, insurer: null };
      const insurer = this.players[contract.giverId];
      if (!insurer || insurer.bankrupt) return { amount: 0, insurer: null };
      const wanted = Math.floor((amountDue * contract.percent) / 100);
      const amount = Math.max(0, Math.min(wanted, contract.capLeft, Math.max(0, insurer.money)));
      if (amount <= 0) return { amount: 0, insurer };
      contract.capLeft -= amount;
      if (contract.capLeft <= 0) this.contracts = this.contracts.filter((c) => c !== contract);
      return { amount, insurer };
    }

    _payRentWithInsurance(payer, owner, rent, tile) {
      const settled = this._settleRentContracts(payer, owner, rent, tile);
      rent = settled.rent;
      owner = settled.beneficiary;
      this._lastRentBeneficiary = owner;
      if (rent <= 0) return 0;

      // Pouvoir "Collecteur" actif : le loyer va à son détenteur plutôt
      // qu'au propriétaire réel (sauf s'il s'agit du même joueur).
      let recipient = owner;
      if (this.rentCollectorEffect && this.rentCollectorEffect.turnsRemaining > 0 && this.rentCollectorEffect.playerId !== owner.id) {
        recipient = this.players[this.rentCollectorEffect.playerId];
      }

      // Événement "Fortune imposée" : si LE PROPRIÉTAIRE est le joueur le
      // plus riche visé par l'événement, le loyer part dans la cagnotte de
      // Vacances au lieu de lui — le payeur paie exactement pareil. Ne
      // s'applique que si le Collecteur ne l'a pas déjà redirigé ailleurs.
      const redirectToVacation =
        recipient.id === owner.id &&
        this.activeEvent &&
        this.activeEvent.id === "wealth_tax_vacation" &&
        this.activeEvent.targetPlayerId === owner.id;
      if (redirectToVacation) recipient = null;

      if (recipient !== owner && recipient !== null) {
        this.addLog(`💼 Ce loyer part chez ${recipient.name} (pouvoir Collecteur actif) au lieu de ${owner.name}.`);
      }

      let payerShare = rent;
      if (payer.insurance && payer.insurance.turnsRemaining > 0) {
        const covered = Math.floor((rent * payer.insurance.coveragePercent) / 100);
        payerShare = rent - covered;
        if (covered > 0) {
          this.pay(null, recipient, covered);
          this.addLog(`🛡️ L'assurance de ${payer.name} prend en charge ${covered} sur ce loyer.`);
        }
      }
      const p2p = this._applyPlayerInsurance(payer, payerShare);
      if (p2p.amount > 0) {
        this.pay(p2p.insurer, recipient, p2p.amount);
        payerShare -= p2p.amount;
        this.addLog(`🛡️ ${p2p.insurer.name} rembourse ${p2p.amount} de ce loyer à la place de ${payer.name} (contrat d'assurance entre joueurs).`);
      }
      this.pay(payer, recipient, payerShare);
      if (redirectToVacation) this._creditVacationPot(rent, owner);
      this._applyLoanIncomeRepayment(recipient, rent);
      return rent;
    }

    _creditVacationPot(amount, owner) {
      this.vacationPot += amount;
      this.addLog(`🏦 Le loyer dû à ${owner.name} part dans la cagnotte de Vacances (${this.vacationPot}) !`);
    }

    // Vrai pour toute activation de pouvoir désormais : uniquement
    // possible pendant SON PROPRE tour (jamais "à tout moment").
    _isMyTurn(playerId) {
      return !this.gameOver && this.currentPlayerIndex === playerId;
    }

    // Active un pouvoir de type "arm" (loyer majoré, immunité fiscale,
    // négociateur) : il reste en attente jusqu'à ce que l'événement
    // concerné se présente. Ne fait rien pour un pouvoir "instant" (ceux-là
    // ont leur propre méthode dédiée, l'effet est immédiat).
    armPower(playerId) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this._isMyTurn(playerId)) return { ok: false, reason: "Un pouvoir ne peut être activé qu'à ton propre tour." };
      if (!player.power) return { ok: false, reason: "Tu n'as pas de pouvoir." };
      if (player.power.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };
      if (player.power.armed) return { ok: false, reason: "Ce pouvoir est déjà activé, en attente." };

      const power = POWERS.find((p) => p.id === player.power.id);
      if (!power || power.mode !== "arm") return { ok: false, reason: "Ce pouvoir ne se déclenche pas de cette façon." };

      player.power.armed = true;
      this.addLog(`${power.icon} ${player.name} active son pouvoir "${power.name}" — en attente.`);
      return { ok: true };
    }

    // Pouvoir "Téléportation" (instant) : uniquement à son tour. La case
    // d'arrivée est résolue exactement comme si le joueur y était tombé
    // en jouant normalement (achat proposé, loyer, vacances, carte...).
    useTeleportPower(playerId, tileIndex) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this._isMyTurn(playerId)) return { ok: false, reason: "Ce pouvoir ne peut être utilisé qu'à ton propre tour." };
      if (!player.power || player.power.id !== "teleport") return { ok: false, reason: "Tu n'as pas ce pouvoir." };
      if (player.power.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };
      if (tileIndex < 0 || tileIndex >= this.board.length) return { ok: false, reason: "Case invalide." };
      if (this.pendingDecision || this.pendingAuction) {
        return { ok: false, reason: "Une décision ou une enchère est déjà en cours." };
      }

      player.power.used = true;
      const tile = this.board[tileIndex];
      this.addLog(`🌀 ${player.name} utilise son pouvoir de téléportation et apparaît sur "${tile.name}" !`);
      this._landOnTile(player, tileIndex, { triggeredByRoll: false, skipMoveLog: true });
      return { ok: true };
    }

    // Pouvoir "Prêt bancaire" (instant) : uniquement à son tour.
    useBankLoanPower(playerId) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this._isMyTurn(playerId)) return { ok: false, reason: "Ce pouvoir ne peut être utilisé qu'à ton propre tour." };
      if (!player.power || player.power.id !== "bank_loan") return { ok: false, reason: "Tu n'as pas ce pouvoir." };
      if (player.power.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };

      player.power.used = true;
      this.pay(null, player, BANK_LOAN_AMOUNT);
      this.addLog(`🏦 ${player.name} utilise son pouvoir et reçoit ${BANK_LOAN_AMOUNT} de la banque !`);
      return { ok: true };
    }

    // Pouvoir "Vol" (instant) : uniquement à son tour, et seulement si la
    // cible a plus de STEAL_MIN_TARGET_MONEY (on n'achève pas un joueur
    // presque ruiné).
    useStealPower(playerId, targetId) {
      const player = this.players[playerId];
      const target = this.players[targetId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this._isMyTurn(playerId)) return { ok: false, reason: "Ce pouvoir ne peut être utilisé qu'à ton propre tour." };
      if (!target || target.bankrupt || targetId === playerId) return { ok: false, reason: "Cible invalide." };
      if (!player.power || player.power.id !== "theft") return { ok: false, reason: "Tu n'as pas ce pouvoir." };
      if (player.power.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };
      if (target.money <= STEAL_MIN_TARGET_MONEY) {
        return { ok: false, reason: `Cette cible doit avoir plus de ${STEAL_MIN_TARGET_MONEY} pour pouvoir être volée.` };
      }

      player.power.used = true;
      const amount = Math.min(STEAL_AMOUNT, target.money);
      this.pay(target, player, amount);
      this.addLog(`🗝️ ${player.name} utilise son pouvoir de vol et dérobe ${amount} à ${target.name} !`);
      return { ok: true };
    }

    // Pouvoir "Collecteur" : pendant 2 tours, tout loyer dû par
    // n'importe quel joueur (à n'importe quel propriétaire) est versé au
    // détenteur du pouvoir à la place. Décompté à chaque tour qui passe
    // (this._tickRentCollector, appelé depuis _advanceToNextPlayer),
    // indépendamment du joueur actif — pas seulement les tours du
    // détenteur, pour rester cohérent avec "pendant 2 tours".
    useRentCollectorPower(playerId) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this._isMyTurn(playerId)) return { ok: false, reason: "Ce pouvoir ne peut être utilisé qu'à ton propre tour." };
      if (!player.power || player.power.id !== "rent_collector") return { ok: false, reason: "Tu n'as pas ce pouvoir." };
      if (player.power.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };

      player.power.used = true;
      this.rentCollectorEffect = { playerId, turnsRemaining: RENT_COLLECTOR_DURATION_TURNS };
      this.addLog(`💼 ${player.name} utilise son pouvoir : tous les loyers lui reviennent pendant ${RENT_COLLECTOR_DURATION_TURNS} tours !`);
      return { ok: true };
    }

    // Pouvoir "Vacances à volonté" : récupère toute la cagnotte de
    // Vacances immédiatement, quelle que soit la position du joueur.
    useVacationClaimPower(playerId) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this._isMyTurn(playerId)) return { ok: false, reason: "Ce pouvoir ne peut être utilisé qu'à ton propre tour." };
      if (!player.power || player.power.id !== "vacation_claim") return { ok: false, reason: "Tu n'as pas ce pouvoir." };
      if (player.power.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };

      player.power.used = true;
      const amount = this.vacationPot;
      this.pay(null, player, amount);
      this.vacationPot = 0;
      this.addLog(`🏖️ ${player.name} utilise son pouvoir et récupère toute la cagnotte de Vacances (${amount}) !`);
      return { ok: true };
    }

    // Pouvoir "Renflouement" : la banque comble immédiatement le négatif
    // du joueur — utilisable uniquement s'il est effectivement à découvert.
    useDebtBailoutPower(playerId) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this._isMyTurn(playerId)) return { ok: false, reason: "Ce pouvoir ne peut être utilisé qu'à ton propre tour." };
      if (!player.power || player.power.id !== "debt_bailout") return { ok: false, reason: "Tu n'as pas ce pouvoir." };
      if (player.power.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };
      if (!player.inDebt) return { ok: false, reason: "Ce pouvoir n'est utilisable que si tu es à découvert." };

      player.power.used = true;
      const amount = -player.money;
      this.pay(null, player, amount);
      this.addLog(`🆘 ${player.name} utilise son pouvoir : la banque comble son négatif (+${amount}) !`);
      this._recheckDebtStatus(player);
      return { ok: true };
    }

    // Pouvoir "Démolition" : retire 4 maisons prises au hasard chez
    // l'adversaire choisi, sans remboursement pour lui.
    useHouseWreckerPower(playerId, targetId) {
      const player = this.players[playerId];
      const target = this.players[targetId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this._isMyTurn(playerId)) return { ok: false, reason: "Ce pouvoir ne peut être utilisé qu'à ton propre tour." };
      if (!target || target.bankrupt || targetId === playerId) return { ok: false, reason: "Cible invalide." };
      if (!player.power || player.power.id !== "house_wrecker") return { ok: false, reason: "Tu n'as pas ce pouvoir." };
      if (player.power.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };

      const targetTiles = this.board.filter((t) => t.owner === targetId && t.type === "property" && t.houses > 0);
      if (targetTiles.length === 0) {
        return { ok: false, reason: "Cette cible n'a aucune maison à démolir." };
      }

      player.power.used = true;
      let removed = 0;
      for (let i = 0; i < HOUSE_WRECKER_COUNT; i++) {
        const withHouses = this.board.filter((t) => t.owner === targetId && t.type === "property" && t.houses > 0);
        if (withHouses.length === 0) break;
        const pick = withHouses[Math.floor(Math.random() * withHouses.length)];
        pick.houses -= 1;
        removed += 1;
      }
      this.addLog(`💥 ${player.name} utilise son pouvoir et démolit ${removed} maison(s) chez ${target.name} !`);
      return { ok: true };
    }

    // Pouvoir "Échange forcé" : échange la propriété de deux cases (ni
    // l'une ni l'autre ne doit avoir de maison/hôtel), quels que soient
    // leurs propriétaires respectifs.
    useForcedSwapPower(playerId, tileIndexA, tileIndexB) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this._isMyTurn(playerId)) return { ok: false, reason: "Ce pouvoir ne peut être utilisé qu'à ton propre tour." };
      if (!player.power || player.power.id !== "forced_swap") return { ok: false, reason: "Tu n'as pas ce pouvoir." };
      if (player.power.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };

      const tileA = this.board[tileIndexA];
      const tileB = this.board[tileIndexB];
      const ownableTypes = ["property", "airport", "utility"];
      if (!tileA || !tileB || tileIndexA === tileIndexB) return { ok: false, reason: "Cases invalides." };
      if (!ownableTypes.includes(tileA.type) || !ownableTypes.includes(tileB.type)) {
        return { ok: false, reason: "Les deux cases doivent être des propriétés/gares/compagnies." };
      }
      if (tileA.owner === null || tileB.owner === null) return { ok: false, reason: "Les deux cases doivent être possédées." };
      if (tileA.owner === playerId || tileB.owner === playerId) {
        return { ok: false, reason: "Ce pouvoir échange les propriétés de DEUX AUTRES joueurs — jamais les tiennes." };
      }
      if (tileA.owner === tileB.owner) {
        return { ok: false, reason: "Les deux cases doivent appartenir à deux joueurs différents." };
      }
      if ((tileA.houses || 0) > 0 || (tileB.houses || 0) > 0) {
        return { ok: false, reason: "Impossible : au moins une des deux cases a des maisons ou un hôtel." };
      }

      player.power.used = true;
      const ownerAName = this.players[tileA.owner].name;
      const ownerBName = this.players[tileB.owner].name;
      const temp = tileA.owner;
      tileA.owner = tileB.owner;
      tileB.owner = temp;
      this._onOwnershipChanged();
      this.addLog(`🔁 ${player.name} utilise son pouvoir et échange ${tileA.name} (${ownerAName}) contre ${tileB.name} (${ownerBName}) !`);
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
      if (this.isCompanyGroupKey(this.effectiveGroupKey(tile))) {
        return { ok: false, reason: "Les propriétés mises en Société Immobilière ne peuvent pas recevoir de maisons." };
      }
      if (!this.ownsFullSet(playerId, tile)) return { ok: false, reason: "Il faut posséder tout le groupe pour construire." };
      if (this.buildOnlyWhenSoldOut && !this.isBoardSoldOut()) {
        return { ok: false, reason: "La construction est bloquée tant que toutes les propriétés du plateau n'ont pas été achetées." };
      }
      if (this._isCollateral(tileIndex)) {
        return { ok: false, reason: "Cette propriété est donnée en garantie d'un prêt : on ne peut pas y construire." };
      }
      const sameGroup = this.board.filter(
        (t) => t.type === "property" && this.effectiveGroupKey(t) === this.effectiveGroupKey(tile)
      );
      if (sameGroup.some((t) => t.mortgaged)) {
        return { ok: false, reason: "Une propriété du groupe est hypothéquée : lève d'abord l'hypothèque pour construire." };
      }
      if (tile.houses >= 5) return { ok: false, reason: "Cette propriété a déjà un hôtel." };

      const groupTiles = this.board.filter((t) => t.type === "property" && this.effectiveGroupKey(t) === this.effectiveGroupKey(tile));
      const minHouses = Math.min(...groupTiles.map((t) => t.houses));
      if (tile.houses !== minHouses) {
        return { ok: false, reason: "Construis d'abord sur les propriétés moins bien loties du groupe (règle Even Build)." };
      }

      const cost = this._houseCostOf(tile);
      const player = this.players[playerId];
      if (player.money < cost) return { ok: false, reason: "Pas assez d'argent." };

      return { ok: true, cost };
    }

    _houseCostOf(tile) {
      return tile.houseCost || HOUSE_COST_BY_GROUP[tile.group];
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
      this._payUniversityBonuses();
      return { ok: true };
    }

    // Les universités rapportent un bonus de la banque à leur propriétaire
    // chaque fois que quelqu'un construit une maison ou un hôtel.
    _payUniversityBonuses() {
      const bonus = (FAMILY_LIB.FAMILIES.university || {}).builderBonus || 0;
      if (!bonus) return;
      this.board.forEach((t) => {
        if (t.family !== "university" || t.owner === null || t.owner === undefined || t.mortgaged) return;
        const owner = this.players[t.owner];
        if (!owner || owner.bankrupt) return;
        this.pay(null, owner, bonus);
        this.addLog(`🎓 ${t.name} rapporte ${bonus} à ${owner.name} (une construction vient d'avoir lieu).`);
      });
    }

    // Vente d'une maison : symétrique de la construction (on vend d'abord
    // sur la propriété qui a le PLUS de maisons du groupe), remboursée à
    // la moitié du prix de construction.
    canSellHouse(playerId, tileIndex) {
      const tile = this.board[tileIndex];
      if (!tile || tile.type !== "property") return { ok: false, reason: "Cette case n'a pas de maisons." };
      if (tile.owner !== playerId) return { ok: false, reason: "Tu ne possèdes pas cette propriété." };
      if (tile.houses <= 0) return { ok: false, reason: "Aucune maison à vendre ici." };

      // Règle de vente équilibrée au sein du (sous-)groupe EFFECTIF, et
      // parmi les cases du vendeur seulement : si un groupe a changé de
      // mains après des échanges (cases avec maisons passées à quelqu'un
      // d'autre), on ne doit jamais exiger de vendre sur la case d'un autre
      // joueur — sinon une dette pourrait devenir impossible à régler.
      const groupTiles = this.board.filter(
        (t) => t.type === "property" && this.effectiveGroupKey(t) === this.effectiveGroupKey(tile) && t.owner === playerId
      );
      const maxHouses = Math.max(...groupTiles.map((t) => t.houses));
      if (tile.houses !== maxHouses) {
        return { ok: false, reason: "Vends d'abord les maisons des propriétés les mieux loties du groupe." };
      }

      const refund = Math.floor(this._houseCostOf(tile) / 2);
      return { ok: true, refund };
    }

    sellHouse(playerId, tileIndex) {
      const check = this.canSellHouse(playerId, tileIndex);
      if (!check.ok) return check;

      const tile = this.board[tileIndex];
      const player = this.players[playerId];
      tile.houses -= 1;
      const isFree = this.activeEvent && this.activeEvent.id === "free_sales";
      const refund = isFree ? this._houseCostOf(tile) : check.refund;
      this.pay(null, player, refund);
      this.addLog(`${player.name} vend une maison sur ${tile.name} pour ${refund}${isFree ? " (Ventes gratuites !)" : ""}.`);
      this._recheckDebtStatus(player);
      return { ok: true };
    }

    // ---- Hypothèque — Phase 6 ----
    canMortgage(playerId, tileIndex) {
      const tile = this.board[tileIndex];
      const player = this.players[playerId];
      if (!tile) return { ok: false, reason: "Case invalide." };
      if (!["property", "airport", "utility"].includes(tile.type)) return { ok: false, reason: "Cette case ne peut pas être hypothéquée." };
      if (tile.owner !== playerId) return { ok: false, reason: "Tu ne possèdes pas cette propriété." };
      if (tile.mortgaged) return { ok: false, reason: "Déjà hypothéquée." };
      if (tile.type === "property" && tile.houses > 0) return { ok: false, reason: "Vends d'abord les maisons avant d'hypothéquer." };
      if (
        tile.type === "property" &&
        this.board.some(
          (t) =>
            t.type === "property" && t !== tile && t.owner === playerId && t.houses > 0 && this.effectiveGroupKey(t) === this.effectiveGroupKey(tile)
        )
      ) {
        return { ok: false, reason: "Vends d'abord les maisons des autres propriétés de ce groupe avant d'hypothéquer." };
      }
      if (!player || player.money >= 0) {
        return { ok: false, reason: "Tu ne peux hypothéquer que lorsque tu es à découvert (argent négatif) — pas comme simple levier pour construire davantage." };
      }

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
      this._recheckDebtStatus(player);
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
      if (this.activeEvent && this.activeEvent.id === "disabled_zones" && this.activeEvent.disabledTiles) {
        const tileIndex = this.board.indexOf(tile);
        if (this.activeEvent.disabledTiles.includes(tileIndex)) {
          this.addLog(`🚫 ${tile.name} est désactivée le temps de l'événement : rien ne se passe.`);
          return;
        }
      }
      switch (tile.type) {
        case "property": {
          if (tile.owner !== player.id) {
            if (tile.mortgaged) {
              this.addLog(`${player.name} ne paie rien : ${tile.name} est hypothéquée.`);
              break;
            }
            if (this._consumeTaxImmunityIfArmed(player)) {
              this.addLog(`🛡️ ${player.name} déclenche son immunité fiscale : aucun loyer payé sur ${tile.name} !`);
              break;
            }
            let rent;
            const rec = this.players[tile.owner].realEstateCompany;
            if (tile.houses > 0) {
              rent = tile.rent * RENT_MULTIPLIERS_BY_HOUSES[tile.houses];
            } else if (rec) {
              rent = tile.rent * rec.multiplier;
            } else {
              rent = this.ownsFullSet(tile.owner, tile) ? tile.rent * 2 : tile.rent;
            }
            const owner = this.players[tile.owner];
            let apocalypseNote = "";
            if (this.apocalypseActive && this.apocalypseGroupMultipliers[tile.group]) {
              const mult = this.apocalypseGroupMultipliers[tile.group].multiplier;
              rent = Math.round(rent * mult);
              apocalypseNote = ` — ☠️ chaos x${mult}`;
            }
            rent = this._applyEventRentModifiers(rent);
            rent = this._applyDoubleRentPower(owner, rent);
            rent = this._applyApocalypseCrisisShield(player, rent);
            rent = this._payRentWithInsurance(player, owner, rent, tile);
            player.stats.rentPaid += rent;
            (this._lastRentBeneficiary || owner).stats.rentReceived += rent;
            player.stats.biggestRentPaid = Math.max(player.stats.biggestRentPaid, rent);
            this.tileRentGenerated[this.board.indexOf(tile)] = (this.tileRentGenerated[this.board.indexOf(tile)] || 0) + rent;
            const buildingNote =
              tile.houses === 5
                ? " (hôtel)"
                : tile.houses > 0
                ? ` (${tile.houses} maison(s))`
                : rec
                ? ` (🏢 Société Immobilière x${rec.multiplier})`
                : "";
            if (rent > 0) this.addLog(`${player.name} paie ${rent} de loyer à ${(this._lastRentBeneficiary || owner).name} (${tile.name}${buildingNote}${apocalypseNote}).`);
          }
          break;
        }
        case "airport": {
          if (tile.owner !== player.id) {
            if (tile.mortgaged) {
              this.addLog(`${player.name} ne paie rien : ${tile.name} est hypothéquée.`);
              break;
            }
            if (this._consumeTaxImmunityIfArmed(player)) {
              this.addLog(`🛡️ ${player.name} déclenche son immunité fiscale : aucun loyer payé sur ${tile.name} !`);
              break;
            }
            const owner = this.players[tile.owner];
            let rent = FAMILY_LIB.familyRent(this.board, tile, { visitorId: player.id, eventActive: !!this.activeEvent });
            rent = this._applyEventRentModifiers(rent);
            rent = this._applyDoubleRentPower(owner, rent);
            rent = this._payRentWithInsurance(player, owner, rent, tile);
            player.stats.rentPaid += rent;
            (this._lastRentBeneficiary || owner).stats.rentReceived += rent;
            player.stats.biggestRentPaid = Math.max(player.stats.biggestRentPaid, rent);
            this.tileRentGenerated[this.board.indexOf(tile)] = (this.tileRentGenerated[this.board.indexOf(tile)] || 0) + rent;
            if (rent > 0) this.addLog(`${player.name} paie ${rent} de loyer à ${(this._lastRentBeneficiary || owner).name} (${tile.name}).`);
          }
          break;
        }
        case "utility": {
          if (tile.owner !== player.id) {
            if (tile.mortgaged) {
              this.addLog(`${player.name} ne paie rien : ${tile.name} est hypothéquée.`);
              break;
            }
            if (this._consumeTaxImmunityIfArmed(player)) {
              this.addLog(`🛡️ ${player.name} déclenche son immunité fiscale : aucun loyer payé sur ${tile.name} !`);
              break;
            }
            const owner = this.players[tile.owner];
            const isExtraFamily = !!tile.family && tile.family !== "utility";
            const count = this.board.filter((t) => t.type === "utility" && (t.family || "utility") === (tile.family || "utility") && t.owner === tile.owner && !t.mortgaged).length;
            const multiplier = count === 1 ? 4 : count === 2 ? 10 : 20;
            let rent = isExtraFamily
              ? FAMILY_LIB.familyRent(this.board, tile, { visitorId: player.id, eventActive: !!this.activeEvent })
              : diceSum * multiplier;
            rent = this._applyEventRentModifiers(rent);
            rent = this._applyDoubleRentPower(owner, rent);
            rent = this._payRentWithInsurance(player, owner, rent, tile);
            player.stats.rentPaid += rent;
            (this._lastRentBeneficiary || owner).stats.rentReceived += rent;
            player.stats.biggestRentPaid = Math.max(player.stats.biggestRentPaid, rent);
            this.tileRentGenerated[this.board.indexOf(tile)] = (this.tileRentGenerated[this.board.indexOf(tile)] || 0) + rent;
            if (rent > 0) this.addLog(`${player.name} paie ${rent} de loyer à ${(this._lastRentBeneficiary || owner).name} (${tile.name}${isExtraFamily ? "" : `, x${multiplier} le lancer de dés`}).`);
          }
          break;
        }
        case "tax": {
          if (this._consumeTaxImmunityIfArmed(player)) {
            this.addLog(`🛡️ ${player.name} déclenche son immunité fiscale : ${tile.name} ne lui coûte rien !`);
            break;
          }
          // Montant tiré au sort parmi 4 valeurs fixes à chaque passage —
          // plus de montant figé par case, pour un peu d'incertitude.
          const TAX_AMOUNTS = [50, 75, 100, 150];
          const baseAmount = TAX_AMOUNTS[Math.floor(Math.random() * TAX_AMOUNTS.length)];
          const amount = this.activeEvent && this.activeEvent.id === "inflation" ? Math.ceil(baseAmount * 1.25) : baseAmount;
          this.pay(player, null, amount);
          player.stats.taxesPaid += amount;
          if (this.vacationPotEnabled) {
            this.vacationPot += amount;
            this.addLog(`${player.name} paie ${amount} de taxe (${tile.name}) — cagnotte de Vacances : ${this.vacationPot}.`);
          } else {
            this.addLog(`${player.name} paie ${amount} de taxe (${tile.name}).`);
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
          // Ne tire plus automatiquement : le joueur doit cliquer pour
          // tirer sa carte (suspense, et ça laisse le temps de suivre ce
          // qui se passe à l'écran plutôt que de tout enchaîner d'un coup).
          this.pendingChanceDraw = { playerId: player.id, tileType: tile.type };
          break;
        }
        case "go-to-jail": {
          this.sendToJail(player);
          break;
        }
        case "mystery": {
          this._resolveMystery(player, tile);
          break;
        }
        // "go", "jail" (simple visite) : pas d'effet particulier ici
        default:
          break;
      }
    }

    // Avant de déclarer la faillite, on regarde si le joueur a encore une
    // carte à jouer : hypothéquer une propriété non hypothéquée (et sans
    // maison dessus), ou vendre une maison. Un prêt d'un autre joueur
    // reste toujours possible aussi, mais ça ne dépend pas de lui seul —
    // on ne peut pas en garantir l'existence, donc on ne le compte pas
    // comme une "option" ici (s'il en obtient un, sa dette baissera et sera
    // réévaluée normalement).
    _hasDebtResolutionOptions(player) {
      const canMortgage = this.board.some(
        (t) => t.owner === player.id && !t.mortgaged && ["property", "airport", "utility"].includes(t.type) && (t.type !== "property" || t.houses === 0)
      );
      if (canMortgage) return true;
      return this.board.some((t) => t.owner === player.id && t.type === "property" && t.houses > 0);
    }

    checkBankruptcy(player) {
      if (player.money >= 0 || player.bankrupt || player.inDebt) return;

      if (this._hasDebtResolutionOptions(player)) {
        player.inDebt = true;
        this.addLog(
          `⚠️ ${player.name} est à découvert (${player.money}) : il doit vendre une maison, hypothéquer une propriété, ou obtenir un prêt avant que la partie continue.`
        );
      } else {
        this._finalizeBankruptcy(player);
      }
    }

    // Tout ce qui attendait un joueur qui vient de quitter la partie (faillite
    // ou abandon) doit être débloqué : sinon la partie pourrait rester figée
    // sur une décision, une enchère ou un vote qui ne viendra jamais.
    _cleanupAfterPlayerLeft(player) {
      const id = player.id;
      this.tradeOffers = this.tradeOffers.filter((t) => t.fromId !== id && t.toId !== id);
      if (this.pendingDecision && this.pendingDecision.playerId === id) this.pendingDecision = null;
      if (this.pendingChanceDraw && this.pendingChanceDraw.playerId === id) this.pendingChanceDraw = null;
      if (this.pendingMoveChoice && this.pendingMoveChoice.playerId === id) this.pendingMoveChoice = null;
      if (player.power) player.power.armed = false;

      const a = this.pendingAuction;
      if (a) {
        if (a.mode === "classic") {
          a.activeBidders = a.activeBidders.filter((x) => x !== id);
          if (a.currentBidderId === id) {
            a.currentBidderId = null;
            a.currentBid = 0;
          }
          if (a.activeBidders.filter((x) => x !== a.currentBidderId).length === 0) {
            this._concludeAuction(a.currentBid > 0 ? a.currentBidderId : null, a.currentBid);
          }
        } else {
          delete a.bids[id];
          a.pendingPlayers = a.pendingPlayers.filter((x) => x !== id);
          if (a.pendingPlayers.length === 0) this._resolveSecretAuction();
        }
      }
      if (this.pendingAuctionVote) this._checkGlobalAuctionVoteOutcome();
      if (this.pendingApocalypseVote) this._checkApocalypseVoteOutcome();
    }

    _finalizeBankruptcy(player) {
      player.bankrupt = true;
      player.inDebt = false;
      // Ses propriétés redeviennent libres (pas d'enchère pour l'instant)
      this.board.forEach((tile) => {
        if (tile.owner === player.id) {
          tile.owner = null;
          if (tile.type === "property") tile.houses = 0;
          if ("mortgaged" in tile) tile.mortgaged = false;
        }
      });
      this.addLog(`💥 ${player.name} n'a plus aucune option et est en faillite : il quitte la partie.`);
      this._onOwnershipChanged();
      this._cleanupAfterPlayerLeft(player);
    }

    // Appelé après toute action qui pourrait avoir renfloué un joueur à
    // découvert (hypothèque, vente de maison, prêt accepté...). Si sa
    // situation est rétablie OU s'il n'a vraiment plus aucune option, on
    // reprend là où le tour avait été mis en pause.
    _recheckDebtStatus(player) {
      if (!player.inDebt) return;

      if (player.money >= 0) {
        player.inDebt = false;
        this.addLog(`✅ ${player.name} a rétabli sa situation financière et la partie continue.`);
      } else if (!this._hasDebtResolutionOptions(player)) {
        this._finalizeBankruptcy(player);
      } else {
        return; // toujours à découvert, mais il lui reste des options : on attend encore
      }

      const resume = this._pendingTurnContinuation;
      this._pendingTurnContinuation = null;
      if (resume) resume();
    }

    checkVictory() {
      const active = this.activePlayers();
      if (active.length === 1) {
        this.gameOver = true;
        this.winner = active[0];
        this.addLog(`🏆 ${this.winner.name} remporte la partie !`);
      }
    }

    // Abandon volontaire d'un joueur (menu ☰). Ne crée aucune nouvelle
    // règle : réutilise exactement le mécanisme de faillite déjà en place
    // (le joueur quitte, ses propriétés redeviennent libres, la victoire
    // est réévaluée normalement).
    forfeitGame(playerId) {
      const player = this.players[playerId];
      if (!player || player.bankrupt || this.gameOver) return { ok: false, reason: "Action impossible." };

      player.bankrupt = true;
      player.inDebt = false;
      this.board.forEach((tile) => {
        if (tile.owner === player.id) {
          tile.owner = null;
          if (tile.type === "property") tile.houses = 0;
          if ("mortgaged" in tile) tile.mortgaged = false;
        }
      });
      this.addLog(`🚪 ${player.name} abandonne la partie.`);
      this._onOwnershipChanged();
      const wasCurrent = this.currentPlayerIndex === playerId;
      const turnBefore = this.turnNumber;
      this._cleanupAfterPlayerLeft(player);
      this.checkVictory();
      // Si le nettoyage a déjà fait avancer le tour (fin d'une enchère lancée
      // par ce joueur), on ne l'avance pas une seconde fois.
      if (wasCurrent && this.turnNumber !== turnBefore) return { ok: true };

      // Si la partie était en pause en attendant que CE joueur règle une
      // dette, l'abandon règle la question : on reprend là où on en était.
      if (!this.gameOver && this._pendingTurnContinuation && this.currentPlayerIndex === playerId) {
        const resume = this._pendingTurnContinuation;
        this._pendingTurnContinuation = null;
        resume();
        return { ok: true };
      }

      if (!this.gameOver && this.currentPlayerIndex === playerId) {
        this.nextPlayer();
      }
      return { ok: true };
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
          value += tile.houses * this._houseCostOf(tile);
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
      const endingPlayer = this.players[this.currentPlayerIndex];
      this._tickPersonalTimers(this.currentPlayerIndex);
      if (endingPlayer.inDebt) {
        // Une échéance de prêt vient de mettre ce joueur à découvert : on
        // met le passage au joueur suivant en pause jusqu'à ce qu'il ait
        // réglé sa situation (ou soit déclaré en faillite).
        this._pendingTurnContinuation = () => this._advanceToNextPlayer();
        return;
      }
      this._advanceToNextPlayer();
    }

    // ---- Cases mystère ----
    // Chaque case mystère cache un effet INSTANTANÉ, tiré au sort au début
    // de la partie et révélé la première fois que quelqu'un tombe dessus.
    // Les montants se calculent à partir du salaire de la partie, pour
    // rester équilibrés quelle que soit la richesse de départ.
    _mysteryUnit() {
      return Math.max(20, Math.round(this.salary / 5) * 5);
    }

    _randomDie() {
      return Math.floor(Math.random() * this.diceSides) + 1;
    }

    _resolveMystery(player, tile) {
      const kind = tile.mysteryKind || "casino";
      if (!tile.mysteryRevealed) {
        tile.mysteryRevealed = true;
        const names = { casino: "un Casino 🎰", tax_office: "un Bureau des impôts 🧾", lottery: "une Loterie 🎟️", bank: "une Banque 🏦", hospital: "un Hôpital 🏥" };
        this.addLog(`🎁 La case mystère se révèle : c'est ${names[kind]} !`);
      }
      const salary = this.salary;
      if (kind === "casino") {
        const stake = Math.min(Math.max(0, player.money), Math.round((salary * 0.5) / 5) * 5);
        if (stake <= 0) {
          this.addLog(`🎰 ${player.name} n'a plus de quoi miser au casino.`);
          return;
        }
        const roll = this._randomDie();
        const third = this.diceSides / 3;
        if (roll <= third) {
          this.pay(player, null, stake);
          this.addLog(`🎰 Casino : ${player.name} mise ${stake}, tire un ${roll} et perd sa mise.`);
        } else if (roll > this.diceSides - third) {
          this.pay(null, player, stake);
          this.addLog(`🎰 Casino : ${player.name} mise ${stake}, tire un ${roll} et DOUBLE sa mise (+${stake}) !`);
        } else {
          this.addLog(`🎰 Casino : ${player.name} mise ${stake}, tire un ${roll} et récupère simplement sa mise.`);
        }
      } else if (kind === "tax_office") {
        if (this._consumeTaxImmunityIfArmed(player)) {
          this.addLog(`🛡️ ${player.name} déclenche son immunité fiscale : le bureau des impôts ne lui prend rien !`);
          return;
        }
        let fortune = Math.max(0, player.money);
        let propCount = 0;
        this.board.forEach((t) => {
          if (t.owner !== player.id || !["property", "airport", "utility"].includes(t.type)) return;
          propCount += 1;
          if (!t.mortgaged) fortune += t.price || 0;
          if (t.type === "property") fortune += (t.houses || 0) * (this._houseCostOf(t) || 0);
        });
        // 4 % de la fortune, ramenés à 2 % pour qui possède 2 propriétés ou moins ; plafonné à 2,5 salaires.
        const pct = propCount <= 2 ? 0.02 : 0.04;
        let amount = Math.min(Math.round(salary * 2.5), Math.max(10, Math.round((fortune * pct) / 5) * 5));
        if (this.activeEvent && this.activeEvent.id === "inflation") amount = Math.ceil(amount * 1.25);
        this.pay(player, null, amount);
        player.stats.taxesPaid += amount;
        if (this.vacationPotEnabled) this.vacationPot += amount;
        this.addLog(`🧾 Bureau des impôts : ${player.name} paie ${amount} (${Math.round(pct * 100)} % de sa fortune de ${fortune}${propCount <= 2 ? ", taux réduit : peu de propriétés" : ""}).`);
      } else if (kind === "lottery") {
        const ticket = Math.max(10, Math.round((salary * 0.1) / 5) * 5);
        const paid = Math.min(ticket, Math.max(0, player.money));
        if (paid > 0) {
          this.pay(player, null, paid);
          this.lotteryPot += paid;
        }
        const roll = this._randomDie();
        if (paid > 0 && roll > this.diceSides - this.diceSides / 3) {
          const pot = this.lotteryPot;
          this.lotteryPot = 0;
          this.pay(null, player, pot);
          this.addLog(`🎟️ Loterie : ${player.name} achète un billet (${paid}), tire un ${roll} et REMPORTE la cagnotte de ${pot} !`);
        } else {
          this.addLog(`🎟️ Loterie : ${player.name} achète un billet (${paid}) et tire un ${roll}. Perdu. La cagnotte monte à ${this.lotteryPot}.`);
        }
      } else if (kind === "bank") {
        if (player.bankDebt > 0) {
          this.addLog(`🏦 Banque : ${player.name} doit encore ${player.bankDebt} sur son prêt rapide, pas de nouveau prêt.`);
          return;
        }
        const loan = Math.round((salary * 0.5) / 5) * 5;
        const debt = Math.round((loan * 1.1) / 5) * 5;
        this.pay(null, player, loan);
        player.bankDebt = debt;
        this.addLog(`🏦 Banque : ${player.name} reçoit un prêt rapide de ${loan}, à rembourser ${debt} au prochain passage par Départ.`);
      } else if (kind === "hospital") {
        const losses = player.stats.rentPaid + player.stats.taxesPaid;
        const newLosses = Math.max(0, losses - (player.hospitalBaseline || 0));
        player.hospitalBaseline = losses;
        const refund = Math.min(Math.round(salary * 1.5), Math.max(Math.round(salary / 10), Math.round((newLosses * 0.3) / 5) * 5));
        this.pay(null, player, refund);
        player.skipTurns = (player.skipTurns || 0) + 1;
        this.addLog(`🏥 Hôpital : ${player.name} est soigné et récupère ${refund} (30 % de ses pertes récentes), mais passera son prochain tour.`);
      }
    }

    _advanceToNextPlayer() {
      for (;;) {
        this.currentPlayerIndex =
          (this.currentPlayerIndex + this.turnDirection + this.players.length) % this.players.length;
        const candidate = this.players[this.currentPlayerIndex];
        if (candidate.bankrupt) continue;
        if (candidate.skipTurns > 0) {
          candidate.skipTurns -= 1;
          this.addLog(`🏥 ${candidate.name} passe son tour (hôpital).`);
          this._tickPersonalTimers(this.currentPlayerIndex);
          continue;
        }
        break;
      }
      this.doublesStreak = 0;
      this.turnNumber += 1;
      this._turnBannerLogged = false;

      if (this.rentCollectorEffect) {
        this.rentCollectorEffect.turnsRemaining -= 1;
        if (this.rentCollectorEffect.turnsRemaining <= 0) {
          this.addLog(`💼 Le pouvoir Collecteur de ${this.players[this.rentCollectorEffect.playerId].name} est terminé.`);
          this.rentCollectorEffect = null;
        }
      }

      this._tickWorldEvent();
      this._tickApocalypse();
      this._tickContracts();
      this._onOwnershipChanged();
    }

    // ---- Événements mondiaux temporaires — Phase 8d ----
    _startRandomWorldEvent() {
      const event = randomEvent();
      const duration = event.duration || EVENT_DURATION_TURNS;
      this.activeEvent = { id: event.id, turnsRemaining: duration };
      this._setupWorldEvent(event);
      this.addLog(`${event.icon} Événement mondial : "${event.name}" ! ${event.description} (${duration} tours)`);
    }

    // Mise en place ponctuelle d'un événement qui a besoin d'un effet
    // immédiat et/ou d'un état particulier à retenir pendant sa durée.
    _setupWorldEvent(event) {
      if (event.id === "rank_reversal") {
        this.turnDirection = -1;
      } else if (event.id === "property_shuffle") {
        const activeIds = this.activePlayers().map((p) => p.id);
        if (activeIds.length >= 2) {
          const shuffled = shuffleArray([...activeIds]);
          const mapping = {};
          shuffled.forEach((id, i) => {
            mapping[id] = shuffled[(i + 1) % shuffled.length];
          });
          const originalOwnership = {};
          this.board.forEach((tile, index) => {
            if (tile.owner !== null && mapping[tile.owner] !== undefined) {
              originalOwnership[index] = { from: tile.owner, to: mapping[tile.owner] }; // pour tout remettre en place une fois l'événement terminé
              tile.owner = mapping[tile.owner];
            }
          });
          this.activeEvent.originalOwnership = originalOwnership;
          this.addLog(`🔀 Toutes les propriétés changent de mains !`);
        }
      } else if (event.id === "wealth_tax_vacation") {
        const richest = this._richestPlayer();
        if (richest) {
          this.activeEvent.targetPlayerId = richest.id;
          this.addLog(`🏦 Les loyers dus à ${richest.name} (le plus riche) partiront dans la cagnotte de Vacances.`);
        }
      } else if (event.id === "wealth_redistribution") {
        const richest = this._richestPlayer();
        const poorest = this._poorestPlayer();
        if (richest && poorest && richest.id !== poorest.id) {
          const amount = Math.floor(richest.money * 0.1);
          if (amount > 0) {
            this.pay(richest, poorest, amount);
            this.addLog(`🤲 ${richest.name} verse ${amount} (10% de sa fortune) à ${poorest.name}.`);
          }
        }
      } else if (event.id === "disabled_zones") {
        const eligible = this.board
          .map((t, i) => i)
          .filter((i) => !["go", "jail", "vacation", "go-to-jail"].includes(this.board[i].type));
        const picked = shuffleArray(eligible).slice(0, 5);
        this.activeEvent.disabledTiles = picked;
        const names = picked.map((i) => this.board[i].name).join(", ");
        this.addLog(`🚫 Cases désactivées le temps de l'événement : ${names}.`);
      }
    }

    // Joueur actif avec la plus grande / plus petite valeur totale
    // (argent + propriétés + constructions) — utilisé par plusieurs
    // événements mondiaux.
    _richestPlayer() {
      const active = this.activePlayers();
      if (active.length === 0) return null;
      return active.reduce((best, p) => (this._computeNetWorth(p) > this._computeNetWorth(best) ? p : best), active[0]);
    }

    _poorestPlayer() {
      const active = this.activePlayers();
      if (active.length === 0) return null;
      return active.reduce((worst, p) => (this._computeNetWorth(p) < this._computeNetWorth(worst) ? p : worst), active[0]);
    }

    _tickWorldEvent() {
      if (!this.activeEvent) return;
      // La durée se compte en TOURS COMPLETS (chaque joueur encore actif
      // a joué au moins une fois), pas en simples passages de joueur —
      // sinon la durée réelle dépendrait du nombre de joueurs (un événement
      // "6 tours" durerait 1,5 round à 4 joueurs contre 6 rounds en tête-à-tête).
      const activeCount = this.players.filter((p) => !p.bankrupt).length;
      this.activeEvent.turnsSinceRoundStart = (this.activeEvent.turnsSinceRoundStart || 0) + 1;
      if (this.activeEvent.turnsSinceRoundStart < Math.max(1, activeCount)) return;
      this.activeEvent.turnsSinceRoundStart = 0;

      this.activeEvent.turnsRemaining -= 1;
      if (this.activeEvent.turnsRemaining <= 0) {
        const ended = WORLD_EVENTS.find((e) => e.id === this.activeEvent.id);
        if (this.activeEvent.id === "rank_reversal") this.turnDirection = 1;
        if (this.activeEvent.id === "property_shuffle" && this.activeEvent.originalOwnership) {
          Object.entries(this.activeEvent.originalOwnership).forEach(([index, rec]) => {
            const t = this.board[Number(index)];
            const from = typeof rec === "object" ? rec.from : rec;
            // Si la case a changé de mains pendant l'événement (échange, rachat, faillite), on n'y touche pas.
            if (typeof rec === "object" && t.owner !== rec.to) return;
            const origOwner = this.players[from];
            if (!origOwner || origOwner.bankrupt) {
              t.owner = null; t.houses = 0; t.mortgaged = false; // propriétaire d'origine parti : la case redevient libre
            } else t.owner = from;
          });
          this.addLog(`🔀 Les propriétés reviennent à leurs propriétaires d'origine.`);
        }
        this.addLog(`${ended.icon} L'événement "${ended.name}" est terminé.`);
        this.activeEvent = null;
        this._onOwnershipChanged();
      }
    }

    // Tentative de sortie de prison par les dés uniquement (double, ou
    // constat qu'il faudra payer après 3 tentatives ratées). La carte
    // "sortie de prison gratuite" n'est PLUS utilisée automatiquement ici
    // — le joueur doit l'utiliser explicitement via useJailFreeCard(), un
    // vrai choix plutôt qu'un réflexe imposé.
    _attemptJailExit(player) {
      const [d1, d2] = this.rollDice();
      this.lastRoll = { playerId: player.id, d1, d2, isDouble: d1 === d2, inJailRoll: true };
      this.addLog(`${player.name} lance les dés en prison : ${d1} et ${d2}.`);
      if (d1 === d2) {
        player.inJail = false;
        player.jailTurns = 0;
        this.addLog(`Double !${player.name} sort de prison et avance directement de ${d1 + d2} case(s).`);
        return { freed: true, moveWithRoll: d1 + d2 };
      }
      player.jailTurns += 1;
      if (player.jailTurns >= MAX_JAIL_TURNS) {
        // Troisième échec : sortie obligatoire, l'amende est payée d'office
        // (si le joueur n'a pas les moyens, il passe à découvert et le
        // mécanisme de dette habituel prend le relais).
        this.addLog(`${player.name} a épuisé ses tentatives : il paie l'amende de ${JAIL_FINE} et sort de prison.`);
        this.pay(player, null, JAIL_FINE);
        player.inJail = false;
        player.jailTurns = 0;
        return { freed: true, moveWithRoll: null };
      }
      this.addLog(`${player.name} reste en prison.`);
      return { freed: false, moveWithRoll: null };
    }

    // Utilise explicitement une carte "sortie de prison gratuite" — sur
    // clic d'un bouton dédié, jamais automatiquement.
    useJailFreeCard(playerId) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this._isMyTurn(playerId)) return { ok: false, reason: "Ce n'est possible qu'à ton tour." };
      if (!player.inJail) return { ok: false, reason: "Tu n'es pas en prison." };
      if (player.jailFreeCards <= 0) return { ok: false, reason: "Tu n'as pas de carte 'sortie de prison gratuite'." };

      player.jailFreeCards -= 1;
      player.inJail = false;
      player.jailTurns = 0;
      this.addLog(`${player.name} utilise une carte "sortie de prison gratuite".`);
      this.checkVictory();
      if (!this.gameOver) this.checkTurnLimit();
      return { ok: true };
    }

    // Bouton "Payer et sortir" : à tout moment durant son tour en prison
    // (pas besoin d'attendre 3 tentatives ratées). Une fois libre, il peut
    // ensuite appeler roll() normalement s'il le souhaite, dans le même tour.
    payJailFine(playerId) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this._isMyTurn(playerId)) return { ok: false, reason: "Ce n'est possible qu'à ton tour." };
      if (!player.inJail) return { ok: false, reason: "Tu n'es pas en prison." };
      if (player.money < JAIL_FINE) return { ok: false, reason: "Pas assez d'argent pour payer l'amende." };

      this.pay(player, null, JAIL_FINE);
      player.inJail = false;
      player.jailTurns = 0;
      this.addLog(`${player.name} paie l'amende de ${JAIL_FINE} et sort de prison.`);
      return { ok: true };
    }

    // Ce qui se passe une fois qu'un lancer est totalement résolu
    // (achat décidé ou pas de décision nécessaire) : faillite (ou mise à
    // découvert), victoire, puis "rejoue" (double) ou "tour suivant".
    _afterRollResolved(isDouble) {
      const player = this.currentPlayer();
      this.checkBankruptcy(player);
      if (player.inDebt) {
        // Le tour est mis en pause : ce joueur doit d'abord régler sa
        // situation (vendre, hypothéquer, emprunter) avant que la partie
        // continue. On retient ce qu'il faudra reprendre une fois réglé.
        this._pendingTurnContinuation = () => this._finishAfterRollResolved(isDouble);
        return;
      }
      this._finishAfterRollResolved(isDouble);
    }

    _finishAfterRollResolved(isDouble) {
      const player = this.currentPlayer();
      this.checkVictory();
      if (!this.gameOver) this.checkTurnLimit();
      if (this.gameOver) return;

      if (isDouble && !player.inJail && !player.bankrupt) {
        // Le même joueur rejoue : on ne touche pas à currentPlayerIndex.
        return;
      }
      this.nextPlayer();
    }

    _finishJailRoll(freed) {
      const player = this.currentPlayer();
      this.checkVictory();
      if (!this.gameOver) this.checkTurnLimit();
      if (!this.gameOver && (!freed || player.bankrupt)) {
        this.nextPlayer();
      }
    }

    // ---- API "pas à pas", pilotée depuis l'extérieur (serveur ou test) ----

    // Fait jouer UN lancer de dés au joueur courant. À utiliser à chaque
    // clic sur "Lancer les dés". Peut se terminer en attente d'une
    // décision d'achat (this.pendingDecision devient non-null).
    roll() {
      if (this.gameOver || this.pendingDecision || this.pendingAuction || this.pendingMoveChoice || this._pendingTurnContinuation) return;
      if (this.players.some((p) => p.inDebt)) return;
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
        const result = this._attemptJailExit(player);
        if (result.moveWithRoll !== null) {
          // Sortie par un double : ce lancer sert directement au déplacement.
          const newPosition = (player.position + result.moveWithRoll) % this.board.length;
          this.moveTo(player, newPosition, true);
          const tile = this.board[player.position];
          this.addLog(`${player.name} arrive sur "${tile.name}".`);
          this._resolveLandedTile(player, tile, false, result.moveWithRoll);
          return;
        }
        this.checkBankruptcy(player);
        if (player.inDebt) {
          this._pendingTurnContinuation = () => this._finishJailRoll(result.freed);
          return;
        }
        this._finishJailRoll(result.freed);
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

      if (player.power && player.power.id === "free_landing" && player.power.armed && !player.power.used) {
        player.power.used = true;
        player.power.armed = false;
        this.pendingMoveChoice = { playerId: player.id, maxDistance: sum, isDouble };
        this.addLog(`🎯 ${player.name} utilise son pouvoir Libre arrêt : il choisit où s'arrêter (jusqu'à ${sum} case(s)).`);
        return;
      }

      const newPosition = (player.position + sum) % this.board.length;
      this.moveTo(player, newPosition, true);
      const tile = this.board[player.position];
      this.addLog(`${player.name} arrive sur "${tile.name}".`);
      this._resolveLandedTile(player, tile, isDouble, sum);
    }

    // Ce qui se passe une fois qu'un joueur vient d'atterrir sur une case
    // (via un lancer normal ou le pouvoir "Libre arrêt") : proposition
    // d'achat / enchère si la case est libre et achetable, sinon
    // résolution normale de la case (loyer, taxe, carte...).
    _resolveLandedTile(player, tile, isDouble, diceSumForRent) {
      const ownableTypes = ["property", "airport", "utility"];
      if (ownableTypes.includes(tile.type) && tile.owner === null) {
        const effectivePrice = this._effectivePrice(tile.price);
        if (player.money >= effectivePrice) {
          this.pendingDecision = { type: "buy", tileIndex: player.position, playerId: player.id, price: effectivePrice, triggeredByRoll: true };
          this._pendingDiceWasDouble = isDouble;
        } else {
          this.addLog(`${player.name} n'a pas les moyens d'acheter ${tile.name}.`);
          this._pendingDiceWasDouble = isDouble;
          this.startAuction(player.position);
        }
        return; // on attend maintenant un achat, une enchère, ou les deux à la suite
      }

      this._pendingDiceWasDouble = isDouble;
      this.resolveTile(player, tile, diceSumForRent);
      // Une carte Destin/Spéciale tirée ici a pu elle-même déplacer le
      // joueur vers une case achetable (ex: "avance de 3 cases") et donc
      // mettre une décision ou une enchère en attente : dans ce cas, on
      // ne conclut PAS encore ce lancer, on attend que ce soit réglé.
      // Idem si une carte reste justement à tirer (clic requis).
      if (!this.pendingDecision && !this.pendingAuction && !this.pendingChanceDraw) {
        this._afterRollResolved(isDouble);
      }
    }

    // Pouvoir "Libre arrêt" : le joueur choisit lui-même où s'arrêter,
    // n'importe où entre 1 et le résultat de son lancer.
    chooseLandingDistance(playerId, distance) {
      if (!this.pendingMoveChoice || this.pendingMoveChoice.playerId !== playerId) {
        return { ok: false, reason: "Aucun choix d'arrêt en attente." };
      }
      const { maxDistance, isDouble } = this.pendingMoveChoice;
      const dist = Math.floor(Number(distance));
      if (!Number.isFinite(dist) || dist < 1 || dist > maxDistance) {
        return { ok: false, reason: `Choisis une distance entre 1 et ${maxDistance}.` };
      }

      this.pendingMoveChoice = null;
      const player = this.players[playerId];
      const newPosition = (player.position + dist) % this.board.length;
      this.moveTo(player, newPosition, true);
      const tile = this.board[player.position];
      this.addLog(`${player.name} arrive sur "${tile.name}" (arrêt choisi après ${dist} case(s) sur ${maxDistance}).`);
      this._resolveLandedTile(player, tile, isDouble, dist);
      return { ok: true };
    }

    // Utilisé par certaines cartes Destin/Spéciales qui déplacent le
    // joueur en cours de résolution (ex: "avance de 3 cases", "va à
    // l'aéroport le plus proche"). Reproduit la même logique que
    // l'arrivée normale sur une case (achat, enchère, loyer...), pour que
    // la case soit traitée exactement comme si le joueur y était arrivé
    // par les dés. Renvoie true si une décision/enchère est maintenant en
    // attente (le tour ne doit alors pas être conclu tout de suite).
    // Écarte du tirage les cartes qui nécessitent un type de case absent
    // de CE plateau (ex: "aéroport le plus proche" si le plateau généré
    // n'a aucun aéroport) — pertinent surtout avec un plateau généré dont
    // la composition varie selon les réglages choisis.
    _availableChanceCards() {
      const available = CHANCE_CARDS.filter((card) => {
        if (!card.requiresTileType) return true;
        return this.board.some((t) => t.type === card.requiresTileType);
      });
      // Filet de sécurité : si jamais tout se retrouvait filtré (ne
      // devrait jamais arriver, il reste toujours des cartes classiques),
      // on retombe sur le paquet complet plutôt que de planter.
      return available.length > 0 ? available : CHANCE_CARDS;
    }

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

    _landOnTile(player, newIndex, options = {}) {
      const triggeredByRoll = options.triggeredByRoll !== false;
      player.position = newIndex;
      this.tileLandingCounts[newIndex] = (this.tileLandingCounts[newIndex] || 0) + 1;
      const tile = this.board[newIndex];
      if (!options.skipMoveLog) {
        this.addLog(`${player.name} est déplacé sur "${tile.name}".`);
      }

      const ownableTypes = ["property", "airport", "utility"];
      if (ownableTypes.includes(tile.type) && tile.owner === null) {
        const effectivePrice = this._effectivePrice(tile.price);
        if (player.money >= effectivePrice) {
          this.pendingDecision = { type: "buy", tileIndex: newIndex, playerId: player.id, price: effectivePrice, triggeredByRoll };
          return true;
        }
        this.addLog(`${player.name} n'a pas les moyens d'acheter ${tile.name}.`);
        this.startAuction(newIndex, { triggeredByRoll });
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
      if (this.activeEvent && this.activeEvent.id === "property_discount_30") {
        return Math.floor(price * 0.7);
      }
      return price;
    }

    // Tire enfin la carte Destin/Spéciale mise en attente — n'agit
    // qu'après un clic explicite du joueur concerné (voir resolveTile).
    drawChanceCard(playerId) {
      if (!this.pendingChanceDraw || this.pendingChanceDraw.playerId !== playerId) {
        return { ok: false, reason: "Aucune carte à tirer pour toi en ce moment." };
      }
      const player = this.players[playerId];
      const tileType = this.pendingChanceDraw.tileType;
      this.pendingChanceDraw = null;

      const deck = this._availableChanceCards();
      const card = deck[Math.floor(Math.random() * deck.length)];
      const label = tileType === "special" ? "Carte Spéciale" : "Carte Destin";
      this.addLog(`${player.name} tire une ${label} : "${card.description}"`);
      card.effect(this, player);

      this.checkBankruptcy(player);
      if (player.inDebt) {
        this._pendingTurnContinuation = () => this._finishChanceDraw(player);
        return { ok: true };
      }
      this._finishChanceDraw(player);
      return { ok: true };
    }

    // Reprend la suite normale du tour après le tirage (même logique que
    // pour une décision d'achat ou une enchère qui viennent de se conclure).
    _finishChanceDraw(player) {
      if (!this.pendingDecision && !this.pendingAuction && !this.pendingChanceDraw) {
        this._afterRollResolved(this._pendingDiceWasDouble);
      }
    }

    decide(playerId, buy) {
      if (!this.pendingDecision || this.pendingDecision.playerId !== playerId) return;
      const tile = this.board[this.pendingDecision.tileIndex];
      const player = this.players[playerId];
      const triggeredByRoll = this.pendingDecision.triggeredByRoll !== false;

      if (buy) {
        let price = this.pendingDecision.price;
        const discounted = this.activeEvent && this.activeEvent.id === "price_reduction";
        let powerDiscountApplied = false;
        if (player.power && player.power.id === "discount_purchase" && player.power.armed && !player.power.used) {
          player.power.used = true;
          player.power.armed = false;
          price = Math.floor((price * (100 - DISCOUNT_PURCHASE_PERCENT)) / 100);
          powerDiscountApplied = true;
        }
        this.pay(player, null, price);
        tile.owner = player.id;
        this._onOwnershipChanged();
        player.stats.propertiesBought += 1;
        const note = powerDiscountApplied ? " (🏷️ remise Négociateur !)" : discounted ? " (prix réduit !)" : "";
        this.addLog(`${player.name} achète ${tile.name} pour ${price}${note}.`);

        const wasDouble = this._pendingDiceWasDouble;
        this.pendingDecision = null;
        this._pendingDiceWasDouble = false;
        // Une décision déclenchée hors d'un lancer (ex: téléportation) ne
        // doit pas faire avancer le tour ni relancer une histoire de double
        // qui n'a jamais eu lieu.
        if (triggeredByRoll) this._afterRollResolved(wasDouble);
      } else {
        // Le pouvoir Négociateur est lié à CE prochain achat précisément :
        // si le joueur refuse, le pouvoir s'arrête, sans deuxième chance.
        if (player.power && player.power.id === "discount_purchase" && player.power.armed && !player.power.used) {
          player.power.used = true;
          player.power.armed = false;
          this.addLog(`🏷️ ${player.name} refuse cet achat : son pouvoir Négociateur s'arrête sans effet.`);
        }
        this.addLog(`${player.name} ne rachète pas ${tile.name} : mise aux enchères !`);
        const tileIndex = this.pendingDecision.tileIndex;
        this.pendingDecision = null;
        // _pendingDiceWasDouble reste en mémoire : utilisé une fois l'enchère résolue (si triggeredByRoll).
        this.startAuction(tileIndex, { triggeredByRoll });
      }
    }

    // ---- Enchères — Phase 7 (secrète) + Phase 8a (classique) ----
    // ---- Mode APOCALYPSE ----
    proposeApocalypse(playerId) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this.apocalypseAllowed) return { ok: false, reason: "Le mode Apocalypse n'est pas autorisé pour cette partie." };
      if (this.apocalypseActive) return { ok: false, reason: "L'Apocalypse est déjà active." };
      if (this.pendingApocalypseVote) return { ok: false, reason: "Un vote pour l'Apocalypse est déjà en cours." };
      if (this.pendingAuctionVote) return { ok: false, reason: "Un vote pour l'enchère globale est déjà en cours." };
      if (this.pendingAuction || this.pendingDecision) {
        return { ok: false, reason: "Attends que l'action en cours soit résolue avant de proposer un vote." };
      }

      this.pendingApocalypseVote = { proposerId: playerId, votes: { [playerId]: true } };
      this.addLog(`☠️ ${player.name} propose de déclencher l'APOCALYPSE — irréversible ! Les autres joueurs doivent voter.`);
      this._checkApocalypseVoteOutcome();
      return { ok: true };
    }

    voteOnApocalypse(playerId, accept) {
      if (!this.pendingApocalypseVote) return { ok: false, reason: "Aucun vote en cours." };
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (this.pendingApocalypseVote.votes[playerId] !== undefined) return { ok: false, reason: "Tu as déjà voté." };

      this.pendingApocalypseVote.votes[playerId] = !!accept;
      this.addLog(`☠️ ${player.name} vote ${accept ? "POUR" : "CONTRE"} l'Apocalypse.`);
      this._checkApocalypseVoteOutcome();
      return { ok: true };
    }

    _checkApocalypseVoteOutcome() {
      if (!this.pendingApocalypseVote) return;
      const activeIds = this.activePlayers().map((p) => p.id);
      const votes = this.pendingApocalypseVote.votes;
      const yesCount = activeIds.filter((id) => votes[id] === true).length;
      const noCount = activeIds.filter((id) => votes[id] === false).length;
      const totalActive = activeIds.length;
      const humansOnBoard = this._allActiveHumansVotedYes(votes);

      if (yesCount > totalActive / 2 && humansOnBoard) {
        this.pendingApocalypseVote = null;
        this._activateApocalypse();
      } else if (noCount > totalActive / 2 || yesCount + noCount === totalActive) {
        this.pendingApocalypseVote = null;
        this.addLog(`☠️ Le vote pour l'Apocalypse est REFUSÉ.`);
      }
    }

    _activateApocalypse() {
      this.apocalypseActive = true;
      this.apocalypseIntensity = 1;
      this._apocalypseTurnsSinceRoundStart = 0;

      const groups = [...new Set(this.board.filter((t) => t.type === "property").map((t) => t.group))];
      groups.forEach((g) => {
        this.apocalypseGroupMultipliers[g] = { multiplier: this._rollApocalypseMultiplier(1), turnsUntilReroll: 3 + Math.floor(Math.random() * 3) };
      });

      // Distribue à chaque joueur encore actif un pouvoir apocalyptique —
      // en plus de son pouvoir normal éventuel, jamais à la place.
      this.activePlayers().forEach((p) => {
        const powerId = APOCALYPSE_POWERS[Math.floor(Math.random() * APOCALYPSE_POWERS.length)].id;
        p.apocalypsePower = { id: powerId, used: false, armed: false };
      });

      this.addLog(`☠️☠️☠️ L'APOCALYPSE EST DÉCLENCHÉE ! Les loyers deviennent chaotiques et instables, et ne feront qu'empirer. Aucun retour en arrière possible. ☠️☠️☠️`);
    }

    // Multiplicateur aléatoire, plage élargie par l'intensité — reste
    // centré autour de 1 en moyenne (donc pas de biais systématique vers
    // la hausse ou la baisse), mais des écarts de plus en plus extrêmes.
    _rollApocalypseMultiplier(intensity) {
      const spread = 0.7 * intensity;
      const raw = 1 + (Math.random() * 2 - 1) * spread;
      return Math.max(0.15, Math.round(raw * 100) / 100);
    }

    // Appelé à chaque tour complet (voir _tickWorldEvent pour le même
    // principe) une fois l'Apocalypse active : intensifie le chaos et
    // ré-évalue une partie des multiplicateurs de groupe.
    _tickApocalypse() {
      if (!this.apocalypseActive) return;
      const activeCount = this.players.filter((p) => !p.bankrupt).length;
      this._apocalypseTurnsSinceRoundStart = (this._apocalypseTurnsSinceRoundStart || 0) + 1;
      if (this._apocalypseTurnsSinceRoundStart < Math.max(1, activeCount)) return;
      this._apocalypseTurnsSinceRoundStart = 0;

      this.apocalypseIntensity = Math.min(6, this.apocalypseIntensity + 0.35);

      Object.keys(this.apocalypseGroupMultipliers).forEach((g) => {
        const entry = this.apocalypseGroupMultipliers[g];
        entry.turnsUntilReroll -= 1;
        if (entry.turnsUntilReroll <= 0) {
          entry.multiplier = this._rollApocalypseMultiplier(this.apocalypseIntensity);
          entry.turnsUntilReroll = 2 + Math.floor(Math.random() * 3);
        }
      });

      // Occasionnellement, un événement de crise ponctuel (probabilité
      // croissante avec l'intensité) vient s'ajouter au chaos ambiant.
      const chanceOfCrisis = Math.min(0.6, 0.1 * this.apocalypseIntensity);
      if (Math.random() < chanceOfCrisis) {
        this._triggerApocalypseCrisisEvent();
      }
    }

    _triggerApocalypseCrisisEvent() {
      const groups = Object.keys(this.apocalypseGroupMultipliers);
      const events = ["crash", "boom", "redistribution", "crisis_tax"];
      const kind = events[Math.floor(Math.random() * events.length)];
      if (kind === "crash" && groups.length > 0) {
        const g = groups[Math.floor(Math.random() * groups.length)];
        this.apocalypseGroupMultipliers[g] = { multiplier: 0.2, turnsUntilReroll: 2 };
        this.addLog(`☠️ 📉 Krach immobilier soudain sur le groupe ${g} (multiplicateur x0.2 temporairement) !`);
      } else if (kind === "boom" && groups.length > 0) {
        const g = groups[Math.floor(Math.random() * groups.length)];
        this.apocalypseGroupMultipliers[g] = { multiplier: 3 + this.apocalypseIntensity * 0.5, turnsUntilReroll: 2 };
        this.addLog(`☠️ 📈 Boom spéculatif soudain sur le groupe ${g} (loyers explosifs temporairement) !`);
      } else if (kind === "redistribution") {
        const active = this.activePlayers();
        if (active.length >= 2) {
          const richest = active.reduce((a, b) => (b.money > a.money ? b : a));
          const poorest = active.reduce((a, b) => (b.money < a.money ? b : a));
          if (richest.id !== poorest.id) {
            const amount = Math.floor(richest.money * 0.2);
            this.pay(richest, poorest, amount);
            this.addLog(`☠️ 💥 Redistribution brutale : ${richest.name} verse ${amount} à ${poorest.name} !`);
          }
        }
      } else if (kind === "crisis_tax") {
        const amount = Math.floor(50 * this.apocalypseIntensity);
        this.activePlayers().forEach((p) => this.pay(p, null, amount));
        this.addLog(`☠️ 🏦 Taxe de crise généralisée : chaque joueur encore en jeu paie ${amount} à la banque !`);
      }
    }


    // ---- Pouvoirs APOCALYPTIQUES — bien plus puissants que la normale ----
    armApocalypsePower(playerId) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this._isMyTurn(playerId)) return { ok: false, reason: "Un pouvoir ne peut être activé qu'à ton propre tour." };
      if (!player.apocalypsePower) return { ok: false, reason: "Tu n'as pas de pouvoir apocalyptique." };
      if (player.apocalypsePower.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };
      if (player.apocalypsePower.armed) return { ok: false, reason: "Ce pouvoir est déjà activé, en attente." };

      const power = findApocalypsePower(player.apocalypsePower.id);
      if (!power || power.mode !== "arm") return { ok: false, reason: "Ce pouvoir ne se déclenche pas de cette façon." };

      player.apocalypsePower.armed = true;
      this.addLog(`${power.icon} ${player.name} active son pouvoir apocalyptique "${power.name}" — en attente.`);
      return { ok: true };
    }

    useApocalypseTargetedCrash(playerId, group) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this._isMyTurn(playerId)) return { ok: false, reason: "Ce pouvoir ne peut être utilisé qu'à ton propre tour." };
      if (!player.apocalypsePower || player.apocalypsePower.id !== "apoc_targeted_crash") return { ok: false, reason: "Tu n'as pas ce pouvoir." };
      if (player.apocalypsePower.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };
      if (!this.apocalypseGroupMultipliers[group]) return { ok: false, reason: "Groupe invalide." };

      player.apocalypsePower.used = true;
      this.apocalypseGroupMultipliers[group] = { multiplier: 0.2, turnsUntilReroll: 3 };
      this.addLog(`📉 ${player.name} déclenche un Krach ciblé sur le groupe ${group} (x0.2) !`);
      return { ok: true };
    }

    useApocalypsePersonalBoom(playerId, group) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this._isMyTurn(playerId)) return { ok: false, reason: "Ce pouvoir ne peut être utilisé qu'à ton propre tour." };
      if (!player.apocalypsePower || player.apocalypsePower.id !== "apoc_personal_boom") return { ok: false, reason: "Tu n'as pas ce pouvoir." };
      if (player.apocalypsePower.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };
      if (!this.apocalypseGroupMultipliers[group]) return { ok: false, reason: "Groupe invalide." };
      if (!this.board.some((t) => t.type === "property" && t.group === group && t.owner === playerId)) {
        return { ok: false, reason: "Tu ne possèdes rien dans ce groupe." };
      }

      player.apocalypsePower.used = true;
      this.apocalypseGroupMultipliers[group] = { multiplier: 5, turnsUntilReroll: 3 };
      this.addLog(`📈 ${player.name} déclenche un Boom personnel sur le groupe ${group} (x5) !`);
      return { ok: true };
    }

    useApocalypseForcedRedistribution(playerId) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this._isMyTurn(playerId)) return { ok: false, reason: "Ce pouvoir ne peut être utilisé qu'à ton propre tour." };
      if (!player.apocalypsePower || player.apocalypsePower.id !== "apoc_forced_redistribution") {
        return { ok: false, reason: "Tu n'as pas ce pouvoir." };
      }
      if (player.apocalypsePower.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };

      const active = this.activePlayers();
      const richest = active.reduce((a, b) => (b.money > a.money ? b : a));
      const poorest = active.reduce((a, b) => (b.money < a.money ? b : a));
      if (richest.id === poorest.id) return { ok: false, reason: "Tout le monde a la même richesse en liquide, rien à redistribuer." };

      player.apocalypsePower.used = true;
      const amount = Math.floor(richest.money * 0.3);
      this.pay(richest, poorest, amount);
      this.addLog(`💥 ${player.name} déclenche une Redistribution forcée : ${richest.name} verse ${amount} à ${poorest.name} !`);
      return { ok: true };
    }

    useApocalypseTargetedTax(playerId, targetId) {
      const player = this.players[playerId];
      const target = this.players[targetId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this._isMyTurn(playerId)) return { ok: false, reason: "Ce pouvoir ne peut être utilisé qu'à ton propre tour." };
      if (!target || target.bankrupt || targetId === playerId) return { ok: false, reason: "Cible invalide." };
      if (!player.apocalypsePower || player.apocalypsePower.id !== "apoc_targeted_tax") return { ok: false, reason: "Tu n'as pas ce pouvoir." };
      if (player.apocalypsePower.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };

      player.apocalypsePower.used = true;
      this.pay(target, null, 300);
      this.addLog(`🎯 ${player.name} déclenche une Taxe ciblée : ${target.name} paie 300 à la banque !`);
      return { ok: true };
    }

    useApocalypseLiquidityCrisis(playerId) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this._isMyTurn(playerId)) return { ok: false, reason: "Ce pouvoir ne peut être utilisé qu'à ton propre tour." };
      if (!player.apocalypsePower || player.apocalypsePower.id !== "apoc_liquidity_crisis") {
        return { ok: false, reason: "Tu n'as pas ce pouvoir." };
      }
      if (player.apocalypsePower.used) return { ok: false, reason: "Ce pouvoir a déjà été utilisé." };

      player.apocalypsePower.used = true;
      this.activePlayers().forEach((p) => {
        if (p.id === playerId) return;
        const amount = Math.floor(p.money * 0.15);
        if (amount > 0) this.pay(p, null, amount);
      });
      this.addLog(`🏦 ${player.name} déclenche une Crise de liquidité : tous les autres joueurs perdent 15% de leur argent !`);
      return { ok: true };
    }

    // N'a de sens que si la construction est bloquée par manque de
    // propriétés vendues : évite qu'un joueur bloque indéfiniment la
    // partie en refusant d'acheter les dernières cases libres.
    proposeGlobalAuction(playerId) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (this.pendingAuctionVote) return { ok: false, reason: "Un vote est déjà en cours." };
      if (this.pendingApocalypseVote) return { ok: false, reason: "Un vote pour l'Apocalypse est déjà en cours." };
      if (this.pendingAuction || this.pendingDecision) {
        return { ok: false, reason: "Attends que l'action en cours soit résolue avant de proposer un vote." };
      }
      const unsoldTiles = this.board
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => ["property", "airport", "utility"].includes(t.type) && t.owner === null)
        .map(({ i }) => i);
      if (unsoldTiles.length === 0) {
        return { ok: false, reason: "Il ne reste aucune propriété libre à mettre aux enchères." };
      }

      this.pendingAuctionVote = { proposerId: playerId, votes: { [playerId]: true }, unsoldTiles };
      this.addLog(
        `🗳️ ${player.name} propose de mettre aux enchères les ${unsoldTiles.length} propriété(s) encore libres. Les autres joueurs doivent voter.`
      );
      this._checkGlobalAuctionVoteOutcome();
      return { ok: true };
    }

    voteOnGlobalAuction(playerId, accept) {
      if (!this.pendingAuctionVote) return { ok: false, reason: "Aucun vote en cours." };
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (this.pendingAuctionVote.votes[playerId] !== undefined) return { ok: false, reason: "Tu as déjà voté." };

      this.pendingAuctionVote.votes[playerId] = !!accept;
      this.addLog(`🗳️ ${player.name} vote ${accept ? "POUR" : "CONTRE"} l'enchère globale.`);
      this._checkGlobalAuctionVoteOutcome();
      return { ok: true };
    }

    // Résout le vote dès que le résultat est mathématiquement acquis
    // (majorité stricte d'un côté), ou dès que tout le monde a voté.
    // Un vote (enchère globale ou Apocalypse) ne doit jamais pouvoir
    // passer sur la seule base des votes de l'IA : si au moins un vrai
    // joueur est encore en jeu, il doit avoir voté POUR pour que ça
    // passe — quel que soit le nombre d'IA impliquées.
    _allActiveHumansVotedYes(votes) {
      const activeIds = this.activePlayers().map((p) => p.id);
      const humanIds = activeIds.filter((id) => !this.aiPlayerIds.has(id));
      if (humanIds.length === 0) return true; // aucun vrai joueur en jeu : pas de restriction
      return humanIds.every((id) => votes[id] === true);
    }

    _checkGlobalAuctionVoteOutcome() {
      if (!this.pendingAuctionVote) return;
      const activeIds = this.activePlayers().map((p) => p.id);
      const votes = this.pendingAuctionVote.votes;
      const yesCount = activeIds.filter((id) => votes[id] === true).length;
      const noCount = activeIds.filter((id) => votes[id] === false).length;
      const totalActive = activeIds.length;
      const humansOnBoard = this._allActiveHumansVotedYes(votes);

      if (yesCount > totalActive / 2 && humansOnBoard) {
        this._resolveGlobalAuctionVote(true);
      } else if (noCount > totalActive / 2) {
        this._resolveGlobalAuctionVote(false);
      } else if (yesCount + noCount === totalActive) {
        this._resolveGlobalAuctionVote(yesCount > noCount && humansOnBoard);
      }
    }

    _resolveGlobalAuctionVote(passed) {
      const vote = this.pendingAuctionVote;
      this.pendingAuctionVote = null;
      if (!passed) {
        this.addLog(`🗳️ Le vote pour l'enchère globale des propriétés restantes est REFUSÉ.`);
        return;
      }
      this.addLog(`🗳️ Le vote est ACCEPTÉ ! Les propriétés encore libres vont être mises aux enchères, une par une.`);
      this.propertyLiquidationQueue = [...vote.unsoldTiles];
      this._startNextLiquidationAuction();
    }

    _startNextLiquidationAuction() {
      if (!this.propertyLiquidationQueue) return;
      // Ignore toute case qui aurait pu être vendue autrement entre-temps (sécurité).
      while (this.propertyLiquidationQueue.length > 0) {
        const nextTile = this.propertyLiquidationQueue.shift();
        if (this.board[nextTile] && this.board[nextTile].owner === null) {
          this.startAuction(nextTile, { triggeredByRoll: false });
          return;
        }
      }
      this.propertyLiquidationQueue = null;
      this.addLog(`🏦 Toutes les propriétés restantes ont trouvé un propriétaire.`);
    }

    startAuction(tileIndex, options = {}) {
      const triggeredByRoll = options.triggeredByRoll !== false;
      const tile = this.board[tileIndex];
      const bidders = this.activePlayers().map((p) => p.id);
      if (bidders.length === 0 || this.auctionMode === "none") {
        if (this.auctionMode === "none") {
          this.addLog(`${tile.name} reste invendue (pas d'enchère activée).`);
        }
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
          triggeredByRoll,
        };
        this.addLog(`🔨 Enchère classique sur ${tile.name} ! Tout le monde peut surenchérir librement (sauf le meilleur enchérisseur actuel).`);
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
      if (this.auctionMode === "none") {
        return { ok: false, reason: "Les enchères sont désactivées pour cette partie (règle \"Pas d'enchère\")." };
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
      // Une mise de 0 (= passer) doit TOUJOURS être possible, même si le
      // joueur est déjà en négatif (arrivé là par un autre mécanisme que
      // la dette formelle) — sinon il resterait bloqué à jamais, incapable
      // de sortir de l'enchère. Seule une vraie mise positive au-delà de
      // ses moyens est refusée.
      if (bid > 0 && bid > player.money) return { ok: false, reason: "Tu n'as pas assez d'argent pour cette mise." };

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

      // Consomme le pouvoir "Espion" de quiconque l'avait armé pour cette
      // enchère précise (qu'il en ait tiré parti ou non).
      this.players.forEach((p) => {
        if (p.power && p.power.id === "auction_spy" && p.power.armed && !p.power.used) {
          p.power.used = true;
          p.power.armed = false;
        }
      });

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

    // -- Enchère classique (à la criée, LIBRE) --
    // N'importe quel joueur encore actif dans l'enchère peut surenchérir
    // À TOUT MOMENT — la seule règle est qu'on ne peut pas surenchérir
    // sur SA PROPRE mise (il faut attendre qu'un autre joueur surenchérisse
    // d'abord). Fini le tour par tour strict qui bloquait tout le monde
    // en attendant qu'un joueur récalcitrant daigne agir.
    raiseAuctionBid(playerId, amount) {
      if (!this.pendingAuction || this.pendingAuction.mode !== "classic") {
        return { ok: false, reason: "Aucune enchère classique en cours." };
      }
      const auction = this.pendingAuction;
      if (!auction.activeBidders.includes(playerId)) {
        return { ok: false, reason: "Tu ne participes plus à cette enchère." };
      }
      if (playerId === auction.currentBidderId) {
        return { ok: false, reason: "Tu es déjà le meilleur enchérisseur : attends qu'un autre joueur surenchérisse." };
      }

      const player = this.players[playerId];
      const bid = Math.floor(Number(amount) || 0);
      if (bid <= auction.currentBid) return { ok: false, reason: "Ta mise doit être supérieure à la mise actuelle." };
      if (bid > player.money) return { ok: false, reason: "Tu n'as pas assez d'argent pour cette mise." };

      auction.currentBid = bid;
      auction.currentBidderId = playerId;
      this.addLog(`${player.name} enchérit à ${bid} sur ${this.board[auction.tileIndex].name}.`);
      return { ok: true };
    }

    passAuctionBid(playerId) {
      if (!this.pendingAuction || this.pendingAuction.mode !== "classic") {
        return { ok: false, reason: "Aucune enchère classique en cours." };
      }
      const auction = this.pendingAuction;
      if (!auction.activeBidders.includes(playerId)) {
        return { ok: false, reason: "Tu ne participes plus à cette enchère." };
      }

      const player = this.players[playerId];
      auction.activeBidders = auction.activeBidders.filter((id) => id !== playerId);
      this.addLog(`${player.name} se retire de l'enchère (sa mise en cours, s'il en a une, reste valable).`);

      // S'il ne reste plus PERSONNE en mesure de surenchérir (tout le
      // monde a lâché sauf, au mieux, le meilleur enchérisseur actuel qui
      // ne peut pas surenchérir sur lui-même), l'enchère est décidée :
      // pas besoin d'attendre le minuteur pour rien.
      const stillCanRaise = auction.activeBidders.filter((id) => id !== auction.currentBidderId);
      if (stillCanRaise.length === 0) {
        this._concludeAuction(auction.currentBid > 0 ? auction.currentBidderId : null, auction.currentBid);
      }
      return { ok: true };
    }

    // Conclut immédiatement une enchère classique par expiration du temps
    // (le chronométrage lui-même vit côté serveur — le moteur reste
    // synchrone et testable sans dépendre du temps réel). Le plus offrant
    // actuel remporte la case ; si personne n'a encore misé, elle reste
    // libre.
    forceEndClassicAuction() {
      if (!this.pendingAuction || this.pendingAuction.mode !== "classic") return;
      const auction = this.pendingAuction;
      const winnerId = auction.currentBid > 0 ? auction.currentBidderId : null;
      this.addLog(`⏱️ Temps écoulé sur l'enchère de ${this.board[auction.tileIndex].name}.`);
      this._concludeAuction(winnerId, auction.currentBid);
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
        this._onOwnershipChanged();
        winner.stats.auctionsWon += 1;
        if (!this.biggestAuctionWin || winningBid > this.biggestAuctionWin.amount) {
          this.biggestAuctionWin = { amount: winningBid, tileIndex: this.pendingAuction.tileIndex, playerId: winnerId };
        }
        this.addLog(`🔨 ${winner.name} remporte l'enchère sur ${tile.name} pour ${winningBid} !`);
      } else {
        this.addLog(`Personne n'a remporté l'enchère : ${tile.name} reste libre.`);
      }

      this.pendingAuction = null;

      // Si cette enchère faisait partie d'une liquidation globale votée,
      // on enchaîne directement sur la case suivante plutôt que de
      // reprendre le déroulement normal du tour.
      if (this.propertyLiquidationQueue !== null) {
        this._startNextLiquidationAuction();
        return;
      }

      if (triggeredByRoll) {
        const wasDouble = this._pendingDiceWasDouble;
        this._pendingDiceWasDouble = false;
        this._afterRollResolved(wasDouble);
      }
    }

    // Une propriété ne s'échange pas (ni ne se cède) tant que son groupe
    // porte des maisons : sinon les maisons changeraient de mains gratuitement
    // et casseraient la règle de construction équilibrée.
    _tileHasGroupBuildings(tileIndex) {
      const tile = this.board[tileIndex];
      if (!tile || tile.type !== "property") return false;
      const key = this.effectiveGroupKey(tile);
      return this.board.some((t) => t.type === "property" && this.effectiveGroupKey(t) === key && (t.houses || 0) > 0);
    }

    // ---- Échanges entre joueurs — Phase 7 ----
    // Contrairement aux achats/enchères, un échange ne bloque jamais le
    // jeu : n'importe qui peut en proposer ou en accepter à tout moment,
    // même si ce n'est pas son tour.
    proposeTrade(fromId, toId, offerTiles, offerMoney, requestTiles, requestMoney, offerClauses, requestClauses) {
      if (this.activeEvent && this.activeEvent.id === "trade_freeze") {
        return { ok: false, reason: "Les échanges sont gelés pour le moment (événement mondial en cours)." };
      }
      const from = this.players[fromId];
      const to = this.players[toId];
      if (!from || !to || from.bankrupt || to.bankrupt || fromId === toId) {
        return { ok: false, reason: "Échange impossible avec ce joueur." };
      }

      if ([...(offerTiles || []), ...(requestTiles || [])].some((i) => this._tileHasGroupBuildings(i))) {
        return { ok: false, reason: "Impossible d'échanger une propriété dont le groupe porte des maisons : vends-les d'abord." };
      }
      if ([...(offerTiles || []), ...(requestTiles || [])].some((i) => this._isCollateral(i))) {
        return { ok: false, reason: "Une des propriétés est donnée en garantie d'un prêt : elle ne peut pas être échangée." };
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

      // Clauses élargies (contrats) : validées maintenant, revalidées à l'acceptation.
      const cleanOfferClauses = [];
      const cleanRequestClauses = [];
      for (const [raws, giverId, receiverId, out] of [
        [offerClauses, fromId, toId, cleanOfferClauses],
        [requestClauses, toId, fromId, cleanRequestClauses],
      ]) {
        if (raws === undefined || raws === null) continue;
        if (!Array.isArray(raws)) return { ok: false, reason: "Clauses invalides." };
        if (raws.length > CONTRACTS.CONTRACT_CONSTANTS.MAX_CLAUSES_PER_SIDE) {
          return { ok: false, reason: `Au maximum ${CONTRACTS.CONTRACT_CONSTANTS.MAX_CLAUSES_PER_SIDE} clauses par côté.` };
        }
        for (const raw of raws) {
          const norm = CONTRACTS.normalizeClause(raw);
          if (!norm.ok) return norm;
          out.push(norm.clause);
        }
      }
      const clauseCheck = this._validateTradeClauses(fromId, toId, offerTiles || [], requestTiles || [], cleanOfferClauses, cleanRequestClauses);
      if (!clauseCheck.ok) return clauseCheck;

      const trade = {
        id: this._nextTradeId++,
        fromId,
        toId,
        offerTiles: [...(offerTiles || [])],
        offerMoney: money1,
        requestTiles: [...(requestTiles || [])],
        requestMoney: money2,
        offerClauses: cleanOfferClauses,
        requestClauses: cleanRequestClauses,
      };
      this.tradeOffers.push(trade);
      this.addLog(`${from.name} propose un échange à ${to.name}.`);
      return { ok: true, tradeId: trade.id };
    }

    // ---- Contrats entre joueurs (clauses d'échange élargies) ----
    // Vérifie une clause par rapport à l'état ACTUEL de la partie.
    // `giverId` accorde la clause à `receiverId`.
    _validateClause(giverId, receiverId, clause, tradedTiles) {
      const giver = this.players[giverId];
      const tile = clause.tileIndex !== undefined ? this.board[clause.tileIndex] : null;
      const ownable = ["property", "airport", "utility"];
      switch (clause.type) {
        case "rentCession":
        case "option": {
          if (!tile || !ownable.includes(tile.type)) return { ok: false, reason: "Propriété invalide pour cette clause." };
          if (tile.owner !== giverId) return { ok: false, reason: `${tile.name} n'appartient pas à ${giver.name}.` };
          if (tile.mortgaged) return { ok: false, reason: `${tile.name} est hypothéquée.` };
          if (tradedTiles.includes(clause.tileIndex)) return { ok: false, reason: `${tile.name} change déjà de propriétaire dans cet échange.` };
          if (this._isCollateral(clause.tileIndex)) return { ok: false, reason: `${tile.name} est donnée en garantie d'un prêt.` };
          if (clause.type === "option" && this._tileHasGroupBuildings(clause.tileIndex)) {
            return { ok: false, reason: `Le groupe de ${tile.name} porte des maisons : pas d'option d'achat tant qu'elles existent.` };
          }
          const taken = this.contracts.some((c) => c.type === clause.type && c.tileIndex === clause.tileIndex);
          if (taken) return { ok: false, reason: `${tile.name} fait déjà l'objet d'un contrat de ce type.` };
          if (clause.type === "option" && clause.price < 1) return { ok: false, reason: "Prix invalide." };
          return { ok: true };
        }
        case "nonAggression": {
          const exists = this.contracts.some(
            (c) =>
              c.type === "nonAggression" &&
              ((c.giverId === giverId && c.receiverId === receiverId) || (c.giverId === receiverId && c.receiverId === giverId))
          );
          return exists ? { ok: false, reason: "Ces deux joueurs ont déjà un pacte de non-agression." } : { ok: true };
        }
        case "insuranceCover": {
          const exists = this.contracts.some((c) => c.type === "insuranceCover" && c.receiverId === receiverId);
          return exists ? { ok: false, reason: "Cet assuré a déjà une assurance entre joueurs en cours." } : { ok: true };
        }
        case "jailCards":
          return giver.jailFreeCards >= clause.count ? { ok: true } : { ok: false, reason: `${giver.name} n'a pas assez de cartes « sortie de prison ».` };
        case "rentWaiver":
        case "salaryCession":
          return { ok: true };
        default:
          return { ok: false, reason: "Clause inconnue." };
      }
    }

    _validateTradeClauses(fromId, toId, offerTiles, requestTiles, offerClauses, requestClauses) {
      const traded = [...offerTiles, ...requestTiles];
      const sides = [
        [offerClauses, fromId, toId],
        [requestClauses, toId, fromId],
      ];
      const seenTiles = new Set();
      let jailCardsOffered = { [fromId]: 0, [toId]: 0 };
      for (const [clauses, giverId, receiverId] of sides) {
        for (const clause of clauses) {
          const check = this._validateClause(giverId, receiverId, clause, traded);
          if (!check.ok) return check;
          if (clause.tileIndex !== undefined) {
            if (seenTiles.has(clause.tileIndex)) return { ok: false, reason: "Une même propriété ne peut figurer que dans une seule clause." };
            seenTiles.add(clause.tileIndex);
          }
          if (clause.type === "jailCards") {
            jailCardsOffered[giverId] += clause.count;
            if (this.players[giverId].jailFreeCards < jailCardsOffered[giverId]) {
              return { ok: false, reason: "Pas assez de cartes « sortie de prison »." };
            }
          }
        }
      }
      const pactCount = [...offerClauses, ...requestClauses].filter((c) => c.type === "nonAggression").length;
      if (pactCount > 1) return { ok: false, reason: "Un seul pacte de non-agression par échange." };
      if (requestClauses.some((c) => c.type === "insuranceCover") && offerClauses.some((c) => c.type === "insuranceCover")) {
        return { ok: false, reason: "Une seule assurance entre joueurs par échange." };
      }
      return { ok: true };
    }

    // Crée les contrats (ou transfère les cartes) une fois l'échange accepté.
    _applyClause(giverId, receiverId, clause) {
      const giver = this.players[giverId];
      const receiver = this.players[receiverId];
      if (clause.type === "jailCards") {
        giver.jailFreeCards -= clause.count;
        receiver.jailFreeCards += clause.count;
        return;
      }
      const contract = {
        id: this._nextContractId++,
        type: clause.type,
        giverId,
        receiverId,
        ...clause,
        turnsRemaining: CONTRACTS.lifetimeOf(clause),
      };
      if (clause.type === "rentWaiver" || clause.type === "salaryCession") contract.count = clause.count;
      if (clause.type === "insuranceCover") contract.capLeft = clause.cap;
      this.contracts.push(contract);
    }

    describeContract(contract) {
      return CONTRACTS.describeClause(contract, this.board);
    }

    // Un contrat est caduc si ses acteurs ont fait faillite, ou si la
    // propriété qu'il vise a changé de mains / été hypothéquée.
    _validateContracts() {
      if (this.loans) this._validateLoans();
      if (!this.contracts || this.contracts.length === 0) return;
      const kept = [];
      for (const c of this.contracts) {
        const giver = this.players[c.giverId];
        const receiver = this.players[c.receiverId];
        let reason = null;
        if (!giver || !receiver || giver.bankrupt || receiver.bankrupt) reason = "faillite d'une des parties";
        else if (c.tileIndex !== undefined) {
          const tile = this.board[c.tileIndex];
          if (!tile || tile.owner !== c.giverId) reason = `${tile ? tile.name : "la propriété"} a changé de propriétaire`;
        }
        if (reason) {
          this.addLog(`📜 Contrat annulé (${reason}) : ${giver ? giver.name : "?"} → ${receiver ? receiver.name : "?"}, ${this.describeContract(c)}.`);
        } else {
          kept.push(c);
        }
      }
      this.contracts = kept;
    }

    // Décompte en TOURS COMPLETS (chaque joueur actif a joué), comme les
    // événements mondiaux.
    _tickContracts() {
      if (!this.contracts || this.contracts.length === 0) return;
      const activeCount = this.players.filter((p) => !p.bankrupt).length;
      this._contractRoundCounter += 1;
      if (this._contractRoundCounter < Math.max(1, activeCount)) return;
      this._contractRoundCounter = 0;
      const kept = [];
      for (const c of this.contracts) {
        c.turnsRemaining -= 1;
        if (c.turnsRemaining <= 0) {
          this.addLog(`📜 Contrat terminé (${this.players[c.giverId].name} → ${this.players[c.receiverId].name}) : ${this.describeContract(c)}.`);
        } else {
          kept.push(c);
        }
      }
      this.contracts = kept;
    }

    // Le détenteur d'une option d'achat l'exerce : il paie le prix fixé et
    // récupère la propriété. Possible à tout moment (comme un échange).
    exerciseOption(contractId, playerId) {
      const idx = this.contracts.findIndex((c) => c.id === contractId && c.type === "option");
      if (idx === -1) return { ok: false, reason: "Cette option n'existe plus." };
      const c = this.contracts[idx];
      if (c.receiverId !== playerId) return { ok: false, reason: "Cette option ne t'appartient pas." };
      if (this.activeEvent && this.activeEvent.id === "trade_freeze") {
        return { ok: false, reason: "Les échanges sont gelés pour le moment (événement mondial en cours)." };
      }
      const holder = this.players[playerId];
      const owner = this.players[c.giverId];
      const tile = this.board[c.tileIndex];
      if (!holder || holder.bankrupt || !owner || owner.bankrupt || !tile || tile.owner !== c.giverId) {
        this.contracts.splice(idx, 1);
        return { ok: false, reason: "L'option n'est plus valable." };
      }
      if (tile.mortgaged) return { ok: false, reason: "La propriété est hypothéquée pour le moment." };
      if (holder.inDebt || holder.money < c.price) return { ok: false, reason: "Pas assez d'argent pour lever l'option." };
      if (this._isCollateral(c.tileIndex)) return { ok: false, reason: "La propriété est donnée en garantie d'un prêt." };
      if (this._tileHasGroupBuildings(c.tileIndex)) return { ok: false, reason: "Le groupe de cette propriété porte des maisons : vends-les d'abord." };

      this.contracts.splice(idx, 1);
      this.pay(holder, owner, c.price);
      tile.owner = holder.id;
      this.addLog(`📜 ${holder.name} lève son option d'achat sur ${tile.name} et la rachète à ${owner.name} pour ${c.price}.`);
      this._onOwnershipChanged();
      this._recheckDebtStatus(owner);
      return { ok: true };
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
      // (une propriété a pu être vendue/hypothéquée entre-temps). Le solde
      // ACTUEL d'un joueur (même déjà négatif s'il est à découvert) n'est
      // PAS un motif de refus en soi — comme un loyer ou une taxe, un
      // échange peut tout à fait faire passer quelqu'un en négatif ; c'est
      // ensuite le mécanisme normal de dette qui prend le relais.
      const from = this.players[trade.fromId];
      const to = this.players[trade.toId];
      if ([...trade.offerTiles, ...trade.requestTiles].some((i) => this._tileHasGroupBuildings(i))) {
        this.tradeOffers.splice(idx, 1);
        return { ok: false, reason: "L'échange n'est plus valide : le groupe d'une propriété porte maintenant des maisons." };
      }
      if ([...trade.offerTiles, ...trade.requestTiles].some((i) => this._isCollateral(i))) {
        this.tradeOffers.splice(idx, 1);
        return { ok: false, reason: "Une des propriétés est maintenant donnée en garantie d'un prêt." };
      }
      const offerStillValid = trade.offerTiles.every((i) => this.board[i].owner === trade.fromId && !this.board[i].mortgaged);
      const requestStillValid = trade.requestTiles.every((i) => this.board[i].owner === trade.toId && !this.board[i].mortgaged);

      if (!offerStillValid || !requestStillValid) {
        this.tradeOffers.splice(idx, 1);
        return { ok: false, reason: "L'échange n'est plus valide (une propriété a changé depuis la proposition)." };
      }
      const offerClauses = trade.offerClauses || [];
      const requestClauses = trade.requestClauses || [];
      const clauseCheck = this._validateTradeClauses(trade.fromId, trade.toId, trade.offerTiles, trade.requestTiles, offerClauses, requestClauses);
      if (!clauseCheck.ok) {
        this.tradeOffers.splice(idx, 1);
        return { ok: false, reason: `L'échange n'est plus valide (${clauseCheck.reason})` };
      }

      trade.offerTiles.forEach((i) => { this.board[i].owner = trade.toId; });
      trade.requestTiles.forEach((i) => { this.board[i].owner = trade.fromId; });
      offerClauses.forEach((clause) => this._applyClause(trade.fromId, trade.toId, clause));
      requestClauses.forEach((clause) => this._applyClause(trade.toId, trade.fromId, clause));
      this._onOwnershipChanged();

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

      const offerParts = trade.offerTiles.map((i) => this.board[i].name);
      if (trade.offerMoney > 0) offerParts.push(`${trade.offerMoney}`);
      offerClauses.forEach((c) => offerParts.push(CONTRACTS.describeClause(c, this.board)));
      const requestParts = trade.requestTiles.map((i) => this.board[i].name);
      if (trade.requestMoney > 0) requestParts.push(`${trade.requestMoney}`);
      requestClauses.forEach((c) => requestParts.push(CONTRACTS.describeClause(c, this.board)));
      const summary = `${from.name} donne ${offerParts.join(", ") || "rien"} et reçoit ${requestParts.join(", ") || "rien"}`;
      this.addLog(`🤝 Échange conclu entre ${from.name} et ${to.name}${taxNote} : ${summary}.`);
      this.checkBankruptcy(from);
      this.checkBankruptcy(to);
      this._recheckDebtStatus(from);
      this._recheckDebtStatus(to);
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

    // ---- Prêts entre joueurs — Phase 8e (+ options plus attractives) ----
    // Le prêteur choisit librement le montant, le taux d'intérêt et la
    // durée. Contrairement aux échanges, un prêt ne bloque jamais le jeu.
    //
    // Options (toutes facultatives, rétrocompatibles) :
    //   mode "income"       remboursement indexé sur les loyers : une part
    //                       (sharePercent) de CHAQUE loyer encaissé par
    //                       l'emprunteur part automatiquement chez le
    //                       prêteur jusqu'à remboursement complet. Ce qui
    //                       reste à l'échéance est dû d'un seul coup.
    //   interestFreeTurns   période sans intérêt : remboursé pendant les N
    //                       premiers tours de l'emprunteur, il ne rend que
    //                       le capital.
    //   collateralTile      gage : une propriété de l'emprunteur, bloquée
    //                       pendant le prêt. Si, à l'échéance, l'emprunteur
    //                       ne peut pas payer, le gage passe au prêteur et
    //                       la dette est soldée (au lieu d'une mise à découvert).
    proposeLoan(lenderId, borrowerId, amount, interestRatePercent, durationTurns, options) {
      if (!this.loansEnabled) return { ok: false, reason: "Les prêts ne sont pas activés pour cette partie." };

      const lender = this.players[lenderId];
      const borrower = this.players[borrowerId];
      if (!lender || !borrower || lender.bankrupt || borrower.bankrupt || lenderId === borrowerId) {
        return { ok: false, reason: "Prêt impossible avec ce joueur." };
      }

      const principal = Math.max(1, Math.floor(Number(amount) || 0));
      if (principal > lender.money) return { ok: false, reason: "Tu ne peux pas prêter plus que ce que tu as." };

      const rate = Math.max(0, Math.min(200, Math.floor(Number(interestRatePercent) || 0)));
      const duration = Math.max(1, Math.min(LOAN_MAX_DURATION, Math.floor(Number(durationTurns) || 5)));
      // Calcul en entiers pour éviter les imprécisions flottantes
      // (ex: 200 * 1.1 peut donner 220.00000000000003 en JavaScript).
      const totalOwed = Math.ceil((principal * (100 + rate)) / 100);

      const opts = options && typeof options === "object" ? options : {};
      const mode = opts.mode === "income" ? "income" : "fixed";
      const sharePercent = mode === "income" ? Math.max(LOAN_SHARE_MIN, Math.min(LOAN_SHARE_MAX, Math.floor(Number(opts.sharePercent) || LOAN_SHARE_DEFAULT))) : 0;
      const interestFreeTurns = Math.max(0, Math.min(Math.max(0, duration - 1), Math.floor(Number(opts.interestFreeTurns) || 0), LOAN_MAX_INTEREST_FREE));
      let collateralTile = null;
      if (opts.collateralTile !== undefined && opts.collateralTile !== null && opts.collateralTile !== "") {
        const idx = Math.floor(Number(opts.collateralTile));
        const tile = Number.isInteger(idx) ? this.board[idx] : null;
        if (!tile || !["property", "airport", "utility"].includes(tile.type) || tile.owner !== borrowerId) {
          return { ok: false, reason: "Le gage doit être une propriété de l'emprunteur." };
        }
        if (this._isCollateral(idx)) return { ok: false, reason: "Cette propriété garantit déjà un autre prêt." };
        if ((tile.houses || 0) > 0) return { ok: false, reason: "Une propriété avec des maisons ne peut pas servir de gage." };
        if (this.loanOffers.some((o) => o.collateralTile === idx)) return { ok: false, reason: "Cette propriété est déjà proposée en gage." };
        collateralTile = idx;
      }

      const offer = { id: this._nextLoanId++, lenderId, borrowerId, principal, interestRate: rate, duration, totalOwed, mode, sharePercent, interestFreeTurns, collateralTile };
      this.loanOffers.push(offer);
      const extras = [];
      if (mode === "income") extras.push(`remboursé par ${sharePercent}% des loyers encaissés`);
      if (interestFreeTurns > 0) extras.push(`sans intérêt si remboursé en ${interestFreeTurns} tour(s)`);
      if (collateralTile !== null) extras.push(`gage ${this.board[collateralTile].name}`);
      this.addLog(
        `💳 ${lender.name} propose un prêt de ${principal} à ${borrower.name} (taux ${rate}%, à rembourser en ${duration} tours, total dû : ${totalOwed}${extras.length ? ", " + extras.join(", ") : ""}).`
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
      if (offer.collateralTile !== null && offer.collateralTile !== undefined) {
        const tile = this.board[offer.collateralTile];
        if (!tile || tile.owner !== offer.borrowerId || this._isCollateral(offer.collateralTile)) {
          this.loanOffers.splice(idx, 1);
          return { ok: false, reason: "Le gage n'est plus disponible." };
        }
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
        mode: offer.mode || "fixed",
        sharePercent: offer.sharePercent || 0,
        interestFreeTurns: offer.interestFreeTurns || 0,
        collateralTile: offer.collateralTile === undefined ? null : offer.collateralTile,
        elapsedTurns: 0,
        repaid: 0,
      });
      this.loanOffers.splice(idx, 1);
      borrower.stats.loansContracted += 1;
      this.addLog(
        `💳 ${borrower.name} accepte le prêt de ${lender.name} : ${offer.principal} reçus maintenant, ${offer.totalOwed} à rembourser dans ${offer.duration} tours.`
      );
      this._recheckDebtStatus(borrower);
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

    // Ce que l'emprunteur doit encore MAINTENANT : sans intérêt pendant la
    // période de grâce, intérêts compris ensuite ; on déduit ce qui a déjà
    // été remboursé (loyers prélevés).
    loanAmountDue(loan) {
      const gross = (loan.elapsedTurns || 0) < (loan.interestFreeTurns || 0) ? loan.principal : loan.totalOwed;
      return Math.max(0, gross - (loan.repaid || 0));
    }

    _isCollateral(tileIndex) {
      return this.loans.some((l) => l.collateralTile === tileIndex);
    }

    // Prêts caducs (faillite) et gages perdus (propriété changée de mains).
    _validateLoans() {
      const kept = [];
      for (const loan of this.loans) {
        const lender = this.players[loan.lenderId];
        const borrower = this.players[loan.borrowerId];
        if (!lender || !borrower || lender.bankrupt || borrower.bankrupt) {
          this.addLog(`💳 Le prêt entre ${lender ? lender.name : "?"} et ${borrower ? borrower.name : "?"} est annulé (faillite).`);
          continue;
        }
        if (loan.collateralTile !== null && loan.collateralTile !== undefined) {
          const tile = this.board[loan.collateralTile];
          if (!tile || tile.owner !== loan.borrowerId) {
            this.addLog(`💳 Le gage du prêt de ${borrower.name} (${tile ? tile.name : "?"}) a changé de mains : le prêt continue sans garantie.`);
            loan.collateralTile = null;
          }
        }
        kept.push(loan);
      }
      this.loans = kept;
      this.loanOffers = this.loanOffers.filter((o) => {
        const l = this.players[o.lenderId];
        const b = this.players[o.borrowerId];
        if (!l || !b || l.bankrupt || b.bankrupt) return false;
        if (o.collateralTile !== null && o.collateralTile !== undefined) {
          const tile = this.board[o.collateralTile];
          if (!tile || tile.owner !== o.borrowerId) return false;
        }
        return true;
      });
    }

    // Prélèvement automatique sur les loyers encaissés (prêts "indexés").
    _applyLoanIncomeRepayment(receiver, receivedAmount) {
      if (!receiver || receivedAmount <= 0) return;
      const loans = this.loans.filter((l) => l.borrowerId === receiver.id && l.mode === "income");
      for (const loan of loans) {
        const due = this.loanAmountDue(loan);
        const part = Math.min(Math.floor((receivedAmount * loan.sharePercent) / 100), due, Math.max(0, receiver.money));
        if (part <= 0) continue;
        const lender = this.players[loan.lenderId];
        this.pay(receiver, lender, part);
        loan.repaid = (loan.repaid || 0) + part;
        const left = this.loanAmountDue(loan);
        this.addLog(`💳 ${loan.sharePercent}% du loyer encaissé par ${receiver.name} rembourse son prêt : ${part} pour ${lender.name} (reste ${left}).`);
        if (left <= 0) {
          this.loans = this.loans.filter((l) => l !== loan);
          this.addLog(`💳 Le prêt de ${lender.name} à ${receiver.name} est entièrement remboursé.`);
        }
      }
    }

    // Remboursement volontaire, avant l'échéance.
    repayLoanEarly(loanId, playerId) {
      const idx = this.loans.findIndex((l) => l.id === loanId);
      if (idx === -1) return { ok: false, reason: "Ce prêt n'existe plus." };
      const loan = this.loans[idx];
      if (loan.borrowerId !== playerId) return { ok: false, reason: "Ce n'est pas ta dette à rembourser." };
      const borrower = this.players[playerId];
      const due = this.loanAmountDue(loan);
      if (borrower.money < due) return { ok: false, reason: "Pas assez d'argent pour rembourser maintenant." };

      const lender = this.players[loan.lenderId];
      this.pay(borrower, lender, due);
      this.loans.splice(idx, 1);
      this.addLog(`💳 ${borrower.name} rembourse par anticipation son prêt à ${lender.name} (${due}).`);
      return { ok: true };
    }

    // Échéance forcée d'un prêt arrivé à son terme (turnsRemaining à 0).
    _settleLoan(loan) {
      const borrower = this.players[loan.borrowerId];
      const lender = this.players[loan.lenderId];
      const due = this.loanAmountDue(loan);
      if (due <= 0) return;
      if (loan.collateralTile !== null && loan.collateralTile !== undefined && borrower.money < due) {
        const tile = this.board[loan.collateralTile];
        if (tile && tile.owner === borrower.id) {
          tile.owner = lender.id;
          this.addLog(`💳 Échéance du prêt : ${borrower.name} ne peut pas payer ${due}. Son gage ${tile.name} passe à ${lender.name} et la dette est soldée.`);
          loan.collateralTile = null;
          loan.repaid = loan.totalOwed;
          this._onOwnershipChanged();
          return;
        }
      }
      this.pay(borrower, lender, due);
      this.addLog(
        `💳 Échéance du prêt : ${borrower.name} rembourse ${due} à ${lender.name} (prêt de ${loan.principal} + intérêts).`
      );
    }

    // Fait avancer d'un tour les prêts ET l'assurance du joueur dont le
    // tour vient de se terminer. Appelé depuis nextPlayer().
    _tickPersonalTimers(playerId) {
      const dueLoans = [];
      this.loans.forEach((loan) => {
        if (loan.borrowerId !== playerId) return;
        loan.elapsedTurns = (loan.elapsedTurns || 0) + 1;
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
    // Change de pouvoir contre paiement — seulement si le pouvoir actuel
    // n'a pas encore été utilisé (sinon ce serait un moyen détourné d'en
    // récupérer un second gratuitement après usage).
    rerollPower(playerId) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!this.powersEnabled) return { ok: false, reason: "Les pouvoirs ne sont pas activés pour cette partie." };
      if (!player.power) return { ok: false, reason: "Tu n'as pas de pouvoir à changer." };
      if (player.power.used) return { ok: false, reason: "Tu as déjà utilisé ton pouvoir : impossible d'en changer maintenant." };
      if (player.hasRerolledPower) return { ok: false, reason: "Tu ne peux changer de pouvoir qu'une seule fois par partie." };
      if (player.money < this.powerRerollCost) return { ok: false, reason: `Il faut ${this.powerRerollCost} pour changer de pouvoir.` };

      const oldName = (POWERS.find((p) => p.id === player.power.id) || {}).name || player.power.id;
      this.pay(player, null, this.powerRerollCost);
      const excludeIds = this.players.length < 3 ? ["forced_swap", player.power.id] : [player.power.id];
      const newId = randomPowerId(excludeIds);
      player.power = { id: newId, used: false, armed: false };
      player.hasRerolledPower = true;
      const newName = (POWERS.find((p) => p.id === newId) || {}).name || newId;
      this.addLog(`🔄 ${player.name} paie ${this.powerRerollCost} pour changer de pouvoir (une seule fois par partie) : ${oldName} → ${newName}.`);
      return { ok: true };
    }

    // ---- Société Immobilière — mécanique de DERNIÈRE CHANCE ----
    // Paliers d'investissement calibrés sur l'économie réelle du jeu :
    // argent de départ 1500, loyers de base 2 à 55 selon les groupes.
    // Rendement décroissant (chaque palier coûte proportionnellement plus
    // cher que le précédent) ; le multiplicateur maximum (x8) reste
    // nettement sous ce qu'un hôtel sur un groupe complet peut atteindre
    // (jusqu'à x50) — ce n'est pas censé être meilleur qu'un groupe classique
    // bien développé, seulement une vraie chance de rester dans la course.

    // Vérifie que TOUTES les conditions de dernière chance sont réunies.
    // Volontairement strict : ce n'est un recours que quand la voie
    // classique est réellement épuisée, pour tout le monde.
    canFormRealEstateCompany(playerId) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (player.realEstateCompany) return { ok: false, reason: "Tu as déjà une Société Immobilière active." };

      const myProperties = this.board.filter((t) => t.type === "property" && t.owner === playerId);
      if (myProperties.length < 3) {
        return { ok: false, reason: "Il faut posséder au moins 3 propriétés pour que ça ait un intérêt stratégique." };
      }

      const myGroups = [...new Set(myProperties.map((t) => this.effectiveGroupKey(t)))];
      if (myGroups.some((g) => this.ownsFullSet(playerId, g))) {
        return { ok: false, reason: "Tu possèdes déjà un groupe complet : la voie classique t'est encore ouverte." };
      }

      const others = this.activePlayers().filter((p) => p.id !== playerId);
      if (others.length === 0) return { ok: false, reason: "Il faut au moins un autre joueur encore en jeu." };
      const allOthersHaveFullGroup = others.every((p) => {
        const theirGroups = [...new Set(this.board.filter((t) => t.type === "property" && t.owner === p.id).map((t) => this.effectiveGroupKey(t)))];
        return theirGroups.some((g) => this.ownsFullSet(p.id, g));
      });
      if (!allOthersHaveFullGroup) {
        return {
          ok: false,
          reason: "Tant qu'un autre joueur n'a pas complété au moins un groupe, ce n'est pas encore une dernière chance.",
        };
      }

      if (!this.isBoardSoldOut()) {
        return {
          ok: false,
          reason: "Il reste des propriétés libres sur le plateau : accessible seulement quand tout a été acheté.",
        };
      }

      // Chaque AUTRE joueur doit avoir construit au moins une maison
      // quelque part (peu importe où) — pas besoin que TOUT le plateau
      // soit développé au maximum, sinon la dernière chance devient
      // quasiment inaccessible en pratique.
      const othersAllBuiltSomewhere = others.every((p) =>
        this.board.some((t) => t.type === "property" && t.owner === p.id && (t.houses || 0) > 0)
      );
      if (!othersAllBuiltSomewhere) {
        return {
          ok: false,
          reason: "Tant qu'un autre joueur n'a pas construit au moins une maison quelque part, la voie classique n'est pas épuisée.",
        };
      }

      return { ok: true };
    }

    formRealEstateCompany(playerId) {
      const check = this.canFormRealEstateCompany(playerId);
      if (!check.ok) return check;
      const player = this.players[playerId];
      player.realEstateCompany = { totalInvested: 0, multiplier: REAL_ESTATE_COMPANY_TIERS[0].multiplier };

      // Les groupes où je possédais des cases sans les avoir toutes ne
      // pourront plus jamais être complétés dans leur forme d'origine (mes
      // cases rejoignent la Société, pas le groupe classique) — les cases
      // RESTANTES (des autres joueurs, ou encore libres) forment donc un
      // vrai sous-groupe à part entière, avec le même prix/loyer/coût de
      // construction qu'avant (basés sur la couleur d'origine, inchangée),
      // mais qui ne nécessite plus que CES cases-là pour être complet.
      const myTiles = this.board.filter((t) => t.type === "property" && t.owner === playerId);
      const myEffectiveGroups = [...new Set(myTiles.map((t) => this.effectiveGroupKey(t)))];
      const freedTiles = [];
      const splits = [];
      myEffectiveGroups.forEach((gKey) => {
        const remainingTiles = this.board.filter(
          (t) => t.type === "property" && this.effectiveGroupKey(t) === gKey && t.owner !== playerId
        );
        if (remainingTiles.length === 0) return; // je possédais tout ce (sous-)groupe, rien à séparer
        const n = this._nextSplitGroupCounter++;
        const splitKey = `${gKey}__split${n}`;
        const coKey = `${gKey}__co${playerId}_${n}`;
        remainingTiles.forEach((t) => {
          t.groupKey = splitKey;
          freedTiles.push(t.name);
        });
        // Mes propres cases quittent aussi le groupe d'origine : elles
        // portent une clé "Société" qui ne forme jamais un groupe complet
        // (sinon une case isolée aurait l'air d'un monopole à elle seule).
        this.board
          .filter((t) => t.type === "property" && this.effectiveGroupKey(t) === gKey && t.owner === playerId)
          .forEach((t) => {
            t.groupKey = coKey;
          });
        splits.push({ baseKey: gKey, splitKey, coKey });
      });
      this._companySplits[playerId] = splits;
      if (freedTiles.length > 0) {
        this.addLog(
          `🔓 Forment désormais un groupe à part entière (même prix qu'avant, plus besoin des cases parties en Société) : ${freedTiles.join(", ")}.`
        );
      }

      this.addLog(`🏢 ${player.name} forme une Société Immobilière avec ses propriétés — dernière chance activée !`);
      return { ok: true };
    }

    // Annule la Société d'un joueur : ses cases et celles qui avaient été
    // isolées à cause d'elle retrouvent leur groupe d'origine. L'argent déjà
    // investi est perdu (il était immobilisé dans la Société).
    _cancelRealEstateCompany(playerId, reasonText) {
      const player = this.players[playerId];
      if (!player || !player.realEstateCompany) return;
      const splits = this._companySplits[playerId] || [];
      splits.forEach(({ baseKey, splitKey, coKey }) => {
        this.board.forEach((t) => {
          if (t.type !== "property") return;
          if (t.groupKey === splitKey || t.groupKey === coKey) {
            if (baseKey === t.group) delete t.groupKey;
            else t.groupKey = baseKey;
          }
        });
      });
      delete this._companySplits[playerId];
      player.realEstateCompany = null;
      this.addLog(`🏢 La Société Immobilière de ${player.name} est dissoute ${reasonText} : les groupes d'origine sont rétablis.`);
    }

    // À appeler après tout changement de propriétaire : si un joueur doté
    // d'une Société possède désormais un VRAI groupe complet, la voie
    // classique lui est de nouveau ouverte et sa Société s'annule.
    _onOwnershipChanged() {
      // Pendant "tous les propriétaires changent", la situation est
      // provisoire : on revalide seulement à la fin de l'événement.
      if (this.activeEvent && this.activeEvent.originalOwnership) return;
      this._validateContracts();
      if (!this.players.some((p) => p.realEstateCompany)) return;
      this.players.forEach((p) => {
        if (!p.realEstateCompany) return;
        if (p.bankrupt) {
          this._cancelRealEstateCompany(p.id, "(faillite)");
          return;
        }
        const keys = new Set(
          this.board.filter((t) => t.type === "property" && t.owner === p.id).map((t) => this.effectiveGroupKey(t))
        );
        const complete = [...keys].some((k) => this.ownsFullSet(p.id, k));
        if (complete) this._cancelRealEstateCompany(p.id, "car il possède de nouveau un groupe complet");
      });
    }

    investInRealEstateCompany(playerId, amount) {
      const player = this.players[playerId];
      if (!player || player.bankrupt) return { ok: false, reason: "Joueur invalide." };
      if (!player.realEstateCompany) return { ok: false, reason: "Tu n'as pas de Société Immobilière active." };
      const invest = Math.max(0, Math.floor(Number(amount) || 0));
      if (invest <= 0) return { ok: false, reason: "Montant invalide." };
      if (player.money < invest) return { ok: false, reason: "Pas assez d'argent pour cet investissement." };

      this.pay(player, null, invest);
      player.realEstateCompany.totalInvested += invest;

      let newMultiplier = 1;
      for (const tier of REAL_ESTATE_COMPANY_TIERS) {
        if (player.realEstateCompany.totalInvested >= tier.invested) newMultiplier = tier.multiplier;
      }
      const increased = newMultiplier > player.realEstateCompany.multiplier;
      player.realEstateCompany.multiplier = newMultiplier;
      this.addLog(
        `🏢 ${player.name} investit ${invest} dans sa Société Immobilière (total investi : ${player.realEstateCompany.totalInvested}, multiplicateur x${newMultiplier}${
          increased ? " — palier franchi !" : ""
        }).`
      );
      return { ok: true, multiplier: newMultiplier };
    }

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
      player.stats.insuranceBought += 1;
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
        pendingChanceDraw: this.pendingChanceDraw,
        gameOver: this.gameOver,
        winner: this.winner ? { id: this.winner.id, name: this.winner.name } : null,
        lastRoll: this.lastRoll,
        vacationPot: this.vacationPotEnabled || this.vacationPot > 0 ? this.vacationPot : null,
        turnLimit: this.turnLimit,
        activeEvent: this.activeEvent ? { ...this.activeEvent } : null,
        loansEnabled: this.loansEnabled,
        insuranceEnabled: this.insuranceEnabled,
        buildOnlyWhenSoldOut: this.buildOnlyWhenSoldOut,
        soldOutReached: this.isBoardSoldOut(),
        pendingAuctionVote: this.pendingAuctionVote ? { ...this.pendingAuctionVote, votes: { ...this.pendingAuctionVote.votes } } : null,
        propertyLiquidationRemaining: this.propertyLiquidationQueue ? this.propertyLiquidationQueue.length : 0,
        apocalypseAllowed: this.apocalypseAllowed,
        aiPlayerIds: [...this.aiPlayerIds],
        tileLandingCounts: [...this.tileLandingCounts],
        tileRentGenerated: [...this.tileRentGenerated],
        biggestAuctionWin: this.biggestAuctionWin ? { ...this.biggestAuctionWin } : null,
        apocalypseActive: this.apocalypseActive,
        apocalypseIntensity: this.apocalypseIntensity,
        apocalypseGroupMultipliers: { ...this.apocalypseGroupMultipliers },
        pendingApocalypseVote: this.pendingApocalypseVote
          ? { ...this.pendingApocalypseVote, votes: { ...this.pendingApocalypseVote.votes } }
          : null,
        powerRerollCost: this.powerRerollCost,
        insurancePrices: this.insurancePrices,
        forcedAuctionsPerGame: this.forcedAuctionsPerGame,
        rentMultipliersByHouses: RENT_MULTIPLIERS_BY_HOUSES,
        realEstateCompanyTiers: REAL_ESTATE_COMPANY_TIERS,
        airportRentTable: [25, 50, 100, 200, 300, 450],
        familyDefs: FAMILY_LIB.publicDefs(),
        lotteryPot: this.board.some((t) => t.type === "mystery") ? this.lotteryPot : null,
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
                eligibleBidders: this.pendingAuction.activeBidders.filter((id) => id !== this.pendingAuction.currentBidderId),
              }
            : {
                mode: "secret",
                tileIndex: this.pendingAuction.tileIndex,
                pendingPlayers: [...this.pendingAuction.pendingPlayers],
              }
          : null,
        pendingMoveChoice: this.pendingMoveChoice ? { ...this.pendingMoveChoice } : null,
        rentCollectorEffect: this.rentCollectorEffect ? { ...this.rentCollectorEffect } : null,
        tradeOffers: this.tradeOffers.map((t) => ({ ...t, offerClauses: (t.offerClauses || []).map((c) => ({ ...c })), requestClauses: (t.requestClauses || []).map((c) => ({ ...c })) })),
        contracts: this.contracts.map((c) => ({ ...c })),
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
          realEstateCompany: p.realEstateCompany ? { ...p.realEstateCompany } : null,
          apocalypsePower: p.apocalypsePower ? { ...p.apocalypsePower } : null,
          hasRerolledPower: !!p.hasRerolledPower,
          bankrupt: p.bankrupt,
          power: p.power ? { ...p.power } : null,
          insurance: p.insurance ? { ...p.insurance } : null,
          forcedAuctionsUsed: p.forcedAuctionsUsed,
          inDebt: p.inDebt,
          skipTurns: p.skipTurns || 0,
          bankDebt: p.bankDebt || 0,
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
          groupKey: t.groupKey || null,
          family: t.family || null,
          mysteryKind: t.type === "mystery" && t.mysteryRevealed ? t.mysteryKind : null,
          houseCost: t.type === "property" ? (t.houseCost || HOUSE_COST_BY_GROUP[t.group]) : null,
        })),
        log: this.log.slice(-80),
        logTotalCount: this.log.length,
        lastJailEvent: this.lastJailEvent ? { ...this.lastJailEvent } : null,
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
        if (this._pendingTurnContinuation) {
          // Un joueur est à découvert : en mode automatique, on tente de
          // le renflouer nous-même (vend les maisons d'abord, puis
          // hypothèque), exactement ce qu'un joueur humain ferait via les
          // boutons de la fenêtre "Mes propriétés".
          const debtor = this.players.find((p) => p.inDebt);
          let acted = false;
          if (debtor) {
            for (let i = 0; i < this.board.length && !acted; i++) {
              if (this.canSellHouse(debtor.id, i).ok) {
                this.sellHouse(debtor.id, i);
                acted = true;
              }
            }
            for (let i = 0; i < this.board.length && !acted; i++) {
              if (this.canMortgage(debtor.id, i).ok) {
                this.mortgage(debtor.id, i);
                acted = true;
              }
            }
          }
          if (!acted) {
            // Filet de sécurité : ne devrait jamais arriver (checkBankruptcy
            // aurait dû finaliser la faillite si vraiment plus d'option),
            // mais on évite à tout prix une boucle infinie.
            break;
          }
        } else if (this.pendingAuction) {
          const tile = this.board[this.pendingAuction.tileIndex];
          if (this.pendingAuction.mode === "classic") {
            // Chacun des enchérisseurs encore actifs (sauf le meilleur
            // actuel) décide indépendamment de surenchérir ou de se
            // retirer — plus de tour strict.
            const auction = this.pendingAuction;
            const eligible = auction.activeBidders.filter((id) => id !== auction.currentBidderId);
            let acted = false;
            eligible.forEach((bidderId) => {
              if (!this.pendingAuction) return; // a pu se conclure entre deux décisions
              const bidder = this.players[bidderId];
              const nextBid = this.pendingAuction.currentBid + Math.floor(tile.price * 0.1) + 5;
              const wantsIt = this.decideBuy(bidder, tile) && nextBid <= tile.price;
              if (wantsIt && nextBid <= bidder.money) {
                this.raiseAuctionBid(bidderId, nextBid);
              } else {
                this.passAuctionBid(bidderId);
              }
              acted = true;
            });
            if (!acted && this.pendingAuction) {
              // Personne n'était éligible (ne devrait pas arriver, filet de sécurité).
              this.forceEndClassicAuction();
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
        } else if (this.pendingChanceDraw) {
          this.drawChanceCard(this.pendingChanceDraw.playerId);
        } else {
          this.roll();
        }
      } while (!this.gameOver && this.currentPlayerIndex === startingIndex);
    }
  }

  return { GameEngine, INSURANCE_PLANS };
});
