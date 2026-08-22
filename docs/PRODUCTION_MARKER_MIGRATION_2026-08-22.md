# Production marker migration — 2026-08-22

Production impact: yes during the canonical deploy only.

## Decision

- Canonical production release branch: `codex/eventgenix-production`.
- Previous marker retained for rollback: `codex/checkbox-hardening-release-v080103`.
- Pre-release live version/SHA: `0.81.12` / `a990b668f60e6376439e80cef0a3ade7672dfe37`.
- The v0.81.13 deploy must pass `RELEASE_DEPLOY_BRANCH=codex/eventgenix-production` to the canonical release helper.
- The first deploy from the new marker must additionally pass both `--migrate-live-source-branch-from codex/checkbox-hardening-release-v080103` and `--migrate-live-source-branch-commit <exact previous live SHA>`. The helper accepts this only for a newer application version, complete live metadata, an exact source-branch/SHA match, and a release commit that descends from the live SHA.
- These migration flags are one-time proof inputs, are not present in npm wrappers by default, and must not be reused after `/api/version` reports `codex/eventgenix-production`.
- Do not use raw `railway up`, delete the old branch, or change rollout variables as part of this migration.

## Verification

After deploy, `/api/version` must report the exact green release SHA, version `0.81.13`, `sourceBranch: codex/eventgenix-production`, and complete deployment metadata. `/api/health/deep` must remain healthy.

## Rollback

The immediate code rollback target is `a990b668f60e6376439e80cef0a3ade7672dfe37`. The old Checkbox marker remains unchanged as an additional branch reference.
