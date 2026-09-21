# BNT-03 lifecycle bug report

## Symptom

The existing Binotel webhook sends every normalized event through generic `processInboundMessage`. A call ID becomes `externalMessageId`, so its generic message de-duplication can discard later answer/completion/recording events rather than update the same call.

## Expected behavior

One `(provider, businessContext, accountId, callId)` identity has one monotonic call projection: start, answer, completion and later recording enrich that projection without cross-business merging or a final state returning to an active state.

## Actual behavior and minimal reproduction

The current normalizer puts its guessed `generalCallID` / `call_id` into an inbound message. Send two events with that ID through `processInboundMessage`; the second is treated by generic message de-duplication, not a call lifecycle update. Existing code also uses `||` for duration, so `0` becomes missing.

## Likely cause

Omni message identity is not call lifecycle identity. The provider's exact lifecycle payload/enums are still unconfirmed, so changing the normalizer or public webhook would currently encode an assumption as a provider contract.

## Verification plan

`tests/binotel-call-lifecycle.test.js` covers canonical start → answered → completed → recording-ready, repeat/delayed active events, scope collision and missing identity. Integrating this reducer with persistence requires confirmed payload mapping plus an approved existing-row upsert strategy; no schema migration has been proposed or applied.
