/**
 * tokenHealthService.js — Background token refresh & health monitoring
 *
 * Runs every 6 hours. For every active account it attempts a proactive
 * token refresh so access tokens never go stale between worker runs.
 *
 * WHY TOKENS EXPIRE AFTER 7 DAYS (the real root cause):
 *   Google OAuth refresh tokens issued for apps still in "Testing" status
 *   in Google Cloud Console expire after exactly 7 days. The fix is to
 *   publish the OAuth consent screen to "Production" in Google Cloud Console
 *   → APIs & Services → OAuth consent screen → Publish App.
 *   This service is a safety net — it cannot fix a revoked/expired refresh
 *   token, but it keeps healthy tokens alive by refreshing them regularly
 *   and marks broken accounts with status='error' so admins see them.
 *
 * INVALID_GRANT errors are caught and the account is marked 'error'
 * so the dashboard shows it needs reconnecting rather than silently failing.
 */

const TokenStore   = require('./tokenStore');
const { getGmailClient, isInvalidGrant } = require('./googleAuth');
const logger       = require('./logger');

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const STALE_THRESHOLD_MS  = 30 * 60 * 1000;      // refresh if expiring within 30 min

let _timer = null;

async function refreshAccount(account) {
  try {
    const tokenData = TokenStore.getWithTokens(account.email);
    if (!tokenData?.refresh_token) {
      logger.warn(`[TokenHealth] ${account.email}: no refresh_token — skipping`);
      return { email: account.email, result: 'skipped' };
    }

    // Only refresh if the access token will expire within the threshold
    const expiresIn = (tokenData.expiry_date || 0) - Date.now();
    if (expiresIn > STALE_THRESHOLD_MS) {
      return { email: account.email, result: 'fresh' };
    }

    // getGmailClient handles the refresh + persists new tokens via onRefresh
    await getGmailClient(
      tokenData,
      (newTokens) => {
        TokenStore.updateToken(account.email, newTokens);
        logger.info(`[TokenHealth] ${account.email}: token refreshed proactively`);
      },
      account.email
    );

    // If account was previously in error state due to token issues, restore it
    if (account.status === 'error') {
      TokenStore.setStatus(account.email, 'active');
      logger.info(`[TokenHealth] ${account.email}: restored to active after successful refresh`);
    }

    return { email: account.email, result: 'refreshed' };
  } catch (err) {
    if (isInvalidGrant(err)) {
      // Token is permanently dead — mark the account so admin/user knows
      TokenStore.setStatus(account.email, 'error');
      logger.error(`[TokenHealth] ${account.email}: INVALID_GRANT — marked error, needs reconnect`);
      return { email: account.email, result: 'invalid_grant' };
    }
    // Transient error (network, quota) — don't mark the account, just log
    logger.warn(`[TokenHealth] ${account.email}: refresh failed (transient) — ${err.message}`);
    return { email: account.email, result: 'error', reason: err.message };
  }
}

async function runHealthCheck() {
  const accounts = TokenStore.getAll().filter(a => a.status !== 'paused');
  if (accounts.length === 0) return;

  logger.info(`[TokenHealth] Starting health check for ${accounts.length} account(s)`);

  // Run checks in small concurrent batches to avoid hammering Google
  const BATCH = 3;
  const results = { refreshed: 0, fresh: 0, skipped: 0, invalid_grant: 0, error: 0 };

  for (let i = 0; i < accounts.length; i += BATCH) {
    const batch   = accounts.slice(i, i + BATCH);
    const settled = await Promise.allSettled(batch.map(a => refreshAccount(a)));
    for (const s of settled) {
      if (s.status === 'fulfilled') results[s.value.result] = (results[s.value.result] || 0) + 1;
    }
    // Small delay between batches — avoid concurrent refresh quota issues
    if (i + BATCH < accounts.length) await new Promise(r => setTimeout(r, 2000));
  }

  logger.info(`[TokenHealth] Done — ${JSON.stringify(results)}`);
  return results;
}

function start() {
  if (_timer) return; // already running
  // Run once shortly after startup, then on the interval
  setTimeout(runHealthCheck, 60 * 1000); // 1 min after boot
  _timer = setInterval(runHealthCheck, REFRESH_INTERVAL_MS);
  logger.info(`[TokenHealth] Background token refresh started (every ${REFRESH_INTERVAL_MS / 3600000}h)`);
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { start, stop, runHealthCheck };