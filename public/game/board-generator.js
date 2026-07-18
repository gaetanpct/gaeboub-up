// ============================================================
// REACH UP — Générateur de plateau procédural
// Phase 8b : plateau aléatoire, prévisualisable avant la partie.
//
// PRINCIPE : ce générateur produit un tableau de cases structurellement
// identique à celui de board.js (mêmes champs : type, name, short,
// group, price, rent, owner, houses, mortgaged...), pour que le moteur
// et l'interface n'aient JAMAIS besoin de savoir si le plateau est fixe
// ou généré — ils manipulent juste "un tableau de 40+ cases".
//
// Pour rester compatible avec le plateau carré affiché à l'écran, le
// nombre total de cases doit être un multiple de 4 (4 coins + un nombre
// égal de cases sur chacun des 4 côtés).
//
// Simplification assumée : les groupes utilisent toujours un préfixe
// des 8 couleurs déjà définies dans board.js (marron → bleu), pour
// réutiliser telles quelles les tables de coût de construction
// existantes plutôt que d'en inventer de nouvelles.
// ============================================================

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.ReachUpBoardGenerator = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {

  // Ordre des couleurs du moins cher au plus cher (identique à board.js).
  // Chaque groupe généré utilise un prix/loyer représentatif de son rang —
  // une simplification volontaire : dans le plateau fixe, deux propriétés
  // du même groupe ont parfois un loyer légèrement différent, ici toutes
  // les cases d'un groupe généré partagent le même prix/loyer.
  const GROUP_TIERS = [
    { group: "marron", price: 60, rent: 3 },
    { group: "cyan", price: 100, rent: 7 },
    { group: "magenta", price: 150, rent: 11 },
    { group: "orange", price: 190, rent: 15 },
    { group: "rouge", price: 230, rent: 19 },
    { group: "jaune", price: 270, rent: 23 },
    { group: "vert", price: 310, rent: 27 },
    { group: "bleu", price: 375, rent: 40 },
    { group: "violet", price: 410, rent: 45 },
    { group: "rose", price: 445, rent: 50 },
    { group: "gris", price: 480, rent: 55 },
  ];

  // Réserves de noms par groupe (on recycle les noms du plateau fixe).
  // Si un groupe généré a besoin de plus de noms que la réserve n'en a,
  // on ajoute un numéro pour rester unique sans planter.
  const NAME_POOLS = {
    marron: ["Rue des Lilas", "Rue des Tilleuls", "Rue des Peupliers", "Rue des Bouleaux"],
    cyan: ["Rue de la Gare", "Rue du Port", "Rue des Docks", "Rue du Quai"],
    magenta: ["Avenue des Roses", "Avenue des Tulipes", "Avenue des Orchidées", "Avenue des Jasmins"],
    orange: ["Boulevard du Commerce", "Boulevard des Arts", "Boulevard de la Paix", "Boulevard du Marché"],
    rouge: ["Rue Victor Hugo", "Rue Voltaire", "Rue Molière", "Rue Balzac"],
    jaune: ["Avenue du Parc", "Avenue des Sports", "Avenue Centrale", "Avenue Fleurie"],
    vert: ["Boulevard Saint-Michel", "Boulevard Saint-Germain", "Boulevard Haussmann", "Boulevard des Capucines"],
    bleu: ["Avenue des Champs", "Avenue Royale", "Avenue Impériale", "Avenue Prestige"],
    violet: ["Rue Améthyste", "Rue Lavande", "Rue Glycine", "Rue Iris"],
    rose: ["Avenue Magnolia", "Avenue Camélia", "Avenue Pivoine", "Avenue Fuchsia"],
    gris: ["Boulevard Argenté", "Boulevard Platine", "Boulevard Perle", "Boulevard Opale"],
  };

  const SHORT_NAME_OVERRIDES = {
    "Rue des Lilas": "Lilas", "Rue des Tilleuls": "Tilleuls", "Rue des Peupliers": "Peupliers", "Rue des Bouleaux": "Bouleaux",
    "Rue de la Gare": "Gare", "Rue du Port": "Port", "Rue des Docks": "Docks", "Rue du Quai": "Quai",
    "Avenue des Roses": "Roses", "Avenue des Tulipes": "Tulipes", "Avenue des Orchidées": "Orchidées", "Avenue des Jasmins": "Jasmins",
    "Boulevard du Commerce": "Commerce", "Boulevard des Arts": "Arts", "Boulevard de la Paix": "Paix", "Boulevard du Marché": "Marché",
    "Rue Victor Hugo": "V. Hugo", "Rue Voltaire": "Voltaire", "Rue Molière": "Molière", "Rue Balzac": "Balzac",
    "Avenue du Parc": "du Parc", "Avenue des Sports": "Sports", "Avenue Centrale": "Centrale", "Avenue Fleurie": "Fleurie",
    "Boulevard Saint-Michel": "St-Michel", "Boulevard Saint-Germain": "St-Germain", "Boulevard Haussmann": "Haussmann", "Boulevard des Capucines": "Capucines",
    "Avenue des Champs": "Champs", "Avenue Royale": "Royale", "Avenue Impériale": "Impériale", "Avenue Prestige": "Prestige",
    "Rue Améthyste": "Améthyste", "Rue Lavande": "Lavande", "Rue Glycine": "Glycine", "Rue Iris": "Iris",
    "Avenue Magnolia": "Magnolia", "Avenue Camélia": "Camélia", "Avenue Pivoine": "Pivoine", "Avenue Fuchsia": "Fuchsia",
    "Boulevard Argenté": "Argenté", "Boulevard Platine": "Platine", "Boulevard Perle": "Perle", "Boulevard Opale": "Opale",
  };

  const COMPASS = ["Nord", "Est", "Sud", "Ouest"];

  function randomInt(max) {
    return Math.floor(Math.random() * max);
  }

  function shuffle(array) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function nameForGroupTile(group, indexInGroup) {
    const pool = NAME_POOLS[group] || [];
    if (indexInGroup < pool.length) return pool[indexInGroup];
    const base = pool[indexInGroup % pool.length] || `Rue ${group}`;
    return `${base} ${indexInGroup + 1}`;
  }

  function shortForName(name) {
    return SHORT_NAME_OVERRIDES[name] || name.split(" ").slice(-1)[0];
  }

  /**
   * @param {object} params
   * @param {number} params.totalTiles - doit être un multiple de 4 (ex: 28, 32, 36, 40, 44)
   * @param {number} params.numGroups - 3 à 8 groupes de couleur
   * @param {number} params.numChanceCards
   * @param {number} params.numSpecialCards
   * @param {number} params.numTaxes
   * @param {number} params.numAirports
   * @param {number} params.numUtilities
   */
  function generateBoard(params) {
    const totalTiles = params.totalTiles && params.totalTiles % 4 === 0 ? params.totalTiles : 40;
    let numGroups = Math.max(3, Math.min(GROUP_TIERS.length, params.numGroups || 8));
    const numChanceCards = Math.max(0, params.numChanceCards ?? 6);
    const numSpecialCards = Math.max(0, params.numSpecialCards ?? 0);
    const numTaxes = Math.max(0, params.numTaxes ?? 2);
    const numAirports = Math.max(0, params.numAirports ?? 4);
    const numUtilities = Math.max(0, params.numUtilities ?? 2);

    const nonCornerSlots = totalTiles - 4;

    // 1) Budget de cases pour les propriétés = ce qu'il reste une fois les
    //    autres types de cases posés. On réduit automatiquement le nombre
    //    de cases "spéciales" demandées si la config ne laisse pas assez
    //    de place, plutôt que de produire un plateau invalide.
    let fillerCount = numChanceCards + numSpecialCards + numTaxes + numAirports + numUtilities;
    let effective;
    if (fillerCount > nonCornerSlots - numGroups) {
      const maxFiller = Math.max(0, nonCornerSlots - numGroups);
      const ratio = fillerCount > 0 ? maxFiller / fillerCount : 0;
      const scale = (n) => Math.floor(n * ratio);
      effective = {
        numChanceCards: scale(numChanceCards),
        numSpecialCards: scale(numSpecialCards),
        numTaxes: scale(numTaxes),
        numAirports: scale(numAirports),
        numUtilities: scale(numUtilities),
      };
    } else {
      effective = { numChanceCards, numSpecialCards, numTaxes, numAirports, numUtilities };
    }
    fillerCount = effective.numChanceCards + effective.numSpecialCards + effective.numTaxes + effective.numAirports + effective.numUtilities;

    let propertyBudget = nonCornerSlots - fillerCount;

    // GARDE-FOU IMPORTANT : si même avec les fillers réduits il n'y a pas
    // assez de place pour au moins 1 case par groupe demandé (typiquement
    // : beaucoup de groupes + petit plateau), on réduit le nombre de
    // groupes en conséquence plutôt que de produire un plateau incomplet
    // (des cases "undefined") — c'est exactement le cas que ce changement
    // (jusqu'à 11 groupes) pouvait déclencher sur un petit plateau.
    if (numGroups > propertyBudget) {
      numGroups = Math.max(1, propertyBudget);
    }

    // 2) Distribue le budget de propriétés entre les groupes (taille 1 à 4
    //    chacun). On commence à 1 partout, puis on distribue le reste au
    //    hasard, sans dépasser 4 par groupe. Le surplus éventuel (si tous
    //    les groupes sont déjà à 4) part en cartes Destin supplémentaires.
    const groupSizes = new Array(numGroups).fill(1);
    let remaining = propertyBudget - numGroups;
    let safety = 0;
    while (remaining > 0 && safety < 10000 && !groupSizes.every((s) => s >= 4)) {
      const g = randomInt(numGroups);
      if (groupSizes[g] < 4) {
        groupSizes[g] += 1;
        remaining -= 1;
      }
      safety += 1;
    }
    const leftoverChance = Math.max(0, remaining);

    // 3) Construit les "blocs" : un bloc par groupe (ses propriétés restent
    //    contiguës), et un bloc par case individuelle (chance/taxe/etc.).
    const blocks = [];
    for (let g = 0; g < numGroups; g++) {
      const tier = GROUP_TIERS[g];
      const tiles = [];
      for (let i = 0; i < groupSizes[g]; i++) {
        const name = nameForGroupTile(tier.group, i);
        tiles.push({
          type: "property",
          name,
          short: shortForName(name),
          group: tier.group,
          price: tier.price,
          rent: tier.rent,
          owner: null,
          houses: 0,
          mortgaged: false,
        });
      }
      blocks.push(tiles);
    }

    const totalChance = effective.numChanceCards + leftoverChance;
    for (let i = 0; i < totalChance; i++) {
      blocks.push([{ type: "chance", name: "Carte Destin", short: "Destin" }]);
    }
    for (let i = 0; i < effective.numSpecialCards; i++) {
      blocks.push([{ type: "special", name: "Carte Spéciale", short: "Spécial" }]);
    }
    for (let i = 0; i < effective.numTaxes; i++) {
      const amount = i === 0 ? 200 : 100 + i * 50;
      const name = i === 0 ? "Impôts" : `Taxe ${i + 1}`;
      blocks.push([{ type: "tax", name, short: i === 0 ? "Impôts" : "Taxe", amount }]);
    }
    for (let i = 0; i < effective.numAirports; i++) {
      const label = i < 4 ? COMPASS[i] : `${i + 1}`;
      blocks.push([{ type: "airport", name: `Aéroport ${label}`, short: `Aéroport ${label.charAt(0)}`, price: 200, owner: null, mortgaged: false }]);
    }
    const utilityNames = ["Compagnie des Eaux", "Compagnie d'Électricité"];
    for (let i = 0; i < effective.numUtilities; i++) {
      const name = utilityNames[i] || `Compagnie ${i + 1}`;
      blocks.push([{ type: "utility", name, short: i < 2 ? (i === 0 ? "Eaux" : "Électricité") : `Cie ${i + 1}`, price: 150, owner: null, mortgaged: false }]);
    }

    // 4) RÉPARTITION PAR CÔTÉ (correction importante) : on ne mélange plus
    //    tous les blocs à plat avant de couper en 4 — un groupe de
    //    plusieurs propriétés pourrait alors se retrouver coupé en deux,
    //    une partie sur un côté du plateau et l'autre sur le côté suivant.
    //    On répartit maintenant chaque bloc-groupe dans le côté qui a le
    //    plus de place restante (« best fit »), puis on comble le reste de
    //    chaque côté avec les cases isolées (Destin, taxes, gares...).
    const last = totalTiles / 4;
    const sideCapacity = last - 1;
    const sides = [[], [], [], []];
    const sideRemaining = [sideCapacity, sideCapacity, sideCapacity, sideCapacity];

    const groupBlocks = shuffle(blocks.filter((b) => b.length > 1));
    const singleBlocks = shuffle(blocks.filter((b) => b.length === 1));

    groupBlocks.forEach((block) => {
      let bestSide = -1;
      let bestRemaining = -1;
      for (let s = 0; s < 4; s++) {
        if (sideRemaining[s] >= block.length && sideRemaining[s] > bestRemaining) {
          bestSide = s;
          bestRemaining = sideRemaining[s];
        }
      }
      if (bestSide === -1) {
        // Filet de sécurité (ne devrait jamais arriver avec nos limites de
        // taille de groupe/plateau) : on éclate le bloc en cases isolées
        // plutôt que de perdre des cases ou de planter.
        block.forEach((tile) => singleBlocks.push([tile]));
        return;
      }
      sides[bestSide].push(...block);
      sideRemaining[bestSide] -= block.length;
    });

    // Comble chaque côté avec des cases isolées, mélangées.
    for (let s = 0; s < 4; s++) {
      while (sideRemaining[s] > 0) {
        const single = singleBlocks.pop();
        sides[s].push(...single);
        sideRemaining[s] -= 1;
      }
    }

    // 5) Place les coins fixes + chaque côté à son emplacement.
    const board = new Array(totalTiles);
    board[0] = { type: "go", name: "Départ", short: "DÉPART" };
    board[last] = { type: "jail", name: "Prison / Simple visite", short: "Prison" };
    board[2 * last] = { type: "vacation", name: "Vacances", short: "Vacances" };
    board[3 * last] = { type: "go-to-jail", name: "Aller en prison", short: "→ Prison" };

    let i;
    for (i = 1; i < last; i++) board[i] = sides[0][i - 1];
    for (i = last + 1; i < 2 * last; i++) board[i] = sides[1][i - last - 1];
    for (i = 2 * last + 1; i < 3 * last; i++) board[i] = sides[2][i - 2 * last - 1];
    for (i = 3 * last + 1; i < totalTiles; i++) board[i] = sides[3][i - 3 * last - 1];

    return board;
  }

  return { generateBoard, GROUP_TIERS };
});
