import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline, Box, Snackbar, Alert } from '@mui/material';
import Topbar          from './components/Topbar';
import Dashboard       from './pages/Dashboard';
import Accounts        from './pages/Accounts';
import Beacons         from './pages/Beacons';
import Logs            from './pages/Logs';
import Reports         from './pages/Reports';
import AdminPanel      from './pages/AdminPanel';
import AccountRequests from './pages/AccountRequests';
import MyRequests      from './pages/MyRequests';
import RunHistory      from './pages/RunHistory';
import Login           from './pages/Login';
import { useStats }    from './hooks/useStats';
import { useWorker }   from './hooks/useWorker';
import { getMe, getActivity, getMyActivity, getPendingCount, logoutApi } from './utils/api';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary:    { main: '#00E5FF' },
    secondary:  { main: '#7C3AED' },
    success:    { main: '#10B981' },
    warning:    { main: '#F59E0B' },
    error:      { main: '#EF4444' },
    background: { default: '#080A0F', paper: '#0F1117' },
    text:       { primary: '#E5E7EB', secondary: '#6B7280' },
  },
  typography: { fontFamily: '"Inter", system-ui, sans-serif' },
  shape: { borderRadius: 10 },
  components: {
    MuiCard:      { styleOverrides: { root: { backgroundImage: 'none', border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#0F1117' } } },
    MuiButton:    { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, borderRadius: 8 } } },
    MuiTableCell: { styleOverrides: { root: { borderColor: 'rgba(255,255,255,0.05)' } } },
    MuiChip:      { styleOverrides: { root: { fontFamily: '"DM Mono", monospace' } } },
    MuiTooltip:   { styleOverrides: { tooltip: { fontSize: 11 } } },
  },
});

function loadStoredUser() {
  try { return JSON.parse(localStorage.getItem('pr_user')); } catch { return null; }
}

const isAdminRole = (role) => ['superadmin', 'admin'].includes(role);

