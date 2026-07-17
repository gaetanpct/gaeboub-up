// ============================================================
// REACH UP — Code côté navigateur
// Phase 1 : on vérifie juste que la connexion temps réel marche.
// La logique du jeu (plateau, dés...) arrivera en Phase 2.
// ============================================================

const socket = io(); // se connecte automatiquement au serveur qui a servi cette page

const statusBox = document.getElementById("status-box");
const playersCountEl = document.getElementById("players-count");

// Le serveur envoie cet événement dès que la connexion est établie
socket.on("server:welcome", (data) => {
  statusBox.textContent = data.message;
  statusBox.classList.remove("status-disconnected");
  statusBox.classList.add("status-connected");
});

// Le serveur envoie cet événement à chaque fois qu'un joueur se connecte/déconnecte
socket.on("server:players-count", (data) => {
  playersCountEl.textContent = data.count;
});

// Si la connexion tombe (ex: coupure réseau), on prévient l'utilisateur
socket.on("disconnect", () => {
  statusBox.textContent = "Connexion perdue. Tentative de reconnexion...";
  statusBox.classList.remove("status-connected");
  statusBox.classList.add("status-disconnected");
});
