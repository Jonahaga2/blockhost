const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- state ----------
let servers = [];
let activeId = null;
let currentTab = "console";
let java = { found: false, ok: false };
const logs = new Map();     // id -> [lines]
const statuses = new Map(); // id -> status
const players = new Map();  // id -> [names]

// ---------- toast ----------
let tt;
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 2000); }

// ---------- boot ----------
async function boot() {
  java = await api.detectJava();
  await refreshServers();
  wireStatic();
  subscribeEvents();
}

async function refreshServers() {
  servers = await api.listServers();
  renderSidebar();
  if (servers.length && (activeId === null || !servers.find((s) => s.id === activeId))) selectServer(servers[0].id);
  else if (!servers.length) showEmpty(true);
  else renderHeader();
}

function showEmpty(v) {
  $("#emptyMain").style.display = v ? "flex" : "none";
  $("#serverMain").style.display = v ? "none" : "flex";
}

// ---------- sidebar ----------
function statusOf(id) { return statuses.get(id) || "stopped"; }
const LABEL = { running: "Running", stopped: "Stopped", starting: "Starting…", stopping: "Stopping…" };

function renderSidebar() {
  const list = $("#srvList"); list.innerHTML = "";
  servers.forEach((s) => {
    const b = document.createElement("button");
    b.className = "srv" + (s.id === activeId ? " active" : "");
    b.innerHTML = `<span class="glyph ${statusOf(s.id)}"></span><span class="col"><span class="nm">${esc(s.name)}</span><span class="mt">${esc(s.type)} ${esc(s.ver)} · ${s.ram} GB · :${s.port}</span></span>`;
    b.onclick = () => selectServer(s.id);
    list.appendChild(b);
  });
}

function selectServer(id) {
  activeId = id;
  showEmpty(false);
  renderSidebar();
  renderHeader();
  renderConsole();
  loadTab(currentTab);
}

function activeServer() { return servers.find((s) => s.id === activeId); }

function renderHeader() {
  const s = activeServer(); if (!s) return;
  const st = statusOf(s.id);
  $("#hName").textContent = s.name;
  $("#hGlyph").className = "glyph " + st;
  $("#hStatus").textContent = LABEL[st];
  $("#hMeta").innerHTML = `Type <b>${esc(s.type)}</b> &nbsp;·&nbsp; Version <b>${esc(s.ver)}</b> &nbsp;·&nbsp; Memory <b>${s.ram} GB</b> &nbsp;·&nbsp; Port <b>${s.port}</b>`;
  $("#javaBanner").classList.toggle("hide", java.ok);
  $("#startBtn").disabled = !java.ok || st === "running" || st === "starting";
  $("#stopBtn").disabled = st === "stopped" || st === "stopping";
}

// ---------- live events ----------
function subscribeEvents() {
  api.onLog(({ id, line }) => {
    if (!logs.has(id)) logs.set(id, []);
    const buf = logs.get(id); buf.push(line); if (buf.length > 600) buf.shift();
    if (id === activeId && currentTab === "console") renderConsole();
  });
  api.onStatus(({ id, status }) => {
    statuses.set(id, status);
    renderSidebar();
    if (id === activeId) renderHeader();
  });
  api.onPlayers(({ id, players: p }) => players.set(id, p));
}

// ---------- console ----------
function renderConsole() {
  const s = activeServer(); if (!s) return;
  const buf = logs.get(s.id) || [];
  const html = buf.length
    ? buf.map((l) => `<div class="ln">${esc(l)}</div>`).join("")
    : `<div class="ln" style="color:var(--muted)">Server is stopped. Press Start to launch it — the first start downloads nothing, it just boots the server.</div>`;
  const el = $("#console"); el.innerHTML = html; el.scrollTop = el.scrollHeight;
}

