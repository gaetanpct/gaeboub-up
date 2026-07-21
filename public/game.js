// ============================================================
// REACH UP — Code côté navigateur
// Phase 3 : écran d'accueil, salon d'attente, puis partie en direct.
// Ce fichier ne connaît AUCUNE règle du jeu : il affiche l'état que
// le serveur lui envoie, et transmet les intentions du joueur
// (lancer les dés, acheter...) — toute la vérité vient du serveur.
// ============================================================

const socket = io();

let myPlayerId = null;

// ============================================================
// Reconnexion — permet de recharger la page (bug, gel, plantage...)
// sans revenir à l'écran d'accueil : on garde le code du salon et un
// jeton de session dans sessionStorage (propre à cet onglet), et on
// tente de rejoindre automatiquement au chargement.
// ============================================================
const SESSION_KEY = "reachup_session";

function saveSession(roomCode, playerToken) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, playerToken }));
  } catch {
    // sessionStorage indisponible (navigation privée stricte...) : tant pis, pas de reconnexion possible.
  }
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // rien à faire
  }
}

socket.on("room:session", ({ roomCode, playerToken }) => {
  saveSession(roomCode, playerToken);
});

socket.on("room:rejoinFailed", ({ reason }) => {
  clearSession();
  showScreen("home");
  homeError.textContent = reason || "Impossible de reprendre cette partie.";
});

socket.on("connect", () => {
  const session = loadSession();
  if (session && session.roomCode && session.playerToken) {
    socket.emit("room:rejoin", session);
  }
});

// Si une session existait déjà au chargement de la page, on affiche tout
// de suite un message de reconnexion à la place de l'écran d'accueil —
// pour éviter le flash "écran d'accueil puis salon/partie" pendant le
// bref aller-retour réseau. On ne touche PAS au contenu de screen-home
// (le script a besoin de ses champs plus loin) : on le cache et on
// insère un message à côté, retiré dès qu'un vrai écran prend le relais.
(function showReconnectingIfNeeded() {
  const session = loadSession();
  if (!session) return;
  const homeScreen = document.getElementById("screen-home");
  if (!homeScreen) return;
  homeScreen.hidden = true;
  const reconnecting = document.createElement("p");
  reconnecting.id = "reconnecting-message";
  reconnecting.className = "properties-empty";
  reconnecting.style.textAlign = "center";
  reconnecting.style.paddingTop = "2rem";
  reconnecting.textContent = "🔄 Reconnexion à ta partie en cours...";
  homeScreen.insertAdjacentElement("afterend", reconnecting);
})();

// ---- Gestion des écrans ----
const screens = {
  home: document.getElementById("screen-home"),
  lobby: document.getElementById("screen-lobby"),
  game: document.getElementById("screen-game"),
};
function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
  const reconnectingMsg = document.getElementById("reconnecting-message");
  if (reconnectingMsg) reconnectingMsg.remove();
  // L'écran de jeu utilise une mise en page plein écran spéciale (Phase 5)
  // pour que tout tienne sans avoir à scroller.
  document.body.classList.toggle("is-game-screen", name === "game");
}

// ============================================================
// Écran d'accueil
// ============================================================
const inputName = document.getElementById("input-name");
const inputCode = document.getElementById("input-code");
const btnCreate = document.getElementById("btn-create");
const btnJoin = document.getElementById("btn-join");
const homeError = document.getElementById("home-error");

btnCreate.addEventListener("click", () => {
  homeError.textContent = "";
  socket.emit("room:create", { name: inputName.value });
});

btnJoin.addEventListener("click", () => {
  const code = inputCode.value.trim().toUpperCase();
  if (!code) {
    homeError.textContent = "Entre le code du salon à rejoindre.";
    return;
  }
  homeError.textContent = "";
  socket.emit("room:join", { name: inputName.value, code });
});

socket.on("room:error", (message) => {
  ReachUpSounds.playError();
  if (!loansModal.hidden) {
    document.getElementById("loans-error").textContent = message;
  } else if (!tradeModal.hidden) {
    document.getElementById("trade-error").textContent = message;
  } else if (!propertiesModal.hidden) {
    document.getElementById("properties-error").textContent = message;
  } else if (!screens.home.hidden) {
    homeError.textContent = message;
  } else if (!screens.lobby.hidden) {
    document.getElementById("lobby-error").textContent = message;
  }
});

// ============================================================
// Écran salon d'attente
// ============================================================
const lobbyCodeEl = document.getElementById("lobby-code");
const lobbyPlayersEl = document.getElementById("lobby-players");
const btnReady = document.getElementById("btn-ready");
const btnStart = document.getElementById("btn-start");

btnReady.addEventListener("click", () => socket.emit("room:toggleReady"));
btnStart.addEventListener("click", () => socket.emit("room:start"));

const boardPreviewPanel = document.getElementById("board-preview-panel");
const boardPreviewGrid = document.getElementById("board-preview-grid");
const btnRegenerateBoard = document.getElementById("btn-regenerate-board");
btnRegenerateBoard.addEventListener("click", () => socket.emit("room:regenerateBoard"));

// ---- Réglages de la partie (Phase 5, généralisé en Phase 8a) ----
// Le formulaire entier est généré à partir de RULES_SCHEMA (rules-schema.js) :
// ajouter une règle dans ce schéma suffit à la faire apparaître ici,
// sans toucher à ce fichier.
const settingsContainer = document.getElementById("settings-container");
const RULES_SCHEMA = ReachUpRules.RULES_SCHEMA;
let currentIsHost = false;

function findRuleDef(ruleId) {
  for (const category of RULES_SCHEMA) {
    const found = category.rules.find((r) => r.id === ruleId);
    if (found) return found;
  }
  return null;
}

function renderInfoButton(rule) {
  if (!rule.info) return "";
  return `
    <button type="button" class="info-toggle" data-info-toggle="${rule.id}" title="Plus d'informations">ℹ️</button>
    <p class="info-text" data-info-text="${rule.id}" hidden>${rule.info}</p>
  `;
}

function renderRuleControl(rule, value) {
  if (rule.type === "boolean") {
    return `
      <label class="checkbox-label">
        <input type="checkbox" data-rule-id="${rule.id}" data-rule-type="boolean" ${value ? "checked" : ""} />
        ${rule.label}
        ${renderInfoButton(rule)}
      </label>
    `;
  }
  if (rule.type === "number") {
    return `
      <label>
        ${rule.label} ${renderInfoButton(rule)}
        <input type="number" data-rule-id="${rule.id}" data-rule-type="number" value="${value}" min="${rule.min ?? ""}" max="${rule.max ?? ""}" />
      </label>
    `;
  }
  // type === "select"
  const optionsHtml = rule.options
    .map((opt) => {
      const optValue = opt.value === null ? "" : String(opt.value);
      const selected = opt.value === value ? "selected" : "";
      return `<option value="${optValue}" ${selected}>${opt.label}</option>`;
    })
    .join("");
  return `
    <label>
      ${rule.label} ${renderInfoButton(rule)}
      <select data-rule-id="${rule.id}" data-rule-type="select">${optionsHtml}</select>
    </label>
  `;
}

function renderSettingsForm(settings) {
  settingsContainer.innerHTML = RULES_SCHEMA.map(
    (category) => `
      <fieldset class="settings-category">
        <legend>${category.category}</legend>
        ${category.rules.map((rule) => renderRuleControl(rule, settings[rule.id])).join("")}
      </fieldset>
    `
  ).join("");

  settingsContainer.querySelectorAll("[data-rule-id]").forEach((el) => {
    el.disabled = !currentIsHost;
    el.addEventListener("change", emitSettingsChange);
  });

  settingsContainer.querySelectorAll("[data-info-toggle]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      const ruleId = btn.dataset.infoToggle;
      const textEl = settingsContainer.querySelector(`[data-info-text="${ruleId}"]`);
      if (textEl) textEl.hidden = !textEl.hidden;
    });
  });
}

function emitSettingsChange() {
  const payload = {};
  settingsContainer.querySelectorAll("[data-rule-id]").forEach((el) => {
    const ruleId = el.dataset.ruleId;
    if (el.dataset.ruleType === "boolean") {
      payload[ruleId] = el.checked;
      return;
    }
    if (el.dataset.ruleType === "number") {
      payload[ruleId] = Number(el.value) || 0;
      return;
    }
    const ruleDef = findRuleDef(ruleId);
    const rawValue = el.value;
    if (rawValue === "") {
      payload[ruleId] = null;
      return;
    }
    // On retrouve la valeur d'origine (nombre, chaîne...) depuis le schéma,
    // pour ne pas envoyer une chaîne de caractères là où un nombre est attendu.
    const matchingOption = ruleDef.options.find((opt) => String(opt.value) === rawValue);
    payload[ruleId] = matchingOption ? matchingOption.value : rawValue;
  });
  socket.emit("room:updateSettings", payload);
}

socket.on("room:update", (room) => {
  showScreen("lobby");
  document.getElementById("lobby-error").textContent = "";
  lobbyCodeEl.textContent = room.code;

  const isHost = room.hostSocketId === socket.id;

  lobbyPlayersEl.innerHTML = "";
  const me = room.players.find((p) => p.socketId === socket.id);
  btnReady.classList.toggle("btn-ready--active", !!(me && me.ready));
  btnReady.textContent = me && me.ready ? "✅ Prêt !" : "Je suis prêt";

  room.players.forEach((p) => {
    const isPlayerHost = p.socketId === room.hostSocketId;
    const isMe = p.socketId === socket.id;

    const card = document.createElement("div");
    card.className = "player-card";
    const statusLine = p.isAI ? `🤖 IA (${(room.aiDifficulties || []).find((d) => d.id === p.difficulty)?.label || p.difficulty})` : p.ready ? "✅ Prêt" : "⏳ Pas prêt";
    card.innerHTML = `
      <h3>${p.name}${isMe ? " (toi)" : ""}${isPlayerHost ? " 👑" : ""}</h3>
      <p class="player-status">${statusLine}</p>
      ${p.isAI && isHost ? `<button class="btn-remove-ai" data-remove-ai="${p.socketId}">Retirer</button>` : ""}
    `;
    lobbyPlayersEl.appendChild(card);
  });
  lobbyPlayersEl.querySelectorAll("[data-remove-ai]").forEach((btn) => {
    btn.addEventListener("click", () => socket.emit("room:removeAI", { socketId: btn.dataset.removeAi }));
  });

  currentIsHost = isHost;
  renderSettingsForm(room.settings || {});

  if (room.previewBoard) {
    boardPreviewPanel.hidden = false;
    ReachUpBoardView.renderPreview(boardPreviewGrid, room.previewBoard);
  } else {
    boardPreviewPanel.hidden = true;
  }
  btnRegenerateBoard.hidden = !isHost;

  addAIPanel.hidden = !isHost || room.players.length >= (room.maxPlayers || 4);
  if (isHost && room.aiDifficulties && aiDifficultySelect.options.length === 0) {
    aiDifficultySelect.innerHTML = room.aiDifficulties.map((d) => `<option value="${d.id}">${d.label}</option>`).join("");
  }

  btnStart.hidden = !isHost;
  btnStart.disabled = !room.canStart;
});

