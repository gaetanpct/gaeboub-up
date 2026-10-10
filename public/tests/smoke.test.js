const fs = require("fs");
const { JSDOM } = require("jsdom");
const P = require("path").join(__dirname, "..", "public") + "/";
const { GameEngine } = require(P + "game/engine.js");
const AI = require(P + "game/ai.js");
const C = require(P + "game/contracts.js");
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const html = fs.readFileSync(P + "index.html", "utf8").replace(/<script[^>]*src=[^>]*><\/script>/g, "");
let errors = 0, rendered = 0, withContracts = 0, withLoans = 0, withCompany = 0;

function mkClient(id) {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
  const w = dom.window; const h = {};
  w.io = () => ({ id: "s", on: (ev, fn) => (h[ev] = fn), emit() {} });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.AudioContext = undefined;
  for (const f of ["sounds.js", "game/rules-schema.js", "game/powers.js", "game/world-events.js", "game/insurance-plans.js", "game/contracts.js", "board-view.js", "game.js"]) w.eval(fs.readFileSync(P + f, "utf8"));
  return { w, h, id };
}

for (let g = 0; g < 12; g++) {
  const n = 3 + rnd(2);
  const e = new GameEngine(Array.from({ length: n }, (_, i) => "P" + i), { startingMoney: 2000, loansEnabled: true, insuranceEnabled: true, powersEnabled: true, aiPlayerIds: Array.from({ length: n }, (_, i) => i) });
  const clients = Array.from({ length: n }, (_, i) => mkClient(i));
  clients.forEach((c) => c.h["game:started"]({ state: e.getPublicState(), socketToPlayerId: { s: c.id }, settings: {} }));
  for (let step = 0; step < 900; step++) {
    for (const p of e.players) if (!p.bankrupt) AI.decideAndAct(e, p.id, pick(["facile", "difficile", "expert"]));
    if (Math.random() < 0.3) {
      const alive = e.players.filter((p) => !p.bankrupt);
      if (alive.length >= 2) {
        const a = pick(alive), b = pick(alive.filter((x) => x.id !== a.id));
        const t = pick(C.CLAUSE_ORDER); const def = C.CLAUSE_TYPES[t]; const raw = { type: t };
        def.params.forEach((p) => (raw[p.key] = p.type === "ownTile" ? pick(e.board.map((x, i) => i).filter((i) => e.board[i].owner === a.id).concat([0])) : p.type === "choice" ? pick(p.choices) : p.min + rnd(p.max - p.min + 1)));
        e.proposeTrade(a.id, b.id, [], rnd(200), [], 0, [raw], []);
        if (Math.random() < 0.5) e.proposeLoan(a.id, b.id, 100 + rnd(200), 10, 8, { mode: pick(["fixed", "income"]), interestFreeTurns: rnd(3), collateralTile: Math.random() < 0.4 ? pick(e.board.map((x, i) => i).filter((i) => e.board[i].owner === b.id).concat([null])) : null });
      }
    }
    if (step % 60 === 0) {
      const st = e.getPublicState();
      if (st.contracts.length) withContracts++;
      if (st.loans.length) withLoans++;
      if (st.players.some((p) => p.realEstateCompany)) withCompany++;
      for (const c of clients) {
        try {
          c.h["game:update"]({ state: st, settings: {} });
          c.w.renderPropertiesModal(); c.w.renderTradeModal(); c.w.renderLoansModal();
          if (c.w.renderStatsModal) c.w.renderStatsModal();
          rendered++;
        } catch (err) { errors++; console.log("ERREUR rendu", err.stack.split("\n").slice(0, 3).join(" | ")); }
      }
    }
    if (e.gameOver) break;
  }
}
console.log(JSON.stringify({ rendered, errors, withContracts, withLoans, withCompany }));
process.exit(errors ? 1 : 0);
