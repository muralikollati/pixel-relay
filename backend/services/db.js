/**
 * db.js — SQLite database (better-sqlite3)
 * Replaces tokens.json, users.json, reports.json.
 */
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/pixelrelay.db');
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username   TEXT PRIMARY KEY,
    password   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login TEXT
  );
  CREATE TABLE IF NOT EXISTS permissions (
    role  TEXT NOT NULL,
    key   TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (role, key)
  );
  CREATE TABLE IF NOT EXISTS accounts (
    email      TEXT PRIMARY KEY,
    owner      TEXT NOT NULL,
    tokens     TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active',
    stats      TEXT NOT NULL DEFAULT '{}',
    added_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS account_requests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    owner         TEXT NOT NULL,
    tokens        TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    requested_at  TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at   TEXT,
    reviewed_by   TEXT,
    reject_reason TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_req_owner  ON account_requests(owner);
  CREATE INDEX IF NOT EXISTS idx_req_status ON account_requests(status);
  CREATE TABLE IF NOT EXISTS reports (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    date             TEXT NOT NULL,
    email            TEXT NOT NULL,
    emails_processed INTEGER NOT NULL DEFAULT 0,
    success_rate     REAL    NOT NULL DEFAULT 0,
    spam_rescued     INTEGER NOT NULL DEFAULT 0,
    pixels_fired     INTEGER NOT NULL DEFAULT 0,
    run_count        INTEGER NOT NULL DEFAULT 1,
    UNIQUE(date, email)
  );
  CREATE INDEX IF NOT EXISTS idx_rep_date ON reports(date);
  CREATE TABLE IF NOT EXISTS worker_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS run_history (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    email            TEXT NOT NULL,
    owner            TEXT NOT NULL DEFAULT '',
    emails_processed INTEGER NOT NULL DEFAULT 0,
    pixels_fired     INTEGER NOT NULL DEFAULT 0,
    success_rate     REAL    NOT NULL DEFAULT 0,
    spam_rescued     INTEGER NOT NULL DEFAULT 0,
    started_at       TEXT,
    finished_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_rh_email ON run_history(email);
  CREATE INDEX IF NOT EXISTS idx_rh_finished ON run_history(finished_at);
`);

// Default worker config
[['concurrencyLimit','10'],['batchDelayMs','2000'],['emailJitterMs','0']].forEach(([k,v]) =>
  db.prepare('INSERT OR IGNORE INTO worker_config (key,value) VALUES (?,?)').run(k,v)
);

// Default permissions
const DEFAULT_PERMS = {
  superadmin: { canManageUsers:true, canConnectAccounts:true, canRunWorker:true, canViewReports:true, canDeleteAccounts:true, canChangePermissions:true },
  admin:      { canManageUsers:false, canConnectAccounts:true, canRunWorker:true, canViewReports:true, canDeleteAccounts:true, canChangePermissions:false },
  user:       { canManageUsers:false, canConnectAccounts:true, canRunWorker:true, canViewReports:true, canDeleteAccounts:false, canChangePermissions:false },
};
const ins = db.prepare('INSERT OR IGNORE INTO permissions (role,key,value) VALUES (?,?,?)');
for (const [role, perms] of Object.entries(DEFAULT_PERMS))
  for (const [key, val] of Object.entries(perms))
    ins.run(role, key, val ? 1 : 0);

// ── Schema migrations for existing databases ───────────────────────────────────
// SQLite's CREATE TABLE IF NOT EXISTS never alters existing tables, so schema
// changes must be applied explicitly via ALTER TABLE or table recreation.
// Each block is idempotent — safe to run on every startup.
(function applyMigrations() {
  // Migration 1: account_requests — add UNIQUE constraint on email and allow NULL tokens.
  //
  // Root cause of "Account connected but request could not be saved":
  //   • The table had no UNIQUE constraint on email, so ON CONFLICT(email) in the
  //     UPSERT was a no-op — SQLite silently inserted duplicate rows instead of
  //     updating the existing one. On re-connect, approve() found the old
  //     already-approved row and threw "Request is already approved", which bubbled
  //     up as token_exchange_failed.
  //   • tokens NOT NULL conflicted with our own fix that sets tokens=NULL on rejection,
  //     causing an immediate constraint violation when a rejected user tried to reconnect.
  //
  // Fix: recreate the table with UNIQUE(email) and tokens TEXT (nullable).
  // Existing rows are preserved via INSERT OR IGNORE into the new table.
  const cols = db.prepare("PRAGMA table_info(account_requests)").all();
  const hasUniqueEmail = (() => {
    try {
      const idxList = db.prepare("PRAGMA index_list(account_requests)").all();
      for (const idx of idxList) {
        if (!idx.unique) continue;
        const idxInfo = db.prepare(`PRAGMA index_info(${idx.name})`).all();
        if (idxInfo.length === 1 && idxInfo[0].name === 'email') return true;
      }
      return false;
    } catch { return false; }
  })();

  if (!hasUniqueEmail) {
    console.log('[DB] Migrating account_requests: adding UNIQUE(email) and allowing NULL tokens...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS account_requests_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        email         TEXT NOT NULL UNIQUE,
        owner         TEXT NOT NULL,
        tokens        TEXT,
        status        TEXT NOT NULL DEFAULT 'pending',
        requested_at  TEXT NOT NULL DEFAULT (datetime('now')),
        reviewed_at   TEXT,
        reviewed_by   TEXT,
        reject_reason TEXT
      );
      -- Deduplicate: keep the most recent row per email
      INSERT OR IGNORE INTO account_requests_new
        (id, email, owner, tokens, status, requested_at, reviewed_at, reviewed_by, reject_reason)
      SELECT id, email, owner, tokens, status, requested_at, reviewed_at, reviewed_by, reject_reason
      FROM account_requests
      ORDER BY requested_at DESC;
      DROP TABLE account_requests;
      ALTER TABLE account_requests_new RENAME TO account_requests;
      CREATE INDEX IF NOT EXISTS idx_req_owner  ON account_requests(owner);
      CREATE INDEX IF NOT EXISTS idx_req_status ON account_requests(status);
    `);
    console.log('[DB] account_requests migration complete.');
  }
})();

