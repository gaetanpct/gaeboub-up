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

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;

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
    players: room.players.map((p) => ({ socketId: p.socketId, name: p.name, ready: p.ready })),
    canStart: room.players.length >= MIN_PLAYERS && room.players.every((p) => p.ready),
    maxPlayers: MAX_PLAYERS,
    settings: room.settings,
    previewBoard: room.settings.boardMode === "random" ? room.previewBoard : null,
  });
}

function broadcastGame(room) {
  const baseState = room.engine.getPublicState();

  room.players.forEach((p) => {
    const playerId = room.socketToPlayerId[p.socketId];
    const stateForPlayer = buildStateForPlayer(baseState, playerId, room.settings);
    io.to(p.socketId).emit("game:update", { state: stateForPlayer, settings: room.settings });
  });
}

// Si la règle "négociations secrètes" est active, on part du principe que
// les joueurs se sont mis d'accord en dehors du jeu (appel, message...).
// Seul le proposeur voit le détail de sa propre offre (il l'a construite
// lui-même). Le destinataire ET les tiers ne voient que "un échange est
// proposé", sans le contenu — sinon ce n'est plus vraiment secret : il
// doit accepter ou refuser en se fiant à ce qui a été convenu ailleurs.
function buildStateForPlayer(baseState, playerId, settings) {
  if (!settings.secretTrades) return baseState;

  return {
    ...baseState,
    tradeOffers: baseState.tradeOffers.map((trade) => {
      if (trade.fromId === playerId) return trade;
      return { id: trade.id, fromId: trade.fromId, toId: trade.toId, hidden: true };
    }),
  };
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ name } = {}) => {
    if (socket.data.roomCode) return; // déjà dans un salon

    const code = generateRoomCode();
    const room = {
      code,
      hostSocketId: socket.id,
      players: [{ socketId: socket.id, name: sanitizeName(name), ready: false }],
      engine: null,
      started: false,
      socketToPlayerId: {},
      settings: buildDefaultSettings(),
      previewBoard: null, // rempli si boardMode === "random" (Phase 8b)
    };
    rooms.set(code, room);

    socket.join(code);
    socket.data.roomCode = code;
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

    room.players.push({ socketId: socket.id, name: sanitizeName(name), ready: false });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    broadcastLobby(room);
  });

  socket.on("room:toggleReady", () => {
    const room = getRoom(socket);
    if (!room || room.started) return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    player.ready = !player.ready;
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

  // ---- Pouvoirs (Phase 8c) : jouable à tout moment, comme la gestion des propriétés ----
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

  // ---- Assurance (Phase 8e) ----
  socket.on("game:buyInsurance", () => {
    const room = getRoom(socket);
    if (!room || !room.started || !room.engine) return;
    const myPlayerId = room.socketToPlayerId[socket.id];
    if (myPlayerId === undefined) return;

    const result = room.engine.buyInsurance(myPlayerId);
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
      room.players = room.players.filter((p) => p.socketId !== socket.id);
      if (room.players.length === 0) {
        rooms.delete(room.code);
        return;
      }
      if (room.hostSocketId === socket.id) {
        room.hostSocketId = room.players[0].socketId;
      }
      broadcastLobby(room);
    } else {
      // Limite connue de cette phase : pas de reconnexion/forfait géré
      // pendant une partie en cours. Voir le récapitulatif de la Phase 3.
      console.log(
        `Joueur déconnecté pendant une partie en cours (salon ${room.code}). Reconnexion non gérée pour l'instant.`
      );
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur Reach Up démarré sur le port ${PORT}`);
});
