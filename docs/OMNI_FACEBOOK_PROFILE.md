# Facebook conversation names

Facebook Messenger message webhooks provide a Page-scoped sender ID (PSID),
not the sender's display name. Omni stores the inbound message first, then
requests first_name and last_name with the explicit business's Page token.

Only blank or Unknown conversation names are filled. A conditional database
update preserves names assigned during the request. No migration or bulk
backfill is needed: a new inbound message triggers another eligible attempt.
Profile lookup never gates sending, receiving, or webhook acknowledgement.

The HTTP lookup has a 3-second deadline and a 64 KiB response limit.
Concurrent attempts for the same business/conversation are coalesced;
there are at most 16 active enrichments and 1,000 cooldown entries per process.
Unresolved conversations retry on a later inbound message after 5 minutes.
This is best effort, not a durable background job: after a process restart,
an unresolved name is retried when another message arrives.

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

No account permissions were changed or live profile requests made for this fix.
The currently granted profile feature has not been verified in the Meta account.

## Diagnostics and verification

Profile failures emit a safe code, without raw provider errors, PSIDs, names,
or tokens. PROFILE_ACCESS_DENIED points to Meta permissions/profile access;
PROFILE_TOKEN_INVALID points to token validity; PROFILE_TIMEOUT and
PROFILE_UNAVAILABLE permit a later retry. Missing profile data leaves Unknown
and does not mark the messaging channel unhealthy.

Run the focused test and the existing workspace behavior tests:
    node --test tests/omni-facebook-profile.test.js tests/omni-workspace-behavior.test.js

After an authorized deployment, use only a designated test Facebook account.
Verify a new conversation and an existing Unknown conversation after another
inbound message, including the selected chat header and conversation list.
Verify a manual reply in that test conversation. Do not bulk-edit real
conversations or change Meta permissions/secrets as part of QA.
