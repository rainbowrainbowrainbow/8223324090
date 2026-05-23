# Page: Center

## Route / Location

- Route: `/center`
- Static file: `center.html`
- Page controller: `js/center-page.js`
- Backend route: `routes/center.js`
- Related navigation item: System group -> `Центр керування`

## Purpose

Center is the entertainment-center operations page for overview, workers, prices, daily report, tasks, clients, goals, briefing, reconciliation, heatmap, program performance, cross-sell, and event log.

## Primary Entities

- Worker
- Price position
- Daily report
- Task
- Client
- Goal
- Event log entry

## Visible UI

- Operational blocks and cards.
- Price/report/task/client/goal panels.
- Heatmap and performance/cross-sell sections.

## Available User Actions

- Review operations overview.
- Manage price positions where authorized.
- View workers/tasks/clients/goals/report/briefing.

## Data Sources

- `routes/center.js`

## Related Files

- `center.html`
- `js/center-page.js`
- `routes/center.js`

## Assistant Context

On Center, answer as an operations control page: current state, blockers, price/report/goals, and event-log context.
