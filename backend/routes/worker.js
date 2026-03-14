/**
 * Worker Routes (JWT protected)
 *
 * GET  /worker/stats    — account list + cumulative stats (all roles)
 * GET  /worker/config   — fetch worker config (all roles)
 * PATCH /worker/config  — update worker config (superadmin only)
 * POST /worker/activity — frontend reports live run status (all roles)
 * GET  /worker/activity — admin/superadmin see all active + completed runs
 */

const express    = require('express');
const router     = express.Router();
const TokenStore = require('../services/tokenStore');
const ConfigStore = require('../services/configStore');
const { requireAuth, requireRole } = require('../middleware/auth');
const RunHistoryStore = require('../services/runHistoryStore');

// ── In-memory activity map ─────────────────────────────────────────────────────
// { [username]: { running, updatedAt, accounts: [{email, phase, message, done, total}],
//                 completed: [{email, emails, beacons, rate, spam, finishedAt}] } }
const activityMap = {};

// Purge stale entries older than 30 minutes
function purgeStale() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [user, entry] of Object.entries(activityMap)) {
    if (entry.updatedAt < cutoff) delete activityMap[user];
  }
}

// FIX: Run purge on a scheduled interval so the activityMap doesn't grow
// unbounded if GET /worker/activity is never polled (e.g. no admin tab open).
setInterval(purgeStale, 5 * 60 * 1000);

// ── Stats ─────────────────────────────────────────────────────────────────────
router.get('/stats', requireAuth, (req, res) => {
  try {
    const { username, role } = req.user;
    const accounts = TokenStore.getAllForUser(username, role);
    const active   = accounts.filter(a => a.status === 'active');
    const avgSuccess = active.length
      ? (active.reduce((s, a) => s + (a.stats?.successRate || 0), 0) / active.length).toFixed(1)
      : 0;

    res.json({
      success: true,
      summary: {
        totalAccounts:  accounts.length,
        activeAccounts: active.length,
        avgSuccessRate: parseFloat(avgSuccess),
        totalEmails:    accounts.reduce((s, a) => s + (a.stats?.emailsProcessed || 0), 0),
        totalBeacons:   accounts.reduce((s, a) => s + (a.stats?.pixelsFired     || 0), 0),
        warnings:       accounts.filter(a => ['warning', 'error'].includes(a.status)).length,
      },
      accounts,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Config ────────────────────────────────────────────────────────────────────
router.get('/config', requireAuth, (req, res) => {
  res.json({ success: true, config: ConfigStore.get() });
});

router.patch('/config', ...requireRole('superadmin'), (req, res) => {
  try {
    const updated = ConfigStore.update(req.body);
    res.json({ success: true, config: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Activity — frontend reports live run status ───────────────────────────────
// body: { running, accounts: [{email, phase, message, done, total}],
//         completed: [{email, emails, beacons, rate, spam, finishedAt}] }
router.post('/activity', requireAuth, (req, res) => {
  const { username } = req.user;
  const { running, accounts = [], completed = [] } = req.body;

  if (!activityMap[username]) {
    activityMap[username] = { running: false, accounts: [], completed: [], updatedAt: Date.now() };
  }

  activityMap[username].running   = running;
  activityMap[username].updatedAt = Date.now();

  if (accounts.length > 0) activityMap[username].accounts = accounts;

  // Append newly completed runs (avoid duplicates by finishedAt key)
  if (completed.length > 0) {
    const existing = new Set(activityMap[username].completed.map(c => c.finishedAt + c.email));
    for (const c of completed) {
      if (!existing.has(c.finishedAt + c.email)) {
        activityMap[username].completed.push(c);
      }
    }
    // Keep last 50 completed per user
    activityMap[username].completed = activityMap[username].completed.slice(-50);
  }

  if (!running) activityMap[username].accounts = [];

  res.json({ success: true });
});

// ── Activity — all-users read (admin/superadmin only) ────────────────────────
router.get('/activity', ...requireRole('admin', 'superadmin'), (req, res) => {
  purgeStale();
  res.json({ success: true, activity: activityMap });
});

// ── Activity — scoped to accounts the current user can see ───────────────────
// Used by regular users to see live progress on their own accounts,
// even when those accounts are being run by an admin session.
router.get('/activity/my', requireAuth, (req, res) => {
  purgeStale();
  const { username, role } = req.user;

  // Get the set of emails this user is allowed to see
  const myAccounts = TokenStore.getAllForUser(username, role);
  const myEmails   = new Set(myAccounts.map(a => a.email));

  // Flatten all activity across all users, keeping only accounts this user can see
  const myActivity = [];
  let anyRunning = false;

  for (const [runnerUsername, entry] of Object.entries(activityMap)) {
    if (!entry.running) continue;
    for (const acc of entry.accounts || []) {
      if (myEmails.has(acc.email)) {
        anyRunning = true;
        myActivity.push({
          ...acc,
          runBy: runnerUsername,  // who is running it
        });
      }
    }
  }

  res.json({ success: true, running: anyRunning, accounts: myActivity });
});

// ── Run history — per-account timeline of all past runs ───────────────────────
// GET /worker/run-history?email=x@y.com&limit=100
router.get('/run-history', requireAuth, (req, res) => {
  const { username, role } = req.user;
  const email = req.query.email ? decodeURIComponent(req.query.email) : null;
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);

  // Verify access
  if (email) {
    const accounts = TokenStore.getAllForUser(username, role);
    if (!accounts.find(a => a.email === email)) {
      return res.status(403).json({ success: false, error: 'Not authorised' });
    }
    return res.json({ success: true, history: RunHistoryStore.getForAccount(email, limit) });
  }

  // Admin/superadmin: get history for all their accounts
  const accounts = TokenStore.getAllForUser(username, role);
  const emails   = accounts.map(a => a.email);
  res.json({ success: true, history: RunHistoryStore.getForAccounts(emails, limit) });
});


// ── Admin stop-request — signal a user's account to stop ─────────────────────
router.post('/stop-request', ...requireRole('admin', 'superadmin'), (req, res) => {
  const { targetUser, email } = req.body;
  if (!targetUser || !email) return res.status(400).json({ error: 'targetUser and email required' });
  if (!activityMap[targetUser]) {
    activityMap[targetUser] = { running: false, accounts: [], completed: [], stopRequests: [], updatedAt: Date.now() };
  }
  if (!activityMap[targetUser].stopRequests) activityMap[targetUser].stopRequests = [];
  if (!activityMap[targetUser].stopRequests.includes(email))
    activityMap[targetUser].stopRequests.push(email);
  res.json({ success: true });
});

// ── Stop-poll — user checks if admin requested a stop ─────────────────────────
router.get('/stop-poll', requireAuth, (req, res) => {
  const { username } = req.user;
  const entry = activityMap[username];
  if (!entry?.stopRequests?.length) return res.json({ success: true, stopRequests: [] });
  const requests = [...entry.stopRequests];
  activityMap[username].stopRequests = [];  // clear after delivery
  res.json({ success: true, stopRequests: requests });
});

module.exports = router;
