# Disposable certificate QA run

`CERT-CLOSE-02` prepares one controlled production check after release. This document does not authorize a production run by itself. Use the release authorization from `CERT-CLOSE-03`, verify its exact deployed SHA, and use only the dedicated QA account from the local secrets file. Never print or commit a token, certificate code, customer data, or credentials.

## Boundaries

- The run is bound to one active account whose name or username identifies it as QA and which has no active staff profile, one `event_genix` business context, one endpoint, one certificate, and a TTL of at most 30 minutes.
- Create the run through `scripts/trusted-qa-certificate-run.js`. A request flag or note cannot mark a normal certificate as QA. The server compares the run token, account, context, exact recipient marker, request ID, and manifest limit inside the issue transaction.
- The QA certificate is absent from registry totals, profile and customer certificate counts, Kleshnya summaries, and Telegram certificate verification. Direct authenticated code lookup remains available for the QA check page.
- No `certificate.created` event is published. Image sending, status editing, deletion, printing, finance linking, and booking redemption reject the QA certificate. Direct one-time redemption keeps its normal transaction, permission, and history checks.
- The trusted QA manifest is retained after closure. A used certificate remains used; an unused active certificate is revoked. Neither is deleted or reactivated. The watchdog can close an expired run using the same cleanup path.

## Operator procedure for one run

1. Confirm deployment identity, the QA account's exact ID and Park access, and that no other certificate QA run is open. Keep a plan file outside the repository with only `runId`, `testAccountId`, `businessContext: "event_genix"`, and `ttlMinutes` (1–30). Use a unique run ID of 8–80 ASCII letters, digits, underscores, or hyphens.
2. Run `node scripts/trusted-qa-certificate-run.js --mode plan --plan-file <absolute-plan-path>`. This is read-only and returns a plan hash and readiness without a token.
3. After the release authorization, run `node scripts/trusted-qa-certificate-run.js --mode create --plan-file <absolute-plan-path> --approved-hash <plan-hash> --confirm CREATE_EXACT_CERTIFICATE_QA_RUN --token-file <absolute-private-token-path>`. The token file must be outside the repository and is created once. The command prints only run metadata and the file path.
4. Sign in with the exact QA account. Issue **one** one-time certificate through `POST /api/certificates` using the normal authentication and `X-Business-Context: event_genix`, plus `X-Disposable-QA-Token` loaded from the private file and a unique `X-QA-Run-Request-Id`. Set `displayValue` to `<runId>:certificate:disposable`; use `displayMode: fio`, `typeCode: one_time_admission`, and a short valid date. Keep the returned code private for the browser QR → login → cancel → redeem → retry check.
5. Check direct code lookup, status/history, registry exclusion, and that no `certificate.created` event, print job, notification, or finance row exists for the exact certificate. Do not create a booking, payment, customer notification, or client record.
6. Run `node scripts/trusted-qa-certificate-run.js --mode finish --run-id <runId>` even if browser QA fails. It checks exact manifest ownership and side effects, revokes any unused active QA certificate, retains a used certificate, and closes the run. A blocker leaves the run visible for investigation; do not delete rows or bypass the inventory. Remove only the exact private token file after closure.

## Migration and rollback

Migration `371_trusted_qa_certificate_lookup.sql` is an additive, repeatable partial index on existing manifest data. It does not backfill or modify certificates. To stop the feature, first stop new QA issuance and close or inventory existing runs. Keep the trusted QA manifest and the business-read filters for any issued QA certificate: reverting those filters to an older release would put historical QA records back into counters. If a runtime rollback is necessary after issuance, carry the filters as a compatibility patch before promotion. The index may be dropped with `DROP INDEX IF EXISTS idx_trusted_qa_certificate_lookup_v371` only after checking query cost; it does not control exclusion semantics. Never remove the manifest, delete QA history, or turn a used code active.
