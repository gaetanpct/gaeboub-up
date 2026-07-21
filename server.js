// ============================================================
// REACH UP — Serveur principal
// Phase 3 : multijoueur (salons, prêt, démarrage, parties en temps réel)
//
// Le serveur est ici "autoritaire" : c'est LUI qui possède le vrai
// GameEngine de chaque partie (voir public/game/engine.js). Les
// navigateurs ne font qu'envoyer des intentions ("je lance les dés",
// "j'achète") et reçoivent en retour l'état complet de la partie.
// ============================================================

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { GameEngine } = require(path.join(__dirname, "public", "game", "engine.js"));
const { buildDefaultSettings, validateSettings } = require(path.join(__dirname, "public", "game", "rules-schema.js"));
const { generateBoard } = require(path.join(__dirname, "public", "game", "board-generator.js"));
const AI = require(path.join(__dirname, "public", "game", "ai.js"));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;
const LOBBY_DISCONNECT_GRACE_MS = 30000; // 30s pour se reconnecter avant d'être vraiment retiré du salon

// Toutes les parties en cours vivent en mémoire du serveur.
// (Elles disparaissent si le serveur redémarre — normal pour ce stade du projet.)
const rooms = new Map();

function generateRoomCode() {
  // On évite les caractères ambigus (0/O, 1/I) pour que ce soit facile à lire à l'oral.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function sanitizeName(rawName) {
  const trimmed = (rawName || "").toString().trim().slice(0, 20);
  return trimmed.length > 0 ? trimmed : "Joueur";
}

let aiIdCounter = 0;
function generateAIId() {
  aiIdCounter += 1;
  return `ai-${aiIdCounter}-${Date.now()}`;
}

// Jeton de session : identifie un JOUEUR (indépendamment de son socket.id,
// qui change à chaque connexion) pour permettre de recharger la page sans
// perdre sa place dans la partie en cours.
function generatePlayerToken() {
  return require("crypto").randomBytes(16).toString("hex");
}

const AI_NAME_POOL = ["Bouzelouf", "Tigrou", "Daddy", "Mommy"];

function aiDisplayName(room) {
  const usedNames = new Set(room.players.map((p) => p.name));
  const available = AI_NAME_POOL.filter((n) => !usedNames.has(n));
  const pool = available.length > 0 ? available : AI_NAME_POOL; // tous déjà pris : on autorise un doublon en dernier recours
  const base = pool[Math.floor(Math.random() * pool.length)];
  if (!usedNames.has(base)) return base;
  let suffix = 2;
  while (usedNames.has(`${base} (${suffix})`)) suffix++;
  return `${base} (${suffix})`;
}

function getRoom(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}

const BOARD_SHAPE_KEYS = [
  "boardSize",
  "boardGroups",
  "boardChanceCards",
  "boardSpecialCards",
  "boardTaxes",
  "boardAirports",
  "boardUtilities",
];

function regenerateBoard(room) {
  room.previewBoard = generateBoard({
    totalTiles: room.settings.boardSize,
    numGroups: room.settings.boardGroups,
    numChanceCards: room.settings.boardChanceCards,
    numSpecialCards: room.settings.boardSpecialCards,
    numTaxes: room.settings.boardTaxes,
    numAirports: room.settings.boardAirports,
    numUtilities: room.settings.boardUtilities,
  });
}

function broadcastLobby(room) {
  io.to(room.code).emit("room:update", {
    code: room.code,
    hostSocketId: room.hostSocketId,
    players: room.players.map((p) => ({ socketId: p.socketId, name: p.name, ready: p.ready, isAI: !!p.isAI, difficulty: p.difficulty || null })),
    canStart: room.players.length >= MIN_PLAYERS && room.players.every((p) => p.ready),
    maxPlayers: MAX_PLAYERS,
    settings: room.settings,
    previewBoard: room.settings.boardMode === "random" ? room.previewBoard : null,
    aiDifficulties: Object.keys(AI.DIFFICULTY_PROFILES).map((id) => ({ id, label: AI.DIFFICULTY_PROFILES[id].label })),
  });
}

