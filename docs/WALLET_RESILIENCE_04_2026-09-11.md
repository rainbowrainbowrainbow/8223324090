# WALLET-RESILIENCE-04 — local implementation and verification

Status: connection handling fixed locally; overflow and opposing-transfer checks pass; historical timezone provenance remains BLOCKED.

Production impact: no production actions in this block. The route fix will affect daily-login and transfer error handling when separately released.

## Baseline and boundaries

- Isolated worktree: `.codex-temp/hr-checklists-residuals-20260911`.
- Branch: `codex/hr-checklists-residuals-20260911`.
- Clean starting HEAD: `344305f4d18e63e1cbcaa16ba5cc328d95ae00c3` (v0.81.112).
- Read-only remote check during this block returned the same production-branch SHA. Recheck before integration; other tasks may advance it.
- The shared checkout and other contributors' changes were not modified.
- Files: `routes/wallet.js`, `tests/wallet-resilience.test.js`, `tests/integration/wallet-ledger.integration.test.js`, the existing `test:unit` file list in `package.json`, this report and the previous Wallet plan's status link.
- No schema, dependency, lockfile, auth, API field/status, reward, global UI, CI workflow or production-setting changes.

## Defect and implementation

Symptom: rejected `pool.connect()` in daily-login or transfer escapes the async handler before a response is sent. Expected: one ordinary 500 response and successful handling of subsequent requests after recovery. Express 4 does not consume this rejected handler Promise automatically; the existing server-level unhandled-rejection handler exits the process. The process-exit consequence was established from code, not induced on production.

Reproduction: invoke each actual route handler with an injected connection-acquisition rejection. Before the route edit, 2 of 8 regression tests fail with the rejection; the six existing BEGIN/query/rollback error paths pass. After the edit, all eight pass.

The fix moves acquisition inside each existing `try`, with rollback/release conditional on having acquired a client. It retains the generic 500 response, transaction scope and existing logging. Tests also verify one response, release count, rollback failure containment, and a subsequent ordinary missing-wallet/recipient response after acquisition recovers. These are direct handler tests with an injected pool, not a real network outage simulation or an auth test.

## PostgreSQL findings

No arithmetic or lock-order change was justified by the reproduced scenarios:

- Daily `coins` and `total_earned` overflow returns 500 and rolls back balance, totals, streak, date, updated timestamp and ledger. Restoring headroom only in the fixture allows the next claim to reach INTEGER maximum exactly.
- Transfer overflow in sender `total_spent`, recipient `coins`, or recipient `total_earned` returns 500 and rolls back both wallets and all entries. A smaller transfer reaching the exact boundary succeeds.
- The maximum individual amount, 2,147,483,647, transfers exactly without rounding or truncation.
- Overflow of the daily streak and production-shaped inventory quantity also rolls back the full claim.
- Opposing 17/23-coin transfers are forced to overlap behind a held lower-ID wallet row. Both complete after release, with expected balances/totals, four correctly owned ledger entries, and zero net ledger change. There was no deadlock in this controlled interleaving.

The full HTTP 500 contract includes `success: false` and a generated `requestId` from the shared error middleware. The first PostgreSQL test draft omitted these metadata fields and failed its response assertions. Those failures were test-expectation defects, not lost-money or rollback defects. The corrected test checks the complete existing response and does not expose database error details.

## Verification evidence

Runtime: Node 22.23.1 / npm 10.9.8. PostgreSQL 16.15, fresh loopback clusters with synthetic accounts and the existing isolated runner. Each cluster was stopped successfully. No production records or credentials were copied into fixtures.

| Command / environment | Result |
| --- | --- |
| `node --test tests/wallet-resilience.test.js` | 8/8 pass, zero skips |
| Wallet isolated runner, UTC, migrated schema | 43/43 Node tests pass |
| Wallet isolated runner, UTC, deployed-shaped schema | 44/44 Node tests pass |
| Wallet isolated runner, America/Los_Angeles, migrated schema | 43/43 Node tests pass |
| Wallet isolated runner, America/Los_Angeles, deployed-shaped schema | 44/44 Node tests pass |
| `npm run check:runtime` | pass |
| `npm run check:api-surface` | pass |
| `npm run check:version` | pass |
| `node --check` for the three changed JavaScript files | pass |
| `git diff --check` | pass |

