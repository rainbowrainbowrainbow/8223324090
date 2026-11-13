# Freelance shift blocks

Base: `dd511e2f0da52da1401502991a68d476eee9ce44`, verified against the production branch ref via GitHub. The isolated feature worktree does not include the unrelated performance checkout changes.

- Schedule: migration 392 adds the work mode to the canonical HR shift segment. The schedule and HR serializers expose it. The schedule editor and fill template submit it, the copy route keeps it, and the schedule filter matches staff with at least one matching segment in the selected period.
- Compatibility: identified existing freelance segments retain their mode when the request omits the field. Implicit replacement through older writers is rejected. Legacy staff-level placeholders are independent.
- Rates and confirmation: migration 393 adds versioned profession/person defaults, terms snapshots and an explicit allocation confirmation. Scheduling takes a dated snapshot of the winning default. Authorized operators can append explicit terms before confirmation. The time split must sum to the attendance fact. Database guards protect confirmed facts and linked blocks.
- Payroll: confirmed freelance minutes are excluded from the regular time, profession and worked-day inputs. Physical totals still reflect both formats. Mixed per-shift rates require review. An existing monthly regular block must be preserved before adding freelance time. A marked day off or confirmed regular preference provides additional scheduling context for a new day.
- Finance: migration 394 links partial payments and reversals to the existing finance ledger. The block row lock serializes payments, a request fingerprint protects replay, and status is derived from the balance. Registration makes no provider calls.
- UI: Finance → Зарплати → Фріланс — до розрахунку opens the selected work date and older outstanding blocks. Existing payroll actions control viewing, terms, attendance confirmation, payment and reversal. The schedule editor shows authorized estimates from the saved terms.
- Import and reassignment: the legacy import writer rejects a change that would flatten a freelance day. A schedule replacement can move an unagreed block and resolve the incoming worker's terms. Existing agreed terms or a recorded start require a new assignment, so the previous worker's rate and history stay attached.
- Verified on isolated PostgreSQL: two independent full-payment transactions produced one finance movement. A retry with the winning key returned the existing movement. The same suite covers the legacy import rejection and protects agreed terms from reassignment.
- Verified in Chromium against the PostgreSQL-backed app in compatibility mode: schedule save and reload, the freelance filter, role denial, terms, confirmed time, payment registration and reopening at 390 px. Screenshots are in the browser test output. Human review is pending. The prior full baseline passed, including 3,987 unit tests. A new baseline is running for the changes above.
- Verified monthly and hourly cases on PostgreSQL: keeping the existing regular block permits an extra freelance block. Replacing planned regular work is rejected. A confirmed mixed day with a frozen hourly rate produces 480 UAH in regular pay and an independent 871 UAH freelance amount. The per-shift calculation flags mixed-day review.
- Membership-mode access: the existing Park payroll gateway intentionally has no membership-enabled write lane for settlements. The freelance API currently follows this existing gate. Compatibility-mode browser evidence does not establish that the finance flow is available to Park membership-mode accounts. Resolving that boundary requires a separate scoped owner decision.
- The Park schedule projection includes the operational work mode on plans and factual allocations. It still strips the agreed rate, estimate and compensation details. A regression test covers both the round trip and the redaction.

The PostgreSQL integration tests use an already migrated isolated local test database. Run them with `RUN_FREELANCE_SHIFT_INTEGRATION=true`, `TEST_DATABASE_URL` and the repository test target guard. The first fixture rolls back. The concurrency and browser tests commit synthetic history and require a disposable database.

The actual app browser test is `tests/browser/freelance-shift-actual-app.js`. Set `RUN_FREELANCE_SHIFT_BROWSER=true`, the local `TEST_URL` and the isolated database variables. Use the existing Playwright tools and, if needed, point `FREELANCE_CHROMIUM_PATH` to a local Chromium binary. The test verifies authenticated schedule save/reload, role denial, confirmed time, payment registration and screenshots in `output/playwright/freelance-shift`.

Do not enable this feature in production from a partially verified build. The existing protected payroll release manifest is specific to its approved inventory and cannot be reused for this change. Review a release path separately. Retain migrations 392–394, confirmed attendance and finance movements on rollback. A compatible rollback build must keep work mode, payroll filtering and history guards whenever any freelance work has been recorded.

## Proposed Park access scope for owner review

The change would use the existing Park membership and ownership checks on these exact method/path pairs. It requires separate approval before editing the gateway.

| Operation | Existing capability |
| --- | --- |
| GET `/api/payroll/freelance/day`, `/api/payroll/freelance/settlement` | `view_payroll` |
| GET or POST `/api/payroll/freelance/rates`, POST `/api/payroll/freelance/terms` | `manage_payroll_rules` |
| POST `/api/payroll/freelance/attendance` | `manage_payroll_accrual` |
| POST `/api/payroll/freelance/payments` | `confirm_payroll_payment` |
| POST `/api/payroll/freelance/reversals` | `reverse_payroll_payment` |
| GET `/api/payroll/freelance/payment-options` (proposed dedicated endpoint) | `confirm_payroll_payment` or `reverse_payroll_payment` |

Use fresh single-business Park membership, existing payroll visibility and explicit deny rules, and writable business scope for every mutation. Keep the generic payment-options route and existing payroll settlement routes unchanged. Exercise the full browser flow using a synthetic membership-mode operator, then check denied access for another business, read-only scope, revoked membership and each explicit capability deny. Rollback removes only the exact freelance route admission and retains history and the ordinary-payroll filter.
