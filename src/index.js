import express from "express";
import http from "http";
import { Server as IOServer } from "socket.io";
import bodyParser from "body-parser";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs-extra";
import dotenv from "dotenv";

dotenv.config();

import { Runner } from "./runner.js";
import { Versioning } from "./versioning.js";
import { VirtualDB } from "./virtualdb.js";
import { NetworkSim } from "./network-sim.js";
import { watchWorkspace } from "./hmr.js";
import { ensureDir, safeJoin } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const WORKSPACES = path.resolve(process.env.WORKSPACES_PATH || path.join(__dirname, "..", "workspaces"));

await ensureDir(WORKSPACES);
await ensureDir(path.join(__dirname, "..", "workspaces")); // ensure top-level

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, { cors: { origin: "*" } });

app.use(cors());
app.use(bodyParser.json({ limit: "20mb" }));

// instantiate services
const runner = new Runner({ workspacesPath: WORKSPACES, io, app });
const versioning = new Versioning(path.join(__dirname, "..", "nk_versions"));
const vdb = new VirtualDB();
const netSim = new NetworkSim();

// websocket subscribe
io.on("connection", socket => {
  socket.on("subscribe", ({ workspaceId }) => {
    socket.join(`ws:${workspaceId}`);
  });
});

// --- Workspace CRUD
app.post("/api/workspaces", async (req, res) => {
  try {
    const id = require("uuid").v4 ? require("uuid").v4() : null; // fallback if needed
    // prefer uuid import - but if not, use timestamp
    const workspaceId = id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
    const dir = path.join(WORKSPACES, workspaceId);
    await ensureDir(dir);
    await fs.writeFile(path.join(dir, "index.html"), `<!doctype html><html><body><h1>NK Workspace ${workspaceId}</h1></body></html>`, "utf8");
    await versioning.initWorkspace(workspaceId);
    watchWorkspace(workspaceId, WORKSPACES, io);
    return res.json({ id: workspaceId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/workspaces/:id/files", async (req, res) => {
  try {
    const dir = path.join(WORKSPACES, req.params.id);
    const list = await fs.readdir(dir);
    res.json({ files: list });
  } catch (err) {
    res.status(404).json({ error: "workspace not found" });
  }
});

app.get("/api/workspaces/:id/file", async (req, res) => {
  try {
    const { id } = req.params;
    const rel = req.query.path || "index.html";
    const p = safeJoin(path.join(WORKSPACES, id), rel);
    const content = await fs.readFile(p, "utf8");
    res.json({ content });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.put("/api/workspaces/:id/file", async (req, res) => {
  try {
    const { id } = req.params;
    const { path: rel, content } = req.body;
    const p = safeJoin(path.join(WORKSPACES, id), rel);
    await ensureDir(path.dirname(p));
    await fs.writeFile(p, content || "", "utf8");
    await versioning.saveSnapshot(id, rel, content || "");
    io.to(`ws:${id}`).emit("file:changed", { path: rel });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/workspaces/:id/file", async (req, res) => {
  try {
    const { id } = req.params;
    const { path: rel } = req.body;
    const p = safeJoin(path.join(WORKSPACES, id), rel);
    await fs.unlink(p);
    await versioning.saveSnapshot(id, rel, null, { deleted: true });
    io.to(`ws:${id}`).emit("file:deleted", { path: rel });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// snapshots / time machine
app.get("/api/workspaces/:id/snapshots", async (req, res) => {
  try {
    const snaps = await versioning.listSnapshots(req.params.id);
    res.json(snaps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/workspaces/:id/restore", async (req, res) => {
  try {
    const { snapshotId } = req.body;
    const restored = await versioning.restoreSnapshot(req.params.id, snapshotId, WORKSPACES);
    io.to(`ws:${req.params.id}`).emit("workspace:restored", { snapshotId });
    res.json({ ok: true, restored });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// run / preview
app.post("/api/workspaces/:id/run", async (req, res) => {
  try {
    const { id } = req.params;
    const { file, mode = "sandbox", network = {} } = req.body;
    netSim.setWorkspaceConfig(id, network);
    const runInfo = await runner.run(id, file, { mode, networkConfig: network });
    res.json(runInfo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/workspaces/:id/stop", async (req, res) => {
  try {
    await runner.stop(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// vdb
app.post("/api/workspaces/:id/vdb/query", async (req, res) => {
  try {
    const rows = await vdb.query(req.params.id, req.body.sql);
    res.json({ ok: true, rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// health
app.get("/", (req, res) => res.send("NK Backend running"));

const serverPort = process.env.PORT || PORT;
server.listen(serverPort, () => {
  console.log("NK backend listening:", serverPort);
});

/* ----------------------------------------------
   TERMINAL REAL (workspace-isolated)
   ---------------------------------------------- */

import { spawn } from "child_process";

app.post("/api/workspaces/:id/terminal", async (req, res) => {
  try {
    const { id } = req.params;
    const { command } = req.body;

    if (!command || typeof command !== "string")
      return res.status(400).json({ error: "invalid-command" });

    const wsPath = path.join(WORKSPACES, id);

    try { await fs.access(wsPath); }
    catch { return res.status(404).json({ error: "workspace-not-found" }); }

    // cria processo dentro do workspace
    const shell = spawn(command, {
      cwd: wsPath,
      shell: true,
      env: {
        ...process.env,
        PATH: process.env.PATH,
      }
    });

    const session = Date.now().toString();

    // stdout
    shell.stdout.on("data", (data) => {
      io.to(`ws:${id}`).emit("terminal:output", {
        session,
        text: data.toString()
      });
    });

    // stderr
    shell.stderr.on("data", (data) => {
      io.to(`ws:${id}`).emit("terminal:error", {
        session,
        text: data.toString()
      });
    });

    // fim do processo
    shell.on("close", (code) => {
      io.to(`ws:${id}`).emit("terminal:close", {
        session,
        code
      });
    });

    return res.json({
      ok: true,
      session
    });

  } catch (err) {
    console.error("TERMINAL ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});