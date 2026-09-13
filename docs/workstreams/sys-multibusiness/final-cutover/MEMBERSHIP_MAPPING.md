# Task 8 — membership mapping contract

Checkpoint: `047e77fe4e15d36e0161f458632c4368583b0178`.
Actual mappings: **UNPOPULATED** for both businesses. Production collection: **NOT_COLLECTED**.
The JSON files are review templates, not migrations. No organization, owner, role or operational record has been assigned.

## Separate inputs and identity

Use `mapping/maysternya_doli.template.json` and `mapping/crm.template.json` as separate inputs. Keep populated person-level mappings in approved restricted storage outside Git; public evidence contains status, counts and SHA-256 fingerprints only. Preserve an unmodified read-only source snapshot. A report hash is an artifact binding, not proof of ownership or authenticated approval.

Each complete input binds the exact production deployment SHA, UTC snapshot time, snapshot hash and independently computed effective-access matrix hash. Identify the literal existing business partition, approved organization and real owner workflow. A shared login, historical username, global creator/director role, source label or NULL business context does not establish that owner.

The existing globally unique `businesses.context_key` allows only one organization to claim each literal partition. Mixed ownership requires an explicit record-level separation decision. Do not invent aliases, attach the partition to the first organization, or rerun first-organization bootstrap.

## Row contract

One `memberships` row per user in the target business:

| Field | Meaning |
| --- | --- |
| `userId, organizationId, businessId` | Verified database identifiers; organization/business must match the separately approved target. |
| `sourceUserFingerprint` | SHA-256 of a canonical restricted before-state, including all relevant role/override/context/default/active fields and existing memberships. Hashes must not be generated from just a username or raw context array. |
| `sourceUserActive, sourceOrganizationRole` | Actual before-state, including absence of an organization membership; unknown is not equivalent to active or ordinary member. |
| `before, after` | Independently computed effective `contextAccessible` and `allowedSurfaces` sets from the old/new server policy for the same account and inputs. |
| `desired` | Primary role, extra roles, organization role, active/default flags, page/action allowlists and denylists; preserve explicit negative rules. |
| `driftPolicy: ABORT` | Changed account/membership/default/data/configuration fingerprint invalidates the plan. |
| `unchangedOutsideTarget: true` | Required assertion to verify independently against other businesses and organizations. |
| `approvedRestrictionRef` | Exact owner decision for any lost access; absence blocks an intentional narrowing. It cannot authorize new access. |

An access-matrix surface should name the method/action, route/service/job family, data scope and applicable conditions; for example a synthetic entry `GET:/api/leads:own_business`. Include denied foreign records, aggregate conditions, privileged actions and non-delegable rules in the full restricted matrix. Supplied strings alone cannot establish those facts.

Compute the legacy baseline from effective server policy, not `users.business_contexts` alone. Current compatibility grants context switching only through creator/director roles (including effective extra roles), with additional page/action and MD timeline restrictions. A manager's stored CRM string is not proof that the manager currently has CRM access.

The after-set must be a subset of the actual before-set. Exact parity is the default target. Any loss requires an explicit restriction decision; any newly granted authority requires a separate permission-change task, outside this no-expansion mapping. Preserve inactive users and revoked memberships. Do not map a platform creator to a new platform creator membership or infer owner/admin promotion.

Organization membership itself exposes directory/lifecycle surfaces. Validate these separately, including owner visibility of business names; a comparison restricted to lead/task APIs is incomplete. The first owner workflow and delegation cannot be authenticated by an `APPROVED` string in a JSON file.

## Defaults and modules

Record every affected user's stored and resolved before/after default. The review format accepts unchanged default contexts only. A new `isDefault` flag must agree with that evidence and the existing per-user/per-organization unique-default constraint. Preserve the explicit-selection requirement for multiple organizations and defaults outside the target.

Adding active memberships under `access_mode=compatibility` can already change resolver selection. Do not treat staging in runtime tables as behavior-free. Keep a plan outside active tables until atomic application unless actual local session/default equivalence has been proved.

Target modules must come from the effective configured cabinet and the server registry, with full domain acceptance. Enabling every core registry module expands scope. Hiding an unsupported module does not prove its API/service/jobs unavailable. See the separate MD and CRM matrices.

## Historical owners remain a different mapping

`historicalOwnerMapping` references the separately approved Task 3 owner mapping and OWN-01–08 decisions. It does not replace `OWNER_MAPPING.schema.json` or approve global catalog/template/recurring/public/asset/job ownership. Shared, mixed or unresolved roots remain quarantined. Children must be checked against every parent and foreign reference.

## Offline validation

From the Task 8 worktree:

```powershell
node docs/workstreams/sys-multibusiness/final-cutover/mapping/validate.cjs docs/workstreams/sys-multibusiness/final-cutover/mapping/crm.template.json
node docs/workstreams/sys-multibusiness/final-cutover/mapping/validate.cjs docs/workstreams/sys-multibusiness/final-cutover/mapping/maysternya_doli.template.json
node --test docs/workstreams/sys-multibusiness/final-cutover/mapping/validate.test.cjs
```

The tool checks strict nested shapes, valid UTC calendar dates, canonical role/module/page/action keys and obvious expansion/default/promotion conflicts. It reads only pure source registries. Unknown override aliases must be reviewed and mapped explicitly; they are not silently normalized or discarded. Known module names still require separate capability/ownership acceptance. The tool does not connect to a database, load the app, independently execute the permission matrix, authenticate approvals or apply anything. Exit 0 means the review format is valid, **not migration ready**. `readyForMigration`, `authorizationVerified` and `safeToApply` always remain false. Do not use its result as a production gate.

## Apply implementation and acceptance still required

The current public lifecycle rejects reserved MD/CRM keys and bootstrap seeds only Park/Dar. A reviewed existing-partition registration/apply workflow is still required. Reuse the organization ownership advisory lock and last-owner invariant; protect context uniqueness, account/default state and migration journal in the same transaction.

Before production: test exact rerun as a no-op, empty/partial/conflicting state, inactive/revoked users, defaults, concurrent membership changes, unrelated organizations, failed parent updates, and rollback with post-cutover records/jobs. Recheck the signed source state in the transaction; `ON CONFLICT DO NOTHING` is not conflict validation.

Do not issue blind additive SQL with guessed IDs, or allocate/edit a historical migration merely to make this preparation look executable. The current schema is migration **357**, while migration **356** is Omni WhatsApp. Any genuinely needed new schema/data migration requires a fresh ledger check, governance headers, local PostgreSQL evidence and its own exact authorized release scope.
