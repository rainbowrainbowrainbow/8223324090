# Costing composition: fresh-only release boundary

The deployable migration set for this candidate is 375-379. Migration 377 creates
composition history only when `costing_execution_groups` and
`costing_group_members` are empty. It locks both source tables and aborts within
the migration transaction if either contains a row. Startup also refuses to
serve groups with missing revision 1 or missing original member inclusions.
Neither guard changes or deletes source records.

This candidate does **not** backfill pre-existing groups. The reviewed two-insert
backfill and its PostgreSQL tests remain in local review commit
`838cc19538972add71723059bbf4b25cb1320c55`
(`codex/costing-backfill-review-20261004`). The SQL file
`db/migrations/380_costing_group_composition_initial_copy.sql` must remain
outside the active migration directory for this fresh-only release. A future
upgrade of populated groups needs its own reviewed Red data-fix workflow; the
current production block controller cannot authorize that broad copy.

The read-only production audit on 2026-10-04 observed migration ledger entries
375-380 absent and the new costing tables absent. This observation must be
repeated immediately before release. Any already applied costing migration or
unexpected costing table at that pre-release check, or a nonempty source or
incomplete initial history during startup, stops this fresh-only path. A failed
377 may leave earlier additive migrations 375 and 376 committed; it does not
mark 377 applied or erase existing rows.

New groups created through the costing API write the group, revision 1, and
revision members in one transaction. Later revisions may intentionally use
different members; the startup guard compares legacy member inclusions only
with the initial revision.
