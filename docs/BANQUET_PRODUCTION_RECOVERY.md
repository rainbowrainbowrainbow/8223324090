# Banquet Production Recovery

This runbook covers historical pinata membership inconsistencies and banquet
groups that have no canonical deposit record.

## Safety boundary

- Deploy and verify the booking reconciliation code before running this process.
- The audit command is read-only and always uses `BEGIN TRANSACTION READ ONLY`.
- The recovery command is dry-run by default.
- Production apply requires both an explicit pair allowlist and
  `--apply --confirm=ATTACH_CONFIRMED_PINATAS`.
- The detach/rollback command is also dry-run by default and requires
  `--apply --confirm=DETACH_CONFIRMED_PINATAS`.
- The legacy QA cleanup mode remains read-only inventory for the historical
  built-in booking allowlist.
- Marker-scoped QA cleanup has a separate dry-run and a guarded transactional
  apply. Apply is allowed only for records carrying the complete disposable QA
  marker contract and an exact expected booking ID set.
- The confirmation token is only a technical guard. A separate explicit owner
  approval for production data mutation is still required.
- The tool never creates, estimates, or updates a deposit.
- Reports contain technical booking/group identifiers, dates, rooms, and a
  one-way match fingerprint. They do not query or print customer names, phone
  numbers, social handles, or secrets.
- Use `audit --summary-only` for routine operator summaries. Raw `--json` output
  is for controlled operator review only and must not be committed, pasted into
  public tickets, or stored in the repository.

## Current release data boundary

Owner decision recorded on 2026-07-21: the current compatibility release must
not mutate the remaining production audit records. The bounded inventory is two
stale banquet groups, four missing-deposit manual-review records, and seven
standalone pinata records. These records remain in place for later manager
review; their presence in the audit is not authorization to treat them as
disposable QA data.

For this release:

- do not run any reconciliation or QA-cleanup apply command for these records;
- do not create or update deposits automatically;
- do not attach standalone pinatas automatically;
- do not physically delete bookings, groups, memberships, links, deposits, or
  history;
- keep normal manager cancellation available for a later, separately reviewed
  action through the canonical booking workflow.

Any later production mutation requires a fresh read-only inspection, an exact
target scope, and a new explicit owner approval. This release boundary does not
weaken or bypass any apply guard documented below.

## 1. Disposable QA cleanup after browser smoke

### 1.1 Legacy read-only inventory

The historical allowlisted mode remains read-only:

```powershell
node scripts/banquet-production-recovery.js qa-cleanup --json
```

The built-in allowlist is limited to:

```text
BK-2026-0662,BK-2026-0663,BK-2026-0664,BK-2026-0665,BK-2026-0666,BK-2026-0667,BK-2026-0668
```

The command runs in `BEGIN TRANSACTION READ ONLY` and returns only technical
booking IDs, dates, rooms, membership refs, compatibility link refs, and deposit
IDs. It rejects booking IDs outside the allowlist. This legacy mode is not
proof that a row is disposable and has no write-path.

Additional release QA rows, if any, must be listed separately in the release
handoff and must not be added to this cleanup allowlist without explicit owner
confirmation.

### 1.2 Marker-scoped dry-run

Every browser-smoke root, member, activity, kitchen/service row and linked
technical child must persist the shared `extra_data.disposableQa` marker:

- `schemaVersion`;
- `runId`;
- `source=timeline_browser_smoke`;
- `cleanupExpected=true`;
- `testCustomerMarker`;
- `kind`;
- `createdAt`.

The marker must be supported, no older than 24 hours, and identical to the
operator scope. A marked group must also use the exact marked test customer.
Do not treat a `runId`, group ID, customer note, or booking label alone as
evidence that a record is disposable.

Run a marker-scoped dry-run before every apply:

```powershell
node scripts/banquet-production-recovery.js qa-cleanup `
  --run-id=RUN_ID `
  --group-id=BQ_ID `
  --primary-booking-id=PRIMARY_BOOKING_ID `
  --expected-bookings=BOOKING_ID,BOOKING_ID `
  --test-customer-marker=timeline_browser_smoke:RUN_ID:test_customer `
  --business-context=event_genix `
  --json
