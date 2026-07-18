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
            "Un effet global aléatoire (inversion du sens de jeu, double déplacement, gel des échanges, ventes gratuites, réduction des prix, salaire doublé...) peut se déclencher, pour une durée limitée affichée à l'écran. Un seul actif à la fois.",
        },
        {
          id: "worldEventFrequency",
          label: "Fréquence",
          type: "select",
          default: "normal",
          options: [
            { value: "rare", label: "Rare" },
            { value: "normal", label: "Normale" },
            { value: "frequent", label: "Fréquente" },
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
          default: 60,
          min: 0,
          max: 2000,
        },
        {
          id: "insurancePlan2Price",
          label: "Prix formule Standard (couvre 50% des loyers)",
          type: "number",
          default: 100,
          min: 0,
          max: 2000,
        },
        {
          id: "insurancePlan3Price",
          label: "Prix formule Premium (couvre 75% des loyers)",
          type: "number",
          default: 150,
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
          default: 1500,
          options: [
            { value: 1000, label: "1000" },
            { value: 1500, label: "1500" },
            { value: 2000, label: "2000" },
            { value: 2500, label: "2500" },
            { value: 3000, label: "3000" },
            { value: 3500, label: "3500" },
            { value: 4000, label: "4000" },
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
      ],
    },
    {
      category: "Durée",
      rules: [
        {
          id: "turnLimit",
          label: "Limite de tours",
          type: "select",
          default: null,
          options: [
            { value: null, label: "Illimité" },
            { value: 60, label: "60 tours" },
            { value: 100, label: "100 tours" },
            { value: 150, label: "150 tours" },
          ],
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
