/**
 * ProfileSwitcher — dropdown to create, rename, delete and switch profiles.
 * Shown in the Topbar next to the user avatar (non-admin users only).
 * Admins see all accounts anyway so profile switching is not exposed to them.
 */
import { useState, useEffect } from 'react';
import {
  Chip, Menu, MenuItem, Divider, Typography, Box,
  IconButton, TextField, Button, Tooltip, CircularProgress,
} from '@mui/material';
import AccountTreeIcon    from '@mui/icons-material/AccountTree';
import AddIcon            from '@mui/icons-material/Add';
import EditIcon           from '@mui/icons-material/Edit';
import DeleteIcon         from '@mui/icons-material/Delete';
import CheckIcon          from '@mui/icons-material/Check';
import CloseIcon          from '@mui/icons-material/Close';
import StarIcon           from '@mui/icons-material/Star';
import StarBorderIcon     from '@mui/icons-material/StarBorder';
import {
  getProfiles, createProfile, renameProfile,
  deleteProfile, activateProfile, setDefaultProfile,
} from '../utils/api';

export default function ProfileSwitcher({ user, onProfileSwitch, onToast }) {
  const [anchorEl,   setAnchorEl]   = useState(null);
  const [profiles,   setProfiles]   = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [switching,  setSwitching]  = useState(null); // profileId being switched to
  const [editingId,  setEditingId]  = useState(null); // profileId being renamed
  const [editName,   setEditName]   = useState('');
  const [creating,   setCreating]   = useState(false);
  const [newName,    setNewName]    = useState('');
  const [saving,     setSaving]     = useState(false);
  const [activeName, setActiveName] = useState('loading...');
  const activeProfileId = user?.activeProfileId;

  const displayName = typeof activeName === 'string' && activeName.length > 10
    ? `${activeName.slice(0, 10)}...`
    : activeName;

  const load = async () => {
    try {
      setLoading(true);
      const res = await getProfiles();
      setProfiles(res.data.profiles || []);
      setActiveName(res.data.profiles.find(p => p.id === activeProfileId)?.name || 'Default');
    } catch { /* non-fatal */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
   load();
  }, []);

  const handleSwitch = async (profileId) => {
    if (profileId === activeProfileId) { setAnchorEl(null); return; }
    try {
      setSwitching(profileId);
      const res = await activateProfile(profileId);
      const { token, user: updatedUser } = res.data;
      localStorage.setItem('pr_token', token);
      localStorage.setItem('pr_user', JSON.stringify(updatedUser));
      onProfileSwitch(updatedUser, token);
      onToast(`Switched to "${res.data.profile.name}"`, 'success');
      setActiveName(res.data.profile.name);
    } catch (err) {
      onToast(err.response?.data?.error || 'Failed to switch profile', 'error');
    } finally {
      setSwitching(null);
      setAnchorEl(null);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      setSaving(true);
      const res = await createProfile(newName.trim());
      setProfiles(p => [...p, res.data.profile]);
      setNewName('');
      setCreating(false);
      onToast(`Profile "${res.data.profile.name}" created`, 'success');
    } catch (err) {
      onToast(err.response?.data?.error || 'Failed to create profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRename = async (id) => {
    if (!editName.trim()) return;
    try {
      setSaving(true);
      const res = await renameProfile(id, editName.trim());
      setProfiles(p => p.map(x => x.id === id ? res.data.profile : x));
      setEditingId(null);
      onToast('Profile renamed', 'success');
    } catch (err) {
      onToast(err.response?.data?.error || 'Failed to rename', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete profile "${name}"? Its accounts will move to your Default profile.`)) return;
    try {
      await deleteProfile(id);
      setProfiles(p => p.filter(x => x.id !== id));
      onToast(`Profile "${name}" deleted`, 'success');
      // If deleting active profile, switch to default
      if (id === activeProfileId) {
        const defaultP = profiles.find(p => p.isDefault && p.id !== id);
        if (defaultP) handleSwitch(defaultP.id);
      }
    } catch (err) {
      onToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  };

  const handleSetDefault = async (id) => {
    try {
      await setDefaultProfile(id);
      setProfiles(p => p.map(x => ({ ...x, isDefault: x.id === id })));
      onToast('Default profile updated', 'success');
    } catch (err) {
      onToast(err.response?.data?.error || 'Failed to set default', 'error');
    }
  };

  return (
    <>
      <Tooltip title={`${activeName} — Switch profile`}>
        <Chip
          icon={loading ? <CircularProgress size={14} sx={{ color: '#00E5FF' }} /> : <AccountTreeIcon sx={{ fontSize: '14px !important' }} />}
          label={displayName}
          size="small"
          onClick={e => setAnchorEl(e.currentTarget)}
          sx={{
            height: 26,
            fontSize: 11,
            fontFamily: 'DM Mono, monospace',
            cursor: 'pointer',
            bgcolor: 'rgba(0,229,255,0.08)',
            color: '#00E5FF',
            border: '1px solid rgba(0,229,255,0.2)',
            '& .MuiChip-label': { px: 1 },
            '&:hover': { bgcolor: 'rgba(0,229,255,0.14)' },
          }}
        />
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={!!anchorEl}
        onClose={() => { setAnchorEl(null); setCreating(false); setEditingId(null); }}
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            minWidth: 240,
            maxWidth: 300,
            border: '1px solid rgba(255,255,255,0.08)',
          },
        }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography sx={{ fontSize: 11, color: 'text.secondary', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Profiles
          </Typography>
        </Box>
        <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={20} sx={{ color: '#00E5FF' }} />
          </Box>
        ) : (
          profiles.map(profile => (
            <Box key={profile.id} sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.25 }}>
              {editingId === profile.id ? (
                // ── Rename inline ───────────────────────────────────────────
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, py: 0.5 }}>
                  <TextField
                    size="small" autoFocus value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename(profile.id); if (e.key === 'Escape') setEditingId(null); }}
                    sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } }}
                    inputProps={{ maxLength: 30 }}
                  />
                  <IconButton size="small" disabled={saving} onClick={() => handleRename(profile.id)} sx={{ color: '#10B981' }}>
                    <CheckIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                  <IconButton size="small" onClick={() => setEditingId(null)} sx={{ color: 'text.secondary' }}>
                    <CloseIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              ) : (
                // ── Profile row ─────────────────────────────────────────────
                <>
                  <MenuItem
                    onClick={() => handleSwitch(profile.id)}
                    sx={{ flex: 1, fontSize: 13, gap: 1, borderRadius: 1, py: 0.75,
                      bgcolor: profile.id === activeProfileId ? 'rgba(0,229,255,0.06)' : 'transparent' }}
                    disabled={switching === profile.id}
                  >
                    {switching === profile.id
                      ? <CircularProgress size={14} sx={{ color: '#00E5FF' }} />
                      : profile.id === activeProfileId
                        ? <CheckIcon sx={{ fontSize: 14, color: '#00E5FF' }} />
                        : <Box sx={{ width: 14 }} />
                    }
                    <Box sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {profile.name}
                    </Box>
                    {profile.isDefault && (
                      <Chip label="default" size="small"
                        sx={{ height: 16, fontSize: 9, bgcolor: 'rgba(245,158,11,0.12)', color: '#F59E0B',
                          fontFamily: 'DM Mono, monospace', '& .MuiChip-label': { px: 1 } }} />
                    )}
                  </MenuItem>

                  {/* Action buttons shown on hover via group */}
                  <Box sx={{ display: 'flex', gap: 0.25, opacity: 0.5, '&:hover': { opacity: 1 } }}>
                    {!profile.isDefault && (
                      <Tooltip title="Set as default">
                        <IconButton size="small" onClick={() => handleSetDefault(profile.id)}
                          sx={{ color: '#F59E0B', p: 0.5 }}>
                          <StarBorderIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="Rename">
                      <IconButton size="small"
                        onClick={() => { setEditingId(profile.id); setEditName(profile.name); }}
                        sx={{ color: 'text.secondary', p: 0.5 }}>
                        <EditIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                    {!profile.isDefault && (
                      <Tooltip title="Delete">
                        <IconButton size="small"
                          onClick={() => handleDelete(profile.id, profile.name)}
                          sx={{ color: '#EF4444', p: 0.5 }}>
                          <DeleteIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </>
              )}
            </Box>
          ))
        )}

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', my: 0.5 }} />

        {/* ── Create new profile ─────────────────────────────────────────── */}
        {creating ? (
          <Box sx={{ px: 1.5, py: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              size="small" autoFocus placeholder="Profile name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
              sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } }}
              inputProps={{ maxLength: 30 }}
            />
            <Button size="small" variant="contained" disabled={!newName.trim() || saving}
              onClick={handleCreate}
              sx={{ minWidth: 0, px: 1.5, fontSize: 12, bgcolor: 'rgba(0,229,255,0.15)',
                color: '#00E5FF', border: '1px solid rgba(0,229,255,0.3)',
                boxShadow: 'none', '&:hover': { bgcolor: 'rgba(0,229,255,0.25)', boxShadow: 'none' } }}>
              {saving ? <CircularProgress size={14} sx={{ color: '#00E5FF' }} /> : 'Add'}
            </Button>
            <IconButton size="small" onClick={() => { setCreating(false); setNewName(''); }}
              sx={{ color: 'text.secondary', p: 0.5 }}>
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
        ) : (
          <MenuItem onClick={() => setCreating(true)}
            sx={{ fontSize: 12, gap: 1, color: '#00E5FF', py: 0.75 }}>
            <AddIcon sx={{ fontSize: 14 }} /> New profile
          </MenuItem>
        )}
      </Menu>
    </>
  );
}