// ---------- controls ----------
function wireStatic() {
  $("#startBtn").onclick = async () => { try { logs.set(activeId, []); renderConsole(); await api.startServer(activeId); } catch (e) { toast(e.message); } };
  $("#stopBtn").onclick = async () => { try { await api.stopServer(activeId); } catch (e) { toast(e.message); } };
  $("#deleteBtn").onclick = async () => {
    const s = activeServer(); if (!s) return;
    if (!confirm(`Delete "${s.name}" and all its worlds? This cannot be undone.`)) return;
    await api.deleteServer(s.id); activeId = null; await refreshServers();
  };

  // tabs
  const tabs = document.querySelectorAll(".tab");
  const underline = $("#tabUnderline");
  const moveU = (tab) => { underline.style.width = tab.offsetWidth + "px"; underline.style.transform = `translateX(${tab.offsetLeft}px)`; };
  tabs.forEach((t) => t.onclick = () => {
    tabs.forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    $(`.panel[data-panel="${t.dataset.tab}"]`).classList.add("active");
    currentTab = t.dataset.tab; moveU(t); loadTab(currentTab);
  });
  window.addEventListener("resize", () => moveU(document.querySelector(".tab.active")));
  requestAnimationFrame(() => moveU(document.querySelector(".tab.active")));

  // theme
  $("#themebtn").onclick = () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : cur === "light" ? "dark" : (matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark");
    document.documentElement.setAttribute("data-theme", next);
  };

  // new server modal
  $("#newBtn").onclick = $("#newBtn2").onclick = openModal;
  $("#cancelBtn").onclick = $("#modalX").onclick = () => $("#scrim").classList.remove("open");
  $("#scrim").onclick = (e) => { if (e.target === $("#scrim")) $("#scrim").classList.remove("open"); };

  wireConsole();
  wireSettings();
  wireFiles();
  wireShare();
  wireBackups();
  wireModal();
}

function loadTab(tab) {
  if (tab === "settings") loadSettings();
  else if (tab === "files") loadFiles();
  else if (tab === "share") loadShare();
  else if (tab === "backups") loadBackups();
  else renderConsole();
}

/* ================= COMMAND AUTOCOMPLETE ================= */
const COMMANDS = [
  ["advancement ","grant or revoke advancements"],["attribute ","change an entity's attributes"],["ban ","ban a player"],
  ["ban-ip ","ban an IP address"],["banlist","show banned players"],["bossbar ","create a boss health bar"],
  ["clear ","clear items from inventory"],["clone ","copy a region of blocks"],["damage ","apply damage to an entity"],
  ["data ","get or change block/entity data"],["datapack ","manage data packs"],["debug ","start or stop a debug report"],
  ["defaultgamemode ","set the default game mode"],["deop ","remove operator status"],["difficulty ","set the difficulty"],
  ["effect ","add or clear status effects"],["enchant ","enchant a held item"],["execute ","run a command in a context"],
  ["experience ","give or set experience"],["fill ","fill a region with blocks"],["fillbiome ","set the biome in a region"],
  ["forceload ","keep chunks loaded"],["function ","run a function file"],["gamemode ","set a player's game mode"],
  ["gamerule ","change a game rule"],["give ","give an item to a player"],["help","list available commands"],
  ["item ","modify items"],["jfr ","flight-recorder profiling"],["kick ","remove a player"],["kill ","kill entities"],
  ["list","list online players"],["locate ","find a structure or biome"],["loot ","drop loot from a table"],
  ["me ","post an action message"],["msg ","send a private message"],["op ","give operator status"],["pardon ","unban a player"],
  ["pardon-ip ","unban an IP address"],["particle ","spawn particles"],["place ","place a feature or structure"],
  ["playsound ","play a sound"],["publish","open your world to the LAN"],["random ","roll a random value"],
  ["recipe ","give or take recipes"],["reload","reload data packs"],["return ","return from a function"],
  ["ride ","make an entity ride another"],["rotate ","rotate an entity"],["save-all","save the world"],
  ["save-off","turn off auto-saving"],["save-on","turn on auto-saving"],["say ","broadcast a message"],
  ["schedule ","schedule a function"],["scoreboard ","manage scoreboards"],["seed","show the world seed"],
  ["setblock ","place a single block"],["setidletimeout ","set the idle-kick timer"],["setworldspawn ","set the world spawn"],
  ["spawnpoint ","set a player's spawn"],["spectate ","spectate an entity"],["spreadplayers ","teleport players apart"],
  ["stop","shut the server down"],["stopsound ","stop a playing sound"],["summon ","spawn an entity"],["tag ","manage entity tags"],
  ["team ","manage teams"],["teammsg ","message your team"],["teleport ","teleport entities"],["tell ","private message"],
  ["tellraw ","send a JSON message"],["tick ","control the tick rate"],["time ","change or query the time"],
  ["title ","show a title on screen"],["tp ","teleport (short for /teleport)"],["transfer ","move a player to another server"],
  ["trigger ","activate a trigger objective"],["weather ","change the weather"],["whitelist ","manage the whitelist"],
  ["worldborder ","change the world border"],["xp ","give or set experience"],
  ["gamemode survival","set a player to survival"],["gamemode creative","set a player to creative"],
  ["gamemode adventure","set a player to adventure"],["gamemode spectator","set a player to spectator"],
  ["time set day","make it daytime"],["time set night","make it nighttime"],["time set noon","midday"],["time set midnight","midnight"],
  ["weather clear","clear skies"],["weather rain","make it rain"],["weather thunder","start a storm"],
  ["difficulty peaceful","no hostile mobs"],["difficulty easy","easy mode"],["difficulty normal","normal mode"],["difficulty hard","hard mode"],
  ["whitelist add ","invite a player"],["whitelist remove ","uninvite a player"],["whitelist on","turn the whitelist on"],
  ["whitelist off","turn the whitelist off"],["whitelist list","show the whitelist"],["whitelist reload","reload the whitelist"],
  ["gamerule keepInventory true","keep items on death"],["gamerule doDaylightCycle false","freeze the time of day"],
  ["gamerule mobGriefing false","stop mobs breaking blocks"],["gamerule doFireTick false","stop fire spreading"],
];

