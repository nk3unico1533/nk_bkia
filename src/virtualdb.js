import fs from "fs-extra";
import path from "path";

export class VirtualDB {
  constructor() {
    this.base = path.join(process.cwd(), "vdb");
    fs.ensureDirSync(this.base);
  }

  async _dbPath(workspaceId) {
    const p = path.join(this.base, `${workspaceId}.json`);
    if (!await fs.pathExists(p)) await fs.writeJson(p, { tables: {} }, { spaces: 2 });
    return p;
  }

  async query(workspaceId, sql) {
    // super simple: support:
    // - SELECT * FROM table
    // - INSERT INTO table VALUES {"k":...}
    // This is purposely minimal for demo/test.
    const p = await this._dbPath(workspaceId);
    const db = await fs.readJson(p);
    const s = sql.trim();
    if (/^select\s+\*\s+from\s+(\w+)/i.test(s)) {
      const m = s.match(/^select\s+\*\s+from\s+(\w+)/i);
      const table = m[1];
      return db.tables[table] || [];
    }
    if (/^insert\s+into\s+(\w+)\s+values\s+(.+)/i.test(s)) {
      const m = s.match(/^insert\s+into\s+(\w+)\s+values\s+(.+)/i);
      const table = m[1];
      let vals;
      try { vals = JSON.parse(m[2]); } catch { vals = null; }
      if (!db.tables[table]) db.tables[table] = [];
      db.tables[table].push(vals);
      await fs.writeJson(p, db, { spaces: 2 });
      return { ok: true };
    }
    throw new Error("Unsupported VDB query. Use SELECT * FROM table or INSERT INTO table VALUES {...}");
  }
}