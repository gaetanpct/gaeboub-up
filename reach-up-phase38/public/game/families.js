// ============================================================
// REACH UP — Familles de cases à acheter (autres que les rues)
//
// Ces familles s'ajoutent aux aéroports et aux compagnies d'origine.
// Chacune est une case achetable (comme un aéroport ou une compagnie,
// donc sans maisons ni groupe de couleur) dont le loyer dépend du
// nombre de cases DE LA MÊME FAMILLE que possède le propriétaire.
//
// Chaque famille est un réglage optionnel de la partie : l'hôte choisit
// combien de cases de ce type posera le plateau aléatoire (0 = aucune).
//
// Le loyer est calculé ici, à un seul endroit, pour que le moteur,
// l'IA, les contrats et l'interface donnent toujours le même chiffre.
// ============================================================

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.ReachUpFamilies = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const FAMILIES = {
    airport: {
      id: "airport", base: "airport", label: "Aéroport", plural: "aéroports", icon: "✈️", price: 200,
      table: [25, 50, 100, 200, 300, 450],
    },
    utility: {
      id: "utility", base: "utility", label: "Compagnie", plural: "compagnies", icon: "⚡", price: 150,
      table: null, // loyer = dés x multiplicateur (règle d'origine)
    },
    port: {
      id: "port", base: "airport", label: "Port", plural: "ports", icon: "⚓", price: 180, setting: "boardPorts",
      table: [22, 50, 100, 190, 280],
      names: ["Port du Nord", "Port de l'Est", "Port du Sud", "Port de l'Ouest", "Port Royal", "Port Lointain"],
      shorts: ["Port N", "Port E", "Port S", "Port O", "Port R", "Port L"],
      title: "⚓ Ports",
      info: "Des ports à acheter, sur le modèle des aéroports mais un peu moins chers (180). Plus tu en possèdes, plus chacun rapporte (22, 50, 100, 190 puis 280 par visite). Un loyer régulier et sûr, qui récompense celui qui en collectionne plusieurs.",
    },
    metro: {
      id: "metro", base: "airport", label: "Métro", plural: "stations de métro", icon: "🚇", price: 120, setting: "boardMetros",
      table: [12, 28, 56, 110, 170],
      names: ["Métro Centre", "Métro Gare", "Métro Université", "Métro Marché", "Métro Port", "Métro Stade"],
      shorts: ["Métro C", "Métro G", "Métro U", "Métro M", "Métro P", "Métro S"],
      title: "🚇 Stations de métro",
      info: "Des stations pas chères (120) qui rapportent peu au début (12 par visite) mais montent vite si tu en réunis plusieurs (jusqu'à 170). Idéal pour se lancer avec peu d'argent, et souvent visitées car elles sont nombreuses.",
    },
    stadium: {
      id: "stadium", base: "utility", label: "Stade", plural: "stades", icon: "🏟️", price: 220, setting: "boardStadiums",
      table: [30, 70, 140, 260, 380],
      names: ["Stade Municipal", "Stade des Champions", "Grand Stade", "Stade Olympique", "Stade du Port", "Stade Nord"],
      shorts: ["Stade M", "Stade C", "Grand Stade", "Stade O", "Stade P", "Stade N"],
      title: "🏟️ Stades",
      info: "Des stades à 220 dont le loyer (30, 70, 140, 260 puis 380) est DOUBLÉ tant qu'un événement mondial est en cours. Un petit pari qui prend tout son sens si les événements mondiaux sont activés.",
    },
    park: {
      id: "park", base: "utility", label: "Parc d'attractions", plural: "parcs d'attractions", icon: "🎢", price: 200, setting: "boardParks",
      table: [28, 60, 120, 220, 320],
      names: ["Parc des Merveilles", "Parc Aventure", "Parc des Rêves", "Parc Géant", "Parc Étoilé", "Parc Magique"],
      shorts: ["Merveilles", "Aventure", "Rêves", "Géant", "Étoilé", "Magique"],
      title: "🎢 Parcs d'attractions",
      info: "Des parcs à 200 qui font payer un ticket à chaque visiteur (28, 60, 120, 220 puis 320 selon le nombre de parcs que tu possèdes). Un rendement simple et équilibré, entre les ports et les stades.",
    },
    university: {
      id: "university", base: "utility", label: "Université", plural: "universités", icon: "🎓", price: 160, setting: "boardUniversities",
      table: [14, 30, 60, 110, 170], builderBonus: 20,
      names: ["Université Centrale", "Grande École", "Faculté des Arts", "Institut Supérieur", "Académie Royale", "Campus Nord"],
      shorts: ["Univ.", "Grande École", "Faculté", "Institut", "Académie", "Campus"],
      title: "🎓 Universités",
      info: "Des universités à 160 au loyer modeste (14 à 170), mais dont le propriétaire reçoit en plus 20 de la banque CHAQUE FOIS qu'un joueur, lui compris, construit une maison ou un hôtel. Plus la partie avance et plus on construit, plus elles rapportent.",
    },
    mall: {
      id: "mall", base: "utility", label: "Centre commercial", plural: "centres commerciaux", icon: "🛍️", price: 240, setting: "boardMalls",
      table: null, // loyer dépendant du visiteur, voir mallRent
      names: ["Centre Commercial Nord", "Galerie Marchande", "Grand Centre", "Mégastore", "Galerie du Sud", "Passage Couvert"],
      shorts: ["Centre N", "Galerie", "Grand Centre", "Mégastore", "Galerie S", "Passage"],
      title: "🛍️ Centres commerciaux",
      info: "Des centres à 240 dont le loyer dépend du visiteur : 12 de base, plus 5 par propriété que le visiteur possède (maximum 120). Ils rapportent donc davantage face aux joueurs riches en propriétés. Posséder plusieurs centres augmente encore le loyer (x1,6 pour deux, x2,2 pour trois, x2,8 pour quatre).",
    },
  };

  // Les familles ajoutées (hors aéroports et compagnies d'origine)
  const EXTRA_FAMILY_IDS = ["port", "metro", "stadium", "park", "university", "mall"];

  const MALL_MULTIPLIERS = [1, 1, 1.6, 2.2, 2.8];

  function familyOf(tile) {
    return (tile && (tile.family || tile.type)) || null;
  }

  function isOwnableType(type) {
    return type === "property" || type === "airport" || type === "utility";
  }

  function roundTo5(n) {
    return Math.max(0, Math.round(n / 5) * 5);
  }

  // Combien de cases de cette famille le propriétaire possède (hypothèque exclue).
  function ownedCount(board, tile) {
    const fam = familyOf(tile);
    return board.filter((t) => familyOf(t) === fam && t.owner === tile.owner && !t.mortgaged).length;
  }

  // Loyer d'une case de famille (aéroport, port, métro, stade, parc, université, centre).
  // ctx = { visitorId, eventActive }.  Renvoie null pour une compagnie d'origine.
  function familyRent(board, tile, ctx) {
    const fam = FAMILIES[familyOf(tile)];
    if (!fam || tile.owner === null || tile.owner === undefined) return null;
    const count = Math.max(1, ownedCount(board, tile));
    if (fam.id === "utility") return null;
    if (fam.id === "mall") {
      const vid = ctx ? ctx.visitorId : null;
      const visitorTiles = vid === null || vid === undefined ? (ctx && ctx.assumedTiles) || 5 : board.filter((t) => isOwnableType(t.type) && t.owner === vid).length;
      const base = Math.min(120, 12 + 5 * visitorTiles);
      return roundTo5(base * MALL_MULTIPLIERS[Math.min(count, MALL_MULTIPLIERS.length - 1)]);
    }
    let rent = fam.table[Math.min(count, fam.table.length) - 1];
    if (fam.id === "stadium" && ctx && ctx.eventActive) rent *= 2;
    return rent;
  }

  // Version « estimation » sans visiteur connu (IA, contrats, affichage).
  function familyRentEstimate(board, tile) {
    return familyRent(board, tile, { visitorId: null, eventActive: false, assumedTiles: 5 });
  }

  // Description publique envoyée aux clients (tables de loyer, icônes...).
  function publicDefs() {
    const out = {};
    Object.values(FAMILIES).forEach((f) => {
      out[f.id] = { id: f.id, base: f.base, label: f.label, plural: f.plural, icon: f.icon, price: f.price, table: f.table, builderBonus: f.builderBonus || 0 };
    });
    return out;
  }

  return { FAMILIES, EXTRA_FAMILY_IDS, MALL_MULTIPLIERS, familyOf, ownedCount, familyRent, familyRentEstimate, publicDefs, isOwnableType };
});
