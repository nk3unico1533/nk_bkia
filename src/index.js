import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs-extra";

import { runFile } from "./runner.js";
import { saveVersion, getVersions } from "./versioning.js";
import { applyHMR } from "./hmr.js";
import { vdb } from "./virtualdb.js";
import { simulateNetwork } from "./network-sim.js";
import { respond } from "./utils.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// =========================
//   CHECK API STATUS
// =========================
app.get("/", (req, res) => {
  res.send("NK Backend is running ✔️");
});

// =========================
//   LISTAR ARQUIVOS
// =========================
app.get("/files", async (req, res) => {
  const dir = "./workspace";

  await fs.ensureDir(dir);
  const tree = await fs.readdir(dir);

  res.json(tree);
});

// =========================
//   CRIAR / EDITAR ARQUIVO
// =========================
app.post("/file", async (req, res) => {
  const { filename, content } = req.body;

  await fs.ensureDir("./workspace");
  await fs.writeFile(`./workspace/${filename}`, content, "utf8");

  await saveVersion(filename, content);

  res.json({ ok: true, message: "File saved ✔️" });
});

// =========================
//   LER ARQUIVO
// =========================
app.get("/file/:name", async (req, res) => {
  try {
    const file = await fs.readFile(
      `./workspace/${req.params.name}`,
      "utf8"
    );
    res.json({ content: file });
  } catch {
    res.status(404).json({ error: "Arquivo não encontrado" });
  }
});

// =========================
//   EXCLUIR ARQUIVO
// =========================
app.delete("/file/:name", async (req, res) => {
  try {
    await fs.remove(`./workspace/${req.params.name}`);
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: "Erro ao deletar" });
  }
});

// =========================
//   EXECUTAR PREVIEW (NVIEW)
// =========================
app.post("/run", async (req, res) => {
  const { filename } = req.body;

  const output = await runFile(filename);
  res.json({ output });
});

// =========================
//   VERSÕES (TIME MACHINE)
// =========================
app.get("/versions/:name", async (req, res) => {
  const versions = await getVersions(req.params.name);
  res.json(versions);
});

// =========================
//   HMR
// =========================
app.post("/hmr", async (req, res) => {
  const result = await applyHMR(req.body);
  res.json(result);
});

// =========================
//   BANCO VIRTUAL
// =========================
app.post("/vdb", async (req, res) => {
  const result = vdb(req.body);
  res.json(result);
});

// =========================
//   SIMULAÇÕES DE REDE
// =========================
app.post("/network", async (req, res) => {
  const result = await simulateNetwork(req.body);
  res.json(result);
});

// =========================
//   START SERVER
// =========================

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("NK Backend rodando na porta " + PORT);
});