const { io } = require("socket.io-client");
const { spawn } = require("child_process");
const PORT = 3461;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = spawn("node", ["server.js"], { cwd: require("path").join(__dirname, ".."), env: { ...process.env, PORT } });
let stderr = "";
srv.stderr.on("data", (d) => (stderr += d));
(async () => {
  await sleep(1200);
  const a = io(`http://localhost:${PORT}`, { transports: ["websocket"] });
  let state = null, session = null;
  a.on("room:session", (x) => (session = x));
  a.on("game:started", (g) => (state = g.state));
  a.on("game:update", (g) => (state = g.state));
  await sleep(300);
  a.emit("room:create", { name: "Ana" }); await sleep(300);
  a.emit("room:updateSettings", { loansEnabled: true, insuranceEnabled: true, powersEnabled: true, worldEventsEnabled: true });
  ["facile", "intermediaire", "difficile"].forEach((d) => a.emit("room:addAI", { difficulty: d })); await sleep(300);
  a.emit("room:toggleReady"); await sleep(200);
  a.emit("room:start"); await sleep(600);
  a.emit("game:forfeit"); // l'humain abandonne : les 3 IA jouent seules
  const t0 = Date.now();
  let lastTurn = 0, advanced = 0;
  while (Date.now() - t0 < 45000 && !(state && state.gameOver)) {
    await sleep(3000);
    if (state && state.turnNumber > lastTurn) { advanced++; lastTurn = state.turnNumber; }
  }
  console.log(JSON.stringify({ turnNumber: state && state.turnNumber, gameOver: state && state.gameOver, advanced, stderr: stderr.slice(0, 500) }));
  srv.kill();
  process.exit(stderr.trim() || advanced < 3 ? 1 : 0);
})();
