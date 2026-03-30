/**
 * PixelRelay v2.0 — Express API Server
 */

require('dotenv').config();
const express      = require('express');
const path         = require('path');

const FRONTEND_DIST = path.join(__dirname, '../frontend/dist');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');

const authRoutes   = require('./routes/auth');
const workerRoutes = require('./routes/worker');
const userRoutes   = require('./routes/users');
const reportRoutes = require('./routes/reports');
const gmailRoutes          = require('./routes/gmail');
const accountRequestRoutes = require('./routes/accountRequests');
const UserStore    = require('./services/userStore');
const logger       = require('./services/logger');
const tokenHealth  = require('./services/tokenHealthService');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Security middleware ────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,  // disabled — API only, no HTML served
  crossOriginEmbedderPolicy: false,
}));

// ── Rate limiting ──────────────────────────────────────────────────────────────

// FIX: loginLimiter must be declared and applied BEFORE the general userRoutes mount.
// Previously it was registered after app.use('/users', userRoutes), so it never fired.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      20,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many login attempts, please try again later.' },
});

// High-frequency endpoint limiter — applied specifically to polling routes so they
// get their own generous bucket rather than sharing with (or bypassing) the general one.
const pollingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      300,  // 5 req/sec sustained — enough for 3s polling intervals
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many polling requests.' },
});

// Gmail proxy limiter — high ceiling per 15 min window, matching expected batch volume.
// 100 emails × 2 calls + 3 overhead = ~203 per account. 10 accounts = 2030 per run.
// FIX #8: keyGenerator by JWT so multiple users behind one IP don't share quota.
const gmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      5000,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => req.headers.authorization || req.ip,
  message: { error: 'Gmail proxy rate limit reached.' },
});

// General API limiter — applied to all other authenticated endpoints.
// FIX #8: keyGenerator uses JWT token when present so users behind the same IP
// (office, VPN, home router) each get their own independent bucket.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      1000,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => req.headers.authorization || req.ip,
  message: { error: 'Too many requests, please try again later.' },
});

// ── Core middleware ────────────────────────────────────────────────────────────
// In production the frontend is served from the same origin — no CORS needed
// In dev allow the Vite dev server
if (!IS_PRODUCTION) {
  app.use(cors({
    origin:      process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  }));
}
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Skip logging for high-frequency polling routes to avoid log spam
const SILENT_ROUTES = new Set([
  '/worker/activity',
  '/worker/stats',
  '/account-requests/pending-count',
  '/users/me',
  '/health',
]);
app.use((req, res, next) => {
  if (!SILENT_ROUTES.has(req.path)) {
    logger.info(`${req.method} ${req.path}`);
  }
  next();
});

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/auth',    generalLimiter, authRoutes);

// FIX: loginLimiter is now applied BEFORE userRoutes so it intercepts /users/login
// correctly. Previously this was registered after app.use('/users') — too late.
app.use('/users/login', loginLimiter);
app.use('/users',   generalLimiter, userRoutes);

// FIX #7: All high-frequency polling routes get their own generous bucket
// (300 req/min) so they never eat into the general limiter's 1000 req/15min budget.
// Note: /worker/activity/my removed (merged into /worker/activity — see worker.js)
// Note: /worker/stop-poll removed (stop signals now returned in POST /worker/activity response)
app.use('/worker/stats',    pollingLimiter);
app.use('/worker/activity', pollingLimiter);
app.use('/worker',          generalLimiter, workerRoutes);

app.use('/reports', generalLimiter, reportRoutes);
app.use('/gmail',   gmailLimiter,   gmailRoutes);

// FIX #7: pending-count on pollingLimiter — it polls every 10s but is now
// folded into /worker/stats (see fix #12). Kept here as a safety net.
app.use('/account-requests/pending-count', pollingLimiter);
app.use('/account-requests', generalLimiter, accountRequestRoutes);

// FIX #7: /users/me polls every 30s — move to pollingLimiter
app.use('/users/me', pollingLimiter);

// ── Health ─────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '3.0.0', time: new Date().toISOString() });
});

// ── Serve frontend (production) ────────────────────────────────────────────────
if (IS_PRODUCTION) {
  app.use(express.static(FRONTEND_DIST));
  // Any non-API route serves index.html — lets React Router handle client-side routing
  app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

// ── 404 / Error ────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

// ── Global crash safety ────────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: reason?.message || reason });
});

// FIX: uncaughtException must exit the process. Node.js officially treats this as
// fatal because the process may be in a corrupted state. Use a process manager
// (PM2, systemd) to handle automatic restarts.
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — shutting down', { error: err.message, stack: err.stack });
  process.exit(1);
});

// ── Graceful shutdown ──────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`[Server] ${signal} received — shutting down gracefully...`);
  logger.info('[Server] Goodbye.');
  process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── Start ──────────────────────────────────────────────────────────────────────
async function start() {
  await UserStore.init();
  app.listen(PORT, () => {
    logger.info(`PixelRelay API running on http://localhost:${PORT}`);
    if (!IS_PRODUCTION) {
      logger.info(`[DEV ONLY] Default login — username: admin  password: ${process.env.DEFAULT_ADMIN_PASSWORD || 'admin123'}`);
    }
    // Start background token health checker — keeps Gmail tokens alive
    // and marks accounts that need reconnecting (INVALID_GRANT)
    tokenHealth.start();
  });
}

start();
module.exports = app;