/**
 * JWT Auth Middleware
 *
 * generateToken      — sign a JWT for a user
 * requireAuth        — any logged-in user (attaches req.user with live permissions)
 * requireRole(roles) — specific role(s) only
 * requirePermission  — checks live permission from UserStore
 * revokeToken        — add a token to the denylist on logout
 *
 * Token denylist: revoked JWTs are stored in SQLite and mirrored in-memory.
 * DB is initialised lazily on first request to avoid circular-require crashes
 * (db.js loads services that load middleware/auth before db.js finishes exporting).
 */

const jwt       = require('jsonwebtoken');
const UserStore = require('../services/userStore');

const SECRET = process.env.JWT_SECRET || 'pixelrelay-secret-change-in-production';
if (process.env.NODE_ENV === 'production' && SECRET === 'pixelrelay-secret-change-in-production') {
  console.error('[Auth] FATAL: JWT_SECRET not set in production. Set JWT_SECRET env variable.');
  process.exit(1);
}

// ── Token denylist ─────────────────────────────────────────────────────────────
// Lazy-initialised on first request — never touches db at module-load time.
// This prevents the circular-require crash:
//   db.js → services/* → middleware/auth → db (not yet exported) → crash
const revokedSet    = new Set();
let   dbInitialised = false;

function ensureDb() {
  if (dbInitialised) return;
  dbInitialised = true;

  const { db } = require('../services/db');   // safe: all modules fully loaded by first request

  db.exec(`
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti        TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_revoked_exp ON revoked_tokens(expires_at);
  `);

  // Seed in-memory set from DB (skip already-expired tokens)
  const rows = db.prepare('SELECT jti FROM revoked_tokens WHERE expires_at > ?')
    .all(Math.floor(Date.now() / 1000));
  for (const r of rows) revokedSet.add(r.jti);

  // Purge expired tokens from DB + memory every 10 minutes
  setInterval(() => {
    const now     = Math.floor(Date.now() / 1000);
    const expired = db.prepare('SELECT jti FROM revoked_tokens WHERE expires_at <= ?').all(now);
    if (expired.length > 0) {
      db.prepare('DELETE FROM revoked_tokens WHERE expires_at <= ?').run(now);
      for (const { jti } of expired) revokedSet.delete(jti);
    }
  }, 10 * 60 * 1000);
}

function revokeToken(decoded) {
  ensureDb();
  const { db } = require('../services/db');
  const jti = decoded.jti || `${decoded.username}:${decoded.iat}`;
  revokedSet.add(jti);
  db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)')
    .run(jti, decoded.exp);
}

function isRevoked(decoded) {
  const jti = decoded.jti || `${decoded.username}:${decoded.iat}`;
  return revokedSet.has(jti);
}

function generateToken(user) {
  return jwt.sign(
    { username: user.username, role: user.role },
    SECRET,
    { expiresIn: '7d' }
  );
}

// requireAuth — verifies JWT, checks denylist, attaches live permissions to req.user
// Also accepts ?token= query param for navigator.sendBeacon() calls, which cannot
// send custom headers. Only used by the beforeunload activity-clear beacon.
async function requireAuth(req, res, next) {
  ensureDb();
  const header = req.headers.authorization;
  const queryToken = req.query?.token;
  if (!header?.startsWith('Bearer ') && !queryToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const token   = queryToken || header.split(' ')[1];
    const decoded = jwt.verify(token, SECRET);

    if (isRevoked(decoded)) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    const user = UserStore.getUser(decoded.username);
    if (!user) {
      return res.status(401).json({ error: 'Account no longer exists', deleted: true });
    }

    req.user = {
      ...decoded,
      permissions: UserStore.getPermissions(decoded.role),
    };

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return [requireAuth, (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  }];
}

function requirePermission(permission) {
  return [requireAuth, (req, res, next) => {
    // Admin/superadmin bypass all permission gates
    if (['admin', 'superadmin'].includes(req.user.role)) return next();
    const perms = req.user.permissions;
    if (!perms[permission]) {
      return res.status(403).json({ error: `Permission denied: ${permission}` });
    }
    next();
  }];
}

module.exports = { generateToken, requireAuth, requireRole, requirePermission, revokeToken };