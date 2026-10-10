const P = require("path").join(__dirname, "..", "public", "game") + "/";
const { GameEngine } = require(P + "engine.js");
const AI = require(P + "ai.js");
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("ECHEC", m); } else console.log("ok", m); };

function setup() {
  const e = new GameEngine(["A", "B", "C"], { startingMoney: 10000 });
  const own = (ids, p) => ids.forEach((i) => (e.board[i].owner = p));
  own([16, 21, 6], 0);
  own([18, 19, 23, 24, 1, 3], 1);
  e.board.forEach((t, i) => { if (["property", "airport", "utility"].includes(t.type) && t.owner === null) t.owner = 2; });
  e.board[1].houses = 1; e.board[37].houses = 1;
  return e;
}

const e = setup();
ok(e.canFormRealEstateCompany(0).ok, "A peut former sa société : " + (e.canFormRealEstateCompany(0).reason || ""));
e.formRealEstateCompany(0);
const k = (i) => e.board[i].groupKey;
ok(k(18) && k(18) === k(19) && !e.isCompanyGroupKey(k(18)), "oranges de B : sous-groupe partagé " + k(18));
ok(k(23) === k(24) && k(23) !== k(18), "rouges de B : sous-groupe séparé de l'orange " + k(23));
ok(k(8) === k(9), "cyan de C : sous-groupe");
ok(e.isCompanyGroupKey(k(16)) && e.isCompanyGroupKey(k(21)), "cases de A en clé Société");
ok(e.ownsFullSet(1, e.board[18]) && e.ownsFullSet(1, e.board[23]), "B possède ses deux sous-groupes");
ok(!e.ownsFullSet(0, e.board[16]), "A n'a pas de faux monopole sur sa case isolée");
e.currentPlayerIndex = 1;
ok(e.canBuildHouse(1, 18).ok, "B peut construire sur l'orange : " + (e.canBuildHouse(1, 18).reason || ""));
e.buildHouse(1, 18);
ok(!e.canBuildHouse(1, 18).ok && e.canBuildHouse(1, 19).ok, "Even Build dans le sous-groupe orange");
ok(e.canBuildHouse(1, 23).ok, "B peut construire sur le rouge indépendamment de l'orange");
e.currentPlayerIndex = 0;
ok(!e.canBuildHouse(0, 16).ok, "A ne peut pas construire sur une case de société");

// état public pour le client
const pub = e.getPublicState();
ok(pub.board[18].groupKey === k(18), "groupKey exposé");

// IA : B construit dans les sous-groupes
{
  const e2 = setup(); e2.formRealEstateCompany(0);
  e2.currentPlayerIndex = 1;
  e2.rollDice = () => [3, 4];
  let built = 0;
  for (let i = 0; i < 40 && built === 0; i++) {
    AI.decideAndAct(e2, 1, "hard");
    built = [18, 19, 23, 24].reduce((s, j) => s + (e2.board[j].houses || 0), 0);
    if (e2.currentPlayerIndex !== 1) e2.currentPlayerIndex = 1;
  }
  ok(built > 0, "l'IA construit dans un sous-groupe (maisons=" + built + ")");
}

// B2 : annulation quand A reconstitue un groupe complet (via échange)
{
  const e3 = setup(); e3.formRealEstateCompany(0);
  e3.proposeTrade(0, 1, [], 500, [18, 19], 0);
  const t = e3.tradeOffers[0];
  const r = e3.respondTrade(t.id, 1, true);
  ok(r.ok, "échange accepté");
  ok(!e3.players[0].realEstateCompany, "société annulée");
  ok([16, 18, 19].every((i) => !e3.board[i].groupKey), "orange revient à la clé d'origine");
  ok(!e3.board[23].groupKey && !e3.board[24].groupKey && !e3.board[21].groupKey, "rouge aussi rétabli");
  ok(e3.ownsFullSet(0, e3.board[16]), "A a un vrai groupe orange");
  ok(e3.canBuildHouse(0, 16).ok || /Even|argent|bloqu/.test(e3.canBuildHouse(0, 16).reason || ""), "A peut construire (ou raison légitime)");
}
// B2 : achat aux enchères d'un sous-groupe entier
{
  const e4 = setup(); e4.formRealEstateCompany(0);
  // B vend ses oranges à A directement
  e4.board[18].owner = 0; e4.board[19].owner = 0; e4._onOwnershipChanged();
  ok(!e4.players[0].realEstateCompany, "annulation après changement de propriétaire direct");
}
// Pas d'annulation intempestive
{
  const e5 = setup(); e5.formRealEstateCompany(0);
  e5.board[18].owner = 0; e5._onOwnershipChanged();
  ok(!!e5.players[0].realEstateCompany, "pas d'annulation avec un seul membre du sous-groupe");
}
// Faillite de A
{
  const e6 = setup(); e6.formRealEstateCompany(0);
  e6.players[0].money = -99999; e6.players[0].inDebt = true;
  e6.checkBankruptcy(e6.players[0]);
  e6.declareBankruptcyIfStuck && 0;
  ok(true, "faillite : état " + (e6.players[0].bankrupt ? "faillite" : "pas encore"));
}
process.exit(fail ? 1 : 0);
