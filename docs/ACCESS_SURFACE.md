# Event Genix Access Surface Map

This document records how Event Genix keeps page access, sidebar visibility, and
static page ownership aligned. The machine-readable exceptions live in
`config/accessSurface.js`; `npm run check:access` runs
`scripts/check-access-matrix.js`.

## Why This Exists

Access drift is easy in this codebase because the same intent is represented in
several places:

- `config/permissionRegistry.js` owns page/action keys, aliases, and default role
  presets.
- `services/accountAccessPolicy.js` derives effective decisions and validation
  from that registry; `middleware/auth.js` and API routes consume the service.
- `js/auth.js` consumes the server capability snapshot; it does not own a
  separate permission matrix.
- `js/components/sidebar.js` owns navigation presentation only and delegates
  visibility to `canAccessPage`.
- `config/staticSurface.js` owns root HTML pages, legacy aliases, embedded
  routes, and public landing/static routes.
- `config/accessSurface.js` owns the access-specific exceptions that should not
  be guessed from code comments.
- `config/permissionRegistry.js` is the machine-readable inventory of all
  current page/action keys, canonical aliases, HR tabs, navigation links, and
  known frontend/backend/API consumers. It is the runtime source for role presets.

The rule going forward: if a page, sidebar item, role, static alias, hash-modal
bridge, or public/embedded exception changes, update the access guard and this
document in the same pack.

## Guarded Invariants

`npm run check:access` verifies:

- backend and frontend `ROLE_HIERARCHY` match;
- every role has `ROLE_NAMES`, `ROLE_PERMISSIONS`, `ROLE_DEPARTMENTS`, and
  `DEFAULT_WIDGETS` coverage;
- frontend capability catalogs are hydrated from the backend registry projection;
- backend and frontend `resolveCapability` decisions match for parity cases;
- every sidebar link maps to a registered page capability, including hash-modal
  links;
- root static canonical pages and non-embedded aliases have matching
  `PAGE_ACCESS`, unless they are documented exceptions here;
- protected root static pages load `js/auth.js`, or are explicit redirect
  shells to another `PAGE_ACCESS` route;
- every `PAGE_ACCESS` entry resolves to a static page, static alias, or
  hash-modal ownership entry.
- `npm run check:permission-registry` verifies that the inventory contains
  exactly the current 42 canonical page keys and 49 action entries, rejects unknown keys,
  validates default-role parity, resolves aliases, and requires enforcement
  evidence or an explicit deprecated marker.

## Public Static Page Exceptions

| Path | Owner | Reason |
| --- | --- | --- |
| `/invite` | invite | Invite/onboarding entrypoint must be reachable before a signed-in CRM session. |

`/invite` is intentionally not part of `PAGE_ACCESS`. Do not add it to the
authenticated page matrix unless the invite flow itself is redesigned.

## Embedded Static Page Exceptions

| Path | Parent Path | Owner | Reason |
| --- | --- | --- | --- |
| `/embed/designs` | `/designs` | designs | Embedded art-director view served from `designs.html`; not a standalone sidebar/page-access route. |
| `/embed/programs` | `/programs` | programs | Embedded art-director view served from `programs.html`; not a standalone sidebar/page-access route. |
| `/embed/graduation` | `/graduation` | graduation | Embedded art-director view served from `graduation.html`; not a standalone sidebar/page-access route. |

Embedded pages inherit their business/API protection from the underlying
feature APIs and parent page ownership. They should not appear as first-class
sidebar entries unless they become standalone pages.

## Hash-Modal Page Access

| Path | Sidebar Href | Redirect Target | Owner | Reason |
| --- | --- | --- | --- | --- |
| `/settings` | `#settings` | none | settings-modal | Hash-modal surface in `index.html`; no standalone root HTML file. |

These paths stay in `PAGE_ACCESS` because UI visibility checks and sidebar
actions need a role matrix even though the UI is modal-based. Certificates and
Afisha were promoted from modal bridges to standalone static surfaces:
`certificates.html` serves `/certificates`, `/certificates/new`, and
`/certificates/batch`; `afisha.html` serves `/afisha`.

## Root-Shell Business Aliases

| Path | Owner | Reason |
| --- | --- | --- |
| `/maysternya-doli` | timeline | Private root-shell timeline context for `Майстерня долі`; visible by creator role or per-user page allowlist, with data isolated by `business_context=maysternya_doli`. |

Root-shell business aliases reuse `index.html`, but they still need explicit
`PAGE_ACCESS`, sidebar access, and backend context checks because storage and
API payloads are business-scoped.

## Sidebar Role Exception

| Path | Owner | Reason |
| --- | --- | --- |
| `/` | timeline | Timeline page access allows all staff except waiter, but the sidebar exposes the link to operations roles only. |

This is the only approved page/sidebar role mismatch. Add a new row before
adding another mismatch.

## Done Marker

This pack is considered done when all of these remain true:

- `npm run check:access` passes.
- Any new protected static page has a `permissionRegistry` entry.
- Any new protected static page loads `js/auth.js`, unless it only redirects to
  another protected page.
- Any new sidebar link maps to a registered page capability.
- Any new public page, embedded route, modal bridge, or intentional sidebar role
  mismatch is listed in `config/accessSurface.js` and this document.

## Access-hardening baseline (Tasks 4-8 and Task 11)

The following capabilities are server-enforced and their UI controls stay
fail-closed until the authenticated permission catalog is ready:

| Surface | Required capability contract | Guardrail |
| --- | --- | --- |
| Revenue-bearing booking, banquet, deposit, and subscription fields | `view_revenue` | Mixed payloads are shaped before serialization; financial-only endpoints deny before service/DB work. |
| Subscription, packages, feature flags, catalog settings, lead-assistant settings, and program-icon settings | `manage_settings` | Mutations use canonical action guards; catalog prices remain readable without revenue access. |
| Payroll, HR reports, attendance artifacts, and staff schedule XLSX | domain view/export capability **and** `export_data` | API guards run before query/workbook generation; UI does not start a forbidden export. |
| Public webhooks and machine APIs | integration contract owner + signature, secret, or API key | Public allowlisting only reaches a route-level integration guard; no user action allow/deny list is used for machine identity. |
| Task Center create/delete/review routes | `tasks.create`, `tasks.delete`, and `tasks.review` | Route-level guards use canonical action decisions, explicit deny wins over role defaults, and create controls stay hidden until `/api/tasks/permissions` hydrates. |

`npm run check:action-permissions`, `npm run check:permission-registry`,
`npm run check:capability-policy`, `npm run check:auth-boundary`, and
`npm run check:api-surface` form the static drift baseline. In particular, the
action check rejects any new `/export` route without `export_data` or the
documented Finance export guard.
