# Park timeline mobile layout

The previous acceptance checked reachable controls but missed row geometry.
Sticky resource labels and the marketing panel repeated the scroll padding as
their `left` inset, shifting labels into the time grid by 16 pixels. Phone label
widths of 56/62 pixels also split ordinary names into fragments.

Park labels and the marketing panel now stick at the scrollport's padding edge.
Phones use the existing page gutter without another timeline inset, with a shared
96-pixel label width for daily/weekly labels and their time scales. Resource text
uses 12-pixel type and normal word wrapping. Weekly labels remain visible during
horizontal navigation with an opaque background, so event text cannot show
through pinned daily labels. The empty daily time scale is hidden in the weekly view.
Weekly sections use the viewport width instead of inheriting the daily grid's
pixel width. Each day's own horizontal scroller can therefore move while its
resource labels stay pinned.
Education layout and booking identity/detail contracts are unchanged.

`tests/browser/park-mobile-layout-browser-smoke.js` uses synthetic API fixtures
with an all-day promotion, timed events and ordinary Ukrainian resource names.
It covers 320/390-pixel phones and 1440-pixel desktop, animator/room views,
day/week periods, light/dark themes, expanded marketing and horizontal scrolling.
Assertions check initial label/grid separation, section separation, consistent
gutters, readable phone labels, page containment, actual movement of the intended
time scroller, weekly viewport bounds, and sticky-label opacity/hit ownership.
Screenshots still require visual review; numerical assertions alone do not certify
the whole mobile experience. The test runs in the existing sidebar/timeline CI job.

## CI response-phase synchronization

The release gate exposed a separate race in the Education Today A-B-A fixture.
Its route handler captured the request phase after `route.fetch()` and released
only responses already present in a snapshot of the row array. A late current
response could remain held by the test itself. Capture the phase before fetching
and use latched old/current phase gates instead. Keep the date, four-card,
no-retry and independent SQL identity assertions unchanged. The source-bound
`education-response-phase-gates.test.js` exercises the actual interception code
with independently delayed old and current responses for success/error cases.
