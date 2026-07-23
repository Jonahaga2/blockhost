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
  fabricVersions: () => invoke("jars:fabricVersions"),

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
  setAutoRestart: (id, enabled) => invoke("servers:setAutoRestart", id, enabled),
  setOwner: (id, owner) => invoke("servers:setOwner", id, owner),
  changeVersion: (id, ver) => invoke("servers:changeVersion", id, ver),
  resetWorld: (id) => invoke("servers:resetWorld", id),

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
  setAutoBackup: (id, opts) => invoke("backups:setAuto", id, opts),

  // world map
  worldMap: (id, dim, y, useCache) => invoke("world:render", id, dim, y, useCache),

  // plugins & mods (Modrinth)
  searchContent: (id, query) => invoke("content:search", id, query),
  installContent: (id, projectId) => invoke("content:install", id, projectId),
  listContent: (id) => invoke("content:list", id),
  removeContent: (id, name) => invoke("content:remove", id, name),
  toggleContent: (id, name) => invoke("content:toggle", id, name),

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
  onStats: (cb) => sub("server:stats", cb),
  onBackupMade: (cb) => sub("backup:made", cb),
  onCrashed: (cb) => sub("server:crashed", cb),
  onContentProgress: (cb) => sub("content:progress", cb),
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