function wireConsole() {
  const input = $("#cmdInput"), ac = $("#ac"), gTyped = $("#ghost .typed"), gRest = $("#ghost .rest");
  let matches = [], hl = 0;
  const parse = () => { const m = input.value.match(/^([\/\\])?(.*)$/); return { prefix: m[1] || "", term: m[2] }; };

  function refresh() {
    const { prefix, term } = parse();
    if (!prefix && !term.trim()) { matches = []; ac.classList.remove("open"); setGhost(); return; }
    const low = term.toLowerCase();
    matches = COMMANDS.filter((c) => c[0].startsWith(low) && c[0] !== low).slice(0, 8);
    if (hl >= matches.length) hl = 0;
    renderAC(); setGhost();
  }
  function renderAC() {
    if (!matches.length) { ac.classList.remove("open"); return; }
    const { prefix, term } = parse();
    ac.innerHTML = matches.map((c, i) => {
      const rest = c[0].slice(term.length);
      return `<div class="ac-item ${i === hl ? "hl" : ""}" data-i="${i}"><span><span>${esc(prefix + term)}</span><span class="m">${esc(rest)}</span></span>${c[1] ? `<span class="d">${esc(c[1])}</span>` : ""}</div>`;
    }).join("");
    ac.classList.add("open");
    ac.querySelectorAll(".ac-item").forEach((el) => {
      el.onmouseenter = () => { hl = +el.dataset.i; renderAC(); setGhost(); };
      el.onmousedown = (e) => e.preventDefault();
      el.onclick = () => { hl = +el.dataset.i; accept(); };
    });
  }
  function setGhost() {
    const { term } = parse();
    if (matches.length && input.value) { gTyped.textContent = input.value; gRest.innerHTML = esc(matches[hl][0].slice(term.length)) + '<span class="hintkey">Tab</span>'; }
    else { gTyped.textContent = ""; gRest.textContent = ""; }
  }
  function accept() { if (!matches.length) return; const { prefix } = parse(); input.value = prefix + matches[hl][0]; matches = []; ac.classList.remove("open"); setGhost(); input.focus(); }
  async function send() {
    const raw = input.value.trim(); if (!raw) return;
    const cmd = raw.replace(/^[/\\]/, "");
    input.value = ""; matches = []; ac.classList.remove("open"); setGhost();
    try { await api.sendCommand(activeId, cmd); } catch (e) { toast(e.message); }
  }
  input.addEventListener("input", () => { hl = 0; refresh(); });
  input.addEventListener("focus", refresh);
  input.addEventListener("keydown", (e) => {
    if (ac.classList.contains("open")) {
      if (e.key === "ArrowDown") { e.preventDefault(); hl = (hl + 1) % matches.length; renderAC(); setGhost(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); hl = (hl - 1 + matches.length) % matches.length; renderAC(); setGhost(); return; }
      if (e.key === "Escape") { matches = []; ac.classList.remove("open"); setGhost(); return; }
      if (e.key === "Tab") { e.preventDefault(); accept(); return; }
      if (e.key === "ArrowRight" && input.selectionStart === input.value.length) { e.preventDefault(); accept(); return; }
    }
    if (e.key === "Enter") send();
  });
  $("#sendBtn").onclick = send;
  document.addEventListener("click", (e) => { if (!e.target.closest(".input-wrap")) { matches = []; ac.classList.remove("open"); setGhost(); } });
}

