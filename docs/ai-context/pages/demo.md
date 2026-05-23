# Page: Demo

## Route / Location

- Route: `/demo`
- Static file: `demo.html`
- Page controller: `js/demo-page.js`
- Backend route: `routes/demo.js`
- Related navigation item: System group -> `Demo`

## Purpose

Demo is the guided demo/scenario page for CRM demos, demo login, sessions, and scenario management.

## Primary Entities

- Demo scenario
- Demo session
- Guest/demo user

## Visible UI

- Scenario/session demo controls.
- Guided tour surfaces.

## Available User Actions

- Start or manage demo sessions.
- View demo overview/scenarios.

## Data Sources

- `routes/demo.js`

## Related Files

- `demo.html`
- `js/demo-page.js`
- `routes/demo.js`

## Assistant Context

On Demo, interpret user questions as demo/training/sales presentation flow unless they reference live CRM operations.
