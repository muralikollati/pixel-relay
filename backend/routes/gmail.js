/**
 * Gmail Proxy Routes — thin API wrapper
 *
 * Backend never fires beacons. It only:
 *   1. Exposes Gmail API through authenticated proxy endpoints
 *   2. Receives run results from frontend and saves to TokenStore/ReportStore
 *
 * All actual beacon extraction + firing happens in the user's browser.
 * Trackers see the user's real IP, not the server's IP.
 */

const express    = require('express');
const router     = express.Router();
const { requireAuth } = require('../middleware/auth');
const { collectAllIds, fetchEmailContent, getAuthenticatedClient, markAsRead } = require('../services/gmailFetcher');
const { rescueSpam }   = require('../services/spamRescuer');
const TokenStore       = require('../services/tokenStore');
const ReportStore      = require('../services/reportStore');
const RunHistoryStore  = require('../services/runHistoryStore');
const { getQuotaUsage } = require('../services/rateLimiter');
const logger           = require('../services/logger');

// ── Rescue spam for one account ───────────────────────────────────────────────
router.post('/rescue/:email', requireAuth, async (req, res) => {
  const email = decodeURIComponent(req.params.email);

  // Verify ownership
  const { username, role } = req.user;
  const accounts = TokenStore.getAllForUser(username, role);
  if (!accounts.find(a => a.email === email)) {
    return res.status(403).json({ success: false, error: 'Not authorised' });
  }

  try {
    const rescued = await rescueSpam(email);
    res.json({ success: true, rescued });
  } catch (err) {
    logger.error(`rescueSpam failed for ${email}`, { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Get all unread message IDs for one account ────────────────────────────────
router.get('/unread/:email', requireAuth, async (req, res) => {
  const email = decodeURIComponent(req.params.email);

  const { username, role } = req.user;
  const accounts = TokenStore.getAllForUser(username, role);
  if (!accounts.find(a => a.email === email)) {
    return res.status(403).json({ success: false, error: 'Not authorised' });
  }

  try {
    const ids = await collectAllIds(email);
    res.json({ success: true, ids });
  } catch (err) {
    logger.error(`collectAllIds failed for ${email}`, { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Fetch HTML content for one message ────────────────────────────────────────
router.get('/message/:email/:messageId', requireAuth, async (req, res) => {
  const email     = decodeURIComponent(req.params.email);
  const messageId = req.params.messageId;

  const { username, role } = req.user;
  const accounts = TokenStore.getAllForUser(username, role);
  if (!accounts.find(a => a.email === email)) {
    return res.status(403).json({ success: false, error: 'Not authorised' });
  }

  try {
    const gmail   = await getAuthenticatedClient(email);
    const content = await fetchEmailContent(email, gmail, messageId);
    res.json({ success: true, email: content });
  } catch (err) {
    logger.error(`fetchEmailContent failed ${messageId}`, { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Mark a message as read ────────────────────────────────────────────────────
router.post('/message/:email/:messageId/read', requireAuth, async (req, res) => {
  const email     = decodeURIComponent(req.params.email);
  const messageId = req.params.messageId;

  const { username, role } = req.user;
  const accounts = TokenStore.getAllForUser(username, role);
  if (!accounts.find(a => a.email === email)) {
    return res.status(403).json({ success: false, error: 'Not authorised' });
  }

  try {
    await markAsRead(email, messageId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Receive run report from frontend — save stats ─────────────────────────────
// Called once per account when the frontend finishes processing it
router.post('/report/:email', requireAuth, async (req, res) => {
  const email = decodeURIComponent(req.params.email);

  const { username, role } = req.user;
  const accounts = TokenStore.getAllForUser(username, role);
  if (!accounts.find(a => a.email === email)) {
    return res.status(403).json({ success: false, error: 'Not authorised' });
  }

  const { emailsProcessed, pixelsFired, successRate, spamRescued } = req.body;

  try {
    const account = TokenStore.get(email);
    const prev    = account?.stats || {};
    const rate    = successRate ?? 100;
    const trend   = [...(prev.trend || []).slice(-6), rate];

    TokenStore.updateStats(email, {
      emailsProcessed: (prev.emailsProcessed || 0) + (emailsProcessed || 0),
      pixelsFired:     (prev.pixelsFired     || 0) + (pixelsFired     || 0),
      successRate:     rate,
      trend,
      quotaUsed:       getQuotaUsage(email),
      spamRescued:     (prev.spamRescued || 0) + (spamRescued || 0),
    });

    TokenStore.setStatus(email, rate < 85 ? 'warning' : 'active');

    ReportStore.recordRun(email, {
      emailsProcessed: emailsProcessed || 0,
      successRate:     rate,
      spamRescued:     spamRescued     || 0,
      pixelsFired:     pixelsFired     || 0,
    });

    RunHistoryStore.record(email, {
      startedAt:       req.body.startedAt   || null,
      finishedAt:      new Date().toISOString(),
      emailsProcessed: emailsProcessed || 0,
      pixelsFired:     pixelsFired     || 0,
      successRate:     rate,
      spamRescued:     spamRescued     || 0,
      stoppedEarly:    req.body.stoppedEarly || false,
    });

    logger.info(`Report saved for ${email}`, { emailsProcessed, pixelsFired, rate, spamRescued });
    res.json({ success: true });
  } catch (err) {
    logger.error(`Report save failed for ${email}`, { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
