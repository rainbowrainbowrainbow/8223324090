# Catalog image generation

Owner decision2026-11-06: generate catalog images only on an explicit user
command. The nightly stale-image regeneration and its minute interval are
removed from server startup, scheduler exports, due-time policy and the
canonical scheduler surface. There is no replacement automatic trigger.

Existing authenticated manual generation, image-to-image, batch generation and
cover generation endpoints in `routes/catalogs.js` are retained unchanged.
Status polling reads the existing provider task; applying the result is a
separate user operation. This change does not add a provider request or apply
an image in production. Existing catalog images, drafts, historical settings,
provider receipts and scheduler history are retained without a data migration.

Menu product photos, Studio creatives and actual attendance OCR are separate
native CRM features and are not disabled by retiring the catalog refresh job.
Independent Telegram integrations and deferred Hermes task delivery are also
unchanged. Do not use the removed job's old name in `CRM_SCHEDULER_DUE_JOBS` to
try to restore automatic regeneration; restoring it requires reviewed code.

The removed path could select up to10older items per eligible run, but actual
historical invocations and provider charges are unknown. No fixed dollar saving
is claimed. The measurable structural change is one fewer minute interval and
no catalog generation or image overwrite initiated by that retired scheduler.

Manual generation remains subject to the existing KIE and route behavior;
this change is not a new universal manual-request budget or idempotency ledger.
Do not claim complete protection against every repeated manual click from this
scheduler removal alone.

Validation uses the actual server startup harness and actual catalog handlers
with loopback HTTP, synthetic DB/storage and a fake KIE transport. It proves
manual generate→poll→explicit apply remains separate, with no generation on
loading or polling and no implicit apply on provider completion. No paid call
or production catalog write is needed for these checks.
