# QuestDiamonds Minecraft Plugin

QuestDiamonds is a simple Spigot plugin for Minecraft that introduces a quest to collect diamonds.

## Features

- Start a quest to collect a configurable number of diamonds.
- Track your quest progress.
- Receive an XP reward upon quest completion.

## How to Build

To build the plugin, you need Apache Maven installed.
Navigate to the project's root directory and run the following command:

```bash
mvn package
```
This will generate a `QuestDiamonds-0.1.0.jar` file in the `target` directory.

## How to Install

1.  Place the generated `QuestDiamonds-0.1.0.jar` file into the `plugins/` folder of your Spigot server.
2.  Restart or reload your server.

## Commands

-   `/quest start`: Starts the diamond collection quest for the player.
-   `/quest status`: Shows the player their current progress in the diamond collection quest.

## Configuration

The quest parameters can be configured in the `config.yml` file located in `plugins/QuestDiamonds/config.yml` after the first run:

-   `diamondsRequired`: The number of diamonds a player needs to collect (default: 10).
-   `rewardXp`: The amount of XP awarded upon quest completion (default: 100).
