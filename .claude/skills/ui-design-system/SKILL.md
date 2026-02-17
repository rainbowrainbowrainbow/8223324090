---
name: ui-design-system
description: UI design system toolkit — design token generation, component documentation, responsive design calculations, and developer handoff tools. Use for creating design systems, maintaining visual consistency, and facilitating design-dev collaboration.
---

# UI Design System

Generate design tokens, create color palettes, calculate typography scales, build component systems, and prepare developer handoff documentation.

## Trigger Terms

Use this skill when you need to:
- "generate design tokens"
- "create color palette"
- "build typography scale"
- "calculate spacing system"
- "create design system"
- "generate CSS variables"
- "set up component architecture"
- "document component library"
- "calculate responsive breakpoints"
- "check WCAG contrast"
- "build 8pt grid system"

## Workflow 1: Generate Design Tokens

1. **Identify brand color and style**
   - Brand primary color (hex format)
   - Style preference: `modern` | `classic` | `playful`

2. **Review generated categories**
   - Colors: primary, secondary, neutral, semantic, surface
   - Typography: fontFamily, fontSize, fontWeight, lineHeight
   - Spacing: 8pt grid-based scale (0-64)
   - Borders: radius, width
   - Shadows: none through 2xl
   - Animation: duration, easing
   - Breakpoints: xs through 2xl

## Workflow 2: Create Component System

1. **Define component hierarchy**
   - Atoms: Button, Input, Icon, Label, Badge
   - Molecules: FormField, SearchBar, Card, ListItem
   - Organisms: Header, Footer, DataTable, Modal
   - Templates: DashboardLayout, AuthLayout

2. **Map tokens to components**

   | Component | Tokens Used |
   |-----------|-------------|
   | Button | colors, sizing, borders, shadows, typography |
   | Input | colors, sizing, borders, spacing |
   | Card | colors, borders, shadows, spacing |
   | Modal | colors, shadows, spacing, z-index, animation |

3. **Define variant patterns**

   Size variants:
   ```
   sm: height 32px, paddingX 12px, fontSize 14px
   md: height 40px, paddingX 16px, fontSize 16px
   lg: height 48px, paddingX 20px, fontSize 18px
   ```

## Workflow 3: Responsive Design

1. **Breakpoints**

   | Name | Width | Target |
   |------|-------|--------|
   | xs | 0 | Small phones |
   | sm | 480px | Large phones |
   | md | 640px | Tablets |
   | lg | 768px | Small laptops |
   | xl | 1024px | Desktops |
   | 2xl | 1280px | Large screens |

2. **Calculate fluid typography**

   Formula: `clamp(min, preferred, max)`
   ```css
   --fluid-h1: clamp(2rem, 1rem + 3.6vw, 4rem);
   --fluid-h2: clamp(1.75rem, 1rem + 2.3vw, 3rem);
   --fluid-h3: clamp(1.5rem, 1rem + 1.4vw, 2.25rem);
   --fluid-body: clamp(1rem, 0.95rem + 0.2vw, 1.125rem);
   ```

3. **Responsive spacing**

   | Token | Mobile | Tablet | Desktop |
   |-------|--------|--------|---------|
   | --space-md | 12px | 16px | 16px |
   | --space-lg | 16px | 24px | 32px |
   | --space-xl | 24px | 32px | 48px |

## Quick Reference: Color Scale

| Step | Brightness | Use Case |
|------|------------|----------|
| 50 | 95% | Subtle backgrounds |
| 100 | 90% | Light backgrounds |
| 200 | 80% | Hover states |
| 300 | 70% | Borders |
| 400 | 60% | Placeholder text |
| 500 | 50% | Primary color (base) |
| 600 | 40% | Hover on primary |
| 700 | 30% | Active states |
| 800 | 20% | Dark text |
| 900 | 10% | Darkest text |

## Quick Reference: Spacing Scale (8pt Grid)

| Token | px | rem | Usage |
|-------|----|-----|-------|
| 0 | 0 | 0 | None |
| 1 | 4 | 0.25 | Tight padding |
| 2 | 8 | 0.5 | Small gap |
| 3 | 12 | 0.75 | Input padding |
| 4 | 16 | 1 | Card padding |
| 6 | 24 | 1.5 | Section gap |
| 8 | 32 | 2 | Section padding |
| 12 | 48 | 3 | Large sections |
| 16 | 64 | 4 | Page sections |

## WCAG Contrast Requirements

| Level | Normal Text | Large Text |
|-------|------------|------------|
| AA | 4.5:1 | 3:1 |
| AAA | 7:1 | 4.5:1 |

## Project Context — Парк Закревського Періоду

Current design tokens are defined in `css/base.css`:
- Primary: #10B981 (emerald)
- Font: Nunito (400, 600, 700, 800, 900)
- Spacing: 4px based scale (4, 8, 12, 16, 24, 32, 48)
- Shadows: xs through xl + glow + primary
- Radii: xs(6), sm(8), base(12), lg(16), xl(20)
- Glass morphism: glass-bg, glass-border, glass-blur
