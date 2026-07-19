// ============================================================
// REACH UP — Registre des pouvoirs
// Phase 8c : chaque joueur peut recevoir un pouvoir aléatoire en
// début de partie (si la règle est activée).
//
// PRINCIPE D'EXTENSION : pour ajouter un nouveau pouvoir plus tard, il
// suffit d'ajouter une entrée dans POWERS ci-dessous. Les pouvoirs
// "passive" s'appliquent automatiquement au bon moment (le moteur les
// vérifie), les pouvoirs "active" sont déclenchés par le joueur via une
// action explicite (voir engine.js : useTeleportPower / useStealPower).
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
      type: "passive",
      description: "La prochaine fois qu'un adversaire te paie un loyer, il est doublé, avec un bonus plafonné à 200 (pour éviter un gain démesuré sur un hôtel).",
    },
    {
      id: "tax_immunity",
      name: "Immunité fiscale",
      icon: "🛡️",
      type: "passive",
      description: "La prochaine taxe sur laquelle tu tombes ne te coûte rien.",
    },
    {
      id: "teleport",
      name: "Téléportation",
      icon: "🌀",
      type: "active",
      description: "Une fois dans la partie, déplace-toi instantanément sur la case de ton choix (utilisable à tout moment).",
    },
    {
      id: "theft",
      name: "Vol",
      icon: "🗝️",
      type: "active",
      description: "Une fois dans la partie, vole jusqu'à 150 à un adversaire de ton choix (utilisable à tout moment).",
    },
    {
      id: "discount_purchase",
      name: "Négociateur",
      icon: "🏷️",
      type: "passive",
      description: "Ton prochain achat direct d'une propriété coûte 20% de moins.",
    },
    {
      id: "jail_skip",
      name: "Passe-droit",
      icon: "🕊️",
      type: "passive",
      description: "La prochaine fois que tu devrais aller en prison, tu l'évites complètement.",
    },
    {
      id: "bank_loan",
      name: "Prêt bancaire",
      icon: "🏦",
      type: "active",
      description: "Une fois dans la partie, reçois 150 directement de la banque (utilisable à tout moment).",
    },
  ];

  const STEAL_AMOUNT = 150;
  const DOUBLE_RENT_CAP = 200;
  const DISCOUNT_PURCHASE_PERCENT = 20;
  const BANK_LOAN_AMOUNT = 150;

  function findPower(id) {
    return POWERS.find((p) => p.id === id) || null;
  }

  function randomPowerId() {
    return POWERS[Math.floor(Math.random() * POWERS.length)].id;
  }

  return { POWERS, STEAL_AMOUNT, DOUBLE_RENT_CAP, DISCOUNT_PURCHASE_PERCENT, BANK_LOAN_AMOUNT, findPower, randomPowerId };
});
