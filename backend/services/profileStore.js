/**
 * ProfileStore — per-user workspace profiles backed by SQLite.
 *
 * Each user can have up to maxProfilesPerUser profiles (default 5, configurable).
 * Every profile gets its own 20-account cap.
 * Accounts and account_requests are scoped to a profile_id.
 */
const { db } = require('./db');

function rowToProfile(row) {
  if (!row) return null;
  return {
    id:         row.id,
    username:   row.username,
    name:       row.profile_name,
    isDefault:  !!row.is_default,
    createdAt:  row.created_at,
  };
}

const ProfileStore = {
  // ── Ensure a default profile exists, returning its id ──────────────────────
  ensureDefault(username) {
    let row = db.prepare(
      "SELECT * FROM profiles WHERE username=? AND is_default=1"
    ).get(username);
    if (row) return rowToProfile(row);

    db.prepare(
      `INSERT OR IGNORE INTO profiles (username, profile_name, is_default)
       VALUES (?, 'Default', 1)`
    ).run(username);

    row = db.prepare(
      "SELECT * FROM profiles WHERE username=? AND is_default=1"
    ).get(username);
    return rowToProfile(row);
  },

  // ── List all profiles for a user ───────────────────────────────────────────
  listForUser(username) {
    return db.prepare(
      "SELECT * FROM profiles WHERE username=? ORDER BY is_default DESC, created_at ASC"
    ).all(username).map(rowToProfile);
  },

  // ── Get a single profile by id (with ownership check) ─────────────────────
  get(id, username) {
    const row = db.prepare(
      "SELECT * FROM profiles WHERE id=? AND username=?"
    ).get(id, username);
    return rowToProfile(row);
  },

  // ── Get profile by id only (used internally) ──────────────────────────────
  getById(id) {
    return rowToProfile(db.prepare("SELECT * FROM profiles WHERE id=?").get(id));
  },

  // ── Create a new profile ───────────────────────────────────────────────────
  create(username, name, maxProfiles = 5) {
    const count = db.prepare(
      "SELECT COUNT(*) as c FROM profiles WHERE username=?"
    ).get(username).c;
    if (count >= maxProfiles) {
      throw new Error(`Profile limit reached (max ${maxProfiles})`);
    }
    const existing = db.prepare(
      "SELECT id FROM profiles WHERE username=? AND profile_name=?"
    ).get(username, name);
    if (existing) throw new Error(`A profile named "${name}" already exists`);

    const result = db.prepare(
      `INSERT INTO profiles (username, profile_name, is_default) VALUES (?, ?, 0)`
    ).run(username, name);
    return rowToProfile(db.prepare("SELECT * FROM profiles WHERE id=?").get(result.lastInsertRowid));
  },

  // ── Rename a profile ───────────────────────────────────────────────────────
  rename(id, username, newName) {
    const existing = db.prepare(
      "SELECT id FROM profiles WHERE username=? AND profile_name=? AND id != ?"
    ).get(username, newName, id);
    if (existing) throw new Error(`A profile named "${newName}" already exists`);

    db.prepare(
      "UPDATE profiles SET profile_name=? WHERE id=? AND username=?"
    ).run(newName, id, username);
    return this.get(id, username);
  },

  // ── Delete a profile (cannot delete default if other profiles exist) ────────
  delete(id, username) {
    const profile = this.get(id, username);
    if (!profile) throw new Error('Profile not found');

    const allProfiles = this.listForUser(username);
    if (profile.isDefault && allProfiles.length > 1) {
      throw new Error('Cannot delete the default profile while other profiles exist. Switch the default first.');
    }

    // Disown accounts (set profile_id to the default profile, or NULL)
    const defaultProfile = allProfiles.find(p => p.isDefault && p.id !== id);
    if (defaultProfile) {
      db.prepare(
        "UPDATE accounts SET profile_id=? WHERE profile_id=?"
      ).run(defaultProfile.id, id);
      db.prepare(
        "UPDATE account_requests SET profile_id=? WHERE profile_id=?"
      ).run(defaultProfile.id, id);
    } else {
      db.prepare("UPDATE accounts SET profile_id=NULL WHERE profile_id=?").run(id);
      db.prepare("UPDATE account_requests SET profile_id=NULL WHERE profile_id=?").run(id);
    }

    db.prepare("DELETE FROM profiles WHERE id=? AND username=?").run(id, username);
  },

  // ── Set a profile as the new default ──────────────────────────────────────
  setDefault(id, username) {
    const profile = this.get(id, username);
    if (!profile) throw new Error('Profile not found');
    db.transaction(() => {
      db.prepare("UPDATE profiles SET is_default=0 WHERE username=?").run(username);
      db.prepare("UPDATE profiles SET is_default=1 WHERE id=? AND username=?").run(id, username);
    })();
    return this.get(id, username);
  },

  // ── Count profiles per user (for admin display) ───────────────────────────
  countForUser(username) {
    return db.prepare("SELECT COUNT(*) as c FROM profiles WHERE username=?").get(username).c;
  },
};

module.exports = ProfileStore;
