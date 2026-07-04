# My Day Live Release Prep - 2026-07-04

Production impact: yes.

This document records the preflight state and approval package for shipping the
existing My Day refactor to the live site. It is an approval package only: no
commit, push, deploy, staging, version bump, changelog edit, release-note edit,
Railway change, CI change, or product-code edit was performed in this task.

## Hard Stop Boundaries

- Do not commit, push, deploy, stage, or create a PR without explicit approval.
- Do not run `npm run version:bump`, `npm run version:sync`, or edit release
  metadata until the release hygiene approval is granted.
- Do not edit `CHANGELOG.md`, `index.html`, `package.json`,
  `package-lock.json`, or `sw.js` in this prep task.
- Do not change DB schema, migrations, auth, permissions, API contracts, task
  status taxonomy, dependencies, lockfile, secrets, production config, payments,
  or external integrations.
- Do not run local DB/API/integration checks for this task; the owner chose live
  validation after release instead of local DB setup.

## Preflight State

- Branch: `codex/timeline-leads-hardening`.
- Upstream: `origin/codex/timeline-leads-hardening`.
- Ahead/behind: `0/0`; local branch is in sync with upstream.
- Current release source of truth from `npm run version:current`:
  `v0.77.125 - Durable catalog media`.
- Runtime check: `npm run check:runtime` passed with
  Node `22.23.1` and npm `10.9.8`.
- `git diff --check` before this prep document passed with no whitespace
  errors. Git printed existing LF-to-CRLF warnings for the five modified
  tracked My Day files.

Dirty files before this prep document:

- Modified tracked files:
  - `css/pages-cabinet.css`
  - `css/pages-tasks.css`
  - `js/profile-page.js`
  - `tests/profile-tasker-segments.test.js`
  - `tests/ui-check.js`
- Untracked docs:
  - `docs/MY_DAY_EXISTING_REFACTOR_ADAPTATION_PLAN_2026-07-03.md`
  - `docs/MY_DAY_REFACTOR_PROGRESS_2026-07-03.md`
- Current preflight found no unrelated dirty tracked timeline or HR files.

## Release Content Summary

The release content stays on the existing path:
`/profile?tab=myday` -> `profile.html` -> `js/profile-page.js` ->
`renderMyDayTab()` -> `renderMyDayCommandCenterTab()`.

User-visible My Day changes that would ship:

- My Day uses a compact profile capsule while non-My-Day profile tabs keep the
  full profile header path.
- Passive command counters are replaced with a real segmented control:
  `Сьогодні`, `Прострочено`, `Чекаю`, `Готово`, `Приватне`.
- The list-mode toggle is scoped to the `Сьогодні` segment.
- My Day task cards become denser and keep only critical visible metadata:
  due state, priority, report gate, selected movement/context badges, progress,
  done action, and more action.
- Only one decomposed task shows an active inline checklist slice at a time; the
  full checklist remains behind the existing toggle/panel behavior.
- The overdue segment becomes a compact triage list with existing delegated
  actions: move to today, custom reschedule, done with existing gates, no date,
  and more menu.
- Sound controls move out of the visible secondary panel into a command-bar
  settings action while preserving existing `/api/tasks/preferences` and
  `SoundEngine.configureTask(...)` behavior.
- Completed history is compact by default through a closed `<details>` summary
  while preserving the real completed-history payload, day groups, detail tiles,
  and `aria-describedby` behavior.
- CSS adds scoped My Day layout, responsive, overflow, and dark-mode coverage.
- Focused tests/static guards were updated for the new My Day shell.

No DB schema, migration, auth, permission, API contract, task status taxonomy,
dependency, lockfile, secret, deployment, Railway, CI, payment, or external API
integration change is part of this release content.

## Proposed Staging Plan

Recommended product/refactor commit staged files:

- `css/pages-cabinet.css`
- `css/pages-tasks.css`
- `js/profile-page.js`
- `tests/profile-tasker-segments.test.js`
- `tests/ui-check.js`

Recommended documentation/traceability commit staged files:

- `docs/MY_DAY_EXISTING_REFACTOR_ADAPTATION_PLAN_2026-07-03.md`
- `docs/MY_DAY_REFACTOR_PROGRESS_2026-07-03.md`
- `docs/MY_DAY_LIVE_RELEASE_PREP_2026-07-04.md`

Recommended separate release hygiene commit: yes.

Reason: repository rules prefer the product/UI change first, then a separate
version/cache/changelog pass for user-visible releases. That release hygiene
commit should only be made after explicit approval and should likely include:

- `package.json`
- `package-lock.json`
- `index.html`
- `CHANGELOG.md`
- `sw.js`
- any additional cache-tag files changed by the approved version sync flow

Do not stage release hygiene files until the user explicitly approves the
version/changelog/release-note pass.

## Draft Release Metadata

Draft next version: `0.78.0`.

Draft `eventGenix.releaseLabel`: `My Day command center`.

Draft `CHANGELOG.md` entry in Ukrainian:

