/**
 * Profile Routes
 *
 * GET    /users/profiles              — list my profiles
 * POST   /users/profiles              — create a new profile
 * PATCH  /users/profiles/:id          — rename a profile
 * DELETE /users/profiles/:id          — delete a profile
 * POST   /users/profiles/:id/activate — switch active profile (returns new JWT)
 * POST   /users/profiles/:id/default  — set as default profile
 */

const express      = require('express');
const router       = express.Router();
const ProfileStore = require('../services/profileStore');
const ConfigStore  = require('../services/configStore');
const UserStore    = require('../services/userStore');
const { requireAuth, generateToken, revokeToken } = require('../middleware/auth');
const logger       = require('../services/logger');

// GET /users/profiles
router.get('/', requireAuth, (req, res) => {
  try {
    const profiles = ProfileStore.listForUser(req.user.username);
    res.json({ success: true, profiles, activeProfileId: req.user.activeProfileId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /users/profiles
router.post('/', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Profile name is required' });
  }
  try {
    const cfg        = ConfigStore.get();
    const maxProfiles = cfg.maxProfilesPerUser || 5;
    const profile    = ProfileStore.create(req.user.username, name.trim(), maxProfiles);
    logger.info(`Profile created: "${name}" for ${req.user.username}`);
    res.json({ success: true, profile });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PATCH /users/profiles/:id — rename
router.patch('/:id', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Profile name is required' });
  }
  try {
    const profile = ProfileStore.rename(parseInt(req.params.id), req.user.username, name.trim());
    if (!profile) return res.status(404).json({ success: false, error: 'Profile not found' });
    logger.info(`Profile renamed to "${name}" for ${req.user.username}`);
    res.json({ success: true, profile });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /users/profiles/:id
router.delete('/:id', requireAuth, (req, res) => {
  try {
    ProfileStore.delete(parseInt(req.params.id), req.user.username);
    logger.info(`Profile ${req.params.id} deleted by ${req.user.username}`);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /users/profiles/:id/activate — switch to this profile, returns new JWT
router.post('/:id/activate', requireAuth, (req, res) => {
  try {
    const profileId = parseInt(req.params.id);
    const profile   = ProfileStore.get(profileId, req.user.username);
    if (!profile) return res.status(404).json({ success: false, error: 'Profile not found' });

    // Revoke current token so old profileId can't be reused
    revokeToken(req.user);

    const user        = UserStore.getUser(req.user.username);
    const permissions = UserStore.getPermissions(user.role);
    const newToken    = generateToken({ ...user, activeProfileId: profileId });

    logger.info(`Profile switched to "${profile.name}" (id=${profileId}) by ${req.user.username}`);
    res.json({
      success: true,
      token: newToken,
      profile,
      user: { ...user, permissions, activeProfileId: profileId },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /users/profiles/:id/default — set as default
router.post('/:id/default', requireAuth, (req, res) => {
  try {
    const profile = ProfileStore.setDefault(parseInt(req.params.id), req.user.username);
    if (!profile) return res.status(404).json({ success: false, error: 'Profile not found' });
    res.json({ success: true, profile });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
