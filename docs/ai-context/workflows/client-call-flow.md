# Workflow: Client Call Flow

## Purpose

Explain how the CRM represents and supports client-related calls on the Client page.

## Source Evidence

- Client page: `customers.html`, `js/customers-page.js`
- API: `routes/customers.js`
- Context service: `services/customerCommunicationHub.js`
- Schema: `db/migrations/076_crm_improvements.sql`

## Current Flow

1. User opens `/customers`.
2. User selects a customer row or opens a customer by deep link.
3. The detail modal loads:
   - customer profile;
   - booking history;
   - certificates;
   - communication hub;
   - CRM communication timeline.
4. The communication hub calls `GET /api/customers/:id/communication-context`.
5. `services/customerCommunicationHub.js` builds:
   - `links.call` as `tel:<customer.phone>` when phone exists;
   - exact/suggested Omni conversation links;
   - related lead and booking links.
6. The CRM journal calls `GET /api/customers/:id/communications`.
7. Frontend renders communication types including `call` with a phone icon.
8. Adding a visible CRM journal entry currently uses `window.addCommunication` and posts `type: 'note'`, `direction: 'internal'`, `summary`.

## What "Call / Дзвінок" Means Here

Depending on user intent:

- "Подзвонити" -> use the `tel:` link if the customer has phone.
- "Що по дзвінку?" -> inspect CRM communication timeline and/or live Omni context for this customer.
- "Записати дзвінок" -> current code supports communication log entries; visible UI creates notes. A dedicated call form/status is not confirmed.
- "Історія дзвінків" -> use `communication_log` if entries of type `call` exist; otherwise explain that the CRM journal may be empty and live conversations are in Omni.

## Assistant Decision Tree

1. Is there a current customer?
   - Yes: use that customer.
   - No: ask "По якому клієнту дивимось дзвінок?"
2. Does the user want to call now?
   - If phone exists: tell them to use `Подзвонити`.
   - If no phone: say phone is missing and suggest adding it.
3. Does the user want history/status?
   - Check visible CRM journal/live Omni context if available.
   - If not available, explain where it is shown.
4. Does the user want to create a call record?
   - Say current code supports communication log entries and the visible button is `+ Нотатка`.
   - Ask whether to record a call note or open phone/Omni.

## Edge Cases

- No phone: no `tel:` call link.
- No exact Omni conversation: use suggested/search link if available.
- Empty CRM journal: say internal CRM log is empty.
- Dedicated call statuses: Status unclear from codebase.

## Suggested Future Integration

If production changes are approved, add a dedicated "Add call" action on the Client detail modal that posts `type: 'call'` to `/api/customers/:id/communications`.
