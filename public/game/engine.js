// ============================================================
// REACH UP — Moteur du jeu
// Phase 2 : règles principales, déplacements, tours, conditions de victoire
//
// Ce moteur ne sait RIEN du réseau ni de Socket.io. C'est volontaire :
// on veut pouvoir tester/valider les règles toutes seules, en local,
// avant de les brancher au multijoueur (Phase 3).
//
// Non inclus pour l'instant (arrivera dans une phase ultérieure) :
//   - construction de maisons/hôtels
//   - hypothèque, vente, échanges entre joueurs
//   - enchères quand un joueur refuse d'acheter
// Sans ça, l'achat de propriété est "acheter ou laisser passer",
// et un joueur en faillite perd simplement ses propriétés (elles
// redeviennent libres), sans enchère pour l'instant.
// ============================================================

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    const { BOARD, CHANCE_CARDS } = require("./board.js");
    module.exports = factory(BOARD, CHANCE_CARDS);
  } else {
    root.ReachUpEngine = factory(root.ReachUpBoard.BOARD, root.ReachUpBoard.CHANCE_CARDS);
  }
})(typeof window !== "undefined" ? window : globalThis, function (BOARD_TEMPLATE, CHANCE_CARDS) {

  const STARTING_MONEY = 1500;
  const SALARY = 200;
  const JAIL_POSITION = 10;
  const JAIL_FINE = 50;
  const MAX_JAIL_TURNS = 3;

  class GameEngine {
    /**
     * @param {string[]} playerNames
     * @param {object} [options]
     * @param {function} [options.decideBuy] - (player, tile) => boolean.
     *   Par défaut : achète si ça laisse au moins 100 en réserve.
     *   Sera remplacé par un vrai choix humain en Phase 3/4.
     */
    constructor(playerNames, options = {}) {
      // On clone le plateau à chaque partie (chaque partie a ses propres
      // propriétaires), pour ne jamais modifier le modèle partagé.
      this.board = BOARD_TEMPLATE.map((tile) => ({ ...tile }));

      this.players = playerNames.map((name, id) => ({
        id,
        name,
        position: 0,
        money: STARTING_MONEY,
        inJail: false,
        jailTurns: 0,
        jailFreeCards: 0,
        bankrupt: false,
      }));

      this.decideBuy =
        options.decideBuy ||
        ((player, tile) => player.money - tile.price >= 100);

      this.currentPlayerIndex = 0;
      this.turnNumber = 0;
      this.log = [];
      this.gameOver = false;
      this.winner = null;
    }

    addLog(message) {
      this.log.push(message);
    }

    currentPlayer() {
      return this.players[this.currentPlayerIndex];
    }

    activePlayers() {
      return this.players.filter((p) => !p.bankrupt);
    }

    rollDice() {
      const d1 = 1 + Math.floor(Math.random() * 6);
      const d2 = 1 + Math.floor(Math.random() * 6);
      return [d1, d2];
    }

    // Transfert d'argent générique. from ou to peuvent être null (= la banque).
    pay(from, to, amount) {
      if (from) from.money -= amount;
      if (to) to.money += amount;
    }

    moveTo(player, index, collectSalaryIfPassed) {
      const passedGo = collectSalaryIfPassed && index <= player.position && !(player.position === 0);
      player.position = index;
      if (passedGo) {
        this.pay(null, player, SALARY);
        this.addLog(`${player.name} passe par la case Départ et touche ${SALARY}.`);
      }
    }

    sendToJail(player) {
      player.position = JAIL_POSITION;
      player.inJail = true;
      player.jailTurns = 0;
      this.addLog(`${player.name} est envoyé en prison.`);
    }

    ownsFullSet(playerId, group) {
      const tilesOfGroup = this.board.filter((t) => t.type === "property" && t.group === group);
      return tilesOfGroup.every((t) => t.owner === playerId);
    }

    resolveTile(player, tile, diceSum) {
      switch (tile.type) {
        case "property": {
          if (tile.owner === null) {
            this.offerPurchase(player, tile);
          } else if (tile.owner !== player.id) {
            let rent = tile.rent;
            if (this.ownsFullSet(tile.owner, tile.group)) rent *= 2;
            const owner = this.players[tile.owner];
            this.pay(player, owner, rent);
            this.addLog(`${player.name} paie ${rent} de loyer à ${owner.name} (${tile.name}).`);
          }
          break;
        }
        case "airport": {
          if (tile.owner === null) {
            this.offerPurchase(player, tile);
          } else if (tile.owner !== player.id) {
            const owner = this.players[tile.owner];
            const count = this.board.filter((t) => t.type === "airport" && t.owner === tile.owner).length;
            const rentTable = [25, 50, 100, 200];
            const rent = rentTable[count - 1];
            this.pay(player, owner, rent);
            this.addLog(`${player.name} paie ${rent} de loyer à ${owner.name} (${tile.name}).`);
          }
          break;
        }
        case "utility": {
          if (tile.owner === null) {
            this.offerPurchase(player, tile);
          } else if (tile.owner !== player.id) {
            const owner = this.players[tile.owner];
            const count = this.board.filter((t) => t.type === "utility" && t.owner === tile.owner).length;
            const multiplier = count === 1 ? 4 : 10;
            const rent = diceSum * multiplier;
            this.pay(player, owner, rent);
            this.addLog(`${player.name} paie ${rent} de loyer à ${owner.name} (${tile.name}, ${count === 1 ? "x4" : "x10"} le lancer de dés).`);
          }
          break;
        }
        case "tax": {
          this.pay(player, null, tile.amount);
          this.addLog(`${player.name} paie ${tile.amount} de taxe (${tile.name}).`);
          break;
        }
        case "chance": {
          const card = CHANCE_CARDS[Math.floor(Math.random() * CHANCE_CARDS.length)];
          this.addLog(`${player.name} tire une carte Destin : "${card.description}"`);
          card.effect(this, player);
          break;
        }
        case "go-to-jail": {
          this.sendToJail(player);
          break;
        }
        // "go", "jail" (simple visite), "vacation" : pas d'effet particulier ici
        default:
          break;
      }
    }

    offerPurchase(player, tile) {
      if (player.money < tile.price) return; // ne peut pas se le permettre
      const wantsToBuy = this.decideBuy(player, tile);
      if (wantsToBuy) {
        this.pay(player, null, tile.price);
        tile.owner = player.id;
        this.addLog(`${player.name} achète ${tile.name} pour ${tile.price}.`);
      } else {
        this.addLog(`${player.name} ne rachète pas ${tile.name}.`);
      }
    }

    checkBankruptcy(player) {
      if (player.money < 0 && !player.bankrupt) {
        player.bankrupt = true;
        // Ses propriétés redeviennent libres (pas d'enchère pour l'instant)
        this.board.forEach((tile) => {
          if (tile.owner === player.id) tile.owner = null;
        });
        this.addLog(`💥 ${player.name} est en faillite et quitte la partie.`);
      }
    }

    checkVictory() {
      const active = this.activePlayers();
      if (active.length === 1) {
        this.gameOver = true;
        this.winner = active[0];
        this.addLog(`🏆 ${this.winner.name} remporte la partie !`);
      }
    }

    nextPlayer() {
      do {
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      } while (this.players[this.currentPlayerIndex].bankrupt);
    }

    // Joue le tour complet du joueur courant (y compris les relances en cas de double).
    playTurn() {
      if (this.gameOver) return;
      const player = this.currentPlayer();
      if (player.bankrupt) {
        this.nextPlayer();
        return;
      }

      this.turnNumber += 1;
      this.addLog(`--- Tour ${this.turnNumber} : ${player.name} ---`);

      // Gestion de la prison
      if (player.inJail) {
        if (player.jailFreeCards > 0) {
          player.jailFreeCards -= 1;
          player.inJail = false;
          this.addLog(`${player.name} utilise une carte "sortie de prison gratuite".`);
        } else {
          const [d1, d2] = this.rollDice();
          this.addLog(`${player.name} lance les dés en prison : ${d1} et ${d2}.`);
          if (d1 === d2) {
            player.inJail = false;
            this.addLog(`Double ! ${player.name} sort de prison.`);
          } else {
            player.jailTurns += 1;
            if (player.jailTurns >= MAX_JAIL_TURNS) {
              this.pay(player, null, JAIL_FINE);
              player.inJail = false;
              this.addLog(`${player.name} paie l'amende de ${JAIL_FINE} et sort de prison.`);
            } else {
              this.addLog(`${player.name} reste en prison.`);
              this.checkBankruptcy(player);
              this.checkVictory();
              if (!this.gameOver) this.nextPlayer();
              return; // le tour s'arrête ici, pas de déplacement
            }
          }
        }
      }

      // Lancers de dés (avec gestion des doubles répétés)
      let doublesInARow = 0;
      let lastDiceSum = 0;
      let keepRolling = true;

      while (keepRolling && !player.bankrupt) {
        const [d1, d2] = this.rollDice();
        lastDiceSum = d1 + d2;
        const isDouble = d1 === d2;
        this.addLog(`${player.name} lance les dés : ${d1} et ${d2}${isDouble ? " (double !)" : ""}.`);

        if (isDouble) doublesInARow += 1;

        if (isDouble && doublesInARow >= 3) {
          this.addLog(`${player.name} fait trois doubles d'affilée : direction la prison !`);
          this.sendToJail(player);
          keepRolling = false;
          break;
        }

        const newPosition = (player.position + lastDiceSum) % this.board.length;
        this.moveTo(player, newPosition, true);
        const tile = this.board[player.position];
        this.addLog(`${player.name} arrive sur "${tile.name}".`);
        this.resolveTile(player, tile, lastDiceSum);

        this.checkBankruptcy(player);
        if (player.bankrupt) break;

        // Un double donne un nouveau lancer, sauf si on vient d'être envoyé en prison
        keepRolling = isDouble && !player.inJail;
      }

      this.checkVictory();
      if (!this.gameOver) this.nextPlayer();
    }
  }

  return { GameEngine };
});
