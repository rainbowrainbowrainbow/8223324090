# TASK: Menu Photo Bulk Queue Phase 2

- Status: proposed after MVP
- Type: future implementation task
- Production impact: yes

## Goal

Add controlled category-wide or batch menu photo generation after the single
product draft/apply MVP is stable.

## Prerequisites

- Single-item draft/apply/reject API is deployed and verified.
- Booking catalog uses product-applied images from `iconUrl`.
- Hermes single-item menu photo contract is in place.
- Operators have used the manual flow enough to validate prompt quality.

## Recommended Scope

- Propose a governed schema before implementation, likely a
  `product_image_generations` or generic AI job table.
- Track:
  - product id;
  - business context;
  - prompt snapshot;
  - provider/model;
  - status;
  - current attempt;
  - cost/token/image estimate if available;
  - generated image URL;
  - applied image URL;
  - actor;
  - timestamps;
  - error.
- Add a worker or scheduler-safe queue rather than doing bulk work in a single
  HTTP request.
- Add category-level batch creation with explicit count/cost preview.
- Add pause/cancel/retry controls.
- Apply images one by one after review, not as automatic mass overwrite.

## Recommended Architecture

Use a durable DB-backed queue, not an in-memory array and not a long-running
bulk HTTP request.

Recommended MVP table: `product_image_generations`.

Why product-specific instead of a generic AI jobs table for Phase 2:

- lower blast radius;
- simpler ownership by `routes/products.js` and `services/menuPhotoGeneration.js`;
- easier migration governance and cleanup;
- can later be generalized if another AI image workflow proves the same queue
  shape is useful.

The single-item draft/apply/reject contract remains the authority. Bulk queue
jobs should enqueue product-level draft generations and store the result as a
draft under `products.ai_card_draft.imageStudio`; they must not apply
`products.icon_url` automatically.

## Governed Schema Proposal

Create a migration only after explicit approval.

Proposed table fields:

- `id BIGSERIAL PRIMARY KEY`
- `batch_id UUID NOT NULL`
- `product_id VARCHAR(80) NOT NULL`
- `business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix'`
- `prompt_snapshot TEXT`
- `provider VARCHAR(40)`
- `model VARCHAR(100)`
- `size VARCHAR(30)`
- `style VARCHAR(40)`
- `status VARCHAR(30) NOT NULL DEFAULT 'queued'`
- `attempt INT NOT NULL DEFAULT 0`
- `max_attempts INT NOT NULL DEFAULT 3`
- `estimated_cost_cents INT`
- `generated_image_url TEXT`
- `applied_image_url TEXT`
- `draft_json JSONB`
- `error TEXT`
- `created_by VARCHAR(100)`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `started_at TIMESTAMPTZ`
- `finished_at TIMESTAMPTZ`
- `applied_at TIMESTAMPTZ`
- `cancelled_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Recommended constraints/indexes:

- status check: `queued`, `running`, `ready`, `failed`, `cancelled`, `applied`
- unique active job guard for `(product_id, business_context)` where status is
  `queued` or `running`
- index `(business_context, status, created_at)`
- index `(batch_id, created_at)`
- index `(product_id, business_context)`

If production restart survival is required, the worker must claim jobs with
row-level locking such as `FOR UPDATE SKIP LOCKED`.

## API Contract Draft

Admin/product endpoints:

- `GET /api/products/menu-image/bulk/preview`
- `POST /api/products/menu-image/bulk/batches`
- `GET /api/products/menu-image/bulk/batches/:batchId`
- `POST /api/products/menu-image/bulk/batches/:batchId/pause`
- `POST /api/products/menu-image/bulk/batches/:batchId/cancel`
- `POST /api/products/menu-image/bulk/jobs/:jobId/retry`
- `POST /api/products/menu-image/bulk/jobs/:jobId/apply`
- `POST /api/products/menu-image/bulk/jobs/:jobId/reject`

Preview request should accept:

- `businessContext`
- `category` or `menuSection`
- `onlyMissingImages`
- `limit`
- `size`
- `style`

Preview response should include:

- item count;
- products affected;
- estimated image count;
- estimated max cost if available;
- items that already have manual/applied images;
- confirmation token or stable preview hash.

Batch creation must require the preview hash or confirmation token so a stale UI
cannot start a different batch than the operator reviewed.

Hermes endpoints should remain single-item in Phase 2 unless a separate
Hermes-specific bulk confirmation design is approved.

## Worker Contract

Recommended service: `services/menuPhotoQueue.js`.

Responsibilities:

- create preview lists from active kitchen menu products;
- create queued job rows from an explicit confirmed batch;
- claim one or a small number of jobs at a time;
- call `generateAndStoreMenuPhotoDraft`;
- persist draft JSON and generated image URL;
- write the ready draft back to `products.ai_card_draft.imageStudio`;
- mark controlled failures without exposing provider raw responses;
- retry failed transient jobs only within `max_attempts`;
- never write `products.icon_url` during generation.

Scheduling options:

- MVP local admin-triggered worker tick endpoint for manual operation;
- production scheduler job after owner approval, registered in
  `config/schedulerSurface.js` and `docs/SCHEDULER_SURFACE.md`;
- no background scheduler if production storage/cost controls are not approved.

## UI Flow

MVP UI should live in the existing products/menu workspace, not a new standalone
AI Photos page unless operators ask for it after manual usage.

Flow:

1. Select menu section/category.
2. Toggle `Only missing images`.
3. Set limit, size, style.
4. Click preview.
5. Review count/cost/products.
6. Confirm batch.
7. Watch queued/running/ready/failed statuses.
8. Open each ready job preview.
9. Apply or reject one by one.

Do not add one-click apply-all in Phase 2.

## Implementation Plan

1. Schema proposal and migration plan.
2. Queue service with focused unit tests and no scheduler.
3. Preview/create/status API endpoints with role/business-context guards.
4. Manual worker tick for local/admin testing.
5. Product UI batch preview and status list.
6. Apply/reject individual generated jobs through the existing draft apply
   semantics.
7. Optional scheduler-safe worker only after storage/cost behavior is approved.

## Protected Approval Gates

Stop for explicit approval before:

- adding the SQL migration;
- registering any scheduler job;
- enabling production bulk generation;
- changing storage provider or production env vars;
- adding new dependencies;
- adding Hermes bulk actions.

## Non-Goals

- Do not start with full auto-replacement.
- Do not run broad generation without cost and count confirmation.
- Do not use production storage assumptions without owner approval.

## Acceptance Criteria

- Bulk generation can be limited by category and count.
- Each generated photo remains a draft until approved.
- Failed items can be retried independently.
- The queue survives server restarts if production use is expected.
- Operators can see how many images will be generated before starting.
- No endpoint can apply all generated photos in one request.
- Existing manually uploaded/applied images are not replaced unless the operator
  applies a reviewed draft for that specific product.

## Risk Controls

- Cost: require preview and confirmation before enqueue.
- Bad photos: keep draft review and single-item apply.
- Duplicate jobs: unique active job guard per product/context.
- Server restart: durable queue with resumable statuses.
- Slow provider calls: worker claims small batches; HTTP request only starts or
  polls work.
- Provider failures: controlled error field, retry per job, no raw provider
  payload in browser.
- Storage cleanup: add a later cleanup job for rejected/old draft files only
  after storage owner approval.

## Verification

```bash
npm run check:runtime
npm run check:migrations
npm run check:scheduler-surface
npm run check:api-surface
node --test tests/<focused-menu-photo-queue-test>.test.js
npm test
```
