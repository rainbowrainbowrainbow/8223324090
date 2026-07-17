# Room Domain Audit

Date: 2026-07-17
Scope: read-only room-domain audit for Event Genix production and local code.
Production impact: yes, read-only only. No schema, data, booking, or production configuration changes were made.

## Executive Summary

The room system does not need a full rewrite before the quarantine-row UX fix. The current room timeline, room projection, room conflict policy, banquet/kitchen overlap policy, and view isolation are covered by focused tests and those tests pass.

The weak part is the room identity model: park bookings still store the physical room as free text in `bookings.room`. There are three active catalogs that currently match each other locally and in production, but they are not one durable source of truth:

- static `#roomSelect` in `index.html`;
- `ALL_ROOMS` in `services/booking.js`;
- `timeline_resources` rows with `type = 'room'`.

Production API audit found 15 active room resources and no inactive room resources. The active resource names match the static HTML room list and `ALL_ROOMS`.

The screenshot issue is not evidence of a broken physical room. The room timeline always receives a virtual quarantine line from `routes/lines.js`; the UI can show that row even when there are no current problem bookings.

However, real quarantined bookings do exist in historical active production data. The API sample for `2026-02-04` returned one room-timeline booking with `custom_room`. The broader active-primary booking slice also shows 47 rows with old English room names such as `Marvel`, `Ninja`, `Minecraft`, `Monster High`, `Elsa`, `Rock`, `Minion`, `Pony`, and `Food Court`. Those are unambiguous legacy aliases, but production `timeline_resources` currently has no aliases, so the current resolver treats them as custom/unmatched rooms.

Recommended decision:

- Short term: catalog consolidation is enough to fix the visible quarantine-row problem and stabilize the UI.
- Medium term: add legacy aliases for English room names and make room selection use `timeline_resources`.
- Durable rename-safe model: add `room_resource_id` only after explicit approval for schema/backfill work.

## Data Safety

Production audit used live API `GET` requests only. No customer names, phone numbers, booking IDs, notes, or other PII are included in this file.

Direct SQL production audit was not possible in this run because the local secrets file exposes live URL and smoke/creator credentials, but not `DATABASE_URL`, `PGHOST`, or another read-only database connection string.

Because of that, these DB-only checks remain incomplete:

- all raw `bookings.room` rows including linked and cancelled bookings;
- direct `banquet_groups.room` vs `bookings.room` mismatch scan;
- raw `booking_templates` and `recurring_templates` table scan beyond available API results;
- exact all-row `room_resource_id` backfill count, because the column does not exist yet and raw tables were not available.

## Source Map

| Area | Current behavior | Evidence |
|---|---|---|
| Booking form catalog | Static `select#roomSelect` with 15 Ukrainian rooms plus `Інше`. | `index.html:391` |
| Backend legacy catalog | `ALL_ROOMS` duplicates the same 15 Ukrainian rooms. | `services/booking.js:94` |
| Stored booking room | `bookings.room VARCHAR(100)` stores text, not a room resource id. | `db/index.js:119`, `db/migrations/001_initial_schema.sql:26` |
| Banquet group room | `banquet_groups.room VARCHAR(100)` stores copied text. | `db/index.js:842`, `db/migrations/265_banquet_groups.sql:11` |
| Booking templates | `booking_templates.room` stores text. | `routes/booking-templates.js:23`, `db/migrations/075_booking_templates.sql:11` |
| Recurring templates | `recurring_templates.room` stores text and generated bookings use the same text conflict check. | `routes/recurring.js:151`, `services/recurring.js:313` |
| Durable room resources | `timeline_resources` supports stable `resource_id`, `type`, `name`, `short_name`, `is_active`, and `metadata`. | `db/migrations/239_timeline_resource_multi_cabinet_engine.sql:5` |
| Event Genix room seed | 15 room resources are seeded with stable ids such as `room-marvel`, `room-ninja`, etc. | `db/migrations/263_event_genix_room_timeline_resources.sql:5` |
| Room timeline lines | Adds virtual `room-takeaway` and `room-quarantine` before actual rooms. | `routes/lines.js:51`, `routes/lines.js:144` |
| Room identity resolver | Active rooms map by durable id/name/shortName/aliases; inactive/unmatched/custom rooms go to quarantine. | `services/timelineResources.js:432` |
| Room conflict lock | Advisory lock key uses normalized text `room:${context}:${date}:${room}`. | `services/booking.js:133` |
| Room SQL conflict | Conflict query compares exact text `b.room = $2`. | `services/booking.js:398` |
| Free rooms endpoint | Park mode uses `ALL_ROOMS` and exact `bookings.room` text, not `timeline_resources`. | `routes/settings.js:687` |
| Create/full/edit flows | Require non-empty `room`, then write text room into `bookings.room`. | `routes/bookings.js:1390`, `routes/bookings.js:2840`, `routes/bookings.js:3661`, `routes/bookings.js:4915` |
| Frontend submit | `buildBookingObject()` sends `room: formData.room`; park room-first `timelineIdentity` describes the service line, not a durable room id. | `js/booking.js:9589`, `js/booking.js:10162`, `js/booking.js:10293` |
| Banquet/kitchen paths | Banquet activity/member rows inherit or copy text room and use the same room conflict policy. | `services/banquetGroups.js:1239`, `services/banquetGroups.js:1471`, `services/banquetGroups.js:1812` |

