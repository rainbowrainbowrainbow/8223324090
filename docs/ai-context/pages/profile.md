# Page: Profile

## Route / Location

- Route: `/profile`
- Static file: `profile.html`
- Page controller: `js/profile-page.js`
- Backend routes: `routes/auth.js`, `routes/gamification.js`
- Related navigation: user profile entry, feature registry profile link.

## Purpose

Profile is the personal cabinet for avatar, personal state, gamification profile, password/security controls, sessions, and account audit.

## Primary Entities

- User account
- Profile
- Security audit event
- Session
- Achievement/coins

## Visible UI

- Profile/account panels.
- Avatar upload.
- Personal security panel.
- Password change and session revoke controls.
- Gamification/achievement data.

## Available User Actions

- Edit profile/avatar.
- Change password.
- Revoke sessions.
- View security journal.
- View personal gamification state.

## Data Sources

- `routes/auth.js`
- `routes/gamification.js`
- `services/accountSecurity.js`
- `db/migrations/129_profile_improvements.sql`
- `db/migrations/204_account_security_personal_cabinet.sql`

## Related Files

- `profile.html`
- `js/profile-page.js`
- `routes/auth.js`

## Assistant Context

On Profile, account/security questions should point to the personal cabinet, not HR Account Center, unless the user asks about managing other users.
