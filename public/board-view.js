// ============================================================
// REACH UP — Rendu du plateau visuel
// Phase 4 : plateau, pions colorés (qui glissent d'une case à l'autre), dés animés
// Phase 8b : généralisé pour supporter des plateaux de taille variable
//            (générés procéduralement), + un rendu de prévisualisation
//            statique pour le salon d'attente.
//
// Ce fichier ne connaît AUCUNE règle du jeu. Il sait seulement dessiner
// un plateau carré (disposition classique façon Monopoly, coins compris)
// et y déplacer des pions selon l'état reçu du serveur.
//
// Fonctions exposées (window.ReachUpBoardView) :
//   - initBoard(boardData)             : construit le plateau de jeu (une fois)
//   - updateBoard(state, myPlayerId)   : met à jour pions / dés / surbrillance
//   - renderPreview(containerEl, board): aperçu statique (salon d'attente)
// ============================================================

(function () {
  // Tons "pierres précieuses", identiques aux tokens --player-1..4 du CSS.
  const PLAYER_COLORS = ["#c0455c", "#4a83c4", "#3f9e6e", "#9c5cc7"];

  const GROUP_COLORS = {
    marron: "#8d5b4c",
    cyan: "#6ec6d9",
    magenta: "#d96ec6",
    orange: "#e0973f",
    rouge: "#e05c5c",
    jaune: "#e0d35c",
    vert: "#6cd98f",
    bleu: "#5c8ee0",
    violet: "#a05ce0",
    rose: "#e05c9d",
    gris: "#9aa0ab",
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

  // Convertit un index de case en position {row, col} sur une grille
  // carrée (0-indexée) dont la taille dépend du nombre TOTAL de cases du
  // plateau (40 par défaut, mais peut varier avec un plateau généré).
  // Case 0 (Départ) en bas à droite, puis le plateau se lit dans le sens :
  // bas → gauche → haut → droite → Départ. "last" = index de chaque coin
  // suivant (= taille du plateau / 4).
  function tilePosition(index, boardLength) {
    const last = boardLength / 4;
    if (index === 0) return { row: last, col: last };
    if (index <= last - 1) return { row: last, col: last - index };
    if (index === last) return { row: last, col: 0 };
    if (index <= 2 * last - 1) return { row: 2 * last - index, col: 0 };
    if (index === 2 * last) return { row: 0, col: 0 };
    if (index <= 3 * last - 1) return { row: 0, col: index - 2 * last };
    if (index === 3 * last) return { row: 0, col: last };
    return { row: index - 3 * last, col: last };
  }

  function tileCenterPercent(index, boardLength) {
    const pos = tilePosition(index, boardLength);
    const gridSize = boardLength / 4 + 1;
    return {
      xPct: ((pos.col + 0.5) / gridSize) * 100,
      yPct: ((pos.row + 0.5) / gridSize) * 100,
    };
  }

  function isCorner(index, boardLength) {
    const last = boardLength / 4;
    return index === 0 || index === last || index === 2 * last || index === 3 * last;
  }

  function tileIcon(tile) {
    switch (tile.type) {
      case "go": return "🏁";
      case "jail": return "🚔";
      case "go-to-jail": return "🚨";
      case "vacation": return "🏖️";
      case "tax": return "💸";
      case "chance": return "❓";
      case "special": return "✨";
      case "airport": return "✈️";
      case "utility": return tile.name.includes("Eau") ? "💧" : "⚡";
      default: return "";
    }
  }

  function buildTileElement(tile, index, boardLength) {
    const pos = tilePosition(index, boardLength);
    const el = document.createElement("div");
    el.className = "board-tile" + (isCorner(index, boardLength) ? " board-tile--corner" : "");
    el.style.gridRow = pos.row + 1;
    el.style.gridColumn = pos.col + 1;
    el.dataset.tileIndex = index;

    if (tile.group && GROUP_COLORS[tile.group]) {
      el.style.setProperty("--group-color", GROUP_COLORS[tile.group]);
      el.classList.add("board-tile--property");
    }

    el.innerHTML = `
      <div class="board-tile__band"></div>
      <div class="board-tile__top-row">
        <span class="board-tile__icon">${tileIcon(tile)}</span>
        <span class="board-tile__buildings" data-buildings-for="${index}"></span>
      </div>
      <div class="board-tile__name">${tile.short}</div>
    `;
    return el;
  }

  let boardEl = null;
  let tokensLayerEl = null;
  let tokenElements = {};
  let lastRenderedRollKey = null;
  let onTileClickCallback = null;

  function initBoard(boardData) {
    boardEl = document.getElementById("board-grid");
    if (!boardEl) return;

    const gridSize = boardData.length / 4 + 1;
    boardEl.style.gridTemplateColumns = `repeat(${gridSize}, 1fr)`;
    boardEl.style.gridTemplateRows = `repeat(${gridSize}, 1fr)`;

    boardEl.innerHTML = "";
    tokenElements = {};
    lastRenderedRollKey = null;

    boardData.forEach((tile, index) => {
      const el = buildTileElement(tile, index, boardData.length);
      el.classList.add("board-tile--clickable");
      boardEl.appendChild(el);
    });

    // Une seule écoute de clic (délégation) sur tout le plateau, plutôt
    // qu'une par case : plus léger, et fonctionne même si les cases sont
    // reconstruites plus tard.
    boardEl.addEventListener("click", (event) => {
      const tileEl = event.target.closest(".board-tile");
      if (!tileEl || !onTileClickCallback) return;
      onTileClickCallback(Number(tileEl.dataset.tileIndex));
    });

    // Zone centrale : titre + dés + indicateur de tour + journal compact.
    // Volontairement sobre (pas de ville en 3D ni d'éléments décoratifs
    // en trop) — juste l'essentiel, dans l'esprit d'une table de jeu.
    const center = document.createElement("div");
    center.className = "board-center";
    center.style.gridRow = `2 / ${gridSize}`;
    center.style.gridColumn = `2 / ${gridSize}`;
    center.innerHTML = `
      <div class="board-center__title">Gaeboub&#8209;up</div>
      <div id="dice-display" class="dice-row"></div>
      <div id="turn-indicator" class="turn-indicator"></div>
      <div id="pot-indicator" class="pot-indicator"></div>
      <div class="board-center__log-wrap">
        <div id="board-log-panel" class="board-log-panel"></div>
        <button id="btn-open-full-log" class="btn-text-link" type="button">Tout voir</button>
      </div>
    `;
    boardEl.appendChild(center);

    // Calque des pions : posé par-dessus tout le plateau, en superposition,
    // pour que chaque pion puisse glisser librement d'une case à l'autre
    // (une simple transition CSS sur left/top, sans dépendre de la grille).
    tokensLayerEl = document.createElement("div");
    tokensLayerEl.className = "tokens-layer";
    boardEl.appendChild(tokensLayerEl);
  }

  // Aperçu statique du plateau (salon d'attente) : juste les cases et
  // leurs couleurs, aucun pion ni dé — sert uniquement à visualiser un
  // plateau généré avant de lancer la partie (Phase 8b).
  function renderPreview(containerEl, boardData) {
    if (!containerEl) return;
    const gridSize = boardData.length / 4 + 1;
    containerEl.style.gridTemplateColumns = `repeat(${gridSize}, 1fr)`;
    containerEl.style.gridTemplateRows = `repeat(${gridSize}, 1fr)`;
    containerEl.innerHTML = "";
    boardData.forEach((tile, index) => {
      containerEl.appendChild(buildTileElement(tile, index, boardData.length));
    });
  }

  function renderDie(value) {
    // Au-delà de 6 (dé à 8 faces), pas de motif de points classique :
    // on affiche directement le chiffre pour rester lisible.
    if (value > 6) {
      return `<div class="die die--number">${value}</div>`;
    }
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

      const center = tileCenterPercent(player.position, state.board.length);
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

  function onTileClick(callback) {
    onTileClickCallback = callback;
  }

  // Petit HTML réutilisable pour situer une propriété par sa couleur (ou
  // son icône si ce n'est pas un groupe coloré) n'importe où dans
  // l'interface (échanges, enchères, listes...) — Phase 10.
  function tileSwatch(tile) {
    if (tile.group && GROUP_COLORS[tile.group]) {
      return `<span class="tile-swatch" style="background:${GROUP_COLORS[tile.group]}"></span>`;
    }
    return `<span class="tile-swatch tile-swatch--icon">${tileIcon(tile)}</span>`;
  }

  window.ReachUpBoardView = { initBoard, updateBoard, renderPreview, onTileClick, tileSwatch, GROUP_COLORS, PLAYER_COLORS };
})();
