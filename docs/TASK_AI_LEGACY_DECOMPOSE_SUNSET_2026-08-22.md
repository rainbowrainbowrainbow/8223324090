# Legacy task decomposition sunset audit — 2026-08-22

Status: `HOLD_REMOVAL`  
Production impact: no changes made by this audit.

## Scope

The deprecated endpoint is `POST /api/tasks/decompose-draft`.

The internal runtime contract is now:

- AI preview: `POST /api/tasks/ai-draft/preview`;
- single commit: `POST /api/tasks/ai-draft/commit`;
- bundle commit: `POST /api/tasks/ai-draft/bundle/commit`;
- deterministic/template decomposition: `POST /api/tasks/decomposition-draft`.

No runtime frontend file calls the deprecated endpoint. It remains a thin compatibility wrapper while external-consumer evidence is incomplete.

## Evidence snapshot

- observed live version: `0.81.12`;
- observed live SHA: `a990b668f60e6376439e80cef0a3ade7672dfe37`;
- deployment start: `2026-08-22T06:24:45Z`;
- sanitized Railway log checks requested for `24h`, `7d`, and `30d`;
- recognized HTTP calls to the legacy route: `0`;
- recognized legacy telemetry events: `0`;
- raw logs and task text were not stored.

These zero counts are not a complete 30-day proof because the current deployment and available log window are newer than 30 days. They cannot justify endpoint removal yet.

## Removal gate

Removal requires all of the following:

1. a complete agreed non-QA observation window with zero real consumers;
2. sanitized evidence tied to release SHA and time buckets;
3. explicit operator confirmation for the removal commit;
4. full AI/My Day CI after removal.

Until then the wrapper remains deprecated, measured, and excluded from internal frontend usage.

## Current operator command

Use the dedicated legacy usage report instead of a raw Railway pipe:

```bash
npm run task-ai-legacy-decompose-usage-report -- \
  --service 8223324090 \
  --deployment-id <deployment-id> \
  --version <version> \
  --sha <40-char-sha> \
  --source-branch codex/eventgenix-production \
  --deployment-start <deployment-start-iso> \
  --output-prefix output/task-ai-legacy-decompose/<timestamp>-legacy-decompose-<version>
```

The command reads Railway telemetry and HTTP logs in memory and writes only redacted JSON/Markdown artifacts. It intentionally exits non-zero for `HOLD_REMOVAL`, `DOCUMENTED_CONSUMER`, `TELEMETRY_GAP`, or invalid metadata.

Artifact verdicts:

- `READY_FOR_REMOVAL_CONFIRMATION`: complete 30-day window, zero non-QA usage, removal still requires explicit operator confirmation;
- `HOLD_REMOVAL`: the evidence window is incomplete or not enough for removal;
- `DOCUMENTED_CONSUMER`: non-QA usage exists, keep the compatibility wrapper and document the consumer;
- `TELEMETRY_GAP`: HTTP calls exist without matching legacy telemetry, fix collector/instrumentation before any sunset decision;
- `INVALID_ARTIFACT_METADATA`: report is not tied to exact release/deployment metadata and cannot be used as proof.
