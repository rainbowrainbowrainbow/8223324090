# Timeline loading, failure and empty states

The resource API previously returned null on failure, the timeline converted it
to an empty roster, and rendering published ready. A successful empty roster
also started a recurring two-second retry. Booking reads could silently reuse
expired snapshots when the response was null or malformed. These behaviors
made an unavailable schedule look like an operationally empty day.

## Behavior

- apiGetLines preserves its legacy nullable default; strict timeline reads opt
  into throwOnError and retain HTTP status and request ID diagnostics.
- Resource and booking reads distinguish a successful array (including [])
  from null, malformed data and network/API errors. Expired cached records
  cannot turn a failed refresh into ready.
- Loading has visible text and aria-busy. Core-source failures show an alert
  and a touch-sized retry; the add-resource action is hidden on failure.
- Retry invalidates both core sources for the selected day or every displayed
  week date, within the captured business context. An obsolete retry handler
  cannot refresh a newer context/view.
- A week becomes ready only after all of its core data has loaded. Any failed
  day shows a retryable week error. Stale week completions/errors cannot
  publish ready or replace a newer day/view.
- Successful empty states explain missing resources separately from missing
  bookings. Status filtering updates both day and week blocks; if it hides all
  rendered bookings, a notice provides the existing reset-filter action.
- Loading no longer starts recurring empty-roster polling. Successful repaint
  preserves the outer vertical reading position; the existing day/week
  horizontal-scroll contract is retained.

Booking identity, source priorities, detail modal ownership and the protected
surface manifest are unchanged. Optional marketing data retains its existing
independent loading contract.

## Verification

- Fourteen new lifecycle cases failed before implementation and passed after
  implementation. Two additional stale-week cases cover late resource and
  booking failures while a newer room/day is ready.
- The focused lifecycle/context/resource/week/regression matrix contains 273
  tests. A pre-existing static week assertion caught an unnecessary change to
  outer horizontal-scroll handling; that change was removed.
- The real-page browser matrix passes eight cases: animator/room, day/week,
  resource/booking failure; widths 390/320 px. Each case clicks retry and the
  filter reset, verifies both sources are reread, then opens a successful empty
  roster. Synthetic API fixtures are intercepted locally; no production writes
  are performed and no backend/database validation is claimed by this suite.
- Error and empty screenshots were visually reviewed. The retry target remains
  inside the 320 px viewport and is at least 44 px tall.
- The protected-surface guard passes. Primary unit tests passed in the first
  full baseline; its UI gate identified an outdated literal-heading assertion,
  which is updated to require both resource and booking failure paths. The
  final release still requires a complete successful baseline and exact-SHA CI.

The browser matrix is included in test:browser:sidebar-timeline, so the existing
GitHub browser gate runs it without changes to workflow permissions or settings.
