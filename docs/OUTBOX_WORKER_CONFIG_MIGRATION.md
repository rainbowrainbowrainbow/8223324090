# Read-only observer: Config as Code to IaC

Prepared 2026-11-03; not applied. This branch is based on the deployed observer
`d9c0b7c81fb81b69ed7d084ff78896a0f58d6843`, not on the main CRM tree.
Never merge or deploy this tree as the main CRM.

## Actual starting state

- Project `bc28b46c-d4bc-491c-893a-d8401c633668`, environment
  `d9f9b984-d54d-4620-a8bf-c48882ad5158`, existing service
  `3e42e8ff-3b75-44f5-91af-010af4918e92` / `eg-tasker-outbox-readonly`.
- Deployment `7ebb9633-7b4b-4403-9b72-d4709b39d72f` is healthy and read-only.
- `ServiceInstance.railwayConfigFile` is null, but deployment metadata identifies
  `/railway.json`: automatic legacy-file discovery is still active.
- Dashboard defaults differ from the effective deployment. IaC must materialize
  NIXPACKS, the exact read-only start command, ON_FAILURE and 3 retries before
  uploading a source artifact without `railway.json`.
- The authenticated plan contains only two safe resource updates for those four
  fields on this existing worker. No resource create/delete or other service.
- No IaC partial currently owns resources. This configuration claims only
  `service.eg-tasker-outbox-readonly`. Future whole-project IaC must account for
  that named partial; do not rename/release it casually.

## Prepared source

`.railway/railway.ts` returns one service and checks exact project/environment
IDs and CLI variables-policy capability. `variables: { managed: false }` excludes
variable management entirely. Source, secrets, replicas, regions, domains,
volumes, healthcheck, cron, sleep and delivery gates are not declared.

The configuration exactly preserves the existing legacy builder/deploy values.
Deleting `railway.json` is local preparation; it is not a production cutover.
The existing branch-only CI workflow is unchanged. Its scope guard accepts this
exact migration branch, pins the reviewed IaC hash, and freezes runtime, package,
lockfile and workflow relative to the deployed observer commit. The same 73
worker/outbox contracts remain required; no test removal or threshold change.

## CLI and SDK details

Use the verified portable Railway CLI 5.71.0 and Node22 on D. Offline evaluation
uses the already cached official `railway@3.16.0` SDK with verified npm integrity;
no root CRM dependency or lockfile addition is needed. Local ignored
`node_modules/railway` points to that D cache. Put the pinned CLI directory on
PATH as well as Node; the SDK invokes `railway --version` during native evaluation.

The installed CLI differs from older online migration instructions:

- `config migrate --apply` writes an authoring file. Remote switching is a
  separate `config migrate cutover`; that command clears explicit config paths
  and redeploys services, including inheriting environments.
- Here the explicit path is already null. `migrate status` reports no legacy
  consumers despite the current deployment's automatic `/railway.json` use.
  Do not treat that status as proof that source migration is finished.
- No `migrate cutover`, path clearing, or broad `migrate undo` is needed here.
  Use the reviewed worker-only settings plan, then upload the source without
  the legacy file and verify the actual resolved deployment configuration.

IaC is applied by the CLI; uploading `.railway/railway.ts` alone does not apply it.

## Activation sequence requiring one owner block

1. Recheck exact target, previous deployment/source message, null explicit
   config path, no pending work/other partial owners, main ready/version,
   parked test app and both databases. Preserve all unrelated dirty worktrees.
2. Commit/push only the five reviewed files on this worker feature branch;
   one commit, parent exactly `d9c0b7c...`. Require exact-SHA whole CI success,
   the worker guard, clean npm ci and all73 tests before any Railway write.
3. Apply only the pinned non-destructive IaC plan. Reject stale configEtag,
   `.railway/` tree drift, variables, other resources, source changes or wider
   fields. The two update records may be coalesced into one deployment; allow
   at most two implicit worker deployments from this single apply and verify
   their outcome. Explicit safe settings must be present before uploading.
4. Upload the clean exact source once to this existing worker with the dedicated
   nonHTTP controller. No main CRM helper/default target or auto-deploy setup.
5. Verify one healthy instance, source-SHA CLI message, no legacy config-file
   metadata, unchanged resolved build/start/restart/region, and multiple
   `READ_ONLY_PLAN` cycles with send/mutation false and claimed0. Check main,
   databases and test parking. A post-apply plan must have no resource drift.
6. Record actual RAM/CPU and startup limitations. This configuration migration
   has no intended steady-state resource or direct dollar saving: its purpose
   is to preserve behavior beyond the legacy cutoff.

No automatic retries or unreviewed descendants. Forward budget: one IaC apply,
at most its two implicit worker deployments, and one source upload. One scoped
retained-build recovery is permitted only under that future owner block.

## Rollback and stop conditions

Before apply, capture config, ownership, exact source hashes and availability of
the retained `7ebb9633...` build. A settings-only failure before upload leaves
the old JSON artifact available; stop and diagnose any partial application.

Operational rollback after upload is one retained-build redeploy of `7ebb9633...`
on the same worker. Keep the explicit NIXPACKS/read-only/ON_FAILURE3 settings.
This restores the previous executable artifact; it does not erase the named IaC
ownership or restore empty dashboard defaults. No historical variable restore,
sender activation, queue replay or service deletion is part of recovery.

A full administrative reversal of ownership/defaults is a separate reviewed
operation. After 2026-12-01, restoring JSON alone is not a supported rollback.
If retained-build recovery is unavailable, a plan drifts, another service would
change, or sending/mutation occurs, stop; never improvise a broader cleanup.

## Sources

- https://docs.railway.com/config-as-code — legacy hard cutoff2026-12-01.
- https://docs.railway.com/infrastructure-as-code — plans, partials and replacement.
- https://docs.railway.com/cli/config — pinned plans and variable redaction.
- https://github.com/railwayapp/cli/blob/v5.71.0/src/commands/config/migrate.rs
  — actual cutover/redeploy behavior of the pinned CLI.
- https://github.com/railwayapp/cli/blob/v5.71.0/src/iac/compiler.rs
  — explicit variables policy and service settings compilation.
