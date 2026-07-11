// Searches, installs, and manages Modrinth plugins (Paper) and mods (Fabric) for a server.
const fs = require("fs");
const path = require("path");
const store = require("./store");
const { download } = require("./jars");

const API = "https://api.modrinth.com/v2";
const UA = "Host/0.1 (Minecraft server manager)";

async function json(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.json();
}

// Paper-family servers take plugins; Fabric servers take mods. Everything else
// (Vanilla, imported) can't run either.
function contentKind(serverType) {
  if (serverType === "Fabric") return { projectType: "mod", loaders: ["fabric"], folder: "mods" };
  if (serverType === "Paper") return { projectType: "plugin", loaders: ["paper", "spigot", "bukkit", "purpur", "folia"], folder: "plugins" };
  return null;
}

async function search(serverType, query, { limit = 20, offset = 0 } = {}) {
  const kind = contentKind(serverType);
  if (!kind) return { hits: [], total_hits: 0 };
  const facets = [[`project_type:${kind.projectType}`], kind.loaders.map((l) => `categories:${l}`)];
  const index = query && query.trim() ? "relevance" : "downloads"; // empty search = browse popular
  const url = `${API}/search?query=${encodeURIComponent(query || "")}&limit=${limit}&offset=${offset}&index=${index}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
  return json(url);
}

// Prefer a version explicitly tagged for this Minecraft version; if the server is on a
// very new release the author may not have tagged it yet, so fall back to the newest
// compatible-loader build and let the caller flag that it wasn't an exact match.
async function versionsFor(serverType, projectId, mcVersion) {
  const kind = contentKind(serverType);
  if (!kind) return { versions: [], matched: false };
  const loaders = encodeURIComponent(JSON.stringify(kind.loaders));
  const withVer = await json(`${API}/project/${projectId}/version?loaders=${loaders}&game_versions=${encodeURIComponent(JSON.stringify([mcVersion]))}`);
  if (withVer.length) return { versions: withVer, matched: true };
  const anyVer = await json(`${API}/project/${projectId}/version?loaders=${loaders}`);
  return { versions: anyVer, matched: false };
}

function contentDir(id, serverType) {
  const kind = contentKind(serverType);
  if (!kind) return null;
  const dir = path.join(store.serverDir(id), kind.folder);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function install(id, serverType, projectId, mcVersion, onProgress) {
  const dir = contentDir(id, serverType);
  if (!dir) throw new Error("This server type doesn't support plugins or mods.");
  const { versions, matched } = await versionsFor(serverType, projectId, mcVersion);
  const version = versions[0];
  if (!version) throw new Error("No compatible version found for this server.");
  const file = version.files.find((f) => f.primary) || version.files[0];
  if (!file) throw new Error("That version has no downloadable file.");
  await download(file.url, path.join(dir, file.filename), onProgress);
  return { filename: file.filename, matched, versionNumber: version.version_number };
}

function list(id, serverType) {
  const dir = contentDir(id, serverType);
  if (!dir) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".jar") || f.endsWith(".jar.disabled"))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, disabled: f.endsWith(".disabled") };
    });
}

function remove(id, serverType, name) {
  const dir = contentDir(id, serverType);
  if (!dir) return;
  fs.rmSync(path.join(dir, name), { force: true });
}

function toggle(id, serverType, name) {
  const dir = contentDir(id, serverType);
  if (!dir) return;
  const from = path.join(dir, name);
  const to = name.endsWith(".disabled") ? path.join(dir, name.slice(0, -9)) : path.join(dir, name + ".disabled");
  fs.renameSync(from, to);
}

module.exports = { contentKind, search, install, list, remove, toggle };
