/**
 * RunHistory — per-account full run timeline
 *
 * Shows every recorded run for each account, newest first.
 * Includes: timestamp, emails processed, beacons fired, success rate, spam rescued, stopped-early flag.
 * Filterable by account and date range.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Box, Card, CardContent, Typography, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, Chip, Select, MenuItem,
  FormControl, InputLabel, CircularProgress, Tooltip, IconButton, LinearProgress,
} from '@mui/material';
import RefreshIcon       from '@mui/icons-material/Refresh';
import WarningAmberIcon  from '@mui/icons-material/WarningAmber';
import CheckCircleIcon   from '@mui/icons-material/CheckCircle';
import { getRunHistory } from '../utils/api';

const rateColor = r => r >= 95 ? '#10B981' : r >= 80 ? '#F59E0B' : '#EF4444';

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function duration(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return '—';
  const ms = new Date(finishedAt) - new Date(startedAt);
  if (ms < 0) return '—';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export default function RunHistory({ data }) {
  const accounts = data?.accounts || [];
  const [selectedEmail, setSelectedEmail] = useState('all');
  const [history, setHistory]   = useState({});   // { email: [...runs] }
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getRunHistory(null, 200);
      setHistory(res.data.history || {});
    } catch {
      setHistory({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Build flat list to display
  const accountEmails = accounts.map(a => a.email);

  const rows = Object.entries(history)
    .filter(([email]) => selectedEmail === 'all' || email === selectedEmail)
    .flatMap(([email, runs]) => (Array.isArray(runs) ? runs : []).map(r => ({ ...r, email })))
    .sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));

  // Per-account summary stats
  const summaries = accountEmails.map(email => {
    const runs = history[email] || [];
    if (!runs.length) return { email, totalRuns: 0, totalEmails: 0, totalBeacons: 0, avgRate: 0 };
    return {
      email,
      totalRuns:    runs.length,
      totalEmails:  runs.reduce((s, r) => s + r.emailsProcessed, 0),
      totalBeacons: runs.reduce((s, r) => s + r.pixelsFired, 0),
      avgRate:      +(runs.reduce((s, r) => s + r.successRate, 0) / runs.length).toFixed(1),
    };
  }).filter(s => s.totalRuns > 0);

  return (
    <Box>
      {/* Summary cards */}
      {summaries.length > 0 && (
        <Box sx={{ display: 'flex', gap: 2, mb: 3, overflowX: 'auto', pb: 1 }}>
          {summaries.map(s => (
            <Card key={s.email} onClick={() => setSelectedEmail(s.email === selectedEmail ? 'all' : s.email)}
              sx={{ minWidth: 200, flex: '0 0 auto', cursor: 'pointer',
                border: selectedEmail === s.email ? '1px solid rgba(0,229,255,0.4)' : '1px solid rgba(255,255,255,0.06)',
                transition: 'border 0.15s', '&:hover': { border: '1px solid rgba(0,229,255,0.25)' } }}>
              <CardContent sx={{ p: '14px !important' }}>
                <Typography sx={{ fontSize: 10, fontFamily: 'DM Mono, monospace', color: 'text.disabled',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', mb: 1 }}>
                  {s.email}
                </Typography>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Box>
                    <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#00E5FF', lineHeight: 1 }}>{s.totalRuns}</Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9 }}>runs</Typography>
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: 20, fontWeight: 800, color: rateColor(s.avgRate), lineHeight: 1 }}>{s.avgRate}%</Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9 }}>avg rate</Typography>
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#7C3AED', lineHeight: 1 }}>{s.totalBeacons.toLocaleString()}</Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9 }}>beacons</Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* Table */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', fontSize: 11, letterSpacing: '0.08em' }}>
              RUN TIMELINE
            </Typography>
            <Box sx={{ flex: 1 }} />
            {accounts.length > 1 && (
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel sx={{ fontSize: 12 }}>Account</InputLabel>
                <Select value={selectedEmail} label="Account" onChange={e => setSelectedEmail(e.target.value)} sx={{ fontSize: 12 }}>
                  <MenuItem value="all">All accounts</MenuItem>
                  {accountEmails.map(e => <MenuItem key={e} value={e} sx={{ fontSize: 11, fontFamily: 'DM Mono, monospace' }}>{e}</MenuItem>)}
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
            <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress size={24} /></Box>
          ) : rows.length === 0 ? (
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', textAlign: 'center', py: 4 }}>
              No run history yet. Run some accounts to see the timeline here.
            </Typography>
          ) : (
            <TableContainer component={Paper} elevation={0} sx={{ bgcolor: 'transparent' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {['Account', 'Finished', 'Duration', 'Emails', 'Beacons', 'Rate', 'Spam rescued', ''].map((col, i) => (
                      <TableCell key={col || i} sx={{ color: 'text.disabled', fontSize: 10, fontFamily: 'DM Mono, monospace', py: 1, whiteSpace: 'nowrap' }}>{col}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={i} sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' } }}>
                      <TableCell sx={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#00E5FF', py: 1, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.email}
                      </TableCell>
                      <TableCell sx={{ fontSize: 10, color: 'text.secondary', py: 1, whiteSpace: 'nowrap', fontFamily: 'DM Mono, monospace' }}>
                        {fmt(r.finishedAt)}
                      </TableCell>
                      <TableCell sx={{ fontSize: 10, color: 'text.secondary', py: 1, fontFamily: 'DM Mono, monospace' }}>
                        {duration(r.startedAt, r.finishedAt)}
                      </TableCell>
                      <TableCell sx={{ fontSize: 11, fontWeight: 600, py: 1 }}>
                        {(r.emailsProcessed || 0).toLocaleString()}
                      </TableCell>
                      <TableCell sx={{ fontSize: 11, color: '#7C3AED', fontWeight: 600, py: 1 }}>
                        {(r.pixelsFired || 0).toLocaleString()}
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography sx={{ fontSize: 11, fontWeight: 700, color: rateColor(r.successRate || 0), fontFamily: 'DM Mono, monospace', minWidth: 38 }}>
                            {(r.successRate || 0).toFixed(1)}%
                          </Typography>
                          <LinearProgress variant="determinate" value={r.successRate || 0}
                            sx={{ flex: 1, height: 3, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.06)',
                              '& .MuiLinearProgress-bar': { bgcolor: rateColor(r.successRate || 0) } }} />
                        </Box>
                      </TableCell>
                      <TableCell sx={{ fontSize: 10, color: 'text.secondary', py: 1 }}>
                        {r.spamRescued > 0 ? (
                          <Chip label={r.spamRescued} size="small" sx={{ height: 18, fontSize: 10,
                            bgcolor: 'rgba(245,158,11,0.1)', color: '#F59E0B', fontFamily: 'DM Mono, monospace' }} />
                        ) : '—'}
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        {r.stoppedEarly ? (
                          <Tooltip title="Stopped early by user">
                            <WarningAmberIcon sx={{ fontSize: 14, color: '#F59E0B' }} />
                          </Tooltip>
                        ) : (
                          <Tooltip title="Completed normally">
                            <CheckCircleIcon sx={{ fontSize: 14, color: 'rgba(16,185,129,0.4)' }} />
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
