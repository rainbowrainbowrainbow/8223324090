# D04 — Generic booking linkedTo protected scope

Date: 2026-09-12. Status: **REPRODUCED_NOT_FIXED / BLOCKED_PROTECTED_CHANGE**.
Base: `a5180def01a1e47f8f4fc75e2f7a43092f205828` on
`codex/sys-mb-auth-p0-20260912`, including the cumulative D03 checkpoint and
independent D04 changes. This document is a review proposal, not an authorization.

## Finding and evidence boundary

Severity: **P1 — cross-business reference integrity in an enabled booking module**.

An ordinary platform account with an active Dar `director` business membership
can supply a foreign or missing `linkedTo` to generic booking creation or update.
The current API checks access to the child's business and the child booking, but
does not resolve/lock the supplied parent in that business before persisting it.

This is HTTP-reachable in the local fixture with the actual `apiAuthBoundary`,
`authenticateToken`, `businessScopeWriteGuard`, and `routes/bookings.js` handlers.
The SQL executes in real PostgreSQL; booking SQL and authorization are not mocked.
It is **not** merely a hypothetical future background-caller gap. It is also
**not** a proven live-site exploit: no production site, account, or record was used.

Proved effects: a child in Dar retains `linked_to` identifying a Park record in the
same organization, a record in another organization, or a nonexistent record.
The parent rows were unchanged. Foreign-parent payload disclosure, cross-business
parent mutation/cancellation, and resulting financial side effects were not
demonstrated and must not be claimed from this evidence.

## Exact local reproducer

File: `tests/integration/booking-linkedto-reproducer-postgres.test.js`.

```powershell
wsl -d Ubuntu -u postgres -- env BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST=1 node --test '/mnt/c/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-auth-p0-20260912/tests/integration/booking-linkedto-reproducer-postgres.test.js'
```

The fixture creates a uniquely named `eventgenix_linkedto_test_<uuid>` database.
It refuses production/Railway contexts, accepts only an explicit local test
connection, never falls back to `DATABASE_URL`, blocks outbound HTTPS/provider
fetches, and drops only its own database. Database and connection absence are
checked after cleanup. No credentials or production data are copied into evidence.

Fixture ownership:

| Record | Organization | Business | Actor membership |
| --- | --- | --- | --- |
| `dar-private` | A | `dar` | director |
| `park-private` | A | `event_genix` | none |
| `other-private` | B | `fixture_other` | none |
| `missing-parent` | absent | absent | none |

The actor's platform role is `animator`; no platform creator privilege is needed.
The test builds an ordinary local signed session and verifies fresh business-role
revocation with that same session. Neither token nor identity is printed.

1. GET `/api/bookings/detail/park-private` with the Dar session returns **404**.
2. POST `/api/bookings?businessContext=dar` using the payload below returns **200**:

```json
{
  "id": "BK-9999-9001",
  "date": "2099-01-01",
  "time": "12:00",
  "lineId": "fixture-specialist",
  "duration": 60,
  "room": "Інше",
  "label": "Synthetic linkedTo reproducer",
  "category": "animation",
  "price": 0,
  "linkedTo": "park-private",
  "skipNotification": true
}
```

3. The actual database contains `business_context = 'dar'` and
   `linked_to = 'park-private'` for `BK-9999-9001`.
4. Independently, PUT `/api/bookings/dar-private?businessContext=dar` with
   `{"linkedTo":"park-private"}` returns **200** and persists the same foreign
   reference on the owned booking.
5. Both POST and PUT also succeed for `other-private` and `missing-parent`.

Expected behavior after an approved fix: foreign/missing parent is indistinguishably
unavailable; return a stable 4xx and roll back all child/link/history/side effects.
An owned permitted parent continues to work. The current results are a defect.

## Executed checks

Environment: WSL Ubuntu, Node **22.22.2**, PostgreSQL **16.15**.
Evidence: `.codex-temp/sys-mb-d04/linkedto-postgres.tap`.
The existing protected-surface check also passed: 6 protected blocks, 4 forbidden
needles and 2 regression files. Evidence:
`.codex-temp/sys-mb-d04/linkedto-protected-surface.txt`.

| Scenario | Current result | Meaning |
| --- | --- | --- |
| POST foreign parent in same organization | 200 and persisted | REPRODUCED_NOT_FIXED |
| PUT foreign parent in same organization | 200 and persisted | REPRODUCED_NOT_FIXED |
| POST parent in another organization | 200 and persisted | REPRODUCED_NOT_FIXED |
| PUT parent in another organization | 200 and persisted | REPRODUCED_NOT_FIXED |
| POST nonexistent parent | 200 and orphan reference | REPRODUCED_NOT_FIXED |
| PUT nonexistent parent | 200 and orphan reference | REPRODUCED_NOT_FIXED |
| POST owned parent | 200, correct context/reference | CONTROL_PASS |
| Foreign context, aggregate request, same-JWT role downgrade | 403, no booking/resource/line changes | CONTROL_PASS |