// Encryption
const RAW_KEY = process.env.TOKEN_ENCRYPTION_KEY;
let ENC_KEY   = null;
if (RAW_KEY && RAW_KEY.length === 64) {
  ENC_KEY = Buffer.from(RAW_KEY, 'hex');
  console.log('[DB] AES-256-GCM encryption enabled');
} else {
  console.warn('[DB] WARNING: TOKEN_ENCRYPTION_KEY missing — tokens stored unencrypted!');
}

function encryptTokens(obj) {
  const text = JSON.stringify(obj);
  if (!ENC_KEY) return text;
  const iv     = crypto.randomBytes(12);
  const c      = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc    = Buffer.concat([c.update(text,'utf8'), c.final()]);
  const tag    = c.getAuthTag();
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptTokens(stored) {
  if (!stored) return {};
  if (!ENC_KEY || !stored.startsWith('enc:')) {
    try { return JSON.parse(stored); } catch { return {}; }
  }
  try {
    const [,ivH,tagH,encH] = stored.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivH,'hex'));
    d.setAuthTag(Buffer.from(tagH,'hex'));
    return JSON.parse(d.update(Buffer.from(encH,'hex'),null,'utf8') + d.final('utf8'));
  } catch(e) { console.error('[DB] Decrypt failed:', e.message); return {}; }
}

