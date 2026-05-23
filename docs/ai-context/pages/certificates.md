# Page: Certificates

## Route / Location

- Routes: `/certificates`, `/certificates/new`, `/certificates/batch`
- Static file: `certificates.html`
- Page controller: `js/certificates-page.js`
- Backend route: `routes/certificates.js`
- Related navigation items: Product group -> `Сертифікати`, quick links for issue/batch

## Purpose

Certificates is the standalone registry plus single and batch certificate issuing flow.

## Primary Entities

- Certificate
- Customer
- Booking
- QR/code validation

## Visible UI

- Registry/list/search.
- Detail modal.
- Single issue flow.
- Batch issue flow.
- QR/validation/status actions.

## Available User Actions

- View certificates.
- Issue one certificate.
- Issue batch certificates.
- Change status/edit/delete where role allows.
- Send image/validate code where supported.

## Data Sources

- `routes/certificates.js`
- `services/certificates.js`
- `db/migrations/107_certificate_booking.sql`

## Related Files

- `certificates.html`
- `js/certificates-page.js`
- `routes/certificates.js`

## Assistant Context

On Certificates, distinguish registry vs `/new` vs `/batch` by route. If the user says "видати", prefer `/certificates/new` unless they mention multiple recipients.
