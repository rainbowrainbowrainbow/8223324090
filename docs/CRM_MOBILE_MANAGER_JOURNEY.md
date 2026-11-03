# Park mobile manager journey

## Evidenced defects

The program cards were rendered at login, but their selection handler reads a
catalog keyed by the current timeline date and business. After changing the
date, the visible card could belong to the old cache while selection fell back
to a local catalog without that product. Opening a booking now refreshes the
catalog before exposing its cards. Late API responses for a previous date or
business also reload/reuse the current scope instead of replacing its cache.
The regression test covers both successful and failed stale responses.

The late sidebar profile override used 100vw at 320px and covered the entire
dismissal backdrop. Its width now follows the existing 92vw cap. The original
real backdrop-click check in the Omni responsive suite passes unchanged.

The desktop edge-close control also floated over mobile form fields despite
the sticky header already providing a close button. It is hidden at the existing
phone breakpoint. The journey asserts that the header action remains inside the
viewport and the duplicate control cannot cover inputs.

## Real application verification

`npm run test:browser:park-manager:isolated` runs four synthetic journeys against
the application's real HTTP APIs and a runner-verified disposable PostgreSQL
database: animator and room modes at 320px and 390px. It is included after the
existing isolated Omni browser gate, so CI exercises it without workflow or
permission changes.

Each case changes the date, uses the actual sidebar to switch modes, applies a
status filter, clicks a free slot, fills the canonical form and saves. Room
mode uses its guest counts, server ticket quote and explicit preorder warning
confirmation, then the banquet inspector's Details action. The canonical detail
endpoint and stored booking identity are verified independently; a creation
response may already populate the UI's established detail cache.

The test waits for asynchronous customer hydration, closes the detail with
Escape and checks the same date, mode, URL and scroll coordinates within two
pixels. Long promotion titles and the add-event action are checked for geometric
overlap and exercised with real clicks at both phone widths.

Only third-party browser resources are blocked. No business API is mocked.
Fixture dates are in 2099, with uniquely marked synthetic customers, programs,
resources and promotions. The isolated runner owns reset/cleanup and refuses
production targets. No production records are created or modified.

Protected booking source priorities, detail ownership, DB mapping and protected
surface hashes remain unchanged. Final acceptance also requires the combined
baseline, exact-SHA CI, deployment and read-only production proof.