// One-time migration from old JSON flat files
function migrate() {
  // users.json
  const up = process.env.USER_STORE_PATH || path.join(__dirname,'../data/users.json');
  if (fs.existsSync(up)) {
    try {
      const raw = JSON.parse(fs.readFileSync(up,'utf8'));
      const ins = db.prepare('INSERT OR IGNORE INTO users (username,password,role,created_at,last_login) VALUES (?,?,?,?,?)');
      for (const u of Object.values(raw.users||{}))
        ins.run(u.username,u.password,u.role,u.createdAt||new Date().toISOString(),u.lastLogin||null);
      const insp = db.prepare('INSERT OR REPLACE INTO permissions (role,key,value) VALUES (?,?,?)');
      for (const [role,perms] of Object.entries(raw.permissions||{}))
        for (const [k,v] of Object.entries(perms)) insp.run(role,k,v?1:0);
      fs.renameSync(up, up+'.migrated');
      console.log('[DB] Migrated users.json');
    } catch(e) { console.error('[DB] users migrate:', e.message); }
  }
  // tokens.json — old field-level encrypted format
  const tp = process.env.TOKEN_STORE_PATH || path.join(__dirname,'../data/tokens.json');
  if (fs.existsSync(tp)) {
    try {
      const raw = JSON.parse(fs.readFileSync(tp,'utf8'));
      const insa = db.prepare('INSERT OR IGNORE INTO accounts (email,owner,tokens,status,stats,added_at,updated_at) VALUES (?,?,?,?,?,?,?)');
      const defStats = {emailsProcessed:0,pixelsFired:0,fallbacks:0,successRate:100,lastRun:null,trend:[100,100,100,100,100,100,100],quotaUsed:0,spamRescued:0};
      for (const [email, rec] of Object.entries(raw)) {
        // Decrypt old per-field encryption
        const decField = (v) => {
          if (!ENC_KEY||!v||!v.startsWith('enc:')) return v;
          try {
            const [,ivH,tagH,encH] = v.split(':');
            const d = crypto.createDecipheriv('aes-256-gcm',ENC_KEY,Buffer.from(ivH,'hex'));
            d.setAuthTag(Buffer.from(tagH,'hex'));
            return d.update(Buffer.from(encH,'hex'),null,'utf8')+d.final('utf8');
          } catch { return v; }
        };
        const tokenObj = {
          access_token: decField(rec.access_token), refresh_token: decField(rec.refresh_token),
          id_token: decField(rec.id_token), expiry_date: rec.expiry_date,
          token_type: rec.token_type, scope: rec.scope,
        };
        insa.run(email, rec.owner||'admin', encryptTokens(tokenObj),
          rec.status||'active', JSON.stringify(rec.stats||defStats),
          rec.addedAt||new Date().toISOString(), rec.updatedAt||new Date().toISOString());
      }
      fs.renameSync(tp, tp+'.migrated');
      console.log('[DB] Migrated tokens.json');
    } catch(e) { console.error('[DB] tokens migrate:', e.message); }
  }
  // reports.json
  const rp = process.env.REPORT_STORE_PATH || path.join(__dirname,'../data/reports.json');
  if (fs.existsSync(rp)) {
    try {
      const raw = JSON.parse(fs.readFileSync(rp,'utf8'));
      const insr = db.prepare('INSERT OR IGNORE INTO reports (date,email,emails_processed,success_rate,spam_rescued,pixels_fired,run_count) VALUES (?,?,?,?,?,?,?)');
      for (const [date,accs] of Object.entries(raw))
        for (const [email,r] of Object.entries(accs))
          insr.run(date,email,r.emailsProcessed||0,r.successRate||0,r.spamRescued||0,r.pixelsFired||0,r.runCount||1);
      fs.renameSync(rp, rp+'.migrated');
      console.log('[DB] Migrated reports.json');
    } catch(e) { console.error('[DB] reports migrate:', e.message); }
  }
}
try { migrate(); } catch(e) { console.error('[DB] Migration error:', e.message); }

module.exports = { db, encryptTokens, decryptTokens };
