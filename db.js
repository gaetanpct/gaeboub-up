// ============================================================
// REACH UP — Base de données (comptes, statistiques, réglages)
//
// SQLite via better-sqlite3 : un seul fichier, aucun service externe à
// configurer. ATTENTION (voir aussi le message accompagnant cette
// fonctionnalité) : sur un hébergeur à disque non persistant (ex. Render
// en version gratuite), ce fichier est effacé à chaque redémarrage du
// service. Pour une persistance réelle en production, il faut soit un
// disque persistant, soit une base externe (le code n'aurait alors qu'à
// changer la chaîne de connexion — la logique applicative resterait la
// même).
// ============================================================

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "gaeboub-up.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    pseudo TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    default_settings TEXT
  );

  CREATE TABLE IF NOT EXISTS game_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    played_at INTEGER NOT NULL,
    won INTEGER NOT NULL,
    bankrupt INTEGER NOT NULL,
    final_net_worth INTEGER,
    final_money INTEGER,
    properties_count INTEGER,
    turns_played INTEGER,
    num_players INTEGER,
    rent_paid INTEGER,
    rent_received INTEGER,
    taxes_paid INTEGER,
    times_in_jail INTEGER,
    houses_built INTEGER,
    trades_completed INTEGER,
    auctions_won INTEGER,
    biggest_rent_paid INTEGER,
    loans_contracted INTEGER,
    insurance_bought INTEGER,
    salary_collected INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_game_stats_user ON game_stats(user_id);
`);

// ---------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------
function createUser({ email, passwordHash, pseudo }) {
  const stmt = db.prepare(
    `INSERT INTO users (email, password_hash, pseudo, created_at, default_settings) VALUES (?, ?, ?, ?, NULL)`
  );
  const info = stmt.run(email.toLowerCase().trim(), passwordHash, pseudo, Date.now());
  return getUserById(info.lastInsertRowid);
}

function getUserByEmail(email) {
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase().trim());
}

function getUserById(id) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
}

function updatePseudo(userId, pseudo) {
  db.prepare(`UPDATE users SET pseudo = ? WHERE id = ?`).run(pseudo, userId);
}

function updateDefaultSettings(userId, settingsObject) {
  db.prepare(`UPDATE users SET default_settings = ? WHERE id = ?`).run(JSON.stringify(settingsObject), userId);
}

function getDefaultSettings(userId) {
  const row = db.prepare(`SELECT default_settings FROM users WHERE id = ?`).get(userId);
  if (!row || !row.default_settings) return null;
  try {
    return JSON.parse(row.default_settings);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Statistiques de parties
// ---------------------------------------------------------------------
function recordGameStats(userId, stats) {
  db.prepare(
    `INSERT INTO game_stats (
      user_id, played_at, won, bankrupt, final_net_worth, final_money, properties_count,
      turns_played, num_players, rent_paid, rent_received, taxes_paid, times_in_jail,
      houses_built, trades_completed, auctions_won, biggest_rent_paid, loans_contracted,
      insurance_bought, salary_collected
    ) VALUES (@userId, @playedAt, @won, @bankrupt, @finalNetWorth, @finalMoney, @propertiesCount,
      @turnsPlayed, @numPlayers, @rentPaid, @rentReceived, @taxesPaid, @timesInJail,
      @housesBuilt, @tradesCompleted, @auctionsWon, @biggestRentPaid, @loansContracted,
      @insuranceBought, @salaryCollected)`
  ).run({ userId, playedAt: Date.now(), ...stats });
}

function getAggregateStats(userId) {
  const totals = db
    .prepare(
      `SELECT
        COUNT(*) AS gamesPlayed,
        SUM(won) AS gamesWon,
        SUM(bankrupt) AS gamesBankrupt,
        SUM(rent_paid) AS totalRentPaid,
        SUM(rent_received) AS totalRentReceived,
        SUM(taxes_paid) AS totalTaxesPaid,
        SUM(times_in_jail) AS totalTimesInJail,
        SUM(houses_built) AS totalHousesBuilt,
        SUM(trades_completed) AS totalTradesCompleted,
        SUM(auctions_won) AS totalAuctionsWon,
        MAX(biggest_rent_paid) AS biggestRentPaidEver,
        MAX(final_net_worth) AS bestNetWorthEver,
        AVG(final_net_worth) AS avgNetWorth,
        AVG(turns_played) AS avgTurnsPlayed
      FROM game_stats WHERE user_id = ?`
    )
    .get(userId);

  const recent = db
    .prepare(`SELECT * FROM game_stats WHERE user_id = ? ORDER BY played_at DESC LIMIT 10`)
    .all(userId);

  return { totals, recent };
}

module.exports = {
  db,
  createUser,
  getUserByEmail,
  getUserById,
  updatePseudo,
  updateDefaultSettings,
  getDefaultSettings,
  recordGameStats,
  getAggregateStats,
};
