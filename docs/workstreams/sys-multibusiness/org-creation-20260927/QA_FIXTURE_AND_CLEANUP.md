# Organization creation: bounded QA and cleanup

Status: PREPARE ONLY; no production fixture exists.

Use only the verified source owner and existing smoke QA account. Repeat the private read-only preflight immediately before any write, including source organization and user IDs, current defaults/memberships, empty QA slug/context, live SHA and TTL. Never commit private identities, JWTs or credentials.

Registered maximum: one organization with slug `sys-mb-org-qa-20260927`; one business with context `sys_mb_qa_20260927` and zero enabled modules; at most two explicit business memberships (existing owner/director, existing smoke member/animator), both non-default and with empty overrides. One creation run, at most two hours, no operational records, sends, payments, generation, jobs, public links or asset writes. The test's traffic is synthetic and excluded from compatibility counts.

QA: verify owner creation, second-organization visibility and business isolation; admin/worker create denial; existing four-business memberships/default Park unchanged; keyboard, cross-tab, late responses, 390/768/1440 and network errors. Same-JWT revoke is optional only if its exact QA membership `DELETE` is authorized.

There is no organization hard-delete lifecycle API. Full cleanup requires an additional exact Red data authorization, using the captured IDs, slug/context, creator, creation window and baseline access snapshot. A guarded transaction must lock and compare exactly one QA organization/business, its registered memberships, zero operational records/resources/jobs/outbox/public links/assets/cutover journals/other consumers, and unchanged existing defaults. Delete registered child membership rows, business and organization in child-to-parent order with exact predicates and row counts; retain audit evidence. Any mismatch aborts and requires reviewed forward repair. No broad SQL, `TRUNCATE`, `CASCADE` or token rotation. Prove zero residual QA rows, grants or side effects afterward.

If cleanup authorization or a verified executable cleanup path is absent, use read-only QA only and mark two-organization live acceptance NOT_TESTABLE. Do not create the fixture.
