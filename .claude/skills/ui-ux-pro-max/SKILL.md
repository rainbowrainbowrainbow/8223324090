---
name: ui-ux-pro-max
description: AI-powered design intelligence for building professional UI/UX across multiple platforms
version: 2.0.0
source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
triggers:
  - UI design
  - UX design
  - landing page
  - dashboard
  - redesign
  - design system
  - color palette
  - typography
  - font pairing
  - web design
  - mobile design
  - component design
---

# UI UX Pro Max — Design Intelligence

Provide design intelligence for building professional UI/UX across multiple platforms and frameworks.

## Capabilities

- **67 UI Styles**: Glassmorphism, Neumorphism, Brutalism, AI-Native, Retro-Futuristic, etc.
- **96 Color Palettes**: Industry-specific options (SaaS, e-commerce, healthcare, fintech, etc.)
- **57 Font Pairings**: Curated typography combinations via Google Fonts
- **100 Reasoning Rules**: Industry-specific design system generation
- **13 Tech Stacks**: React, Vue, Next.js, Svelte, SwiftUI, React Native, Flutter, Shadcn, Tailwind, Jetpack Compose, etc.

## When to Use

Reference these guidelines when:
- Designing new UI components or pages
- Choosing color palettes and typography
- Reviewing code for UX issues
- Building landing pages, hero sections, or dashboards
- Implementing accessibility requirements
- Creating design systems for projects

## Workflow

When a user requests UI/UX work:

### Step 1: Identify Requirements
- **Product type**: SaaS, e-commerce, portfolio, blog, dashboard, etc.
- **Style keywords**: minimal, playful, professional, futuristic, etc.
- **Industry**: healthcare, fintech, gaming, education, etc.
- **Stack**: React, Vue, Next.js, or default to `html-tailwind`

### Step 2: Generate Design System
Start with comprehensive recommendations:

1. **Style Priority**: Select from 67 styles based on product type + industry
2. **Color Palette**: Pick from 96 industry-specific palettes
3. **Typography**: Choose from 57 font pairings
4. **Layout Pattern**: Grid, asymmetric, card-based, etc.
5. **Component Library**: Match to chosen stack

### Step 3: Implementation

Generate production-ready code with:
- Proper colors, fonts, spacing per design system
- Responsive layout (mobile-first)
- Accessibility (min 4.5:1 contrast ratio, visible focus rings, descriptive alt text, aria-labels, keyboard nav, form labels)
- Smooth transitions and micro-interactions
- Dark mode support where applicable

## Design System Persistence

Use `--persist` flag to save design decisions:
- Generates `MASTER.md` file with full design system
- Creates page-specific overrides under `design-system/pages/[page-name].md`
- Page-specific files are prioritized when they exist; otherwise Master rules apply

## Style Categories

### Trending Styles
| Style | Best For | Key Features |
|-------|----------|-------------|
| Glassmorphism | SaaS, dashboards | Frosted glass, transparency, depth |
| Neumorphism | Settings, controls | Soft shadows, raised/inset elements |
| Brutalism | Creative, portfolio | Raw typography, exposed structure |
| AI-Native | AI products, tech | Gradient mesh, data visualization |
| Minimalist Pro | Corporate, finance | Whitespace, precision, clarity |

### Color Palette Examples
| Industry | Primary | Secondary | Accent |
|----------|---------|-----------|--------|
| Healthcare | #0077B6 | #90E0EF | #FF6B6B |
| Fintech | #1A1A2E | #16213E | #0F3460 |
| E-commerce | #2D3436 | #636E72 | #E17055 |
| Education | #6C5CE7 | #A29BFE | #FD79A8 |
| Gaming | #0A0A0A | #1A1A2E | #E94560 |

### Typography Pairings
| Heading | Body | Style |
|---------|------|-------|
| Inter | System UI | Clean tech |
| Playfair Display | Source Sans Pro | Editorial |
| Space Grotesk | DM Sans | Modern SaaS |
| Clash Display | General Sans | Bold creative |
| Outfit | Plus Jakarta Sans | Friendly startup |

## Anti-Patterns to Avoid

- Generic purple/blue gradients without purpose
- Overusing border-radius on everything
- Default system fonts without consideration
- Cookie-cutter hero sections
- Ignoring mobile-first approach
- Low contrast text
- Missing hover/focus states
- Inconsistent spacing scale

## Accessibility Checklist

- [ ] Minimum 4.5:1 contrast ratio for text
- [ ] Visible focus rings for keyboard navigation
- [ ] Descriptive alt text for images
- [ ] Proper aria-labels for interactive elements
- [ ] Keyboard navigable interface
- [ ] Form labels associated with inputs
- [ ] Skip navigation link
- [ ] Semantic HTML structure

## Installation (Full Version)

For the complete skill with all 67 styles, 96 palettes, and 100 reasoning rules:

```bash
npm install -g uipro-cli
cd /path/to/your/project
uipro init --ai claude
```

Or install via Claude Code:
```bash
npx skills add https://github.com/nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max
```
