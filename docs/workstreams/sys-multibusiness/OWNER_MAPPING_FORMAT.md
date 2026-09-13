# Restricted ownership review format — version 1

This is an offline review-input format for SYS-MB-OWNERSHIP-DECISIONS / D02-C3/C4. It does not assign ownership, authorize a migration, enable a module, or change a public link, job, product, booking, or provider. All eight historical ownership/policy decisions are currently **PENDING**. Existing organization/bootstrap authorization does not approve historical record mapping.

Artifacts:

- `OWNER_MAPPING.schema.json`: structural JSON Schema, draft 2020-12.
- `OWNER_MAPPING.synthetic.json`: fictional examples for the twelve actual legacy tables. All twelve entries are unassigned/PENDING/quarantined; the one contextual product reference and registry IDs are also fictional. Repeated-digit SHA256 values illustrate the format and are not real source fingerprints.
- `tools/validate-owner-mapping.cjs`: dependency-free Node 22 offline structural and semantic validator.
- `tools/validate-owner-mapping.test.cjs`: synthetic regression tests, including stale review bindings and relation/organization conflicts.
- Ignored working file `.codex-temp/sys-mb-ownership-decisions/restricted/owner-mapping.json`: **UNPOPULATED / NOT_COLLECTED**, with `source:null` and no records. It is not a zero-row production inventory.

The versioned example must never be applied. No real IDs, customer data, usernames, owner names, tokens, URLs, binary images, external job IDs, or provider payloads were collected for these artifacts.

## Collection and storage boundary

Real mapping belongs in operator-approved restricted storage, outside versioned reports. `.gitignore` prevents accidental Git inclusion; it is **not access control**. No ACLs or storage settings are changed by this task. Before filling the ignored working file with real identifiers, choose the approved storage/location and review who can read it.

Use `dataKind:"unpopulated"` until a specifically selected read-only source is available. That state requires a null source, empty registry/evidence/record arrays, and PENDING decisions without attestations. Do not substitute fake rows, current usernames, default Park, or fixture counts for missing production evidence.

For a collected restricted snapshot, record an opaque `snapshotRef`, SHA256 of its exact immutable export, source collection timestamp, coverage, and the SHA256 of the verified code/checkpoint manifest. Do not put connection strings, passwords, file URLs, signed URLs, account names, raw notes, or financial values in the mapping. Artifact references are opaque identifiers resolved separately in restricted storage.

`rowSha256` identifies the reviewed source row. The operator must specify and preserve the source export/canonicalization procedure, including NULL, JSON, timestamps, numeric values and binary hashes. The validator cannot recompute source-row fingerprints from this redacted mapping and never claims to have done so. A later migration must re-read the exact rows and reject stale or mismatched fingerprints before applying anything.

Unicode identifiers are retained exactly; no lowercasing, transliteration, truncation, trimming, or guessing occurs. Serial keys use positive decimal strings without leading zeros. Catalog/product/booking textual IDs respect the current 50-character columns; timeline resources use their actual `(business_context, resource_id)` unique key. Blob filenames retain their SQL nonblank/trimmed/no-slash rule. The format additionally excludes control characters and caps filenames at 4096 characters and the input document at 20 MiB. A source identifier outside these bounded representation rules is **BLOCKED_UNREPRESENTABLE** until the format is explicitly revised; do not sanitize its identity.

## Actual schema and graph

The following tables exist in repository migrations. Relations described as observations are not invented SQL constraints.