export default function App() {
  const [user,         setUser]         = useState(loadStoredUser);
  const [tab,          setTab]          = useState('dashboard');
  const [toast,        setToast]        = useState(null);
  const [toastOpen,    setToastOpen]    = useState(false);

  // allActivity: for admin — full map of all users' running sessions
  // myActivity:  for all users — scoped live statuses for accounts they can see
  const [allActivity,  setAllActivity]  = useState({});
  const [myActivity,   setMyActivity]   = useState({ running: false, accounts: [] });
  const [pendingCount, setPendingCount] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, refetch } = useStats(4000, !!user);
  const worker = useWorker({ onStatsUpdate: refetch, username: user?.username });

  // ── Permissions refresh ─────────────────────────────────────────────────────
  // FIX: Use a ref to hold the current user so the interval callback always reads
  // fresh data without re-creating itself on every user object change.
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  useEffect(() => {
    if (!user?.username) return;
    const refresh = async () => {
      const currentUser = userRef.current;
      if (!currentUser) return;
      try {
        const res     = await getMe();
        const updated = res.data.user;
        if (JSON.stringify(currentUser.permissions) !== JSON.stringify(updated.permissions)) {
          const merged = { ...currentUser, permissions: updated.permissions };
          setUser(merged);
          localStorage.setItem('pr_user', JSON.stringify(merged));
        }
      } catch { /* non-fatal */ }
    };
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [user?.username]); // only restart when username changes — not on every user object mutation

  // ── Admin: poll full activity map (all users) ───────────────────────────────
  useEffect(() => {
    if (!user || !isAdminRole(user.role)) return;
    const poll = async () => {
      try { const res = await getActivity(); setAllActivity(res.data.activity || {}); } catch { /* */ }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [user?.role]);

  // ── All users: poll activity scoped to their own accounts ──────────────────
  // This ensures regular users see live progress even when admin is running their account.
  // Admins also poll this so their dashboard shows correctly when not running themselves.
  useEffect(() => {
    if (!user) return;
    const poll = async () => {
      try { const res = await getMyActivity(); setMyActivity(res.data); } catch { /* */ }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [user?.username]);

  // ── Pending request badge (admin) ───────────────────────────────────────────
  useEffect(() => {
    if (!user || !isAdminRole(user.role)) return;
    const poll = async () => {
      try { const res = await getPendingCount(); setPendingCount(res.data.count || 0); } catch { /* */ }
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => clearInterval(id);
  }, [user?.role]);

  // ── OAuth redirect handling ─────────────────────────────────────────────────
  // FIX: This MUST run unconditionally regardless of auth state.
  //
  // The bug: Google redirects back to /?pending=email (or /?error=...) BEFORE the
  // user is logged in. The old code had this effect inside the authenticated shell,
  // below the `if (!user) return <Login/>` early return — so it never fired when
  // the page loaded fresh from a Google redirect. The user would log in, but
  // searchParams hadn't changed since login so the effect wouldn't re-trigger either,
  // causing the toast to be silently lost and the URL params to linger forever.
  //
  // Fix: stash the params in a ref immediately on mount (before any user check),
  // then show the toast once user becomes available (post-login). This handles
  // both cases: user already logged in when redirected back, or needs to log in first.
  const oauthParamRef = useRef({
    connected: searchParams.get('connected'),
    pending:   searchParams.get('pending'),
    error:     searchParams.get('error'),
  });

  // Clear params from URL immediately so they don't linger or re-trigger
  useEffect(() => {
    const { connected, pending, error } = oauthParamRef.current;
    if (connected || pending || error) setSearchParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the toast as soon as user is available (immediately if already logged in,
  // or right after login if they had to authenticate first)
  useEffect(() => {
    if (!user) return;
    const { connected, pending, error } = oauthParamRef.current;
    if (!connected && !pending && !error) return;

    if (connected) {
      showToast(`${decodeURIComponent(connected)} connected!`, 'success');
      refetch();
    }
    if (pending) {
      showToast(`${decodeURIComponent(pending)} submitted — awaiting admin approval`, 'info');
    }
    if (error) {
      const msgs = {
        auth_init_failed:      'Failed to start OAuth flow',
        token_exchange_failed: 'OAuth token exchange failed — please try again',
        access_denied:         'Access denied by Google',
        no_code:               'No authorisation code received',
        request_create_failed: 'Account connected but request could not be saved — please try again',
      };
      showToast(msgs[error] || `OAuth error: ${error}`, 'error');
    }

    // Consume — don't show again on re-renders
    oauthParamRef.current = { connected: null, pending: null, error: null };
  }, [user]); // fires once on mount if already logged in, or once after login

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setToastOpen(true);
  }

  const handleLogin  = (userData) => { setUser(userData); setTab('dashboard'); };
  const handleLogout = async () => {
    // FIX: Revoke the token server-side before clearing local state.
    // The server adds it to a denylist so it can't be reused even if intercepted.
    await logoutApi();
    localStorage.removeItem('pr_token');
    localStorage.removeItem('pr_user');
    setUser(null);
  };
  const handleToastClose = (_, reason) => { if (reason === 'clickaway') return; setToastOpen(false); };

  if (!user) return <ThemeProvider theme={theme}><CssBaseline /><Login onLogin={handleLogin} /></ThemeProvider>;

  const severity = ['success','error','warning','info'].includes(toast?.type) ? toast.type : 'success';
  const isAdmin  = isAdminRole(user.role);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
        <Topbar
          tab={tab} setTab={setTab}
          onToast={showToast} refetch={refetch}
          worker={worker} data={data}
          user={user} onLogout={handleLogout}
          pendingCount={pendingCount}
        />
        <Box component="main" sx={{ flex: 1, maxWidth: 1400, width: '100%', mx: 'auto', px: { xs: 2, sm: 3, md: 4 }, py: { xs: 2, sm: 3 }, boxSizing: 'border-box' }}>
          {tab === 'dashboard' && (
            <Dashboard
              data={data} refetch={refetch} onToast={showToast}
              worker={worker}
              allActivity={allActivity}   /* admin: full map */
              myActivity={myActivity}     /* all users: scoped to their accounts */
              userRole={user.role}
            />
          )}
          {tab === 'accounts'         && <Accounts         data={data} refetch={refetch} onToast={showToast} worker={worker} user={user} myActivity={myActivity} />}
          {tab === 'beacons'          && <Beacons          data={data} beaconSamples={worker.beaconSamples} />}
          {tab === 'logs'             && <Logs             accountStatuses={worker.accountStatuses} />}
          {tab === 'reports'          && <Reports          onToast={showToast} />}
          {tab === 'run-history'      && <RunHistory       data={data} />}
          {tab === 'my-requests'      && !isAdmin && <MyRequests onToast={showToast} />}
          {tab === 'account-requests' && isAdmin  && <AccountRequests onToast={showToast} />}
          {tab === 'admin'            && isAdmin  && <AdminPanel onToast={showToast} user={user} />}
        </Box>
        <Snackbar open={toastOpen} autoHideDuration={3500} onClose={handleToastClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <Alert severity={severity} onClose={handleToastClose} sx={{ width: '100%', fontSize: 13 }}>
            {toast?.message}
          </Alert>
        </Snackbar>
      </Box>
    </ThemeProvider>
  );
}
