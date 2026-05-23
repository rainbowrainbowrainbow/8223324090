# Entity: Certificate

## Meaning

A Certificate is a issued gift/certificate record with registry, QR/code validation, customer/booking linkage, status, and send-image actions.

## Fields / Properties

Source evidence: `routes/certificates.js`, `services/certificates.js`.

- `id`
- certificate code
- display value
- status
- customer id
- booking id
- validity date
- QR/code validation data

Status: exact column list should be confirmed from current certificates migration/service before schema-level answers.

## Related Entities

- Certificate may belong to Client.
- Certificate may link to Booking.
- Certificate has status lifecycle.

## Where It Appears

- Certificates page.
- Client detail modal.

## Assistant Interpretation

On `/certificates/new`, "видати" means issue one certificate. On `/certificates/batch`, it means batch issue.
