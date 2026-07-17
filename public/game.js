// ============================================================
// REACH UP — Code côté navigateur
// Phase 3 : écran d'accueil, salon d'attente, puis partie en direct.
// Ce fichier ne connaît AUCUNE règle du jeu : il affiche l'état que
// le serveur lui envoie, et transmet les intentions du joueur
// (lancer les dés, acheter...) — toute la vérité vient du serveur.
// ============================================================

const socket = io();

let myPlayerId = null;

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
  if (!screens.home.hidden) {
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

// ---- Réglages de la partie (Phase 5) ----
const settingInputs = {
  startingMoney: document.getElementById("setting-startingMoney"),
  salary: document.getElementById("setting-salary"),
  vacationPot: document.getElementById("setting-vacationPot"),
  turnLimit: document.getElementById("setting-turnLimit"),
};

function emitSettingsChange() {
  socket.emit("room:updateSettings", {
    startingMoney: Number(settingInputs.startingMoney.value),
    salary: Number(settingInputs.salary.value),
    vacationPot: settingInputs.vacationPot.checked,
    turnLimit: settingInputs.turnLimit.value ? Number(settingInputs.turnLimit.value) : null,
  });
}

Object.values(settingInputs).forEach((el) => {
  el.addEventListener("change", emitSettingsChange);
});

function applySettingsToInputs(settings) {
  if (!settings) return;
  const moneyStr = String(settings.startingMoney);
  if (settingInputs.startingMoney.value !== moneyStr) settingInputs.startingMoney.value = moneyStr;

  const salaryStr = String(settings.salary);
  if (settingInputs.salary.value !== salaryStr) settingInputs.salary.value = salaryStr;

  settingInputs.vacationPot.checked = !!settings.vacationPot;

  const turnLimitStr = settings.turnLimit ? String(settings.turnLimit) : "";
  if (settingInputs.turnLimit.value !== turnLimitStr) settingInputs.turnLimit.value = turnLimitStr;
}

socket.on("room:update", (room) => {
  showScreen("lobby");
  document.getElementById("lobby-error").textContent = "";
  lobbyCodeEl.textContent = room.code;

  lobbyPlayersEl.innerHTML = "";
  room.players.forEach((p) => {
    const isHost = p.socketId === room.hostSocketId;
    const isMe = p.socketId === socket.id;

    const card = document.createElement("div");
    card.className = "player-card";
    card.innerHTML = `
      <h3>${p.name}${isMe ? " (toi)" : ""}${isHost ? " 👑" : ""}</h3>
      <p class="player-status">${p.ready ? "✅ Prêt" : "⏳ Pas prêt"}</p>
    `;
    lobbyPlayersEl.appendChild(card);
  });

  applySettingsToInputs(room.settings);

  const isHost = room.hostSocketId === socket.id;
  Object.values(settingInputs).forEach((el) => {
    el.disabled = !isHost;
  });

  btnStart.hidden = !isHost;
  btnStart.disabled = !room.canStart;
});

// ============================================================
// Écran de jeu
// ============================================================
const playersPanel = document.getElementById("players-panel");
const actionArea = document.getElementById("action-area");
const logPanel = document.getElementById("log-panel");

socket.on("game:started", ({ state, socketToPlayerId }) => {
  myPlayerId = socketToPlayerId[socket.id];
  showScreen("game");
  renderGame(state);
});

socket.on("game:update", ({ state }) => {
  renderGame(state);
});

function renderGame(state) {
  ReachUpBoardView.updateBoard(state, myPlayerId);
  renderPlayers(state);
  renderActionArea(state);
  renderLog(state);
}

function renderPlayers(state) {
  playersPanel.innerHTML = "";

  state.players.forEach((player) => {
    const tile = state.board[player.position];
    const propertiesCount = state.board.filter((t) => t.owner === player.id).length;

    let statusLabel = "Actif";
    if (player.bankrupt) statusLabel = "En faillite";
    else if (player.inJail) statusLabel = "En prison";

    const isCurrent = !state.gameOver && state.currentPlayerIndex === player.id;

    const card = document.createElement("div");
    card.className = "player-card";
    if (player.bankrupt) card.classList.add("player-card--bankrupt");
    if (isCurrent) card.classList.add("player-card--current");
    card.style.borderLeft = `4px solid ${ReachUpBoardView.PLAYER_COLORS[player.id % ReachUpBoardView.PLAYER_COLORS.length]}`;

    card.innerHTML = `
      <h3>${player.name}${player.id === myPlayerId ? " (toi)" : ""}</h3>
      <p>💰 ${player.money}</p>
      <p>📍 ${tile.name}</p>
      <p>🏷️ ${propertiesCount} propriété(s)</p>
      <p class="player-status">${statusLabel}</p>
    `;
    playersPanel.appendChild(card);
  });

  if (state.gameOver) {
    const banner = document.createElement("div");
    banner.className = "winner-banner";
    banner.textContent = `🏆 ${state.winner.name} remporte la partie !`;
    playersPanel.appendChild(banner);
  }
}

function renderActionArea(state) {
  actionArea.innerHTML = "";
  if (state.gameOver) return;

  // Cas 1 : quelqu'un doit décider d'acheter ou non
  if (state.pendingDecision) {
    if (state.pendingDecision.playerId === myPlayerId) {
      const tile = state.board[state.pendingDecision.tileIndex];
      const box = document.createElement("div");
      box.className = "action-box";
      box.innerHTML = `
        <p>Acheter <strong>${tile.name}</strong> pour <strong>${tile.price}</strong> ?</p>
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
}

function showWaitingBox(text) {
  const box = document.createElement("div");
  box.className = "action-box action-box--waiting";
  box.textContent = text;
  actionArea.appendChild(box);
}

function renderLog(state) {
  logPanel.innerHTML = state.log.map((line) => `<div>${line}</div>`).join("");
  logPanel.scrollTop = logPanel.scrollHeight;
}
