// App entry point: creates the window and wires up the engine.
const { app, BrowserWindow } = require("electron");
const path = require("path");
const ipc = require("./ipc");
const servers = require("./servers");
const tunnel = require("./tunnel");

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: "#08080a",
    autoHideMenuBar: true,
    title: "Host",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  ipc.register(win);
}

app.whenReady().then(createWindow);

let quitting = false;
// Give running servers a few seconds to save and shut down cleanly, then force-kill
// anything still alive so we never leave an orphaned server locking its world.
function shutdownThenQuit(e) {
  tunnel.stop();
  if (quitting || !servers.hasRunning()) return;
  e.preventDefault();
  quitting = true;
  servers.stopAll();
  setTimeout(() => { servers.killAll(); app.exit(0); }, 4000);
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", shutdownThenQuit);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
