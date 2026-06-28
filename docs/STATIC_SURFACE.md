# Event Genix Static Surface Map

This document records the intended static HTML surface for Event Genix. The
machine-readable source is `config/staticSurface.js`; `npm run
check:static-surface` verifies that root HTML files, documented paths, and
`server.js` static routes stay aligned.

## Why This Exists

Root HTML pages are served both by explicit routes and by the broad root static
mount in `server.js`. That makes cleanup risky: a file can look unused while a
bookmark, sidebar link, iframe, or legacy redirect still depends on it.

The rule going forward is simple: a root HTML file is not allowed to exist
unless it is listed here and in `config/staticSurface.js`. If a new static page
is added, renamed, redirected, or removed, update the manifest, this document,
and focused tests in the same pack.

## Root HTML Pages

| File | Canonical Path | Owner | Status | Notes |
| --- | --- | --- | --- | --- |
| `analytics.html` | `/analytics` | analytics | canonical-page | Operational analytics dashboard. |
| `afisha.html` | `/afisha` | afisha | canonical-page | Standalone product page for Afisha events, import/export, recurring templates, and task generation. |
| `booking-summary.html` | `/booking-summary.html` | bookings | canonical-page | Printable banquet summary preview for booking details. |
| `art-director.html` | `/art` | art-director | canonical-page | Legacy `/art-director` and `/art-director.html` redirect to `/art`. |
| `center.html` | `/center` | center | canonical-page | Entertainment center operations page. |
| `chat.html` | `/chat` | chat | canonical-page | `/kleshnya` redirects to this messenger surface. |
| `chat-settings.html` | `/chat-settings` | chat | canonical-page | Dedicated Chat AI, Guardian, and integrations settings page. |
| `timeline-settings.html` | `/timeline-settings` | timeline | canonical-page | Dedicated timeline settings center for visibility, visual presets, and display modes. |
| `checkin.html` | `/checkin` | checkin | canonical-page | Staff check-in page. |
| `content.html` | `/content` | content | canonical-page | Content matrix page. |
| `copilot.html` | `/copilot` | copilot | canonical-page | Sales/copilot workspace. |
| `customers.html` | `/customers` | customers | canonical-page | Customer CRM page. |
| `dashboard.html` | `/dashboard` | dashboard | canonical-page | Authenticated dashboard page. |
| `demo.html` | `/demo` | demo | canonical-page | Demo mode page. |
| `designer.html` | `/designer` | designer | canonical-page | Designer production workspace. |
| `designs.html` | `/designs` | designs | canonical-page | Also served at `/embed/designs` for embedded art-director views. |
| `certificates.html` | `/certificates` | certificates | canonical-page | Also serves `/certificates/new` and `/certificates/batch` for standalone creation flows. |
| `finance.html` | `/finance` | finance | canonical-page | Finance operations page. |
| `game.html` | `/game` | game | canonical-page | Gamification game page. |
| `graduation.html` | `/graduation` | graduation | canonical-page | Also served at `/embed/graduation`. |
| `guardian-ops.html` | `/guardian-ops` | guardian | canonical-page | Guardian operations console. |
| `hr.html` | `/hr` | hr | canonical-page | HR operations page. |
| `index.html` | `/` | timeline | root-shell | Main CRM shell and final non-API fallback. |
| `invite.html` | `/invite` | invite | public-page | Invite/onboarding page. |
| `leads.html` | `/sales-funnel` | leads | canonical-page | `/leads` redirects to `/sales-funnel`. |
| `omni.html` | `/omni` | omnichannel | canonical-page | Omnichannel inbox page. |
| `profile.html` | `/profile` | profile | canonical-page | Gamification profile page. |
| `programs.html` | `/programs` | programs | canonical-page | Also served at `/embed/programs`. |
| `quiz.html` | `/quiz` | quiz | canonical-page | Quiz page. |
| `report-agent.html` | `/report-agent` | reports | canonical-page | Report agent page. |
| `reports.html` | `/reports` | reports | canonical-page | Reports page. |
| `room.html` | `/room` | room | canonical-page | Room page. |
| `shop.html` | `/shop` | shop | canonical-page | Gamification shop page. |
| `sound.html` | `/sound` | sound | canonical-page | Sound library page. |
| `staff.html` | `/staff` | staff | canonical-page | Staff operations page. |
| `status.html` | `/status` | status | canonical-page | Status page. |
| `tasks.html` | `/tasks` | tasks | canonical-page | Task management page. |
| `training.html` | `/training` | training | canonical-page | Training page. |
| `warehouse.html` | `/warehouse` | warehouse | canonical-page | Warehouse operations page. |

