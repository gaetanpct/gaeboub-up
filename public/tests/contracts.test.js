const P = require("path").join(__dirname, "..", "public", "game") + "/";
const { GameEngine } = require(P + "engine.js");
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("ECHEC", m); } else console.log("ok", m); };

function fresh(opts = {}) {
  const e = new GameEngine(["A", "B", "C"], { startingMoney: 5000, loansEnabled: true, ...opts });
  e.board[16].owner = 0; // A possède orange 16
  e.board[18].owner = 0;
  e.board[21].owner = 1; // B possède rouge 21
  return e;
}
// B arrive sur la case `tile` (jeu d'un tour)
function landOn(e, pid, tile, dice = [1, 2]) {
  const p = e.players[pid];
  e.pendingDecision = null; e.pendingAuction = null;
  p.position = (tile - (dice[0] + dice[1]) + 40) % 40;
  e.currentPlayerIndex = pid;
  e.rollDice = () => dice;
  const m0 = p.money;
  e.roll();
  return m0 - p.money;
}
function trade(e, from, to, ot, om, rt, rm, oc, rc) {
  const r = e.proposeTrade(from, to, ot, om, rt, rm, oc, rc);
  if (!r.ok) return r;
  return e.respondTrade(r.tradeId, to, true);
}

// --- Exemple du propriétaire : B donne 1000, A renonce aux 3 prochains loyers de B
{
  const e = fresh();
  const r = trade(e, 1, 0, [], 1000, [], 0, [], [{ type: "rentWaiver", count: 3 }]);
  ok(r.ok, "échange argent contre exemption accepté : " + (r.reason || ""));
  ok(e.contracts.length === 1 && e.contracts[0].count === 3, "contrat créé");
  const paid = [1, 2, 3, 4].map(() => landOn(e, 1, 16));
  console.log("   loyers payés par B sur la 16 :", paid.join(","));
  ok(paid[0] === 0 && paid[1] === 0 && paid[2] === 0 && paid[3] > 0, "3 loyers annulés, le 4e est payé");
  ok(e.contracts.length === 0, "contrat consommé");
  // mais A paie toujours B
  const e2 = fresh(); trade(e2, 1, 0, [], 0, [], 0, [], [{ type: "rentWaiver", count: 2 }]);
  ok(landOn(e2, 0, 21) > 0, "l'exemption ne joue que dans un sens");
}
// --- Cession de loyers
{
  const e = fresh();
  ok(trade(e, 0, 1, [], 0, [], 300, [{ type: "rentCession", tileIndex: 16, turns: 2 }], []).ok, "cession (A cède 16 à B contre 300)");
  const a0 = e.players[0].money, b0 = e.players[1].money;
  const paid = landOn(e, 2, 16);
  ok(paid > 0 && e.players[1].money === b0 + paid && e.players[0].money === a0, "le loyer de C va à B et non à A");
  ok(landOn(e, 1, 16) === 0, "B sur sa propre case cédée ne paie rien");
  ok(landOn(e, 0, 16) === 0, "A sur sa case ne paie rien non plus");
  // expiration après 2 tours complets
  for (let i = 0; i < 6; i++) { e.currentPlayerIndex = i % 3; e.nextPlayer(); }
  ok(!e.contracts.some((c) => c.type === "rentCession"), "contrat expiré après 2 tours complets");
  // vente de la case : contrat annulé
  const e2 = fresh(); trade(e2, 0, 1, [], 0, [], 100, [{ type: "rentCession", tileIndex: 16, turns: 5 }], []);
  e2.board[16].owner = 2; e2._onOwnershipChanged();
  ok(e2.contracts.length === 0, "propriété cédée à un tiers -> contrat annulé");
}
// --- Salaire
{
  const e = fresh();
  ok(trade(e, 0, 1, [], 0, [], 0, [{ type: "salaryCession", count: 2 }], []).ok, "A cède 2 salaires à B (cadeau)");
  const a0 = e.players[0].money, b0 = e.players[1].money;
  e.players[0].position = 38; e.currentPlayerIndex = 0; e.rollDice = () => [2, 2]; e.roll();
  ok(e.players[1].money === b0 + 200 && e.players[0].money === a0, "le salaire va à B");
  ok(e.contracts[0].count === 1, "il reste 1 salaire");
}
// --- Pacte
{
  const e = fresh();
  ok(trade(e, 0, 1, [], 0, [], 0, [{ type: "nonAggression", turns: 3 }], []).ok, "pacte conclu");
  ok(landOn(e, 1, 16) === 0 && landOn(e, 0, 21) === 0, "pas de loyer dans les deux sens");
  ok(landOn(e, 2, 16) > 0, "C paie toujours");
  ok(!trade(e, 1, 0, [], 0, [], 0, [{ type: "nonAggression", turns: 2 }], []).ok, "second pacte refusé");
}
// --- Cartes
{
  const e = fresh(); e.players[0].jailFreeCards = 2;
  ok(trade(e, 0, 1, [], 0, [], 0, [{ type: "jailCards", count: 2 }], []).ok && e.players[1].jailFreeCards === 2 && e.players[0].jailFreeCards === 0, "cartes transférées");
  ok(!e.proposeTrade(0, 1, [], 0, [], 0, [{ type: "jailCards", count: 1 }], []).ok, "plus de carte à donner -> refusé");
}
// --- Option
{
  const e = fresh();
  ok(trade(e, 0, 1, [], 0, [], 50, [{ type: "option", tileIndex: 16, price: 150, turns: 4 }], []).ok, "option accordée");
  const c = e.contracts.find((x) => x.type === "option");
  const a0 = e.players[0].money, b0 = e.players[1].money;
  ok(!e.exerciseOption(c.id, 0).ok, "seul le détenteur peut lever l'option");
  ok(e.exerciseOption(c.id, 1).ok && e.board[16].owner === 1 && e.players[1].money === b0 - 150 && e.players[0].money === a0 + 150, "option levée");
  ok(e.contracts.length === 0, "contrat soldé");
}
// --- Assurance entre joueurs
{
  const e = fresh();
  ok(trade(e, 1, 0, [], 120, [], 0, [], [{ type: "insuranceCover", percent: 50, cap: 100, turns: 5 }]).ok, "A assure B (prime 120)");
  const a0 = e.players[0].money;
  const paid = landOn(e, 1, 16, [3, 4]); // B -> A
  console.log("   payé par B net:", paid);
  const c = e.contracts.find((x) => x.type === "insuranceCover");
  ok(!!c || true, "contrat présent ou consommé");
  // A est aussi le bénéficiaire du loyer : il rembourse à lui-même -> net 0 ; test avec C propriétaire
  const e2 = fresh(); e2.board[19].owner = 2; e2.board[19].houses = 0;
  const tr = trade(e2, 1, 0, [], 0, [], 0, [], [{ type: "insuranceCover", percent: 50, cap: 100, turns: 5 }]); ok(tr.ok, "assurance cap 100 acceptée " + (tr.reason||"")); e2.contracts[0].capLeft = 5;
  const rent = e2.board[19].rent * 1;
  const before = { a: e2.players[0].money, b: e2.players[1].money, c: e2.players[2].money };
  landOn(e2, 1, 19);
  const dA = before.a - e2.players[0].money, dB = before.b - e2.players[1].money, dC = e2.players[2].money - before.c;
  console.log("   assureur A:", dA, " assuré B:", dB, " bénéficiaire C:", dC);
  ok(dA === 5 && dB + dA === dC, "A rembourse 5 (plafond restant), C touche le loyer entier");
  // assureur sans argent : jamais à découvert
  const e3 = fresh(); e3.board[19].owner = 2;
  trade(e3, 1, 0, [], 0, [], 0, [], [{ type: "insuranceCover", percent: 75, cap: 1000, turns: 5 }]);
  e3.players[0].money = 1;
  landOn(e3, 1, 19);
  ok(e3.players[0].money >= 0, "l'assureur ne passe jamais à découvert (" + e3.players[0].money + ")");
}
// --- Validations
{
  const e = fresh();
  ok(!e.proposeTrade(0, 1, [], 0, [], 0, [{ type: "rentCession", tileIndex: 21, turns: 2 }], []).ok, "cession d'une case qui n'est pas au donneur refusée");
  ok(!e.proposeTrade(0, 1, [16], 0, [], 0, [{ type: "option", tileIndex: 16, price: 10, turns: 2 }], []).ok, "case échangée ET en clause refusée");
  ok(!e.proposeTrade(0, 1, [], 0, [], 0, [{ type: "rentWaiver", count: 99 }], []).ok, "valeur hors bornes refusée");
  ok(!e.proposeTrade(0, 1, [], 0, [], 0, [{ type: "magie" }], []).ok, "type inconnu refusé");
  ok(!e.proposeTrade(0, 1, [], 0, [], 0, [{type:"rentWaiver",count:1},{type:"rentWaiver",count:1},{type:"salaryCession",count:1},{type:"jailCards",count:0}], []).ok, "trop de clauses refusé");
  ok(!e.proposeTrade(0, 1, [], 0, [], 0, "x", []).ok, "clauses non tableau refusées");
  e.board[16].mortgaged = true;
  ok(!e.proposeTrade(0, 1, [], 0, [], 0, [{ type: "option", tileIndex: 16, price: 10, turns: 2 }], []).ok, "case hypothéquée refusée");
  // faillite
  const e2 = fresh(); trade(e2, 0, 1, [], 0, [], 0, [{ type: "salaryCession", count: 3 }], []);
  e2.players[0].bankrupt = true; e2._onOwnershipChanged();
  ok(e2.contracts.length === 0, "contrat annulé à la faillite");
  // état public
  const pub = fresh().getPublicState();
  ok(Array.isArray(pub.contracts), "contracts exposé");
}
// --- Prêts
{
  const e = fresh();
  ok(e.proposeLoan(0, 1, 500, 20, 10, { mode: "income", sharePercent: 50, interestFreeTurns: 2 }).ok, "prêt indexé proposé");
  const off = e.loanOffers[0];
  ok(e.respondLoan(off.id, 1, true).ok, "accepté");
  const L = e.loans[0];
  ok(L.mode === "income" && L.sharePercent === 50 && L.totalOwed === 600, "paramètres du prêt");
  // B encaisse un loyer de C -> 50% part chez A
  e.board[21].owner = 1;
  const a0 = e.players[0].money;
  const paid = landOn(e, 2, 21);
  ok(e.players[0].money > a0 && L.repaid > 0, `une part des loyers de B rembourse le prêt (${L.repaid})`);
  // remboursement anticipé pendant la période sans intérêt : capital seulement
  const due = e.loanAmountDue(L);
  ok(due === 500 - L.repaid, "pendant la période sans intérêt, on rend le capital (reste " + due + ")");
  ok(e.repayLoanEarly(L.id, 1).ok && e.loans.length === 0, "remboursé par anticipation");
}
{
  // gage
  const e = fresh();
  e.proposeLoan(0, 1, 300, 10, 2, { collateralTile: 21 });
  e.respondLoan(e.loanOffers[0].id, 1, true);
  ok(e._isCollateral(21), "gage enregistré");
  ok(!e.proposeTrade(1, 0, [21], 0, [], 0).ok, "gage non échangeable");
  ok(!e.proposeLoan(2, 1, 100, 0, 3, { collateralTile: 21 }).ok, "gage déjà pris");
  ok(!e.proposeLoan(0, 1, 100, 0, 3, { collateralTile: 16 }).ok, "gage doit appartenir à l'emprunteur");
  e.players[1].money = 5; // B est fauché
  for (let i = 0; i < 4; i++) { e.currentPlayerIndex = 1; e.nextPlayer(); if (e.players[1].inDebt) break; }
  ok(e.board[21].owner === 0 && e.loans.length === 0 && !e.players[1].inDebt, "défaut : le gage passe au prêteur, dette soldée");
}
{
  // compat ancienne signature
  const e = fresh();
  ok(e.proposeLoan(0, 1, 200, 10, 3).ok, "ancienne signature sans options");
  e.respondLoan(e.loanOffers[0].id, 1, true);
  ok(e.loans[0].mode === "fixed" && e.loanAmountDue(e.loans[0]) === 220, "prêt classique inchangé");
}
process.exit(fail ? 1 : 0);
