# Facebook and Instagram conversation names

Facebook Messenger and Instagram Direct message webhooks provide a scoped
sender ID rather than a display name. Omni commits the inbound message first,
then starts best-effort enrichment with the explicit business's channel Page
token. Facebook requests first_name/last_name; Instagram requests name/username
through the existing Facebook Login integration at graph.facebook.com.
Instagram prefers a meaningful name and falls back to `@username`. The prefix
distinguishes a verified account handle from a person's name; blank/Unknown
handles, a lone `@` and malformed handle syntax are rejected. Existing meaningful
names remain unchanged.

The inbox uses the same display fallback in its list, selected header, avatar
and assistant labels. A blank/Unknown Meta name displays the channel and scoped
ID until a real name or handle is available. A scoped ID is never presented as
an `@username` or copied into the Instagram field of a new lead draft. A stored
Instagram `@handle` prefills that field; it does not prefill the person-name field.
Manual values already entered in an open lead draft survive conversation refreshes.

Only blank or Unknown conversation names are filled. A conditional database
update checks conversation ID, channel, external ID and business context,
preserving names assigned during the request. Both adapter and enrichment
reject a missing or mismatched returned profile ID. No schema change is needed.
Profile lookup never gates sending, receiving, or webhook acknowledgement.

The HTTP lookup has a 3-second deadline and a 64 KiB response limit.
Responses are assembled as raw bytes and decoded once, preserving Cyrillic
names even when network chunks split a UTF-8 character.
Concurrent attempts for the same business/channel/conversation/external ID
are coalesced; both channels share a limit of 16 active enrichments and 1,000
cooldown entries per process. Identity is captured before asynchronous work.
Unresolved conversations retry on a later inbound message after 5 minutes.
This is best effort, not a durable background job: after a process restart,
an unresolved name is retried when another message arrives. Viewing a chat,
sending an outbound reply, or receiving a duplicate webhook does not trigger
enrichment. Existing Unknown chats without new inbound messages can be inspected
and recovered explicitly with `scripts/repair-omni-meta-names.js`; there is no
automatic backfill. The operator tool defaults to dry-run, selects at most three
exactly scoped records and requires a previously reviewed scope digest for apply.
It shares `lookupMetaName` / `updateMetaName` with inbound enrichment and adds
native-timestamp snapshot guards before writing. See the commands, authorization
boundaries and sanitized evidence in
[the task 2 handoff](OMNI_META_NAMES_TASK2_HANDOFF_2026-09-21.md).

`services/omni-facebook-profile.js` retains `enrichFacebookConversation` as a
Facebook-only compatibility wrapper. The hub uses `enrichMetaConversation` for
both channels. The return contract remains `{ id, businessContext }` or null;
the existing scoped notification refreshes client data without profile details
in its payload. Send/reply adapter methods retain their existing contracts.

## Meta access

The Page token must belong to the Page that received the PSID and have
pages_messaging access. Check the app feature **Business Asset User Profile Access**:
Meta for Developers > EventGenix CRM > Use cases > Messenger >
Permissions and features. For ordinary customers outside the app's testing
roles, request the feature's Advanced Access through App Review when required.
A feature marked Ready for testing is not proof of production approval.
User consent/eligibility restrictions can still prevent a profile response.

References:
- https://developers.facebook.com/docs/messenger-platform/identity/user-profile/
- https://developers.facebook.com/docs/features-reference/#business-asset-user-profile-access
- https://help.yeastar.com/en/p-series-software-edition/contact-center-guide/submit-app-for-review.html

No account permissions or credentials are changed by this implementation.
The separate, authorized diagnostic on 2026-09-21 returned a matching Facebook
profile with first_name/last_name and an Instagram profile with name/username;
a different Facebook profile returned code 100/subcode 33. This confirms access
for those two profiles only, not blanket access to all customers. Task 1 made no
additional profile requests. A separate explicit task 2 allowance authorized a
bounded dry-run: three additional profile GETs confirmed the same two available
names and one unavailable object; no production names were written.

## Diagnostics and verification

Profile failures emit safe codes under `OmniMetaProfile`, without raw provider
errors, PSIDs, names, or tokens. Missing profile data leaves the stored name
unchanged and does not mark the messaging channel unhealthy. The UI fallback
does not write any name or assert why a profile is unavailable.

| Code | Meaning |
| --- | --- |
| PROFILE_CONTEXT_REQUIRED / PROFILE_ID_INVALID | Invalid lookup input; no provider request |
| PROFILE_CONFIG_MISSING | Missing Page token or Page ID for this channel/business |
| PROFILE_TOKEN_INVALID | Meta rejected the token (190) |
| PROFILE_OBJECT_UNAVAILABLE | Meta returned 100/33; the scoped object is unavailable, without asserting why |
| PROFILE_REQUEST_INVALID | Other Meta code 100; do not assume missing permissions |
| PROFILE_ACCESS_DENIED | Meta code 10/200 or HTTP 403, unless a more specific code above applies |
| PROFILE_ID_MISMATCH | Returned ID is absent, non-string, or differs from the requested ID |
| PROFILE_NAME_EMPTY | Identity matched but no usable name/username was available |
| PROFILE_TIMEOUT / PROFILE_RESPONSE_TOO_LARGE | Profile request exceeded its deadline/size limit |
| PROFILE_UNAVAILABLE | Other provider/configuration read failure |
| PROFILE_ENRICHMENT_FAILED | Enrichment or conditional database update failed |

Run the focused test and the existing workspace behavior tests:
    node --test tests/omni-facebook-profile.test.js tests/omni-meta-profile-adapters.test.js tests/omni-meta-name-repair.test.js tests/omni-workspace-behavior.test.js

After an authorized deployment, use only designated test Meta accounts.
Verify a new conversation and an existing Unknown conversation after another
inbound message for each channel, including the selected chat header and conversation list.
Verify a manual reply in that test conversation. Do not bulk-edit real
conversations or change Meta permissions/secrets as part of QA.