## Production API Findings

Environment:

- URL origin: `https://8223324090-production.up.railway.app`
- business context: `event_genix`
- audit range for active primary bookings: `2024-01-01` to `2028-12-31`
- credential class used: creator
- API limitation: `/api/stats/:from/:to` returns active primary bookings only, with `linked_to IS NULL`; it is not a raw all-bookings SQL dump.

Catalog and resources:

| Check | Result |
|---|---:|
| `roomSelect` rooms | 15 |
| `ALL_ROOMS` rooms | 15 |
| Production `timeline_resources type=room` | 15 |
| Active room resources | 15 |
| Inactive room resources | 0 |
| Drift between `roomSelect`, `ALL_ROOMS`, active resource names | 0 differences |
| Production resource aliases | none |

Active primary booking room classification from API slice:

| Classification | Count | Meaning |
|---|---:|---|
| `active_exact` | 249 | Current Ukrainian `bookings.room` text matches one active room resource by name/shortName. |
| `english_legacy_alias_missing` | 47 | Old English room names are unambiguous, but aliases are not configured, so current resolver treats them as custom rooms. |
| `non_operational_other` | 3 | `Інше`; intentionally not a physical room. |
| `blank_room` | 1 | Empty room in active primary API slice. |
| ambiguous | 0 | No room value mapped to multiple room resources. |

Future active primary bookings in the API slice:

- total: 8;
- all 8 use active Ukrainian room names;
- no future English legacy, `Інше`, blank, inactive, or ambiguous room values were found through this API slice.

Room values needing attention in historical active primary data:

- English legacy aliases: `Marvel`, `Ninja`, `Minecraft`, `Monster High`, `Elsa`, `Rock`, `Minion`, `Pony`, `Food Court`;
- non-operational: `Інше`;
- blank: one active primary row in the API slice.

Backfill/readiness estimate from API slice:

| Group | Count | Recommended handling |
|---|---:|---|
| Already exact-matchable to active resources | 249 | Can be linked to stable room resource ids if a future `room_resource_id` column is approved. |
| English legacy names with clear one-to-one mapping | 47 | Add aliases first, or map during an approved backfill. |
| Ambiguous rows | 0 | No ambiguity found in API slice. |
| `Інше` rows | 3 | Do not auto-backfill to a physical room. Keep legacy/display-only or manual repair. |
| Blank room rows | 1 | Requires manual review before any backfill. |

Template API findings:

| Endpoint | Result |
|---|---:|
| `/api/booking-templates` | 0 templates |
| `/api/recurring` | 0 templates |

Live date checks:

| Date | Room bookings | Diagnostics | Lines | Quarantine line | Takeaway line | Free rooms result |
|---|---:|---|---:|---|---|---|
| `2026-07-17` | 0 | none | 17 | present | present | 15 free / 0 occupied / total 15 |
| `2026-07-21` | 3 | `ok: 3` | 17 | present | present | 14 free / 1 occupied / total 15 |
| `2026-02-04` | 1 | `custom_room: 1` | 17 | present | present | 15 free / 0 occupied / total 15 |
| `2099-01-01` | 0 | none | 17 | present | present | 15 free / 0 occupied / total 15 |

Interpretation:

- The quarantine line is always present in `/api/lines` for room timeline: 15 real rooms + `room-takeaway` + `room-quarantine` = 17 lines.
- On dates with no problem booking, this is a UI/display issue if the empty quarantine line is visible.
- Real quarantined booking projection does exist for at least one historical active booking (`custom_room` on `2026-02-04`).

