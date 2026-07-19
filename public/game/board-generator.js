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
    marron: ["Rue Zaza", "Rue Grand Méchant Loup Ahouuu", "Rue Brrbrrrpatapim", "Rue Pupuce"],
    cyan: ["Rue 67", "Rue Latina Chargée", "Rue Barmitsva", "Rue du Quai"],
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
    "Rue Zaza": "Zaza", "Rue Grand Méchant Loup Ahouuu": "Ahouuu !", "Rue Brrbrrrpatapim": "Patapim", "Rue Pupuce": "Pupuce",
    "Rue 67": "Rue 67", "Rue Latina Chargée": "Latina Chargée", "Rue Barmitsva": "Barmitsva", "Rue du Quai": "Quai",
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

    const last = totalTiles / 4;
    const sideCapacity = last - 1;

    function roundRobinToSides(items) {
      const buckets = [[], [], [], []];
      const startOffset = randomInt(4);
      shuffle(items).forEach((item, i) => {
        buckets[(startOffset + i) % 4].push(item);
      });
      return buckets;
    }

    // 2) Construit les cases isolées (Destin, spéciales, taxes, gares,
    //    compagnies) et les répartit en TOURNIQUET sur les 4 côtés — 1 pour
    //    le côté 0, 1 pour le côté 1, 1 pour le côté 2, 1 pour le côté 3,
    //    on recommence, avec un point de départ mélangé à chaque TYPE de
    //    case. C'est ce qui garantit qu'il y a des gares/cartes Destin/etc.
    //    de CHAQUE côté, jamais tous entassés au même endroit — et comme
    //    c'est fait AVANT de décider la taille des groupes de propriétés,
    //    on peut ensuite plafonner correctement ces tailles pour qu'elles
    //    tiennent vraiment dans la place qu'il reste sur chaque côté.
    const fillerBucketsBySide = [[], [], [], []];
    const fillerBlocksByType = {
      chance: Array.from({ length: effective.numChanceCards }, () => [{ type: "chance", name: "Carte Destin", short: "Destin" }]),
      special: Array.from({ length: effective.numSpecialCards }, () => [{ type: "special", name: "Carte Spéciale", short: "Spécial" }]),
      tax: Array.from({ length: effective.numTaxes }, (_, i) => [
        { type: "tax", name: i === 0 ? "Impôts" : `Taxe ${i + 1}`, short: i === 0 ? "Impôts" : "Taxe", amount: i === 0 ? 200 : 100 + i * 50 },
      ]),
      airport: Array.from({ length: effective.numAirports }, (_, i) => {
        const label = i < 4 ? COMPASS[i] : `${i + 1}`;
        return [{ type: "airport", name: `Aéroport ${label}`, short: `Aéroport ${label.charAt(0)}`, price: 200, owner: null, mortgaged: false }];
      }),
      utility: Array.from({ length: effective.numUtilities }, (_, i) => {
        const utilityNames = ["Compagnie des Eaux", "Compagnie d'Électricité"];
        const name = utilityNames[i] || `Compagnie ${i + 1}`;
        return [{ type: "utility", name, short: i < 2 ? (i === 0 ? "Eaux" : "Électricité") : `Cie ${i + 1}`, price: 150, owner: null, mortgaged: false }];
      }),
    };
    Object.values(fillerBlocksByType).forEach((typeBlocks) => {
      roundRobinToSides(typeBlocks).forEach((bucket, s) => fillerBucketsBySide[s].push(...bucket));
    });

    // Capacité RÉELLE restant pour des propriétés sur chaque côté, une
    // fois les cases isolées ci-dessus déjà réservées.
    const propertyCapacityPerSide = fillerBucketsBySide.map((bucket) => sideCapacity - bucket.length);

    // 3) Décide COMBIEN de groupes vont sur chaque côté, proportionnellement
    //    à la capacité RÉELLE de ce côté (cases isolées déjà retirées),
    //    PUIS dimensionne les groupes de CHAQUE côté pour remplir
    //    EXACTEMENT cette capacité (taille 1 à 4 chacun). Cette approche
    //    "structure d'abord, tailles ensuite" garantit un empilement
    //    parfait par construction — jamais besoin de couper un groupe —
    //    plutôt que de tailler les groupes au hasard et espérer qu'ils
    //    rentrent (ce qui échouait souvent dès que les côtés n'avaient
    //    plus une capacité uniforme, à cause des cases isolées réparties
    //    en tourniquet ci-dessus).
    const avgGroupSize = propertyBudget / numGroups;
    const rawShares = propertyCapacityPerSide.map((cap) => cap / avgGroupSize);
    const groupsPerSide = rawShares.map((r) => Math.max(0, Math.floor(r)));
    const assignedGroups = groupsPerSide.reduce((a, b) => a + b, 0);
    const leftoverGroupCount = numGroups - assignedGroups;
    if (leftoverGroupCount > 0) {
      const fractions = rawShares
        .map((r, s) => ({ s, frac: r - Math.floor(r) }))
        .sort((a, b) => b.frac - a.frac);
      for (let i = 0; i < leftoverGroupCount; i++) {
        groupsPerSide[fractions[i % 4].s] += 1;
      }
    }
    // Remarque : si numGroups < 4, au moins un côté aura FORCÉMENT 0
    // groupe (on ne peut pas répartir 3 groupes sur 4 côtés en en mettant
    // au moins 1 partout) — ce n'est pas une erreur, la capacité propriété
    // de ce côté est alors simplement absorbée en cartes Destin ci-dessous.

    // Dimensionne les groupes DE CHAQUE côté pour remplir EXACTEMENT sa
    // capacité — jamais de reste, jamais de dépassement.
    const groupSizesPerSide = groupsPerSide.map((count, s) => {
      if (count === 0) {
        // Aucun groupe assigné à ce côté : toute sa capacité propriété
        // part en cartes Destin plutôt que de rester non comptabilisée.
        for (let i = 0; i < propertyCapacityPerSide[s]; i++) {
          fillerBucketsBySide[s].push([{ type: "chance", name: "Carte Destin", short: "Destin" }]);
        }
        return [];
      }
      const sizes = new Array(count).fill(1);
      let remaining = propertyCapacityPerSide[s] - count;
      let safety = 0;
      while (remaining > 0 && safety < 10000 && !sizes.every((sz) => sz >= 4)) {
        const g = randomInt(count);
        if (sizes[g] < 4) {
          sizes[g] += 1;
          remaining -= 1;
        }
        safety += 1;
      }
      // Filet de sécurité extrême (ne devrait quasiment jamais arriver) :
      // si tous les groupes de ce côté sont déjà à la taille maximale et
      // qu'il reste du budget, le surplus part en carte(s) Destin sur ce
      // même côté plutôt que de rester bloqué.
      if (remaining > 0) {
        for (let i = 0; i < remaining; i++) {
          fillerBucketsBySide[s].push([{ type: "chance", name: "Carte Destin", short: "Destin" }]);
        }
      }
      return sizes;
    });

    // 4) Construit les blocs-groupes (propriétés, restent contiguës), en
    //    attribuant les paliers de prix dans l'ordre des côtés (0 → 3) et,
    //    à l'intérieur d'un côté, dans l'ordre où les groupes y ont été
    //    placés — ce qui donne une progression de prix croissante du
    //    Départ jusqu'à la fin du plateau, comme dans le vrai Monopoly.
    const groupBlocksBySide = [[], [], [], []];
    let tierIndex = 0;
    for (let s = 0; s < 4; s++) {
      groupSizesPerSide[s].forEach((size) => {
        const tier = GROUP_TIERS[tierIndex];
        tierIndex += 1;
        const tiles = [];
        for (let i = 0; i < size; i++) {
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
        groupBlocksBySide[s].push(tiles);
      });
    }

    // 5) Chaque côté a déjà ses groupes exactement dimensionnés pour sa
    //    capacité réelle (étape 3) : on les place donc directement, sans
    //    empilement "au mieux" ni filet de sécurité — par construction,
    //    ça tient toujours exactement.
    const sideChunks = groupBlocksBySide;

    // Comble chaque côté avec ses cases isolées (déjà réparties en
    // tourniquet ci-dessus), dispersées dans les « espaces » entre les
    // groupes (avant le premier, entre chaque paire, après le dernier) —
    // jamais À L'INTÉRIEUR d'un groupe, et sans jamais changer l'ordre
    // relatif de deux groupes qui partagent le même côté.
    for (let s = 0; s < 4; s++) {
      const groupChunksOfSide = sideChunks[s];
      const numGaps = groupChunksOfSide.length + 1;
      const gaps = Array.from({ length: numGaps }, () => []);
      shuffle(fillerBucketsBySide[s]).forEach((single) => {
        gaps[randomInt(numGaps)].push(...single);
      });
      const withFillers = [];
      groupChunksOfSide.forEach((chunk, i) => {
        withFillers.push(...gaps[i]);
        withFillers.push(chunk);
      });
      withFillers.push(...gaps[numGaps - 1]);
      sideChunks[s] = withFillers;
    }

    // Chaque côté est maintenant prêt : groupes dans l'ordre croissant de
    // prix, cases isolées réparties sur les 4 côtés et dispersées entre
    // les groupes sans jamais les déplacer.
    const sides = sideChunks.map((chunks) => chunks.flat());

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
