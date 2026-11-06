# Business-split UI recovery audit — 2026-11-06

Baseline: production `8ed01107f000330bdda0c4820268ee58572cec2d`, version 0.83.18.

## Confirmed regressions and repair

1. Writable Park `/api/hr/today` responses were treated like the old compatibility namespace because the UI used `todayAccess.readOnly` to choose an identity source. It attempted the unsupported global staff/account-link adjunct and displayed the yellow “Спільні дані працівників” migration warning despite successful manual-attendance access. Both read-only and writable Park responses now keep the existing scoped HR card and skip that unrelated account-link request.
2. The writable Park view showed profile/schedule links without their individual capabilities. Both response modes now use the existing capability checks; manual attendance is still governed by the server's `todayAccess.readOnly`. No capability is granted or stored by this repair.
3. The backend already supports Park catalogs with an enabled `catalogs` business module, while the browser helper only recognized compatibility mode and the Art/certificate recovery flags. The helper now recognizes the explicit server registry module map, with the existing ready-profile and single-Park requirements.
4. Cached legacy denials and in-flight context fingerprints omitted relevant module/recovery state. A refreshed module or recovery flag could leave the old “not migrated” decision attached to the same identity. The fingerprint now includes that surface's server configuration; obsolete entries are discarded and late denials cannot poison the new state.

Only frontend behavior and tests change. Existing route guards, tenant isolation, role definitions, permissions, business/module settings, stored data and provider configuration remain unchanged. No new dependencies or migrations.

## Central legacy-surface inventory

The audit traced all 13 descriptors in `services/legacyBusinessSurface.js`, their mounted routes/internal consumers and the browser helper's call sites.

| Family | Current server contract | Audit outcome |
|---|---|---|
| `catalogs` | Ready single Park membership plus configured catalogs module; separate legacy behavior before cutover | False frontend denial repaired. Disabled modules and other businesses stay denied. |
| `staff` | Broad namespace closed; exact Park schedule, Today, HR card, profession/onboarding reads, monthly report and individual attendance lanes have their own guards | False Today account-link warning and unavailable row links repaired. Broad account linking remains unavailable. |
| `certificates` | Explicit fresh Park recovery availability, page capability and single business | Existing supported lane preserved; refreshed flag invalidates stale cached denial. |
| `art` | Explicit fresh Park recovery availability, page capability and single business | Existing supported lane preserved; refreshed flag invalidates stale cached denial. |
| `booking_templates` | Legacy guard denies membership-mode global templates | Genuine containment, not a false frontend warning. |
| `recurring` | Legacy guard denies membership-mode global recurring namespace | Genuine containment. |
| `finance_salary` | Legacy finance salary report stays closed in membership mode | Genuine containment; no financial operation enabled. |
| `payroll` | Broad legacy payroll stays closed; exact Park preview/export/conditions routes have separate contracts | Genuine partial recovery; no settlement, payment or close lane added. |
| `contractors_procurement` | Shared contractor/procurement namespace is guarded | Genuine containment. |
| `warehouse_photo_intake` | Internal consumer requires its own legacy ownership check | Genuine containment; no photo generation or provider invocation used in this audit. |
| `chat` | Shared chat router and unread socket consumer share the legacy guard | Frontend/server denial agrees. |
| `kleshnya` | Legacy assistant router retains its own guard | Frontend/server denial agrees; unused OpenClaw retirement is a separate completed task. |
| `finance_notifications` | Internal income notification consumer retains its own legacy ownership check | Genuine containment; no notifications sent. |

The Park role-assignment report adjunct, broad staff/account linking, some HR mutations and HR PDF/automation endpoints still lack a membership-mode lane. Removing their legacy guard would be a new backend access/ownership change, not this UI consistency repair. This audit does not claim that the full multi-business migration is complete.

## Verification boundaries

Tests use synthetic users, staff, business/module profiles and local HTTP/browser fixtures. Dedicated production credentials supplied to another chat were not read or used here. No production attendance, roster, payroll, profile, queue or business configuration was changed. No provider generation, Telegram message, paid request, new resource or purchase was made.

Unit coverage includes compatibility behavior, writable/read-only Today, independent capabilities, disabled modules, non-Park/aggregate scopes, unavailable profiles, configuration refresh, late denial and cross-tab business/auth isolation. Browser coverage exercises real HR-card clicks at 390/1440 widths in light/dark themes and catalog selection plus disable/re-enable/business switching. Full `npm test` and exact-SHA CI/deploy results are recorded separately; no future release success is assumed by this audit.
