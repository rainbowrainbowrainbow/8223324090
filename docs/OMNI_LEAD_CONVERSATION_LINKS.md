# Omni lead conversation links

`lead_conversation_links` is the canonical confirmed relationship between a CRM
lead and an Omni conversation. It replaces neither the legacy `conversations.meta`
fields nor lead source fields during the compatibility period; later tasks migrate
readers and writers to this table.

## Structure

Each row contains `business_context`, `lead_id`, `conversation_id`, `is_origin`,
`is_primary`, `source`, optional `metadata`, optional `created_by`, and timestamps.

- One lead may link to many conversations.
- One conversation may link to many leads.
- `is_origin` is the historical conversation from which this lead was created.
- `is_primary` is the conversation a manager currently prefers to open.

## Invariants

1. A `(business_context, lead_id, conversation_id)` pair exists at most once.
2. A lead has at most one origin and at most one primary conversation.
3. The link, lead, and conversation must have exactly the same business context.
   Database triggers reject cross-business inserts and prevent a linked lead or
   conversation from being moved to another business context.
4. Changing the primary conversation never clears or rewrites the origin flag.
5. A confirmed link is only created through `linkLeadConversation`; name, phone,
   channel, and customer matches are suggestions and never create a link by themselves.

## Shared service

Use `services/leadConversationLinks.js`:

- `linkLeadConversation(input, { client })` creates or reuses a confirmed link.
  Pass `isOrigin: true` and `isPrimary: true` only when a lead is created from
  that conversation. Without `client`, the service owns its transaction.
- `linkManualConversationPreservingLegacyOrigin(input, { client })` is the
  workspace operation for a manager-confirmed link. On the first canonical
  transition it persists a verified legacy conversation as origin and current
  primary in the same transaction, then adds the selected conversation without
  changing primary. A manager must still use the explicit primary action.
- `setLeadPrimaryConversation(input, { client })` changes only `is_primary` on an
  existing confirmed link.
- `listLeadConversationLinks` and `listConversationLeadLinks` read confirmed links
  for the next API and UI tasks.

The write operations serialize by `(business_context, lead_id)` with a
transaction-scoped advisory lock. They validate both referenced records inside the
same transaction and are idempotent for repeated link requests.

## Resolver and API contract

`services/leadConversationResolver.js` is the only selection policy for a lead
workspace. Its response has `confirmedLinks`, `suggestions`, and `resolution`.
Suggestions can be based on a customer relationship, phone, or name, but they are
never opened automatically and are excluded when that pair is already confirmed,
including a temporary confirmed legacy pair.

`resolution` is deterministic:

1. open an available primary link;
2. otherwise open an available origin link;
3. otherwise open the only confirmed link;
4. return `choose` for several confirmed links;
5. return `link` for suggestions only; or
6. return `empty` when there is no evidence.

If the selected primary or origin is unavailable, the resolver returns
`unavailable` and does not silently select another conversation. Unavailable Omni
access does not expose conversation IDs or customer data.

Leads API endpoints reuse the shared services:

- `GET /api/leads/:id/conversation-context` returns the resolver contract.
- `POST /api/leads/:id/conversation-links` creates a manager-confirmed pair with
  `conversationId` in the body.
- `POST /api/leads/:id/conversation-links/:conversationId/make-primary` changes
  only the primary selection.

They retain the existing manager/marketer and Omni capability checks. The Omni
conversation context exposes all canonical `confirmed.leads`; legacy metadata is
only a compatibility fallback when no canonical lead is linked.

## Workspace UI contract

The unified card's entry points, tab/URL behavior, field preservation matrix,
and view-versus-write boundaries are defined in
[Lead workspace UI contract](LEAD_WORKSPACE_UI_CONTRACT.md). The `Комунікації`
action opens its in-card communications tab; the channel-specific action opens
Omni. These actions share the existing resolver contract below and do not create
another conversation-selection policy.

The lead workspace renders only `confirmedLinks` as linked conversations. Its
main action uses the resolver result and an explicit `conversation` URL
parameter, so it is named after the actual channel (`Відкрити Instagram`, for
example) and never searches by phone or name. Omni fetches that conversation by
ID when the current list filters or pagination do not contain it.

