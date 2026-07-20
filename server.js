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
const db = require(path.join(__dirname, "db.js"));
const auth = require(path.join(__dirname, "auth.js"));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------
// Comptes — routes REST (indépendantes des salons/parties en temps réel)
// ---------------------------------------------------------------------
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token ? auth.verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: "Non connecté." });
  req.userId = payload.userId;
  next();
}

app.post("/api/auth/signup", (req, res) => {
  const { email, password, pseudo } = req.body || {};
  if (!auth.isValidEmail(email)) return res.status(400).json({ error: "Adresse email invalide." });
  if (!auth.isValidPassword(password)) return res.status(400).json({ error: "Le mot de passe doit contenir au moins 6 caractères." });
  if (!auth.isValidPseudo(pseudo)) return res.status(400).json({ error: "Le pseudo doit contenir entre 2 et 20 caractères." });

  if (db.getUserByEmail(email)) {
    return res.status(409).json({ error: "Un compte existe déjà avec cette adresse email." });
  }

  const user = db.createUser({ email, passwordHash: auth.hashPassword(password), pseudo: pseudo.trim().slice(0, 20) });
  const token = auth.signToken(user);
  res.json({ token, user: { id: user.id, email: user.email, pseudo: user.pseudo } });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = db.getUserByEmail(email || "");
  if (!user || !auth.verifyPassword(password || "", user.password_hash)) {
    return res.status(401).json({ error: "Adresse email ou mot de passe incorrect." });
  }
  const token = auth.signToken(user);
  res.json({ token, user: { id: user.id, email: user.email, pseudo: user.pseudo } });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  const user = db.getUserById(req.userId);
  if (!user) return res.status(404).json({ error: "Compte introuvable." });
  res.json({
    user: { id: user.id, email: user.email, pseudo: user.pseudo },
    defaultSettings: db.getDefaultSettings(user.id),
  });
});

app.put("/api/auth/pseudo", requireAuth, (req, res) => {
  const { pseudo } = req.body || {};
  if (!auth.isValidPseudo(pseudo)) return res.status(400).json({ error: "Le pseudo doit contenir entre 2 et 20 caractères." });
  db.updatePseudo(req.userId, pseudo.trim().slice(0, 20));
  res.json({ ok: true });
});

app.put("/api/auth/settings", requireAuth, (req, res) => {
  const { settings } = req.body || {};
  if (!settings || typeof settings !== "object") return res.status(400).json({ error: "Réglages invalides." });
  db.updateDefaultSettings(req.userId, settings);
  res.json({ ok: true });
});

app.get("/api/auth/stats", requireAuth, (req, res) => {
  res.json(db.getAggregateStats(req.userId));
});

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

let aiIdCounter = 0;
function generateAIId() {
  aiIdCounter += 1;
  return `ai-${aiIdCounter}-${Date.now()}`;
}

function aiDisplayName(difficulty, existingCount) {
  const label = (AI.DIFFICULTY_PROFILES[difficulty] || AI.DIFFICULTY_PROFILES.difficile).label;
  return `IA ${label}${existingCount > 0 ? ` (${existingCount + 1})` : ""}`;
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

  if (room.engine.gameOver && !room.statsRecorded) {
    room.statsRecorded = true;
    recordGameStatsForRoom(room);
  }

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

// Enregistre les statistiques de fin de partie, uniquement pour les
// joueurs connectés à un compte (userId défini) — les invités et les IA
// ne laissent aucune trace en base.
function recordGameStatsForRoom(room) {
  const engine = room.engine;
  const numPlayers = engine.players.length;
  room.players.forEach((p) => {
    if (!p.userId) return;
    const playerId = room.socketToPlayerId[p.socketId];
    const player = engine.players[playerId];
    if (!player) return;
    const propertiesCount = engine.board.filter((t) => t.owner === playerId).length;
    const won = !!(engine.winner && engine.winner.id === playerId);
    try {
      db.recordGameStats(p.userId, {
        won: won ? 1 : 0,
        bankrupt: player.bankrupt ? 1 : 0,
        finalNetWorth: engine._computeNetWorth(player),
        finalMoney: player.money,
        propertiesCount,
        turnsPlayed: engine.turnNumber,
        numPlayers,
        rentPaid: player.stats.rentPaid,
        rentReceived: player.stats.rentReceived,
        taxesPaid: player.stats.taxesPaid,
        timesInJail: player.stats.timesInJail,
        housesBuilt: player.stats.housesBuilt,
        tradesCompleted: player.stats.tradesCompleted,
        auctionsWon: player.stats.auctionsWon,
        biggestRentPaid: player.stats.biggestRentPaid,
        loansContracted: player.stats.loansContracted,
        insuranceBought: player.stats.insuranceBought,
        salaryCollected: player.stats.salaryCollected,
      });
    } catch (err) {
      console.error("Erreur d'enregistrement des statistiques:", err.message);
    }
  });
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
  socket.on("room:create", ({ name, token } = {}) => {
    if (socket.data.roomCode) return; // déjà dans un salon

    const authedUser = token ? auth.verifyToken(token) : null;
    const playerName = authedUser ? authedUser.pseudo : sanitizeName(name);
    const savedSettings = authedUser ? db.getDefaultSettings(authedUser.userId) : null;

    const code = generateRoomCode();
    const room = {
      code,
      hostSocketId: socket.id,
      players: [{ socketId: socket.id, name: playerName, ready: false, userId: authedUser ? authedUser.userId : null }],
      engine: null,
      started: false,
      socketToPlayerId: {},
      settings: savedSettings ? { ...buildDefaultSettings(), ...validateSettings(savedSettings) } : buildDefaultSettings(),
      previewBoard: null, // rempli si boardMode === "random" (Phase 8b)
      aiCheckScheduled: false,
    };
    rooms.set(code, room);

    socket.join(code);
    socket.data.roomCode = code;
    broadcastLobby(room);
  });

  socket.on("room:join", ({ code, name, token } = {}) => {
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

    const authedUser = token ? auth.verifyToken(token) : null;
    const playerName = authedUser ? authedUser.pseudo : sanitizeName(name);

    room.players.push({ socketId: socket.id, name: playerName, ready: false, userId: authedUser ? authedUser.userId : null });
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
    const existingAICount = room.players.filter((p) => p.isAI).length;
    room.players.push({
      socketId: generateAIId(),
      name: aiDisplayName(chosenDifficulty, existingAICount),
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
      room.players = room.players.filter((p) => p.socketId !== socket.id);
      if (room.players.length === 0) {
        rooms.delete(room.code);
        return;
      }
      if (room.hostSocketId === socket.id) {
        const newHost = room.players.find((p) => !p.isAI) || room.players[0];
        room.hostSocketId = newHost.socketId;
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
  console.log(`Serveur Gaeboub-up démarré sur le port ${PORT}`);
});
