// Admin authentication: scrypt password hashes, signed expiring session cookies, CSRF tokens.
const crypto = require("node:crypto");

const COOKIE = "cc_admin";

// ---- passwords --------------------------------------------------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const hash = crypto.scryptSync(password, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split("$");
    if (scheme !== "scrypt") return false;
    const expected = Buffer.from(hashB64, "base64");
    const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Used when the user does not exist so response time does not reveal valid usernames.
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString("hex"));

function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < 10) return "Use at least 10 characters.";
  if (pw.length > 200) return "Password is too long.";
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return "Use letters and at least one number.";
  return null;
}

// ---- sessions ---------------------------------------------------------------
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const sign = (secret, data) => crypto.createHmac("sha256", secret).update(data).digest("base64url");

function createSession(secret, { uid, username }, hours) {
  const payload = { uid, username, csrf: crypto.randomBytes(24).toString("base64url"), exp: Date.now() + hours * 3600 * 1000 };
  const body = b64u(JSON.stringify(payload));
  return { token: `${body}.${sign(secret, body)}`, payload };
}

function readSession(secret, token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = sign(secret, body);
  const a = Buffer.from(String(sig)), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ }
    }
  });
  return out;
}

function cookieOptions(cfg, secure) {
  return { httpOnly: true, sameSite: "strict", secure, path: cfg.adminPath, maxAge: cfg.sessionHours * 3600 * 1000 };
}

module.exports = { COOKIE, hashPassword, verifyPassword, DUMMY_HASH, passwordProblem, createSession, readSession, parseCookies, cookieOptions };
