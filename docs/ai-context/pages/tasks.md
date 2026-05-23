# Page: Tasks

## Route / Location

- Route: `/tasks`
- Static file: `tasks.html`
- Page controller: `js/tasks-page.js`
- Backend routes: `routes/tasks.js`, `routes/task-templates.js`
- Related navigation item: Today group -> `Задачі`

## Purpose

The Tasks page is the task operating system: inbox/focus views, ownership, status movement, deadlines, templates, action history, and smart scheduling.

## Primary Entities

- Task
- Task template
- User/owner
- Observer
- Source entity

## Visible UI

- Task views/lists/boards.
- Filters for ownership/status/priority/dates.
- Quick capture and task detail modal.
- Status/action controls.
- Personal and team task surfaces.

## Available User Actions

- Create/update/complete tasks.
- Reassign owner.
- Change deadline/status/priority.
- View task history and context links.
- Use smart scheduling fields where available.

## Data Sources

- `routes/tasks.js`
- `routes/task-templates.js`
- `services/taskPolicy.js`
- `services/taskLifecycle.js`
- `services/taskScheduling.js`
- `services/taskExecution.js`
- `services/taskActionHistory.js`

## Related Files

- `tasks.html`
- `js/tasks-page.js`
- `routes/tasks.js`
- `services/taskPolicy.js`

## Assistant Context

On Tasks, prioritize overdue, owner, deadline, status, and source context. If the user asks "що по задачах?", summarize visible tasks and propose one next action.