const addAIPanel = document.getElementById("add-ai-panel");
const aiDifficultySelect = document.getElementById("ai-difficulty-select");
document.getElementById("btn-add-ai").addEventListener("click", () => {
  socket.emit("room:addAI", { difficulty: aiDifficultySelect.value });
});

// ============================================================
// Écran de jeu
// ============================================================
const playersPanel = document.getElementById("players-panel");
const actionArea = document.getElementById("action-area");
const propertiesModal = document.getElementById("properties-modal");
const propertiesList = document.getElementById("properties-list");
const btnOpenProperties = document.getElementById("btn-open-properties");
const btnCloseProperties = document.getElementById("btn-close-properties");

const tradeModal = document.getElementById("trade-modal");
const tradeContent = document.getElementById("trade-content");
const btnOpenTrade = document.getElementById("btn-open-trade");
const btnCloseTrade = document.getElementById("btn-close-trade");
let tradeTargetId = null;

const powerModal = document.getElementById("power-modal");
const powerContent = document.getElementById("power-content");
const btnOpenPower = document.getElementById("btn-open-power");
const btnClosePower = document.getElementById("btn-close-power");

const btnToggleSound = document.getElementById("btn-toggle-sound");
function refreshSoundButton() {
  btnToggleSound.textContent = ReachUpSounds.isMuted() ? "🔇" : "🔊";
}
refreshSoundButton();
btnToggleSound.addEventListener("click", () => {
  ReachUpSounds.toggleMuted();
  refreshSoundButton();
});

const fullLogModal = document.getElementById("full-log-modal");
const btnCloseFullLog = document.getElementById("btn-close-full-log");
btnCloseFullLog.addEventListener("click", () => { fullLogModal.hidden = true; });
fullLogModal.addEventListener("click", (event) => {
  if (event.target === fullLogModal) fullLogModal.hidden = true;
});
// Le bouton "Tout voir" est créé dynamiquement dans la zone centrale du
// plateau (board-view.js) : délégation d'événement pour le capter quel
// que soit le moment où il apparaît dans le DOM.
document.addEventListener("click", (event) => {
  if (event.target && event.target.id === "btn-open-full-log") {
    fullLogModal.hidden = false;
    if (latestGameState) renderLog(latestGameState);
  }
});

const menuModal = document.getElementById("menu-modal");
const btnMenu = document.getElementById("btn-menu");
const btnCloseMenu = document.getElementById("btn-close-menu");
const btnForfeit = document.getElementById("btn-forfeit");
const forfeitConfirm = document.getElementById("forfeit-confirm");
btnMenu.addEventListener("click", () => {
  forfeitConfirm.hidden = true;
  menuModal.hidden = false;
  renderSummaryModal();
});
btnCloseMenu.addEventListener("click", () => { menuModal.hidden = true; });
menuModal.addEventListener("click", (event) => {
  if (event.target === menuModal) menuModal.hidden = true;
});
btnForfeit.addEventListener("click", () => { forfeitConfirm.hidden = false; });
document.getElementById("btn-forfeit-cancel").addEventListener("click", () => { forfeitConfirm.hidden = true; });
document.getElementById("btn-forfeit-confirm").addEventListener("click", () => {
  socket.emit("game:forfeit");
  menuModal.hidden = true;
});

const loansModal = document.getElementById("loans-modal");
const loansContent = document.getElementById("loans-content");
const btnOpenLoans = document.getElementById("btn-open-loans");
const btnCloseLoans = document.getElementById("btn-close-loans");
let loanTargetId = null;

const tileDetailModal = document.getElementById("tile-detail-modal");
const btnCloseTileDetail = document.getElementById("btn-close-tile-detail");
btnCloseTileDetail.addEventListener("click", () => { tileDetailModal.hidden = true; });
tileDetailModal.addEventListener("click", (event) => {
  if (event.target === tileDetailModal) tileDetailModal.hidden = true;
});
ReachUpBoardView.onTileClick((tileIndex) => {
  renderTileDetailModal(tileIndex);
  tileDetailModal.hidden = false;
});

const referenceModal = document.getElementById("reference-modal");
const btnOpenReference = document.getElementById("btn-open-reference");
const btnCloseReference = document.getElementById("btn-close-reference");
btnOpenReference.addEventListener("click", () => {
  referenceModal.hidden = false;
  renderReferenceModal();
});
btnCloseReference.addEventListener("click", () => { referenceModal.hidden = true; });
referenceModal.addEventListener("click", (event) => {
  if (event.target === referenceModal) referenceModal.hidden = true;
});

const statsModal = document.getElementById("stats-modal");
const btnCloseStats = document.getElementById("btn-close-stats");
btnCloseStats.addEventListener("click", () => { statsModal.hidden = true; });
statsModal.addEventListener("click", (event) => {
  if (event.target === statsModal) statsModal.hidden = true;
});
let statsAutoShown = false;

let latestGameState = null;

// À chaque mise à jour reçue (même venant d'un AUTRE joueur), les fenêtres
// ouvertes sont entièrement reconstruites à partir de l'état — pratique
// pour rester à jour, mais ça effaçait au passage tout ce qu'on était en
// train de saisir (montant d'enchère, case cochée pour un échange...).
// Ces deux fonctions capturent les valeurs juste avant de reconstruire, et
// les remettent en place juste après, sans rien changer d'autre.
function captureFormValues(container) {
  const values = {};
  if (!container) return values;
  container.querySelectorAll("input, select, textarea").forEach((el) => {
    const key = el.id || (el.type === "checkbox" || el.type === "radio" ? `${el.className}:${el.value}` : null);
    if (!key) return;
    values[key] = el.type === "checkbox" || el.type === "radio" ? el.checked : el.value;
  });
  return values;
}

function restoreFormValues(container, values) {
  if (!container) return;
  container.querySelectorAll("input, select, textarea").forEach((el) => {
    const key = el.id || (el.type === "checkbox" || el.type === "radio" ? `${el.className}:${el.value}` : null);
    if (!key || !(key in values)) return;
    if (el.type === "checkbox" || el.type === "radio") {
      el.checked = values[key];
    } else {
      el.value = values[key];
    }
  });
}

btnOpenProperties.addEventListener("click", () => {
  propertiesModal.hidden = false;
  renderPropertiesModal();
});
btnCloseProperties.addEventListener("click", () => {
  propertiesModal.hidden = true;
});
propertiesModal.addEventListener("click", (event) => {
  if (event.target === propertiesModal) propertiesModal.hidden = true;
});

btnOpenTrade.addEventListener("click", () => {
  tradeModal.hidden = false;
  renderTradeModal();
});
btnCloseTrade.addEventListener("click", () => {
  tradeModal.hidden = true;
});
tradeModal.addEventListener("click", (event) => {
  if (event.target === tradeModal) tradeModal.hidden = true;
});

btnOpenPower.addEventListener("click", () => {
  powerModal.hidden = false;
  renderPowerModal();
});
btnClosePower.addEventListener("click", () => {
  powerModal.hidden = true;
});
powerModal.addEventListener("click", (event) => {
  if (event.target === powerModal) powerModal.hidden = true;
});

btnOpenLoans.addEventListener("click", () => {
  loansModal.hidden = false;
  renderLoansModal();
});
btnCloseLoans.addEventListener("click", () => {
  loansModal.hidden = true;
});
loansModal.addEventListener("click", (event) => {
  if (event.target === loansModal) loansModal.hidden = true;
});

let latestGameSettings = null;
let lastLogTotalCount = 0;

socket.on("game:started", ({ state, socketToPlayerId, settings }) => {
  myPlayerId = socketToPlayerId[socket.id];
  latestGameSettings = settings || null;
  lastLogTotalCount = state.logTotalCount; // pas de notification rétroactive sur le journal déjà existant
  lastKnownMoney = {}; // idem pour les indicateurs de variation d'argent
  showScreen("game");
  renderGame(state);
  // Reconnexion directe vers une partie déjà terminée (cas rare) : la
  // session ne sert plus à rien, on l'efface pour ne pas y revenir en boucle.
  if (state.gameOver) clearSession();
});

socket.on("game:update", ({ state, settings }) => {
  if (settings) latestGameSettings = settings;
  processNewLogLines(state);
  renderGame(state);
  // Dès que la partie se termine, la session de reconnexion n'a plus lieu
  // d'être : sans ça, "Retour au menu" (qui recharge la page) ramènerait
  // automatiquement vers cette même partie terminée.
  if (state.gameOver) clearSession();
});

