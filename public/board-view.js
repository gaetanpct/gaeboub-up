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
  const PLAYER_COLORS = ["#c0455c", "#4a83c4", "#3f9e6e", "#9c5cc7", "#d98c3f"];

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
  // 5 pions sur la même case restent visibles au lieu de se superposer.
  const TOKEN_OFFSETS = [
    { dx: -1.8, dy: -1.8 },
    { dx: 1.8, dy: -1.8 },
    { dx: -1.8, dy: 1.8 },
    { dx: 1.8, dy: 1.8 },
    { dx: 0, dy: 0 },
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

  // Les colonnes latérales (gauche/droite) sont plus larges que les
  // colonnes du milieu — c'est ce qui permet aux cases de ces côtés
  // d'afficher leur contenu horizontalement, sur une seule ligne bien
  // lisible, au lieu d'être coincées dans une case carrée trop étroite
  // (comme sur les plateaux façon richup.io).
  const SIDE_COLUMN_FR = 2;
  const MIDDLE_COLUMN_FR = 1;

  function colFr(col, gridSize) {
    return col === 0 || col === gridSize - 1 ? SIDE_COLUMN_FR : MIDDLE_COLUMN_FR;
  }

  function totalColFr(gridSize) {
    return SIDE_COLUMN_FR * 2 + (gridSize - 2) * MIDDLE_COLUMN_FR;
  }

  // Position/largeur en % d'une colonne, en tenant compte de la largeur
  // RÉELLE (variable) de chaque colonne — une simple division par
  // gridSize serait fausse dès que les colonnes ne sont plus uniformes.
  function colLeftPercent(col, gridSize) {
    let sum = 0;
    for (let i = 0; i < col; i++) sum += colFr(i, gridSize);
    return (sum / totalColFr(gridSize)) * 100;
  }

  function colWidthPercent(col, gridSize) {
    return (colFr(col, gridSize) / totalColFr(gridSize)) * 100;
  }

  // Chaîne CSS grid-template-columns avec colonnes latérales élargies.
  function gridColumnTemplate(gridSize) {
    const middleCount = gridSize - 2;
    return `${SIDE_COLUMN_FR}fr repeat(${middleCount}, ${MIDDLE_COLUMN_FR}fr) ${SIDE_COLUMN_FR}fr`;
  }

  // Ratio largeur/hauteur du plateau (légèrement plus large que haut, à
  // cause des colonnes latérales élargies) — utilisé pour que le calcul
  // de taille (resizeBoardToFit) fasse tenir un RECTANGLE, pas un carré.
  function boardAspectRatio(gridSize) {
    return totalColFr(gridSize) / gridSize;
  }

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
      xPct: colLeftPercent(pos.col, gridSize) + colWidthPercent(pos.col, gridSize) / 2,
      yPct: ((pos.row + 0.5) / gridSize) * 100,
    };
  }

  function isCorner(index, boardLength) {
    const last = boardLength / 4;
    return index === 0 || index === last || index === 2 * last || index === 3 * last;
  }

  // Sur quel bord du plateau se trouve cette case (pour savoir de quel
  // côté, vers le centre, pousser l'indicateur de maisons/hôtel) — null
  // pour un coin (pas de construction possible dessus).
  function edgeDirectionFor(index, boardLength) {
    if (isCorner(index, boardLength)) return null;
    const pos = tilePosition(index, boardLength);
    const gridSize = boardLength / 4 + 1;
    if (pos.row === 0) return "top";
    if (pos.row === gridSize - 1) return "bottom";
    if (pos.col === 0) return "left";
    if (pos.col === gridSize - 1) return "right";
    return null;
  }

  // Position (en %) de l'indicateur de construction d'une case : le
  // centre de la case, décalé vers l'intérieur du plateau (là où le
  // centre — dés, journal — se trouve), pour qu'il ne recouvre jamais le
  // nom de la propriété tout en restant bien à côté d'elle.
  const BUILDINGS_OFFSET_PCT = 6;
  function buildingsPositionPercent(index, boardLength) {
    const center = tileCenterPercent(index, boardLength);
    const dir = edgeDirectionFor(index, boardLength);
    switch (dir) {
      case "top":
        return { xPct: center.xPct, yPct: center.yPct + BUILDINGS_OFFSET_PCT };
      case "bottom":
        return { xPct: center.xPct, yPct: center.yPct - BUILDINGS_OFFSET_PCT };
      case "left":
        return { xPct: center.xPct + BUILDINGS_OFFSET_PCT, yPct: center.yPct };
      case "right":
        return { xPct: center.xPct - BUILDINGS_OFFSET_PCT, yPct: center.yPct };
      default:
        return center;
    }
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
    const gridSize = boardLength / 4 + 1;
    const corner = isCorner(index, boardLength);
    const isSideColumn = !corner && (pos.col === 0 || pos.col === gridSize - 1);

    // Sur quel bord du plateau se trouve cette case ? Ça déterminera de
    // quel côté (vers le centre du plateau) pousser l'indicateur de
    // maisons/hôtel, pour qu'il ne recouvre jamais le nom de la propriété.
    let edgeClass = "";
    if (!corner) {
      if (pos.row === 0) edgeClass = " board-tile--edge-top";
      else if (pos.row === gridSize - 1) edgeClass = " board-tile--edge-bottom";
      else if (pos.col === 0) edgeClass = " board-tile--edge-left";
      else if (pos.col === gridSize - 1) edgeClass = " board-tile--edge-right";
    }

    const el = document.createElement("div");
    el.className = "board-tile" + (corner ? " board-tile--corner" : "") + (isSideColumn ? " board-tile--side" : "") + edgeClass;
    el.style.gridRow = pos.row + 1;
    el.style.gridColumn = pos.col + 1;
    el.dataset.tileIndex = index;

    if (tile.group && GROUP_COLORS[tile.group]) {
      el.style.setProperty("--group-color", GROUP_COLORS[tile.group]);
      el.classList.add("board-tile--property");
    }

    // L'indicateur de maisons/hôtel est un élément à part, positionné en
    // dehors du carré de la case (vers l'intérieur du plateau) — comme sur
    // un vrai plateau physique, plutôt que d'encombrer le nom de la
    // propriété avec des icônes à l'intérieur.
    el.innerHTML = `
      <div class="board-tile__band"></div>
      <div class="board-tile__top-row">
        <span class="board-tile__icon">${tileIcon(tile)}</span>
      </div>
      <div class="board-tile__name">${tile.short}</div>
    `;
    return el;
  }

  let boardEl = null;
  let tokensLayerEl = null;
  let buildingsLayerEl = null;
  let buildingElements = {};
  let tokenElements = {};
  let lastRenderedRollKey = null;
  let lastRenderedJailEventKey = null;
  let onTileClickCallback = null;
  let currentAspectRatio = 1;

  function initBoard(boardData) {
    boardEl = document.getElementById("board-grid");
    if (!boardEl) return;

    const gridSize = boardData.length / 4 + 1;
    boardEl.style.gridTemplateColumns = gridColumnTemplate(gridSize);
    boardEl.style.gridTemplateRows = `repeat(${gridSize}, 1fr)`;
    currentAspectRatio = boardAspectRatio(gridSize);

    boardEl.innerHTML = "";
    tokenElements = {};
    buildingElements = {};
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
      <div class="board-center__tagline">The High Stakes Game</div>
      <div id="dice-display" class="dice-row"></div>
      <div id="turn-indicator" class="turn-indicator"></div>
      <div id="vacation-pot-badge" class="vacation-pot-badge" hidden></div>
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

    // Calque des indicateurs de construction (maisons/hôtel/hypothèque) :
    // un badge par case possédable, positionné EN DEHORS du carré de la
    // case, vers l'intérieur du plateau — comme sur un vrai plateau
    // physique — plutôt que d'encombrer le nom de la propriété avec des
    // icônes à l'intérieur (et pour ne pas être coupé par le
    // "overflow: hidden" de la case, nécessaire pour d'autres raisons).
    buildingsLayerEl = document.createElement("div");
    buildingsLayerEl.className = "buildings-layer";
    boardData.forEach((tile, index) => {
      if (!["property", "airport", "utility"].includes(tile.type)) return;
      const pos = buildingsPositionPercent(index, boardData.length);
      const badge = document.createElement("span");
      badge.className = "buildings-badge";
      badge.style.left = `${pos.xPct}%`;
      badge.style.top = `${pos.yPct}%`;
      badge.dataset.buildingsFor = index;
      buildingsLayerEl.appendChild(badge);
      buildingElements[index] = badge;
    });
    boardEl.appendChild(buildingsLayerEl);

    resizeBoardToFit();
    attachResizeListener();
  }

  // Calcule la taille exacte du plateau en mesurant l'espace RÉELLEMENT
  // disponible (largeur ET hauteur) autour de lui, plutôt que de deviner
  // via des unités de fenêtre (vh/vw) qui ignorent la barre du haut, la
  // sidebar, etc. C'est ce calcul qui garantit que le plateau tient
  // toujours entièrement à l'écran, sans jamais dépasser en haut ou sur
  // les côtés.
  function resizeBoardToFit() {
    if (!boardEl) return;
    const container = boardEl.parentElement; // .board-container
    if (!container) return;

    // En layout mobile (colonne), le CSS gère déjà la taille via
    // largeur/hauteur de fenêtre — on ne touche à rien pour ne pas entrer
    // en conflit, la page peut de toute façon défiler sur mobile.
    const layout = container.parentElement; // .game-layout
    if (layout && window.getComputedStyle(layout).flexDirection === "column") {
      boardEl.style.width = "";
      boardEl.style.height = "";
      return;
    }

    const availableWidth = container.clientWidth;
    const availableHeight = container.clientHeight;
    if (availableWidth <= 0 || availableHeight <= 0) return;

    // Fait tenir un RECTANGLE (colonnes latérales élargies = plateau
    // légèrement plus large que haut) dans l'espace disponible, en
    // respectant toujours width/height = currentAspectRatio.
    let width = availableWidth;
    let height = width / currentAspectRatio;
    if (height > availableHeight) {
      height = availableHeight;
      width = height * currentAspectRatio;
    }
    width = Math.max(200, Math.floor(width));
    height = Math.max(Math.floor(200 / currentAspectRatio), Math.floor(height));
    boardEl.style.width = `${width}px`;
    boardEl.style.height = `${height}px`;
  }

  let resizeListenerAttached = false;
  function attachResizeListener() {
    if (resizeListenerAttached) return;
    resizeListenerAttached = true;
    const raf = window.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
    const caf = window.cancelAnimationFrame || ((id) => clearTimeout(id));
    let pendingFrame = null;
    window.addEventListener("resize", () => {
      if (pendingFrame) caf(pendingFrame);
      pendingFrame = raf(resizeBoardToFit);
    });
  }

  // Aperçu statique du plateau (salon d'attente) : juste les cases et
  // leurs couleurs, aucun pion ni dé — sert uniquement à visualiser un
  // plateau généré avant de lancer la partie (Phase 8b).
  function renderPreview(containerEl, boardData) {
    if (!containerEl) return;
    const gridSize = boardData.length / 4 + 1;
    containerEl.style.gridTemplateColumns = gridColumnTemplate(gridSize);
    containerEl.style.gridTemplateRows = `repeat(${gridSize}, 1fr)`;
    containerEl.style.aspectRatio = `${boardAspectRatio(gridSize)} / 1`;
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

      const buildingsSlot = buildingElements[index];
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
    //
    // Cas particulier : un joueur qui vient d'être envoyé en prison (case
    // "Aller en prison", carte Destin...) ne doit pas y apparaître d'un
    // coup — le pion doit d'abord transiter par la case qui l'a envoyé là,
    // pour qu'on comprenne immédiatement pourquoi, exactement comme s'il y
    // était vraiment arrivé en jouant.
    const jailEvent = state.lastJailEvent;
    const jailEventKey = jailEvent ? `${jailEvent.playerId}-${jailEvent.seq}` : null;
    const isNewJailEvent = !!jailEventKey && jailEventKey !== lastRenderedJailEventKey;
    if (jailEventKey) lastRenderedJailEventKey = jailEventKey;

    state.players.forEach((player) => {
      let token = tokenElements[player.id];

      if (player.bankrupt) {
        if (token) token.style.display = "none";
        return;
      }

      if (!token) {
        token = document.createElement("div");
        token.className = "token";
        token.style.setProperty("--token-color", PLAYER_COLORS[player.id % PLAYER_COLORS.length]);
        token.textContent = player.name.charAt(0).toUpperCase();
        token.title = player.name;
        tokensLayerEl.appendChild(token);
        tokenElements[player.id] = token;
      }

      token.style.display = "";
      token.title = player.id === myPlayerId ? `${player.name} (toi)` : player.name;

      const center = tileCenterPercent(player.position, state.board.length);
      const offset = TOKEN_OFFSETS[player.id % TOKEN_OFFSETS.length];

      if (isNewJailEvent && jailEvent.playerId === player.id) {
        const fromCenter = tileCenterPercent(jailEvent.fromIndex, state.board.length);
        token.style.left = `calc(${fromCenter.xPct}% + ${offset.dx}%)`;
        token.style.top = `calc(${fromCenter.yPct}% + ${offset.dy}%)`;
        setTimeout(() => {
          token.style.left = `calc(${center.xPct}% + ${offset.dx}%)`;
          token.style.top = `calc(${center.yPct}% + ${offset.dy}%)`;
        }, 550);
      } else {
        token.style.left = `calc(${center.xPct}% + ${offset.dx}%)`;
        token.style.top = `calc(${center.yPct}% + ${offset.dy}%)`;
      }
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

      const vacationBadge = document.getElementById("vacation-pot-badge");
      if (vacationBadge) {
        if (state.vacationPot !== null && state.vacationPot !== undefined) {
          vacationBadge.hidden = false;
          vacationBadge.textContent = `🏖️ Cagnotte de Vacances : ${state.vacationPot}`;
        } else {
          vacationBadge.hidden = true;
        }
      }

      const potIndicator = document.getElementById("pot-indicator");
      if (potIndicator) {
        potIndicator.textContent = state.turnLimit ? `⏱️ Tour ${state.turnNumber}/${state.turnLimit}` : "";
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

  window.ReachUpBoardView = { initBoard, updateBoard, renderPreview, onTileClick, tileSwatch, resizeBoardToFit, GROUP_COLORS, PLAYER_COLORS };
})();
