package com.blockhost.hostpanel;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

// Entry point. Loads the BlockHost handshake, registers the click listener, and
// serves the /host command (owner-only).
public class HostPanelPlugin extends JavaPlugin {
    private Handshake handshake;

    @Override
    public void onEnable() {
        handshake = Handshake.load(getLogger());
        getServer().getPluginManager().registerEvents(new PanelListener(this), this);
        getLogger().info(handshake != null
                ? "Host panel ready — connected to BlockHost (owner: " + (handshake.owner.isEmpty() ? "unset" : handshake.owner) + ")"
                : "Host panel ready — BlockHost not detected (app-level actions disabled)");
    }

    public Handshake handshake() { return handshake; }

    // True if this player is the configured owner; falls back to op status when no
    // owner is set (e.g. the server wasn't launched by BlockHost).
    public boolean isOwner(Player p) {
        if (handshake != null && handshake.owner != null && !handshake.owner.isEmpty()) {
            return p.getName().equalsIgnoreCase(handshake.owner);
        }
        return p.isOp();
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player p)) {
            sender.sendMessage("Only a player can open the Host panel.");
            return true;
        }
        if (!isOwner(p)) {
            p.sendMessage(Component.text("Only the server owner can open the Host panel.").color(NamedTextColor.RED));
            return true;
        }
        PanelGui.open(p, handshake != null && handshake.connected());
        return true;
    }
}
