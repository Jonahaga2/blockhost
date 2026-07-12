package com.blockhost.hostmod.client;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.KeyMapping;
import org.lwjgl.glfw.GLFW;

// The "open the Host panel" key (default: G). Registered from HostMod on the mod bus.
public final class KeyBindings {
    public static final KeyMapping OPEN_PANEL = new KeyMapping(
            "key.hostpanel.open",
            InputConstants.Type.KEYSYM,
            GLFW.GLFW_KEY_G,
            KeyMapping.Category.MULTIPLAYER);

    private KeyBindings() {}
}
