# BNT-06 recordings and customer-navigation blocker

`taskStatus`: `BLOCKED`

No Binotel account-specific recording method, URL host allowlist, redirect policy, TTL, call-record identity mapping, or recording authorization policy was supplied. Implementing an audio proxy, a public media endpoint, URL query token, browser player, or arbitrary customer lookup without those facts would alter protected access behavior and could expose customer recordings.

The journal therefore exposes only the canonical `recording.available` boolean and `callRecordId` field; it does not render a playback URL or a client-card link. Existing rows remain escaped text and do not create customers. No recording, secret or phone number was fetched, stored, cached or played.

To unblock, obtain from Binotel for the intended test account: documented read method/request authentication, response fields for call record identity, recording host and redirects, TTL, allowed user/role scope, error/expiry behavior, and one synthetic or approved test recording. Then choose an existing authenticated same-origin media grant/proxy pattern without changing session policy; any access-policy change needs exact approval.
