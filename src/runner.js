// src/runner.js
import path from "path";
import fs from "fs/promises";
import { VM } from "vm2";

function safeJoin(base, rel) {
  const resolved = path.normalize(path.join(base, rel));
  if (!resolved.startsWith(path.normalize(base))) throw new Error("Invalid path");
  return resolved;
}

export class Runner {
  /**
   * @param {Object} opts
   * @param {string} opts.workspacesPath - caminho base dos workspaces
   * @param {import("socket.io").Server} opts.io - socket.io para logs (opcional)
   * @param {import("express").Application} opts.app - instância do express (opcional)
   */
  constructor({ workspacesPath, io = null, app = null }) {
    this.workspacesPath = workspacesPath;
    this.io = io;
    this.app = app;
    this.active = new Map(); // workspaceId -> execution info

    if (this.app) {
      // rota de preview dinâmica: /preview/:workspaceId/<path...>
      this.app.get("/preview/:workspaceId/*", async (req, res) => {
        try {
          const workspaceId = req.params.workspaceId;
          const rel = req.params[0] || "index.html";
          const filePath = safeJoin(path.join(this.workspacesPath, workspaceId), rel);
          const data = await fs.readFile(filePath);
          // content type simples por extensão
          if (rel.endsWith(".html")) res.type("html");
          else if (rel.endsWith(".css")) res.type("css");
          else if (rel.endsWith(".js")) res.type("application/javascript");
          else if (rel.endsWith(".json")) res.type("application/json");
          else if (rel.endsWith(".png")) res.type("png");
          else if (rel.endsWith(".svg")) res.type("image/svg+xml");
          else if (rel.endsWith(".jpg") || rel.endsWith(".jpeg")) res.type("jpeg");
          // stream
          res.send(data);
        } catch (err) {
          res.status(404).send("Not found");
        }
      });
    }
  }

  /**
   * Run a file in the workspace.
   * - For static files: returns previewUrl to /preview/:workspaceId/:file
   * - For .js: executes code in vm2 sandbox and returns captured stdout
   *
   * @param {string} workspaceId
   * @param {string} file - relative path inside workspace
   * @param {Object} opts
   */
  async run(workspaceId, file = "index.html", opts = {}) {
    const wsPath = path.join(this.workspacesPath, workspaceId);
    const rel = file || "index.html";
    const full = safeJoin(wsPath, rel);
    // quick existence check
    try {
      await fs.access(full);
    } catch {
      throw new Error("file-not-found");
    }

    const ext = path.extname(rel).toLowerCase();

    // STATIC: just return a preview URL that index.js already serves
    if ([".html", ".htm", ".css", ".svg", ".png", ".jpg", ".jpeg", ".json"].includes(ext)) {
      // previewUrl relative to the same host
      const previewUrl = `/preview/${workspaceId}/${rel}`;
      // notify via socket if present
      if (this.io) this.io.to(`ws:${workspaceId}`).emit("runner:preview", { previewUrl });
      return { type: "static", previewUrl };
    }

    // JS: execute inside vm2 sandbox (safe-ish)
    if (ext === ".js" || ext === ".mjs") {
      const code = await fs.readFile(full, "utf8");

      // capture console.log
      let stdout = "";
      const sandboxConsole = {
        log: (...args) => {
          const s = args.map(a => {
            try { return typeof a === "string" ? a : JSON.stringify(a); } catch { return String(a); }
          }).join(" ");
          stdout += s + "\n";
          // emit to socket
          if (this.io) this.io.to(`ws:${workspaceId}`).emit("runner:log", { text: s });
        },
        error: (...args) => {
          const s = args.join(" ");
          stdout += "ERROR: " + s + "\n";
          if (this.io) this.io.to(`ws:${workspaceId}`).emit("runner:error", { text: s });
        }
      };

      // vm2 options
      const timeout = opts.timeout || 2000; // ms
      const memoryLimit = opts.memoryLimitMB || 64;

      const vm = new VM({
        timeout,
        sandbox: {
          console: sandboxConsole,
          // provide a minimal "process.env" with only user-safe vars
          process: {
            env: { NODE_ENV: process.env.NODE_ENV || "production" }
          }
        },
        eval: false,
        wasm: false
      });

      let result = null;
      try {
        // run code
        result = vm.run(`(async ()=>{ ${code} })()`);
        // if returns a promise, await
        if (result && typeof result.then === "function") {
          await result;
        }
      } catch (err) {
        const msg = (err && err.stack) ? err.stack.toString() : String(err);
        if (this.io) this.io.to(`ws:${workspaceId}`).emit("runner:error", { text: msg });
        return { type: "js", success: false, error: msg, stdout };
      }

      return { type: "js", success: true, stdout };
    }

    // Other langs: not supported in Render edition
    return {
      type: "unsupported",
      message:
        "Runner no Render suporta preview estático e execução JS via sandbox. Para PHP/Python/servers, use um runner externo (ex.: VPS, Fly.io, Railway) ou ative o runner local com Docker."
    };
  }

  async stop(workspaceId) {
    // no-op: nothing to stop for static or vm runs (vm finishes)
    if (this.active.has(workspaceId)) this.active.delete(workspaceId);
    return { ok: true };
  }
}