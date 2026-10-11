// ============================================================
// REACH UP — Familles de cases à acheter (autres que les rues)
//
// Ces cases s'ajoutent aux aéroports et aux compagnies d'origine. Ce sont
// des cases achetables (donc sans maisons ni groupe de couleur) mais
// dont l'intérêt ne vient PAS d'un loyer de visite comme un aéroport.
// Ce sont des options sympas, jamais une stratégie à elles seules.
//
//  - Université  : petit loyer + prime à chaque construction de maison.
//  - Péage       : quiconque PASSE devant (pas seulement s'y arrête) paie
//                  un petit péage au propriétaire. 2 au maximum, toujours
//                  aux deux extrémités du plateau.
//  - Banque centrale : le propriétaire touche 15 % des salaires des
//                  autres joueurs. 1 seule par plateau.
//  - Régie publicitaire : +10 % sur tous tes loyers (+20 % avec la
//                  seconde). 2 au maximum.
//  - Jardin public : le propriétaire prélève 10 % des loyers touchés sur
//                  les deux cases rentables les plus proches de lui.
//
// Un seul fichier pour que le moteur, l'IA, les contrats et l'interface
// donnent toujours les mêmes chiffres.
// ============================================================

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.ReachUpFamilies = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const TOLL_SHARE_OF_BOARD_VALUE = 0.003; // fraction de la valeur du plateau
  const TOLL_MIN = 10;
  const TOLL_CAP_SHARE_OF_SALARY = 0.15; // le péage ne dépasse jamais 15 % d'un salaire
  const BANK_SALARY_SHARE = 0.15;
  const AD_BONUS = [0, 0.1, 0.2];
  const GARDEN_SHARE = 0.1;

  const FAMILIES = {
    airport: { id: "airport", base: "airport", label: "Aéroport", plural: "aéroports", icon: "✈️", price: 200, table: [25, 50, 100, 200, 300, 450] },
    utility: { id: "utility", base: "utility", label: "Compagnie", plural: "compagnies", icon: "⚡", price: 150, table: null },
    university: {
      id: "university", base: "utility", label: "Université", plural: "universités", icon: "🎓", price: 160, setting: "boardUniversities", max: 3,
      table: [14, 30, 60, 110, 170], builderBonus: 20,
      names: ["Université Centrale", "Grande École", "Faculté des Arts", "Institut Supérieur"],
      shorts: ["Univ.", "Grande École", "Faculté", "Institut"],
      title: "🎓 Universités",
      info: "Des universités à 160 au loyer modeste (14 à 170 selon le nombre possédé), mais dont le propriétaire reçoit en plus 20 de la banque CHAQUE FOIS qu'un joueur, lui compris, construit une maison ou un hôtel. Plus la partie avance et plus on construit, plus elles rapportent.",
    },
    toll: {
      id: "toll", base: "utility", label: "Péage", plural: "péages", icon: "🛣️", price: 160, setting: "boardTolls", max: 2, rentless: true,
      names: ["Péage du Nord", "Péage du Sud"],
      shorts: ["Péage N", "Péage S"],
      title: "🛣️ Péages",
      info: "Deux péages au maximum, placés aux deux extrémités du plateau. Tout joueur qui PASSE devant (ou s'arrête dessus) paie un petit péage à leur propriétaire. Le montant évolue pendant la partie, proportionnel à la valeur de ce qui est acheté et construit sur le plateau, mais il ne dépasse jamais 15 % d'un salaire. Un petit revenu régulier, jamais une stratégie à lui seul.",
    },
    centralbank: {
      id: "centralbank", base: "utility", label: "Banque centrale", plural: "banques centrales", icon: "🏛️", price: 300, setting: "boardCentralBank", max: 1, rentless: true,
      names: ["Banque Centrale"],
      shorts: ["Banque C."],
      title: "🏛️ Banque centrale",
      info: "Une seule par plateau, à 300. Son propriétaire touche 15 % de chaque salaire que les autres joueurs perçoivent en passant par Départ (prélevés sur leur salaire). Elle rapporte de plus en plus au fil de la partie, mais reste un bonus modéré.",
    },
    adagency: {
      id: "adagency", base: "utility", label: "Régie publicitaire", plural: "régies publicitaires", icon: "📺", price: 220, setting: "boardAdAgencies", max: 2, rentless: true,
      names: ["Régie Publicitaire", "Grande Régie"],
      shorts: ["Régie", "Grande Régie"],
      title: "📺 Régies publicitaires",
      info: "Deux au maximum, à 220. Elle ne rapporte aucun loyer en elle-même, mais augmente de 10 % TOUS les loyers que tu touches. Avec la seconde régie, le bonus monte directement à 20 %. Une vraie synergie, très forte avec les deux.",
    },
    garden: {
      id: "garden", base: "utility", label: "Jardin public", plural: "jardins publics", icon: "🌳", price: 180, setting: "boardGardens", max: 3, rentless: true,
      names: ["Jardin des Plantes", "Jardin Public", "Parc Municipal"],
      shorts: ["Jardin P.", "Jardin", "Parc M."],
      title: "🌳 Jardins publics",
      info: "À 180, un jardin ne rapporte rien en lui-même. En revanche son propriétaire prélève 10 % des loyers touchés par les propriétaires des deux cases rentables les plus proches, une à gauche et une à droite (propriétés, aéroports, compagnies, universités). Les cartes Destin, taxes, cases mystère et coins sont ignorés, on regarde simplement la case rentable suivante. L'emplacement fait toute la différence.",
    },
  };

  const EXTRA_FAMILY_IDS = ["university", "toll", "centralbank", "adagency", "garden"];

  function familyOf(tile) {
    return (tile && (tile.family || tile.type)) || null;
  }

  function isOwnableType(type) {
    return type === "property" || type === "airport" || type === "utility";
  }

  function ownedCount(board, tile) {
    const fam = familyOf(tile);
    return board.filter((t) => familyOf(t) === fam && t.owner === tile.owner && !t.mortgaged).length;
  }

  // Loyer de visite d'une case de famille. 0 pour les cases « sans loyer ».
  function familyRent(board, tile, ctx) {
    const fam = FAMILIES[familyOf(tile)];
    if (!fam || tile.owner === null || tile.owner === undefined) return null;
    if (fam.id === "utility") return null;
    if (fam.rentless) return 0;
    const count = Math.max(1, ownedCount(board, tile));
    let rent = fam.table[Math.min(count, fam.table.length) - 1];
    if (fam.id === "stadium" && ctx && ctx.eventActive) rent *= 2;
    return rent;
  }

  function familyRentEstimate(board, tile) {
    const fam = FAMILIES[familyOf(tile)];
    if (fam && fam.rentless) {
      // revenu moyen indicatif par tour d'adversaire, pour l'IA
      return { toll: 15, centralbank: 20, adagency: 10, garden: 12 }[fam.id] || 0;
    }
    return familyRent(board, tile, {});
  }

  // Une case « rentable » pour le jardin : elle touche un loyer quand on s'y arrête.
  function isEarningTile(tile) {
    if (!tile) return false;
    if (tile.type === "property" || tile.type === "airport") return true;
    if (tile.type === "utility") {
      const fam = FAMILIES[familyOf(tile)];
      return !fam || !fam.rentless;
    }
    return false;
  }

  // Indices des deux cases rentables les plus proches d'un jardin (gauche et droite).
  function gardenNeighbours(board, gardenIndex) {
    const n = board.length;
    const result = [];
    [-1, 1].forEach((dir) => {
      for (let step = 1; step < n; step++) {
        const idx = (gardenIndex + dir * step + n * 2) % n;
        if (idx === gardenIndex) break;
        if (isEarningTile(board[idx])) {
          if (!result.includes(idx)) result.push(idx);
          break;
        }
      }
    });
    return result;
  }

  // Valeur courante du plateau : prix des cases achetées + maisons construites.
  function boardValue(board, houseCostOf) {
    return board.reduce((sum, t) => {
      if (t.owner === null || t.owner === undefined || !isOwnableType(t.type)) return sum;
      return sum + (t.price || 0) + (t.type === "property" ? (t.houses || 0) * (houseCostOf(t) || 0) : 0);
    }, 0);
  }

  // Péage actuel : proportionnel à la valeur du plateau, avec un plancher et un plafond.
  function tollAmount(value, salary) {
    const cap = Math.max(TOLL_MIN, Math.round((salary * TOLL_CAP_SHARE_OF_SALARY) / 5) * 5);
    return Math.max(TOLL_MIN, Math.min(cap, Math.round((value * TOLL_SHARE_OF_BOARD_VALUE) / 5) * 5));
  }

  function adBonus(count) {
    return AD_BONUS[Math.min(count, AD_BONUS.length - 1)];
  }

  function publicDefs() {
    const out = {};
    Object.values(FAMILIES).forEach((f) => {
      out[f.id] = { id: f.id, base: f.base, label: f.label, plural: f.plural, icon: f.icon, price: f.price, table: f.table || null, builderBonus: f.builderBonus || 0, rentless: !!f.rentless };
    });
    return out;
  }

  return {
    FAMILIES, EXTRA_FAMILY_IDS, familyOf, ownedCount, familyRent, familyRentEstimate, publicDefs, isOwnableType,
    isEarningTile, gardenNeighbours, boardValue, tollAmount, adBonus,
    BANK_SALARY_SHARE, GARDEN_SHARE,
  };
});
