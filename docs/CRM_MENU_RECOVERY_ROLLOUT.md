# Menu image recovery: rollout and rollback

This is a preparation checklist, not authorization to deploy, change Railway
variables, reconcile live records, or submit a paid provider request. Apply
the current `AGENTS.md` and `CODEX_PRODUCTION_AUTONOMY.md` policy to each step.

## Required evidence before a release

1. Recheck the actual production branch and `/api/version`, pending Railway
   work, source ancestry, exact-SHA CI, and the numbered migration sequence.
   The local candidate contains migrations 387 and 388; their numbers must be
   checked again against the then-current production branch. Verify a usable,
   independently stored backup and a tested restore before a migration.
2. Inventory existing KIE requests and their terminal state using both CRM and
   provider evidence. Count current `generating` drafts, and investigate tasks
   that may have been detached, overwritten, rejected or submitted by old
   processes. A missing draft, elapsed time, or an absent task ID does not prove
   that an external task stopped or was not billed. Do not change or replay old
   tasks as part of an inventory.
3. Identify every CRM replica and external integration that can start a paid
   menu image. Older binaries do not honor the new marker or advisory locks.
   Drain them and verify they are no longer accepting/submitting work before
   activating the guard. `eg-tasker-outbox-readonly` and independent background
   KIE catalog updates are separate paths; do not disable or classify them as
   menu-image Hermes dependencies without independent evidence.
4. Review the recovery, result-list and draft-selection routes and role/business
   access; exercise the full authentication/session topology in an isolated QA
   environment. The synthetic JWT and browser fixtures are not production login
   or membership evidence. Obtain separate authorization for any production
   auth/permission or environment-variable change and any real-record mutation.

## Controlled activation

- Deploy only an exact approved candidate after its required CI and migration
  gates. New recovery, creative execution, schedule OCR, menu guard and review
  switches default off. A deployment itself is not permission to enable them.
- Agree an exact limited paid pilot separately: provider, model, maximum calls,
  maximum budget, disposable inputs and handling of ambiguous charges. Check
  handwritten OCR with a representative, suitably anonymized sample; do not
  infer its accuracy from synthetic printed fixtures.
- After old senders/replicas and legacy KIE tasks are accounted for, obtain the
  required permission for the precise flag change and turn on the guarded menu
  path and recovery in a coordinated rollout. Enabling recovery only after jobs
  were submitted cannot retroactively create their request metadata. A first
  guarded request activates a persistent marker only if no current draft says
  `generating`; that check alone cannot reveal already-detached old tasks.
- Confirm one approved disposable end-to-end task: one submission, status reads,
  draft review, explicit selection and explicit apply. Test cancel, refresh,
  a second click and an uncertain outcome. Watch provider charges, ledger
  states, concurrency, errors, restart behavior and actual resource usage.
  Do not retry an ambiguous paid operation automatically.

## Rollback and known limits

- Disabling recovery blocks its endpoints and retains metadata/results; it does
  not cancel a provider job or erase its possible charge. Operators must retain
  a path to inspect pending operations. Disabling the menu guard after marker
  activation deliberately blocks the guarded binary's legacy path.
- Do not roll back to an old binary while paid tasks or old replicas can run:
  the old binary ignores the marker and locks and can submit duplicates. An
  actual rollback needs a scoped, explicitly approved quiescence and outstanding
  task reconciliation plan, plus a verified database/application backup.
  Do not drop recovery tables or remove the marker as an automatic rollback.
- Request metadata exists only for jobs started with recovery enabled; older
  detached tasks need separate provider evidence and an approved operator path.
  A failed storage/transaction sequence may leave an unreferenced image object;
  do not delete files without proving ownership and obtaining required approval.
- New UI review actions send the viewed draft identity. Older clients that omit
  it retain legacy behavior; a staged rollout must account for browser caches.
  Manual upload remains disabled while a current result is uncertain, because a
  late synchronous OpenAI response may otherwise be lost.
