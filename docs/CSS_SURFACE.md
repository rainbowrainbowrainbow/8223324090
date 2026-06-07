# Event Genix CSS Surface Map

This document records the intended CSS ownership surface for Event Genix. The
machine-readable source is `config/cssSurface.js`; `scripts/check-css-surface.js`
runs `npm run check:css-surface` and verifies that CSS files, runtime
references, this document, and Service Worker app-shell CSS precache entries
stay aligned.

## Why This Exists

The static frontend has shared CSS, page-scoped CSS, root-shell CSS, and public
landing CSS. Broad consolidation without ownership can break pages that are
served directly, embedded, redirected, or cached by the Service Worker.

The rule going forward is simple: a CSS file under `css/` or `landing/` is not
allowed to exist unless it is listed here and in `config/cssSurface.js`. Any
future CSS split, removal, rename, or consolidation must update the manifest,
this document, and `npm run test:ui` coverage in the same pack.

## CSS Files

| File | Owner | Category | Status | Notes |
| --- | --- | --- | --- | --- |
| `css/achievements.css` | shop | `page-scoped` | active | Gamification achievements and shop presentation styles. |
| `css/agents.css` | chat | `page-scoped` | active | Chat assistant and agent panel styles. |
| `css/auth.css` | shared-auth | `shared` | active | Login and authentication shell styles used by root, dashboard, and sound pages. |
| `css/assistant-rail.css` | shared-crm-assistant | `shared` | active | Shared global CRM assistant rail, proactive help panel, voice controls, and dark/mobile states. |
| `css/base.css` | shared-ui | `shared` | active | Global variables, reset, typography, and shared primitives. |
| `css/catalog.css` | catalogs | `feature-shared` | active | Catalog viewer and print/public catalog styles used by designs and catalog routes. |
| `css/chat.css` | chat | `page-scoped-large` | active-large | Main chat page styles; large-file consolidation candidate. |
| `css/content.css` | content | `page-scoped` | active | Content matrix page styles. |
| `css/controls.css` | shared-ui | `shared` | active | Shared form controls, buttons, and toolbar patterns. |
| `css/copilot.css` | copilot | `page-scoped` | active | Sales/copilot workspace styles. |
| `css/dark-mode.css` | shared-ui | `shared-large` | active-large | Shared dark-mode overrides across authenticated CRM pages. |
| `css/dashboard.css` | dashboard | `page-scoped` | active | Dashboard widget and onboarding styles. |
| `css/decision-screen.css` | dashboard | `feature-shared` | active | Decision overlay styles mounted from the dashboard page. |
| `css/designs.css` | designs | `page-scoped` | active | Design catalog workspace styles. |
| `css/entity-card.css` | leads-customers | `feature-shared` | active | Shared lead/customer entity workspace card shell and safe visual contract. |
| `css/features.css` | timeline | `shell-large` | active-large | Root shell feature and modal adjunct styles; large-file consolidation candidate. |
| `css/graduation.css` | graduation | `page-scoped-large` | active-large | Graduation event builder and embedded view styles. |
| `css/hr-page.css` | hr | `page-scoped-large` | active-large | HR workspace styles extracted from `hr.html`; large-file consolidation candidate. |
| `css/kleshnya-widget.css` | kleshnya | `feature-shared` | active | Root shell Kleshnya widget styles. |
| `css/layout.css` | shared-ui | `shared-large` | active-large | Shared layout, sidebar, and content frame styles. |
| `css/sidebar-aurora.css` | shared-ui | `shared` | active | Sidebar Aurora visual layer and dual-theme micro-interactions for the shared CRM menu. |
| `css/sidebar-smart-menu.css` | shared-ui | `shared` | active | Optional smart sidebar menu customizer styles for compact dashboard shortcuts. |
| `css/minigame.css` | game | `page-scoped-large` | active-large | Gamification game styles; large-file consolidation candidate. |
| `css/modals.css` | shared-ui | `shared-large` | active-large | Shared modal and profile modal styles across CRM pages. |
| `css/pages.css` | shared-ui | `shared` | active | Shared page-level layout helpers for static CRM pages. |
| `css/panel.css` | timeline | `shell` | active | Root shell side panel styles. |
| `css/responsive.css` | shared-ui | `shared` | active | Shared responsive overrides across authenticated CRM pages. |
| `css/sound.css` | sound | `page-scoped` | active | Sound library page styles. |
| `css/timeline.css` | timeline | `shell` | active | Root booking timeline styles. |
| `css/training.css` | training | `page-scoped` | active | Training workspace styles for materials, tests, progress, leaderboard, and onboarding. |
| `landing/style.css` | landing | `landing-scoped-large` | active-large | Public landing site styles outside the authenticated CRM CSS directory. |

## Service Worker App-Shell CSS

The Service Worker currently pre-caches this CSS subset from `sw.js`:

`css/base.css`, `css/auth.css`, `css/layout.css`, `css/sidebar-aurora.css`,
`css/timeline.css`, `css/panel.css`, `css/modals.css`, `css/controls.css`,
`css/features.css`, `css/dark-mode.css`, and `css/responsive.css`.

Changing that list is a cache behavior change. Update
`config/cssSurface.js`, this document, and focused verification in the same
commit.

## Current Large-File Candidates

The current high-value CSS consolidation candidates are `css/chat.css`,
`css/hr-page.css`, `landing/style.css`, `css/features.css`, `css/dark-mode.css`,
`css/minigame.css`, `css/modals.css`, `css/layout.css`, and
`css/graduation.css`.

Do not start with a broad reformat. Prefer page-scoped extraction or removal
with `npm run check:css-surface`, `npm run test:ui`, and browser smoke for the
touched page.

## Done Marker

This pack is considered done when all of these remain true:

- `npm run check:css-surface` passes.
- `npm test` includes `npm run check:css-surface`.
- `npm run test:ui` remains green after CSS ownership changes.
- New, renamed, or removed CSS files update `config/cssSurface.js`,
  `docs/CSS_SURFACE.md`, HTML/runtime references, and focused UI verification
  in the same commit.
