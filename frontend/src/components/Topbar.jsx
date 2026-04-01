import { useState, useEffect } from 'react';
import {
  AppBar, Toolbar, Box, Button, Chip, Tabs, Tab,
  IconButton, Drawer, List, ListItemButton, ListItemText,
  useMediaQuery, useTheme, Tooltip, Avatar, Menu, MenuItem, Divider, Typography, Badge,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, InputAdornment, CircularProgress,
} from '@mui/material';
import MenuIcon          from '@mui/icons-material/Menu';
import PlayArrowIcon     from '@mui/icons-material/PlayArrow';
import StopIcon          from '@mui/icons-material/Stop';
import AddIcon           from '@mui/icons-material/Add';
import BoltIcon          from '@mui/icons-material/Bolt';
import LogoutIcon        from '@mui/icons-material/Logout';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import InboxIcon         from '@mui/icons-material/Inbox';
import HistoryIcon       from '@mui/icons-material/History';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import GetAppIcon from '@mui/icons-material/GetApp';
import LockResetIcon from '@mui/icons-material/LockReset';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { healthCheck, connectGmail, changeMyPassword } from '../utils/api';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import ProfileSwitcher from './ProfileSwitcher';

// Tabs visible per role
const TABS_BY_ROLE = {
  superadmin: ['dashboard', 'accounts', 'reports', 'beacons', 'logs', 'run-history', 'account-requests', 'admin'],
  admin:      ['dashboard', 'accounts', 'reports', 'beacons', 'logs', 'run-history', 'account-requests', 'admin'],
  user:       ['dashboard', 'accounts', 'reports', 'run-history', 'my-requests'],
};

const TAB_LABELS = {
  'dashboard':         'Dashboard',
  'accounts':          'Accounts',
  'reports':           'Reports',
  'beacons':           'Beacons',
  'logs':              'Logs',
  'run-history':       'History',
  'account-requests':  'Requests',
  'my-requests':       'My Requests',
  'admin':             'Admin',
};

const roleColor = r => r === 'superadmin' ? '#EF4444' : r === 'admin' ? '#F59E0B' : '#10B981';
const roleLabel = r => r === 'superadmin' ? 'Super Admin' : r === 'admin' ? 'Admin' : 'User';

