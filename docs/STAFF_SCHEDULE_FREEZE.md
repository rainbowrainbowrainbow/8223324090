# Staff Schedule Freeze

Event Genix CRM release: `v0.78.88 - Staff Schedule Commercial Freeze`

This document defines the frozen commercial contract for `staff.html` Staff Schedule. It protects shipped behavior and prevents product drift after freeze.

## Frozen Invariants

1. Period state invariant
   - Header, date inputs, table body, attendance, hours data, export and print must belong to one committed range.
   - A requested range is not active until all required reads for that range succeed.
   - A stale API response must not mutate DOM or `StaffState`.
   - On navigation failure, the last confirmed range and data stay visible, controls return to the confirmed range, and the failed range is shown in a persistent error state.

2. Canonical grouping invariant
   - In `Всі`, one numeric staff ID renders once in its canonical `display_group`.
   - In a concrete department chip, a staff member renders once if primary or secondary profession belongs to that department.
   - Department chip counts are unique staff IDs eligible for that department.
   - The sum of department chip counts may exceed `Всі` because one staff member can have multiple professions.

3. Subgroup and health invariant
   - In `Всі`, subgroup ownership follows primary profession.
   - In a concrete department filter, primary profession wins if it belongs to the department; otherwise the relevant secondary profession is used.
   - One staff member cannot render in two subgroups in the same table render.
   - Health staffing counts use `entry.profession_key` for the shift. Fallback to primary profession is allowed only when the shift has no profession key.
   - Missing readiness source data is neutral, not an operational warning.

4. Export and print parity invariant
   - Export and print use the same final visible staff ID set as the table.
   - Active department, search and committed period are preserved.
   - Duplicate workbook or print rows for the same numeric staff ID are a release blocker.

5. Modal and mobile invariant
   - Cell history commits only for the latest still-open modal identity.
   - Closing a modal invalidates pending history reads.
   - Keyboard focus enters the dialog, stays trapped while open, Escape goes through the existing unsafe-dismiss guard, and focus returns to the opening schedule cell.
   - Browser zoom is not blocked.
   - The page must not have global horizontal overflow at 320, 360 or 390 px; the schedule wrapper owns table overflow.

## Required Test Commands

Run these before shipping any Staff Schedule change:

```powershell
npm run check:runtime
npm run test:staff-schedule
npm test
npm run test:browser:staff-schedule
```

For a production release, run after deploy:

```powershell
npm run release:staff-schedule:verify -- https://<live-crm-host>
```

The release verifier is read-only for Staff Schedule. Restorative write smoke requires a separate QA task, QA records and explicit authorization.

## Allowed Reopen Reasons

Reopen Staff Schedule only for:

- wrong staff/date/status shown or saved;
- stale or missing period data;
- duplicate or missing staff rows;
- save overwrite or modal history race;
- table/export/print staff set mismatch;
- confirmed production mobile, keyboard or accessibility regression;
- security or permission defect.

## Not Accepted Without A New Business Decision

Do not reopen this block for:

- new colors or icons;
- new group layouts;
- new health, forecast or accountability panels;
- new KPI/views;
- new bulk actions;
- changing grouping semantics;
- broad `js/staff-page.js` refactor.

## Protected Surfaces

This freeze does not authorize changes to:

- DB schema, migrations or seed data;
- auth, roles, sessions or permissions;
- secrets, env vars, webhooks or Railway settings;
- shared CI/release-gate wiring.

Any change to those surfaces requires a separate production-impact task and explicit approval.
