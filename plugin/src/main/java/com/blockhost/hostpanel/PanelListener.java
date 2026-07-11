package com.blockhost.hostpanel;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.scheduler.BukkitRunnable;

import java.util.function.Consumer;

// Handles clicks inside the Host panel. Native actions run server commands
// directly; app-level actions (backup, share) call the BlockHost bridge async.
public class PanelListener implements Listener {
    private final HostPanelPlugin plugin;

    public PanelListener(HostPanelPlugin plugin) { this.plugin = plugin; }

    @EventHandler
    public void onClick(InventoryClickEvent e) {
        if (!(e.getInventory().getHolder() instanceof PanelGui.Holder)) return;
        e.setCancelled(true); // never let items be moved out of the menu
        if (!(e.getWhoClicked() instanceof Player p)) return;
        if (!plugin.isOwner(p)) return;

        switch (e.getRawSlot()) {
            case PanelGui.DAY -> { console("time set day"); tell(p, "Time set to day."); }
            case PanelGui.NIGHT -> { console("time set night"); tell(p, "Time set to night."); }
            case PanelGui.CLEAR -> { console("weather clear"); tell(p, "Weather cleared."); }
            case PanelGui.RAIN -> { console("weather rain"); tell(p, "Rain started."); }
            case PanelGui.SURVIVAL -> { p.setGameMode(GameMode.SURVIVAL); tell(p, "You are now in Survival."); }
            case PanelGui.CREATIVE -> { p.setGameMode(GameMode.CREATIVE); tell(p, "You are now in Creative."); }
            case PanelGui.WHITELIST_ON -> { console("whitelist on"); tell(p, "Whitelist turned on."); }
            case PanelGui.WHITELIST_OFF -> { console("whitelist off"); tell(p, "Whitelist turned off."); }
            case PanelGui.BACKUP -> backup(p);
            case PanelGui.SHARE -> share(p);
            default -> { }
        }
    }

    private void backup(Player p) {
        Handshake hs = plugin.handshake();
        if (hs == null || !hs.connected()) { tell(p, "BlockHost isn't connected — open the desktop app."); return; }
        p.closeInventory();
        tell(p, "Backing up the world… this can take a moment.");
        callApi("POST", "/servers/" + hs.serverId + "/backup", p, r -> {
            if (r.ok()) tell(p, "Backup saved.");
            else tell(p, "Backup failed (" + r.code + ").");
        });
    }

    private void share(Player p) {
        Handshake hs = plugin.handshake();
        if (hs == null || !hs.connected()) { tell(p, "BlockHost isn't connected — open the desktop app."); return; }
        callApi("GET", "/servers/" + hs.serverId + "/share", p, r -> {
            if (!r.ok()) { tell(p, "Couldn't fetch the address (" + r.code + ")."); return; }
            String ip = Json.str(r.body, "publicIp");
            long port = Json.num(r.body, "port");
            tell(p, "Connect address: " + (ip == null || ip.isEmpty() ? "your-ip" : ip) + ":" + port);
        });
    }

    private void console(String command) {
        Bukkit.dispatchCommand(Bukkit.getConsoleSender(), command);
    }

    private void tell(Player p, String message) {
        p.sendMessage(Component.text("[Host] ").color(NamedTextColor.GREEN)
                .append(Component.text(message).color(NamedTextColor.WHITE)));
    }

    // Run a bridge request off-thread, then deliver the result back on the main thread.
    private void callApi(String method, String path, Player p, Consumer<BlockHostApi.Result> onDone) {
        BlockHostApi api = new BlockHostApi(plugin.handshake());
        new BukkitRunnable() {
            @Override public void run() {
                BlockHostApi.Result result = api.request(method, path);
                new BukkitRunnable() {
                    @Override public void run() { if (p.isOnline()) onDone.accept(result); }
                }.runTask(plugin);
            }
        }.runTaskAsynchronously(plugin);
    }
}
