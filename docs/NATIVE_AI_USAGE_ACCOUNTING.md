# Native AI usage accounting

Run the report from a trusted operator environment with `DATABASE_URL` supplied
privately through its environment. Do not paste credentials into command arguments.

```powershell
node scripts/report-native-ai-usage.js --business event_genix --from 2026-11-01 --to 2026-11-08
```

The end date is exclusive. Each invocation accepts at most 31 calendar days in
Europe/Kyiv and performs one aggregate SQL read inside a bounded read-only
transaction. The CLI creates no schema or provider request. It exports no employee
names, images, prompts, document contents, tokens or per-operation identifiers.
Database driver errors are deliberately not echoed.

The report covers current CRM-native menu-image reservations, creative jobs
claimed by the CRM executors, and actual-attendance OCR executions. Existing
provider concurrency, idempotency, unknown-outcome and immutable receipt fences
are unchanged. Status polling, preview refreshes and repeat downloads are not new
paid attempts and are not counted.

`reservations` counts possibly paid attempts, including reservations that may not
have reached the provider. It is not a billed-request count. `recordedCredits`
sums only numeric nonnegative credits in existing provider receipts.
`costUnknown` explicitly counts attempts whose cost is missing. Image task IDs,
successful outcomes and catalog prices do not prove individual invoiced costs.
A zero sum with unknown costs must never be presented as free generation.

Dates use reservation/claim time, not the date written on an uploaded historical
attendance sheet. Creative claims missing a timestamp fall back to job creation;
`timeInferred` makes this limitation visible. Later human approval/rejection does
not create another attempt. Legacy generators, external Hermes, other AI features
and provider-account activity outside these CRM paths remain outside scope.

This report does **not** enforce or activate a daily budget and cannot certify a
provider invoice. A future cap needs an owner-selected amount, durable atomic
reservations across all paid entry points, conservative bounds for variable-price
models, and reconciliation that retains unknown outcomes. Never reset an unknown
operation or retry a paid request to make the accounting appear complete.

Verification uses synthetic receipt aggregates plus a real read-only SQL check.
No paid call is needed to run or verify this report. Rollback is to stop invoking
the CLI or revert its isolated implementation commit; no data rollback exists
because the report does not write data.
