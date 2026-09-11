# Multi-business bootstrap runbook

This runbook activates the membership model only after migration `356_organizations_business_memberships.sql` is present. It does not alter bookings, customers, products, finance, or any other business data.

## Preconditions

1. Production migration governance and a database backup are complete.
2. Run `npm run audit:multibusiness-readiness` with a read-only database connection and retain the redacted result as release evidence.
3. Confirm the initial owner is logged in with an existing platform `creator` account.
4. Confirm that the initial organization name and slug are final. Bootstrap can run only when no organization exists.

## Bootstrap

The authenticated platform creator calls `POST /api/organizations/bootstrap` with a name and slug. The server creates one organization, sets that actor as `owner`, then creates membership-mode businesses for `event_genix` and `dar`.

For every active legacy user assigned to either context, the server copies the existing role and capability overrides into the matching business membership. It never grants a context which is absent from that user's legacy `business_contexts`. The bootstrap owner is always assigned to both businesses.

## Verification

1. `GET /api/auth/business-profile` returns `membershipMode: "membership"` for Park and Dar.
2. A user with different Park/Dar memberships receives a different `role` in each active context.
3. A deactivated membership returns `403 business_context_unavailable` immediately, including with a previously issued token.
4. `maysternya_doli` and `crm` still return `membershipMode: "compatibility"` until their dedicated cutovers.
5. Save the readiness-audit output and relevant account-security events as release evidence.

## Rollback

Set the affected business `status` to `inactive` only after confirming an operator rollback. This returns requests to the compatibility path without deleting memberships. Do not drop the migration tables until any post-bootstrap organization data and audit evidence have been exported.
