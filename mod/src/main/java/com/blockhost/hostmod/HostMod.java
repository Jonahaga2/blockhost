package com.blockhost.hostmod;

import com.blockhost.hostmod.client.HostScreen;
import com.blockhost.hostmod.client.KeyBindings;
import net.minecraft.client.Minecraft;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;
import net.neoforged.neoforge.common.NeoForge;

// Client-only mod: an in-game admin panel the server owner opens with a keybind (G).
// Listeners are registered programmatically so we're explicit about which bus each
// event belongs to (key mappings on the mod bus, ticks on the game bus).
@Mod(value = HostMod.MODID, dist = Dist.CLIENT)
public class HostMod {
    public static final String MODID = "hostpanel";

    public HostMod(IEventBus modBus) {
        modBus.addListener(this::onRegisterKeyMappings);
        NeoForge.EVENT_BUS.addListener(this::onClientTick);
    }

    private void onRegisterKeyMappings(RegisterKeyMappingsEvent event) {
        event.register(KeyBindings.OPEN_PANEL);
    }

    private void onClientTick(ClientTickEvent.Post event) {
        while (KeyBindings.OPEN_PANEL.consumeClick()) {
            Minecraft mc = Minecraft.getInstance();
            // Only open in-world, and don't stack on top of another screen.
            if (mc.player != null && mc.screen == null) {
                mc.setScreen(new HostScreen());
            }
        }
    }
}
