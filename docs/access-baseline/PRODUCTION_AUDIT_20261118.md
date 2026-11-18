# Read-only production access audit — 2026-11-18

The owner supplied a relocated `codex-crm-secrets.ps1` in this task. Required
literal environment values were parsed into a short-lived process; the unsigned
file was not executed, copied or modified. Values were never printed or stored.
The configured application URL matched the canonical production domain. The
dedicated connection verified the public CRM schema and read-only transaction.
No login/session creation, data repair, classification, migration, push or deploy
was performed.

Latest observed live/remote: 0.84.4,
`d4abaadfc45f7df53b79920d6c20ae55e51275d8`. Its preset registry, role definitions
and access policy are unchanged from 0.84.3. Inventories are separate
repeatable-read/read-only snapshots and always roll back. Revalidate source state
before any future bounded mutation; these artifacts do not authorize writes.

## Production evidence

Sanitized ID/count-only reports are local under ignored `output/`:

| Artifact | Result |
|---|---|
| `baseline-access-production-audit.json` | 32 active accounts with current Park membership. 14 have other than one active employee bridge; 3 roles are outside the 26-role registry; 1 profession/role mismatch is flagged. These are review signals, not repair instructions. Technical accounts may intentionally lack a bridge; profession need not equal authorization role. |
| `chat-scope-production-inventory.json` | 22 channels; 17 with multi-business principal membership sets and 11 with unresolved principals. Neither a membership set nor a single-business set establishes channel ownership. No messages, names or URLs returned. |
| `training-scope-production-inventory.json` | 17 relations without ownership columns; complete bounded row/reference enumeration. 31 profession-seed courses, 93 lectures, 7 canonical progress rows. Legacy enrollment/knowledge progress/test-results/submission tables are empty. No content, questions, answers, scores, names or URLs returned. |
| `game-zone-production-classification.json` | 15 active Park room resources, none explicitly `workArea=game_zone`. 18 bookings lack canonical room references across history; none is a current/future non-cancelled booking. No label inference or backfill. |
| `reported-access-production-diagnostic.json` | Unique matches for the reported administrator/card and instructor/account. The old administrator payload lacks three payroll-rule capabilities; the candidate metadata workflow is allowed. The instructor's candidate zone scope is allowed but its explicit resource set is empty. Authorization simulation only, no HTTP write or impersonation. |
| `BASELINE_PRODUCTION_REVIEW_UK.md`, `baseline-production-decisions.proposed.json` | Owner-facing exact IDs, recorded Park ownership/15-resource classification decisions and source hashes. Regeneration preserves decisions only for unchanged inventory hashes; production-write authorization remains false. |

Node absence requires review against each account's effective team scope, not an
automatic correction for every account. No department or profession text was
substituted for structural responsibility.

## Inventory safeguards and identity finding

`node scripts/audit-training-scope.js` uses only process-local
`ACCESS_AUDIT_DATABASE_URL`, with no bootstrap or migration path. A single client
verifies a repeatable-read/read-only snapshot. Connection, statement and lock
waits are bounded; fixed identifiers and parameterized limits enumerate rows in
primary-key order, with separate table counts. No per-record queries or indexes
are added. Default limit is 1,000 rows/table, hard maximum 10,000; assigned-target
arrays are capped at 1,000 references. Truncation is explicit. Missing schema,
unsafe numeric values or an unverified snapshot fail instead of inventing zeros.
Resource counts are not an exact attachment inventory.

Several legacy Training APIs use `req.user.id` for stored `staff_id`, whereas
the current course path uses an active employee-profile bridge. A physical staff
FK cannot prove historical identity when IDs collide. Such references remain
unverified; no person/business mapping or automatic repair is performed. Empty
legacy tables do not justify retaining unsafe future write paths.

The account report exports only registered role/capability keys. Unknown stored
profession/role/override values become counts and flags. Permission resolution
continues using the unchanged effective account.

## Verification

- Real minimal-schema PostgreSQL inventory tests: 5/5, no skips,
  `output/training-chat-scope-postgres.log`. Covers actual rejected writes,
  rollback, orphan references, nullable flags, source/URL canaries, row/reference
  truncation and ownership-column detection without inference.
- Fully migrated actual-app disposable schema: 1/1, no skips,
  `output/training-scope-migrated.log`,
  `output/training-scope-disposable-migrated.json`.
- Focused projection/CLI checks: 40 passed, 1 dedicated-DB case skipped; dedicated
  coverage above passes. Permission contracts: 118 passed, 2 dedicated-DB cases
  skipped, both exercised successfully above. Logs:
  `output/training-inventory-audit-projection.log`,
  `output/training-inventory-permission-contracts-final.log`.
- Earlier complete runtime baseline on 0.84.3 remains in STATE.md. These changes
  are audit-only; final candidate CI/release gates remain required.

SQL review applied Supabase Postgres Best Practices: explicit projections, one
connection per snapshot, bounded waits and primary-key-ordered bounded reads.

## Owner decisions and remaining execution gates

The owner selected all 15 existing room resources as instructor game zones and
assigned courses 1–31 exclusively to Park. For Chat the owner delegated the
decision, stating only Park currently operates; the chosen policy assigns the
22 inventoried channels (1–20, 27, 28) exclusively to Park while preserving their
membership/privacy restrictions. No ownership is inferred from mixed principal
memberships. Other business statuses remain unchanged.

A final read-only preflight confirmed Park already configures both modules and
all 15 room metadata objects lack `workArea`. The only identified production
classification change is the exact 15-key addition; no historical booking
backfill or module-configuration change is proposed. Production mutation remains
unauthorized. API/recipient/file boundaries and authenticated readiness now pass
locally on integrated0.84.6; see CHAT_SCOPE.md, WORK_READINESS.md and STATE.md.
The exact resource pairs, before-state fences and rollback are reviewable in
PRODUCTION_CUTOVER_PLAN.md. Final RC and separately approved production execution
remain required.
