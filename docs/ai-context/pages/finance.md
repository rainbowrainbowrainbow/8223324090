# Page: Finance

## Route / Location

- Route: `/finance`
- Static file: `finance.html`
- Page controller: `js/finance-page.js`
- Backend routes: `routes/finance.js`, `routes/payroll.js`, `routes/personal-accounts.js`
- Related navigation item: Sales group -> `Фінанси та аналітика`

## Purpose

Finance is the cash, transactions, debts, account, salary/payroll, P&L, receipts, and finance analytics workspace.

## Primary Entities

- Finance transaction
- Finance account
- Debt
- Shift/cash session
- Payroll scheme
- Receipt/act

## Visible UI

- Finance dashboard/stat cards.
- Transactions and categories.
- Debts and mark-paid actions.
- Budget/forecast/P&L surfaces.
- Accounts and payroll areas.

## Available User Actions

- View/create/edit/delete transactions.
- Manage finance categories/accounts where role allows.
- Open/close shifts.
- Mark booking debt paid.
- Export reports.

## Data Sources

- `routes/finance.js`
- `routes/payroll.js`
- `routes/personal-accounts.js`
- `services/payroll.js`

## Related Files

- `finance.html`
- `js/finance-page.js`
- `routes/finance.js`

## Assistant Context

On Finance, prioritize amounts, period, account, debt/payment status, and P&L impact. If role is not finance-capable, explain access may be limited.
