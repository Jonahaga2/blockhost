// Local HTTP bridge between BlockHost and the in-game Host panel plugin.
//
// The plugin runs *inside* a Minecraft server and can do anything an op can do on
// its own, but app-level features (backups, share address, etc.) live out here in
// the desktop app. This exposes them over a tiny HTTP API that is:
//   - bound to 127.0.0.1 only (never reachable from the network),
//   - guarded by a per-session secret token the plugin reads from a handshake file.
//
// Modules are require()d lazily inside handlers so this file can be part of the
// require cycle with servers.js without capturing a half-initialised exports object.
const http = require("http");
const crypto = require("crypto");

const TOKEN = crypto.randomBytes(24).toString("hex");
let server = null;
let port = null;

function authed(req) {
  const got = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "") || req.headers["x-blockhost-token"] || "";
  const a = Buffer.from(String(got));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function send(res, code, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": data.length });
  res.end(data);
}

// Route table: [method, /path/regex/, handler(params, req, res)]. :id becomes a param.
const routes = [
  ["GET", /^\/ping$/, () => {
    const { app } = require("electron");
    return { ok: true, app: "BlockHost", version: app.getVersion() };
  }],
  ["GET", /^\/servers$/, () => {
    const store = require("./store");
    const servers = require("./servers");
    return store.list().map((s) => ({ id: s.id, name: s.name, type: s.type, port: s.port, owner: s.owner || null, status: servers.state(s.id).status }));
  }],
  ["GET", /^\/servers\/(?<id>\d+)$/, (p) => serverInfo(+p.id)],
  ["GET", /^\/servers\/(?<id>\d+)\/backups$/, (p) => {
    const backup = require("./backup");
    return backup.list(+p.id);
  }],
  ["POST", /^\/servers\/(?<id>\d+)\/backup$/, (p) => {
    const backup = require("./backup");
    const name = backup.create(+p.id, "in-game");
    backup.prune(+p.id, "in-game", 10);
    return { name };
  }],
  ["GET", /^\/servers\/(?<id>\d+)\/share$/, async (p) => {
    const store = require("./store");
    const network = require("./network");
    const s = store.get(+p.id);
    if (!s) throw notFound();
    const info = await network.info().catch(() => ({}));
    return { port: s.port, publicIp: info.publicIp || null, localIp: info.localIp || null };
  }],
];

function serverInfo(id) {
  const store = require("./store");
  const servers = require("./servers");
  const s = store.get(id);
  if (!s) throw notFound();
  const st = servers.state(id);
  return { id: s.id, name: s.name, type: s.type, ver: s.ver, port: s.port, owner: s.owner || null, status: st.status, players: st.players || [] };
}

function notFound() { const e = new Error("Not found"); e.code = 404; return e; }

async function handle(req, res) {
  if (!authed(req)) return send(res, 401, { error: "unauthorized" });
  const url = new URL(req.url, "http://127.0.0.1");
  for (const [method, re, fn] of routes) {
    if (req.method !== method) continue;
    const m = re.exec(url.pathname);
    if (!m) continue;
    try {
      const result = await fn(m.groups || {}, req, res);
      return send(res, 200, result);
    } catch (e) {
      return send(res, e.code === 404 ? 404 : 500, { error: e.message || "error" });
    }
  }
  send(res, 404, { error: "no such endpoint" });
}

function start() {
  if (server) return;
  server = http.createServer((req, res) => { handle(req, res).catch(() => { try { send(res, 500, { error: "internal" }); } catch {} }); });
  server.on("error", (e) => { console.error("[bridge] listen error:", e.message); });
  server.listen(0, "127.0.0.1", () => { port = server.address().port; });
}

function stop() { if (server) { try { server.close(); } catch {} server = null; port = null; } }

// What servers.js writes into each server's handshake file so the plugin can find us.
function info() { return { port, token: TOKEN }; }

module.exports = { start, stop, info };
