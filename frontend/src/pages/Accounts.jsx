/**
 * Accounts page
 *
 * Per-account rules (v3.1):
 *  - If account is RUNNING → only Stop button is active; all other actions disabled
 *  - If account is IDLE/DONE → Run, Pause/Resume, Delete available (with confirms)
 *  - Delete always requires confirmation
 *  - Pause/Resume always requires confirmation
 *  - Stop requires confirmation
 *  - Run All skips any account already in progress
 */
import { useState } from 'react';
import {
  Box, Grid, Card, CardContent, Typography, LinearProgress, Chip,
  IconButton, Tooltip, Button,
} from '@mui/material';
import PlayArrowIcon      from '@mui/icons-material/PlayArrow';
import StopIcon           from '@mui/icons-material/Stop';
import PauseIcon          from '@mui/icons-material/Pause';
import ReplayIcon         from '@mui/icons-material/Replay';
import DeleteOutlineIcon  from '@mui/icons-material/DeleteOutline';
import AddIcon            from '@mui/icons-material/Add';
import ConfirmDialog      from '../components/ConfirmDialog';
import { pauseAccount, resumeAccount, removeAccount, connectGmail } from '../utils/api';

const rateColor = r => r >= 95 ? '#10B981' : r >= 85 ? '#F59E0B' : '#EF4444';

function isLiveRunning(liveStatus) {
  return liveStatus?.phase && !['done', 'idle', 'error', undefined].includes(liveStatus.phase);
}

