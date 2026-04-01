/**
 * MyRequests — user-facing page to see their own account connection requests.
 *
 * - Shows all requests submitted by the current user with live status
 * - Rejected requests show the rejection reason + a "Re-request" button
 *   which resets the record to pending without a new OAuth flow
 * - Approved requests show a success state
 * - Pending shows a waiting indicator
 */
import { useState, useEffect, useCallback } from 'react';
import { toUTC, dateFormatter, dateOnlyFormatter } from '../utils/helper';
import {
  Box, Card, CardContent, Typography, Chip, Button, CircularProgress,
  Tooltip, IconButton, Divider,
} from '@mui/material';
import RefreshIcon              from '@mui/icons-material/Refresh';
import CheckCircleOutlineIcon   from '@mui/icons-material/CheckCircleOutline';
import HourglassEmptyIcon       from '@mui/icons-material/HourglassEmpty';
import CancelOutlinedIcon       from '@mui/icons-material/CancelOutlined';
import ReplayIcon               from '@mui/icons-material/Replay';
import AddIcon                  from '@mui/icons-material/Add';
import { getAccountRequests, reRequestAccount, connectGmail } from '../utils/api';

const STATUS = {
  pending:  { color: '#F59E0B', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.2)',  label: 'Pending approval', Icon: HourglassEmptyIcon },
  approved: { color: '#10B981', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.2)',  label: 'Approved',         Icon: CheckCircleOutlineIcon },
  rejected: { color: '#EF4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.2)',   label: 'Rejected',         Icon: CancelOutlinedIcon },
};

