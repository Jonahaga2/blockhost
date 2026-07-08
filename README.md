# BlockHost

A simple desktop app to host and manage **Minecraft servers** — download and run
servers, watch the live console, edit settings, back up your world, and let a
far‑away friend join. Built with Electron.

![status](https://img.shields.io/badge/platform-Windows-black)

## Features

- **Create servers** — Paper or Vanilla, any version, downloaded automatically
- **Import existing servers** — point BlockHost at a server folder you already have
- **Run for real** — start/stop, live console, and a command box with full
  Minecraft command autocomplete (type with or without a leading `/`)
- **Easy settings** — 35+ common `server.properties` options as friendly controls
- **File editor** — edit `server.properties`, `whitelist.json`, `ops.json`, etc.
- **Backups** — one‑click zip/restore of your worlds
- **Invite a friend** — a free [playit.gg](https://playit.gg) tunnel (no router setup),
  plus UPnP + manual port‑forward helpers and a reachability check
- **Bundled Java** — the packaged app ships with a Java runtime, so end users
  install nothing

## Run from source

```bash
npm install
npm start
```

Minecraft servers need **Java 17+** (the newest versions need **Java 25**). When
running from source, install [Temurin](https://adoptium.net/temurin/releases/) or
drop a JRE into `resources/jre/` (so `resources/jre/bin/java.exe` exists) and the
app will use it automatically.

## Build the Windows installer

```bash
npm run dist
```

This produces `dist/BlockHost Setup <version>.exe`, a one‑click installer with the
Java runtime bundled in. On Windows, run the build from an **Administrator**
terminal — electron‑builder needs elevated rights to unpack its signing tools.

## Project layout

```
src/main/       Electron main process (the engine)
  main.js       window + app lifecycle
  servers.js    start/stop servers, stream the console
  jars.js       download Paper/Vanilla jars (PaperMC Fill v3 + Mojang)
  java.js       locate Java (bundled JRE first)
  files.js      read/write server config files
  backup.js     zip/restore worlds
  network.js    public/local IP, UPnP, reachability
  tunnel.js     playit.gg tunnel
  store.js      persist the server list
  ipc.js        bridge to the UI
src/preload/    safe window.api bridge
src/renderer/   the UI (HTML/CSS/JS)
```

## License

MIT
