/**
 * RunHistoryStore — individual run records backed by SQLite.
 */
const { db } = require('./db');

function rowToRun(r) {
  return {
    id:              r.id,
    email:           r.email,
    owner:           r.owner,
    emailsProcessed: r.emails_processed,
    pixelsFired:     r.pixels_fired,
    successRate:     r.success_rate,
    spamRescued:     r.spam_rescued,
    finishedAt:      r.finished_at,
  };
}

const RunHistoryStore = {
  add(email, owner, stats) {
    db.prepare(`
      INSERT INTO run_history (email, owner, emails_processed, pixels_fired, success_rate, spam_rescued)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(email, owner, stats.emailsProcessed || 0, stats.pixelsFired || 0, stats.successRate || 0, stats.spamRescued || 0);
  },

  getForAccount(email, limit = 100) {
    return db.prepare(
      'SELECT * FROM run_history WHERE email = ? ORDER BY finished_at DESC LIMIT ?'
    ).all(email, limit).map(rowToRun);
  },

  getForAccounts(emails, limit = 100) {
    if (!emails.length) return [];
    const ph = emails.map(() => '?').join(',');
    return db.prepare(
      `SELECT * FROM run_history WHERE email IN (${ph}) ORDER BY finished_at DESC LIMIT ?`
    ).all(...emails, limit).map(rowToRun);
  },

  getRecent(limit = 30) {
    return db.prepare(
      'SELECT * FROM run_history ORDER BY finished_at DESC LIMIT ?'
    ).all(limit).map(rowToRun);
  },
};

module.exports = RunHistoryStore;

// Alias used by gmail route
RunHistoryStore.record = function(email, data) {
  const row = db.prepare('SELECT owner FROM accounts WHERE email = ?').get(email);
  RunHistoryStore.add(email, row?.owner || '', {
    emailsProcessed: data.emailsProcessed || 0,
    pixelsFired:     data.pixelsFired     || 0,
    successRate:     data.successRate     || 0,
    spamRescued:     data.spamRescued     || 0,
  });
};
