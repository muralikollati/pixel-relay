/**
 * JWT Auth Middleware
 *
 * requireAuth        — any logged-in user (attaches req.user with live permissions)
 * requireRole(roles) — specific role(s) only
 * requirePermission  — checks live permission from UserStore
 *
 * FIX: Token denylist added. On logout, tokens are added to an in-memory Set
 * (backed by SQLite for persistence across restarts). All requests check this
 * denylist before proceeding, so logout is truly immediate.
 */

const jwt       = require('jsonwebtoken');
const UserStore = require('../services/userStore');
const { db }    = require('../services/db');

const SECRET = process.env.JWT_SECRET || 'pixelrelay-secret-change-in-production';
if (process.env.NODE_ENV === 'production' && SECRET === 'pixelrelay-secret-change-in-production') {
  console.error('[Auth] FATAL: JWT_SECRET not set in production. Set JWT_SECRET env variable.');
  process.exit(1);
}

// ── Token denylist ─────────────────────────────────────────────────────────────
// Stores revoked JWTs until their natural expiry. Uses SQLite so revocations
// survive server restarts. An in-memory Set mirrors the DB for O(1) hot-path checks.
db.exec(`
  CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti        TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_revoked_exp ON revoked_tokens(expires_at);
`);

// Seed in-memory set from DB on startup (only non-expired tokens)
const revokedSet = new Set(
  db.prepare('SELECT jti FROM revoked_tokens WHERE expires_at > ?')
    .all(Math.floor(Date.now() / 1000))
    .map(r => r.jti)
);

// Purge expired entries from DB + memory (runs every 10 minutes)
setInterval(() => {
  const now = Math.floor(Date.now() / 1000);
  const expired = db.prepare('SELECT jti FROM revoked_tokens WHERE expires_at <= ?').all(now);
  if (expired.length > 0) {
    db.prepare('DELETE FROM revoked_tokens WHERE expires_at <= ?').run(now);
    for (const { jti } of expired) revokedSet.delete(jti);
  }
}, 10 * 60 * 1000);

function revokeToken(decoded) {
  // Use jti if present; otherwise use username+iat as a composite key
  const jti = decoded.jti || `${decoded.username}:${decoded.iat}`;
  revokedSet.add(jti);
  db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)').run(jti, decoded.exp);
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

// requireAuth — verifies JWT and attaches LIVE permissions from UserStore onto req.user
// This means permission changes take effect immediately without re-login.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const token   = header.split(' ')[1];
    const decoded = jwt.verify(token, SECRET);

    // FIX: Check denylist — catches explicitly logged-out tokens
    if (isRevoked(decoded)) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    // Verify user still exists (catches deleted accounts mid-session)
    const user = UserStore.getUser(decoded.username);
    if (!user) {
      return res.status(401).json({ error: 'Account no longer exists', deleted: true });
    }

    // Attach decoded JWT fields PLUS live permissions from UserStore
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
