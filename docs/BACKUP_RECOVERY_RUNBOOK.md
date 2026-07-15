# Event Genix CRM Backup Recovery Runbook

## Status and authority

The machine-readable policy is `config/backupRestorePolicy.js`. This runbook
explains the operator procedure for that policy; it does not widen the runtime
permissions of any endpoint.

Policy baseline:

- artifact format: `eventgenix.backup` version `2`;
- full restore: supported only from a structured version 2 artifact;
- legacy raw SQL restore: disabled by policy;
- named selective restore set: `attendance-v1`;
- restore confirmation header: `X-Backup-Restore-Confirmed: true`;
- scheduled/Telegram delivery: authenticated AES-256-GCM envelope only;
- live smoke restore: prohibited.

## Recovery scope and limitations

This policy covers PostgreSQL data only. The database artifact can restore rows
and external-asset references, but it does not contain the referenced files.

Not included:

- files in `uploads` or a mounted Railway/local volume;
- object-storage blobs;
- Telegram-hosted photos, documents, and other media;
- data retained only by an external provider;
- environment variables, credentials, API keys, and deployment configuration.

A complete business recovery therefore requires a separately owned external
asset backup, secrets/configuration recovery, and a post-restore check that
database references still resolve. Do not claim complete recovery from the
database artifact alone.

The artifact contains sensitive database values, including authentication
hashes and external-provider credentials where those values exist in database
rows. Treat both plain and encrypted artifacts as secrets. Never attach a plain
artifact to Telegram, email, tickets, logs, or chat. Telegram delivery fails
closed unless an encryption key is available.

`schema_migrations` is intentionally excluded. It represents deployment state,
not business data. The matching Event Genix application version must create a
fresh schema and run its migrations before data is restored.

## Operator policy values

The production owner must set and review these values outside source control.
`OPERATOR_MUST_SET` is not an SLA and must not be reported as one.

| Policy | Required operator value | Meaning |
| --- | --- | --- |
| RPO | `OPERATOR_MUST_SET` | Maximum acceptable business-data loss measured backward from the incident. |
| RTO | `OPERATOR_MUST_SET` | Maximum acceptable time to restore service after recovery is authorized. |
| Database retention | `OPERATOR_MUST_SET` | Number and age of independently stored version 2 artifacts. |
| External-asset retention | `OPERATOR_MUST_SET` | Retention for uploads, blobs, and provider-owned artifacts. |
| Restore drill cadence | `OPERATOR_MUST_SET` | Frequency of disposable full recovery drills. |
| Recovery owner and approver | `OPERATOR_MUST_SET` | Named people authorized to handle artifacts, keys, and cutover. |
| Encryption-key custodian and rotation | `OPERATOR_MUST_SET` | Separate escrow location, key version, rotation schedule, and retention of old keys for retained artifacts. |

The backup encryption key must be escrowed outside Telegram and outside the
same Railway environment it protects. Retain every old key for at least as long
as any artifact encrypted with it. A disposable drill must prove both decrypt
and restore; a restore-only drill with an already decrypted artifact is not a
key-custody proof.

## Authentication and endpoint boundary

All `/api/backup/*` routes use normal CRM authentication and require the
`creator` or `director` role. A Hermes API key is not a replacement for the CRM
JWT boundary.

Required or recommended headers:

| Header | Applies to | Requirement |
| --- | --- | --- |
| `Authorization: Bearer <CRM JWT>` | every endpoint | Required. Never record or print its value. |
| `Content-Type: application/json` | restore POST requests | Required for a structured request body. |
| `X-Backup-Restore-Confirmed: true` | restore POST requests | Required explicit operator confirmation. Header name is case-insensitive. |
| `X-Backup-Encryption-Key: <secret>` | encrypted download/restore and manual Telegram delivery | At least 16 UTF-8 bytes; required unless `BACKUP_ENCRYPTION_KEY` is available server-side. Never put it in a URL, body, log, screenshot, or receipt. |
| `X-Request-Id: <unique id>` | every operator request | Recommended for an auditable recovery receipt. |

Structured JSON requests and artifacts use UTF-8. Do not rely on a shell's
legacy default encoding when transferring an artifact.

Current endpoint inventory:

| Method and path | Purpose | Version 2 operator use |
| --- | --- | --- |
| `POST /api/backup/create` | Trigger configured encrypted backup delivery. | Sends only an AES-256-GCM version 2 envelope and fails closed without a key. |
| `GET /api/backup/download` | Download the structured version 2 database artifact. | Valid source for full or named selective restore after integrity validation. |
| `GET /api/backup/download-encrypted` | Download the encrypted structured version 2 artifact. | Valid after decryption and integrity validation. Do not put encryption keys in URLs or logs. |
| `GET /api/backup/verify` | Generate and inspect backup metadata without restoring. | Read-only verification only; it is not a recovery proof. |
| `GET /api/backup/tables` | List current dynamic inventory and recovery gates. | Read-only diagnostic; exposes only a boolean for encryption-key readiness, never the key. |
| `POST /api/backup/restore` | Restore a structured version 2 artifact. | Supports full restore and declared restore sets; requires explicit confirmation. |
| `POST /api/backup/restore-encrypted` | Decrypt and restore a structured version 2 artifact. | Same restore policy and confirmation requirement; key material must remain outside URLs, logs, and receipts. |

