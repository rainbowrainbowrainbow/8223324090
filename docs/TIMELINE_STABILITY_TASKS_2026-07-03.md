# Timeline Stability Tasks - 2026-07-03

Production impact: yes.

## Bug Report

Symptom: the primary activity block in the timeline can show
`TL-BK-DETAIL-OK-OPEN-FAILED`, while the linked/additional host block opens the
canonical Ukrainian booking detail modal.

Expected behavior: both primary and additional activity blocks open the same
canonical `showBookingDetails(...)` modal, and optional banquet/package sections
cannot block the whole modal.

Actual behavior observed: the server returned a booking, but the current
frontend did not finish opening the modal for the primary block.

Likely causes:

- optional booking detail renderers can throw and abort canonical modal rendering;
- timeline/booking identity can drift between `linkedTo`, `lineId`,
  `resourceId`, and banquet snapshot source fields;
- previous recovery UI masked root cause instead of fixing the canonical path;
- release/cache drift can leave old and new timeline/booking assets mixed.

Verification plan:

- focused unit regression for primary activity opening;
- static guard for canonical booking detail ownership;
- protected block hashes for identity/projection/DB row mapping;
- live QA smoke with `codex.qa` on production after deploy.

## P0 - Stop Regressions Before Deploy

- Add `check:timeline-protected-surface` to the fast baseline.
- Protect canonical booking detail open path in `js/booking.js`.
- Protect timeline open diagnostics in `js/timeline.js`.
- Protect backend identity mapping in `routes/bookings.js` and
  `services/booking.js`.
- Forbid timeline-owned recovery detail UI.
- Keep regression coverage for primary activity safe-render failure.

Status: done locally. The guard is part of `npm test` through
`npm run check:timeline-protected-surface`.

## P1 - Live QA And Diagnostics

- Add a browser/API smoke that logs in as `codex.qa` without storing secrets in
  repo files.
- Verify primary activity, additional activity, banquet group, and room timeline
  opening on live/staging.
- Capture console warnings for `TL-BK-*` codes and map them to actionable causes.
- Add a post-deploy checklist for version smoke, timeline proof, and booking
  detail click smoke.

Status: API/assets smoke done locally and verified once against production
`0.77.111` for `BK-2026-0528` and `BK-2026-0529`. `npm run
smoke:timeline-detail -- <live-url>` covers read-only auth,
`/api/bookings/detail/:id`, and live `booking.js`/`timeline.js` markers without
storing secrets in the repository. Browser click automation is still a separate
follow-up because it needs a fresh authenticated browser session.

## P2 - Observability And Cleanup

- Add a structured frontend diagnostic endpoint or client-side diagnostics queue
  only after approving logging scope and data retention.
- Consolidate timeline/booking error code documentation.
- Add a read-only production data audit for broken `linkedTo`, missing
  `lineId/resourceId`, and stale banquet group links.
- Decide whether `codex.qa` remains as a permanent QA account or should be
  disabled after stabilization.

Status: pending.
