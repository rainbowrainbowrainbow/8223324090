# TASK: Banquet Deposit Summary And PDF Projection

- Status: proposed after analysis
- Type: implementation task
- Production impact: yes

## Goal

Make banquet summary/PDF use accountant-confirmed deposit data without regressing the current client document contract.

## Recommended Scope

- Extend `services/banquetSummary.js` to read canonical deposit projection.
- Preserve current warning behavior:
  - no explicit deposit means `deposit_not_specified`;
  - `paid_amount` alone must not become deposit.
- Decide per mode whether deposit details appear in PDF/client view.
- Keep current tests that expect compact finance rows aligned with product decision.
- If compatibility is needed, map canonical deposit into the existing summary `deposit` object.

## Non-Goals

- Do not change finance transaction creation.
- Do not reintroduce older finance row layouts unless product explicitly wants that.

## Acceptance Criteria

- Summary `deposit.source` indicates canonical confirmed deposit source.
- PDF/client mode does not accidentally expose internal accountant metadata.
- Existing no-deposit and paid-amount-warning tests still pass or are intentionally updated.

## Verification

```bash
npm run check:runtime
node --test tests/booking-digest.test.js
node --test tests/booking-summary-pdf.test.js
node --test tests/booking-banquet-links.test.js
```
