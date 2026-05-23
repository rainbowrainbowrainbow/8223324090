# Page: Guardian Ops

## Route / Location

- Route: `/guardian-ops`
- Static file: `guardian-ops.html`
- Page controller: `js/guardian-ops-page.js`
- Backend route: `routes/guardian.js`
- Related navigation item: System group -> `Guardian Ops`

## Purpose

Guardian Ops is the moderation/reliability console for Guardian AI, safety reports, moderation actions, rules, mutes, health, analytics, and dead-letter/requeue operations.

## Primary Entities

- Guardian report
- Moderation action
- Rule
- Mute
- Trust/mood/analytics record
- Outbox/dead-letter event

## Visible UI

- Guardian analytics and reliability panels.
- Reports/actions/mutes/rules lists.
- Requeue/reconcile controls.

## Available User Actions

- View Guardian reports/stats.
- Generate reports.
- Manage moderation rules/mutes/whitelist.
- Requeue/reconcile failed events.
- Emergency stop/toggle where authorized.

## Data Sources

- `routes/guardian.js`
- `services/guardian.js`
- `services/guardianDelivery.js`
- `services/guardianModerationState.js`

## Related Files

- `guardian-ops.html`
- `js/guardian-ops-page.js`
- `routes/guardian.js`

## Assistant Context

On Guardian Ops, preserve privacy: public moderation text and internal detail are separate. Detailed profanity/reason data belongs in internal logs/reports, not public chat replies.