export default function Topbar({ tab, setTab, onToast, user, onLogout, onProfileSwitch, worker, data, pendingCount = 0, ownerFilter = '', setOwnerFilter }) {
  const theme    = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [online,     setOnline]   = useState(false);
  const [pulse,      setPulse]    = useState(false);
  const [drawerOpen, setDrawer]   = useState(false);
  const [anchorEl,   setAnchorEl] = useState(null);
  const { canInstall, install, installed } = useInstallPrompt();

  // ── Change password dialog state ─────────────────────────────────────────────
  const [pwOpen,       setPwOpen]       = useState(false);
  const [pwCurrent,    setPwCurrent]    = useState('');
  const [pwNew,        setPwNew]        = useState('');
  const [pwConfirm,    setPwConfirm]    = useState('');
  const [pwSaving,     setPwSaving]     = useState(false);
  const [pwShowCur,    setPwShowCur]    = useState(false);
  const [pwShowNew,    setPwShowNew]    = useState(false);

  const pwMismatch  = pwConfirm && pwNew !== pwConfirm;
  const pwTooShort  = pwNew && pwNew.length < 8;
  const pwSameAsCur = pwNew && pwNew === pwCurrent;
  const pwValid     = pwCurrent && pwNew && pwConfirm && !pwMismatch && !pwTooShort && !pwSameAsCur;

  const handlePwOpen = () => {
    setPwCurrent(''); setPwNew(''); setPwConfirm('');
    setPwShowCur(false); setPwShowNew(false);
    setAnchorEl(null);
    setPwOpen(true);
  };

  const handlePwSubmit = async () => {
    if (!pwValid) return;
    setPwSaving(true);
    try {
      await changeMyPassword(pwCurrent, pwNew);
      onToast('Password updated successfully', 'success');
      setPwOpen(false);
    } catch (err) {
      onToast(err.response?.data?.error || 'Failed to update password', 'error');
    } finally {
      setPwSaving(false);
    }
  };

  const tabs       = TABS_BY_ROLE[user?.role] || ['dashboard'];
  const anyRunning = worker?.running    || false;
  const runAllMode = worker?.runAllMode || false;

  useEffect(() => {
    healthCheck().then(() => setOnline(true)).catch(() => setOnline(false));
    const id = setInterval(() => setPulse(p => !p), 1800);
    return () => clearInterval(id);
  }, []);

  const handleRunAll = () => {
    const liveStatuses = worker?.accountStatuses || {};
    const isAdmin = ['admin', 'superadmin'].includes(user?.role);
    const accounts = (data?.accounts || []).filter(a => {
      if (!['active', 'warning'].includes(a.status)) return false;
      const live = liveStatuses[a.email];
      if (live?.phase && !['done', 'idle', 'error'].includes(live.phase)) return false;
      // If admin has an owner filter active, only run that owner's accounts
      if (isAdmin && ownerFilter && a.owner !== ownerFilter) return false;
      return true;
    });
    if (accounts.length === 0) {
      onToast(ownerFilter ? `No idle accounts for owner "${ownerFilter}"` : 'No idle accounts to run', 'warning');
      return;
    }
    worker.startRun(accounts, 'all');
    onToast(`Starting ${accounts.length} account(s)${ownerFilter ? ` for ${ownerFilter}` : ''}`, 'success');
  };

  const handleStopAll = () => {
    worker.stopAll();
    onToast('Stop signal sent — all accounts halt after current batch', 'warning');
  };

  const canRun     = user?.permissions?.canRunWorker;
  const canConnect = user?.permissions?.canConnectAccounts || ['admin','superadmin'].includes(user?.role);
  const isAdmin    = ['admin', 'superadmin'].includes(user?.role);

  const renderTabLabel = (t) => {
    if (t === 'account-requests' && pendingCount > 0) {
      return (
        <Badge badgeContent={pendingCount} color="warning"
          sx={{ '& .MuiBadge-badge': { fontSize: 9, height: 16, minWidth: 16, top: -2, right: -4 } }}>
          {TAB_LABELS[t]}
        </Badge>
      );
    }
    return TAB_LABELS[t];
  };

  const navTabs = isMobile ? (
    <List sx={{ width: 220 }}>
      {tabs.map(t => (
        <ListItemButton key={t} selected={tab === t} onClick={() => { setTab(t); setDrawer(false); }}>
          <ListItemText
            primary={t === 'account-requests' && pendingCount > 0 ? `Requests (${pendingCount})` : TAB_LABELS[t]}
            primaryTypographyProps={{ fontSize: 13, color: t === 'account-requests' && pendingCount > 0 ? '#F59E0B' : 'inherit' }}
          />
        </ListItemButton>
      ))}
    </List>
  ) : (
    <Tabs
      value={tabs.includes(tab) ? tab : tabs[0]}
      onChange={(_, v) => setTab(v)}
      textColor="primary" indicatorColor="primary"
      sx={{ '& .MuiTab-root': { minWidth: 72, fontSize: 12, py: 0 } }}
    >
      {tabs.map(t => (
        <Tab key={t} value={t} label={renderTabLabel(t)}
          sx={t === 'account-requests' && pendingCount > 0 ? { color: '#F59E0B !important' } : {}}
        />
      ))}
    </Tabs>
  );

  return (
    <AppBar position="sticky" elevation={0}
      sx={{ bgcolor: 'rgba(8,10,15,0.97)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <Toolbar sx={{ gap: isMobile ? 1 : 2, minHeight: { xs: 56, sm: 64 } }}>
        {/* Logo */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: isMobile ? '4px' : 2, flexShrink: 0 }} onClick={() => {setTab('dashboard');  setAnchorEl(null);}} style={{ cursor: 'pointer' }}>
          <Box sx={{ width: 32, height: 32, borderRadius: 2, background: 'linear-gradient(135deg, #00E5FF 0%, #7C3AED 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 16px rgba(0,229,255,0.2)' }}>
            <BoltIcon sx={{ fontSize: 18, color: '#000' }} />
          </Box>
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
            <Box sx={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>PixelRelay</Box>
            <Box sx={{ fontSize: 9, color: 'text.secondary', fontFamily: 'DM Mono, monospace' }}>v3.1</Box>
          </Box>
        </Box>

        {!isMobile && navTabs}

        {/* Profile switcher — only for regular users */}
        {!isAdmin && user && (
          <ProfileSwitcher user={user} onProfileSwitch={onProfileSwitch} onToast={onToast} />
        )}

        <Box sx={{ flex: 1 }} />

        {/* API status */}
        {/* <Chip size="small" label={online ? 'API ONLINE' : 'API OFFLINE'}
          sx={{ fontFamily: 'DM Mono, monospace', fontSize: 10, height: 26,
            bgcolor: online ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
            color: online ? '#10B981' : '#EF4444',
            border: `1px solid ${online ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
            display: { xs: 'none', sm: 'flex' }, '& .MuiChip-label': { px: 1.5 } }}
          icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', ml: '6px !important',
            bgcolor: online ? '#10B981' : '#EF4444',
            boxShadow: pulse && online ? '0 0 8px #10B981' : 'none', transition: 'box-shadow 0.4s' }} />}
        /> */}

        {/* Run All / Stop All */}
        {canRun && !anyRunning && (
          <Button variant="contained" size="small" startIcon={<PlayArrowIcon />} onClick={handleRunAll}
            sx={{ bgcolor: 'rgba(124,58,237,0.15)', color: '#A78BFA', border: '1px solid rgba(124,58,237,0.3)', boxShadow: 'none',
              '&:hover': { bgcolor: 'rgba(124,58,237,0.25)', boxShadow: 'none' } }}>
            {'Run All'}
          </Button>
        )}
        {canRun && anyRunning && runAllMode && (
          <Tooltip title="Stop all accounts after their current batch finishes">
            <Button variant="contained" size="small" startIcon={<StopIcon />} onClick={handleStopAll}
              sx={{ bgcolor: 'rgba(239,68,68,0.15)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)', boxShadow: 'none',
                '&:hover': { bgcolor: 'rgba(239,68,68,0.25)', boxShadow: 'none' } }}>
              {isMobile ? 'Stop' : 'Stop All'}
            </Button>
          </Tooltip>
        )}
        {canRun && anyRunning && !runAllMode && (
          <Chip size="small" label="RUNNING"
            sx={{ fontFamily: 'DM Mono, monospace', fontSize: 10, height: 26,
              bgcolor: 'rgba(124,58,237,0.12)', color: '#A78BFA', border: '1px solid rgba(124,58,237,0.25)',
              animation: 'pulse 2s infinite',
              '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.6 } } }}
          />
        )}

        {/* Connect Gmail — with slot indicator for regular users */}
        {canConnect && (() => {
          const isAtCap  = !isAdmin && data?.slotsRemaining === 0;
          const showSlot = !isAdmin && data?.maxAccountsPerUser;
          return (
            <Tooltip title={isAtCap ? `Slot limit reached (${data.slotsUsed}/${data.maxAccountsPerUser} used including pending requests)` : ''}>
              <span>
                <Button variant="outlined" size="small" startIcon={<AddIcon />}
                  onClick={() => connectGmail(user?.activeProfileId)} color="primary" disabled={isAtCap}
                  sx={{ borderColor: 'rgba(0,229,255,0.3)', display: { xs: 'none', sm: 'flex' },
                    '&.Mui-disabled': { borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.2)' } }}>
                  {showSlot
                    ? `Connect Gmail (${data.slotsUsed}/${data.maxAccountsPerUser})`
                    : 'Connect Gmail'}
                </Button>
              </span>
            </Tooltip>
          );
        })()}

        {/* Avatar menu */}
        <Tooltip title={`${user?.username} (${roleLabel(user?.role)})`}>
          <Avatar onClick={e => setAnchorEl(e.currentTarget)}
            sx={{ width: 30, height: 30, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              bgcolor: 'rgba(255,255,255,0.08)', border: `2px solid ${roleColor(user?.role)}`, color: roleColor(user?.role) }}>
            {user?.username?.[0]?.toUpperCase()}
          </Avatar>
        </Tooltip>

        <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}
          PaperProps={{ sx: { bgcolor: 'background.paper', minWidth: 190, border: '1px solid rgba(255,255,255,0.08)' } }}>
          <Box sx={{ px: 2, py: 1 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{user?.username}</Typography>
            <Chip label={roleLabel(user?.role)} size="small"
              sx={{ fontSize: 9, height: 18, mt: 0.5, bgcolor: `${roleColor(user?.role)}22`, color: roleColor(user?.role), fontFamily: 'DM Mono, monospace' }} />
          </Box>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />

          <MenuItem onClick={() => { setTab('run-history'); setAnchorEl(null); }} sx={{ fontSize: 13, gap: 1 }}>
            <HistoryIcon sx={{ fontSize: 16 }} /> Run History
          </MenuItem>

          <MenuItem onClick={handlePwOpen} sx={{ fontSize: 13, gap: 1 }}>
            <LockResetIcon sx={{ fontSize: 16 }} /> Change Password
          </MenuItem>

          {!isAdmin && (
            <MenuItem onClick={() => { setTab('my-requests'); setAnchorEl(null); }} sx={{ fontSize: 13, gap: 1 }}>
              <HourglassEmptyIcon sx={{ fontSize: 16 }} /> My Requests
            </MenuItem>
          )}

          {isAdmin && [
            <MenuItem key="requests" onClick={() => { setTab('account-requests'); setAnchorEl(null); }} sx={{ fontSize: 13, gap: 1 }}>
              <Badge badgeContent={pendingCount} color="warning" sx={{ '& .MuiBadge-badge': { fontSize: 9, height: 16, minWidth: 16 } }}>
                <InboxIcon sx={{ fontSize: 16 }} />
              </Badge>
              Account Requests
            </MenuItem>,
            <MenuItem key="admin" onClick={() => { setTab('admin'); setAnchorEl(null); }} sx={{ fontSize: 13, gap: 1 }}>
              <AdminPanelSettingsIcon sx={{ fontSize: 16 }} /> Admin Panel
            </MenuItem>,
          ]}

          {canInstall && (
            <MenuItem onClick={async () => { await install(); setAnchorEl(null); }} sx={{ fontSize: 13, gap: 1, color: '#00E5FF' }}>
              <GetAppIcon sx={{ fontSize: 16 }} /> Add to Home Screen
            </MenuItem>
          )}

          <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />
          <MenuItem onClick={() => { onLogout(); setAnchorEl(null); }} sx={{ fontSize: 13, gap: 1, color: '#EF4444' }}>
            <LogoutIcon sx={{ fontSize: 16 }} /> Sign Out
          </MenuItem>
        </Menu>

        {isMobile && (
          <IconButton onClick={() => setDrawer(true)} size="small" sx={{ color: 'text.secondary' }}>
            <MenuIcon />
          </IconButton>
        )}
      </Toolbar>

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawer(false)}
        PaperProps={{ sx: { bgcolor: 'background.paper' } }}>
        <Box sx={{ pt: 2 }}>
          {navTabs}
          {canConnect && (() => {
            const isAtCap = !isAdmin && data?.slotsRemaining === 0;
            return (
              <Box sx={{ px: 2, pt: 2 }}>
                <Button fullWidth variant="outlined" color="primary" startIcon={<AddIcon />}
                  disabled={isAtCap}
                  onClick={() => { connectGmail(user?.activeProfileId); setDrawer(false); }}>
                  {isAtCap
                    ? `Slots full (${data.slotsUsed}/${data.maxAccountsPerUser})`
                    : 'Connect Gmail'}
                </Button>
              </Box>
            );
          })()}
          {canInstall && (
            <Box sx={{ px: 2, pt: 1.5 }}>
              <Button fullWidth variant="outlined" startIcon={<GetAppIcon />}
                onClick={async () => { await install(); setDrawer(false); }}
                sx={{ borderColor: 'rgba(0,229,255,0.3)', color: '#00E5FF',
                  '&:hover': { borderColor: '#00E5FF', bgcolor: 'rgba(0,229,255,0.06)' } }}>
                Add to Home Screen
              </Button>
            </Box>
          )}
        </Box>
      </Drawer>

      {/* ── Change Password Dialog ─────────────────────────────────────── */}
      <Dialog open={pwOpen} onClose={() => !pwSaving && setPwOpen(false)} maxWidth="xs" fullWidth
        PaperProps={{ sx: { bgcolor: 'background.paper', border: '1px solid rgba(255,255,255,0.08)' } }}>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 700, pb: 1 }}>Change Password</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          <TextField
            label="Current password" type={pwShowCur ? 'text' : 'password'}
            value={pwCurrent} onChange={e => setPwCurrent(e.target.value)}
            size="small" fullWidth autoComplete="current-password"
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setPwShowCur(v => !v)} edge="end">
                    {pwShowCur ? <VisibilityOffIcon sx={{ fontSize: 16 }} /> : <VisibilityIcon sx={{ fontSize: 16 }} />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          <TextField
            label="New password" type={pwShowNew ? 'text' : 'password'}
            value={pwNew} onChange={e => setPwNew(e.target.value)}
            size="small" fullWidth autoComplete="new-password"
            error={!!pwTooShort || !!pwSameAsCur}
            helperText={pwTooShort ? 'At least 8 characters' : pwSameAsCur ? 'Must differ from current password' : ' '}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setPwShowNew(v => !v)} edge="end">
                    {pwShowNew ? <VisibilityOffIcon sx={{ fontSize: 16 }} /> : <VisibilityIcon sx={{ fontSize: 16 }} />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          <TextField
            label="Confirm new password" type="password"
            value={pwConfirm} onChange={e => setPwConfirm(e.target.value)}
            size="small" fullWidth autoComplete="new-password"
            error={!!pwMismatch}
            helperText={pwMismatch ? 'Passwords do not match' : ' '}
            onKeyDown={e => e.key === 'Enter' && pwValid && handlePwSubmit()}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button size="small" onClick={() => setPwOpen(false)} disabled={pwSaving}
            sx={{ color: 'text.secondary' }}>
            Cancel
          </Button>
          <Button size="small" variant="contained" onClick={handlePwSubmit}
            disabled={!pwValid || pwSaving}
            sx={{ bgcolor: 'rgba(0,229,255,0.15)', color: '#00E5FF',
              border: '1px solid rgba(0,229,255,0.3)', boxShadow: 'none',
              '&:hover': { bgcolor: 'rgba(0,229,255,0.25)', boxShadow: 'none' },
              '&.Mui-disabled': { opacity: 0.4 } }}>
            {pwSaving ? <CircularProgress size={14} sx={{ color: '#00E5FF' }} /> : 'Update Password'}
          </Button>
        </DialogActions>
      </Dialog>
    </AppBar>
  );
}