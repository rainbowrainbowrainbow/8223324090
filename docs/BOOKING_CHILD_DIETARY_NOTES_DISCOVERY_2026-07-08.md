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

