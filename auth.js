// ============================================================
// REACH UP — Authentification
//
// Jetons JWT auto-suffisants (pas de session stockée côté serveur) :
// le client garde son jeton (localStorage) et le renvoie à chaque
// connexion. Ça survit à un redémarrage du serveur SANS avoir besoin
// d'un magasin de sessions séparé — tant que le secret ne change pas.
//
// Le secret est lu depuis la variable d'environnement JWT_SECRET s'il
// existe (recommandé en production), sinon un secret de repli est
// utilisé (suffisant pour un usage entre amis, mais change à chaque
// redémarrage si aucune variable d'environnement n'est définie — les
// jetons existants deviennent alors invalides, ce qui déconnecte tout le
// monde sans casser quoi que ce soit).
// ============================================================

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const JWT_SECRET = process.env.JWT_SECRET || "gaeboub-up-dev-secret-changez-moi-en-production";
const TOKEN_EXPIRY = "180d"; // "se souvenir de moi" par défaut — longue durée

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function signToken(user) {
  return jwt.sign({ userId: user.id, email: user.email, pseudo: user.pseudo }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === "string" && EMAIL_REGEX.test(email.trim());
}

function isValidPassword(password) {
  return typeof password === "string" && password.length >= 6;
}

function isValidPseudo(pseudo) {
  return typeof pseudo === "string" && pseudo.trim().length >= 2 && pseudo.trim().length <= 20;
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  isValidEmail,
  isValidPassword,
  isValidPseudo,
};
