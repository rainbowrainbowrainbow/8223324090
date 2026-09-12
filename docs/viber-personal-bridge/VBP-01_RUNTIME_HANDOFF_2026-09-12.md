# VBP-01 — Windows runtime handoff

Status: implementation complete for the recoverable runtime layer. Capture and
Send remain disabled until VBP-02/VBP-04 prove their adapters.

Production impact: local Windows bridge runtime only. No Railway settings,
provider webhooks, production secrets, database schema, journal cursor or account
epoch were changed by this block.

## What VBP-01 fixed

- The repository runtime and installed Windows runtime can now be reproduced from
  one installer script.
- Runtime installation writes a manifest with the source SHA, installed files,
  checksums and config/state presence.
- The daemon has a local `--preflight` mode. It reports modules, state file,
  Viber Desktop executable/build when available, live inbound readiness and
  sender readiness without contacting CRM.
- Missing capture is reported as `CAPTURE_NOT_CONFIGURED`.
- Missing product sender is reported as `SENDER_NOT_CONFIGURED`.
- The installed `.eventgenix` state directory is no longer falsely blocked as
  `STATE_INSIDE_REPOSITORY`; state inside the real repository is still rejected.
- The installer can create a runtime backup, restore the latest backup and keep
  exactly one worker for the selected `connector.json`.
- The daemon keeps a stable local `runtime_id.txt` so a restart does not look
  like a competing second worker to CRM.

## Installed runtime

Default install root:

```powershell
C:\Users\Plotva\.eventgenix\viber-personal-bridge
```

Entrypoint:

```powershell
C:\Users\Plotva\.eventgenix\viber-personal-bridge\runtime\run_p1_daemon.py
```

Private config:

```powershell
C:\Users\Plotva\.eventgenix\viber-personal-bridge\connector.json
```

Private state:

```powershell
C:\Users\Plotva\.eventgenix\viber-personal-bridge\bridge.sqlite
```

Stable local runtime id:

```powershell
C:\Users\Plotva\.eventgenix\viber-personal-bridge\runtime_id.txt
```

Manifest:

```powershell
C:\Users\Plotva\.eventgenix\viber-personal-bridge\runtime\runtime_manifest.json
```

Do not commit or print the private config, state, journals, source DB paths,
tokens or message content.

## Commands

Install or update runtime files while preserving config and state:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-viber-personal-bridge-runtime.ps1
```

Install and restart exactly one worker for this connector:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-viber-personal-bridge-runtime.ps1 -Restart
```

Preflight without contacting CRM:

```powershell
py -3.13 -B C:\Users\Plotva\.eventgenix\viber-personal-bridge\runtime\run_p1_daemon.py --config C:\Users\Plotva\.eventgenix\viber-personal-bridge\connector.json --preflight
```

One transport cycle against CRM:

```powershell
py -3.13 -B C:\Users\Plotva\.eventgenix\viber-personal-bridge\runtime\run_p1_daemon.py --config C:\Users\Plotva\.eventgenix\viber-personal-bridge\connector.json --once
```

Rollback latest runtime backup, preserving config and state:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-viber-personal-bridge-runtime.ps1 -RollbackLatest
```

Rollback and restart one worker:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-viber-personal-bridge-runtime.ps1 -RollbackLatest -Restart
```

## Expected VBP-01 preflight shape

With capture still disabled, preflight should show:

```json
{
  "ok": true,
  "statePathExists": true,
  "liveInbound": {
    "enabled": false,
    "status": "disabled",
    "blockReason": "CAPTURE_NOT_CONFIGURED"
  },
  "sender": {
    "enabled": false,
    "status": "disabled",
    "blockReason": "SENDER_NOT_CONFIGURED"
  }
}
```

`viberDesktop.present=true` means the local Viber Desktop executable was found.
It is not proof that a chat is bound or that messages can be captured.

`--once` returning `ok=true` means the local bridge/account/epoch/business/token
matched CRM well enough for authenticated transport. It is not proof of inbound
capture.

## Handoff to VBP-02

VBP-02 may use this runtime, but must not enable full inbox claims. The next
block should:

- add `live_inbound` to the private config only after a fresh enrollment plan is
  ready;
- keep the existing `bridge_id`, `account_id`, `account_epoch`,
  `business_context`, token, `bridge.sqlite` and any journal/cursor;
- use fresh PHONE/DESKTOP markers after a baseline scan;
- prove one explicitly paired chat first;
- keep `receive_text=false` until a successful live scan imports events to the
  local journal and CRM ACK path;
- leave Send disabled until VBP-04.

If the real Viber source requires Qt/SEE access, do not replace that with the
synthetic SQLite fixture source and call it live. Fixture tests only prove local
logic.
