const { db, encryptTokens, decryptTokens } = require('./db');

const DEFAULT_STATS = {
  emailsProcessed:0, pixelsFired:0, fallbacks:0, successRate:100,
  lastRun:null, trend:[100,100,100,100,100,100,100], quotaUsed:0, spamRescued:0,
};

function rowToAccount(row) {
  if (!row) return null;
  return {
    email:     row.email,
    owner:     row.owner,
    profileId: row.profile_id || null,
    status:    row.status,
    stats:     JSON.parse(row.stats || '{}'),
    addedAt:   row.added_at,
    updatedAt: row.updated_at,
    hasToken:  true,
  };
}

const TokenStore = {
  save(email, tokenData, ownerUsername, profileId = null) {
    const tokenObj = {
      access_token:  tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      id_token:      tokenData.id_token,
      expiry_date:   tokenData.expiry_date,
      token_type:    tokenData.token_type,
      scope:         tokenData.scope,
    };
    const existing = db.prepare('SELECT stats, status, profile_id FROM accounts WHERE email=?').get(email);
    db.prepare(`
      INSERT INTO accounts (email,owner,tokens,status,stats,profile_id,added_at,updated_at)
      VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))
      ON CONFLICT(email) DO UPDATE SET
        tokens=excluded.tokens, updated_at=datetime('now'),
        profile_id=COALESCE(excluded.profile_id, profile_id)
    `).run(email, ownerUsername||'admin', encryptTokens(tokenObj),
       existing ? existing.status || 'active' : 'active',
       existing ? existing.stats : JSON.stringify(DEFAULT_STATS),
       profileId || (existing ? existing.profile_id : null));
    return rowToAccount(db.prepare('SELECT * FROM accounts WHERE email=?').get(email));
  },

  get(email) {
    return rowToAccount(db.prepare('SELECT * FROM accounts WHERE email=?').get(email));
  },

  getAll() {
    return db.prepare('SELECT * FROM accounts ORDER BY added_at').all().map(rowToAccount);
  },

  getAllForUser(username, role) {
    const rows = ['superadmin','admin'].includes(role)
      ? db.prepare('SELECT * FROM accounts ORDER BY added_at').all()
      : db.prepare('SELECT * FROM accounts WHERE owner=? ORDER BY added_at').all(username);
    return rows.map(rowToAccount);
  },

  // Returns accounts scoped to a specific profile
  getAllForProfile(profileId) {
    return db.prepare('SELECT * FROM accounts WHERE profile_id=? ORDER BY added_at').all(profileId).map(rowToAccount);
  },

  // Count accounts in a profile (for cap enforcement)
  countForProfile(profileId) {
    return db.prepare('SELECT COUNT(*) as c FROM accounts WHERE profile_id=?').get(profileId).c;
  },

  // Returns full token object for worker use
  getWithTokens(email) {
    const row = db.prepare('SELECT * FROM accounts WHERE email=?').get(email);
    if (!row) return null;
    const tokens = decryptTokens(row.tokens);
    return {
      ...rowToAccount(row),
      ...tokens,
    };
  },

  updateStats(email, stats) {
    const row = db.prepare('SELECT stats FROM accounts WHERE email=?').get(email);
    if (!row) return;
    const current = JSON.parse(row.stats || '{}');
    const merged  = { ...DEFAULT_STATS, ...current, ...stats, lastRun: new Date().toISOString() };
    db.prepare('UPDATE accounts SET stats=?,updated_at=datetime(\'now\') WHERE email=?')
      .run(JSON.stringify(merged), email);
  },

  setStatus(email, status) {
    db.prepare('UPDATE accounts SET status=?,updated_at=datetime(\'now\') WHERE email=?').run(status, email);
  },

  remove(email) {
    db.prepare('DELETE FROM accounts WHERE email=?').run(email);
  },

  updateToken(email, newTokens) {
    const row = db.prepare('SELECT tokens FROM accounts WHERE email=?').get(email);
    if (!row) return;
    const existing = decryptTokens(row.tokens);
    const merged   = { ...existing, ...newTokens };
    db.prepare('UPDATE accounts SET tokens=?,updated_at=datetime(\'now\') WHERE email=?')
      .run(encryptTokens(merged), email);
  },
};

module.exports = TokenStore;
