/**
 * Spam Rescuer — Phase 0 of the worker pipeline.
 *
 * Before processing unread inbox emails, this moves ALL spam
 * emails back to INBOX so they get processed by the main worker.
 *
 * Gmail API:
 *   removeLabelIds: ['SPAM']
 *   addLabelIds:    ['INBOX']
 *
 * Returns count of emails rescued.
 */

const { getGmailClient }      = require('./googleAuth');
const { withRetry }           = require('./gmailFetcher');
const { consumeQuota, UNITS } = require('./rateLimiter');
const TokenStore              = require('./tokenStore');
const logger                  = require('./logger');

async function rescueSpam(email) {
  let rescued = 0;
  try {
    const tokenData = TokenStore.getWithTokens(email);
    if (!tokenData) return 0;

    const gmail = await getGmailClient(tokenData, (t) => TokenStore.updateToken(email, t));

    // Collect ALL spam message IDs (paginated)
    const spamIds  = [];
    let pageToken  = null;

    do {
      await consumeQuota(email, UNITS.LIST);
      // FIX: List call now wrapped in withRetry. Previously a transient 429 during
      // list phase would silently return 0 rescued — now it retries with backoff.
      const res = await withRetry(() => gmail.users.messages.list({
        userId:     'me',
        maxResults: 100,
        labelIds:   ['SPAM'],
        q:          'is:unread newer_than:7d',
        ...(pageToken ? { pageToken } : {}),
      }), 3, `spam list for ${email}`);

      const msgs = res.data.messages || [];
      spamIds.push(...msgs.map(m => m.id));
      pageToken = res.data.nextPageToken || null;

    } while (pageToken);

    if (spamIds.length === 0) {
      logger.info(`${email} — no spam to rescue`);
      return 0;
    }

    logger.info(`${email} — rescuing ${spamIds.length} spam emails`);

    // Move each spam email to inbox
    for (const id of spamIds) {
      try {
        await consumeQuota(email, UNITS.MODIFY);
        await gmail.users.messages.modify({
          userId:      'me',
          id,
          requestBody: {
            addLabelIds:    ['INBOX'],
            removeLabelIds: ['SPAM'],
          },
        });
        rescued++;
      } catch (err) {
        logger.warn(`Failed to rescue spam msg ${id}`, { error: err.message });
      }
    }

    logger.info(`${email} — rescued ${rescued}/${spamIds.length} spam emails to inbox`);

  } catch (err) {
    logger.error(`rescueSpam failed for ${email}`, { error: err.message });
  }

  return rescued;
}

module.exports = { rescueSpam };
