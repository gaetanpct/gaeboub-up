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
    { type: "property", name: "Rue Zaza", short: "Zaza", group: "marron", price: 60, rent: 2, owner: null, houses: 0, mortgaged: false },
    { type: "chance", name: "Carte Destin", short: "Destin" },
    { type: "property", name: "Rue des Peupliers", short: "Peupliers", group: "marron", price: 60, rent: 4, owner: null, houses: 0, mortgaged: false },
    { type: "tax", name: "Impôts", short: "Impôts", amount: 200 },
    { type: "airport", name: "Aéroport Nord", short: "Aéroport N", price: 200, owner: null, mortgaged: false },
    { type: "property", name: "Rue 67", short: "Rue 67", group: "cyan", price: 100, rent: 6, owner: null, houses: 0, mortgaged: false },
    { type: "chance", name: "Carte Destin", short: "Destin" },
    { type: "property", name: "Rue des Docks", short: "Docks", group: "cyan", price: 100, rent: 6, owner: null, houses: 0, mortgaged: false },
    { type: "property", name: "Rue du Quai", short: "Quai", group: "cyan", price: 120, rent: 8, owner: null, houses: 0, mortgaged: false },
    { type: "jail", name: "Prison / Simple visite", short: "Prison" },
    { type: "property", name: "Avenue Pupuce", short: "Pupuce", group: "magenta", price: 140, rent: 10, owner: null, houses: 0, mortgaged: false },
    { type: "utility", name: "Compagnie des Eaux", short: "Eaux", price: 150, owner: null, mortgaged: false },
    { type: "property", name: "Avenue des Tulipes", short: "Tulipes", group: "magenta", price: 140, rent: 10, owner: null, houses: 0, mortgaged: false },
    { type: "property", name: "Avenue des Orchidées", short: "Orchidées", group: "magenta", price: 160, rent: 12, owner: null, houses: 0, mortgaged: false },
    { type: "airport", name: "Aéroport Est", short: "Aéroport E", price: 200, owner: null, mortgaged: false },
    { type: "property", name: "Boulevard Grand Méchant Loup Ahouuu", short: "Ahouuu !", group: "orange", price: 180, rent: 14, owner: null, houses: 0, mortgaged: false },
    { type: "chance", name: "Carte Destin", short: "Destin" },
    { type: "property", name: "Boulevard des Arts", short: "Arts", group: "orange", price: 180, rent: 14, owner: null, houses: 0, mortgaged: false },
    { type: "property", name: "Boulevard de la Paix", short: "Paix", group: "orange", price: 200, rent: 16, owner: null, houses: 0, mortgaged: false },
    { type: "vacation", name: "Vacances", short: "Vacances" },
    { type: "property", name: "Rue Latina Chargée", short: "Latina Chargée", group: "rouge", price: 220, rent: 18, owner: null, houses: 0, mortgaged: false },
    { type: "chance", name: "Carte Destin", short: "Destin" },
    { type: "property", name: "Rue Voltaire", short: "Voltaire", group: "rouge", price: 220, rent: 18, owner: null, houses: 0, mortgaged: false },
    { type: "property", name: "Rue Molière", short: "Molière", group: "rouge", price: 240, rent: 20, owner: null, houses: 0, mortgaged: false },
    { type: "airport", name: "Aéroport Sud", short: "Aéroport S", price: 200, owner: null, mortgaged: false },
    { type: "property", name: "Avenue Brrbrrrpatapim", short: "Patapim", group: "jaune", price: 260, rent: 22, owner: null, houses: 0, mortgaged: false },
    { type: "property", name: "Avenue des Sports", short: "Sports", group: "jaune", price: 260, rent: 22, owner: null, houses: 0, mortgaged: false },
    { type: "utility", name: "Compagnie d'Électricité", short: "Électricité", price: 150, owner: null, mortgaged: false },
    { type: "property", name: "Avenue Centrale", short: "Centrale", group: "jaune", price: 280, rent: 24, owner: null, houses: 0, mortgaged: false },
    { type: "go-to-jail", name: "Aller en prison", short: "→ Prison" },
    { type: "property", name: "Boulevard Barmitsva", short: "Barmitsva", group: "vert", price: 300, rent: 26, owner: null, houses: 0, mortgaged: false },
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
  // Quand une carte fait payer le joueur À LA BANQUE (l'argent quitte
  // vraiment le jeu, contrairement à un versement à un autre joueur),
  // ce montant part aussi dans la cagnotte de Vacances si elle est
  // activée — exactement comme une case Taxe.
  function payCardToBank(engine, player, amount) {
    engine.pay(player, null, amount);
    if (engine.vacationPotEnabled) engine.vacationPot += amount;
  }

  const CHANCE_CARDS = [
    {
      description: "Vous gagnez un prix de mots croisés (+100).",
      effect: (engine, player) => engine.pay(null, player, 100),
    },
    {
      description: "Erreur fiscale : vous payez une pénalité (-75).",
      effect: (engine, player) => payCardToBank(engine, player, 75),
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
      effect: (engine, player) => payCardToBank(engine, player, 50),
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
        if (cost > 0) payCardToBank(engine, player, cost);
      },
    },
    {
      description: "Un distributeur vous rend trop de monnaie par erreur (+120).",
      effect: (engine, player) => engine.pay(null, player, 120),
    },
    {
      description: "Amende pour excès de vitesse (-40).",
      effect: (engine, player) => payCardToBank(engine, player, 40),
    },
    {
      description: "Vous retrouvez un billet oublié dans une veste (+30).",
      effect: (engine, player) => engine.pay(null, player, 30),
    },
    {
      description: "Frais de notaire imprévus (-60).",
      effect: (engine, player) => payCardToBank(engine, player, 60),
    },
    {
      description: "Bonus de fidélité de la banque (+80).",
      effect: (engine, player) => engine.pay(null, player, 80),
    },
    {
      description: "Contrôle fiscal (-90).",
      effect: (engine, player) => payCardToBank(engine, player, 90),
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
      requiresTileType: "airport",
      effect: (engine, player) => {
        const newIndex = engine._findNearestTileOfType(player.position, "airport");
        engine._landOnTile(player, newIndex);
      },
    },
    {
      description: "Direction la compagnie la plus proche.",
      requiresTileType: "utility",
      effect: (engine, player) => {
        const newIndex = engine._findNearestTileOfType(player.position, "utility");
        engine._landOnTile(player, newIndex);
      },
    },

    // ---- Nouvelles cartes ----
    {
      description: "Remboursement d'impôts inattendu (+130).",
      effect: (engine, player) => engine.pay(null, player, 130),
    },
    {
      description: "Réparation de toiture après une tempête (-70).",
      effect: (engine, player) => payCardToBank(engine, player, 70),
    },
    {
      description: "Un ami vous prête sa voiture : avancez de 4 cases.",
      effect: (engine, player) => {
        const newIndex = (player.position + 4) % engine.board.length;
        engine._landOnTile(player, newIndex);
      },
    },
    {
      description: "Panne générale des transports : reculez de 4 cases.",
      effect: (engine, player) => {
        const newIndex = (player.position - 4 + engine.board.length) % engine.board.length;
        engine._landOnTile(player, newIndex);
      },
    },
    {
      description: "Esprit d'économie : versez 40 dans la cagnotte de Vacances.",
      effect: (engine, player) => {
        if (engine.vacationPotEnabled) {
          engine.pay(player, null, 40);
          engine.vacationPot += 40;
        } else {
          engine.pay(player, null, 40); // sans cagnotte active, ça part simplement à la banque
        }
      },
    },
    {
      description: "Petit geste de la mairie : récupérez 25% de la cagnotte de Vacances actuelle.",
      effect: (engine, player) => {
        if (engine.vacationPotEnabled && engine.vacationPot > 0) {
          const amount = Math.floor(engine.vacationPot * 0.25);
          if (amount > 0) {
            engine.vacationPot -= amount;
            engine.pay(null, player, amount);
          }
        }
        // Pas de cagnotte active ou vide : la carte n'a simplement aucun effet.
      },
    },
    {
      description: "Coup de pouce de l'urbanisme : si vous possédez un groupe complet sans la moindre maison, construisez-y gratuitement une maison. Sinon, rien ne se passe.",
      effect: (engine, player) => {
        const groups = [...new Set(engine.board.filter((t) => t.type === "property" && t.owner === player.id).map((t) => t.group))];
        for (const group of groups) {
          const tiles = engine.board.filter((t) => t.type === "property" && t.group === group);
          const allMine = tiles.every((t) => t.owner === player.id);
          const noHouses = tiles.every((t) => (t.houses || 0) === 0 && !t.mortgaged);
          if (allMine && noHouses) {
            const target = tiles[0];
            const idx = engine.board.indexOf(target);
            target.houses = 1;
            engine.addLog(`🏗️ ${player.name} reçoit gratuitement une maison sur ${target.name} grâce à sa carte !`);
            return;
          }
        }
      },
    },
    {
      description: "Petit incendie de cuisine : vous perdez une maison au hasard chez vous (aucun remboursement). Si vous n'avez aucune maison, rien ne se passe.",
      effect: (engine, player) => {
        const withHouses = engine.board.filter((t) => t.type === "property" && t.owner === player.id && (t.houses || 0) > 0);
        if (withHouses.length === 0) return;
        const target = withHouses[Math.floor(Math.random() * withHouses.length)];
        target.houses -= 1;
        engine.addLog(`🔥 Un petit incendie détruit une maison de ${player.name} sur ${target.name} (aucun remboursement).`);
      },
    },
    {
      description: "Un notaire retrouve une vieille hypothèque : une de vos propriétés hypothéquées est levée gratuitement. Si vous n'en avez aucune, rien ne se passe.",
      effect: (engine, player) => {
        const mortgaged = engine.board.filter((t) => t.owner === player.id && t.mortgaged);
        if (mortgaged.length === 0) return;
        const target = mortgaged[Math.floor(Math.random() * mortgaged.length)];
        target.mortgaged = false;
        engine.addLog(`📜 L'hypothèque de ${player.name} sur ${target.name} est levée gratuitement !`);
      },
    },
    {
      description: "Frais de gestion locative (-55).",
      effect: (engine, player) => payCardToBank(engine, player, 55),
    },
    {
      description: "Remboursement d'une caution oubliée (+70).",
      effect: (engine, player) => engine.pay(null, player, 70),
    },
    {
      description: "Vous gagnez à la loterie de quartier (+150), mais 50 partent directement dans la cagnotte de Vacances.",
      effect: (engine, player) => {
        engine.pay(null, player, 150);
        if (engine.vacationPotEnabled) {
          engine.pay(player, null, 50);
          engine.vacationPot += 50;
        }
      },
    },
    {
      description: "Journée sans chance : reculez jusqu'à la case Prison la plus proche (simple visite, pas d'arrestation).",
      effect: (engine, player) => {
        const jailIndex = engine.board.findIndex((t) => t.type === "jail");
        if (jailIndex >= 0) engine._landOnTile(player, jailIndex);
      },
    },
  ];

  return { BOARD, CHANCE_CARDS, HOUSE_COST_BY_GROUP, RENT_MULTIPLIERS_BY_HOUSES };
});
