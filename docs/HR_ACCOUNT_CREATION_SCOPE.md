# HR account creation scope

The account center grants CRM access to an existing Park staff card. Staff cards
are created through HR Team or vacancy hiring. The staff card also offers account
creation and linking to an existing account. The account onboarding API and its
operation receipts remain available to their other consumers.

The guarded `POST /api/users` route accepts an account without `staffId` and can
activate a business membership. The HR account-center form does not expose that
path. Creating a synthetic Park test account without a staff card therefore has
no dedicated UI in this flow; designing one is outside this change.