```

The dry-run uses `BEGIN TRANSACTION READ ONLY`. Continue only when:

- the returned `groupId` is the requested group;
- `expectedBookingIds` and `actualBookingIds` are exactly equal;
- the status is `ready` or `already_cancelled_clean`;
- every member and technical child has a valid marker;
- there are no deposits, receipts, payment references, certificates, stock
  dependencies, foreign customers, external links, or noncanonical finance
  rows.

`unexpected_member`, `unmarked_child`, `marker_mismatch`,
`real_customer_blocked`, `financial_dependencies_present`, `not_found`, and
`inconsistent` are hard stops. Never broaden `--expected-bookings` merely to
make a blocked result pass.

### 1.3 Marker-scoped apply

Production apply requires a separate explicit owner approval for that exact
`runId`, group ID and booking ID set. The confirmation token is necessary but
is not owner approval:

```powershell
node scripts/banquet-production-recovery.js qa-cleanup `
  --run-id=RUN_ID `
  --group-id=BQ_ID `
  --primary-booking-id=PRIMARY_BOOKING_ID `
  --expected-bookings=BOOKING_ID,BOOKING_ID `
  --test-customer-marker=timeline_browser_smoke:RUN_ID:test_customer `
  --business-context=event_genix `
  --apply `
  --confirm=CANCEL_DISPOSABLE_QA_BANQUET `
  --json
```

The canonical service:

1. opens a `SERIALIZABLE` transaction;
2. takes a group-scoped advisory lock and canonical booking-finance locks;
3. locks and repeats the full preflight inside the transaction;
4. cancels only the exact verified booking ID set;
5. performs strict canonical finance synchronization for every booking;
6. cancels the group only after every booking succeeds;
7. keeps memberships and compatibility links for audit;
8. rereads the complete state and requires `already_cancelled_clean`;
9. writes one technical history event and commits.

Any error rolls back booking statuses, group status, finance changes and the
history insert together. A repeated apply is idempotent: it returns
`already_cancelled_clean`, cancels zero rows and writes no second history event.
There is no fallback that merely updates `status='cancelled'`.

### 1.4 Evidence and PII restrictions

Store only:

- `runId`;
- group ID;
- technical booking IDs;
- classification and blocker codes;
- before/after counts.

Never put customer names, phone numbers, social handles, credentials, tokens,
request headers, arbitrary API bodies, or browser form payloads into cleanup
artifacts, terminal logs, tickets, commits, or release notes.

### 1.5 Production acceptance evidence - 2026-07-20

TASK 7 production acceptance was completed against:

- Production URL: `https://8223324090-production.up.railway.app`;
- version: `0.79.114`;
- release label: `Безпечне закриття порожніх банкетних груп`;
- release SHA: `c5469f4dbce80009c168d0edf59f6e32557fd1f6`;
- source branch: `codex/production`.

Acceptance scope:

- `runId`: `task7-prod-1784545548168-3kwn2n`;
- group ID: `BQ-MRT4C45S-24B1C1D0`;
- booking ID count: `2`;
- marker source: `timeline_browser_smoke`;
- dependencies intentionally absent: deposits, receipts, certificates, stock
  dependencies, payment references, and finance rows.

Results:

- marker-scoped dry-run returned `ready` with zero blockers;
- exact booking set matched expected and actual sets;
- first apply cancelled `2` bookings and `1` banquet group;
- post-apply classification returned `already_cancelled_clean`;
- repeated apply returned `already_cancelled_clean` with `0` cancelled bookings
  and `0` cancelled groups;
- live timeline API verification found `0` active rows for the disposable
  booking set;
- disposable customer cleanup through the standard customer endpoint succeeded;
- read-only DB verification found bookings total `2`, active bookings `0`,
  group total `1`, active groups `0`, finance rows `0`, deposit rows `0`,
  disposable customer rows `0`, and cleanup history events `1`.

This evidence intentionally omits customer PII, credentials, request headers,
raw API payloads, and payment details.

## 2. Read-only recovery audit after deploy

Use an explicit bounded date range:

```powershell
npm run audit:banquet-recovery -- --from=YYYY-MM-DD --to=YYYY-MM-DD --business-context=event_genix --summary-only
```

`--summary-only` prints aggregate counters only. It does not print booking IDs,
group IDs, rooms, customer fields, or fingerprints. Use it for routine production
checks and release notes.

Use raw JSON only when an approved operator must inspect exact technical rows:

```powershell
npm run audit:banquet-recovery -- --from=YYYY-MM-DD --to=YYYY-MM-DD --business-context=event_genix --json
```

The report separates:

- `pinatas.exactMatches`: one active banquet group matches the pinata by exact
  business context, customer, date, and trimmed room;
