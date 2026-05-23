# Page: Status

## Route / Location

- Route: `/status`
- Static file: `status.html`
- Page controller: `js/status-page.js`
- Backend route: `routes/status.js`
- Related navigation: static route, System/status surface.

## Purpose

Status is the operational/system status page for health, queues, integrations, and status indicators.

## Primary Entities

- System status
- Health check
- Integration status
- Queue/event state

## Visible UI

- Status cards/indicators.
- Health/error/loading states.

## Available User Actions

- View status and diagnostics.
- Trigger status-related actions where exposed.

## Data Sources

- `routes/status.js`
- `routes/agents.js`
- `routes/event-queue.js`

## Related Files

- `status.html`
- `js/status-page.js`
- `routes/status.js`

## Assistant Context

On Status, answer through health/readiness/diagnostic context, not business workflow unless the status points to a business module.
