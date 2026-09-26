# CERT-CLOSE-03 — release and live QA evidence

Production impact: yes. Verified on 2026-09-26. The release was delivered; the booking form gap below remains open.

## Release identity and gates

- Production branch: codex/eventgenix-production. Release v0.82.18 SHA: a059e7ac29e585d75da1d36cbbf5ef6aa616be3b. Previous live SHA: 814900eab52278a4bd81231aba494f99e9678bbf.
- Authorized Red block: CERT-CLOSE-03-RED-FCE8B674. The canonical production controller signed block EG-20260926T111517Z-9492a8f9 at candidate SHA 9492a8f907057ac416f2103e9f18188c198b32a4. Its dry-run passed with the exact Red paths routes/auth.js and routes/finance.js, one certificate QA scope, and migration 371 only.
- Local Node 22.23.1/npm 10.9.8: full npm test passed after normalizing a Windows CRLF fixture in tests/checkin-reliability-contract.test.js. The candidate branch CI [run 36238153545](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36238153545) failed only in the certificate browser smoke: confirmation dialog did not detach within 30 seconds. The same tests on the exact release SHA passed in all 8 jobs: [run 36238494774](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36238494774). This intermittent browser test needs investigation; it did not block the required exact-SHA gate.
- The canonical controller committed the patch version and Ukrainian release notes, pushed the exact SHA, waited for green CI, and invoked release:railway-up. Railway project fortunate-appreciation, production service 8223324090, deployment acbeec32-5468-4fb9-b5a4-573857f3a58e: SUCCESS.
- Live /api/version and version smoke confirmed v0.82.18, exact SHA, source branch codex/eventgenix-production, and archive manifest metadata. Timeline release proof passed. Migration 371_trusted_qa_certificate_lookup and its partial index were confirmed in production through a read-only transaction.

## Isolated certificate QA

- Before writing, the operator plan was rerun read-only for exact QA account ID 48, Park context, run certclose03_20260926_release, 30-minute TTL, and one-certificate limit. It confirmed the account was isolated and no certificate QA run was open. The browser credentials matched that account; the owner session was not used.
- One trusted QA run and one certificate (internal ID 921) were created through the approved operator and normal certificate API. The generated code, recipient marker, run token, credentials, and customer data are omitted from this report.
- A new anonymous browser session opened the QR deep link, redirected to login, and returned to the same code after QA-account login. The page showed an available one-time redemption. Canceling confirmation left status active, used_at empty, and zero redemption history.
- At 390×844 the check page had no horizontal overflow, and the redemption button stayed in the viewport. Tab reached Verify and Redeem; Enter opened the confirmation.
- One confirmed UI redemption showed the used state. Reload kept it used and removed the redemption button. A direct repeat redemption POST returned HTTP 409, reason certificate_used. A read-only DB check found used_at set and exactly one certificate_used history row.
- Booking validate API returned valid=true, canRedeem=false, redemptionReason=qa_booking_unavailable for the active QA code. No ordinary booking was created. Registry search returned zero items for the QA run. The operator finish completed with state cleaned and entityCount=1; its side-effect inventory found no persistent business, finance, notification, or external event rows. After finish, the certificate remained used, the QA manifest remained cleaned, and history still contained exactly one redemption. Both isolated browsers and exact temporary token/code files were closed or removed.

## Type mapping and rollback

- Aggregate-only production audit after QA at 11:41 UTC found 929 physical certificates: 495 exact one-time labels, 3 exact subscriptions, 431 other unmapped. The trusted QA manifest accounts for one physical certificate; business-visible count was 928. The increase in other physical records since the 10:36 UTC baseline is not attributed to this QA run. Rollback audit remained unsafeGrants=0 and safeDenials=0.
- Migration 371 is an additive partial lookup index. Preserve the trusted QA manifest and business-read filters during any rollback, so the historical QA record cannot re-enter business counts. Stop new QA issuance and inventory/finish active runs before promoting an older binary. Do not reactivate the used code.

## Open findings

- The current booking form in index.html has no certCodeInput or certValidationResult element and no Validate button. The certificate handler in js/booking.js therefore cannot be exercised from that form. The published release note says the form shows precheck availability; that claim is inaccurate for the current UI. The server validate response and transaction guard behaved correctly, but the live form scenario is unverified. A focused form wiring fix, regression test, exact-SHA CI, and new release are required.
- Candidate branch CI showed one intermittent confirmation-dialog timeout while the exact release SHA was green. Stabilize that browser smoke so the certificate gate remains dependable.

The deployed SHA above is distinct from any subsequent documentation-only commit.
