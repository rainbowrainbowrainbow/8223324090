# Page: Report Agent

## Route / Location

- Route: `/report-agent`
- Static file: `report-agent.html`
- Backend route: `routes/report-bot.js`

## Purpose

Report Agent is the operational surface around automated/Telegram report submission and report-bot data.

## Primary Entities

- Report bot submission
- Finance report
- Personal expense
- User/on-duty staff

## Visible UI

- Report-agent workspace.
- Submission/status controls.
- Bot-related report data.

## Available User Actions

- Review report bot submissions.
- Inspect routing/summary/account data where exposed.

## Data Sources

- `routes/report-bot.js`
- `services/report-bot.js`

## Related Files

- `report-agent.html`
- `routes/report-bot.js`
- `services/report-bot.js`

## Assistant Context

On this page, distinguish report bot from Omni Telegram inbox. Do not treat report bot binding as an Omni inbox binding.
