import { useState, useRef } from 'react';
import {
  Box, Card, CardContent, Typography, TextField,
  Button, CircularProgress,
} from '@mui/material';
import BoltIcon from '@mui/icons-material/Bolt';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { login } from '../utils/api';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  // FIX: Ref-based guard prevents parallel login requests from double-clicks
  // on slow networks, where the loading state update hasn't propagated yet.
  const submittingRef = useRef(false);

  // Check URL for redirect reason — 'deleted' means admin removed this account mid-session
  const params  = new URLSearchParams(window.location.search);
  const reason  = params.get('reason');
  const [error, setError] = useState(
    reason === 'deleted' ? 'Your account was removed. Contact your administrator.' : ''
  );

  const handleSubmit = async () => {
    if (submittingRef.current) return; // FIX: block rapid double-submit
    if (!username || !password) { setError('Enter username and password'); return; }
    submittingRef.current = true;
    setLoading(true); setError('');
    try {
      const res = await login(username, password);
      localStorage.setItem('pr_token', res.data.token);
      localStorage.setItem('pr_user',  JSON.stringify(res.data.user));
      onLogin(res.data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <Box sx={{
      minHeight: '100vh', bgcolor: 'background.default',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse at 50% 0%, rgba(0,229,255,0.04) 0%, transparent 60%)',
    }}>
      <Card sx={{ width: '100%', maxWidth: 400, mx: 2 }}>
        <CardContent sx={{ p: 4 }}>
          {/* Logo */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 4 }}>
            <Box sx={{
              width: 52, height: 52, borderRadius: 3,
              background: 'linear-gradient(135deg, #00E5FF 0%, #7C3AED 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 24px rgba(0,229,255,0.2)', mb: 2,
            }}>
              <BoltIcon sx={{ fontSize: 28, color: '#000' }} />
            </Box>
            <Typography sx={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>
              PixelRelay
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'DM Mono, monospace' }}>
              v3.1 — Sign in to continue
            </Typography>
          </Box>

          {error && (
            <Box sx={{ mb: 2, px: 2, py: 1.5, borderRadius: 2, bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <Typography sx={{ fontSize: 12, color: '#FCA5A5' }}>{error}</Typography>
            </Box>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Username"
              size="small"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              fullWidth
            />
            <TextField
              label="Password"
              type="password"
              size="small"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              fullWidth
            />
            <Button
              variant="contained"
              fullWidth
              onClick={handleSubmit}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <LockOutlinedIcon />}
              sx={{
                mt: 1, py: 1.2,
                background: 'linear-gradient(135deg, rgba(0,229,255,0.8) 0%, rgba(124,58,237,0.8) 100%)',
                color: '#000', fontWeight: 700,
                '&:hover': { opacity: 0.9 },
              }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </Box>


        </CardContent>
      </Card>
    </Box>
  );
}
