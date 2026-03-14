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
const logger     = require('../services/logger');
const { requireAuth, requirePermission } = require('../middleware/auth');
const UserStore  = require('../services/userStore');
const crypto     = require('crypto');

// Simple signing so the state can't be forged (username:sig)
const STATE_SECRET = process.env.JWT_SECRET || 'pixelrelay-secret-change-in-production';

function signState(username) {
  const sig = crypto.createHmac('sha256', STATE_SECRET).update(username).digest('hex').slice(0, 16);
  return Buffer.from(`${username}:${sig}`).toString('base64url');
}

function verifyState(state) {
  try {
    if (!state) return null;
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    const colon   = decoded.lastIndexOf(':');
    if (colon < 0) return null;
    const username = decoded.slice(0, colon);
    const sig      = decoded.slice(colon + 1);
    const expected = crypto.createHmac('sha256', STATE_SECRET).update(username).digest('hex').slice(0, 16);
    if (sig !== expected) return null;
    return username;
  } catch {
    return null;
  }
}

// POST /auth/google/init
// requirePermission handles admin/superadmin bypass + live permission check for users
router.post('/google/init', ...requirePermission('canConnectAccounts'), (req, res) => {
  try {
    // Encode username in the state param — survives the Google redirect regardless of browser/cookie
    const state = signState(req.user.username);
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

    // Recover the owner from the signed state param — fallback to 'admin' if missing/invalid
    const owner = verifyState(state) || 'admin';
    logger.info(`OAuth callback: email=${tokenData.email}, owner=${owner}`);

    // If this Gmail is already an active approved account, just refresh its token
    const existing = TokenStore.get(tokenData.email);
    if (existing) {
      TokenStore.save(tokenData.email, tokenData, existing.owner || owner);
      logger.info(`Token refreshed: ${tokenData.email}`);
      return res.redirect(`${FRONTEND}/?connected=${encodeURIComponent(tokenData.email)}`);
    }

    // Check if the owner is admin/superadmin — if so, skip approval queue entirely
    const ownerUser = UserStore.getUser(owner);
    const ownerRole = ownerUser?.role || 'user';
    if (['admin', 'superadmin'].includes(ownerRole)) {
      TokenStore.save(tokenData.email, tokenData, owner);
      logger.info(`Account connected directly (admin): ${tokenData.email} (owner: ${owner})`);
      return res.redirect(`${FRONTEND}/?connected=${encodeURIComponent(tokenData.email)}`);
    }

    // Regular user — create a pending request awaiting admin approval.
    // FIX: Wrapped in its own try/catch so a DB error here redirects with a clear
    // "request_create_failed" code instead of "token_exchange_failed" which wrongly
    // implies something went wrong with Google — making the error very hard to diagnose.
    try {
      AccountRequestStore.create(tokenData.email, tokenData, owner);
      logger.info(`Account request created: ${tokenData.email} (owner: ${owner})`);
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
    const accounts = TokenStore.getAllForUser(req.user.username, req.user.role);
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
