# PixelRelay v3.0
### Gmail Pixel Rendering System — Full-Stack App

---

## Quick Start (5 steps)

### Step 1 — Clone & install dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

---

### Step 2 — Configure Google OAuth

1. Go to https://console.cloud.google.com/
2. Create a project (or select existing)
3. Navigate to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add Authorized redirect URI: `http://localhost:3001/auth/google/callback`
7. Copy your **Client ID** and **Client Secret**

Enable the Gmail API:
- Go to **APIs & Services → Library**
- Search "Gmail API" → Enable it

---

### Step 3 — Set environment variables

```bash
cd backend
cp .env.example .env
```

Edit `.env` and fill in:
```
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback
FRONTEND_URL=http://localhost:5173
PORT=3001
JWT_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
TOKEN_ENCRYPTION_KEY=<generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
DEFAULT_ADMIN_PASSWORD=<choose a strong password>
```

---

### Step 4 — Start the backend

```bash
cd backend
npm run dev
```

---

### Step 5 — Start the frontend

```bash
cd frontend
npm run dev
```

Open http://localhost:5173 — default login: `admin` / `admin123` (change immediately)

---

## Features

### Account Approval Workflow (new in v3)

When any user connects a Gmail account via OAuth, instead of going live immediately:

1. A **pending request** is created and the user sees "awaiting admin approval"
2. **Admin/SuperAdmin** sees a badge on the **Requests** tab in the nav
3. Admin can:
   - **Approve individually** — account becomes active immediately
   - **Reject** — with optional reason message
   - **Approve all pending** — one-click bulk approval
   - **Approve all for a user** — approve all requests from one user at once
4. Only approved accounts appear in the account list and processing queue

### Processing Controls & Safety (new in v3)

- **Stop requires confirmation** — stop single account or Stop All now shows a confirm dialog
- **Delete blocked while running** — cannot delete an account that is currently processing
- **Pause/Resume requires confirmation** — prevents accidental pauses mid-run
- **Skip already-running accounts** — Run All skips any account already being processed (no double-runs)
- **Admin stop-only during run** — when a run is in progress, only Stop is available; delete is blocked for non-admins

### User & Role Management

- 3 roles: `superadmin`, `admin`, `user`
- Superadmin can create/delete users, change roles, reset passwords, update permissions per role
- Role changes require confirmation dialog
- Password minimum 8 characters enforced on creation and reset

### Worker

- All processing runs in the browser — beacons fire from the user's real IP
- 6 beacon vector types: pixel, tracked-link, css-beacon, iframe, preload, hidden-input
- Configurable batch delay, email jitter, and per-user concurrency limit
- Live progress reporting to admin activity feed

---

## Architecture

```
frontend (React + Vite)  →  backend (Express)
                                  ↓
                         routes/auth.js          (OAuth flow → pending requests)
                         routes/accountRequests.js (approve/reject workflow)
                         routes/worker.js        (job control + activity feed)
                         routes/gmail.js         (Gmail API proxy)
                         routes/users.js         (user + permission management)
                                  ↓
                    ┌─────────────┴──────────────────┐
                    ↓                                 ↓
             tokenStore.js                  accountRequestStore.js
             (AES-256-GCM encrypted)        (pending/approved/rejected)
```

---

## File Structure

```
pixelrelay/
├── backend/
│   ├── server.js
│   ├── .env.example
│   ├── routes/
│   │   ├── auth.js               ← OAuth + account connect (creates pending requests)
│   │   ├── accountRequests.js    ← approve/reject/bulk workflow (NEW)
│   │   ├── worker.js             ← worker config + live activity
│   │   ├── users.js              ← user management
│   │   ├── gmail.js              ← Gmail API proxy
│   │   └── reports.js            ← daily report data
│   ├── services/
│   │   ├── accountRequestStore.js ← pending request persistence (NEW)
│   │   ├── tokenStore.js         ← AES-256-GCM encrypted token store
│   │   ├── userStore.js          ← bcrypt user store
│   │   ├── configStore.js        ← worker runtime config
│   │   ├── googleAuth.js         ← OAuth2 client
│   │   ├── gmailFetcher.js       ← Gmail API + HTML extraction
│   │   ├── spamRescuer.js        ← spam rescue (fixed: newer_than:7d filter)
│   │   ├── rateLimiter.js        ← token bucket quota limiter
│   │   └── logger.js             ← Winston logger
│   └── middleware/
│       └── auth.js               ← JWT auth (fixed: 7d expiry)
│
├── frontend/
│   └── src/
│       ├── App.jsx               ← root + routing + pending toast
│       ├── components/
│       │   ├── Topbar.jsx        ← nav with pending requests badge
│       │   ├── ConfirmDialog.jsx ← reused for all destructive actions
│       │   └── ui.jsx
│       ├── pages/
│       │   ├── Dashboard.jsx     ← stats + table (stop/delete confirmations)
│       │   ├── Accounts.jsx      ← account cards (full confirm guards)
│       │   ├── AccountRequests.jsx ← admin approval panel (NEW)
│       │   ├── AdminPanel.jsx    ← user/permission/config mgmt
│       │   ├── Beacons.jsx
│       │   ├── Logs.jsx
│       │   └── Reports.jsx
│       ├── hooks/
│       │   ├── useWorker.js      ← processing engine (skip-already-running)
│       │   └── useStats.js
│       └── utils/
│           └── api.js            ← all API calls incl. account-requests
│
└── README.md
```

---

## Bug Fixes in v3

| Bug | File | Fix |
|---|---|---|
| `extractAllBeacons` defined twice | `beaconExtractor.js` | Removed dead first export |
| Duplicate `q:` property in spam query | `spamRescuer.js` | Kept `newer_than:7d` filter, removed duplicate |
| JWT tokens never expire | `middleware/auth.js` | Added `expiresIn: '7d'` |
| JWT_SECRET production check missing | `middleware/auth.js` | Exits if default secret used in production |
| Rate limiter skip list had ghost route | `server.js` | Removed `/worker/status` dead entry |
| Password no minimum length | `AdminPanel.jsx` + `userStore.js` | 8-char minimum enforced |
| Version mismatch (v2/v3) | Multiple | Unified to v3.0.0 |

---

## Production Notes

- Swap `*.json` stores for MongoDB with AES-256 encryption
- Add Redis + BullMQ for distributed queues
- Run behind nginx with HTTPS
- Set `NODE_ENV=production` — serves frontend from backend, disables CORS
