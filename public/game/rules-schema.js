// ============================================================
// REACH UP — Schéma générique des règles configurables
// Phase 8a : fondation du système de personnalisation poussée.
//
// PRINCIPE : ce fichier est la SEULE source de vérité pour "quelles
// règles existent, avec quelles valeurs possibles". Il sert à :
//   1. Générer automatiquement le formulaire de configuration (client),
//   2. Valider ce que le serveur accepte (aucune valeur non prévue),
//   3. Fournir les valeurs par défaut à la création d'un salon.
//
// POUR AJOUTER UNE NOUVELLE RÈGLE PLUS TARD (8b-8f) :
// il suffit d'ajouter une entrée dans la catégorie concernée ci-dessous.
// Le formulaire, la validation et les valeurs par défaut suivent
// automatiquement — aucun autre fichier "squelette" à modifier pour
// qu'une règle apparaisse dans l'interface.
//
// Types de règles supportés :
//   - "boolean" : case à cocher (true/false)
//   - "select"  : liste de choix (options: [{value, label}, ...])
//   - "number"  : nombre libre borné (min, max) — Phase 11
// D'autres types (curseur...) pourront être ajoutés ici au besoin.
// ============================================================

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.ReachUpRules = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {

  const RULES_SCHEMA = [
    {
      category: "Plateau",
      rules: [
        {
          id: "boardMode",
          label: "Plateau",
          type: "select",
          default: "fixed",
          options: [
            { value: "fixed", label: "Fixe (classique)" },
            { value: "random", label: "Généré aléatoirement" },
          ],
        },
        {
          id: "boardSize",
          label: "Nombre de cases",
          type: "select",
          default: 40,
          options: [
            { value: 28, label: "28 (plus court)" },
            { value: 32, label: "32" },
            { value: 36, label: "36" },
            { value: 40, label: "40 (classique)" },
            { value: 44, label: "44" },
            { value: 48, label: "48" },
            { value: 52, label: "52 (plus long)" },
          ],
        },
        {
          id: "boardGroups",
          label: "Nombre de groupes de propriétés",
          type: "select",
          default: 8,
          info:
            "Un groupe compte 2 ou 3 propriétés, jamais plus. Si le plateau est grand et que tu demandes peu de groupes, le nombre de groupes est augmenté automatiquement pour remplir le plateau. À partir de 9 groupes, les prix sont étalés sur la même plage qu'un plateau classique (de 60 à 375) pour que le dernier groupe ne coûte pas démesurément plus que le premier.",
          options: [
            { value: 4, label: "4" },
            { value: 5, label: "5" },
            { value: 6, label: "6" },
            { value: 7, label: "7" },
            { value: 8, label: "8 (classique)" },
            { value: 9, label: "9" },
            { value: 10, label: "10" },
            { value: 11, label: "11" },
            { value: 12, label: "12" },
          ],
        },
        {
          id: "boardChanceCards",
          label: "Cartes Destin",
          type: "select",
          default: 6,
          options: [
            { value: 0, label: "0" },
            { value: 2, label: "2" },
            { value: 4, label: "4" },
            { value: 6, label: "6 (classique)" },
            { value: 8, label: "8" },
          ],
        },
        {
          id: "boardSpecialCards",
          label: "Cartes Spéciales",
          type: "select",
          default: 0,
          info:
            "Chaque case Spéciale déclenche, quand un joueur tombe dessus, un événement mondial temporaire (inversion du sens de jeu, double déplacement, gel des échanges, ventes gratuites, réduction des prix, salaire doublé...) pour une durée limitée affichée à l'écran. Un seul événement est actif à la fois. Dès qu'il y a au moins une case Spéciale sur le plateau, les événements mondiaux sont activés.",
          options: [
            { value: 0, label: "0 (classique)" },
            { value: 1, label: "1" },
            { value: 2, label: "2" },
            { value: 4, label: "4" },
          ],
        },
        {
          id: "boardTaxes",
          label: "Cases Taxes",
          type: "select",
          default: 2,
          options: [
            { value: 0, label: "0" },
            { value: 2, label: "2 (classique)" },
            { value: 4, label: "4" },
          ],
        },
        {
          id: "boardAirports",
          label: "Gares/Aéroports",
          type: "select",
          default: 4,
          options: [
            { value: 0, label: "0" },
            { value: 2, label: "2" },
            { value: 4, label: "4 (classique)" },
            { value: 6, label: "6" },
          ],
        },
        {
          id: "boardUtilities",
          label: "Compagnies (eau/électricité)",
          type: "select",
          default: 2,
          options: [
            { value: 0, label: "0" },
            { value: 1, label: "1" },
            { value: 2, label: "2 (classique)" },
            { value: 3, label: "3" },
          ],
        },
        {
          id: "boardMystery",
          showInfo: true,
          label: "❓ Cases Mystère",
          type: "select",
          default: 2,
          info:
            "Une case mystère cache un effet instantané tiré au sort au début de la partie (révélé la première fois qu'un joueur tombe dessus), différent d'une partie à l'autre. Les cinq effets possibles. 🎰 Casino : le joueur mise automatiquement la moitié d'un salaire et lance un dé, tiers inférieur il perd sa mise, tiers du milieu il la récupère, tiers supérieur il la double. 🧾 Bureau des impôts : paie 4 % de sa fortune (argent, propriétés et maisons), 2 % seulement s'il possède 2 propriétés ou moins, plafonné à 2,5 salaires. 🎟️ Loterie : chacun qui tombe dessus achète un billet (un dixième de salaire) versé dans une cagnotte, et gagne toute la cagnotte sur le tiers supérieur du dé. 🏦 Banque : prêt rapide d'un demi-salaire, à rembourser 110 % au prochain passage par Départ. 🏥 Hôpital : récupère 30 % de ses pertes récentes en loyers et taxes, mais passe son prochain tour.",
          options: [
            { value: 0, label: "0 (aucune)" },
            { value: 1, label: "1" },
            { value: 2, label: "2" },
            { value: 3, label: "3" },
            { value: 4, label: "4" },
          ],
        },
      ],
    },
    {
      category: "Familles de cases (plateau aléatoire)",
      rules: [
        {
          id: "boardUniversities",
          showInfo: true,
          label: "🎓 Universités",
          type: "select",
          default: 0,
          info:
            "Des universités à 160 au loyer modeste (14 à 170), mais dont le propriétaire reçoit en plus 20 de la banque CHAQUE FOIS qu'un joueur, lui compris, construit une maison ou un hôtel. Plus la partie avance et plus on construit, plus elles rapportent.",
          options: [
            { value: 0, label: "0 (aucune)" },
            { value: 1, label: "1" },
            { value: 2, label: "2" },
            { value: 3, label: "3" }
          ],
        },
        {
          id: "boardTolls",
          showInfo: true,
          label: "🛣️ Péages",
          type: "select",
          default: 0,
          info:
            "Deux péages au maximum, placés aux deux extrémités du plateau. Tout joueur qui PASSE devant (ou s'arrête dessus) paie un petit péage à leur propriétaire. Le montant évolue pendant la partie, proportionnel à la valeur de ce qui est acheté et construit sur le plateau, mais il ne dépasse jamais 15 % d'un salaire. Un petit revenu régulier, jamais une stratégie à lui seul.",
          options: [
            { value: 0, label: "0 (aucun)" },
            { value: 1, label: "1" },
            { value: 2, label: "2" },
          ],
        },
        {
          id: "boardCentralBank",
          showInfo: true,
          label: "🏛️ Banque centrale",
          type: "select",
          default: 0,
          info:
            "Une seule par plateau, à 300. Son propriétaire touche 15 % de chaque salaire que les autres joueurs perçoivent en passant par Départ (prélevés sur leur salaire). Elle rapporte de plus en plus au fil de la partie, mais reste un bonus modéré.",
          options: [
            { value: 0, label: "0 (aucun)" },
            { value: 1, label: "1" },
          ],
        },
        {
          id: "boardAdAgencies",
          showInfo: true,
          label: "📺 Régies publicitaires",
          type: "select",
          default: 0,
          info:
            "Deux au maximum, à 220. Elle ne rapporte aucun loyer en elle-même, mais augmente de 10 % TOUS les loyers que tu touches. Avec la seconde régie, le bonus monte directement à 20 %. Une vraie synergie, très forte avec les deux.",
          options: [
            { value: 0, label: "0 (aucun)" },
            { value: 1, label: "1" },
            { value: 2, label: "2" },
          ],
        },
        {
          id: "boardGardens",
          showInfo: true,
          label: "🌳 Jardins publics",
          type: "select",
          default: 0,
          info:
            "À 180, un jardin ne rapporte rien en lui-même. En revanche son propriétaire prélève 10 % des loyers touchés par les propriétaires des deux cases rentables les plus proches, une à gauche et une à droite (propriétés, aéroports, compagnies, universités). Les cartes Destin, taxes, cases mystère et coins sont ignorés, on regarde simplement la case rentable suivante. L'emplacement fait toute la différence.",
          options: [
            { value: 0, label: "0 (aucun)" },
            { value: 1, label: "1" },
            { value: 2, label: "2" },
            { value: 3, label: "3" },
          ],
        },
      ],
    },
    {
      category: "Pouvoirs",
      rules: [
        {
          id: "powersEnabled",
          label: "🔮 Chaque joueur reçoit un pouvoir aléatoire en début de partie",
          type: "boolean",
          default: false,
        },
      ],
    },
    {
      category: "Prêts",
      rules: [
        {
          id: "loansEnabled",
          label: "💳 Prêts entre joueurs",
          type: "boolean",
          default: false,
          info: "Un joueur peut prêter de l'argent à un autre en choisissant librement le montant, le taux d'intérêt et la durée de remboursement. Tout est public : personne ne peut cacher une dette.",
        },
      ],
    },
    {
      category: "Économie",
      rules: [
        {
          id: "startingMoney",
          label: "Argent de départ",
          type: "select",
          default: 2000,
          options: [
            { value: 1000, label: "1000" },
            { value: 1500, label: "1500" },
            { value: 2000, label: "2000" },
            { value: 2500, label: "2500" },
            { value: 3000, label: "3000" },
            { value: 3500, label: "3500" },
            { value: 4000, label: "4000" },
            { value: 10000, label: "10000" },
            { value: 50000, label: "50000" },
          ],
        },
        {
          id: "salary",
          label: "Salaire (case Départ)",
          type: "select",
          default: 200,
          options: [
            { value: 100, label: "100" },
            { value: 200, label: "200" },
            { value: 300, label: "300" },
          ],
        },
        {
          id: "vacationPot",
          label: "🏖️ Cagnotte de Vacances (les taxes s'accumulent, Vacances les redistribue)",
          type: "boolean",
          default: false,
        },
        {
          id: "buildOnlyWhenSoldOut",
          label: "🚧 Construction uniquement lorsque toutes les propriétés du plateau ont été achetées",
          type: "boolean",
          default: false,
          info:
            "Les groupes peuvent être complétés normalement, mais personne ne peut construire de maison/hôtel tant qu'il reste des propriétés libres sur le plateau. Un bouton permet alors de proposer un vote pour mettre aux enchères toutes les propriétés encore libres d'un coup.",
        },
        {
          id: "apocalypseAllowed",
          label: "☠️ Autoriser le mode Apocalypse",
          type: "boolean",
          default: false,
          info:
            "N'importe quel joueur peut proposer de déclencher l'Apocalypse à tout moment (vote des autres joueurs requis). Une fois déclenchée, c'est irréversible : chaque groupe reçoit un multiplicateur de loyer chaotique et instable qui évolue et s'intensifie au fil des tours, en plus de tout ce qui est déjà actif (événements, pouvoirs...). Des pouvoirs apocalyptiques bien plus puissants sont distribués à ce moment-là.",
        },
      ],
    },
    {
      category: "Enchères",
      rules: [
        {
          id: "auctionMode",
          label: "Type d'enchère (quand personne n'achète une case)",
          type: "select",
          default: "secret",
          options: [
            { value: "secret", label: "Enchère secrète (mise cachée, révélée à la fin)" },
            { value: "classic", label: "Enchère classique (à tour de rôle, à la criée)" },
            { value: "none", label: "Pas d'enchère (la case reste juste invendue)" },
          ],
        },
        {
          id: "forcedAuctionsPerGame",
          label: "🔨 Enchères forcées par joueur (déclencher une enchère sur la propriété de son choix, à tout moment)",
          type: "select",
          default: 0,
          options: [
            { value: 0, label: "0 (désactivé)" },
            { value: 1, label: "1 fois" },
            { value: 2, label: "2 fois" },
            { value: 3, label: "3 fois" },
          ],
        },
      ],
    },
    {
      category: "Échanges",
      rules: [
        {
          id: "secretTrades",
          label: "🤫 Négociations secrètes (les autres joueurs ne voient pas le contenu)",
          type: "boolean",
          default: false,
        },
      ],
    },
    {
      category: "Rythme",
      rules: [
        {
          id: "slowMode",
          label: "🐢 Mode lent (pions case par case)",
          type: "boolean",
          default: false,
          info:
            "Les pions avancent case par case, comme à la main : si tu fais 5, ton pion passe par les 5 cases avant de s'arrêter. Valable pour tous les joueurs, et l'IA prend aussi son temps pour décider. Le jeu reste fluide, mais on peut suivre chaque déplacement sans se perdre.",
        },
      ],
    },
  ];

  // Construit l'objet de réglages par défaut à partir du schéma
  // (utilisé à la création d'un salon).
  function buildDefaultSettings() {
    const settings = {};
    RULES_SCHEMA.forEach((category) => {
      category.rules.forEach((rule) => {
        settings[rule.id] = rule.default;
      });
    });
    return settings;
  }

  // Valide un objet de réglages envoyé par un client : ne conserve que
  // les clés connues du schéma, avec une valeur autorisée. Toute clé
  // inconnue ou valeur hors-liste est silencieusement ignorée (on garde
  // la valeur précédente pour cette règle, gérée par l'appelant).
  function validateSettings(payload) {
    const validated = {};
    if (!payload || typeof payload !== "object") return validated;

    RULES_SCHEMA.forEach((category) => {
      category.rules.forEach((rule) => {
        if (!(rule.id in payload)) return;
        const value = payload[rule.id];

        if (rule.type === "boolean") {
          validated[rule.id] = !!value;
          return;
        }

        if (rule.type === "select") {
          const allowed = rule.options.some((opt) => opt.value === value);
          if (allowed) validated[rule.id] = value;
          return;
        }

        if (rule.type === "number") {
          const num = Math.floor(Number(value));
          if (Number.isNaN(num)) return;
          const min = rule.min !== undefined ? rule.min : -Infinity;
          const max = rule.max !== undefined ? rule.max : Infinity;
          validated[rule.id] = Math.max(min, Math.min(max, num));
        }
      });
    });
    return validated;
  }

  return { RULES_SCHEMA, buildDefaultSettings, validateSettings };
});