/* ================= SETTINGS ================= */
const SETTINGS = [
  { group: "Gameplay", fields: [
    { key: "gamemode", label: "Game mode", help: "How new players start out.", type: "select", options: ["survival","creative","adventure","spectator"], def: "survival" },
    { key: "difficulty", label: "Difficulty", help: "How dangerous the world is.", type: "select", options: ["peaceful","easy","normal","hard"], def: "easy" },
    { key: "hardcore", label: "Hardcore mode", help: "One life only — death is permanent.", type: "toggle", def: "false" },
    { key: "pvp", label: "Player vs player (PVP)", help: "Let players fight each other.", type: "toggle", def: "true" },
    { key: "force-gamemode", label: "Force game mode", help: "Reset players to the default mode on join.", type: "toggle", def: "false" },
    { key: "allow-flight", label: "Allow flight", help: "Stop kicking players who fly (needed for elytra/plugins).", type: "toggle", def: "false" },
    { key: "player-idle-timeout", label: "Idle kick (minutes)", help: "Kick idle players. 0 = never.", type: "number", def: "0" },
  ]},
  { group: "World", fields: [
    { key: "level-name", label: "World name", help: "The folder name for this world.", type: "text", def: "world" },
    { key: "level-seed", label: "World seed", help: "Leave blank for a random world.", type: "text", def: "" },
    { key: "level-type", label: "World type", help: "The shape of the generated land.", type: "select", options: ["minecraft:normal","minecraft:flat","minecraft:large_biomes","minecraft:amplified"], def: "minecraft:normal" },
    { key: "generate-structures", label: "Generate structures", help: "Villages, temples, strongholds, and more.", type: "toggle", def: "true" },
    { key: "allow-nether", label: "Allow the Nether", help: "Let players use Nether portals.", type: "toggle", def: "true" },
    { key: "spawn-protection", label: "Spawn protection", help: "Blocks around spawn only ops can build in.", type: "slider", min: 0, max: 64, def: "16", unit: "blocks" },
    { key: "view-distance", label: "View distance", help: "How far players can see, in chunks.", type: "slider", min: 3, max: 32, def: "10", unit: "chunks" },
    { key: "simulation-distance", label: "Simulation distance", help: "How far the world keeps ticking.", type: "slider", min: 3, max: 32, def: "10", unit: "chunks" },
    { key: "max-world-size", label: "World border size", help: "Maximum world width in blocks.", type: "number", def: "29999984" },
  ]},
  { group: "Mobs & spawning", fields: [
    { key: "spawn-monsters", label: "Spawn monsters", help: "Zombies, creepers, skeletons, etc.", type: "toggle", def: "true" },
    { key: "spawn-animals", label: "Spawn animals", help: "Cows, pigs, sheep, and other passive mobs.", type: "toggle", def: "true" },
    { key: "spawn-npcs", label: "Spawn villagers", help: "Villagers and other NPCs.", type: "toggle", def: "true" },
  ]},
  { group: "Players & access", fields: [
    { key: "max-players", label: "Max players", help: "How many people can be on at once.", type: "slider", min: 1, max: 100, def: "20", unit: "players" },
    { key: "white-list", label: "Whitelist only", help: "Only invited players can join.", type: "toggle", def: "false" },
    { key: "enforce-whitelist", label: "Enforce whitelist", help: "Kick players the moment they're removed.", type: "toggle", def: "false" },
    { key: "online-mode", label: "Online mode", help: "Require real Minecraft accounts.", type: "toggle", def: "true" },
    { key: "op-permission-level", label: "Op permission level", help: "How much power /op gives (4 = full).", type: "select", options: ["1","2","3","4"], def: "4" },
  ]},
  { group: "Server info & appearance", fields: [
    { key: "motd", label: "Server message (MOTD)", help: "Shown next to your server in the list.", type: "text", def: "A BlockHost server" },
    { key: "hide-online-players", label: "Hide online players", help: "Don't reveal who's online in the list.", type: "toggle", def: "false" },
    { key: "resource-pack", label: "Resource pack URL", help: "Optional texture pack players download on join.", type: "text", def: "" },
    { key: "require-resource-pack", label: "Require resource pack", help: "Players must accept it or can't join.", type: "toggle", def: "false" },
  ]},
  { group: "Advanced & performance", fields: [
    { key: "enable-command-block", label: "Enable command blocks", help: "Allow command blocks to run.", type: "toggle", def: "false" },
    { key: "max-tick-time", label: "Max tick time (ms)", help: "Watchdog stops the server if a tick hangs. -1 = off.", type: "number", def: "60000" },
    { key: "network-compression-threshold", label: "Compression threshold", help: "Packets bigger than this (bytes) get compressed.", type: "number", def: "256" },
    { key: "entity-broadcast-range-percentage", label: "Entity broadcast range", help: "How far entities are shown to players.", type: "slider", min: 10, max: 500, def: "100", unit: "%" },
    { key: "sync-chunk-writes", label: "Sync chunk writes", help: "Safer saves, slightly slower.", type: "toggle", def: "true" },
    { key: "enable-rcon", label: "Remote console (RCON)", help: "Let tools control the server over the network.", type: "toggle", def: "false" },
    { key: "enable-query", label: "Enable query", help: "Let server-list sites read basic status.", type: "toggle", def: "false" },
  ]},
];

