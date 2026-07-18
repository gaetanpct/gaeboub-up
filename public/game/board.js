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
  //
  // Phase 6 : les propriétés/aéroports/compagnies ont maintenant deux
  // nouveaux champs :
  //   - houses : 0 à 4 maisons, 5 = hôtel (uniquement pour "property")
  //   - mortgaged : hypothéquée ou non (property/airport/utility)
  const BOARD = [
    { type: "go", name: "Départ", short: "DÉPART" },
    { type: "property", name: "Rue des Lilas", short: "Lilas", group: "marron", price: 60, rent: 2, owner: null, houses: 0, mortgaged: false },
    { type: "chance", name: "Carte Destin", short: "Destin" },
    { type: "property", name: "Rue des Tilleuls", short: "Tilleuls", group: "marron", price: 60, rent: 4, owner: null, houses: 0, mortgaged: false },
    { type: "tax", name: "Impôts", short: "Impôts", amount: 200 },
    { type: "airport", name: "Aéroport Nord", short: "Aéroport N", price: 200, owner: null, mortgaged: false },
    { type: "property", name: "Rue de la Gare", short: "Gare", group: "cyan", price: 100, rent: 6, owner: null, houses: 0, mortgaged: false },
    { type: "chance", name: "Carte Destin", short: "Destin" },
    { type: "property", name: "Rue du Port", short: "Port", group: "cyan", price: 100, rent: 6, owner: null, houses: 0, mortgaged: false },
    { type: "property", name: "Rue des Docks", short: "Docks", group: "cyan", price: 120, rent: 8, owner: null, houses: 0, mortgaged: false },
    { type: "jail", name: "Prison / Simple visite", short: "Prison" },
    { type: "property", name: "Avenue des Roses", short: "Roses", group: "magenta", price: 140, rent: 10, owner: null, houses: 0, mortgaged: false },
    { type: "utility", name: "Compagnie des Eaux", short: "Eaux", price: 150, owner: null, mortgaged: false },
    { type: "property", name: "Avenue des Tulipes", short: "Tulipes", group: "magenta", price: 140, rent: 10, owner: null, houses: 0, mortgaged: false },
    { type: "property", name: "Avenue des Orchidées", short: "Orchidées", group: "magenta", price: 160, rent: 12, owner: null, houses: 0, mortgaged: false },
    { type: "airport", name: "Aéroport Est", short: "Aéroport E", price: 200, owner: null, mortgaged: false },
    { type: "property", name: "Boulevard du Commerce", short: "Commerce", group: "orange", price: 180, rent: 14, owner: null, houses: 0, mortgaged: false },
    { type: "chance", name: "Carte Destin", short: "Destin" },
    { type: "property", name: "Boulevard des Arts", short: "Arts", group: "orange", price: 180, rent: 14, owner: null, houses: 0, mortgaged: false },
    { type: "property", name: "Boulevard de la Paix", short: "Paix", group: "orange", price: 200, rent: 16, owner: null, houses: 0, mortgaged: false },
    { type: "vacation", name: "Vacances", short: "Vacances" },
    { type: "property", name: "Rue Victor Hugo", short: "V. Hugo", group: "rouge", price: 220, rent: 18, owner: null, houses: 0, mortgaged: false },
    { type: "chance", name: "Carte Destin", short: "Destin" },
    { type: "property", name: "Rue Voltaire", short: "Voltaire", group: "rouge", price: 220, rent: 18, owner: null, houses: 0, mortgaged: false },
    { type: "property", name: "Rue Molière", short: "Molière", group: "rouge", price: 240, rent: 20, owner: null, houses: 0, mortgaged: false },
    { type: "airport", name: "Aéroport Sud", short: "Aéroport S", price: 200, owner: null, mortgaged: false },
    { type: "property", name: "Avenue du Parc", short: "du Parc", group: "jaune", price: 260, rent: 22, owner: null, houses: 0, mortgaged: false },
    { type: "property", name: "Avenue des Sports", short: "Sports", group: "jaune", price: 260, rent: 22, owner: null, houses: 0, mortgaged: false },
    { type: "utility", name: "Compagnie d'Électricité", short: "Électricité", price: 150, owner: null, mortgaged: false },
    { type: "property", name: "Avenue Centrale", short: "Centrale", group: "jaune", price: 280, rent: 24, owner: null, houses: 0, mortgaged: false },
    { type: "go-to-jail", name: "Aller en prison", short: "→ Prison" },
    { type: "property", name: "Boulevard Saint-Michel", short: "St-Michel", group: "vert", price: 300, rent: 26, owner: null, houses: 0, mortgaged: false },
    { type: "property", name: "Boulevard Saint-Germain", short: "St-Germain", group: "vert", price: 300, rent: 26, owner: null, houses: 0, mortgaged: false },
    { type: "chance", name: "Carte Destin", short: "Destin" },
    { type: "property", name: "Boulevard Haussmann", short: "Haussmann", group: "vert", price: 320, rent: 28, owner: null, houses: 0, mortgaged: false },
    { type: "airport", name: "Aéroport Ouest", short: "Aéroport O", price: 200, owner: null, mortgaged: false },
    { type: "chance", name: "Carte Destin", short: "Destin" },
    { type: "property", name: "Avenue des Champs", short: "Champs", group: "bleu", price: 350, rent: 35, owner: null, houses: 0, mortgaged: false },
    { type: "tax", name: "Taxe de luxe", short: "Taxe", amount: 100 },
    { type: "property", name: "Avenue Royale", short: "Royale", group: "bleu", price: 400, rent: 50, owner: null, houses: 0, mortgaged: false },
  ];

  // Coût d'une maison (ou d'un étage supplémentaire) par groupe de couleur.
  // Même coût pour construire une maison ou passer de 4 maisons à l'hôtel.
  const HOUSE_COST_BY_GROUP = {
    marron: 50,
    cyan: 50,
    magenta: 100,
    orange: 100,
    rouge: 150,
    jaune: 150,
    vert: 200,
    bleu: 200,
    violet: 225,
    rose: 225,
    gris: 250,
  };

  // Multiplicateur de loyer selon le nombre de maisons (index = tile.houses).
  // Index 5 = hôtel.
  const RENT_MULTIPLIERS_BY_HOUSES = [1, 5, 15, 30, 40, 50];

  // Paquet de cartes "Destin" — tiré au hasard avec remise. Un mélange de
  // gains/pertes d'argent, d'effets de groupe (tout le monde paie/reçoit),
  // et de déplacements — comme un vrai jeu de plateau économique.
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
    {
      description: "C'est votre anniversaire : chaque joueur vous offre 20.",
      effect: (engine, player) => {
        engine.activePlayers().forEach((other) => {
          if (other.id === player.id) return;
          engine.pay(other, player, 20);
        });
      },
    },
    {
      description: "Vous organisez une fête : versez 15 à chaque joueur.",
      effect: (engine, player) => {
        engine.activePlayers().forEach((other) => {
          if (other.id === player.id) return;
          engine.pay(player, other, 15);
        });
      },
    },
    {
      description: "Réparations générales : payez 25 par maison et 100 par hôtel que vous possédez.",
      effect: (engine, player) => {
        const cost = engine.board
          .filter((t) => t.owner === player.id && t.type === "property" && t.houses > 0)
          .reduce((sum, t) => sum + (t.houses === 5 ? 100 : t.houses * 25), 0);
        if (cost > 0) engine.pay(player, null, cost);
      },
    },
    {
      description: "Un distributeur vous rend trop de monnaie par erreur (+120).",
      effect: (engine, player) => engine.pay(null, player, 120),
    },
    {
      description: "Amende pour excès de vitesse (-40).",
      effect: (engine, player) => engine.pay(player, null, 40),
    },
    {
      description: "Vous retrouvez un billet oublié dans une veste (+30).",
      effect: (engine, player) => engine.pay(null, player, 30),
    },
    {
      description: "Frais de notaire imprévus (-60).",
      effect: (engine, player) => engine.pay(player, null, 60),
    },
    {
      description: "Bonus de fidélité de la banque (+80).",
      effect: (engine, player) => engine.pay(null, player, 80),
    },
    {
      description: "Contrôle fiscal (-90).",
      effect: (engine, player) => engine.pay(player, null, 90),
    },
    {
      description: "Avancez de 3 cases.",
      effect: (engine, player) => {
        const newIndex = (player.position + 3) % engine.board.length;
        engine._landOnTile(player, newIndex);
      },
    },
    {
      description: "Reculez de 2 cases.",
      effect: (engine, player) => {
        const newIndex = (player.position - 2 + engine.board.length) % engine.board.length;
        engine._landOnTile(player, newIndex);
      },
    },
    {
      description: "Grève générale des transports : reculez de 5 cases.",
      effect: (engine, player) => {
        const newIndex = (player.position - 5 + engine.board.length) % engine.board.length;
        engine._landOnTile(player, newIndex);
      },
    },
    {
      description: "Foncez vers l'aéroport le plus proche.",
      effect: (engine, player) => {
        const newIndex = engine._findNearestTileOfType(player.position, "airport");
        engine._landOnTile(player, newIndex);
      },
    },
    {
      description: "Direction la compagnie la plus proche.",
      effect: (engine, player) => {
        const newIndex = engine._findNearestTileOfType(player.position, "utility");
        engine._landOnTile(player, newIndex);
      },
    },
  ];

  return { BOARD, CHANCE_CARDS, HOUSE_COST_BY_GROUP, RENT_MULTIPLIERS_BY_HOUSES };
});
