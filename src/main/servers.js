// Starts, stops and talks to the actual Minecraft server processes.
const { spawn, exec } = require("child_process");
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const store = require("./store");
const files = require("./files");

const bus = new EventEmitter();
const running = new Map(); // id -> { proc, status, players:Set }

function state(id) {
  return running.get(id) || { status: "stopped", players: [] };
}

function setStatus(id, status) {
  const r = running.get(id);
  if (r) r.status = status;
  bus.emit("status", { id, status });
}

function writeEula(dir) {
  fs.writeFileSync(path.join(dir, "eula.txt"), "eula=true\n");
}

// Drop a handshake file the in-game Host panel plugin reads on startup: it tells the
// plugin which server it is, how to reach the desktop app's local API, the secret
// token to authenticate with, and who the owner is (for the owner-only panel).
function writeHandshake(dir, id, cfg) {
  try {
    const { port, token } = require("./bridge").info();
    const data = { serverId: id, name: cfg.name || "", owner: cfg.owner || "", apiPort: port || null, token };
    fs.writeFileSync(path.join(dir, "blockhost.json"), JSON.stringify(data, null, 2));
  } catch {}
}

// Where the bundled HostPanel plugin jar lives, in dev and in the packaged app.
function pluginJarPath() {
  const candidates = [
    path.join(process.resourcesPath || "", "HostPanel.jar"),           // packaged (extraResources)
    path.join(__dirname, "..", "..", "resources", "HostPanel.jar"),    // running from source
  ];
  return candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
}

// Only Paper servers load Bukkit plugins. Drop the in-game Host panel into place so
// the owner never has to install it by hand. The bundled jar is the source of truth.
function installPlugin(dir, cfg) {
  if (cfg.type !== "Paper") return;
  const src = pluginJarPath();
  if (!src) return;
  try {
    const pluginsDir = path.join(dir, "plugins");
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.copyFileSync(src, path.join(pluginsDir, "HostPanel.jar"));
  } catch {}
}

function ensureProperties(dir, cfg) {
  const file = path.join(dir, "server.properties");
  if (fs.existsSync(file)) return;
  const lines = [
    `motd=${cfg.name || "A Minecraft Server"}`,
    `server-port=${cfg.port || 25565}`,
    "gamemode=survival",
    "difficulty=easy",
    "max-players=20",
    "pvp=true",
    "white-list=false",
    "online-mode=true",
    "level-name=world",
    "view-distance=10",
    "spawn-protection=16",
  ];
  fs.writeFileSync(file, lines.join("\n") + "\n");
}

function start(id, javaPath) {
  const cfg = store.get(id);
  if (!cfg) throw new Error("No such server");
  if (running.get(id) && running.get(id).proc) return; // already running

  const dir = store.serverDir(id);
  const jarName = cfg.jarName || "server.jar";
  const jar = path.join(dir, jarName);
  if (!fs.existsSync(jar)) throw new Error("Server files are missing — re-create or re-import the server.");

  writeEula(dir);
  ensureProperties(dir, cfg);
  files.applyProps(id); // re-assert the owner's saved settings before every launch
  writeHandshake(dir, id, cfg);
  installPlugin(dir, cfg);

  const ram = Math.max(1, cfg.ram || 2);
  const args = [`-Xmx${ram}G`, `-Xms${ram}G`, "-jar", jarName, "nogui"];
  const proc = spawn(javaPath || "java", args, { cwd: dir });

  const rec = { proc, status: "starting", players: new Set(), startedAt: Date.now(), statsTimer: null, stopping: false };
  running.set(id, rec);
  setStatus(id, "starting");
  startStats(id, rec);

  const handle = (buf) => {
    const text = buf.toString();
    text.split(/\r?\n/).forEach((raw) => {
      if (!raw) return;
      const line = raw.replace(/\x1b\[[0-9;]*m/g, ""); // strip ANSI colour codes from piped console
      bus.emit("log", { id, line });
      if (/Done \(/.test(line)) {
        setStatus(id, "running");
        // Make the owner an operator automatically, once, when the server is ready.
        if (cfg.owner && !rec.owned) {
          rec.owned = true;
          try { proc.stdin.write(`op ${cfg.owner}\n`); } catch {}
        }
      }

      let changed = false;
      const join = line.match(/(\w{1,16}) joined the game/);
      const left = line.match(/(\w{1,16}) left the game/);
      if (join) { rec.players.add(join[1]); changed = true; }
      if (left) { rec.players.delete(left[1]); changed = true; }

      // authoritative sync from a /list command: "There are N of a max of M players online: a, b"
      if (/There are \d+ of a max of \d+ players online/i.test(line)) {
        const names = (line.split(/players online:?/i)[1] || "").split(/,\s*/).map((n) => n.trim()).filter(Boolean);
        rec.players = new Set(names);
        changed = true;
      }
      if (changed) bus.emit("players", { id, players: [...rec.players] });
    });
  };

  proc.stdout.on("data", handle);
  proc.stderr.on("data", handle);

  proc.on("close", (code) => {
    if (rec.statsTimer) clearInterval(rec.statsTimer);
    const wasStopping = rec.stopping;
    running.delete(id);
    bus.emit("log", { id, line: `[Host] Server stopped (exit code ${code}).` });
    bus.emit("players", { id, players: [] });
    bus.emit("stats", { id, memMB: null, uptimeMs: 0, players: 0, status: "stopped" });
    if (!wasStopping) bus.emit("crashed", { id, code });
    bus.emit("status", { id, status: "stopped" });
  });

  proc.on("error", (err) => {
    running.delete(id);
    bus.emit("log", { id, line: `[Host] Failed to start: ${err.message}` });
    bus.emit("status", { id, status: "stopped" });
  });
}

// ---- live stats (uptime, memory, player count) ----
function memoryMB(pid) {
  return new Promise((resolve) => {
    exec(`tasklist /FI "PID eq ${pid}" /NH /FO CSV`, { timeout: 4000 }, (err, stdout) => {
      const m = stdout && stdout.match(/"([\d,]+) K"/);
      resolve(m ? Math.round(parseInt(m[1].replace(/,/g, ""), 10) / 1024) : null);
    });
  });
}
function startStats(id, rec) {
  const tick = async () => {
    if (!rec.proc) return;
    const memMB = await memoryMB(rec.proc.pid);
    bus.emit("stats", { id, memMB, uptimeMs: Date.now() - rec.startedAt, players: rec.players.size, status: rec.status });
  };
  rec.statsTimer = setInterval(tick, 3000);
  tick();
}

function command(id, cmd) {
  const r = running.get(id);
  if (!r || !r.proc) throw new Error("Server is not running");
  r.proc.stdin.write(cmd.replace(/^[/\\]/, "") + "\n");
}

function stop(id) {
  const r = running.get(id);
  if (!r || !r.proc) return;
  r.stopping = true; // an intentional stop — don't treat the exit as a crash
  setStatus(id, "stopping");
  try {
    r.proc.stdin.write("stop\n");
  } catch {
    r.proc.kill();
  }
}

function stopAll() {
  for (const id of running.keys()) stop(id);
}

function hasRunning() {
  for (const r of running.values()) if (r.proc) return true;
  return false;
}

// Last-resort: force-kill every server process so none is left orphaned holding a world lock.
function killAll() {
  for (const r of running.values()) {
    if (r.statsTimer) clearInterval(r.statsTimer);
    if (r.proc) try { r.proc.kill(); } catch {}
  }
  running.clear();
}

module.exports = { bus, start, stop, stopAll, hasRunning, killAll, command, state };
