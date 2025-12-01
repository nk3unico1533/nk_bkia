import path from "path";
import fs from "fs/promises";
import { VM } from "vm2";
import { safeJoin } from "./utils.js";

export class Runner {
  constructor({ workspacesPath, io = null, app = null }) {
    this.workspacesPath = workspacesPath;
    this.io = io;
    this.app = app;
    this.active = new Map();

    if (this.app) {
      // preview route: /preview/:workspaceId/<path...>
      this.app.get("/preview/:workspaceId/*", async (req, res) => {
        try {
          const workspaceId = req.params.workspaceId;
          const rel = req.params[0] || "index.html";
          const p = safeJoin(path.join(this.workspacesPath, workspaceId), rel);
          const data = await fs.readFile(p);
          if (rel.endsWith(".html")) res.type("html");
          else if (rel.endsWith(".css")) res.type("css");
          else if (rel.endsWith(".js")) res.type("application/javascript");
          else if (rel.endsWith(".json")) res.type("application/json");
          else if (rel.endsWith(".png")) res.type("png");
          else if (rel.endsWith(".svg")) res.type("image/svg+xml");
          else if (rel.endsWith(".jpg") || rel.endsWith(".jpeg")) res.type("jpeg");
          res.send(data);
        } catch {
          res.status(404).send("Not found");
        }
      });
    }
  }

  async run(workspaceId, file = "index.html", opts = {}) {
    const wsPath = path.join(this.workspacesPath, workspaceId);
    const rel = file || "index.html";
    const full = safeJoin(wsPath, rel);

    // existence
    try {
      await fs.access(full);
    } catch {
      throw new Error("file-not-found");
    }

    const ext = path.extname(rel).toLowerCase();

    if ([".html", ".htm", ".css", ".svg", ".png", ".jpg", ".jpeg", ".json"].includes(ext)) {
      const previewUrl = `/preview/${workspaceId}/${rel}`;
      if (this.io) this.io.to(`ws:${workspaceId}`).emit("runner:preview", { previewUrl });
      return { type: "static", previewUrl };
    }

    if (ext === ".js" || ext === ".mjs") {
      const code = await fs.readFile(full, "utf8");
      let stdout = "";
      const sandboxConsole = {
        log: (...args) => {
          const s = args.map(a => {
            try { return typeof a === "string" ? a : JSON.stringify(a); } catch { return String(a); }
          }).join(" ");
          stdout += s + "\n";
          if (this.io) this.io.to(`ws:${workspaceId}`).emit("runner:log", { text: s });
        },
        error: (...args) => {
          const s = args.map(a => String(a)).join(" ");
          stdout += "ERROR: " + s + "\n";
          if (this.io) this.io.to(`ws:${workspaceId}`).emit("runner:error", { text: s });
        }
      };

      const timeout = parseInt(process.env.DEFAULT_JS_TIMEOUT_MS || "2000", 10);
      const vm = new VM({
        timeout,
        sandbox: { console: sandboxConsole, process: { env: { NODE_ENV: process.env.NODE_ENV || "production" } } },
        eval: false,
        wasm: false
      });

      try {
        const result = vm.run(`(async ()=>{ ${code} })()`);
        if (result && typeof result.then === "function") await result;
      } catch (err) {
        const msg = err && err.stack ? err.stack.toString() : String(err);
        if (this.io) this.io.to(`ws:${workspaceId}`).emit("runner:error", { text: msg });
        return { type: "js", success: false, error: msg, stdout };
      }

      return { type: "js", success: true, stdout };
    }

    return { type: "unsupported", message: "Unsupported language in Render edition" };
  }

  async stop(workspaceId) {
    if (this.active.has(workspaceId)) this.active.delete(workspaceId);
    return { ok: true };
  }
}