// Persists the list of servers and gives each one its own folder on disk.
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const ROOT = () => path.join(app.getPath("userData"), "blockhost");
const SERVERS_DIR = () => path.join(ROOT(), "servers");
const INDEX = () => path.join(ROOT(), "servers.json");

function ensureDirs() {
  fs.mkdirSync(SERVERS_DIR(), { recursive: true });
}

function readIndex() {
  ensureDirs();
  try {
    return JSON.parse(fs.readFileSync(INDEX(), "utf8"));
  } catch {
    return [];
  }
}

function writeIndex(list) {
  ensureDirs();
  fs.writeFileSync(INDEX(), JSON.stringify(list, null, 2));
}

function serverDir(id) {
  const s = readIndex().find((x) => x.id === id);
  if (s && s.dir) return s.dir; // imported server lives in its own folder
  return path.join(SERVERS_DIR(), String(id));
}

function list() {
  return readIndex();
}

function get(id) {
  return readIndex().find((s) => s.id === id) || null;
}

function add(server) {
  const list = readIndex();
  list.push(server);
  writeIndex(list);
  fs.mkdirSync(serverDir(server.id), { recursive: true });
  return server;
}

function update(id, patch) {
  const list = readIndex();
  const i = list.findIndex((s) => s.id === id);
  if (i === -1) return null;
  list[i] = { ...list[i], ...patch };
  writeIndex(list);
  return list[i];
}

function remove(id) {
  const list = readIndex().filter((s) => s.id !== id);
  writeIndex(list);
  try {
    fs.rmSync(serverDir(id), { recursive: true, force: true });
  } catch {}
}

module.exports = { list, get, add, update, remove, serverDir, ROOT, ensureDirs };
