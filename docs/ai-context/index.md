# Event Genix AI Product Context Knowledge Base

This directory is the internal product map for Event Genix AI assistants. It documents routes, pages, entities, workflows, terms, permissions, and data dependencies so assistants can answer in the context of the user's current CRM page.

Status: first-pass knowledge base from current source code. A small read-only runtime slice is exposed through `services/aiProductContext.js` and attached to the CRM assistant rail as compact excerpts; this directory is not dumped wholesale into prompts.

## How Assistants Should Use This

1. Start with [assistant-instructions.md](./assistant-instructions.md).
2. If the current route/page is known, load the matching page file under [pages/](./pages/).
3. If the user mentions a business object, load the matching entity file under [entities/](./entities/).
4. If the question is action-oriented, load the closest workflow under [workflows/](./workflows/).
5. If source evidence is marked unclear, ask one precise clarification question instead of inventing behavior.

## Source Maps Used

- Static page registry: `config/staticSurface.js`
- Server page routes: `server.js`
- Sidebar/navigation: `js/components/sidebar.js`
- Frontend page access: `js/auth.js`
- Backend page access: `middleware/auth.js`
- API route mounting: `server.js`
- CRM assistant API: `routes/crm-assistant.js`
- Assistant service/prompt loading: `services/dashboardAssistant.js`, `prompts/crm-assistant-system.md`
- Feature locator: `js/crm-feature-registry.js`

## Pages

- [Dashboard](./pages/dashboard.md)
- [Timeline](./pages/timeline.md)
- [Maysternya Doli](./pages/maysternya-doli.md)
- [Tasks](./pages/tasks.md)
- [Chat](./pages/chat.md)
- [Chat Settings](./pages/chat-settings.md)
- [Client / Customers](./pages/client.md)
- [Sales Funnel / Leads](./pages/sales-funnel.md)
- [Omni](./pages/omni.md)
- [Reports](./pages/reports.md)
- [Report Agent](./pages/report-agent.md)
- [Finance](./pages/finance.md)
- [Analytics](./pages/analytics.md)
- [Copilot](./pages/copilot.md)
- [Staff Schedule](./pages/staff.md)
- [HR](./pages/hr.md)
- [Training](./pages/training.md)
- [Check-in](./pages/checkin.md)
- [Products](./pages/products.md)
- [Content](./pages/content.md)
- [Art Director](./pages/art.md)
- [Graduation](./pages/graduation.md)
- [Designs](./pages/designs.md)
- [Designer](./pages/designer.md)
- [Sound](./pages/sound.md)
- [Afisha](./pages/afisha.md)
- [Certificates](./pages/certificates.md)
- [Guardian Ops](./pages/guardian-ops.md)
- [Center](./pages/center.md)
- [Warehouse](./pages/warehouse.md)
- [Game](./pages/game.md)
- [Shop](./pages/shop.md)
- [Profile](./pages/profile.md)
- [Demo](./pages/demo.md)
- [Status](./pages/status.md)
- [Room](./pages/room.md)
- [Quiz](./pages/quiz.md)
- [Invite](./pages/invite.md)
- [Public Landing](./pages/landing.md)

## Entities

- [Client](./entities/client.md)
- [Call](./entities/call.md)
- [Communication](./entities/communication.md)
- [Conversation](./entities/conversation.md)
- [Lead](./entities/lead.md)
- [Booking](./entities/booking.md)
- [Task](./entities/task.md)
- [Note](./entities/note.md)
- [Certificate](./entities/certificate.md)
- [Product](./entities/product.md)
- [Catalog Item](./entities/catalog-item.md)
- [Staff Member](./entities/staff-member.md)
- [User Account](./entities/user-account.md)
- [Finance Transaction](./entities/finance-transaction.md)
- [Warehouse Item](./entities/warehouse-item.md)
- [Content Post](./entities/content-post.md)
- [Design Asset](./entities/design-asset.md)
- [Graduation Flow](./entities/graduation-flow.md)
- [Report](./entities/report.md)
- [Sound Asset](./entities/sound-asset.md)

## Workflows

- [Client Call Flow](./workflows/client-call-flow.md)
- [Lead to Booking Flow](./workflows/lead-to-booking-flow.md)
- [Task Lifecycle](./workflows/task-lifecycle.md)
- [Omni Reply Flow](./workflows/omni-reply-flow.md)
- [Graduation Diploma Flow](./workflows/graduation-diploma-flow.md)
- [Account Management Flow](./workflows/account-management-flow.md)

## Integration Recommendation

See [integration-proposal.md](./integration-proposal.md) for the minimal safe path that is now implemented for the CRM assistant rail. Keep future expansion constrained to small excerpts and focused tests.

## Unresolved Areas

See [unresolved-questions.md](./unresolved-questions.md).
