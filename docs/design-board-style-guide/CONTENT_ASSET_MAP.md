# Design Board Guidebook Content Asset Map

Дата: 2026-09-13
Branch: `codex/design-board-guidebook-release`
Base: `origin/codex/eventgenix-production` at `4214598e263057b1cb1524d7fb84f328031d288d`

## Product Scope

`designer.html` is treated as the Event Genix CRM guidebook for demo and advertising preparation. Client brands are shown only as clearly labeled examples of different brand voices. This task does not introduce a brand editor, tenant selector, backend brand model, storage migration, auth change, or legacy file recovery.

## Copied Assets

| Source | Brand / purpose | Repository file | Usage in UI | Notes |
| --- | --- | --- | --- | --- |
| Local CRM_ART event-card-family-event image | Event Genix demo visual, family and craft theme | `images/brand/guidebook/event-card-family-event.png` | Guidebook hero and Instagram template preview | Safe illustrative asset; no people, secrets, customer records, or local path is displayed in product UI. |
| Local CRM_ART event-card-workshop image | Event Genix demo visual, workshop theme | `images/brand/guidebook/event-card-workshop.png` | Catalog material card and A4 catalog template preview | Safe illustrative asset; no people, secrets, customer records, or local path is displayed in product UI. |
| Local CRM_ART event-card-show-program image | Event Genix demo visual, show program theme | `images/brand/guidebook/event-card-show-program.png` | Catalog material card and presentation template preview | Safe illustrative asset; no people, secrets, customer records, or local path is displayed in product UI. |
| Local CRM_ART event-card-quest image | Event Genix demo visual, quest theme | `images/brand/guidebook/event-card-quest.png` | Catalog material card | Safe illustrative asset; no people, secrets, customer records, or local path is displayed in product UI. |
| Local CRM_ART event-card-private-party image | Event Genix demo visual, photo zone and private event theme | `images/brand/guidebook/event-card-private-party.png` | Catalog material card and stories template preview | Safe illustrative asset; no people, secrets, customer records, or local path is displayed in product UI. |

## Existing Repository Assets

| Source | Brand / purpose | Repository file | Usage in UI | Notes |
| --- | --- | --- | --- | --- |
| Existing Event Genix mosaic image | Event Genix visual mark | `images/brand/event-genix-logo.png` | Guidebook hero logo panel, guideline logo stage | Kept as the primary CRM guidebook mark because it already exists in the repository and matches the colorful Event Genix presentation direction. |
| Existing gear SVG | Event Genix shell mark | `images/gear-logo.svg` | Existing sidebar brand area | Left unchanged. The guidebook now identifies it as a shell/technical mark, not the main guidebook logo. |
| Existing Park image | Park-specific mark | `images/park-logo.png` | Not used by this guidebook update | Not copied or repurposed. The page no longer labels the Event Genix brand book as Park brand content. |

## Inspected Sources Not Copied

| Source | Brand / purpose | Used for | Reason not copied |
| --- | --- | --- | --- |
| `бренд бук дар.pptx` | Дитячий Активний Розвиток brand book | High-level example of a child-development brand voice, color discipline, logo spacing, and do/don't rules | It is a client brand source, so its private visuals and deck assets were not published into the generic CRM guidebook. |
| `Опис бренду МД.docx` | Майстерня долі brand description | High-level example of a calm, reflective consulting brand voice and safety language | It is a separate brand source, so no private claims, contacts, promises, or assets were copied into the Event Genix product UI. |

## Content Source Classification

| UI area | Content status | Source basis |
| --- | --- | --- |
| Hero intro | Authored for the guidebook | Based on the current Design Board / Style Guide product goal and existing Event Genix CRM positioning in the app shell. |
| Catalog material cards | Authored for the guidebook | Based on the selected CRM_ART images and current Design Board material categories. |
| Event Genix logo rules | Authored for the guidebook | Based on existing repository assets and current page usage. |
| Event Genix color roles | Authored for the guidebook | Derived from the existing mosaic logo colors and existing CRM UI roles. |
| Typography guidance | Authored for the guidebook | Based on current `designer.html` font imports and existing CRM UI typography. |
| Event Genix tone samples | Authored for the guidebook | Practical editorial guidance. No company history, metrics, awards, customer names, official approvals, or contact details were invented. |
| ДАР and Майстерня долі examples | Paraphrased as separate examples | Based on inspected source documents, but no private files or long source copy were copied into product UI. |
| Template descriptions | Authored for the guidebook | Describes intended demo formats only. This task does not create downloadable template files. |

## Guardrails Kept

- No database schema, migration, auth, API, dependency, billing, quota, brand editor, global rebrand, or legacy file recovery changes.
- No customer records, secrets, personal photos, employee questionnaires, or entire local folders were copied.
- Product UI does not expose local filesystem paths.
- Existing deep links remain unchanged: `/designer`, `/designer#catalogs`, `/designer#guideline`, `/designer#brand`, `/designer#styleguide`, and `/designer#templates`.

## Handoff To Task 2

Task 2 should treat this commit as content foundation. It can further improve presentation, local light/dark rendering, responsive QA, and create real downloadable demo templates if still desired. It should not replace this guidebook with a new backend brand-management system.
