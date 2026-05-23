# Page: Public Landing

## Route / Location

- Routes: `/landing`, `/landing/manager-guide.html`, `/landing/sales-deck.html`
- Legacy aliases: `/manager-guide`, `/manager-guide.html`, `/sales-deck`, `/sales-deck.html`, `/landing/sales-deck`
- Static files: `landing/index.html`, `landing/manager-guide.html`, `landing/sales-deck.html`

## Purpose

Public marketing/guide pages outside the authenticated CRM shell.

## Primary Entities

- Public lead/demo request
- Sales deck
- Manager guide

## Visible UI

- Public landing content.
- Guide/deck pages.

## Available User Actions

- View public content.
- Submit demo/landing lead where implemented.

## Data Sources

- `routes/landing.js`

## Related Files

- `landing/index.html`
- `landing/manager-guide.html`
- `landing/sales-deck.html`
- `routes/landing.js`

## Assistant Context

On public landing pages, do not assume authenticated CRM state or internal entities unless explicitly provided.
