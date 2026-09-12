# Viber Personal Bridge fault QA gate

This gate is for the limited paired-chat Viber Personal Bridge scope. It does not approve arbitrary Viber inbox discovery or production-wide Send.

## Synthetic coverage in this branch

- Pending inbound events survive CRM transport timeout and daemon restart; recovery ACK removes only confirmed events.
- `dispatch_started` commands recover to `unknown` and are never resent automatically.
- Terminal `submitted_unconfirmed`, `failed`, `unknown`, and `rejected` command states are not dispatched again.
- CRM send is blocked unless the active bridge heartbeat also reports `send_text=true`.
- Heartbeat capabilities are sanitized before persistence; arbitrary bridge payload fields are not exposed as diagnostics.
- Journal schema mismatch and journal loss marker block capture instead of silently resetting the cursor.
- Source DB/schema/account/peer changes block receive and revoke send capability.

## Required live QA before daily-use activation

Use one test bridge, one test Windows machine, and only agreed test Viber chats. Record timestamps, bridge version/SHA, Viber Desktop version, Windows scaling, and CRM release SHA.

| Scenario | Expected result | Evidence |
| --- | --- | --- |
| Restart daemon with pending events | No duplicate in Omni; pending events ACK after recovery | Local journal count, CRM conversation, bridge logs without message text |
| 15 minutes without CRM network, then restore | Heartbeat becomes stale/blocked in Omni; pending outbox survives; recovery sends one batch | Omni diagnostics before/after, ACK count |
| Restart Viber Desktop | Capture/Send disabled until source/account/peer is reverified | Block reason in Omni |
| Windows lock/unlock and RDP disconnect | No blind Send; receive either continues or shows stale/gap | Omni heartbeat/scan timestamps |
| Focus change, resize, side panel, DPI 125/150% | UI sender refuses Send unless exact peer/composer/layout/DPI preflight passes | Dispatcher result and no wrong-recipient |
| Manager sends from Omni while user edits manually in Viber Desktop | Composer preflight blocks or Send remains at-most-once; no text mixing | Viber Desktop + phone recipient check |
| Disk full/storage error | Capture/Send fail closed; journal is not truncated; blocked state visible | Block reason, journal file state |
| Journal deleted/corrupted | Capture blocks as `JOURNAL_LOST` or `JOURNAL_SCHEMA_MISMATCH`; no silent cursor reset | Bridge startup output and Omni diagnostics |
| 24-hour soak on test chats | No duplicate, wrong-recipient, silent gap, or blind retry after unknown | Hourly heartbeat/scan/send counters |

## Activation decision

- `GO LIMITED`: all scenarios pass for manually paired verified chats only.
- `HOLD`: any wrong-recipient, duplicate after unknown, silent cursor reset, hidden capture gap, or unsupported Viber Desktop version.
- `NO-GO`: identity uses display name/sidebar position, unknown contacts cannot be safely separated, or UI Send cannot prove exact peer.

## Production release note requirement

A release may ship the code and diagnostics without enabling live Send. Enabling `send_text=true` for a bridge requires the live evidence above for that bridge/account/business tuple.