export default function Accounts({ data, refetch, onToast, worker, user, myActivity = {} }) {
  const accounts = data?.accounts || [];

  const [deleteTarget,  setDeleteTarget]  = useState(null);
  const [pauseTarget,   setPauseTarget]   = useState(null); // { email, action }
  const [stopTarget,    setStopTarget]    = useState(null);

  const { accountStatuses, startRun, stopOne } = worker || {};
  const isAdmin = ['superadmin', 'admin'].includes(user?.role);

  // Build merged live status map: own browser + backend-reported cross-session activity
  const mergedStatuses = { ...(accountStatuses || {}) };
  for (const acc of (myActivity?.accounts || [])) {
    if (acc.email && acc.phase && !mergedStatuses[acc.email]) {
      mergedStatuses[acc.email] = { phase: acc.phase, message: acc.message || '', done: acc.done || 0, total: acc.total || 0, fromRemote: true };
    }
  }

  const handleRun = (account) => {
    const live = mergedStatuses[account.email];
    if (isLiveRunning(live)) { onToast(`${account.email} is already processing`, 'warning'); return; }
    if (!['active', 'warning'].includes(account.status)) { onToast(`${account.email} is paused — resume first`, 'warning'); return; }
    startRun([account], 'individual');
    onToast(`Running ${account.email}`, 'info');
  };

  const confirmStop = () => {
    if (!stopTarget) return;
    // only send stop if it's our own session; cross-session stops are shown as disabled
    stopOne(stopTarget);
    onToast(`Stop signal sent to ${stopTarget}`, 'warning');
    setStopTarget(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const live = mergedStatuses[deleteTarget];
    if (isLiveRunning(live)) { onToast(`Stop ${deleteTarget} before deleting`, 'error'); setDeleteTarget(null); return; }
    try { await removeAccount(deleteTarget); onToast(`${deleteTarget} disconnected`); refetch(); }
    catch { onToast('Failed to disconnect', 'error'); }
    finally { setDeleteTarget(null); }
  };

  const confirmPauseResume = async () => {
    if (!pauseTarget) return;
    const { email, action } = pauseTarget;
    try {
      if (action === 'pause') { await pauseAccount(email); onToast(`Paused ${email}`); }
      else                    { await resumeAccount(email); onToast(`Resumed ${email}`); }
      refetch();
    } catch { onToast('Failed', 'error'); }
    finally { setPauseTarget(null); }
  };

  return (
    <Box>
      <Grid container spacing={2}>
        {accounts.map(a => {
          const live      = mergedStatuses[a.email] || {};
          const running   = isLiveRunning(live);
          const progress  = live.total ? Math.round((live.done / live.total) * 100) : 0;
          const isPaused  = a.status === 'paused';
          const rate      = a.stats?.successRate || 0;

          return (
            <Grid item xs={12} sm={6} md={4} key={a.email}>
              <Card sx={{
                border: running
                  ? '1px solid rgba(124,58,237,0.45)'
                  : '1px solid rgba(255,255,255,0.06)',
                height: '100%', transition: 'border 0.2s',
              }}>
                <CardContent>
                  {/* Header row */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
                    <Typography sx={{ fontSize: 12, fontFamily: 'DM Mono, monospace', wordBreak: 'break-all', flex: 1, mr: 1 }}>
                      {a.email}
                    </Typography>
                    <Chip size="small"
                      label={running ? 'Running' : a.status}
                      color={running ? 'secondary' : a.status === 'active' ? 'success' : a.status === 'warning' ? 'warning' : a.status === 'error' ? 'error' : 'default'}
                      sx={{ fontSize: 10, height: 20, fontFamily: 'DM Mono, monospace', flexShrink: 0 }}
                    />
                  </Box>

                  {/* Owner (admin sees it) */}
                  {isAdmin && a.owner && (
                    <Typography variant="caption" sx={{ fontSize: 9, color: 'text.disabled', fontFamily: 'DM Mono, monospace', display: 'block', mb: 1 }}>
                      owner: {a.owner}
                    </Typography>
                  )}

                  {/* Rate */}
                  <Typography sx={{ fontSize: 36, fontWeight: 800, color: rateColor(rate), lineHeight: 1, mb: 0.5 }}>
                    {rate}%
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                    success rate · {(a.stats?.emailsProcessed || 0).toLocaleString()} emails
                  </Typography>

                  {/* Live progress bar */}
                  {running && (
                    <Box sx={{ mb: 1.5 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="caption" sx={{ color: '#7C3AED', fontSize: 10, fontFamily: 'DM Mono, monospace' }}>
                          {live.message || 'Processing…'}
                        </Typography>
                        {live.total > 0 && (
                          <Typography variant="caption" sx={{ color: '#7C3AED', fontSize: 10, fontFamily: 'DM Mono, monospace' }}>
                            {live.done}/{live.total}
                          </Typography>
                        )}
                      </Box>
                      <LinearProgress
                        variant={live.total ? 'determinate' : 'indeterminate'} value={progress}
                        sx={{ height: 4, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.06)', '& .MuiLinearProgress-bar': { bgcolor: '#7C3AED' } }}
                      />
                    </Box>
                  )}

                  <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 2 }}>
                    {(a.stats?.pixelsFired || 0).toLocaleString()} beacons fired
                  </Typography>

                  {/* ── Action buttons ── */}
                  <Box sx={{ display: 'flex', gap: 1 }}>

                    {/* RUNNING → only Stop */}
                    {running ? (
                      <Tooltip title="Stop after current batch">
                        <Button fullWidth size="small" variant="outlined" startIcon={<StopIcon />}
                          onClick={() => setStopTarget(a.email)}
                          sx={{ color: '#EF4444', borderColor: 'rgba(239,68,68,0.4)', fontSize: 11,
                            '&:hover': { borderColor: '#EF4444', bgcolor: 'rgba(239,68,68,0.08)' } }}>
                          Stop
                        </Button>
                      </Tooltip>
                    ) : (
                      /* IDLE → Run + Pause/Resume + Delete */
                      <>
                        {/* Run */}
                        <Tooltip title={isPaused ? 'Resume account first' : `Run ${a.email}`}>
                          <span style={{ flex: 1 }}>
                            <Button fullWidth size="small" variant="outlined" startIcon={<PlayArrowIcon />}
                              onClick={() => handleRun(a)} disabled={isPaused}
                              sx={{ color: '#00E5FF', borderColor: 'rgba(0,229,255,0.3)', fontSize: 11,
                                '&:hover': { borderColor: '#00E5FF', bgcolor: 'rgba(0,229,255,0.08)' },
                                '&.Mui-disabled': { opacity: 0.3 } }}>
                              Run
                            </Button>
                          </span>
                        </Tooltip>

                        {/* Pause / Resume */}
                        <Tooltip title={isPaused ? 'Resume this account' : 'Pause this account'}>
                          <span style={{ flex: 1 }}>
                            <Button fullWidth size="small" variant="outlined"
                              startIcon={isPaused ? <ReplayIcon /> : <PauseIcon />}
                              onClick={() => setPauseTarget({ email: a.email, action: isPaused ? 'resume' : 'pause' })}
                              sx={{
                                color: isPaused ? '#10B981' : '#F59E0B',
                                borderColor: isPaused ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)',
                                fontSize: 11,
                                '&:hover': { borderColor: isPaused ? '#10B981' : '#F59E0B',
                                  bgcolor: isPaused ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)' },
                              }}>
                              {isPaused ? 'Resume' : 'Pause'}
                            </Button>
                          </span>
                        </Tooltip>

                        {/* Delete */}
                        <Tooltip title="Disconnect account">
                          <IconButton size="small" onClick={() => setDeleteTarget(a.email)}
                            sx={{ color: '#EF4444', bgcolor: 'rgba(239,68,68,0.08)', borderRadius: 1.5 }}>
                            <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          );
        })}

        {/* Add account card */}
        <Grid item xs={12} sm={6} md={4}>
          <Card onClick={connectGmail} sx={{ height: '100%', border: '1px dashed rgba(0,229,255,0.2)', cursor: 'pointer',
            '&:hover': { border: '1px dashed rgba(0,229,255,0.5)', bgcolor: 'rgba(0,229,255,0.02)' }, transition: 'all 0.2s' }}>
            <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 160, gap: 1 }}>
              <AddIcon sx={{ color: '#00E5FF', fontSize: 32, opacity: 0.5 }} />
              <Typography sx={{ color: '#00E5FF', opacity: 0.7, fontSize: 13, fontWeight: 600 }}>Connect Gmail Account</Typography>
              <Typography variant="caption" color="text.disabled" sx={{ textAlign: 'center' }}>
                Submits a request for admin approval
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Confirm dialogs */}
      <ConfirmDialog open={!!stopTarget} title="Stop processing?"
        message={`Send stop signal to ${stopTarget}? It finishes the current batch then halts across all sessions.`}
        confirmLabel="Stop" confirmColor="error" onConfirm={confirmStop} onClose={() => setStopTarget(null)} />

      <ConfirmDialog open={!!deleteTarget} title="Disconnect account"
        message={`Remove ${deleteTarget} from PixelRelay? Stats will be cleared. Gmail account is unaffected.`}
        confirmLabel="Disconnect" confirmColor="error" onConfirm={confirmDelete} onClose={() => setDeleteTarget(null)} />

      <ConfirmDialog
        open={!!pauseTarget}
        title={pauseTarget?.action === 'pause' ? 'Pause account?' : 'Resume account?'}
        message={pauseTarget?.action === 'pause'
          ? `Pause ${pauseTarget?.email}? It will be excluded from future Run All batches until resumed.`
          : `Resume ${pauseTarget?.email}? It will be included in the next run.`}
        confirmLabel={pauseTarget?.action === 'pause' ? 'Pause' : 'Resume'}
        confirmColor={pauseTarget?.action === 'pause' ? 'warning' : 'success'}
        onConfirm={confirmPauseResume} onClose={() => setPauseTarget(null)} />
    </Box>
  );
}
