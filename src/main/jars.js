// Downloads Minecraft server jars — Paper (via the PaperMC API) or Vanilla (via Mojang).
const fs = require("fs");

// PaperMC's new "Fill" v3 API (the old api.papermc.io/v2 was retired — returns 410).
const PAPER = "https://fill.papermc.io/v3/projects/paper";
const MOJANG = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const UA = "BlockHost/0.1 (Minecraft server manager)";

async function json(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.json();
}

// ---- version lists ----
async function paperVersions() {
  const data = await json(`${PAPER}/versions`);
  // keep stable releases (both old "1.x" and new "26.x" schemes), skip pre-releases / RCs / snapshots
  return data.versions
    .map((v) => v.version.id)
    .filter((id) => /^\d+\.\d/.test(id) && !/[-_a-z]/i.test(id));
}

async function vanillaVersions() {
  const data = await json(MOJANG);
  return data.versions
    .filter((v) => v.type === "release")
    .map((v) => v.id); // already newest-first
}

// ---- resolve a download url ----
async function paperUrl(version) {
  const builds = await json(`${PAPER}/versions/${version}/builds`);
  const latest = builds[0]; // newest build first
  if (!latest) throw new Error(`No Paper build for ${version}`);
  const dl = latest.downloads["server:default"] || Object.values(latest.downloads)[0];
  return dl.url;
}

async function vanillaUrl(version) {
  const manifest = await json(MOJANG);
  const entry = manifest.versions.find((v) => v.id === version);
  if (!entry) throw new Error(`Unknown version ${version}`);
  const meta = await json(entry.url);
  if (!meta.downloads || !meta.downloads.server)
    throw new Error(`No server jar for ${version}`);
  return meta.downloads.server.url;
}

// ---- download with progress (reader-based, binary-safe, honours backpressure) ----
async function download(url, destFile, onProgress) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`Download failed: ${r.status}`);
  const total = Number(r.headers.get("content-length")) || 0;
  let received = 0;

  const out = fs.createWriteStream(destFile);
  const reader = r.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (onProgress) onProgress(received, total);
      if (!out.write(Buffer.from(value))) {
        await new Promise((res) => out.once("drain", res));
      }
    }
  } finally {
    out.end();
  }
  await new Promise((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", reject);
  });
}

async function downloadServer(type, version, destFile, onProgress) {
  const url = type === "Vanilla" ? await vanillaUrl(version) : await paperUrl(version);
  await download(url, destFile, onProgress);
}

module.exports = { paperVersions, vanillaVersions, downloadServer };
