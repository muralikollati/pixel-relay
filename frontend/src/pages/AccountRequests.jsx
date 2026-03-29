/**
 * AccountRequests — Admin / SuperAdmin page
 *
 * Shows all Gmail account connection requests grouped by status.
 * Admins can: approve individually, reject (with optional reason),
 * approve all pending, or approve all pending for a specific user.
 */
import { useState, useEffect, useCallback } from 'react';
import { toUTC, dateFormatter, dateOnlyFormatter } from '../utils/helper';
import {
  Box, Card, CardContent, Typography, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, Chip, IconButton,
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Tooltip, Divider, Badge, CircularProgress, Select,
  MenuItem, FormControl, InputLabel, useTheme, useMediaQuery,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CancelOutlinedIcon     from '@mui/icons-material/CancelOutlined';
import DeleteOutlineIcon      from '@mui/icons-material/DeleteOutline';
import DoneAllIcon            from '@mui/icons-material/DoneAll';
import PersonIcon             from '@mui/icons-material/Person';
import RefreshIcon            from '@mui/icons-material/Refresh';
import PendingActionsIcon     from '@mui/icons-material/PendingActions';
import ConfirmDialog          from '../components/ConfirmDialog';
import {
  getAccountRequests, approveRequest, rejectRequest,
  approveAllRequests, approveUserRequests, deleteAccountRequest,
} from '../utils/api';

const STATUS_COLOR = {
  pending:  { color: '#F59E0B', bg: 'rgba(245,158,11,0.1)',  label: 'Pending'  },
  approved: { color: '#10B981', bg: 'rgba(16,185,129,0.1)',  label: 'Approved' },
  rejected: { color: '#EF4444', bg: 'rgba(239,68,68,0.1)',   label: 'Rejected' },
};

function StatusChip({ status }) {
  const s = STATUS_COLOR[status] || STATUS_COLOR.pending;
  return (
    <Box sx={{ display: 'inline-block', px: 1, py: 0.3, borderRadius: 1, bgcolor: s.bg, color: s.color, fontSize: 10, fontFamily: 'DM Mono, monospace' }}>
      {s.label}
    </Box>
  );
}

export default function AccountRequests({ onToast }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [requests,      setRequests]      = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [filterStatus,  setFilterStatus]  = useState('all');
  const [filterUser,    setFilterUser]    = useState('all');

  // Reject dialog
  const [rejectTarget,  setRejectTarget]  = useState(null);
  const [rejectReason,  setRejectReason]  = useState('');

  // Delete confirm
  const [deleteTarget,  setDeleteTarget]  = useState(null);

  // Approve-all-for-user confirm
  const [userApproveTarget, setUserApproveTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAccountRequests();
      setRequests(res.data.requests || []);
    } catch {
      onToast('Failed to load account requests', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (email) => {
    try {
      await approveRequest(email);
      onToast(`${email} approved and activated`, 'success');
      load();
    } catch (err) {
      onToast(err.response?.data?.error || 'Approve failed', 'error');
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    try {
      await rejectRequest(rejectTarget, rejectReason);
      onToast(`${rejectTarget} rejected`, 'warning');
      setRejectTarget(null);
      setRejectReason('');
      load();
    } catch (err) {
      onToast(err.response?.data?.error || 'Reject failed', 'error');
    }
  };

  const handleApproveAll = async () => {
    try {
      const res = await approveAllRequests();
      onToast(`${res.data.count} account(s) approved`, 'success');
      load();
    } catch {
      onToast('Bulk approve failed', 'error');
    }
  };

  const handleApproveUser = async () => {
    if (!userApproveTarget) return;
    try {
      const res = await approveUserRequests(userApproveTarget);
      onToast(`${res.data.count} account(s) approved for ${userApproveTarget}`, 'success');
      setUserApproveTarget(null);
      load();
    } catch {
      onToast('User approve failed', 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteAccountRequest(deleteTarget);
      onToast(`Request for ${deleteTarget} deleted`, 'info');
      setDeleteTarget(null);
      load();
    } catch {
      onToast('Delete failed', 'error');
    }
  };

  // Unique users for filter dropdown
  const uniqueUsers = [...new Set(requests.map(r => r.owner))].sort();

  const filtered = requests.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (filterUser   !== 'all' && r.owner   !== filterUser)  return false;
    return true;
  });

  const pendingCount   = requests.filter(r => r.status === 'pending').length;
  const approvedCount  = requests.filter(r => r.status === 'approved').length;
  const rejectedCount  = requests.filter(r => r.status === 'rejected').length;

  // Group pending by user for user-wise approve
  const pendingByUser = requests
    .filter(r => r.status === 'pending')
    .reduce((acc, r) => { acc[r.owner] = (acc[r.owner] || 0) + 1; return acc; }, {});

  return (
    <Box>
      {/* Stats row */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        {[
          { label: 'Pending',  value: pendingCount,  color: '#F59E0B' },
          { label: 'Approved', value: approvedCount, color: '#10B981' },
          { label: 'Rejected', value: rejectedCount, color: '#EF4444' },
        ].map(s => (
          <Card key={s.label} sx={{ flex: 1, minWidth: 100 }}>
            <CardContent sx={{ p: '14px !important' }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', fontSize: 10, display: 'block', mb: 0.5 }}>
                {s.label.toUpperCase()}
              </Typography>
              <Typography sx={{ fontSize: 28, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* Pending users quick-approve section */}
      {Object.keys(pendingByUser).length > 0 && (
        <Card sx={{ mb: 3, border: '1px solid rgba(245,158,11,0.2)' }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                <PendingActionsIcon sx={{ fontSize: 16, color: '#F59E0B' }} />
                Pending requests by user
              </Typography>
              <Button
                variant="outlined" size="small" startIcon={<DoneAllIcon />}
                onClick={handleApproveAll}
                sx={{ color: '#10B981', borderColor: 'rgba(16,185,129,0.4)', fontSize: 11, '&:hover': { borderColor: '#10B981', bgcolor: 'rgba(16,185,129,0.08)' } }}
              >
                Approve All ({pendingCount})
              </Button>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {Object.entries(pendingByUser).map(([user, count]) => (
                <Box key={user} sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 2, px: 1.5, py: 0.75 }}>
                  <PersonIcon sx={{ fontSize: 14, color: '#F59E0B' }} />
                  <Typography sx={{ fontSize: 12, color: '#F59E0B', fontFamily: 'DM Mono, monospace' }}>{user}</Typography>
                  <Chip label={count} size="small" sx={{ height: 18, fontSize: 10, bgcolor: 'rgba(245,158,11,0.15)', color: '#F59E0B', fontFamily: 'DM Mono, monospace' }} />
                  <Button
                    size="small" variant="text"
                    onClick={() => setUserApproveTarget(user)}
                    sx={{ fontSize: 10, color: '#10B981', p: '2px 6px', minWidth: 0, '&:hover': { bgcolor: 'rgba(16,185,129,0.1)' } }}
                  >
                    Approve all
                  </Button>
                </Box>
              ))}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Filters + table */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', fontSize: 11 }}>
              ALL REQUESTS
            </Typography>
            <Box sx={{ flex: 1 }} />

            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel sx={{ fontSize: 12 }}>Status</InputLabel>
              <Select value={filterStatus} label="Status" onChange={e => setFilterStatus(e.target.value)} sx={{ fontSize: 12 }}>
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="approved">Approved</MenuItem>
                <MenuItem value="rejected">Rejected</MenuItem>
              </Select>
            </FormControl>

            {uniqueUsers.length > 1 && (
              <FormControl size="small" sx={{ minWidth: 130 }}>
                <InputLabel sx={{ fontSize: 12 }}>User</InputLabel>
                <Select value={filterUser} label="User" onChange={e => setFilterUser(e.target.value)} sx={{ fontSize: 12 }}>
                  <MenuItem value="all">All users</MenuItem>
                  {uniqueUsers.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                </Select>
              </FormControl>
            )}

            <Tooltip title="Refresh">
              <IconButton size="small" onClick={load} sx={{ color: 'text.secondary' }}>
                <RefreshIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : filtered.length === 0 ? (
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', textAlign: 'center', py: 4 }}>
              No requests found
            </Typography>
          ) : isMobile ? (
            /* ── Mobile: request cards ── */
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {filtered.map(r => {
                const statusColor = r.status === 'approved' ? '#10B981' : r.status === 'pending' ? '#F59E0B' : '#EF4444';
                return (
                  <Box key={r.email} sx={{
                    p: 1.5, borderRadius: 2,
                    bgcolor: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    borderLeft: `3px solid ${statusColor}`,
                  }}>
                    {/* Email + status */}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75, gap: 1 }}>
                      <Typography sx={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#00E5FF',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {r.email}
                      </Typography>
                      <StatusChip status={r.status} />
                    </Box>
                    {/* Reject reason if any */}
                    {r.rejectReason && (
                      <Typography sx={{ fontSize: 10, color: '#EF4444', mb: 0.75 }}>↳ {r.rejectReason}</Typography>
                    )}
                    {/* Meta */}
                    <Box sx={{ display: 'flex', gap: 2, mb: 1.25 }}>
                      <Box>
                        <Typography sx={{ fontSize: 9, color: 'text.disabled', fontFamily: 'DM Mono, monospace' }}>BY</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <PersonIcon sx={{ fontSize: 11, color: 'text.disabled' }} />
                          <Typography sx={{ fontSize: 10, fontFamily: 'DM Mono, monospace' }}>{r.owner}</Typography>
                        </Box>
                      </Box>
                      <Box>
                        <Typography sx={{ fontSize: 9, color: 'text.disabled', fontFamily: 'DM Mono, monospace' }}>SUBMITTED</Typography>
                        <Typography sx={{ fontSize: 10, color: 'text.secondary', fontFamily: 'DM Mono, monospace' }}>{dateFormatter(r.requestedAt)}</Typography>
                      </Box>
                      {r.reviewedBy && (
                        <Box>
                          <Typography sx={{ fontSize: 9, color: 'text.disabled', fontFamily: 'DM Mono, monospace' }}>REVIEWED BY</Typography>
                          <Typography sx={{ fontSize: 10, color: 'text.secondary', fontFamily: 'DM Mono, monospace' }}>{r.reviewedBy}</Typography>
                        </Box>
                      )}
                    </Box>
                    {/* Actions */}
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      {r.status === 'pending' && (
                        <>
                          <Button size="small" startIcon={<CheckCircleOutlineIcon sx={{ fontSize: 12 }} />}
                            onClick={() => handleApprove(r.email)}
                            sx={{ fontSize: 10, color: '#10B981', bgcolor: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 1.5, py: 0.4, px: 1, textTransform: 'none', minWidth: 0 }}>
                            Approve
                          </Button>
                          <Button size="small" startIcon={<CancelOutlinedIcon sx={{ fontSize: 12 }} />}
                            onClick={() => { setRejectTarget(r.email); setRejectReason(''); }}
                            sx={{ fontSize: 10, color: '#EF4444', bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 1.5, py: 0.4, px: 1, textTransform: 'none', minWidth: 0 }}>
                            Reject
                          </Button>
                        </>
                      )}
                      {r.status === 'rejected' && (
                        <Button size="small" startIcon={<CheckCircleOutlineIcon sx={{ fontSize: 12 }} />}
                          onClick={() => handleApprove(r.email)}
                          sx={{ fontSize: 10, color: '#10B981', bgcolor: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 1.5, py: 0.4, px: 1, textTransform: 'none', minWidth: 0 }}>
                          Approve anyway
                        </Button>
                      )}
                      <Button size="small" startIcon={<DeleteOutlineIcon sx={{ fontSize: 12 }} />}
                        onClick={() => setDeleteTarget(r.email)}
                        sx={{ fontSize: 10, color: 'text.disabled', bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 1.5, py: 0.4, px: 1, textTransform: 'none', minWidth: 0,
                          '&:hover': { color: '#EF4444', bgcolor: 'rgba(239,68,68,0.08)' } }}>
                        Delete
                      </Button>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          ) : (
            /* ── Desktop: table ── */
            <TableContainer component={Paper} elevation={0} sx={{ bgcolor: 'transparent' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {['Gmail account', 'Requested by', 'Profile', 'Submitted', 'Status', 'Reviewed by', 'Actions'].map(h => (
                      <TableCell key={h} sx={{ color: 'text.disabled', fontSize: 10, fontFamily: 'DM Mono, monospace', py: 1 }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.map(r => (
                    <TableRow key={r.email} sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' } }}>
                      <TableCell sx={{ fontFamily: 'DM Mono, monospace', fontSize: 11, py: 1.25 }}>{r.email}</TableCell>
                      <TableCell sx={{ fontSize: 11, py: 1.25 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <PersonIcon sx={{ fontSize: 12, color: 'text.disabled' }} />
                          {r.owner}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ fontSize: 10, py: 1.25 }}>
                        {r.profileName ? (
                          <Chip label={r.profileName} size="small"
                            sx={{ height: 18, fontSize: 9, fontFamily: 'DM Mono, monospace',
                              bgcolor: 'rgba(0,229,255,0.08)', color: '#00E5FF',
                              border: '1px solid rgba(0,229,255,0.2)',
                              '& .MuiChip-label': { px: 1 } }} />
                        ) : (
                          <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>—</Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ fontSize: 10, color: 'text.secondary', py: 1.25, fontFamily: 'DM Mono, monospace' }}>
                        {dateFormatter(r.requestedAt)}
                      </TableCell>
                      <TableCell sx={{ py: 1.25 }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          <StatusChip status={r.status} />
                          {r.rejectReason && (
                            <Typography variant="caption" sx={{ fontSize: 9, color: '#EF4444', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.rejectReason}
                            </Typography>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ fontSize: 10, color: 'text.secondary', py: 1.25 }}>
                        {r.reviewedBy ? (
                          <Box>
                            <Typography sx={{ fontSize: 10 }}>{r.reviewedBy}</Typography>
                            {r.reviewedAt && (
                              <Typography variant="caption" sx={{ fontSize: 9, color: 'text.disabled', fontFamily: 'DM Mono, monospace' }}>
                                {dateOnlyFormatter(r.reviewedAt)}
                              </Typography>
                            )}
                          </Box>
                        ) : '—'}
                      </TableCell>
                      <TableCell sx={{ py: 1.25 }}>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          {r.status === 'pending' && (
                            <>
                              <Tooltip title="Approve">
                                <IconButton size="small" onClick={() => handleApprove(r.email)}
                                  sx={{ color: '#10B981', bgcolor: 'rgba(16,185,129,0.08)', borderRadius: 1, p: 0.5, '&:hover': { bgcolor: 'rgba(16,185,129,0.15)' } }}>
                                  <CheckCircleOutlineIcon sx={{ fontSize: 15 }} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Reject">
                                <IconButton size="small" onClick={() => { setRejectTarget(r.email); setRejectReason(''); }}
                                  sx={{ color: '#EF4444', bgcolor: 'rgba(239,68,68,0.08)', borderRadius: 1, p: 0.5, '&:hover': { bgcolor: 'rgba(239,68,68,0.15)' } }}>
                                  <CancelOutlinedIcon sx={{ fontSize: 15 }} />
                                </IconButton>
                              </Tooltip>
                            </>
                          )}
                          {r.status === 'rejected' && (
                            <Tooltip title="Approve anyway">
                              <IconButton size="small" onClick={() => handleApprove(r.email)}
                                sx={{ color: '#10B981', bgcolor: 'rgba(16,185,129,0.08)', borderRadius: 1, p: 0.5 }}>
                                <CheckCircleOutlineIcon sx={{ fontSize: 15 }} />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title="Delete request">
                            <IconButton size="small" onClick={() => setDeleteTarget(r.email)}
                              sx={{ color: 'text.disabled', bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 1, p: 0.5, '&:hover': { color: '#EF4444', bgcolor: 'rgba(239,68,68,0.08)' } }}>
                              <DeleteOutlineIcon sx={{ fontSize: 15 }} />
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

      {/* Reject dialog */}
      <Dialog open={!!rejectTarget} onClose={() => setRejectTarget(null)}
        PaperProps={{ sx: { bgcolor: 'background.paper', border: '1px solid rgba(255,255,255,0.08)', minWidth: 380 } }}>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>Reject account request</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Rejecting <Box component="span" sx={{ color: '#EF4444', fontFamily: 'DM Mono, monospace', fontSize: 12 }}>{rejectTarget}</Box>
          </Typography>
          <TextField
            fullWidth multiline rows={2} size="small"
            label="Reason (optional)"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="e.g. Duplicate account, not authorised, etc."
            sx={{ '& .MuiInputBase-root': { fontSize: 13 } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={() => setRejectTarget(null)} size="small" sx={{ color: 'text.secondary' }}>Cancel</Button>
          <Button onClick={handleReject} size="small" variant="contained" color="error" sx={{ boxShadow: 'none' }}>
            Reject
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete request"
        message={`Delete the request record for ${deleteTarget}? This only removes the request — it doesn't affect any connected accounts.`}
        confirmLabel="Delete"
        confirmColor="error"
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />

      {/* User approve confirm */}
      <ConfirmDialog
        open={!!userApproveTarget}
        title={`Approve all for ${userApproveTarget}`}
        message={`Approve all ${pendingByUser[userApproveTarget] || 0} pending account(s) from ${userApproveTarget}? They will become immediately active.`}
        confirmLabel="Approve all"
        confirmColor="success"
        onConfirm={handleApproveUser}
        onClose={() => setUserApproveTarget(null)}
      />
    </Box>
  );
}