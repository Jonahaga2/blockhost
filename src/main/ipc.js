// Bridges the UI (renderer) to the engine. Every window.api.xxx() call lands here.
const { ipcMain, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const store = require("./store");
const java = require("./java");
const jars = require("./jars");
const servers = require("./servers");
const files = require("./files");
const backup = require("./backup");
const network = require("./network");
const tunnel = require("./tunnel");
const worldmap = require("./worldmap");
const modrinth = require("./modrinth");

let settings = { javaPath: "" };
function settingsFile() {
  return path.join(store.ROOT(), "app-settings.json");
}
function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), "utf8")) };
  } catch {}
}
function saveSettings() {
  store.ensureDirs();
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}

function register(win) {
  loadSettings();

  // forward live server events to the window
  servers.bus.on("log", (d) => win.webContents.send("server:log", d));
  servers.bus.on("status", (d) => win.webContents.send("server:status", d));
  servers.bus.on("players", (d) => win.webContents.send("server:players", d));
  servers.bus.on("stats", (d) => win.webContents.send("server:stats", d));

  // ---- automatic backups ----
  const lastAuto = {};
  const online = {};       // current player count per server
  const hadPlayers = {};   // has anyone been on since the last backup?
  servers.bus.on("players", (d) => {
    online[d.id] = d.players.length;
    if (d.players.length > 0) hadPlayers[d.id] = true;
  });
  function autoBackup(id, reason) {
    const cfg = store.get(id);
    if (!cfg || !cfg.autoBackup) return;
    try {
      backup.create(id, "auto");
      backup.prune(id, "auto", cfg.autoBackupKeep || 5);
      lastAuto[id] = Date.now();
      hadPlayers[id] = (online[id] || 0) > 0; // reset activity; keep true if someone's still on
      win.webContents.send("backup:made", { id, reason });
    } catch {}
  }
  servers.bus.on("status", (d) => {
    if (d.status === "running") lastAuto[d.id] = Date.now(); // don't back up the instant it starts
    if (d.status === "stopped") autoBackup(d.id, "server stopped");
  });
  setInterval(() => {
    for (const s of store.list()) {
      if (!s.autoBackup || servers.state(s.id).status !== "running") continue;
      const mins = s.autoBackupMins || 60;
      if (Date.now() - (lastAuto[s.id] || 0) < mins * 60000) continue;
      if (s.autoBackupPlayersOnly && !hadPlayers[s.id]) continue; // skip idle, empty servers
      autoBackup(s.id, "scheduled");
    }
  }, 60000);

  // ---- crash auto-restart ----
  const crashLog = {};              // id -> [timestamps of recent crashes]
  const RESTART_LIMIT = 3;          // give up after this many within the window
  const RESTART_WINDOW = 10 * 60000;
  const RESTART_DELAY = 3000;       // let the port/files settle before relaunching
  servers.bus.on("crashed", ({ id }) => {
    const cfg = store.get(id);
    if (!cfg || cfg.autoRestart === false) return; // on by default unless the user turned it off
    const now = Date.now();
    const hist = (crashLog[id] || []).filter((t) => now - t < RESTART_WINDOW);
    hist.push(now);
    crashLog[id] = hist;
    if (hist.length > RESTART_LIMIT) {
      win.webContents.send("server:crashed", { id, restarting: false, count: hist.length, limit: RESTART_LIMIT });
      return;
    }
    win.webContents.send("server:crashed", { id, restarting: true, count: hist.length, limit: RESTART_LIMIT });
    setTimeout(() => {
      try { servers.start(id, java.resolve(settings.javaPath || undefined)); } catch {}
    }, RESTART_DELAY);
  });

  const h = (name, fn) => ipcMain.handle(name, (_e, ...args) => fn(...args));

  // app + java
  h("app:settings", () => settings);
  h("app:setJavaPath", (p) => { settings.javaPath = p || ""; saveSettings(); return settings; });
  h("java:detect", () => java.detect(settings.javaPath || undefined));

  // versions
  h("jars:paperVersions", () => jars.paperVersions());
  h("jars:vanillaVersions", () => jars.vanillaVersions());
  h("jars:fabricVersions", () => jars.fabricVersions());

  // servers
  h("servers:list", () => store.list());
  h("servers:create", async (cfg, onProgressChannel) => {
    const id = Date.now();
    const server = {
      id,
      name: cfg.name || "New Server",
      type: cfg.type || "Paper",
      ver: cfg.ver,
      ram: cfg.ram || 2,
      port: cfg.port || 25565,
    };
    if (!server.ver || /couldn't|loading/i.test(server.ver))
      throw new Error("Pick a real version from the list first.");
    store.add(server);
    try {
      const dest = path.join(store.serverDir(id), "server.jar");
      await jars.downloadServer(server.type, server.ver, dest, (received, total) => {
        win.webContents.send("download:progress", { id, received, total });
      });
      return server;
    } catch (e) {
      store.remove(id); // don't leave a broken, empty server behind
      throw e;
    }
  });
  h("dialog:pickFolder", async () => {
    const res = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "Choose your existing Minecraft server folder",
    });
    return res.canceled ? null : res.filePaths[0];
  });
  h("servers:import", (cfg) => {
    const dir = cfg.dir;
    if (!dir || !fs.existsSync(dir)) throw new Error("That folder doesn't exist.");
    // find a runnable jar (prefer server.jar, else the biggest .jar in the folder)
    let jarName = "server.jar";
    if (!fs.existsSync(path.join(dir, "server.jar"))) {
      const found = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".jar"));
      if (!found.length) throw new Error("No .jar file found in that folder — is it a server folder?");
      jarName = found.sort((a, b) => fs.statSync(path.join(dir, b)).size - fs.statSync(path.join(dir, a)).size)[0];
    }
    // pull the port from the existing server.properties if we can
    let port = cfg.port || 25565;
    const propsFile = path.join(dir, "server.properties");
    if (fs.existsSync(propsFile)) {
      const m = fs.readFileSync(propsFile, "utf8").match(/^server-port=(\d+)/m);
      if (m) port = parseInt(m[1], 10);
    }
    const id = Date.now();
    const server = { id, name: cfg.name || path.basename(dir), type: "Imported", ver: "existing", ram: cfg.ram || 2, port, dir, jarName };
    store.add(server);
    return server;
  });
  h("servers:start", (id) => {
    servers.start(id, java.resolve(settings.javaPath || undefined));
    return true;
  });
  h("servers:stop", (id) => { servers.stop(id); return true; });
  h("servers:command", (id, cmd) => { servers.command(id, cmd); return true; });
  h("servers:state", (id) => servers.state(id));
  h("servers:delete", (id) => { servers.stop(id); store.remove(id); return true; });
  h("servers:rename", (id, name) => store.update(id, { name }));
  h("servers:setAutoRestart", (id, enabled) => store.update(id, { autoRestart: !!enabled }));

  // settings (server.properties) + raw files
  h("props:read", (id) => files.readProps(id));
  h("props:write", (id, updates) => { files.writeProps(id, updates); return true; });
  h("files:list", (id) => files.listFiles(id));
  h("files:read", (id, name) => files.readFile(id, name));
  h("files:write", (id, name, content) => { files.writeFile(id, name, content); return true; });

  // backups
  h("backups:list", (id) => backup.list(id));
  h("backups:create", (id, label) => backup.create(id, label));
  h("backups:restore", (id, name) => { servers.stop(id); backup.restore(id, name); return true; });
  h("backups:delete", (id, name) => { backup.remove(id, name); return true; });
  h("backups:setAuto", (id, opts) => store.update(id, {
    autoBackup: !!opts.enabled,
    autoBackupMins: opts.mins || 60,
    autoBackupKeep: opts.keep || 5,
    autoBackupPlayersOnly: !!opts.playersOnly,
  }));

  // world map (top-down block colours)
  h("world:render", (id, dim, y, useCache) => worldmap.render(id, dim, y, useCache));

  // plugins & mods (Modrinth)
  h("content:search", (id, query) => {
    const s = store.get(id);
    return s ? modrinth.search(s.type, query) : { hits: [], total_hits: 0 };
  });
  h("content:install", async (id, projectId) => {
    const s = store.get(id);
    if (!s) throw new Error("No such server");
    return modrinth.install(id, s.type, projectId, s.ver, (received, total) => {
      win.webContents.send("content:progress", { id, received, total });
    });
  });
  h("content:list", (id) => {
    const s = store.get(id);
    return s ? modrinth.list(id, s.type) : [];
  });
  h("content:remove", (id, name) => {
    const s = store.get(id);
    if (s) modrinth.remove(id, s.type, name);
    return true;
  });
  h("content:toggle", (id, name) => {
    const s = store.get(id);
    if (s) modrinth.toggle(id, s.type, name);
    return true;
  });

  // network / invite a friend
  h("net:info", () => network.info());
  h("net:upnp", (action, port) => network.upnp(action, port));
  h("net:reachable", (host, port) => network.reachable(host, port));

  // open a link in the real browser
  h("app:openExternal", (url) => shell.openExternal(url));

  // playit.gg tunnel
  tunnel.bus.on("claim-url", (url) => win.webContents.send("tunnel:claim-url", url));
  tunnel.bus.on("claim-state", (state) => win.webContents.send("tunnel:claim-state", state));
  tunnel.bus.on("log", (line) => win.webContents.send("tunnel:log", line));
  tunnel.bus.on("status", (s) => win.webContents.send("tunnel:status", s));
  h("tunnel:status", () => ({ running: tunnel.isRunning(), hasSecret: !!settings.tunnelSecret }));
  h("tunnel:setup", async () => {
    const secret = await tunnel.claim();          // waits for browser approval
    settings.tunnelSecret = secret; saveSettings();
    await tunnel.start(secret);
    return true;
  });
  h("tunnel:start", async () => {
    if (!settings.tunnelSecret) throw new Error("Set up the tunnel first.");
    await tunnel.start(settings.tunnelSecret);
    return true;
  });
  h("tunnel:stop", () => { tunnel.stop(); return true; });
  h("tunnel:list", () => (settings.tunnelSecret ? tunnel.tunnels(settings.tunnelSecret) : []));
}

module.exports = { register };
