/**
 * Worker Routes (JWT protected)
 *
 * GET  /worker/stats    — account list + cumulative stats + pendingRequests (admin only)
 * GET  /worker/config   — fetch worker config (all roles)
 * PATCH /worker/config  — update worker config (superadmin only)
 * POST /worker/activity — frontend reports live run status; returns stop signals in response
 * GET  /worker/activity — merged: admins get full map + own scope; users get own scope only
 * GET  /worker/run-history — per-account full run timeline
 * POST /worker/stop-request — admin signals a user's account to stop
 */

const express    = require('express');
const router     = express.Router();
const TokenStore = require('../services/tokenStore');
const ConfigStore = require('../services/configStore');
const { requireAuth, requireRole } = require('../middleware/auth');
const RunHistoryStore = require('../services/runHistoryStore');

// ── In-memory activity map ─────────────────────────────────────────────────────
// { [username]: { running, updatedAt, accounts: [{email, phase, message, done, total}],
//                 completed: [{email, emails, beacons, rate, spam, finishedAt}],
//                 stopRequests: [email, ...] } }
const activityMap = {};

// Purge stale entries older than 30 minutes
function purgeStale() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [user, entry] of Object.entries(activityMap)) {
    if (entry.updatedAt < cutoff) delete activityMap[user];
  }
}

setInterval(purgeStale, 5 * 60 * 1000);

// ── Stats ─────────────────────────────────────────────────────────────────────
// FIX #12: pendingRequests added for admin/superadmin — removes the separate
// /account-requests/pending-count polling loop entirely.
router.get('/stats', requireAuth, (req, res) => {
  try {
    const { username, role } = req.user;
    const accounts = TokenStore.getAllForUser(username, role);
    const active   = accounts.filter(a => a.status === 'active');
    const avgSuccess = active.length
      ? (active.reduce((s, a) => s + (a.stats?.successRate || 0), 0) / active.length).toFixed(1)
      : 0;

    const isAdmin = ['admin', 'superadmin'].includes(role);

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
      // Only compute and expose pendingRequests for admin roles to avoid leaking info
      pendingRequests: isAdmin ? require('../services/accountRequestStore').pendingCount() : 0,
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
// FIX #13: Stop signals are now delivered in the POST response body instead of
// requiring a separate GET /worker/stop-poll endpoint. The frontend reads
// response.data.stopRequests and applies them immediately — same latency (3s
// activity interval) with one less polling loop.
// body: { running, accounts: [{email, phase, message, done, total}],
//         completed: [{email, emails, beacons, rate, spam, finishedAt}] }
router.post('/activity', requireAuth, (req, res) => {
  const { username } = req.user;
  const { running, accounts = [], completed = [] } = req.body;

  if (!activityMap[username]) {
    activityMap[username] = { running: false, accounts: [], completed: [], stopRequests: [], updatedAt: Date.now() };
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

  // Deliver and clear any pending stop requests in the response
  const stopRequests = activityMap[username].stopRequests || [];
  if (stopRequests.length > 0) activityMap[username].stopRequests = [];

  res.json({ success: true, stopRequests });
});

// ── Activity — merged read endpoint (replaces /activity and /activity/my) ─────
// FIX #10: Single endpoint serves all roles:
//   - admin/superadmin: receives full activityMap + own scoped myActivity
//   - regular users: receives empty activity map + own scoped myActivity
// This eliminates the separate /worker/activity/my polling loop for admins,
// saving ~40 requests/min per admin user.
router.get('/activity', requireAuth, (req, res) => {
  purgeStale();
  const { username, role } = req.user;
  const isAdmin = ['admin', 'superadmin'].includes(role);

  // Build scoped activity for the current user's own accounts
  const myAccounts = TokenStore.getAllForUser(username, role);
  const myEmails   = new Set(myAccounts.map(a => a.email));
  const myActivity = [];
  let anyRunning = false;

  for (const [runnerUsername, entry] of Object.entries(activityMap)) {
    if (!entry.running) continue;
    for (const acc of entry.accounts || []) {
      if (myEmails.has(acc.email)) {
        anyRunning = true;
        myActivity.push({ ...acc, runBy: runnerUsername });
      }
    }
  }

  res.json({
    success:    true,
    // Full map only for admins; empty object for regular users
    activity:   isAdmin ? activityMap : {},
    // Scoped to current user's accounts for everyone
    myActivity: { running: anyRunning, accounts: myActivity },
  });
});

// ── Run history — per-account timeline of all past runs ───────────────────────
router.get('/run-history', requireAuth, (req, res) => {
  const { username, role } = req.user;
  const email = req.query.email ? decodeURIComponent(req.query.email) : null;
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);

  if (email) {
    const accounts = TokenStore.getAllForUser(username, role);
    if (!accounts.find(a => a.email === email)) {
      return res.status(403).json({ success: false, error: 'Not authorised' });
    }
    return res.json({ success: true, history: RunHistoryStore.getForAccount(email, limit) });
  }

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

module.exports = router;