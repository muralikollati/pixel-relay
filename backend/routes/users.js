/**
 * User & Auth Routes
 *
 * POST /users/login                     — login, returns JWT
 * GET  /users/me                        — get current user info
 * POST /users/logout                    — revoke token server-side (FIX: was stateless)
 *
 * --- canManageUsers permission (superadmin always, admin/user if granted) ---
 * GET    /users                         — list all users
 * POST   /users                         — create user
 * DELETE /users/:username               — delete user
 * PATCH  /users/:username/password      — reset password
 *
 * --- SuperAdmin only (privilege escalation risk) ---
 * PATCH  /users/:username/role          — change user role
 *
 * GET    /users/permissions             — get all role permissions
 * PATCH  /users/permissions/:role       — update role permissions (superadmin)
 */

const express    = require('express');
const router     = express.Router();
const UserStore  = require('../services/userStore');
const ProfileStore = require('../services/profileStore');
const { generateToken, requireAuth, requireRole, requirePermission, revokeToken } = require('../middleware/auth');
const logger     = require('../services/logger');
const profileRoutes = require('./profiles');

// ── Login ──────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const user = await UserStore.verifyLogin(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // Ensure a default profile exists for the user (idempotent)
    const defaultProfile = ProfileStore.ensureDefault(username);
    const activeProfileId = defaultProfile?.id || null;

    const token       = generateToken({ ...user, activeProfileId });
    const permissions = UserStore.getPermissions(user.role);
    logger.info(`User logged in: ${username} (${user.role})`);
    res.json({ success: true, token, user: { ...user, permissions, activeProfileId } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Profile sub-routes ─────────────────────────────────────────────────────────
router.use('/profiles', profileRoutes);

// ── Logout — server-side token revocation ──────────────────────────────────────
// FIX: Previously this was described as "client-side token discard (stateless)".
// The token is now added to a denylist so it cannot be reused even if stolen.
router.post('/logout', requireAuth, (req, res) => {
  revokeToken(req.user);
  logger.info(`User logged out: ${req.user.username}`);
  res.json({ success: true, message: 'Logged out' });
});

// ── Current user ───────────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const user        = UserStore.getUser(req.user.username);
  const permissions = UserStore.getPermissions(req.user.role);
  res.json({ success: true, user: { ...user, permissions } });
});

// ── List users (canManageUsers permission) ──────────────────────────────────────
router.get('/', ...requirePermission('canManageUsers'), (req, res) => {
  const users = UserStore.listUsers();
  const TokenStore = require('../services/tokenStore');
  // Annotate each user with profile and account counts for admin panel display
  const enriched = users.map(u => ({
    ...u,
    profileCount: ProfileStore.countForUser(u.username),
    accountCount: TokenStore.getAll().filter(a => a.owner === u.username).length,
  }));
  res.json({ success: true, users: enriched });
});

// ── Create user (canManageUsers permission) ─────────────────────────────────────
router.post('/', ...requirePermission('canManageUsers'), async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'username, password and role required' });
  }
  // FIX: Enforce minimum password length on the backend — API clients bypass frontend validation
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    await UserStore.createUser(username, password, role);
    logger.info(`User created: ${username} (${role}) by ${req.user.username}`);
    res.json({ success: true, message: `User ${username} created` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Delete user (canManageUsers permission) ─────────────────────────────────────
router.delete('/:username', ...requirePermission('canManageUsers'), (req, res) => {
  const { username } = req.params;
  if (username === req.user.username) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }
  try {
    UserStore.deleteUser(username);
    logger.info(`User deleted: ${username} by ${req.user.username}`);
    res.json({ success: true, message: `User ${username} deleted` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Change role (superadmin only) ──────────────────────────────────────────────
router.patch('/:username/role', ...requirePermission('canManageUsers'), (req, res) => {
  const { username } = req.params;
  const { role }     = req.body;
  // Non-superadmins cannot assign or target superadmin role
  if (!['admin','superadmin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  if (role === 'superadmin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Only superadmin can assign superadmin role' });
  }
  const target = UserStore.getUser(username);
  if (target?.role === 'superadmin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: `Only superadmin can change a superadmin's role` })
  }
  try {
    UserStore.updateRole(username, role);
    logger.info(`Role updated: ${username} → ${role} by ${req.user.username}`);
    res.json({ success: true, message: `${username} is now ${role}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Self-service password change (any logged-in user) ─────────────────────────
// Requires current password — users cannot change others' passwords via this route.
router.patch('/me/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password must be different from current password' });
  }
  try {
    // Verify current password before allowing the change
    const user = await UserStore.verifyLogin(req.user.username, currentPassword);
    if (!user) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    await UserStore.updatePassword(req.user.username, newPassword);
    logger.info(`Password changed by user: ${req.user.username}`);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reset password (canManageUsers permission) ──────────────────────────────────
router.patch('/:username/password', ...requirePermission('canManageUsers'), async (req, res) => {
  const { username } = req.params;
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password required' });
  // FIX: Enforce minimum password length server-side (matches frontend validation)
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    await UserStore.updatePassword(username, password);
    logger.info(`Password reset: ${username} by ${req.user.username}`);
    res.json({ success: true, message: `Password updated for ${username}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Get all permissions (superadmin) ───────────────────────────────────────────
router.get('/permissions', ...requireRole('superadmin'), (req, res) => {
  res.json({ success: true, permissions: UserStore.getAllPermissions() });
});

// ── Update role permissions (superadmin) ───────────────────────────────────────
router.patch('/permissions/:role', ...requireRole('superadmin'), (req, res) => {
  const { role }        = req.params;
  const { permissions } = req.body;
  if (!permissions) return res.status(400).json({ error: 'permissions object required' });
  try {
    UserStore.setPermissions(role, permissions);
    logger.info(`Permissions updated for role: ${role} by ${req.user.username}`);
    res.json({ success: true, permissions: UserStore.getAllPermissions() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;