# Focused Regression QA Matrix - 2026-06-24

Production impact: yes.

Branch: `codex/timeline-leads-hardening`
Version checked: `0.77.15 - Timeline Banquet Inspector Activity Fix`
Runtime checked: Node `22.23.0` / npm `10.9.8`

## Automated Verification

| Check | Result |
| --- | --- |
| `npm run check:runtime` | Pass |
| `npm run check:version` | Pass |
| `npm run test:ui` | Pass - `1033/1033` checks |
| `npm test` | Pass - `1059/1059` unit checks and `1033/1033` UI checks |

## Regression Matrix

| Area | Scenario | Status | Evidence | Manual/live gap |
| --- | --- | --- | --- | --- |
| Logout shell | Logout from timeline/customers/leads/profile must not leave partial UI, `page-exiting`, or broken login shell. | Automated pass | `tests/auth-frontend-session.test.js` covers `showLoginScreen` cleanup, sub-page redirect cleanup, and logout stable visual state. `npm test` passed. | Needs browser check on live/staging for the four pages after deploy. |
| Service worker cleanup | Logout/account switch must clear private API cache and legacy offline DB. | Automated pass | `tests/service-worker-policy.test.js` covers `CLEAR_PRIVATE_CACHES`, API cache namespace cleanup, and `park-offline` deletion. `npm test` passed. | Needs browser DevTools/cache confirmation only if service worker behavior looks stale on live. |
| Banquet timeline | Banquet with kitchen/food marker and activity must keep activity visible. | Automated pass | `tests/timeline-resources.test.js` covers activity-first primary animation beside kitchen service marker and overlapping markers. `npm test` passed. | Needs live/staging create/open check with real banquet data after deploy. |
| Mini banquet inspector | Inspector must show activity count/list when activity exists. | Automated pass | `tests/timeline-resources.test.js` asserts `activityCount` for primary activity and multiple activities with kitchen marker. `npm test` passed. | Needs live/staging click-through on the exact UI panel after deploy. |
| Timeline rooms/animators switch | Switching rooms/animators must not hide rows or pollute cache. | Automated pass | `tests/timeline-lifecycle.test.js`, `tests/timeline-resources.test.js`, and `tests/timeline-regression-matrix.test.js` cover view switch, room-only previews, matching, and cache isolation. `npm test` passed. | Needs live/staging role-based smoke if animator permissions changed. |
| Customer children | Customer with 0/1/3 children must persist and display without truncation. | Automated pass | `tests/customer-children.test.js`, `tests/customer-birthday-tags.test.js`, `tests/sales-funnel.test.js`, `tests/operations-flow-v2.test.js`, and `npm test` passed. Existing manual harness notes live in `docs/CUSTOMER_CHILDREN_MANUAL_QA_2026-06-23.md`. | Needs real CRM record smoke after deploy for 0/1/3 children. |
| Birthday display | Explicit birthday should display; age-only child must not generate fake birthday. | Automated pass | `tests/customer-children.test.js`, `tests/customer-birthday-tags.test.js`, and `npm test` passed. | Needs visual check in customer card and any birthday-facing production surfaces. |
| Booking/banquet summary | Booking and banquet summary must keep customer/children/banquet projections stable. | Automated pass | `tests/booking-digest.test.js`, `tests/booking-banquet-links.test.js`, `tests/booking-create-durability.test.js`, `tests/booking-package-contract.test.js`, and `npm test` passed. | Needs PDF/export smoke on live/staging if production PDF generator differs. |
| Version badge/cache | Release badge, `/api/version`, service worker cache names, and asset `?v=` tags must stay in sync. | Automated pass | `npm run check:version`, `scripts/version-sync.js`, `scripts/check-service-worker-policy.js`, and `npm test` passed. | Needs `npm run version:smoke -- https://<live-crm-host>` after deploy. |

## Live/Staging Smoke Needed After Deploy

Run only after a target host is confirmed:

```bash
npm run smoke:live -- https://<live-crm-host>
npm run version:smoke -- https://<live-crm-host>
```

Manual browser smoke:

1. Logout from `/`, `/customers`, `/sales-funnel`, and `/profile`; confirm the full login screen appears and no old shell fragments remain.
2. Open or create a banquet with kitchen/food marker and at least one activity; open mini inspector; confirm activity count/list is present.
3. Switch `Rooms -> Animators -> Rooms`; confirm rows remain visible and do not duplicate.
4. Open customers with `0`, `1`, and `3` children; confirm birthday values display only when explicit.
5. Open booking/banquet summary and export/PDF if available.
6. Confirm login version badge and `/api/version` match `0.77.15 - Timeline Banquet Inspector Activity Fix`.
