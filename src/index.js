import express from "express";
import http from "http";
import { Server as IOServer } from "socket.io";
import bodyParser from "body-parser";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";

import { Runner } from "./runner.js";
import { Versioning } from "./versioning.js";
import { VirtualDB } from "./virtualdb.js";
import { NetworkSim } from "./network-sim.js";
import { watchWorkspace } from "./hmr.js";
import { ensureDir, safeJoin } from "./utils.js";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const WORKSPACES = path.resolve(process.env.WORKSPACES_PATH || path.join(__dirname, "..", "workspaces"));

await ensureDir(WORKSPACES);

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

const server = http.createServer(app);
const io = new IOServer(server, { cors: { origin: "*" } });

const runner = new Runner({ workspacesPath: WORKSPACES, io });
const versioning = new Versioning(path.join(__dirname, "..", "nk_versions.db"));
const vdb = new VirtualDB();
const netSim = new NetworkSim();

io.on("connection", socket => {
  console.log("ws connected", socket.id);
  socket.on("subscribe", ({ workspaceId }) => {
    socket.join(`ws:${workspaceId}`);
  });
});

// --- Workspaces CRUD
app.post("/api/workspaces", async (req, res) => {
  const id = uuidv4();
  const dir = path.join(WORKSPACES, id);
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, "index.html"), `<!doctype html><html><body><h1>NK Workspace ${id}</h1></body></html>`);
  await versioning.initWorkspace(id);
  // start watch
  watchWorkspace(id, WORKSPACES, io);
  res.json({ id });
});

app.get("/api/workspaces/:id/files", async (req, res) => {
  const id = req.params.id;
  const dir = path.join(WORKSPACES, id);
  try {
    const files = await fs.readdir(dir);
    res.json({ files });
  } catch (e) {
    res.status(404).json({ error: "workspace not found" });
  }
});

// read file
app.get("/api/workspaces/:id/file", async (req, res) => {
  const id = req.params.id;
  const rel = req.query.path;
  try {
    const p = safeJoin(path.join(WORKSPACES, id), rel);
    const content = await fs.readFile(p, "utf8");
    res.json({ content });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// write file (create/update)
app.put("/api/workspaces/:id/file", async (req, res) => {
  const id = req.params.id;
  const { path: rel, content } = req.body;
  try {
    const p = safeJoin(path.join(WORKSPACES, id), rel);
    await ensureDir(path.dirname(p));
    await fs.writeFile(p, content || "");
    await versioning.saveSnapshot(id, rel, content || "");
    io.to(`ws:${id}`).emit("file:changed", { path: rel });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// delete file
app.delete("/api/workspaces/:id/file", async (req, res) => {
  const id = req.params.id;
  const { path: rel } = req.body;
  try {
    const p = safeJoin(path.join(WORKSPACES, id), rel);
    await fs.unlink(p);
    await versioning.saveSnapshot(id, rel, null, { deleted: true });
    io.to(`ws:${id}`).emit("file:deleted", { path: rel });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// snapshots
app.get("/api/workspaces/:id/snapshots", async (req, res) => {
  const snaps = await versioning.listSnapshots(req.params.id);
  res.json(snaps);
});

app.post("/api/workspaces/:id/restore", async (req, res) => {
  const { snapshotId } = req.body;
  try {
    const restored = await versioning.restoreSnapshot(req.params.id, snapshotId, WORKSPACES);
    io.to(`ws:${req.params.id}`).emit("workspace:restored", { snapshotId });
    res.json({ ok: true, restored });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// run / play
app.post("/api/workspaces/:id/run", async (req, res) => {
  const id = req.params.id;
  const { file, mode = "sandbox", network = {} } = req.body;
  netSim.setWorkspaceConfig(id, network);
  try {
    const runInfo = await runner.run(id, file, { mode, networkConfig: network });
    res.json({ previewUrl: runInfo.previewUrl, containerId: runInfo.containerId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/workspaces/:id/stop", async (req, res) => {
  const id = req.params.id;
  try {
    await runner.stop(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// analyze line (AI integration stub)
app.post("/api/workspaces/:id/analyze", async (req, res) => {
  const id = req.params.id;
  const { file, line } = req.body;
  try {
    const p = safeJoin(path.join(WORKSPACES, id), file);
    const data = await fs.readFile(p, "utf8");
    const lines = data.split("\n");
    const ctx = lines.slice(Math.max(0,line-6), line+6).join("\n");
    // aqui integra com OpenAI/Gemini: enviar prompt com ctx
    res.json({ context: ctx, file, line });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// virtual DB
app.post("/api/workspaces/:id/vdb/query", async (req, res) => {
  const id = req.params.id;
  const { sql } = req.body;
  try {
    const rows = await vdb.query(id, sql);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

server.listen(PORT, () => console.log("NK backend listening:", PORT));

// auto-watch existing workspaces on start
(async ()=>{
  const ws = await fs.readdir(WORKSPACES);
  for (const id of ws) {
    watchWorkspace(id, WORKSPACES, io);
  }
})();