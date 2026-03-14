#!/usr/bin/env node
/**
 * migrate-json-to-sqlite.js — one-time migration from JSON flat files → SQLite
 *
 * Run ONCE on your server after deploying the new build:
 *   node migrate-json-to-sqlite.js
 *
 * Safe to run multiple times — uses INSERT OR IGNORE / ON CONFLICT DO NOTHING.
 * Your old JSON files are NOT deleted — they stay as backup.
 */
require('dotenv').config();

const fs   = require('fs');
const db   = require('./services/db'); // triggers schema creation

function readJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.warn(`  [warn] Could not read ${filePath}: ${err.message}`);
    return fallback;
  }
}

let total = 0;

// ── 1. Users ──────────────────────────────────────────────────────────────────
const usersPath = process.env.USER_STORE_PATH || './data/users.json';
const usersData = readJSON(usersPath, { users: {}, permissions: {} });

console.log('\n[migrate] Users...');
const insertUser = db.prepare(
  'INSERT OR IGNORE INTO users (username, password, role, created_at, last_login) VALUES (?, ?, ?, ?, ?)'
);
const txUsers = db.transaction(() => {
  for (const u of Object.values(usersData.users || {})) {
    insertUser.run(u.username, u.password, u.role || 'user',
      u.createdAt || new Date().toISOString(), u.lastLogin || null);
    total++;
  }
});
txUsers();
console.log(`  ✓ ${Object.keys(usersData.users || {}).length} users imported`);

// Permissions
console.log('[migrate] Permissions...');
const upsertPerm = db.prepare(
  'INSERT INTO permissions (role, key, value) VALUES (?, ?, ?) ON CONFLICT(role,key) DO UPDATE SET value=excluded.value'
);
const txPerms = db.transaction(() => {
  for (const [role, perms] of Object.entries(usersData.permissions || {})) {
    for (const [key, val] of Object.entries(perms)) {
      upsertPerm.run(role, key, val ? 1 : 0);
    }
  }
});
txPerms();
console.log(`  ✓ permissions imported`);

// ── 2. Gmail accounts (tokens) ────────────────────────────────────────────────
const tokensPath = process.env.TOKEN_STORE_PATH || './data/tokens.json';
const tokensData = readJSON(tokensPath, {});

console.log('\n[migrate] Accounts (tokens)...');
const insertAccount = db.prepare(`
  INSERT OR IGNORE INTO accounts
    (email, owner, access_token, refresh_token, id_token, token_expiry, status, stats, added_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const txAccounts = db.transaction(() => {
  for (const [email, rec] of Object.entries(tokensData)) {
    insertAccount.run(
      rec.email || email,
      rec.owner || 'admin',
      rec.access_token  || null,
      rec.refresh_token || null,
      rec.id_token      || null,
      rec.expiry_date   ? String(rec.expiry_date) : null,
      rec.status        || 'active',
      JSON.stringify(rec.stats || {}),
      rec.addedAt   || new Date().toISOString(),
      rec.updatedAt || new Date().toISOString(),
    );
    total++;
  }
});
txAccounts();
console.log(`  ✓ ${Object.keys(tokensData).length} accounts imported`);

// ── 3. Account requests ───────────────────────────────────────────────────────
const reqPath  = process.env.ACCOUNT_REQUEST_STORE_PATH || './data/account_requests.json';
const reqData  = readJSON(reqPath, {});

console.log('\n[migrate] Account requests...');
const insertReq = db.prepare(`
  INSERT OR IGNORE INTO account_requests
    (email, owner, token_data, status, requested_at, reviewed_at, reviewed_by, reject_reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const txReqs = db.transaction(() => {
  for (const [email, r] of Object.entries(reqData)) {
    insertReq.run(
      r.email || email,
      r.owner || '',
      JSON.stringify(r.tokenData || {}),
      r.status       || 'pending',
      r.requestedAt  || new Date().toISOString(),
      r.reviewedAt   || null,
      r.reviewedBy   || null,
      r.rejectReason || null,
    );
    total++;
  }
});
txReqs();
console.log(`  ✓ ${Object.keys(reqData).length} account requests imported`);

// ── 4. Reports ────────────────────────────────────────────────────────────────
const reportPath = process.env.REPORT_STORE_PATH || './data/reports.json';
const reportData = readJSON(reportPath, {});

console.log('\n[migrate] Reports...');
const insertReport = db.prepare(`
  INSERT OR IGNORE INTO reports
    (email, owner, date, emails_processed, pixels_fired, success_rate, spam_rescued, fallbacks)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const txReports = db.transaction(() => {
  // Old format: { [email]: { [date]: { ... } } }
  for (const [email, byDate] of Object.entries(reportData)) {
    for (const [date, r] of Object.entries(byDate || {})) {
      insertReport.run(
        email,
        r.owner || '',
        date,
        r.emailsProcessed || 0,
        r.pixelsFired     || 0,
        r.successRate     || 0,
        r.spamRescued     || 0,
        r.fallbacks       || 0,
      );
      total++;
    }
  }
});
txReports();
console.log(`  ✓ reports imported`);

// ── 5. Config ─────────────────────────────────────────────────────────────────
const configPath = process.env.CONFIG_STORE_PATH || './data/config.json';
const configData = readJSON(configPath, {});

console.log('\n[migrate] Config...');
const upsertConfig = db.prepare(
  'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
);
const txConfig = db.transaction(() => {
  for (const [key, val] of Object.entries(configData)) {
    upsertConfig.run(key, String(val));
  }
});
txConfig();
console.log(`  ✓ config imported`);

console.log(`\n✅ Migration complete — ${total} total records imported`);
console.log('   Your original JSON files are unchanged and can be removed once you verify everything works.\n');
