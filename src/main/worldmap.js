// Thin client for the map worker. All the heavy region-reading and rendering happens
// on a background thread (mapworker.js) so the UI never freezes.
const path = require("path");
const { Worker } = require("worker_threads");
const store = require("./store");

let worker = null;
let seq = 0;
const pending = new Map();

function ensureWorker() {
  if (worker) return;
  worker = new Worker(path.join(__dirname, "mapworker.js"));
  worker.on("message", (m) => {
    const resolve = pending.get(m.reqId);
    if (resolve) { pending.delete(m.reqId); resolve(m); }
  });
  worker.on("error", () => {
    for (const resolve of pending.values()) resolve({ count: 0, bounds: null, coords: new Int32Array(0), pixels: new Uint8Array(0) });
    pending.clear();
    worker = null; // let it respawn on the next request
  });
  worker.unref(); // don't keep the app alive just for the worker
}

function render(id, dim = "overworld", y = null, useCache = false) {
  ensureWorker();
  const dir = store.serverDir(id);
  return new Promise((resolve) => {
    const reqId = ++seq;
    pending.set(reqId, resolve);
    worker.postMessage({ reqId, dir, dim, y, useCache });
  });
}

module.exports = { render };
