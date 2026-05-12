# Event Genix Access Surface Map

This document records how Event Genix keeps page access, sidebar visibility, and
static page ownership aligned. The machine-readable exceptions live in
`config/accessSurface.js`; `npm run check:access` runs
`scripts/check-access-matrix.js`.

## Why This Exists

Access drift is easy in this codebase because the same intent is represented in
several places:

- `middleware/auth.js` exports the server-side `PAGE_ACCESS` matrix and role
  hierarchy metadata used by APIs.
- `js/auth.js` mirrors `PAGE_ACCESS` for browser-side page checks and
  `data-page-access` visibility.
- `js/components/sidebar.js` owns `NAV_ITEMS` and `SIDEBAR_ACCESS` for visible
  navigation.
- `config/staticSurface.js` owns root HTML pages, legacy aliases, embedded
  routes, and public landing/static routes.
- `config/accessSurface.js` owns the access-specific exceptions that should not
  be guessed from code comments.

The rule going forward: if a page, sidebar item, role, static alias, hash-modal
bridge, or public/embedded exception changes, update the access guard and this
document in the same pack.

## Guarded Invariants

`npm run check:access` verifies:

- backend and frontend `ROLE_HIERARCHY` match;
- every role has `ROLE_NAMES`, `ROLE_PERMISSIONS`, `ROLE_DEPARTMENTS`, and
  `DEFAULT_WIDGETS` coverage;
- backend and frontend `PAGE_ACCESS` paths and role sets match exactly;
- every sidebar `NAV_ITEMS` access key exists in `SIDEBAR_ACCESS`;
- sidebar role sets match `PAGE_ACCESS` for linked pages, including hash-modal
  links;
- root static canonical pages and non-embedded aliases have matching
  `PAGE_ACCESS`, unless they are documented exceptions here;
- every `PAGE_ACCESS` entry resolves to a static page, static alias, or
  hash-modal ownership entry.

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
| `/afisha` | `#afisha` | `/?open=afisha` | timeline-modal | Hash-modal surface in `index.html` with a legacy root redirect bridge. |
| `/certificates` | `#certificates` | `/?open=certificates` | timeline-modal | Hash-modal surface in `index.html` with a legacy root redirect bridge. |
| `/settings` | `#settings` | none | settings-modal | Hash-modal surface in `index.html`; no standalone root HTML file. |

These paths stay in `PAGE_ACCESS` because UI visibility checks and sidebar
actions need a role matrix even though the UI is modal-based.

## Sidebar Role Exception

| Path | Owner | Reason |
| --- | --- | --- |
| `/` | timeline | Timeline page access allows all staff except waiter, but the sidebar exposes the link to operations roles only. |

This is the only approved page/sidebar role mismatch. Add a new row before
adding another mismatch.

## Done Marker

This pack is considered done when all of these remain true:

- `npm run check:access` passes.
- Any new protected static page has a backend and frontend `PAGE_ACCESS` entry.
- Any new sidebar link has a `SIDEBAR_ACCESS` key and matches page access roles.
- Any new public page, embedded route, modal bridge, or intentional sidebar role
  mismatch is listed in `config/accessSurface.js` and this document.
