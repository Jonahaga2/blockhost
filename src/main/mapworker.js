// Runs on a background thread so map reading/rendering never freezes the app.
// Reads region files once, caches parsed chunks, renders any Y layer, and preloads
// layers in the background. Results are posted back as packed typed arrays.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { parentPort } = require("worker_threads");

function levelName(dir) {
  try {
    const m = fs.readFileSync(path.join(dir, "server.properties"), "utf8").match(/^level-name=(.*)$/m);
    if (m && m[1].trim()) return m[1].trim();
  } catch {}
  return "world";
}

function regionDir(dir, level, dim) {
  const candidates = {
    overworld: [[level, "dimensions", "minecraft", "overworld", "region"], [level, "region"]],
    nether: [[level, "dimensions", "minecraft", "the_nether", "region"], [level + "_nether", "DIM-1", "region"], [level, "DIM-1", "region"]],
    end: [[level, "dimensions", "minecraft", "the_end", "region"], [level + "_the_end", "DIM1", "region"], [level, "DIM1", "region"]],
  }[dim] || [];
  for (const parts of candidates) {
    const p = path.join(dir, ...parts);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function parseNBT(buf) {
  let o = 0;
  const u8 = () => buf.readUInt8(o++);
  const i16 = () => { const v = buf.readInt16BE(o); o += 2; return v; };
  const i32 = () => { const v = buf.readInt32BE(o); o += 4; return v; };
  const str = () => { const n = buf.readUInt16BE(o); o += 2; const s = buf.toString("utf8", o, o + n); o += n; return s; };
  function payload(t) {
    switch (t) {
      case 1: { const v = buf.readInt8(o); o += 1; return v; }
      case 2: return i16();
      case 3: return i32();
      case 4: { const v = buf.readBigInt64BE(o); o += 8; return v; }
      case 5: { const v = buf.readFloatBE(o); o += 4; return v; }
      case 6: { const v = buf.readDoubleBE(o); o += 8; return v; }
      case 7: { const n = i32(); const a = buf.subarray(o, o + n); o += n; return a; }
      case 8: return str();
      case 9: { const et = u8(); const n = i32(); const a = []; for (let i = 0; i < n; i++) a.push(payload(et)); return a; }
      case 10: { const obj = {}; for (;;) { const tt = u8(); if (tt === 0) break; const nm = str(); obj[nm] = payload(tt); } return obj; }
      case 11: { const n = i32(); const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = i32(); return a; }
      case 12: { const n = i32(); const a = buf.subarray(o, o + n * 8); o += n * 8; return a; }
      default: throw new Error("bad NBT tag " + t);
    }
  }
  if (u8() !== 10) throw new Error("NBT root not a compound");
  str();
  return payload(10);
}

function readChunkNBT(fd, header, i) {
  const loc = header.readUInt32BE(i * 4);
  if (loc === 0) return null;
  const start = (loc >>> 8) * 4096;
  const head = Buffer.alloc(5);
  fs.readSync(fd, head, 0, 5, start);
  const length = head.readUInt32BE(0);
  const comp = head.readUInt8(4);
  if (length <= 1 || (comp & 0x80)) return null;
  const data = Buffer.alloc(length - 1);
  fs.readSync(fd, data, 0, length - 1, start + 5);
  let raw;
  if (comp === 1) raw = zlib.gunzipSync(data);
  else if (comp === 2) raw = zlib.inflateSync(data);
  else if (comp === 3) raw = data;
  else return null;
  return parseNBT(raw);
}

const C = {
  "minecraft:grass_block": [102, 140, 60], "minecraft:dirt": [134, 96, 67], "minecraft:coarse_dirt": [120, 85, 58],
  "minecraft:rooted_dirt": [124, 90, 62], "minecraft:podzol": [90, 64, 30], "minecraft:mud": [60, 54, 50],
  "minecraft:farmland": [110, 78, 52], "minecraft:dirt_path": [148, 120, 72], "minecraft:mycelium": [110, 94, 104],
  "minecraft:stone": [125, 125, 125], "minecraft:cobblestone": [122, 122, 122], "minecraft:gravel": [136, 130, 127],
  "minecraft:andesite": [132, 132, 134], "minecraft:diorite": [188, 188, 190], "minecraft:granite": [154, 110, 90],
  "minecraft:tuff": [108, 110, 102], "minecraft:deepslate": [80, 80, 86], "minecraft:bedrock": [70, 70, 72],
  "minecraft:calcite": [224, 224, 218], "minecraft:clay": [160, 166, 178], "minecraft:terracotta": [152, 94, 68],
  "minecraft:sand": [219, 207, 163], "minecraft:sandstone": [216, 203, 156], "minecraft:red_sand": [190, 102, 49],
  "minecraft:red_sandstone": [186, 99, 48],
  "minecraft:water": [57, 104, 202], "minecraft:ice": [150, 180, 235], "minecraft:packed_ice": [141, 171, 230],
  "minecraft:blue_ice": [120, 158, 225], "minecraft:snow": [240, 240, 245], "minecraft:snow_block": [240, 240, 245],
  "minecraft:powder_snow": [236, 236, 242], "minecraft:lava": [214, 110, 26],
  "minecraft:oak_leaves": [58, 110, 45], "minecraft:spruce_leaves": [48, 92, 54], "minecraft:birch_leaves": [70, 120, 50],
  "minecraft:jungle_leaves": [52, 116, 40], "minecraft:acacia_leaves": [80, 120, 40], "minecraft:dark_oak_leaves": [46, 86, 38],
  "minecraft:mangrove_leaves": [52, 110, 44], "minecraft:cherry_leaves": [210, 150, 190], "minecraft:azalea_leaves": [70, 110, 50],
  "minecraft:oak_log": [124, 96, 58], "minecraft:spruce_log": [86, 62, 38], "minecraft:birch_log": [196, 188, 168],
  "minecraft:jungle_log": [120, 90, 56], "minecraft:dark_oak_log": [76, 58, 38], "minecraft:oak_planks": [162, 130, 78],
  "minecraft:moss_block": [90, 118, 52], "minecraft:moss_carpet": [90, 118, 52],
  "minecraft:netherrack": [106, 44, 44], "minecraft:nether_bricks": [44, 22, 26], "minecraft:soul_sand": [84, 64, 50],
  "minecraft:soul_soil": [76, 58, 46], "minecraft:basalt": [72, 72, 78], "minecraft:blackstone": [42, 40, 46],
  "minecraft:glowstone": [190, 150, 80], "minecraft:crimson_nylium": [130, 40, 44], "minecraft:warped_nylium": [40, 110, 110],
  "minecraft:magma_block": [140, 64, 34], "minecraft:end_stone": [220, 222, 160], "minecraft:obsidian": [30, 26, 44],
  "minecraft:purpur_block": [160, 110, 160],
};
function colorFor(name, dim) {
  if (!name || name === "minecraft:air" || name === "minecraft:cave_air" || name === "minecraft:void_air")
    return dim === "end" ? [18, 14, 26] : dim === "nether" ? [40, 20, 22] : [40, 44, 52];
  const hit = C[name];
  if (hit) return hit;
  if (name.includes("leaves")) return [58, 104, 44];
  if (name.includes("log") || name.includes("planks") || name.includes("wood") || name.includes("stem")) return [130, 100, 60];
  if (name.includes("water")) return [57, 104, 202];
  if (name.includes("lava")) return [214, 110, 26];
  if (name.includes("sand")) return [216, 203, 156];
  if (name.includes("snow")) return [240, 240, 245];
  if (name.includes("ice")) return [141, 171, 230];
  if (name.includes("grass") || name.includes("moss") || name.includes("fern") || name.includes("leaf")) return [96, 136, 58];
  if (name.includes("deepslate")) return [80, 80, 86];
  if (name.includes("netherrack") || name.includes("nether")) return [106, 44, 44];
  if (name.includes("stone") || name.includes("ore") || name.includes("cobble") || name.includes("brick")) return [122, 122, 124];
  if (name.includes("dirt") || name.includes("mud") || name.includes("clay")) return [130, 96, 66];
  if (name.includes("concrete") || name.includes("wool") || name.includes("terracotta")) return [150, 120, 110];
  return [120, 120, 128];
}

const MIN_Y = { overworld: -64, nether: 0, end: 0 };
const DIM_Y = { overworld: [-64, 320], nether: [0, 128], end: [0, 192] };
const AIR = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air"]);
const clamp8 = (v) => Math.max(0, Math.min(255, Math.round(v)));

// Extract a bit-field from a big-endian long array using plain 32-bit math.
// BigInt here was ~10x slower and deoptimised the hot loop.
function readPacked(buf, off, bitStart, bits, mask) {
  if (bitStart + bits <= 32) { const lo = buf.readUInt32BE(off + 4); return (lo >>> bitStart) & mask; }
  if (bitStart >= 32) { const hi = buf.readUInt32BE(off); return (hi >>> (bitStart - 32)) & mask; }
  const lo = buf.readUInt32BE(off + 4), hi = buf.readUInt32BE(off);
  return ((lo >>> bitStart) | (hi << (32 - bitStart))) & mask;
}

function blockNameAt(section, lx, ly, lz) {
  const st = section && section.block_states;
  if (!st) return null;
  const palette = st.palette;
  if (!palette || !palette.length) return null;
  if (palette.length === 1 || !st.data) return palette[0].Name;
  const bits = Math.max(4, 32 - Math.clz32(palette.length - 1));
  const perLong = (64 / bits) | 0;
  const idx = (ly * 16 + lz) * 16 + lx;
  const li = (idx / perLong) | 0;
  const within = idx - li * perLong;
  const v = readPacked(st.data, li * 8, within * bits, bits, (1 << bits) - 1);
  return (palette[v] || palette[0]).Name;
}

function chunkPixels(chunk, dim, sliceY, rgb) {
  const hm = chunk.Heightmaps && (chunk.Heightmaps.MOTION_BLOCKING || chunk.Heightmaps.WORLD_SURFACE);
  const sections = chunk.sections || [];
  const secByY = {};
  for (const s of sections) if (typeof s.Y === "number") secByY[s.Y] = s;
  const minY = MIN_Y[dim] != null ? MIN_Y[dim] : -64;

  const heights = new Int16Array(256);
  if (hm && hm.length) {
    const longs = hm.length / 8;
    const bpe = Math.floor((longs * 64) / 256) || 9;
    const perLong = (64 / bpe) | 0;
    const mask = (1 << bpe) - 1;
    for (let idx = 0; idx < 256; idx++) {
      const li = (idx / perLong) | 0;
      const within = idx - li * perLong;
      heights[idx] = readPacked(hm, li * 8, within * bpe, bpe, mask);
    }
  }

  const renderH = new Int16Array(256);
  const nameAt = new Array(256);
  const solid = new Uint8Array(256);
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const col = z * 16 + x;
      const surfaceTop = heights[col] > 0 ? minY + heights[col] - 1 : null;
      let topY = null;
      if (sliceY == null || (surfaceTop != null && sliceY >= surfaceTop)) {
        topY = surfaceTop;
      } else {
        // scan down for the first solid block, skipping whole missing / all-air
        // sections at once (otherwise ungenerated columns crawl 128 blocks each)
        let y = sliceY;
        while (y >= minY) {
          const sec = secByY[y >> 4];
          if (!sec) { y = ((y >> 4) << 4) - 1; continue; }
          const bs = sec.block_states;
          if (bs && bs.palette && bs.palette.length === 1) {
            const only = bs.palette[0].Name;
            if (only && !AIR.has(only)) { topY = y; break; }
            y = ((y >> 4) << 4) - 1; continue;
          }
          const nm = blockNameAt(sec, x, y & 15, z);
          if (nm && !AIR.has(nm)) { topY = y; break; }
          y--;
        }
      }
      if (topY == null) { solid[col] = 0; renderH[col] = minY; }
      else { solid[col] = 1; renderH[col] = topY; nameAt[col] = blockNameAt(secByY[topY >> 4], x, topY & 15, z); }
    }
  }

  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const col = z * 16 + x;
      let c;
      if (solid[col]) {
        c = colorFor(nameAt[col], dim);
        const hl = x > 0 ? renderH[col - 1] : renderH[col];
        const hu = z > 0 ? renderH[col - 16] : renderH[col];
        const slope = (renderH[col] - hl) + (renderH[col] - hu);
        const f = slope > 0 ? 1.12 : slope < 0 ? 0.84 : 1;
        c = [clamp8(c[0] * f), clamp8(c[1] * f), clamp8(c[2] * f)];
      } else {
        c = colorFor(null, dim);
      }
      const p = col * 3;
      rgb[p] = c[0]; rgb[p + 1] = c[1]; rgb[p + 2] = c[2];
    }
  }
}