- `pinatas.ambiguous`: more than one active group matches;
- `pinatas.standalone`: no active group matches;
- `depositsForManualReview`: active groups whose primary booking is also active
  and that have no non-cancelled canonical deposit linked by group or primary
  booking;
- `integrityIssues`: duplicate membership, wrong canonical role, or an exact-key
  mismatch on an existing pinata membership.
- `groupStateIntegrityIssues`: banquet group state problems that must not be
  handled as deposit creation, including active groups with a cancelled primary,
  missing primary membership, cancelled groups with active members, active groups
  without active members, and member status mismatch.

Do not turn ambiguous or standalone rows into recovery pairs.
Do not create deposits for `groupStateIntegrityIssues`; those rows need a
separate business decision and a bounded reconciliation plan.

## 3. Build the confirmed recovery allowlist

After an operator reviews every exact candidate, create a comma-separated list:

```text
PINATA_BOOKING_ID:BANQUET_GROUP_ID,PINATA_BOOKING_ID:BANQUET_GROUP_ID
```

Use only technical IDs copied from `pinatas.exactMatches`. Do not copy customer
data into tickets, command history, or recovery logs.

## 4. Recovery dry-run

```powershell
npm run repair:banquet-pinatas -- --pairs=PINATA_ID:BQ_ID --business-context=event_genix --json
```

Every row must be `ready` or `already_applied`. The command blocks when:

- the target is not an active root pinata;
- customer, date, or room differs;
- another exact active group exists;
- the pinata already belongs to a different group;
- duplicate memberships already exist.

## 5. Production recovery apply

Run only after separate explicit approval for production data mutation:

```powershell
npm run repair:banquet-pinatas -- --pairs=PINATA_ID:BQ_ID --business-context=event_genix --apply --confirm=ATTACH_CONFIRMED_PINATAS --json
```

The allowlist is processed in one serializable transaction. The tool:

1. locks and revalidates every selected pinata, group, primary booking, and
   existing membership;
2. aborts the entire allowlist if any row is blocked;
3. inserts one canonical `activity` membership;
4. upserts the existing compatibility link;
5. records technical recovery history;
6. rechecks every pair before commit.

Repeated apply is idempotent and reports `already_applied`.

## 6. Detach / rollback for a wrong pinata attachment

Use this only for an explicitly confirmed bad attachment. The allowlist format is
the same as recovery: `PINATA_BOOKING_ID:BANQUET_GROUP_ID`.

Dry-run:

```powershell
node scripts/banquet-production-recovery.js detach --pairs=PINATA_ID:BQ_ID --business-context=event_genix --json
```

Production apply after separate owner approval:

```powershell
node scripts/banquet-production-recovery.js detach --pairs=PINATA_ID:BQ_ID --business-context=event_genix --apply --confirm=DETACH_CONFIRMED_PINATAS --json
```

The detach command:

1. locks and revalidates the allowlisted membership;
2. blocks primary, kitchen, manual, service, or non-pinata rows;
3. deletes only the `activity` row from `banquet_group_bookings`;
4. deletes only the compatibility `booking_banquet_links` relation between the
   group primary and the pinata;
5. updates the banquet group timestamp;
6. records technical history;
7. verifies that every allowlisted pair is `already_detached` before commit.

Repeated apply is idempotent when the membership is already absent.

## 7. Post-recovery verification

Repeat the same read-only aggregate audit and save only the summary counters:

```powershell
npm run audit:banquet-recovery -- --from=YYYY-MM-DD --to=YYYY-MM-DD --business-context=event_genix --summary-only
```

For every recovered group, verify on the live site:

- banquet details contain the pinata as an activity;
- the banquet sheet contains the pinata once;
- no unrelated activity was attached;
- the audit no longer reports the recovered pinata as ungrouped.

If verification fails, stop further recovery. Do not run broad cleanup SQL.
Prepare an explicit allowlist for canonical detach/rollback and obtain separate
production approval.

## Deposit review

`depositsForManualReview` is a manager review queue, not a repair plan. A missing
record does not prove a deposit amount, date, method, or status. The queue only
contains active groups with active primary bookings. Create or update a canonical
deposit only through the normal manager workflow and only when a trusted source
is available.

`groupStateIntegrityIssues` is a data integrity queue, not an accounting queue.
For example, an active group whose primary booking is cancelled must be resolved
by an explicit owner-approved reconciliation decision. Do not silently restore
the primary booking, create a deposit, switch the group to another booking, or
cancel production records from this audit.

