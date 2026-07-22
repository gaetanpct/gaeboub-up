// ============================================================
// REACH UP — Registre des pouvoirs
// Phase 8c, revu en profondeur (Phase 13) : TOUS les pouvoirs sont
// désormais actifs — c'est toujours le joueur qui choisit le moment de
// les déclencher, et UNIQUEMENT PENDANT SON PROPRE TOUR (aucun pouvoir
// ne peut plus être activé "à tout moment").
//
// Deux familles :
//   - mode "arm"     : on l'active, il reste en attente ("armé") jusqu'à
//                       ce que l'événement concerné se présente (loyer
//                       reçu, taxe/loyer à payer, achat proposé...).
//   - mode "instant"  : l'effet a lieu immédiatement à l'activation.
//
// PRINCIPE D'EXTENSION : ajouter un pouvoir se fait ici. La logique
// d'activation/armement est dans engine.js (armPower / useXPower).
// ============================================================

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.ReachUpPowers = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {

  const POWERS = [
    {
      id: "double_rent",
      name: "Loyer majoré",
      icon: "💰",
      mode: "arm",
      description: "Active-le à ton tour : la prochaine fois qu'un adversaire te paie un loyer, il est majoré, avec un bonus plafonné à 500 (pour éviter un gain démesuré sur un hôtel).",
    },
    {
      id: "tax_immunity",
      name: "Immunité fiscale",
      icon: "🛡️",
      mode: "arm",
      description: "Active-le à ton tour : la prochaine taxe OU le prochain loyer sur lequel tu tombes ne te coûte rien.",
    },
    {
      id: "teleport",
      name: "Téléportation",
      icon: "🌀",
      mode: "instant",
      description: "À ton tour, déplace-toi instantanément sur la case de ton choix.",
    },
    {
      id: "theft",
      name: "Vol",
      icon: "🗝️",
      mode: "instant",
      description: "À ton tour, vole jusqu'à 300 à un adversaire de ton choix — à condition qu'il ait plus de 400 sur son compte.",
    },
    {
      id: "discount_purchase",
      name: "Négociateur",
      icon: "🏷️",
      mode: "arm",
      description: "Active-le à ton tour : ton prochain achat direct d'une propriété coûte 95% de moins. Si tu refuses ce prochain achat, le pouvoir s'arrête sans effet.",
    },
    {
      id: "bank_loan",
      name: "Prêt bancaire",
      icon: "🏦",
      mode: "instant",
      description: "À ton tour, reçois 500 directement de la banque.",
    },
    {
      id: "auction_spy",
      name: "Espion",
      icon: "🕵️",
      mode: "arm",
      description: "Active-le à ton tour : lors de la prochaine enchère scellée, tu vois les mises déjà déposées par les autres avant de poser la tienne.",
    },
    {
      id: "rent_collector",
      name: "Collecteur",
      icon: "💼",
      mode: "instant",
      description: "À ton tour : pendant 2 tours, tous les loyers dus par n'importe quel joueur (à n'importe quel propriétaire) te sont versés à toi à la place.",
    },
    {
      id: "vacation_claim",
      name: "Vacances à volonté",
      icon: "🏖️",
      mode: "instant",
      description: "À ton tour, récupère immédiatement toute la cagnotte de Vacances, quelle que soit ta position.",
    },
    {
      id: "debt_bailout",
      name: "Renflouement",
      icon: "🆘",
      mode: "instant",
      description: "Si tu es à découvert, la banque comble immédiatement ton négatif (utilisable uniquement dans cette situation).",
    },
    {
      id: "free_landing",
      name: "Libre arrêt",
      icon: "🎯",
      mode: "arm",
      description: "Active-le à ton tour : à ton prochain lancer, tu choisis où t'arrêter parmi les cases accessibles par ton résultat (ex: tu fais 7, tu peux t'arrêter après 3 cases).",
    },
    {
      id: "house_wrecker",
      name: "Démolition",
      icon: "💥",
      mode: "instant",
      description: "À ton tour, retire 4 maisons prises au hasard chez l'adversaire de ton choix (sans remboursement pour lui).",
    },
    {
      id: "forced_swap",
      name: "Échange forcé",
      icon: "🔁",
      mode: "instant",
      description: "À ton tour, force un échange entre deux AUTRES joueurs (pas toi) : choisis une propriété appartenant à l'un et une appartenant à l'autre, aucune des deux ne doit avoir de maison ou d'hôtel dessus.",
    },
  ];

  const STEAL_AMOUNT = 300;
  const STEAL_MIN_TARGET_MONEY = 400;
  const DOUBLE_RENT_CAP = 500;
  const DISCOUNT_PURCHASE_PERCENT = 95;
  const BANK_LOAN_AMOUNT = 500;
  const RENT_COLLECTOR_DURATION_TURNS = 2;
  const HOUSE_WRECKER_COUNT = 4;

  function findPower(id) {
    return POWERS.find((p) => p.id === id) || null;
  }

  function randomPowerId(excludeIds) {
    const exclude = excludeIds || [];
    const eligible = POWERS.filter((p) => !exclude.includes(p.id));
    const pool = eligible.length > 0 ? eligible : POWERS; // filet de sécurité si jamais tout était exclu
    return pool[Math.floor(Math.random() * pool.length)].id;
  }

  // ---- Pouvoirs APOCALYPTIQUES — distribués uniquement si le mode
  // Apocalypse se déclenche, bien plus puissants que la normale.
  const APOCALYPSE_POWERS = [
    {
      id: "apoc_targeted_crash",
      name: "☠️ Krach ciblé",
      icon: "📉",
      mode: "instant",
      description: "Choisis un groupe adverse : son multiplicateur de chaos s'effondre à x0.2 pour les prochains tours.",
    },
    {
      id: "apoc_personal_boom",
      name: "☠️ Boom personnel",
      icon: "📈",
      mode: "instant",
      description: "Un de tes groupes reçoit un multiplicateur de chaos x5 pour les prochains tours.",
    },
    {
      id: "apoc_forced_redistribution",
      name: "☠️ Redistribution forcée",
      icon: "💥",
      mode: "instant",
      description: "Le joueur le plus riche verse 30% de son argent liquide au joueur le plus pauvre (toi y compris si concerné).",
    },
    {
      id: "apoc_targeted_tax",
      name: "☠️ Taxe ciblée",
      icon: "🎯",
      mode: "instant",
      description: "Choisis un adversaire : il paie immédiatement 300 à la banque.",
    },
    {
      id: "apoc_crisis_shield",
      name: "☠️ Bouclier de crise",
      icon: "🛡️",
      mode: "arm",
      description: "Active-le à ton tour : le prochain loyer que tu payes est réduit de 75%, quel que soit le chaos ambiant.",
    },
    {
      id: "apoc_liquidity_crisis",
      name: "☠️ Crise de liquidité",
      icon: "🏦",
      mode: "instant",
      description: "Tous les autres joueurs perdent 15% de leur argent liquide, versé directement à la banque.",
    },
  ];
  function findApocalypsePower(id) {
    return APOCALYPSE_POWERS.find((p) => p.id === id) || null;
  }

  return {
    POWERS,
    STEAL_AMOUNT,
    STEAL_MIN_TARGET_MONEY,
    DOUBLE_RENT_CAP,
    DISCOUNT_PURCHASE_PERCENT,
    BANK_LOAN_AMOUNT,
    RENT_COLLECTOR_DURATION_TURNS,
    HOUSE_WRECKER_COUNT,
    findPower,
    randomPowerId,
    APOCALYPSE_POWERS,
    findApocalypsePower,
  };
});
