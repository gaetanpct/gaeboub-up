// ============================================================
// REACH UP — Rendu du plateau visuel
// Phase 4 : plateau, pions colorés (qui glissent d'une case à l'autre), dés animés
//
// Ce fichier ne connaît AUCUNE règle du jeu. Il sait seulement dessiner
// un plateau de 40 cases en carré (disposition classique façon Monopoly)
// et y déplacer des pions selon l'état reçu du serveur.
//
// Deux fonctions exposées (window.ReachUpBoardView) :
//   - initBoard(boardData)            : construit le plateau une seule fois
//   - updateBoard(state, myPlayerId)  : met à jour pions / dés / surbrillance
// ============================================================

(function () {
  const PLAYER_COLORS = ["#ff5c72", "#4fd1ff", "#ffd76a", "#8effc1"];

  const GROUP_COLORS = {
    marron: "#8d5b4c",
    cyan: "#6ec6d9",
    magenta: "#d96ec6",
    orange: "#e0973f",
    rouge: "#e05c5c",
    jaune: "#e0d35c",
    vert: "#6cd98f",
    bleu: "#5c8ee0",
  };

  // Décalages (en % de la largeur/hauteur du plateau) pour que jusqu'à
  // 4 pions sur la même case restent visibles au lieu de se superposer.
  const TOKEN_OFFSETS = [
    { dx: -1.8, dy: -1.8 },
    { dx: 1.8, dy: -1.8 },
    { dx: -1.8, dy: 1.8 },
    { dx: 1.8, dy: 1.8 },
  ];

  // Motifs des points de dé (grille 3x3, true = point visible)
  const DICE_PATTERNS = {
    1: [0, 0, 0, 0, 1, 0, 0, 0, 0],
    2: [1, 0, 0, 0, 0, 0, 0, 0, 1],
    3: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    4: [1, 0, 1, 0, 0, 0, 1, 0, 1],
    5: [1, 0, 1, 0, 1, 0, 1, 0, 1],
    6: [1, 0, 1, 1, 0, 1, 1, 0, 1],
  };

  // Convertit un index de case (0-39) en position {row, col} sur une
  // grille 11x11 (0-indexé). Case 0 (Départ) en bas à droite, puis le
  // plateau se lit dans le sens : bas → gauche → haut → droite → Départ.
  function tilePosition(index) {
    if (index === 0) return { row: 10, col: 10 };
    if (index <= 9) return { row: 10, col: 10 - index };
    if (index === 10) return { row: 10, col: 0 };
    if (index <= 19) return { row: 20 - index, col: 0 };
    if (index === 20) return { row: 0, col: 0 };
    if (index <= 29) return { row: 0, col: index - 20 };
    if (index === 30) return { row: 0, col: 10 };
    return { row: index - 30, col: 10 };
  }

  function tileCenterPercent(index) {
    const pos = tilePosition(index);
    return {
      xPct: ((pos.col + 0.5) / 11) * 100,
      yPct: ((pos.row + 0.5) / 11) * 100,
    };
  }

  function isCorner(index) {
    return index === 0 || index === 10 || index === 20 || index === 30;
  }

  function tileIcon(tile) {
    switch (tile.type) {
      case "go": return "🏁";
      case "jail": return "🚔";
      case "go-to-jail": return "🚨";
      case "vacation": return "🏖️";
      case "tax": return "💸";
      case "chance": return "❓";
      case "airport": return "✈️";
      case "utility": return tile.name.includes("Eau") ? "💧" : "⚡";
      default: return "";
    }
  }

  let boardEl = null;
  let tokensLayerEl = null;
  let tokenElements = {};
  let lastRenderedRollKey = null;

  function initBoard(boardData) {
    boardEl = document.getElementById("board-grid");
    if (!boardEl) return;

    boardEl.innerHTML = "";
    tokenElements = {};
    lastRenderedRollKey = null;

    boardData.forEach((tile, index) => {
      const pos = tilePosition(index);
      const el = document.createElement("div");
      el.className = "board-tile" + (isCorner(index) ? " board-tile--corner" : "");
      el.style.gridRow = pos.row + 1;
      el.style.gridColumn = pos.col + 1;
      el.dataset.tileIndex = index;

      if (tile.group && GROUP_COLORS[tile.group]) {
        el.style.setProperty("--group-color", GROUP_COLORS[tile.group]);
        el.classList.add("board-tile--property");
      }

      el.innerHTML = `
        <div class="board-tile__band"></div>
        <div class="board-tile__icon">${tileIcon(tile)}</div>
        <div class="board-tile__buildings" data-buildings-for="${index}"></div>
        <div class="board-tile__name">${tile.short}</div>
      `;
      boardEl.appendChild(el);
    });

    // Zone centrale : titre + dés + indicateur de tour
    const center = document.createElement("div");
    center.className = "board-center";
    center.style.gridRow = "2 / 11";
    center.style.gridColumn = "2 / 11";
    center.innerHTML = `
      <div class="board-center__title">Reach&nbsp;Up</div>
      <div id="dice-display" class="dice-row"></div>
      <div id="turn-indicator" class="turn-indicator"></div>
      <div id="pot-indicator" class="pot-indicator"></div>
    `;
    boardEl.appendChild(center);

    // Calque des pions : posé par-dessus tout le plateau, en superposition,
    // pour que chaque pion puisse glisser librement d'une case à l'autre
    // (une simple transition CSS sur left/top, sans dépendre de la grille).
    tokensLayerEl = document.createElement("div");
    tokensLayerEl.className = "tokens-layer";
    boardEl.appendChild(tokensLayerEl);
  }

  function renderDie(value) {
    const pattern = DICE_PATTERNS[value] || DICE_PATTERNS[1];
    const dots = pattern.map((visible) => `<span class="die-dot${visible ? " die-dot--on" : ""}"></span>`).join("");
    return `<div class="die">${dots}</div>`;
  }

  function updateBoard(state, myPlayerId) {
    if (!boardEl) initBoard(state.board);

    // 1. Surbrillance des propriétés possédées + maisons/hôtel/hypothèque
    state.board.forEach((tile, index) => {
      const el = boardEl.querySelector(`.board-tile[data-tile-index="${index}"]`);
      if (!el) return;
      if (tile.owner !== null && tile.owner !== undefined) {
        el.style.setProperty("--owner-color", PLAYER_COLORS[tile.owner % PLAYER_COLORS.length]);
        el.classList.add("board-tile--owned");
      } else {
        el.classList.remove("board-tile--owned");
      }

      const buildingsSlot = el.querySelector(`[data-buildings-for="${index}"]`);
      if (buildingsSlot) {
        if (tile.mortgaged) {
          buildingsSlot.innerHTML = "🔒";
        } else if (tile.houses === 5) {
          buildingsSlot.innerHTML = "🏨";
        } else if (tile.houses > 0) {
          buildingsSlot.innerHTML = "🏠".repeat(tile.houses);
        } else {
          buildingsSlot.innerHTML = "";
        }
      }
    });

    // 2. Pions : positions mises à jour en douceur (transition CSS)
    state.players.forEach((player) => {
      let token = tokenElements[player.id];

      if (player.bankrupt) {
        if (token) token.style.display = "none";
        return;
      }

      if (!token) {
        token = document.createElement("div");
        token.className = "token";
        token.style.background = PLAYER_COLORS[player.id % PLAYER_COLORS.length];
        token.textContent = player.name.charAt(0).toUpperCase();
        token.title = player.name;
        tokensLayerEl.appendChild(token);
        tokenElements[player.id] = token;
      }

      token.style.display = "";
      token.title = player.id === myPlayerId ? `${player.name} (toi)` : player.name;

      const center = tileCenterPercent(player.position);
      const offset = TOKEN_OFFSETS[player.id % TOKEN_OFFSETS.length];
      token.style.left = `calc(${center.xPct}% + ${offset.dx}%)`;
      token.style.top = `calc(${center.yPct}% + ${offset.dy}%)`;
    });

    // 3. Dés + indicateur de tour, au centre du plateau
    const diceDisplay = document.getElementById("dice-display");
    const turnIndicator = document.getElementById("turn-indicator");
    if (diceDisplay && turnIndicator) {
      if (state.lastRoll) {
        diceDisplay.innerHTML = renderDie(state.lastRoll.d1) + renderDie(state.lastRoll.d2);
        const rollKey = `${state.lastRoll.playerId}-${state.lastRoll.d1}-${state.lastRoll.d2}-${state.log.length}`;
        if (rollKey !== lastRenderedRollKey) {
          lastRenderedRollKey = rollKey;
          diceDisplay.classList.remove("dice-row--rolling");
          void diceDisplay.offsetWidth; // force le reflow pour rejouer l'animation
          diceDisplay.classList.add("dice-row--rolling");
        }
      } else {
        diceDisplay.innerHTML = "";
      }

      if (state.gameOver) {
        turnIndicator.textContent = `🏆 ${state.winner.name} a gagné !`;
      } else {
        const current = state.players[state.currentPlayerIndex];
        const isMe = current.id === myPlayerId;
        turnIndicator.textContent = isMe ? "À toi de jouer !" : `Tour de ${current.name}`;
      }

      const potIndicator = document.getElementById("pot-indicator");
      if (potIndicator) {
        const parts = [];
        if (state.vacationPot !== null && state.vacationPot !== undefined) {
          parts.push(`🏖️ Cagnotte : ${state.vacationPot}`);
        }
        if (state.turnLimit) {
          parts.push(`⏱️ Tour ${state.turnNumber}/${state.turnLimit}`);
        }
        potIndicator.textContent = parts.join("  •  ");
      }
    }
  }

  window.ReachUpBoardView = { initBoard, updateBoard, PLAYER_COLORS };
})();
