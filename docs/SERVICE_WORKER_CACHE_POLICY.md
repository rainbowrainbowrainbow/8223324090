# Event Genix Service Worker Cache Policy

This document records the intended Service Worker API cache and offline
mutation policy for Event Genix. The machine-readable ownership manifest is
`config/serviceWorkerPolicy.js`; `npm run check:service-worker-policy` verifies
that `sw.js`, this document, and `tests/service-worker-policy.test.js` stay
aligned.

## Why This Exists

Event Genix is an authenticated CRM. Private API data must not be served from
stale Cache Storage by default, and failed mutations must not be replayed later
unless a specific endpoint has reviewed conflict behavior.

The rule going forward is simple: `sw.js` may cache the static app shell, but
API GET caching is `default-deny`. Offline mutation replay is
`disabled-until-reviewed`.

## Runtime Files

| Area | File | Notes |
| --- | --- | --- |
| Service Worker runtime | `sw.js` | Contains the browser-executed policy copy and fetch strategies. |
| Ownership manifest | `config/serviceWorkerPolicy.js` | Defines reviewed API cache entries, sensitive prefixes, and disabled mutation replay. |
| Focused tests | `tests/service-worker-policy.test.js` | Exercises runtime policy helpers in a VM context. |
| Guard script | `scripts/check-service-worker-policy.js` | Compares runtime policy, manifest, docs, and test anchors. |

The Service Worker also keeps `park-offline` as the legacy offline IndexedDB
name and supports explicit `CLEAR_PRIVATE_CACHES` and `INVALIDATE_CACHE`
messages for private cache cleanup.

`CLEAR_PRIVATE_CACHES` must run through `event.waitUntil(clearPrivateCaches())`
and delete both the active `event-genix-api-*` Cache Storage namespace and the
legacy `park-offline` database. This keeps logout/account switches from
leaving stale private API responses or old offline mutations behind.

## API GET Cache Allowlist

Only public, non-user-specific GET endpoints may be cached by the Service
Worker:

| Entry | Owner | Reason |
| --- | --- | --- |
| `/api/version` | settings | Public version metadata is non-user-specific and safe for offline smoke reads. |
| `/api/status/public` | status | Public status metadata is intentionally unauthenticated and non-user-specific. |

Even these endpoints must stay network-only when the request has an
`Authorization` header.

## Sensitive API Prefixes

These prefixes are documented as sensitive guardrails and must remain
network-only for Service Worker API GETs and disabled for offline mutation
replay:

`/api/auth`, `/api/backup`, `/api/telegram`, `/api/report-bot`,
`/api/finance`, `/api/chat`, `/api/hr`, `/api/customers`, `/api/reports`,
`/api/report-agent`, `/api/dashboard`, `/api/analytics`, `/api/leads`,
`/api/staff`, `/api/tasks`, `/api/bookings`, `/api/warehouse`,
`/api/designs`, `/api/sound`, `/api/profile`, `/api/users`, `/api/settings`,
`/api/search`, `/api/notifications`, `/api/push`, `/api/kleshnya`,
`/api/copilot`, and `/api/omni`.

This list is not the only protection. The runtime policy is still default-deny
for every `/api/*` GET that is not in the explicit allowlist.

## Offline Mutation Replay

`MUTATION_QUEUE_ALLOWLIST` is intentionally empty. Mutations under `/api/*`
should fail with an offline-aware `503` response when the network is down
unless a future pack reviews a specific endpoint, user conflict handling,
idempotency, and focused tests.

## Done Marker

This pack is considered done when all of these remain true:

- `npm run check:service-worker-policy` passes.
- `npm test` includes `npm run check:service-worker-policy`.
- New Service Worker API cache entries update `config/serviceWorkerPolicy.js`,
  `sw.js`, `docs/SERVICE_WORKER_CACHE_POLICY.md`, and focused tests in the same
  commit.
- `MUTATION_QUEUE_ALLOWLIST` remains empty unless a reviewed endpoint has
  conflict handling, idempotency, and tests.
