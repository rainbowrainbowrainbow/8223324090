# Approved local game-zone access change

Owner approval: `Дозволяю блок EG-BASE-ZONES-20261118` on 2026-11-18.
The original proposal artifact retains SHA256
`ADC3BEC1A3EE6EFEBA57C87FFA84CE0B425DCFF7AFB69ECB07BF707C9E23FC43`.
It has been applied locally and completed with membership/module/page checks,
correct bound SQL parameters, additive independent scopes, consistent resource
catalog/room-row/availability filtering and separate contact field checks.
The original patch remains review history, not a patch to apply again.
No production classification, migration or deployment is authorized by this block.

## Why approval is needed

The approved instructor page preset does not authorize unrelated bookings. Current
Park booking visibility supports durable staff/animator assignments and broad
operational views, but has no game-zone scope. Enabling `view_all` for instructors
would exceed the requested model. Adding a new timeline visibility source is
treated as a protected-contract decision under `docs/TIMELINE_PROTECTED_SURFACE.md`.

## Concrete proposed source

Use existing active `timeline_resources` rows of type `room` whose persisted
`metadata.workArea` is exactly `game_zone`, within the server-resolved business.
Use only the existing canonical `bookings.room_resource_id` link. Do not infer a
zone from labels, room text, usernames, profession titles or browser input. The
canonical mapper, modal, detail endpoint and identity priorities stay unchanged.

The companion `game-zone-scope.proposed.patch` records the reviewed server source
and capability wiring. The implementation uses that source contract; it also
filters existing UI resource responses on the server. No alternate frontend
booking renderer or new modal is added. Canonical date-cache/detail endpoint
priorities, mapper identity and eight protected hashes remain unchanged.

## Boundaries

- Default new capability: instructor and senior_instructor only; explicit denials
  continue to win. Operational roles keep their independent existing permissions.
- The capability grants coordination/working details, not contacts, revenue,
  creation, editing, cancellation or export.
- Active business membership, module availability and page permission still apply.
- Missing, inactive, unclassified or cross-business resources yield no grant.
- Existing production resource metadata is not updated by this change.
- No schema migration is needed for the proposed metadata classification.
- Only disposable registered zone resources/bookings may be created for live QA
  after a valid bounded production authorization.

## Required validation after approval

Test instructor/senior instructor plus an explicit deny, primary/additional roles,
revoked membership, cross-business resource IDs, unclassified rooms and inactive
zones. Assert the canonical detail modal opens only allowed zone bookings; inspect
desktop/mobile screenshots and direct API field restrictions. Run protected-surface
guard and full baseline. Never update a protected hash merely to pass the guard.

Local evidence is tracked in STATE.md. Tests first failed before implementation.
Direct PostgreSQL-backed APIs cover both instructor presets, extra roles, explicit
grants/denials, disabled module, revoked membership, inactive/unclassified/foreign
resources and room-text aliases. Actual-app browser tests use both presets at
1280/390, independently call detail API and open the canonical modal using Enter
and click, close with Escape/button and verify trigger focus return. The modal may
correctly use the current-date cache; tests do not change that priority to force
an HTTP request from the opener.

## Existing-data dependency

A read-only inventory must identify which production resource IDs are game zones.
The allowed local live-QA secrets file is unavailable on this host, so this task
has not classified any real resource or identified Nazar's staff/account pair.
Any proposed production metadata updates require an exact ID inventory, before
values and a separately authorized rollback.