function broadcastGame(room) {
  scheduleAuctionTimer(room);
  let baseState = room.engine.getPublicState();

  if (baseState.pendingAuction && baseState.pendingAuction.mode === "classic" && room.auctionResponseDeadline) {
    baseState = {
      ...baseState,
      pendingAuction: {
        ...baseState.pendingAuction,
        responseDeadline: room.auctionResponseDeadline,
        hardDeadline: room.auctionHardDeadline,
      },
    };
  }

  room.players.forEach((p) => {
    const playerId = room.socketToPlayerId[p.socketId];
    const stateForPlayer = buildStateForPlayer(baseState, playerId, room.settings, room.engine);
    io.to(p.socketId).emit("game:update", { state: stateForPlayer, settings: room.settings });
  });

  scheduleAICheck(room);
}

// ---------------------------------------------------------------------
// Chronométrage des enchères CLASSIQUES (à la criée) — les enchères
// scellées n'ont pas de minuteur, chacun mise à son rythme.
//
// Deux minuteurs travaillent ensemble : une fenêtre de réponse courte qui
// repart de zéro à chaque nouvelle surenchère (sinon, la première
// personne à se taire perdrait alors que les autres réfléchissent encore
// à raison), plafonnée par une durée totale absolue (sinon une enchère
// très animée pourrait s'éterniser indéfiniment).
// ---------------------------------------------------------------------
const AUCTION_RESPONSE_WINDOW_MS = 8000;
const AUCTION_HARD_CAP_MS = 25000;

function clearAuctionTimers(room) {
  if (room.auctionResponseTimer) clearTimeout(room.auctionResponseTimer);
  if (room.auctionHardTimer) clearTimeout(room.auctionHardTimer);
  room.auctionResponseTimer = null;
  room.auctionHardTimer = null;
  room.auctionTimerKey = undefined;
  room.auctionStartedAt = null;
  room.auctionResponseDeadline = null;
  room.auctionHardDeadline = null;
  room.auctionLastBid = undefined;
}

function forceConcludeIfStillSameAuction(room, auctionKey) {
  if (!room.engine || !room.engine.pendingAuction) return;
  if (room.engine.pendingAuction.mode !== "classic") return;
  if (String(room.engine.pendingAuction.tileIndex) !== auctionKey) return;
  room.engine.forceEndClassicAuction();
  clearAuctionTimers(room);
  broadcastGame(room);
}

function resetAuctionResponseTimer(room) {
  if (room.auctionResponseTimer) clearTimeout(room.auctionResponseTimer);
  const auctionKey = room.auctionTimerKey;
  room.auctionResponseDeadline = Date.now() + AUCTION_RESPONSE_WINDOW_MS;
  room.auctionResponseTimer = setTimeout(() => {
    forceConcludeIfStillSameAuction(room, auctionKey);
  }, AUCTION_RESPONSE_WINDOW_MS);
}

function scheduleAuctionTimer(room) {
  if (!room.started || !room.engine) return;
  const auction = room.engine.pendingAuction;
  if (!auction || auction.mode !== "classic") {
    if (room.auctionTimerKey !== undefined) clearAuctionTimers(room);
    return;
  }

  const auctionKey = String(auction.tileIndex);
  if (room.auctionTimerKey === auctionKey) {
    // Même enchère déjà suivie : si la mise a changé depuis la dernière
    // fois, la fenêtre de réponse repart de zéro.
    if (room.auctionLastBid !== auction.currentBid) {
      room.auctionLastBid = auction.currentBid;
      resetAuctionResponseTimer(room);
    }
    return;
  }

  // Nouvelle enchère classique détectée : initialise tout depuis le début.
  clearAuctionTimers(room);
  room.auctionTimerKey = auctionKey;
  room.auctionStartedAt = Date.now();
  room.auctionLastBid = auction.currentBid;
  room.auctionHardDeadline = room.auctionStartedAt + AUCTION_HARD_CAP_MS;
  resetAuctionResponseTimer(room);
  room.auctionHardTimer = setTimeout(() => {
    forceConcludeIfStillSameAuction(room, auctionKey);
  }, AUCTION_HARD_CAP_MS);
}

