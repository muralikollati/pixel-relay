/**
 * Gmail Fetcher Service
 *
 * Phase 1 — collectAllIds():
 *   Paginates through Gmail API to collect ALL unread message IDs.
 *   Fast and cheap — only 5 quota units per page (100 IDs per page).
 *
 * Phase 2 — fetchEmailContent():
 *   Fetches full HTML content for a single message ID.
 *   Called in parallel batches of 5 by the worker.
 */

const { getGmailClient }      = require('./googleAuth');
const { consumeQuota, UNITS } = require('./rateLimiter');
const TokenStore              = require('./tokenStore');
const logger                  = require('./logger');

// ── Retry helper ─────────────────────────────────────────────────────────────
// Handles Gmail 429 / 500 / 503 with exponential backoff
async function withRetry(fn, retries = 3, label = '') {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.response?.status || err?.code;
      const retryable = [429, 500, 503, 'ECONNRESET', 'ETIMEDOUT'].includes(status);
      if (!retryable || attempt === retries) throw err;
      const delay = Math.pow(2, attempt - 1) * 1000;  // 1s, 2s, 4s — true exponential backoff
      logger.warn(`[GmailFetcher] ${label} failed (${status}), retry ${attempt}/${retries} in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeBase64(data) {
  if (!data) return '';
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

function extractHtml(payload) {
  if (!payload) return '';

  // Direct HTML part
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return decodeBase64(payload.body.data);
  }

  if (payload.parts) {
    // Prefer text/html in parts
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return decodeBase64(part.body.data);
      }
    }
    // Recurse into nested multipart
    for (const part of payload.parts) {
      const html = extractHtml(part);
      if (html) return html;
    }
  }

  // Last resort — plain text wrapped in pre
  if (payload.body?.data) {
    return `<pre>${decodeBase64(payload.body.data)}</pre>`;
  }

  return '';
}

// ── Phase 1: Collect ALL unread message IDs via pagination ────────────────────

/**
 * Returns ALL unread message IDs for an account.
 * Gmail returns max 100 IDs per page — we loop through all pages.
 *
 * @param {string} email
 * @returns {string[]} - Array of message IDs
 */
async function collectAllIds(email) {
  const tokenData = TokenStore.getWithTokens(email);
  if (!tokenData) throw new Error(`No token found for ${email}`);

  const gmail = await getGmailClient(tokenData, (newTokens) => {
    TokenStore.updateToken(email, newTokens);
  }, email);

  const allIds    = [];
  let pageToken   = null;
  let pageNumber  = 0;

  do {
    pageNumber++;
    await consumeQuota(email, UNITS.LIST);

    const res = await withRetry(() => gmail.users.messages.list({
      userId:     'me',
      maxResults: 100,        // max Gmail allows per page
      q:          'is:unread',
      labelIds:   ['INBOX'],
      ...(pageToken ? { pageToken } : {}),
    }), 3, `list page ${pageNumber} for ${email}`);

    const messages = res.data.messages || [];
    allIds.push(...messages.map(m => m.id));

    pageToken = res.data.nextPageToken || null;

    logger.info(`${email} — ID page ${pageNumber}: ${messages.length} IDs (total so far: ${allIds.length})`);

  } while (pageToken);

  logger.info(`${email} — collected ${allIds.length} unread IDs across ${pageNumber} page(s)`);
  return allIds;
}

// ── Phase 2: Fetch full content for ONE message ID ────────────────────────────

/**
 * Fetches full HTML content for a single message.
 * Called in parallel batches by the worker.
 *
 * @param {string} email
 * @param {object} gmail     - authenticated Gmail client
 * @param {string} messageId
 * @returns {{ id, subject, from, date, html } | null}
 */
async function fetchEmailContent(email, gmail, messageId) {
  try {
    await consumeQuota(email, UNITS.GET);

    const res = await withRetry(() => gmail.users.messages.get({
      userId: 'me',
      id:     messageId,
      format: 'full',
    }), 3, `fetch ${messageId}`);

    const payload = res.data.payload;
    const headers = payload?.headers || [];

    return {
      id:      messageId,
      subject: headers.find(h => h.name === 'Subject')?.value || '(no subject)',
      from:    headers.find(h => h.name === 'From')?.value    || '',
      date:    headers.find(h => h.name === 'Date')?.value    || '',
      html:    extractHtml(payload),
    };
  } catch (err) {
    logger.warn(`Failed to fetch content for ${messageId}`, { error: err.message });
    return null;
  }
}

// ── Mark as Read ──────────────────────────────────────────────────────────────

async function markAsRead(email, messageId) {
  try {
    const tokenData = TokenStore.getWithTokens(email);
    if (!tokenData) return;

    const gmail = await getGmailClient(tokenData, (t) => TokenStore.updateToken(email, t), email);

    await consumeQuota(email, UNITS.MODIFY);
    await gmail.users.messages.modify({
      userId:      'me',
      id:          messageId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });

    logger.info(`Marked as read: ${messageId} for ${email}`);
  } catch (err) {
    logger.warn(`markAsRead failed for ${messageId}`, { error: err.message });
  }
}

// ── Get authenticated Gmail client (reusable across batch) ───────────────────

async function getAuthenticatedClient(email) {
  const tokenData = TokenStore.getWithTokens(email);
  if (!tokenData) throw new Error(`No token found for ${email}`);
  return getGmailClient(tokenData, (newTokens) => {
    TokenStore.updateToken(email, newTokens);
  }, email);
}

module.exports = { collectAllIds, fetchEmailContent, getAuthenticatedClient, markAsRead, withRetry };