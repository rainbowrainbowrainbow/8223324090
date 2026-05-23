# Page: Reports

## Route / Location

- Route: `/reports`
- Static file: `reports.html`
- Page controller: `js/reports-page.js`
- Backend route: `routes/reports.js`
- Related navigation item: Sales group -> `Звіти`

## Purpose

Reports is the reporting workspace for operational, financial, and tagged report records.

## Primary Entities

- Report
- Report tag/hashtag
- User
- Finance transaction
- Submission

## Visible UI

- Report lists/tables.
- Filters, date ranges, status/category controls.
- Detail/edit surfaces.

## Available User Actions

- View and filter reports.
- Create/update report records where permitted.
- Review submitted data.

## Data Sources

- `routes/reports.js`
- `routes/report-bot.js`
- `services/report-bot.js`
- `db/migrations/089_reports_module.sql`
- `db/migrations/090_reports_hashtags.sql`

## Related Files

- `reports.html`
- `js/reports-page.js`
- `routes/reports.js`

## Assistant Context

On Reports, interpret user questions around report period, source, tag/category, responsible person, and whether the report came from CRM UI or report bot.
