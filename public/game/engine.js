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
    module.exports = factory(
      BOARD, CHANCE_CARDS, HOUSE_COST_BY_GROUP, RENT_MULTIPLIERS_BY_HOUSES,
      POWERS, STEAL_AMOUNT, STEAL_MIN_TARGET_MONEY, DOUBLE_RENT_CAP, DISCOUNT_PURCHASE_PERCENT, BANK_LOAN_AMOUNT, RENT_COLLECTOR_DURATION_TURNS, HOUSE_WRECKER_COUNT, randomPowerId, APOCALYPSE_POWERS, findApocalypsePower,
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
      p.POWERS, p.STEAL_AMOUNT, p.STEAL_MIN_TARGET_MONEY, p.DOUBLE_RENT_CAP, p.DISCOUNT_PURCHASE_PERCENT, p.BANK_LOAN_AMOUNT, p.RENT_COLLECTOR_DURATION_TURNS, p.HOUSE_WRECKER_COUNT, p.randomPowerId, p.APOCALYPSE_POWERS, p.findApocalypsePower,
      w.WORLD_EVENTS, w.EVENT_DURATION_TURNS, w.FREQUENCY_PROBABILITY, w.randomEvent,
      ins.INSURANCE_PLANS
    );
  }
})(typeof window !== "undefined" ? window : globalThis, function (
  BOARD_TEMPLATE, CHANCE_CARDS, HOUSE_COST_BY_GROUP, RENT_MULTIPLIERS_BY_HOUSES,
  POWERS, STEAL_AMOUNT, STEAL_MIN_TARGET_MONEY, DOUBLE_RENT_CAP, DISCOUNT_PURCHASE_PERCENT, BANK_LOAN_AMOUNT, RENT_COLLECTOR_DURATION_TURNS, HOUSE_WRECKER_COUNT, randomPowerId, APOCALYPSE_POWERS, findApocalypsePower,
  WORLD_EVENTS, EVENT_DURATION_TURNS, FREQUENCY_PROBABILITY, randomEvent,
  INSURANCE_PLANS
) {
  const STARTING_MONEY = 2000;
  const SALARY = 200;
  const JAIL_FINE = 50;
  const MAX_JAIL_TURNS = 3;

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
      if (passedGo) {
        const doubled = this.activeEvent && this.activeEvent.id === "double_salary";
        let salaryAmount = doubled ? this.salary * 2 : this.salary;
        // Règle permanente (toujours active, pas un réglage à cocher) :
        // atterrir EXACTEMENT sur Départ rapporte 1.5x plus que le simple
        // passage devant.
        if (landedExactlyOnGo) salaryAmount = Math.floor(salaryAmount * 1.5);
        this.pay(null, player, salaryAmount);
        player.stats.salaryCollected += salaryAmount;
        const landedNote = landedExactlyOnGo ? " (atterrissage exact : x1.5 !)" : "";
        this.addLog(
          `${player.name} ${landedExactlyOnGo ? "atterrit sur" : "passe par"} la case Départ et touche ${salaryAmount}${doubled ? " (salaire doublé !)" : ""}${landedNote}.`
        );
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

    ownsFullSet(playerId, groupKeyOrTile) {
      const key = typeof groupKeyOrTile === "string" ? groupKeyOrTile : this.effectiveGroupKey(groupKeyOrTile);
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

    _payRentWithInsurance(payer, owner, rent) {
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

      if (payer.insurance && payer.insurance.turnsRemaining > 0) {
        const covered = Math.floor((rent * payer.insurance.coveragePercent) / 100);
        const payerShare = rent - covered;
        this.pay(payer, recipient, payerShare);
        if (covered > 0) {
          this.pay(null, recipient, covered);
          this.addLog(`🛡️ L'assurance de ${payer.name} prend en charge ${covered} sur ce loyer.`);
        }
        if (redirectToVacation) this._creditVacationPot(rent, owner);
        return;
      }
      this.pay(payer, recipient, rent);
      if (redirectToVacation) this._creditVacationPot(rent, owner);
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
      if (!this.ownsFullSet(playerId, tile)) return { ok: false, reason: "Il faut posséder tout le groupe pour construire." };
      if (this.buildOnlyWhenSoldOut) {
        const unsoldTile = this.board.find((t) => ["property", "airport", "utility"].includes(t.type) && t.owner === null);
        if (unsoldTile) {
          return { ok: false, reason: "La construction est bloquée tant que toutes les propriétés du plateau n'ont pas été achetées." };
        }
      }
      if (tile.houses >= 5) return { ok: false, reason: "Cette propriété a déjà un hôtel." };

      const groupTiles = this.board.filter((t) => t.type === "property" && this.effectiveGroupKey(t) === this.effectiveGroupKey(tile));
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
            this._payRentWithInsurance(player, owner, rent);
            player.stats.rentPaid += rent;
            owner.stats.rentReceived += rent;
            player.stats.biggestRentPaid = Math.max(player.stats.biggestRentPaid, rent);
            const buildingNote =
              tile.houses === 5
                ? " (hôtel)"
                : tile.houses > 0
                ? ` (${tile.houses} maison(s))`
                : rec
                ? ` (🏢 Société Immobilière x${rec.multiplier})`
                : "";
            this.addLog(`${player.name} paie ${rent} de loyer à ${owner.name} (${tile.name}${buildingNote}${apocalypseNote}).`);
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
            const count = this.board.filter((t) => t.type === "airport" && t.owner === tile.owner && !t.mortgaged).length;
            const rentTable = [25, 50, 100, 200, 300, 450];
            let rent = rentTable[Math.max(count - 1, 0)];
            rent = this._applyEventRentModifiers(rent);
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
            if (this._consumeTaxImmunityIfArmed(player)) {
              this.addLog(`🛡️ ${player.name} déclenche son immunité fiscale : aucun loyer payé sur ${tile.name} !`);
              break;
            }
            const owner = this.players[tile.owner];
            const count = this.board.filter((t) => t.type === "utility" && t.owner === tile.owner && !t.mortgaged).length;
            const multiplier = count === 1 ? 4 : count === 2 ? 10 : 20;
            let rent = diceSum * multiplier;
            rent = this._applyEventRentModifiers(rent);
            rent = this._applyDoubleRentPower(owner, rent);
            this._payRentWithInsurance(player, owner, rent);
            player.stats.rentPaid += rent;
            owner.stats.rentReceived += rent;
            player.stats.biggestRentPaid = Math.max(player.stats.biggestRentPaid, rent);
            this.addLog(`${player.name} paie ${rent} de loyer à ${owner.name} (${tile.name}, x${multiplier} le lancer de dés).`);
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
      this.checkVictory();

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

    _advanceToNextPlayer() {
      do {
        this.currentPlayerIndex =
          (this.currentPlayerIndex + this.turnDirection + this.players.length) % this.players.length;
      } while (this.players[this.currentPlayerIndex].bankrupt);
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
              originalOwnership[index] = tile.owner; // pour tout remettre en place une fois l'événement terminé
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
          Object.entries(this.activeEvent.originalOwnership).forEach(([index, ownerId]) => {
            this.board[Number(index)].owner = ownerId;
          });
          this.addLog(`🔀 Les propriétés reviennent à leurs propriétaires d'origine.`);
        }
        this.addLog(`${ended.icon} L'événement "${ended.name}" est terminé.`);
        this.activeEvent = null;
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
        return { freed: true, moveWithRoll: null };
      }
      const [d1, d2] = this.rollDice();
      this.lastRoll = { playerId: player.id, d1, d2, isDouble: d1 === d2, inJailRoll: true };
      this.addLog(`${player.name} lance les dés en prison : ${d1} et ${d2}.`);
      if (d1 === d2) {
        player.inJail = false;
        this.addLog(`Double ! ${player.name} sort de prison et avance directement de ${d1 + d2} case(s).`);
        return { freed: true, moveWithRoll: d1 + d2 };
      }
      player.jailTurns += 1;
      if (player.jailTurns >= MAX_JAIL_TURNS) {
        this.pay(player, null, JAIL_FINE);
        player.inJail = false;
        this.addLog(`${player.name} paie l'amende de ${JAIL_FINE} (3e tentative) et sort de prison.`);
        return { freed: true, moveWithRoll: null };
      }
      this.addLog(`${player.name} reste en prison.`);
      return { freed: false, moveWithRoll: null };
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
        winner.stats.auctionsWon += 1;
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
      // (une propriété a pu être vendue/hypothéquée entre-temps). Le solde
      // ACTUEL d'un joueur (même déjà négatif s'il est à découvert) n'est
      // PAS un motif de refus en soi — comme un loyer ou une taxe, un
      // échange peut tout à fait faire passer quelqu'un en négatif ; c'est
      // ensuite le mécanisme normal de dette qui prend le relais.
      const from = this.players[trade.fromId];
      const to = this.players[trade.toId];
      const offerStillValid = trade.offerTiles.every((i) => this.board[i].owner === trade.fromId && !this.board[i].mortgaged);
      const requestStillValid = trade.requestTiles.every((i) => this.board[i].owner === trade.toId && !this.board[i].mortgaged);

      if (!offerStillValid || !requestStillValid) {
        this.tradeOffers.splice(idx, 1);
        return { ok: false, reason: "L'échange n'est plus valide (une propriété a changé depuis la proposition)." };
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

      const offerParts = trade.offerTiles.map((i) => this.board[i].name);
      if (trade.offerMoney > 0) offerParts.push(`${trade.offerMoney}`);
      const requestParts = trade.requestTiles.map((i) => this.board[i].name);
      if (trade.requestMoney > 0) requestParts.push(`${trade.requestMoney}`);
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

      const unsoldTile = this.board.find((t) => ["property", "airport", "utility"].includes(t.type) && t.owner === null);
      if (unsoldTile) {
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
      myEffectiveGroups.forEach((gKey) => {
        const remainingTiles = this.board.filter(
          (t) => t.type === "property" && this.effectiveGroupKey(t) === gKey && t.owner !== playerId
        );
        if (remainingTiles.length === 0) return; // je possédais tout ce (sous-)groupe, rien à séparer
        const newKey = `${gKey}__split${this._nextSplitGroupCounter++}`;
        remainingTiles.forEach((t) => {
          t.groupKey = newKey;
          freedTiles.push(t.name);
        });
      });
      if (freedTiles.length > 0) {
        this.addLog(
          `🔓 Forment désormais un groupe à part entière (même prix qu'avant, plus besoin des cases parties en Société) : ${freedTiles.join(", ")}.`
        );
      }

      this.addLog(`🏢 ${player.name} forme une Société Immobilière avec ses propriétés — dernière chance activée !`);
      return { ok: true };
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
        pendingAuctionVote: this.pendingAuctionVote ? { ...this.pendingAuctionVote, votes: { ...this.pendingAuctionVote.votes } } : null,
        propertyLiquidationRemaining: this.propertyLiquidationQueue ? this.propertyLiquidationQueue.length : 0,
        apocalypseAllowed: this.apocalypseAllowed,
        aiPlayerIds: [...this.aiPlayerIds],
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
          realEstateCompany: p.realEstateCompany ? { ...p.realEstateCompany } : null,
          apocalypsePower: p.apocalypsePower ? { ...p.apocalypsePower } : null,
          hasRerolledPower: !!p.hasRerolledPower,
          bankrupt: p.bankrupt,
          power: p.power ? { ...p.power } : null,
          insurance: p.insurance ? { ...p.insurance } : null,
          forcedAuctionsUsed: p.forcedAuctionsUsed,
          inDebt: p.inDebt,
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
          houseCost: t.type === "property" ? HOUSE_COST_BY_GROUP[t.group] : null,
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
