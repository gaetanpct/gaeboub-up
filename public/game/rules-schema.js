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
// D'autres types (nombre libre, curseur...) pourront être ajoutés ici
// au besoin dans les prochaines sous-phases.
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
            { value: 44, label: "44 (plus long)" },
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
        }
      });
    });
    return validated;
  }

  return { RULES_SCHEMA, buildDefaultSettings, validateSettings };
});
