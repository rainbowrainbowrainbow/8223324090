# Room ID Migration Audit

Date: 2026-07-17  
Business context: `event_genix`  
Production impact: yes.

## Current State

The read-only audit is complete and the additive schema migration
`296_room_resource_id_schema` has been applied in production after explicit owner approval.
The migration added nullable `room_resource_id` columns and indexes only. It did not
rewrite `room`, assign room IDs, or modify booking/customer data.

The production backfill has **not** been applied yet. The final dry-run below is the
approval boundary for `--apply`.

## Migration Scope

| Table | Durable field | Legacy snapshot retained |
|---|---|---|
| `bookings` | `room_resource_id` | `room` |
| `banquet_groups` | `room_resource_id` | `room` |
| `booking_templates` | `room_resource_id` | `room` |
| `recurring_templates` | `room_resource_id` | `room` |

`timeline_resources(type='room')` is the canonical catalog. It currently contains
15 active physical room resources. `room-takeaway` remains a virtual non-physical
identity.

No FK was added because template tables do not carry `business_context` and
`timeline_resources.resource_id` is unique only together with `business_context`.
All booking write paths validate context, resource type and active state in the
backend.

## Final Production Dry-Run

Command mode: read-only `--dry-run --json`  
PII included: no  
Customer names, phones and other customer fields were not queried or reported.

| Metric | Count |
|---|---:|
| Scanned | 758 |
| Already assigned | 0 |
| Safe automatic backfill | 737 |
| Unresolved, left unchanged | 21 |
| Banquet group ↔ primary booking mismatches | 0 |
| Catalog resources receiving legacy aliases | 9 |

Safe categories:

| Category | Count |
|---|---:|
| Exact canonical name | 604 |
| Unique legacy alias | 120 |
| Takeaway | 13 |
| **Total safe** | **737** |

Unresolved categories:

| Category | Count | Handling |
|---|---:|---|
| `other_legacy` (`Інше`) | 7 | Do not map to a physical room |
| Mojibake/question-mark value | 8 | Quarantine/manual repair |
| Unknown/custom test value | 5 | Quarantine/manual repair |
| Empty | 1 | Manual review |
| **Total unresolved** | **21** | No automatic update |

Per table:

| Table | Scanned | Safe | Unresolved |
|---|---:|---:|---:|
| `bookings` | 718 | 700 | 18 |
| `banquet_groups` | 40 | 37 | 3 |
| `booking_templates` | 0 | 0 | 0 |
| `recurring_templates` | 0 | 0 | 0 |

## Planned Catalog Alias Repair

The apply transaction will add these one-to-one legacy aliases without changing
current room names or resource IDs:

| Resource ID | Alias |
|---|---|
| `room-marvel` | `Marvel` |
| `room-ninja` | `Ninja` |
| `room-minecraft` | `Minecraft` |
| `room-monster-high` | `Monster High` |
| `room-elza` | `Elsa` |
| `room-rock` | `Rock` |
| `room-minion` | `Minion` |
| `room-pony` | `Pony` |
| `room-foodcourt` | `Food Court` |

The alias change and safe ID assignments run in one transaction. Apply requires both
`--confirm=BACKFILL_ROOM_RESOURCE_ID` and the exact dry-run guard
`--expected-safe=737`.

The earlier owner confirmation for `safe=718` was not used because the guard detected
19 new safe records before apply. Production data remains unchanged pending a new
confirmation for the current `safe=737` snapshot.

## Unresolved Technical IDs

Only technical IDs are listed:

- Empty: `bookings/BK-2026-0179`.
- `Інше`: `bookings/BK-2026-0360`, `BK-2026-0408`, `BK-2026-0409`,
  `BK-2026-0414`, `BK-2026-0457`, `BKML6UY6LC`, `BKML6UY6NZ`.
- Unknown/custom: `bookings/BK-2026-0634`, `BK-2026-0635`,
  `BK-2026-0636`, `BK-2026-0661`;
  `banquet_groups/BQ-MRNNQK0D-9AB1A3F2`.
- Mojibake: `bookings/BK-2026-0663`, `BK-2026-0664`, `BK-2026-0665`,
  `BK-2026-0666`, `BK-2026-0667`, `BK-2026-0668`;
  `banquet_groups/BQ-MROUMZIF-8E5B247C`, `BQ-MROUPBKN-63A9E113`.

These rows remain `room_resource_id IS NULL` and continue through the controlled
legacy resolver/quarantine repair path.

## Room Path Coverage

Durable ID has been carried through:

- create, edit, duplicate, full and linked booking flows;
- banquet group, activity, kitchen and member booking flows;
- booking templates and recurring templates/generation;
- timeline projection and quarantine resolver;
- free-room availability;
- strict conflicts, same-banquet policy and advisory locks.

Primary room conflict identity is `business_context + date + room_resource_id`.
Legacy text/name/short-name/unique-alias fallback is restricted to rows whose
`room_resource_id` is `NULL`. A non-null ID cannot bypass conflict detection after
a room rename.

`ALL_ROOMS` and static HTML room options are no longer used as the park room
catalog. The constant and export have been removed; active
`timeline_resources(type='room')` is the only operational catalog.

## Safety And Rollback

- Schema rollback is documented in migration 296, but the additive columns should
  normally be left in place during a code rollback.
- `bookings.room` and other text snapshots are retained.
- Backfill apply is idempotent and only updates rows where `room_resource_id IS NULL`.
- Unresolved rows are never assigned automatically.
- Do not rollback a completed backfill with destructive SQL; older code ignores the
  additive columns.
