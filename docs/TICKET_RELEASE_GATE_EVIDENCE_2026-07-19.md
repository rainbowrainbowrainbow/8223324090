# Admission tickets release gate evidence - 2026-07-19

Release: `v0.79.82 - Admission Tickets Release Gate`

## Local gate

- `node --check scripts/live-ticket-release-gate.js` - passed after removing UTF-8 BOM.
- `node --test tests/ticket-tariff-contract.test.js` - passed, 9/9.
- `node --test tests/booking-package-contract.test.js` - passed, 116/116.
- `npm test` - passed, 2089/2089; UI check passed 1264/1264.

## Committed live gate coverage

- Uses `package.json` or `LIVE_TICKET_QA_EXPECTED_VERSION`; no hardcoded old version.
- Finds a free future weekday and weekend slot before creating a disposable QA booking.
- Verifies manager and senior_manager access paths.
- Verifies ticket tariff matrix:
  - regular child;
  - child under 3;
  - discounted child;
  - birthday child;
  - adult companion;
  - adult game;
  - weekday/weekend;
  - standard/reserved table-room contexts.
- Verifies weekend under-3 blocker.
- Verifies booking time boundary: `20:00` is not offered for non-zero duration.
- Verifies save/reopen/detail/summary/PDF/booking total.
- Captures browser console/page/auth errors and fails on unknown errors.
- Soft-deletes the disposable booking in `finally`.

## Production evidence

To be filled after CI green deployment:

- Release SHA:
- CI run:
- Production URL:
- `/api/version`:
- `/api/health`:
- `/api/ready`:
- `npm run qa:live:tickets -- <production-url>`:
- Cleanup proof:

