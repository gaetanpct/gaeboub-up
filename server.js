// ============================================================
// REACH UP — Serveur principal
// Phase 1 : fondation du projet
//
// Ce fichier ne contient PAS encore les règles du jeu.
// Son seul objectif ici est de prouver que toute la chaîne
// technique fonctionne de bout en bout :
//   navigateur  <—— temps réel (Socket.io) ——>  serveur (Node/Express)
//
// Les règles du jeu (plateau, dés, achats...) arriveront en Phase 2.
// ============================================================

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Sert tous les fichiers du dossier "public" (HTML, CSS, JS du navigateur)
// Exemple : public/index.html devient accessible à l'adresse "/"
app.use(express.static(path.join(__dirname, "public")));

// Compteur très simple du nombre de joueurs connectés en ce moment.
// (Purement pour vérifier que la synchronisation temps réel fonctionne.)
let connectedPlayers = 0;

io.on("connection", (socket) => {
  connectedPlayers++;
  console.log(`Un joueur s'est connecté (socket ${socket.id}). Total : ${connectedPlayers}`);

  // Message de bienvenue envoyé uniquement à ce joueur
  socket.emit("server:welcome", {
    message: "Connecté au serveur Reach Up !",
  });

  // On informe TOUS les joueurs connectés du nouveau total
  io.emit("server:players-count", { count: connectedPlayers });

  socket.on("disconnect", () => {
    connectedPlayers--;
    console.log(`Un joueur s'est déconnecté (socket ${socket.id}). Total : ${connectedPlayers}`);
    io.emit("server:players-count", { count: connectedPlayers });
  });
});

// Render (et la plupart des hébergeurs) imposent leur propre port via
// la variable d'environnement PORT. En local, on utilise 3000 par défaut.
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur Reach Up démarré sur le port ${PORT}`);
});
