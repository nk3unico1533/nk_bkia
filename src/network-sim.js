export class NetworkSim {
  constructor() {
    this.cfg = new Map();
  }

  setWorkspaceConfig(workspaceId, cfg) {
    this.cfg.set(workspaceId, cfg || {});
  }

  getWorkspaceConfig(workspaceId) {
    return this.cfg.get(workspaceId) || {};
  }
}

export function networkSimMiddleware(req, res, next) {
  // optional middleware if you want to mount globally; not used by default here
  const latency = parseInt(process.env.NETWORK_LATENCY || "0", 10);
  const failRate = parseFloat(process.env.NETWORK_FAILURE_RATE || "0");
  if (Math.random() < failRate) {
    return res.status(500).json({ ok: false, error: "Simulated network failure" });
  }
  if (latency > 0) return setTimeout(next, latency);
  return next();
}