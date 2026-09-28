# IMG-04 — Menu image generation release handoff

Production impact: yes, after a separately authorized release.

## Cause and limits of the diagnosis

The deployed code previously treated every provider HTTP 429 as a temporary rate limit and discarded the provider error code/type, request ID, and `Retry-After`. The CRM also charged draft generation, its `/generate` alias, manual external drafts, Apply, and Reject against the same four-per-minute generation bucket. The UI reduced the response to a generic notification and kept its busy state only in the rendered card. These defects explain the misleading message and avoidable local throttling. The subtype of the original production 429 is **not confirmed** because the old response/logging path did not retain the necessary metadata. If it was exhausted provider credits or account quota, code changes will not restore generation; the account owner must resolve that limit.

## Candidate and production state

- Candidate: detached worktree `C:\Users\Plotva\.codex\worktrees\menu-image-errors\EventGenix`, based on `7a61464776e983165fbac7a5cc3062515596858a` (`0.82.35`). Changes remain uncommitted.
- Read-only live `/api/version` on 2026-09-28: `0.82.36`, SHA `3ad833403eaf05e473947f3ba9a01f0c7e133ae3`, source branch `codex/eventgenix-production`, complete manifest deployment metadata.
- The candidate base is older than the live release. Before any release, transfer the scoped change onto the then-current production branch/SHA, inspect conflicts and unrelated changes, and rerun validation. Do not reset, stash, or merge the dirty primary checkout to do so.

## Scoped implementation

- `services/menuPhotoGeneration.js`: allowlisted provider classification and safe public contract (`code`, `retryable`, `retryAfterSeconds`, `requestId`); quota, transient, access/configuration, and unknown failures have distinct results. Logs receive allowlisted metadata only, not upstream bodies.
- `routes/products.js`, `routes/hermes.js`: use the shared classification; product generation and Hermes generation preserve the current `icon_url` on failure. Product draft and generate alias share the four-per-minute generation bucket; external draft, Apply, and Reject share a separate guarded review bucket.
- `js/api.js`, `js/programs-page.js`, `css/pages-products.css`: retain structured errors, show Ukrainian next-step messages in the card, honor server cooldown without automatic paid retries, and keep in-flight state across rerenders by business context and product ID. Manual upload and review remain available after AI failure.
- `tests/menu-photo-provider-errors.test.js`, `tests/products-menu-image-limits.test.js`, `tests/products-menu-image-ui.test.js`, `tests/hermes-routes.test.js`, `package.json`: regression coverage and registration in the unit test list.
- No migrations, auth changes, provider/model/key/billing changes, dependency or lockfile changes, or production setting changes are part of this candidate.

## Verification on this candidate

- `npm run check:runtime`: passed, Node `22.23.1`, npm `10.9.8`.
- `node --test tests/menu-photo-provider-errors.test.js tests/products-menu-image-limits.test.js tests/products-menu-image-ui.test.js tests/hermes-routes.test.js`: 109/109 passed. Tests cover transient/quota/unknown 429, successful generation, limiter separation and alias sharing, duplicate click, rerender, failure preserving `icon_url`, and a ready draft requiring manual Apply.
- `npm run test:ui`: 1327/1327 static UI checks and 4/4 frontend code-splitting tests passed.
- `npm run check:syntax`: 1340 JavaScript files passed.
- `npm run check:css-surface` and `git diff --check`: passed.
- The isolated worktree has no own `node_modules`; tests used the already installed packages from the primary checkout through process-local `NODE_PATH`. No install was performed.
- CI, release candidate version/cache sync, deployment, and live write QA have **not** run. No commit or push was made.

## Release and live QA handoff

1. Rebase the *change* safely onto the then-current production source, preserving the primary dirty checkout. Review the exact diff and add the normal version/cache/changelog release metadata. Run targeted checks again, then the repository's release gates and exact-SHA CI under the applicable authorization envelope.
2. After an authorized deploy, verify `/api/version` reports the exact intended SHA and `codex/eventgenix-production` before UI QA.
3. On one approved disposable menu product in the test business context, generate **one** photo. Check loading → ready, a reviewable AI draft, and unchanged current product photo. Click Apply manually and confirm the photo changes only then. Check manual upload still works after an AI error if such an error occurs naturally. Do not generate traffic to force a 429.
4. For a naturally occurring generation failure, record only HTTP status, safe provider `error.code`/`type`, request ID, `Retry-After`, public `code`, and whether the UI gives the right next action. A quota/credits result requires the account owner to inspect provider billing/limits; an unknown 429 requires provider-side evidence rather than an assumed cooldown.

The original 429 subtype remains unproven until provider metadata from a future failure or account-side evidence is available. The live candidate is not released.
