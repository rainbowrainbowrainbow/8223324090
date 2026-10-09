# EDU-CLOSE-05 — physical acceptance preparation

Production impact: yes, if later product fixes are needed. Actual status: TECHNICAL_PREPARATION_COMPLETE / BLOCKED_DEVICE. No hardware acceptance and no release GO.

## Scope and current candidate

Worktree C:/Users/Plotva/.codex/worktrees/education-close-pack/EventGenix; branch codex/education-close-pack; base a7d074ff0c5fde63158c81e69732c78fc317446c; dirty authorized01–04 source preserved. Node22.23.1/npm10.9.8. Read actual AGENTS.md, README/package, CLOSE handoff, old READY08C14×3 checklist and device guards. No new dependencies, lockfile, schema definition/migration, auth/session/permissions, production setting, version, commit/push/deploy changes. Existing migrations ran only during fresh local DB startup.

Old device runner hardcodes the retained eventgenix_education_ready_devices and previous output/registry. Running it from CLOSE cannot prove current preview and must not overwrite retained records. Decision: new exact closeDevices allowlisted target and CLOSE owner/registry, separate app3015/gateway3016. Shared gateway retains old defaults; explicit CLOSE profile additionally allows POST new customer-child via existing workflow. No account/global staff/provider/money writes through gateway; CRM access model is unchanged. Safe environment allowlist and existing loopback/outbound hold apply.

## Preparation / exact evidence

Output: output/education-ready/close05. Operator instructions: docs/EDUCATION_CLOSE_05_OPERATOR_CHECKLIST_UK.md.

New owned DB eventgenix_education_close_devices, distinct from manual/old devices/disposable. Cluster identity verified against existing READY02 owner/data_directory/loopback55469. Never cloned/reset retained data. Anchor2026-10-07 Europe/Kyiv. Fresh preflight: Dar4 teachers/6 groups/24 children/12 representatives/3 cabinets/36 lessons; total39 bookings with second synthetic business and Park control. Explicit membership5. Repeat start/prepare reuse confirmed with no reseed. Manifest has full source+harness inventories, attempt, plan hash, IDs, independent report totals and anchor. Credentials used privately process-local; stored app credentials only in existing auth storage, no secret evidence output.

| Evidence/category | Actual result |
| --- | --- |
| Focused guard tests |17 PASS/0 FAIL/0 skips: focused-final.log; includes new5 CLOSE tests plus existing12 dataset/device tests. Validator fixtures are not hardware observations. |
| Runtime |PASS runtime.log, Node22.23.1/npm10.9.8 |
| New SQL preflight |PASS preflight.json; independent fixture ownership/relations/oracles |
| Final desktop loopback preflight |3 named technical checks PASS: independent owned SQL, anonymous401, existing visible login→5 terminal tabs; technical-final.log/technical-verification.json. Not5 journeys, not hardware. |
| Personal screenshot review |5 current desktop frames reviewed; visual-review.json; Schedule label overlap remains. No phone screenshots exist. |
| Physical iPhone/Safari/VoiceOver |D01–D14 BLOCKED_DEVICE, model/OS/browser/operator unknown |
| Physical iPad/Safari/VoiceOver |D01–D14 BLOCKED_DEVICE, model/OS/browser/operator unknown |
| Physical Android/Chrome/TalkBack |D01–D14 BLOCKED_DEVICE, model/OS/browser/operator unknown |
| Physical CLI |42 unverified/0PASS/0FAIL, BLOCKED_DEVICE, actual exit2: device-blocked.log/device-verification.json |
| Cleanup |Owned stop exit0; cleanup.json/preview STOPPED. No LAN listener opened during this task; loopback3015 shut. listeners-final.json confirms no3015/3016, only original PG55469 among inspected ports. |
| Retained safety |preservation-start/prepared/stopped compare every public table of both retained DBs, hashes/counts equal; no retained writes. |
| Previous evidence/checkouts |2515 immutable prior CLOSE01–04 artifact hashes and3 other checkout status/diff hashes identical; the shared active PostgreSQL daemon log appended, with its original byte prefix independently verified unchanged, previous-evidence-before/after.json. |
| Protected/parser/diff |protected.log6 blocks PASS; syntax.log PASS; diff-check.log exit0. |

