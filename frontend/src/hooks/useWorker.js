/**
 * useWorker — all email processing logic runs in the browser
 *
 * Features:
 *   • Concurrency pool  — max N accounts at a time per user, rest queue
 *   • Per-account stop  — stopOne(email) stops only that account
 *   • Stop All          — only available when started via Run All
 *   • Configurable delays — batchDelay + emailJitter fetched from backend
 *   • Activity reporting  — POSTs live status to backend for admin visibility
 *
 * Run modes:
 *   startRun([account])   → individual mode  → per-account ▶/⏹ toggle
 *   startRun(accounts)    → run-all mode     → global Stop All only
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import api from '../utils/api';
import { extractAllBeacons } from '../services/beaconExtractor';
import { fireAllBeacons }    from '../services/beaconFirer';
import { postActivity } from '../utils/api';

const DEFAULT_CONFIG = { batchDelayMs: 2000, emailJitterMs: 0, concurrencyLimit: 10, batchSize: 5 };
const TAG            = '[PixelRelay]';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Run fn(item) for each item, but at most `limit` concurrent at a time
async function withConcurrency(items, limit, fn) {
  const queue   = [...items];
  const active  = new Set();
  const results = [];

  return new Promise((resolve) => {
    function next() {
      if (queue.length === 0 && active.size === 0) { resolve(results); return; }
      while (active.size < limit && queue.length > 0) {
        const item    = queue.shift();
        const promise = fn(item).then(r => {
          results.push(r);
          active.delete(promise);
          next();
        }).catch(err => {
          results.push({ error: err.message });
          active.delete(promise);
          next();
        });
        active.add(promise);
      }
    }
    next();
  });
}

export function useWorker({ onStatsUpdate, username } = {}) {
  const [running,         setRunning]         = useState(false);
  const [runAllMode,      setRunAllMode]       = useState(false);
  const [accountStatuses, setAccountStatuses] = useState({});

  // runningRef: sync guard — prevents double startRun
  const runningRef   = useRef(false);
  // stopMapRef: per-account stop flags { [email]: true }
  const stopMapRef   = useRef({});
  // completedRef: accumulated completed runs for activity reporting
  const completedRef = useRef([]);
  // beaconSamplesRef: per-type URL samples captured during current/last run
  const beaconSamplesRef = useRef({});  // { [type]: [ ...urls ] }
  const [beaconSamples, setBeaconSamples] = useState({});
  // configRef: cached config for current run
  const configRef    = useRef(DEFAULT_CONFIG);
  // statusesRef: mirrors accountStatuses state — readable inside intervals/closures
  const statusesRef  = useRef({});

  const setStatus = useCallback((email, patch) => {
    setAccountStatuses(prev => {
      const next = {
        ...prev,
        [email]: { ...(prev[email] || {}), ...patch, updatedAt: Date.now() },
      };
      statusesRef.current = next;   // keep ref in sync so intervals can read it
      return next;
    });
  }, []);

  const clearStatus = useCallback((email) => {
    setAccountStatuses(prev => {
      const next = { ...prev };
      delete next[email];
      statusesRef.current = next;   // keep ref in sync
      return next;
    });
  }, []);

  // Report live activity to backend so admin can see it
  // Always reads from statusesRef so intervals never get stale closure data
  // FIX #13: reportActivity now returns a Promise so callers that need stop signals
  // can await it. The backend returns stopRequests in the POST response body —
  // no separate /worker/stop-poll endpoint needed.
  function reportActivity(isRunning) {
    const statuses  = statusesRef.current;
    const accounts  = Object.entries(statuses)
      .filter(([, s]) => s?.phase && s.phase !== 'idle')
      .map(([email, s]) => ({
        email,
        phase:   s.phase,
        message: s.message || '',
        done:    s.done    || 0,
        total:   s.total   || 0,
      }));
    return postActivity({
      running:   isRunning,
      accounts,
      completed: completedRef.current,
    }).then(res => {
      // Apply any stop signals delivered inline in the activity response
      const stops = res?.data?.stopRequests || [];
      if (stops.length > 0) {
        const newMap = { ...stopMapRef.current };
        for (const email of stops) {
          console.log(`${TAG} Admin stop received for: ${email}`);
          newMap[email] = true;
        }
        stopMapRef.current = newMap;
      }
    }).catch(() => {}); // non-fatal — never block processing
  }

  // ── Process a single email ──────────────────────────────────────────────────
  async function processEmail(accountEmail, messageId) {
    console.log(`${TAG} [${accountEmail}] Fetching ${messageId}`);
    try {
      const res       = await api.get(`/gmail/message/${encodeURIComponent(accountEmail)}/${messageId}`);
      const emailData = res.data.email;

      if (!emailData?.html || emailData.html.trim().length < 50) {
        await api.post(`/gmail/message/${encodeURIComponent(accountEmail)}/${messageId}/read`);
        return { success: true, skipped: true };
      }

      const beacons = extractAllBeacons(emailData.html);
      console.log(`${TAG} [${accountEmail}] ${messageId} → ${beacons.length} beacons`);

      // Capture URL samples per type (keep up to 5 per type)
      for (const b of beacons) {
        const type = b.type || 'unknown';
        if (!beaconSamplesRef.current[type]) beaconSamplesRef.current[type] = [];
        if (beaconSamplesRef.current[type].length < 5 && b.url) {
          // Create a new array to avoid mutating the reference held by React state
          beaconSamplesRef.current[type] = [...beaconSamplesRef.current[type], { url: b.url, email: accountEmail }];
          setBeaconSamples({ ...beaconSamplesRef.current });
        }
      }

      if (beacons.length === 0) {
        await api.post(`/gmail/message/${encodeURIComponent(accountEmail)}/${messageId}/read`);
        return { success: true, skipped: true };
      }

      // Optional per-email jitter
      const jitter = configRef.current.emailJitterMs || 0;
      if (jitter > 0) await sleep(Math.random() * jitter);

      const { fired, total } = await fireAllBeacons(beacons);
      console.log(`${TAG} [${accountEmail}] ${messageId} → fired ${fired}/${total}`);

      await api.post(`/gmail/message/${encodeURIComponent(accountEmail)}/${messageId}/read`);
      return { success: true, fired, total };
    } catch (err) {
      console.error(`${TAG} [${accountEmail}] processEmail ${messageId} FAILED:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // ── Process one account ─────────────────────────────────────────────────────
  async function processAccount(accountEmail) {
    let spamRescued  = 0;
    const config     = configRef.current;
    const startedAt  = new Date().toISOString();
    console.log(`${TAG} [${accountEmail}] ── Start ── config:`, config);

    try {
      // Phase 0: Spam rescue
      setStatus(accountEmail, { phase: 'fetching', message: 'Rescuing spam...' });
      try {
        const r = await api.post(`/gmail/rescue/${encodeURIComponent(accountEmail)}`);
        spamRescued = r.data.rescued || 0;
        console.log(`${TAG} [${accountEmail}] Rescued: ${spamRescued}`);
      } catch (err) {
        // invalid_grant during rescue — stop immediately, don't treat as non-fatal
        if (err.response?.data?.needsReconnect || err.response?.data?.error === 'invalid_grant') {
          console.warn(`${TAG} [${accountEmail}] invalid_grant during rescue — needs reconnect`);
          setStatus(accountEmail, { phase: 'error', message: '⚠ Token expired — reconnect required', needsReconnect: true });
          onStatsUpdate?.();
          return;
        }
        // All other rescue errors are non-fatal — continue the run
        console.warn(`${TAG} [${accountEmail}] Spam rescue failed (non-fatal):`, err.message);
      }

      if (stopMapRef.current[accountEmail]) {
        console.log(`${TAG} [${accountEmail}] Stopped before fetch`);
        setStatus(accountEmail, { phase: 'idle', message: 'Stopped' });
        setTimeout(() => clearStatus(accountEmail), 4000);
        await api.post(`/gmail/report/${encodeURIComponent(accountEmail)}`, {
          emailsProcessed: 0, pixelsFired: 0, successRate: 100, spamRescued,
          startedAt, stoppedEarly: true,
        }).catch(() => {});
        return;
      }

      // Phase 1: Collect IDs
      setStatus(accountEmail, { phase: 'fetching', message: 'Collecting unread emails...' });
      console.log(`${TAG} [${accountEmail}] Collecting unread IDs`);
      let idsRes;
      try {
        idsRes = await api.get(`/gmail/unread/${encodeURIComponent(accountEmail)}`);
      } catch (err) {
        // Detect invalid_grant / token-revoked — backend already marked account as 'error'
        if (err.response?.data?.needsReconnect || err.response?.data?.error === 'invalid_grant') {
          const msg = '⚠ Token expired — reconnect required';
          console.warn(`${TAG} [${accountEmail}] invalid_grant on collectIds — needs reconnect`);
          setStatus(accountEmail, { phase: 'error', message: msg, needsReconnect: true });
          onStatsUpdate?.(); // refresh account list so the card shows 'error' status immediately
          // Throw a tagged error so the outer catch knows not to overwrite the status
          const tagged = new Error(msg);
          tagged.needsReconnect = true;
          throw tagged;
        }
        throw err; // all other errors bubble to outer catch as before
      }
      const allIds = idsRes.data.ids || [];
      console.log(`${TAG} [${accountEmail}] Found ${allIds.length} unread`);

      if (allIds.length === 0) {
        setStatus(accountEmail, { phase: 'done', message: `No unread emails · ${spamRescued} rescued`, spamRescued });
        setTimeout(() => clearStatus(accountEmail), 8000);
        return;
      }

      setStatus(accountEmail, {
        phase: 'processing', message: `Processing ${allIds.length} emails...`,
        total: allIds.length, done: 0, spamRescued,
      });

      // Phase 2: Batched processing
      let success = 0, done = 0, totalBeacons = 0;
      const batchSize    = config.batchSize || 5;
      const totalBatches = Math.ceil(allIds.length / batchSize);
      console.log(`${TAG} [${accountEmail}] ${allIds.length} emails · ${totalBatches} batches · batchSize ${batchSize} · delay ${config.batchDelayMs}ms`);

      for (let i = 0; i < allIds.length; i += batchSize) {
        if (stopMapRef.current[accountEmail]) {
          console.log(`${TAG} [${accountEmail}] Stopped at batch ${Math.floor(i / batchSize) + 1}/${totalBatches}`);
          setStatus(accountEmail, { phase: 'idle', message: `Stopped at ${done}/${allIds.length}` });
          setTimeout(() => clearStatus(accountEmail), 5000);
          const partialRate = done > 0 ? +((success / done) * 100).toFixed(1) : 100;
          await api.post(`/gmail/report/${encodeURIComponent(accountEmail)}`, {
            emailsProcessed: done, pixelsFired: totalBeacons, successRate: partialRate, spamRescued,
            startedAt, stoppedEarly: true,
          }).catch(() => {});
          return;
        }

        const batch    = allIds.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        console.log(`${TAG} [${accountEmail}] Batch ${batchNum}/${totalBatches}`);

        setStatus(accountEmail, {
          phase: 'processing', message: `Batch ${batchNum}/${totalBatches}`,
          total: allIds.length, done, spamRescued,
        });

        const results = await Promise.allSettled(batch.map(id => processEmail(accountEmail, id)));

        for (const r of results) {
          if (r.status === 'fulfilled' && r.value?.skipped) {
            done++;
          } else if (r.status === 'fulfilled' && r.value?.success) {
            success++; done++;
            totalBeacons += r.value.fired || 0;
          } else {
            done++;
            console.warn(`${TAG} [${accountEmail}] Email failed:`, r.reason || r.value?.error);
          }
        }

        console.log(`${TAG} [${accountEmail}] Batch ${batchNum} done — ${success}/${done}, ${totalBeacons} beacons`);

        // Batch delay between batches (not after the last one)
        const isLastBatch = i + batchSize >= allIds.length;
        if (!isLastBatch && config.batchDelayMs > 0) {
          console.log(`${TAG} [${accountEmail}] Waiting ${config.batchDelayMs}ms before next batch`);
          await sleep(config.batchDelayMs);
        }
      }

      const rate = done > 0 ? +((success / done) * 100).toFixed(1) : 100;
      const finishedAt = new Date().toISOString();
      console.log(`${TAG} [${accountEmail}] ── Complete: ${success}/${done}, ${totalBeacons} beacons, ${rate}%, ${spamRescued} rescued ──`);

      await api.post(`/gmail/report/${encodeURIComponent(accountEmail)}`, {
        emailsProcessed: done, pixelsFired: totalBeacons, successRate: rate, spamRescued,
        startedAt, stoppedEarly: false,
      });

      // Record in completedRef for activity reporting
      completedRef.current.push({
        email: accountEmail, emails: done, beacons: totalBeacons,
        rate, spam: spamRescued, finishedAt,
      });

      setStatus(accountEmail, {
        phase: 'done', message: `${success}/${done} emails · ${totalBeacons} beacons · ${spamRescued} rescued`,
        rate, done, total: done, spamRescued,
      });

      setTimeout(() => clearStatus(accountEmail), 10000);
      onStatsUpdate?.();

    } catch (err) {
      console.error(`${TAG} [${accountEmail}] FAILED:`, err);
      // Don't overwrite the status if we already set a specific needsReconnect message above
      if (!err.needsReconnect) {
        setStatus(accountEmail, { phase: 'error', message: err.message });
      }
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  const startRun = useCallback(async (accounts, mode = 'individual') => {
    if (runningRef.current) {
      console.warn(`${TAG} startRun ignored — already running`);
      return;
    }

    // Fetch latest config before starting
    try {
      const res = await api.get('/worker/config');
      configRef.current = res.data.config || DEFAULT_CONFIG;
    } catch {
      configRef.current = DEFAULT_CONFIG;
    }
    const { concurrencyLimit } = configRef.current;

    runningRef.current = true;
    stopMapRef.current = {};
    completedRef.current = [];

    const isRunAll = mode === 'all' || accounts.length > 1;
    setRunning(true);
    setRunAllMode(isRunAll);
    setAccountStatuses({});

    // Filter out accounts already actively processing (safety guard against double-runs)
    const alreadyRunning = Object.entries(statusesRef.current)
      .filter(([, s]) => s?.phase && !['done', 'idle', 'error'].includes(s.phase))
      .map(([email]) => email);

    const filtered = accounts.filter(a => {
      if (alreadyRunning.includes(a.email)) {
        console.warn(`${TAG} Skipping ${a.email} — already processing`);
        return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      console.warn(`${TAG} All accounts already running — nothing to start`);
      runningRef.current = false;
      setRunning(false);
      setRunAllMode(false);
      return;
    }

    const accountsToRun = filtered;

    console.log(`${TAG} ══ Run started [${isRunAll ? 'RUN ALL' : 'INDIVIDUAL'}] ${accountsToRun.length} account(s), concurrency: ${concurrencyLimit} ══`);
    console.log(`${TAG} Config:`, configRef.current);

    // Activity report on start
    reportActivity(true);

    // Activity reporting interval — reads statusesRef so always has current data.
    // FIX #13: Stop signals are now returned in the POST /worker/activity response
    // body — no separate stop-poll interval needed.
    let activityInterval = null;
    activityInterval = setInterval(() => reportActivity(true), 3000);

    try {
      await withConcurrency(accountsToRun, concurrencyLimit, a => processAccount(a.email));
    } finally {
      clearInterval(activityInterval);
      runningRef.current = false;
      setRunning(false);
      setRunAllMode(false);
      // Final activity report — run ended, clear accounts list
      statusesRef.current = {};
      reportActivity(false);
      console.log(`${TAG} ══ All accounts finished ══`);
      onStatsUpdate?.();
    }
  // NOTE: Empty deps array is intentional and safe here. startRun reads ALL
  // mutable state through refs (runningRef, stopMapRef, configRef, statusesRef,
  // completedRef, beaconSamplesRef) — never from React state directly. If you
  // add a state read inside this callback without going through a ref first,
  // you will get a stale closure bug. Always add a ref and read from that instead.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop a single account (individual mode only)
  const stopOne = useCallback((email) => {
    console.log(`${TAG} stopOne: ${email}`);
    stopMapRef.current = { ...stopMapRef.current, [email]: true };
  }, []);

  // Stop all accounts (run-all mode)
  const stopAll = useCallback(() => {
    console.log(`${TAG} stopAll`);
    // Mark all currently tracked accounts as stopped
    setAccountStatuses(prev => {
      const toStop = Object.keys(prev);
      const newMap = { ...stopMapRef.current };
      for (const email of toStop) newMap[email] = true;
      stopMapRef.current = newMap;
      return prev;
    });
  }, []);

  // FIX: Warn the user before closing/refreshing the tab mid-run.
  // Previously a page refresh would silently abandon the job — emails could be
  // half-processed and the backend activity map would show stale "running" state
  // for up to 30 minutes. The unload handler also fires a final "stopped" report
  // so the backend clears immediately instead of waiting for the purge interval.
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (!runningRef.current) return;
      // navigator.sendBeacon() cannot send custom headers, so the JWT is passed
      // as a query param. The backend's requireAuth accepts ?token= for this case.
      try {
        const token   = localStorage.getItem('pr_token') || '';
        const payload = JSON.stringify({ running: false, accounts: [], completed: [] });
        navigator.sendBeacon(
          `/worker/activity?token=${encodeURIComponent(token)}`,
          new Blob([payload], { type: 'application/json' })
        );
      } catch { /* non-fatal */ }
      // Show browser's built-in "Leave site?" dialog
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []); // runningRef is a ref — stable reference, safe with empty deps

  return { running, runAllMode, accountStatuses, startRun, stopOne, stopAll, beaconSamples };
}