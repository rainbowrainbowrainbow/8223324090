# TASK: Banquet Deposit Tests

- Status: proposed after analysis
- Type: implementation task
- Production impact: yes

## Goal

Add regression coverage for the banquet deposit accountant workflow.

## Required Coverage

- Lead stage transition creates one accountant task.
- Re-saving `deposit_received` does not duplicate the task.
- Missing booking creates a blocked/pending handoff state.
- Deposit confirmation rejects missing required fields.
- Verified deposit is saved with banquet context.
- Banquet summary reads confirmed deposit and ignores generic `paid_amount`.
- Finance debt flow still uses `paid_amount/payment_status` separately.
- Access rules protect accountant-only write paths.
- UI static smoke checks include the new visible controls/status.

## Suggested Tests

- `tests/sales-funnel.test.js`
- `tests/lead-booking-link.test.js`
- new focused `tests/banquet-deposit.test.js`
- `tests/booking-digest.test.js`
- `tests/booking-banquet-links.test.js`
- `tests/booking-summary-pdf.test.js`
- `tests/finance.test.js`
- `tests/ui-check.js`

## Verification

```bash
npm run check:runtime
node --test tests/banquet-deposit.test.js
npm test
```
