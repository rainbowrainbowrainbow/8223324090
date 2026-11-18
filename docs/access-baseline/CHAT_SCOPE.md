# Park Chat access perimeter

Status: implemented and verified locally; no production release or data mutation.

## Ownership and policy

The owner delegated the existing channel ownership decision because only Park
operates now. All 22 existing channels (IDs 1–20, 27, 28) belong exclusively to
Park. Mixed participant memberships do not establish ownership. The existing
exclusive-Park namespace pattern needs no schema/backfill. Other businesses need
a separate ownership migration before Chat can be enabled there.

HTTP, private files, WebSocket delivery and scheduled publication require current
active Park membership, configured Chat module and page permission. Channel
membership remains necessary; a stale membership cannot enlarge a two-person DM
or an assistant owner's identity. Linked bookings additionally require current
Park booking visibility and coherent links. Coordination previews omit contacts
and financial fields even for privileged recipients.

Recipients, profiles, invitations, presence and task assignment resolve current
Park eligibility. Staff profiles use the unique active employee bridge. Team task
assignment uses the canonical task-owner policy. Explicit denials win. Channel
authorization is not cached. Replies, threads, pins and message mutations retain
their live parent-channel boundary. Future messages remain hidden until delivery.

Scheduled delivery claims only currently eligible sender/channel pairs under
row locks and assigns fresh sequence numbers. Revoked senders' rows remain queued;
this change does not cancel, repair or delete their records.

## Private attachments

Both the authenticated API path and historical static paths check authoritative
live message/channel ownership before reading file content. Blob records bind to
their linked message; legacy files retain their earliest historical reference.
Copied metadata, guessed path channel IDs, orphan blobs and encoded path aliases
cannot transfer access. Responses are private/no-store, nosniff and same-origin.

The browser reuses existing bearer API fetches, with no URL credentials or login
mechanism changes. Bounded object URLs are revoked on removal, scope/session
changes and page exit; stale asynchronous responses cannot repaint another scope.
Images fetch near the viewport with an immediate fallback without
IntersectionObserver. Image preview/download work with the keyboard; voice loads
on request. Ordered scripts use defer. CSP adds only blob media support.

## Evidence

Node 22.23.4/npm 10.9.9:

- Focused perimeter regression: 38/38; final attachment/record checks: 11/11.
- WebSocket/task/namespace parity: 70/70, no skips.
- Real disposable PostgreSQL plus authenticated HTTP: 8/8, no skips,
  output/park-chat-actual-api-final.log. Covers current/foreign/revoked membership,
  DM/assistant identity, files and historical aliases, booking visibility,
  scheduled invisibility and concurrent fresh sequence claims.
- Actual-app Chrome at 1280 and 390: 2/2,
  output/park-chat-private-browser-final.log. Image preview/keyboard, file download,
  voice playback, three authenticated query-free fetches and all three URL leases
  revoked after auth clearing; zero page errors. Both final screenshots reviewed.
- Existing service-worker sensitive-route policy passes; private files stay
  network-only. No dependency or lockfile change.

Tests use synthetic local records, no real customer data or external messages.
Final integrated full baseline, six-role common-work acceptance, authenticated
readiness, exact-SHA CI and approved live proof remain separate completion gates.

## Modern Web Guidance

Applied security and performance guides: DOM text APIs, authenticated private
no-store fetches, bounded/revoked blob URLs, viewport loading with fallback and
ordered deferred scripts. Existing keyboard/focus behavior is retained and
desktop/mobile interactions were actually exercised.

- https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/security/security.md
- https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/performance.md

Local rollback: revert the own unpublished Chat commit. No production rollback is
needed because no production write or deployment occurred.