function readAll(dir, dim) {
  const rd = regionDir(dir, levelName(dir), dim);
  if (!rd) return { entries: [], bounds: null };
  const entries = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const header = Buffer.alloc(4096);
  for (const f of fs.readdirSync(rd)) {
    const m = f.match(/^r\.(-?\d+)\.(-?\d+)\.mca$/);
    if (!m) continue;
    const rx = parseInt(m[1], 10), rz = parseInt(m[2], 10);
    let fd;
    try {
      fd = fs.openSync(path.join(rd, f), "r");
      if (fs.readSync(fd, header, 0, 4096, 0) < 4096) continue;
      for (let i = 0; i < 1024; i++) {
        if (header.readUInt32BE(i * 4) === 0) continue;
        let chunk;
        try { chunk = readChunkNBT(fd, header, i); } catch { chunk = null; }
        if (!chunk) continue;
        const cx = rx * 32 + (i % 32), cz = rz * 32 + Math.floor(i / 32);
        entries.push({ x: cx, z: cz, chunk });
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cz < minZ) minZ = cz;
        if (cz > maxZ) maxZ = cz;
      }
    } catch {} finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    }
  }
  return { entries, bounds: entries.length ? { minX, maxX, minZ, maxZ } : null };
}

let cache = null;          // { key, entries, bounds, layers:Map, cap }
let preloadToken = 0;      // bumped to cancel an in-flight preload
let preloadTimer = null;