Both download endpoints synchronously record a sanitized `backup_download`
admin-audit receipt before returning an artifact. The receipt contains only the
outcome, encrypted/plain flag, format version, artifact ID, byte size, request
metadata, or a stable failure code; it never contains the artifact, envelope,
encryption key, passphrase, or raw database diagnostics. A successful download
is fail-closed: if the durable audit insert fails, the server returns
`BACKUP_DOWNLOAD_AUDIT_REQUIRED` and does not send the artifact or envelope.

## Supported restore modes

### Full restore

Full restore is supported only when all of these conditions are true:

1. The artifact is structured `eventgenix.backup` version `2`.
2. Its integrity and required manifest fields have been validated.
3. The target uses the matching Event Genix application version.
4. The target schema is fresh and all matching migrations have completed.
5. The restore is first proven on a disposable target.
6. Both `BACKUP_FULL_RESTORE_ENABLED=true` and `BACKUP_RECOVERY_MODE=true` are enabled only on the isolated recovery target for the authorized restore window. Normal runtime keeps both gates disabled.
7. The recovery target uses a unique temporary `JWT_SECRET`, unique temporary
   bootstrap creator credentials, and `BACKUP_OUTBOUND_HOLD=true`. It receives
   no live provider credentials.

Recovery mode accepts only health/version, read-only backup metadata, CRM login,
and the two restore endpoints. Login may update its normal authentication/audit
fields and should be performed only by the recovery operator. Recovery mode
suppresses webhook setup, bot registration,
memberships, schedulers, outbound queues, marketing automation, WebSocket
broadcasters, and task lifecycle jobs. Keep the recovery target network-
isolated from real providers as defense in depth; never give a disposable drill
live Telegram, Omni, marketing, email, payment, or other provider credentials.
Authenticated recovery requests re-read the user and require both the JWT user
ID and username to match the current database. Authentication activity writes
are disabled in recovery mode, so a restore response cannot be followed by a
late `last_seen_at` mutation. A bootstrap token issued before full restore is
invalid once the restored `users` table replaces that identity.

Supplying raw SQL, even SQL generated by an older CRM release, is disabled by
policy. Never bypass this rule through direct `psql`, direct DB writes, or the
legacy request body.

### Attendance selective restore

The only named selective set in this policy is `attendance-v1`:

```json
{
  "restoreSet": "attendance-v1"
}
```

The `staff` parents must already exist in the target. This set restores
attendance facts only; it must not replace the staff roster, `staff_schedule`,
or `hr_shifts`. Any other selective combination needs a separately reviewed
policy entry with its full FK dependency and cascade analysis.

## Source to fresh-schema recovery flow

### 1. Authorize and isolate

1. Record the incident, recovery owner, approver, desired restore point, and
   unique request ID.
2. Freeze ordinary writes or isolate the source according to the incident plan.
3. Never expose database URLs, credentials, encryption keys, JWTs, cookies, or
   artifact contents in terminals, CI output, screenshots, or the receipt.
4. Select a disposable target first. A production database is never the first
   restore target.
5. Confirm the artifact is within the enforced chain: 64 MiB maximum canonical
   payload, 32 MiB maximum structured artifact, 45 MiB maximum encrypted
   envelope, and 50 MiB maximum HTTP restore body.

Before Node.js loads any table rows, backup generation scans aggregate row
counts and a conservative encoded-byte footprint inside the same repeatable-read
PostgreSQL snapshot. The estimate includes payload metadata and row separators;
generation fails closed with `BACKUP_GENERATION_SIZE_LIMIT_EXCEEDED` when the
64 MiB canonical payload budget cannot be met. Each subsequently loaded table
is checked against that preflight, so the final gzip step is not the first size
guard. A size rejection means the recovery format or storage/delivery policy
must be revised deliberately; do not bypass the limit ad hoc.

### 2. Acquire and validate the source artifact

1. Select the structured version 2 artifact that meets the operator RPO.
2. Validate the artifact format/version, integrity metadata, application
   version, schema compatibility, database scope, table manifest, and declared
   exclusions.
3. Reject an incomplete, truncated, corrupt, legacy raw SQL, or unknown-version
   artifact. Do not continue with a best-effort partial restore.
4. Locate the matching external-asset snapshot separately.

### 3. Create the fresh target schema

1. Provision a new empty PostgreSQL database with no production connection
   string inherited by the shell or test process.
