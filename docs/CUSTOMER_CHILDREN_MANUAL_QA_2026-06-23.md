# Customer Children Manual QA - 2026-06-23

Production impact: yes.

## Scope

Manual QA for customer children support, birthday display, client card layout, lead-to-customer projection, booking compatibility, and reload behavior.

## Environment

- Local repository: `codex/timeline-leads-hardening`
- Product version in repo: `0.77.11 - Banquet Sheet Official Design`
- Real CRM DB/API access: not available in this shell
  - `DATABASE_URL`: not set
  - `TEST_URL`: not set
  - `TEST_USER` / `TEST_PASS`: not set
- QA mode used: near-real browser harness with production CSS/classes and representative CRM records.

## Artifacts

- Harness: `output/playwright/customer-children-manual-qa/harness.html`
- DOM result JSON: `output/playwright/customer-children-manual-qa/qa-results.json`
- Desktop screenshots:
  - `output/playwright/customer-children-manual-qa/desktop-three-children-full.png`
  - `output/playwright/customer-children-manual-qa/desktop-long-contact-full.png`
- Narrow screenshots:
  - `output/playwright/customer-children-manual-qa/narrow-three-children-full.png`
  - `output/playwright/customer-children-manual-qa/narrow-long-contact-full.png`

## Records Checked

| Case | Result |
| --- | --- |
| 0 children | Pass - empty children state renders without broken layout. |
| 1 child with birthday | Pass - birthday is visible as `2018-01-01`. |
| 3 children with different birthdays | Pass - 3 rows/cards persist in detail, booking preview, and lead preview. |
| Age-only child | Pass - age is shown, no fake birthday is created. |
| Legacy `Саша 4 роки` | Pass - text is preserved, not treated as birthday. |
| Long client name/phone/social | Pass with one non-blocking visual defect listed below. Header wraps without action overlap. |

## Flow Checks

| Flow | Result |
| --- | --- |
| Create customer | Pass in harness - representative record can be created/rendered with 0/1/3 children. |
| Edit customer | Pass in harness - simulated save/reload keeps 3 children. |
| Lead -> deal -> customer card | Pass in harness - 3 celebrants project to 3 customer children. |
| Customer detail card | Pass - children section renders as a list/cards, not a single field. |
| Booking creation from customer | Pass - multi-child display is preserved, single-child fallback uses first child only for compatibility. |
| Reload after save | Pass - simulated reload keeps child count and birthday values. |
| Desktop width | Pass - no action overlap or clipped children cards found. |
| Narrow width | Pass - header/actions wrap, children stack correctly. |

## Defects Found

1. `BUG CUSTOMER CHILDREN 1 - Child note low contrast in dark mode`
   - File: `docs/BUG_CUSTOMER_CHILDREN_1_CHILD_NOTE_DARK_CONTRAST_2026-06-23.md`
   - Severity: low/medium visual QA defect.
   - Data is present, but child note text is too dark on dark cards.

## Limitations

This QA did not create records in a live CRM database because DB/API credentials are not available in this environment. Live acceptance still needs one pass against a real PostgreSQL-backed CRM with `TEST_USER` / `TEST_PASS` or an operator account.
