package com.example.questdiamonds;

import org.bukkit.Material;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.HashMap;
import java.util.HashSet;
import java.util.UUID;

public class QuestDiamonds extends JavaPlugin implements Listener, CommandExecutor {

    private FileConfiguration config;
    private int diamondsRequired;
    private int rewardXp;

    private final HashMap<UUID, Integer> playerDiamondCount = new HashMap<>();
    private final HashSet<UUID> playersOnQuest = new HashSet<>();

    @Override
    public void onEnable() {
        // Load configuration
        saveDefaultConfig();
        config = getConfig();
        diamondsRequired = config.getInt("diamondsRequired", 10);
        rewardXp = config.getInt("rewardXp", 100);

        // Register command
        this.getCommand("quest").setExecutor(this);

        // Register event listener
        getServer().getPluginManager().registerEvents(this, this);

        getLogger().info("QuestDiamonds plugin enabled!");
    }

    @Override
    public void onDisable() {
        getLogger().info("QuestDiamonds plugin disabled!");
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player)) {
            sender.sendMessage("This command can only be run by a player.");
            return true;
        }

        Player player = (Player) sender;
        UUID playerId = player.getUniqueId();

        if (args.length > 0) {
            if (args[0].equalsIgnoreCase("start")) {
                if (playersOnQuest.contains(playerId)) {
                    player.sendMessage("You are already on the quest! Current progress: " + playerDiamondCount.getOrDefault(playerId, 0) + "/" + diamondsRequired + " diamonds.");
                } else {
                    playersOnQuest.add(playerId);
                    playerDiamondCount.put(playerId, 0);
                    player.sendMessage("Quest started: Collect " + diamondsRequired + " diamonds!");
                }
                return true;
            } else if (args[0].equalsIgnoreCase("status")) {
                if (playersOnQuest.contains(playerId)) {
                    player.sendMessage("Quest status: " + playerDiamondCount.getOrDefault(playerId, 0) + "/" + diamondsRequired + " diamonds collected.");
                } else {
                    player.sendMessage("You are not currently on a quest. Type '/quest start' to begin.");
                }
                return true;
            }
        }

        player.sendMessage("Usage: /quest <start|status>");
        return true;
    }

    @EventHandler
    public void onBlockBreak(BlockBreakEvent event) {
        Player player = event.getPlayer();
        UUID playerId = player.getUniqueId();

        if (playersOnQuest.contains(playerId)) {
            if (event.getBlock().getType() == Material.DIAMOND_ORE || event.getBlock().getType() == Material.DEEPSLATE_DIAMOND_ORE) {
                int currentDiamonds = playerDiamondCount.getOrDefault(playerId, 0);
                currentDiamonds++;
                playerDiamondCount.put(playerId, currentDiamonds);
                player.sendMessage("Diamond collected! Progress: " + currentDiamonds + "/" + diamondsRequired);

                if (currentDiamonds >= diamondsRequired) {
                    player.sendMessage("Quest complete! You collected " + diamondsRequired + " diamonds.");
                    player.giveExp(rewardXp);
                    player.sendMessage("You received " + rewardXp + " XP!");
                    // Reset quest for the player
                    playersOnQuest.remove(playerId);
                    playerDiamondCount.remove(playerId);
                }
            }
        }
    }
}
