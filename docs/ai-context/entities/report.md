# Entity: Report

## Meaning

A Report is an operational/finance submission or analytics record, either created in CRM or via report bot.

## Fields / Properties

Source evidence: `routes/reports.js`, `routes/report-bot.js`.

- id
- type/category/tag
- amount or operational values where applicable
- submitter/source
- created/updated time
- status/routing metadata

## Related Entities

- May create Finance Transaction.
- May originate from Telegram report bot.
- May be linked to user/on-duty context.

## Where It Appears

- Reports page.
- Report Agent.
- Finance.

## Assistant Interpretation

If user mentions Telegram report bot, do not confuse it with Omni Telegram inbox.
