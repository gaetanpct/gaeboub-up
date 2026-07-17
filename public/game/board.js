// ============================================================
// REACH UP — Données du plateau
// Phase 2 : les règles (prix, loyers, groupes)
// Phase 4 : ajout du champ "short" (nom court affiché sur le plateau visuel)
//
// Ce fichier ne contient AUCUNE logique, seulement les données.
// Il fonctionne à la fois dans le navigateur (via <script>) et dans
// le serveur Node (via require()) grâce à ce petit bloc "UMD".
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
    { type: "go", name: "Départ", short: "DÉPART" },
    { type: "property", name: "Rue des Lilas", short: "Lilas", group: "marron", price: 60, rent: 2, owner: null },
    { type: "chance", name: "Carte Destin", short: "Destin" },
    { type: "property", name: "Rue des Tilleuls", short: "Tilleuls", group: "marron", price: 60, rent: 4, owner: null },
    { type: "tax", name: "Impôts", short: "Impôts", amount: 200 },
    { type: "airport", name: "Aéroport Nord", short: "Aéroport N", price: 200, owner: null },
    { type: "property", name: "Rue de la Gare", short: "Gare", group: "cyan", price: 100, rent: 6, owner: null },
    { type: "chance", name: "Carte Destin", short: "Destin" },
    { type: "property", name: "Rue du Port", short: "Port", group: "cyan", price: 100, rent: 6, owner: null },
    { type: "property", name: "Rue des Docks", short: "Docks", group: "cyan", price: 120, rent: 8, owner: null },
    { type: "jail", name: "Prison / Simple visite", short: "Prison" },
    { type: "property", name: "Avenue des Roses", short: "Roses", group: "magenta", price: 140, rent: 10, owner: null },
    { type: "utility", name: "Compagnie des Eaux", short: "Eaux", price: 150, owner: null },
    { type: "property", name: "Avenue des Tulipes", short: "Tulipes", group: "magenta", price: 140, rent: 10, owner: null },
    { type: "property", name: "Avenue des Orchidées", short: "Orchidées", group: "magenta", price: 160, rent: 12, owner: null },
    { type: "airport", name: "Aéroport Est", short: "Aéroport E", price: 200, owner: null },
    { type: "property", name: "Boulevard du Commerce", short: "Commerce", group: "orange", price: 180, rent: 14, owner: null },
    { type: "chance", name: "Carte Destin", short: "Destin" },
    { type: "property", name: "Boulevard des Arts", short: "Arts", group: "orange", price: 180, rent: 14, owner: null },
    { type: "property", name: "Boulevard de la Paix", short: "Paix", group: "orange", price: 200, rent: 16, owner: null },
    { type: "vacation", name: "Vacances", short: "Vacances" },
    { type: "property", name: "Rue Victor Hugo", short: "V. Hugo", group: "rouge", price: 220, rent: 18, owner: null },
    { type: "chance", name: "Carte Destin", short: "Destin" },
    { type: "property", name: "Rue Voltaire", short: "Voltaire", group: "rouge", price: 220, rent: 18, owner: null },
    { type: "property", name: "Rue Molière", short: "Molière", group: "rouge", price: 240, rent: 20, owner: null },
    { type: "airport", name: "Aéroport Sud", short: "Aéroport S", price: 200, owner: null },
    { type: "property", name: "Avenue du Parc", short: "du Parc", group: "jaune", price: 260, rent: 22, owner: null },
    { type: "property", name: "Avenue des Sports", short: "Sports", group: "jaune", price: 260, rent: 22, owner: null },
    { type: "utility", name: "Compagnie d'Électricité", short: "Électricité", price: 150, owner: null },
    { type: "property", name: "Avenue Centrale", short: "Centrale", group: "jaune", price: 280, rent: 24, owner: null },
    { type: "go-to-jail", name: "Aller en prison", short: "→ Prison" },
    { type: "property", name: "Boulevard Saint-Michel", short: "St-Michel", group: "vert", price: 300, rent: 26, owner: null },
    { type: "property", name: "Boulevard Saint-Germain", short: "St-Germain", group: "vert", price: 300, rent: 26, owner: null },
    { type: "chance", name: "Carte Destin", short: "Destin" },
    { type: "property", name: "Boulevard Haussmann", short: "Haussmann", group: "vert", price: 320, rent: 28, owner: null },
    { type: "airport", name: "Aéroport Ouest", short: "Aéroport O", price: 200, owner: null },
    { type: "chance", name: "Carte Destin", short: "Destin" },
    { type: "property", name: "Avenue des Champs", short: "Champs", group: "bleu", price: 350, rent: 35, owner: null },
    { type: "tax", name: "Taxe de luxe", short: "Taxe", amount: 100 },
    { type: "property", name: "Avenue Royale", short: "Royale", group: "bleu", price: 400, rent: 50, owner: null },
  ];

  // Petit paquet de cartes "Destin" — tiré au hasard avec remise.
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
