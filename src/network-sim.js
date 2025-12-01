export class NetworkSim {
  constructor() {
    this.cfg = new Map();
  }
  setWorkspaceConfig(workspaceId, cfg) {
    this.cfg.set(workspaceId, cfg);
  }
  getWorkspaceConfig(workspaceId) {
    return this.cfg.get(workspaceId) || {};
  }
}