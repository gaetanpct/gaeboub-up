// ============================================================
// REACH UP — Intelligence artificielle stratégique
//
// PRINCIPE FONDAMENTAL : cette IA n'a JAMAIS accès aux données privées
// (les mises scellées des autres, par exemple) et n'agit QUE via les
// mêmes méthodes publiques du moteur qu'un vrai joueur humain utilise
// via les sockets (roll, decide, mortgage, proposeTrade, useXPower...).
// Elle "voit" la partie exactement comme getPublicState() la donne à un
// client — jamais les champs internes bruts du moteur — sauf pour
// quelques méthodes de LECTURE SEULE (canBuildHouse, ownsFullSet...) qui
// ne font qu'exposer une information qu'un joueur humain pourrait de
// toute façon déduire lui-même de l'état public (l'interface le fait
// déjà pour lui, en grisant les boutons impossibles).
//
// ARCHITECTURE : un seul moteur de décision, piloté par un "profil de
// difficulté" (des paramètres numériques). Ajouter un niveau de
// difficulté = ajouter une entrée dans DIFFICULTY_PROFILES, rien de plus
// à dupliquer ailleurs.
// ============================================================

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.ReachUpAI = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {

  // ---------------------------------------------------------------------
  // Profils de difficulté
  // ---------------------------------------------------------------------
  const DIFFICULTY_PROFILES = {
    facile: {
      label: "Facile",
      mistakeChance: 0.30,        // probabilité de prendre un choix sous-optimal exprès
      cashSafetyMargin: 100,      // réserve de cash qu'elle cherche à garder
      monopolyWeight: 1.0,        // importance donnée à compléter un groupe
      auctionAggressiveness: 0.75, // fraction du prix normal qu'elle est prête à payer max
      buildThreshold: 260,        // cash minimal restant après construction pour construire
      tradeFairnessTolerance: 0.45, // écart de valeur toléré pour accepter un échange
      proactiveTradeChance: 0.15, // probabilité de tenter de proposer un échange par tour
      usePowersProactively: 0.4,  // probabilité d'utiliser un pouvoir instantané dès qu'il a de la valeur
      thinkTimeSimpleMs: [350, 600],
      thinkTimeComplexMs: [500, 900],
    },
    intermediaire: {
      label: "Intermédiaire",
      mistakeChance: 0.12,
      cashSafetyMargin: 160,
      monopolyWeight: 1.25,
      auctionAggressiveness: 0.9,
      buildThreshold: 220,
      tradeFairnessTolerance: 0.25,
      proactiveTradeChance: 0.3,
      usePowersProactively: 0.65,
      thinkTimeSimpleMs: [300, 550],
      thinkTimeComplexMs: [600, 1100],
    },
    difficile: {
      label: "Difficile",
      mistakeChance: 0.04,
      cashSafetyMargin: 200,
      monopolyWeight: 1.45,
      auctionAggressiveness: 1.0,
      buildThreshold: 180,
      tradeFairnessTolerance: 0.14,
      proactiveTradeChance: 0.45,
      usePowersProactively: 0.85,
      thinkTimeSimpleMs: [250, 450],
      thinkTimeComplexMs: [650, 1300],
    },
    expert: {
      label: "Expert",
      mistakeChance: 0,
      cashSafetyMargin: 220,
      monopolyWeight: 1.7,
      auctionAggressiveness: 1.08,
      buildThreshold: 150,
      tradeFairnessTolerance: 0.06,
      proactiveTradeChance: 0.6,
      usePowersProactively: 1.0,
      thinkTimeSimpleMs: [200, 380],
      thinkTimeComplexMs: [700, 1500],
    },
  };

  function getProfile(difficulty) {
    return DIFFICULTY_PROFILES[difficulty] || DIFFICULTY_PROFILES.difficile;
  }

  function chance(p) {
    return Math.random() < p;
  }

  function randRange([min, max]) {
    return Math.floor(min + Math.random() * (max - min));
  }

  // ---------------------------------------------------------------------
  // Évaluation de la position (lecture seule, sur l'état PUBLIC)
  // ---------------------------------------------------------------------

  const OWNABLE_TYPES = ["property", "airport", "utility"];

  function netWorthOf(state, playerId) {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return 0;
    const propsValue = state.board
      .filter((t) => t.owner === playerId)
      .reduce((sum, t) => {
        const base = t.mortgaged ? Math.floor((t.price || 0) / 2) : t.price || 0;
        const houseValue = t.type === "property" && t.houses ? t.houses * Math.floor((t.price || 0) * 0.4) : 0;
        return sum + base + houseValue;
      }, 0);
    return player.money + propsValue;
  }

  function tilesOfGroup(state, group) {
    return state.board.filter((t) => t.type === "property" && t.group === group);
  }

  function ownsFullGroupPublic(state, playerId, group) {
    const tiles = tilesOfGroup(state, group);
    return tiles.length > 0 && tiles.every((t) => t.owner === playerId);
  }

  // Combien de cases d'un groupe ce joueur possède déjà (pour mesurer à
  // quel point une case donnée le rapprocherait d'un monopole).
  function groupOwnershipCount(state, playerId, group) {
    return tilesOfGroup(state, group).filter((t) => t.owner === playerId).length;
  }

  function richestPlayer(state) {
    const active = state.players.filter((p) => !p.bankrupt);
    if (active.length === 0) return null;
    return active.reduce((best, p) => (netWorthOf(state, p.id) > netWorthOf(state, best.id) ? p : best), active[0]);
  }

  function myRank(state, playerId) {
    const active = state.players.filter((p) => !p.bankrupt);
    const sorted = [...active].sort((a, b) => netWorthOf(state, b.id) - netWorthOf(state, a.id));
    return sorted.findIndex((p) => p.id === playerId) + 1; // 1 = premier
  }

  // Valeur stratégique d'une case possédable pour CE joueur : au-delà du
  // simple prix, prend en compte le rendement locatif et le fait qu'elle
  // rapproche (ou complète) un groupe de couleur.
  function strategicValue(state, playerId, tileIndex, profile) {
    const tile = state.board[tileIndex];
    if (!tile || !OWNABLE_TYPES.includes(tile.type)) return 0;
    const price = tile.price || 1;
    let value = price;

    if (tile.type === "property") {
      const owned = groupOwnershipCount(state, playerId, tile.group);
      const groupSize = tilesOfGroup(state, tile.group).length;
      const unownedOrMineInGroup = tilesOfGroup(state, tile.group).every((t) => t.owner === null || t.owner === playerId);
      if (owned === groupSize - 1 && unownedOrMineInGroup) {
        // Cette case COMPLÈTE un groupe : très précieuse.
        value *= 2.2 * profile.monopolyWeight;
      } else if (owned > 0) {
        value *= 1 + 0.5 * profile.monopolyWeight * (owned / groupSize);
      }
      // Rendement locatif de base (loyer / prix) : une case qui rapporte
      // beaucoup relativement à son prix vaut plus qu'une case chère mais
      // peu rentable.
      const yieldRatio = (tile.rent || 0) / price;
      value *= 1 + Math.min(yieldRatio * 4, 0.6);
    } else if (tile.type === "airport") {
      const ownedAirports = state.board.filter((t) => t.type === "airport" && t.owner === playerId).length;
      value *= 1 + 0.35 * ownedAirports;
    } else if (tile.type === "utility") {
      const ownedUtilities = state.board.filter((t) => t.type === "utility" && t.owner === playerId).length;
      value *= 1 + 0.25 * ownedUtilities;
    }

    return value;
  }

  // Réserve de cash "de sécurité" que l'IA cherche à garder disponible
  // avant de dépenser (achat, construction, enchère...) — s'ajuste très
  // légèrement à l'avancement de la partie (plus tolérant en tout début).
  function safeReserve(state, profile) {
    const earlyGame = state.turnNumber < 8;
    return earlyGame ? Math.floor(profile.cashSafetyMargin * 0.7) : profile.cashSafetyMargin;
  }

  // ---------------------------------------------------------------------
  // Pouvoirs : trouve et utilise le meilleur pouvoir disponible pour la
  // situation actuelle, ou l'arme s'il n'a pas encore d'effet immédiat.
  // ---------------------------------------------------------------------
  function handlePowerBeforeRoll(engine, state, me, profile) {
    if (!me.power || me.power.used) return false;

    // Types "arm" : gratuits à activer, toujours utile de les avoir prêts
    // (sauf le Négociateur, qui se gâche si on décline le prochain achat —
    // risque accepté ici, un vrai joueur ferait probablement pareil).
    if (!me.power.armed) {
      const armTypes = ["double_rent", "tax_immunity", "discount_purchase", "auction_spy", "free_landing"];
      if (armTypes.includes(me.power.id)) {
        engine.armPower(me.id);
        return true;
      }
    }

    // Types "instant" utilisables avant de lancer les dés.
    if (me.power.id === "bank_loan" && me.money < safeReserve(state, profile) * 1.5) {
      engine.useBankLoanPower(me.id);
      return true;
    }
    if (me.power.id === "vacation_claim" && (state.vacationPot || 0) > 100) {
      engine.useVacationClaimPower(me.id);
      return true;
    }
    if (me.power.id === "rent_collector" && chance(profile.usePowersProactively)) {
      // Utile surtout s'il reste des adversaires solvables autour.
      const solventOpponents = state.players.filter((p) => p.id !== me.id && !p.bankrupt && p.money > 200);
      if (solventOpponents.length >= Math.max(1, state.players.length - 2)) {
        engine.useRentCollectorPower(me.id);
        return true;
      }
    }
    if (me.power.id === "teleport") {
      const best = bestUnownedTileForTeleport(state, me, profile);
      if (best !== null) {
        engine.useTeleportPower(me.id, best);
        return true;
      }
    }
    if (me.power.id === "theft") {
      const target = bestTheftTarget(state, me);
      if (target !== null) {
        engine.useStealPower(me.id, target);
        return true;
      }
    }
    if (me.power.id === "house_wrecker" && chance(profile.usePowersProactively)) {
      const target = bestHouseWreckerTarget(state, me);
      if (target !== null) {
        engine.useHouseWreckerPower(me.id, target);
        return true;
      }
    }
    if (me.power.id === "forced_swap") {
      const swap = bestForcedSwap(state, me, profile);
      if (swap) {
        engine.useForcedSwapPower(me.id, swap.a, swap.b);
        return true;
      }
    }
    return false;
  }

  function bestUnownedTileForTeleport(state, me, profile) {
    let bestIndex = null;
    let bestValue = 0;
    state.board.forEach((tile, index) => {
      if (!OWNABLE_TYPES.includes(tile.type) || tile.owner !== null) return;
      const price = tile.price || 0;
      if (price > me.money - safeReserve(state, profile)) return;
      const value = strategicValue(state, me.id, index, profile);
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    });
    // Seulement si ça complète (ou rapproche fort d'un) un groupe — sinon
    // le pouvoir vaut mieux gardé pour une meilleure occasion.
    return bestValue > (state.board[bestIndex]?.price || Infinity) * 1.4 ? bestIndex : null;
  }

  function bestTheftTarget(state, me) {
    const candidates = state.players.filter((p) => p.id !== me.id && !p.bankrupt && p.money > 400);
    if (candidates.length === 0) return null;
    // Vise en priorité le leader (le rapprocher de moi), sinon le plus riche des cibles valides.
    const richest = candidates.reduce((a, b) => (b.money > a.money ? b : a), candidates[0]);
    return richest.id;
  }

  function bestHouseWreckerTarget(state, me) {
    const candidates = state.players.filter((p) => p.id !== me.id && !p.bankrupt);
    const withHouses = candidates
      .map((p) => ({ p, houses: state.board.filter((t) => t.owner === p.id && t.houses > 0).length }))
      .filter((x) => x.houses > 0)
      .sort((a, b) => netWorthOf(state, b.p.id) - netWorthOf(state, a.p.id));
    return withHouses.length > 0 ? withHouses[0].p.id : null;
  }

  // Le pouvoir force un échange entre DEUX AUTRES joueurs (jamais moi).
  // Utilisation défensive : repère l'adversaire le plus menaçant qui a un
  // groupe presque complet (il ne lui manque qu'une case), et lui retire
  // une des pièces qu'il possède déjà dans ce groupe — cassant son
  // monopole en formation — en échange d'une propriété quelconque, sans
  // rapport, appartenant à un troisième joueur.
  function bestForcedSwap(state, me, profile) {
    const others = state.players.filter((p) => p.id !== me.id && !p.bankrupt);
    if (others.length < 2) return null; // il faut deux AUTRES joueurs distincts

    let bestSwap = null;
    let bestThreatScore = -Infinity;

    others.forEach((threat) => {
      const groups = [...new Set(state.board.filter((t) => t.type === "property" && t.owner === threat.id).map((t) => t.group))];
      groups.forEach((group) => {
        const tiles = tilesOfGroup(state, group);
        const ownedByThreat = tiles.filter((t) => t.owner === threat.id);
        const stillMissing = tiles.filter((t) => t.owner !== threat.id);
        // Ne cible que les groupes presque complets (une seule case manquante) — le cas le plus urgent à désamorcer.
        if (ownedByThreat.length !== tiles.length - 1 || stillMissing.length !== 1) return;
        const tileToTakeAway = ownedByThreat.find((t) => (t.houses || 0) === 0);
        if (!tileToTakeAway) return; // tout est bâti, aucun échange possible sur ce groupe

        const missingTile = stillMissing[0];
        const thirdPartyTiles = state.board
          .map((t, i) => ({ t, i }))
          .filter(
            ({ t }) =>
              OWNABLE_TYPES.includes(t.type) &&
              t.owner !== null &&
              t.owner !== threat.id &&
              t.owner !== me.id &&
              t !== missingTile && // ne surtout pas redonner accidentellement la pièce manquante elle-même
              (t.houses || 0) === 0
          );
        if (thirdPartyTiles.length === 0) return;
        // Donne en échange la propriété la moins précieuse possible, pour minimiser ce que l'adversaire visé y gagne.
        const cheapest = thirdPartyTiles.reduce((a, b) => ((b.t.price || 0) < (a.t.price || 0) ? b : a), thirdPartyTiles[0]);

        const threatScore = netWorthOf(state, threat.id);
        if (threatScore > bestThreatScore) {
          bestThreatScore = threatScore;
          bestSwap = { a: state.board.indexOf(tileToTakeAway), b: cheapest.i };
        }
      });
    });

    // N'agit que si la cible représente une vraie menace (comparable ou supérieure à moi).
    if (bestSwap && bestThreatScore >= netWorthOf(state, me.id) * 0.75) {
      return bestSwap;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Décision d'achat
  // ---------------------------------------------------------------------
  function decideBuy(engine, state, me, profile) {
    const tileIndex = state.pendingDecision.tileIndex;
    const price = state.pendingDecision.price;
    const value = strategicValue(state, me.id, tileIndex, profile);
    const reserve = safeReserve(state, profile);
    const canAfford = me.money - price >= reserve;

    let wantsToBuy = canAfford && value >= price * 0.85;
    if (chance(profile.mistakeChance)) wantsToBuy = !wantsToBuy;

    engine.decide(me.id, wantsToBuy);
    return { kind: "buy", complex: false };
  }

  // ---------------------------------------------------------------------
  // Enchères
  // ---------------------------------------------------------------------
  function decideAuctionBid(engine, state, me, profile) {
    const auction = state.pendingAuction;
    const tile = state.board[auction.tileIndex];
    const value = strategicValue(state, me.id, auction.tileIndex, profile);
    const reserve = safeReserve(state, profile);
    const maxWillingToPay = Math.min(
      me.money - reserve,
      Math.floor(value * profile.auctionAggressiveness)
    );

    if (auction.mode === "secret") {
      const bid = Math.max(0, maxWillingToPay);
      engine.submitAuctionBid(me.id, bid);
    } else {
      const nextBid = auction.currentBid + Math.max(5, Math.floor(tile.price * 0.08));
      if (nextBid <= maxWillingToPay && nextBid <= me.money) {
        engine.raiseAuctionBid(me.id, nextBid);
      } else {
        engine.passAuctionBid(me.id);
      }
    }
    return { kind: "auction", complex: true };
  }

  // ---------------------------------------------------------------------
  // Choix de case d'arrivée (pouvoir "Libre arrêt")
  // ---------------------------------------------------------------------
  function decideMoveChoice(engine, state, me, profile) {
    const { maxDistance } = state.pendingMoveChoice;
    let bestDistance = maxDistance; // par défaut : va au bout (salaire si ça passe par Départ)
    let bestScore = -Infinity;

    for (let d = 1; d <= maxDistance; d++) {
      const idx = (me.position + d) % state.board.length;
      const tile = state.board[idx];
      let score = 0;
      if (OWNABLE_TYPES.includes(tile.type) && tile.owner === null) {
        score = strategicValue(state, me.id, idx, profile) / 20;
      } else if (OWNABLE_TYPES.includes(tile.type) && tile.owner !== me.id && tile.owner !== null) {
        // Case adverse : évaluer le loyer potentiel comme un risque négatif.
        score = -(tile.rent || 20) / 10;
      } else if (tile.type === "vacation") {
        score = (state.vacationPot || 0) / 30;
      } else if (tile.type === "tax") {
        score = -(tile.amount || 0) / 20;
      } else if (tile.type === "go-to-jail") {
        score = -15;
      }
      // Légère préférence pour aller plus loin (progression, salaire si on passe par Départ).
      score += d * 0.05;
      if (score > bestScore) {
        bestScore = score;
        bestDistance = d;
      }
    }

    engine.chooseLandingDistance(me.id, bestDistance);
    return { kind: "moveChoice", complex: true };
  }

  // ---------------------------------------------------------------------
  // Dette : vend/hypothèque dans le meilleur ordre possible pour combler
  // le négatif, en essayant de préserver les groupes complets.
  // ---------------------------------------------------------------------
  function decideDebtResolution(engine, state, me, profile) {
    if (me.power && !me.power.used && me.power.id === "debt_bailout") {
      engine.useDebtBailoutPower(me.id);
      return { kind: "debtBailoutPower", complex: false };
    }

    // 1) Vend en priorité les maisons des groupes qui ne sont pas complets
    //    depuis longtemps / les moins stratégiques (ici : celles du groupe
    //    le moins cher en premier, pour préserver les gros investissements).
    const withHouses = state.board
      .filter((t) => t.owner === me.id && t.type === "property" && t.houses > 0)
      .sort((a, b) => (a.price || 0) - (b.price || 0));
    for (const tile of withHouses) {
      const idx = state.board.indexOf(tile);
      const check = engine.canSellHouse(me.id, idx);
      if (check.ok) {
        engine.sellHouse(me.id, idx);
        return { kind: "sellHouse", complex: false };
      }
    }

    // 2) Hypothèque en priorité les propriétés isolées (pas de groupe
    //    complet en jeu), avant de toucher à un monopole déjà formé.
    const mortgageable = state.board
      .filter((t) => t.owner === me.id && !t.mortgaged && OWNABLE_TYPES.includes(t.type) && (t.type !== "property" || t.houses === 0))
      .sort((a, b) => {
        const aFull = a.type === "property" && ownsFullGroupPublic(state, me.id, a.group) ? 1 : 0;
        const bFull = b.type === "property" && ownsFullGroupPublic(state, me.id, b.group) ? 1 : 0;
        return aFull - bFull; // les groupes complets en dernier
      });
    if (mortgageable.length > 0) {
      const idx = state.board.indexOf(mortgageable[0]);
      engine.mortgage(me.id, idx);
      return { kind: "mortgage", complex: false };
    }

    return { kind: "noDebtOption", complex: false };
  }

  // ---------------------------------------------------------------------
  // Construction : construit tant que c'est rentable et que la réserve
  // de sécurité reste respectée, en respectant Even Build via canBuildHouse.
  // ---------------------------------------------------------------------
  function considerBuilding(engine, state, me, profile) {
    let acted = false;
    let safety = 0;
    while (safety < 30) {
      safety += 1;
      const myFullGroups = [...new Set(state.board.filter((t) => t.type === "property" && t.owner === me.id).map((t) => t.group))].filter(
        (g) => ownsFullGroupPublic(state, me.id, g)
      );
      if (myFullGroups.length === 0) break;

      let target = null;
      let targetCost = Infinity;
      myFullGroups.forEach((group) => {
        tilesOfGroup(state, group).forEach((tile) => {
          if (tile.owner !== me.id) return;
          const idx = state.board.indexOf(tile);
          const check = engine.canBuildHouse(me.id, idx);
          if (check.ok && check.cost < targetCost) {
            targetCost = check.cost;
            target = idx;
          }
        });
      });

      if (target === null) break;
      const remainingAfter = me.money - targetCost;
      if (remainingAfter < profile.buildThreshold) break;

      engine.buildHouse(me.id, target);
      acted = true;
      // Reflète l'argent dépensé pour la prochaine itération de la boucle.
      me = { ...me, money: me.money - targetCost };
      state = engine.getPublicState();
    }
    return acted;
  }

  // ---------------------------------------------------------------------
  // Échanges : évalue une offre reçue en comparant la valeur stratégique
  // de ce que je donne contre ce que je reçois (pas juste le prix affiché).
  // ---------------------------------------------------------------------
  function tradeNetValueForRecipient(state, trade, profile) {
    const toId = trade.toId;
    const giveValue =
      trade.requestTiles.reduce((s, i) => s + strategicValue(state, toId, i, profile), 0) + trade.requestMoney;
    const receiveValue =
      trade.offerTiles.reduce((s, i) => s + strategicValue(state, toId, i, profile), 0) + trade.offerMoney;
    return receiveValue - giveValue;
  }

  function decideIncomingTrade(engine, state, me, profile, trade) {
    const netValue = tradeNetValueForRecipient(state, trade, profile);
    const referenceScale = Math.max(
      100,
      trade.requestTiles.reduce((s, i) => s + (state.board[i].price || 0), 0) + trade.requestMoney
    );
    const relativeGain = netValue / referenceScale;

    let accept = relativeGain >= -profile.tradeFairnessTolerance;
    // Ne jamais accepter un échange qui nous mettrait sous la réserve de sécurité.
    if (me.money + trade.offerMoney - trade.requestMoney < 0) accept = false;
    // Ne jamais aider (sans contrepartie nette positive) le joueur en tête à compléter un monopole.
    const proposer = state.players.find((p) => p.id === trade.fromId);
    if (proposer && myRank(state, trade.fromId) === 1 && relativeGain < 0.05) accept = false;

    if (chance(profile.mistakeChance)) accept = !accept;

    engine.respondTrade(trade.id, me.id, accept);
    return { kind: "respondTrade", complex: true };
  }

  function decideIncomingLoan(engine, state, me, profile, offer) {
    const reserve = safeReserve(state, profile);
    const genuinelyNeedsCash = me.money < reserve * 1.3;
    const totalCostRatio = offer.totalOwed / Math.max(1, offer.principal);
    // N'accepte que si le besoin est réel ET le coût du crédit reste raisonnable.
    let accept = genuinelyNeedsCash && totalCostRatio <= 1 + 0.35 + profile.tradeFairnessTolerance;
    if (chance(profile.mistakeChance)) accept = !accept;
    engine.respondLoan(offer.id, me.id, accept);
    return { kind: "respondLoan", complex: false };
  }

  // Propose spontanément un échange s'il existe une case adverse qui
  // compléterait un de mes groupes, contre une offre honnête (case(s) ou
  // argent équivalent à sa valeur, avec une petite marge en ma faveur).
  function considerProposingTrade(engine, state, me, profile) {
    if (state.activeEvent && state.activeEvent.id === "trade_freeze") return null;
    if (!chance(profile.proactiveTradeChance)) return null;
    const alreadyProposedTo = new Set(state.tradeOffers.filter((t) => t.fromId === me.id).map((t) => t.toId));

    let bestTarget = null;
    let bestTileIdx = null;
    let bestValue = 0;
    state.board.forEach((tile, idx) => {
      if (tile.type !== "property" || tile.owner === null || tile.owner === me.id) return;
      if (tile.houses > 0) return;
      const owned = groupOwnershipCount(state, me.id, tile.group);
      const groupSize = tilesOfGroup(state, tile.group).length;
      if (owned !== groupSize - 1) return; // ne cible que ce qui complèterait un groupe
      if (alreadyProposedTo.has(tile.owner)) return;
      const value = strategicValue(state, me.id, idx, profile);
      if (value > bestValue) {
        bestValue = value;
        bestTarget = tile.owner;
        bestTileIdx = idx;
      }
    });

    if (bestTarget === null) return null;
    const targetTile = state.board[bestTileIdx];
    const offerMoney = Math.min(me.money - safeReserve(state, profile), Math.floor((targetTile.price || 0) * 1.15));
    if (offerMoney <= 0) return null;

    engine.proposeTrade(me.id, bestTarget, [], offerMoney, [bestTileIdx], 0);
    return { kind: "proposeTrade", complex: true };
  }

  // En tant que prêteur potentiel : propose un petit prêt à un adversaire
  // clairement à court d'argent, à un taux qui reste rentable pour moi.
  function considerProposingLoan(engine, state, me, profile) {
    if (!state.loansEnabled) return null;
    if (!chance(profile.proactiveTradeChance * 0.5)) return null;
    const reserve = safeReserve(state, profile);
    if (me.money < reserve * 2) return null;

    const alreadyOfferedTo = new Set(state.loanOffers.filter((o) => o.lenderId === me.id).map((o) => o.borrowerId));
    const target = state.players.find(
      (p) => p.id !== me.id && !p.bankrupt && !alreadyOfferedTo.has(p.id) && p.money < 100 && p.money >= 0
    );
    if (!target) return null;

    const amount = Math.min(150, Math.floor((me.money - reserve) / 2));
    if (amount < 30) return null;
    engine.proposeLoan(me.id, target.id, amount, 20, 6);
    return { kind: "proposeLoan", complex: true };
  }

  // ---------------------------------------------------------------------
  // Déroulement du tour : gère pouvoirs + construction avant de lancer,
  // puis lance les dés.
  // ---------------------------------------------------------------------
  function decideTurnActions(engine, state, me, profile) {
    if (handlePowerBeforeRoll(engine, state, me, profile)) {
      return { kind: "power", complex: true };
    }
    if (considerBuilding(engine, state, me, profile)) {
      return { kind: "build", complex: true };
    }
    engine.roll();
    return { kind: "roll", complex: false };
  }

  // ---------------------------------------------------------------------
  // Point d'entrée : inspecte l'état courant et effectue LA prochaine
  // action nécessaire pour ce joueur IA, exactement comme le ferait un
  // humain via l'interface (une action par appel).
  // ---------------------------------------------------------------------
  function decideAndAct(engine, playerId, difficulty) {
    const profile = getProfile(difficulty);
    const state = engine.getPublicState();
    const me = state.players.find((p) => p.id === playerId);
    if (!me || me.bankrupt || state.gameOver) return null;

    if (me.inDebt) return decideDebtResolution(engine, state, me, profile);

    if (state.pendingDecision && state.pendingDecision.playerId === playerId) {
      return decideBuy(engine, state, me, profile);
    }

    if (state.pendingAuction) {
      const canBidNow =
        state.pendingAuction.mode === "secret"
          ? state.pendingAuction.pendingPlayers.includes(playerId)
          : state.pendingAuction.currentTurnPlayerId === playerId;
      if (canBidNow) return decideAuctionBid(engine, state, me, profile);
      return null; // ce n'est pas à moi de miser pour l'instant
    }

    if (state.pendingMoveChoice && state.pendingMoveChoice.playerId === playerId) {
      return decideMoveChoice(engine, state, me, profile);
    }

    const incomingTrade = state.tradeOffers.find((t) => t.toId === playerId);
    if (incomingTrade) return decideIncomingTrade(engine, state, me, profile, incomingTrade);

    const incomingLoan = state.loanOffers.find((o) => o.borrowerId === playerId);
    if (incomingLoan) return decideIncomingLoan(engine, state, me, profile, incomingLoan);

    if (state.currentPlayerIndex === playerId) {
      return decideTurnActions(engine, state, me, profile);
    }

    return considerProposingTrade(engine, state, me, profile) || considerProposingLoan(engine, state, me, profile) || null;
  }

  function computeThinkTime(actionInfo, difficulty) {
    const profile = getProfile(difficulty);
    if (!actionInfo) return 200;
    return actionInfo.complex ? randRange(profile.thinkTimeComplexMs) : randRange(profile.thinkTimeSimpleMs);
  }

  return { decideAndAct, computeThinkTime, getProfile, DIFFICULTY_PROFILES };
});
