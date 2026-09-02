# EventGenix autopilot drill evidence — 2026-09-02

## Scheduler-triggered heartbeat resume

- Automation: `eventgenix-autonomy-hardening-supervisor`
- Target task: `01a047c0-786c-7fc0-a665-c740bac990ac`
- Drill marker: `HEARTBEAT_DRILL_EG_20260902_5C11641B`
- Scheduler wake observed: `2026-09-02T09:01:21.220Z`
- Decision: `DONT_NOTIFY` because the canary was still inside its TTL.
- Evidence journal: `rollout-2026-09-02T11-57-47-01a06156-b3c5-76a3-98ee-ec3c0ee7d5c0.jsonl`.

The scheduler replayed the heartbeat into the same task without a user message.
The resumed turn inspected the exact canary and deliberately did not perform an
early cleanup. This proves the idle task resume path rather than only the static
supervisor policy simulation.

## Exact canary lifecycle

- Production version at creation: `0.81.59`
- Production SHA: `5c11641b36d7d9e7efbdb8210ac50840fc0b6146`
- Run: `timeline-showcase-20260902-mtjuyxlm`
- Database run ID: `34`
- Registered booking: `BK-2026-1668`
- Expiry: `2026-09-02T09:07:16.051Z`
- Final state: `cleaned`
- Cleanup attempts: `1`
- Registry entity count retained for audit: `1`
- Active booking count after watchdog cleanup: `0`
- Registry ownership mismatch IDs: none

`exactEntityCount` is intentionally the immutable registry inventory. The
controller exposes `activeBookingCount` separately so a cleaned run proves that
no active disposable booking remains while preserving its audit trail.

## Current manual timeline QA run

Run `timeline-showcase-20260902-mtjxp0j8` is separate from the canary. It owns 36
registered bookings (`BK-2026-1669` through `BK-2026-1704`), has complete
registry ownership, and remains active until its four-hour TTL for manual
product-owner review. It must not be cleaned early.

## Lifecycle conclusion

The heartbeat resume and exact watchdog cleanup requirements are proven. The
heartbeat remains active only because the wider EventGenix production Goal is
not complete; it must be disabled after the final Timeline v2 acceptance audit.
