const fs = require("fs");
const { JSDOM } = require("jsdom");
const P = require("path").join(__dirname, "..", "public") + "/";
const { GameEngine } = require(P + "game/engine.js");
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("ECHEC", m); } else console.log("ok", m); };

const e = new GameEngine(["Ana", "Ben", "Cleo"], { startingMoney: 5000, loansEnabled: true, insuranceEnabled: true });
e.board[16].owner = 0; e.board[18].owner = 0; e.board[21].owner = 1;

const html = fs.readFileSync(P + "index.html", "utf8").replace(/<script[^>]*src=[^>]*><\/script>/g, "");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window; const handlers = {}; const emitted = [];
w.io = () => ({ id: "s", on: (ev, fn) => (handlers[ev] = fn), emit: (ev, p) => emitted.push([ev, p]) });
for (const f of ["sounds.js", "game/rules-schema.js", "game/powers.js", "game/world-events.js", "game/insurance-plans.js", "game/contracts.js", "board-view.js", "game.js"]) w.eval(fs.readFileSync(P + f, "utf8"));
const push = () => handlers["game:update"]({ state: e.getPublicState(), settings: {} });
handlers["game:started"]({ state: e.getPublicState(), socketToPlayerId: { s: 0 }, settings: {} });
const $ = (id) => w.document.getElementById(id);
const setVal = (id, v) => { const el = $(id); el.value = v; };

w.renderTradeModal();
ok($("clause-type-offer") && $("clause-type-request"), "constructeur de clauses présent des deux côtés");
// ajouter une clause "salaryCession" côté offre
$("clause-type-offer").value = "salaryCession"; $("clause-type-offer").dispatchEvent(new w.Event("change"));
setVal("cl-offer-salaryCession-count", "2");
w.document.querySelector("[data-add-clause='offer']").click();
ok(w.document.querySelectorAll(".clause-list li").length === 1, "clause ajoutée au brouillon");
ok(w.document.querySelector(".clause-list").textContent.includes("2 prochain(s) salaire"), "description lisible");
// clause rentWaiver côté demande (l'autre me renonce à 3 loyers)
$("clause-type-request").value = "rentWaiver"; $("clause-type-request").dispatchEvent(new w.Event("change"));
setVal("cl-request-rentWaiver-count", "3");
w.document.querySelector("[data-add-clause='request']").click();
ok(w.document.querySelectorAll(".clause-list li").length === 2, "deuxième clause côté demande");
// clause invalide
$("clause-type-offer").value = "rentWaiver"; $("clause-type-offer").dispatchEvent(new w.Event("change"));
setVal("cl-offer-rentWaiver-count", "99");
w.document.querySelector("[data-add-clause='offer']").click();
ok(/entre 1 et 5/.test($("trade-error").textContent), "valeur hors bornes signalée : " + $("trade-error").textContent);
// proposer
setVal("trade-offer-money", "1000");
$("btn-propose-trade").click();
const sent = emitted.filter((x) => x[0] === "game:proposeTrade").pop()[1];
ok(sent.offerMoney === 1000 && sent.offerClauses.length === 1 && sent.requestClauses.length === 1, "payload avec clauses");
ok(sent.offerClauses[0].type === "salaryCession" && sent.requestClauses[0].type === "rentWaiver" && sent.requestClauses[0].count === 3, "contenu des clauses");
ok(w.document.querySelectorAll(".clause-list li").length === 0, "brouillon vidé après envoi");

// Le serveur (moteur) accepte ce payload tel quel
const r = e.proposeTrade(0, 1, [], sent.offerMoney, [], 0, sent.offerClauses, sent.requestClauses);
ok(r.ok, "moteur : " + (r.reason || "ok"));
// côté Ben (destinataire), la ligne d'offre affiche les clauses
{
  const dom2 = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
  const w2 = dom2.window; const h2 = {}; const em2 = [];
  w2.io = () => ({ id: "s2", on: (ev, fn) => (h2[ev] = fn), emit: (ev, p) => em2.push([ev, p]) });
  for (const f of ["sounds.js", "game/rules-schema.js", "game/powers.js", "game/world-events.js", "game/insurance-plans.js", "game/contracts.js", "board-view.js", "game.js"]) w2.eval(fs.readFileSync(P + f, "utf8"));
  h2["game:started"]({ state: e.getPublicState(), socketToPlayerId: { s2: 1 }, settings: {} });
  w2.renderTradeModal();
  const txt = w2.document.getElementById("trade-content").textContent;
  ok(txt.includes("salaire") && txt.includes("loyer"), "Ben voit les clauses dans l'offre reçue");
  w2.document.querySelector("[data-accept-trade]").click();
  ok(em2.some((x) => x[0] === "game:respondTrade" && x[1].accept === true), "acceptation émise");
  e.respondTrade(e.tradeOffers[0].id, 1, true);
  h2["game:update"]({ state: e.getPublicState(), settings: {} });
  w2.renderTradeModal();
  const txt2 = w2.document.getElementById("trade-content").textContent;
  ok(txt2.includes("Contrats en cours") && txt2.includes("Ana") , "section contrats affichée");
}
// Option : bouton lever l'option
{
  const e3 = new GameEngine(["Ana", "Ben"], { startingMoney: 5000 });
  e3.board[16].owner = 0;
  e3.proposeTrade(0, 1, [], 0, [], 0, [{ type: "option", tileIndex: 16, price: 150, turns: 4 }], []);
  // proposeTrade(0->1) : offerClauses sont donnés par 0
  e3.tradeOffers.length = 0;
  e3.proposeTrade(0, 1, [], 0, [], 0, [{ type: "option", tileIndex: 16, price: 150, turns: 4 }], undefined);
  e3.respondTrade(e3.tradeOffers[0].id, 1, true);
  const dom3 = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
  const w3 = dom3.window; const h3 = {}; const em3 = [];
  w3.io = () => ({ id: "s3", on: (ev, fn) => (h3[ev] = fn), emit: (ev, p) => em3.push([ev, p]) });
  for (const f of ["sounds.js", "game/rules-schema.js", "game/powers.js", "game/world-events.js", "game/insurance-plans.js", "game/contracts.js", "board-view.js", "game.js"]) w3.eval(fs.readFileSync(P + f, "utf8"));
  h3["game:started"]({ state: e3.getPublicState(), socketToPlayerId: { s3: 1 }, settings: {} });
  w3.renderTradeModal();
  const btn = w3.document.querySelector("[data-exercise-option]");
  ok(!!btn, "bouton 'Lever l'option' pour le détenteur");
  btn.click();
  ok(em3.some((x) => x[0] === "game:exerciseOption"), "événement exerciseOption émis");
}
// Prêts : formulaire enrichi
{
  w.renderLoansModal();
  ok($("loan-mode") && $("loan-share") && $("loan-free") && $("loan-collateral"), "formulaire de prêt enrichi");
  setVal("loan-amount", "300"); setVal("loan-mode", "income"); setVal("loan-share", "40"); setVal("loan-free", "2");
  $("btn-propose-loan").click();
  const p = emitted.filter((x) => x[0] === "game:proposeLoan").pop()[1];
  ok(p.mode === "income" && p.sharePercent === 40 && p.interestFreeTurns === 2 && p.amount === 300, "payload de prêt");
}
process.exit(fail ? 1 : 0);