// Ne connaît aucune règle du jeu : lit juste les nouvelles lignes du
// journal (déjà écrites en langage humain par le moteur) et en déduit un
// son, une notification, et/ou une carte animée selon des mots-clés
// simples. Découplé du reste, donc n'importe quelle action future produit
// une notification "gratuitement" si son log contient les bons mots, sans
// avoir à toucher au moteur.
//
// IMPORTANT : state.log n'est qu'une FENÊTRE GLISSANTE des 80 dernières
// lignes (pour ne pas alourdir chaque message réseau) — un simple suivi
// par longueur de tableau se dérègle complètement dès que cette fenêtre
// "glisse" (partie un peu longue). state.logTotalCount, lui, ne fait que
// grandir et permet de savoir exactement combien de lignes ont été
// ajoutées depuis la dernière fois, même dans ce cas.
function processNewLogLines(state) {
  const missedCount = state.logTotalCount - lastLogTotalCount;
  lastLogTotalCount = state.logTotalCount;
  if (missedCount <= 0) return;
  const newLines = state.log.slice(-Math.min(missedCount, state.log.length));

  newLines.forEach((line) => {
    // --- Sons (inchangé) ---
    if (line.includes("remporte la partie")) ReachUpSounds.playVictory();
    else if (line.includes("faillite")) ReachUpSounds.playError();
    else if (line.includes("lance les dés")) ReachUpSounds.playDiceRoll();
    else if (line.includes("Carte Destin") || line.includes("Carte Spéciale") || line.includes("Événement mondial")) ReachUpSounds.playCardDraw();
    else if (line.includes("achète") || line.includes("paie") || line.includes("rembourse") || line.includes("reçoit")) ReachUpSounds.playCoin();

    // --- Carte animée (Destin / Spéciale / Événement mondial) ---
    const cardMatch = line.match(/tire une (Carte Destin|Carte Spéciale) : "(.+)"$/);
    if (cardMatch) {
      showCardReveal(cardMatch[1] === "Carte Destin" ? "❓ Carte Destin" : "✨ Carte Spéciale", cardMatch[2]);
      return;
    }
    const eventMatch = line.match(/Événement mondial : "(.+)" ! (.+) \(\d+ tours?\)$/);
    if (eventMatch) {
      showCardReveal(`🌍 Événement mondial — ${eventMatch[1]}`, eventMatch[2], { dramatic: true });
      return;
    }

    // --- Notifications temporaires (toasts) ---
    const playerId = findPlayerIdInLine(state, line);
    if (line.includes("achète") && !line.includes("Échange")) {
      showToast(`🏠 ${line}`, playerId);
    } else if (line.includes("remporte l'enchère")) {
      showToast(`🔨 ${line}`, playerId);
    } else if (line.includes("souscrit l'assurance")) {
      showToast(`🛡️ ${line}`, playerId);
    } else if (line.includes("reçoit le pouvoir")) {
      showToast(line, null);
    } else if (line.includes("accepte le prêt de")) {
      showToast(`💳 ${line}`, playerId);
    } else if (line.includes("Échange conclu entre")) {
      showToast(`🤝 ${line}`, null);
    } else if (line.includes("est en faillite")) {
      showToast(line, playerId);
    } else if (line.includes("abandonne la partie")) {
      showToast(`🚪 ${line}`, playerId);
    } else if (line.includes("est à découvert")) {
      showToast(`⚠️ ${line}`, playerId);
    } else if (line.includes("a rétabli sa situation financière")) {
      showToast(`✅ ${line}`, playerId);
    }
  });
}

// Retrouve l'identifiant du joueur dont le nom commence la ligne de
// journal (la quasi-totalité des messages du moteur suivent ce format),
// pour pouvoir teinter une notification avec sa couleur.
function findPlayerIdInLine(state, line) {
  const player = state.players.find((p) => line.startsWith(p.name));
  return player ? player.id : null;
}

// ---- Notifications temporaires ("toasts") ----
const toastContainer = document.getElementById("toast-container");