## Stale Group Reconciliation Dry-Run

Use reconciliation only for one of these exact integrity classes:

```text
active group + cancelled primary booking + active non-primary members
active group + cancelled primary booking + zero active members
```

The general strategies are `cancel-stale-group` and
`cancel-empty-stale-group`. A third, deliberately narrow strategy,
`cancel-empty-stale-group-with-quoted-primary`, exists only for an empty stale
group whose single cancelled primary membership still carries a quoted price but
has no deposit, ticket ownership, or finance transaction. None of these
strategies is a restore path. Do not directly restore a cancelled primary
booking. If the business decision is to keep the banquet, create a replacement
through the canonical booking-set workflow instead.

Read-only dry-run:

```powershell
node scripts/banquet-production-recovery.js reconcile-group-state --group-id=BQ_ID --business-context=event_genix --expected-classification=active_group_cancelled_primary --strategy=cancel-stale-group --json
```

Empty stale group dry-run:

```powershell
node scripts/banquet-production-recovery.js reconcile-group-state --group-id=BQ_ID --business-context=event_genix --expected-classification=active_group_without_active_members --strategy=cancel-empty-stale-group --json
```

Quoted-primary empty stale group dry-run:

```powershell
node scripts/banquet-production-recovery.js reconcile-group-state --group-id=BQ_ID --business-context=event_genix --expected-classification=active_group_without_active_members --strategy=cancel-empty-stale-group-with-quoted-primary --json
```

The dry-run requires exact group scope and returns technical state only:

- current group status;
- primary booking status;
- active/cancelled member counts;
- active non-primary and complete membership booking IDs;
- active deposit count;
- ticket ownership conflict count;
- active priced-member conflict count.

Dry-run is blocked when the group no longer matches the expected classification,
the primary booking is not cancelled, the group is not active, there are no
active non-primary members, an active canonical deposit exists, ticket snapshot
ownership exists, active members carry priced financial fields, or related
finance transactions already exist for the primary/member bookings.

`cancel-empty-stale-group` additionally requires zero active members, exactly one
canonical primary membership, and no membership that points to a missing or
cross-context booking. Ticket snapshots and priced financial fields on any
historical member block the general empty-group strategy. This is intentionally
stricter than checking only active members.

`cancel-empty-stale-group-with-quoted-primary` does not weaken that general
strategy. It permits exactly one priced membership only when all of these
conditions hold simultaneously:

- the group has zero active members;
- the complete membership set contains exactly one booking;
- that one membership is the canonical primary;
- the primary booking is cancelled;
- the primary is the only booking with a non-zero quoted price;
- active deposits, ticket ownership snapshots, and finance transactions are all
  zero;
- the exact full membership allowlist and business context match the fresh
  dry-run.

A quoted booking price is not proof that money was collected. Any actual deposit,
ticket ownership, finance transaction, second membership, or active member blocks
this strategy.

## Stale Group Reconciliation Guarded Apply

Apply exists only for the explicit business decision `CANCEL GROUP` and only for
the strategies above. It must not be used to keep or restore a banquet.
If the decision is `KEEP BOOKING`, do not run this command; create a replacement
through the canonical manager booking-set workflow.

Production apply requires a separate owner approval after a fresh dry-run. The
approval must include:

- exact group ID;
- exact command;
- dry-run summary;
- rollback/compensation plan;
- confirmation token `RECONCILE_STALE_BANQUET_GROUP` for `cancel-stale-group`.

Guarded apply command shape:

```powershell
node scripts/banquet-production-recovery.js reconcile-group-state --group-id=BQ_ID --business-context=event_genix --expected-classification=active_group_cancelled_primary --strategy=cancel-stale-group --allowlist=ACTIVE_NON_PRIMARY_BOOKING_ID[,MORE_IDS] --apply --confirm=RECONCILE_STALE_BANQUET_GROUP --json
```

The `--allowlist` must exactly match the active non-primary member IDs from the
fresh dry-run. If the member set changed, apply blocks before mutation.

For an empty stale group, production approval must instead name confirmation
token `CANCEL_EMPTY_STALE_BANQUET_GROUP`. The operator-side allowlist must contain
the complete current membership booking ID set from the fresh dry-run, including
the cancelled primary booking. Raw IDs remain in the bounded operator command and
must not be copied into chat or the repository:

```powershell
node scripts/banquet-production-recovery.js reconcile-group-state --group-id=BQ_ID --business-context=event_genix --expected-classification=active_group_without_active_members --strategy=cancel-empty-stale-group --allowlist=EXACT_MEMBER_BOOKING_ID[,MORE_IDS] --apply --confirm=CANCEL_EMPTY_STALE_BANQUET_GROUP --json
```

For `cancel-empty-stale-group`, apply changes only the active banquet group to
`cancelled`. It does not update any booking status. A changed membership set,
active member, active deposit, ticket snapshot, priced member, finance
transaction, missing canonical primary membership, or business-context mismatch
blocks the transaction.

For the quoted-primary exception, production approval must name the dedicated
token `CANCEL_EMPTY_STALE_BANQUET_GROUP_WITH_QUOTED_PRIMARY`. Raw IDs remain only
in the bounded operator command:

```powershell
node scripts/banquet-production-recovery.js reconcile-group-state --group-id=BQ_ID --business-context=event_genix --expected-classification=active_group_without_active_members --strategy=cancel-empty-stale-group-with-quoted-primary --allowlist=EXACT_PRIMARY_BOOKING_ID --apply --confirm=CANCEL_EMPTY_STALE_BANQUET_GROUP_WITH_QUOTED_PRIMARY --json
```

This apply also changes only the banquet group status. It never clears the quoted
price or updates the cancelled primary booking. Before production use, obtain a
fresh dry-run and a separate exact production-write approval that names this
strategy and token. Shipping the strategy does not authorize running it.

Apply guards:

- exact group ID and exact business context are required;
- the expected classification must match the selected strategy exactly;
- each strategy requires its dedicated confirmation token;
- active deposits block apply;
- ticket ownership snapshots block apply;
- priced active members block apply;
- finance transactions on the primary or member bookings block apply;
- group/member/booking/deposit/finance state is locked and revalidated inside a
  serializable transaction;
- `cancel-stale-group` cancels only allowlisted active non-primary members before
  cancelling the group;
- `cancel-empty-stale-group` cancels only the group and leaves bookings unchanged;
- `cancel-empty-stale-group-with-quoted-primary` also cancels only the group and
  requires the sole quoted primary to remain unchanged;
- customer rows, primary booking, deposits, history, memberships, and links are
  not physically deleted;
- technical history is written only after the booking/group updates succeed;
- post-apply verification requires group `cancelled` and the strategy-specific
  active member count `0`;
- repeated apply is idempotent and reports `already_applied` when the group is
  already cancelled and the allowlist still matches the strategy-specific member
  set.

After apply, run verification in this order:

1. summary-only audit for the same bounded date range;
2. exact dry-run for the same group;
3. read-only timeline check;
4. read-only banquet details check;
5. confirm no active orphan member remains;
6. confirm unrelated groups were untouched.

Do not store raw production JSON in the repository or chat. Keep evidence
aggregate-only unless an owner explicitly asks for a bounded operator review.

## Railway SSH operator flow
Use the dedicated audit SSH key and the local SSH alias configured for operator
audits. Do not use a personal catch-all key for routine recovery checks.

Before running a command:

1. Verify the SSH host key through the normal OpenSSH known-hosts prompt or an
   already trusted `known_hosts` entry.
2. Run only bounded commands with explicit `--from` and `--to` dates.
3. Prefer `--summary-only` for production status checks.
4. Do not save raw production reports in the repository.
5. Do not print account metadata, private key paths, emails, secrets, or raw
   production identifiers in handoff notes.

Example summary-only audit over the SSH alias:

```powershell
ssh eventgenix-railway-audit node scripts/banquet-production-recovery.js audit --from=YYYY-MM-DD --to=YYYY-MM-DD --business-context=event_genix --summary-only
```

Raw JSON over SSH is allowed only for a bounded operator review:

```powershell
ssh eventgenix-railway-audit node scripts/banquet-production-recovery.js audit --from=YYYY-MM-DD --to=YYYY-MM-DD --business-context=event_genix --json
```

## SSH key lifecycle

The audit key has broader Railway account/workspace scope than a single command.
Rotation or revoke requires separate owner approval.

Generic rotation procedure:

1. Create a new dedicated audit key.
2. Add it to Railway with a date-scoped name.
3. Verify a read-only `node --version` or `audit --summary-only` command.
4. Remove the old key from Railway only after the new key is verified.
5. Update the local SSH alias to the new key.
6. Record only the rotation date and key label, not private key material,
   fingerprints, account metadata, or raw production output.

Next rotation/reconfirmation target: no later than 2026-10-19.