## Flow Review

Create booking:

- `POST /api/bookings` requires date, time, line id, and non-empty room.
- For park room-first mode it does not require an active `timeline_resources` room id.
- Room conflicts are checked by exact room text.

Full/linked booking:

- `POST /api/bookings/full` defaults linked and activity rooms from the main room when omitted.
- It still stores room text and checks conflicts by exact room text.
- Linked technical bookings are excluded from room timeline projection through `projectBookingsForTimelineView()`.

Edit booking:

- `PUT /api/bookings/:id` merges missing room from the existing row.
- If the room or time slot changes, conflict check uses exact text.

Duplicate flow:

- The editable form hydrates `roomSelect.value = booking.room`.
- If a historical value is not in the static list, the frontend adds the current room as a temporary option, preserving the legacy text.

Banquet activity and kitchen paths:

- Banquet group and member rows copy or inherit text room.
- Same-banquet kitchen/activity overlap policy is intentionally allowed where configured.
- Unrelated room conflicts remain strict.

Free rooms:

- In park mode `/api/rooms/free/:date/:time/:duration` still uses `ALL_ROOMS`.
- It does not use `timeline_resources`, so future resource rename/deactivation can drift from the room timeline catalog.

Kitchen:

- Kitchen/menu data is attached to bookings and banquet groups; room identity remains the same text `room` field.
- Kitchen is not a separate room source of truth.

## Risk Assessment

Current production risk:

- Low for future operational bookings in the API slice: future active primary bookings use active Ukrainian room names.
- Medium for historical room timeline dates: old English room names can show as quarantine/custom.
- Medium for future maintenance: room rename/deactivation can break conflict checks and free-room display because conflict identity is text.

Specific risk after renaming a room:

- `bookings.room = old name` and `bookings.room = new name` become different conflict-lock keys.
- SQL conflict checks compare exact text and can miss conflicts between old and new labels.
- `/api/rooms/free` can show incorrect free/occupied state if old bookings use the previous name.
- Room timeline can still display rows through aliases if aliases are configured, but conflicts/free rooms will still be text-sensitive until durable room ids are introduced.

## Recommendation

Do not start with a broad rewrite.

Recommended order:

1. Hide the empty quarantine row in the UI while keeping the quarantine line available for real problem bookings.
2. Add a room-domain contract test that asserts `roomSelect`, `ALL_ROOMS`, and active `timeline_resources type=room` stay aligned.
3. Add English legacy aliases to the 9 affected room resources, or include those aliases in the resolver/config. This should turn historical English rows from `custom_room` into `renamed_room` or active alias matches.
4. Move the park free-room/catalog UI to active `timeline_resources` so settings, room timeline, and free-room chips use one catalog.
5. Only after explicit schema/backfill approval, add nullable `room_resource_id` and move conflict locks/SQL conflict checks to durable room ids with legacy fallback.

Decision on `room_resource_id`:

- Not required to fix the visible quarantine-row issue.
- Strongly recommended before relying on room renames, deactivations, or settings-driven room management in production.

## Verification Performed

Commands run locally:

```powershell
npm run check:runtime
node --test --test-name-pattern "room|Room|кімнат|Кімнат" tests\timeline-resources.test.js tests\booking-create-durability.test.js tests\booking-package-contract.test.js tests\timeline-regression-matrix.test.js
```

Results:

- runtime check passed: Node 22.23.1 / npm 10.9.8;
- focused room/timeline tests passed: 80/80;
- test output includes expected non-critical mocked finance/banquet reconciliation warnings.

Live read-only API checks performed:

- `/api/auth/login`;
- `/api/timeline/resources?type=room&includeInactive=true`;
- `/api/stats/2024-01-01/2028-12-31`;
- `/api/booking-templates`;
- `/api/recurring`;
- `/api/bookings/:date?timelineView=rooms`;
- `/api/lines/:date?timelineView=rooms`;
- `/api/rooms/free/:date/12:00/60`.

## Remaining Gaps

These require read-only DB access or a dedicated safe audit endpoint:

- raw `SELECT DISTINCT room` across all `bookings`, including linked and cancelled rows;
- raw `banquet_groups.room` mismatch report against primary booking rooms;
- exact count of all bookings that would currently get `inactive_room`, `unmatched_room`, or `custom_room`;
- direct validation of any inactive-room bookings if inactive resources are introduced later;
- exact backfill report for a future `room_resource_id` migration.
