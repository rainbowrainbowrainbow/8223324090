# CERT-CLOSE-03 — release and live QA evidence

Production impact: yes. Verified on 2026-09-26. The v0.82.18 release and v0.82.19 booking precheck follow-up are delivered.

## Release identity and gates

- Production branch: codex/eventgenix-production. Release v0.82.18 SHA: a059e7ac29e585d75da1d36cbbf5ef6aa616be3b. Previous live SHA: 814900eab52278a4bd81231aba494f99e9678bbf.
- Authorized Red block: CERT-CLOSE-03-RED-FCE8B674. The canonical production controller signed block EG-20260926T111517Z-9492a8f9 at candidate SHA 9492a8f907057ac416f2103e9f18188c198b32a4. Its dry-run passed with the exact Red paths routes/auth.js and routes/finance.js, one certificate QA scope, and migration 371 only.
- Local Node 22.23.1/npm 10.9.8: full npm test passed after normalizing a Windows CRLF fixture in tests/checkin-reliability-contract.test.js. The candidate branch CI [run 36238153545](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36238153545) failed only in the certificate browser smoke: confirmation dialog did not detach within 30 seconds. The same tests on the exact release SHA passed in all 8 jobs: [run 36238494774](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36238494774). This intermittent browser test needs investigation; it did not block the required exact-SHA gate.
- The canonical controller committed the patch version and Ukrainian release notes, pushed the exact SHA, waited for green CI, and invoked release:railway-up. Railway project fortunate-appreciation, production service 8223324090, deployment acbeec32-5468-4fb9-b5a4-573857f3a58e: SUCCESS.
- Live /api/version and version smoke confirmed v0.82.18, exact SHA, source branch codex/eventgenix-production, and archive manifest metadata. Timeline release proof passed. Migration 371_trusted_qa_certificate_lookup and its partial index were confirmed in production through a read-only transaction.

## Booking precheck follow-up release

- The v0.82.18 live QA found that `index.html` lacked the certificate input, result, and Validate button although `js/booking.js` had a handler. The narrow fix added those controls, Park-only visibility and stale-result invalidation, an explicit QA refusal message, a form regression, and a focus wait in the browser smoke. It did not change schema, roles, permissions, or protected booking identity/detail contracts.
- Authorized production block `EG-20260926T115455Z-f4272c77`, candidate `f4272c774fe2366bfcdfaaa2e3f2bef207e49ce2`. The canonical controller ran the full local gate, committed the patch version and Ukrainian release notes, pushed the production branch, and waited for [exact-SHA CI run 36241568971](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36241568971): 8/8 jobs successful, including certificate regression.
- Release v0.82.19 SHA `b0b466743e929d48681f741e8df571ee23d21b28`, source branch `codex/eventgenix-production`. Manual Railway deployment `b9e00eee-9f54-4f0e-930f-fa6dc1b3c42b` is `SUCCESS`. Version smoke confirmed v0.82.19, exact SHA, branch, and manifest metadata; timeline release proof passed. No migration was included.
- Separate test-account browser QA opened the Park booking panel without saving. The certificate field, button, and result were visible. A read-only precheck of the previously used isolated QA certificate (internal ID 921) displayed `Сертифікат уже використаний.` and no green availability. At 390×844, document width was 390 px; Tab moved from the input to `certValidateButton`. No new QA certificate or booking was created. The browser was closed and its temporary code file removed.

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

## Remaining limits

- The v0.82.18 form gap was closed by v0.82.19 and verified live with a used QA certificate. The earlier browser confirmation timeout was addressed by waiting for dialog focus; candidate and exact release CI are green. This live follow-up did not create an ordinary production booking or another QA certificate. Other role and redemption states remain covered by the isolated regression gate.

The deployed app SHA `b0b466743e929d48681f741e8df571ee23d21b28` is distinct from the subsequent documentation-only commit.
