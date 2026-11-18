# Proposed production cutover — not authorized or executed

## Fixed destination

- Branch: codex/eventgenix-production.
- Railway project: fortunate-appreciation,
  bc28b46c-d4bc-491c-893a-d8401c633668.
- Environment: production, d9f9b984-d54d-4620-a8bf-c48882ad5158.
- Service name:8223324090; actual Railway service UUID:
  3fb62d4c-2dc2-4701-8e2b-09ce16e188ee.
- Last verified live/remote version0.84.6, base
  b0f6077df31ae1eb5dbd6e5753dcb24619253a79. Revalidate before authorization,
  push and upload. A different live/remote release requires reconciliation.

## Separate real-data action requiring exact Red approval

The owner chose all existing15Park rooms as game zones. The proposed write adds
only metadata.workArea="game_zone" to these exact stable pairs:

| Database ID | resource_id |
|---|---|
|8|room-marvel|
|9|room-ninja|
|10|room-minecraft|
|11|room-monster-high|
|12|room-elza|
|13|room-rastishka|
|14|room-rock|
|15|room-minion|
|16|room-pony|
|17|room-foodcourt|
|18|room-yellow-table|
|19|room-sofa-1|
|20|room-sofa-2|
|21|room-sofa-3|
|22|room-sofa-4|

Precondition for every row: business_context=event_genix, type=room, active=true,
metadata is a JSON object and has no workArea key. Re-read and lock the exact
15rows in one transaction, compare stable pairs and preconditions, and abort the
whole action on any mismatch. Bounded lock/statement deadlines apply. Update only
that key, assert exactly15matching post-values and commit only under the separate
approval. Do not replace the metadata object or alter any booking/customer/person.
Save only IDs/counts/outcomes/hash-bound execution evidence, never private values.

Rollback removes only the added workArea key from these exact15pairs, under fresh
locks and only while its value remains game_zone. Abort on ownership, active-state
or classification drift; do not overwrite later operator decisions. No original
workArea value needs restoration because every audited before-state lacks the key.

The bounded operator is scripts/game-zone-classification.js. Default mode opens
a repeatable-read/read-only transaction and emits only exact resource pairs,
candidate SHA, a sorted metadata snapshot hash and the plan hash. The production
database target fingerprint is shared with the QA operator. No credential is
printed or written. Prepare with --release-sha <candidate>; save only its plan
object to an absolute reviewed JSON path.

Apply requires --mode apply --plan-file <absolute-plan> --approved-hash <hash>
--confirm APPLY_EXACT_GAME_ZONE_CLASSIFICATION. Rollback uses --mode rollback and
ROLLBACK_EXACT_GAME_ZONE_CLASSIFICATION. Both require the plan's exact deployed
SHA/production branch and complete metadata before opening their transaction.
They lock all15stable pairs, verify the full original metadata snapshot, update
only workArea, assert exactly15post-values and preserve all other metadata.
Rollback also rejects unrelated metadata drift; perform it before an application
rollback changes the live SHA. Neither mode is currently authorized for production.

This is an explicit operator data-fix, not an automatic startup migration. No
booking backfill, channel/course row mutation, module toggle or other business
status change is proposed. Chat and Training already belong to the owner-approved
exclusive Park namespace; both modules are already configured there.

## Release and disposable QA requiring the final bounded envelope

After final local checks/commit, choose the next free patch, prepare the exact
candidate and hash-bound controller manifest. State the permitted descendants,
six-hour deadline, maximum three attempts and exact rollback base. Use exact-SHA
CI and the repository manual Railway helper; no raw upload/settings change.

The envelope must separately specify registered disposable test accounts, staff
cards, dates/resources, counts and TTL for instructor and administrator profession
saves. Existing Anya/Alina/instructor records are diagnostic-only and cannot be
edited. Synthetic records may not send Telegram/push/messages to real recipients,
create invoices/payments or change real compensation. Cleanup may target only
that approved run's registry-owned IDs.

Application rollback uses the documented guarded helper and the recorded prior
live base. The metadata rollback above is independent. Do not claim a deployed
rollback point or live proof before the corresponding actions actually occur.

## Read-only Railway preflight

2026-11-18: all three production services online, zero warnings/criticals and
zero recent failures. CRM deployment cf86d5cc-df5e-436f-bb59-6b517f74a296 succeeded.
Railway reports an old staged empty patch83f07c85-3186-498d-a7df-506f40c99246
(2026-11-14, zero changes); no settings were accepted, modified or cleared. Verify
its state again; a new/nonempty/applying operation is release drift.
