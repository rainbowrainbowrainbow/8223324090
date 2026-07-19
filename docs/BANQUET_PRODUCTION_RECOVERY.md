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
- The QA cleanup command is read-only inventory only. It does not delete
  bookings, groups, links, or deposits.
- The confirmation token is only a technical guard. A separate explicit owner
  approval for production data mutation is still required.
- The tool never creates, estimates, or updates a deposit.
- Reports contain technical booking/group identifiers, dates, rooms, and a
  one-way match fingerprint. They do not query or print customer names, phone
  numbers, social handles, or secrets.

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

## 2. Read-only recovery audit after deploy

Use an explicit bounded date range:

```powershell
npm run audit:banquet-recovery -- --from=YYYY-MM-DD --to=YYYY-MM-DD --business-context=event_genix --json
```

The report separates:

- `pinatas.exactMatches`: one active banquet group matches the pinata by exact
  business context, customer, date, and trimmed room;
- `pinatas.ambiguous`: more than one active group matches;
- `pinatas.standalone`: no active group matches;
- `depositsForManualReview`: active groups with no non-cancelled canonical
  deposit linked by group or primary booking;
- `integrityIssues`: duplicate membership, wrong canonical role, or an exact-key
  mismatch on an existing pinata membership.

Do not turn ambiguous or standalone rows into recovery pairs.

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

Repeat the same read-only audit and save the technical before/after summaries:

```powershell
npm run audit:banquet-recovery -- --from=YYYY-MM-DD --to=YYYY-MM-DD --business-context=event_genix --json
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
record does not prove a deposit amount, date, method, or status. Create or update
a canonical deposit only through the normal manager workflow and only when a
trusted source is available.
