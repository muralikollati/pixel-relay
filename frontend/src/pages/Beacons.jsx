/**
 * Beacons page — v3.1
 *
 * Adds beacon URL preview: live-captured sample URLs from the current/last run,
 * shown per type with truncated display + hover tooltip for full URL.
 */
import { useState } from 'react';
import {
  Box, Card, CardContent, Typography, Grid, Chip, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, Tooltip, IconButton, useTheme, useMediaQuery,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

const VECTORS = [
  { id: 1, key: 'pixel',        label: 'Tracking Pixels',   color: '#00E5FF', desc: '1×1 and 0×0 img tags (width/height=0/1 or display:none) — most common tracker type' },
  { id: 2, key: 'tracked-link', label: 'Tracked Links',     color: '#7C3AED', desc: 'ESP redirect URLs — sendgrid, mailchimp, hubspot, klaviyo, and 25+ other providers' },
  { id: 3, key: 'css',          label: 'CSS Beacons',       color: '#10B981', desc: 'background-image: url(...) in inline styles — fires HTTP request when rendered' },
  { id: 4, key: 'iframe',       label: 'Iframe Beacons',    color: '#F59E0B', desc: 'Hidden <iframe src="…"> — server-side tracking loaded silently' },
  { id: 5, key: 'preload',      label: 'Preload Beacons',   color: '#EF4444', desc: '<link rel="preload/prefetch"> tags with tracking URLs' },
  { id: 6, key: 'hidden-input', label: 'Hidden Input URLs', color: '#EC4899', desc: '<input type="hidden" value="http…"> — less common, used by some ESPs' },
];

const FIRING = [
  { type: 'pixel',        method: 'new Image().src',     why: 'No CORS, no preflight. Fires even on 4xx.' },
  { type: 'tracked-link', method: 'fetch(mode: no-cors)', why: 'Follows redirect chain through ESP.' },
  { type: 'css / iframe', method: 'fetch(mode: no-cors)', why: 'GET request from real browser IP.' },
  { type: 'preload',      method: 'fetch(mode: no-cors)', why: 'Triggers prefetch/preload trackers.' },
  { type: 'hidden-input', method: 'fetch(mode: no-cors)', why: 'Direct HTTP request to hidden URL.' },
];

const rateColor = r => r >= 95 ? '#10B981' : r >= 85 ? '#F59E0B' : '#EF4444';

function truncate(url, n = 60) {
  if (!url) return '';
  if (url.length <= n) return url;
  return url.slice(0, n) + '…';
}

function BeaconUrlPreview({ beaconSamples }) {
  const [copied, setCopied] = useState(null);
  const hasSamples = Object.values(beaconSamples || {}).some(arr => arr.length > 0);

  const handleCopy = (url) => {
    navigator.clipboard.writeText(url).catch(() => {});
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', fontSize: 11 }}>
            BEACON URL PREVIEW
          </Typography>
          {hasSamples && (
            <Chip label="live" size="small" sx={{ fontSize: 9, height: 18, bgcolor: 'rgba(16,185,129,0.1)', color: '#10B981', fontFamily: 'DM Mono, monospace' }} />
          )}
        </Box>

        {!hasSamples ? (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <Typography variant="caption" color="text.disabled">
              Sample beacon URLs will appear here during and after a run.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {VECTORS.map(v => {
              const samples = beaconSamples?.[v.key] || [];
              if (!samples.length) return null;
              return (
                <Box key={v.key}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: v.color, flexShrink: 0 }} />
                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: v.color }}>{v.label}</Typography>
                    <Chip label={samples.length} size="small" sx={{ height: 16, fontSize: 9, bgcolor: `${v.color}15`, color: v.color, fontFamily: 'DM Mono, monospace' }} />
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {samples.map((s, i) => (
                      <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 1, px: 1.5, py: 0.75, border: '1px solid rgba(255,255,255,0.04)' }}>
                        <Tooltip title={s.url} placement="top-start">
                          <Typography sx={{ flex: 1, fontSize: 10, fontFamily: 'DM Mono, monospace', color: 'text.secondary',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default' }}>
                            {truncate(s.url, 65)}
                          </Typography>
                        </Tooltip>
                        <Tooltip title={copied === s.url ? 'Copied!' : 'Copy URL'}>
                          <IconButton size="small" onClick={() => handleCopy(s.url)}
                            sx={{ p: 0.25, color: copied === s.url ? '#10B981' : 'text.disabled', flexShrink: 0 }}>
                            <ContentCopyIcon sx={{ fontSize: 12 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    ))}
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export default function Beacons({ data, beaconSamples = {} }) {
  const totalBeacons = data?.summary?.totalBeacons  || 0;
  const totalEmails  = data?.summary?.totalEmails   || 0;
  const accounts     = data?.accounts               || [];
  const avgBeaconsPerEmail = totalEmails > 0 ? (totalBeacons / totalEmails).toFixed(1) : '—';
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <Box>
      {/* Header stats */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          { label: 'TOTAL BEACONS FIRED', value: totalBeacons.toLocaleString(), sub: 'all accounts · all time', color: '#00E5FF' },
          { label: 'AVG PER EMAIL',       value: avgBeaconsPerEmail,             sub: 'beacons per processed email', color: '#7C3AED' },
          { label: 'FIRING METHOD',       value: 'Browser',                      sub: 'your real IP · not server IP', color: '#10B981', mono: false },
          { label: 'VECTORS ACTIVE',      value: '6',                            sub: 'all isolated · concurrent', color: '#F59E0B' },
        ].map(s => (
          <Grid item xs={6} sm={3} key={s.label}>
            <Card><CardContent sx={{ p: '16px !important' }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', display: 'block', mb: 1, fontSize: 11 }}>
                {s.label}
              </Typography>
              <Typography sx={{ fontSize: s.mono === false ? 18 : 32, fontWeight: 800, color: s.color, lineHeight: 1, mb: 0.5 }}>
                {s.value}
              </Typography>
              <Typography variant="caption" color="text.disabled">{s.sub}</Typography>
            </CardContent></Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2}>
        {/* Left col */}
        <Grid item xs={12} md={7}>
          {/* Vector cards */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
            {VECTORS.map(v => (
              <Box key={v.id} sx={{
                bgcolor: 'rgba(255,255,255,0.02)', border: `1px solid ${v.color}22`,
                borderRadius: 2, p: 2, display: 'flex', alignItems: 'flex-start', gap: 2, position: 'relative', overflow: 'hidden',
              }}>
                <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: `linear-gradient(90deg, ${v.color}66, transparent)` }} />
                <Box sx={{ width: 36, height: 36, borderRadius: 2, flexShrink: 0, bgcolor: `${v.color}15`, border: `1px solid ${v.color}33`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: v.color, fontFamily: 'DM Mono, monospace' }}>
                  {v.id}
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5, flexWrap: 'wrap', gap: 1 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{v.label}</Typography>
                    <Chip label="isolated ✓" size="small" sx={{ fontSize: 9, height: 20, bgcolor: 'rgba(16,185,129,0.1)', color: '#10B981', fontFamily: 'DM Mono, monospace' }} />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.6 }}>{v.desc}</Typography>
                </Box>
              </Box>
            ))}
          </Box>

          {/* Firing method table / cards */}
          <Card>
            <CardContent>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', display: 'block', mb: 2, fontSize: 11 }}>
                HOW EACH VECTOR FIRES
              </Typography>
              {isMobile ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {FIRING.map(f => (
                    <Box key={f.type} sx={{ p: 1.25, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Typography sx={{ fontSize: 10, fontFamily: 'DM Mono, monospace', color: '#00E5FF' }}>{f.type}</Typography>
                        <Box sx={{ px: 0.75, py: 0.15, borderRadius: 1, bgcolor: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.2)' }}>
                          <Typography sx={{ fontSize: 9, fontFamily: 'DM Mono, monospace', color: '#A78BFA' }}>{f.method}</Typography>
                        </Box>
                      </Box>
                      <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>{f.why}</Typography>
                    </Box>
                  ))}
                </Box>
              ) : (
                <TableContainer component={Paper} elevation={0} sx={{ bgcolor: 'transparent' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {['Type', 'Browser API', 'Why'].map(h => (
                          <TableCell key={h} sx={{ color: 'text.disabled', fontSize: 10, fontFamily: 'DM Mono, monospace', py: 0.75 }}>{h}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {FIRING.map(f => (
                        <TableRow key={f.type} sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' } }}>
                          <TableCell sx={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#00E5FF', py: 1 }}>{f.type}</TableCell>
                          <TableCell sx={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#E5E7EB', py: 1 }}>{f.method}</TableCell>
                          <TableCell sx={{ fontSize: 10, color: 'text.secondary', py: 1 }}>{f.why}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Right col */}
        <Grid item xs={12} md={5}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

            {/* ── Beacon URL Preview (new) ── */}
            <BeaconUrlPreview beaconSamples={beaconSamples} />

            {/* Per-account stats */}
            <Card>
              <CardContent>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', display: 'block', mb: 2, fontSize: 11 }}>
                  PER-ACCOUNT BEACONS
                </Typography>
                {accounts.length === 0 ? (
                  <Typography variant="caption" color="text.disabled" sx={{ display: 'block', textAlign: 'center', py: 3 }}>
                    No accounts connected yet
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    {accounts.map(a => {
                      const fired  = a.stats?.pixelsFired     || 0;
                      const emails = a.stats?.emailsProcessed || 0;
                      const rate   = a.stats?.successRate     || 0;
                      const avg    = emails > 0 ? (fired / emails).toFixed(1) : '0';
                      const pct    = totalBeacons > 0 ? Math.round((fired / totalBeacons) * 100) : 0;
                      return (
                        <Box key={a.email} sx={{ bgcolor: 'rgba(255,255,255,0.03)', borderRadius: 1.5, p: 1.5 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography sx={{ fontSize: 11, fontFamily: 'DM Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                              {a.email}
                            </Typography>
                            <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#00E5FF', fontFamily: 'DM Mono, monospace' }}>
                              {fired.toLocaleString()}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 1.5 }}>
                            <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9 }}>{emails.toLocaleString()} emails</Typography>
                            <Typography variant="caption" sx={{ fontSize: 9, color: '#7C3AED' }}>~{avg}/email</Typography>
                            <Typography variant="caption" sx={{ fontSize: 9, color: rateColor(rate) }}>{rate}% rate</Typography>
                            <Typography variant="caption" sx={{ fontSize: 9, color: 'text.disabled' }}>{pct}% of total</Typography>
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                )}
              </CardContent>
            </Card>

            {/* Safe execution model */}
            <Card>
              <CardContent>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', display: 'block', mb: 1.5, fontSize: 11 }}>
                  SAFE EXECUTION MODEL
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7, mb: 2 }}>
                  All {VECTORS.length} vectors run concurrently via{' '}
                  <Box component="span" sx={{ color: '#00E5FF', fontFamily: 'DM Mono, monospace' }}>Promise.allSettled</Box>.
                  One failure never blocks the others.
                </Typography>
                <Box sx={{ bgcolor: 'rgba(0,0,0,0.3)', borderRadius: 1.5, p: 2, fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#D4D4D4', lineHeight: 1.9, border: '1px solid rgba(255,255,255,0.04)' }}>
                  <Box component="span" sx={{ color: '#6B7280' }}>// fires all beacons in parallel</Box><br />
                  <Box component="span" sx={{ color: '#7C3AED' }}>await</Box>{' Promise.allSettled('}<br />
                  {'  beacons.'}<Box component="span" sx={{ color: '#7C3AED' }}>map</Box>{'(b => fireOne(b))'}<br />
                  {');'}
                </Box>
              </CardContent>
            </Card>

          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}