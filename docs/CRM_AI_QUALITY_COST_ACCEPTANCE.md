# AI quality and cost acceptance handoff

Prepared 2026-11-01 in D:\Codex\EventGenix\quality-cost-acceptance.
See REPORT.md, SOURCES.md and README.md in that directory for exact criteria,
current official pricing, reproducible commands and limitations.

Owner decision: square creative review drafts are sufficient for this stage.
Finished stories/print dimensions are not a blocker for the current square-draft
pilot. Existing reference-editing jobs and unrelated Hermes functions are not
cancelled by that decision.

OCR candidates: gpt-5.6-luna and gpt-5.4-mini-2026-03-17. Image candidates:
gpt-image-2.5-flare-2026-09-08 and gpt-image-2.5-sunburst-2026-09-08. These are
unmeasured trial candidates, not approved production defaults. The current
repository image fallback gpt-image-1-mini is scheduled for shutdown on
2026-12-01: [official deprecations](https://developers.openai.com/api/docs/deprecations).
Actual production model overrides and AI billing remain unverified.

Six synthetic PNG source documents and two image briefs are prepared. Native
adapters captured 16 request drafts through fake transports. Nine evaluator
tests pass; all real model results remain NOT_RUN. No paid request, production
change, commit, push or deployment occurred. Product code/lockfile unchanged.

Pilot proposal: at most 12 OCR and 4 image calls, serial, n=1, zero automatic
retries; planning reserve $2.1868 under declared token assumptions and proposed
$3 review envelope. This is not a hard API cost cap or spending authorization.
See the report before proposing an actual pilot. Measure usage/latency and cost
per accepted result; unknown/ambiguous charges cannot be counted as zero.

The current adapters drop provider usage from their return values. A local-only
pilot harness with durable call ledger and sanitized receipt capture is now
prepared separately; see CRM_AI_PILOT_EXECUTOR.md. Paid transport remains
inactive pending an explicit scope and dedicated key. Keep production flags disabled.
Representative handwritten/photo samples and external sender reconciliation
remain separate readiness gates. Next task is not started automatically.
