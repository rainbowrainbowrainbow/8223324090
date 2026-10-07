# EDU-READY-08C — physical-device acceptance preparation

Status: physical iPhone/Safari, iPad/Safari and Android/Chrome are BLOCKED_DEVICE until an operator supplies actual device results. Desktop/LAN preparation is a separate technical preflight, never physical-device PASS. No product fixes have been made; production impact would apply to future demonstrated UI fixes.

## Scope and model recorded before implementation

Continue `C:/Users/Plotva/.codex/worktrees/education-ready-pack/EventGenix`, branch `codex/education-ready-pack-20261003`, base `56fe29bf2134f0d67f1d98b43e8fa0af1c490e2e`. Inherited01–08B changes and evidence stay intact. The primary checkout is untouched.07 Chromium/WebKit proofs do not cover real OS pickers, keyboard, notch, assistive technology or hardware.

Use the existing fixture generator in a third, exact-allowlisted owned database `eventgenix_education_ready_devices`, PostgreSQL127.0.0.1:55469. Its own ownership registry and extra confirmation are required; existing manual/disposable modes stay unchanged. The old preview launcher explicitly manages only its two original databases. The device database uses the unchanged existing schema/migrations and generates realistic fictional records; there is no new migration/schema/auth/role/permission/dependency change. Do not clone/reset the retained manual database. Reopening device preview preserves operator edits; a partial/unregistered DB is a blocker, not an automatic reset.

The actual app listens only on loopback3013 with existing outbound TCP/HTTP/fetch hold and a process environment allowlist. A separate temporary gateway listens only on an explicit RFC1918 Wi-Fi interface, port3014, same subnet; never0.0.0.0, VPN/public address, tunnel or PG LAN exposure. It forwards only to the owned loopback app, preserves the unchanged CRM login, rejects foreign Origin/Host and out-of-scope mutations, disables WebSocket upgrades, and expires after5–90 minutes (default30). No firewall/profile/router/production setting is changed. PC reachability cannot prove reachability from a phone or bypass Wi-Fi client isolation.

Risks/verification: ownership/PID reuse guards; distinct database/seed idempotency; manual full-row hash/preflight before/after; no anonymous education data access; narrow gateway routes; actual UI write→Express→device SQL; no unwanted listeners after stop. Test credentials come only from the local private secrets file or process environment, never evidence/docs/screenshots. Trusted private LAN HTTP is a local test path; HTTPS/service-worker/browser permission behavior is not accepted by it.

## Preflight bug report before correction

The first desktop LAN run passed fixture, anonymous-auth boundary, five tabs and visible date editor, but its group-write scenario failed with a response wait timeout. Expected: the actual visible Save reaches Express and stores a group only in the device DB. Actual: the frontend root request uses `/api/education/groups/`, whereas the gateway allowed `/api/education/groups` only; it returned403 before Express, and the harness response predicate also omitted the trailing slash. Root cause: an overly strict local gateway pathname matcher and an equally strict harness predicate, not a production UI defect. Correct by normalizing trailing slashes for the same allowlisted route and testing both spellings; preserve the first FAIL/exit1 and rerun real UI. Archive confirmation also needs an explicit browser dialog handler. Do not repair the failed UI write through API/SQL.

Stop-guard diagnosis before correction: its first stop returned a false PID-reuse refusal. WMI creation UTC09:01:46 was before the ownership marker2026-10-04T09:01:49Z, but `ConvertFrom-Json` had already decoded the timestamp as DateTime; reparsing its culture-specific string interpreted it as April10. Use the decoded DateTime directly in UTC, or invariant ISO parsing for a string; keep command-path/listener/PID guards. No unrelated process was stopped and the5-minute gateway lease remained active during diagnosis. Verify the corrected actual stop, not a fabricated cleanup marker.

A subsequent stop verified/stopped its loopback app, then encountered a relative parent command path before the app-exit handler finished. The handler itself closed the gateway and produced a real manual-preservation proof; a socket inventory confirmed only the original manual3012/PG55469 remained. The stop tool now waits up to5 seconds for that verified app-exit cleanup before checking a surviving parent. Operator launch instructions use an absolute script path, keeping strict path guards rather than guessing an unrelated process.

## Prepared operator package and actual results

The operator was asked which physical devices are available; no confirmed device/operator session or hardware evidence was supplied in this turn. Do not invent model/OS/browser/capture details. **08C is not complete: all42 physical checks remain BLOCKED_DEVICE,0 PASS.** The access/keyboard/picker/notch/zoom/VoiceOver/TalkBack requirements have not been executed on real hardware.

Owner-facing checklist: `docs/EDUCATION_READY_08C_OPERATOR_CHECKLIST_UK.md`. It contains the absolute launcher command, private test login workflow,30-minute operator lease, stop command,14 cases per device and independent report expectations. Physical template: `output/education-ready/08C/operator-results.json`; evidence directory `08C/evidence/` remains empty. The model, actual OS/browser name/version, operator, physical confirmation and observation date are null. The validator requires the expected actual browser/OS, detailed observations and hashed local evidence; D13 also requires actual spoken output. It rejects absent hardware or unclassified/emulated evidence as proof of PASS. Self-test synthetic validator metadata is not an actual device record.

