package com.blockhost.hostpanel;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;

// Thin HTTP client for BlockHost's local bridge API. Uses only the JDK so the
// plugin jar stays dependency-free. Always call from an async task — never the
// main server thread.
public class BlockHostApi {
    private final Handshake hs;

    public BlockHostApi(Handshake hs) { this.hs = hs; }

    public static final class Result {
        public final int code;
        public final String body;
        Result(int code, String body) { this.code = code; this.body = body; }
        public boolean ok() { return code >= 200 && code < 300; }
    }

    public Result request(String method, String path) {
        HttpURLConnection c = null;
        try {
            URI uri = URI.create("http://127.0.0.1:" + hs.apiPort + path);
            c = (HttpURLConnection) uri.toURL().openConnection();
            c.setRequestMethod(method);
            c.setRequestProperty("Authorization", "Bearer " + hs.token);
            c.setConnectTimeout(4000);
            c.setReadTimeout(20000);
            if ("POST".equals(method)) {
                c.setDoOutput(true);
                c.getOutputStream().close();
            }
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String body = in == null ? "" : new String(in.readAllBytes(), StandardCharsets.UTF_8);
            return new Result(code, body);
        } catch (Exception e) {
            return new Result(0, e.getMessage() == null ? "connection failed" : e.getMessage());
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
