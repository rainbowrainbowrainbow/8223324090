# CRM image generation through KIE

## Local candidate

The 2026-11-04 synthetic provider pilot confirmed the existing KIE credential and
two successful tasks: menu `nano-banana-2-1` (4 credits, nominal USD 0.02), square
creative `gpt-image-2-5-flare-text-to-image` (6 credits, nominal USD 0.03). Receipts
and original images are retained outside Git in
`D:/Codex/EventGenix/kie-pilot-20261104`. These are one sample per function, not
average quality or cost per approved image. The creative added a punctuation mark
to the supplied price; every output still needs human text and visual review.

The menu generator adds Nano Banana 2.1 as an explicit selection. Existing saved
choices and defaults are preserved. No background catalog or icon generator is
changed. Its menu reference-photo flow remains available.

Creative execution can use KIE without an OpenAI key when both are explicitly set:

```text
CRM_CREATIVE_EXECUTION_ENABLED=true
CRM_CREATIVE_IMAGE_GENERATOR=kie/gpt-image-2-5-flare-text-to-image
```

It also needs the existing nonempty `KIE_API_KEY`. Do not copy that value into a
release manifest, log, browser, Git, or local file. Setting production flags is a
separate authorized production-settings action. This candidate does not set them.
The legacy OpenAI route is retained for explicit configured use; no automatic
provider fallback or second paid request is made after KIE uncertainty.

## Asynchronous lifecycle

1. The existing Studio decision authorization, explicit initial confirmation and
   disabled-by-default execution flag apply. References that would require an
   editing model fail before claiming or paying.
2. A committed canonical job claim precedes the single provider POST. Receipt
   persistence uses existing `hermes_jobs.result_payload` and history: provider,
   model, task ID, executor, `in_progress`. There is no schema migration.
3. Only one unresolved CRM creative is permitted across replicas/contexts; claimed,
   in-progress and needs-input jobs consume the async slot. Saved pending/unknown
   receipts continue to count even after a user decision changes job status; such
   receipts need operator reconciliation if no longer fetchable in Studio. The existing shared
   provider session lock and menu paid-capacity check also apply. This is a
   concurrency/outstanding-work limit, not a monthly financial cap.
4. Each request polls the saved task once, then returns. Studio shows
   **Перевірити результат**. That action also works after a page reload or process
   restart and does not ask for another paid-generation confirmation. There is no
   new always-on worker, callback or polling timer.
5. Temporary status/download/storage failures retain the task and allow a later
   result check. An ambiguous initial POST becomes `needs_input`; a lost receipt
   leaves the committed claim for operator reconciliation. Neither is automatically
   retried, requeued or freed by time expiry.
6. A ready PNG is downloaded through the existing bounded image downloader with
   HTTPS KIE/CDN hostname validation on every redirect and no API credentials on
   asset requests. It must be square and at most 4096 pixels per side. The actual
   dimensions are saved, e.g. 1254x1254, not falsely labelled 1024x1024.
7. The canonical job result, PostgreSQL image blob, asset and history are saved in
   one transaction. Current status/claim/task are rechecked under the same row lock
   used by decisions, so late results cannot overwrite a rejection/cancellation.
   The result is `ready_for_review`. Approval is a separate existing user action.

## Future activation and rollback

Before any release, refresh production Git/live SHA, check parallel work and the
manual release helper guard, run exact-SHA CI, and prepare one bounded release
manifest under `AGENTS.md` and `CODEX_PRODUCTION_AUTONOMY.md`. Include the reviewed
generator string, execution flag, scoped actor/business access and rollback.
Do not reuse previous completed authorizations. No additional paid tests are
included in this candidate's local verification.

Activation review must also cover existing menu paid-guard/recovery readiness.
Their migration/flag state must not be inferred from the KIE pilot. References
need an appropriate supported model; the selected creative model is text-only.
Handwritten OCR quality and external Hermes notification-sender fencing are
independent unfinished tasks and are not enabled by this release.

To stop new creative submissions, disable the execution flag under the approved
settings envelope. Retain all job receipts, assets, decisions and unknown outcomes.
If code is rolled back, keep a task-aware status/recovery path for already pending
tasks; the prior synchronous executor cannot retrieve them. Do not clear claims
or recreate queued jobs to recover an unknown paid result. Provider task failure
needs explicit review before a new revision. Existing user decisions remain intact.

## Provider contracts

- https://docs.kie.ai/market/google/nanobanana-2-1
- https://docs.kie.ai/market/gpt/gpt-image-2-5-flare-text-to-image
- https://kie.ai/nano-banana-2-1
- https://kie.ai/gpt-image-2-5

Request bodies use the model-specific documented fields at fixed 1K resolution.
Prices are provider-published and must be refreshed before a future pricing change.
