# Post-release monitoring checklist: v0.77.11 banquet sheet

Production impact: yes.

This checklist is for the first working cycle after the `v0.77.11 - Banquet Sheet Official Design` deploy. It is monitoring only. Do not change production config, redeploy, rollback, or edit data unless a separate action is explicitly confirmed.

## Release context

- Release version: `0.77.11`
- Release label: `Banquet Sheet Official Design`
- Release commit: `55c8ef9ca8c60643392f1d1a3da6f7da47cc24da`
- Deploy branch: `codex/timeline-leads-hardening`
- Rollback note: `docs/ROLLBACK-v0.77.11-banquet-sheet-official-design.md`

Fill in during monitoring:

- Live host: `https://<live-crm-host>`
- Deploy finished at: `YYYY-MM-DD HH:mm Europe/Kyiv`
- Live commit observed: `<commit>`
- Live version observed: `<version>`
- Monitor owner: `<name>`
- Business cycle covered: `<date/time range>`

## Automated live checks

Run after deploy finishes and again after the service worker/cache has had time to update.

```powershell
npm run smoke:live -- https://<live-crm-host>
npm run version:smoke -- https://<live-crm-host>
```

Record:

- `/api/version` returns `0.77.11`.
- Login release badge matches `/api/version`.
- No cache/version drift is reported.
- Protected routes still reject unauthenticated requests with `401`, not `500`.

## Banquet sheet functional checks

Use an authenticated manager/admin account and 2-3 real banquet bookings:

- Short banquet.
- Large banquet with many menu/order rows.
- Banquet with finance block and terms/notes.

For each booking record:

```text
Booking ID:
Business context:
Tester:
Checked at:
Result:
Notes:
```

Check:

- `booking-summary.html?id=<bookingId>&businessContext=<businessContext>&mode=client` opens.
- Header logo loads and is not stretched/cropped.
- No old `EG` placeholder is visible.
- Table text wraps without overlap.
- Finance block is visible when expected.
- Terms block is visible when expected.
- Final brand/footer is visible.
- Browser print dialog/PDF preview opens.
- Server PDF export works for:
  - client PDF
  - kitchen PDF
  - staff PDF, if the user role can access it

## Network checks

In browser devtools or a HAR/network log, confirm:

- `GET /booking-summary.html?...` returns `200`.
- `GET /js/booking-summary-page.js?v=0.77.11` returns `200`.
- `GET /css/booking-summary.css?v=0.77.11` returns `200`.
- `GET /images/banquet-logo.png` returns `200`.
- `GET /api/bookings/<bookingId>/banquet-summary?...` returns `200` for authenticated user.
- `GET /api/bookings/<bookingId>/banquet-summary.pdf?...` returns `200` and `Content-Type: application/pdf`.
- No `500` responses appear in the banquet summary or PDF flow.

## Server log checks

Review production logs for the first working cycle after deploy.

Search for:

```text
banquet-summary
banquet-summary.pdf
banquet_summary_pdf_validation_failed
booking-summary-page
banquet-logo.png
500
404
Unhandled
Error:
```

Acceptance signals:

- No live `500` for `/api/bookings/:id/banquet-summary`.
- No live `500` for `/api/bookings/:id/banquet-summary.pdf`.
- No repeated `404` for `/images/banquet-logo.png`.
- No service-worker cache mismatch reports.
- Validation failures, if any, are expected data-quality errors and not layout/server crashes.

## User confirmation

Collect 1-2 confirmations from real users after they open/export a real banquet sheet.

Confirmation 1:

```text
User role:
Booking ID:
Checked HTML: yes/no
Checked PDF: yes/no
User feedback:
Confirmed at:
```

Confirmation 2:

```text
User role:
Booking ID:
Checked HTML: yes/no
Checked PDF: yes/no
User feedback:
Confirmed at:
```

Acceptance:

- At least one manager/admin confirms a real banquet sheet looks correct.
- Prefer two confirmations if the first checked only a simple banquet.

## Bug task template

Create a separate bug task for each issue. Do not hide multiple symptoms under one generic task.

```text
BUG — Banquet sheet post-release issue: <short symptom>

Production impact: yes.

Observed:
- Live host:
- Booking ID:
- Business context:
- User role:
- Time observed:
- Browser/device:
- URL:
- Request ID/log correlation, if available:

Symptom:
<what user sees>

Expected:
<what should happen>

Actual:
<what happened>

Reproduction path:
1. Log in as <role>.
2. Open <URL>.
3. Click/export <action>.
4. Observe <failure>.

Evidence:
- Screenshot:
- PDF artifact:
- Network status:
- Server log excerpt:

Initial classification:
- HTML render
- PDF export
- logo asset/cache
- service worker/cache drift
- data-quality validation
- permission/auth
- unknown

Rollback needed now: yes/no
Suggested next action:
```

## Completion criteria

Mark monitoring complete only when all are true:

- Automated live smoke/version checks pass.
- No live `500`/unexpected `404` for banquet summary or logo asset.
- Production PDF generation works for at least one real booking.
- At least one manager/admin confirms a real banquet sheet looks correct.
- Any discovered defects have separate bug tasks with reproduction paths.
