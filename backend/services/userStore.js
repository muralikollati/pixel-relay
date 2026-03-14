const bcrypt = require('bcryptjs');
const { db } = require('./db');

async function seedDefaultAdmin() {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count === 0) {
    const hash = await bcrypt.hash(process.env.DEFAULT_ADMIN_PASSWORD || 'admin123', 10);
    db.prepare('INSERT INTO users (username,password,role) VALUES (?,?,?)').run('admin', hash, 'superadmin');
    console.log('[UserStore] Default superadmin created — username: admin');
  }
}

const UserStore = {
  async init() { await seedDefaultAdmin(); },

  async verifyLogin(username, password) {
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if (!user) return null;
    const match = await bcrypt.compare(password, user.password);
    if (!match) return null;
    db.prepare('UPDATE users SET last_login=? WHERE username=?').run(new Date().toISOString(), username);
    return { username: user.username, role: user.role };
  },

  getPermissions(role) {
    const rows = db.prepare('SELECT key,value FROM permissions WHERE role=?').all(role);
    return Object.fromEntries(rows.map(r => [r.key, r.value === 1]));
  },

  setPermissions(role, permissions) {
    const upd = db.prepare('INSERT OR REPLACE INTO permissions (role,key,value) VALUES (?,?,?)');
    const tx  = db.transaction((perms) => {
      for (const [key, val] of Object.entries(perms)) upd.run(role, key, val ? 1 : 0);
    });
    tx(permissions);
  },

  getAllPermissions() {
    const rows = db.prepare('SELECT role,key,value FROM permissions').all();
    const out  = {};
    for (const r of rows) {
      if (!out[r.role]) out[r.role] = {};
      out[r.role][r.key] = r.value === 1;
    }
    return out;
  },

  async createUser(username, password, role) {
    if (!['superadmin','admin','user'].includes(role)) throw new Error('Invalid role');
    const exists = db.prepare('SELECT 1 FROM users WHERE username=?').get(username);
    if (exists) throw new Error('Username already exists');
    const hash = await bcrypt.hash(password, 10);
    db.prepare('INSERT INTO users (username,password,role) VALUES (?,?,?)').run(username, hash, role);
  },

  deleteUser(username) {
    const r = db.prepare('DELETE FROM users WHERE username=?').run(username);
    if (r.changes === 0) throw new Error('User not found');
  },

  async updatePassword(username, newPassword) {
    const hash = await bcrypt.hash(newPassword, 10);
    const r = db.prepare('UPDATE users SET password=? WHERE username=?').run(hash, username);
    if (r.changes === 0) throw new Error('User not found');
  },

  updateRole(username, role) {
    if (!['superadmin','admin','user'].includes(role)) throw new Error('Invalid role');
    const r = db.prepare('UPDATE users SET role=? WHERE username=?').run(role, username);
    if (r.changes === 0) throw new Error('User not found');
  },

  listUsers() {
    return db.prepare('SELECT username,role,created_at,last_login FROM users ORDER BY created_at').all()
      .map(u => ({ username: u.username, role: u.role, createdAt: u.created_at, lastLogin: u.last_login }));
  },

  getUser(username) {
    const u = db.prepare('SELECT username,role,created_at,last_login FROM users WHERE username=?').get(username);
    if (!u) return null;
    return { username: u.username, role: u.role, createdAt: u.created_at, lastLogin: u.last_login };
  },
};

module.exports = UserStore;
