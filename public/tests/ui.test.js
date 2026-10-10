const fs = require("fs");
const { JSDOM } = require("jsdom");
const P = require("path").join(__dirname, "..", "public") + "/";
const { GameEngine } = require(P + "game/engine.js");
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("ECHEC", m); } else console.log("ok", m); };

function setup() {
  const e = new GameEngine(["A", "B", "C"], { startingMoney: 10000 });
  const own = (ids, p) => ids.forEach((i) => (e.board[i].owner = p));
  own([16, 21, 6], 0);
  own([18, 19, 23, 24, 1, 3], 1);
  e.board.forEach((t) => { if (["property", "airport", "utility"].includes(t.type) && t.owner === null) t.owner = 2; });
  e.board[1].houses = 1; e.board[37].houses = 1;
  e.formRealEstateCompany(0);
  return e;
}

function boot(state, myId) {
  const html = fs.readFileSync(P + "index.html", "utf8").replace(/<script[^>]*src=[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
  const w = dom.window;
  const handlers = {};
  const emitted = [];
  w.io = () => ({ id: "sock1", on: (ev, fn) => { handlers[ev] = fn; }, emit: (ev, p) => emitted.push([ev, p]) });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.AudioContext = function () { return { createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }, createOscillator() { return { frequency: { value: 0, setValueAtTime() {} }, connect() {}, start() {}, stop() {}, type: "" }; }, destination: {}, currentTime: 0, state: "running", resume() {} }; };
  for (const f of ["sounds.js", "game/rules-schema.js", "game/powers.js", "game/world-events.js", "game/insurance-plans.js", "board-view.js", "game.js"]) {
    w.eval(fs.readFileSync(P + f, "utf8"));
  }
  handlers["game:started"]({ state, socketToPlayerId: { sock1: myId }, settings: {} });
  return { w, emitted, handlers };
}

const e = setup();
for (const [who, label, tiles] of [[1, "B", [18, 19, 23, 24]]]) {
  const { w } = boot(e.getPublicState(), who);
  w.renderPropertiesModal();
  const list = w.document.getElementById("properties-list");
  const builds = [...list.querySelectorAll("[data-action='build']")].map((b) => Number(b.dataset.tile));
  console.log("boutons Construire pour B:", builds.join(","));
  ok(tiles.every((t) => builds.includes(t)), "B voit 'Construire' sur ses deux sous-groupes (orange et rouge)");
  ok(list.textContent.includes("Sous-groupe indépendant"), "mention 'Sous-groupe indépendant'");
}
{
  const { w } = boot(e.getPublicState(), 0);
  w.renderPropertiesModal();
  const list = w.document.getElementById("properties-list");
  ok(list.querySelectorAll("[data-action='build']").length === 0, "A (société) n'a aucun bouton Construire");
  ok(list.textContent.includes("Société Immobilière"), "A voit l'étiquette Société Immobilière");
}
// C possède cyan 8,9 en sous-groupe mais 6 est à A : C a le sous-groupe complet
{
  const { w } = boot(e.getPublicState(), 2);
  w.renderPropertiesModal();
  const list = w.document.getElementById("properties-list");
  const builds = [...list.querySelectorAll("[data-action='build']")].map((b) => Number(b.dataset.tile));
  ok(builds.includes(8) && builds.includes(9), "C peut construire sur son sous-groupe cyan");
}
// Sous-groupe incomplet : B possède 18 seulement, 19 à C
{
  const e2 = setup(); e2.board[19].owner = 2;
  const { w } = boot(e2.getPublicState(), 1);
  w.renderPropertiesModal();
  const list = w.document.getElementById("properties-list");
  const builds = [...list.querySelectorAll("[data-action='build']")].map((b) => Number(b.dataset.tile));
  ok(!builds.includes(18), "pas de bouton si le sous-groupe est incomplet");
  ok(/il manque/.test(list.textContent), "l'interface indique ce qu'il manque");
}
process.exit(fail ? 1 : 0);