// ---------------------------------------------------------------------
// IA — déclenchement automatique de ses actions.
//
// PRINCIPE : après CHAQUE broadcastGame (donc après CHAQUE action de
// n'importe quel joueur, humain ou IA), on regarde si un joueur IA doit
// maintenant agir (son tour, une décision/enchère qui le concerne, une
// offre reçue...). Si oui, on programme son action après un court délai
// de "réflexion", puis on rappelle broadcastGame — ce qui redéclenche
// cette même vérification, formant une boucle naturelle qui s'arrête
// dès qu'il n'y a plus rien à faire pour une IA (typiquement : en
// attente d'un humain).
// ---------------------------------------------------------------------
function findAIRoomPlayer(room, playerId) {
  const socketId = Object.keys(room.socketToPlayerId).find((sid) => room.socketToPlayerId[sid] === playerId);
  const player = room.players.find((p) => p.socketId === socketId);
  return player && player.isAI ? player : null;
}

function findAIPlayerNeedingToAct(room) {
  const engine = room.engine;
  if (!engine || engine.gameOver) return null;

  // Priorité 1 : un joueur (IA) à découvert doit régler sa situation.
  const debtor = engine.players.find((p) => p.inDebt);
  if (debtor) {
    const aiP = findAIRoomPlayer(room, debtor.id);
    if (aiP) return { player: aiP, kind: "debt", complex: false };
  }

  // Priorité 2 : décision d'achat en attente.
  if (engine.pendingDecision) {
    const aiP = findAIRoomPlayer(room, engine.pendingDecision.playerId);
    if (aiP) return { player: aiP, kind: "buy", complex: false };
  }

  // Priorité 3 : enchère en cours.
  if (engine.pendingAuction) {
    if (engine.pendingAuction.mode === "secret") {
      for (const pid of engine.pendingAuction.pendingPlayers) {
        const aiP = findAIRoomPlayer(room, pid);
        if (aiP) return { player: aiP, kind: "auction", complex: true };
      }
      return null;
    }
    const eligible = engine.pendingAuction.activeBidders.filter((id) => id !== engine.pendingAuction.currentBidderId);
    for (const pid of eligible) {
      const aiP = findAIRoomPlayer(room, pid);
      if (aiP) return { player: aiP, kind: "auction", complex: true };
    }
    return null;
  }

  // Priorité 4 : choix de case d'arrivée (pouvoir Libre arrêt).
  if (engine.pendingMoveChoice) {
    const aiP = findAIRoomPlayer(room, engine.pendingMoveChoice.playerId);
    if (aiP) return { player: aiP, kind: "moveChoice", complex: true };
  }

  // Priorité 5 : offres reçues (échange/prêt) adressées à une IA — traitées
  // avant même son propre tour, comme le ferait un humain attentif.
  for (const offer of engine.tradeOffers) {
    const aiP = findAIRoomPlayer(room, offer.toId);
    if (aiP) return { player: aiP, kind: "trade", complex: true };
  }
  for (const offer of engine.loanOffers) {
    const aiP = findAIRoomPlayer(room, offer.borrowerId);
    if (aiP) return { player: aiP, kind: "loan", complex: true };
  }

  // Priorité 6 : c'est le tour d'une IA et rien n'est en attente -> elle joue.
  const current = engine.players[engine.currentPlayerIndex];
  if (current && !current.bankrupt) {
    const aiP = findAIRoomPlayer(room, current.id);
    if (aiP) return { player: aiP, kind: "turn", complex: false };
  }

  return null;
}

function scheduleAICheck(room) {
  if (!room.started || !room.engine || room.engine.gameOver) return;
  if (room.aiCheckScheduled) return; // évite d'empiler plusieurs vérifications identiques
  room.aiCheckScheduled = true;
  setTimeout(() => {
    room.aiCheckScheduled = false;
    runNextAIAction(room);
  }, 10);
}

