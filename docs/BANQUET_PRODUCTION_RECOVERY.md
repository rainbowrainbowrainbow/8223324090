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
- Legacy allowlist QA cleanup is read-only inventory only.
- Marker-based QA cleanup has a guarded apply path for disposable timeline smoke
  records only. It requires exact group scope, disposable markers, serializable
  preflight, post-apply verification, and
  `--apply --confirm=CANCEL_DISPOSABLE_QA_BANQUET`.
- The confirmation token is only a technical guard. A separate explicit owner
  approval for production data mutation is still required.
- The tool never creates, estimates, or updates a deposit.
- Reports contain technical booking/group identifiers, dates, rooms, and a
  one-way match fingerprint. They do not query or print customer names, phone
  numbers, social handles, or secrets.
- Use `audit --summary-only` for routine operator summaries. Raw `--json` output
  is for controlled operator review only and must not be committed, pasted into
  public tickets, or stored in the repository.

## 1. QA cleanup inventory after live QA

After QA evidence is captured, inventory only the safe QA records that were
created for the release:

```powershell
node scripts/banquet-production-recovery.js qa-cleanup --json
```

The built-in allowlist is limited to:

```text
BK-2026-0662,BK-2026-0663,BK-2026-0664,BK-2026-0665,BK-2026-0666,BK-2026-0667,BK-2026-0668
```

The command runs in `BEGIN TRANSACTION READ ONLY` and returns only technical
booking ids, dates, rooms, membership refs, compatibility link refs, and deposit
ids. It rejects `--apply` and rejects booking ids outside the allowlist. Do not
delete QA rows without a separate owner approval for production mutation and a
separate deletion plan.

Additional release QA rows, if any, must be listed separately in the release
handoff and must not be added to this cleanup allowlist without explicit owner
confirmation.

Marker-based cleanup for disposable timeline browser smoke groups uses a
different guarded path. Use dry-run first:

```powershell
node scripts/banquet-production-recovery.js qa-cleanup --run-id=RUN_ID --group-id=BQ_ID --primary-booking-id=PRIMARY_ID --test-customer-marker=MARKER --business-context=event_genix --json
```

The dry-run must report `ready` or `already_cancelled`. It blocks real customers,
active deposits, primary mismatch, foreign business context, and any group member
or linked child booking that does not carry the same disposable QA marker.

Apply is allowed only after explicit owner approval for this exact disposable
group:

```powershell
node scripts/banquet-production-recovery.js qa-cleanup --run-id=RUN_ID --group-id=BQ_ID --primary-booking-id=PRIMARY_ID --test-customer-marker=MARKER --business-context=event_genix --apply --confirm=CANCEL_DISPOSABLE_QA_BANQUET --json
```

After apply, repeat the dry-run. It must report `already_cancelled`. The command
does not physically delete bookings.

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

Use this only for the specific integrity class:

```text
active group + cancelled primary booking + active non-primary members
```

The only supported strategy is `cancel-stale-group`. It is not a restore path.
Do not directly restore a cancelled primary booking. If the business decision is
to keep the banquet, create a replacement through the canonical booking-set
workflow instead of using this strategy.

Read-only dry-run:

```powershell
node scripts/banquet-production-recovery.js reconcile-group-state --group-id=BQ_ID --business-context=event_genix --expected-classification=active_group_cancelled_primary --strategy=cancel-stale-group --json
```

The dry-run requires exact group scope and returns technical state only:

- current group status;
- primary booking status;
- active/cancelled member counts;
- active non-primary member IDs;
- active deposit count;
- ticket ownership conflict count;
- active priced-member conflict count.

Dry-run is blocked when the group no longer matches the expected classification,
the primary booking is not cancelled, the group is not active, there are no
active non-primary members, an active canonical deposit exists, ticket snapshot
ownership exists, or active members carry priced financial fields.

Production apply is intentionally not available in this phase. Adding the apply
path requires explicit owner approval with this exact wording:

```text
Дозволяю додати guarded real-banquet reconciliation apply без його запуску
```

Running production apply later requires a separate approval with the exact group
allowlist, expected before-state, command, rollback/compensation plan, and
confirmation token. Previous SSH audit approval does not authorize this write.

Any future apply must use a serializable transaction, lock and revalidate the
group and member bookings, cancel only the remaining active group members and
the group, avoid physical deletes, write technical history only after successful
mutation, and verify that the group is cancelled and active members are zero.

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