The runner reports 9 passing tests, including its parent test: **six defect
characterizations and two control scenarios**. This is not a security PASS.
Do not add the current characterization assertions to the security gate as proof
of isolation. After an authorized fix, replace them with denial/no-write assertions.

## Exact candidate hunks — not applied

The protected boundary is explicit in `AGENTS.md` under “Protected Booking And
Timeline Contract” and `docs/TIMELINE_PROTECTED_SURFACE.md`: changing the protected
`linkedTo`/`linked_to` write contract needs separate owner approval. D04 explicitly
asks to separate this subpart. Independent D04 service fixes can proceed.

Candidate authorization name: **SYS-MB-D04-LINKEDTO-GUARD-LOCAL**.
Its proposed scope is local validation/transaction ownership, tests and evidence;
no release, production data, schema, pricing, field precedence or UI rendering.

1. **New `services/bookingLinkOwnership.js`:** a transaction-only validator accepts
   the actual queryable, canonical child ID, canonical `linkedTo`, and explicit
   business context. Resolve the parent from `bookings` with the same normalized
   context SQL used by booking routes, lock it for the lifetime of the caller's
   transaction, and reject missing/foreign/self references with a uniform
   `statusCode: 404`, `code: 'BOOKING_LINK_PARENT_UNAVAILABLE'`, and safe public text.
   It must not open a separate pool query or commit the caller's transaction.
   Blank/null behavior stays as the existing write contract; no new snake-case
   precedence or automatic Park fallback is introduced.
2. **`routes/bookings.js`, import block next to booking service imports:**

   ```diff
   +const { assertBookingLinkedParent } = require('../services/bookingLinkOwnership');
   ```

3. **POST `/`, inside the existing transaction immediately after trusted input is
   established and before price/package/resource/customer writes:**

   ```diff
        qaContext = await prepareTrustedQaBookingInput(client, req, b, businessContext);
   +    await assertBookingLinkedParent(client, {
   +        childId: b.id, linkedTo: b.linkedTo, businessContext
   +    });
        if (!qaContext.trusted && !b.linkedTo) {
   ```

4. **PUT `/:id`, after the current scoped child is locked/confirmed and the current
   banquet/ticket guards succeed, before linked-dependent writes or conflict skips:**

   ```diff
        if (wouldPersistAdmissionTicketsOnLinkedBooking(b, oldBooking)) {
            await client.query('ROLLBACK');
            return sendTicketPackageOwnerRequired(res);
        }
   +    await assertBookingLinkedParent(client, {
   +        childId: id, linkedTo: b.linkedTo, businessContext
   +    });
        mergeExistingExtraDataForBookingUpdate(b, oldBooking);
   ```

   Both existing catch paths already roll back and respect `statusCode`. Verify
   deterministic child/parent lock ordering and concurrent parent deletion/context
   update. A transaction retry must re-resolve ownership rather than reuse rows.
5. **Test-only hunks:** convert the six characterizations to stable 4xx/no-write
   assertions; add same-business success/replay, self reference, parent-update/delete
   race, and forced-failure rollback. Check raw SQL snapshots of all affected rows.
   A longer-chain/root-link policy and record-level parent visibility permissions
   require an explicit contract decision; do not silently broaden this patch.

The above are anchored proposed insertion hunks, not an implementation to deploy.
No production code or protected manifest was edited for this subpart. Independent
D04 changes may shift line numbers; use the exact function/statement anchors.

## Preserved contracts and next review

`services/booking.js` remains the row mapper (`linkedTo: row.linked_to`). The generic
write persists the existing camel-case value. `BOOKING_WRITE_ALIAS_PAIRS` currently
covers ticket/banquet/count fields, not `linkedTo`/`linked_to`; do not silently add
an alias or choose new precedence under the ownership fix.

Existing delete/linked-child scans inspected in booking routes include the business
context predicate. That reduces the proven impact but does not repair the invalid
reference accepted on write. This was not a complete cancellation/banquet audit.

Preserve `id`, all timeline/detail field priorities, generated second-animator links,
`mapBookingRow`, timeline projections, modal ownership and
`config/timelineProtectedSurface.js`. If a later implementation truly needs to
change a hashed block, obtain explicit approval for that exact block, add its
regression test, and follow the protected manifest workflow; never refresh hashes
merely to pass CI.

Release readiness remains **HOLD for generic linkedTo integrity** until the guarded
write contract is separately authorized, implemented and verified. This does not
block the independent lead/customer/product service ownership work in D04.
