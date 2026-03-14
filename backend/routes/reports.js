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
    const reports = ReportStore.getReports(days);
    res.json({ success: true, reports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/today', requireAuth, (req, res) => {
  try {
    res.json({ success: true, report: ReportStore.getToday() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
