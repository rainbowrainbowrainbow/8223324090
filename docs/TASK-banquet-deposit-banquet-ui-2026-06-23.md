# TASK: Banquet Deposit Status UI

- Status: proposed after analysis
- Type: implementation task
- Production impact: yes

## Goal

Show deposit status directly in the banquet record surface.

## Recommended Scope

- Identify the exact banquet record UI surface before editing:
  - banquet group/member detail in booking detail;
  - banquet list/table if one exists;
  - booking detail warning section;
  - room/timeline banquet detail surface.
- Add a compact deposit status column/field:
  - not specified;
  - pending accountant;
  - needs booking link;
  - verified;
  - corrected.
- Use backend deposit projection only.
- Keep existing design patterns and loading/error/empty states.
- Show amount/date/method only where role visibility allows.

## Non-Goals

- Do not create deposit data from display-only UI.
- Do not duplicate calculation logic in frontend.

## Acceptance Criteria

- Banquet record clearly shows whether deposit is verified.
- Status survives reload because it comes from API.
- Missing deposit does not claim paid state from `paid_amount`.
- UI remains consistent for primary booking and banquet group flows.

## Verification

```bash
npm run check:runtime
npm run test:ui
node --test tests/booking-banquet-links.test.js
```
