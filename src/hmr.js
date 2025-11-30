import chokidar from "chokidar";
import path from "path";

export function watchWorkspace(workspaceId, workspacesPath, io) {
  const dir = path.join(workspacesPath, workspaceId);
  try {
    const watcher = chokidar.watch(dir, { ignored: /node_modules|\.git/ });
    watcher.on("change", (filePath) => {
      const rel = filePath.replace(dir + path.sep, "");
      io.to(`ws:${workspaceId}`).emit("file:changed", { path: rel });
    });
    watcher.on("add", (filePath) => {
      const rel = filePath.replace(dir + path.sep, "");
      io.to(`ws:${workspaceId}`).emit("file:added", { path: rel });
    });
    watcher.on("unlink", (filePath) => {
      const rel = filePath.replace(dir + path.sep, "");
      io.to(`ws:${workspaceId}`).emit("file:deleted", { path: rel });
    });
    return watcher;
  } catch (e) {
    console.error("watchWorkspace error", e);
  }
}
