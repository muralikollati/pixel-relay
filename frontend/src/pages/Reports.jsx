import { useState, useEffect, useCallback } from 'react';
import {
  Box, Card, CardContent, Typography, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, Chip, CircularProgress,
  ToggleButtonGroup, ToggleButton, Button, useTheme, useMediaQuery,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { getReports } from '../utils/api';

const rateColor = r => r >= 95 ? '#10B981' : r >= 85 ? '#F59E0B' : '#EF4444';

export default function Reports({ onToast }) {
  const [reports, setReports]     = useState({});
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [days,    setDays]        = useState(7);
  const [view,    setView]        = useState('chart');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getReports(days);
      setReports(res.data.reports || {});
    } catch (err) {
      const msg = err.response?.status === 429
        ? 'Rate limit hit — please wait a moment and retry.'
        : `Failed to load reports: ${err.message}`;
      setLoadError(msg);
      onToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const chartData = Object.entries(reports)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, accounts]) => {
      const entries     = Object.values(accounts);
      const totalEmails = entries.reduce((s, a) => s + (a.emailsProcessed || 0), 0);
      const totalSpam   = entries.reduce((s, a) => s + (a.spamRescued    || 0), 0);
      const totalBeacons = entries.reduce((s, a) => s + (a.pixelsFired   || 0), 0);
      const avgRate     = entries.length
        ? +(entries.reduce((s, a) => s + (a.successRate || 0), 0) / entries.length).toFixed(1)
        : 0;
      return { date: date.slice(5), emails: totalEmails, spam: totalSpam, beacons: totalBeacons, rate: avgRate };
    });

  const allAccounts = [...new Set(
    Object.values(reports).flatMap(day => Object.keys(day))
  )].sort();

  const sortedDays = Object.keys(reports).sort();

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', fontSize: 11 }}>
          DAILY REPORTS — LAST {days} DAYS
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <ToggleButtonGroup value={days} exclusive onChange={(_, v) => v && setDays(v)} size="small">
            {[3, 7].map(d => (
              <ToggleButton key={d} value={d} sx={{ fontSize: 11, fontFamily: 'DM Mono, monospace', py: 0.5, px: 1.5 }}>{d}D</ToggleButton>
            ))}
          </ToggleButtonGroup>
          <ToggleButtonGroup value={view} exclusive onChange={(_, v) => v && setView(v)} size="small">
            <ToggleButton value="chart" sx={{ fontSize: 11, py: 0.5, px: 1.5 }}>Chart</ToggleButton>
            <ToggleButton value="table" sx={{ fontSize: 11, py: 0.5, px: 1.5 }}>Table</ToggleButton>
          </ToggleButtonGroup>
          <Button size="small" startIcon={<RefreshIcon />} onClick={load} disabled={loading}
            sx={{ fontSize: 11, color: 'text.secondary', borderColor: 'rgba(255,255,255,0.1)', border: '1px solid' }}>
            Refresh
          </Button>
        </Box>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={32} />
        </Box>
      ) : loadError ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <Typography sx={{ fontSize: 32, mb: 1 }}>⚠️</Typography>
            <Typography color="error" sx={{ mb: 2 }}>{loadError}</Typography>
            <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : sortedDays.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 8 }}>
            <Typography sx={{ fontSize: 36, mb: 1 }}>📊</Typography>
            <Typography color="text.secondary">No reports yet — run the worker to generate daily reports.</Typography>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary chart */}
          {view === 'chart' && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', display: 'block', mb: 2 }}>
                  EMAILS PROCESSED + SPAM RESCUED
                </Typography>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#4B5563' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#4B5563' }} tickLine={false} axisLine={false} />
                    <RTooltip contentStyle={{ background: '#0F1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} itemStyle={{ color: '#E5E7EB' }} />
                    <Legend wrapperStyle={{ fontSize: 11, color: '#6B7280' }} />
                    <Bar dataKey="emails"  name="Emails Processed" fill="#7C3AED" radius={[3,3,0,0]} />
                    <Bar dataKey="spam"    name="Spam Rescued"      fill="#00E5FF" radius={[3,3,0,0]} />
                    <Bar dataKey="beacons" name="Beacons Fired"     fill="#10B981" radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Per-account breakdown */}
          <Card>
            <CardContent>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', display: 'block', mb: 2 }}>
                PER-ACCOUNT BREAKDOWN
              </Typography>

              {isMobile ? (
                /* ── Mobile: account accordion cards ── */
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {allAccounts.map(account => {
                    const accountDays = sortedDays.filter(d => reports[d]?.[account]);
                    if (!accountDays.length) return null;
                    const latest = reports[accountDays[0]]?.[account];
                    const avgRate = +(accountDays.reduce((s, d) => s + (reports[d]?.[account]?.successRate || 0), 0) / accountDays.length).toFixed(1);
                    const color = rateColor(avgRate);
                    return (
                      <Box key={account} sx={{
                        borderRadius: 2,
                        bgcolor: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.07)',
                        borderLeft: `3px solid ${color}`,
                        overflow: 'hidden',
                      }}>
                        {/* Account header */}
                        <Box sx={{ p: 1.5, pb: 1 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                            <Typography sx={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#00E5FF',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, mr: 1 }}>
                              {account}
                            </Typography>
                            <Typography sx={{ fontSize: 14, fontWeight: 800, color, fontFamily: 'DM Mono, monospace', flexShrink: 0 }}>
                              {avgRate}%
                            </Typography>
                          </Box>
                          <Box sx={{ height: 3, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.06)', overflow: 'hidden', mb: 1 }}>
                            <Box sx={{ width: `${avgRate}%`, height: '100%', bgcolor: color, borderRadius: 2 }} />
                          </Box>
                        </Box>
                        {/* Day breakdown chips */}
                        <Box sx={{ px: 1.5, pb: 1.5, display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                          {sortedDays.map(day => {
                            const r = reports[day]?.[account];
                            if (!r) return (
                              <Box key={day} sx={{ px: 1, py: 0.5, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                                <Typography sx={{ fontSize: 9, color: 'text.disabled', fontFamily: 'DM Mono, monospace' }}>{day.slice(5)}</Typography>
                                <Typography sx={{ fontSize: 10, color: 'text.disabled', fontFamily: 'DM Mono, monospace' }}>—</Typography>
                              </Box>
                            );
                            const dc = rateColor(r.successRate);
                            return (
                              <Box key={day} sx={{ px: 1, py: 0.5, borderRadius: 1.5, bgcolor: `${dc}10`, border: `1px solid ${dc}30` }}>
                                <Typography sx={{ fontSize: 9, color: 'text.disabled', fontFamily: 'DM Mono, monospace' }}>{day.slice(5)}</Typography>
                                <Typography sx={{ fontSize: 11, fontWeight: 700, color: dc, fontFamily: 'DM Mono, monospace' }}>{r.successRate}%</Typography>
                                <Typography sx={{ fontSize: 9, color: 'text.disabled', fontFamily: 'DM Mono, monospace' }}>{r.emailsProcessed}e · {r.pixelsFired || 0}b</Typography>
                                {r.spamRescued > 0 && <Typography sx={{ fontSize: 9, color: '#00E5FF', fontFamily: 'DM Mono, monospace' }}>+{r.spamRescued} spam</Typography>}
                              </Box>
                            );
                          })}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              ) : (
                /* ── Desktop: table ── */
                <TableContainer component={Paper} elevation={0} sx={{ bgcolor: 'transparent', overflowX: 'auto' }}>
                  <Table size="small" sx={{ minWidth: 600 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ color: 'text.disabled', fontSize: 10, fontFamily: 'DM Mono, monospace' }}>ACCOUNT</TableCell>
                        {sortedDays.map(day => (
                          <TableCell key={day} align="center" sx={{ color: 'text.disabled', fontSize: 10, fontFamily: 'DM Mono, monospace' }}>
                            {day.slice(5)}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {allAccounts.map(account => (
                        <TableRow key={account} sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' } }}>
                          <TableCell sx={{ fontFamily: 'DM Mono, monospace', fontSize: 11 }}>{account}</TableCell>
                          {sortedDays.map(day => {
                            const r = reports[day]?.[account];
                            if (!r) return <TableCell key={day} align="center"><Typography variant="caption" color="text.disabled">—</Typography></TableCell>;
                            return (
                              <TableCell key={day} align="center">
                                <Typography sx={{ fontSize: 12, fontWeight: 700, color: rateColor(r.successRate), fontFamily: 'DM Mono, monospace' }}>
                                  {r.successRate}%
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 9, display: 'block' }}>
                                  {r.emailsProcessed} emails
                                </Typography>
                                <Typography variant="caption" sx={{ color: '#10B981', fontSize: 9, display: 'block' }}>
                                  {r.pixelsFired || 0} beacons
                                </Typography>
                                {r.spamRescued > 0 && (
                                  <Chip label={`+${r.spamRescued} spam`} size="small"
                                    sx={{ fontSize: 9, height: 16, bgcolor: 'rgba(0,229,255,0.08)', color: '#00E5FF', mt: 0.25 }} />
                                )}
                              </TableCell>
                            );
                          })}
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
    </Box>
  );
}