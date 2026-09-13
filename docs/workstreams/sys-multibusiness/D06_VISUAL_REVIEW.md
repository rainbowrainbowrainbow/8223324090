# D06 — Visual review of actual local screenshots

Final run: `d06_1789241525527_7d4a50`. Images come from the actual app and disposable PostgreSQL, not HTML fixtures or mocked API responses. All displayed accounts/records are synthetic or local startup catalog rows; no production credentials or customer data were loaded.

The parent visually inspected these exact final images under `output/playwright/sys-mb-d06/d06_1789241525527_7d4a50/`:

| File | Observation |
| --- | --- |
| `membership-390-light-history-viewport.png` | History has visible keyboard focus and selected state within the horizontal tab rail. Close and disabled save footer remain reachable. The canonical dark editor styling persists under light theme. Long organization label is contained in its select. |
| `cabinet-768-dark-viewport.png` | Module choices, unavailable-module disclosure, save/cancel and member account form fit the viewport. Normal document scrolling exposes the lower controls without horizontal clipping. |
| `products-custom-history.png` | Sidebar selects D06 custom business; heading/eyebrow use its registry name, two custom-owned synthetic cards are visible, no MD-specific timeline action is shown. The wide page uses its existing layout. |

The browser scenario also checked light/dark at 390/768/1440 through native theme toggle, keyboard focus, hit-testing/reachability and document overflow assertions. Full-page and viewport images for each combination are preserved. Those executable checks are separate from the three parent visual inspections above. Additional browser reviewer observations and exact artifacts are in `D06_BROWSER_REPORT.md`.

The parent also reviewed the earlier Dar wrong-context screenshot, the corrected Dar page and B02/B10 failure screenshots. Earlier images remain historical evidence, not substitutes for the final source-bound run. The B10 diagnostic screenshot showed Dar timeline when the test expected Profile; source analysis established its early-login navigation precondition error. The separate historical B02 click issue remains OPEN_UNCONFIRMED_ROOT_CAUSE.

External fonts/analytics and service workers were blocked, so this is not live-site typography/cache/offline certification. Network diagnostics remain FAIL as reported separately; visually readable pages do not clear those errors or the access-isolation blockers.
