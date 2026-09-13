# SYS-MB-FINISH-02 rollback

Migration 363 is additive and creates only an empty journal plus aggregate telemetry tables. It performs no historical mapping, membership apply, owner assignment, price/formula update, public-link change, job execution, or production record mutation.

Before any future cutover apply, retain the exact source snapshot/mapping hashes and journal row. A failed prepare is rolled back in the same transaction. A future applied cutover must use a forward corrective release: preserve the journal, set an auditable blocked/rolled-back state through the reviewed operator workflow, and reverse only the reviewed membership/registry changes after checking post-cutover records and jobs. Never restore legacy access by reset, force-push, broad SQL delete, or inferred owner assignment.

Dropping the two migration-363 tables is not an operational rollback; it requires export of evidence and a separate approved cleanup migration.