let currentProps = {};
let sid = 0;
function val(key, def) { return key in currentProps ? currentProps[key] : def; }
function setControl(f) {
  const v = val(f.key, f.def);
  if (f.type === "select") {
    const opts = f.options.includes(v) ? f.options : [v, ...f.options];
    return `<div class="selwrap"><select data-key="${f.key}">${opts.map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`;
  }
  if (f.type === "toggle") { const on = v === "true"; return `<div class="toggle ${on ? "on" : ""}" data-key="${f.key}" data-toggle><span class="sw"><span class="kn"></span></span><span class="state">${on ? "On" : "Off"}</span></div>`; }
  if (f.type === "slider") { const id = "sv" + (sid++); return `<div class="slider"><input type="range" min="${f.min}" max="${f.max}" value="${esc(v)}" data-key="${f.key}" data-valfor="${id}"><span class="val"><span id="${id}">${esc(v)}</span> ${f.unit || ""}</span></div>`; }
  if (f.type === "number") return `<input class="num" data-key="${f.key}" value="${esc(v)}">`;
  return `<input class="txt" data-key="${f.key}" value="${esc(v)}">`;
}
async function loadSettings() {
  if (!activeId) return;
  currentProps = await api.readProps(activeId);
  sid = 0;
  $("#setBody").innerHTML = SETTINGS.map((sec) => `
    <div class="set-section"><h3>${sec.group}</h3>
      <div class="setgrid">${sec.fields.map((f) => `<div class="card" data-name="${esc((f.label + " " + f.help).toLowerCase())}"><div class="lab">${f.label}</div><div class="hlp">${f.help}</div>${setControl(f)}</div>`).join("")}</div>
    </div>`).join("");
}
function wireSettings() {
  $("#setSearch").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll(".set-section").forEach((sec) => {
      let any = false;
      sec.querySelectorAll(".card").forEach((c) => { const hit = !q || c.dataset.name.includes(q); c.classList.toggle("hide", !hit); if (hit) any = true; });
      sec.classList.toggle("hide", !any);
    });
  });
  document.addEventListener("click", (e) => { const t = e.target.closest("[data-toggle]"); if (!t) return; t.classList.toggle("on"); t.querySelector(".state").textContent = t.classList.contains("on") ? "On" : "Off"; });
  document.addEventListener("input", (e) => { const r = e.target; if (r.matches && r.matches('input[type="range"][data-valfor]')) { const el = document.getElementById(r.dataset.valfor); if (el) el.textContent = r.value; } });
  $("#saveBtn").onclick = async () => {
    const updates = {};
    document.querySelectorAll("#setBody [data-key]").forEach((el) => {
      const key = el.dataset.key;
      if (el.hasAttribute("data-toggle")) updates[key] = el.classList.contains("on") ? "true" : "false";
      else if (el.tagName === "SELECT") updates[key] = el.value;
      else updates[key] = el.value;
    });
    try { await api.writeProps(activeId, updates); toast(statusOf(activeId) === "running" ? "Saved — restart to apply" : "Settings saved"); } catch (e) { toast(e.message); }
  };
}