Suggestions are visibly unconfirmed. A manager must choose a conversation in the
link dialog before the `POST /conversation-links` request is sent. The same UI
uses `POST /make-primary` for the primary action; it never writes `is_origin`.
Unavailable confirmed conversations stay unavailable instead of silently opening
another link. Omni renders every `confirmed.leads` entry as a separate lead
action when one conversation is shared by several leads.

## Compatibility

Omni lead creation writes the canonical row in the same transaction as the lead:
the current conversation is both origin and initial primary. A retry or a reuse
only attaches the confirmed pair; it never changes `is_origin` or a manager's
chosen `is_primary`.

Until the legacy records are backfilled, the resolver reads canonical links first.
Only when a lead has no canonical link, it may expose one temporary confirmed
legacy pair. That pair needs one unambiguous saved conversation ID and at least
two independent pieces of stored evidence from `leads.external_id`,
`leads.raw_payload.conversationId`, and `conversations.meta.lead_id` / `leadIds`.
The lead and conversation must also share a business context and, when present,
the saved source channel. Conflicts, missing conversations, and one-source
matches are ignored. This compatibility read never writes a link; phone, name,
and customer matches never create or choose a link.

The resolver, backfill planner, and manual-transition writer share
`services/legacyLeadConversationLink.js` as the evidence policy. When a manager
links another conversation for an eligible legacy lead, the service atomically
persists that verified legacy pair as `is_origin`. It remains `is_primary` until
the manager explicitly selects another confirmed conversation. Existing
canonical origin and primary flags always take precedence over legacy evidence.

`npm run audit:omni-lead-conversation-links` is a dry-run by default. It requires
`OMNI_LINK_BACKFILL_READONLY_DATABASE_URL`, reports `ready`, `alreadyLinked`,
`skipped`, and `conflicts`, and only accepts exact stored conversation IDs from
the fields above. Lead scanning uses keyset batches and `coverage.complete`
states whether the complete requested business scope was checked. An explicit
`--max-leads` cap produces an incomplete report and cannot be applied.

`--apply` is deliberately separate. It requires a dedicated write URL, an
explicit business context, an operator-reviewed dry-run JSON file, an exact
maximum candidate count, and the confirmation token. The approved candidate
fingerprint prevents accidental list drift. Each approved pair is revalidated
under the same per-lead advisory lock used by manager operations. Current links,
the lead evidence fields, and relevant conversation metadata are read again in
the write transaction. Existing canonical rows are reported without updates;
new manager choices, changed evidence, conflicts, and cross-business rows are
skipped. Apply never discovers or inserts candidates outside the reviewed file.
Its result separates `added`, `alreadyExisted`, `skipped`, and `conflicts` and
records whether every approved candidate was classified.

Every JSON report includes `reportVersion`, the tool name, and the current
package version so an operator can bind the reviewed inventory to the released
implementation.

## Verification

```powershell
npm run check:migrations
npm run test:lead-conversation-links
$env:OMNI_LINK_BACKFILL_READONLY_DATABASE_URL = 'postgres://…/eventgenix_readonly'
node scripts/backfill-lead-conversation-links.js --business-context=event_genix --batch-size=500 | Set-Content -Encoding utf8 omni-links-plan.json
$env:LEAD_CONVERSATION_LINKS_TEST_DATABASE_URL = 'postgres://…/lead_conversation_links_fixture_test'
npm run test:integration:omni-links
```

The PostgreSQL test accepts only a disposable loopback database URL and creates a
unique temporary database. A local PostgreSQL Unix socket is also accepted by the
test. It never reads `DATABASE_URL`.

The production apply shape is documented for the delivery task; do not run it
without that task's explicit production authorization:

```powershell
$env:OMNI_LINK_BACKFILL_DATABASE_URL = 'postgres://…/eventgenix_operator'
npm run audit:omni-lead-conversation-links -- --apply --business-context=event_genix --approved-plan=omni-links-plan.json --max-apply=100 --confirm=APPLY_OMNI_LEAD_CONVERSATION_LINKS
```
