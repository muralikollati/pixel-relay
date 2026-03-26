/**
 * Google OAuth2 Service
 * Handles: auth URL generation, code exchange, token refresh, Gmail client creation
 */

const { google } = require('googleapis');
require('dotenv').config();

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Detect whether an error is an invalid_grant / token-revoked error.
 * Google surfaces this in different ways depending on the library version:
 *   - err.message includes 'invalid_grant'
 *   - err.response.data.error === 'invalid_grant'
 */
function isInvalidGrant(err) {
  if (!err) return false;
  if (err.code === 'INVALID_GRANT') return true;
  if (typeof err.message === 'string' && err.message.toLowerCase().includes('invalid_grant')) return true;
  if (err.response?.data?.error === 'invalid_grant') return true;
  return false;
}

/**
 * Per-email refresh mutex.
 *
 * ROOT CAUSE of premature invalid_grant (happens in < 7 days):
 *   useWorker fires a batch of 5 messages concurrently via Promise.allSettled().
 *   Each concurrent request hits the backend, each calls getAuthenticatedClient(),
 *   each creates a new OAuth client, reads the SAME expired token from the DB,
 *   and all 5 simultaneously call refreshAccessToken().
 *
 *   Google processes the FIRST refresh and invalidates the old refresh_token.
 *   The remaining 4 requests try to refresh with the now-dead token → invalid_grant.
 *
 * Fix: serialize all refresh operations per email using a promise-based mutex.
 *   Only one refresh runs at a time per email. Others wait and re-read the
 *   freshly stored token from the DB instead of performing a second refresh.
 */
const refreshLocks = new Map(); // email → Promise

async function withRefreshLock(email, fn) {
  // Wait for any in-progress refresh for this email to finish first
  while (refreshLocks.has(email)) {
    await refreshLocks.get(email);
  }
  // Now hold the lock ourselves
  let resolve;
  const lock = new Promise(r => { resolve = r; });
  refreshLocks.set(email, lock);
  try {
    return await fn();
  } finally {
    refreshLocks.delete(email);
    resolve();
  }
}

/**
 * Generate the Google OAuth consent URL.
 * access_type=offline ensures we get a refresh_token.
 */
function getAuthUrl(statePayload) {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type:            'offline',
    scope:                  SCOPES,
    prompt:                 'consent',
    include_granted_scopes: true,
    state:                  statePayload || '',
  });
}

/**
 * Exchange an authorization code for tokens.
 * Returns: { access_token, refresh_token, expiry_date, token_type, scope }
 */
async function exchangeCode(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Fetch the Gmail address linked to this token
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();

  return {
    ...tokens,
    email:        data.email,
    displayName:  data.name,
    picture:      data.picture,
  };
}

/**
 * Create an authenticated Gmail API client for a stored account.
 *
 * FIX — concurrent refresh race condition:
 *   When a batch of requests arrives for the same account simultaneously,
 *   all of them would read the same expired token and race to refresh it.
 *   Google invalidates the old refresh token on first use, so all subsequent
 *   parallel refreshes get invalid_grant even though the account is fine.
 *
 *   Solution: the refresh is wrapped in a per-email mutex. If a refresh is
 *   already in flight for this email, subsequent callers wait for it to finish,
 *   then re-read the now-fresh token from the DB instead of refreshing again.
 *
 * @param {object} tokenData  - token record (may be stale if another request
 *                              already refreshed while we were waiting)
 * @param {function} onRefresh - callback(newTokens) to persist refreshed tokens
 * @param {string} email       - used as the mutex key; pass it explicitly so
 *                              the lock works across concurrent callers
 */
async function getGmailClient(tokenData, onRefresh, email) {
  const FIVE_MIN = 5 * 60 * 1000;
  const needsRefresh = !tokenData.expiry_date || (tokenData.expiry_date - Date.now()) < FIVE_MIN;

  if (needsRefresh && tokenData.refresh_token) {
    // Use the mutex to ensure only one concurrent refresh per email.
    // All other callers wait, then skip the refresh (their onRefresh re-reads
    // the fresh token from the DB before making API calls).
    await withRefreshLock(email || tokenData.email || '_unknown', async () => {
      // Re-check after acquiring lock — another waiter may have already refreshed
      const TokenStore = require('./tokenStore');
      const fresh = email ? TokenStore.getWithTokens(email) : null;
      const freshExpiry = fresh?.expiry_date || tokenData.expiry_date;
      const stillNeedsRefresh = !freshExpiry || (freshExpiry - Date.now()) < FIVE_MIN;

      if (!stillNeedsRefresh) {
        // Another concurrent caller already refreshed — use their fresh token
        if (fresh) {
          tokenData.access_token  = fresh.access_token;
          tokenData.expiry_date   = fresh.expiry_date;
          if (fresh.refresh_token) tokenData.refresh_token = fresh.refresh_token;
        }
        return;
      }

      const client = createOAuthClient();
      client.setCredentials({
        access_token:  tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expiry_date:   tokenData.expiry_date,
      });

      try {
        const { credentials } = await client.refreshAccessToken();
        // Persist immediately so waiting callers get the fresh token from DB
        if (onRefresh) onRefresh(credentials);
        // Update local tokenData so this call also uses the fresh token
        tokenData.access_token  = credentials.access_token;
        tokenData.expiry_date   = credentials.expiry_date;
        if (credentials.refresh_token) tokenData.refresh_token = credentials.refresh_token;
      } catch (err) {
        if (isInvalidGrant(err)) {
          const tagged = new Error(
            'Gmail access token has been revoked or expired. The account needs to be reconnected.'
          );
          tagged.code = 'INVALID_GRANT';
          throw tagged;
        }
        const logger = require('./logger');
        logger.warn(`[GoogleAuth] Proactive refresh failed (non-fatal): ${err.message}`);
      }
    });
  }

  const client = createOAuthClient();
  client.setCredentials({
    access_token:  tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expiry_date:   tokenData.expiry_date,
  });

  // Auto-refresh listener — persists new tokens back to store for the
  // lifetime of this client instance (covers lazy refreshes mid-call).
  client.on('tokens', (newTokens) => {
    if (onRefresh) onRefresh(newTokens);
  });

  return google.gmail({ version: 'v1', auth: client });
}

/**
 * Manually refresh an access token using its refresh_token.
 */
async function refreshToken(refreshTokenVal) {
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshTokenVal });
  const { credentials } = await client.refreshAccessToken();
  return credentials;
}

module.exports = { getAuthUrl, exchangeCode, getGmailClient, refreshToken, createOAuthClient, isInvalidGrant };