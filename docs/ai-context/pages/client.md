# Page: Client / Customers

## Route / Location

- Route: `/customers`
- Static file: `customers.html`
- Page controller: `js/customers-page.js`
- Backend route: `routes/customers.js`
- Communication context service: `services/customerCommunicationHub.js`
- Related navigation item: sidebar Sales group -> `Клієнти`
- Related tabs: `customers`, `rfm`, `segments`, `birthdays`, `duplicates`, `journey`, `nps`, `bulk`, plus table/detail modal surfaces in `customers.html` and `js/customers-page.js`.

## Purpose

The Client page is the CRM customer registry. It lets managers/reception/admin users search customers, view client details, inspect booking/certificate history, maintain tags, add CRM communication notes, and route to live communication context in Omni.

## Primary Entities

- [Client](../entities/client.md)
- [Call](../entities/call.md)
- [Communication](../entities/communication.md)
- [Conversation](../entities/conversation.md)
- [Booking](../entities/booking.md)
- [Certificate](../entities/certificate.md)
- [Lead](../entities/lead.md)
- [Note](../entities/note.md)

## Visible UI

- Customer stats cards from `/api/customers/stats`.
- Filter bar: search, source, sort, date range, tag filter.
- Customer table with name, child, phone, source, visits/bookings/spend, tags, and row click to detail.
- Tabs for analytics/segments/birthdays/duplicates/journey/NPS/bulk messaging.
- Customer detail modal with:
  - contact fields;
  - social identities;
  - child data;
  - statistics;
  - communication hub;
  - tags;
  - LTV;
  - CRM communication timeline;
  - certificates;
  - booking history.
- Customer edit modal with name, phone, Instagram, child name/birthday, source, social identities, and notes.
- Import/export actions: CSV/XLSX/vCard and bulk messaging.

## Available User Actions

- Search and filter clients.
- Open a client detail modal.
- Create/edit/delete a client if role allows.
- Add/remove tags.
- Open a `tel:` call link for a client if phone exists.
- Open exact/suggested Omni conversation or Omni search for the client.
- Open related lead workspace.
- Open related booking on the timeline.
- Add an internal CRM communication note.
- View CRM communication timeline entries.
- Export customers or import vCard data.
- Merge duplicates with manager-level access.

## Important Terminology

- `Client` and `Customer` refer to the same source object in this codebase: table/API `customers`.
- `Call / дзвінок` on this page can mean:
  - a phone action via `tel:` link;
  - a CRM communication log entry with `type = 'call'`;
  - a live conversation in Omni related to the client;
  - a note about a past or planned call.
- `CRM-журнал комунікацій` is internal CRM history stored in `communication_log`; it is not the live Omni message history.
- `Live Omni` means conversation data from `conversations` and `conversation_messages`.
- `Exact conversation` means `conversations.customer_id` matches the customer.
- `Suggested conversation` means phone/name matching found an Omni conversation not yet linked by `customer_id`.

## Data Sources

- `GET /api/customers`
- `GET /api/customers/:id`
- `POST /api/customers`
- `PUT /api/customers/:id`
- `DELETE /api/customers/:id`
- `GET /api/customers/:id/communication-context`
- `GET /api/customers/:id/communications`
- `POST /api/customers/:id/communications`
- `GET /api/customers/search`
- `GET /api/customers/stats`
- `GET /api/customers/rfm`
- `GET /api/customers/tags`
- `POST /api/customers/:id/tags`
- `DELETE /api/customers/:id/tags/:tagId`
- `GET /api/customers/duplicates`
- `POST /api/customers/:primaryId/merge`
- `GET /api/customers/export`, `/export-xlsx`, `/export-vcf`
- `POST /api/customers/import-vcf`
- `POST /api/customers/bulk-message`
- Database tables: `customers`, `customer_tags`, `communication_log`, `bookings`, `certificates`, `conversations`, `conversation_messages`, `leads`.

## Permissions / Roles

- Page access is configured in `middleware/auth.js` and `js/auth.js` as `/customers`: admin-up roles plus `reception`.
- API route `routes/customers.js` uses `authenticateToken` and `requireRole('admin', 'reception')` for the route module, with stricter manager-level guards for merge/delete/bulk messaging.
- Frontend management buttons are hidden for users outside `creator`, `director`, `vice_director`, `senior_manager`, `manager`.

## Edge / Empty / Error States

- Empty table uses filter-aware empty text in `customerEmptyHtml()`.
- Communication hub failure shows fallback text while keeping the client card and CRM journal usable.
- If no exact Omni conversation exists, the hub may show suggested or search links.
- If there are no CRM communication entries, the timeline explicitly says the CRM journal is empty and live history is in Omni.
- Edit modal uses unsafe-dismiss guard to avoid losing dirty form data.

## Related Files

- `customers.html`
- `js/customers-page.js`
- `routes/customers.js`
- `services/customerCommunicationHub.js`
- `db/migrations/008_customers.sql`
- `db/migrations/076_crm_improvements.sql`
- `db/migrations/108_customer_lead_link.sql`
- `db/migrations/176_client_pinata_service_split_v1.sql`
- `js/components/sidebar.js`
- `middleware/auth.js`
- `js/auth.js`

## Assistant Context

When the user is on `/customers` and asks about a call:

1. Prefer the currently selected/open customer if visible.
2. If a customer is open and has a phone, explain that the page can start a phone call through the `Подзвонити` / `tel:` action.
3. If the user asks about call history, point to the `CRM-журнал комунікацій`; mention that live message history is opened in Omni.
4. If the user asks to create a call record, explain that source evidence shows an internal communication journal endpoint and `call` type support, but the current UI button creates `note`; ask whether they want a CRM note for the call or to open the phone/Omni channel.
5. If no current customer is known, ask: "По якому клієнту дивимось дзвінок?"

Status: dedicated call-status editing is unclear from codebase; do not claim it exists.
