/**
 * AdminPanel — Admin + SuperAdmin
 * Sections:
 *   1. User Management     (canManageUsers permission — superadmin always, admin/user if granted)
 *   2. Role Permissions    (superadmin only)
 *   3. Worker Config       (superadmin only) — delays + concurrency
 *   4. Live Activity       (admin + superadmin) — all users' current runs
 *   5. Completed Runs      (admin + superadmin) — today's finished runs
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { toUTC, dateFormatter, dateOnlyFormatter } from '../utils/helper';
import {
  Box, Card, CardContent, Typography, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, Chip, IconButton,
  Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions,
  Select, MenuItem, FormControl, InputLabel, Switch, FormControlLabel,
  Tooltip, Divider, Grid, Slider, CircularProgress, useTheme, useMediaQuery,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddIcon           from '@mui/icons-material/Add';
import SearchIcon        from '@mui/icons-material/Search';
import InputAdornment    from '@mui/material/InputAdornment';
import LockResetIcon     from '@mui/icons-material/LockReset';
import InfoOutlinedIcon  from '@mui/icons-material/InfoOutlined';
import RefreshIcon       from '@mui/icons-material/Refresh';
import ConfirmDialog     from '../components/ConfirmDialog';
import {
  getUsers, createUser, deleteUser, updateUserRole,
  resetPassword, getPermissions, updatePermissions,
  getWorkerConfig, patchWorkerConfig, getActivity,
} from '../utils/api';

const ROLES       = ['superadmin', 'admin', 'user'];
const ROLE_LABELS = { superadmin: 'Super Admin', admin: 'Admin', user: 'User' };
const PERM_LABELS = {
  canManageUsers:       'Manage Users',
  canConnectAccounts:   'Connect Gmail Accounts',
  canRunWorker:         'Run / Stop Worker',
  canViewReports:       'View Reports',
  canDeleteAccounts:    'Delete Accounts',
  canChangePermissions: 'Change Permissions',
};

const roleColor = r => r === 'superadmin' ? 'error' : r === 'admin' ? 'warning' : 'default';
const roleColorHex = r => r === 'superadmin' ? '#EF4444' : r === 'admin' ? '#F59E0B' : '#10B981';

const phaseColor = {
  fetching:   '#00E5FF',
  processing: '#7C3AED',
  done:       '#10B981',
  error:      '#EF4444',
  idle:       '#6B7280',
};

export default function AdminPanel({ onToast, user }) {
  const isSuperAdmin    = user?.role === 'superadmin';
  const canManageUsers  = isSuperAdmin || !!(user?.permissions?.canManageUsers);
  const theme           = useTheme();
  const isMobile        = useMediaQuery(theme.breakpoints.down('sm'));

  // ── User management state ───────────────────────────────────────────────────
  const [users,       setUsers]       = useState([]);
  const [permissions, setPermissions] = useState({});
  const [loading,     setLoading]     = useState(true);

  const [createOpen,  setCreateOpen]  = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole,     setNewRole]     = useState('user');

  const [resetOpen,   setResetOpen]   = useState(false);
  const [resetTarget, setResetTarget] = useState('');
  const [resetPw,     setResetPw]     = useState('');

  const [deleteTarget,  setDeleteTarget]  = useState(null);
  const [roleConfirm,   setRoleConfirm]   = useState(null);  // { username, role }
  const [userSearch,    setUserSearch]    = useState('');

  // ── Worker config state ─────────────────────────────────────────────────────
  const [config,         setConfig]         = useState(null);
  const [configLoading,  setConfigLoading]  = useState(false);
  const [configDirty,    setConfigDirty]    = useState(false);
  const [localConfig,    setLocalConfig]    = useState(null);

  // ── Activity state ──────────────────────────────────────────────────────────
  const [activity,       setActivity]       = useState({});
  const activityInterval = useRef(null);

  // ── Load everything ─────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const promises = [getActivity()];
      if (canManageUsers) promises.push(getUsers());
      if (isSuperAdmin)   promises.push(getPermissions(), getWorkerConfig());

      const results = await Promise.allSettled(promises);
      if (results[0].status === 'fulfilled') setActivity(results[0].value.data.activity || {});

      let idx = 1;
      if (canManageUsers && results[idx]?.status === 'fulfilled') {
        setUsers(results[idx].value.data.users);
        idx++;
      }
      if (isSuperAdmin) {
        if (results[idx]?.status === 'fulfilled')   setPermissions(results[idx].value.data.permissions);
        if (results[idx+1]?.status === 'fulfilled') {
          const cfg = results[idx+1].value.data.config;
          setConfig(cfg);
          setLocalConfig(cfg);
        }
      }
    } catch { onToast('Failed to load admin data', 'error'); }
    finally { setLoading(false); }
  }, [isSuperAdmin, canManageUsers]);

  useEffect(() => {
    load();
    // Poll activity every 5s
    activityInterval.current = setInterval(async () => {
      try {
        const res = await getActivity();
        setActivity(res.data.activity || {});
      } catch {}
    }, 5000);
    return () => clearInterval(activityInterval.current);
  }, [load]);

  // ── User management handlers ────────────────────────────────────────────────
  const usernameAlreadyExists = newUsername.trim().length > 0 &&
    users.some(u => u.username.toLowerCase() === newUsername.trim().toLowerCase());

  const handleCreate = async () => {
    if (!newUsername || !newPassword) { onToast('Fill all fields', 'warning'); return; }
    if (usernameAlreadyExists) { onToast(`Username "${newUsername}" is already taken`, 'warning'); return; }
    if (newPassword.length < 8) { onToast('Password must be at least 8 characters', 'warning'); return; }
    try {
      await createUser({ username: newUsername, password: newPassword, role: newRole });
      onToast(`User "${newUsername}" created`, 'success');
      setCreateOpen(false); setNewUsername(''); setNewPassword(''); setNewRole('user');
      load();
    } catch (err) { onToast(err.response?.data?.error || 'Failed to create user', 'error'); }
  };

  const handleDelete = async () => {
    try { await deleteUser(deleteTarget); onToast(`User ${deleteTarget} deleted`); load(); }
    catch (err) { onToast(err.response?.data?.error || 'Failed', 'error'); }
    finally { setDeleteTarget(null); }
  };

  const handleRoleChange = (username, role) => {
    setRoleConfirm({ username, role });
  };

  const confirmRoleChange = async () => {
    if (!roleConfirm) return;
    try {
      await updateUserRole(roleConfirm.username, roleConfirm.role);
      onToast(`${roleConfirm.username} is now ${ROLE_LABELS[roleConfirm.role]}`);
      load();
    } catch { onToast('Failed to update role', 'error'); }
    setRoleConfirm(null);
  };

  const handleResetPw = async () => {
    if (!resetPw || resetPw.length < 8) { onToast('Password must be at least 8 characters', 'warning'); return; }
    try {
      await resetPassword(resetTarget, resetPw);
      onToast(`Password reset for ${resetTarget}`, 'success');
      setResetOpen(false);
      setResetPw('');
      setResetTarget('');
    } catch (err) {
      onToast(err.response?.data?.error || 'Failed to reset password', 'error');
    }
  };

  const handlePermissionToggle = async (role, key, value) => {
    try {
      const res = await updatePermissions(role, { [key]: value });
      setPermissions(res.data.permissions);
      onToast(`${ROLE_LABELS[role]}: ${PERM_LABELS[key]} ${value ? 'enabled' : 'disabled'}`);
    } catch { onToast('Failed to update permission', 'error'); }
  };

  // ── Worker config handlers ───────────────────────────────────────────────────
  const handleConfigChange = (key, value) => {
    setLocalConfig(prev => ({ ...prev, [key]: value }));
    setConfigDirty(true);
  };

  const handleSaveConfig = async () => {
    setConfigLoading(true);
    try {
      const res = await patchWorkerConfig(localConfig);
      setConfig(res.data.config);
      setLocalConfig(res.data.config);
      setConfigDirty(false);
      onToast('Worker config saved', 'success');
    } catch { onToast('Failed to save config', 'error'); }
    finally { setConfigLoading(false); }
  };

  // ── Derived activity data ────────────────────────────────────────────────────
  const activeUsers = Object.entries(activity).filter(([, e]) => e.running);
  const allCompleted = Object.entries(activity).flatMap(([username, e]) =>
    (e.completed || []).map(c => ({ ...c, username }))
  ).sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt)).slice(0, 30);

  if (loading) return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 8 }}>
      <CircularProgress size={32} />
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>

      {/* ── Live Activity ─────────────────────────────────────────────────── */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', fontSize: 11 }}>
                LIVE ACTIVITY
              </Typography>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: activeUsers.length > 0 ? '#10B981' : '#4B5563',
                boxShadow: activeUsers.length > 0 ? '0 0 8px #10B981' : 'none',
                animation: activeUsers.length > 0 ? 'blink 1.5s infinite' : 'none',
                '@keyframes blink': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.3 } },
              }} />
            </Box>
            <Tooltip title="Refresh activity">
              <IconButton size="small" onClick={load} sx={{ color: 'text.disabled', p: 0.5 }}>
                <RefreshIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>

          {activeUsers.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="caption" color="text.disabled">No users currently running — activity will appear here in real time</Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {activeUsers.map(([username, entry]) => (
                <Box key={username} sx={{ bgcolor: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 2, p: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#7C3AED', boxShadow: '0 0 6px #7C3AED' }} />
                    <Typography sx={{ fontSize: 12, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: '#A78BFA' }}>
                      {username}
                    </Typography>
                    <Chip label="RUNNING" size="small" sx={{ fontSize: 9, height: 18, bgcolor: 'rgba(124,58,237,0.2)', color: '#A78BFA', fontFamily: 'DM Mono, monospace' }} />
                  </Box>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {(entry.accounts || []).map(acc => (
                      <Box key={acc.email} sx={{ bgcolor: 'rgba(0,0,0,0.3)', borderRadius: 1.5, px: 1.5, py: 0.75, border: '1px solid rgba(255,255,255,0.06)' }}>
                        <Typography sx={{ fontSize: 11, fontFamily: 'DM Mono, monospace', color: 'text.primary' }}>
                          {acc.email.split('@')[0]}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, mt: 0.25 }}>
                          <Typography sx={{ fontSize: 9, color: phaseColor[acc.phase] || '#9CA3AF', fontFamily: 'DM Mono, monospace' }}>
                            {acc.phase}
                          </Typography>
                          {acc.total > 0 && (
                            <Typography sx={{ fontSize: 9, color: 'text.disabled', fontFamily: 'DM Mono, monospace' }}>
                              {acc.done}/{acc.total}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* ── Completed Runs ───────────────────────────────────────────────────── */}
      <Card>
        <CardContent>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', display: 'block', mb: 2, fontSize: 11 }}>
            COMPLETED RUNS — LAST 30
          </Typography>

          {allCompleted.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="caption" color="text.disabled">No completed runs yet today</Typography>
            </Box>
          ) : (
            <TableContainer component={Paper} elevation={0} sx={{ bgcolor: 'transparent', overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {['User', 'Account', 'Emails', 'Beacons', 'Rate', 'Spam Rescued', 'Finished'].map((col, i) => (
                      <TableCell key={col || i} sx={{ color: 'text.disabled', fontSize: 10, fontFamily: 'DM Mono, monospace', py: 0.75 }}>{col}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {allCompleted.map((c, i) => (
                    <TableRow key={i} sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' } }}>
                      <TableCell>
                        <Chip label={c.username} size="small" sx={{ fontSize: 10, height: 20, bgcolor: `${roleColorHex('user')}15`, color: roleColorHex('user'), fontFamily: 'DM Mono, monospace' }} />
                      </TableCell>
                      <TableCell sx={{ fontSize: 11, fontFamily: 'DM Mono, monospace', color: 'text.primary' }}>
                        {c.email}
                      </TableCell>
                      <TableCell sx={{ fontSize: 12, fontFamily: 'DM Mono, monospace', color: '#00E5FF' }}>
                        {c.emails}
                      </TableCell>
                      <TableCell sx={{ fontSize: 12, fontFamily: 'DM Mono, monospace', color: '#7C3AED' }}>
                        {c.beacons}
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: 12, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: c.rate >= 95 ? '#10B981' : c.rate >= 85 ? '#F59E0B' : '#EF4444' }}>
                          {c.rate}%
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ fontSize: 11, color: '#00E5FF', fontFamily: 'DM Mono, monospace' }}>
                        {c.spam > 0 ? `+${c.spam}` : '—'}
                      </TableCell>
                      <TableCell sx={{ fontSize: 10, color: 'text.disabled', fontFamily: 'DM Mono, monospace', whiteSpace: 'nowrap' }}>
                        {toUTC(c.finishedAt).toLocaleTimeString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* Worker Config — superadmin only */}
      {isSuperAdmin && (
        <>
          {/* ── Worker Config ──────────────────────────────────────────────── */}
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', fontSize: 11 }}>
                  WORKER CONFIGURATION
                </Typography>
                <Button size="small" variant="contained" onClick={handleSaveConfig}
                  disabled={!configDirty || configLoading}
                  sx={{ fontSize: 11, bgcolor: configDirty ? 'rgba(0,229,255,0.15)' : 'rgba(255,255,255,0.05)', color: configDirty ? '#00E5FF' : 'text.disabled', border: `1px solid ${configDirty ? 'rgba(0,229,255,0.3)' : 'rgba(255,255,255,0.08)'}`, boxShadow: 'none' }}>
                  {configLoading ? 'Saving...' : 'Save Config'}
                </Button>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3, px: 2, py: 1.5, borderRadius: 2, bgcolor: 'rgba(0,229,255,0.05)', border: '1px solid rgba(0,229,255,0.15)' }}>
                <InfoOutlinedIcon sx={{ color: '#00E5FF', fontSize: 16, flexShrink: 0 }} />
                <Typography sx={{ fontSize: 11, color: '#67E8F9' }}>
                  Config is applied at the start of every run for all users. Changes take effect on the next run.
                </Typography>
              </Box>

              {localConfig && (
                <Grid container spacing={4}>
                  <Grid item xs={12} sm={4}>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
                      Concurrency Limit
                    </Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 2 }}>
                      Max accounts running per user at once. Others queue.
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Slider
                        value={localConfig.concurrencyLimit}
                        onChange={(_, v) => handleConfigChange('concurrencyLimit', v)}
                        min={1} max={20} step={1}
                        sx={{ color: '#7C3AED', flex: 1 }}
                      />
                      <Box sx={{ minWidth: 40, textAlign: 'center', fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 800, color: '#7C3AED' }}>
                        {localConfig.concurrencyLimit}
                      </Box>
                    </Box>
                    <Typography variant="caption" color="text.disabled">1 – 20 accounts</Typography>
                  </Grid>

                  <Grid item xs={12} sm={4}>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
                      Batch Delay
                    </Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 2 }}>
                      Wait time between each batch of 5 emails. Slows down runs to appear more human.
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Slider
                        value={localConfig.batchDelayMs}
                        onChange={(_, v) => handleConfigChange('batchDelayMs', v)}
                        min={0} max={10000} step={500}
                        sx={{ color: '#00E5FF', flex: 1 }}
                      />
                      <Box sx={{ minWidth: 50, textAlign: 'center', fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 800, color: '#00E5FF' }}>
                        {localConfig.batchDelayMs / 1000}s
                      </Box>
                    </Box>
                    <Typography variant="caption" color="text.disabled">0 – 10 seconds</Typography>
                  </Grid>

                  <Grid item xs={12} sm={4}>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
                      Email Jitter
                    </Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 2 }}>
                      Max random delay between individual emails within a batch.
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Slider
                        value={localConfig.emailJitterMs}
                        onChange={(_, v) => handleConfigChange('emailJitterMs', v)}
                        min={0} max={3000} step={250}
                        sx={{ color: '#10B981', flex: 1 }}
                      />
                      <Box sx={{ minWidth: 50, textAlign: 'center', fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 800, color: '#10B981' }}>
                        {localConfig.emailJitterMs / 1000}s
                      </Box>
                    </Box>
                    <Typography variant="caption" color="text.disabled">0 – 3 seconds</Typography>
                  </Grid>

                  {/* FIX #14: Batch size now configurable */}
                  <Grid item xs={12} sm={4}>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
                      Batch Size
                    </Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 2 }}>
                      Emails processed in parallel per account per batch.
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Slider
                        value={localConfig.batchSize || 5}
                        onChange={(_, v) => handleConfigChange('batchSize', v)}
                        min={1} max={20} step={1}
                        sx={{ color: '#F59E0B', flex: 1 }}
                      />
                      <Box sx={{ minWidth: 40, textAlign: 'center', fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 800, color: '#F59E0B' }}>
                        {localConfig.batchSize || 5}
                      </Box>
                    </Box>
                    <Typography variant="caption" color="text.disabled">1 – 20 emails per batch</Typography>
                  </Grid>

                  {/* FIX #9: Max accounts per user cap */}
                  <Grid item xs={12} sm={4}>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
                      Max Accounts Per User
                    </Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 2 }}>
                      Max Gmail accounts any single user can connect. Prevents API quota abuse.
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Slider
                        value={localConfig.maxAccountsPerUser || 10}
                        onChange={(_, v) => handleConfigChange('maxAccountsPerUser', v)}
                        min={1} max={50} step={1}
                        sx={{ color: '#EF4444', flex: 1 }}
                      />
                      <Box sx={{ minWidth: 40, textAlign: 'center', fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 800, color: '#EF4444' }}>
                        {localConfig.maxAccountsPerUser || 10}
                      </Box>
                    </Box>
                    <Typography variant="caption" color="text.disabled">1 – 50 accounts per user</Typography>
                  </Grid>
                </Grid>
              )}
            </CardContent>
          </Card>

        </>
      )}

      {/* User Management — visible to any user with canManageUsers permission */}
      {canManageUsers && (
        <>
          {/* ── User Management ─────────────────────────────────────────────── */}
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', fontSize: 11 }}>
                  USER MANAGEMENT
                </Typography>
                <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}
                  sx={{ borderColor: 'rgba(0,229,255,0.3)', color: '#00E5FF', fontSize: 11 }}>
                  Create User
                </Button>
              </Box>
              {/* <TextField
                size="small" placeholder="Search users..." value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: 'text.disabled' }} /></InputAdornment> }}
                sx={{ mb: 2, width: 240, '& .MuiInputBase-input': { fontSize: 12 } }}
              /> */}

              {isMobile ? (
                /* ── Mobile: user cards ── */
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {users
                    .filter(u => isSuperAdmin || u.role !== 'superadmin')
                    .filter(u => !userSearch || u.username.toLowerCase().includes(userSearch.toLowerCase()))
                    .sort((a, b) => {
                      if (a.username === user?.username) return -1;
                      if (b.username === user?.username) return 1;
                      return a.username.localeCompare(b.username);
                    })
                    .map(u => (
                    <Box key={u.username} sx={{
                      p: 1.5,
                      borderRadius: 2,
                      bgcolor: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.07)',
                      borderLeft: `3px solid ${u.role === 'superadmin' ? '#8a1d1d' : u.role === 'admin' ? '#F59E0B' : '#0c4d37'}`,
                    }}>
                      {/* Top: username + role selector */}
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography sx={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700 }}>
                            {u.username}
                          </Typography>
                          {u.username === user?.username && (
                            <Chip label="You" size="small" sx={{ height: 15, fontSize: 9, fontFamily: 'DM Mono, monospace', bgcolor: 'rgba(0,229,255,0.1)', color: '#00E5FF', border: '1px solid rgba(0,229,255,0.2)' }} />
                          )}
                        </Box>
                        <FormControl size="small" variant="standard">
                          <Select value={u.role} onChange={e => handleRoleChange(u.username, e.target.value)}
                            disableUnderline sx={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: u.role === 'superadmin' ? '#EF4444' : u.role === 'admin' ? '#F59E0B' : '#10B981' }}>
                            {ROLES.filter(r => isSuperAdmin || r !== 'superadmin').map(r => (
                              <MenuItem key={r} value={r} sx={{ fontSize: 11 }}>{ROLE_LABELS[r]}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Box>
                      {/* Meta row */}
                      <Box sx={{ display: 'flex', gap: 2, mb: 1.25 }}>
                        <Box>
                          <Typography sx={{ fontSize: 9, color: 'text.disabled', fontFamily: 'DM Mono, monospace', mb: 0.25 }}>CREATED</Typography>
                          <Typography sx={{ fontSize: 10, color: 'text.secondary', fontFamily: 'DM Mono, monospace' }}>{dateOnlyFormatter(u.createdAt)}</Typography>
                        </Box>
                        <Box>
                          <Typography sx={{ fontSize: 9, color: 'text.disabled', fontFamily: 'DM Mono, monospace', mb: 0.25 }}>LAST LOGIN</Typography>
                          <Typography sx={{ fontSize: 10, color: 'text.secondary', fontFamily: 'DM Mono, monospace' }}>{u.lastLogin ? dateFormatter(u.lastLogin) : '—'}</Typography>
                        </Box>
                        <Box>
                          <Typography sx={{ fontSize: 9, color: 'text.disabled', fontFamily: 'DM Mono, monospace', mb: 0.25 }}>PROFILES</Typography>
                          <Typography sx={{ fontSize: 10, color: '#00E5FF', fontFamily: 'DM Mono, monospace' }}>
                            {(u.profileCount ?? '—')}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography sx={{ fontSize: 9, color: 'text.disabled', fontFamily: 'DM Mono, monospace', mb: 0.25 }}>ACCOUNTS</Typography>
                          <Typography sx={{ fontSize: 10, color: 'text.secondary', fontFamily: 'DM Mono, monospace' }}>
                            {(u.accountCount ?? '—')}
                          </Typography>
                        </Box>
                      </Box>
                      {/* Actions */}
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button size="small" startIcon={<LockResetIcon sx={{ fontSize: 13 }} />}
                          onClick={() => { setResetTarget(u.username); setResetOpen(true); }}
                          sx={{ fontSize: 10, color: '#F59E0B', bgcolor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 1.5, py: 0.4, px: 1, minWidth: 0, textTransform: 'none' }}>
                          Reset pw
                        </Button>
                        <Button size="small" startIcon={<DeleteOutlineIcon sx={{ fontSize: 13 }} />}
                          onClick={() => setDeleteTarget(u.username)}
                          sx={{ fontSize: 10, color: '#EF4444', bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 1.5, py: 0.4, px: 1, minWidth: 0, textTransform: 'none' }}>
                          Delete
                        </Button>
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : (
                /* ── Desktop: table ── */
                <TableContainer component={Paper} elevation={0} sx={{ bgcolor: 'transparent' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {['Username', 'Role', 'Profiles', 'Accounts', 'Last Login', 'Created', 'Actions'].map((col, i) => (
                          <TableCell key={col || i} sx={{ color: 'text.disabled', fontSize: 10, fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em' }}>{col}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {users
                        .filter(u => isSuperAdmin || u.role !== 'superadmin')
                        .filter(u => !userSearch || u.username.toLowerCase().includes(userSearch.toLowerCase()))
                        .sort((a, b) => {
                          if (a.username === user?.username) return -1;
                          if (b.username === user?.username) return 1;
                          return a.username.localeCompare(b.username);
                        })
                        .map(u => (
                        <TableRow key={u.username} sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' } }}>
                          <TableCell sx={{ fontFamily: 'DM Mono, monospace', fontSize: 12 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              {u.username}
                              {u.username === user?.username && (
                                <Chip label="You" size="small" sx={{ height: 16, fontSize: 9, fontFamily: 'DM Mono, monospace', bgcolor: 'rgba(0,229,255,0.1)', color: '#00E5FF', border: '1px solid rgba(0,229,255,0.2)' }} />
                              )}
                            </Box>
                          </TableCell>
                          <TableCell>
                            <FormControl size="small" variant="standard">
                              <Select value={u.role} onChange={e => handleRoleChange(u.username, e.target.value)}
                                disableUnderline sx={{ fontFamily: 'DM Mono, monospace', fontSize: 11 }}>
                                {ROLES.filter(r => isSuperAdmin || r !== 'superadmin').map(r => (
                                  <MenuItem key={r} value={r} sx={{ fontSize: 11 }}>{ROLE_LABELS[r]}</MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          </TableCell>
                          <TableCell sx={{ fontSize: 11, color: '#00E5FF', fontFamily: 'DM Mono, monospace' }}>
                            {u.profileCount ?? '—'}
                          </TableCell>
                          <TableCell sx={{ fontSize: 11, color: 'text.secondary', fontFamily: 'DM Mono, monospace' }}>
                            {u.accountCount ?? '—'}
                          </TableCell>
                          <TableCell sx={{ fontSize: 11, color: 'text.secondary' }}>
                            {u.lastLogin ? dateFormatter(u.lastLogin) : '—'}
                          </TableCell>
                          <TableCell sx={{ fontSize: 11, color: 'text.secondary' }}>
                            {dateOnlyFormatter(u.createdAt)}
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                              <Tooltip title="Reset password">
                                <IconButton size="small" onClick={() => { setResetTarget(u.username); setResetOpen(true); }}
                                  sx={{ color: '#F59E0B', bgcolor: 'rgba(245,158,11,0.08)', borderRadius: 1.5 }}>
                                  <LockResetIcon sx={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Delete user">
                                <IconButton size="small" onClick={() => setDeleteTarget(u.username)}
                                  sx={{ color: '#EF4444', bgcolor: 'rgba(239,68,68,0.08)', borderRadius: 1.5 }}>
                                  <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>

        </>
      )}

      {/* Role Permissions and Worker Config — superadmin only */}
      {isSuperAdmin && (
        <>
          {/* ── Role Permissions ─────────────────────────────────────────────── */}
          <Card>
            <CardContent>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', fontSize: 11, display: 'block', mb: 2 }}>
                ROLE PERMISSIONS — LIVE CONTROL
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, px: 2, py: 1.5, borderRadius: 2, bgcolor: 'rgba(0,229,255,0.05)', border: '1px solid rgba(0,229,255,0.15)' }}>
                <InfoOutlinedIcon sx={{ color: '#00E5FF', fontSize: 16, flexShrink: 0 }} />
                <Typography sx={{ fontSize: 11, color: '#67E8F9' }}>
                  Changes take effect immediately for all users with that role — no restart needed.
                </Typography>
              </Box>

              <Grid container spacing={2}>
                {['admin', 'user'].map(role => (
                  <Grid item xs={12} md={6} key={role}>
                    <Box sx={{ p: 2, border: '1px solid rgba(255,255,255,0.06)', borderRadius: 2 }}>
                      <Chip label={ROLE_LABELS[role]} color={roleColor(role)} size="small" sx={{ mb: 2, fontFamily: 'DM Mono, monospace', fontSize: 11 }} />
                      {Object.keys(PERM_LABELS).map(key => (
                        <Box key={key} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.5 }}>
                          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>{PERM_LABELS[key]}</Typography>
                          <Switch size="small"
                            checked={!!(permissions[role]?.[key])}
                            onChange={e => handlePermissionToggle(role, key, e.target.checked)}
                            disabled={key === 'canViewReports'}
                            sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#00E5FF' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#00E5FF' } }}
                          />
                        </Box>
                      ))}
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── Dialogs ────────────────────────────────────────────────────────── */}
      <Dialog open={createOpen} onClose={() => { setCreateOpen(false); setNewUsername(''); setNewPassword(''); setNewRole('user'); }} PaperProps={{ sx: { bgcolor: 'background.paper', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3, minWidth: 360 } }}>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>Create New User</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          <TextField
            label="Username"
            size="small"
            value={newUsername}
            onChange={e => setNewUsername(e.target.value)}
            autoFocus
            fullWidth
            error={usernameAlreadyExists}
            helperText={usernameAlreadyExists ? 'Username already exists' : ' '}
            FormHelperTextProps={{ sx: { fontSize: 11, mx: 0 } }}
          />
          <TextField label="Password" type="password" size="small" value={newPassword} onChange={e => setNewPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()} fullWidth />
          <FormControl size="small" fullWidth>
            <InputLabel>Role</InputLabel>
            <Select value={newRole} label="Role" onChange={e => setNewRole(e.target.value)}>
              {ROLES.filter(r => isSuperAdmin || r !== 'superadmin').map(r => (
                <MenuItem key={r} value={r}>{ROLE_LABELS[r]}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button size="small" onClick={() => { setCreateOpen(false); setNewUsername(''); setNewPassword(''); setNewRole('user'); }}
            sx={{ color: 'text.secondary', bgcolor: 'rgba(255,255,255,0.05)', '&:hover': { bgcolor: 'rgba(255,255,255,0.09)' } }}>
            Cancel
          </Button>
          <Button size="small" variant="contained" onClick={handleCreate} disabled={!newUsername || !newPassword || usernameAlreadyExists}>
            Create User
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={resetOpen} onClose={() => { setResetOpen(false); setResetPw(''); }} PaperProps={{ sx: { bgcolor: 'background.paper', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3, minWidth: 360 } }}>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>Reset Password — {resetTarget}</DialogTitle>
        <DialogContent sx={{ pt: '12px !important' }}>
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 2 }}>
            Enter a new password for <Box component="span" sx={{ color: 'text.primary', fontFamily: 'DM Mono, monospace' }}>{resetTarget}</Box>. They will need to log in again.
          </Typography>
          <TextField
            label="New Password"
            type="password"
            size="small"
            value={resetPw}
            onChange={e => setResetPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleResetPw()}
            autoFocus
            fullWidth
            placeholder="Min 8 characters"
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button size="small" onClick={() => { setResetOpen(false); setResetPw(''); }}
            sx={{ color: 'text.secondary', bgcolor: 'rgba(255,255,255,0.05)', '&:hover': { bgcolor: 'rgba(255,255,255,0.09)' } }}>
            Cancel
          </Button>
          <Button size="small" variant="contained" color="warning" onClick={handleResetPw} disabled={!resetPw}>
            Reset Password
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!roleConfirm}
        title="Change user role"
        message={`Change ${roleConfirm?.username}'s role to ${ROLE_LABELS[roleConfirm?.role]}? This will update their permissions immediately.`}
        confirmLabel="Change role"
        confirmColor="warning"
        onConfirm={confirmRoleChange}
        onClose={() => setRoleConfirm(null)}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete User"
        message={`Permanently delete "${deleteTarget}"? They will be immediately logged out.`}
        confirmLabel="Delete User"
        confirmColor="error"
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </Box>
  );
}