# Work-module ownership dependencies

Page presets do not establish ownership of global rows. On2026-11-18 the owner assigned existing Chat and Training data exclusively to Park. No production mutation or release has occurred.

## Approved namespace policy

- Chat channel IDs1–20,27,28: single Park owner (event_genix/business1), preserving channel membership and privacy. The owner delegated this decision because only Park operates now. Mixed participant memberships are not the ownership authority.
- Training course IDs1–31: exclusively Park, explicitly selected by the owner. Their93lectures and7canonical progress rows remain in the same namespace. Empty legacy progress tables are not evidence that account/staff IDs may be conflated on future writes.
- Instructor resources: all15active room-* records, database IDs8–22. Exact production classification is metadata.workArea=game_zone; all audited before-values lack that key, so rollback removes only this key. Execution needs exact Red approval. No historical booking backfill is proposed: none of18missing canonical references is a current/future non-cancelled booking.
- Park already configures chat and training. Required module additions are empty; no business configuration write or other business status change is needed.

Use the existing exclusive-Park legacy namespace pattern with fresh active membership, configured module/page checks and independent record/privacy guards. Per-row owner columns/backfills are unnecessary for this approved single owner. A future additional business requires its own ownership migration; a module toggle must never expose these global tables there.

## Chat: implementation remaining

Current production channels have no per-row business column. Keep the module contained until all of the following agree:

1. HTTP common reads/writes require an active Park membership, page and configured module. Preserve channel membership, DM/assistant privacy and linked-booking visibility/business checks.
2. User/profile/presence/DM/invite targets resolve current Park eligibility. Avoid stale channel-list authorization caches, and constrain reply/thread references to their parent channel.
3. Blob and legacy local attachments require authentication and an authoritative live message/channel relationship. A guessed filename, path channel ID or copied metadata reference cannot transfer ownership. Cover static-file fallback and encoded-path bypasses.
4. Socket subscriptions/delivery, presence, push and background producers retain the same Park/channel/record boundaries. Booking links cannot bypass Chat ownership or expose foreign business records/independent financial fields.
5. Complete actual PostgreSQL/authenticated HTTP, recipient/reconnect/revocation, historical-file and browser desktop/mobile regressions before enablement.

## Training: implemented locally

Every route now requires current Park module/page access. Management uses canonical training.manage; learner progress uses an active canonical staff bridge. Homework retains its historical account-ID contract with assigned/public parents, own-only submissions, reduced DTOs and fresh Park recipients. Telegram delivery/inputs enforce the same current eligibility; private summaries additionally require management permission. See TRAINING_SCOPE.md for proof and remaining release gates.

## Read-only evidence and mutation boundary

Inventory CLIs use bounded repeatable-read/read-only snapshots, statement/lock limits and rollback. Actual production inventory:22Chat channels (17with mixed business principal sets,11with unresolved principals); Training17relations,31seed courses,93lectures,7canonical progress rows and empty legacy attempt/submission tables. Reports contain IDs/counts/flags, not content/names/URLs/secrets. See PRODUCTION_AUDIT_20261118.md.

Ignored owner-review artifacts retain exact IDs, source hashes and recorded policy choices; productionDataMutationAuthorized remains false. Their regeneration refuses inventory drift rather than overwriting approved decisions. Revalidate exact before-state immediately before any approved production write.

## Staff responsibility

Team writes use exactly one active employee profile and the active staff card's company_structure_node_id. Real missing/ambiguous/orphan links are review signals; never repair them automatically or substitute department/profession text. Cross-node leadership needs an explicit business/leader/target-node responsibility relation and exact approval for real-record changes.
