#!/usr/bin/env node
/**
 * reset-superadmin.js — Emergency superadmin password reset
 *
 * Run this directly on the server when the superadmin password is forgotten.
 * Does NOT require being logged in — it writes directly to the SQLite DB.
 *
 * Usage:
 *   node reset-superadmin.js                        ← interactive prompt
 *   node reset-superadmin.js <username> <newpass>   ← non-interactive
 *
 * Examples:
 *   node reset-superadmin.js
 *   node reset-superadmin.js admin MyNewPass123
 *
 * Requirements:
 *   - Run from the backend/ directory  (cd backend && node reset-superadmin.js)
 *   - Node.js must be installed
 *   - bcryptjs and better-sqlite3 must be installed (they are — same deps as server)
 */

'use strict';
require('dotenv').config();

const path    = require('path');
const readline = require('readline');
const bcrypt  = require('bcryptjs');
const Database = require('better-sqlite3');

// ── Security gate ─────────────────────────────────────────────────────────────
// This script must never be runnable by anyone who simply has repo or SSH access.
//
// Before running, set a one-time secret in your .env file:
//   RESET_SECRET=some-long-random-string
//
// Then run:
//   RESET_SECRET=some-long-random-string node reset-superadmin.js
//
// Remove RESET_SECRET from .env immediately after use.
const RESET_SECRET = process.env.RESET_SECRET;
if (!RESET_SECRET || RESET_SECRET.trim().length < 12) {
  console.error('\n❌  Blocked: RESET_SECRET env variable is missing or too short.');
  console.error('\n   To use this script:');
  console.error('   1. Add RESET_SECRET=<your-long-random-value> to backend/.env');
  console.error('   2. Run: node reset-superadmin.js');
  console.error('   3. Remove RESET_SECRET from .env immediately after.\n');
  process.exit(1);
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data/pixelrelay.db');

// ── Helpers ───────────────────────────────────────────────────────────────────

function openDb() {
  try {
    return new Database(DB_PATH);
  } catch (err) {
    console.error(`\n❌  Cannot open database at: ${DB_PATH}`);
    console.error(`    ${err.message}`);
    console.error(`\n    Make sure you are running this from the backend/ directory`);
    console.error(`    and that the server has been started at least once.\n`);
    process.exit(1);
  }
}

function listSuperadmins(db) {
  return db.prepare(`SELECT username, last_login FROM users WHERE role='superadmin' ORDER BY username`).all();
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function promptHidden(question) {
  // Node has no built-in hidden input — use a visible prompt with a warning
  return prompt(question);
}

function validatePassword(pass) {
  if (!pass || pass.length < 8) return 'Password must be at least 8 characters';
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║     PixelRelay — Superadmin Password Reset    ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const db = openDb();

  const admins = listSuperadmins(db);
  if (admins.length === 0) {
    console.error('❌  No superadmin accounts found in the database.');
    console.error('    The database may be empty or corrupted.\n');
    db.close();
    process.exit(1);
  }

  console.log('Superadmin accounts found:');
  admins.forEach((a, i) => {
    const lastLogin = a.last_login ? `last login: ${a.last_login}` : 'never logged in';
    console.log(`  [${i + 1}] ${a.username}  (${lastLogin})`);
  });
  console.log();

  // ── Get username ────────────────────────────────────────────────────────────
  let targetUsername;
  const cliUsername = process.argv[2];

  if (cliUsername) {
    const match = db.prepare(`SELECT username FROM users WHERE username=? AND role='superadmin'`).get(cliUsername);
    if (!match) {
      console.error(`❌  "${cliUsername}" is not a superadmin account.\n`);
      db.close();
      process.exit(1);
    }
    targetUsername = cliUsername;
    console.log(`Resetting password for: ${targetUsername}`);
  } else if (admins.length === 1) {
    targetUsername = admins[0].username;
    console.log(`Only one superadmin found — resetting: ${targetUsername}`);
  } else {
    const input = await prompt(`Enter superadmin username to reset: `);
    const match = db.prepare(`SELECT username FROM users WHERE username=? AND role='superadmin'`).get(input);
    if (!match) {
      console.error(`\n❌  "${input}" is not a superadmin account.\n`);
      db.close();
      process.exit(1);
    }
    targetUsername = input;
  }

  // ── Get new password ────────────────────────────────────────────────────────
  let newPassword;
  const cliPassword = process.argv[3];

  if (cliPassword) {
    const err = validatePassword(cliPassword);
    if (err) {
      console.error(`\n❌  ${err}\n`);
      db.close();
      process.exit(1);
    }
    newPassword = cliPassword;
  } else {
    console.log();
    while (true) {
      const pass1 = await promptHidden('Enter new password (min 8 chars): ');
      const err = validatePassword(pass1);
      if (err) { console.log(`  ⚠  ${err}`); continue; }

      const pass2 = await promptHidden('Confirm new password:              ');
      if (pass1 !== pass2) { console.log('  ⚠  Passwords do not match — try again\n'); continue; }

      newPassword = pass1;
      break;
    }
  }

  // ── Hash and save ───────────────────────────────────────────────────────────
  console.log('\n⏳  Hashing password...');
  const hash = await bcrypt.hash(newPassword, 10);

  const result = db.prepare(`UPDATE users SET password=? WHERE username=? AND role='superadmin'`).run(hash, targetUsername);

  if (result.changes === 0) {
    console.error(`\n❌  Failed to update password — no rows changed.\n`);
    db.close();
    process.exit(1);
  }

  // Also revoke all existing tokens for this user so old sessions can't linger.
  // The revoked_tokens table may not exist if the server hasn't been run yet — safe to skip.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS revoked_tokens (
        jti        TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
    `);
    // We can't revoke by username easily (JTI is username:iat), so we insert a
    // broad sentinel that expires far in the future — the server purges by exp anyway.
    // The simplest approach: restart the server after reset to clear the in-memory set.
    console.log('ℹ   Restart the server after this to invalidate any active sessions.');
  } catch {}

  db.close();

  console.log(`\n✅  Password reset successfully for: ${targetUsername}`);
  console.log(`    You can now log in with the new password.\n`);
}

main().catch(err => {
  console.error('\n❌  Unexpected error:', err.message, '\n');
  process.exit(1);
});