function showToast(message, playerId) {
  const toast = document.createElement("div");
  toast.className = "toast";
  if (playerId !== null && playerId !== undefined) {
    toast.style.borderLeftColor = ReachUpBoardView.PLAYER_COLORS[playerId % ReachUpBoardView.PLAYER_COLORS.length];
  }
  toast.textContent = message;
  toastContainer.appendChild(toast);

  // Petit délai avant l'apparition pour laisser jouer la transition CSS.
  const raf = window.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
  raf(() => toast.classList.add("toast--visible"));

  setTimeout(() => {
    toast.classList.remove("toast--visible");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ---- Carte animée (Destin / Spéciale / Événement mondial) ----
const cardReveal = document.getElementById("card-reveal");
const cardRevealTitle = document.getElementById("card-reveal-title");
const cardRevealText = document.getElementById("card-reveal-text");
let cardRevealTimeout = null;

function showCardReveal(title, text, options = {}) {
  cardRevealTitle.textContent = title;
  cardRevealText.textContent = text;
  cardReveal.classList.toggle("card-reveal--dramatic", !!options.dramatic);
  cardReveal.hidden = false;

  if (cardRevealTimeout) clearTimeout(cardRevealTimeout);
  cardRevealTimeout = setTimeout(() => {
    cardReveal.hidden = true;
  }, options.dramatic ? 4500 : 3500);
}

cardReveal.addEventListener("click", () => {
  cardReveal.hidden = true;
  if (cardRevealTimeout) clearTimeout(cardRevealTimeout);
});

// ---- Alerte automatique : une offre (échange ou prêt) m'est destinée ----
// On ouvre la fenêtre concernée toute seule dès qu'une offre NOUVELLE
// m'arrive, plutôt que d'attendre que le joueur pense à cliquer sur le
// bouton. On ne rouvre pas pour une offre déjà vue (l'utilisateur a pu la
// fermer volontairement sans décider tout de suite).
const seenIncomingOfferIds = new Set();

function checkIncomingOffers(state) {
  if (myPlayerId === null || myPlayerId === undefined) return;

  const incomingTrades = state.tradeOffers.filter((t) => t.toId === myPlayerId);
  const newTrade = incomingTrades.find((t) => !seenIncomingOfferIds.has(`trade-${t.id}`));
  incomingTrades.forEach((t) => seenIncomingOfferIds.add(`trade-${t.id}`));
  if (newTrade && tradeModal.hidden) {
    tradeModal.hidden = false;
    renderTradeModal();
  }

  const incomingLoans = (state.loanOffers || []).filter((o) => o.borrowerId === myPlayerId);
  const newLoan = incomingLoans.find((o) => !seenIncomingOfferIds.has(`loan-${o.id}`));
  incomingLoans.forEach((o) => seenIncomingOfferIds.add(`loan-${o.id}`));
  if (newLoan && loansModal.hidden) {
    loansModal.hidden = false;
    renderLoansModal();
  }
}

function renderSummaryModal() {
  if (!latestGameState) return;
  const state = latestGameState;

  const ranking = [...state.players]
    .map((p) => {
      const propsValue = state.board
        .filter((t) => t.owner === p.id)
        .reduce((sum, t) => sum + (t.mortgaged ? Math.floor((t.price || 0) / 2) : t.price || 0), 0);
      return { ...p, netWorth: p.money + propsValue };
    })
    .sort((a, b) => b.netWorth - a.netWorth);

  const rankingHtml = ranking
    .map((p, i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "";
      const dot = `<span class="tile-swatch" style="background:${ReachUpBoardView.PLAYER_COLORS[p.id % ReachUpBoardView.PLAYER_COLORS.length]}"></span>`;
      return `<li>${medal} ${dot}${p.name}${p.bankrupt ? " (faillite)" : ""} — ${p.netWorth}</li>`;
    })
    .join("");

  const current = state.players[state.currentPlayerIndex];
  const lastImportantLine = [...state.log].reverse().find((l) => !l.startsWith("---")) || "—";

  const activeLoansCount = (state.loans || []).length;
  const activeInsuranceCount = state.players.filter((p) => p.insurance).length;

  const chips = buildActiveRuleChips(state);

  document.getElementById("menu-summary-content").innerHTML = `
    <p><strong>Tour</strong> ${state.turnNumber}${state.turnLimit ? ` / ${state.turnLimit}` : ""} — au tour de <strong>${state.gameOver ? "—" : current.name}</strong></p>
    <h3 class="trade-section-title">Classement (valeur totale)</h3>
    <ul class="reference-list">${rankingHtml}</ul>
    <h3 class="trade-section-title">Dernier événement important</h3>
    <p class="properties-empty">${lastImportantLine}</p>
    <h3 class="trade-section-title">En cours</h3>
    <p class="properties-empty">💳 ${activeLoansCount} prêt(s) actif(s) — 🛡️ ${activeInsuranceCount} assurance(s) active(s)</p>
    ${chips ? `<h3 class="trade-section-title">Règles actives pour cette partie</h3><div class="active-rules-chips">${chips}</div>` : ""}
  `;
}

function renderGame(state) {
  latestGameState = state;
  ReachUpBoardView.updateBoard(state, myPlayerId);
  renderPlayers(state);
  renderActionArea(state);
  renderLog(state);
  renderActiveEventBanner(state);
  if (!propertiesModal.hidden) renderPropertiesModal();
  if (!tradeModal.hidden) renderTradeModal();
  if (!powerModal.hidden) renderPowerModal();
  if (!loansModal.hidden) renderLoansModal();
  if (!statsModal.hidden) renderStatsModal();
  if (!menuModal.hidden) renderSummaryModal();
  checkIncomingOffers(state);

  const me = state.players.find((p) => p.id === myPlayerId);
  btnOpenPower.hidden = !me || !me.power;
  btnOpenLoans.hidden = !(state.loansEnabled || state.insuranceEnabled);

  if (state.gameOver && !statsAutoShown) {
    statsAutoShown = true;
    renderStatsModal();
    statsModal.hidden = false;
  }
}

function renderActiveEventBanner(state) {
  const banner = document.getElementById("active-event-banner");
  if (!state.activeEvent) {
    banner.hidden = true;
    return;
  }
  const event = ReachUpWorldEvents.findEvent(state.activeEvent.id);
  banner.hidden = false;
  banner.textContent = `${event.icon} ${event.name} — ${event.description} (${state.activeEvent.turnsRemaining} tour(s) restant(s))`;
}

// Panneau "Règles actives" — Phase 8f. Générique : compare les réglages
// reçus aux valeurs par défaut du schéma (RULES_SCHEMA) et n'affiche que
// ce qui a été réellement changé pour cette partie, plus l'événement
// mondial en cours s'il y en a un. Comme il se base sur le schéma, toute
// nouvelle règle ajoutée plus tard y apparaît automatiquement.
function buildActiveRuleChips(state) {
  const chips = [];

  if (state.activeEvent) {
    const event = ReachUpWorldEvents.findEvent(state.activeEvent.id);
    chips.push(`<span class="rule-chip rule-chip--event">${event.icon} ${event.name} (${state.activeEvent.turnsRemaining}t)</span>`);
  }

  if (latestGameSettings) {
    RULES_SCHEMA.forEach((category) => {
      category.rules.forEach((rule) => {
        const value = latestGameSettings[rule.id];
        if (value === rule.default) return; // rien de spécial pour cette règle, on ne l'affiche pas

        let text;
        if (rule.type === "boolean") {
          text = rule.label.replace(/^[^\w]*\s*/, ""); // retire l'emoji déjà présent dans le libellé
        } else if (rule.type === "number") {
          text = `${rule.label} : ${value}`;
        } else {
          const option = rule.options.find((o) => o.value === value);
          text = `${rule.label} : ${option ? option.label : value}`;
        }
        chips.push(`<span class="rule-chip">${text}</span>`);
      });
    });
  }

  return chips.join("");
}

// Affiche brièvement un "+200" ou "-160" flottant près de l'argent d'un
// joueur dès que celui-ci change — un suivi des transactions hyper clair,
// sans avoir besoin d'un nouveau panneau : ça vient se poser exactement
// là où on regarde déjà (le montant lui-même).
let lastKnownMoney = {};
function showMoneyDelta(playerId, currentMoney) {
  const previous = lastKnownMoney[playerId];
  lastKnownMoney[playerId] = currentMoney;
  if (previous === undefined || previous === currentMoney) return;

  const moneyEl = document.querySelector(`[data-money-for="${playerId}"]`);
  if (!moneyEl) return;

  const delta = currentMoney - previous;
  const badge = document.createElement("span");
  badge.className = `money-delta ${delta > 0 ? "money-delta--positive" : "money-delta--negative"}`;
  badge.textContent = delta > 0 ? `+${delta}` : `${delta}`;
  moneyEl.appendChild(badge);
  setTimeout(() => badge.remove(), 1800);
}

function renderPlayers(state) {
  playersPanel.innerHTML = "";

  state.players.forEach((player) => {
    const tile = state.board[player.position];
    const propertiesCount = state.board.filter((t) => t.owner === player.id).length;

    let statusLabel = "Actif";
    if (player.bankrupt) statusLabel = "En faillite";
    else if (player.inDebt) statusLabel = "⚠️ À découvert";
    else if (player.inJail) statusLabel = "En prison";

    const isCurrent = !state.gameOver && state.currentPlayerIndex === player.id;

    const card = document.createElement("div");
    card.className = "player-card";
    if (player.bankrupt) card.classList.add("player-card--bankrupt");
    if (player.inDebt) card.classList.add("player-card--indebt");
    if (isCurrent) card.classList.add("player-card--current");
    card.style.borderLeft = `4px solid ${ReachUpBoardView.PLAYER_COLORS[player.id % ReachUpBoardView.PLAYER_COLORS.length]}`;

    const powerStatus = player.power
      ? player.power.used
        ? " (utilisé)"
        : player.power.armed
        ? " (activé, en attente)"
        : ""
      : "";
    const powerDef = player.power && player.power.id ? ReachUpPowers.findPower(player.power.id) : null;
    const powerBadgeHtml = player.power
      ? player.power.hidden
        ? `<p class="power-badge">🔒 Pouvoir en réserve${powerStatus}</p>`
        : powerDef
        ? `<p class="power-badge">${powerDef.icon} ${powerDef.name}${powerStatus}</p>`
        : ""
      : "";

    card.innerHTML = `
      <h3>${player.name}${player.id === myPlayerId ? " (toi)" : ""}</h3>
      <p class="player-money" data-money-for="${player.id}">💰 ${player.money}</p>
      <p>📍 ${ReachUpBoardView.tileSwatch(tile)} ${tile.name}</p>
      <p>🏷️ ${propertiesCount} propriété(s)</p>
      ${powerBadgeHtml}
      <p class="player-status">${statusLabel}</p>
    `;
    playersPanel.appendChild(card);
    showMoneyDelta(player.id, player.money);
  });

  if (state.gameOver) {
    const banner = document.createElement("div");
    banner.className = "winner-banner";
    banner.textContent = `🏆 ${state.winner.name} remporte la partie !`;
    playersPanel.appendChild(banner);
  }
}

// Compte à rebours de l'enchère classique : la fenêtre de réponse (repart
// à 0 à chaque surenchère) ET le plafond absolu de la partie, tous deux
// fixés par le serveur — le client se contente d'afficher le temps
// restant jusqu'à ces échéances, sans rien décider lui-même.
let auctionCountdownInterval = null;
function stopAuctionCountdown() {
  if (auctionCountdownInterval) {
    clearInterval(auctionCountdownInterval);
    auctionCountdownInterval = null;
  }
}
function startAuctionCountdown(auction) {
  stopAuctionCountdown();
  if (!auction.responseDeadline) return;
  const tick = () => {
    const el = document.getElementById("auction-countdowns");
    if (!el) {
      stopAuctionCountdown();
      return;
    }
    const responseLeft = Math.max(0, Math.ceil((auction.responseDeadline - Date.now()) / 1000));
    const hardLeft = auction.hardDeadline ? Math.max(0, Math.ceil((auction.hardDeadline - Date.now()) / 1000)) : null;
    const urgent = responseLeft <= 3 || (hardLeft !== null && hardLeft <= 5);
    el.innerHTML = `<p class="auction-countdown ${urgent ? "auction-countdown--urgent" : ""}">⏱️ ${responseLeft}s${hardLeft !== null ? ` · ⏳ ${hardLeft}s max` : ""}</p>`;
  };
  tick();
  auctionCountdownInterval = setInterval(tick, 250);
}

function renderActionArea(state) {
  const preserved = captureFormValues(actionArea);
  actionArea.innerHTML = "";
  try {
  if (state.gameOver) {
    const box = document.createElement("div");
    box.className = "action-box";
    box.innerHTML = `
      <button id="btn-reopen-stats" class="btn-primary">📊 Voir les statistiques</button>
      <button id="btn-return-menu">🏠 Retour au menu</button>
    `;
    actionArea.appendChild(box);
    document.getElementById("btn-reopen-stats").addEventListener("click", () => {
      renderStatsModal();
      statsModal.hidden = false;
    });
    document.getElementById("btn-return-menu").addEventListener("click", () => {
      clearSession();
      window.location.reload();
    });
    return;
  }

  // Cas -1 : un joueur est à découvert — la partie est en pause tant
  // qu'il n'a pas vendu/hypothéqué/emprunté (ou qu'il ne lui reste plus
  // aucune option, auquel cas la faillite est déclarée automatiquement).
  const debtor = state.players.find((p) => p.inDebt);
  if (debtor) {
    const box = document.createElement("div");
    box.className = "action-box";
    if (debtor.id === myPlayerId) {
      box.innerHTML = `
        <p>⚠️ Tu es à découvert (<strong>${debtor.money}</strong>). Vends une maison, hypothèque une propriété, ou espère un prêt d'un adversaire avant que la partie ne continue.</p>
        <button id="btn-debt-open-properties" class="btn-primary">🏠 Gérer mes propriétés</button>
      `;
      actionArea.appendChild(box);
      document.getElementById("btn-debt-open-properties").addEventListener("click", () => {
        propertiesModal.hidden = false;
        renderPropertiesModal();
      });
    } else {
      box.innerHTML = `<p>⏳ En attente que <strong>${debtor.name}</strong> règle sa situation financière...</p>`;
      actionArea.appendChild(box);
    }
    return;
  }

  // Cas -0.75 : une carte Destin/Spéciale attend d'être tirée (clic requis).
  if (state.pendingChanceDraw) {
    const box = document.createElement("div");
    box.className = "action-box";
    if (state.pendingChanceDraw.playerId === myPlayerId) {
      const label = state.pendingChanceDraw.tileType === "special" ? "Carte Spéciale" : "Carte Destin";
      box.innerHTML = `
        <p>🎴 Une ${label} t'attend...</p>
        <button id="btn-draw-chance" class="btn-primary">Tirer la carte</button>
      `;
      actionArea.appendChild(box);
      document.getElementById("btn-draw-chance").addEventListener("click", () => {
        socket.emit("game:drawChanceCard");
      });
    } else {
      const drawerName = state.players[state.pendingChanceDraw.playerId].name;
      box.innerHTML = `<p class="action-box--waiting">🎴 ${drawerName} s'apprête à tirer une carte...</p>`;
      actionArea.appendChild(box);
    }
    return;
  }

  // Cas -0.5 : le pouvoir "Libre arrêt" est en attente d'un choix.
  if (state.pendingMoveChoice) {
    const box = document.createElement("div");
    box.className = "action-box";
    if (state.pendingMoveChoice.playerId === myPlayerId) {
      const me = state.players.find((p) => p.id === myPlayerId);
      const options = Array.from({ length: state.pendingMoveChoice.maxDistance }, (_, i) => i + 1)
        .map((dist) => {
          const tileIndex = (me.position + dist) % state.board.length;
          const tile = state.board[tileIndex];
          return `<option value="${dist}">${dist} case(s) → ${tile.name}</option>`;
        })
        .join("");
      box.innerHTML = `
        <p>🎯 Choisis où t'arrêter (jusqu'à ${state.pendingMoveChoice.maxDistance} case(s)) :</p>
        <select id="landing-distance-select">${options}</select>
        <button id="btn-confirm-landing" class="btn-primary">Confirmer</button>
      `;
      actionArea.appendChild(box);
      document.getElementById("btn-confirm-landing").addEventListener("click", () => {
        const distance = Number(document.getElementById("landing-distance-select").value);
        socket.emit("game:chooseLandingDistance", { distance });
      });
    } else {
      const p = state.players.find((pl) => pl.id === state.pendingMoveChoice.playerId);
      box.innerHTML = `<p>⏳ ${p ? p.name : "Un joueur"} choisit où s'arrêter...</p>`;
      actionArea.appendChild(box);
    }
    return;
  }

  // Cas 0 : une enchère est en cours (secrète ou classique)
  if (state.pendingAuction) {
    const tile = state.board[state.pendingAuction.tileIndex];

    if (state.pendingAuction.mode === "classic") {
      const auction = state.pendingAuction;
      const box = document.createElement("div");
      box.className = "action-box action-box--compact";

      const iAmEligible = (auction.eligibleBidders || []).includes(myPlayerId);
      const iAmLeading = auction.currentBidderId === myPlayerId;
      const bidderName = auction.currentBidderId !== null ? state.players[auction.currentBidderId].name : null;

      const headerHtml = `
        <p class="auction-header">🔨 <strong>${tile.short || tile.name}</strong> — mise : <strong>${auction.currentBid}</strong>${bidderName ? ` (${bidderName})` : ""}</p>
        <div id="auction-countdowns" class="auction-countdowns"></div>
      `;

      if (iAmEligible) {
        const minBid = auction.currentBid + 1;
        box.innerHTML = `
          ${headerHtml}
          <div class="quick-bid-row">
            <button class="btn-quick-bid" data-quick-bid="10">+10</button>
            <button class="btn-quick-bid" data-quick-bid="50">+50</button>
            <button class="btn-quick-bid" data-quick-bid="100">+100</button>
          </div>
          <details class="auction-custom-bid">
            <summary>Montant précis...</summary>
            <input type="number" id="auction-raise-input" min="${minBid}" value="${minBid}" class="auction-input" />
            <button id="btn-raise-bid">OK</button>
          </details>
          <button id="btn-pass-bid" class="btn-text-link">Me retirer</button>
        `;
        actionArea.appendChild(box);
        box.querySelectorAll(".btn-quick-bid").forEach((btn) => {
          btn.addEventListener("click", () => {
            socket.emit("game:auctionRaise", { amount: auction.currentBid + Number(btn.dataset.quickBid) });
          });
        });
        document.getElementById("btn-raise-bid").addEventListener("click", () => {
          const amount = Number(document.getElementById("auction-raise-input").value) || 0;
          socket.emit("game:auctionRaise", { amount });
        });
        document.getElementById("btn-pass-bid").addEventListener("click", () => {
          socket.emit("game:auctionPass");
        });
      } else {
        const waitingMessage = iAmLeading ? "Meilleure mise pour l'instant, en attente..." : "Tu ne participes plus.";
        box.innerHTML = `
          ${headerHtml}
          <p class="action-box--waiting">${waitingMessage}</p>
        `;
        actionArea.appendChild(box);
      }
      startAuctionCountdown(auction);
      return;
    }

    stopAuctionCountdown();

    // mode "secret"
    if (state.pendingAuction.pendingPlayers.includes(myPlayerId)) {
      const box = document.createElement("div");
      box.className = "action-box";
      const spyBids = state.pendingAuction.bids;
      const spyReveal =
        spyBids && Object.keys(spyBids).length > 0
          ? `<p class="properties-empty">🕵️ Mises déjà déposées (pouvoir Espion) : ${Object.entries(spyBids)
              .map(([pid, amount]) => `${state.players[pid].name} : ${amount}`)
              .join(", ")}</p>`
          : "";
      box.innerHTML = `
        <p>🔨 Enchère scellée sur ${ReachUpBoardView.tileSwatch(tile)} <strong>${tile.name}</strong> (prix normal : ${tile.price})</p>
        ${spyReveal}
        <div class="stepper-row">
          <button id="btn-bid-decrease" class="btn-stepper" type="button" title="Baisser de 2">− 2</button>
          <input type="number" id="auction-bid-input" min="0" value="0" class="auction-input" />
          <button id="btn-bid-increase" class="btn-stepper" type="button" title="Augmenter de 10">+ 10</button>
        </div>
        <button id="btn-submit-bid" class="btn-primary">Miser ce montant (0 = passer)</button>
      `;
      actionArea.appendChild(box);
      document.getElementById("btn-bid-increase").addEventListener("click", () => {
        const input = document.getElementById("auction-bid-input");
        input.value = Math.max(0, (Number(input.value) || 0) + 10);
      });
      document.getElementById("btn-bid-decrease").addEventListener("click", () => {
        const input = document.getElementById("auction-bid-input");
        input.value = Math.max(0, (Number(input.value) || 0) - 2);
      });
      document.getElementById("btn-submit-bid").addEventListener("click", () => {
        const amount = Number(document.getElementById("auction-bid-input").value) || 0;
        socket.emit("game:auctionBid", { amount });
      });
    } else {
      showWaitingBox(`🔨 Enchère en cours sur ${tile.name}, en attente des autres joueurs...`);
    }
    return;
  }

  // Cas 1 : quelqu'un doit décider d'acheter ou non
  if (state.pendingDecision) {
    if (state.pendingDecision.playerId === myPlayerId) {
      const tile = state.board[state.pendingDecision.tileIndex];
      const box = document.createElement("div");
      box.className = "action-box";
      box.innerHTML = `
        <p>Acheter ${ReachUpBoardView.tileSwatch(tile)} <strong>${tile.name}</strong> pour <strong>${tile.price}</strong> ?</p>
        <button id="btn-buy" class="btn-primary">Acheter</button>
        <button id="btn-pass">Passer</button>
      `;
      actionArea.appendChild(box);
      document.getElementById("btn-buy").addEventListener("click", () => {
        socket.emit("game:buyDecision", { buy: true });
      });
      document.getElementById("btn-pass").addEventListener("click", () => {
        socket.emit("game:buyDecision", { buy: false });
      });
    } else {
      const waitingPlayer = state.players[state.pendingDecision.playerId];
      showWaitingBox(`En attente de la décision d'achat de ${waitingPlayer.name}...`);
    }
    return;
  }

  // Cas 2 : c'est mon tour de lancer les dés
  const isMyTurn = state.currentPlayerIndex === myPlayerId;
  if (isMyTurn) {
    const box = document.createElement("div");
    box.className = "action-box";
    const me = state.players.find((p) => p.id === myPlayerId);
    if (me && me.inJail) {
      const canAfford = me.money >= 50;
      box.innerHTML = `
        <p>🔒 Tu es en prison. Paie 50 pour sortir tout de suite, ou tente ta chance : un double te libère et te déplace directement du nombre de cases obtenu.</p>
        <button id="btn-pay-jail" class="btn-primary" ${canAfford ? "" : "disabled"}>💰 Payer 50 et sortir</button>
        <button id="btn-roll" class="btn-secondary">🎲 Lancer les dés (tenter un double)</button>
        ${canAfford ? "" : '<p class="properties-empty">Pas assez d\'argent pour payer l\'amende.</p>'}
      `;
      actionArea.appendChild(box);
      const payBtn = document.getElementById("btn-pay-jail");
      if (canAfford) payBtn.addEventListener("click", () => socket.emit("game:payJailFine"));
      document.getElementById("btn-roll").addEventListener("click", () => socket.emit("game:roll"));
      return;
    }
    box.innerHTML = `<button id="btn-roll" class="btn-primary">🎲 Lancer les dés</button>`;
    actionArea.appendChild(box);
    document.getElementById("btn-roll").addEventListener("click", () => {
      socket.emit("game:roll");
    });
    return;
  }

  // Cas 3 : c'est le tour de quelqu'un d'autre
  const currentName = state.players[state.currentPlayerIndex].name;
  showWaitingBox(`En attente du tour de ${currentName}...`);
  } finally {
    restoreFormValues(actionArea, preserved);
  }
}

function showWaitingBox(text) {
  const box = document.createElement("div");
  box.className = "action-box action-box--waiting";
  box.textContent = text;
  actionArea.appendChild(box);
}

// Devine une catégorie visuelle pour une ligne de journal donnée, à partir
// de mots-clés déjà présents dans les messages du moteur (aucune règle du
// jeu à connaître ici, juste du texte).
function classifyLogLine(line) {
  if (line.startsWith("---")) return "turn";
  if (line.includes("remporte la partie") || line.includes("Événement mondial")) return "major";
  if (line.includes("faillite")) return "negative";
  if (line.includes("achète") || line.includes("paie") || line.includes("perd")) return "negative-soft";
  if (line.includes("reçoit") || line.includes("gagne") || line.includes("remporte") || line.includes("touche")) return "positive";
  return "neutral";
}

function renderLog(state) {
  const boardLogPanel = document.getElementById("board-log-panel");
  if (boardLogPanel) {
    const recent = state.log.slice(-10);
    boardLogPanel.innerHTML = recent
      .map((line) => `<div class="log-line log-line--${classifyLogLine(line)}">${line}</div>`)
      .join("");
    boardLogPanel.scrollTop = boardLogPanel.scrollHeight;
  }

  const fullLogContent = document.getElementById("full-log-content");
  if (fullLogContent && !fullLogModal.hidden) {
    fullLogContent.innerHTML = state.log
      .map((line) => `<div class="log-line log-line--${classifyLogLine(line)}">${line}</div>`)
      .join("");
    fullLogContent.scrollTop = fullLogContent.scrollHeight;
  }
}

function renderPropertiesModal() {
  if (!latestGameState) return;
  document.getElementById("properties-error").textContent = "";

  let html = "";

  if (latestGameState.forcedAuctionsPerGame > 0) {
    const me = latestGameState.players.find((p) => p.id === myPlayerId);
    const used = me ? me.forcedAuctionsUsed : 0;
    const remaining = latestGameState.forcedAuctionsPerGame - used;
    const availableTiles = latestGameState.board
      .map((tile, index) => ({ tile, index }))
      .filter(({ tile }) => ["property", "airport", "utility"].includes(tile.type) && tile.owner === null);

    html += `<h3 class="trade-section-title">🔨 Enchère forcée (${remaining}/${latestGameState.forcedAuctionsPerGame} restante(s))</h3>`;
    if (remaining <= 0) {
      html += `<p class="properties-empty">Tu as déjà utilisé toutes tes enchères forcées.</p>`;
    } else if (availableTiles.length === 0) {
      html += `<p class="properties-empty">Aucune case libre à mettre aux enchères.</p>`;
    } else {
      const options = availableTiles
        .map(({ tile, index }) => `<option value="${index}">${tile.name} (${tile.price})</option>`)
        .join("");
      html += `
        <div class="trade-form">
          <label>Case à mettre aux enchères <select id="forced-auction-target">${options}</select></label>
          <button id="btn-start-forced-auction" class="btn-primary">Déclencher l'enchère</button>
        </div>
      `;
    }
  }

  const myTiles = latestGameState.board
    .map((tile, index) => ({ tile, index }))
    .filter(({ tile }) => tile.owner === myPlayerId);

  html += `<h3 class="trade-section-title">🏠 Mes propriétés</h3>`;
  html +=
    myTiles.length === 0
      ? `<p class="properties-empty">Tu ne possèdes aucune propriété pour le moment.</p>`
      : myTiles.map(({ tile, index }) => renderPropertyRow(tile, index)).join("");

  propertiesList.innerHTML = html;

  const forcedAuctionBtn = document.getElementById("btn-start-forced-auction");
  if (forcedAuctionBtn) {
    forcedAuctionBtn.addEventListener("click", () => {
      const tileIndex = Number(document.getElementById("forced-auction-target").value);
      socket.emit("game:startForcedAuction", { tileIndex });
    });
  }

  // Boutons "construire"
  propertiesList.querySelectorAll("[data-action='build']").forEach((btn) => {
    btn.addEventListener("click", () => {
      socket.emit("game:build", { tileIndex: Number(btn.dataset.tile) });
    });
  });
  propertiesList.querySelectorAll("[data-action='sellHouse']").forEach((btn) => {
    btn.addEventListener("click", () => {
      socket.emit("game:sellHouse", { tileIndex: Number(btn.dataset.tile) });
    });
  });
  propertiesList.querySelectorAll("[data-action='mortgage']").forEach((btn) => {
    btn.addEventListener("click", () => {
      socket.emit("game:mortgage", { tileIndex: Number(btn.dataset.tile) });
    });
  });
  propertiesList.querySelectorAll("[data-action='unmortgage']").forEach((btn) => {
    btn.addEventListener("click", () => {
      socket.emit("game:unmortgage", { tileIndex: Number(btn.dataset.tile) });
    });
  });
}

function renderPropertyRow(tile, index) {
  const ownsFullSet =
    tile.type === "property" &&
    latestGameState.board.filter((t) => t.type === "property" && t.group === tile.group).every((t) => t.owner === myPlayerId);

  let buildingLabel = "";
  if (tile.type === "property") {
    buildingLabel = tile.houses === 5 ? "🏨 Hôtel" : tile.houses > 0 ? `🏠 x${tile.houses}` : "";
  }

  const buttons = [];

  if (tile.mortgaged) {
    const unmortgageCost = Math.ceil((tile.price / 2) * 1.1);
    buttons.push(`<button data-action="unmortgage" data-tile="${index}">🔓 Lever l'hypothèque (${unmortgageCost})</button>`);
  } else {
    if (tile.type === "property" && ownsFullSet && tile.houses < 5) {
      buttons.push(`<button data-action="build" data-tile="${index}" class="btn-primary">🏠 Construire (${tile.houseCost})</button>`);
    }
    if (tile.type === "property" && tile.houses > 0) {
      buttons.push(`<button data-action="sellHouse" data-tile="${index}">➖ Vendre une maison (+${Math.floor(tile.houseCost / 2)})</button>`);
    }
    if (tile.houses === 0) {
      const mortgageAmount = Math.floor(tile.price / 2);
      buttons.push(`<button data-action="mortgage" data-tile="${index}">🏦 Hypothéquer (+${mortgageAmount})</button>`);
    }
  }

  return `
    <div class="property-row ${tile.mortgaged ? "property-row--mortgaged" : ""}">
      <div class="property-row__info">
        ${ReachUpBoardView.tileSwatch(tile)} <strong>${tile.name}</strong> ${buildingLabel}
        ${tile.mortgaged ? '<span class="mortgaged-tag">Hypothéquée</span>' : ""}
      </div>
      <div class="property-row__actions">${buttons.join("")}</div>
    </div>
  `;
}

function renderPowerModal() {
  if (!latestGameState) return;
  document.getElementById("power-error").textContent = "";

  const me = latestGameState.players.find((p) => p.id === myPlayerId);
  if (!me || !me.power) {
    powerContent.innerHTML = `<p class="properties-empty">Tu n'as reçu aucun pouvoir pour cette partie.</p>`;
    return;
  }

  const power = ReachUpPowers.findPower(me.power.id);
  const isMyTurn = !latestGameState.gameOver && latestGameState.currentPlayerIndex === myPlayerId;

  let html = `
    <div class="property-row">
      <div class="property-row__info">
        <strong>${power.icon} ${power.name}</strong><br />
        ${power.description}
      </div>
    </div>
  `;

  if (!me.power.used) {
    const cost = latestGameState.powerRerollCost || 150;
    const canAfford = me.money >= cost;
    html += `
      <div class="trade-form">
        <button id="btn-reroll-power" class="btn-text-link" type="button" ${canAfford ? "" : "disabled"}>
          🔄 Changer de pouvoir (${cost})
        </button>
        ${canAfford ? "" : `<p class="properties-empty">Pas assez d'argent pour changer de pouvoir.</p>`}
      </div>
    `;
  }

  if (me.power.used) {
    html += `<p class="properties-empty">Ce pouvoir a déjà été utilisé.</p>`;
  } else if (power.mode === "arm" && me.power.armed) {
    html += `<p class="properties-empty">🔔 Activé — en attente de son effet.</p>`;
  } else if (!isMyTurn) {
    html += `<p class="properties-empty">⏳ Ce pouvoir ne peut être activé qu'à ton tour.</p>`;
  } else if (power.mode === "arm") {
    html += `
      <div class="trade-form">
        <button id="btn-arm-power" class="btn-primary">Activer maintenant</button>
      </div>
    `;
  } else if (power.id === "teleport") {
    const options = latestGameState.board.map((t, i) => `<option value="${i}">${t.name}</option>`).join("");
    html += `
      <div class="trade-form">
        <label>Se téléporter sur
          <select id="power-teleport-target">${options}</select>
        </label>
        <button id="btn-use-power" class="btn-primary">Utiliser le pouvoir</button>
      </div>
    `;
  } else if (power.id === "theft") {
    const others = latestGameState.players.filter(
      (p) => p.id !== myPlayerId && !p.bankrupt && p.money > ReachUpPowers.STEAL_MIN_TARGET_MONEY
    );
    if (others.length === 0) {
      html += `<p class="properties-empty">Aucune cible disponible (il faut plus de ${ReachUpPowers.STEAL_MIN_TARGET_MONEY} sur son compte).</p>`;
    } else {
      const options = others.map((p) => `<option value="${p.id}">${p.name} (${p.money})</option>`).join("");
      html += `
        <div class="trade-form">
          <label>Voler
            <select id="power-steal-target">${options}</select>
          </label>
          <button id="btn-use-power" class="btn-primary">Utiliser le pouvoir</button>
        </div>
      `;
    }
  } else if (power.id === "bank_loan") {
    html += `
      <div class="trade-form">
        <button id="btn-use-power" class="btn-primary">Recevoir ${ReachUpPowers.BANK_LOAN_AMOUNT} de la banque</button>
      </div>
    `;
  } else if (power.id === "rent_collector") {
    html += `
      <div class="trade-form">
        <button id="btn-use-power" class="btn-primary">Activer (loyers redirigés pendant ${ReachUpPowers.RENT_COLLECTOR_DURATION_TURNS} tours)</button>
      </div>
    `;
  } else if (power.id === "vacation_claim") {
    html += `
      <div class="trade-form">
        <button id="btn-use-power" class="btn-primary">Récupérer la cagnotte (${latestGameState.vacationPot || 0})</button>
      </div>
    `;
  } else if (power.id === "debt_bailout") {
    if (!me.inDebt) {
      html += `<p class="properties-empty">Utilisable uniquement quand tu es à découvert.</p>`;
    } else {
      html += `
        <div class="trade-form">
          <button id="btn-use-power" class="btn-primary">Combler mon négatif (${me.money})</button>
        </div>
      `;
    }
  } else if (power.id === "house_wrecker") {
    const others = latestGameState.players.filter((p) => p.id !== myPlayerId && !p.bankrupt);
    if (others.length === 0) {
      html += `<p class="properties-empty">Aucune cible disponible.</p>`;
    } else {
      const options = others.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
      html += `
        <div class="trade-form">
          <label>Démolir chez
            <select id="power-wrecker-target">${options}</select>
          </label>
          <button id="btn-use-power" class="btn-primary">Utiliser le pouvoir</button>
        </div>
      `;
    }
  } else if (power.id === "forced_swap") {
    const swappable = latestGameState.board
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => ["property", "airport", "utility"].includes(t.type) && t.owner !== null && (t.houses || 0) === 0);
    if (swappable.length < 2) {
      html += `<p class="properties-empty">Pas assez de propriétés échangeables (sans maison) sur le plateau.</p>`;
    } else {
      const options = swappable.map(({ t, i }) => `<option value="${i}">${t.name} (${latestGameState.players[t.owner].name})</option>`).join("");
      html += `
        <div class="trade-form">
          <label>Première case
            <select id="power-swap-a">${options}</select>
          </label>
          <label>Seconde case
            <select id="power-swap-b">${options}</select>
          </label>
          <button id="btn-use-power" class="btn-primary">Échanger</button>
        </div>
      `;
    }
  }

  powerContent.innerHTML = html;

  const armBtn = document.getElementById("btn-arm-power");
  if (armBtn) {
    armBtn.addEventListener("click", () => socket.emit("game:armPower"));
  }

  const rerollBtn = document.getElementById("btn-reroll-power");
  if (rerollBtn) {
    rerollBtn.addEventListener("click", () => socket.emit("game:rerollPower"));
  }

  const useBtn = document.getElementById("btn-use-power");
  if (useBtn && power.id === "teleport") {
    useBtn.addEventListener("click", () => {
      const tileIndex = Number(document.getElementById("power-teleport-target").value);
      socket.emit("game:useTeleport", { tileIndex });
    });
  } else if (useBtn && power.id === "theft") {
    useBtn.addEventListener("click", () => {
      const targetId = Number(document.getElementById("power-steal-target").value);
      socket.emit("game:useSteal", { targetId });
    });
  } else if (useBtn && power.id === "bank_loan") {
    useBtn.addEventListener("click", () => {
      socket.emit("game:useBankLoan");
    });
  } else if (useBtn && power.id === "rent_collector") {
    useBtn.addEventListener("click", () => {
      socket.emit("game:useRentCollector");
    });
  } else if (useBtn && power.id === "vacation_claim") {
    useBtn.addEventListener("click", () => {
      socket.emit("game:useVacationClaim");
    });
  } else if (useBtn && power.id === "debt_bailout") {
    useBtn.addEventListener("click", () => {
      socket.emit("game:useDebtBailout");
    });
  } else if (useBtn && power.id === "house_wrecker") {
    useBtn.addEventListener("click", () => {
      const targetId = Number(document.getElementById("power-wrecker-target").value);
      socket.emit("game:useHouseWrecker", { targetId });
    });
  } else if (useBtn && power.id === "forced_swap") {
    useBtn.addEventListener("click", () => {
      const tileIndexA = Number(document.getElementById("power-swap-a").value);
      const tileIndexB = Number(document.getElementById("power-swap-b").value);
      if (tileIndexA === tileIndexB) {
        document.getElementById("power-error").textContent = "Choisis deux cases différentes.";
        return;
      }
      socket.emit("game:useForcedSwap", { tileIndexA, tileIndexB });
    });
  }
}

// Fenêtre de détail d'une case : cliquée depuis le plateau (n'importe
// quel joueur, n'importe quand — information toujours publique).
function renderTileDetailModal(tileIndex) {
  if (!latestGameState) return;
  const tile = latestGameState.board[tileIndex];
  const content = document.getElementById("tile-detail-content");
  document.getElementById("tile-detail-title").innerHTML = `${ReachUpBoardView.tileSwatch(tile)} ${tile.name}`;

  const ownerLine = () => {
    if (tile.owner === null || tile.owner === undefined) return `<p>Libre — appartient à personne.</p>`;
    const owner = latestGameState.players[tile.owner];
    return `<p>Propriétaire : <strong>${owner.name}</strong>${tile.mortgaged ? " (hypothéquée 🔒)" : ""}</p>`;
  };

  if (tile.type === "property") {
    const rows = [0, 1, 2, 3, 4, 5]
      .map((houses) => {
        const rent = tile.rent * latestGameState.rentMultipliersByHouses[houses];
        const label = houses === 0 ? "Juste la propriété" : houses === 5 ? "Hôtel" : `${houses} maison(s)`;
        const isCurrent = tile.houses === houses;
        return `<tr class="${isCurrent ? "tile-detail-row--current" : ""}"><td>${label}</td><td>${rent}</td></tr>`;
      })
      .join("");
    content.innerHTML = `
      <p>Prix d'achat : <strong>${tile.price}</strong> — Coût d'une maison/étage : <strong>${tile.houseCost}</strong></p>
      ${ownerLine()}
      <table class="tile-detail-table">
        <thead><tr><th>Situation</th><th>Loyer</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="properties-empty">Loyer x2 si tu possèdes tout le groupe (sans maison).</p>
    `;
  } else if (tile.type === "airport") {
    const rows = latestGameState.airportRentTable
      .map((rent, i) => `<tr><td>${i + 1} aéroport(s) possédé(s)</td><td>${rent}</td></tr>`)
      .join("");
    content.innerHTML = `
      <p>Prix d'achat : <strong>${tile.price}</strong></p>
      ${ownerLine()}
      <table class="tile-detail-table">
        <thead><tr><th>Situation</th><th>Loyer</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } else if (tile.type === "utility") {
    content.innerHTML = `
      <p>Prix d'achat : <strong>${tile.price}</strong></p>
      ${ownerLine()}
      <p>Loyer = lancer de dés × <strong>4</strong> si tu possèdes cette seule compagnie, × <strong>10</strong> si tu possèdes les deux.</p>
    `;
  } else if (tile.type === "tax") {
    content.innerHTML = `<p>Case Taxe : paie <strong>${tile.amount}</strong> en y passant.</p>`;
  } else {
    const descriptions = {
      go: "Case Départ : touche ton salaire chaque fois que tu passes par ici.",
      jail: "Prison : simple visite si tu n'y es pas envoyé, sinon il faut payer, utiliser une carte, ou faire un double pour sortir.",
      vacation: "Vacances : aucun effet, sauf si la cagnotte de Vacances est activée (elle est alors reversée ici).",
      "go-to-jail": "Envoie directement en prison, sans passer par la case Départ.",
      chance: "Carte Destin : tire un effet aléatoire (argent, déplacement, prison...).",
      special: "Carte Spéciale : si les événements mondiaux sont activés, déclenche un événement temporaire pour toute la table.",
    };
    content.innerHTML = `<p>${descriptions[tile.type] || "Case sans effet particulier."}</p>`;
  }
}

function renderReferenceModal() {
  const content = document.getElementById("reference-content");
  const chanceList = latestGameState
    ? latestGameState.chanceCardDescriptions.map((d) => `<li>${d}</li>`).join("")
    : "<li>Charge une partie pour voir la liste.</li>";

  const eventsList = ReachUpWorldEvents.WORLD_EVENTS.map(
    (e) => `<li>${e.icon} <strong>${e.name}</strong> — ${e.description}</li>`
  ).join("");

  const powersList = ReachUpPowers.POWERS.map(
    (p) => `<li>${p.icon} <strong>${p.name}</strong> (${p.mode === "arm" ? "à activer, effet différé" : "effet immédiat"}) — ${p.description}</li>`
  ).join("");

  content.innerHTML = `
    <h3 class="trade-section-title">❓ Cartes Destin / Spéciales possibles</h3>
    <ul class="reference-list">${chanceList}</ul>
    <h3 class="trade-section-title">🌍 Événements mondiaux possibles</h3>
    <ul class="reference-list">${eventsList}</ul>
    <h3 class="trade-section-title">🔮 Pouvoirs possibles</h3>
    <ul class="reference-list">${powersList}</ul>
  `;
}

function renderStatsModal() {
  if (!latestGameState) return;
  const content = document.getElementById("stats-content");
  const state = latestGameState;

  const withNetWorth = state.players.map((p) => {
    const propsValue = state.board
      .filter((t) => t.owner === p.id)
      .reduce((sum, t) => sum + (t.mortgaged ? Math.floor((t.price || 0) / 2) : t.price || 0), 0);
    return { ...p, netWorth: p.money + propsValue, propertiesCount: state.board.filter((t) => t.owner === p.id).length };
  });
  withNetWorth.sort((a, b) => b.netWorth - a.netWorth);

  const header = state.gameOver
    ? `<p class="properties-empty">🏆 <strong>${state.winner.name}</strong> remporte la partie en ${state.turnNumber} tours, sur un plateau de ${state.board.length} cases.</p>`
    : `<p class="properties-empty">Partie en cours — tour ${state.turnNumber}, classement provisoire ci-dessous.</p>`;

  const cards = withNetWorth
    .map((p, rank) => {
      const s = p.stats;
      return `
        <div class="property-row stats-card">
          <div class="property-row__info">
            <strong>${rank === 0 ? "🥇 " : rank === 1 ? "🥈 " : rank === 2 ? "🥉 " : ""}${p.name}${p.bankrupt ? " (faillite)" : ""}</strong>
            <div class="stats-grid">
              <span>💰 Argent : <strong>${p.money}</strong></span>
              <span>📈 Valeur totale : <strong>${p.netWorth}</strong></span>
              <span>🏷️ Propriétés : <strong>${p.propertiesCount}</strong></span>
              <span>🏠 Constructions : <strong>${s.housesBuilt}</strong></span>
              <span>💵 Loyers payés : <strong>${s.rentPaid}</strong></span>
              <span>💴 Loyers reçus : <strong>${s.rentReceived}</strong></span>
              <span>💸 Plus gros loyer payé : <strong>${s.biggestRentPaid}</strong></span>
              <span>🧾 Taxes payées : <strong>${s.taxesPaid}</strong></span>
              <span>🚔 Fois en prison : <strong>${s.timesInJail}</strong></span>
              <span>🛒 Achats directs : <strong>${s.propertiesBought}</strong></span>
              <span>🔨 Enchères gagnées : <strong>${s.auctionsWon}</strong></span>
              <span>🤝 Échanges conclus : <strong>${s.tradesCompleted}</strong></span>
              <span>🏁 Salaire encaissé : <strong>${s.salaryCollected}</strong></span>
              <span>💳 Prêts contractés : <strong>${s.loansContracted}</strong></span>
              <span>🛡️ Assurances souscrites : <strong>${s.insuranceBought}</strong></span>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  content.innerHTML = header + cards;
}

function renderLoansModal() {
  if (!latestGameState) return;
  const preserved = captureFormValues(loansContent);
  document.getElementById("loans-error").textContent = "";

  let html = "";

  if (latestGameState.loansEnabled) {
    const others = latestGameState.players.filter((p) => p.id !== myPlayerId && !p.bankrupt);
    if (loanTargetId === null || !others.some((p) => p.id === loanTargetId)) {
      loanTargetId = others.length > 0 ? others[0].id : null;
    }
    const targetOptions = others
      .map((p) => `<option value="${p.id}" ${p.id === loanTargetId ? "selected" : ""}>${p.name}</option>`)
      .join("");

    html += `<h3 class="trade-section-title">Proposer un prêt</h3>`;
    html +=
      others.length === 0
        ? `<p class="properties-empty">Aucun autre joueur actif.</p>`
        : `
          <div class="trade-form">
            <label>À qui <select id="loan-target">${targetOptions}</select></label>
            <label>Montant <input type="number" id="loan-amount" min="1" value="100" /></label>
            <label>Taux d'intérêt (%) <input type="number" id="loan-rate" min="0" max="200" value="10" /></label>
            <label>Durée (tours) <input type="number" id="loan-duration" min="1" max="20" value="5" /></label>
            <button id="btn-propose-loan" class="btn-primary">Proposer le prêt</button>
          </div>
        `;

    const incoming = latestGameState.loanOffers.filter((o) => o.borrowerId === myPlayerId);
    const outgoing = latestGameState.loanOffers.filter((o) => o.lenderId === myPlayerId);

    html += `<h3 class="trade-section-title">📬 Offres de prêt reçues</h3>`;
    html += incoming.length === 0 ? `<p class="properties-empty">Aucune.</p>` : incoming.map(renderIncomingLoanOffer).join("");

    html += `<h3 class="trade-section-title">📤 Tes propositions</h3>`;
    html += outgoing.length === 0 ? `<p class="properties-empty">Aucune.</p>` : outgoing.map(renderOutgoingLoanOffer).join("");

    html += `<h3 class="trade-section-title">📒 Prêts en cours (visibles par tous)</h3>`;
    html +=
      latestGameState.loans.length === 0
        ? `<p class="properties-empty">Aucun prêt en cours.</p>`
        : latestGameState.loans.map(renderActiveLoan).join("");
  }

  if (latestGameState.insuranceEnabled) {
    const me = latestGameState.players.find((p) => p.id === myPlayerId);
    html += `<h3 class="trade-section-title">🛡️ Assurance</h3>`;
    if (me.insurance) {
      html += `<p class="properties-empty">Formule <strong>${me.insurance.planName}</strong> active : ${me.insurance.coveragePercent}% des loyers pris en charge, encore ${me.insurance.turnsRemaining} tour(s).</p>`;
    } else {
      html += ReachUpInsurance.INSURANCE_PLANS.map((plan) => {
        const price = latestGameState.insurancePrices ? latestGameState.insurancePrices[plan.id] : plan.premium;
        return `
          <div class="property-row">
            <div class="property-row__info"><strong>${plan.name}</strong> — coût ${price}, couvre ${plan.coveragePercent}% des loyers pendant ${plan.duration} tours</div>
            <div class="property-row__actions"><button data-buy-insurance="${plan.id}" class="btn-primary">Souscrire</button></div>
          </div>
        `;
      }).join("");
    }
  }

  loansContent.innerHTML = html;

  const targetSelect = document.getElementById("loan-target");
  if (targetSelect) {
    targetSelect.addEventListener("change", () => {
      loanTargetId = Number(targetSelect.value);
      renderLoansModal();
    });
  }

  const proposeBtn = document.getElementById("btn-propose-loan");
  if (proposeBtn) {
    proposeBtn.addEventListener("click", () => {
      const amount = Number(document.getElementById("loan-amount").value) || 0;
      const interestRate = Number(document.getElementById("loan-rate").value) || 0;
      const duration = Number(document.getElementById("loan-duration").value) || 1;
      socket.emit("game:proposeLoan", { toId: loanTargetId, amount, interestRate, duration });
    });
  }

  loansContent.querySelectorAll("[data-accept-loan]").forEach((btn) => {
    btn.addEventListener("click", () => socket.emit("game:respondLoan", { offerId: Number(btn.dataset.acceptLoan), accept: true }));
  });
  loansContent.querySelectorAll("[data-reject-loan]").forEach((btn) => {
    btn.addEventListener("click", () => socket.emit("game:respondLoan", { offerId: Number(btn.dataset.rejectLoan), accept: false }));
  });
  loansContent.querySelectorAll("[data-cancel-loan]").forEach((btn) => {
    btn.addEventListener("click", () => socket.emit("game:cancelLoan", { offerId: Number(btn.dataset.cancelLoan) }));
  });
  loansContent.querySelectorAll("[data-repay-loan]").forEach((btn) => {
    btn.addEventListener("click", () => socket.emit("game:repayLoan", { loanId: Number(btn.dataset.repayLoan) }));
  });

  const buyInsuranceBtns = loansContent.querySelectorAll("[data-buy-insurance]");
  buyInsuranceBtns.forEach((btn) => {
    btn.addEventListener("click", () => socket.emit("game:buyInsurance", { planId: Number(btn.dataset.buyInsurance) }));
  });

  restoreFormValues(loansContent, preserved);
}

function renderIncomingLoanOffer(offer) {
  const lender = latestGameState.players[offer.lenderId];
  return `
    <div class="property-row">
      <div class="property-row__info"><strong>${lender.name}</strong> te propose ${offer.principal} à ${offer.interestRate}% (à rembourser : ${offer.totalOwed} en ${offer.duration} tours)</div>
      <div class="property-row__actions">
        <button data-accept-loan="${offer.id}" class="btn-primary">Accepter</button>
        <button data-reject-loan="${offer.id}">Refuser</button>
      </div>
    </div>
  `;
}

function renderOutgoingLoanOffer(offer) {
  const borrower = latestGameState.players[offer.borrowerId];
  return `
    <div class="property-row">
      <div class="property-row__info">À <strong>${borrower.name}</strong> : ${offer.principal} à ${offer.interestRate}% (total dû : ${offer.totalOwed})</div>
      <div class="property-row__actions"><button data-cancel-loan="${offer.id}">Annuler</button></div>
    </div>
  `;
}

function renderActiveLoan(loan) {
  const lender = latestGameState.players[loan.lenderId];
  const borrower = latestGameState.players[loan.borrowerId];
  const isMine = loan.borrowerId === myPlayerId;
  return `
    <div class="property-row">
      <div class="property-row__info">${borrower.name} doit ${loan.totalOwed} à ${lender.name} (${loan.turnsRemaining} tour(s) restant(s))</div>
      <div class="property-row__actions">${isMine ? `<button data-repay-loan="${loan.id}">Rembourser maintenant</button>` : ""}</div>
    </div>
  `;
}

function renderTradeModal() {
  if (!latestGameState) return;
  const preserved = captureFormValues(tradeContent);
  document.getElementById("trade-error").textContent = "";

  const others = latestGameState.players.filter((p) => p.id !== myPlayerId && !p.bankrupt);
  if (tradeTargetId === null || !others.some((p) => p.id === tradeTargetId)) {
    tradeTargetId = others.length > 0 ? others[0].id : null;
  }

  const myTiles = latestGameState.board
    .map((tile, index) => ({ tile, index }))
    .filter(({ tile }) => tile.owner === myPlayerId && !tile.mortgaged);

  const theirTiles =
    tradeTargetId !== null
      ? latestGameState.board
          .map((tile, index) => ({ tile, index }))
          .filter(({ tile }) => tile.owner === tradeTargetId && !tile.mortgaged)
      : [];

  const targetOptions = others
    .map((p) => `<option value="${p.id}" ${p.id === tradeTargetId ? "selected" : ""}>${p.name}</option>`)
    .join("");

  const tileCheckbox = (tile, index, className) =>
    `<label class="tile-checkbox"><input type="checkbox" class="${className}" value="${index}" /> ${ReachUpBoardView.tileSwatch(tile)} ${tile.name}</label>`;

  const myTilesHtml =
    myTiles.map(({ tile, index }) => tileCheckbox(tile, index, "offer-tile")).join("") ||
    `<p class="properties-empty">Tu n'as aucune propriété libre à proposer.</p>`;

  const theirTilesHtml =
    theirTiles.map(({ tile, index }) => tileCheckbox(tile, index, "request-tile")).join("") ||
    `<p class="properties-empty">Ce joueur n'a aucune propriété libre.</p>`;

  const incoming = latestGameState.tradeOffers.filter((t) => t.toId === myPlayerId);
  const outgoing = latestGameState.tradeOffers.filter((t) => t.fromId === myPlayerId);
  const bystanderTrades = latestGameState.tradeOffers.filter((t) => t.toId !== myPlayerId && t.fromId !== myPlayerId);

  const formHtml =
    others.length === 0
      ? `<p class="properties-empty">Aucun autre joueur actif avec qui échanger.</p>`
      : `
        <div class="trade-form">
          <label>Proposer un échange à
            <select id="trade-target">${targetOptions}</select>
          </label>
          <div class="trade-columns">
            <div class="trade-column">
              <h4>Tu donnes</h4>
              <label>Argent <input type="number" id="trade-offer-money" min="0" value="0" /></label>
              <div class="tile-checkbox-list">${myTilesHtml}</div>
            </div>
            <div class="trade-column">
              <h4>Tu reçois</h4>
              <label>Argent <input type="number" id="trade-request-money" min="0" value="0" /></label>
              <div class="tile-checkbox-list">${theirTilesHtml}</div>
            </div>
          </div>
          <button id="btn-propose-trade" class="btn-primary">Proposer l'échange</button>
        </div>
      `;

  tradeContent.innerHTML = `
    ${formHtml}
    <h3 class="trade-section-title">📬 Offres reçues</h3>
    ${incoming.length === 0 ? `<p class="properties-empty">Aucune offre reçue.</p>` : incoming.map((t) => renderTradeRow(t, "incoming")).join("")}
    <h3 class="trade-section-title">📤 Tes propositions envoyées</h3>
    ${outgoing.length === 0 ? `<p class="properties-empty">Aucune proposition envoyée.</p>` : outgoing.map((t) => renderTradeRow(t, "outgoing")).join("")}
    <h3 class="trade-section-title">👀 Échanges entre les autres joueurs</h3>
    ${bystanderTrades.length === 0 ? `<p class="properties-empty">Aucun échange en cours entre les autres joueurs.</p>` : bystanderTrades.map((t) => renderTradeRow(t, "observer")).join("")}
  `;

  const targetSelect = document.getElementById("trade-target");
  if (targetSelect) {
    targetSelect.addEventListener("change", () => {
      tradeTargetId = Number(targetSelect.value);
      renderTradeModal();
    });
  }

  const proposeBtn = document.getElementById("btn-propose-trade");
  if (proposeBtn) {
    proposeBtn.addEventListener("click", () => {
      const offerTiles = [...document.querySelectorAll(".offer-tile:checked")].map((el) => Number(el.value));
      const requestTiles = [...document.querySelectorAll(".request-tile:checked")].map((el) => Number(el.value));
      const offerMoney = Number(document.getElementById("trade-offer-money").value) || 0;
      const requestMoney = Number(document.getElementById("trade-request-money").value) || 0;
      socket.emit("game:proposeTrade", { toId: tradeTargetId, offerTiles, offerMoney, requestTiles, requestMoney });
    });
  }

  propertiesModalWireTradeButtons();
  restoreFormValues(tradeContent, preserved);
}

function propertiesModalWireTradeButtons() {
  tradeContent.querySelectorAll("[data-accept-trade]").forEach((btn) => {
    btn.addEventListener("click", () => {
      socket.emit("game:respondTrade", { tradeId: Number(btn.dataset.acceptTrade), accept: true });
    });
  });
  tradeContent.querySelectorAll("[data-reject-trade]").forEach((btn) => {
    btn.addEventListener("click", () => {
      socket.emit("game:respondTrade", { tradeId: Number(btn.dataset.rejectTrade), accept: false });
    });
  });
  tradeContent.querySelectorAll("[data-cancel-trade]").forEach((btn) => {
    btn.addEventListener("click", () => {
      socket.emit("game:cancelTrade", { tradeId: Number(btn.dataset.cancelTrade) });
    });
  });
}

function renderTradeRow(trade, mode) {
  const fromPlayer = latestGameState.players[trade.fromId];
  const toPlayer = latestGameState.players[trade.toId];
  const isIncoming = mode === "incoming";
  const isObserver = mode === "observer";

  if (trade.hidden) {
    // Négociation secrète : on ne connaît pas le contenu, seulement qui propose.
    // On suppose que les joueurs se sont mis d'accord en dehors du jeu.
    const description = isIncoming
      ? `<strong>${fromPlayer.name}</strong> te propose un échange 🤫 <em>(négocié ailleurs — fie-toi à ce que vous avez convenu)</em>`
      : isObserver
      ? `<strong>${fromPlayer.name}</strong> → <strong>${toPlayer.name}</strong> : échange en cours 🤫`
      : `À <strong>${toPlayer.name}</strong> : échange en cours 🤫`;
    const actions = isIncoming
      ? `<button data-accept-trade="${trade.id}" class="btn-primary">Accepter</button>
         <button data-reject-trade="${trade.id}">Refuser</button>`
      : "";
    return `
      <div class="property-row">
        <div class="property-row__info">${description}</div>
        <div class="property-row__actions">${actions}</div>
      </div>
    `;
  }

  const offerNames = trade.offerTiles.map((i) => `${ReachUpBoardView.tileSwatch(latestGameState.board[i])} ${latestGameState.board[i].name}`);
  if (trade.offerMoney > 0) offerNames.push(`${trade.offerMoney} 💰`);
  const requestNames = trade.requestTiles.map((i) => `${ReachUpBoardView.tileSwatch(latestGameState.board[i])} ${latestGameState.board[i].name}`);
  if (trade.requestMoney > 0) requestNames.push(`${trade.requestMoney} 💰`);

  const description = isIncoming
    ? `<strong>${fromPlayer.name}</strong> te propose : ${offerNames.join(", ") || "rien"} contre ${requestNames.join(", ") || "rien"}`
    : isObserver
    ? `<strong>${fromPlayer.name}</strong> → <strong>${toPlayer.name}</strong> : ${offerNames.join(", ") || "rien"} contre ${requestNames.join(", ") || "rien"}`
    : `À <strong>${toPlayer.name}</strong> : ${offerNames.join(", ") || "rien"} contre ${requestNames.join(", ") || "rien"}`;

  const actions = isIncoming
    ? `<button data-accept-trade="${trade.id}" class="btn-primary">Accepter</button>
       <button data-reject-trade="${trade.id}">Refuser</button>`
    : isObserver
    ? ""
    : `<button data-cancel-trade="${trade.id}">Annuler</button>`;

  return `
    <div class="property-row">
      <div class="property-row__info">${description}</div>
      <div class="property-row__actions">${actions}</div>
    </div>
  `;
}