The 174 PostgreSQL Node tests include four parent tests (170 scenario subtests). The schema variants cover the migrated username/character-item model and the verified deployed user-ID/shop-item model. Current-day UTC boundary checks remain enabled in both zones.

Local logs: `output/hr-checklists-residuals/wallet-resilience-{before,after,unit}.log`, `wallet-resilience-pg-{utc,la}.log`, `wallet-resilience-api-guard.log`, `wallet-resilience-version.log`. Per-variant evidence: `output/wallet-ledger/results-{migrated,deployed}-{UTC,America_Los_Angeles}.json`. Diagnostic `wallet-resilience-pg-before.log` contains the initial metadata assertion mismatch and is not passing evidence.

The new handler regression is in the existing `test:unit` list. Existing CI already invokes the expanded isolated Wallet matrix; no workflow/settings change is needed. No push, CI run, deploy or live QA was performed for this diff. Full `npm test` was not rerun in this block; the focused checks above are the evidence. No new screenshots: this is a backend-only block.

## Historical timezone — BLOCKED

The prior read-only deployed catalog evidence (`output/hr-checklists-residuals/wallet-live-schema.json`) reports session timezone `Etc/UTC`, but `coin_transactions.created_at` is `TIMESTAMP WITHOUT TIME ZONE`. The current migrations have the same type and `DEFAULT NOW()`.

A synthetic PostgreSQL proof shows that the same stored `2026-09-11 23:30:00` represents UTC day September 11 when written in UTC, and September 12 when written in America/Los_Angeles. The row does not contain the offset needed to distinguish them. Current configuration and passing constant-timezone tests cannot prove historical writer conventions. Session timezone changes between a claim and its legacy fallback check remain outside the verified contract.

Do not guess offsets or rewrite historical timestamps. A future migration requires trustworthy writer-timezone history, identification of any explicit application-written timestamps, a conversion rule for each verified period, and a decision for ambiguous rows. Only then design and separately authorize a migration (potentially to an instant-preserving type) and assess the existing history API serialization. No migration or production data read/write was performed in this block.

## Remaining tasks and integration risks

1. **WALLET-TIMEZONE-05 — provenance and migration decision.** Goal: establish the historical convention before changing data. Scope: read-only deployment/configuration history and all ledger writers, followed by a reviewable migration proposal if provenance is sufficient. Done when every proposed conversion has evidence and ambiguous periods are explicitly identified. Live QA: read-only. Schema/API/data changes require separate authorization.
2. **WALLET-HISTORY-06 — pagination contract review.** Source inspection found that negative `page`/`limit` values can reach SQL OFFSET/LIMIT; equal timestamps also lack a secondary ordering key. This was not reproduced as a live defect here. Reproduce on the disposable DB, define backward-compatible validation/ordering, then implement only the approved contract. Include empty, invalid, oversized and tied-timestamp pages. Live QA: read-only. No change is included in this block.
3. **Release and existing HR platform QA.** Before release, recheck the live/source SHA, integrate concurrent changes without overwriting them, prepare version/cache notes, run exact-SHA CI and the authorized release workflow. Retain native Safari/iOS and NVDA/VoiceOver scenarios from HR-CHK-QA-02; Playwright WebKit is not proof for those platforms. Live QA must remain read-only unless separately authorized.

INTEGER storage capacity is unchanged. Reaching it still produces the existing generic 500 rather than a new business limit or a silently truncated award. A friendlier limit response or a wider numeric type is a separate product/API/schema decision. Cross-module races involving shop/minigame writers, every missing-wallet interleaving, real pool exhaustion/restart under load, and ambiguous COMMIT outcomes were not exhaustively tested. This report does not claim zero technical debt or full CRM coverage.
