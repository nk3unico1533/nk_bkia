import fs from "fs-extra";

export async function runFile(filename) {
  try {
    const path = `./workspace/${filename}`;
    if (!fs.existsSync(path)) return "Arquivo não encontrado.";

    const file = await fs.readFile(path, "utf8");

    return {
      success: true,
      rendered: file
    };
  } catch (e) {
    return {
      success: false,
      error: e.toString()
    };
  }
}