const { db } = require('./db');

const ConfigStore = {
  get() {
    const rows = db.prepare('SELECT key,value FROM worker_config').all();
    const cfg  = {};
    for (const r of rows) cfg[r.key] = isNaN(r.value) ? r.value : Number(r.value);
    return cfg;
  },
  update(patch) {
    const upd = db.prepare('INSERT OR REPLACE INTO worker_config (key,value) VALUES (?,?)');
    const tx  = db.transaction((p) => { for (const [k,v] of Object.entries(p)) upd.run(k, String(v)); });
    tx(patch);
    return this.get();
  },
};
module.exports = ConfigStore;
