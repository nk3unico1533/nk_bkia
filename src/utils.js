import fs from "fs/promises";
import path from "path";

export async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

export function safeJoin(base, rel) {
  // evita path traversal simples
  const full = path.normalize(path.join(base, rel));
  if (!full.startsWith(path.normalize(base))) throw new Error("Invalid path");
  return full;
}
