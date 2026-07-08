// Zips and restores a server's world folders. Backups live in <server>/backups.
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const store = require("./store");

const WORLDS = ["world", "world_nether", "world_the_end"];

function backupsDir(id) {
  const d = path.join(store.serverDir(id), "backups");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function create(id, label) {
  const dir = store.serverDir(id);
  const zip = new AdmZip();
  let any = false;
  for (const w of WORLDS) {
    const wp = path.join(dir, w);
    if (fs.existsSync(wp)) {
      zip.addLocalFolder(wp, w);
      any = true;
    }
  }
  if (!any) throw new Error("No world to back up yet — start the server once first.");
  const name = `${stamp()}${label ? "_" + label.replace(/[^\w-]+/g, "-") : ""}.zip`;
  zip.writeZip(path.join(backupsDir(id), name));
  return name;
}

function list(id) {
  const d = backupsDir(id);
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith(".zip"))
    .map((f) => {
      const st = fs.statSync(path.join(d, f));
      return { name: f, size: st.size, when: st.mtimeMs };
    })
    .sort((a, b) => b.when - a.when);
}

function restore(id, name) {
  const dir = store.serverDir(id);
  const file = path.join(backupsDir(id), name);
  if (!fs.existsSync(file)) throw new Error("Backup not found");
  // remove current worlds, then unzip the backup over the server folder
  for (const w of WORLDS) {
    fs.rmSync(path.join(dir, w), { recursive: true, force: true });
  }
  new AdmZip(file).extractAllTo(dir, true);
}

function remove(id, name) {
  const file = path.join(backupsDir(id), name);
  fs.rmSync(file, { force: true });
}

module.exports = { create, list, restore, remove };
