# Page: Content

## Route / Location

- Route: `/content`
- Static file: `content.html`
- Page controller: `js/content-page.js`
- Backend route: `routes/content.js`
- Related navigation item: Product group -> `Контент`

## Purpose

Content is the content matrix for social posts, templates, approvals, schedule, regeneration, and social account settings.

## Primary Entities

- Content post
- Template
- Social account
- Approval status

## Visible UI

- Content post list/calendar/matrix.
- Filters and analytics.
- Post editor and approval actions.
- Social account/template management.

## Available User Actions

- Create/edit/delete posts.
- Approve/reject/schedule/regenerate posts.
- Manage templates and social accounts.

## Data Sources

- `routes/content.js`
- `db/migrations/151_content_posts.sql`
- `db/migrations/152_content_templates.sql`
- `db/migrations/153_social_accounts.sql`

## Related Files

- `content.html`
- `js/content-page.js`
- `routes/content.js`

## Assistant Context

On Content, interpret questions around post status, platform, approval, schedule, and content templates.