No physical-device/operator session or hardware evidence was supplied after an explicit availability request. PC tool access does not include these physical devices. Step4–7 physical execution/retest cannot be completed autonomously. All42 specific rows are BLOCKED_DEVICE, not PASS. Two-operator physical scenario additionally needs distinct local synthetic accounts through existing authorized Users workflow before device session; no second hardware author is claimed. Physical evidence directory is empty. No reproduced physical defect or product fix is claimed.

## Diagnostic before preflight correction

Symptom: initial navigation preflight returned PASS for tab visibility, but personal screenshot review showed Reports still loading. Expected technical screenshot shows terminal state; actual initial frame was intermediate. Root cause: activeView only and no report-response/terminal-result wait. Initial attempt preserved in initial-preflight-diagnostic including manifest, verification, frames/log/template; classified navigation-only, not final report or physical proof. Added response expectation on actual GET /api/education/reports, terminal summary/reportLoading/attendance options/group teacher readiness and aria-pressed; finite tab animations/font readiness, no arbitrary sleep or CSS overrides. Final technical repeat PASS. A matcher path was corrected before executing the repeat; unrun manifest retained as manifest-unrun-matcher.json, not a failed physical attempt.

Initial focused run also exposed old guard-test error-message mismatch: assertLocalTarget now executes before the old loopback assertion. Wrong DB/confirmation was correctly rejected; clarified the dataset rejection message rather than weakening the assertion. Final17 guard tests PASS. This is harness diagnostics, not a production auth defect.

## Remaining product/release limits

CLOSE04-F01 new-child birthday SQL2020-05-14 versus API/UI2020-05-13 remains open; D02 explicitly covers it. CLOSE04-F02 intermittent minimap stale uncaught rejection remains open. CLOSE04-V01 schedule label overlap remains; current desktop screenshot shows11:30 card over cabinet2 label when visible ruler begins12:00, in addition to prior tablet09:30 variant. No timeline range/source-priority/protected workaround applied. Known defect does not become a physical FAIL until physically observed, and it remains an independent local product defect.

EXISTING_HR_LINK_BLOCKED_DESIGN and BLOCKED_PROTECTED_PRESENTATION remain. Candidate base behind last checked production v0.82.70/ea635cf690ca95a5ff265dbbe90bd71849ffbf47 (CLOSE04 observation, not freshly rechecked05). No production/browser request was needed for this local preparation.

New/changed harness files make the old CLOSE04 strict harness inventory stale. Prior evidence is preserved as a historical checkpoint, not rewritten or presented as current complete acceptance. Runtime product source did not change in05. Future acceptance must rerun software matrix on the exact final source+harness after fixes and integrate current production safely in06.

## Continuation

Operator must supply availability and actual models/OS/browser. Launch a bounded30-minute authenticated LAN session using the exact checklist URL and current private interface; record each of42 rows individually, detailed evidence and real spokenOutput. Independent SQL reads for synthetic IDs must confirm observed saves/conflicts; never repair failed UI through API. After scoped fixes, preserve old attempt, refresh final hashes and repeat affected software+physical scenarios. Stop owned app/gateway at session end and verify preservation/listeners. Preparation is ready; task05 Done-when is NOT satisfied and release remains NO-GO.

Additional final physical-validator negatives:10/10 PASS,0 skips (`negative-report.log`); empty/duplicate/missing device-case inventory, stale attempt/manifest/source/harness, generic PASS without time/evidence and historical observation all rejected. These are validator self-tests, not10 physical journeys. Shared active PostgreSQL log is outside the CLOSE04 accepted evidence index; its append is explicitly recorded in previous-evidence-after.json, no old bytes/proofs rewritten. Initial strict preservation comparison rejected the append before classification; no blanket claim that every runtime log hash stayed identical.

Verification scope: no full npm test, full13-entry software matrix, new CI run, production QA or positive LAN/physical reachability run in05. No product fix occurred; targeted runner safety/parser/protected/desktop preparation checks were used. CLOSE04 source-bound software results remain historical and its harness inventory is now stale. Lease expiry itself was not exercised; actual owned stop and final listener absence were exercised.
