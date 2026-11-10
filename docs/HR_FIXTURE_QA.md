# Park HR fixture acceptance

This runbook applies to a separately approved disposable QA run. It uses the normal Park staff, profile, account onboarding, linking and membership routes with an additional run token. The token cannot grant page, action, business or account permissions.

## Plan

Use an exact deployed SHA and two existing isolated test accounts. The owner account must already have Park organization ownership, the HR page, full HR access and account management. The delegate must already have the HR page, create and basic-edit rights, with no account or payroll viewing access. The test accounts must be active, recognizably marked as QA and free of active staff links.

Prepare a private plan containing `runId` (`hrqa-` followed by 12 lowercase hexadecimal digits), `ownerId`, `delegateId`, `releaseSha` and `ttlMinutes` (1–30). Use the approved process-local audit credential to run:

```text
node scripts/trusted-qa-hr-run.js --mode plan --plan-file <absolute-private-plan>
```

The plan command opens a read-only transaction. If membership access is unavailable, have the authorized operator produce a read-only preflight against the exact plan. Do not infer access from platform roles or from the real employee accounts.

After approval of the returned hash, create the run using the exact operator connection for the approved target. Store the token in a private directory outside the repository. On Windows verify the directory owner and ACL before use.

```text
node scripts/trusted-qa-hr-run.js --mode create --plan-file <absolute-private-plan> --approved-hash <sha256> --confirm EXECUTE_EXACT_HR_FIXTURE_QA --token-file <absolute-private-token>
```

Use `--local` only with the repository's isolated disposable database guard. Production acceptance uses its own write authorization and run scope.

## Browser and API sequence

Use the two test sessions in separate Playwright contexts with service workers blocked. Install `installHrFixtureQaBrowserGuard` from `scripts/hr-fixture-qa-browser-guard.js` before navigating to the app. It blocks cross-origin traffic, WebSockets and unexpected writes, and attaches the run token only to the six scoped routes. Never write the token to browser storage, a trace or screenshots.

1. As the delegate, create `<runId>-staff-1` in HR Team. Use a single animator profession. Edit its position and reopen the same ID.
2. As the owner, use the wizard for the first registered card with login `<runId>-account-1`. Use the same staff name, animator role and Park business. Keep compensation unchanged, with no role or page overrides.
3. Use the wizard for `<runId>-staff-2` and `<runId>-account-2`, again without compensation or structure changes. Repeat the exact creation operation with its original idempotency key. Compare both IDs. The recovered receipt omits the password.
4. Confirm the pending account state. Assign one registered account an animator business membership and organization member role in the same Park organization. Verify a fresh session. Revoke that exact membership and verify that the old session has lost business access.
5. Confirm the two staff IDs, two CRM accounts, two exact profile links and one registered membership pair. A confirmed QA run suppresses default chat enrollment. Use synthetic data and retain only sanitized results.

## Retire

Run the exact finish command after the browser work, including when the work stops on a failure or a lost response. The plan and approval hash also bind cleanup after expiry.

```text
node scripts/trusted-qa-hr-run.js --mode finish --plan-file <absolute-private-plan> --approved-hash <sha256> --confirm EXECUTE_EXACT_HR_FIXTURE_QA
```

Cleanup locks the run and its registered rows, validates fixture markers and dependencies, then retires exact staff cards, role assignments, CRM accounts, profile links, memberships and sessions. It preserves audit records, the operation ledger and inactive fixture rows. Unexpected links, chats, schedules, time records, payroll reports, documents or resource assignments stop the cleanup transaction. Repeat the exact finish command after investigating an interruption. Keep the original run plan and the private token file until the registry confirms cleanup.

The real owner and Anna can review the result and confirm the UI from their own sessions. Test sessions use the isolated accounts described above. Never use an actual employee's password to automate the run.
