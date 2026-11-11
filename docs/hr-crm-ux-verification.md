# HR → CRM UX verification

The existing HR card and account onboarding endpoint remain authoritative. Existing-person onboarding uses three steps; new-person onboarding uses four. Optional setup, compensation and extra access are explicit opt-ins. This change does not alter permission presets, business membership policy or schema.

## Regression boundaries

- Existing staff IDs, legacy profession columns, assignments and base rates are preserved when setup is omitted. Explicit condition writes retain payroll authorization and validate the locked staff's saved professions.
- Receipts distinguish created cards from linked cards, active from pending business access, and unknown recovery fields from empty values. Recovery does not reissue credentials.
- The card's onboarding CTA uses onboarding options for delegates; it does not expose the account directory or password actions.
- Card menus use the browser top layer where supported, retain a fixed-position fallback, and close on anchor movement. A queued pre-click scroll event must not dismiss a newly opened menu.
- Loading saved role assignments establishes a clean scope baseline. Merely visiting profile tabs must not create a dirty draft.

## Reproduction

Use Node 22/npm 10. Use only a disposable local PostgreSQL database with the runner's `TEST_DATABASE_URL` and `TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE` safeguards. Never point these commands at production.

```text
npm test
node scripts/run-isolated-postgres-tests.js hr-staff-account
node scripts/run-isolated-postgres-tests.js onboarding
```

For the visual matrix set `EG_HR_UX_VISUAL_AUDIT=1`. For advanced owner settings and native 200% browser zoom also set `EG_HR_UX_EXTENDED_AUDIT=1` and `PLAYWRIGHT_CHROMIUM_FULL_EXECUTABLE_PATH` to a full Chromium executable. An optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects the headless shell. The native zoom audit creates its own temporary browser profile and local extension; it never uses the owner's browser profile.

```text
npx --yes --package playwright node scripts/run-isolated-postgres-tests.js hr-staff-browser
node scripts/build-hr-crm-ux-gallery.js
npx --yes --package playwright node scripts/render-hr-crm-guide.js
```

The browser harness covers 40 role/mode/viewport/theme cases plus six advanced/native-zoom cases. The underlying smoke also captures create/edit, existing account linking, conflicting edits and response-loss recovery. Screenshots are full viewport; one-time passwords are masked. Evidence and the fullscreen gallery are generated under `output/playwright/hr-staff-creation/ux-matrix/`.

The administrator's ordinary entry is the saved HR card CTA. The new-person wizard matrix invokes the same canonical wizard function for this role; it does not assert that the restricted Accounts tab is visible.

`docs/hr-crm-staff-guide.html` is the editable two-page Ukrainian guide, reusing the prior PDF's content and navy/mint presentation. The earlier ReportLab source was unavailable. The renderer writes an explicitly unreleased candidate PDF under `output/pdf/`; the prior published PDF remains historical until release acceptance.

## External acceptance

Local fixtures do not establish Anna's current permissions. Check her exact login, active membership and explicit allow/deny with approved read access before proposing a real-account diff. Physical phone keyboard behavior, screen readers, and Safari/Firefox require separate device checks. Chromium viewport and keyboard coverage is not certification for those environments.

Production push/deploy remains a separate bounded authorization. The standard production controller creates the version/cache/changelog descendant after approval; its prepared manifest is bound to the reviewed functional commit. Do not pre-bump and accidentally cause a second patch increment.
