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
  Box, Card, CardContent, Typography, LinearProgress, Chip,
  IconButton, Tooltip, Button, useTheme, useMediaQuery,
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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

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
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: isMobile ? 1.5 : 2 }}>
        {accounts.map(a => {
          const live      = mergedStatuses[a.email] || {};
          const running   = isLiveRunning(live);
          const progress  = live.total ? Math.round((live.done / live.total) * 100) : 0;
          const isPaused  = a.status === 'paused';
          const rate      = a.stats?.successRate || 0;
          const accentColor = running ? '#7C3AED' : rateColor(rate);

          return (
            <Card key={a.email} sx={{
              border: running ? '1px solid rgba(124,58,237,0.45)' : '1px solid rgba(255,255,255,0.06)',
              borderLeft: `3px solid ${accentColor}`,
              transition: 'border 0.2s',
            }}>
              <CardContent sx={{ p: isMobile ? '12px !important' : '16px !important' }}>
                {/* Email + status badge */}
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1, gap: 1 }}>
                  <Typography sx={{ fontSize: 11, fontFamily: 'DM Mono, monospace', color: '#00E5FF',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {a.email}
                  </Typography>
                  <Chip size="small"
                    label={running ? 'Running' : a.status}
                    color={running ? 'secondary' : a.status === 'active' ? 'success' : a.status === 'warning' ? 'warning' : a.status === 'error' ? 'error' : 'default'}
                    sx={{ fontSize: 9, height: 18, fontFamily: 'DM Mono, monospace', flexShrink: 0 }}
                  />
                </Box>

                {isAdmin && a.owner && (
                  <Typography sx={{ fontSize: 9, color: 'text.disabled', fontFamily: 'DM Mono, monospace', mb: 1 }}>
                    owner: {a.owner}
                  </Typography>
                )}

                {/* Rate headline */}
                <Typography sx={{ fontSize: isMobile ? 28 : 36, fontWeight: 800, color: rateColor(rate), lineHeight: 1, mb: 0.25 }}>
                  {rate}%
                </Typography>

                {/* Stats pills */}
                <Box sx={{ display: 'flex', gap: 1, mb: running ? 1.25 : 1.5, flexWrap: 'wrap' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                    {(a.stats?.emailsProcessed || 0).toLocaleString()} emails
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: 10, color: '#7C3AED' }}>
                    {(a.stats?.pixelsFired || 0).toLocaleString()} beacons
                  </Typography>
                </Box>

                {/* Live progress */}
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
                    <LinearProgress variant={live.total ? 'determinate' : 'indeterminate'} value={progress}
                      sx={{ height: 3, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.06)', '& .MuiLinearProgress-bar': { bgcolor: '#7C3AED' } }} />
                  </Box>
                )}

                {/* Action buttons */}
                <Box sx={{ display: 'flex', gap: 0.75 }}>
                  {running ? (
                    <Button fullWidth size="small" startIcon={<StopIcon sx={{ fontSize: 12 }} />}
                      onClick={() => setStopTarget(a.email)}
                      sx={{ fontSize: 10, color: '#EF4444', bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 1.5, py: 0.5, textTransform: 'none',
                        '&:hover': { bgcolor: 'rgba(239,68,68,0.15)' } }}>
                      Stop
                    </Button>
                  ) : (
                    <>
                      <Tooltip title={isPaused ? 'Resume account first' : `Run ${a.email}`}>
                        <span style={{ flex: 1 }}>
                          <Button fullWidth size="small" startIcon={<PlayArrowIcon sx={{ fontSize: 12 }} />}
                            onClick={() => handleRun(a)} disabled={isPaused}
                            sx={{ fontSize: 10, color: '#00E5FF', bgcolor: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.25)', borderRadius: 1.5, py: 0.5, textTransform: 'none',
                              '&:hover': { bgcolor: 'rgba(0,229,255,0.15)' }, '&.Mui-disabled': { opacity: 0.3 } }}>
                            Run
                          </Button>
                        </span>
                      </Tooltip>
                      <Button size="small"
                        startIcon={isPaused ? <ReplayIcon sx={{ fontSize: 12 }} /> : <PauseIcon sx={{ fontSize: 12 }} />}
                        onClick={() => setPauseTarget({ email: a.email, action: isPaused ? 'resume' : 'pause' })}
                        sx={{ fontSize: 10, color: isPaused ? '#10B981' : '#F59E0B',
                          bgcolor: isPaused ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
                          border: `1px solid ${isPaused ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}`,
                          borderRadius: 1.5, py: 0.5, px: 1, minWidth: 0, textTransform: 'none' }}>
                        {isPaused ? 'Resume' : 'Pause'}
                      </Button>
                      <Tooltip title="Disconnect account">
                        <IconButton size="small" onClick={() => setDeleteTarget(a.email)}
                          sx={{ color: '#EF4444', bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 1.5 }}>
                          <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    </>
                  )}
                </Box>
              </CardContent>
            </Card>
          );
        })}

        {/* Add account card */}
        <Card onClick={connectGmail} sx={{ border: '1px dashed rgba(0,229,255,0.2)', cursor: 'pointer',
          '&:hover': { border: '1px dashed rgba(0,229,255,0.5)', bgcolor: 'rgba(0,229,255,0.02)' }, transition: 'all 0.2s' }}>
          <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: isMobile ? 100 : 140, gap: 1 }}>
            <AddIcon sx={{ color: '#00E5FF', fontSize: 28, opacity: 0.5 }} />
            <Typography sx={{ color: '#00E5FF', opacity: 0.7, fontSize: 12, fontWeight: 600 }}>Connect Gmail Account</Typography>
            <Typography variant="caption" color="text.disabled" sx={{ textAlign: 'center', fontSize: 10 }}>
              Submits a request for admin approval
            </Typography>
          </CardContent>
        </Card>
      </Box>

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