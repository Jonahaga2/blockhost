package com.blockhost.hostmod.client;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

// The in-game admin panel. Each button runs a server command as the player, so it
// works for whatever the player is allowed to do (i.e. an operator/server owner).
// Rendering is left to the base Screen — the buttons are added as renderable widgets.
public class HostScreen extends Screen {
    private static final int BTN_W = 220;
    private static final int BTN_H = 20;
    private static final int GAP = 24;

    public HostScreen() {
        super(Component.literal("Host panel"));
    }

    @Override
    protected void init() {
        int x = this.width / 2 - BTN_W / 2;
        int y = 40;
        y = addAction(x, y, "Set time: Day", "time set day");
        y = addAction(x, y, "Set time: Night", "time set night");
        y = addAction(x, y, "Weather: Clear", "weather clear");
        y = addAction(x, y, "Weather: Rain", "weather rain");
        y = addAction(x, y, "Your gamemode: Creative", "gamemode creative");
        y = addAction(x, y, "Your gamemode: Survival", "gamemode survival");
        y = addAction(x, y, "Whitelist: On", "whitelist on");
        y = addAction(x, y, "Whitelist: Off", "whitelist off");

        this.addRenderableWidget(Button.builder(Component.literal("Close"), b -> this.onClose())
                .bounds(x, y + 8, BTN_W, BTN_H).build());
    }

    private int addAction(int x, int y, String label, String command) {
        this.addRenderableWidget(Button.builder(Component.literal(label), b -> runCommand(command))
                .bounds(x, y, BTN_W, BTN_H).build());
        return y + GAP;
    }

    private void runCommand(String command) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player != null && mc.player.connection != null) {
            mc.player.connection.sendCommand(command); // command without the leading slash
        }
        this.onClose();
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
