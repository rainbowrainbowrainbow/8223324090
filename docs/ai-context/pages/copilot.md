# Page: Copilot

## Route / Location

- Route: `/copilot`
- Static file: `copilot.html`
- Page controller: `js/copilot-page.js`
- Backend route: `routes/copilot.js`
- Related navigation item: Sales group -> `AI менеджер`

## Purpose

Copilot is the manager AI sales workspace for coaching, objection handling, debriefs, sales QA, meeting prep, message writing, cases, and workflow previews.

## Primary Entities

- Lead
- Sales case
- Interaction
- Follow-up
- Copilot prompt/result

## Visible UI

- AI tools for sales assistance.
- Case and interaction lists.
- Debrief/coach/message generation surfaces.

## Available User Actions

- Ask for sales coaching.
- Generate objection handling or message drafts.
- Save debriefs/interactions.
- Run workflow previews/self-checks.

## Data Sources

- `routes/copilot.js`
- `services/copilot.js`

## Related Files

- `copilot.html`
- `js/copilot-page.js`
- `routes/copilot.js`

## Assistant Context

On Copilot, interpret questions through sales enablement: lead stage, objection, next message, manager debrief, or case quality.
