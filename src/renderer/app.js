const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// deterministic name -> colour swatch, so the same name always gets the same colour
function swatch(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return "sw-" + (Math.abs(h) % 6);
}
function initial(name) { return esc((name || "?").trim().charAt(0).toUpperCase() || "?"); }

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
    b.innerHTML = `<span class="avatar-wrap"><span class="avatar ${swatch(s.name)}">${initial(s.name)}</span><span class="avatar-dot ${statusOf(s.id)}"></span></span><span class="col"><span class="nm">${esc(s.name)}</span><span class="mt"><span class="tag">${esc(s.type)} ${esc(s.ver)}</span><span class="tag">:${s.port}</span></span></span>`;
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
    const buf = logs.get(id); const wasEmpty = buf.length === 0;
    buf.push(line); if (buf.length > 600) buf.shift();
    // Append just the new line instead of re-rendering the whole buffer — a fresh
    // server dumps hundreds of lines at once, and a full rebuild each time is O(n²).
    if (id === activeId && currentTab === "console") {
      if (wasEmpty) renderConsole();       // first line: clear the "server is off" placeholder
      else appendConsoleLine(line);
    }
  });
  api.onStatus(({ id, status }) => {
    statuses.set(id, status);
    renderSidebar();
    if (id === activeId) { renderHeader(); if (currentTab === "players") renderPlayers(); }
  });
  api.onPlayers(({ id, players: p }) => { players.set(id, p); if (id === activeId && currentTab === "players") renderPlayers(); });
  api.onBackupMade(({ id }) => { toast("Auto-backup saved"); if (id === activeId && currentTab === "backups") loadBackups(); });
  api.onCrashed(({ id, restarting, count, limit }) => {
    const s = servers.find((x) => x.id === id);
    const name = s ? s.name : "The server";
    toast(restarting ? `${name} crashed — restarting (${count}/${limit})` : `${name} keeps crashing — auto-restart paused`);
  });
}

// ---------- console ----------
function renderConsole() {
  const s = activeServer(); if (!s) return;
  const buf = logs.get(s.id) || [];
  const html = buf.length
    ? buf.map((l) => `<div class="ln">${esc(l)}</div>`).join("")
    : `<div class="ln" style="color:var(--muted)">Server is off. Press Start to turn it on.</div>`;
  const el = $("#console"); el.innerHTML = html; el.scrollTop = el.scrollHeight;
}

// Append a single line node — O(1) per line, and textContent escapes for us.
function appendConsoleLine(line) {
  const el = $("#console");
  const div = document.createElement("div");
  div.className = "ln";
  div.textContent = line;
  el.appendChild(div);
  while (el.childElementCount > 600) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
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
  wireAddons();
  wireShare();
  wireBackups();
  wireMap();
  wireReliability();
  wireModal();
}

function loadTab(tab) {
  if (tab === "players") { renderPlayers(); syncPlayers(); }
  else if (tab === "map") loadMap();
  else if (tab === "settings") { loadReliability(); loadSettings(); }
  else if (tab === "files") loadFiles();
  else if (tab === "addons") loadAddons();
  else if (tab === "share") loadShare();
  else if (tab === "backups") loadBackups();
  else renderConsole();
}

function loadReliability() {
  const s = activeServer(); if (!s) return;
  abToggle($("#crToggle"), s.autoRestart !== false); // on by default
}
function wireReliability() {
  $("#crToggle").onclick = () => {
    const s = activeServer(); if (!s) return;
    const on = !$("#crToggle").classList.contains("on");
    abToggle($("#crToggle"), on);
    s.autoRestart = on;
    api.setAutoRestart(s.id, on);
    toast(on ? "Auto-restart on" : "Auto-restart off");
  };
}

