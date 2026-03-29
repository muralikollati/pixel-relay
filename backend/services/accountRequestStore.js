/**
 * AccountRequestStore — Gmail account connection requests backed by SQLite.
 * tokenData is stored as a JSON blob with sensitive fields encrypted.
 */
const { db } = require('./db');
const crypto = require('crypto');

// Reuse encryption from env
const RAW_KEY = process.env.TOKEN_ENCRYPTION_KEY;
let ENCRYPTION_KEY = null;
if (RAW_KEY && RAW_KEY.length === 64) ENCRYPTION_KEY = Buffer.from(RAW_KEY, 'hex');

function encrypt(text) {
  if (!ENCRYPTION_KEY || !text) return text;
  const iv = crypto.randomBytes(12);
  const c  = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const e  = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return `enc:${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${e.toString('hex')}`;
}

function decrypt(text) {
  if (!ENCRYPTION_KEY || !text || !text.startsWith('enc:')) return text;
  try {
    const p  = text.split(':');
    const d  = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(p[1],'hex'));
    d.setAuthTag(Buffer.from(p[2],'hex'));
    return d.update(Buffer.from(p[3],'hex'), null, 'utf8') + d.final('utf8');
  } catch { return null; }
}

const SENSITIVE = ['access_token', 'refresh_token', 'id_token'];

function encryptTokenData(tokenData) {
  const out = { ...tokenData };
  for (const f of SENSITIVE) if (out[f]) out[f] = encrypt(out[f]);
  return JSON.stringify(out);
}

function decryptTokenData(json) {
  const obj = JSON.parse(json);
  for (const f of SENSITIVE) if (obj[f]) obj[f] = decrypt(obj[f]);
  return obj;
}

function rowToRequest(row, includeTokenData = false) {
  if (!row) return null;
  const out = {
    email:        row.email,
    owner:        row.owner,
    profileId:    row.profile_id || null,
    status:       row.status,
    requestedAt:  row.requested_at,
    reviewedAt:   row.reviewed_at,
    reviewedBy:   row.reviewed_by,
    rejectReason: row.reject_reason,
  };
  if (includeTokenData) out.tokenData = decryptTokenData(row.tokens);
  return out;
}

const AccountRequestStore = {
  create(email, tokenData, ownerUsername, profileId = null) {
    const existing = db.prepare('SELECT status FROM account_requests WHERE email = ?').get(email);
    if (existing?.status === 'pending') return rowToRequest(db.prepare('SELECT * FROM account_requests WHERE email = ?').get(email));
    const encData = encryptTokenData(tokenData);
    db.prepare(`
      INSERT INTO account_requests (email, owner, tokens, status, profile_id, requested_at)
      VALUES (?, ?, ?, 'pending', ?, datetime('now'))
      ON CONFLICT(email) DO UPDATE SET
        tokens       = excluded.tokens,
        status       = 'pending',
        profile_id   = excluded.profile_id,
        requested_at = datetime('now'),
        reviewed_at  = NULL, reviewed_by = NULL, reject_reason = NULL
    `).run(email, ownerUsername, encData, profileId);
    return rowToRequest(db.prepare('SELECT * FROM account_requests WHERE email = ?').get(email));
  },

  approve(email, reviewerUsername) {
    const row = db.prepare('SELECT * FROM account_requests WHERE email = ?').get(email);
    if (!row) throw new Error(`No request found for ${email}`);
    if (row.status !== 'pending') throw new Error(`Request is already ${row.status}`);
    // Guard: tokens are wiped on rejection. If somehow a null-token row reaches approval
    // (shouldn't happen after the UNIQUE migration, but belt-and-suspenders).
    if (!row.tokens) throw new Error(`No token data for ${email} — user must reconnect via OAuth first`);
    db.prepare(`
      UPDATE account_requests SET status='approved', reviewed_at=datetime('now'), reviewed_by=? WHERE email=?
    `).run(reviewerUsername, email);
    return decryptTokenData(row.tokens);
  },

  reject(email, reviewerUsername, reason = '') {
    const row = db.prepare('SELECT status FROM account_requests WHERE email = ?').get(email);
    if (!row) throw new Error(`No request found for ${email}`);
    // FIX: Wipe stored OAuth tokens when rejecting. Keeping live refresh tokens for
    // rejected requests is a security liability — they remain valid indefinitely in Google
    // and accessible to anyone with DB access. Tokens are nulled; re-request requires a
    // new OAuth flow to generate fresh credentials.
    db.prepare(`
      UPDATE account_requests
      SET status='rejected', reviewed_at=datetime('now'), reviewed_by=?, reject_reason=?, tokens=NULL
      WHERE email=?
    `).run(reviewerUsername, reason || null, email);
  },

  get(email) {
    return rowToRequest(db.prepare('SELECT * FROM account_requests WHERE email = ?').get(email));
  },

  getAll({ owner, role, status } = {}) {
    let query = 'SELECT * FROM account_requests';
    const params = [];
    const conds  = [];
    if (status) { conds.push('status = ?'); params.push(status); }
    if (!['superadmin','admin'].includes(role) && owner) { conds.push('owner = ?'); params.push(owner); }
    if (conds.length) query += ' WHERE ' + conds.join(' AND ');
    query += ' ORDER BY requested_at DESC';
    return db.prepare(query).all(...params).map(r => rowToRequest(r));
  },

  reRequest(email) {
    const row = db.prepare('SELECT status, tokens FROM account_requests WHERE email = ?').get(email);
    if (!row) throw new Error(`No request found for ${email}`);
    if (row.status !== 'rejected') throw new Error(`Request is ${row.status}, not rejected`);
    // FIX: Tokens are wiped on rejection. A re-request with null tokens would be approved
    // with no credentials, causing silent failures. Block it and require a new OAuth flow.
    if (!row.tokens) {
      throw new Error('Token data was cleared on rejection. Please connect the account again via OAuth to re-submit.');
    }
    db.prepare(`
      UPDATE account_requests SET status='pending', requested_at=datetime('now'),
        reviewed_at=NULL, reviewed_by=NULL, reject_reason=NULL WHERE email=?
    `).run(email);
    return rowToRequest(db.prepare('SELECT * FROM account_requests WHERE email = ?').get(email));
  },

  remove(email) {
    db.prepare('DELETE FROM account_requests WHERE email = ?').run(email);
  },

  pendingCount() {
    return db.prepare("SELECT COUNT(*) as c FROM account_requests WHERE status='pending'").get().c;
  },

  // Count pending+rejected requests for a specific profile (for cap enforcement)
  countActiveForProfile(profileId) {
    return db.prepare(
      "SELECT COUNT(*) as c FROM account_requests WHERE profile_id=? AND status IN ('pending')"
    ).get(profileId).c;
  },

  // Count pending requests for a user across all profiles (fallback when no profileId)
  countPendingForOwner(owner) {
    return db.prepare(
      "SELECT COUNT(*) as c FROM account_requests WHERE owner=? AND status='pending'"
    ).get(owner).c;
  },
};

module.exports = AccountRequestStore;