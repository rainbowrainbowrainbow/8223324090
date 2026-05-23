# Unresolved Questions and Unclear Areas

These areas were unclear from source inspection and should be confirmed before production assistant wiring.

## Client / Call

- Calls are represented as:
  - `tel:` action links from `services/customerCommunicationHub.js`;
  - `communication_log.type = 'call'` support in the communication timeline icon map;
  - live conversation links into Omni.
- The current Client page UI action `+ Нотатка` posts `type: 'note'`; there is no dedicated create-call form found in `js/customers-page.js`.
- Status: unclear from codebase whether call statuses exist as first-class statuses. `communication_log` has `type`, `direction`, `summary`, `created_by`, `created_at`, but no call status column in `db/migrations/076_crm_improvements.sql`.

## Deals

- The codebase has leads, bookings, reports, finance, and sales funnel/lifecycle analytics, but no clearly named canonical `deals` table was confirmed in this pass.
- Status: unclear from codebase. Assistants should map "deal" questions to leads/bookings only if the user's current page or data makes that relationship explicit.

## Current UI Context Injection

- `services/dashboardAssistant.js` accepts `page`, `recentState`, `signals`, `evidence`, and `featureLocator`-style data.
- Status: unclear from codebase whether every page sends current tab, selected entity id, or visible row data to `/api/crm-assistant/reply`.

## Complete Component Inventory

- Every canonical page is documented here at a page level.
- Some page-specific inner tabs and controls need deeper owner-by-owner expansion if assistants must answer down to every button or modal on those pages.

## Production Integration

- This knowledge base is not yet loaded by the assistant runtime.
- Confirmation is required before changing production assistant behavior.
