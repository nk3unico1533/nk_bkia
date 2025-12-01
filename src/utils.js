import fs from "fs-extra";
import path from "path";

export async function ensureDir(p) {
  await fs.ensureDir(p);
}

export function safeJoin(base, rel) {
  const full = path.normalize(path.join(base, rel));
  if (!full.startsWith(path.normalize(base))) throw new Error("Invalid path");
  return full;
}