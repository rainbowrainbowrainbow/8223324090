# Binotel telephony local handoff

## Candidate

- Base SHA: `d328eebee940dd5985917fa79a172b6e9ab65738`
- Branch/worktree: `codex/binotel-crm-integration` at `C:\Users\Plotva\.codex\worktrees\binotel-crm-integration\EventGenix`
- Delivery state: local, uncommitted and not deployed. A candidate is identified by its file manifest and diff, not by the base SHA.
- Readiness: `LOCAL_BROWSER_VERIFIED_BASELINE_BLOCKED` for the authenticated UI/API contract and fixture-tested DTO/lifecycle behavior. It is not a live Binotel integration.

## What works locally

1. A scoped Binotel client fails closed for missing configuration and for undocumented provider operations.
2. Canonical call DTO/lifecycle tests preserve zero durations and large string IDs, reject scope collisions and prevent late active events from regressing a completed call.
3. Authenticated Omni telephony routes validate Kyiv date ranges and return controlled unavailability rather than a false empty success.
4. The internal Omni telephony mode has filters, tabs, cancellation, scoped URL history, cursor pagination and clear unavailable/empty/error states without global navigation/access changes. Browser fixture coverage verifies filter reset, Back, keyboard tabs, mobile layout and an Inbox draft surviving a mode switch.
5. A customer deep link is emitted only when the canonical scoped DTO supplies a customer ID. Recording/live/queue controls remain safely unavailable until their provider contracts are confirmed.

## Not implemented

- Provider HTTP requests, historical records, live snapshots, queues, recordings, audio playback, number-based customer lookup, webhook lifecycle persistence and provider verification changes.
- Any production configuration, secret, schema, role, commit, push, PR or deploy action.

## Verification evidence

- Focused local suite passed: 19/19 tests across client, lifecycle, journal and UI.
- Local Playwright fixture passed with no provider requests or writes; it covers filters, pagination, history navigation, keyboard tabs, safe unavailable controls and an Inbox draft surviving a mode switch.
- Screenshots (synthetic fixture data only): `output/binotel/binotel-telephony-desktop-dark.png`, `output/binotel/binotel-telephony-mobile-light.png`, `output/binotel/binotel-telephony-native-zoom-200.png`.
- `npm test` was attempted after `npm ci --ignore-scripts`, but stopped at the pre-existing `omni.html` inline-style budget (`61,113 > 60,000`). The package does not modify an inline `<style>` block; later baseline stages did not run.

## Minimal activation checklist

1. Obtain Binotel's account-specific REST/Webhook/WebSocket documentation and explicit read-only test-account authorization.
2. Confirm the existing account fields (`BINOTEL_API_KEY`, legacy `BINOTEL_KEY`, `BINOTEL_WEBHOOK_SECRET`, account name) are populated through the established scoped connection flow; do not put values in browser code.
3. Confirm the public CRM base URL and callback URL only in the activation stage. Existing route: `/api/omni/webhook/binotel`; provider verification scheme must be confirmed before changing its guard.
4. Add documented transport/mapping fixtures, then run one read-only test history/live/recording scenario using safe test data.
5. For recordings, confirm host/redirect/TTL/user scope and use an existing same-origin authenticated media mechanism with `no-store`; never place credentials in a URL.
6. Keep rollback as disabling/disconnecting the Binotel provider connection; do not delete communication history.

## Required approvals

Schema/migration, auth/access changes, production secrets/settings or webhook configuration, provider activation/live test, commit/push/PR/deploy each need the separate explicit authorization required by `AGENTS.md`.
