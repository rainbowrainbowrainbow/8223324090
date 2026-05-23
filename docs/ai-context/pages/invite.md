# Page: Invite

## Route / Location

- Route: `/invite`
- Static file: `invite.html`
- Backend route: standalone static page in `server.js`

## Purpose

Invite is a public/invite/onboarding page that can show event details from URL parameters and invite content.

## Primary Entities

- Invite
- Event details
- Program/date/time/room from URL parameters

## Visible UI

- Invite content.
- Event details card when URL parameters are present.

## Available User Actions

- View invite details.
- Follow invite/onboarding actions where present.

## Data Sources

- URL parameters in `invite.html`.

## Related Files

- `invite.html`
- `server.js`

## Assistant Context

On Invite, interpret questions through invite/event details. Do not assume authenticated CRM permissions unless the user is in the CRM shell.
