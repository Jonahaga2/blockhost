// Reads and writes the config files inside a server's folder (for the Files editor
// and the friendly Settings screen).
const fs = require("fs");
const path = require("path");
const store = require("./store");

const EDITABLE = [
  "server.properties",
  "whitelist.json",
  "ops.json",
  "eula.txt",
  "bukkit.yml",
  "spigot.yml",
  "paper-world-defaults.yml",
];

function listFiles(id) {
  const dir = store.serverDir(id);
  return EDITABLE.filter((f) => fs.existsSync(path.join(dir, f)));
}

function readFile(id, name) {
  if (!EDITABLE.includes(name)) throw new Error("Not an editable file");
  const p = path.join(store.serverDir(id), name);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

function writeFile(id, name, content) {
  if (!EDITABLE.includes(name)) throw new Error("Not an editable file");
  fs.writeFileSync(path.join(store.serverDir(id), name), content);
  // Keep the remembered settings in sync when the raw properties file is hand-edited,
  // so applyProps() doesn't undo those edits on the next start.
  if (name === "server.properties") store.update(id, { props: parseProps(content) });
}

// ---- server.properties as key/value for the Settings screen ----
function parseProps(text) {
  const props = {};
  text.split(/\r?\n/).forEach((line) => {
    if (!line || line.startsWith("#")) return;
    const i = line.indexOf("=");
    if (i === -1) return;
    props[line.slice(0, i).trim()] = line.slice(i + 1);
  });
  return props;
}

function readProps(id) {
  return parseProps(readFile(id, "server.properties"));
}

// Merge key/values into a server.properties file: update existing keys in place,
// append any new ones, leave everything else (and comments) untouched.
function mergePropsFile(file, updates) {
  let lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  const seen = new Set();
  lines = lines.map((line) => {
    if (!line || line.startsWith("#")) return line;
    const i = line.indexOf("=");
    if (i === -1) return line;
    const key = line.slice(0, i).trim();
    if (key in updates) {
      seen.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) lines.push(`${k}=${v}`);
  }
  fs.writeFileSync(file, lines.join("\n"));
}

function writeProps(id, updates) {
  const dir = store.serverDir(id);
  mergePropsFile(path.join(dir, "server.properties"), updates);
  // Remember these as the server's own settings so they survive restarts and any
  // rewrite the server does on shutdown — reapplied on every launch by applyProps().
  const cur = (store.get(id) || {}).props || {};
  store.update(id, { props: { ...cur, ...updates } });
}

// Reapply the owner's saved settings to server.properties. Called before every start
// so a stop/restart never loses them, and so they're in place before the world is
// first generated (which is the only time a seed or hardcore flag can take effect).
function applyProps(id) {
  const s = store.get(id);
  if (!s || !s.props || !Object.keys(s.props).length) return;
  mergePropsFile(path.join(store.serverDir(id), "server.properties"), s.props);
}

module.exports = { listFiles, readFile, writeFile, readProps, writeProps, applyProps, EDITABLE };
