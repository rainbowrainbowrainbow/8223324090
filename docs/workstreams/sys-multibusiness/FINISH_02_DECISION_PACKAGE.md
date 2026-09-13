# SYS-MB-FINISH-02 decision package

Status: **PENDING_OWNER_DECISIONS / NO_PRODUCTION_MAPPING**.

This is the single package required before an MD or CRM cutover can be applied. It is intentionally free of user names, IDs, tokens, URLs, customer data, and inferred owners. A populated mapping belongs in restricted operator storage; Git evidence stores only its SHA-256 and approval reference.

| ID | Decision required | Required approval value | Consequence while pending |
| --- | --- | --- | --- |
| OWN-01 | Target organization and accountable owner for `maysternya_doli` | Existing organization ID, attested owner, restricted mapping hash | MD registration/apply blocked |
| OWN-02 | Target organization and accountable owner for `crm` | Existing organization ID, attested owner, restricted mapping hash | CRM registration/apply blocked |
| OWN-03 | Membership/default/role equivalence | Per-user before/after capability matrix; every restriction reference | No membership writes or default changes |
| OWN-04 | Legacy catalog/library ownership | Record-level owner or explicit shared-library/quarantine decision | Catalog/template migration remains contained |
| OWN-05 | Public catalog links and assets | Retain/reissue/withdraw list, publication revision and asset-reference policy | Existing public behavior is unchanged; no new public migration |
| OWN-06 | Actorless catalog/jobs/retries/provider destinations | Stored business principal, destination, retry and post-revoke policy | Existing global actorless flows are not reopened |
| OWN-07 | MD creator-only timeline and external program identifiers | Delegation policy without platform creator; external-code/replay contract | MD membership cutover blocked |
| OWN-08 | CRM required modules and protected finance/people boundaries | Required module list plus explicit protected-domain status | CRM cutover blocked for affected modules |

## Required restricted mapping contract

Use `final-cutover/mapping/{maysternya_doli,crm}.template.json` and its validator. A mapping must bind all of these values:

1. Read-only snapshot timestamp/hash and exact deployed source SHA.
2. Existing target organization/business IDs and approved module list.
3. Each affected account's source fingerprint, effective before/after access matrix, desired role/overrides, active/default state, and an explicit restriction reference for every removed access.
4. Historical root/child mapping hash and the approved public/assets/jobs policy reference.
5. `driftPolicy: ABORT`; unrelated organizations and defaults remain unchanged.

`APPROVED` in JSON alone is insufficient. The implementation revalidates organization ownership, source hashes and journal state inside a transaction during a separately authorized production cutover.

## Read-only source needed

Set only `MULTIBUSINESS_AUDIT_DATABASE_URL` process-locally to a separately provisioned read-only PostgreSQL connection, then run the collector once per context. It never reads `DATABASE_URL`. Current result is `AUDIT_READONLY_CONNECTION_REQUIRED` for both contexts, so no real counts, owners or mappings have been collected.
