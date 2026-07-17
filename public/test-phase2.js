// ============================================================
// REACH UP — Page de test du moteur (Phase 2)
// Pilote un GameEngine en local, sans réseau, pour vérifier
// visuellement que les règles se comportent correctement.
// ============================================================

let engine = createNewGame();

const playersPanel = document.getElementById("players-panel");
const logPanel = document.getElementById("log-panel");

document.getElementById("btn-turn").addEventListener("click", () => {
  playTurns(1);
});
document.getElementById("btn-turn-10").addEventListener("click", () => {
  playTurns(10);
});
document.getElementById("btn-turn-end").addEventListener("click", () => {
  // Garde-fou : on ne joue jamais plus de 1000 tours, au cas où
  // une partie théoriquement infinie se produirait.
  playTurns(1000, true);
});
document.getElementById("btn-reset").addEventListener("click", () => {
  engine = createNewGame();
  render();
});

function createNewGame() {
  return new ReachUpEngine.GameEngine(["Toi", "Ami", "Bot de test"]);
}

function playTurns(count, stopOnGameOver = false) {
  for (let i = 0; i < count; i++) {
    if (engine.gameOver) break;
    engine.playTurn();
    if (stopOnGameOver && engine.gameOver) break;
  }
  render();
}

function render() {
  renderPlayers();
  renderLog();
}

function renderPlayers() {
  playersPanel.innerHTML = "";
  engine.players.forEach((player) => {
    const tile = engine.board[player.position];
    const propertiesCount = engine.board.filter(
      (t) => t.owner === player.id
    ).length;

    let statusLabel = "Actif";
    if (player.bankrupt) statusLabel = "En faillite";
    else if (player.inJail) statusLabel = "En prison";

    const card = document.createElement("div");
    card.className = "player-card";
    if (player.bankrupt) card.classList.add("player-card--bankrupt");

    card.innerHTML = `
      <h3>${player.name}</h3>
      <p>💰 ${player.money}</p>
      <p>📍 ${tile.name}</p>
      <p>🏷️ ${propertiesCount} propriété(s)</p>
      <p class="player-status">${statusLabel}</p>
    `;
    playersPanel.appendChild(card);
  });

  if (engine.gameOver) {
    const banner = document.createElement("div");
    banner.className = "winner-banner";
    banner.textContent = `🏆 ${engine.winner.name} remporte la partie en ${engine.turnNumber} tours !`;
    playersPanel.appendChild(banner);
  }
}

function renderLog() {
  // On affiche les 60 dernières lignes pour rester lisible sur les longues parties
  const recent = engine.log.slice(-60);
  logPanel.innerHTML = recent.map((line) => `<div>${line}</div>`).join("");
  logPanel.scrollTop = logPanel.scrollHeight;
}

render();
