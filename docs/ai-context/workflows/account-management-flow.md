# Workflow: Account Management Flow

## Purpose

Explain how CRM login accounts are managed separately from staff records.

## Source Evidence

- Page: `hr.html`, `js/hr-page.js`
- API: `routes/users.js`, `routes/auth.js`
- Security service: `services/accountSecurity.js`
- Profile page: `profile.html`, `js/profile-page.js`

## Flow

1. HR Account Center lists user accounts.
2. Creator/director can create accounts, update profile/access, reset password, and activate/deactivate allowed records.
3. Account can be linked to staff profile where available.
4. Personal account security lives in Profile: password change, session revoke, security journal.

## Assistant Behavior

- If user asks to manage another person's account, route to HR -> `Акаунти`.
- If user asks to manage their own password/session, route to Profile personal security.
- Never provide or invent passwords. Password reset should be done through authorized UI/API.

## Edge Cases

- Do not confuse staff display name with username.
- System/creator accounts may have stronger protection.
- Active search/filter state can hide accounts; use reset filters if the list appears empty after edits.
