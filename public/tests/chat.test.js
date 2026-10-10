const { io } = require("socket.io-client");
const { spawn } = require("child_process");
const PORT = 3457;
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("ECHEC", m); } else console.log("ok", m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn("node", ["server.js"], { cwd: require("path").join(__dirname, ".."), env: { ...process.env, PORT } });
srv.stderr.on("data", (d) => process.stderr.write(d));

function client() {
  const s = io(`http://localhost:${PORT}`, { transports: ["websocket"] });
  s.inbox = []; s.history = null; s.errors = [];
  s.on("chat:message", (m) => s.inbox.push(m));
  s.on("chat:history", (h) => (s.history = h));
  s.on("chat:error", (e) => s.errors.push(e));
  s.on("room:session", (x) => (s.session = x));
  s.on("room:update", (r) => (s.room = r));
  s.on("game:started", (g) => (s.game = g));
  return s;
}

(async () => {
  await sleep(1200);
  const a = client(), b = client(), c = client();
  await sleep(300);
  a.emit("room:create", { name: "Ana" }); await sleep(300);
  const code = a.session.roomCode;
  b.emit("room:join", { code, name: "Ben" }); await sleep(200);
  c.emit("room:join", { code, name: "Cléo" }); await sleep(200);
  a.emit("room:addAI", { difficulty: "easy" }); await sleep(200);
  [a, b, c].forEach((s) => s.emit("room:toggleReady")); await sleep(300);
  a.emit("room:start"); await sleep(800);
  ok(a.game && b.game && c.game, "partie démarrée");
  const ids = a.game.socketToPlayerId;
  const idA = ids[a.id], idB = ids[b.id], idC = ids[c.id];

  // chat avant démarrage ignoré: n/a. Public
  a.emit("chat:send", { text: "  Salut   tout le monde  " }); await sleep(200);
  ok([a, b, c].every((s) => s.inbox.length === 1 && s.inbox[0].text === "Salut tout le monde" && s.inbox[0].from === idA), "message public reçu par tous, texte normalisé");

  // usurpation: l'expéditeur envoyé par le client est ignoré
  b.emit("chat:send", { text: "usurpation", from: idA, fromName: "Ana" }); await sleep(200);
  ok(a.inbox[1].from === idB && a.inbox[1].fromName === "Ben", "expéditeur déduit de la socket");

  // privé A -> B : C ne reçoit rien
  await sleep(800);
  a.emit("chat:send", { text: "secret", toPlayerId: idB }); await sleep(200);
  ok(b.inbox.some((m) => m.text === "secret"), "B reçoit le privé");
  ok(a.inbox.some((m) => m.text === "secret"), "A voit son privé");
  ok(!c.inbox.some((m) => m.text === "secret"), "C ne reçoit PAS le privé");

  // anti-spam
  a.emit("chat:send", { text: "x1" }); a.emit("chat:send", { text: "x2" }); await sleep(250);
  ok(a.errors.length >= 1 && !a.inbox.some((m) => m.text === "x2"), "anti-spam 700 ms");
  await sleep(800);

  // vide, trop long, destinataires invalides
  const before = a.inbox.length;
  a.emit("chat:send", { text: "   " }); a.emit("chat:send", { text: 42 }); a.emit("chat:send", null); await sleep(200);
  ok(a.inbox.length === before, "vide / non-texte / null ignorés");
  await sleep(800);
  a.emit("chat:send", { text: "y".repeat(500) }); await sleep(200);
  ok(a.inbox[a.inbox.length - 1].text.length === 200, "texte tronqué à 200");
  await sleep(800);
  const aiId = a.game.state.aiPlayerIds[0];
  a.errors.length = 0;
  a.emit("chat:send", { text: "à l'IA", toPlayerId: aiId }); await sleep(200);
  ok(a.errors.length === 1, "IA non destinataire");
  await sleep(800);
  a.emit("chat:send", { text: "à moi", toPlayerId: idA }); a.emit("chat:send", { text: "inconnu", toPlayerId: 99 }); await sleep(200);
  ok(!a.inbox.some((m) => m.text === "à moi" || m.text === "inconnu"), "soi-même / id inconnu refusés");

  // HTML brut transmis tel quel (affichage via textContent côté client)
  await sleep(800);
  b.emit("chat:send", { text: "<img src=x onerror=alert(1)>" }); await sleep(200);
  ok(a.inbox[a.inbox.length - 1].text.includes("<img"), "HTML conservé comme texte brut côté serveur");

  // reconnexion de C: historique = publics + ses privés (pas le privé A->B)
  const token = c.session.playerToken;
  c.disconnect(); await sleep(300);
  const c2 = client(); await sleep(300);
  c2.emit("room:rejoin", { roomCode: code, playerToken: token }); await sleep(500);
  ok(c2.history && c2.history.length > 0, "historique reçu à la reconnexion");
  ok(c2.history && !c2.history.some((m) => m.text === "secret") && c2.history.some((m) => m.text === "Salut tout le monde"), "historique sans privé d'autrui");
  ok(c2.history.length <= 50, "historique borné");

  srv.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