2. Check out the exact application release declared by the artifact.
3. Start the application or migration runner against the fresh target so the
   complete schema and `schema_migrations` ledger are created from code.
4. Confirm every migration for that release is applied and the target has no
   source business rows.
5. Stop ordinary application writers before restore.

Backup export holds a shared PostgreSQL schema-maintenance advisory lock. The
Event Genix startup/migration path holds the matching exclusive lock around the
two-phase initialization, preventing a deploy migration from racing a snapshot.
Direct operator DDL outside that controlled path remains prohibited.

### 4. Restore

1. Submit the validated structured artifact to the appropriate restore endpoint
   with the CRM JWT, `X-Backup-Restore-Confirmed: true`, and request ID.
2. Use full mode only for a fresh target. Use `attendance-v1` only for its exact
   two-table contract and only when parent staff rows are already present.
3. Treat any rejected table, manifest mismatch, FK error, sequence error,
   decryption error, or timeout as a failed restore. Do not cut over.
4. Preserve the failed target and sanitized request ID for diagnosis; retry on a
   new clean target after correcting the cause.

Every restore transaction applies a transaction-local 15-second PostgreSQL
lock timeout before it requests the shared schema fence or table locks, plus a
four-minute statement timeout for database work. Lock contention returns the
sanitized code `BACKUP_RESTORE_LOCK_TIMEOUT`; an overlong statement returns
`BACKUP_RESTORE_STATEMENT_TIMEOUT`. Both failures roll the transaction back.
Do not extend these limits for production in order to force a blocked restore;
diagnose the competing transaction and repeat the drill on a clean isolated
target.

### 5. Verify before cutover

Verify at minimum:

- artifact table manifest against the target database inventory;
- row counts and deterministic table digests;
- foreign keys and other constraints;
- serial and identity sequence state;
- exact date, timestamp, timezone, JSON, and binary-reference values;
- `/api/health`, `/api/ready`, and `/api/version`;
- authenticated read-only checks for critical staff, attendance, payroll,
  booking, finance, and communication data;
- external-asset reference resolution against the separately restored asset
  store.

The restore transaction verifies table digests before commit. After the HTTP
response, `admin_audit_log` and `user_action_log` may each contain approved
append-only restore/API audit receipts that were not present in the artifact.
Post-response comparison must account only for those explicit audit deltas;
every other restored table must still match the artifact.

Record PASS/FAIL for every check. Cutover requires all mandatory checks to pass
and explicit approval from the recovery approver.

Before leaving recovery mode, complete this mandatory side-effect review:

1. Keep `BACKUP_OUTBOUND_HOLD=true` and keep all live Telegram, email, Omni,
   marketing, webhook, payment, and other provider credentials absent.
2. Compare every restored pending outbox, retry, webhook, notification,
   scheduler, and job record with provider-side delivery receipts for the time
   after the selected restore point. A row restored to `pending` may already
   have been delivered externally after the snapshot.
3. Quarantine or mark already-delivered work so it cannot be replayed. Record
   counts, evidence, reviewer, and request ID. Do not infer non-delivery only
   from the restored database state.
4. Obtain explicit recovery-approver acceptance of the reconciliation result.

`BACKUP_OUTBOUND_HOLD=true` leaves web requests available but prevents the
server startup path from registering webhooks, bots, schedulers, broadcasters,
or background/provider jobs. It is a pre-cutover safety state, not permission
to run write smoke tests.

### 6. Cut over and retain evidence

1. Remove all temporary `BOOTSTRAP_CREATOR_*` values, rotate the temporary
   recovery `JWT_SECRET`, disable `BACKUP_RECOVERY_MODE` and
   `BACKUP_FULL_RESTORE_ENABLED`, keep `BACKUP_OUTBOUND_HOLD=true`, then restart.
   Prove that the pre-restore bootstrap JWT is rejected.
2. Point the application at the restored target through the normal controlled
   deployment process and run read-only health/version/read checks while the
   outbound hold and provider isolation remain active.
3. Only after the mandatory side-effect reconciliation and explicit approval,
   restore provider credentials, set `BACKUP_OUTBOUND_HOLD=false`, and perform
   the final controlled restart. Never reuse the recovery JWT secret.
4. Retain the source artifact, integrity result, application commit/version,
   migration result, sanitized request IDs, verification summary, timestamps,
   and approver decision according to the operator retention policy.
5. Keep the previous database isolated until the rollback window closes.

## No live restore smoke policy

Automated and manual live-site smoke checks are read-only. They may call health,
readiness, version, capabilities, or read-only backup metadata endpoints. They
must never call either restore endpoint, execute backup SQL, perform an
attendance apply, or mutate production data.

Full and selective restore drills run only against an explicitly identified
disposable PostgreSQL target protected by the repository's isolated database
safety contract. A successful download or `/verify` response is not a restore
drill and must not be reported as disaster-recovery proof.