/* ================= PLAYERS ================= */
const GMODES = ["survival", "creative", "adventure", "spectator"];
function playerCmd(cmd) { api.sendCommand(activeId, cmd).catch((e) => toast(e.message)); }
// Ask the running server who's online — the reply is parsed back into the players list.
function syncPlayers() { const s = activeServer(); if (s && statusOf(s.id) === "running") api.sendCommand(s.id, "list").catch(() => {}); }
function renderPlayers() {
  const s = activeServer(); if (!s) return;
  const wrap = $("#playersWrap");
  const st = statusOf(s.id);
  const list = players.get(s.id) || [];
  if (st !== "running") {
    wrap.innerHTML = `<div class="empty">Start the server to manage players. Anyone who joins shows up here — then you can change their game mode, make them an operator, or remove them.</div>`;
    return;
  }
  if (!list.length) {
    wrap.innerHTML = `<div class="empty">No one is online right now. Players appear here the moment they join.</div>`;
    return;
  }
  wrap.innerHTML = `<div class="pl-count">${list.length} ${list.length === 1 ? "player" : "players"} online</div>` + list.map((name) => {
    const n = esc(name);
    return `<div class="pl-card" data-p="${n}">
      <div class="pl-top">
        <span class="pl-face ${swatch(name)}">${initial(name)}</span>
        <span class="pl-name">${n}</span>
        <button class="btn sm ghost pl-kick" type="button">Kick</button>
        <button class="btn sm ghost pl-ban" type="button">Ban</button>
      </div>
      <div class="pl-row">
        <span class="pl-lab">Game mode</span>
        <div class="seg pl-gm">${GMODES.map((g) => `<button data-gm="${g}" type="button">${g[0].toUpperCase() + g.slice(1)}</button>`).join("")}</div>
      </div>
      <div class="pl-row">
        <span class="pl-lab">Operator</span>
        <button class="btn sm pl-op" type="button">Make operator</button>
        <button class="btn sm ghost pl-deop" type="button">Remove op</button>
        <span class="pl-sep"></span>
        <button class="btn sm ghost pl-wl" type="button">Add to whitelist</button>
      </div>
    </div>`;
  }).join("");
  wrap.querySelectorAll(".pl-card").forEach((card) => {
    const name = card.dataset.p;
    card.querySelector(".pl-kick").onclick = () => { if (confirm(`Kick ${name} from the server?`)) { playerCmd(`kick ${name}`); toast(`${name} kicked`); } };
    card.querySelector(".pl-ban").onclick = () => { if (confirm(`Ban ${name}? They won't be able to rejoin until you unban them.`)) { playerCmd(`ban ${name}`); toast(`${name} banned`); } };
    card.querySelector(".pl-op").onclick = () => { playerCmd(`op ${name}`); toast(`${name} is now an operator`); };
    card.querySelector(".pl-deop").onclick = () => { playerCmd(`deop ${name}`); toast(`Removed operator from ${name}`); };
    card.querySelector(".pl-wl").onclick = () => { playerCmd(`whitelist add ${name}`); toast(`${name} added to whitelist`); };
    card.querySelectorAll(".pl-gm button").forEach((b) => b.onclick = () => {
      card.querySelectorAll(".pl-gm button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      playerCmd(`gamemode ${b.dataset.gm} ${name}`);
      toast(`${name} set to ${b.dataset.gm}`);
    });
  });
}

/* ================= WORLD MAP ================= */
let mapDim = "overworld";
let mapData = null;         // { off, blocksW, blocksH, originBX, originBZ, count }
let mapZoom = 2, mapPanX = 0, mapPanY = 0, mapDrag = null;
let mapY = null;            // null = surface, otherwise a Y level to slice at
const Y_RANGE = { overworld: [-64, 320], nether: [0, 128], end: [0, 192] };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function updateYLabel() {
  const sl = $("#mapY");
  const max = +sl.max;
  $("#mapYLabel").textContent = +sl.value >= max ? "Y: Surface" : "Y: " + sl.value;
}
function applyYRange() {
  const [lo, hi] = Y_RANGE[mapDim] || [-64, 320];
  const sl = $("#mapY");
  sl.min = lo; sl.max = hi; sl.value = hi;   // reset to Surface for the new dimension
  mapY = null;
  updateYLabel();
}

function wireMap() {
  document.querySelectorAll("#mapDim button").forEach((b) => b.onclick = () => {
    document.querySelectorAll("#mapDim button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on"); mapDim = b.dataset.dim; applyYRange(); loadMap();
  });

  const ys = $("#mapY");
  ys.addEventListener("input", updateYLabel);
  ys.addEventListener("change", () => { mapY = +ys.value >= +ys.max ? null : +ys.value; loadMap(true, true); });
  $("#mapRefresh").onclick = () => loadMap(true);
  $("#mapZoomIn").onclick = () => zoomBy(1.5);
  $("#mapZoomOut").onclick = () => zoomBy(1 / 1.5);
  // auto-refresh the map every 2 minutes while it's on screen and the server is running
  setInterval(() => {
    if (currentTab !== "map" || !mapData) return;
    const s = activeServer();
    if (s && statusOf(s.id) === "running") loadMap(true);
  }, 120000);

  const canvas = $("#mapCanvas");
  canvas.addEventListener("wheel", (e) => {
    if (!mapData) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.2 : 1 / 1.2);
  }, { passive: false });
  canvas.addEventListener("mousedown", (e) => { if (!mapData) return; mapDrag = { x: e.clientX, y: e.clientY, px: mapPanX, py: mapPanY }; canvas.style.cursor = "grabbing"; });
  window.addEventListener("mousemove", (e) => { if (!mapDrag) return; mapPanX = mapDrag.px + (e.clientX - mapDrag.x); mapPanY = mapDrag.py + (e.clientY - mapDrag.y); drawMapView(); });
  window.addEventListener("mouseup", () => { if (mapDrag) { mapDrag = null; const c = $("#mapCanvas"); if (c) c.style.cursor = "grab"; } });
  window.addEventListener("resize", () => { if (currentTab === "map" && mapData) drawMapView(); });
}

