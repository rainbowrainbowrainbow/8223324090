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
- Verified in Chromium against the PostgreSQL-backed app in compatibility mode: schedule save and reload, the freelance filter, role denial, terms, confirmed time, payment registration and reopening at 390 px. Visual inspection found a regular-pay preview counting freelance time. The corrected browser test verifies 240 regular minutes and the absence of regular pay controls on the freelance block. Screenshots are in the browser test output for human review.
- The full baseline completed with exit code 0, including 3,988 unit tests. The subsequent Park response and preview changes passed focused schedule, HR and Park tests and a fresh actual-app browser journey.
- Verified monthly and hourly cases on PostgreSQL: keeping the existing regular block permits an extra freelance block. Replacing planned regular work is rejected. A confirmed mixed day with a frozen hourly rate produces 480 UAH in regular pay and an independent 871 UAH freelance amount. The per-shift calculation flags mixed-day review.
- The same PostgreSQL fixture preserves a separate freelance day without an agreed rate. Attendance confirmation returns `FREELANCE_TERMS_REQUIRED`, no settlement row appears, and creating a later default does not replace the previously saved plan.
- Membership-mode access: the owner approved the exact freelance routes below. The gateway checks fresh Park membership, payroll visibility, the action permission, writable scope for mutations and attendance ownership. The dedicated payment-options route uses the existing Finance catalog query.
- The Park schedule projection includes the operational work mode on plans and factual allocations. It still strips the agreed rate, estimate and compensation details. A regression test covers both the round trip and the redaction.

The PostgreSQL integration tests use an already migrated isolated local test database. Run them with `RUN_FREELANCE_SHIFT_INTEGRATION=true`, `TEST_DATABASE_URL` and the repository test target guard. The first fixture rolls back. The concurrency and browser tests commit synthetic history and require a disposable database.

The actual app browser test is `tests/browser/freelance-shift-actual-app.js`. Set `RUN_FREELANCE_SHIFT_BROWSER=true`, the local `TEST_URL` and the isolated database variables. Use the existing Playwright tools and, if needed, point `FREELANCE_CHROMIUM_PATH` to a local Chromium binary. With `FREELANCE_BROWSER_MEMBERSHIP=true`, run against a disposable registry owned by the fixture. The test provisions synthetic Park and Dar memberships and verifies schedule save and reload, agreed terms, confirmed time, payment and reversal. It also checks access denial in Dar, aggregate read-only scope and revoked Park membership, and checks explicit permission denies. Desktop and 390 px captures are saved to `output/playwright/freelance-shift-park` for owner review. Compatibility mode saves to `output/playwright/freelance-shift`.

Do not enable this feature in production from a partially verified build. The existing protected payroll release manifest is specific to its approved inventory and cannot be reused for this change. Review a release path separately. Retain migrations 392–394, confirmed attendance and finance movements on rollback. A compatible rollback build must keep work mode, payroll filtering and history guards whenever any freelance work has been recorded.

## Approved Park access scope

The gateway applies the existing Park membership, payroll visibility and ownership checks to these exact method and path pairs.

| Operation | Existing capability |
| --- | --- |
| GET `/api/payroll/freelance/day`, `/api/payroll/freelance/settlement` | `view_payroll` |
| GET or POST `/api/payroll/freelance/rates`, POST `/api/payroll/freelance/terms` | `manage_payroll_rules` |
| POST `/api/payroll/freelance/attendance` | `manage_payroll_accrual` |
| POST `/api/payroll/freelance/payments` | `confirm_payroll_payment` |
| POST `/api/payroll/freelance/reversals` | `reverse_payroll_payment` |
| GET `/api/payroll/freelance/payment-options` | `confirm_payroll_payment` or `reverse_payroll_payment` |

Rollback of Park access removes the freelance route admission and retains work modes, history and the ordinary-payroll filter.
