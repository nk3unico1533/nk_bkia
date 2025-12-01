import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import fs from "fs/promises";

export class VirtualDB {
  constructor() {
    this.dbs = new Map();
  }
  async _openForWorkspace(workspaceId) {
    if (this.dbs.has(workspaceId)) return this.dbs.get(workspaceId);
    const dbPath = path.join(process.cwd(), "vdb", `${workspaceId}.db`);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    this.dbs.set(workspaceId, db);
    return db;
  }
  async query(workspaceId, sql) {
    const db = await this._openForWorkspace(workspaceId);
    if (/^\s*select/i.test(sql)) {
      return await db.all(sql);
    } else {
      const r = await db.run(sql);
      return { changes: r.changes, lastID: r.lastID };
    }
  }
}