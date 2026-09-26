# EG-HR-07 — HR Park staff card release preflight (2026-09-26)

**Verdict: GO to prepare the scoped EG-HR-08 feature commits and exact-SHA CI. This is not approval to deploy.** The current staff ownership check is complete; no new staff row has an unresolved or foreign business signal. Production impact: yes.

## Source identity and candidate scope

- Read-only production `GET /api/version`: version `0.82.15`, source branch `codex/eventgenix-production`, SHA `e1694b9e0a96883960ad37fd0be32c2d2c817362`.
- `git ls-remote origin refs/heads/codex/eventgenix-production` returned the same SHA. Candidate branch `codex/hr-park-card-read-20260925` is at that HEAD with uncommitted EG-HR-02–06 changes; no source drift was found.
- Read-only Railway status from the already-linked checkout resolved project `fortunate-appreciation` (`bc28b46c-d4bc-491c-893a-d8401c633668`), production environment `d9f9b984-d54d-4620-a8bf-c48882ad5158`, and application service `8223324090` (`3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`). The candidate worktree itself has no Railway link.
- The candidate diff contains only the previously scoped HR/Check-in implementation, tests, and preflight docs: 15 modified tracked files and 6 prior untracked files, plus this report. `git diff --check` passed. No unrelated files or secrets were added.

## Production ownership audit

At `2026-09-26T07:49:50Z`, the audit ran with `eventgenix_audit_ro` inside `REPEATABLE READ READ ONLY`; `transaction_read_only=on`, all 16 required tables readable during the lease, and none writable by this role. Only aggregate counts were returned. No names, staff/user IDs, contacts, or row contents were output.

| Aggregate from current production | Count |
| --- | ---: |
| All staff rows | 217 |
| Staff created since 2026-09-14 | 1 |
| New rows with Park-only `account_onboarding_created` in HR audit | 1 |
| New rows with matching Park-only account security audit | 1 |
| New rows linked through an active profile to an active Park-only account and Park default context | 1 |
| New rows with a foreign account-context or active foreign-membership signal | 0 |
| New rows with foreign or NULL-context schedule/time signals | 0 |
| New rows with foreign or NULL-context certifications | 0 |
| New rows with foreign/NULL stock context or costume assignments | 0 |
| Orphan staff certifications, documents, resource links, schedules, time records, or profiles | 0 |
| NULL-context certifications in the whole historical namespace | 2; neither is new |
| Assignments to Park stock in the whole historical namespace | 2; neither is new |

A second aggregate diagnostic at `2026-09-26T07:52:18Z` found that the new staff row's linked account has **no business_membership and no organization_membership**. It has an active profile and active account with only `event_genix` in `users.business_contexts` and as its default. The onboarding writer records the new staff row, account, profile link, and both Park-context audit events in one transaction. No non-Park signal or orphan was found. The owner decision in `docs/PARK_STAFF_SCHEDULE_READ_RECOVERY.md` assigns the existing staff namespace to Park and explicitly says account membership is not the source of staff data ownership. The missing membership is therefore a separate account-onboarding/access gap, not evidence that this staff row belongs to another business. It should be tracked separately; the Park HR GET guard must still require current requesting-user membership.

## Temporary audit read lease

The user explicitly authorized `EG-HR-07-READ-LEASE`. The existing `scripts/sys-mb-audit-read-lease.cjs` temporarily granted `SELECT` only on `public.organizations`, `public.businesses`, `public.organization_memberships`, and `public.business_memberships` to the existing read-only role. The operator connection was used only for catalog checks and GRANT/REVOKE; operational aggregates used a separate read-only connection and transaction. Two short lease cycles were needed to isolate the missing membership condition. Both returned `RETIRED`, and a fresh plan after each showed the initial ACL fingerprint `78b71644d422a521c9d2f6be540dc7e8010037c83be6491a25bb3da993a057a9` restored exactly. Private receipts were retained outside Git. No operational row, schema, app permission, secret, or Railway setting was changed.

## Verification and remaining gates

- `npm run check:runtime`: Node 22.23.1 / npm 10.9.8 passed.
- `npm run check:version`: release references remained aligned at `0.82.15`.
- `npm run test:staff-schedule-recovery` using existing local dependencies: 61/61 passed, including real Express staff-card routes, payroll masking, team states, Schedule, and Today.
- Focused local grant/revoke tests: 5/5 passed. The prepared audit script passed `node --check` and failed closed before the temporary lease. `git diff --check` passed.
- The disposable PostgreSQL permission suite and exact candidate CI still need the EG-HR-08 commit SHA. The new HR code is not live, so post-release QA is pending.

Before a later production deploy, repeat the read-only ownership audit as required by EG-HR-09 because new staff could appear after this snapshot. The audit role's temporary registry grants are now retired, so another specifically authorized bounded read lease or an independently provisioned read-only credential with the same SELECT scope will be needed then. Do not infer ownership from the linked account's absent membership, grant it automatically, or broaden `/staff/*`.
