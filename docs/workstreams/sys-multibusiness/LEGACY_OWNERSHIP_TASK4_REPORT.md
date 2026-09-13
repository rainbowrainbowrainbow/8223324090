# SYS-MB-LEGACY-OWNERSHIP — Task 4 prerequisite check

Date: 2026-09-12. Status: **BLOCKED_SOURCE_MAPPING_AND_POLICY**.
Implementation, migration and containment removal: **NOT_STARTED**.

## Verified checkpoint

Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-auth-p0-20260912`.
Branch: `codex/sys-mb-auth-p0-20260912`.
HEAD/base: `a5180def01a1e47f8f4fc75e2f7a43092f205828`.

All 202 entries in `OWNERSHIP_DECISIONS_VERIFICATION.json` match: 138 source
entries, 32 audited-source entries and 32 artifacts. These lists overlap;
202 is the number of verified entries, not unique files. The cumulative
implementation remains uncommitted. No existing checkpoint or evidence was edited.

The current request authorizes Task 4 local implementation using **only approved
Task 3 decisions and mapping**. It does not supply those missing decisions or
approve the proposed policies by reference. This is a prerequisite blocker,
not a request to reconfirm routine local implementation.

## Actual inputs and blockers

| Part | Observed input | Status and exact missing prerequisite |
| --- | --- | --- |
| Durable root ownership, child constraints and scoped private operations | OWN-01/02/03/08 remain PENDING in `DECISIONS.md` | BLOCKED: approve single-business ownership/library/mixed-record/source policies and reconcile actual row mapping before choosing the migration model |
| Historical mapping | Restricted working JSON has `dataKind:unpopulated`, `source:null`, no entities or contextual references; all eight decisions PENDING | BLOCKED: selected read-only source, exact restricted inventory, reviewed row identities/owners and approval evidence. No entries means NOT_COLLECTED, not zero production rows |
| Public links and assets | OWN-04/05/08 remain PENDING | BLOCKED: intended publication/revision/expiry rules plus existing link/asset classification; the suggested 30-day lifetime is not an approved default |
| Provider jobs, refresh and business-owned recurring | OWN-03/06/08 remain PENDING; historical series and job destinations are not mapped | BLOCKED: permitted job lifecycle, reviewed owner/destination mapping and historical-instance handling; protected booking changes still need their exact scope |
| Containment removal | No Task 4 migration or private/public/asset/background acceptance has run | BLOCKED per module: retain C1/C2 until its complete implementation and acceptance pass |
| OWN-07 / other domains | HR/finance/integration decisions remain PENDING | Separate domain dependency; do not silently include those changes in Task 4 |

Only the architecture and existing scope constraints in Task 3 are APPROVED.
They do not establish an owner for a historical row or select public/job behavior.
`LEGACY_OWNERSHIP_VERIFICATION.json` is older collector evidence, explicitly
`NOT_IMPLEMENTED_PENDING_OWNER_MAPPING`; it is not a later implementation or
approval checkpoint. An independent read-only review reached the same conclusion.

The dedicated process-local `MULTIBUSINESS_AUDIT_DATABASE_URL` and
`BUSINESS_MEMBERSHIP_TEST_DATABASE_URL` are absent. Only their presence was checked.
No secrets file, application URL fallback, production database or provider was read.

## Verification performed this task

- Canonical runtime: Node 22.23.1 / npm 10.9.8.
- Exact Git branch/HEAD and all 202 prior checkpoint entries: PASS.
- Existing offline validator on the actual restricted working file: format-valid,
  `recordCollection:NOT_COLLECTED`, `migrationReadiness:NOT_COLLECTED`, eight pending
  decisions; `safeToApply`, `authorizationVerified`, `sourceSnapshotVerified` false.
- No actual-source collection, migration, backfill, partial-mapping application,
  rerun or rollback test was performed. Those are **BLOCKED**, not PASS.
- Task 3's 10 unit / 8 PostgreSQL / 27 validator results remain historical evidence
  only. They were not rerun or relabeled as Task 4 migration acceptance.
- No full npm suite, CI, deploy, live QA, provider call or production write.

Only this report and `LEGACY_OWNERSHIP_TASK4_VERIFICATION.json` are added. Runtime,
SQL/schema, containment, public links, assets, recurring and scheduler behavior are
unchanged. No migration number was reserved; no fake owner mapping or speculative
schema was introduced. This report does not claim Task 4 implementation complete.

## Resume with concrete inputs

1. Record the owner's chosen policies for OWN-01/02/03/04/05/06/08 in the relevant
   scope, using `DECISIONS.md` recommendations or explicit alternatives. Keep OWN-07
   with its separately scoped domains; it must not unnecessarily block independent
   implementation once its boundaries are clear.
2. Select a named read-only database/snapshot through the approved local operator
   mechanism. Do not send a connection string in chat. Collect the restricted exact
   inventory, then review per-record mapping with `OWNER_MAPPING_FORMAT.md`.
3. Resume the existing Task 4 steps for each module with sufficient decisions and
   mapping. Use local PostgreSQL for empty/partial/mixed/rerun/rollback acceptance;
   keep unready modules contained. Production operations remain Task 7 work.

There is no independently runnable Task 4 runtime patch under the current
approved-input restriction. Read-only verification is complete; independent
inventory in other tasks remains possible but was not substituted for this task.
