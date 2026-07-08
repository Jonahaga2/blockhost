// Finds Java to run Minecraft. Prefers the Java bundled inside the app (so a friend
// needs to install nothing), then any Java already on the computer.
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

function parseVersion(text) {
  const m = text.match(/version "(\d+)(?:\.(\d+))?[._]?(\d+)?/);
  if (!m) return null;
  let major = parseInt(m[1], 10);
  if (major === 1 && m[2]) major = parseInt(m[2], 10); // old "1.8" style
  return { raw: m[0].replace('version "', ""), major };
}

// Every place we might find a java.exe, best first.
function candidates() {
  const list = [];
  // 1) Java bundled with the app (packaged build)
  if (process.resourcesPath) list.push(path.join(process.resourcesPath, "jre", "bin", "java.exe"));
  // 2) Java bundled in the source tree (running from source)
  list.push(path.join(__dirname, "..", "..", "resources", "jre", "bin", "java.exe"));
  // 3) Common install locations (so it works even if Java isn't on PATH)
  const pf = process.env["ProgramFiles"] || "C:\\Program Files";
  for (const base of [
    path.join(pf, "Eclipse Adoptium"),
    path.join(pf, "Java"),
    path.join(pf, "Microsoft", "jdk"),
    path.join(pf, "Amazon Corretto"),
    path.join(pf, "Zulu"),
  ]) {
    try {
      for (const d of fs.readdirSync(base)) list.push(path.join(base, d, "bin", "java.exe"));
    } catch {}
  }
  return list;
}

// The java command we should actually run.
function resolve(customPath) {
  if (customPath && fs.existsSync(customPath)) return customPath;
  for (const c of candidates()) if (c && fs.existsSync(c)) return c;
  return "java"; // last resort: whatever is on PATH
}

function detect(customPath) {
  const javaPath = resolve(customPath);
  const cmd = javaPath.includes(" ") || javaPath.endsWith(".exe") ? `"${javaPath}" -version` : "java -version";
  return new Promise((resolve) => {
    exec(cmd, { timeout: 8000 }, (err, stdout, stderr) => {
      const out = (stderr || "") + (stdout || "");
      if (err && !out) return resolve({ found: false, path: javaPath });
      const v = parseVersion(out);
      if (!v) return resolve({ found: false, path: javaPath });
      resolve({ found: true, path: javaPath, version: v.raw, major: v.major, ok: v.major >= 17 });
    });
  });
}

module.exports = { detect, resolve };
