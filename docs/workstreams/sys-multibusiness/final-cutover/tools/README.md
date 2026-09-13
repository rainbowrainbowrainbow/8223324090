# Remaining-business read-only preflight

This operator tool collects evidence for exactly one remaining context, `maysternya_doli` or `crm`. It does not start the application, migrate, create memberships, infer ownership, change roles, or contact providers. No production/operator database was used to build or verify it.

From the repository root, with an independently approved read-only connection already held process-locally in `MULTIBUSINESS_AUDIT_DATABASE_URL`:

```powershell
node docs/workstreams/sys-multibusiness/final-cutover/tools/business-cutover-preflight.cjs --context maysternya_doli
node docs/workstreams/sys-multibusiness/final-cutover/tools/business-cutover-preflight.cjs --context crm
```

Do not paste credentials into these commands, reports, logs or chat. The tool never reads `DATABASE_URL`, `.env`, the CRM secrets file or application DB initialization. It accepts no write/apply flags or arbitrary context/SQL identifiers. Output excludes usernames, IDs, secrets, source field values, labels, customer records and raw DB errors. Known module identifiers come from the source catalog; unknown configured module names are counted without disclosure.

The transaction is `REPEATABLE READ READ ONLY`, verified with PostgreSQL `SHOW` and finished with `ROLLBACK`. One connection uses 10-second statements, a 1-second lock timeout, a 15-second idle-transaction timeout and a 60-second total collection budget checked before each query. Access rows are bounded to 10,000 active users, 16 KiB per access row and 8 MiB total before any user fields are loaded. Registry module payloads are bounded to 16 KiB before transfer; duplicate context rows make their inventory ambiguous. A bound violation produces `NOT_COLLECTED`, never a sampled cohort. These are collection safety limits, not production traffic thresholds.

Declared collection covers 49 observations: registry, source/configured module inventory, memberships, defaults, potential legacy cohort, migration ledger, persisted cabinet/timeline settings, 24 scoped ownership tables, 11 historical catalog/template/recurring/asset/job roots and 7 listed foreign edges. Historical-root counts do not infer an owner. The exact allowlists are exported from the tool. Missing schema/columns, RLS (even under a bypass role), insufficient SELECT rights and timeouts are unavailable evidence. Zero matching rows are observations only. Counts for NULL/empty owners are global unattributed counts and do not belong to the requested business by inference.

`legacyPotentialCohortUsers` uses the current pure `businessContext` global-role helper without the membership overlay. It preserves role-switch restrictions and aliases, including the fact that a non-switch-role user can have an explicit legacy array that does not grant the corresponding context. It is neither a real usage counter nor permission-equivalence proof. `activeUsersExamined` and `globalExplicitDefaultOutsideLegacyAllowedUsers` count all active users examined, including invalid defaults unrelated to the requested context; the other cohort fields count the requested context/cohort. Membership/default observations concern rows connected to the requested registry business/organization; the finite queries do not inventory every dangling membership outside that scope.

`COMPLETE_FOR_DECLARED_SCOPE` means only that these observations were collected. The report always returns `safeToApply=false`, `authorizationVerified=false`, `ownershipEstablished=false` and `status=HOLD_REVIEW_REQUIRED`. `notCovered` explicitly includes complete dangling owner/membership inventory, source deployment attestation, full page/action permission equivalence, all remaining edges/JSON, protected domains, provider/public bindings, jobs/retries, approved mapping and live denial QA. Registry plus built-in module lists and the persisted setting counts are not the effective current cabinet. Missing product references in MD may be opaque legacy codes, so counts alone cannot distinguish a contract from a defect.

Local verification (Node 22):

```powershell
node --test docs/workstreams/sys-multibusiness/final-cutover/tools/business-cutover-preflight.test.cjs
wsl -d Ubuntu -u postgres -- env SYS_MB_CUTOVER_LOCAL_TEST=true node --test '/mnt/c/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-final-cutover-20260912/docs/workstreams/sys-multibusiness/final-cutover/tools/business-cutover-preflight.test.cjs' '/mnt/c/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-final-cutover-20260912/docs/workstreams/sys-multibusiness/final-cutover/tools/business-cutover-preflight.postgres.test.cjs'
```

The PG test refuses production/Railway/operator environment markers, uses only the local PostgreSQL socket, creates one unpredictable `eventgenix_cutover_test_<uuid>` database and one test-only NOLOGIN role, and removes exactly those resources in `finally`. Its permissive minimal tables deliberately represent historical conflicts without changing any application schema. It asserts a real write rejection (`25006`), complete row-snapshot equality, repeatability, RLS/SELECT/lock failures, partial schema, alias/role behavior, user bounds and exact cleanup. It is a synthetic local test, never live acceptance.
