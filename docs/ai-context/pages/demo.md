# Page: Demo

## Route / Location

- Route: `/demo`
- Static file: `demo.html`
- Page controller: `js/demo-page.js`
- Backend route: `routes/demo.js`
- Related navigation item: System group -> `Demo`

## Purpose

The Demo page displays CRM packages and provides controls for demo mode and feature flags.

## Primary Entities

- Package and included features
- Feature flag
- Guest demo mode

## Visible UI

- The Packages tab shows package details.
- Users with the required settings access can view and update feature flags and switch guest demo mode.

## Data Sources

- `routes/packages.js` supplies package and feature flag data.
- `routes/demo.js` supplies the demo overview and handles guest mode changes. It also serves the separate guest login, scenario metadata and session history APIs.

## Assistant Context

For questions about available packages, open the Packages tab. For guest access or feature flags, check the user's settings access before describing controls.
