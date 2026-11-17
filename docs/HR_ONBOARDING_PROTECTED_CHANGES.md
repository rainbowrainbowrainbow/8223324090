# HR onboarding decisions requiring owner authorization

## Park profession departments

The isolated Park fixture reproduced HTTP 403 for an owner saving a profession. The current Park profession service is a read-only lane, and the legacy staff boundary denies writes to the shared catalog. The hiring form already reflects persisted department assignments. A desktop UI alone cannot enable editing in Park.

Proposed scope: add a Park catalog operation that changes only the department of an existing Park-owned profession. Use the existing organization membership and business scope resolver plus the existing staff management capability. Return a reduced profession response. Leave other profession attributes, archives, checklist writes, payroll, and non-Park businesses under their current policy. Establish catalog ownership before allowing a write. If ownership cannot be proven from the current model, present the required data model decision first.

Review surfaces: `services/parkHrProfessionRead.js`, `services/legacyBusinessSurface.js`, `routes/hr.js`, the profession editor, and the Park permission and staff browser suites. Prove positive and negative cases for Park managers, read-only members, expired memberships, cross-business requests, and attempts to send other fields. Roll back the route change to return to read-only mode. Preserve previously saved department values. Merging actual duplicate records is a separate data operation requiring an inventory and separate authorization.

## Existing staff account issuance

The existing wizard already links an existing staff card by ID, generates an editable initial password, and reports whether membership is active. Its optional sections still allow changing profession, work terms and extra permissions. The role defaults are currently derived in the client and mirrored in the service. Existing identity and membership proofs should carry forward.

Proposed scope: issue an account against an existing eligible staff card using the server's mapping for its stored primary profession. Show the resolved CRM role and business as a read-only summary. Require manual follow-up through existing account administration when an eligible role cannot be resolved. Do not pick animator implicitly. Keep existing target role, principal, and membership checks. Remove the profession, structure, working conditions and advanced access controls and their payload logic from the short issuance form. Keep the separate authorized administration paths and inventory existing API consumers before retiring server compatibility.

Review surfaces: `js/hr-page.js`, `hr.html`, `services/accountOnboarding.js` and `routes/users.js`, plus the standalone staff issuance entry if it remains in use. Reuse the existing idempotency, credential recovery and membership result. Test cook, unknown profession, elevated or mismatched role, denied operator, unresolved business membership, unchanged staff conditions, replay, and business boundaries. Roll back by redeploying the previous build. A rollback does not revoke accounts already issued.

## Pay presentation and effective terms

The current payroll engine supports hourly, daily and monthly rates and weekday-specific rules. The scoped UI copy now expresses the existing reserve rate and calculation preview in Ukrainian. The owner asked to keep initial rate setup employee-centered. The Microsoft reference is still unidentified.

Proposed scope: prioritize the existing effective pay controls and place reserve rates after them. Keep a visible summary of the resolved rate and effective date. Support a local draft for unfinished effective terms and a deliberate apply action. Keep current formulas, rate precedence, period locks and persistence endpoints. If separate weekday/day-unit behavior exceeds current rules, show the exact gap and test case before proposing a calculation change.

Review surfaces: `hr.html`, `js/hr-page.js`, affected existing payroll tests, and any server files only if the UI cannot express a required existing rule. Use isolated PostgreSQL to compare legacy, personal, weekday, zero, and monthly cases before and after. Roll back the UI commit while retaining rates recorded through authorized existing workflows. Real payroll changes are excluded from local verification.

## Release boundary

This review document itself grants no permission. Separate approval is required before implementing the protected access and payroll changes above. Production promotion is a later Yellow block with the verified exact candidate, live and remote heads, deployment target, migrations, rollback reference and QA limits. The currently prepared additive migrations are 413 and 414 on the worktree base. Their numbers must be checked against the then-current production branch.
