// The only bridge between the web UI and Node. Exposes a small, safe window.api.
const { contextBridge, ipcRenderer } = require("electron");

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld("api", {
  // app + java
  getSettings: () => invoke("app:settings"),
  setJavaPath: (p) => invoke("app:setJavaPath", p),
  detectJava: () => invoke("java:detect"),

  // versions
  paperVersions: () => invoke("jars:paperVersions"),
  vanillaVersions: () => invoke("jars:vanillaVersions"),

  // servers
  listServers: () => invoke("servers:list"),
  createServer: (cfg) => invoke("servers:create", cfg),
  pickFolder: () => invoke("dialog:pickFolder"),
  importServer: (cfg) => invoke("servers:import", cfg),
  startServer: (id) => invoke("servers:start", id),
  stopServer: (id) => invoke("servers:stop", id),
  sendCommand: (id, cmd) => invoke("servers:command", id, cmd),
  serverState: (id) => invoke("servers:state", id),
  deleteServer: (id) => invoke("servers:delete", id),
  renameServer: (id, name) => invoke("servers:rename", id, name),

  // settings + files
  readProps: (id) => invoke("props:read", id),
  writeProps: (id, updates) => invoke("props:write", id, updates),
  listFiles: (id) => invoke("files:list", id),
  readFile: (id, name) => invoke("files:read", id, name),
  writeFile: (id, name, content) => invoke("files:write", id, name, content),

  // backups
  listBackups: (id) => invoke("backups:list", id),
  createBackup: (id, label) => invoke("backups:create", id, label),
  restoreBackup: (id, name) => invoke("backups:restore", id, name),
  deleteBackup: (id, name) => invoke("backups:delete", id, name),

  // network
  netInfo: () => invoke("net:info"),
  upnp: (action, port) => invoke("net:upnp", action, port),
  reachable: (host, port) => invoke("net:reachable", host, port),
  openExternal: (url) => invoke("app:openExternal", url),

  // playit.gg tunnel
  tunnelStatus: () => invoke("tunnel:status"),
  tunnelSetup: () => invoke("tunnel:setup"),
  tunnelStart: () => invoke("tunnel:start"),
  tunnelStop: () => invoke("tunnel:stop"),
  tunnelList: () => invoke("tunnel:list"),

  // live events (returns an unsubscribe function)
  onLog: (cb) => sub("server:log", cb),
  onStatus: (cb) => sub("server:status", cb),
  onPlayers: (cb) => sub("server:players", cb),
  onDownload: (cb) => sub("download:progress", cb),
  onTunnelClaimUrl: (cb) => sub("tunnel:claim-url", cb),
  onTunnelClaimState: (cb) => sub("tunnel:claim-state", cb),
  onTunnelStatus: (cb) => sub("tunnel:status", cb),
});

function sub(channel, cb) {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
