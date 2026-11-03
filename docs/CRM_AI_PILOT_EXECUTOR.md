# Local pilot executor handoff

Prepared 2026-11-01 under D:\Codex\EventGenix\quality-cost-acceptance\pilot.
README.md contains commands; REPORT.md describes exact guards and limitations.
Product branch: codex/hermes-independent-preparation; no application source,
schema, provider default, dependency lockfile, production settings or secrets
changed in this task. Square review drafts remain the owner-approved scope.

The local Node 22 tool reuses native OCR/image adapters, commits a per-request
SQLite reservation before network dispatch, captures sanitized usage/IDs and
stores checked results on D. Request keys, source/fixture/model/price hashes and
mode binding prevent silent scope changes or repeated spending. It has no
automatic retry/reclaim/reset or queue processing. Unknown receipt/cost blocks
the pilot and remains unknown; an actual cost over forecast is recorded and
halts future attempts. A planning reserve is not a hard API billing cap.

Default mode is plan; live requires a still-inactive exact-scope authorization
file and a separate CRM_AI_PILOT_API_KEY. Neither was established. The reviewed
proposal has 12 OCR + 4 image calls, reserve $2.1868 under token assumptions and
a proposed $3 envelope; these figures are not spending permission. Production
and Railway contexts are refused. Local SQLite is pilot tooling, not a new
production database/service. The tested node:sqlite API is experimental.

Evidence: 16 complete mock attempts; replay made 0 additional mock sends.
24 focused tests passed (15 executor + 9 evaluator), including a killed child
process, concurrent SQLite sessions, unknown charges, persistence failure,
scope/ceiling/secret/artifact checks. Unauthorized CLI live command is blocked;
fixed live ledger has 0 attempts. Real provider requests/quality remain NOT_RUN.

Read-only status can inspect prior receipts after source drift/approval expiry.
Exports preserve mock/live provenance and require explicit image approval.
Next: obtain a dedicated pilot key and explicit bounded spending/call scope,
recheck rates/access, then separately evaluate live synthetic samples. Do not
enable production flags or retire external Hermes based on mock evidence.
