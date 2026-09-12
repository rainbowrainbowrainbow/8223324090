# VBP-R5 Release QA — paired-only Viber Personal Bridge

Date: 2026-09-12
Scope: one explicitly paired text chat only.
Production impact: yes.

## Release target

- Version: `0.81.147`
- Label: `Omni: Viber Bridge paired-only release`
- Previous live before R5: `0.81.146` / `1f28c652d7acef20776afd2c664fb73af6c22d42` / `codex/eventgenix-production`
- Runtime scope: Windows user-session bridge, Viber Desktop, one confirmed chat binding.

## Evidence ledger

| Gate | Status | Evidence |
| --- | --- | --- |
| Local targeted JS tests | passed | `node --test tests/omni-viber-personal-bridge.test.js tests/omni-completion.test.js tests/omni-send-truth.test.js` — 69 tests passed. |
| Local observer Python tests | passed | `python -m unittest discover docs/viber-personal-bridge/observer -p test_*.py` — 235 tests passed. |
| Syntax/version checks | passed | `npm run check:version` OK; `npm run check:syntax` — 1155 files passed. |
| Commit SHA | pending | Filled from Git history/final release evidence after push. |
| GitHub CI exact SHA | pending | To be filled after push. |
| Railway deploy | pending | To be filled after manual deploy. |
| Installed Windows runtime | pending | To be filled after runtime install/health. |
| Live paired-chat receive | pending | Requires agreed test messages. |
| Live paired-chat send | pending | Requires agreed test recipient/texts. |
| Fault QA | pending | Restart/CRM outage/lock/RDP/focus/DPI require controlled live window. |
| 24-hour soak | not started | Must not be shortened to a smoke. |

## Rollback

Application rollback target before R5 is `1f28c652d7acef20776afd2c664fb73af6c22d42` on `codex/eventgenix-production`.
No database rollback is planned for this release.
Runtime rollback must use `scripts/viber-personal-bridge-control.ps1 -Action rollback-latest` or the installer rollback artifact, preserving `connector.json`, journal, cursor and account epoch.
Do not delete bridge journal or rebind the chat as a rollback step.

## Out of scope

- Full Viber inbox.
- New unknown contacts.
- Attachments.
- Provider-level delivery receipt; local outbound remains `submitted_unconfirmed` or `unknown` unless a stronger proof is available.


