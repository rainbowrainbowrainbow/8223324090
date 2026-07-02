# Menu Image Agent Workflow Release Audit

Date: 2026-07-02
Branch: `codex/timeline-leads-hardening`
Package version audited before release prep: `0.77.95`
Prepared release version: `0.77.96` (`Menu Image Agent Workflow`)
Scope: pre-release audit and local release preparation for the Hermes/manual kitchen menu image workflow.
Production deploy: performed after explicit user approval.
Release commit: `e30f61f05` (`Release menu image agent workflow`).
Live URL: `https://8223324090-production.up.railway.app`.

## Summary

No release-blocking issue was found in the implemented Hermes/manual menu image workflow.

The implementation is consistent with the intended no-auto-apply architecture:

- external/manual/Hermes image submission creates a reviewable draft only;
- active menu images still live in `products.icon_url`;
- `products.icon_url` is changed by explicit apply actions only;
- draft state lives in `products.ai_card_draft.imageStudio`;
- uploaded/generated assets are stored under `/uploads/catalog-images/items/...`;
- static `js/kitchen-menu-images.js` remains a fallback only.

## Changed Files Reviewed

Tracked modified files:

- `css/pages-products.css`
- `js/api.js`
- `js/programs-page.js`
- `routes/hermes.js`
- `routes/products.js`
- `services/imageStorage.js`
- `tests/auth-boundary.test.js`
- `tests/booking-package-contract.test.js`
- `tests/hermes-auth.test.js`
- `tests/hermes-routes.test.js`
- `tests/image-storage.test.js`
- `tests/product-program-icon-generation.test.js`
- `tests/products-detailed-tech-card.test.js`
- `tests/products-ia.test.js`
- `tests/ui-check.js`

Untracked new files:

- `docs/MENU_IMAGE_AGENT_WORKFLOW.md`
- `docs/MENU_IMAGE_AGENT_WORKFLOW_AUDIT.md`
- `docs/MENU_IMAGE_AGENT_WORKFLOW_RELEASE_AUDIT.md`
- `services/menuImageDrafts.js`
- `tests/menu-image-drafts.test.js`

No database migrations, schema files, env files, secrets, package files, CI/deploy files, or infrastructure settings were changed.

## Architecture Review

### Shared Service Boundary

`services/menuImageDrafts.js` owns:

- safe product context creation;
- external draft payload validation;
- image source normalization;
- image upload through `uploadFromUrl()`;
- draft object construction;
- `ai_card_draft` persistence.

The service header states it never applies images to `products.icon_url`, and the persistence SQL updates only:

```sql
SET ai_card_draft = $1::jsonb,
    updated_at = NOW(),
    updated_by = $2
```

### Product API

Implemented routes:

- `GET /api/products/:id/menu-image/context`
- `POST /api/products/:id/menu-image/external-draft`

Both use existing product auth, product loading, kitchen-menu checks, business context checks, and existing apply/reject flow.

`handleExternalMenuImageDraftRequest()` calls `createExternalMenuImageDraft()` and `persistMenuImageDraft()`. It does not write `products.icon_url`.

### Hermes API

Implemented routes:

- `GET /api/hermes/menu-photos/:productId/context`
- `POST /api/hermes/menu-photos/:productId/external-draft`

Hermes mutation route is wrapped with:

- `requireHermesMutationGuard`
- `ensureWritableTaskBusinessScope`
- `withHermesIdempotency`

Invalid external-draft service errors are converted to Hermes `statusCode < 500` errors inside the idempotency work function, so controlled validation failures are stored/replayed instead of leaving the idempotency key in an in-progress state.

### Manual Operator UI

`/programs#kitchen-menu` image studio now has:

- file input;
- image URL input;
- save-as-draft action;
- controlled busy/error/success states;
- existing Apply/Reject buttons remain the only activation path.

`js/api.js` sends manual drafts to `POST /api/products/:id/menu-image/external-draft`.

### Storage And Security

`services/imageStorage.js` now validates remote and data image ingestion with:

- allowed image MIME types: PNG, JPEG/JPG, WebP;
- default max image bytes: 12 MB;
- redirect limit;
- download timeout;
- response `Content-Type` check;
- response `Content-Length` and streaming byte limit;
- safe source preview logging that does not print base64 payloads.

`services/menuImageDrafts.js` additionally enforces:

- exactly one of `imageUrl` or `imageBase64`;
- `imageUrl` must be `http(s)`;
- `data:image/...` belongs in `imageBase64`, not `imageUrl`;
- max URL length: 2048;
- supported URL extensions when present: `jpg`, `jpeg`, `png`, `webp`;
- private/local host blocking for external URLs;
- redirect URL revalidation through `validateUrl`;
- controlled error codes for invalid payloads.

## `products.icon_url` Write Path Review

Menu image workflow:

- CRM-side draft/generate writes `ai_card_draft`, not `icon_url`.
- Product external draft writes `ai_card_draft`, not `icon_url`.
- Hermes external draft writes `ai_card_draft`, not `icon_url`.
- Product apply writes `icon_url` and marks draft `applied`.
- Hermes apply writes `icon_url` and marks draft `applied`.
- Reject routes do not change the active image unless preserving already-applied state.

Existing unrelated program icon generation routes in `routes/products.js` still write `icon_url` for program icons. That is outside this kitchen menu photo workflow and was not introduced by this task set.

## Acceptance Criteria Check

| Task | Result | Evidence |
| --- | --- | --- |
| Task 0 audit | Passed | `docs/MENU_IMAGE_AGENT_WORKFLOW_AUDIT.md` exists and documents baseline. It is now marked historical. |
| Task 1 baseline handoff | Passed | Runtime confirmed on Node 22/npm 10; audit used as source for implementation planning. |
| Task 2 shared service | Passed | `services/menuImageDrafts.js` centralizes context/external draft validation/storage/persistence and never writes `icon_url`. |
| Task 3 Product context API | Passed | `GET /api/products/:id/menu-image/context` returns safe product facts and image rules. |
| Task 4 Product external draft API | Passed | `POST /api/products/:id/menu-image/external-draft` creates ready draft only and preserves active image. |
| Task 5 Hermes wrappers | Passed | Hermes context/external-draft routes exist; mutation route requires confirmation/idempotency and writable business scope. |
| Task 6 manual UI | Passed | Image studio supports file/URL draft creation and reuses existing Apply/Reject actions. |
| Task 7 booking priority | Passed | Tests assert `iconUrl`/`icon_url` and `/uploads/catalog-images/items/...` beat manifest fallback. |
| Task 8 security hardening | Passed | Validation covers source count, protocols, MIME, URL length, base64 size, file size, extensions, private hosts, redirects, and no base64 echo. |
| Task 9 docs | Passed | `docs/MENU_IMAGE_AGENT_WORKFLOW.md` documents API contract, workflows, stop conditions, examples, and verification commands. |
| Task 10 verification | Passed | Focused tests, UI check, and full `npm test` passed on Node 22/npm 10. |

## Test Coverage Review

Covered by tests:

- Product route/static contract for context/external-draft presence.
- Shared menu draft service context shape, base64 draft, URL draft, persistence, invalid inputs, upload failure, no active image mutation.
- Image storage MIME and size rejection without file writes.
- Hermes context wrapper.
- Hermes auth on context/external-draft.
- Hermes external ready draft idempotency.
- Hermes confirmation and idempotency guard failures.
- Hermes read-only business scope rejection.
- Hermes invalid payload rejection without draft writes or base64 echo.
- Apply/reject active image behavior.
- Booking active image priority over manifest/generic fallback.
- UI/static wiring for manual external draft controls.
- Hermes capabilities/auth contract includes new menu photo actions.

Not covered by automated tests:

- Real browser file-picker interaction against a live app.
- Real external CDN image URL behavior in a deployed environment.
- Production smoke.
- DNS rebinding or resolved-IP SSRF defense.
- Antivirus/image moderation.

These gaps are not release blockers for the scoped MVP, but they should be considered before broad external use.

## Verification Results

Task 10 verification was run on Node 22/npm 10:

```text
npx -y -p node@22 -p npm@10 -c "npm run check:runtime"
Result: passed, Node 22.23.1 / npm 10.9.8.

npx -y -p node@22 -p npm@10 -c "node --test tests/products-ia.test.js tests/products-detailed-tech-card.test.js tests/booking-package-contract.test.js tests/booking-drawer-encoding.test.js tests/hermes-routes.test.js tests/image-storage.test.js"
Result: passed, 150 tests, 0 failures.

npx -y -p node@22 -p npm@10 -c "npm run test:ui"
Result: passed, 1127 checks, 0 failures.

npx -y -p node@22 -p npm@10 -c "npm test"
Result: passed, 1421 unit tests and 1127 UI checks, 0 failures.
```