```markdown
## v0.78.0 - My Day command center

- Оновлено `Мій день` у профілі як компактний командний центр без зміни
  маршруту `/profile?tab=myday`.
- Додано сегменти `Сьогодні`, `Прострочено`, `Чекаю`, `Готово`,
  `Приватне`, компактні картки задач і один активний зріз чекліста.
- Прострочені задачі отримали triage-рядки з діями `На сьогодні`,
  `Відкласти`, `Закрити` і `Без дати` через наявні task-механіки.
- Налаштування звуку перенесено в меню командного рядка, а історію виконань
  згорнуто за замовчуванням без зміни backend-контрактів.
```

Draft `index.html` "Що нового" modal text in Ukrainian:

```markdown
### Мій день: компактний командний центр

- У профілі вкладка `Мій день` стала щільнішою: компактний заголовок,
  сегменти задач і менше шуму у першому екрані.
- Прострочені задачі можна швидко розібрати: перенести на сьогодні,
  відкласти, закрити або прибрати дату без нового статусу чи нового API.
- Чеклісти показують один активний наступний пункт, а повний список
  залишається доступним за розгортанням.
- Звук задач і історія виконань залишились доступними, але більше не
  займають основний робочий простір.
```

## Proposed Commit Messages

- Product/refactor commit:
  `refactor(profile): tighten My Day command center`
- Documentation/traceability commit:
  `docs(profile): record My Day release prep`
- Later release hygiene commit, only after approval:
  `chore(release): bump to v0.78.0`

## Push And Deploy Target

- Proposed push target: `origin codex/timeline-leads-hardening`.
- Repo docs state Railway production target branch should be
  `codex/timeline-leads-hardening`.
- Expected deployment path from repo evidence: Railway should deploy from the
  confirmed production branch.
- Still requiring owner confirmation: live host URL, whether Railway auto-deploys
  immediately on push to `codex/timeline-leads-hardening`, and whether Railway
  is currently attached to that exact branch.
- Do not push to historical `deployed` unless the owner explicitly confirms
  Railway was reconfigured back to it.

## Live QA Checklist

Before approving deploy:

- Approve the release hygiene plan and exact next version.
- Run the repository release gate after release hygiene is prepared:
  `npm run release:gate`.
- If a live URL is available and approved, use the documented live gate form:
  `npm run release:gate -- https://<live-crm-host>`.

After deploy on the live site:

- Confirm `/api/version` reports the approved version and label.
- Confirm `/api/ready` and `/api/health/deep` do not show schema/runtime drift.
- Open `/profile` and verify normal profile tabs still use the full profile
  header.
- Open `/profile?tab=myday` and verify it lands on the existing My Day tab,
  not a duplicate route or My Day v2.
- Verify compact My Day capsule, command bar, and segment buttons.
- Check each segment: `Сьогодні`, `Прострочено`, `Чекаю`, `Готово`,
  `Приватне`.
- In `Сьогодні`, verify focused/all list mode still works where visible.
- Verify quick-add still creates a task through the existing task-create flow.
- Verify compact cards with long Ukrainian and long unbroken English titles.
- Verify one decomposed task shows the active checklist slice and another
  decomposed task stays compact until selected.
- Verify full checklist expansion, subtask completion, and completion blocking
  still work.
- In `Прострочено`, verify triage actions:
  `На сьогодні`, `Відкласти`, `Закрити`, `Без дати`, and more menu.
- Verify report-required and unfinished-checklist tasks cannot be closed
  incorrectly.
- Open the `Звук` command-bar action, change volume/theme, run test sound, and
  verify persistence after refresh.
- Expand completed history and verify day grouping/details still show real done
  task data.
- Verify CRM signal cards are still present and semantically unchanged.
- Check desktop widths around 1280, 1440, 1920 and a narrow mobile viewport for
  no horizontal overflow or overlapping labels.
- Run documented post-deploy checks when approved:
  `npm run smoke:live -- https://<live-crm-host>` and
  `npm run version:smoke -- https://<live-crm-host>`.

## Rollback And Hotfix Fallback

- If `/api/version` does not match the approved version, treat the deploy/cache
  as incomplete and do not close the release.
- If `/api/ready` or `/api/health/deep` reports schema/runtime drift, stop UI
  validation and investigate production health first.
- If the app returns `502`, check GitHub deployment status and Railway logs
  before making any feature fix.
- If My Day UI fails but startup and version are healthy, prefer reverting the
  product/refactor commit on `codex/timeline-leads-hardening`, then rerun the
  release gate and redeploy only after explicit approval.
- If the issue is isolated and low-risk, create a small hotfix commit on the same
  production branch after explicit approval; do not mix unrelated timeline/HR or
  release metadata changes into that hotfix.
- Record failing URL, user role, browser viewport, Network status, request id if
  present, and exact task/action before rollback or hotfix.

## Approval Readiness

Preflight is coherent enough to ask for approvals:

- Branch is the documented production target branch.
- Upstream is in sync.
- Current dirty tracked files are scoped to My Day product/test files.
- Untracked docs are identifiable and can be kept in a separate documentation
  commit.
- Runtime and current-version checks passed.
- Local DB-backed smoke remains intentionally skipped and must be replaced by
  explicit live-site QA after deployment.

Do not proceed until the owner answers the approval questions for version
hygiene, staging/commit, push, and deploy/live verification.
