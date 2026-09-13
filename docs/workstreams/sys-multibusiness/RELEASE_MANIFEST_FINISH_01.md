# SYS-MB-FINISH-01 release manifest

Status: **READY_FOR_EXACT_AUTHORIZATION**. This is not a release approval.

| Field | Value |
| --- | --- |
| Candidate worktree | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-finish-01-r3-20260913` |
| Candidate branch | `codex/sys-mb-finish-01-r3-20260913` |
| Local candidate commit | resolve `HEAD` immediately before exact authorization; it is not pushed |
| Required destination | `codex/eventgenix-production` |
| Production base | `d2b6a686a4fe4ad21d14d809c053cab68dcfb374` |
| Base version | `0.81.151` — `PIN тестової каси біля маршруту` |
| Railway target | `fortunate-appreciation / production / 8223324090` |
| Release commit | pending exact authorization |
| Version/cache/changelog commit | pending exact authorization |
| New migration files | none; membership schema is the pre-existing `357_multibusiness_organizations.sql` and must be confirmed in the live ledger read-only |
| QA data | no writable fixtures; approved existing test accounts only, read-only scope |
| Local actual-app acceptance | `d06_1789297445570_d09fe4`: 196 PASS / 1 NOT_TESTABLE / 0 FAIL; disposable DB cleanup verified |
| Full baseline | `npm test` PASS after static browser-smoke contract correction |

## Included change families

1. Cumulative Park/Dar membership resolver, profile, cabinet management, registry/branding and scoped core domain implementation.
2. Explicit containment of unsupported global contractor/procurement, staff, certificate, Art and payroll entrypoints in membership mode.
3. Transactional generic booking linked-parent ownership check and HTTP/PostgreSQL regression fixture.
4. Wallet/chat-browser diagnostics, availability UI and focused regression tests.

## Mandatory gates before delivery

1. Re-fetch `origin/codex/eventgenix-production`, read live `/api/version` at `https://8223324090-production.up.railway.app/api/version`, and stop if the base/branch changed.
2. Confirm Railway status resolves exactly to the stated project/environment/service.
3. Run release function commit, then canonical patch version/cache/changelog commit. Push only the verified candidate descendant to the confirmed production branch.
4. Wait for required green CI on the exact version commit. Deploy only with `npm run release:railway-up` and `RELEASE_DEPLOY_BRANCH=codex/eventgenix-production`.
5. Prove the exact live SHA/branch/version/label through `/api/version`; then execute read-only QA and save redacted evidence.

## Read-only live QA boundary

Allowed: login of pre-approved test accounts, business-profile and enabled core-domain reads, sidebar/cabinet switching, browser keyboard/responsive/light-dark inspection, expected denials and network/console capture.

Forbidden: bootstrap, organization/business/member changes, writes, booking/customer/lead/task/product/price-rule creation, wallet reward POST, provider sends, exports, payroll/finance access, or any attempt to reproduce a protected exposure with real records. Lifecycle mutation, same-JWT revoke and cross-organization write tests are `NOT_TESTABLE` in production until a separately reviewed fixture registry exists.

## Forward rollback

Use a new clean worktree from then-current production. Reverse only the recorded SYS-MB functional hunks, preserve later streams, make a new versioned commit, pass exact-SHA CI and deploy through the same helper. Do not reset, force-push, delete migration ledger rows, drop schema, infer owners, or restore a historical whole checkout.
