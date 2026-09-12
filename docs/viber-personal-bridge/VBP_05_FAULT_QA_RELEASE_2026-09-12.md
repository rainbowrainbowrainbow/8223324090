# VBP-05 fault QA and limited activation evidence

Date: 2026-09-12
Scope: Viber Personal Bridge paired-only text bridge for one installed Windows runtime.
Production impact: yes for the CRM release/deploy stage; no provider webhooks, production secrets, Railway settings, or real customer data are changed by this document or the control script.

## Baseline checked

- Live CRM before VBP-05: `0.81.145`, commit `e814942b48ee8254ff8b9b685a3a022d112cb0ec`, branch `codex/eventgenix-production`.
- Local worktree before VBP-05 changes: branch `codex/viber-personal-bridge-production-release-r2`, based on the same commit.
- Installed Windows bridge runtime before refresh: manifest commit `1a51855feb82c880f1558492b13e3b692ba0e657`, installed at `2026-09-12T18:08:13.9601861Z`.
- Installed runtime gap found during VBP-05: old package had no `p1_uia_sender.py`, `Send-P1Controlled.ps1`, `Verify-ActiveMarkerChat.ps1`, or `Inspect-ViberComposer.ps1` in the manifest, so VBP-04 sender code was not actually installed yet.
- Private connector was present, readable, and kept outside the repository. Verification output must show only presence/redacted IDs, never token values or reference keys.

## Operator control

Use this script for safe local bridge operations:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/viber-personal-bridge-control.ps1 -Action status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/viber-personal-bridge-control.ps1 -Action preflight
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/viber-personal-bridge-control.ps1 -Action install -DryRun
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/viber-personal-bridge-control.ps1 -Action install
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/viber-personal-bridge-control.ps1 -Action restart
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/viber-personal-bridge-control.ps1 -Action rollback-latest
```

The script:

- keeps `connector.json`, `bridge.sqlite`, journal, runtime id, cursor, and account epoch untouched;
- does not enable receiving or sending by itself;
- reports installed runtime manifest and missing adapters separately from heartbeat;
- fails closed for `start`, `stop`, and `restart` if Windows process enumeration is blocked;
- redacts bridge/account identities and never prints secrets.

## Fixture evidence already covered by automated tests

| Scenario | Evidence source | Expected result |
| --- | --- | --- |
| Pending inbound events survive restart before ACK | `test_p1_live_inbound.py::test_pending_journal_event_imports_after_restart_before_rescan` | pending event is imported after restart and not lost |
| Duplicate/emoji/multiline inbound after enrollment | `test_p1_live_inbound.py::test_enrollment_captures_text_variants_and_restart_does_not_duplicate_after_ack` | each EventID is one occurrence, ACK clears pending |
| CRM timeout / outage / recovery | `test_p1_transport.py::test_timeout_and_non_200_keep_every_event_pending`, `test_restart_with_pending_events_and_crm_outage_then_recovery_is_at_most_once` | events remain pending during outage and clear only after valid ACK |
| Partial ACK | `test_p1_transport.py::test_partial_ack_is_durable_and_replay_contains_only_remaining_event` | only unacked event is replayed |
| Forged or unknown ACK | `test_p1_transport.py::test_invalid_or_forged_ack_never_changes_local_state`, `test_p1_bridge_core.py::test_changed_source_occurrence_conflicts_and_unknown_ack_is_atomic` | no local state is changed by invalid ACK |
| Timeout/crash after Send boundary | `test_p1_dispatcher.py::test_timeout_after_dispatch_boundary_becomes_unknown_and_never_retries`, `test_p1_bridge_core.py::test_restart_after_dispatch_started_becomes_unknown_without_retry` | command becomes `unknown`; no blind resend |
| Repeated CRM command after terminal unknown | `test_p1_daemon.py::test_pull_reports_existing_terminal_unknown_without_resend` | daemon reports existing status without UI gesture |
| Missing sender adapter | `test_p1_daemon.py`, `test_run_p1_daemon.py`, `scripts/viber-personal-bridge-control.ps1 status/preflight` | `send_text=false` unless sender adapter is installed and configured |

## Manual fault QA checklist

These checks require the real Windows session with Viber Desktop and the paired test chat. Record actual start/end time and exact runtime manifest commit.

| Check | Status | Evidence to record |
| --- | --- | --- |
| Install refreshed runtime without changing config/journal/cursor | pending | status before/after, manifest commit, backup path |
| Restart daemon with pending inbound event | pending live | pending count before restart, same event after restart, CRM ACK |
| 15 minutes CRM unavailable and recovery | pending live | start/end timestamps, no duplicate after recovery |
| Restart Viber Desktop | pending live | capture blocked while unavailable, resumes after Viber returns |
| Windows lock/unlock and RDP disconnect | pending live | heartbeat/receive/send states before/after |
| Focus, resize, DPI 125/150%, side panel | pending live | sender stays blocked or sends only after exact-peer verification |
| Manual Viber Desktop/phone reply during manager work | pending live | no echo/double ingestion, history converges |
| Disposable storage error / journal unavailable | covered by fixtures where possible; pending OS fixture | local error code and no silent data loss |
| 24-hour soak | not started | real duration, message count, gaps, duplicates, wrong-recipient count |

A short run is not a soak. Until the 24-hour soak is actually complete, report it as `not started` or `partial`, never as passed.

## Limited activation boundary

Works and may be activated only when proven on this machine:

- paired-only text receiving for explicitly bound chats;
- paired-only text sending after exact-peer gate;
- at-most-once command handling with `unknown` after uncertain Send;
- diagnostics that distinguish transport heartbeat, receive health, and send capability.

Do not claim these as ready from VBP-05:

- full Viber inbox;
- automatic discovery of all new contacts;
- attachments;
- provider delivery receipts;
- background Windows service in Session 0;
- auto-retry after unknown Send.

## Rollback

Rollback program files only, preserving private state:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/viber-personal-bridge-control.ps1 -Action rollback-latest
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/viber-personal-bridge-control.ps1 -Action restart
```

If rollback is needed after `unknown` Send, do not resend the same command automatically. Inspect the Viber Desktop chat and CRM command state first.
