// playit.gg tunnel: lets a far-away friend join without touching the router.
// Downloads the playit agent, runs the claim flow to get a secret, then runs the
// agent daemon and reads the public tunnel address from playit's API.
const { spawn } = require("child_process");
const { EventEmitter } = require("events");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const store = require("./store");

const API = "https://api.playit.gg";
const VERSION = "1.0.10";
const AGENT_URL = `https://github.com/playit-cloud/playit-agent/releases/download/v${VERSION}/playit-windows-x86_64-signed.exe`;

const bus = new EventEmitter();
let proc = null;

function agentPath() {
  return path.join(store.ROOT(), "playit.exe");
}

async function ensureAgent() {
  const p = agentPath();
  if (fs.existsSync(p) && fs.statSync(p).size > 1_000_000) return p;
  store.ensureDirs();
  const r = await fetch(AGENT_URL, { headers: { "User-Agent": "BlockHost/0.1" } });
  if (!r.ok) throw new Error("Couldn't download the playit agent.");
  const out = fs.createWriteStream(p);
  const reader = r.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!out.write(Buffer.from(value))) await new Promise((res) => out.once("drain", res));
  }
  out.end();
  await new Promise((resolve, reject) => { out.on("finish", resolve); out.on("error", reject); });
  return p;
}

async function apiCall(pathname, body, secret) {
  const headers = { "Content-Type": "application/json" };
  if (secret) headers["Authorization"] = "Agent-Key " + secret;
  const r = await fetch(API + pathname, { method: "POST", headers, body: JSON.stringify(body || {}) });
  const j = await r.json();
  if (j.status !== "success") throw new Error(j.message || JSON.stringify(j));
  return j.data;
}

// Run the claim flow. Emits "claim-url" and "claim-state"; resolves with the secret key.
async function claim() {
  const code = crypto.randomBytes(8).toString("hex"); // 16 hex chars — playit rejects longer codes

  // IMPORTANT: register the code with playit BEFORE opening the browser, otherwise
  // the claim page loads an unknown code and shows "Invalid claim code".
  const first = await apiCall("/claim/setup", { code, agent_type: "self-managed", version: VERSION });
  bus.emit("claim-url", "https://playit.gg/claim/" + code);
  bus.emit("claim-state", first);

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const state = await apiCall("/claim/setup", { code, agent_type: "self-managed", version: VERSION });
    bus.emit("claim-state", state);
    if (state === "UserAccepted") break;
    if (state === "UserRejected") throw new Error("You rejected the setup on playit.gg.");
    await new Promise((r) => setTimeout(r, 3000));
  }
  const res = await apiCall("/claim/exchange", { code });
  return res.secret_key;
}

async function start(secret) {
  const exe = await ensureAgent();
  if (proc) return;
  proc = spawn(exe, ["--secret", secret], { windowsHide: true });
  proc.stdout.on("data", (d) => bus.emit("log", d.toString()));
  proc.stderr.on("data", (d) => bus.emit("log", d.toString()));
  proc.on("close", () => { proc = null; bus.emit("status", "stopped"); });
  proc.on("error", (e) => { proc = null; bus.emit("log", "agent error: " + e.message); bus.emit("status", "stopped"); });
  bus.emit("status", "running");
}

function stop() {
  if (proc) { try { proc.kill(); } catch {} proc = null; }
}

function isRunning() {
  return !!proc;
}

// List the tunnels playit has assigned to this agent (the addresses to share).
async function tunnels(secret) {
  const data = await apiCall("/v1/agents/rundata", {}, secret);
  return (data.tunnels || []).map((t) => ({
    name: t.name,
    address: t.display_address,
    type: t.tunnel_type_display,
  }));
}

module.exports = { bus, claim, start, stop, isRunning, tunnels };