| Mapping table | Exact key | Relations to account for |
|---|---|---|
| `catalog_definitions` | `id` | Root. Public-link and shared-library policy require independent decisions. |
| `catalog_subcategories` | serial `id` | Non-null `catalog_id` → definition; actual FK. |
| `catalog_items` | serial `id` | Non-null `catalog_id` → definition; actual FK. The free-text `subcategory` is not an ID/FK. |
| `catalog_settings` | `catalog_id` | Definition FK; key must equal the referenced definition ID. |
| `catalog_pages` | serial `id` | Definition FK; `embedded_item_reference` explicitly accounts for reviewed JSON item references. |
| `catalog_page_history` | serial `id` | Nullable `catalog_page_id` → page; actual FK. |
| `catalog_automations` | serial `id` | Nullable definition FK. This configuration is not a durable provider-generation job. |
| `trend_proposals` | serial `id` | `catalog_id` and nullable `generated_item_id`; observed references without FKs in migration 093. |
| `catalog_image_blobs` | exact `filename` | `observed_asset_use` covers references from definitions/items/pages/history/products. There is no declared catalog/product owner FK. |
| `booking_templates` | serial `id` | Nullable `product_id` and `room_resource_id` references; no product FK or business owner currently. |
| `recurring_templates` | serial `id` | Product/resource references and `observed_recurring_instance` records. Existing instances do not choose the series owner. |
| `recurring_booking_skips` | serial `id` | Non-null `template_id` → recurring template; actual FK. |

Schema sources: migrations `003_recurring_bookings.sql`, `075_booking_templates.sql`, `093_catalogs.sql`, `127_catalog_pages.sql`, `136_catalog_automations.sql`, `239_timeline_resource_multi_cabinet_engine.sql`, `276_catalog_image_blobs.sql`, and `296_room_resource_id_schema.sql`. Consult the existing catalog and template/recurring source audits for additional entrypoints. Repository schema is not a live schema attestation.

`referenceRecords` permits only existing `products`, `bookings`, and `timeline_resources`. They provide reviewed contextual evidence; this format does **not** authorize updating those records. Their observed business owner may be null. A product owner, occurrence owner, or room match is not evidence that a template or asset has the same historical owner.

For each applicable single relation, include exactly one state:

- `LINKED`: an existing mapped/reference target and evidence.
- `NULL`: source is null, or a repeated observation set was explicitly reviewed and empty; evidence required. Non-null FK fields cannot use it.
- `ORPHANED`: a source reference exists but its target is missing; keep the entity quarantined.
- `NOT_COLLECTED`: the relation has not been inspected; keep coverage incomplete and the entity quarantined.

For `relationCoverage:"COMPLETE"`, account for **every** applicable field, including repeated `embedded_item_reference`, `observed_asset_use`, and `observed_recurring_instance`: either a LINKED list or one evidenced NULL marker for a reviewed empty set. Omission is not proof of an empty set. NOT_COLLECTED cannot be labeled COMPLETE. Duplicate field/target pairs, NULL plus LINKED, and other contradictory repeated states are rejected.

The validator checks target table/ref existence, owner registry consistency, and exact organization/business agreement on all assigned related records. A child cannot be approved under a pending/unassigned parent or a different business. It checks the manifest graph, not actual database FK values: snapshot reconciliation must independently prove each claimed edge and completeness.

This deliberately excludes fictional `catalog_generation_jobs` or other proposed tables. Existing registered/dormant scheduler functions, storage paths, raw provider task IDs, and jobs in unrelated domains are handled by `OWN-06` and the public/background policy inventory. A future durable catalog generation-job model needs its own reviewed schema; it must not be represented as existing data here. Unsupported external asset-use types leave coverage PARTIAL/NOT_COLLECTED and require a later format/domain extension.

## Decisions, quarantine and attestation

Every document contains exactly these decision IDs and revisions:

| ID | Decision scope |
|---|---|
| `OWN-01` | Historical root/child business ownership; explicit row mapping. |
| `OWN-02` | Organization library, sharing and independent operational copies. |
| `OWN-03` | Mixed/unassigned records and historical recurring instances. |
| `OWN-04` | Public catalog links and retention/revocation rules. |
| `OWN-05` | Asset visibility and shared storage references. |
| `OWN-06` | Scheduled/operator/provider jobs and permitted maintenance scope. |
| `OWN-07` | HR/finance/integration ownership boundaries. |
| `OWN-08` | Migration/readiness acceptance and source evidence. |

The format supports `APPROVED` as a **claim backed by review evidence**, not as authorization verified by this script. An approved decision requires owner-decision evidence plus reviewer attestation. An approved entity requires explicit business/organization registry references, complete compatible relations, approved linked decisions, row evidence and its own attestation. Applicable required decisions are enforced by table.

