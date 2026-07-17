// ============================================================
// REACH UP — Données du plateau
// Phase 2 : moteur du jeu
//
// Ce fichier ne contient AUCUNE logique, seulement les données.
// Il est écrit pour fonctionner à la fois :
//   - dans le navigateur (chargé par un <script>)
//   - plus tard dans le serveur Node (via require())
// C'est pourquoi on utilise ce petit bloc "UMD" en haut/bas du fichier.
//
// NOTE : les maisons/hôtels ne sont PAS encore implémentés.
// Pour l'instant, le seul bonus de loyer est "posséder tout le groupe"
// (loyer x2). La construction viendra dans une phase ultérieure.
// ============================================================

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.ReachUpBoard = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {

  // type possibles : "go" | "property" | "airport" | "utility" | "tax"
  //                | "chance" | "jail" | "go-to-jail" | "vacation"
  const BOARD = [
    { type: "go", name: "Départ" },
    { type: "property", name: "Rue des Lilas", group: "marron", price: 60, rent: 2, owner: null },
    { type: "chance", name: "Carte Destin" },
    { type: "property", name: "Rue des Tilleuls", group: "marron", price: 60, rent: 4, owner: null },
    { type: "tax", name: "Impôts", amount: 200 },
    { type: "airport", name: "Aéroport Nord", price: 200, owner: null },
    { type: "property", name: "Rue de la Gare", group: "cyan", price: 100, rent: 6, owner: null },
    { type: "chance", name: "Carte Destin" },
    { type: "property", name: "Rue du Port", group: "cyan", price: 100, rent: 6, owner: null },
    { type: "property", name: "Rue des Docks", group: "cyan", price: 120, rent: 8, owner: null },
    { type: "jail", name: "Prison / Simple visite" },
    { type: "property", name: "Avenue des Roses", group: "magenta", price: 140, rent: 10, owner: null },
    { type: "utility", name: "Compagnie des Eaux", price: 150, owner: null },
    { type: "property", name: "Avenue des Tulipes", group: "magenta", price: 140, rent: 10, owner: null },
    { type: "property", name: "Avenue des Orchidées", group: "magenta", price: 160, rent: 12, owner: null },
    { type: "airport", name: "Aéroport Est", price: 200, owner: null },
    { type: "property", name: "Boulevard du Commerce", group: "orange", price: 180, rent: 14, owner: null },
    { type: "chance", name: "Carte Destin" },
    { type: "property", name: "Boulevard des Arts", group: "orange", price: 180, rent: 14, owner: null },
    { type: "property", name: "Boulevard de la Paix", group: "orange", price: 200, rent: 16, owner: null },
    { type: "vacation", name: "Vacances" },
    { type: "property", name: "Rue Victor Hugo", group: "rouge", price: 220, rent: 18, owner: null },
    { type: "chance", name: "Carte Destin" },
    { type: "property", name: "Rue Voltaire", group: "rouge", price: 220, rent: 18, owner: null },
    { type: "property", name: "Rue Molière", group: "rouge", price: 240, rent: 20, owner: null },
    { type: "airport", name: "Aéroport Sud", price: 200, owner: null },
    { type: "property", name: "Avenue du Parc", group: "jaune", price: 260, rent: 22, owner: null },
    { type: "property", name: "Avenue des Sports", group: "jaune", price: 260, rent: 22, owner: null },
    { type: "utility", name: "Compagnie d'Électricité", price: 150, owner: null },
    { type: "property", name: "Avenue Centrale", group: "jaune", price: 280, rent: 24, owner: null },
    { type: "go-to-jail", name: "Aller en prison" },
    { type: "property", name: "Boulevard Saint-Michel", group: "vert", price: 300, rent: 26, owner: null },
    { type: "property", name: "Boulevard Saint-Germain", group: "vert", price: 300, rent: 26, owner: null },
    { type: "chance", name: "Carte Destin" },
    { type: "property", name: "Boulevard Haussmann", group: "vert", price: 320, rent: 28, owner: null },
    { type: "airport", name: "Aéroport Ouest", price: 200, owner: null },
    { type: "chance", name: "Carte Destin" },
    { type: "property", name: "Avenue des Champs", group: "bleu", price: 350, rent: 35, owner: null },
    { type: "tax", name: "Taxe de luxe", amount: 100 },
    { type: "property", name: "Avenue Royale", group: "bleu", price: 400, rent: 50, owner: null },
  ];

  // Petit paquet de cartes "Destin" — tiré au hasard avec remise.
  // Chaque carte a une description (pour le log) et un effet.
  const CHANCE_CARDS = [
    {
      description: "Vous gagnez un prix de mots croisés (+100).",
      effect: (engine, player) => engine.pay(null, player, 100),
    },
    {
      description: "Erreur fiscale : vous payez une pénalité (-75).",
      effect: (engine, player) => engine.pay(player, null, 75),
    },
    {
      description: "Avancez jusqu'à la case Départ (touchez 200).",
      effect: (engine, player) => engine.moveTo(player, 0, true),
    },
    {
      description: "Allez en prison directement, sans passer par la case Départ.",
      effect: (engine, player) => engine.sendToJail(player),
    },
    {
      description: "Carte 'Sortie de prison gratuite' — conservée jusqu'à utilisation.",
      effect: (engine, player) => { player.jailFreeCards += 1; },
    },
    {
      description: "Vous recevez des dividendes de vos investissements (+50).",
      effect: (engine, player) => engine.pay(null, player, 50),
    },
    {
      description: "Frais de scolarité à payer (-50).",
      effect: (engine, player) => engine.pay(player, null, 50),
    },
    {
      description: "Vous héritez d'une petite somme (+100).",
      effect: (engine, player) => engine.pay(null, player, 100),
    },
  ];

  return { BOARD, CHANCE_CARDS };
});
