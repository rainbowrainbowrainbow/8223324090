# Admission tickets release gate evidence - 2026-07-19

Release: `v0.79.83 - Admission Tickets Working Hours Gate`

## Prior gate result

- `v0.79.82` passed CI and deployed, but the new production live gate correctly failed the release because the booking UI still offered `20:00` for a non-zero activity duration.
- The disposable QA booking was soft-deleted during the failed run; the report confirmed it was absent from the active timeline.
- `v0.79.83` carries the working-hours/duration fix and keeps the release gate as the acceptance check.

## Local gate

- `node --check scripts/live-ticket-release-gate.js` - passed after removing UTF-8 BOM.
- `node --test tests/booking-working-hours.test.js tests/booking-create-durability.test.js tests/booking-linked-atomic.test.js tests/booking-package-contract.test.js tests/ticket-tariff-contract.test.js` - passed, 198/198.
- `npm test` - run before final commit as the release baseline.

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

- Final release SHA: `7cc9487f4f1030ecb188617ac747289f32b99072`
- Final CI run: `29665611463` - passed.
- Final deployment: `bcf56259-d234-48fc-8c73-1bba515768ec` - Railway production `SUCCESS`.
- Product behavior SHA before tooling hardening: `5fd832a40d45d00c5220f23b4e69e2498c7ed868`
- Product behavior CI run: `29665334978` - passed.
- Product behavior deployment: `0eee3a68-4b27-4e94-9c4a-d8ef1e943b31` - Railway production `SUCCESS`, later superseded by the final tooling deployment.
- Production URL: `https://8223324090-production.up.railway.app`
- `/api/version`: `v0.79.83 - Admission Tickets Working Hours Gate`
- `/api/health`, `/api/ready`, `/api/health/deep`: passed through public live smoke.
- `npm run qa:live:tickets -- https://8223324090-production.up.railway.app`: passed on the final production deployment.
- Cleanup proof: disposable booking `BK-2026-0741` was soft-deleted and absent from the active timeline.
- Expected negative-path browser diagnostics: two `422` resource messages from the weekend under-3 blocker were stored as known/ignored console errors; unknown console/page/auth errors were empty.

