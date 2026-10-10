const P = require("path").join(__dirname, "..", "public", "game") + "/";
const { GameEngine } = require(P + "engine.js");
const AI = require(P + "ai.js");
const C = require(P + "contracts.js");
const GAMES = Number(process.argv[2] || 100);
const chaosOn = process.argv[3] !== "nochaos";
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const DIFFS = ["facile", "intermediaire", "difficile", "expert"];

function randomClause(e) {
  const type = pick([...C.CLAUSE_ORDER, "bogus"]);
  const raw = { type };
  const def = C.CLAUSE_TYPES[type];
  if (!def) return raw;
  def.params.forEach((p) => {
    if (p.type === "ownTile") raw[p.key] = rnd(40);
    else if (p.type === "choice") raw[p.key] = pick([...p.choices, 33]);
    else raw[p.key] = p.min - 1 + rnd(p.max - p.min + 3);
  });
  return raw;
}

function chaos(e) {
  const alive = e.players.filter((p) => !p.bankrupt);
  if (alive.length < 2) return;
  const a = pick(alive), b = pick(alive.filter((p) => p.id !== a.id));
  const r = Math.random();
  if (r < 0.5) {
    const ot = e.board.map((t, i) => i).filter((i) => e.board[i].owner === a.id && Math.random() < 0.2);
    const rt = e.board.map((t, i) => i).filter((i) => e.board[i].owner === b.id && Math.random() < 0.2);
    const oc = Array.from({ length: rnd(3) }, () => randomClause(e));
    const rc = Array.from({ length: rnd(3) }, () => randomClause(e));
    e.proposeTrade(a.id, b.id, ot, rnd(300), rt, rnd(300), oc, rc);
  } else if (r < 0.7 && e.loansEnabled) {
    e.proposeLoan(a.id, b.id, 50 + rnd(400), rnd(40), 1 + rnd(30), {
      mode: pick(["fixed", "income"]), sharePercent: rnd(100), interestFreeTurns: rnd(7),
      collateralTile: Math.random() < 0.5 ? rnd(40) : null,
    });
  } else if (r < 0.85) {
    const c = e.contracts.find((x) => x.type === "option");
    if (c) e.exerciseOption(c.id, Math.random() < 0.8 ? c.receiverId : a.id);
  } else {
    // un humain "fantôme" répond/annule
    const t = pick(e.tradeOffers.length ? e.tradeOffers : [null]);
    if (t) { if (Math.random() < 0.5) e.respondTrade(t.id, t.toId, Math.random() < 0.7); else e.cancelTrade(t.id, t.fromId); }
    const l = pick(e.loanOffers.length ? e.loanOffers : [null]);
    if (l) e.respondLoan(l.id, l.borrowerId, Math.random() < 0.7);
    const ln = pick(e.loans.length ? e.loans : [null]);
    if (ln && Math.random() < 0.3) e.repayLoanEarly(ln.id, ln.borrowerId);
  }
}

function sig(e) {
  return [e.turnNumber, e.currentPlayerIndex, e.players.map((p) => p.money + ":" + p.position + ":" + p.inJail + ":" + p.jailTurns).join(","),
    e.pendingDecision ? 1 : 0, e.pendingAuction ? JSON.stringify(e.pendingAuction.currentBid) : 0, e.tradeOffers.length, e.loanOffers.length, e.loans.length, e.contracts.length].join("|");
}

function check(e, g) {
  e.players.forEach((p) => { if (!Number.isFinite(p.money)) throw new Error("money NaN " + p.name); });
  e.contracts.forEach((c) => {
    if (e.players[c.giverId].bankrupt || e.players[c.receiverId].bankrupt) throw new Error("contrat avec failli: " + JSON.stringify(c));
    if (c.count !== undefined && c.count < 0) throw new Error("count<0");
    if (c.turnsRemaining <= 0) throw new Error("contrat expiré conservé");
    if (c.tileIndex !== undefined && e.board[c.tileIndex].owner !== c.giverId) throw new Error("contrat sur case changée " + JSON.stringify(c));
    if (c.capLeft !== undefined && c.capLeft <= 0) throw new Error("cap épuisé conservé");
  });
  e.loans.forEach((l) => {
    if (e.players[l.borrowerId].bankrupt) throw new Error("prêt d'un failli conservé");
    if (l.collateralTile !== null && e.board[l.collateralTile].owner !== l.borrowerId) throw new Error("gage perdu non nettoyé");
  });
  // pas de groupe avec "co" key détenu entièrement
  e.board.forEach((t) => { if (t.groupKey && e.isCompanyGroupKey(t.groupKey) && t.owner === null) { /* libre = ok? */ } });
  e.players.forEach((p) => { if (p.jailTurns > 2 && p.inJail) throw new Error("prison > 3 tours " + p.name); });
}

let stalls = 0, finished = 0, capped = 0, errors = 0, jailWorst = 0, contractsMade = 0, optionsDone = 0, cancels = 0;
for (let g = 0; g < GAMES; g++) {
  const n = 2 + rnd(4);
  const opts = {
    startingMoney: pick([1500, 2000, 10000]), loansEnabled: Math.random() < 0.8, insuranceEnabled: Math.random() < 0.6,
    powersEnabled: Math.random() < 0.5, vacationPot: Math.random() < 0.5, worldEventsEnabled: Math.random() < 0.5,
    buildOnlyWhenSoldOut: Math.random() < 0.3, apocalypseAllowed: Math.random() < 0.3, auctionMode: pick(["classic", "secret"]),
    forcedAuctionsPerGame: rnd(3), tradeTaxPercent: pick([0, 0, 10]), aiPlayerIds: Array.from({ length: n }, (_, i) => i),
  };
  let e;
  try {
    e = new GameEngine(Array.from({ length: n }, (_, i) => "P" + i), opts);
    const diffs = e.players.map(() => pick(DIFFS));
    let last = "", same = 0, steps = 0;
    const realMake = e._applyClause.bind(e);
    e._applyClause = (...a) => { contractsMade++; return realMake(...a); };
    const realOpt = e.exerciseOption.bind(e);
    e.exerciseOption = (...a) => { const r = realOpt(...a); if (r.ok) optionsDone++; return r; };
    const realCancel = e._cancelRealEstateCompany.bind(e);
    e._cancelRealEstateCompany = (...a) => { cancels++; return realCancel(...a); };
    while (!e.gameOver && e.turnNumber < 350 && steps++ < 60000) {
      for (const p of e.players) {
        if (p.bankrupt) continue;
        AI.decideAndAct(e, p.id, diffs[p.id]);
      }
      if (chaosOn && Math.random() < 0.35) chaos(e);
      check(e, g);
      const s = sig(e);
      if (s === last && e.pendingAuction && e.pendingAuction.mode === "classic" && same > 15) { e.forceEndClassicAuction(); }
      if (s === last) { if (++same > 400) { stalls++; e.players.filter(p=>p.inDebt).forEach(p=>{ e.board.forEach((t,i)=>{ if(t.owner===p.id && t.type==="property" && t.houses>0){ console.log("   tile",i,t.name,"houses",t.houses,"key",t.groupKey||t.group, "sell:",JSON.stringify(e.canSellHouse(p.id,i)), "groupmates:", e.board.map((u,j)=>({u,j})).filter(({u})=>u.type==="property" && e.effectiveGroupKey(u)===e.effectiveGroupKey(t)).map(({u,j})=>j+":"+u.owner+":h"+u.houses+":m"+(u.mortgaged?1:0)).join(" ")); } }); });
      console.log("BLOCAGE partie", g, "debtPlayers=", e.players.filter(p=>p.inDebt).map(p=>p.id+":"+p.money+":props="+e.board.filter(t=>t.owner===p.id).length+":hs="+e.board.filter(t=>t.owner===p.id&&t.houses>0).length+":mort="+e.board.filter(t=>t.owner===p.id&&t.mortgaged).length), "aiAct=", JSON.stringify(e.players.filter(p=>p.inDebt).map(p=>AI.decideAndAct(e,p.id,"facile"))), s, JSON.stringify({ pd: e.pendingDecision, pa: !!e.pendingAuction, debt: e.players.map((p) => p.inDebt), trades: e.tradeOffers.length })); break; } } else { same = 0; last = s; }
    }
    if (e.gameOver) finished++; else if (e.turnNumber >= 350) capped++;
  } catch (err) {
    errors++; console.log("ERREUR partie", g, err.stack.split("\n").slice(0, 4).join(" | "));
  }
}
console.log(JSON.stringify({ GAMES, finished, capped, stalls, errors, contractsMade, optionsDone, companyCancels: cancels }));
process.exit(stalls || errors ? 1 : 0);
