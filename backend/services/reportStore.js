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

  getReports(days = 7) {
    const rows = db.prepare(`SELECT * FROM reports WHERE date >= date('now','-${days} days') ORDER BY date,email`).all();
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

  getToday() {
    const rows = db.prepare('SELECT * FROM reports WHERE date=?').all(today());
    const out  = {};
    for (const r of rows) out[r.email] = {
      emailsProcessed: r.emails_processed, successRate: r.success_rate,
      spamRescued: r.spam_rescued, pixelsFired: r.pixels_fired, runCount: r.run_count,
    };
    return out;
  },
};

module.exports = ReportStore;
