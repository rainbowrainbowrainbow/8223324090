# Workflow: Graduation Diploma Flow

## Purpose

Explain graduation diploma readiness and operations flow.

## Source Evidence

- Page/API/services: `graduation.html`, `routes/graduation.js`, `services/graduationDiplomas.js`, `services/graduationOpsAutomation.js`
- Migrations: `192_graduation_diplomas.sql`, `198_graduation_list_packs.sql`, `203_graduation_ops_automation.sql`

## Flow

1. Graduation booking/package includes diploma-related service.
2. Children roster/list is needed for diploma generation.
3. Diploma service renders/exports printable artifacts.
4. Ops automation can create missing-roster tasks and print reminders.
5. Art-director print handoff depends on readiness.

## Assistant Behavior

- If user asks "де список дітей", route to graduation list/roster context.
- If user asks "друк дипломів", check readiness: roster exists, diploma batch exists, PDF/print artifact.
- If user asks about missing roster, explain it is an operational blocker.

## Edge Cases

- If no roster exists, do not pretend PDF is ready.
- If event date changes, reminders should follow current event date where automation supports it.