| Category | Actual result |
| --- | --- |
| New owned device fixture |PASS; `eventgenix_education_ready_devices`, anchor2026-10-04,4 teachers/6 primary groups/24 primary children/3 cabinets/36 primary lessons plus secondary and Park controls; total39 bookings,5 explicit teacher memberships |
| Repeat preparation |PASS; no reseed or duplicates; one UI-created archived group survives, total8 groups;39 owned booking fixture checks remain valid |
| Final desktop LAN technical preflight |6/6 PASS, exit0; `08C/technical-2026-10-04T09-08-28-666Z/verification.json` |
| Focused local-boundary/evidence tests |12/12 PASS,0 skips; `08C-focused-proof-final.log` |
| Preparation evidence verifier |7/7 PASS, exit0, classification TECHNICAL_PREPARATION_ONLY; `08C/preparation-verification.json` |
| Physical iPhone/Safari/VoiceOver |14 BLOCKED_DEVICE; model/OS/browser observation missing |
| Physical iPad/Safari/VoiceOver |14 BLOCKED_DEVICE; model/OS/browser observation missing |
| Physical Android/Chrome/TalkBack |14 BLOCKED_DEVICE; model/OS/browser observation missing |
| Physical evidence validator |BLOCKED_DEVICE,42 unverified/0 passed/0 failed, actual exit2; `08C/device-verification.json`, `08C-device-final-blocked.log` |

The desktop LAN proof checks the real CRM login, anonymous education401, provider/out-of-scope403, cross-origin403, five visible tabs, a visible group create/archive through Express→device SQL, and visible date/duration45 edit controls. It is not a complete functional/device acceptance, native-picker proof or a remote phone reachability test. The first5/6 FAIL/exit1 remains at attempt09-03-16; no API repair was performed. All13 original technical screenshots from both attempts were personally reviewed in a SHA256 contact-sheet manifest, `08C/technical-review/manifest.json`, with explicit desktop-only classification.

Manual preservation is independently proven by exact hashes of all39 full booking rows and the full preflight before/after preparation/start/browser/stop/reuse. Final `08C/listeners-verified-live.json` comes from the current Windows TCP listener inventory: no3013 or3014; only the prior owned loopback manual3012 and PostgreSQL55469 remain. The actual final stop command exited0. Device DB is retained and preview is STOPPED; the LAN URL is a future startup address, not an active service now. Firewall/network profile/router/public tunnel were never changed. Timed lease code is present; an actual timer-expiry run was not claimed because the owned stop ended both preflights earlier.

Initial verifier diagnostics are retained: contact-sheet folder mistakenly selected as a run caused ENOENT/exit1; the selector now accepts only timestamped attempts. A TCP connection timeout to the closed LAN port was correctly treated as insufficient evidence/exit1. The final verifier instead reads the authoritative live Windows listener inventory and fails if any unnecessary device listener remains; it does not equate a remote timeout with successful phone reachability. These are QA-runner corrections, not hardware UI fixes.

## Changed files, commands and continuation

New runner/tools: `scripts/start-education-device-preview.js`, `scripts/stop-education-device-preview.ps1`, `scripts/lib/education-device-gateway.js`, `scripts/lib/education-device-acceptance.js`, `scripts/prepare-education-device-checklist.js`, `tests/browser/education-device-preview-preflight.js`, `tests/education-device-preview.test.js`, `tests/tools/verify-education-device-evidence.js`, `tests/tools/verify-education-device-preparation.js`. Existing harness changes: dataset exact devices-mode confirmation; loopback device-mode guard; original manual launcher explicitly retains its two original databases. Updated report/checklist/handoff. No application product, schema/migration definition, auth/session/permission, dependency/lockfile, production/infrastructure setting, version, commit/push/deploy change.

```powershell
# Execute from this worktree with Node22/npm10.
npm run check:runtime
node --test tests/education-ready-dataset.test.js tests/education-device-preview.test.js
node tests/tools/verify-education-device-preparation.js
# Physical acceptance intentionally exits2 until actual operator results exist:
node tests/tools/verify-education-device-evidence.js
```

All11 changed/new JavaScript harness files parse; protected6 blocks and git diff check PASS. Previous08B evidence consistency remains5/5 PASS on the unchanged product sources/manual dataset. A full `npm test`, CI and production QA were not rerun for08C harness/docs-only work;08B results remain historical/current for their specified sources, not physical-device proof.

Next action: arrange an operator with the available real devices, start a new bounded LAN session using the checklist, collect actual results and review evidence. Missing devices stay blocked individually. If a real defect is reproduced, record its bug/root cause before narrow education edits and rerun the affected functional/browser/device cases. Preserve the old template/proofs before generating a new source-bound run; never simply update hashes to turn old observations into a new PASS. Combined final acceptance is still pending after hardware acceptance.
