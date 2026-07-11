package com.blockhost.hostpanel;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.util.List;

// Builds the chest-menu Host panel. A custom InventoryHolder lets the click
// listener recognise our menu without guessing from the title.
public final class PanelGui {

    // Marker so InventoryClickEvent can tell this menu apart from any other.
    public static final class Holder implements InventoryHolder {
        private Inventory inventory;
        void bind(Inventory inv) { this.inventory = inv; }
        @Override public Inventory getInventory() { return inventory; }
    }

    // Slot layout (single 27-slot chest).
    public static final int DAY = 10, NIGHT = 11, CLEAR = 12, RAIN = 13,
            SURVIVAL = 14, CREATIVE = 15, WHITELIST_ON = 19, WHITELIST_OFF = 20,
            BACKUP = 22, SHARE = 24;

    private PanelGui() {}

    public static void open(Player p, boolean connected) {
        Holder holder = new Holder();
        Inventory inv = Bukkit.createInventory(holder, 27, Component.text("Host panel").color(NamedTextColor.AQUA));
        holder.bind(inv);

        inv.setItem(DAY, item(Material.SUNFLOWER, NamedTextColor.YELLOW, "Set time: Day"));
        inv.setItem(NIGHT, item(Material.CLOCK, NamedTextColor.BLUE, "Set time: Night"));
        inv.setItem(CLEAR, item(Material.WHITE_STAINED_GLASS, NamedTextColor.AQUA, "Weather: Clear"));
        inv.setItem(RAIN, item(Material.WATER_BUCKET, NamedTextColor.DARK_AQUA, "Weather: Rain"));
        inv.setItem(SURVIVAL, item(Material.IRON_SWORD, NamedTextColor.WHITE, "Your gamemode: Survival"));
        inv.setItem(CREATIVE, item(Material.GRASS_BLOCK, NamedTextColor.GREEN, "Your gamemode: Creative"));
        inv.setItem(WHITELIST_ON, item(Material.OAK_DOOR, NamedTextColor.GOLD, "Whitelist: On"));
        inv.setItem(WHITELIST_OFF, item(Material.IRON_DOOR, NamedTextColor.GRAY, "Whitelist: Off"));

        if (connected) {
            inv.setItem(BACKUP, item(Material.ENDER_CHEST, NamedTextColor.LIGHT_PURPLE, "Back up the world now", "Saves a copy through BlockHost"));
            inv.setItem(SHARE, item(Material.PAPER, NamedTextColor.AQUA, "Show the connect address", "Public IP and port for friends"));
        } else {
            inv.setItem(BACKUP, item(Material.BARRIER, NamedTextColor.RED, "BlockHost not connected", "Open the BlockHost desktop app"));
        }

        p.openInventory(inv);
    }

    private static ItemStack item(Material mat, NamedTextColor color, String name, String... lore) {
        ItemStack stack = new ItemStack(mat);
        ItemMeta meta = stack.getItemMeta();
        meta.displayName(Component.text(name).color(color).decoration(TextDecoration.ITALIC, false));
        if (lore.length > 0) {
            Component[] lines = new Component[lore.length];
            for (int i = 0; i < lore.length; i++) {
                lines[i] = Component.text(lore[i]).color(NamedTextColor.GRAY).decoration(TextDecoration.ITALIC, false);
            }
            meta.lore(List.of(lines));
        }
        stack.setItemMeta(meta);
        return stack;
    }
}
