const P = require("path").join(__dirname, "..", "public", "game") + "/";
const { GameEngine } = require(P + "engine.js");
const AI = require(P + "ai.js");
const C = require(P + "contracts.js");
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("ECHEC", m); } else console.log("ok", m); };

function scenario(setup, diff = "expert", runs = 30) {
  let accepted = 0;
  for (let i = 0; i < runs; i++) {
    const e = new GameEngine(["H", "IA", "C"], { startingMoney: 2000, aiPlayerIds: [1], loansEnabled: true });
    [16, 18, 19, 6, 8].forEach((x, j) => (e.board[x].owner = j < 3 ? 1 : 2));
    e.board[21].owner = 0; e.board[23].owner = 0;
    setup(e);
    const before = e.tradeOffers.length;
    if (!e.tradeOffers.length) throw new Error("trade not created");
    AI.decideAndAct(e, 1, diff);
    if (e.tradeOffers.length < before) {
      if (e.contracts.length > 0 || e.players[0].money !== 2000) accepted++;
    }
  }
  return accepted / runs;
}
// 1. Cadeau pur : l'humain cède 2 salaires gratuitement à l'IA
let rate = scenario((e) => e.proposeTrade(0, 1, [], 0, [], 0, [{ type: "salaryCession", count: 2 }], []));
console.log("   cadeau de salaires, acceptation:", rate);
ok(rate > 0.7, "l'IA accepte un cadeau de salaires");
// 2. L'IA doit renoncer à 5 loyers contre rien
rate = scenario((e) => e.proposeTrade(0, 1, [], 0, [], 0, [], [{ type: "rentWaiver", count: 5 }]));
console.log("   exemption de 5 loyers gratuite demandée à l'IA, acceptation:", rate);
ok(rate < 0.5, "l'IA refuse de renoncer gratuitement à 5 loyers");
// 3. Exemple propriétaire : 1000 contre 3 loyers
rate = scenario((e) => e.proposeTrade(0, 1, [], 1000, [], 0, [], [{ type: "rentWaiver", count: 3 }]));
console.log("   1000 contre 3 loyers, acceptation:", rate);
ok(rate > 0.7, "l'IA accepte 1000 contre 3 loyers");
// 4. Option dérisoire sur une propriété de l'IA
rate = scenario((e) => e.proposeTrade(0, 1, [], 0, [], 0, [], [{ type: "option", tileIndex: 16, price: 20, turns: 10 }]));
console.log("   option à 20 sur une propriété, acceptation:", rate);
ok(rate < 0.4, "l'IA refuse une option dérisoire");
// 5. Mix invalide refusé par le moteur
{
  const e = new GameEngine(["H", "IA"], { aiPlayerIds: [1] });
  ok(!e.proposeTrade(0, 1, [], 200, [], 0, [{ type: "jailCards", count: 0 }], []).ok, "clause invalide refusée sans plantage");
}
// 6. IA lève ses options
{
  const e = new GameEngine(["H", "IA"], { startingMoney: 3000, aiPlayerIds: [1] });
  e.board[16].owner = 0; e.board[18].owner = 1; e.board[19].owner = 1;
  e.proposeTrade(0, 1, [], 0, [], 0, [{ type: "option", tileIndex: 16, price: 100, turns: 5 }], undefined);
  e.respondTrade(e.tradeOffers[0].id, 1, true);
  e.currentPlayerIndex = 1;
  for (let i = 0; i < 6 && e.board[16].owner === 0; i++) AI.decideAndAct(e, 1, "expert");
  ok(e.board[16].owner === 1, "l'IA lève une option avantageuse (complète un groupe)");
}
// 7. Prêt à gage : l'IA n'accepte que si besoin criant
{
  let acc = 0;
  for (let i = 0; i < 30; i++) {
    const e = new GameEngine(["H", "IA"], { startingMoney: 3000, aiPlayerIds: [1], loansEnabled: true });
    e.board[18].owner = 1; e.players[1].money = 400;
    e.proposeLoan(0, 1, 300, 10, 6, { collateralTile: 18 });
    AI.decideAndAct(e, 1, "expert");
    if (e.loans.length) acc++;
  }
  console.log("   prêt avec gage à une IA aisée (400):", acc / 30);
  ok(acc / 30 < 0.5, "prêt à gage peu accepté quand le besoin n'est pas criant");
}
process.exit(fail ? 1 : 0);
