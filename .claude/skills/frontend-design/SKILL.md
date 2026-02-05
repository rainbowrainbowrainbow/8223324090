---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with exceptional design quality
version: 1.0.0
source: https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design
triggers:
  - frontend
  - website design
  - web page
  - hero section
  - landing page
  - component design
  - redesign website
  - UI implementation
  - CSS design
---

# Frontend Design — Distinctive Production-Grade Interfaces

Create distinctive, production-grade frontend interfaces. Commit to creative, polished code that avoids generic AI aesthetics.

## Core Philosophy

Bold maximalism and refined minimalism both work — the key is **intentionality, not intensity**.

Before writing any code, establish clear answers to:
- **Purpose**: What is this interface trying to achieve?
- **Tone**: What emotions should it evoke?
- **Constraints**: Technical limitations, brand guidelines, accessibility needs?
- **Differentiation**: What makes this feel unique rather than template-generated?

## Design Pillars

### 1. Typography
- Choose **distinctive, characterful fonts** — never fall back to defaults without reason
- Create clear hierarchy: display → heading → subheading → body → caption
- Explore variable fonts, custom letter-spacing, and fluid type scales
- Consider font personality: a fintech dashboard needs different type than a creative portfolio

### 2. Color
- Build a **cohesive color theme** with a dominant hue and sharp accents
- Avoid clichéd combinations (purple-to-blue gradient, etc.) unless contextually justified
- Use color to create depth: layered backgrounds, subtle tints for hierarchy
- Every color choice should be defensible — "it looks nice" isn't enough

### 3. Motion & Animation
- Add CSS animations and scroll-triggered effects that enhance storytelling
- Micro-interactions for buttons, inputs, cards — make the interface feel alive
- Stagger animations for lists and grids
- Use `prefers-reduced-motion` for accessibility

### 4. Spatial Composition
- Break free from predictable symmetric layouts when appropriate
- Use asymmetry, overlap, and grid-breaking elements intentionally
- Create visual tension and hierarchy through negative space
- Consider the viewport as a canvas, not just a container

### 5. Atmospheric Details
- Textures, grain, noise overlays for depth
- Layered backgrounds with subtle patterns
- Shadow systems that create realistic depth
- Glassmorphism, gradients, or flat — but always with purpose

## Anti-Patterns (What to Avoid)

- **Generic font stacks**: "Inter, system-ui, sans-serif" as an unconscious default
- **Purple gradient everything**: The telltale sign of AI-generated UI
- **Predictable layouts**: Same hero-features-testimonials-footer pattern
- **Cookie-cutter components**: Rounded rectangles with drop shadows everywhere
- **Missing context**: Design that could belong to any industry
- **Timid choices**: Being "safe" often means being forgettable

## Implementation Approach

Match implementation complexity to the aesthetic vision:

- **Maximalist designs** → elaborate CSS, multiple layers, rich animations
- **Minimalist designs** → precise typography, exact spacing, restraint in every detail
- **Brutalist designs** → raw elements, intentional roughness, exposed structure
- **Playful designs** → creative interactions, unexpected transitions, personality

## Output Standards

Every interface should:
1. **Feel genuinely designed** for its specific context
2. **Have a clear aesthetic direction** that's consistent throughout
3. **Include thoughtful details** that reward closer inspection
4. **Work responsively** across viewport sizes
5. **Be accessible** (WCAG AA minimum)
6. **Use semantic HTML** as foundation

## Process

1. **Understand** the context, audience, and purpose
2. **Choose** an aesthetic direction with conviction
3. **Design** the visual system (colors, type, spacing, motion)
4. **Build** with production-quality code
5. **Polish** with details, animations, and edge cases
6. **Validate** accessibility, responsiveness, and performance
