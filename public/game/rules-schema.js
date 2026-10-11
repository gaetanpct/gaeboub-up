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
            "Si les événements mondiaux sont activés, tomber sur une carte Spéciale déclenche un événement temporaire (si aucun n'est déjà en cours). Sinon, elle tire un effet classique comme une carte Destin.",
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
          id: "boardPorts",
          showInfo: true,
          label: "⚓ Ports",
          type: "select",
          default: 0,
          info:
            "Des ports à acheter, sur le modèle des aéroports mais un peu moins chers (180). Plus tu en possèdes, plus chacun rapporte (22, 50, 100, 190 puis 280 par visite). Un loyer régulier et sûr, qui récompense celui qui en collectionne plusieurs.",
          options: [
            { value: 0, label: "0 (aucune)" },
            { value: 1, label: "1" },
            { value: 2, label: "2" },
            { value: 3, label: "3" },
            { value: 4, label: "4" },
          ],
        },
        {
          id: "boardMetros",
          showInfo: true,
          label: "🚇 Stations de métro",
          type: "select",
          default: 0,
          info:
            "Des stations pas chères (120) qui rapportent peu au début (12 par visite) mais montent vite si tu en réunis plusieurs (jusqu'à 170). Idéal pour se lancer avec peu d'argent, et souvent visitées car elles sont nombreuses.",
          options: [
            { value: 0, label: "0 (aucune)" },
            { value: 1, label: "1" },
            { value: 2, label: "2" },
            { value: 3, label: "3" },
            { value: 4, label: "4" },
          ],
        },
        {
          id: "boardStadiums",
          showInfo: true,
          label: "🏟️ Stades",
          type: "select",
          default: 0,
          info:
            "Des stades à 220 dont le loyer (30, 70, 140, 260 puis 380) est DOUBLÉ tant qu'un événement mondial est en cours. Un petit pari qui prend tout son sens si les événements mondiaux sont activés.",
          options: [
            { value: 0, label: "0 (aucune)" },
            { value: 1, label: "1" },
            { value: 2, label: "2" },
            { value: 3, label: "3" },
            { value: 4, label: "4" },
          ],
        },
        {
          id: "boardParks",
          showInfo: true,
          label: "🎢 Parcs d'attractions",
          type: "select",
          default: 0,
          info:
            "Des parcs à 200 qui font payer un ticket à chaque visiteur (28, 60, 120, 220 puis 320 selon le nombre de parcs que tu possèdes). Un rendement simple et équilibré, entre les ports et les stades.",
          options: [
            { value: 0, label: "0 (aucune)" },
            { value: 1, label: "1" },
            { value: 2, label: "2" },
            { value: 3, label: "3" },
            { value: 4, label: "4" },
          ],
        },
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
            { value: 3, label: "3" },
            { value: 4, label: "4" },
          ],
        },
        {
          id: "boardMalls",
          showInfo: true,
          label: "🛍️ Centres commerciaux",
          type: "select",
          default: 0,
          info:
            "Des centres à 240 dont le loyer dépend du visiteur : 12 de base, plus 5 par propriété que le visiteur possède (maximum 120). Ils rapportent donc davantage face aux joueurs riches en propriétés. Posséder plusieurs centres augmente encore le loyer (x1,6 pour deux, x2,2 pour trois, x2,8 pour quatre).",
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
      category: "Événements",
      rules: [
        {
          id: "worldEventsEnabled",
          label: "🌍 Événements mondiaux temporaires",
          type: "boolean",
          default: false,
          info:
            "Se déclenche quand un joueur tombe sur une case Spéciale (leur nombre se règle dans Plateau) : un effet global aléatoire (inversion du sens de jeu, double déplacement, gel des échanges, ventes gratuites, réduction des prix, salaire doublé...) pour une durée limitée affichée à l'écran. Un seul actif à la fois.",
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
      category: "Prêts & Assurance",
      rules: [
        {
          id: "loansEnabled",
          label: "💳 Prêts entre joueurs",
          type: "boolean",
          default: false,
          info: "Un joueur peut prêter de l'argent à un autre en choisissant librement le montant, le taux d'intérêt et la durée de remboursement. Tout est public : personne ne peut cacher une dette.",
        },
        {
          id: "insuranceEnabled",
          label: "🛡️ Assurance",
          type: "boolean",
          default: false,
          info: "Un joueur peut souscrire l'une de 3 formules (coût et couverture différents) qui prend en charge une partie de ses loyers à payer pendant une durée limitée. Toi, l'hôte, choisis le prix de chaque formule ci-dessous.",
        },
        {
          id: "insurancePlan1Price",
          label: "Prix formule Basique (couvre 25% des loyers)",
          type: "number",
          default: 300,
          min: 0,
          max: 2000,
        },
        {
          id: "insurancePlan2Price",
          label: "Prix formule Standard (couvre 50% des loyers)",
          type: "number",
          default: 550,
          min: 0,
          max: 2000,
        },
        {
          id: "insurancePlan3Price",
          label: "Prix formule Premium (couvre 75% des loyers)",
          type: "number",
          default: 900,
          min: 0,
          max: 2000,
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
      category: "Dés",
      rules: [
        {
          id: "diceSides",
          label: "Dés à",
          type: "select",
          default: 6,
          options: [
            { value: 6, label: "6 faces (classique)" },
            { value: 8, label: "8 faces" },
          ],
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
          id: "tradeTaxPercent",
          label: "Taxe sur les échanges",
          type: "select",
          default: 0,
          options: [
            { value: 0, label: "Aucune" },
            { value: 5, label: "5 %" },
            { value: 10, label: "10 %" },
          ],
        },
        {
          id: "secretTrades",
          label: "🤫 Négociations secrètes (les autres joueurs ne voient pas le contenu)",
          type: "boolean",
          default: false,
        },
      ],
    },
    {
      category: "IA",
      rules: [
        {
          id: "slowMode",
          label: "🐢 Mode lent (l'IA joue à vitesse humaine)",
          type: "boolean",
          default: false,
          info:
            "Ralentit nettement les déplacements et les décisions de l'IA pour pouvoir suivre ce qu'il se passe à l'œil, comme un vrai joueur — utile en observant une partie ou pour les nouveaux joueurs.",
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
