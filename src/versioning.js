import fs from "fs-extra";
import { v4 as uuid } from "uuid";

const dir = "./versions";

export async function saveVersion(filename, content) {
  await fs.ensureDir(dir);

  const save = {
    id: uuid(),
    filename,
    content,
    date: Date.now()
  };

  await fs.writeJson(`${dir}/${filename}-${save.id}.json`, save);
  return save;
}

export async function getVersions(filename) {
  await fs.ensureDir(dir);

  const files = await fs.readdir(dir);
  const filtered = files.filter(f => f.startsWith(filename));

  const versions = [];

  for (const file of filtered) {
    const data = await fs.readJson(`${dir}/${file}`);
    versions.push(data);
  }

  return versions.sort((a, b) => b.date - a.date);
}