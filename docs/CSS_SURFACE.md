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
| `css/assistant-rail.css` | shared-crm-assistant | `shared` | active | Aggregate entrypoint for shared CRM assistant rail styles. |
| `css/assistant-rail-base.css` | shared-crm-assistant | `shared` | active | Base shared CRM assistant rail, state tokens, ticker, panel, voice controls, and responsive shell styles imported by `assistant-rail.css`. |
| `css/assistant-rail-command.css` | shared-crm-assistant | `shared-large` | active-large | Assistant cockpit, command bar, avatar button, and stable global docking styles imported by `assistant-rail.css`. |
| `css/assistant-rail-dashboard.css` | shared-crm-assistant | `shared` | active | Dashboard-scoped assistant shell repair styles imported by `assistant-rail.css`. |
| `css/assistant-rail-handoff.css` | shared-crm-assistant | `shared-large` | active-large | Legacy Claude Design handoff layers for assistant topbar and embedded panel parity imported by `assistant-rail.css`. |
| `css/assistant-rail-motion.css` | shared-crm-assistant | `shared-large` | active-large | Assistant motion spectrum, expandable stage, product topbar, and geometry guard styles imported by `assistant-rail.css`. |
| `css/assistant-rail-panel.css` | shared-crm-assistant | `shared-large` | active-large | Expanded assistant panel, action cards, teaching runner, voice comfort, and CRM chat bridge styles imported by `assistant-rail.css`. |
| `css/assistant-rail-presence.css` | shared-crm-assistant | `shared-large` | active-large | Assistant presence constellation, compact top assistant, avatar guard, and light window contrast styles imported by `assistant-rail.css`. |
| `css/assistant-rail-timeline.css` | shared-crm-assistant | `shared` | active | Timeline-specific assistant parity and dark composer contrast styles imported by `assistant-rail.css`. |
| `css/assistant-rail-topbar.css` | shared-crm-assistant | `shared-large` | active-large | Assistant top menu docking, readable animated output, full rethink, and mini-window styles imported by `assistant-rail.css`. |
| `css/base.css` | shared-ui | `shared` | active | Global variables, reset, typography, and shared primitives. |
| `css/catalog.css` | catalogs | `feature-shared` | active | Catalog viewer and print/public catalog styles used by designs and catalog routes. |
| `css/chat.css` | chat | `page-scoped` | active | Aggregate entrypoint for Team messenger styles. |
| `css/chat-core.css` | chat | `page-scoped-large` | active-large | Core Team messenger layout, sidebar, messages, panels, modals, and input styles imported by `chat.css`. |
| `css/chat-effects.css` | chat | `page-scoped-large` | active-large | Chat emoji, reaction, voice, pinned, avatar, and dino effect styles imported by `chat.css`. |
| `css/chat-guardian.css` | chat | `page-scoped` | active | Guardian bot, security panel, analytics, commands, and moderation styles imported by `chat.css`. |
| `css/chat-modern.css` | chat | `page-scoped` | active | Messenger improvement, sound settings, channel management, animated wallpaper, and supplemental chat styles imported by `chat.css`. |
| `css/chat-omni.css` | chat | `page-scoped` | active | Omni workspace rebuild and omnichannel health/account mode styles imported by `chat.css`. |
| `css/chat-polish.css` | chat | `page-scoped` | active | Chat dashboard-surface polish and adjacent override layer imported by `chat.css`. |
| `css/chat-settings.css` | chat | `page-scoped` | active | Chat settings control-plane and AI provider configuration styles imported by `chat.css`. |
| `css/content.css` | content | `page-scoped` | active | Content matrix page styles. |
| `css/controls.css` | shared-ui | `shared` | active | Shared form controls, buttons, and toolbar patterns. |
| `css/copilot.css` | copilot | `page-scoped` | active | Sales/copilot workspace styles. |
| `css/dark-mode.css` | shared-ui | `shared-large` | active-large | Shared dark-mode overrides across authenticated CRM pages. |
| `css/dashboard.css` | dashboard | `page-scoped` | active | Aggregate entrypoint for Dashboard page styles. |
| `css/dashboard-board.css` | dashboard | `page-scoped-large` | active-large | Dashboard whiteboard canvas, planner, geometry, connector, dark-mode, and compact tool dock styles imported by `dashboard.css`. |
| `css/dashboard-legacy.css` | dashboard | `page-scoped` | active | Dashboard devtools, legacy assistant fallback, and final patch styles imported by `dashboard.css`. |
| `css/dashboard-scene.css` | dashboard | `page-scoped` | active | Dashboard mixed-scene and writing-zone layout styles imported by `dashboard.css`. |
| `css/dashboard-settings.css` | dashboard | `page-scoped-large` | active-large | Dashboard settings modal, widget manager, task widget rows, and dark-mode settings styles imported by `dashboard.css`. |
| `css/dashboard-shell.css` | dashboard | `page-scoped-large` | active-large | Dashboard page shell, assistant fallback rail, role preview, action toolbar, and workspace controls imported by `dashboard.css`. |
| `css/dashboard-widgets.css` | dashboard | `page-scoped-large` | active-large | Dashboard widget grid, cards, task previews, booking, team, weather, currency, onboarding, and widget dark-mode styles imported by `dashboard.css`. |
| `css/dashboard-work-queue.css` | dashboard | `page-scoped-large` | active-large | Dashboard Work Queue triage, reply operations, buckets, bulk actions, and responsive queue styles imported by `dashboard.css`. |
| `css/decision-screen.css` | dashboard | `feature-shared` | active | Decision overlay styles mounted from the dashboard page. |
| `css/designs.css` | designs | `page-scoped` | active | Design catalog workspace styles. |
| `css/entity-card.css` | leads-customers | `feature-shared` | active | Shared lead/customer entity workspace card shell and safe visual contract. |
| `css/features.css` | timeline | `shell-large` | active-large | Root shell feature and modal adjunct styles; large-file consolidation candidate. |
| `css/graduation.css` | graduation | `page-scoped-large` | active-large | Graduation event builder and embedded view styles. |
| `css/hr-page.css` | hr | `page-scoped-large` | active-large | HR workspace styles extracted from `hr.html`; large-file consolidation candidate. |
| `css/kleshnya-widget.css` | kleshnya | `feature-shared` | active | Root shell Kleshnya widget styles. |
| `css/layout.css` | shared-ui | `shared-large` | active-large | Shared layout, sidebar, and content frame styles. |
| `css/sidebar-aurora.css` | shared-ui | `shared` | active | Sidebar Aurora aggregate entrypoint for shared CRM menu styles. |
| `css/sidebar-aurora-shell.css` | shared-ui | `shared-large` | active-large | Sidebar base shell, brand, quick counters, groups, and mobile rail styles imported by `sidebar-aurora.css`. |
| `css/sidebar-aurora-cockpit.css` | shared-ui | `shared` | active | Sidebar AI cockpit, focus deck, navigation group, and mobile base override styles imported by `sidebar-aurora.css`. |
| `css/sidebar-aurora-design-system.css` | shared-ui | `shared-large` | active-large | Sidebar Claude-design system layer, brand shell, design extras, and navigation restyle imported by `sidebar-aurora.css`. |
| `css/sidebar-aurora-today.css` | shared-ui | `shared` | active | Sidebar today dock, quick day menu, extra badges, and related responsive rules imported by `sidebar-aurora.css`. |
| `css/sidebar-aurora-legacy-shell.css` | shared-ui | `shared-large` | active-large | Legacy sidebar shell geometry, logo restoration, collapsed rail, profile typography, and Additional editor styles imported by `sidebar-aurora.css`. |
| `css/sidebar-aurora-compact.css` | shared-ui | `shared-large` | active-large | Compact sidebar density, laptop width, light theme, alert carousel, and collapse button styles imported by `sidebar-aurora.css`. |
| `css/sidebar-aurora-identity.css` | shared-ui | `shared-large` | active-large | Sidebar identity card, status rail, quick access submenu, and profile signal styles imported by `sidebar-aurora.css`. |
| `css/sidebar-aurora-enterprise.css` | shared-ui | `shared-large` | active-large | Enterprise sidebar redesign, passive time widgets, refreshed theme, and role identity styles imported by `sidebar-aurora.css`. |
| `css/sidebar-aurora-rail.css` | shared-ui | `shared` | active | Collapsed sidebar utility rail, contextual flyout, and compact business controls imported by `sidebar-aurora.css`. |
| `css/sidebar-aurora-rhythm.css` | shared-ui | `shared` | active | Sidebar rhythm, spacing, visual density, and nav readability polish imported by `sidebar-aurora.css`. |
| `css/sidebar-aurora-profile.css` | shared-ui | `shared-large` | active-large | Sidebar profile readability, mobile entry reliability, identity meta, and business selector polish imported by `sidebar-aurora.css`. |
| `css/sidebar-smart-menu.css` | shared-ui | `shared` | active | Optional smart sidebar menu customizer styles for compact dashboard shortcuts. |
| `css/minigame.css` | game | `page-scoped-large` | active-large | Gamification game styles; large-file consolidation candidate. |
| `css/modals.css` | shared-ui | `shared-large` | active-large | Shared modal and profile modal styles across CRM pages. |
| `css/pages.css` | shared-ui | `shared` | active | Aggregate entrypoint for shared static CRM page styles. |
| `css/pages-afisha.css` | shared-ui | `shared` | active | Afisha event workspace, material folder, event card, and dark-mode styles imported by `pages.css`. |
| `css/pages-analytics-vacancy.css` | shared-ui | `shared` | active | Analytics chart readout, HR vacancy workspace, and salary period picker styles imported by `pages.css`. |
| `css/pages-art.css` | shared-ui | `shared` | active | Art standalone shell, tabs, boards, kanban, recent work, and responsive styles imported by `pages.css`. |
| `css/pages-cabinet.css` | shared-ui | `shared-large` | active-large | Personal cabinet task composer, quick metrics, completion strips, task cards, subtasks, and dark-mode styles imported by `pages.css`. |
| `css/pages-certificates.css` | shared-ui | `shared` | active | Certificate page list, create flow, preview, filters, dark-mode, and responsive styles imported by `pages.css`. |
| `css/pages-customers.css` | shared-ui | `shared` | active | Customer detail hero, funnel stage, booking summary, Omni shortcut, dark-mode, and responsive styles imported by `pages.css`. |
| `css/pages-core.css` | shared-ui | `shared` | active | Shared page containers, headers, cards, buttons, tables, search, login, fatal error, and empty-state styles imported by `pages.css`. |
| `css/pages-leads.css` | shared-ui | `shared` | active | Sales funnel kanban stage hint controls and tooltip styles imported by `pages.css`. |
| `css/pages-hr-foundation.css` | shared-ui | `shared` | active | HR employee-card foundation, offboarding readiness, payroll hybrid config, role assignment, and dark-mode styles imported by `pages.css`. |
| `css/pages-hr-staff.css` | shared-ui | `shared-large` | active-large | HR payroll toolbar, staff pulse navigation, schedule replacement controls, HR team tabs, team filters, and onboarding assignment styles imported by `pages.css`. |
| `css/pages-task-taxonomy.css` | shared-ui | `shared` | active | Task print rules, taxonomy chips, operations summary, operational packs, and dark-mode taxonomy styles imported by `pages.css`. |
| `css/pages-tasks.css` | shared-ui | `shared-large` | active-large | Task cards, task action surfaces, filters, work rows, dark-mode task controls, and responsive task shell styles imported by `pages.css`. |
| `css/panel.css` | timeline | `shell` | active | Root shell side panel styles. |
| `css/responsive.css` | shared-ui | `shared` | active | Shared responsive overrides across authenticated CRM pages. |
| `css/sound.css` | sound | `page-scoped` | active | Sound library page styles. |
| `css/timeline.css` | timeline | `shell` | active | Root booking timeline styles. |
| `css/training.css` | training | `page-scoped` | active | Training workspace styles for materials, tests, progress, leaderboard, and onboarding. |
| `landing/style.css` | landing | `landing-scoped-large` | active-large | Public landing site styles outside the authenticated CRM CSS directory. |