/* ================= FILES ================= */
let curFile = null, fileNames = [];
function updateGutter() { const n = $("#editorArea").value.split("\n").length; let s = ""; for (let i = 1; i <= n; i++) s += i + "\n"; $("#gutter").textContent = s; }
async function loadFiles() {
  if (!activeId) return;
  fileNames = await api.listFiles(activeId);
  const list = $("#fileList");
  if (!fileNames.length) {
    list.innerHTML = ""; $("#edName").textContent = "—"; $("#editorArea").value = "Config files appear here after you start the server for the first time."; updateGutter();
    return;
  }
  if (!curFile || !fileNames.includes(curFile)) curFile = fileNames[0];
  list.innerHTML = fileNames.map((n) => `<div class="file-item ${n === curFile ? "active" : ""}" data-f="${esc(n)}">${esc(n)}</div>`).join("");
  list.querySelectorAll(".file-item").forEach((el) => el.onclick = () => { curFile = el.dataset.f; openFile(); });
  openFile();
}
async function openFile() {
  const content = await api.readFile(activeId, curFile);
  $("#edName").textContent = curFile;
  $("#editorArea").value = content;
  updateGutter();
  document.querySelectorAll("#fileList .file-item").forEach((el) => el.classList.toggle("active", el.dataset.f === curFile));
}
function wireFiles() {
  const ta = $("#editorArea");
  ta.addEventListener("input", updateGutter);
  ta.addEventListener("scroll", () => { $("#gutter").scrollTop = ta.scrollTop; });
  $("#saveFileBtn").onclick = async () => { if (!curFile) return; try { await api.writeFile(activeId, curFile, ta.value); toast(curFile + " saved"); } catch (e) { toast(e.message); } };
  $("#revertBtn").onclick = () => { if (curFile) openFile(); };
}

