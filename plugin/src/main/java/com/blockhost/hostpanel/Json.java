package com.blockhost.hostpanel;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

// Deliberately tiny JSON field reader. The bridge's responses and the handshake
// file are small, flat objects, so a full JSON library (and shading it into the
// jar) would be overkill. Only reads top-level string/number fields.
final class Json {
    private Json() {}

    static String str(String json, String key) {
        Matcher m = Pattern.compile("\"" + Pattern.quote(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"").matcher(json);
        return m.find() ? m.group(1).replace("\\\"", "\"").replace("\\\\", "\\") : null;
    }

    static long num(String json, String key) {
        Matcher m = Pattern.compile("\"" + Pattern.quote(key) + "\"\\s*:\\s*(-?\\d+)").matcher(json);
        return m.find() ? Long.parseLong(m.group(1)) : 0L;
    }
}
