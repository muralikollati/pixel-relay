/**
 * Per-account Token Bucket Rate Limiter
 * Caps Gmail API usage at 200 units/user/second (Google limit: 250)
 * Provides 20% headroom to prevent silent quota failures.
 *
 * Gmail API unit costs:
 *   messages.list   = 5 units
 *   messages.get    = 5 units
 *   messages.modify = 10 units
 */

const CAP = parseInt(process.env.QUOTA_CAP_PER_SECOND || '200');

// Map of email → { tokens, lastRefill }
const buckets = new Map();

function getBucket(email) {
  if (!buckets.has(email)) {
    buckets.set(email, { tokens: CAP, lastRefill: Date.now() });
  }
  return buckets.get(email);
}

/**
 * Consume `units` from the bucket for `email`.
 * If not enough tokens, waits until refilled.
 *
 * FIX: Previously the code set bucket.tokens = 0 after waiting, which meant the
 * consumed units weren't actually deducted — the next caller skipped the wait
 * even if quota was still depleted. Now we properly subtract the consumed units
 * from whatever tokens accumulated during the wait period.
 */
async function consumeQuota(email, units = 5) {
  const bucket = getBucket(email);
  const now    = Date.now();

  // Refill based on elapsed time
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(CAP, bucket.tokens + elapsed * CAP);
  bucket.lastRefill = now;

  if (bucket.tokens >= units) {
    bucket.tokens -= units;
    return;
  }

  // Wait for enough tokens to accumulate
  const waitMs = ((units - bucket.tokens) / CAP) * 1000;
  await new Promise(r => setTimeout(r, Math.ceil(waitMs)));

  // FIX: Re-calculate tokens after wait and deduct what was consumed.
  // Old code did `bucket.tokens = 0` which gave a free pass to the next caller.
  const now2    = Date.now();
  const elapsed2 = (now2 - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(CAP, bucket.tokens + elapsed2 * CAP) - units;
  bucket.lastRefill = now2;
}

/** Get current quota usage percentage for an account (0–100) */
function getQuotaUsage(email) {
  const bucket = getBucket(email);
  return Math.round(((CAP - bucket.tokens) / CAP) * 100);
}

/** Reset bucket for an account (e.g. after reconnect) */
function resetBucket(email) {
  buckets.set(email, { tokens: CAP, lastRefill: Date.now() });
}

// Unit cost constants
const UNITS = {
  LIST:   5,
  GET:    5,
  MODIFY: 10,
};

module.exports = { consumeQuota, getQuotaUsage, resetBucket, UNITS };
