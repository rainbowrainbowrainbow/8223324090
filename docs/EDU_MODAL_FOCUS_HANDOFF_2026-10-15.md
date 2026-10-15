# Shared modal focus release — 2026-10-15

Production impact: yes.

## Base and reproduced defect

Verified live and remote production: v0.82.95,
`6de1d0344e5d0e00318a86dcfd8d775133793b70`,
`codex/eventgenix-production`. Exact-SHA CI 38715284868 passed all 23 jobs.
Railway target: fortunate-appreciation / production / 8223324090.

The owner asked to continue the scoped focus fix after a fresh status review.
The old October 9 release block is expired and is not reused. The same isolated
worktree now uses branch `codex/edu-modal-release-20261015` from the verified
production SHA. The old branch, evidence, QA worktrees and dirty main checkout
are preserved.

Symptom: Tab navigation misses the native collapsed actions summary; hidden
nested details content is classified incorrectly; Tab escapes a dialog with no
controls. Expected behavior is to trap focus on the actual visible native
controls, or retain focus on the dialog content when there are none.

The seven focused regressions reproduced **4 PASS / 3 FAIL** on the fresh base.
The public live `js/ui.js` matched the exact production Git source during the
status review. Initial failures remain in `output/edu-focus-release-20261015/`.

## Scoped implementation

- `js/ui.js`: include native summaries, check all collapsed details ancestors,
  use the same visibility classification for preferred focus, and prevent Tab
  escape when the dialog has no controls.
- `tests/booking-detail-modal-keyboard.test.js`: seven canonical/shared focus
  regressions, registered in the existing package unit gate.
- `tests/browser/education-modal-actual-app-browser-smoke.js`: native closed/open
  actions, empty dialog, Today/day/week/Park, Escape,
  close-button focus return, native tab selection and light/dark viewport checks.
  Synthetic teacher setup uses the existing teacher API; navigation waits for
  terminal runtime reads using the current education harness pattern.
  Theme checks use the real header toggle, including its native color-scheme
  update. Direct CSS-only theme simulation produced misleading native controls;
  its diagnostic screenshots and first-run logs are preserved separately.
- `docs/EDU_MODAL_FOCUS_RELEASE_NOTES_20261015.json`: signed Ukrainian release
  notes for the canonical release controller.

No booking renderer, identity field, API contract, protected source/manifest,
auth/permission, dependency, schema, provider or production setting is changed.

## Verification and delivery gates

Node 22.23.1 / npm 10.9.8. Existing locked packages installed with
`npm ci --ignore-scripts --no-audit --no-fund`; no dependency/lockfile change.
Five focused modal/unsaved-change/timeline suites: **220 PASS, 0 FAIL**.
Protected surface: **PASS**, all six protected blocks unchanged.

Actual-app browser runs use the installed Playwright 1.64 Chromium/WebKit and
only the task-owned disposable loopback PostgreSQL. Production business writes
are not part of this release. Full baseline, exact-SHA CI, manual helper deploy,
version proof and read-only live checks remain required before completion.

The new bounded production block must name the exact functional SHA, fixed
branch/service, next free patch, generated-release-only descendant rule, no
migrations or production QA fixtures, at most three attempts and a maximum
three-hour window. Stop on drift or any new protected requirement. Rollback
reference is the verified v0.82.95 SHA above, through the documented helper.

Final receipts belong in `output/edu-focus-release-20261015/`: block manifest,
CI/deploy/version identity and read-only QA. Do not label pending gates PASS.

## Remaining boundaries

The physical-device / VoiceOver / TalkBack matrix remains owner-deferred; browser
emulation does not close it. This patch does not add server idempotency for
independent group POSTs. Canonical booking interactions are tested on disposable
data; production verification remains read only.

## Final local preflight

The final actual-app Chromium and WebKit runs both passed with real theme-toggle
interactions and unchanged keyboard/layout assertions. Logs:
`modal-chromium-final.log`, `modal-webkit-final.log`. The initial CSS-only theme
runs are historical; their screenshots are retained under
`output/playwright/edu-focus-release-20261015/theme-diagnostic-before/`.

Personally reviewed four final synthetic frames: Chromium desktop/light and
phone/dark, WebKit desktop/dark and phone/light. Native field palettes now match
the selected application theme; tab labels, focus outlines and viewport layout
remain usable. The remaining four frames have automated checks only. No live
screenshots or customer data were captured.

Local preflight is complete. Full repository validation and deployment evidence
will be recorded by the bounded production controller and companion release
receipts; they are not claimed here before execution.
