# Project Skills Configuration

This project has custom Claude Code skills installed in `.claude/skills/`.

## Installed Skills

### Group 1: Nano Banana (Image Generation & Prompts)

#### `nano-banana-prompts-recommend`
- **What**: Recommends from 7000+ curated Nano Banana Pro image prompts
- **When**: User needs image prompts, thumbnails, avatars, social media visuals, illustrations
- **How to use**: Ask for image prompt recommendations, describe what image you need
- **Source**: [YouMind-OpenLab/nano-banana-pro-prompts-recommend-skill](https://github.com/YouMind-OpenLab/nano-banana-pro-prompts-recommend-skill)

#### `cc-nano-banana`
- **What**: Generates/edits images via Gemini CLI nano-banana extension
- **When**: User wants to actually generate or edit images
- **How to use**: `/generate`, `/edit`, `/restore`, `/icon`, `/diagram`, `/pattern`, `/story`
- **Requires**: Gemini CLI + GEMINI_API_KEY + nanobanana extension
- **Source**: [kkoppenhaver/cc-nano-banana](https://github.com/kkoppenhaver/cc-nano-banana)

#### Reference Libraries
- [awesome-nano-banana-pro-prompts](https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts) — 6000+ prompts with images
- [awesome-nanobanana-pro](https://github.com/ZeroLu/awesome-nanobanana-pro) — Curated styles & examples

### Group 2: UI/UX Design & Redesign

#### `ui-ux-pro-max`
- **What**: Design intelligence with 67 styles, 96 palettes, 57 font pairings
- **When**: Building landing pages, dashboards, UI components, or full redesigns
- **How to use**: Describe what you want to build, specify industry/style/stack
- **Source**: [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)

#### `frontend-design`
- **What**: Creates distinctive, production-grade frontend interfaces
- **When**: Implementing frontend code that needs to look genuinely designed (not generic)
- **How to use**: Ask to build/redesign any frontend component or page
- **Source**: [Anthropic official skill](https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design)

#### Skill Catalogs for More Skills
- [awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) — 200+ agent skills
- [awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) — Curated Claude skills collection
- [awesome-claude-skills (ComposioHQ)](https://github.com/ComposioHQ/awesome-claude-skills) — Skills + resources
