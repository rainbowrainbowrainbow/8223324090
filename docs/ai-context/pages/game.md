# Page: Game

## Route / Location

- Route: `/game`
- Static file: `game.html`
- Backend routes: `routes/gamification.js`, `routes/minigame.js`
- Related navigation item: System group -> `Гра`

## Purpose

Game is the gamification/minigame page for coins, achievements, challenges, teams, shop links, and playful CRM progression.

## Primary Entities

- Achievement
- Coin transaction
- Challenge
- Team
- Minigame session

## Visible UI

- Gamification/game interface.
- Achievement/progress/shop surfaces where linked.

## Available User Actions

- View/play game-related functionality.
- Interact with gamification rewards where exposed.

## Data Sources

- `routes/gamification.js`
- `routes/minigame.js`
- `routes/achievements.js`

## Related Files

- `game.html`
- `routes/gamification.js`
- `routes/minigame.js`

## Assistant Context

On Game, interpret questions through gamification, achievements, coins, and challenges, not operational task execution unless explicitly linked.
