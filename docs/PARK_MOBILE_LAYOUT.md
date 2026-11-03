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
Education layout and booking identity/detail contracts are unchanged.

`tests/browser/park-mobile-layout-browser-smoke.js` uses synthetic API fixtures
with an all-day promotion, timed events and ordinary Ukrainian resource names.
It covers 320/390-pixel phones and 1440-pixel desktop, animator/room views,
day/week periods, light/dark themes, expanded marketing and horizontal scrolling.
Assertions check initial label/grid separation, section separation, consistent
gutters, readable phone labels, page containment, and sticky-label opacity/hit ownership.
Screenshots still require visual review; numerical assertions alone do not certify
the whole mobile experience. The test runs in the existing sidebar/timeline CI job.
