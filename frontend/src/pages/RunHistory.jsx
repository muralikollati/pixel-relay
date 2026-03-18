/**
 * RunHistory — per-account full run timeline
 *
 * Desktop: scrollable table
 * Mobile:  stacked run cards — modern timeline feed
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Box, Card, CardContent, Typography, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, Chip, Select, MenuItem,
  FormControl, InputLabel, CircularProgress, Tooltip, IconButton,
  LinearProgress, useTheme, useMediaQuery,
} from '@mui/material';
import RefreshIcon      from '@mui/icons-material/Refresh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleIcon  from '@mui/icons-material/CheckCircle';
import { getRunHistory } from '../utils/api';
import { toUTC } from '../utils/helper';

const rateColor = r => r >= 95 ? '#10B981' : r >= 80 ? '#F59E0B' : '#EF4444';
const rateGlow  = r => r >= 95 ? '0 0 12px rgba(16,185,129,0.4)' : r >= 80 ? '0 0 12px rgba(245,158,11,0.4)' : '0 0 12px rgba(239,68,68,0.4)';

function fmt(iso) {
  if (!iso) return '—';
  // return toUTC(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtShort(iso) {
  if (!iso) return '—';
  const d = toUTC(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

function duration(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return '—';
  const ms = toUTC(finishedAt) - toUTC(startedAt);
  if (isNaN(ms) || ms < 0) return '—';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function StatPill({ label, value, color }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 0.5,
      bgcolor: `${color}10`, border: `1px solid ${color}25`,
      borderRadius: 1, px: 0.75, py: 0.25,
    }}>
      <Typography sx={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'DM Mono, monospace', lineHeight: 1.2 }}>
        {value}
      </Typography>
      <Typography sx={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'DM Mono, monospace', lineHeight: 1.2 }}>
        {label}
      </Typography>
    </Box>
  );
}


/* ── Mobile run card ─────────────────────────────────────────────────────────── */
function RunCard({ r, index }) {
  const rate     = r.successRate || 0;
  const color    = rateColor(rate);
  const dur      = duration(r.startedAt, r.finishedAt);
  return (
    <Box sx={{ position: 'relative', display: 'flex', gap: 1.5, mb: 1.5 }}>
      {/* Timeline spine */}
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, pt: 0.5 }}>
        {/* Dot */}
        <Box sx={{
          width: 10, height: 10, borderRadius: '50%',
          bgcolor: r.stoppedEarly ? '#F59E0B' : color,
          boxShadow: r.stoppedEarly ? '0 0 8px rgba(245,158,11,0.6)' : rateGlow(rate),
          flexShrink: 0, zIndex: 1,
        }} />
        {/* Line below */}
        <Box sx={{ width: '1px', flex: 1, bgcolor: 'rgba(255,255,255,0.06)', mt: 0.5 }} />
      </Box>

      {/* Card */}
      <Box sx={{
        flex: 1, mb: 0.5,
        bgcolor: 'rgba(255,255,255,0.03)',
        border: `1px solid rgba(255,255,255,0.07)`,
        borderLeft: `2px solid ${r.stoppedEarly ? '#F59E0B' : color}`,
        borderRadius: '0 10px 10px 0',
        p: 1.5,
        transition: 'background 0.15s',
        '&:active': { bgcolor: 'rgba(255,255,255,0.06)' },
      }}>
        {/* Top row: email + status badge */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, gap: 1 }}>
          <Typography sx={{
            fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#00E5FF',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          }}>
            {r.email}
          </Typography>
          {r.stoppedEarly ? (
            <Chip label="STOPPED" size="small" icon={<WarningAmberIcon sx={{ fontSize: '10px !important', color: '#F59E0B !important' }} />}
              sx={{ height: 17, fontSize: 9, bgcolor: 'rgba(245,158,11,0.1)', color: '#F59E0B',
                fontFamily: 'DM Mono, monospace', border: '1px solid rgba(245,158,11,0.25)', px: 0.25 }} />
          ) : (
            <Chip label="DONE" size="small" icon={<CheckCircleIcon sx={{ fontSize: '10px !important', color: `${color} !important` }} />}
              sx={{ height: 17, fontSize: 9, bgcolor: `${color}15`, color,
                fontFamily: 'DM Mono, monospace', border: `1px solid ${color}40`, px: 0.25 }} />
          )}
        </Box>

        {/* Time + duration row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
          <Typography sx={{ fontSize: 10, color: 'text.disabled', fontFamily: 'DM Mono, monospace' }}>
            {fmtShort(r.finishedAt)}
          </Typography>
          {dur !== '—' && (
            <>
              <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.2)' }} />
              <Typography sx={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: 'DM Mono, monospace' }}>
                {dur}
              </Typography>
            </>
          )}
        </Box>

        {/* Stats row */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.25 }}>
          <StatPill label="emails" value={(r.emailsProcessed || 0).toLocaleString()} color="#00E5FF" />
          <StatPill label="beacons" value={(r.pixelsFired || 0).toLocaleString()} color="#7C3AED" />
          {r.spamRescued > 0 && (
            <StatPill label="rescued" value={`+${r.spamRescued}`} color="#F59E0B" />
          )}
        </Box>

        {/* Rate bar */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{
            fontSize: 10, fontWeight: 700, color, fontFamily: 'DM Mono, monospace',
            minWidth: 36, textShadow: rateGlow(rate),
          }}>
            {rate.toFixed(1)}%
          </Typography>
          <Box sx={{ flex: 1, height: 3, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <Box sx={{
              width: `${rate}%`, height: '100%', borderRadius: 2,
              bgcolor: color,
              boxShadow: rateGlow(rate),
              transition: 'width 0.6s ease',
            }} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}


/* ── Main component ──────────────────────────────────────────────────────────── */
export default function RunHistory({ data }) {
  const theme    = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const accounts = data?.accounts || [];
  const [selectedEmail, setSelectedEmail] = useState('all');
  const [history,  setHistory]  = useState({});
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

  const accountEmails = accounts.map(a => a.email);

  const rows = Object.entries(history)
    .filter(([email]) => selectedEmail === 'all' || email === selectedEmail)
    .flatMap(([email, runs]) => (Array.isArray(runs) ? runs : []).map(r => ({ ...r, email })))
    .sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));

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
      {/* Summary chips */}
      {summaries.length > 0 && (
        <Box sx={{ display: 'flex', gap: isMobile ? 1 : 2, mb: 3, overflowX: 'auto', pb: 1 }}>
          {summaries.map(s => (
            <Card key={s.email}
              onClick={() => setSelectedEmail(s.email === selectedEmail ? 'all' : s.email)}
              sx={{
                minWidth: isMobile ? 160 : 200, flex: '0 0 auto', cursor: 'pointer',
                border: selectedEmail === s.email ? '1px solid rgba(0,229,255,0.4)' : '1px solid rgba(255,255,255,0.06)',
                transition: 'border 0.15s', '&:hover': { border: '1px solid rgba(0,229,255,0.25)' },
              }}>
              <CardContent sx={{ p: `${isMobile ? 10 : 14}px !important` }}>
                <Typography sx={{ fontSize: 10, fontFamily: 'DM Mono, monospace', color: 'text.disabled',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', mb: 1 }}>
                  {s.email}
                </Typography>
                <Box sx={{ display: 'flex', gap: isMobile ? 1.5 : 2 }}>
                  <Box>
                    <Typography sx={{ fontSize: isMobile ? 17 : 20, fontWeight: 800, color: '#00E5FF', lineHeight: 1 }}>{s.totalRuns}</Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9 }}>runs</Typography>
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: isMobile ? 17 : 20, fontWeight: 800, color: rateColor(s.avgRate), lineHeight: 1 }}>{s.avgRate}%</Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9 }}>avg rate</Typography>
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: isMobile ? 17 : 20, fontWeight: 800, color: '#7C3AED', lineHeight: 1 }}>{s.totalBeacons.toLocaleString()}</Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9 }}>beacons</Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* Timeline / Table */}
      <Card>
        <CardContent>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', fontSize: 11, letterSpacing: '0.08em' }}>
              RUN TIMELINE
            </Typography>
            <Box sx={{ flex: 1 }} />
            {accounts.length > 1 && (
              <FormControl size="small" sx={{ minWidth: isMobile ? 160 : 200 }}>
                <InputLabel sx={{ fontSize: 12 }}>Account</InputLabel>
                <Select value={selectedEmail} label="Account" onChange={e => setSelectedEmail(e.target.value)} sx={{ fontSize: 12 }}>
                  <MenuItem value="all">All accounts</MenuItem>
                  {accountEmails.map(e => (
                    <MenuItem key={e} value={e} sx={{ fontSize: 11, fontFamily: 'DM Mono, monospace' }}>{e}</MenuItem>
                  ))}
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
          ) : isMobile ? (
            /* ── Mobile: timeline cards ── */
            <Box sx={{ pt: 0.5 }}>
              {rows.map((r, i) => <RunCard key={i} r={r} index={i} />)}
            </Box>
          ) : (
            /* ── Desktop: table ── */
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