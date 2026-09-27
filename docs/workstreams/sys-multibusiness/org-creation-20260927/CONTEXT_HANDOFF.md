# SYS-MB organization creation handoff

Use `C:\Users\Plotva\.codex\worktrees\sys-mb-org-release-refresh-20260927\EventGenix` and its current `codex/sys-mb-org-release-refresh-20260927` HEAD. Read `RELEASE_MANIFEST.md`, `QA_FIXTURE_AND_CLEANUP.md`, `VERIFICATION_MANIFEST.json`, and the historical 2026-09-23 local implementation report. The previous candidate `b412d34a...` / `v0.82.12` and named 2026-09-23 block are stale; do not push them.

Recheck live/remote/Railway before obtaining a new exact block. No production push, deploy or QA fixture has occurred from this refreshed candidate. The fresh read-only preflight private receipt is at `C:\Users\Plotva\.eventgenix\sys-mb-org-release-refresh-20260927\ORG_CREATION_PREFLIGHT_PRIVATE.json`; do not copy it into Git. The local PostgreSQL lifecycle test was skipped for lack of an owned disposable DB; fixture-based live acceptance remains conditional on an exact cleanup authorization.

MD/CRM cutovers, catalog repair and prior role QA remain already applied and must not be replayed. `observation.startUtc=null`, `PASS_MEASURED=false`, `GLOBAL_MODEL_COMPLETE=false`; keep the existing read-only monitor.
