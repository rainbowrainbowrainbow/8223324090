# Work-module ownership dependencies

Page presets do not establish ownership of global rows. These proposals are
preparation only: no migration, production backfill or new API lane is applied.

## Chat

Current chat_channels lacks business ownership. Park membership requests fail
with chat_not_migrated. Bypassing this boundary exposes global channels.

1. `node scripts/audit-chat-scope.js` is the prepared read-only inventory. Set
   `ACCESS_AUDIT_DATABASE_URL` locally through the approved credentials source;
   never put it in command arguments or output. The script starts a repeatable-read
   read-only transaction, limits statement/lock waits and always rolls back.
   It returns channel IDs/types, active-principal business-ID sets, unresolved or
   multi-business principal counts, message/non-text counts and cross-channel
   reply counts. Principals include members, creators, DM recipients and historical
   authors. Content, names, file URLs and credentials are never selected. Non-text
   counts are not an exact attachment inventory. Mixed/absent memberships remain
   unresolved, and even a single business-ID set never establishes ownership.
2. Owner approves an exact channel-to-business manifest. Shared channels need an
   explicit ownership policy; never infer Park ownership from default context.
3. Add durable business ownership through an additive migration. Unclassified
   channels remain inaccessible to membership business APIs. No startup backfill.
4. Guard channels/messages/members/search/unread/attachments, socket subscriptions
   and background notifications by business and existing channel membership.
   Private channels retain independent checks.
5. New channels receive a server-validated business owner. Direct conversations
   need the same boundary; mixed recipients fail closed.
6. Test cross-business IDs, revoked membership, reconnect, historical attachments
   and classified/unclassified channels before enabling the module.

Production classification needs exact IDs, before values and rollback. No such
data change is authorized by this baseline implementation.

The inventory was verified against a disposable PostgreSQL schema with no content,
name, metadata or credential columns, including revoked/inactive principals,
multi-business recipients, historical authors, empty channels and cross-channel
replies. A real production inventory has not run because the permitted local
credentials file is unavailable.

## Training

Registry policy says not migrated while the legacy API can answer a Park member.
Readiness exposes this mismatch rather than marking the common minimum complete.

Inventory course/lesson/assignment/attempt/progress ownership and identify shared
content. Add explicit content ownership (or an approved shared-content relation)
and constrain progress to active business. Filter lists and direct IDs; guard
submissions, downloads, completion and reminders. Enable the module only when all
consumers agree. No global course classification is inferred.

## Staff responsibility

Team writes use exactly one active employee profile and its active staff card's
company_structure_node_id. Audit missing, ambiguous and orphan links without
repair. Cross-node leadership needs an explicit business/leader/target-node
responsibility relation. Department labels and professions cannot substitute.