/* ================= SHARE ================= */
let net = {};
async function loadShare() {
  const s = activeServer(); if (!s) return;
  $("#portCode").textContent = s.port;
  $("#addrBox").textContent = "Finding your address…";
  net = await api.netInfo();
  $("#addrBox").textContent = (net.publicIp || "your-ip") + ":" + s.port;
  $("#localCode").textContent = net.localIp || "—";
  $("#gwLink").textContent = "http://" + (net.gateway || "192.168.1.1");
  // tunnel state
  const ts = await api.tunnelStatus();
  if (ts.running) { showTunnel("active"); refreshTunnelAddrs(); }
  else if (ts.hasSecret) { showTunnel("active"); api.tunnelStart().then(refreshTunnelAddrs).catch(() => {}); }
  else showTunnel("idle");
}
function showTunnel(which) {
  $("#tunnelIdle").style.display = which === "idle" ? "block" : "none";
  $("#tunnelSetup").style.display = which === "setup" ? "block" : "none";
  $("#tunnelActive").style.display = which === "active" ? "block" : "none";
}
async function refreshTunnelAddrs() {
  let list = [];
  try { list = await api.tunnelList(); } catch {}
  const el = $("#tunnelAddrs");
  if (!list.length) {
    el.innerHTML = `<div class="note"><span class="k">➕</span><div>Tunnel is connected, but no Minecraft tunnel exists yet. On <b>playit.gg</b>, add a <b>Minecraft: Java</b> tunnel pointing to <code>127.0.0.1:25565</code>, then press Refresh. <button class="btn sm" id="openPlayit" type="button" style="margin-top:8px">Open playit.gg</button></div></div>`;
    const b = $("#openPlayit"); if (b) b.onclick = () => api.openExternal("https://playit.gg/account/tunnels");
    return;
  }
  el.innerHTML = list.map((t) => `<div class="addr"><div class="box">${esc(t.address)}</div><button class="btn copytun" data-a="${esc(t.address)}" type="button">Copy</button></div>`).join("");
  el.querySelectorAll(".copytun").forEach((b) => b.onclick = () => { copyText(b.dataset.a); b.textContent = "Copied ✓"; toast("Address copied"); setTimeout(() => b.textContent = "Copy", 1400); });
}
function wireShare() {
  $("#copyBtn").onclick = () => { copyText($("#addrBox").textContent); $("#copyBtn").textContent = "Copied ✓"; toast("Address copied"); setTimeout(() => $("#copyBtn").textContent = "Copy", 1400); };
  $("#upnpBtn").onclick = async () => {
    const s = activeServer(); if (!s) return;
    $("#upnpBtn").disabled = true; $("#upnpBtn").innerHTML = "Working…";
    const r = await api.upnp("open", s.port);
    toast(r.msg); $("#upnpBtn").disabled = false; $("#upnpBtn").innerHTML = '<span class="icon">⚡</span> Try automatic setup (UPnP)';
  };
  $("#checkBtn").onclick = async () => {
    const s = activeServer(); if (!s) return;
    $("#reachText").textContent = "Checking from the outside…"; $("#reachGlyph").className = "glyph starting";
    const host = net.publicIp; if (!host) { $("#reachText").textContent = "Couldn't find your public IP."; $("#reachGlyph").className = "glyph stopped"; return; }
    const r = await api.reachable(host, s.port);
    if (r.online) { $("#reachGlyph").className = "glyph running"; $("#reachText").innerHTML = "<b>Reachable</b> — friends can connect."; }
    else { $("#reachGlyph").className = "glyph stopped"; $("#reachText").innerHTML = "<b>Not reachable yet.</b> Start the server and forward the port, then check again."; }
  };

  // ---- playit.gg tunnel ----
  let claimUrl = null;
  api.onTunnelClaimUrl((url) => { claimUrl = url; api.openExternal(url); $("#tunnelClaim").style.display = "block"; });
  api.onTunnelClaimState((state) => {
    const map = { WaitingForUserVisit: "Waiting for you to open playit.gg and sign in…", WaitingForUser: "Waiting for you to click Allow…", UserAccepted: "Approved! Connecting the tunnel…" };
    $("#tunnelState").textContent = map[state] || state;
  });
  $("#tunnelSetupBtn").onclick = async () => {
    showTunnel("setup"); $("#tunnelState").textContent = "Contacting playit.gg…"; $("#tunnelClaim").style.display = "none";
    try { await api.tunnelSetup(); showTunnel("active"); refreshTunnelAddrs(); toast("Tunnel connected"); }
    catch (e) { toast("Tunnel setup failed: " + e.message); showTunnel("idle"); }
  };
  $("#tunnelOpenBtn").onclick = () => { if (claimUrl) api.openExternal(claimUrl); };
  $("#tunnelRefresh").onclick = refreshTunnelAddrs;
  $("#tunnelStopBtn").onclick = async () => { await api.tunnelStop(); showTunnel("idle"); toast("Tunnel turned off"); };
}
function copyText(t) { try { navigator.clipboard.writeText(t); } catch { const a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select(); document.execCommand("copy"); a.remove(); } }

/* ================= BACKUPS ================= */
function fmtSize(b) { if (b > 1e9) return (b / 1e9).toFixed(1) + " GB"; if (b > 1e6) return (b / 1e6).toFixed(1) + " MB"; if (b > 1e3) return (b / 1e3).toFixed(0) + " KB"; return b + " B"; }
function fmtWhen(ms) { const d = new Date(ms); return d.toLocaleString(); }
async function loadBackups() {
  if (!activeId) return;
  const list = await api.listBackups(activeId);
  const el = $("#bkList");
  if (!list.length) { el.innerHTML = `<div class="empty">No backups yet. Click “Back up now” to save a copy of your world.</div>`; return; }
  el.innerHTML = list.map((b) => `<div class="bk-row"><div class="grow"><div class="fn">${esc(b.name)}</div><div class="sub">${esc(fmtWhen(b.when))}</div></div><span class="sz">${fmtSize(b.size)}</span><div class="rowbtns"><button class="btn sm" data-restore="${esc(b.name)}" type="button">Restore</button><button class="btn sm ghost" data-del="${esc(b.name)}" type="button">Delete</button></div></div>`).join("");
  el.querySelectorAll("[data-restore]").forEach((btn) => btn.onclick = async () => { if (!confirm("Restore this backup? Your current world will be replaced.")) return; try { await api.restoreBackup(activeId, btn.dataset.restore); toast("World restored"); } catch (e) { toast(e.message); } });
  el.querySelectorAll("[data-del]").forEach((btn) => btn.onclick = async () => { if (!confirm("Delete this backup?")) return; await api.deleteBackup(activeId, btn.dataset.del); loadBackups(); });
}
function wireBackups() {
  $("#backupBtn").onclick = async () => { try { const name = await api.createBackup(activeId, ""); toast("Backup created"); loadBackups(); } catch (e) { toast(e.message); } };
}

/* ================= NEW SERVER MODAL ================= */
let modalType = "Paper", eulaOk = false, modalMode = "new", pickedDir = null;
async function openModal() {
  $("#scrim").classList.add("open");
  $("#dlWrap").style.display = "none";
  eulaOk = false; $("#eulaChk").classList.remove("on"); $("#eulaChk").textContent = "";
  setModalMode("new");
  pickedDir = null; $("#pickedPath").innerHTML = "No folder chosen — pick the folder that holds your server's <code>.jar</code>.";
  loadVersions();
}
function setModalMode(mode) {
  modalMode = mode;
  document.querySelectorAll("#mMode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  $("#newFields").style.display = mode === "new" ? "block" : "none";
  $("#importFields").style.display = mode === "import" ? "block" : "none";
  $("#createBtn").textContent = mode === "import" ? "Import server →" : "Create server →";
}
async function loadVersions() {
  const sel = $("#mVersion"); sel.innerHTML = "<option>loading…</option>";
  try {
    const vers = modalType === "Vanilla" ? await api.vanillaVersions() : await api.paperVersions();
    sel.innerHTML = vers.slice(0, 40).map((v) => `<option>${esc(v)}</option>`).join("");
  } catch (e) { sel.innerHTML = "<option>couldn't load versions</option>"; toast("Couldn't fetch versions — check your internet."); }
}
function wireModal() {
  $("#mRam").addEventListener("input", (e) => $("#mRamVal").textContent = e.target.value);
  document.querySelectorAll("#mType button").forEach((b) => b.onclick = () => { document.querySelectorAll("#mType button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); modalType = b.dataset.type; loadVersions(); });
  $(".eula").onclick = () => { eulaOk = !eulaOk; $("#eulaChk").classList.toggle("on", eulaOk); $("#eulaChk").textContent = eulaOk ? "✓" : ""; };
  api.onDownload(({ received, total }) => {
    $("#dlWrap").style.display = "block";
    if (total) { const pct = Math.round((received / total) * 100); $("#dlBar").style.width = pct + "%"; $("#dlLabel").textContent = `Downloading… ${pct}%`; }
    else { $("#dlLabel").textContent = `Downloading… ${(received / 1e6).toFixed(1)} MB`; }
  });
  document.querySelectorAll("#mMode button").forEach((b) => b.onclick = () => setModalMode(b.dataset.mode));
  $("#pickFolderBtn").onclick = async () => {
    const dir = await api.pickFolder();
    if (!dir) return;
    pickedDir = dir; $("#pickedPath").textContent = dir;
  };

  $("#createBtn").onclick = async () => {
    if (modalMode === "import") {
      if (!pickedDir) { toast("Choose your server folder first"); return; }
      $("#createBtn").disabled = true;
      try {
        const server = await api.importServer({ name: $("#mName").value.trim(), ram: +$("#mRam").value, dir: pickedDir });
        $("#scrim").classList.remove("open"); toast("Server imported");
        await refreshServers(); selectServer(server.id);
      } catch (e) { toast("Couldn't import: " + e.message); }
      finally { $("#createBtn").disabled = false; }
      return;
    }
    if (!eulaOk) { toast("Please accept the EULA first"); return; }
    const cfg = { name: $("#mName").value.trim() || "My Server", type: modalType, ver: $("#mVersion").value, ram: +$("#mRam").value, port: +$("#mPort").value || 25565 };
    $("#createBtn").disabled = true; $("#dlWrap").style.display = "block"; $("#dlLabel").textContent = "Preparing…"; $("#dlBar").style.width = "0%";
    try {
      const server = await api.createServer(cfg);
      $("#scrim").classList.remove("open");
      toast("Server created");
      await refreshServers(); selectServer(server.id);
    } catch (e) { toast("Couldn't create server: " + e.message); }
    finally { $("#createBtn").disabled = false; }
  };
}

boot();
