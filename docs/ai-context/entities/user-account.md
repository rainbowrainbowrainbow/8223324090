# Entity: User Account

## Meaning

A User Account is the login/security/role record for a person using CRM. It is distinct from a staff profile, though it can be linked.

## Fields / Properties

Source evidence: `routes/users.js`, `routes/auth.js`, `services/accountSecurity.js`, HR Account Center.

- `id`
- `username`
- `name`
- `role`
- active/system flags
- extra roles/page allowlist
- staff link
- password hash
- session/security metadata

## Related Entities

- User account may link to Staff Member.
- User owns/creates Tasks.
- User can create communications, reports, content, etc.
- User has profile/security audit/session state.

## Where It Appears

- HR -> Account Center.
- Profile personal cabinet.
- Auth/session routes.
- Sidebar/user card.

## Assistant Interpretation

If user asks "акаунт" on HR, they likely mean managing login/account. If on Profile, they mean their own account/security controls.
