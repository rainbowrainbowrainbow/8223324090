# Design Board Guidebook QA Report

Date: 2026-09-13
Branch: `codex/design-board-guidebook-release`
Scope: TASK 2 guidebook / Design Board presentation polish.

## Local Browser QA

Environment:

- Local static server: `http://127.0.0.1:4177`
- Browser automation: Playwright Chromium
- Auth mode: mocked local test user for `/designer.html`; static component render for the Design Board guidebook entry because the static server does not run the real Express auth/permission lifecycle.

Results:

| Area | Result |
| --- | --- |
| `/designer.html#guideline` | Opened the guidebook and rendered the guideline tab. |
| Tab click | `#brand` hash was written after clicking Brand Book. |
| Back navigation | Browser Back returned to `#guideline`. |
| Keyboard navigation | ArrowRight moved focus/active tab from guideline to brand. |
| Tab ARIA state | Active tab/panel set `aria-selected`, `tabIndex`, `hidden`, and `.active` consistently. |
| Copy actions | 10 `data-guide-copy` actions are present; unavailable clipboard state is handled in code. |
| Templates | 3 downloadable SVG template links exist and return 200 locally. |
| Design Board entry | Internal guidebook entry links to `/designer#styleguide`. |
| Mobile 390px dark theme | No horizontal overflow; template cards and download buttons remain readable. |
| Images | Broken images: 0. |
| JavaScript page errors | Page errors: 0. |

Screenshots captured locally:

- `output/playwright/designer-guidebook-light.png`
- `output/playwright/designer-guidebook-dark-mobile.png`
- `output/playwright/design-board-entry-light.png`

The screenshots are local QA artifacts and are intentionally not committed.

## Automated Verification

Passed:

- `npm run check:runtime`
- `node --test --experimental-test-isolation=none tests/designer-navigation.test.js tests/designs-page-ui.test.js tests/design-storage.test.js tests/design-material-storage-audit.test.js`
- `npm run check:access`
- `npm run check:static-surface`
- `npm run check:css-surface`
- `npm run check:storage-surface`
- `npm run check:theme-surface`
- `npm run test:ui`

## Production Comparison

Production was not modified in this task. Read-only comparison checked the currently deployed release:

- `/api/version`: `0.81.153`, release label `Рішення щодо legacy-матеріалів Design Board`
- Live branch: `codex/eventgenix-production`
- Live SHA: `4214598e263057b1cb1524d7fb84f328031d288d`
- `LIVE_SMOKE_PUBLIC_ONLY=true npm run smoke:live -- https://8223324090-production.up.railway.app`: passed
- `VERSION_SMOKE_EXPECT_COMMIT=4214598e263057b1cb1524d7fb84f328031d288d VERSION_SMOKE_EXPECT_BRANCH=codex/eventgenix-production npm run version:smoke -- https://8223324090-production.up.railway.app`: passed

This is a comparison against the current production baseline, not proof that this branch has been deployed.

## Notes

- Sidebar, permission grants, auth, API, database, billing, quotas, and dependency files were not changed.
- Missing legacy Design Board file bytes are still not faked in the UI.
- The three SVG templates are static demo files, not an online brand editor.