// Render one Y layer into packed typed arrays (coords + rgb pixels).
function renderLayer(dim, y) {
  const { entries, bounds } = cache;
  const count = entries.length;
  const coords = new Int32Array(count * 2);
  const pixels = new Uint8Array(count * 768);
  const tmp = Buffer.alloc(768);
  let n = 0;
  for (const e of entries) {
    try { chunkPixels(e.chunk, dim, y, tmp); } catch { continue; }
    coords[n * 2] = e.x; coords[n * 2 + 1] = e.z;
    pixels.set(tmp, n * 768);
    n++;
  }
  if (n < count) return { count: n, bounds, coords: coords.slice(0, n * 2), pixels: pixels.slice(0, n * 768) };
  return { count, bounds, coords, pixels };
}

function stopPreload() {
  preloadToken++;
  if (preloadTimer) { clearTimeout(preloadTimer); preloadTimer = null; }
}
// Resume preloading after a short idle gap so it never competes with a live request.
function queuePreload(dim) {
  if (preloadTimer) clearTimeout(preloadTimer);
  preloadTimer = setTimeout(() => runPreload(dim, ++preloadToken), 250);
}
function runPreload(dim, token) {
  if (!cache) return;
  const key = cache.key;
  const [lo, hi] = DIM_Y[dim] || [-64, 320];
  let y = hi;
  const step = () => {
    if (token !== preloadToken || !cache || cache.key !== key || cache.layers.size >= cache.cap) return;
    while (y >= lo) { const yk = y >= hi ? "s" : String(y); if (!cache.layers.has(yk)) break; y--; }
    if (y < lo) return;
    const yk = y >= hi ? "s" : String(y);
    cache.layers.set(yk, renderLayer(dim, y >= hi ? null : y));
    y--;
    setTimeout(step, 6); // setTimeout (not setImmediate) so incoming messages get through
  };
  setTimeout(step, 6);
}

parentPort.on("message", (msg) => {
  stopPreload(); // a request arrived — pause preloading so we answer it immediately
  const { reqId, dir, dim, y, useCache } = msg;
  try {
    const key = dir + ":" + dim;
    if (!useCache || !cache || cache.key !== key) {
      cache = { key, ...readAll(dir, dim), layers: new Map() };
      cache.cap = Math.max(24, Math.floor((240 * 1024 * 1024) / ((cache.entries.length * 768) || 1)));
    }
    const yk = y == null ? "s" : String(y);
    let res = cache.layers.get(yk);
    if (!res) {
      res = renderLayer(dim, y);
      if (cache.layers.size < cache.cap) cache.layers.set(yk, res);
    }
    parentPort.postMessage({ reqId, count: res.count, bounds: res.bounds, coords: res.coords, pixels: res.pixels });
  } catch (e) {
    parentPort.postMessage({ reqId, count: 0, bounds: null, coords: new Int32Array(0), pixels: new Uint8Array(0) });
  }
  queuePreload(dim);
});
