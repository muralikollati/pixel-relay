import { useState, useEffect, useRef } from 'react';
import {
  Box, Card, CardContent, Typography, Chip, LinearProgress, Paper, IconButton, Tooltip,
} from '@mui/material';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';

const phaseColor = {
  fetching:   { bg: 'rgba(0,229,255,0.1)',   color: '#00E5FF' },
  processing: { bg: 'rgba(124,58,237,0.1)',  color: '#7C3AED' },
  waiting:    { bg: 'rgba(245,158,11,0.1)',  color: '#F59E0B' },
  done:       { bg: 'rgba(16,185,129,0.1)',  color: '#10B981' },
  error:      { bg: 'rgba(239,68,68,0.1)',   color: '#EF4444' },
  idle:       { bg: 'rgba(107,114,128,0.1)', color: '#6B7280' },
};

// accountStatuses is passed from App → live local state from useWorker
export default function Logs({ accountStatuses = {} }) {
  const [log,      setLog]  = useState([]);
  const bottomRef  = useRef(null);
  const seenRef    = useRef({});  // tracks last message per account to avoid duplicates

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  // Watch accountStatuses and append new entries to the log
  useEffect(() => {
    const now        = new Date().toLocaleTimeString();
    const newEntries = [];

    Object.entries(accountStatuses).forEach(([email, s]) => {
      if (!s?.phase || s.phase === 'idle') return;

      // Use updatedAt + message as dedup key
      const key     = `${email}:${s.updatedAt}:${s.message}`;
      if (seenRef.current[email] === key) return;
      seenRef.current[email] = key;

      newEntries.push({ time: now, phase: s.phase, email, message: s.message || '' });
    });

    if (newEntries.length > 0) {
      setLog(prev => [...prev.slice(-299), ...newEntries]);
    }
  }, [accountStatuses]);

  const activeJobs = Object.entries(accountStatuses).filter(([, s]) => s?.phase && s.phase !== 'idle');

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 300px' }, gap: 2 }}>
      {/* Log stream */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', fontSize: 11 }}>
              LOG STREAM
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip size="small" label="live" sx={{ fontSize: 9, height: 18, bgcolor: 'rgba(16,185,129,0.1)', color: '#10B981', fontFamily: 'DM Mono, monospace' }} />
              <Tooltip title="Clear log">
                <IconButton size="small" onClick={() => { setLog([]); seenRef.current = {}; }}
                  sx={{ color: 'text.disabled', p: 0.5 }}>
                  <DeleteSweepIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          <Paper elevation={0} sx={{ bgcolor: 'rgba(0,0,0,0.3)', borderRadius: 1, height: { xs: 320, md: 480 }, overflow: 'auto', fontFamily: 'DM Mono, monospace', fontSize: 12, border: '1px solid rgba(255,255,255,0.04)' }}>
            {log.length === 0 ? (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <Typography variant="caption" color="text.disabled">
                  No activity yet. Click Run All on the Dashboard to start.
                </Typography>
              </Box>
            ) : (
              log.map((entry, i) => {
                const pc = phaseColor[entry.phase] || phaseColor.idle;
                return (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, px: 2, py: 0.75, borderBottom: '1px solid rgba(255,255,255,0.02)', '&:last-child': { borderBottom: 'none' }, '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' } }}>
                    <Typography sx={{ fontSize: 10, color: 'text.disabled', fontFamily: 'DM Mono, monospace', flexShrink: 0, mt: 0.25 }}>
                      {entry.time}
                    </Typography>
                    <Box sx={{ px: 1, py: 0.2, borderRadius: 1, bgcolor: pc.bg, color: pc.color, fontSize: 9, fontFamily: 'DM Mono, monospace', flexShrink: 0 }}>
                      {entry.phase}
                    </Box>
                    <Typography sx={{ fontSize: 10, color: 'text.secondary', fontFamily: 'DM Mono, monospace', flexShrink: 0, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.email}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: 'text.primary', fontFamily: 'DM Mono, monospace', flex: 1 }}>
                      {entry.message}
                    </Typography>
                  </Box>
                );
              })
            )}
            <div ref={bottomRef} />
          </Paper>
        </CardContent>
      </Card>

      {/* Per-account live status */}
      <Card>
        <CardContent>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', display: 'block', mb: 2, fontSize: 11 }}>
            ACCOUNT JOB STATUS
          </Typography>
          {activeJobs.length === 0 ? (
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', textAlign: 'center', py: 4 }}>
              No active jobs
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {activeJobs.map(([email, s]) => {
                const pc       = phaseColor[s.phase] || phaseColor.idle;
                const progress = s.total ? Math.round((s.done / s.total) * 100) : 0;
                return (
                  <Box key={email} sx={{ bgcolor: 'rgba(255,255,255,0.03)', borderRadius: 1.5, p: 1.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
                      <Typography sx={{ fontSize: 11, fontFamily: 'DM Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>
                        {email}
                      </Typography>
                      <Box sx={{ px: 1, py: 0.2, borderRadius: 1, bgcolor: pc.bg, color: pc.color, fontSize: 9, fontFamily: 'DM Mono, monospace' }}>
                        {s.phase}
                      </Box>
                    </Box>
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10, display: 'block', mb: s.total > 0 ? 1 : 0 }}>
                      {s.message || '—'}
                    </Typography>
                    {s.total > 0 && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <LinearProgress variant="determinate" value={progress}
                          sx={{ flex: 1, height: 4, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.06)', '& .MuiLinearProgress-bar': { bgcolor: pc.color } }} />
                        <Typography variant="caption" sx={{ fontSize: 9, color: pc.color, fontFamily: 'DM Mono, monospace', flexShrink: 0 }}>
                          {s.done}/{s.total}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