## Landing Pages

| File | Canonical Path | Owner | Status | Notes |
| --- | --- | --- | --- | --- |
| `landing/index.html` | `/landing` | landing | public-page | Public landing site root. |
| `landing/manager-guide.html` | `/landing/manager-guide.html` | landing | public-page | Legacy `/manager-guide` and `/manager-guide.html` redirect here. |
| `landing/sales-deck.html` | `/landing/sales-deck.html` | landing | public-page | Legacy `/sales-deck`, `/sales-deck.html`, and `/landing/sales-deck` resolve here. |

## Legacy Redirects And Modal Bridges

| Path | Target | Owner | Reason |
| --- | --- | --- | --- |
| `/art-director` | `/art` | art-director | Old art URL. |
| `/art-director.html` | `/art` | art-director | Old root HTML URL. |
| `/leads` | `/sales-funnel` | leads | Old sales funnel URL. |
| `/kleshnya` | `/chat` | chat | Assistant surface now lives in chat. |
| `/manager-guide` | `/landing/manager-guide.html` | landing | Public landing legacy URL. |
| `/manager-guide.html` | `/landing/manager-guide.html` | landing | Public landing legacy URL. |
| `/sales-deck` | `/landing/sales-deck.html` | landing | Public landing legacy URL. |
| `/sales-deck.html` | `/landing/sales-deck.html` | landing | Public landing legacy URL. |

## Exposure Classification

Static root files are not all equivalent:

- Public root page: `invite.html` at `/invite`.
- Root shell: `index.html` at `/`.
- Public landing files: `landing/index.html`, `landing/manager-guide.html`,
  and `landing/sales-deck.html`.
- Embedded aliases: `/embed/designs`, `/embed/programs`, and
  `/embed/graduation`.

All other root HTML pages are authenticated CRM surfaces and must be protected
through `PAGE_ACCESS` or a separate documented exception in
`docs/ACCESS_SURFACE.md`. Do not add a new public root page by only placing an
`.html` file in the repository root.

## Repository Source Guard

The broad root static mount must not expose repository source, config, scripts,
tests, generated QA output, internal docs, or package metadata. Keep
`middleware/staticDocGuard.js` in front of `express.static(...)` and cover this
with `tests/static-doc-guard.test.js`.

Allowed public static surfaces are the documented HTML pages, `landing/`,
`js/`, `css/`, `images/`, `assets/`, `sounds/`, `uploads/`, `favicon.ico`,
`logo.png`, and `manifest.json`. Internal paths such as `routes/`, `services/`,
`middleware/`, `db/`, `config/`, `scripts/`, `tests/`, `docs/`, `utils/`,
`lib/`, `data/`, `prompts/`, `output/`, `tmp/`, plus root `server.js`,
`swagger.js`, `package.json`, and `package-lock.json` must return 404 from the
static layer.

## Done Marker

This pack is considered done when all of these remain true:

- `npm run check:static-surface` passes.
- `npm run cleanup:inventory` shows only documented root HTML pages.
- Root markdown and repository source exposure remain limited by
  `tests/static-doc-guard.test.js`.
- Any future static page addition/removal updates `config/staticSurface.js`, this
  file, and focused tests in the same commit.
