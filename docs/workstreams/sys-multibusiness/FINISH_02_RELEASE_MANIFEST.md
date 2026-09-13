# SYS-MB-FINISH-02 production package manifest

Status: **RUNNABLE_PREPARE_PACKAGE / APPLY_HOLD**.

| Item | Value |
| --- | --- |
| Candidate branch | `codex/sys-mb-finish-02-r2-20260913` |
| Verified production base | `4214598e263057b1cb1524d7fb84f328031d288d` (`codex/eventgenix-production`, v0.81.153) |
| Candidate foundation | `7cc3699ac` (FINISH-01 replayed onto that base); FINISH-02 remains uncommitted pending review |
| Required future destination | `codex/eventgenix-production` |
| Migration | `363_multibusiness_cutover_journal_telemetry.sql` — additive schema only |
| Runtime changes | `services/businessCutover.js`, `middleware/auth.js`, `routes/organizations.js` |
| Read-only collector | `final-cutover/tools/business-cutover-preflight.cjs` for `maysternya_doli` and `crm` |
| Mapping input | restricted `final-cutover/mapping/*.template.json`; never commit populated mapping |
| Production writes in this task | 0 |
| Current apply status | HOLD: no real preflight, owner decision, mapping, or exact migration/auth/release/QA authorization |

## Future execution order

1. Run the dedicated read-only collector and store only redacted counts plus snapshot hash.
2. Approve the one decision package and restricted mapping for **one** context.
3. Revalidate current production base, migration ledger, mapping/source fingerprints and Railway target.
4. Obtain an exact one-business auth/migration/data/QA block; prepare journal, apply reviewed mapping in the same transaction, then version/CI/helper deploy/live QA/cleanup.
5. Repeat separately for the second context. Start compatibility observation only after both PASS.

The prepare endpoint never claims a reserved business or writes memberships. There is deliberately no unaudited public apply endpoint in this package.