async function loadMap(keepView = false, useCache = false) {
  const s = activeServer(); if (!s) return;
  if (!keepView) $("#mapStat").textContent = "Reading world…";
  // flush freshly-explored chunks to disk — only when reading fresh from disk, not on a Y change
  if (!useCache && statusOf(s.id) === "running") {
    try { await api.sendCommand(s.id, "save-all"); await new Promise((r) => setTimeout(r, 1300)); } catch {}
  }
  let data;
  try { data = await api.worldMap(s.id, mapDim, mapY, useCache); }
  catch (e) { $("#mapStat").textContent = ""; toast(e.message); return; }
  if (currentTab === "map") buildMap(data, keepView);
}

// Paint every chunk's 16x16 colours into one offscreen canvas at 1px per block.
function buildMap(data, keepView = false) {
  const canvas = $("#mapCanvas"), empty = $("#mapEmpty");
  const { count, bounds, coords, pixels } = data;
  if (!count || !bounds) {
    mapData = null; canvas.style.display = "none"; empty.style.display = "flex";
    empty.textContent = statusOf(activeId) === "running"
      ? "No chunks generated here yet. Walk around in this dimension in-game, then press Refresh."
      : "No world data yet. Start the server and explore, then come back to see the map.";
    $("#mapStat").textContent = "0 chunks";
    return;
  }
  empty.style.display = "none"; canvas.style.display = "block";

  const prev = mapData;
  const originBX = bounds.minX * 16, originBZ = bounds.minZ * 16;
  const blocksW = (bounds.maxX - bounds.minX + 1) * 16, blocksH = (bounds.maxZ - bounds.minZ + 1) * 16;
  const off = document.createElement("canvas");
  off.width = blocksW; off.height = blocksH;
  const octx = off.getContext("2d");
  const img = octx.createImageData(16, 16);
  for (let i = 0; i < count; i++) {
    const base = i * 768;
    for (let k = 0; k < 256; k++) {
      const s = base + k * 3, d = k * 4;
      img.data[d] = pixels[s]; img.data[d + 1] = pixels[s + 1]; img.data[d + 2] = pixels[s + 2]; img.data[d + 3] = 255;
    }
    octx.putImageData(img, coords[i * 2] * 16 - originBX, coords[i * 2 + 1] * 16 - originBZ);
  }

  mapData = { off, blocksW, blocksH, originBX, originBZ, count };
  if (keepView && prev) {
    // keep the same world position and zoom after a refresh, even if the world grew
    mapPanX -= (originBX - prev.originBX) * mapZoom;
    mapPanY -= (originBZ - prev.originBZ) * mapZoom;
  } else {
    const availW = (canvas.parentElement.clientWidth || 700) - 2;
    mapZoom = clamp(availW / blocksW, 0.25, 6);
    mapPanX = 0; mapPanY = 0;
  }
  drawMapView();
  $("#mapStat").textContent = `${count.toLocaleString()} chunks${mapY == null ? "" : " · Y " + mapY}`;
}

function drawMapView() {
  if (!mapData) return;
  const canvas = $("#mapCanvas"), wrap = canvas.parentElement;
  const cssW = wrap.clientWidth, cssH = wrap.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const css = getComputedStyle(document.documentElement);
  ctx.fillStyle = (css.getPropertyValue("--field").trim() || "#111");
  ctx.fillRect(0, 0, cssW, cssH);

  const scaledW = mapData.blocksW * mapZoom, scaledH = mapData.blocksH * mapZoom;
  mapPanX = scaledW <= cssW ? (cssW - scaledW) / 2 : clamp(mapPanX, cssW - scaledW, 0);
  mapPanY = scaledH <= cssH ? (cssH - scaledH) / 2 : clamp(mapPanY, cssH - scaledH, 0);
  ctx.drawImage(mapData.off, 0, 0, mapData.blocksW, mapData.blocksH, mapPanX, mapPanY, scaledW, scaledH);
}

