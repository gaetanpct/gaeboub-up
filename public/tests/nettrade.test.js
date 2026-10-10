const { io } = require("socket.io-client");
const { spawn } = require("child_process");
const PORT = 3459;
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("ECHEC", m); } else console.log("ok", m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = spawn("node", ["server.js"], { cwd: require("path").join(__dirname, ".."), env: { ...process.env, PORT } });
srv.stderr.on("data", (d) => process.stderr.write(d));
function client() {
  const s = io(`http://localhost:${PORT}`, { transports: ["websocket"] });
  s.state = null; s.errors = [];
  s.on("room:session", (x) => (s.session = x));
  s.on("game:started", (g) => { s.game = g; s.state = g.state; });
  s.on("game:update", (g) => (s.state = g.state));
  s.on("room:error", (e) => s.errors.push(e));
  return s;
}
(async () => {
  await sleep(1200);
  const a = client(), b = client(), c = client();
  await sleep(300);
  a.emit("room:create", { name: "Ana" }); await sleep(300);
  const code = a.session.roomCode;
  b.emit("room:join", { code, name: "Ben" }); c.emit("room:join", { code, name: "Cleo" }); await sleep(300);
  a.emit("room:updateSettings", { secretTrades: true, loansEnabled: true }); await sleep(200);
  [a, b, c].forEach((s) => s.emit("room:toggleReady")); await sleep(300);
  a.emit("room:start"); await sleep(800);
  const ids = a.game.socketToPlayerId;
  const idA = ids[a.id], idB = ids[b.id], idC = ids[c.id];

  // Ana propose un pacte + 1 salaire à Ben (cadeau), via la vraie route
  a.emit("game:proposeTrade", { toId: idB, offerTiles: [], offerMoney: 0, requestTiles: [], requestMoney: 0,
    offerClauses: [{ type: "nonAggression", turns: 3 }, { type: "salaryCession", count: 1 }], requestClauses: [] });
  await sleep(400);
  ok(a.errors.length === 0, "proposition acceptée par le serveur " + a.errors.join("|"));
  const t = b.state.tradeOffers[0];
  ok(t && t.hidden === true, "échanges secrets : Ben voit une offre masquée (hidden)");
  ok(c.state.tradeOffers[0] && c.state.tradeOffers[0].hidden && !c.state.tradeOffers[0].offerClauses, "Cléo ne voit pas les clauses");
  ok(a.state.tradeOffers[0].offerClauses.length === 2, "Ana voit ses propres clauses");
  b.emit("game:respondTrade", { tradeId: t.id, accept: true }); await sleep(400);
  ok(a.state.contracts.length === 2 && b.state.contracts.length === 2, "contrats visibles par les parties");
  ok(c.state.contracts.length === 0, "contrats invisibles pour le tiers (échanges secrets)");

  // clause invalide via socket
  a.errors.length = 0;
  a.emit("game:proposeTrade", { toId: idC, offerClauses: [{ type: "rentWaiver", count: 50 }] }); await sleep(300);
  ok(a.errors.length === 1, "clause hors bornes refusée côté serveur : " + a.errors[0]);
  a.errors.length = 0;
  a.emit("game:proposeTrade", { toId: idC, offerClauses: "n'importe quoi" }); await sleep(300);
  ok(a.errors.length === 1, "payload absurde refusé");

  // prêt avec options
  a.emit("game:proposeLoan", { toId: idB, amount: 200, interestRate: 10, duration: 12, mode: "income", sharePercent: 40, interestFreeTurns: 2, collateralTile: "" }); await sleep(300);
  const lo = b.state.loanOffers[0];
  ok(lo && lo.mode === "income" && lo.sharePercent === 40 && lo.interestFreeTurns === 2 && lo.collateralTile === null, "offre de prêt avec options côté serveur");
  b.emit("game:respondLoan", { offerId: lo.id, accept: true }); await sleep(300);
  ok(b.state.loans.length === 1 && b.state.loans[0].mode === "income", "prêt indexé actif");

  // option : exercice par un non-détenteur
  b.emit("game:exerciseOption", { contractId: 999 }); await sleep(200);
  ok(b.errors.length >= 1, "levée d'option invalide -> erreur");

  srv.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
