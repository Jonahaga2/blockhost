// Helps friends connect: public/local IP, UPnP port-forwarding, and a real
// Minecraft reachability check via mcsrvstat.us.
const os = require("os");
const natUpnp = require("nat-upnp");

function localIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

function gatewayGuess() {
  // Best-effort: routers are almost always the .1 of your subnet.
  const ip = localIp();
  const parts = ip.split(".");
  parts[3] = "1";
  return parts.join(".");
}

async function publicIp() {
  try {
    const r = await fetch("https://api.ipify.org?format=json");
    const d = await r.json();
    return d.ip;
  } catch {
    return null;
  }
}

async function info() {
  const [pub] = await Promise.all([publicIp()]);
  return { publicIp: pub, localIp: localIp(), gateway: gatewayGuess() };
}

function upnp(action, port) {
  return new Promise((resolve) => {
    const client = natUpnp.createClient();
    const done = (ok, msg) => {
      try { client.close(); } catch {}
      resolve({ ok, msg });
    };
    if (action === "open") {
      client.portMapping(
        { public: port, private: port, ttl: 0, protocol: "TCP", description: "BlockHost Minecraft" },
        (err) => (err ? done(false, "Your router refused automatic setup (UPnP may be off).") : done(true, "Port opened automatically.")),
      );
    } else {
      client.portUnmapping({ public: port, protocol: "TCP" }, (err) =>
        err ? done(false, err.message) : done(true, "Port closed."),
      );
    }
  });
}

async function reachable(host, port) {
  // mcsrvstat.us actually pings the Minecraft server from the outside world.
  try {
    const r = await fetch(`https://api.mcsrvstat.us/3/${host}:${port}`, {
      headers: { "User-Agent": "BlockHost/0.1" },
    });
    const d = await r.json();
    return { online: !!d.online };
  } catch {
    return { online: false, error: true };
  }
}

module.exports = { info, upnp, reachable };
