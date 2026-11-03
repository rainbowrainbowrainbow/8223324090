# Omni viewport reconciliation

The shared system-page entrance animation scales mainContent to 1.02 before
returning to 1. A viewport/ResizeObserver callback during that overshoot measures
transformed coordinates and assigns an excessive shell height. Returning to the
final transform does not resize the layout box, so ResizeObserver does not
correct that value. This explains the timing-dependent 320x640 overflow in the
0.83.0 CI attempt.

Omni now recomputes its height when its own mainContent entrance animation ends
or is cancelled. It retains the existing visual-viewport/keyboard calculations,
responsive breakpoints, composer sizing and message-position behavior.

## Reproduction and verification

- The focused browser fixture restarts the real shared-shell CSS animation,
  pauses its overshoot, dispatches the real viewport handler, waits for resize
  observation, then finishes the animation. No synthetic geometry is substituted.
- Three cycles before the fix retained a 550px shell below a 95px header: bottom
  645 on a 640px viewport. Three cycles after the fix produce height 545 and
  bottom 640. The original maximum-bottom tolerance remains two pixels.
- The fixture is included in both the responsive browser suite and the
  PostgreSQL-backed actual-app navigation suite. It is also directly runnable
  with `node tests/browser/omni-viewport-browser-smoke.js` using the existing
  ephemeral Playwright setup.
- Focused Omni behavior/completion/history tests passed: 93 tests.
- Actual-app navigation passed at 1366x768, 390x844, 320x640 and 390x420, including
  drafts, reading position, mode navigation, keyboard reopen, stale responses and
  history failure/retry. The first local run completed those checks but its
  disposable schema cleanup exhausted the local PostgreSQL lock table. The owned
  fixture's lock capacity was corrected; a subsequent complete run exited zero.
- The broader responsive suite exposed a separate existing mobile sidebar
  defect: a late profile CSS override makes the sidebar 100vw at 320px, covering
  the entire dismissal backdrop. Its existing real-click assertion correctly
  fails. That CSS correction belongs to the mobile-manager block and must be
  integrated before claiming the full responsive suite passes.

No provider connectivity is claimed. Database mutations occur only in an owned
loopback disposable fixture. Production remains read-only during preparation.
Final release acceptance still requires a complete baseline, exact-SHA CI,
deployment and live proof.
