# Banquet Production Recovery

This runbook covers historical pinata membership inconsistencies and banquet
groups that have no canonical deposit record.

## Safety boundary

- Deploy and verify the booking reconciliation code before running this process.
- The audit command is read-only and always uses `BEGIN TRANSACTION READ ONLY`.
- The recovery command is dry-run by default.
- Production apply requires both an explicit pair allowlist and
  `--apply --confirm=ATTACH_CONFIRMED_PINATAS`.
- The confirmation token is only a technical guard. A separate explicit owner
  approval for production data mutation is still required.
- The tool never creates, estimates, or updates a deposit.
- Reports contain technical booking/group identifiers, dates, rooms, and a
  one-way match fingerprint. They do not query or print customer names, phone
  numbers, social handles, or secrets.

## 1. Read-only audit after deploy

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

## 2. Build the confirmed allowlist

After an operator reviews every exact candidate, create a comma-separated list:

```text
PINATA_BOOKING_ID:BANQUET_GROUP_ID,PINATA_BOOKING_ID:BANQUET_GROUP_ID
```

Use only technical IDs copied from `pinatas.exactMatches`. Do not copy customer
data into tickets, command history, or recovery logs.

## 3. Recovery dry-run

```powershell
npm run repair:banquet-pinatas -- --pairs=PINATA_ID:BQ_ID --business-context=event_genix --json
```

Every row must be `ready` or `already_applied`. The command blocks when:

- the target is not an active root pinata;
- customer, date, or room differs;
- another exact active group exists;
- the pinata already belongs to a different group;
- duplicate memberships already exist.

## 4. Production apply

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

## 5. Post-recovery verification

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
