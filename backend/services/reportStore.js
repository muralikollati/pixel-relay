const { db } = require('./db');

function today() { return new Date().toISOString().slice(0,10); }

const ReportStore = {
  recordRun(email, { emailsProcessed, successRate, spamRescued, pixelsFired }) {
    const ep = emailsProcessed||0, sr = successRate||0,
          sp = spamRescued||0,    pf = pixelsFired||0;
    const existing = db.prepare('SELECT * FROM reports WHERE date=? AND email=?').get(today(), email);
    if (!existing) {
      db.prepare('INSERT INTO reports (date,email,emails_processed,success_rate,spam_rescued,pixels_fired,run_count) VALUES (?,?,?,?,?,?,1)')
        .run(today(), email, ep, sr, sp, pf);
    } else {
      const rc  = existing.run_count + 1;
      const avg = +((existing.success_rate * existing.run_count + sr) / rc).toFixed(1);
      db.prepare('UPDATE reports SET emails_processed=?,success_rate=?,spam_rescued=?,pixels_fired=?,run_count=? WHERE date=? AND email=?')
        .run(existing.emails_processed+ep, avg, existing.spam_rescued+sp, existing.pixels_fired+pf, rc, today(), email);
    }
    // Purge older than 7 days
    db.prepare("DELETE FROM reports WHERE date < date('now','-7 days')").run();
  },

  getReports(days = 7, username = null, role = 'user') {
    const isAdmin = ['admin', 'superadmin'].includes(role);
    let rows;
    if (isAdmin) {
      rows = db.prepare(
        `SELECT * FROM reports WHERE date >= date('now','-${days} days') ORDER BY date,email`
      ).all();
    } else {
      // FIX: Join against accounts table so only the requesting user's own
      // accounts are returned. Without this, ALL accounts' reports were exposed
      // to every authenticated user regardless of ownership.
      rows = db.prepare(
        `SELECT r.* FROM reports r
         INNER JOIN accounts a ON a.email = r.email AND a.owner = ?
         WHERE r.date >= date('now','-${days} days')
         ORDER BY r.date, r.email`
      ).all(username);
    }
    const out  = {};
    for (const r of rows) {
      if (!out[r.date]) out[r.date] = {};
      out[r.date][r.email] = {
        emailsProcessed: r.emails_processed, successRate: r.success_rate,
        spamRescued: r.spam_rescued, pixelsFired: r.pixels_fired, runCount: r.run_count,
      };
    }
    return out;
  },

  getToday(username = null, role = 'user') {
    const isAdmin = ['admin', 'superadmin'].includes(role);
    let rows;
    if (isAdmin) {
      rows = db.prepare('SELECT * FROM reports WHERE date=?').all(today());
    } else {
      // FIX: same ownership scope as getReports above.
      rows = db.prepare(
        `SELECT r.* FROM reports r
         INNER JOIN accounts a ON a.email = r.email AND a.owner = ?
         WHERE r.date = ?`
      ).all(username, today());
    }
    const out  = {};
    for (const r of rows) out[r.email] = {
      emailsProcessed: r.emails_processed, successRate: r.success_rate,
      spamRescued: r.spam_rescued, pixelsFired: r.pixels_fired, runCount: r.run_count,
    };
    return out;
  },
};

module.exports = ReportStore;