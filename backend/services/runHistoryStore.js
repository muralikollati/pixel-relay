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
    startedAt:       r.started_at,
    finishedAt:      r.finished_at,
    stoppedEarly:    r.stopped_early === 1,
  };
}

const RunHistoryStore = {
  add(email, owner, stats) {
    db.prepare(`
      INSERT INTO run_history (email, owner, emails_processed, pixels_fired, success_rate, spam_rescued, started_at, stopped_early)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      email, owner,
      stats.emailsProcessed || 0,
      stats.pixelsFired     || 0,
      stats.successRate     || 0,
      stats.spamRescued     || 0,
      stats.startedAt       || null,
      stats.stoppedEarly    ? 1 : 0,
    );
  },

  getForAccount(email, limit = 100) {
    const rows = db.prepare(
      'SELECT * FROM run_history WHERE email = ? ORDER BY finished_at DESC LIMIT ?'
    ).all(email, limit).map(rowToRun);
    // Return grouped { email: [...runs] } to match frontend expectation
    return { [email]: rows };
  },

  getForAccounts(emails, limit = 100) {
    if (!emails.length) return {};
    const ph = emails.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT * FROM run_history WHERE email IN (${ph}) ORDER BY finished_at DESC LIMIT ?`
    ).all(...emails, limit).map(rowToRun);

    // Group by email so frontend can do Object.entries(history)
    const grouped = {};
    for (const run of rows) {
      if (!grouped[run.email]) grouped[run.email] = [];
      grouped[run.email].push(run);
    }
    return grouped;
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
    startedAt:       data.startedAt       || null,
    stoppedEarly:    data.stoppedEarly    || false,
  });
};