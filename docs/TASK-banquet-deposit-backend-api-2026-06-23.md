# TASK: Banquet Deposit Backend API And Service

- Status: proposed after analysis
- Type: implementation task
- Production impact: yes

## Goal

Create a backend service/API layer that reads and writes canonical banquet deposit confirmations.

## Recommended Scope

- Add `services/banquetDeposits.js`.
- Add route handlers, preferably under banquet/booking context:
  - `GET /api/banquets/by-booking/:bookingId/deposit` or equivalent;
  - `POST /api/banquets/:groupId/deposit`;
  - `PATCH /api/banquet-deposits/:id`.
- Resolve deposit context from lead, booking, and banquet group.
- Validate required accountant fields before `accountant_verified`.
- Normalize payment method to `cash` or `card`.
- Write audit metadata and task action history when confirmation changes task state.
- Return a stable deposit projection for UI and banquet summary.

## Non-Goals

- Do not create finance transactions.
- Do not change lead stage behavior in this task.
- Do not build frontend UX in this task.

## Acceptance Criteria

- API refuses verification without amount, received date, event date, banquet/booking link, client name, and payment method.
- API preserves business context.
- API is idempotent for existing active deposit workflow.
- API exposes display state: missing, needs booking link, pending accountant, verified, corrected.

## Verification

```bash
npm run check:runtime
node --test tests/booking-banquet-links.test.js
node --test tests/booking-digest.test.js
```
