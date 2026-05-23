# Entity: Note

## Meaning

A Note is an internal text record. In Client context, notes can be stored on the customer record (`customers.notes`) or in `communication_log` with `type = 'note'`.

## Fields / Properties

Customer note:

- `customers.notes`

Communication note:

- `communication_log.type = 'note'`
- `summary`
- `direction`
- `created_by`
- `created_at`

## Related Entities

- Note belongs to Client in customer context.
- Notes can be part of communication timeline.
- Chat/board may have separate note-like entities; do not merge them unless source links are explicit.

## Where It Appears

- Client detail/edit modal.
- Client CRM communication timeline.
- Dashboard board notes through `routes/board.js`.

## Assistant Interpretation

If user says "нотатка" on Client page, assume customer/communication note. If on Dashboard board, assume board note.
