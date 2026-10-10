const P = require("path").join(__dirname, "..", "public", "game") + "/";
const { GameEngine } = require(P + "engine.js");
const AI = require(P + "ai.js");
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("ECHEC", m); } else console.log("ok", m); };

// 1. 3 échecs -> libéré et 50 payés
{
  const e = new GameEngine(["A", "B"]);
  e.rollDice = () => [2, 5];
  const a = e.players[0];
  e.sendToJail(a);
  const m0 = a.money;
  ok(a.inJail && a.jailTurns === 0, "entrée en prison jailTurns=0");
  e.roll(); ok(a.inJail && a.jailTurns === 1 && e.currentPlayer() === e.players[1], "tentative 1 reste en prison, tour passe");
  e.currentPlayerIndex = 0;
  e.roll(); ok(a.inJail && a.jailTurns === 2, "tentative 2");
  e.currentPlayerIndex = 0;
  e.roll(); ok(!a.inJail && a.money === m0 - 50 && a.jailTurns === 0, "tentative 3 libère et paie 50");
  ok(e.currentPlayer() === a, "le joueur libéré garde son tour");
}
// 2. carte
{
  const e = new GameEngine(["A", "B"]);
  const a = e.players[0]; e.sendToJail(a); a.jailTurns = 2; a.jailFreeCards = 1;
  e.useJailFreeCard(a.id); ok(!a.inJail && a.jailTurns === 0, "carte remet jailTurns à 0");
}
// 3. payJailFine
{
  const e = new GameEngine(["A", "B"]);
  const a = e.players[0]; e.sendToJail(a); a.jailTurns = 2;
  e.payJailFine(a.id); ok(!a.inJail && a.jailTurns === 0, "payJailFine remet jailTurns à 0");
}
// 4. joueur sans argent: dette gérée sans blocage
{
  const e = new GameEngine(["A", "B"]);
  e.rollDice = () => [2, 5];
  const a = e.players[0]; e.sendToJail(a); a.jailTurns = 2; a.money = 10;
  e.roll();
  ok(!a.inJail, "libéré même sans argent");
}
// 5. résistance IA : aucun joueur plus de 3 tours consécutifs en prison
{
  let worst = 0, stuck = 0;
  for (let g = 0; g < 150; g++) {
    const e = new GameEngine(["A", "B", "C"]);
    e.rollDice = () => { const d = 1 + Math.floor(Math.random() * 6); let d2 = 1 + Math.floor(Math.random() * 6); return [d, d2]; };
    const run = {};
    let steps = 0, last = "";
    while (!e.gameOver && steps++ < 20000 && e.turnNumber < 300) {
      for (const p of e.players) if (!p.bankrupt) AI.decideAndAct(e, p.id, "intermediate");
      for (const p of e.players) {
        run[p.id] = p.inJail ? (run[p.id] || 0) : 0;
        if (p.inJail && p.jailTurns > worst) worst = p.jailTurns;
      }
    }
    if (steps >= 20000) stuck++;
  }
  ok(worst <= 2, "jailTurns max observé en prison = " + worst);
  ok(stuck === 0, "aucune partie bloquée (" + stuck + ")");
}
process.exit(fail ? 1 : 0);
