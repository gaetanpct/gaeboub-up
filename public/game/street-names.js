// ============================================================
// REACH UP — Noms de rues personnalisés
//
// Sept noms maison remplacent au hasard sept noms de rues du plateau, à
// chaque partie. « Avenue Maitre Picut » est toujours posée dans le
// groupe le plus cher du plateau (le bleu marine en fin de plateau).
// ============================================================

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.ReachUpStreetNames = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const PREMIUM_STREET = { name: "Avenue Maitre Picut", short: "Maitre Picut" };
  const OTHER_STREETS = [
    { name: "Boulevard des Thaïlandaises Xmen", short: "Thaïlandaises X" },
    { name: "Rue Khalamité", short: "Khalamité" },
    { name: "Rue de la Kirkification", short: "Kirkification" },
    { name: "Rue Yakak", short: "Yakak" },
    { name: "Rue BadGyal", short: "BadGyal" },
    { name: "Rue de Lappe", short: "Lappe" },
  ];

  function shuffled(array) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // Modifie le plateau sur place (à appeler sur une copie propre à la partie).
  function applyStreetNames(board) {
    const props = board.map((t, i) => ({ t, i })).filter(({ t }) => t.type === "property");
    if (props.length === 0) return board;
    const maxPrice = Math.max(...props.map(({ t }) => t.price || 0));
    const topGroup = props.find(({ t }) => (t.price || 0) === maxPrice).t.group;
    const topTiles = props.filter(({ t }) => t.group === topGroup);
    const picut = shuffled(topTiles)[0];
    picut.t.name = PREMIUM_STREET.name;
    picut.t.short = PREMIUM_STREET.short;
    const others = shuffled(props.filter(({ i }) => i !== picut.i));
    OTHER_STREETS.slice(0, others.length).forEach((street, k) => {
      others[k].t.name = street.name;
      others[k].t.short = street.short;
    });
    return board;
  }

  return { applyStreetNames, PREMIUM_STREET, OTHER_STREETS };
});
