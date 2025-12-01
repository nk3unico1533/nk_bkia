import fs from "fs-extra";
import path from "path";
import { v4 as uuid } from "uuid";

export class Versioning {
  constructor(basePath) {
    this.base = basePath;
    fs.ensureDirSync(this.base);
  }

  async initWorkspace(workspaceId) {
    await fs.ensureDir(path.join(this.base, workspaceId));
  }

  async saveSnapshot(workspaceId, filepath, content, meta = {}) {
    const id = uuid();
    const dir = path.join(this.base, workspaceId);
    await fs.ensureDir(dir);
    const obj = { id, filepath, content, meta, created: Date.now() };
    await fs.writeJson(path.join(dir, `${id}.json`), obj, { spaces: 2 });
    return id;
  }

  async listSnapshots(workspaceId) {
    const dir = path.join(this.base, workspaceId);
    if (!await fs.pathExists(dir)) return [];
    const files = await fs.readdir(dir);
    const snaps = [];
    for (const f of files) {
      try {
        const obj = await fs.readJson(path.join(dir, f));
        snaps.push(obj);
      } catch {}
    }
    return snaps.sort((a,b)=>b.created - a.created);
  }

  async restoreSnapshot(workspaceId, snapshotId, workspacesPath) {
    const p = path.join(this.base, workspaceId, `${snapshotId}.json`);
    const obj = await fs.readJson(p);
    const target = path.join(workspacesPath, workspaceId, obj.filepath);
    if (obj.content === null) {
      try { await fs.remove(target); } catch {}
    } else {
      await fs.ensureDir(path.dirname(target));
      await fs.writeFile(target, obj.content, "utf8");
    }
    return { ok: true, appliedTo: obj.filepath };
  }
}