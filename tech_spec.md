# Technical Design Document

## 1. Prevent Text Clipping
- **Issue**: UI elements use fixed-width fields, so long names or localized strings overflow or get cut off.
- **Solution**: Calculate available width dynamically based on terminal size. Truncate with ellipsis only when needed and support multi-line wrapping.
- **Metrics**: Support terminal widths from 80 to 120 columns.

## 2. Skill Screen Redesign
- **Layout**: Display skills as a scrollable list. Each entry shows name, cost, and rarity. Selecting a skill opens a pop-up with full description, advantages, and disadvantages.
- **Navigation**: Arrow keys or numbers to scroll; page indicators for more than 5 skills.

## 3. Random Skill Generation
- **Rarity Tiers**: common (40%), uncommon (30%), rare (20%), epic (8%), legendary (2%).
- **Algorithm**: Weighted random choice on level-up. Ensure at least one skill of player's current tier or below appears among the three options.

## 4. Map Structure
- 7 normal battles, 2 boss fights, 2 treasure rooms.
- Battles arranged along a path with optional side nodes for events.

## 5. Branching Routes
- At least 3 forks with unique events: ambushes, hidden caches, or mini‑quests.
- Each branch recombines into the main route after 1–2 nodes.

## 6. New Enemy Types
1. **Shadow Cat** – agile, dodges 30% of attacks; medium HP.
2. **Clockwork Kitten** – mechanical, resists magic; low HP but high defense.
3. **Arcane Lynx** – casts spells, moderate damage; weak to physical attacks.
4. **Necro Purr** – summons minions; slow but durable.
5. **Royal Tiger Guard** – elite enemy before final boss; high attack and defense.

## 8. Artifact Chest Examples
1. **Ring of Nine Lives** – survive lethal hit once per combat.
2. **Boots of Silent Paws** – +15% dodge.
3. **Whisker Wand** – spells cost 10% less mana.
4. **Cloak of Catnip** – enemies focus user less but defense −5.
5. **Tailwind Charm** – act first each turn; speed +20%.
6. **Purrfect Amulet** – heal 2 HP each turn.
7. **Feral Claw** – attack +5 but defense −2.
8. **Gemmed Collar** – +20% gold from battles.
9. **Spectral Bell** – reveal hidden traps on map.
10. **Moonlit Tiara** – boosts magic by 8 but reduces physical attack by 3.


