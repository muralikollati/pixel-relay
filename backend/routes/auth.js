/**
 * Gmail OAuth Routes
 *
 * POST /auth/google/init       — generate consent URL, encode username in state param
 * GET  /auth/google/callback   — exchange code, read owner from state (no cookie dependency)
 * GET  /auth/accounts          — list approved accounts for current user
 * DELETE /auth/accounts/:email — disconnect account
 * PATCH  /auth/accounts/:email/status — pause / resume
 */

const express    = require('express');
const router     = express.Router();
const { getAuthUrl, exchangeCode } = require('../services/googleAuth');
const TokenStore = require('../services/tokenStore');
const AccountRequestStore = require('../services/accountRequestStore');
const ProfileStore = require('../services/profileStore');
const logger     = require('../services/logger');
const { requireAuth, requirePermission } = require('../middleware/auth');
const UserStore   = require('../services/userStore');
const crypto     = require('crypto');

// Simple signing so the state can't be forged (username:profileId:sig)
const STATE_SECRET = process.env.JWT_SECRET || 'pixelrelay-secret-change-in-production';

function signState(username, profileId) {
  const payload = `${username}:${profileId || ''}`;
  const sig = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('hex').slice(0, 16);
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function verifyState(state) {
  try {
    if (!state) return null;
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    const parts   = decoded.split(':');
    if (parts.length < 2) return null;
    const sig      = parts[parts.length - 1];
    const profileId = parts.length >= 3 ? parts[parts.length - 2] : '';
    const username  = parts.slice(0, parts.length - 2).join(':'); // handle colons in username
    const payload  = `${username}:${profileId}`;
    const expected = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('hex').slice(0, 16);
    if (sig !== expected) return null;
    return { username, profileId: profileId ? parseInt(profileId) : null };
  } catch {
    return null;
  }
}

// POST /auth/google/init
// requirePermission handles admin/superadmin bypass + live permission check for users
router.post('/google/init', ...requirePermission('canConnectAccounts'), (req, res) => {
  try {
    // Prefer explicitly passed profileId from request body over JWT activeProfileId.
    // This ensures the correct profile is used when called from any page.
    const profileId = req.body?.profileId || req.user.activeProfileId || null;
    const state = signState(req.user.username, profileId);
    const url   = getAuthUrl(state);
    res.json({ success: true, url });
  } catch (err) {
    logger.error('Failed to generate auth URL', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to start OAuth flow' });
  }
});

// GET /auth/google/callback — called by Google after user grants consent
router.get('/google/callback', async (req, res) => {
  const { code, error, state } = req.query;

  // FIX: Guard FRONTEND_URL — without it every redirect goes to "undefined/..."
  // which the browser treats as a relative path and the frontend never sees the params.
  const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (error || !code) {
    logger.warn('OAuth callback error', { error });
    return res.redirect(`${FRONTEND}/?error=${encodeURIComponent(error || 'no_code')}`);
  }

  try {
    const tokenData = await exchangeCode(code);
    if (!tokenData.email) throw new Error('Could not retrieve email from Google');

    // Recover the owner and profileId from the signed state param
    const stateData = verifyState(state);
    const owner     = stateData?.username || 'admin';
    const profileId = stateData?.profileId || null;
    logger.info(`OAuth callback: email=${tokenData.email}, owner=${owner}, profileId=${profileId}`);

    // If this Gmail is already an active approved account, just refresh its token
    const existing = TokenStore.get(tokenData.email);
    if (existing) {
      TokenStore.save(tokenData.email, tokenData, existing.owner || owner, existing.profileId || profileId);
      logger.info(`Token refreshed: ${tokenData.email}`);
      return res.redirect(`${FRONTEND}/?connected=${encodeURIComponent(tokenData.email)}`);
    }

    // Check if the owner is admin/superadmin — if so, skip approval queue entirely
    const ownerUser = UserStore.getUser(owner);
    const ownerRole = ownerUser?.role || 'user';

    // Resolve which profile to add the account to
    const resolvedProfileId = profileId || (() => {
      try { return ProfileStore.ensureDefault(owner)?.id || null; } catch { return null; }
    })();

    // Cap check: approved accounts + pending requests for this profile combined.
    // This prevents users from bypassing the cap by flooding the request queue
    // before any are approved.
    const maxAccountsPerUser = require('../services/configStore').get().maxAccountsPerUser || 20;
    const AccountRequestStore = require('../services/accountRequestStore');

    const approvedCount = resolvedProfileId
      ? TokenStore.countForProfile(resolvedProfileId)
      : TokenStore.getAll().filter(a => a.owner === owner).length;

    const pendingCount = resolvedProfileId
      ? AccountRequestStore.countActiveForProfile(resolvedProfileId)
      : AccountRequestStore.countPendingForOwner(owner);

    const totalCount = approvedCount + pendingCount;

    if (totalCount >= maxAccountsPerUser) {
      logger.warn(`Account cap reached for ${owner} profile ${resolvedProfileId}: ${approvedCount} approved + ${pendingCount} pending = ${totalCount}/${maxAccountsPerUser}`);
      return res.redirect(`${FRONTEND}/?error=account_limit_reached`);
    }

    if (['admin', 'superadmin'].includes(ownerRole)) {
      TokenStore.save(tokenData.email, tokenData, owner, resolvedProfileId);
      logger.info(`Account connected directly (admin): ${tokenData.email} (owner: ${owner}, profile: ${resolvedProfileId})`);
      return res.redirect(`${FRONTEND}/?connected=${encodeURIComponent(tokenData.email)}`);
    }

    // Regular user — create a pending request awaiting admin approval.
    try {
      AccountRequestStore.create(tokenData.email, tokenData, owner, resolvedProfileId);
      logger.info(`Account request created: ${tokenData.email} (owner: ${owner}, profile: ${resolvedProfileId})`);
      return res.redirect(`${FRONTEND}/?pending=${encodeURIComponent(tokenData.email)}`);
    } catch (storeErr) {
      logger.error('Failed to create account request', { email: tokenData.email, error: storeErr.message });
      return res.redirect(`${FRONTEND}/?error=request_create_failed`);
    }

  } catch (err) {
    logger.error('OAuth callback failed', { error: err.message });
    res.redirect(`${FRONTEND}/?error=token_exchange_failed`);
  }
});

// GET /auth/accounts — list approved accounts visible to the current user
router.get('/accounts', requireAuth, (req, res) => {
  try {
    const { username, role, activeProfileId } = req.user;
    const isAdmin = ['admin', 'superadmin'].includes(role);
    let accounts;
    if (isAdmin) {
      accounts = TokenStore.getAllForUser(username, role);
    } else if (activeProfileId) {
      accounts = TokenStore.getAllForProfile(activeProfileId);
    } else {
      accounts = TokenStore.getAllForUser(username, role);
    }
    res.json({ success: true, accounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /auth/accounts/:email — disconnect an account
router.delete('/accounts/:email', ...requirePermission('canDeleteAccounts'), (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);

    // Ownership check: users can only delete their own accounts
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      const account = TokenStore.get(email);
      if (!account || account.owner !== req.user.username) {
        return res.status(403).json({ success: false, error: 'Not your account' });
      }
    }

    TokenStore.remove(email);
    AccountRequestStore.remove(email);
    logger.info(`Account disconnected: ${email} by ${req.user.username}`);
    res.json({ success: true, message: `${email} disconnected` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /auth/accounts/:email/status — pause or resume
router.patch('/accounts/:email/status', ...requirePermission('canRunWorker'), (req, res) => {
  try {
    const email    = decodeURIComponent(req.params.email);
    const { status } = req.body;
    if (!['active', 'paused'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status. Use active or paused.' });
    }

    // Ownership check for users
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      const account = TokenStore.get(email);
      if (!account || account.owner !== req.user.username) {
        return res.status(403).json({ success: false, error: 'Not your account' });
      }
    }

    TokenStore.setStatus(email, status);
    res.json({ success: true, email, status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;