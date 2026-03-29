const express             = require('express');
const router              = express.Router();
const AccountRequestStore = require('../services/accountRequestStore');
const TokenStore          = require('../services/tokenStore');
const ProfileStore        = require('../services/profileStore');
const { requireAuth, requireRole } = require('../middleware/auth');
const logger              = require('../services/logger');

function enrichRequests(requests) {
  return requests.map(r => {
    let profileName = null;
    if (r.profileId) {
      try {
        const p = ProfileStore.getById(r.profileId);
        profileName = p?.name || null;
      } catch { /* non-fatal */ }
    }
    return { ...r, profileName };
  });
}

router.get('/', requireAuth, (req, res) => {
  const { username, role } = req.user;
  const requests = AccountRequestStore.getAll({ owner: username, role });
  res.json({ success: true, requests: enrichRequests(requests) });
});

router.get('/pending-count', ...requireRole('admin', 'superadmin'), (req, res) => {
  res.json({ success: true, count: AccountRequestStore.pendingCount() });
});

router.post('/:email/approve', ...requireRole('admin', 'superadmin'), (req, res) => {
  const email = decodeURIComponent(req.params.email);
  try {
    const tokenData = AccountRequestStore.approve(email, req.user.username);
    const record    = AccountRequestStore.get(email);
    TokenStore.save(email, tokenData, record.owner, record.profileId);
    logger.info(`Account request approved: ${email} by ${req.user.username}`);
    res.json({ success: true, message: `${email} approved and activated` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/:email/reject', ...requireRole('admin', 'superadmin'), (req, res) => {
  const email  = decodeURIComponent(req.params.email);
  const reason = req.body?.reason || '';
  try {
    AccountRequestStore.reject(email, req.user.username, reason);
    logger.info(`Account request rejected: ${email} by ${req.user.username}`);
    res.json({ success: true, message: `${email} rejected` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/:email/re-request', requireAuth, (req, res) => {
  const email      = decodeURIComponent(req.params.email);
  const { username } = req.user;
  const record     = AccountRequestStore.get(email);
  if (!record) return res.status(404).json({ success: false, error: 'No request found for this account' });
  if (record.owner !== username) return res.status(403).json({ success: false, error: 'Not your request' });
  if (record.status !== 'rejected') return res.status(400).json({ success: false, error: `Request is currently ${record.status} — only rejected requests can be re-submitted` });
  AccountRequestStore.reRequest(email);
  logger.info(`Account re-requested: ${email} by ${username}`);
  res.json({ success: true, message: `${email} re-submitted for approval` });
});

router.post('/approve-all', ...requireRole('admin', 'superadmin'), (req, res) => {
  const pending  = AccountRequestStore.getAll({ status: 'pending', role: req.user.role });
  const approved = [];
  for (const r of pending) {
    try {
      const tokenData = AccountRequestStore.approve(r.email, req.user.username);
      const record    = AccountRequestStore.get(r.email);
      TokenStore.save(r.email, tokenData, record.owner, record.profileId);
      approved.push(r.email);
    } catch (err) {
      logger.warn(`Failed to approve ${r.email}: ${err.message}`);
    }
  }
  logger.info(`Bulk approve: ${approved.length} accounts by ${req.user.username}`);
  res.json({ success: true, approved, count: approved.length });
});

router.post('/approve-user/:username', ...requireRole('admin', 'superadmin'), (req, res) => {
  const targetUser = req.params.username;
  const pending    = AccountRequestStore.getAll({ status: 'pending', role: req.user.role })
    .filter(r => r.owner === targetUser);
  const approved = [];
  for (const r of pending) {
    try {
      const tokenData = AccountRequestStore.approve(r.email, req.user.username);
      const record    = AccountRequestStore.get(r.email);
      TokenStore.save(r.email, tokenData, record.owner, record.profileId);
      approved.push(r.email);
    } catch (err) {
      logger.warn(`Failed to approve ${r.email}: ${err.message}`);
    }
  }
  logger.info(`User approve: ${approved.length} for ${targetUser} by ${req.user.username}`);
  res.json({ success: true, approved, count: approved.length });
});

router.delete('/:email', ...requireRole('admin', 'superadmin'), (req, res) => {
  const email = decodeURIComponent(req.params.email);
  AccountRequestStore.remove(email);
  res.json({ success: true });
});

module.exports = router;