## Service Worker App-Shell CSS

The Service Worker currently pre-caches this CSS subset from `sw.js`:

`css/base.css`, `css/auth.css`, `css/layout.css`, `css/sidebar-aurora.css`,
`css/sidebar-aurora-shell.css`, `css/sidebar-aurora-cockpit.css`,
`css/sidebar-aurora-design-system.css`, `css/sidebar-aurora-today.css`,
`css/sidebar-aurora-legacy-shell.css`, `css/sidebar-aurora-compact.css`,
`css/sidebar-aurora-identity.css`, `css/sidebar-aurora-enterprise.css`,
`css/sidebar-aurora-rail.css`, `css/sidebar-aurora-rhythm.css`,
`css/sidebar-aurora-profile.css`, `css/timeline.css`, `css/panel.css`,
`css/modals.css`, `css/controls.css`, `css/features.css`,
`css/dark-mode.css`, and `css/responsive.css`.

Changing that list is a cache behavior change. Update
`config/cssSurface.js`, this document, and focused verification in the same
commit.

## Current Large-File Candidates

The current high-value CSS consolidation candidates are `css/chat-core.css`,
`css/chat-effects.css`, `css/hr-page.css`, `landing/style.css`,
`css/features.css`, `css/dark-mode.css`, `css/pages-cabinet.css`,
`css/dashboard-board.css`, `css/minigame.css`, `css/modals.css`,
`css/layout.css`, `css/sidebar-aurora-enterprise.css`,
`css/sidebar-aurora-identity.css`, and `css/graduation.css`.

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
