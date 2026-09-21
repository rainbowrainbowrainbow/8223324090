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
never opened automatically and are excluded when that pair is already confirmed.

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

Until the legacy records are backfilled, the Omni creation path reads canonical
links first. It falls back to saved legacy IDs only when the conversation has no
canonical links. `leads.external_id`, `leads.raw_payload.conversationId`, and
`conversations.meta.lead_id` / `leadIds` remain compatibility evidence; phone,
name, and customer matches never create or choose a link.

`npm run audit:omni-lead-conversation-links` is a dry-run by default. It requires
`OMNI_LINK_BACKFILL_READONLY_DATABASE_URL`, reports `ready`, `alreadyLinked`,
`skipped`, and `conflicts`, and only accepts exact stored conversation IDs from
the fields above. `--apply` is deliberately separate, requires a dedicated
write URL plus an explicit confirmation token, and must be run only under the
production autonomy policy after review of the dry-run output.

## Verification

```powershell
npm run check:migrations
npm run test:lead-conversation-links
$env:OMNI_LINK_BACKFILL_READONLY_DATABASE_URL = 'postgres://…/eventgenix_readonly'
npm run audit:omni-lead-conversation-links -- --business-context=event_genix
$env:LEAD_CONVERSATION_LINKS_TEST_DATABASE_URL = 'postgres://…/lead_conversation_links_fixture_test'
npm run test:integration:omni-links
```

The PostgreSQL test accepts only a disposable loopback database URL and creates a
unique temporary database. It never reads `DATABASE_URL`.
