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
  if (!tradeModal.hidden) {
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
const propertiesModal = document.getElementById("properties-modal");
const propertiesList = document.getElementById("properties-list");
const btnOpenProperties = document.getElementById("btn-open-properties");
const btnCloseProperties = document.getElementById("btn-close-properties");

const tradeModal = document.getElementById("trade-modal");
const tradeContent = document.getElementById("trade-content");
const btnOpenTrade = document.getElementById("btn-open-trade");
const btnCloseTrade = document.getElementById("btn-close-trade");
let tradeTargetId = null;

let latestGameState = null;

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

socket.on("game:started", ({ state, socketToPlayerId }) => {
  myPlayerId = socketToPlayerId[socket.id];
  showScreen("game");
  renderGame(state);
});

socket.on("game:update", ({ state }) => {
  renderGame(state);
});

function renderGame(state) {
  latestGameState = state;
  ReachUpBoardView.updateBoard(state, myPlayerId);
  renderPlayers(state);
  renderActionArea(state);
  renderLog(state);
  if (!propertiesModal.hidden) renderPropertiesModal();
  if (!tradeModal.hidden) renderTradeModal();
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

  // Cas 0 : une enchère scellée est en cours
  if (state.pendingAuction) {
    const tile = state.board[state.pendingAuction.tileIndex];
    if (state.pendingAuction.pendingPlayers.includes(myPlayerId)) {
      const box = document.createElement("div");
      box.className = "action-box";
      box.innerHTML = `
        <p>🔨 Enchère scellée sur <strong>${tile.name}</strong> (prix normal : ${tile.price})</p>
        <input type="number" id="auction-bid-input" min="0" value="0" class="auction-input" />
        <button id="btn-submit-bid" class="btn-primary">Miser (0 = passer)</button>
      `;
      actionArea.appendChild(box);
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

function renderPropertiesModal() {
  if (!latestGameState) return;
  document.getElementById("properties-error").textContent = "";

  const myTiles = latestGameState.board
    .map((tile, index) => ({ tile, index }))
    .filter(({ tile }) => tile.owner === myPlayerId);

  if (myTiles.length === 0) {
    propertiesList.innerHTML = `<p class="properties-empty">Tu ne possèdes aucune propriété pour le moment.</p>`;
    return;
  }

  propertiesList.innerHTML = myTiles
    .map(({ tile, index }) => renderPropertyRow(tile, index))
    .join("");

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
        <strong>${tile.name}</strong> ${buildingLabel}
        ${tile.mortgaged ? '<span class="mortgaged-tag">Hypothéquée</span>' : ""}
      </div>
      <div class="property-row__actions">${buttons.join("")}</div>
    </div>
  `;
}

function renderTradeModal() {
  if (!latestGameState) return;
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
    `<label class="tile-checkbox"><input type="checkbox" class="${className}" value="${index}" /> ${tile.name}</label>`;

  const myTilesHtml =
    myTiles.map(({ tile, index }) => tileCheckbox(tile, index, "offer-tile")).join("") ||
    `<p class="properties-empty">Tu n'as aucune propriété libre à proposer.</p>`;

  const theirTilesHtml =
    theirTiles.map(({ tile, index }) => tileCheckbox(tile, index, "request-tile")).join("") ||
    `<p class="properties-empty">Ce joueur n'a aucune propriété libre.</p>`;

  const incoming = latestGameState.tradeOffers.filter((t) => t.toId === myPlayerId);
  const outgoing = latestGameState.tradeOffers.filter((t) => t.fromId === myPlayerId);

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
    ${incoming.length === 0 ? `<p class="properties-empty">Aucune offre reçue.</p>` : incoming.map((t) => renderTradeRow(t, true)).join("")}
    <h3 class="trade-section-title">📤 Tes propositions envoyées</h3>
    ${outgoing.length === 0 ? `<p class="properties-empty">Aucune proposition envoyée.</p>` : outgoing.map((t) => renderTradeRow(t, false)).join("")}
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

function renderTradeRow(trade, isIncoming) {
  const fromPlayer = latestGameState.players[trade.fromId];
  const toPlayer = latestGameState.players[trade.toId];

  const offerNames = trade.offerTiles.map((i) => latestGameState.board[i].name);
  if (trade.offerMoney > 0) offerNames.push(`${trade.offerMoney} 💰`);
  const requestNames = trade.requestTiles.map((i) => latestGameState.board[i].name);
  if (trade.requestMoney > 0) requestNames.push(`${trade.requestMoney} 💰`);

  const description = isIncoming
    ? `<strong>${fromPlayer.name}</strong> te propose : ${offerNames.join(", ") || "rien"} contre ${requestNames.join(", ") || "rien"}`
    : `À <strong>${toPlayer.name}</strong> : ${offerNames.join(", ") || "rien"} contre ${requestNames.join(", ") || "rien"}`;

  const actions = isIncoming
    ? `<button data-accept-trade="${trade.id}" class="btn-primary">Accepter</button>
       <button data-reject-trade="${trade.id}">Refuser</button>`
    : `<button data-cancel-trade="${trade.id}">Annuler</button>`;

  return `
    <div class="property-row">
      <div class="property-row__info">${description}</div>
      <div class="property-row__actions">${actions}</div>
    </div>
  `;
}
