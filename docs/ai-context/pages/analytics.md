# Page: Analytics

## Route / Location

- Route: `/analytics`
- Static file: `analytics.html`
- Page controller: `js/analytics-page.js`
- Backend route: `routes/analytics.js`
- Related access group: finance/analytics roles from `middleware/auth.js` and `js/auth.js`.

## Purpose

Analytics is the operational analytics dashboard for overview, charts, comparison, conversion, deals lifecycle, product sales, bookings, and revenue analytics.

## Primary Entities

- Booking
- Revenue metric
- Conversion metric
- Product sale
- Lead/deal lifecycle metric
- Customer aggregate

## Visible UI

- Analytics overview and charts.
- Date/period filters.
- Comparison/conversion/product sales/revenue panels.
- Export for product sales where supported.

## Available User Actions

- View analytics overview.
- Inspect charts and comparisons.
- Review conversion/deals lifecycle/product sales/bookings/revenue.
- Export product sales data where available.

## Data Sources

- `GET /api/analytics/overview`
- `GET /api/analytics/charts`
- `GET /api/analytics/comparison`
- `GET /api/analytics/conversion`
- `GET /api/analytics/deals-lifecycle`
- `GET /api/analytics/product-sales`
- `GET /api/analytics/product-sales/export`
- `GET /api/analytics/bookings`
- `GET /api/analytics/revenue`

## Related Files

- `analytics.html`
- `js/analytics-page.js`
- `routes/analytics.js`
- `middleware/auth.js`
- `js/auth.js`

## Assistant Context

On Analytics, interpret questions through period, metric, segment, and source data. If the user asks "чому цифра така", ask which period/filter is active if not visible.
