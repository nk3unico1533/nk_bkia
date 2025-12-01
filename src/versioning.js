import sqlite3 from "sqlite3";
import { open } from "sqlite";
import fs from "fs/promises";
import path from "path";

export class Versioning {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.ready = this._init();
  }
  async _init() {
    this.db = await open({ filename: this.dbPath, driver: sqlite3.Database });
    await this.db.exec(`CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY, workspace TEXT, filepath TEXT, content TEXT, created INTEGER, meta TEXT
    )`);
  }
  async initWorkspace(workspaceId) {
    await this.ready;
    // noop
  }
  async saveSnapshot(workspaceId, filepath, content, meta={}) {
    await this.ready;
    const id = (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,8));
    await this.db.run(`INSERT INTO snapshots (id, workspace, filepath, content, created, meta) VALUES (?,?,?,?,?,?)`,
      id, workspaceId, filepath, content, Date.now(), JSON.stringify(meta));
    return id;
  }
  async listSnapshots(workspaceId) {
    await this.ready;
    const rows = await this.db.all(`SELECT id, filepath, created, meta FROM snapshots WHERE workspace = ? ORDER BY created DESC LIMIT 100`, workspaceId);
    return rows.map(r => ({ id: r.id, filepath: r.filepath, created: r.created, meta: JSON.parse(r.meta||"{}") }));
  }
  async restoreSnapshot(workspaceId, snapshotId, workspacesPath) {
    await this.ready;
    const row = await this.db.get(`SELECT * FROM snapshots WHERE id = ? AND workspace = ?`, snapshotId, workspaceId);
    if (!row) throw new Error("snapshot not found");
    const target = path.join(workspacesPath, workspaceId, row.filepath);
    if (row.content === null) {
      try { await fs.unlink(target); } catch(e){}
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, row.content);
    }
    return { ok: true, appliedTo: row.filepath };
  }
}