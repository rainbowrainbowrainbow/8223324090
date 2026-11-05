# Attendance-sheet uploads from HR Today

Local candidate. Manager entry: `/hr#today`. Worker entry:
`/attendance-upload.html#uploadKey=<private random grant>`.

## Workflow and authority

The manager uses the existing attendance-management capability to create an
upload link for an explicit document date. It lasts24hours, accepts at most3
unique photos, can be revoked, and is invalidated if its reviewer loses current
account/membership/module/capability/ownership access or revokes their sessions.
Creation is limited to3links per reviewer in a rolling24hour window; revocation
does not reset this budget. This is possession-based upload access, not proof of
an employee's identity or an attendance mark.

The worker needs no CRM login. A256-bit random key travels only in the URL
fragment and a dedicated request header; only its SHA256 is stored. Exact three
API exceptions are owned by `config/authBoundary.js` and retain global rate
limiting, same-origin checks and the scoped bearer guard. No anonymous roster,
recognized employee rows, staff IDs, payroll data, arbitrary actor/date/model,
JWT creation, group fallback or attendance apply is allowed.

The worker explicitly confirms AI processing and uploads one PNG/JPEG up to4MiB.
The server uses the existing KIE OCR executor, fixed reviewer/date, durable
reservation, image/date/reviewer deduplication and cross-replica provider limits.
Unknown paid outcomes stay held. Retry/recovery never blindly repeats payment.
Worker responses contain only a safe submission receipt/status. Opening a page,
loading an inbox, recovery, refresh and photo viewing do not call a paid model.

The manager sees received sheets in HR Today, can view their private original
photo and opens the existing immutable, actor-owned OCR preview. Eligible rows
start unselected. Separate explicit confirmation applies selected actual
arrival/departure pairs through the canonical transaction; blanks, uncertainty,
conflicts and closed/paid historical periods retain their existing holds. No
planned shifts, automatic attendance or automatic payroll writes are introduced.

## Provider and source storage

The existing server-side KIE Gemini3.8Flash integration/model flag is reused.
Official image-input docs: https://docs.kie.ai/market/gemini/gemini-3-8-flash-openai
The accepted handwriting pilot consumed0.36credits, nominalUSD0.0018 for that
one request atUSD0.005/credit. This is not a fixed tariff, invoice, average or
cheapest-model claim. No additional paid probe is required for this website.

Migration390 adds private upload links, submissions and bounded source-photo
storage only. An original photo is readable by its reviewer for7days. Expired
photo bytes are cleared opportunistically in bounded100-row batches belonging
only to that reviewer when the inbox is used or they receive another upload.
There is no new cron/service. The history, receipts, hashes, previews and actual
attendance rows remain. Expired photos cannot be fetched even before byte cleanup;
this is active-store retention, not a claim about physical erasure from backups.

## Activation and rollback

`CRM_ATTENDANCE_UPLOAD_LINKS_ENABLED` defaults off; existing OCR must also be on.
No feature links or production records are seeded by the additive migration.
No new provider secret or role/session policy change is needed. New public
scoped-access routes and source-photo retention require a separate exact Red
approval before production activation, in addition to the bounded Yellow release.

Release candidate must pass focused boundary tests, the existing actual-app
PostgreSQL/browser gate with a synthetic provider, full npm baseline, exact-SHA
CI, migration390/deployment/version proof and permitted readonly live QA. The
current production0.83.9 remains unchanged until approval. Full Hermes retirement
still has independent unresolved external sender facts.

Rollback: disable only `CRM_ATTENDANCE_UPLOAD_LINKS_ENABLED`, then forward-release
an approved fix if needed. Keep migration390, existing OCR389 and all receipts,
previews, submissions, staff/payroll records and history. No dropping tables,
queue replay, alternative Telegram sender or old-approval reuse.