function fmt(iso) {
  if (!iso) return '—';
  return toUTC(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export default function MyRequests({ onToast, data, user }) {
  const [requests, setRequests] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [busy,     setBusy]     = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAccountRequests();
      setRequests(res.data.requests || []);
    } catch {
      onToast('Failed to load requests', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleReRequest = async (email) => {
    setBusy(b => ({ ...b, [email]: true }));
    try {
      await reRequestAccount(email);
      onToast(`${email} re-submitted — awaiting admin approval`, 'info');
      load();
    } catch (err) {
      onToast(err.response?.data?.error || 'Re-request failed', 'error');
    } finally {
      setBusy(b => ({ ...b, [email]: false }));
    }
  };

  const pending  = requests.filter(r => r.status === 'pending');
  const approved = requests.filter(r => r.status === 'approved');
  const rejected = requests.filter(r => r.status === 'rejected');

  if (loading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
      <CircularProgress size={28} />
    </Box>
  );

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3, gap: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 18, fontWeight: 700 }}>My Account Requests</Typography>
          <Typography variant="caption" color="text.secondary">
            Gmail accounts you've connected — pending admin approval
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={load} sx={{ color: 'text.secondary' }}>
              <RefreshIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Button variant="outlined" size="small" startIcon={<AddIcon sx={{ fontSize: 14 }} />} onClick={() => connectGmail(user?.activeProfileId)} disabled= {data?.slotsRemaining === 0}
            sx={{ borderColor: 'rgba(0,229,255,0.3)', color: '#00E5FF', fontSize: 11, py: 0.5, whiteSpace: 'nowrap',
              '&:hover': { borderColor: '#00E5FF', bgcolor: 'rgba(0,229,255,0.06)' } }}>
            Connect
          </Button>
        </Box>
      </Box>

      {requests.length === 0 ? (
        <Card sx={{ border: '1px dashed rgba(255,255,255,0.08)' }}>
          <CardContent sx={{ py: 6, textAlign: 'center' }}>
            <AddIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
            <Typography color="text.secondary" sx={{ mb: 2 }}>No account requests yet</Typography>
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => connectGmail(user?.activeProfileId)}
              sx={{ borderColor: 'rgba(0,229,255,0.3)', color: '#00E5FF' }}>
              Connect a Gmail account
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {/* Sort: rejected first (action needed), then pending, then approved */}
          {[...rejected, ...pending, ...approved].map(r => {
            const s = STATUS[r.status] || STATUS.pending;
            const Icon = s.Icon;
            return (
              <Card key={r.email} sx={{ border: `1px solid ${s.border}`, bgcolor: s.bg }}>
                <CardContent sx={{ p: '16px !important' }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
                    {/* Icon */}
                    <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: `${s.color}18`,
                      border: `1px solid ${s.color}33`, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', flexShrink: 0 }}>
                      <Icon sx={{ fontSize: 18, color: s.color }} />
                    </Box>

                    {/* Content */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
                        <Typography sx={{ fontSize: 13, fontFamily: 'DM Mono, monospace', fontWeight: 600, wordBreak: 'break-all' }}>
                          {r.email}
                        </Typography>
                        <Box sx={{ px: 1, py: 0.2, borderRadius: 1, bgcolor: `${s.color}20`, color: s.color, fontSize: 10, fontFamily: 'DM Mono, monospace', flexShrink: 0 }}>
                          {s.label}
                        </Box>
                      </Box>

                      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10, fontFamily: 'DM Mono, monospace' }}>
                          Requested: {fmt(r.requestedAt)}
                        </Typography>
                        {r.reviewedAt && (
                          <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10, fontFamily: 'DM Mono, monospace' }}>
                            Reviewed: {fmt(r.reviewedAt)}
                            {r.reviewedBy ? ` by ${r.reviewedBy}` : ''}
                          </Typography>
                        )}
                      </Box>

                      {/* Rejection reason */}
                      {r.status === 'rejected' && r.rejectReason && (
                        <Box sx={{ mt: 1, p: 1.5, bgcolor: 'rgba(239,68,68,0.06)', borderRadius: 1.5, border: '1px solid rgba(239,68,68,0.15)' }}>
                          <Typography variant="caption" sx={{ color: '#EF4444', fontSize: 11 }}>
                            <strong>Reason:</strong> {r.rejectReason}
                          </Typography>
                        </Box>
                      )}

                      {/* Approved — active notice */}
                      {r.status === 'approved' && (
                        <Typography variant="caption" sx={{ color: '#10B981', fontSize: 11, display: 'block', mt: 0.5 }}>
                          ✓ This account is now active and will appear in your Accounts list
                        </Typography>
                      )}
                    </Box>

                    {/* Re-request button for rejected */}
                    {r.status === 'rejected' && (
                      <Button size="small" startIcon={busy[r.email] ? <CircularProgress size={12} /> : <ReplayIcon sx={{ fontSize: 13 }} />}
                        disabled={!!busy[r.email]}
                        onClick={() => handleReRequest(r.email)}
                        sx={{ color: '#F59E0B', bgcolor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 1.5,
                          fontSize: 11, flexShrink: 0, py: 0.5, px: 1.25, textTransform: 'none',
                          '&:hover': { bgcolor: 'rgba(245,158,11,0.15)' },
                          '&.Mui-disabled': { opacity: 0.5 } }}>
                        Re-request
                      </Button>
                    )}
                  </Box>
                </CardContent>
              </Card>
            );
          })}
        </Box>
      )}

      {/* Quick stats */}
      {requests.length > 0 && (
        <Box sx={{ display: 'flex', gap: 2, mt: 3, flexWrap: 'wrap' }}>
          {[
            { label: 'Pending',  count: pending.length,  color: '#F59E0B' },
            { label: 'Approved', count: approved.length, color: '#10B981' },
            { label: 'Rejected', count: rejected.length, color: '#EF4444' },
          ].map(s => s.count > 0 && (
            <Box key={s.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75,
              bgcolor: 'rgba(255,255,255,0.03)', borderRadius: 1.5, px: 1.5, py: 0.75,
              border: '1px solid rgba(255,255,255,0.06)' }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: s.color }} />
              <Typography sx={{ fontSize: 12, color: s.color }}>{s.count} {s.label}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}