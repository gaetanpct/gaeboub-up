// ============================================================
// REACH UP — Formules d'assurance
// Phase 10 : 3 formules au choix, du moins cher/moins couvrant au plus
// cher/plus couvrant. Fichier séparé pour que le client puisse afficher
// les 3 choix sans avoir à charger tout le moteur.
// ============================================================

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.ReachUpInsurance = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {

  const INSURANCE_PLANS = [
    { id: 0, name: "Basique", premium: 150, coveragePercent: 25, duration: 8 },
    { id: 1, name: "Standard", premium: 350, coveragePercent: 50, duration: 8 },
    { id: 2, name: "Premium", premium: 600, coveragePercent: 75, duration: 8 },
  ];

  return { INSURANCE_PLANS };
});