`git diff --check` reported no whitespace errors. It reported only existing LF-to-CRLF warnings.

Task 12 release preparation:

```text
npx -y -p node@22 -p npm@10 -c "npm test"
Result before version bump: passed, Node 22.23.1 / npm 10.9.8, 1421 unit tests and 1127 UI checks, 0 failures.

npx -y -p node@22 -p npm@10 -c "npm run check:version"
Result after version bump: passed for v0.77.96 - Menu Image Agent Workflow.

npx -y -p node@22 -p npm@10 -c "npm test"
Result after version bump/changelog/docs: passed, Node 22.23.1 / npm 10.9.8, 1421 unit tests and 1127 UI checks, 0 failures.
```

## Documentation Accuracy

`docs/MENU_IMAGE_AGENT_WORKFLOW.md` matches the implemented route names and response/request shapes at the MVP level. JSON examples were parsed successfully during Task 9 documentation verification.

`docs/MENU_IMAGE_AGENT_WORKFLOW_AUDIT.md` remains a historical audit snapshot and now explicitly points to `docs/MENU_IMAGE_AGENT_WORKFLOW.md` as the current operational contract.

## Remaining Risks

Non-blocking risks:

- Manual browser QA has not been performed in a running CRM session.
- Production smoke was intentionally out of scope.
- `imageStorage.js` is shared by other image flows; automated baseline passed, but production providers should still be watched after release.
- DNS-level SSRF protection is not implemented. Current protection blocks obvious local/private literal hosts and revalidates redirects.
- No antivirus or image moderation pipeline is implemented.

## Blockers

No critical release blockers found.

## Release Preparation Status

- Tasks 1-11 are complete.
- Bonus release audit is complete.
- Local release version prepared: `0.77.96`.
- Ukrainian release notes were added to `CHANGELOG.md` and the visible `index.html` changelog modal.
- Version cache tags were synchronized through the existing `version-sync.js` flow.
- Release commit was pushed to `origin/codex/timeline-leads-hardening`.
- Production deploy was approved by the user and completed through the production target branch.
- PR and infrastructure changes were not performed.

## Post-Deploy Verification

Recorded: 2026-07-02 15:39:49 +03:00.

```text
git push origin codex/timeline-leads-hardening
Result: pushed e30f61f05 to production target branch.

npx -y -p node@22 -p npm@10 -c "npm run version:smoke -- https://8223324090-production.up.railway.app"
Initial result: live was still v0.77.95 while Railway deploy was in progress.
Retry result: passed, live v0.77.96 - Menu Image Agent Workflow.

LIVE_SMOKE_PUBLIC_ONLY=true npx -y -p node@22 -p npm@10 -c "npm run smoke:live -- https://8223324090-production.up.railway.app"
Result: passed public smoke.
Covered: /api/version v0.77.96, /api/health ok, /api/ready schema ok, /api/health/deep schema ok.

npx -y -p node@22 -p npm@10 -c "npm run release:timeline-proof -- https://8223324090-production.up.railway.app"
Result: passed, root and Maysternya Doli timeline asset tags and Service Worker cache names are on v0.77.96.
```

Protected authenticated `smoke:live` was not run because `LIVE_SMOKE_TOKEN`, `LIVE_SMOKE_USER`, `LIVE_SMOKE_PASS`, `TEST_USER`, and `TEST_PASS` were not present in the local environment. No secrets were printed.

## Rollback Plan

Before deploy:

1. Revert the release-preparation diff for `package.json`, `package-lock.json`, versioned asset tags, `CHANGELOG.md`, `index.html`, and `sw.js`.
2. Keep or revert the workflow implementation depending on whether the release is being delayed or cancelled.
3. Re-run `npx -y -p node@22 -p npm@10 -c "npm run check:version"` and `npx -y -p node@22 -p npm@10 -c "npm test"`.

After an approved deploy:

1. Revert the release commit or deploy the previous known-good commit from the release branch.
2. Run `npm run version:smoke -- https://<live-crm-host>` against the restored version.
3. Run `npm run smoke:live -- https://<live-crm-host>` if the live smoke command is available for the target environment.
4. Confirm booking menu image fallback still works and no external-draft route applies images automatically.

Recommended pre-release action:

1. Run one manual QA path in a local/staging CRM session: Hermes/context or manual UI -> external draft -> reject -> external draft -> apply -> booking menu verifies applied `/uploads/catalog-images/items/...` image.
