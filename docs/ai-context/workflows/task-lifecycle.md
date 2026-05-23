# Workflow: Task Lifecycle

## Purpose

Document how assistants should reason about task state and ownership across the CRM.

## Source Evidence

- Page: `tasks.html`, `js/tasks-page.js`
- API: `routes/tasks.js`, `routes/task-templates.js`
- Services: `services/taskPolicy.js`, `services/taskLifecycle.js`, `services/taskExecution.js`, `services/taskScheduling.js`, `services/taskActionHistory.js`
- Assistant task context: `services/dashboardAssistant.js`

## Flow

1. Task is created manually or by automation.
2. Task gets owner/creator/status/priority/deadline/source metadata.
3. Visibility policy decides who can see it.
4. User can update status, owner, deadline, and details where permitted.
5. Task history/action services preserve operational accountability where implemented.

## Assistant Behavior

- Always respect visibility context.
- If user asks "мої задачі", filter to current owner/assignee.
- If user asks "я поставив", filter by created-by/delegated tasks.
- If user asks "всі", use page/role permissions.
- If source metadata exists, route user to the exact source context.

## Edge Cases

- Legacy tasks may have older owner fields.
- Some automations create source-linked tasks.
- Some tasks use special-control/observer visibility.
