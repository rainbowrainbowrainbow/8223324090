# Event Genix API Auth Boundary

This document records the intentional API authentication exceptions. The
machine-readable source is `config/authBoundary.js`; `npm run
check:auth-boundary` verifies that the middleware, docs, query-token callers,
and focused tests stay aligned.

## Why This Exists

Most `/api/*` routes must require a normal `Authorization: Bearer <jwt>` header.
Only a small set of endpoints are public, provider-secret guarded, bot-key
guarded, or opened by browser flows that cannot attach headers.

The rule going forward is simple: do not add a new public API route or
`?token=` JWT route directly in middleware or a route file. Add it to
`config/authBoundary.js`, document why it is safe here, and cover it with
focused tests.

## Public API Exceptions

| Entry | Owner | Reason |
| --- | --- | --- |
| `ANY /auth/*` | auth | Authentication endpoints own their own login, refresh, logout, and credential guards. |
| `GET /health` | settings | Public health endpoint for uptime checks and lightweight operational smoke. |
| `GET /ready` | settings | Public readiness endpoint verifies database and schema compatibility before/after deploy. |
| `GET /health/deep` | settings | Public deep health endpoint exposes schema diagnostics for release smoke checks. |
| `GET /version` | settings | Public version endpoint used by clients and smoke checks. |
| `POST /telegram/webhook` | telegram | Telegram webhook is guarded by provider secret validation instead of JWT. |
| `POST /omni/webhook/telegram` | omnichannel | Omni Telegram inbox webhook must accept Telegram provider updates before CRM user JWT exists. |
| `POST /report-bot/webhook` | report-bot | Report-bot webhook is guarded by Telegram webhook secret validation instead of JWT. |
| `POST /report-bot/submit` | report-bot | Report-bot submit is guarded by the bot API key instead of user JWT. |
| `GET /report-bot/on-duty` | report-bot | Report bot read endpoint is guarded inside the route by bot API key policy. |
| `GET /report-bot/summary` | report-bot | Report bot read endpoint is guarded inside the route by bot API key policy. |
| `GET /report-bot/accounts` | report-bot | Report bot account lookup is guarded inside the route by bot API key policy. |
| `GET /report-bot/submissions` | report-bot | Report bot submission lookup is guarded inside the route by bot API key policy. |
| `ANY /hermes/*` | hermes | Hermes integration is public only at the central JWT boundary; `routes/hermes.js` validates `x-api-key` or Bearer secret and loads the configured actor before any response. |
| `POST /personal-accounts/sync` | personal-accounts | Report-bot personal-account sync uses bot/API-key authorization inside the route. |
| `GET /personal-accounts/my` | personal-accounts | Report-bot personal account lookup uses bot/API-key authorization inside the route. |
| `POST /personal-accounts/:accountId/grant` | personal-accounts | Report-bot personal-account grant uses bot/API-key authorization inside the route. |
| `DELETE /personal-accounts/:accountId/access/:userId` | personal-accounts | Report-bot personal-account access removal uses bot/API-key authorization inside the route. |
| `GET /personal-accounts/:accountId/transactions` | personal-accounts | Report-bot transaction lookup uses bot/API-key authorization inside the route. |
| `POST /personal-accounts/:accountId/transactions` | personal-accounts | Report-bot transaction submission uses bot/API-key authorization inside the route. |
| `POST /kleshnya/webhook` | kleshnya | Kleshnya webhook is provider/bridge controlled rather than user JWT controlled. |
| `GET /kleshnya/pending-messages` | kleshnya | Kleshnya bridge polling endpoint is controlled by bridge route policy. |
| `POST /kleshnya/sync-chat` | kleshnya | Kleshnya bridge sync endpoint is controlled by bridge route policy. |
| `POST /music/library/generate-music/callback` | music | Kie.ai Suno callback is guarded by `KIE_CALLBACK_SECRET` before any payload is accepted. |
| `POST /demo/login` | demo | Demo login is intentionally public and issues its own demo session. |
| `GET /demo/scenarios` | demo | Demo scenarios are public read-only demo metadata. |
| `GET /packages` | packages | Public landing/package materials need unauthenticated package reads. |
| `GET /status/public` | status | Public status page uses this read-only endpoint without user JWT. |
| `POST /leads/landing` | leads | Public landing lead capture endpoint; protected by landing lead limiter. |
| `POST /leads/webhook/universal` | leads | External lead capture webhook is guarded by `UNIVERSAL_WEBHOOK_TOKEN` instead of user JWT. |
| `POST /leads/webhook/maysternya-booking` | leads | Maysternya bot booking webhook is public for JWT boundary only; the route validates Bearer `UNIVERSAL_WEBHOOK_TOKEN` before creating CRM bookings. |
| `POST /leads/webhook/maysternya-availability` | leads | Maysternya bot availability webhook is public for JWT boundary only; the route validates Bearer `UNIVERSAL_WEBHOOK_TOKEN` before exposing scoped booking slots. |
| `GET /leads/webhook/status` | leads | Read-only webhook readiness endpoint exposes configured flags and dry-run instructions without secrets for external delivery smoke checks. |
| `POST /landing/demo-request` | landing | Public landing demo request endpoint; protected by landing lead limiter. |

## Query-Token JWT Exceptions

Query-token auth is not a general fallback. It exists only for `GET` endpoints
that are opened with `window.open`, where the browser cannot attach an
`Authorization` header. These routes still authenticate as normal JWT requests
after `middleware/apiAuthBoundary.js` converts the approved `?token=` value into
a bearer header.

| Entry | Example | Client | Reason |
| --- | --- | --- | --- |
| `GET /graduation/quotes/:id/proposal` | `/graduation/quotes/123/proposal` | `js/graduation.js` | Proposal HTML is opened with `window.open`, where the frontend cannot attach an Authorization header. |
| `GET /graduation/catalog/export` | `/graduation/catalog/export` | `js/graduation.js` | Print-ready catalog HTML is opened with `window.open`, where the frontend cannot attach an Authorization header. |

Generic protected endpoints must keep rejecting `?token=`. The focused coverage
for this boundary lives in `tests/auth-boundary.test.js` and route-level smoke
coverage lives in `tests/route-smoke.test.js`.

## Done Marker

This pack is considered done when all of these remain true:

- `npm run check:auth-boundary` passes.
- `npm test` includes `npm run check:auth-boundary`.
- `middleware/apiAuthBoundary.js` imports route manifests from
  `config/authBoundary.js`.
- No route file handles `req.query.token` directly for JWT auth.
- New public or query-token exceptions update `config/authBoundary.js`,
  `docs/AUTH_BOUNDARY.md`, and focused tests in the same commit.