function runNextAIAction(room) {
  if (!room.started || !room.engine || room.engine.gameOver) return;
  const situation = findAIPlayerNeedingToAct(room);
  if (!situation) return;

  const { player: aiPlayer, kind, complex } = situation;
  const playerId = room.socketToPlayerId[aiPlayer.socketId];
  const thinkTime = AI.computeThinkTime({ complex }, aiPlayer.difficulty);

  setTimeout(() => {
    if (!room.started || !room.engine || room.engine.gameOver) return; // la partie a pu se terminer entre-temps
    const stillNeeded = findAIPlayerNeedingToAct(room);
    if (!stillNeeded || stillNeeded.player.socketId !== aiPlayer.socketId || stillNeeded.kind !== kind) {
      return; // la situation a changé, le prochain cycle s'en chargera correctement
    }
    AI.decideAndAct(room.engine, playerId, aiPlayer.difficulty);
    broadcastGame(room);
  }, thinkTime);
}

// Si la règle "négociations secrètes" est active, on part du principe que
// les joueurs se sont mis d'accord en dehors du jeu (appel, message...).
// Seul le proposeur voit le détail de sa propre offre (il l'a construite
// lui-même). Le destinataire ET les tiers ne voient que "un échange est
// proposé", sans le contenu — sinon ce n'est plus vraiment secret : il
// doit accepter ou refuser en se fiant à ce qui a été convenu ailleurs.
//
// De même, une enchère scellée ne révèle jamais les montants dans l'état
// public — SAUF pour un joueur qui a armé le pouvoir "Espion" : lui seul
// reçoit ici les vraies mises déjà déposées par les autres.
function buildStateForPlayer(baseState, playerId, settings, engine) {
  let state = baseState;

  if (settings.secretTrades) {
    state = {
      ...state,
      tradeOffers: state.tradeOffers.map((trade) => {
        if (trade.fromId === playerId) return trade;
        return { id: trade.id, fromId: trade.fromId, toId: trade.toId, hidden: true };
      }),
    };
  }

  if (state.pendingAuction && state.pendingAuction.mode === "secret" && engine && engine.pendingAuction) {
    const me = engine.players[playerId];
    const hasSpy = me && me.power && me.power.id === "auction_spy" && me.power.armed && !me.power.used;
    if (hasSpy) {
      state = {
        ...state,
        pendingAuction: {
          ...state.pendingAuction,
          bids: { ...engine.pendingAuction.bids },
        },
      };
    }
  }

  return state;
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ name } = {}) => {
    if (socket.data.roomCode) return; // déjà dans un salon

    const code = generateRoomCode();
    const playerToken = generatePlayerToken();
    const room = {
      code,
      hostSocketId: socket.id,
      players: [{ socketId: socket.id, name: sanitizeName(name), ready: false, playerToken }],
      engine: null,
      started: false,
      socketToPlayerId: {},
      settings: buildDefaultSettings(),
      previewBoard: null, // rempli si boardMode === "random" (Phase 8b)
      aiCheckScheduled: false,
    };
    rooms.set(code, room);

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerToken = playerToken;
    socket.emit("room:session", { roomCode: code, playerToken });
    broadcastLobby(room);
  });

  socket.on("room:join", ({ code, name } = {}) => {
    if (socket.data.roomCode) return;

    const room = rooms.get((code || "").toString().toUpperCase());
    if (!room) {
      socket.emit("room:error", "Ce salon n'existe pas.");
      return;
    }
    if (room.started) {
      socket.emit("room:error", "Cette partie a déjà commencé.");
      return;
    }
    if (room.players.length >= MAX_PLAYERS) {
      socket.emit("room:error", `Ce salon est complet (${MAX_PLAYERS} joueurs max).`);
      return;
    }

    const playerToken = generatePlayerToken();
    room.players.push({ socketId: socket.id, name: sanitizeName(name), ready: false, playerToken });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerToken = playerToken;
    socket.emit("room:session", { roomCode: room.code, playerToken });
    broadcastLobby(room);
  });

  // Reconnexion : le client renvoie le jeton reçu à la création/arrivée
  // dans le salon (gardé de son côté en sessionStorage) pour retrouver sa
  // place — que ce soit encore dans le salon d'attente, ou en pleine
  // partie — sans jamais revenir à l'écran d'accueil.
  socket.on("room:rejoin", ({ roomCode, playerToken } = {}) => {
    if (socket.data.roomCode) return; // déjà dans un salon (ex: double appel)
    const room = rooms.get((roomCode || "").toString().toUpperCase());
    if (!room) {
      socket.emit("room:rejoinFailed", { reason: "Cette partie n'existe plus." });
      return;
    }
    const player = room.players.find((p) => p.playerToken === playerToken);
    if (!player) {
      socket.emit("room:rejoinFailed", { reason: "Impossible de te retrouver dans cette partie." });
      return;
    }

    const oldSocketId = player.socketId;
    player.socketId = socket.id;
    player.disconnected = false;
    if (room.disconnectTimers && room.disconnectTimers[playerToken]) {
      clearTimeout(room.disconnectTimers[playerToken]);
      delete room.disconnectTimers[playerToken];
    }
    if (room.hostSocketId === oldSocketId) room.hostSocketId = socket.id;
    if (room.started && room.socketToPlayerId[oldSocketId] !== undefined) {
      room.socketToPlayerId[socket.id] = room.socketToPlayerId[oldSocketId];
      delete room.socketToPlayerId[oldSocketId];
    }

    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerToken = playerToken;
    socket.emit("room:session", { roomCode: room.code, playerToken });

    if (room.started && room.engine) {
      const playerId = room.socketToPlayerId[socket.id];
      const baseState = room.engine.getPublicState();
      const stateForPlayer = buildStateForPlayer(baseState, playerId, room.settings, room.engine);
      socket.emit("game:started", { state: stateForPlayer, socketToPlayerId: room.socketToPlayerId, settings: room.settings });
      console.log(`${player.name} reconnecté en pleine partie (salon ${room.code}).`);
    } else {
      broadcastLobby(room);
    }
  });

  socket.on("room:toggleReady", () => {
    const room = getRoom(socket);
    if (!room || room.started) return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    player.ready = !player.ready;
    broadcastLobby(room);
  });

  socket.on("room:addAI", ({ difficulty } = {}) => {
    const room = getRoom(socket);
    if (!room || room.started) return;
    if (socket.id !== room.hostSocketId) {
      socket.emit("room:error", "Seul l'hôte peut ajouter une IA.");
      return;
    }
    if (room.players.length >= MAX_PLAYERS) {
      socket.emit("room:error", `Ce salon est complet (${MAX_PLAYERS} joueurs max).`);
      return;
    }
    const chosenDifficulty = AI.DIFFICULTY_PROFILES[difficulty] ? difficulty : "difficile";
    room.players.push({
      socketId: generateAIId(),
      name: aiDisplayName(room),
      ready: true, // une IA est toujours prête, pas besoin de la faire "cocher"
      isAI: true,
      difficulty: chosenDifficulty,
    });
    broadcastLobby(room);
  });

  socket.on("room:removeAI", ({ socketId } = {}) => {
    const room = getRoom(socket);
    if (!room || room.started) return;
    if (socket.id !== room.hostSocketId) {
      socket.emit("room:error", "Seul l'hôte peut retirer une IA.");
      return;
    }
    const target = room.players.find((p) => p.socketId === socketId && p.isAI);
    if (!target) return;
    room.players = room.players.filter((p) => p.socketId !== socketId);
    broadcastLobby(room);
  });

  socket.on("room:updateSettings", (payload = {}) => {
    const room = getRoom(socket);
    if (!room || room.started) return;
    if (socket.id !== room.hostSocketId) {
      socket.emit("room:error", "Seul l'hôte peut modifier les réglages.");
      return;
    }

    const validated = validateSettings(payload);
    const modeWasRandom = room.settings.boardMode === "random";
    Object.assign(room.settings, validated);

    if (room.settings.boardMode === "random") {
      const shapeChanged = BOARD_SHAPE_KEYS.some((k) => k in validated);
      const justActivated = !modeWasRandom;
      if (!room.previewBoard || shapeChanged || justActivated) {
        regenerateBoard(room);
      }
    } else {
      room.previewBoard = null;
    }

    broadcastLobby(room);
  });

  socket.on("room:regenerateBoard", () => {
    const room = getRoom(socket);
    if (!room || room.started) return;
    if (socket.id !== room.hostSocketId) {
      socket.emit("room:error", "Seul l'hôte peut régénérer le plateau.");
      return;
    }
    if (room.settings.boardMode !== "random") return;

    regenerateBoard(room);
    broadcastLobby(room);
  });

  socket.on("room:start", () => {
    const room = getRoom(socket);
    if (!room || room.started) return;

    if (socket.id !== room.hostSocketId) {
      socket.emit("room:error", "Seul l'hôte du salon peut démarrer la partie.");
      return;
    }
    if (room.players.length < MIN_PLAYERS) {
      socket.emit("room:error", `Il faut au moins ${MIN_PLAYERS} joueurs pour commencer.`);
      return;
    }
    if (!room.players.every((p) => p.ready)) {
      socket.emit("room:error", "Tous les joueurs doivent être prêts.");
      return;
    }

    room.started = true;
    room.engine = new GameEngine(room.players.map((p) => p.name), {
      ...room.settings,
      customBoard: room.settings.boardMode === "random" ? room.previewBoard : undefined,
    });
    room.players.forEach((p, index) => {
      room.socketToPlayerId[p.socketId] = index;
    });

    io.to(room.code).emit("game:started", {
      state: room.engine.getPublicState(),
      socketToPlayerId: room.socketToPlayerId,
      settings: room.settings,
    });
    scheduleAICheck(room);
  });

  socket.on("game:roll", () => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;

    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;
    if (room.engine.pendingDecision || room.engine.pendingAuction) return; // une décision/enchère est en attente
    if (room.engine.currentPlayerIndex !== myPlayerId) {
      socket.emit("room:error", "Ce n'est pas ton tour.");
      return;
    }

    room.engine.roll();
    broadcastGame(room);
  });

  socket.on("game:payJailFine", () => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.payJailFine(myPlayerId);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:buyDecision", ({ buy } = {}) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;

    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;
    if (!room.engine.pendingDecision || room.engine.pendingDecision.playerId !== myPlayerId) return;

    room.engine.decide(myPlayerId, !!buy);
    broadcastGame(room);
  });

  // ---- Gestion des propriétés (Phase 6) : jouable à tout moment, pas
  // seulement pendant son propre tour, comme dans un vrai Monopoly. ----

  socket.on("game:build", (payload) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;
    const result = room.engine.buildHouse(myPlayerId, payload && payload.tileIndex);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:sellHouse", (payload) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;
    const result = room.engine.sellHouse(myPlayerId, payload && payload.tileIndex);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:mortgage", (payload) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;
    const result = room.engine.mortgage(myPlayerId, payload && payload.tileIndex);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:unmortgage", (payload) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;
    const result = room.engine.unmortgage(myPlayerId, payload && payload.tileIndex);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  // ---- Enchères scellées (Phase 7) ----
  socket.on("game:auctionBid", (payload) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;
    const result = room.engine.submitAuctionBid(myPlayerId, payload && payload.amount);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Mise impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:auctionRaise", (payload) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;
    const result = room.engine.raiseAuctionBid(myPlayerId, payload && payload.amount);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Mise impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:auctionPass", () => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;
    const result = room.engine.passAuctionBid(myPlayerId);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  // ---- Échanges entre joueurs (Phase 7) ----
  socket.on("game:proposeTrade", (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.proposeTrade(
      myPlayerId,
      payload.toId,
      payload.offerTiles || [],
      payload.offerMoney || 0,
      payload.requestTiles || [],
      payload.requestMoney || 0
    );
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Proposition impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:respondTrade", (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.respondTrade(payload.tradeId, myPlayerId, !!payload.accept);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:cancelTrade", (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.cancelTrade(payload.tradeId, myPlayerId);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  // ---- Pouvoirs (Phase 8c, tous actifs et uniquement à son tour depuis la Phase 13) ----
  socket.on("game:armPower", () => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.armPower(myPlayerId);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:useTeleport", (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.useTeleportPower(myPlayerId, payload.tileIndex);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:useSteal", (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.useStealPower(myPlayerId, payload.targetId);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:useBankLoan", () => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.useBankLoanPower(myPlayerId);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  // ---- Nouveaux pouvoirs (Phase 19) ----
  socket.on("game:useRentCollector", () => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.useRentCollectorPower(myPlayerId);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:useVacationClaim", () => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.useVacationClaimPower(myPlayerId);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:useDebtBailout", () => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.useDebtBailoutPower(myPlayerId);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:useHouseWrecker", (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.useHouseWreckerPower(myPlayerId, payload.targetId);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:useForcedSwap", (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.useForcedSwapPower(myPlayerId, payload.tileIndexA, payload.tileIndexB);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:chooseLandingDistance", (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.chooseLandingDistance(myPlayerId, payload.distance);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  // ---- Abandon de partie (Phase 12) ----
  socket.on("game:forfeit", () => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.forfeitGame(myPlayerId);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  // ---- Prêts entre joueurs (Phase 8e) ----
  socket.on("game:proposeLoan", (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.proposeLoan(myPlayerId, payload.toId, payload.amount, payload.interestRate, payload.duration);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Proposition impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:respondLoan", (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.respondLoan(payload.offerId, myPlayerId, !!payload.accept);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:cancelLoan", (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.cancelLoanOffer(payload.offerId, myPlayerId);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("game:repayLoan", (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.repayLoanEarly(payload.loanId, myPlayerId);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  // ---- Assurance (Phase 8e, formules multiples Phase 10) ----
  socket.on("game:buyInsurance", (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.buyInsurance(myPlayerId, payload.planId);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  // ---- Enchères forcées (Phase 10) ----
  socket.on("game:startForcedAuction", (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.startForcedAuction(myPlayerId, payload.tileIndex);
    if (!result || !result.ok) {
      socket.emit("room:error", (result && result.reason) || "Action impossible.");
      return;
    }
    broadcastGame(room);
  });

  socket.on("disconnect", () => {
    const room = getRoom(socket);
    if (!room) return;

    if (!room.started) {
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) return;

      // Délai de grâce avant de vraiment retirer le joueur : sans ça, un
      // rechargement de page (déconnexion puis reconnexion quasi
      // immédiate) supprimerait le salon avant même d'avoir eu une chance
      // de le retrouver — en particulier si c'était le dernier joueur
      // encore présent.
      player.disconnected = true;
      const token = player.playerToken;
      room.disconnectTimers = room.disconnectTimers || {};
      if (room.disconnectTimers[token]) clearTimeout(room.disconnectTimers[token]);
      room.disconnectTimers[token] = setTimeout(() => {
        const stillRoom = rooms.get(room.code);
        if (!stillRoom) return;
        const stillPlayer = stillRoom.players.find((p) => p.playerToken === token);
        if (!stillPlayer || !stillPlayer.disconnected) return; // reconnecté entre-temps
        stillRoom.players = stillRoom.players.filter((p) => p.playerToken !== token);
        delete stillRoom.disconnectTimers[token];
        if (stillRoom.players.length === 0) {
          rooms.delete(stillRoom.code);
          return;
        }
        if (stillRoom.hostSocketId === stillPlayer.socketId) {
          const newHost = stillRoom.players.find((p) => !p.isAI) || stillRoom.players[0];
          stillRoom.hostSocketId = newHost.socketId;
        }
        broadcastLobby(stillRoom);
      }, LOBBY_DISCONNECT_GRACE_MS);

      broadcastLobby(room);
    } else {
      const player = room.players.find((p) => p.socketId === socket.id);
      if (player) player.disconnected = true;
      broadcastGame(room);
      console.log(`${player ? player.name : "Un joueur"} déconnecté pendant une partie en cours (salon ${room.code}) — sa place est conservée pour une reconnexion.`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur Gaeboub-up démarré sur le port ${PORT}`);
});
