# Booking Child Dietary Notes Discovery - 2026-07-08

## Status

Discovery only. No database schema, migration, API, auth, secrets, Railway, or production data changes were made.

## Current Flow

- Managers enter child-specific context in `children[].note`.
- Booking customer search now returns `customer.notes` and `children[].note`.
- Booking drawer shows those notes read-only in the right customer context panel.
- Kitchen mode highlights child notes in `Важливо для кухні`.
- Child notes are copied into `bookingNotes` only after the explicit `Додати в примітки кухні` action.

## Current Risk

`children[].note` mixes several meanings in one free-text field:

- allergy or dietary risk;
- "не можна" food restrictions;
- lactose, gluten, nuts, sugar, dyes, or similar restrictions;
- seating, behavior, family, or operational notes;
- manager-only context that is not kitchen-critical.

The current regex/keyword highlight is useful for MVP, but it is not a reliable source of truth for food safety.

## Read-Only Discovery Tool

Use the anonymized audit script before approving schema work:

```bash
npm run audit:child-dietary-notes -- --business-context=event_genix --limit=500
```

Default output is aggregate-only:

- total child notes in scope;
- scanned notes;
- food-safety signal count;
- category counts;
- recommendation.

Redacted snippets require an explicit flag:

```bash
npm run audit:child-dietary-notes -- --business-context=event_genix --limit=500 --samples
```

Safety rules:

- the script opens a read-only transaction;
- it does not write, update, delete, migrate, or backfill data;
- it does not print database credentials or environment values;
- samples redact obvious phone numbers, emails, handles, URLs, and dates;
- do not paste raw production notes into chat, commits, or release notes.

## Audit Run Notes

2026-07-08 Codex local run:

- command: `npm run audit:child-dietary-notes -- --business-context=event_genix --limit=500`;
- result: blocked before reading data because no reachable PostgreSQL connection was available from the local environment;
- observed connection error class: `AggregateError`, code `ECONNREFUSED`, local targets `::1:5432` and `127.0.0.1:5432`;
- no production child notes were printed or committed.

Next required action before schema decisions:

1. Run the aggregate-only command from an environment with read-only DB access.
2. Review counts only first.
3. Use `--samples` only if an operator needs redacted examples for wording patterns.
4. Keep raw child notes out of chat, logs, commits, screenshots, and release notes.

## Recommendation

Keep the current free-text flow for the next release cycle, but treat it as a display and reminder feature, not as structured kitchen safety data.

Do not add a schema migration yet.

Move to structured dietary data only after reviewing real manager wording examples and confirming that operators need filtering, reporting, or kitchen-only checklists.

## MVP Decision Rule

Stay with `children[].note` plus keyword highlighting if:

- notes are mostly informal and short;
- managers only need a visible reminder during booking;
- kitchen does not need reporting or formal sign-off;
- false positives are acceptable because the text is read by a human.

Add structured dietary fields if:

- allergies must be visible consistently on kitchen sheets;
- kitchen needs filtering, export, or separate print sections;
- managers repeatedly write the same dietary concepts in different wording;
- operators need to distinguish "allergy" from "preference" and "behavior note";
- the business wants an audit trail for who added or confirmed a restriction.

## Candidate Data Models

### Option A: Free Text Only

Keep `children.note` as the only field.

Pros:
- no migration;
- no backfill;
- fastest UX;
- preserves current manager workflow.

Cons:
- no reliable filtering;
- no formal allergy distinction;
- keyword matching can miss or over-highlight notes.

### Option B: Dietary Tags On Child

Add structured tags such as `nuts`, `lactose`, `gluten`, `sugar`, `dyes`, `other`.

Pros:
- simple kitchen badges;
- easier filtering and summary display;
- backfill can be partially automated from text.

Cons:
- requires migration and UI changes;
- tags may be too coarse;
- still needs free-text detail for edge cases.

### Option C: Child Dietary Notes Table

Add a dedicated child dietary notes table with fields like:

- `child_id`;
- `type`: `allergy`, `restriction`, `preference`, `medical`, `other`;
- `label`;
- `details`;
- `severity`;
- `created_by`;
- timestamps.

Pros:
- strongest source of truth;
- supports audit and kitchen workflows;
- separates food safety from general notes.

Cons:
- largest implementation;
- requires migration, backfill, UI, tests, and operational training;
- easy to overbuild before real usage is clear.

## Suggested Next Implementation Task

If approved later, start with Option B, not Option C.

Implementation shape:

1. Add structured dietary tags to children.
2. Keep `children.note` unchanged.
3. Show tags above free text in booking customer context.
4. Add a manual "Add from note" helper, not automatic silent migration.
5. Backfill only as a reviewed operator script or manual cleanup, not at startup.

## Protected Areas

Any implementation beyond discovery touches protected areas:

- database schema;
- migration files;
- customer child API contracts;
- booking drawer UI;
- kitchen/banquet summary display.

Schema work needs explicit approval before code changes.
