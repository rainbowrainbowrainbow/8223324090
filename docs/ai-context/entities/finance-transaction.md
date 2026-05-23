# Entity: Finance Transaction

## Meaning

A Finance Transaction is a money movement tracked by Finance.

## Fields / Properties

Source evidence: `routes/finance.js`.

- id
- amount
- type/category
- account
- date
- note/description
- linked booking/report where applicable

Status: exact fields should be confirmed in finance migrations before schema-level answers.

## Related Entities

- Can relate to Report Bot submissions.
- Can relate to Booking/debt/receipt.
- Belongs to Finance Account/category.

## Where It Appears

- Finance page.
- Reports/report bot.
- Personal accounts.

## Assistant Interpretation

On Finance, money questions should specify period, account/category, and whether the user means cash transaction, debt, payroll, or report submission.
