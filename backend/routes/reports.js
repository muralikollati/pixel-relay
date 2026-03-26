/**
 * Reports Routes
 * GET /reports       — last 7 days of all accounts
 * GET /reports/today — today's snapshot only
 */

const express      = require('express');
const router       = express.Router();
const ReportStore  = require('../services/reportStore');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  try {
    // FIX: Clamp days to a safe range. Previously parseInt() with no bounds allowed
    // negative values, NaN, or huge numbers causing full table scans or empty results.
    const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 365);
    // FIX: Pass username + role so non-admin users only see their own accounts' reports.
    const reports = ReportStore.getReports(days, req.user.username, req.user.role);
    res.json({ success: true, reports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/today', requireAuth, (req, res) => {
  try {
    // FIX: scope today's report to the requesting user's own accounts.
    res.json({ success: true, report: ReportStore.getToday(req.user.username, req.user.role) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;