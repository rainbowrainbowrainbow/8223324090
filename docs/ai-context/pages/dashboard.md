# Page: Dashboard

## Route / Location

- Route: `/dashboard`
- Static file: `dashboard.html`
- Page controller: `js/dashboard-page.js`
- Backend route: `routes/dashboard.js`
- Related navigation item: Today group -> `Дашборд`

## Purpose

The Dashboard is the authenticated workshop/control-room page for operational widgets, board items, assistant rail, work queue signals, and role-aware summaries.

## Primary Entities

- Task
- Widget
- Board item
- Work queue item
- Alert
- User/role preview

## Visible UI

- Dashboard header and assistant rail.
- Normal/operate mode and configure/planning mode.
- Widget grid/scene with configurable board items.
- Reserved/empty zones for layout planning.
- Inspector/palette/toolbar controls.
- Work queue and operational widgets.

## Available User Actions

- View dashboard widgets and operational summaries.
- Switch into planning/configure mode.
- Add, move, resize, inspect, hide, or remove widgets/board items.
- Reserve empty layout zones.
- Save/reload dashboard layout.
- Ask the CRM assistant from the dashboard rail.

## Data Sources

- `GET /api/dashboard/config`
- `PUT /api/dashboard/config`
- `GET /api/dashboard/widgets/:type`
- `GET /api/dashboard/today`
- `GET /api/dashboard/alerts`
- `POST /api/crm-assistant/reply`

## Related Files

- `dashboard.html`
- `js/dashboard-page.js`
- `routes/dashboard.js`
- `routes/crm-assistant.js`
- `services/dashboardAssistant.js`
- `prompts/crm-assistant-system.md`

## Assistant Context

On Dashboard, interpret user questions through overall operations: widgets, urgent tasks, reply backlog, layout planning, and visible work queue. If the user asks "what should I do?", prioritize the strongest operational blocker from visible dashboard signals.
