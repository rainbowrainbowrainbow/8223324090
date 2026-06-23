# TASK: Lead Deposit Stage Accountant Task Hook

- Status: proposed after analysis
- Type: implementation task
- Production impact: yes

## Goal

Create exactly one accountant verification task when a manager moves a lead/deal into `deposit_received`.

## Recommended Scope

- Update `routes/leads.js` deposit hook.
- Trigger accountant handoff only when old stage is not `deposit_received` and new stage is `deposit_received`.
- Pass `businessContext` into all task creation from the deposit hook.
- Create or load the canonical deposit handoff record before creating the task.
- Reuse stored `accountant_task_id` if present and active.
- Use `kleshnya.createTask`.
- Assign typed `owner_user_id` to a configured/on-duty accountant user when possible.
- Set `owner_role='accountant'` as secondary metadata.
- Use stable source metadata such as `source_type='banquet_deposit'` and `source_entity_type='lead'` or the canonical deposit id.
- Include client, event date, booking/banquet number, and direct source context in the task description/control metadata.

## Non-Goals

- Do not save accountant confirmation fields here.
- Do not create finance transactions.
- Do not rewrite existing art/kitchen/admin tasks unless necessary for business context safety.

## Acceptance Criteria

- Moving `deal -> deposit_received` creates one active accountant task.
- Re-saving `deposit_received` does not create duplicates.
- Changing on-duty accountant does not create duplicate active handoff tasks.
- Missing booking creates a safe blocked/pending workflow, not silent bad data.
- Existing art/kitchen/admin task behavior remains intact or is explicitly migrated safely.

## Verification

```bash
npm run check:runtime
node --test tests/sales-funnel.test.js
node --test tests/lead-booking-link.test.js
```
