# Room Domain Audit

Date: 2026-07-17
Scope: original read-only room-domain audit plus pre-release durable room identity follow-up.
Production impact: yes. Schema migration 296 has been applied after explicit owner approval; production backfill has not been applied.

## Executive Summary

Pre-release status: durable `room_resource_id` support is implemented locally and the additive production schema exists. New and edited room bookings now use validated `timeline_resources(type='room')` identity, while legacy `room` text is retained as a display snapshot.

The original screenshot issue was a UX symptom, not a broken physical room: `room-quarantine` is a virtual diagnostic line and should render only when at least one visible booking needs quarantine. That behavior is now covered by focused room timeline tests.

The remaining production boundary is data, not schema or UI code:

- production backfill has not been applied;
- latest dry-run scanned 758 records;
- 737 records are safe automatic mappings;
- 21 records remain unresolved and must stay in quarantine/manual repair;
- 9 room resources will receive one-to-one English legacy aliases during apply.

Do not use the stale `safe=718` approval. The apply boundary is now a fresh dry-run and exact owner confirmation for the current safe count.

## Data Safety

The original audit used live API `GET` requests only. The later migration audit used read-only PostgreSQL access and reports only counts and technical IDs. No customer names, phone numbers, notes, or other PII are included.

## Source Map

Current pre-release source map:

| Area | Current pre-release behavior | Evidence |
|---|---|---|
| Booking form catalog | Dynamic active room resources from `timeline_resources(type='room')`; selected option carries `data-resource-id`. | `js/booking.js`, `js/booking-form.js` |
| Backend room catalog | Active `timeline_resources(type='room')`; operational `ALL_ROOMS` usage/export removed. | `services/timelineResources.js`, `routes/settings.js`, `services/booking.js` |
| Stored booking room | `bookings.room_resource_id` is the canonical identity; `bookings.room` remains display/legacy text. | `db/migrations/296_room_resource_id_schema.sql`, `routes/bookings.js` |
| Banquet group room | `banquet_groups.room_resource_id` mirrors durable group identity; `banquet_groups.room` remains display/legacy text. | `db/migrations/296_room_resource_id_schema.sql`, `services/banquetGroups.js` |
| Booking templates | `booking_templates.room_resource_id` is persisted and validated before template writes. | `routes/booking-templates.js` |
| Recurring templates | `recurring_templates.room_resource_id` is persisted, validated, and copied into generated bookings. | `routes/recurring.js`, `services/recurring.js` |
| Room timeline lines | Keeps virtual `room-takeaway`; keeps `room-quarantine` for matching but hides empty quarantine rows in render. | `routes/lines.js`, `js/timeline.js` |
| Room identity resolver | Uses `room_resource_id` first, then controlled legacy name/shortName/alias fallback, then quarantine. | `services/timelineResources.js`, `routes/bookings.js` |
| Room conflict lock | Advisory lock key uses `business_context + date + room_resource_id`, with controlled legacy fallback only for NULL IDs. | `services/booking.js` |
| Room SQL conflict | Primary conflict query compares `room_resource_id`; text/line fallback is restricted to rows with `room_resource_id IS NULL`. | `services/booking.js` |
| Free rooms endpoint | Park mode availability uses the same active room resource catalog and durable IDs as timeline. | `routes/settings.js`, `services/timelineResources.js` |
| Create/full/edit flows | Backend validates room resource, canonicalizes display room name, and persists `room_resource_id`. | `routes/bookings.js`, `services/timelineResources.js` |
| Frontend submit | Booking form sends selected `roomResourceId` from the dynamic room select. | `js/booking.js`, `js/booking-form.js` |
| Banquet/kitchen paths | Banquet groups, activities, kitchen/member rows carry `room_resource_id` atomically with legacy room text. | `services/banquetGroups.js`, `routes/bookings.js` |

Historical source map below is retained as the original audit baseline before the durable-id implementation.

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

## Final Durable-ID Follow-up

The raw production audit is now closed through direct read-only PostgreSQL access.
Migration 296 added nullable durable IDs without rewriting room text. The latest
dry-run scanned 758 rows: 737 are safe automatic mappings and 21 remain unresolved.
There are no banquet group ↔ primary booking room mismatches.

The exact counts, technical IDs, alias plan and rollback rules are maintained in
`docs/ROOM_ID_MIGRATION_AUDIT.md`.
