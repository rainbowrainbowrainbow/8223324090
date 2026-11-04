# KIE schedule OCR: local preparation

This candidate adds an optional KIE chat adapter to the existing planned-schedule
OCR flow. It is not production acceptance or authorization to activate OCR.
The default provider remains OpenAI; existing image-release manifests are unchanged.

## Configuration boundary

The existing `CRM_SCHEDULE_OCR_ENABLED` gate remains off unless explicitly enabled.
The candidate KIE path requires all of:

```text
CRM_SCHEDULE_OCR_ENABLED=true
CRM_SCHEDULE_OCR_PROVIDER=kie
CRM_SCHEDULE_OCR_MODEL=gemini-3-8-flash-openai
KIE_API_KEY=<existing secret, never put in source or evidence>
```

No OpenAI credential is needed for that path. No new service, worker, timer,
dependency, schema migration, public file-upload service, or automatic provider
fallback is introduced. Native HTTP is blocked in tests without injected transport.

The fixed endpoint is
`https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions`.
There is one request with a 45-second timeout, redirects disabled, at most a 4 MiB
PNG/JPEG input, and at most a 1 MiB JSON response. The request asks for JSON and
6,000 output tokens. Replies must contain exactly one completed JSON answer,
at most 100 rows, and no refusal. HTTP-200 business errors are also errors.

## Important unverified provider contracts

[KIE's model documentation](https://docs.kie.ai/market/gemini/gemini-3-8-flash-openai)
documents image URLs and OpenAI-compatible chat. It does not explicitly confirm
inline `data:` image URLs, the requested `max_tokens` / `response_format` fields,
or enforcement of the output token limit. The adapter uses those conventions as
a candidate contract, not as proven KIE behavior. A mocked response cannot prove
provider acceptance, retention policy, actual usage, latency, or handwriting quality.

Do not activate this candidate until a separately authorized, bounded synthetic
probe confirms the inline-image and response contracts. If inline images are
unsupported, stop and review a private transport; do not silently upload employee
photos to public file hosting. Request limits are not a verified monetary ceiling.
KIE retention/privacy terms also need review before sending real staff documents.

## Spending and replay

The existing cross-replica provider lock bounds concurrent submissions. A durable
OCR import reservation is committed before the single paid POST. Failures,
timeouts, malformed replies, and uncertain outcomes keep the reservation for
manual review; they never automatically retry another paid request.

Replay now searches by business context, image hash, creating actor, and document
date independently of model/provider. Switching providers cannot bypass an old
ambiguous reservation. Completed extracted rows reuse their original source
reference and immutable preview. Legacy OpenAI references keep their exact shape.
Missing credentials or an unsupported model fail before creating a new reservation.

An optional receipt callback exposes only whitelisted model/request/token/credit
metadata. Missing usage remains unknown. It is not a durable production cost ledger.
Any future paid pilot must persist its own reservation and receipt journal, including
unknown outcomes. No OCR request is authorized by the earlier image-only pilot.

## Business invariants

The existing UI and HTTP handlers continue to require confirmation before OCR.
The prompt treats text in the image as data and extracts planned schedules only.
Model-assigned staff IDs are discarded. Existing employee/date validation,
low-confidence rejection, schedule-conflict checks, preview ownership and
immutability, selected-row confirmation, and manual apply remain authoritative.
No recognized row is applied automatically and no actual-attendance record is written.

## Verification and future activation

Local evidence is at `D:/Codex/EventGenix/ocr-kie-evidence-20261104`.
Focused unit checks and local disposable PostgreSQL/browser checks use synthetic
staff, dates, PNGs, and injected KIE responses. A real browser goes through the
existing upload UI, HTTP handlers, PostgreSQL preview, selection, and confirmed
apply. There are no real provider calls or production/business-data changes.
Full `npm test` passed on functional commit `70e407a3`: 5,645 TAP executions
across 39 sections, zero failures/skips, Node 22, about 452 seconds. These are
executions, not unique business scenarios. Hosted exact-SHA CI has not run.
This local result does not prove the real KIE or handwriting contracts above.

Before a future release:

1. Verify current production refs; integrate this separate branch without changing
   the already-prepared image candidate or its approval envelope.
2. Run proportionate release checks and exact-SHA CI under a fresh release scope.
3. Obtain a separate, explicit OCR budget, model/request count, privacy decision,
   representative handwritten image and independently checked expected rows.
4. Probe the transport on synthetic data first. Keep reservations/receipts; do not
   retry an unknown paid result. Evaluate row accuracy and safe rejection, not just
   whether the API returned JSON. Preserve human review before any apply.
5. Activate only the verified provider/settings under separate production approval.

Rollback: keep OCR disabled before activation; after activation stop new OCR by
disabling its execution gate, retain all reservations, extracted rows and previews,
and assess any in-flight request before another submission. Do not delete imports
to reset deduplication. A provider switch must preserve the original replay identity.
Do not rely on switching to an older implementation that lacks cross-provider lookup.
