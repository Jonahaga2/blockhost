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
}

// ---- server.properties as key/value for the Settings screen ----
function readProps(id) {
  const text = readFile(id, "server.properties");
  const props = {};
  text.split(/\r?\n/).forEach((line) => {
    if (!line || line.startsWith("#")) return;
    const i = line.indexOf("=");
    if (i === -1) return;
    props[line.slice(0, i).trim()] = line.slice(i + 1);
  });
  return props;
}

function writeProps(id, updates) {
  const dir = store.serverDir(id);
  const file = path.join(dir, "server.properties");
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

module.exports = { listFiles, readFile, writeFile, readProps, writeProps, EDITABLE };