PENDING always means `owner:null` and `disposition:"QUARANTINE"`. MIXED, UNKNOWN and SHARED_CANDIDATE remain PENDING/unassigned/quarantined. V1 assigns only an explicitly reviewed single business. It does not invent organization-wide ownership or allow a business array. Shared-library design and copies remain OWN-02 work; conflicting/missing parent ownership remains OWN-03 work.

Each attestation includes an opaque reviewer reference, timestamp, independent approval-evidence reference and `bindingSha256`. Approval evidence should be an immutable independent owner-review artifact, not a circular file whose hash includes the newly generated binding. The binding is SHA256 over `canonicalJson(...)` constructed by the exported `attestationBinding(document, kind, record)` helper:

- source fingerprint and checkpoint;
- the registry snapshot and resolved evidence definitions;
- reviewed decision/entity fields, excluding its own attestation;
- for entities, linked decision ID/revision/status/evidence references and their attestation binding;
- for entities, resolved relation target table/key/row fingerprint/owner/status/evidence references, without recursively binding target attestations.

The registry/evidence snapshot is deliberately conservative: changing even an otherwise unrelated registry/evidence definition invalidates previous review bindings. Row fingerprints, target identity changes, owner retargeting, source changes or approved policy revision changes also invalidate stale bindings. Arrays preserve order unless explicitly sorted by the helper; object keys are sorted; ordering uses deterministic code-unit comparison, not locale sorting. Timestamps must be real UTC calendar instants, with at most millisecond precision.

This detects stale or inconsistent review input. **It is not a digital signature, does not authenticate the reviewer, does not fetch evidence, and cannot turn a self-authored APPROVED value into a trusted owner decision.** Verify reviewer authority and the original approval independently before any migration. Do not reuse foundation bootstrap authorization as historical ownership approval.

## Commands and interpretation

From the source worktree with Node 22:

```powershell
node docs/workstreams/sys-multibusiness/tools/validate-owner-mapping.cjs docs/workstreams/sys-multibusiness/OWNER_MAPPING.synthetic.json
node docs/workstreams/sys-multibusiness/tools/validate-owner-mapping.cjs .codex-temp/sys-mb-ownership-decisions/restricted/owner-mapping.json
node --test docs/workstreams/sys-multibusiness/tools/validate-owner-mapping.test.cjs
```

The validator reads only the supplied JSON and local schema. No app startup, DB connection, SQL, provider, filesystem write, environment credential read, dependency installation, apply/migrate mode or automatic output file exists. It emits fixed error codes/schema paths and aggregate counts, without record IDs, key values, input filenames, parser excerpts or private field values. Unknown properties/flags and duplicate record/ref identifiers are rejected.

Exit 0 means **format-valid only**; 1 means schema/semantic rejection; 2 means CLI/unreadable JSON/size failure. No `--apply` or readiness override exists. The JSON result always retains `authorizationVerified:false`, `sourceSnapshotVerified:false`, and `safeToApply:false`.

| Result | Meaning |
|---|---|
| `NOT_COLLECTED` | Actual restricted input is unpopulated; no source records were collected. Zero mapping entries are not a production count. |
| `SYNTHETIC_NOT_APPLICABLE` | Fictional format/test evidence only. |
| `BLOCKED_UNRESOLVED_REVIEW` | Restricted input still has pending decisions/entities or incomplete coverage. |
| `REQUIRES_INDEPENDENT_SOURCE_AND_APPROVAL_VERIFICATION` | Claims are internally consistent; actual source, owner approval, migration design and release authorization still require independent verification. |
| `INVALID_FORMAT` | Input cannot enter the review queue. |

Future migration readiness additionally requires a live-schema/read-only source reconciliation, approved historic mappings and public/background policies, source freshness, orphan/mixed-record handling, idempotent migration and rollback tests, protected booking approval where relevant, and a current exact migration/release envelope. This validator cannot supply any of those approvals.
