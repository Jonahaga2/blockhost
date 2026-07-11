package com.blockhost.hostpanel;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.logging.Logger;

// Reads blockhost.json, which BlockHost drops into the server folder on startup.
// It tells the plugin which server it is, how to reach the desktop app's local
// API, the secret token to authenticate with, and who the owner is.
public class Handshake {
    public long serverId;
    public String name = "";
    public String owner = "";
    public int apiPort = 0;
    public String token = "";

    public boolean connected() {
        return apiPort > 0 && token != null && !token.isEmpty();
    }

    // The server's working directory is its own folder, so blockhost.json sits at ".".
    static Handshake load(Logger log) {
        File f = new File("blockhost.json");
        if (!f.isFile()) return null;
        try {
            String s = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
            Handshake h = new Handshake();
            h.serverId = Json.num(s, "serverId");
            h.apiPort = (int) Json.num(s, "apiPort");
            h.token = orEmpty(Json.str(s, "token"));
            h.owner = orEmpty(Json.str(s, "owner"));
            h.name = orEmpty(Json.str(s, "name"));
            return h;
        } catch (Exception e) {
            if (log != null) log.warning("Couldn't read blockhost.json: " + e.getMessage());
            return null;
        }
    }

    private static String orEmpty(String v) { return v == null ? "" : v; }
}
