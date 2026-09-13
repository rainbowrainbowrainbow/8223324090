# SYS-MB RECOVER-02 QA inventory

## Local automated evidence already collected

| Check | Status |
| --- | --- |
| `node --test tests/business-cutover.test.js` | PASS 8/8 |
| Disposable PostgreSQL `tests/integration/business-cutover-journal-postgres.test.js` | PASS 2/2 |
| `npm run check:migrations` | PASS |
| `npm run test:unit:business-cabinets` | PASS 84/84 |
| `npm run test:sys-mb` | PASS |
| `npm run test:browser:account-access:mobile` | PASS 1/1 |
| Focused `tests/production-block-controller.test.js` with SYS-MB workflow | PASS |

## Required live QA after deploy/apply

1. Confirm `/api/version` exact SHA, branch, version and release label.
2. Owner account: open business profile, verify four businesses after MD/CRM cutover, no Park/Dar default drift.
3. Director in MD and CRM: access only approved modules/pages/actions for active business.
4. Admin account in MD and CRM: operational admin only; no organization owner controls and no platform creator role.
5. Manager in Maysternya: access only through active MD membership and scoped actions; no CRM/Park/Dar inheritance.
6. Worker/non-member: denied for MD/CRM pages and APIs.
7. Same JWT revoke/role change: next request reflects DB change without relogin wait.
8. Foreign IDs: bookings/customers/leads/tasks/products/finance requests cannot read/write another business.
9. Catalogs: all nine roots remain Park; MD/CRM/Dar cannot load Park global catalogs through active membership.
10. Public links: preserved tokens for the three reviewed Park catalogs show correct safe content; no token regeneration.
11. WebSocket/cross-tab/late response: business switch or revoke cannot repopulate stale data.
12. Responsive UI: account access/business controls usable at 390/768/1440 widths and keyboard navigation works.
13. Compatibility telemetry: after telemetry migration, all required family/context buckets observed; zero allowed compatibility/unknown/missing-context grants before removal.

## Fixture safety

QA may create disposable fixtures only after an exact QA block. Do not create bookings, payments, sends, exports, Telegram actions, or real customer data in production without separate explicit approval.