function zoomBy(f) { const c = $("#mapCanvas"); zoomAt(c.clientWidth / 2, c.clientHeight / 2, f); }
function zoomAt(cx, cy, f) {
  if (!mapData) return;
  const old = mapZoom;
  mapZoom = clamp(mapZoom * f, 0.25, 40);
  const k = mapZoom / old;
  mapPanX = cx - (cx - mapPanX) * k;   // keep the point under the cursor fixed
  mapPanY = cy - (cy - mapPanY) * k;
  drawMapView();
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
    { key: "pvp", label: "Player fighting", help: "Let players hurt each other.", type: "toggle", def: "true" },
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
  { group: "Mobs", fields: [
    { key: "spawn-monsters", label: "Spawn monsters", help: "Zombies, creepers, skeletons, etc.", type: "toggle", def: "true" },
    { key: "spawn-animals", label: "Spawn animals", help: "Cows, pigs, sheep, and other passive mobs.", type: "toggle", def: "true" },
    { key: "spawn-npcs", label: "Spawn villagers", help: "Villagers and other NPCs.", type: "toggle", def: "true" },
  ]},
  { group: "Players", fields: [
    { key: "max-players", label: "Max players", help: "How many people can be on at once.", type: "slider", min: 1, max: 100, def: "20", unit: "players" },
    { key: "white-list", label: "Whitelist only", help: "Only invited players can join.", type: "toggle", def: "false" },
    { key: "enforce-whitelist", label: "Enforce whitelist", help: "Kick players the moment they're removed.", type: "toggle", def: "false" },
    { key: "online-mode", label: "Online mode", help: "Require real Minecraft accounts.", type: "toggle", def: "true" },
    { key: "op-permission-level", label: "Operator power", help: "How much power operators get (4 = full control).", type: "select", options: ["1","2","3","4"], def: "4" },
  ]},
  { group: "Appearance", fields: [
    { key: "motd", label: "Server message (MOTD)", help: "Shown next to your server in the list.", type: "text", def: "A Host server" },
    { key: "hide-online-players", label: "Hide online players", help: "Don't reveal who's online in the list.", type: "toggle", def: "false" },
    { key: "resource-pack", label: "Resource pack URL", help: "Optional texture pack players download on join.", type: "text", def: "" },
    { key: "require-resource-pack", label: "Require resource pack", help: "Players must accept it or can't join.", type: "toggle", def: "false" },
  ]},
  { group: "Advanced", fields: [
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

/* ================= ADD-ONS (Modrinth plugins & mods) ================= */
let aoDebounce = null;
function addonKind(s) { return s.type === "Fabric" ? "mods" : s.type === "Paper" ? "plugins" : null; }
function fmtNum(n) { return n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n); }
async function loadAddons() {
  const s = activeServer(); if (!s) return;
  const kind = addonKind(s);
  const unsupported = $("#addonsUnsupported"), body = $("#addonsBody");
  if (!kind) {
    unsupported.style.display = "block"; body.style.display = "none";
    unsupported.innerHTML = s.type === "Vanilla"
      ? "Vanilla servers can't use plugins or mods. Make a <b>Paper</b> server for plugins, or a <b>Fabric</b> server for mods."
      : "Plugins and mods aren't available for imported servers.";
    return;
  }
  unsupported.style.display = "none"; body.style.display = "block";
  $("#aoKind").textContent = kind === "mods" ? "Fabric mods" : "Paper plugins";
  $("#aoSearch").placeholder = `Search ${kind}…`;
  await renderInstalled();
  await runAddonSearch("");
}
async function runAddonSearch(query) {
  const s = activeServer(); if (!s) return;
  const el = $("#aoResults");
  el.innerHTML = `<div class="empty">Searching…</div>`;
  try {
    const data = await api.searchContent(s.id, query);
    if (!data.hits || !data.hits.length) { el.innerHTML = `<div class="empty">No results.</div>`; return; }
    el.innerHTML = data.hits.map((h) => `
      <div class="ao-card" data-id="${esc(h.project_id)}">
        <img class="ao-icon" src="${esc(h.icon_url || "")}" onerror="this.style.visibility='hidden'" />
        <div class="ao-info">
          <div class="ao-title">${esc(h.title)}</div>
          <div class="ao-desc">${esc(h.description || "")}</div>
          <div class="ao-meta">${fmtNum(h.downloads)} downloads</div>
        </div>
        <button class="btn sm solid ao-install" type="button">Install</button>
      </div>`).join("");
    el.querySelectorAll(".ao-card").forEach((card) => {
      card.querySelector(".ao-install").onclick = () => installAddon(card.dataset.id, card.querySelector(".ao-install"));
    });
  } catch (e) {
    el.innerHTML = `<div class="empty">Couldn't search Modrinth — check your internet.</div>`;
  }
}
async function installAddon(projectId, btn) {
  const s = activeServer(); if (!s) return;
  btn.disabled = true; btn.textContent = "Installing…";
  try {
    const r = await api.installContent(s.id, projectId);
    toast(r.matched ? `Installed ${r.filename}` : `Installed ${r.filename} — no build tagged for your version, used the newest one`);
    await renderInstalled();
  } catch (e) {
    toast("Couldn't install: " + e.message);
  } finally {
    btn.disabled = false; btn.textContent = "Install";
  }
}
async function renderInstalled() {
  const s = activeServer(); if (!s) return;
  const el = $("#aoInstalled");
  const kind = addonKind(s);
  const list = await api.listContent(s.id);
  if (!list.length) { el.innerHTML = `<div class="empty">No ${kind || "add-ons"} installed yet.</div>`; return; }
  el.innerHTML = list.map((f) => `
    <div class="ao-inst-row ${f.disabled ? "off" : ""}">
      <span class="ao-inst-name">${esc(f.name)}</span>
      <div class="rowbtns">
        <button class="btn sm ghost" data-toggle="${esc(f.name)}" type="button">${f.disabled ? "Enable" : "Disable"}</button>
        <button class="btn sm ghost" data-remove="${esc(f.name)}" type="button">Remove</button>
      </div>
    </div>`).join("");
  el.querySelectorAll("[data-toggle]").forEach((btn) => btn.onclick = async () => { await api.toggleContent(s.id, btn.dataset.toggle); renderInstalled(); });
  el.querySelectorAll("[data-remove]").forEach((btn) => btn.onclick = async () => { if (!confirm(`Remove ${btn.dataset.remove}?`)) return; await api.removeContent(s.id, btn.dataset.remove); renderInstalled(); });
}
function wireAddons() {
  $("#aoSearch").addEventListener("input", (e) => {
    clearTimeout(aoDebounce);
    const q = e.target.value;
    aoDebounce = setTimeout(() => runAddonSearch(q), 350);
  });
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
    el.innerHTML = `<div class="note"><div>Tunnel is connected, but no Minecraft tunnel exists yet. On <b>playit.gg</b>, add a <b>Minecraft: Java</b> tunnel pointing to <code>127.0.0.1:25565</code>, then press Refresh. <button class="btn sm" id="openPlayit" type="button" style="margin-top:8px">Open playit.gg</button></div></div>`;
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
    toast(r.msg); $("#upnpBtn").disabled = false; $("#upnpBtn").innerHTML = 'Try automatic setup (UPnP)';
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
function abToggle(el, on) { el.classList.toggle("on", on); el.querySelector(".state").textContent = on ? "On" : "Off"; }
function loadAuto() {
  const s = activeServer(); if (!s) return;
  abToggle($("#abToggle"), !!s.autoBackup);
  $("#abMins").value = String(s.autoBackupMins || 60);
  $("#abKeep").value = String(s.autoBackupKeep || 5);
  abToggle($("#abPlayers"), !!s.autoBackupPlayersOnly);
  $("#abOpts").classList.toggle("dim", !s.autoBackup);
}
function saveAuto() {
  const s = activeServer(); if (!s) return;
  const opts = {
    enabled: $("#abToggle").classList.contains("on"),
    mins: +$("#abMins").value,
    keep: +$("#abKeep").value,
    playersOnly: $("#abPlayers").classList.contains("on"),
  };
  Object.assign(s, { autoBackup: opts.enabled, autoBackupMins: opts.mins, autoBackupKeep: opts.keep, autoBackupPlayersOnly: opts.playersOnly });
  $("#abOpts").classList.toggle("dim", !opts.enabled);
  api.setAutoBackup(s.id, opts);
}
async function loadBackups() {
  if (!activeId) return;
  loadAuto();
  const list = await api.listBackups(activeId);
  const el = $("#bkList");
  if (!list.length) { el.innerHTML = `<div class="empty">No backups yet. Click “Back up now” to save a copy of your world.</div>`; return; }
  el.innerHTML = list.map((b) => `<div class="bk-row"><div class="grow"><div class="fn">${esc(b.name)}</div><div class="sub">${esc(fmtWhen(b.when))}</div></div><span class="sz">${fmtSize(b.size)}</span><div class="rowbtns"><button class="btn sm" data-restore="${esc(b.name)}" type="button">Restore</button><button class="btn sm ghost" data-del="${esc(b.name)}" type="button">Delete</button></div></div>`).join("");
  el.querySelectorAll("[data-restore]").forEach((btn) => btn.onclick = async () => { if (!confirm("Restore this backup? Your current world will be replaced.")) return; try { await api.restoreBackup(activeId, btn.dataset.restore); toast("World restored"); } catch (e) { toast(e.message); } });
  el.querySelectorAll("[data-del]").forEach((btn) => btn.onclick = async () => { if (!confirm("Delete this backup?")) return; await api.deleteBackup(activeId, btn.dataset.del); loadBackups(); });
}
function wireBackups() {
  $("#backupBtn").onclick = async () => { try { const name = await api.createBackup(activeId, ""); toast("Backup created"); loadBackups(); } catch (e) { toast(e.message); } };
  // auto-backup controls save immediately
  $("#abToggle").onclick = () => { abToggle($("#abToggle"), !$("#abToggle").classList.contains("on")); saveAuto(); toast($("#abToggle").classList.contains("on") ? "Automatic backups on" : "Automatic backups off"); };
  $("#abPlayers").onclick = () => { abToggle($("#abPlayers"), !$("#abPlayers").classList.contains("on")); saveAuto(); };
  $("#abMins").onchange = saveAuto;
  $("#abKeep").onchange = saveAuto;
}

/* ================= NEW SERVER MODAL ================= */
let modalType = "Paper", eulaOk = false, modalMode = "new", pickedDir = null;
function usedPorts() { return new Set(servers.map((s) => s.port)); }
function nextFreePort() {
  const used = usedPorts();
  let p = 25565;
  while (used.has(p)) p++;
  return p;
}
function checkPort() {
  const port = +$("#mPort").value;
  const taken = usedPorts().has(port);
  $("#portWarn").style.display = taken ? "block" : "none";
  $("#portWarn").textContent = taken ? "Already used by another server on this PC — pick a different port." : "";
  $("#portWarn").className = "hint warn";
  $("#createBtn").disabled = modalMode === "new" && taken;
  return !taken;
}
async function openModal() {
  $("#scrim").classList.add("open");
  $("#dlWrap").style.display = "none";
  eulaOk = false; $("#eulaChk").classList.remove("on"); $("#eulaChk").textContent = "";
  setModalMode("new");
  $("#mPort").value = nextFreePort();
  checkPort();
  pickedDir = null; $("#pickedPath").innerHTML = "No folder picked yet. Choose the folder with your server's <code>.jar</code> file.";
  loadVersions();
}
function setModalMode(mode) {
  modalMode = mode;
  document.querySelectorAll("#mMode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  $("#newFields").style.display = mode === "new" ? "block" : "none";
  $("#importFields").style.display = mode === "import" ? "block" : "none";
  $("#createBtn").textContent = mode === "import" ? "Import server →" : "Create server →";
  checkPort();
}
async function loadVersions() {
  const sel = $("#mVersion"); sel.innerHTML = "<option>loading…</option>";
  try {
    const vers = modalType === "Vanilla" ? await api.vanillaVersions() : modalType === "Fabric" ? await api.fabricVersions() : await api.paperVersions();
    sel.innerHTML = vers.slice(0, 40).map((v) => `<option>${esc(v)}</option>`).join("");
  } catch (e) { sel.innerHTML = "<option>couldn't load versions</option>"; toast("Couldn't fetch versions — check your internet."); }
}
function wireModal() {
  $("#mRam").addEventListener("input", (e) => $("#mRamVal").textContent = e.target.value);
  $("#mPort").addEventListener("input", checkPort);
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
    if (!checkPort()) { toast("That port is already used by another server"); return; }
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
