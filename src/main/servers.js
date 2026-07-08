// Starts, stops and talks to the actual Minecraft server processes.
const { spawn } = require("child_process");
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const store = require("./store");

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

  const ram = Math.max(1, cfg.ram || 2);
  const args = [`-Xmx${ram}G`, `-Xms${ram}G`, "-jar", jarName, "nogui"];
  const proc = spawn(javaPath || "java", args, { cwd: dir });

  const rec = { proc, status: "starting", players: new Set() };
  running.set(id, rec);
  setStatus(id, "starting");

  const handle = (buf) => {
    const text = buf.toString();
    text.split(/\r?\n/).forEach((line) => {
      if (!line) return;
      bus.emit("log", { id, line });
      if (/Done \(/.test(line)) setStatus(id, "running");
      const join = line.match(/: (\w+) joined the game/);
      const left = line.match(/: (\w+) left the game/);
      if (join) rec.players.add(join[1]);
      if (left) rec.players.delete(left[1]);
      if (join || left) bus.emit("players", { id, players: [...rec.players] });
    });
  };

  proc.stdout.on("data", handle);
  proc.stderr.on("data", handle);

  proc.on("close", (code) => {
    running.delete(id);
    bus.emit("log", { id, line: `[BlockHost] Server stopped (exit code ${code}).` });
    bus.emit("players", { id, players: [] });
    bus.emit("status", { id, status: "stopped" });
  });

  proc.on("error", (err) => {
    running.delete(id);
    bus.emit("log", { id, line: `[BlockHost] Failed to start: ${err.message}` });
    bus.emit("status", { id, status: "stopped" });
  });
}

function command(id, cmd) {
  const r = running.get(id);
  if (!r || !r.proc) throw new Error("Server is not running");
  r.proc.stdin.write(cmd.replace(/^[/\\]/, "") + "\n");
}

function stop(id) {
  const r = running.get(id);
  if (!r || !r.proc) return;
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

module.exports = { bus, start, stop, stopAll, command, state };
