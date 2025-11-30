import { exec } from "child_process";
import path from "path";
import fs from "fs/promises";
import os from "os";

function execAsync(cmd) {
  return new Promise((res, rej) => {
    exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) return rej({ err, stderr });
      res({ stdout, stderr });
    });
  });
}

export class Runner {
  constructor({ workspacesPath, io }) {
    this.workspacesPath = workspacesPath;
    this.io = io;
    this.active = new Map();
  }

  async run(workspaceId, file, opts = {}) {
    const wsPath = path.join(this.workspacesPath, workspaceId);
    const ext = path.extname(file || "index.html").toLowerCase();

    // get free port na faixa alta (simples)
    const port = 30000 + Math.floor(Math.random() * 20000);

    // prepare command and container image according to ext
    if ([".html", ".htm", ".css", ".js", ".svg"].includes(ext)) {
      // serve static with python http.server inside container
      const memory = (opts.mode === "sandbox") ? (process.env.DEFAULT_MEMORY_LIMIT || "512m") : "1g";
      const cpus = (opts.mode === "sandbox") ? (process.env.DEFAULT_CPU_LIMIT || "0.5") : "1.0";
      const cmd = `docker run --rm -d -p ${port}:8000 --memory=${memory} --cpus=${cpus} -v ${wsPath}:/srv:ro python:3.11-slim sh -c "cd /srv && python -m http.server 8000"`;
      const { stdout } = await execAsync(cmd);
      const containerId = stdout.trim();
      const previewUrl = `http://localhost:${port}/${file}`;
      this._attachLogs(workspaceId, containerId);
      this.active.set(workspaceId, { containerId, port });
      return { containerId, port, previewUrl };
    }

    // PHP handler (simple: use php:apache)
    if (ext === ".php") {
      const memory = (opts.mode === "sandbox") ? (process.env.DEFAULT_MEMORY_LIMIT || "512m") : "1g";
      const cpus = (opts.mode === "sandbox") ? (process.env.DEFAULT_CPU_LIMIT || "0.5") : "1.0";
      const cmd = `docker run --rm -d -p ${port}:80 --memory=${memory} --cpus=${cpus} -v ${wsPath}:/var/www/html:ro php:8.1-apache`;
      const { stdout } = await execAsync(cmd);
      const containerId = stdout.trim();
      const previewUrl = `http://localhost:${port}/${file}`;
      this._attachLogs(workspaceId, containerId);
      this.active.set(workspaceId, { containerId, port });
      return { containerId, port, previewUrl };
    }

    // Node.js: try to find package.json / server file
    if (ext === ".js" || ext === ".mjs") {
      // naive: run node server in workspace (user must provide server)
      const memory = (opts.mode === "sandbox") ? (process.env.DEFAULT_MEMORY_LIMIT || "512m") : "1g";
      const cpus = (opts.mode === "sandbox") ? (process.env.DEFAULT_CPU_LIMIT || "0.5") : "1.0";
      const cmd = `docker run --rm -d -p ${port}:3000 --memory=${memory} --cpus=${cpus} -v ${wsPath}:/usr/src/app -w /usr/src/app node:20 bash -c "npm i --silent || true; node ${file}"`;
      const { stdout } = await execAsync(cmd);
      const containerId = stdout.trim();
      const previewUrl = `http://localhost:${port}/`;
      this._attachLogs(workspaceId, containerId);
      this.active.set(workspaceId, { containerId, port });
      return { containerId, port, previewUrl };
    }

    throw new Error("Runner: file type não suportado ainda: " + ext);
  }

  async stop(workspaceId) {
    const info = this.active.get(workspaceId);
    if (!info) return;
    try {
      await execAsync(`docker kill ${info.containerId}`);
    } catch (e) {
      // ignore
    }
    this.active.delete(workspaceId);
  }

  _attachLogs(workspaceId, containerId) {
    // spawn docker logs -f and stream via socket.io
    const { spawn } = await import('child_process');
    const p = spawn('docker', ['logs', '-f', containerId]);

    p.stdout.on('data', (chunk) => {
      this.io.to(`ws:${workspaceId}`).emit('runner:log', { text: chunk.toString() });
    });
    p.stderr.on('data', (chunk) => {
      this.io.to(`ws:${workspaceId}`).emit('runner:log', { text: chunk.toString(), level: 'error' });
    });

    // store proc if needed
    const info = this.active.get(workspaceId) || {};
    info.logProc = p;
    this.active.set(workspaceId, info);
  }
}
