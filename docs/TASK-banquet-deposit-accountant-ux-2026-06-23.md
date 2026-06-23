# TASK: Accountant Deposit Verification UX

- Status: proposed after analysis
- Type: implementation task
- Production impact: yes

## Goal

Give accountants a focused way to verify a banquet deposit from the generated task.

## Recommended Scope

- Extend task detail UX for tasks linked to `banquet_deposit`.
- Show source context:
  - client name;
  - event date;
  - banquet group id or primary booking id;
  - lead id;
  - linked booking route.
- Add required inputs:
  - client surname/name snapshot;
  - deposit received date;
  - celebration date;
  - banquet number;
  - amount;
  - payment method: cash/card.
- Save through the deposit API.
- Complete the task only after successful verification.
- Show blocked state when there is no booking/banquet link.

## Non-Goals

- Do not build a separate finance transaction form.
- Do not let frontend decide deposit source of truth.

## Acceptance Criteria

- Accountant can verify from task detail without navigating through unrelated finance screens.
- Required fields are enforced before completion.
- Dirty-form behavior follows existing task modal guard patterns.
- Non-accountant roles cannot accidentally edit verified deposit fields unless allowed by backend.

## Verification

```bash
npm run check:runtime
npm run test:ui
node --test tests/task-scheduling.test.js
```
