# VBP-02 — live inbound handoff

## Implemented

- `run_p1_daemon.py` now supports `live_inbound.source_kind="g3_sid"` for the real Windows G3 SID/Qt/SEE reader.
- `source_db_path` is rejected for `g3_sid`; it remains available only for `sqlite_fixture` tests.
- `G3SidReadOnlySource` opens the single private G3 session or an explicit private session path, keeps a retained Viber process guard, uses the reviewed Qt/SEE read-only source, and fails closed on process/source changes.
- `LiveInboundAdapter.scan_once()` now wraps source reads in an optional source scan transaction and converts end-of-scan continuity failures into blocked receive state.
- Runtime preflight now reports G3 session mode, Viber Desktop build match, hidden DB path, and G3 module presence without tokens, reference keys, raw DB paths, message text, or source IDs.
- Runtime packaging now requires and installs the G3 reader modules needed by live capture.
- `g3_state.py` no longer treats the whole user profile as the repository root when copied into the installed runtime.

## Installed local runtime

- Runtime root: `C:\Users\Plotva\.eventgenix\viber-personal-bridge\runtime`
- Private config: `C:\Users\Plotva\.eventgenix\viber-personal-bridge\connector.json`
- Capture journal: `C:\Users\Plotva\.eventgenix\viber-personal-bridge\capture.sqlite`
- Config and runtime backups were created before changes.
- Worker count after restart: 1.

## Current VBP-02 state

- Viber Desktop build detected by runtime preflight: `26.3.2.0`.
- Live source kind: `g3_sid`.
- G3 session mode: auto, single canonical session available.
- Capture journal state after first scan: waiting for enrollment markers.
- Baseline is set; old marker messages before this baseline are intentionally ignored.
- No message text was exported into this handoff.

## Next live action

After this baseline, send the enrollment markers in the already agreed test chat:

1. From the phone/account side: `EGXG3-0B038E78-PHONE`
2. From Viber Desktop in the same chat: `EGXG3-0B038E78-DESKTOP`

Then send the controlled inbound test messages from the phone/account side:

- two different texts;
- the same text twice;
- one emoji message;
- one multiline message.

The expected result is: `reader → capture.sqlite → bridge ledger → CRM ACK`, no duplicate after daemon restart, and `receive_text=true` only after successful enrollment.

## Known limits

- Scope is still paired chats only. Unknown new contacts are not claimed as supported.
- `JOURNAL_FAILED` in the legacy marker observer can occur against the old G3 marker journal; VBP-02 live capture uses a separate `capture.sqlite` journal.
- Send from Omni is still disabled in this block.
