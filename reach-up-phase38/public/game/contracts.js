// ============================================================
// REACH UP — Contrats entre joueurs (clauses d'échange élargies)
//
// Module PARTAGÉ client / serveur / IA (format UMD, comme les autres).
// Il ne contient AUCUN état de partie : seulement la définition des
// clauses, leur validation de forme, leur description en français et
// une estimation de leur valeur en argent (pour que l'IA puisse les
// comparer à un montant, et que l'interface puisse l'afficher).
//
// Une "clause" est ce qu'un joueur (le DONNEUR) accorde à l'autre (le
// RECEVEUR) dans un échange, en plus d'argent et de propriétés :
//   rentWaiver     le donneur renonce aux N prochains loyers que le
//                  receveur lui devrait (exemple : "je te donne 1000
//                  contre les 3 prochains loyers que je te dois")
//   rentCession    pendant N tours complets, le receveur touche les
//                  loyers d'une propriété précise du donneur (usufruit)
//   salaryCession  les N prochains passages du donneur par Départ
//                  rapportent le salaire au receveur
//   nonAggression  pacte : plus aucun loyer entre les deux joueurs
//                  pendant N tours complets (réciproque)
//   jailCards      le donneur remet N cartes "sortie de prison"
//   option         le receveur peut racheter une propriété du donneur à
//                  un prix fixé d'avance, pendant N tours complets
//   insuranceCover pendant N tours complets, le donneur (assureur)
//                  rembourse X % des loyers que le receveur paie, dans
//                  la limite d'un plafond total (et de sa propre trésorerie)
//
// Calibrage : toutes les valeurs découlent de l'économie du jeu (salaire
// 200, loyers de base 2 à 55, amende de prison 50) et sont regroupées
// dans CONTRACT_CONSTANTS pour être ajustées en un seul endroit.
// ============================================================

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.ReachUpContracts = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const CONTRACT_CONSTANTS = {
    SALARY: 200, // repère : salaire de la case Départ
    JAIL_CARD_VALUE: 75, // une carte vaut l'amende (50) + le tempo gagné
    MOVES_PER_TURN: 1.15, // cases-arrivées moyennes par tour (les doubles font rejouer)
    RENT_WAIVER_MAX_LIFETIME: 20, // un "N prochains loyers" expire après 20 tours complets
    SALARY_CESSION_MAX_LIFETIME: 40,
    OPTION_VALUE_FACTOR: 0.5, // part de l'aubaine théorique réellement attendue
    OPTION_FAIR_PRICE_FACTOR: 1.3, // une propriété "vaut" environ 1,3 fois son prix de base pour son acquéreur
    DEFAULT_RENT_ESTIMATE: 40, // loyer moyen retenu quand on ne peut pas faire mieux
    MAX_CLAUSES_PER_SIDE: 3,
  };

  const INSURANCE_PERCENTS = [25, 50, 75];

  const CLAUSE_TYPES = {
    rentWaiver: {
      id: "rentWaiver",
      icon: "🧾",
      label: "Annuler des loyers",
      help: "Le donneur renonce aux prochains loyers que le receveur lui devrait.",
      params: [{ key: "count", label: "Nombre de loyers", min: 1, max: 5, def: 3 }],
    },
    rentCession: {
      id: "rentCession",
      icon: "🏘️",
      label: "Céder les loyers d'une propriété",
      help: "Le receveur touche les loyers d'une propriété du donneur pendant N tours complets.",
      params: [
        { key: "tileIndex", label: "Propriété", type: "ownTile" },
        { key: "turns", label: "Tours complets", min: 1, max: 10, def: 5 },
      ],
    },
    salaryCession: {
      id: "salaryCession",
      icon: "💵",
      label: "Céder des salaires",
      help: "Les prochains passages du donneur par Départ rapportent le salaire au receveur.",
      params: [{ key: "count", label: "Nombre de salaires", min: 1, max: 5, def: 2 }],
    },
    nonAggression: {
      id: "nonAggression",
      icon: "🕊️",
      label: "Pacte de non-agression",
      help: "Aucun loyer entre les deux joueurs pendant N tours complets (dans les deux sens).",
      params: [{ key: "turns", label: "Tours complets", min: 1, max: 10, def: 4 }],
    },
    jailCards: {
      id: "jailCards",
      icon: "🗝️",
      label: "Cartes sortie de prison",
      help: "Le donneur remet des cartes « sortie de prison gratuite ».",
      params: [{ key: "count", label: "Nombre de cartes", min: 1, max: 3, def: 1 }],
    },
    option: {
      id: "option",
      icon: "📜",
      label: "Option d'achat",
      help: "Le receveur peut racheter une propriété du donneur au prix fixé, pendant N tours complets.",
      params: [
        { key: "tileIndex", label: "Propriété", type: "ownTile" },
        { key: "price", label: "Prix de rachat", min: 1, max: 5000, def: 300 },
        { key: "turns", label: "Tours complets", min: 1, max: 10, def: 6 },
      ],
    },
    insuranceCover: {
      id: "insuranceCover",
      icon: "🛡️",
      label: "Assurance entre joueurs",
      help: "Le donneur (assureur) rembourse une part des loyers que le receveur paie, dans la limite d'un plafond.",
      params: [
        { key: "percent", label: "Part couverte (%)", type: "choice", choices: INSURANCE_PERCENTS, def: 50 },
        { key: "cap", label: "Plafond total", min: 100, max: 1000, def: 400 },
        { key: "turns", label: "Tours complets", min: 1, max: 10, def: 5 },
      ],
    },
  };

  const CLAUSE_ORDER = ["rentWaiver", "rentCession", "salaryCession", "nonAggression", "jailCards", "option", "insuranceCover"];

  function toInt(value) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? n : NaN;
  }

  // Vérifie la FORME d'une clause (types, bornes) et renvoie une version
  // propre, sans champ superflu. Les conditions liées à la partie en cours
  // (le donneur possède-t-il la propriété ?...) sont vérifiées par le moteur.
  function normalizeClause(raw) {
    if (!raw || typeof raw !== "object") return { ok: false, reason: "Clause invalide." };
    const def = CLAUSE_TYPES[raw.type];
    if (!def) return { ok: false, reason: "Type de clause inconnu." };
    const clause = { type: def.id };
    for (const param of def.params) {
      const value = toInt(raw[param.key]);
      if (!Number.isFinite(value)) return { ok: false, reason: `Valeur manquante (${param.label}).` };
      if (param.type === "ownTile") {
        if (value < 0) return { ok: false, reason: "Propriété invalide." };
      } else if (param.type === "choice") {
        if (!param.choices.includes(value)) return { ok: false, reason: `Valeur invalide (${param.label}).` };
      } else if (value < param.min || value > param.max) {
        return { ok: false, reason: `${param.label} : entre ${param.min} et ${param.max}.` };
      }
      clause[param.key] = value;
    }
    return { ok: true, clause };
  }

  function tileName(board, index) {
    const t = board && board[index];
    return t ? t.name : `case ${index}`;
  }

  // Description lisible, utilisée dans l'interface et dans le journal.
  function describeClause(clause, board) {
    switch (clause.type) {
      case "rentWaiver":
        return `${clause.count} prochain(s) loyer(s) annulé(s)`;
      case "rentCession":
        return `loyers de ${tileName(board, clause.tileIndex)} pendant ${clause.turns} tour(s) complet(s)`;
      case "salaryCession":
        return `${clause.count} prochain(s) salaire(s) de la case Départ`;
      case "nonAggression":
        return `pacte de non-agression (aucun loyer entre eux) pendant ${clause.turns} tour(s) complet(s)`;
      case "jailCards":
        return `${clause.count} carte(s) « sortie de prison »`;
      case "option":
        return `option d'achat sur ${tileName(board, clause.tileIndex)} à ${clause.price} pendant ${clause.turns} tour(s) complet(s)`;
      case "insuranceCover":
        return `assurance ${clause.percent}% des loyers payés (plafond ${clause.cap}) pendant ${clause.turns} tour(s) complet(s)`;
      default:
        return "clause inconnue";
    }
  }

  // ---------------------------------------------------------------
  // Estimation de valeur (en argent). Fonctionne aussi bien sur l'état
  // public (client, IA) que sur le moteur : seuls board et players sont lus.
  // ---------------------------------------------------------------
  const RENT_MULTS = [1, 5, 15, 30, 40, 50];
  const AIRPORT_RENTS = [25, 50, 100, 200, 300, 450];

  function activeCount(state) {
    return state.players.filter((p) => !p.bankrupt).length;
  }

  // Loyer courant estimé d'une case (sans connaître le détail des
  // monopoles : une propriété nue vaut un peu plus que son loyer de base).
  function tileRentEstimate(state, tile) {
    if (!tile || tile.mortgaged || tile.owner === null || tile.owner === undefined) return 0;
    if (tile.type === "property") {
      const base = tile.rent || 0;
      return tile.houses > 0 ? base * RENT_MULTS[Math.min(5, tile.houses)] : base * 1.5;
    }
    if (tile.type === "airport" || tile.type === "utility") {
      const F = typeof window !== "undefined" ? window.ReachUpFamilies : require("./families.js");
      if (tile.type === "utility" && (!tile.family || tile.family === "utility")) return 28;
      return F.familyRentEstimate(state.board, tile) || 0;
    }
    return 0;
  }

  // Loyers qu'un joueur donné devrait en moyenne encaisser par tour
  // complet de CHAQUE adversaire qui passerait sur ses cases.
  function rentIncomePerPayerTurn(state, ownerId) {
    const len = state.board.length || 40;
    let sum = 0;
    state.board.forEach((t) => {
      if (t.owner === ownerId) sum += tileRentEstimate(state, t);
    });
    return (sum / len) * CONTRACT_CONSTANTS.MOVES_PER_TURN;
  }

  function lifetimeOf(clause) {
    if (clause.type === "rentWaiver") return CONTRACT_CONSTANTS.RENT_WAIVER_MAX_LIFETIME;
    if (clause.type === "salaryCession") return CONTRACT_CONSTANTS.SALARY_CESSION_MAX_LIFETIME;
    return clause.turns;
  }

  // Renvoie { forReceiver, forGiver } : le gain net estimé de chaque côté.
  // Pour la plupart des clauses, ce que l'un gagne l'autre le perd.
  function clauseValue(clause, state, giverId, receiverId) {
    const C = CONTRACT_CONSTANTS;
    const len = state.board.length || 40;
    let gain = 0; // gain du receveur
    switch (clause.type) {
      case "rentWaiver": {
        // Fréquence à laquelle le receveur tombe sur une case du donneur.
        const owned = state.board.filter((t) => t.owner === giverId && !t.mortgaged && ["property", "airport", "utility"].includes(t.type)).length;
        const eventsPerTurn = (owned / len) * C.MOVES_PER_TURN;
        const expectedEvents = Math.min(clause.count, eventsPerTurn * C.RENT_WAIVER_MAX_LIFETIME);
        gain = expectedEvents * avgRentOwned(state, giverId);
        break;
      }
      case "rentCession": {
        const tile = state.board[clause.tileIndex];
        const payers = Math.max(0, activeCount(state) - 1); // tout le monde sauf le donneur (le receveur s'épargne son propre loyer)
        gain = clause.turns * payers * (C.MOVES_PER_TURN / len) * tileRentEstimate(state, tile);
        break;
      }
      case "salaryCession":
        gain = clause.count * C.SALARY * 0.9;
        break;
      case "jailCards":
        gain = clause.count * C.JAIL_CARD_VALUE;
        break;
      case "option": {
        const tile = state.board[clause.tileIndex];
        const price = tile && tile.price ? tile.price : 0;
        gain = Math.max(0, price * C.OPTION_FAIR_PRICE_FACTOR - clause.price) * C.OPTION_VALUE_FACTOR;
        break;
      }
      case "insuranceCover": {
        let expectedRentPerTurn = 0;
        state.players.forEach((p) => {
          if (p.bankrupt || p.id === receiverId) return;
          expectedRentPerTurn += rentIncomePerPayerTurn(state, p.id);
        });
        gain = Math.min(clause.cap, (clause.percent / 100) * clause.turns * expectedRentPerTurn);
        break;
      }
      case "nonAggression": {
        // Réciproque : chacun évite les loyers qu'il devrait à l'autre,
        // mais renonce à ceux que l'autre lui devrait.
        const toGiver = clause.turns * rentIncomePerPayerTurn(state, giverId); // ce que le receveur paierait au donneur
        const toReceiver = clause.turns * rentIncomePerPayerTurn(state, receiverId); // ce que le donneur paierait au receveur
        return { forReceiver: Math.round(toGiver - toReceiver), forGiver: Math.round(toReceiver - toGiver) };
      }
      default:
        gain = 0;
    }
    gain = Math.round(gain);
    return { forReceiver: gain, forGiver: -gain };
  }

  function avgRentOwned(state, ownerId) {
    const tiles = state.board.filter((t) => t.owner === ownerId && !t.mortgaged && ["property", "airport", "utility"].includes(t.type));
    if (tiles.length === 0) return 0;
    const total = tiles.reduce((s, t) => s + tileRentEstimate(state, t), 0);
    return total / tiles.length;
  }

  return {
    CONTRACT_CONSTANTS,
    CLAUSE_TYPES,
    CLAUSE_ORDER,
    INSURANCE_PERCENTS,
    normalizeClause,
    describeClause,
    clauseValue,
    lifetimeOf,
    tileRentEstimate,
  };
});
