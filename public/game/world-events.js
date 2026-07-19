// ============================================================
// REACH UP — Registre des événements mondiaux temporaires
// Phase 8d : effets globaux à durée limitée, affectant toute la table.
//
// PRINCIPE D'EXTENSION : ajouter un événement se fait ici. Son effet
// mécanique est ensuite branché dans engine.js aux endroits concernés
// (ils vérifient tous simplement `this.activeEvent.id === "..."`).
//
// Un seul événement actif à la fois (simplification volontaire — cumuler
// plusieurs effets globaux en même temps ouvrirait des interactions
// difficiles à équilibrer/tester). Déclenché soit aléatoirement selon la
// fréquence choisie, soit en tombant sur une case "Carte Spéciale".
// ============================================================

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.ReachUpWorldEvents = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {

  const EVENT_DURATION_TURNS = 6; // valeur par défaut, utilisée si un événement ne précise pas la sienne

  const WORLD_EVENTS = [
    {
      id: "rank_reversal",
      name: "Inversion du classement",
      icon: "🔄",
      description: "Le sens du tour est inversé.",
    },
    {
      id: "double_movement",
      name: "Double déplacement",
      icon: "⚡",
      description: "Les dés comptent double pour se déplacer.",
    },
    {
      id: "trade_freeze",
      name: "Gel des échanges",
      icon: "🧊",
      description: "Impossible de proposer ou d'accepter un échange.",
    },
    {
      id: "free_sales",
      name: "Ventes gratuites",
      icon: "🎁",
      description: "Revendre une maison rembourse son plein prix.",
    },
    {
      id: "price_reduction",
      name: "Réduction des prix",
      icon: "🏷️",
      description: "Les propriétés coûtent 25% de moins à l'achat directe.",
    },
    {
      id: "double_salary",
      name: "Salaire doublé",
      icon: "💵",
      description: "Le salaire de la case Départ est doublé.",
    },
    {
      id: "property_shuffle",
      name: "Grand chelem",
      icon: "🔀",
      duration: 1,
      description: "Toutes les propriétés changent de mains d'un coup (redistribuées en chaîne entre tous les joueurs).",
    },
    {
      id: "wealth_tax_vacation",
      name: "Fortune imposée",
      icon: "🏦",
      duration: 2,
      description: "Tous les loyers dus au joueur le plus riche partent directement dans la cagnotte de Vacances.",
    },
    {
      id: "rent_reduction",
      name: "Récession",
      icon: "📉",
      duration: 3,
      description: "Les loyers rapportent 25% de moins.",
    },
    {
      id: "property_discount_30",
      name: "Soldes immobilières",
      icon: "💸",
      duration: 2,
      description: "Les propriétés coûtent 30% de moins à l'achat directe.",
    },
    {
      id: "inflation",
      name: "Inflation galopante",
      icon: "📈",
      duration: 3,
      description: "Taxes et loyers augmentent de 25%.",
    },
    {
      id: "wealth_redistribution",
      name: "Redistribution",
      icon: "🤲",
      duration: 1,
      description: "Le joueur le plus riche verse 10% de son argent au joueur le plus pauvre.",
    },
    {
      id: "disabled_zones",
      name: "Zones désactivées",
      icon: "🚫",
      duration: 5,
      description: "5 cases tirées au sort n'ont plus aucun effet tant que ça dure.",
    },
  ];

  const FREQUENCY_PROBABILITY = {
    rare: 1 / 15,
    normal: 1 / 10,
    frequent: 1 / 6,
  };

  function findEvent(id) {
    return WORLD_EVENTS.find((e) => e.id === id) || null;
  }

  function randomEvent() {
    return WORLD_EVENTS[Math.floor(Math.random() * WORLD_EVENTS.length)];
  }

  return { WORLD_EVENTS, EVENT_DURATION_TURNS, FREQUENCY_PROBABILITY, findEvent, randomEvent };
});
