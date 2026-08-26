# Event Genix Cleanup Register

This register is the active cleanup map for the Event Genix CRM monolith. It is
not a historical audit. Use it to choose small cleanup packs, record why each
pack matters, and keep deletion/refactor work tied to tests.

Last refreshed: 2026-08-26
Current product version source: `package.json`

## Operating Model

Cleanup should move in small, deployable packs. Each pack should have:

- a narrow ownership area;
- a clear reason the cleanup reduces risk or future work;
- focused tests first;
- the full local baseline before commit;
- no destructive database or filesystem cleanup without explicit approval.

Do not mix product feature work with broad cleanup. If a cleanup uncovers a
product bug, either fix it in the same narrow area with tests or record it here
as a later pack.

## Current Scale Snapshot

Use `npm run cleanup:inventory` for the current generated view.

Known high-change areas from the latest inventory snapshot:

- `routes/`: 90 files, API ownership and auth boundaries.
- `services/`: 210 files, business logic and scheduler side effects.
- `js/`: 100 files, large vanilla frontend modules.
- `css/`: 91 files, shared UI and page-specific styling.
- `tests/`: 384 files, mixed unit, route smoke, UI smoke, and live API tests.
- `db/migrations/`: 329 migrations, with documented legacy duplicate/gap debt.
- `landing/`: 12 public landing materials and static assets.

Large files that should not be casually reformatted:

- `index.html`
- `js/dashboard-page.js`
- `js/chat-page.js`
- `js/hr-page.js`
- `js/profile-page.js`
- `routes/hr.js`
- `js/booking.js`
- `js/tasks-page.js`
- `profile.html`
- `css/dark-mode.css`
- `landing/style.css`
- `omni.html`
- `js/settings.js`

Do not treat aggregate CSS entrypoints such as `css/assistant-rail.css`,
`css/chat.css`, `css/sidebar-aurora.css`, `css/dashboard.css`, or
`css/pages.css` as large-file targets by filename alone. Their payload now
lives in ordered modules listed in `docs/CSS_SURFACE.md`.

2026-08-26 Task 17 repository/worktree hygiene snapshot:

- Production branch after `git fetch origin --prune`:
  `codex/eventgenix-production` at
  `1e3d543e1f4802600c3c22f5a5a90cd30b439509`, `ahead=0`, `behind=0`.
- Safe cleanup completed: 138 registered worktrees removed with
  `git worktree remove`; every removed worktree was clean and its `HEAD` was an
  ancestor of `origin/codex/eventgenix-production`.
- Branches were not deleted. `codex/checkbox-hardening-release-v080103` and
  `.codex-temp/_preserved-artifacts` were not touched.
- Remaining registered worktrees: 86 total:
  2 protected/main, 36 dirty, 1 conflicted worktree, 47 clean worktrees with
  unique commits not contained in production, 0 clean+ancestor candidates.
- `.codex-temp` top-level directories after cleanup: 71.
- Local branches after prune: 253. Branches with `[gone]` upstream: 0.
- Root workspace size after cleanup: approximately 10.84 GB across 127,589
  readable files; 4 filesystem entries returned access errors during the scan.
- `npm run cleanup:inventory` is not a reliable source on this checkout yet:
  sandboxed execution fails on `tmp/pymupdf/bin` with `EPERM`, and the
  unsandboxed read-only scan was manually stopped after it did not complete in
  a useful time window. The counts above come from direct git/worktree and
  shallow filesystem inventory.

Open PR hygiene on 2026-08-26:

- Closed as fully subsumed by production: #35, #15, #11, #10, #8.
- Left open because their heads still contain unique commits:

| PR | Head | Unique commits | Status | Short diff summary |
| --- | --- | ---: | --- | --- |
| #25 | `codex/attendance-audit-role-lifecycle` | 2 | draft, clean | 10 files, attendance audit runbook/scripts/tests |
| #24 | `codex/attendance-anomaly-audit` | 1 | draft, behind | 5 files, attendance anomaly audit command/docs/tests |
| #9 | `codex/reduce-information-on-landing-page` | 2 | clean | 3 landing files, large landing rewrite |
| #5 | `claude/youthful-feynman-ku9oB` | 150 | dirty | 140 files, old broad Claude branch |
| #4 | `claude/update-project-info-SagnQ` | 14 | dirty | 17 files, old project info/assets branch |
| #2 | `claude/fix-clear-booking-sizes-FZlVY` | 102 | dirty | 93 files, old broad Claude branch |
| #1 | `codex/create-a-surprising-but-safe-script` | 1 | clean | 4 files, README/spec/scripts |

Remaining registered worktree manifest:

| Reason | Path | Branch | Head | Dirty | Conflicts | Ahead/Behind | Ancestor | Last Modified |
| --- | --- | --- | --- | ---: | ---: | --- | --- | --- |
| KEEP_PROTECTED_OR_MAIN | `C:/Users/Plotva/OneDrive/Документи/EventGenix` | `codex/eventgenix-production` | `1e3d543e1` | 0 | 0 | +0/-0 | true | 2026-08-26 12:00 |
| KEEP_PROTECTED_OR_MAIN | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/checkbox-hardening-release-v080103` | `codex/checkbox-hardening-release-v080103` | `4ee0a66be` | 79 | 5 | +0/-231 | true | 2026-08-10 19:23 |
| REVIEW_CONFLICTED | `C:/tmp/EventGenix-production-830test` | `codex/production-task356-full-smoke` | `fda715add` | 2 | 1 | +0/-159 | true | 2026-07-19 20:38 |
| REVIEW_DIRTY | `C:/tmp/EventGenix-banquet-recovery-production-merge` | `codex/banquet-recovery-production-merge` | `2cb294048` | 52 | 0 | +2/-185 | false | 2026-07-19 16:00 |
| REVIEW_DIRTY | `C:/tmp/EventGenix-banquet-recovery-production-merge-v2` | `codex/release-reliability-runbook-hardening` | `231850935` | 1 | 0 | +0/-178 | true | 2026-07-19 16:32 |
| REVIEW_DIRTY | `C:/tmp/EventGenix-lead-guest-8018` | `codex/lead-guest-context-v08018` | `799ca6649` | 4 | 0 | +0/-0 | true | 2026-07-28 21:26 |
| REVIEW_DIRTY | `C:/tmp/EventGenix-production-attendance-kpi-overtime-guard-v2` | `codex/production-attendance-kpi-overtime-guard-v2` | `92bcb051d` | 52 | 0 | +1/-182 | false | 2026-07-19 17:04 |
| REVIEW_DIRTY | `C:/tmp/EventGenix-staff-schedule-category-fix` | `codex/staff-schedule-category-fix` | `d2f6ed9d8` | 3 | 0 | +0/-114 | true | 2026-07-29 19:36 |
| REVIEW_DIRTY | `C:/Users/Plotva/AppData/Local/hermes/profiles/main-agent/workspace/event_genix/prod_activation_staff_onboarding_20260731` | `deploy/eg-bot-onboarding-prod-v1-20260731` | `87fd0363c` | 54 | 0 | +0/-58 | true | 2026-07-31 17:26 |
| REVIEW_DIRTY | `C:/Users/Plotva/AppData/Local/hermes/profiles/main-agent/worktrees/eg_staff_reg_bot_operator_safe_local_20260816` | `codex/staff-reg-bot-operator-safe-local-20260816` | `9188e6b6a` | 4 | 0 | +0/-31 | true | 2026-08-16 14:19 |
| REVIEW_DIRTY | `C:/Users/Plotva/AppData/Local/hermes/profiles/main-agent/worktrees/eg_staff_registration_cycle_account_options_20260816` | `(detached)` | `7d2069d7b` | 1 | 0 | +0/-0 | true | 2026-08-16 12:58 |
| REVIEW_DIRTY | `C:/Users/Plotva/AppData/Local/hermes/profiles/main-agent/worktrees/eventgenix-schedule-attendance-visible-20260728` | `(detached)` | `6f5e9eb63` | 3 | 0 | +0/-0 | true | 2026-07-28 18:28 |
| REVIEW_DIRTY | `C:/Users/Plotva/AppData/Local/hermes/profiles/main-agent/worktrees/eventgenix-staff-node-dropdown-full-list-native-20260721-152432` | `deploy/staff-node-dropdown-full-list-native-20260721-152432` | `186894e6f` | 2 | 0 | +0/-105 | true | 2026-07-21 15:58 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix-customers-profile-async` | `codex/customers-profile-async-hardening` | `73ac5acb0` | 5 | 0 | +0/-0 | true | 2026-07-12 21:19 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix-leads-tasks-pagination-regressions` | `codex/leads-tasks-pagination-regressions` | `73ac5acb0` | 3 | 0 | +0/-0 | true | 2026-07-12 21:31 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix-task42-isolation` | `codex/task42-banquet-recovery-isolation` | `e518f2cc4` | 26 | 0 | +0/-0 | true | 2026-07-19 09:42 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/banquet-deposit-revenue-v08067` | `codex/banquet-deposit-revenue-v08067` | `7de60e2bf` | 8 | 0 | +0/-11 | true | 2026-08-02 18:07 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/booking-hours-current-audit-20260728` | `codex/booking-hours-current-audit-20260728` | `cbb7e11a0` | 2 | 0 | +0/-6 | true | 2026-07-28 17:55 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/checkbox-activation-readiness` | `codex/checkbox-activation-readiness` | `d37683e44` | 26 | 0 | +0/-0 | true | 2026-08-09 17:19 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/checkbox-final-software-hardening` | `codex/checkbox-final-software-hardening` | `65b28271c` | 39 | 0 | +0/-266 | true | 2026-08-09 21:04 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/checkbox-fiscal-readiness` | `codex/checkbox-fiscal-readiness` | `68d00b326` | 40 | 0 | +0/-10 | true | 2026-08-09 15:15 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/checkbox-fullstack-testmode-v08117` | `codex/checkbox-fullstack-testmode-v08117` | `c527d2358` | 12 | 0 | +0/-9 | true | 2026-08-23 13:31 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/checkbox-park-pilot` | `codex/checkbox-park-pilot` | `910d37f56` | 28 | 0 | +0/-0 | true | 2026-08-08 15:26 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/checkbox-thin-mvp-current-v08091` | `codex/checkbox-thin-mvp-current-v08091` | `c01224030` | 29 | 0 | +0/-0 | true | 2026-08-08 22:26 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/checkbox-thin-mvp-hardening` | `codex/checkbox-thin-mvp-hardening` | `15ec27c22` | 10 | 0 | +0/-0 | true | 2026-08-08 19:10 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/checkbox-thin-mvp-hardening-v08089` | `codex/checkbox-thin-mvp-hardening-v08089` | `4a44ee8ce` | 28 | 0 | +0/-9 | true | 2026-08-08 19:41 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/current-production-20260729` | `codex/lead-guest-context-v08018-final` | `d2f6ed9d8` | 13 | 0 | +0/-114 | true | 2026-07-29 20:35 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/global-task-timer-v080124` | `codex/global-task-timer-v080124` | `17367d272` | 9 | 0 | +0/-0 | true | 2026-08-12 00:04 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/legacy-permission-compat-v08066` | `codex/legacy-permission-compat-v08066` | `1dd1dc766` | 13 | 0 | +0/-14 | true | 2026-08-02 11:11 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/my-day-ai-composer-v08093` | `codex/my-day-ai-composer-v08094` | `a467fa434` | 10 | 0 | +0/-5 | true | 2026-08-09 00:32 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/my-day-card-time-v080124` | `codex/my-day-card-time-v080124` | `17367d272` | 12 | 0 | +0/-0 | true | 2026-08-12 00:04 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/my-day-compact-pulse-v080147` | `codex/my-day-compact-pulse-v080147` | `4f97c24e2` | 2 | 0 | +0/-0 | false | 2026-08-15 13:07 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/my-day-completion-qa-release-v080151` | `codex/my-day-completion-qa-release-v080151` | `a79b79702` | 56 | 0 | +1/-72 | false | 2026-08-15 17:05 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/my-day-impacts-ui-v080129` | `codex/my-day-v080138-release` | `3ee8f78ce` | 5 | 0 | +0/-101 | true | 2026-08-13 18:25 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/my-day-release-gate-v080124` | `codex/my-day-release-gate-v080124` | `17367d272` | 7 | 0 | +0/-0 | true | 2026-08-12 00:05 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/my-day-ui-compact-v080100` | `(detached)` | `a467fa434` | 9 | 0 | +0/-0 | true | 2026-08-09 17:09 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/task-ai-composer-ui-v080124` | `codex/task-ai-composer-ui-v080124` | `17367d272` | 6 | 0 | +0/-0 | true | 2026-08-12 00:04 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/task-ai-contract-v080124` | `codex/task-ai-contract-v080124` | `17367d272` | 13 | 0 | +0/-0 | true | 2026-08-12 00:04 |
| REVIEW_DIRTY | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/task-composer-unified-release-v08101` | `codex/task-composer-unified-release-v08101` | `8cdf10f9d` | 2 | 0 | +0/-28 | true | 2026-08-16 17:36 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/tmp/EventGenix-attendance-anomaly-audit` | `codex/attendance-anomaly-audit` | `31b5db6ac` | 0 | 0 | +0/-0 | false | 2026-07-19 23:19 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/tmp/EventGenix-attendance-datafix-noop-closure` | `codex/attendance-datafix-noop-closure` | `b91fb59d4` | 0 | 0 | +0/-0 | false | 2026-07-19 20:36 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/tmp/EventGenix-attendance-kpi-overtime-guard` | `codex/attendance-kpi-overtime-guard-v3` | `397da9d46` | 0 | 0 | +0/-0 | false | 2026-07-19 13:53 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/tmp/EventGenix-attendance-role-lifecycle` | `codex/attendance-audit-role-lifecycle` | `ad30324cf` | 0 | 0 | +0/-0 | false | 2026-07-19 23:48 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/tmp/EventGenix-cancel-priced-empty-stale-group` | `codex/cancel-priced-empty-stale-group` | `29372f9b4` | 0 | 0 | +0/-0 | false | 2026-07-20 17:01 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/tmp/EventGenix-historical-datafix` | `codex/historical-attendance-datafix` | `fd4c92768` | 0 | 0 | +0/-0 | false | 2026-07-19 10:28 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/tmp/EventGenix-historical-datafix-v2` | `codex/historical-attendance-datafix-v3` | `68d5885ec` | 0 | 0 | +0/-0 | false | 2026-07-19 14:11 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/tmp/EventGenix-payroll-bulk-release` | `(detached)` | `927c96dd2` | 0 | 0 | +0/-0 | false | 2026-07-18 19:05 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/tmp/EventGenix-performance-ci-fix` | `codex/performance-task356-ci` | `4c7b2202e` | 0 | 0 | +0/-4 | false | 2026-07-19 19:11 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/tmp/EventGenix-production-attendance-kpi-overtime-guard` | `codex/production-attendance-kpi-overtime-guard` | `dbd4aac8d` | 0 | 0 | +2/-183 | false | 2026-07-19 16:11 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/tmp/EventGenix-production-historical-attendance-datafix` | `codex/production-historical-attendance-datafix` | `5f1d0a212` | 0 | 0 | +4/-183 | false | 2026-07-19 16:23 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/tmp/EventGenix-production-historical-attendance-datafix-v2` | `codex/production-historical-attendance-datafix-v2` | `65e01d76f` | 0 | 0 | +4/-182 | false | 2026-07-19 16:36 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/tmp/EventGenix-production-historical-attendance-datafix-v3` | `codex/production-historical-attendance-datafix-v3` | `5c608019c` | 0 | 0 | +0/-0 | false | 2026-07-19 17:45 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/tmp/EventGenix-production-task356` | `codex/production-task356` | `c10a6a5ca` | 0 | 0 | +2/-163 | false | 2026-07-19 19:40 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/tmp/EventGenix-task41-isolation` | `codex/task41-professions-load-order` | `2fa2b5c3e` | 0 | 0 | +1/-9 | false | 2026-07-20 16:09 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/AppData/Local/hermes/profiles/main-agent/worktrees/eg-tasker-outbox-worker-readonly-20260802` | `deploy/eg-tasker-batch-prod-hardening-readonly-20260803` | `bac980a44` | 0 | 0 | +0/-0 | false | 2026-08-03 16:41 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/AppData/Local/hermes/profiles/main-agent/worktrees/event-genix-outbox-clean-20260630` | `main` | `03041e1c7` | 0 | 0 | +0/-0 | false | 2026-06-30 10:40 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/auth-session-test-hardening` | `codex/auth-session-test-hardening` | `81ac45e29` | 0 | 0 | +0/-0 | false | 2026-08-01 16:20 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/checkbox-test-config-prep-v080113` | `codex/checkbox-test-config-prep-v080113` | `64819afd6` | 0 | 0 | +2/-232 | false | 2026-08-10 17:44 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/fix-banquet-ws-two-tab-sync` | `codex/fix-banquet-ws-two-tab-sync` | `4d8c9b746` | 0 | 0 | +1/-72 | false | 2026-08-15 16:26 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/fix-trusted-qa-inventory-attribution` | `codex/fix-trusted-qa-inventory-attribution` | `9aa71f12a` | 0 | 0 | +0/-0 | false | 2026-08-15 16:42 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/hr-structure-production` | `codex/hr-structure-tree-polish-prod` | `e48896fb5` | 0 | 0 | +0/-0 | false | 2026-07-20 00:22 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/lead-guest-8018` | `codex/hr-resource-history-v08020` | `098b1761e` | 0 | 0 | +0/-0 | false | 2026-07-28 23:01 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/my-day-closure` | `codex/my-day-closure` | `21f348b59` | 0 | 0 | +0/-0 | false | 2026-08-01 14:23 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/my-day-compact-v080101` | `codex/my-day-time-disclosure-v080102` | `6075af7c9` | 0 | 0 | +0/-0 | false | 2026-08-09 19:14 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/my-day-e2e-v080151` | `codex/my-day-e2e-v080151` | `950f90c3a` | 0 | 0 | +0/-0 | false | 2026-08-15 17:22 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/my-day-e2e-v080155` | `codex/my-day-e2e-v080155` | `776a6a9f4` | 0 | 0 | +0/-0 | false | 2026-08-15 19:35 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/my-day-final-release-v080151` | `codex/my-day-final-release-v080151` | `590cfbf42` | 0 | 0 | +0/-0 | false | 2026-08-15 17:45 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/my-day-final-v080155` | `codex/my-day-final-v080155` | `96a883075` | 0 | 0 | +0/-0 | false | 2026-08-15 21:00 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/my-day-overdue-action-hotfix-v080160` | `codex/release-v0810-my-day-ai-smoke-harness` | `76134f4f9` | 0 | 0 | +0/-0 | false | 2026-08-16 13:22 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/my-day-projection-v080153` | `codex/my-day-projection-v080153` | `a5e559ef3` | 0 | 0 | +0/-0 | false | 2026-08-15 18:22 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/my-day-ui-hardening-v080153` | `codex/my-day-ui-hardening-v080153` | `7800dc473` | 0 | 0 | +0/-0 | false | 2026-08-15 18:57 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/release-metadata-integrity` | `codex/release-metadata-integrity` | `fcb0ed000` | 0 | 0 | +0/-0 | false | 2026-08-01 14:39 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/task-ai-current-contract-v08111` | `codex/task-ai-current-contract-v08111` | `311fe1398` | 0 | 0 | +0/-0 | false | 2026-08-21 20:31 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/task-ai-evidence-v08111` | `codex/task-ai-evidence-v08111` | `840226f00` | 0 | 0 | +0/-0 | false | 2026-08-21 19:42 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/task-ai-rollout-evidence-v080151` | `codex/task-ai-rollout-evidence-v080151` | `32be098fd` | 0 | 0 | +0/-0 | false | 2026-08-15 17:22 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/task-ai-safety-v080154` | `codex/task-ai-safety-v080154` | `ed12b77a6` | 0 | 0 | +0/-0 | false | 2026-08-15 19:01 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/task-center-contract` | `codex/task-center-contract` | `13c7fcb2d` | 0 | 0 | +0/-0 | false | 2026-07-31 13:59 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/task-postponement-explanation` | `codex/task-postponement-explanation` | `ced23f396` | 0 | 0 | +3/-96 | false | 2026-07-30 02:32 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/task1-trusted-qa-manifest` | `codex/task1-trusted-qa-manifest` | `f42e9a5dc` | 0 | 0 | +0/-0 | false | 2026-08-15 14:15 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/task4-overview` | `codex/task4-overview` | `5bbd4cbea` | 0 | 0 | +0/-0 | false | 2026-07-31 15:43 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix-attendance-techdebt` | `codex/attendance-techdebt-isolation` | `94a0b22a6` | 0 | 0 | +0/-1 | false | 2026-07-20 01:12 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix-banquet-state-audit` | `codex/banquet-state-audit` | `6d909eebd` | 0 | 0 | +0/-0 | false | 2026-07-19 13:17 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix-clean` | `codex/historical-attendance-decision-note` | `8d57c1455` | 0 | 0 | +0/-0 | false | 2026-07-18 18:59 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix-hermes-deploy-388e723c` | `(detached)` | `388e723c7` | 0 | 0 | +0/-0 | false | 2026-07-05 23:38 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix-monthly-timesheet-numeric` | `codex/monthly-timesheet-numeric-entry` | `bbc7f087e` | 0 | 0 | +0/-0 | false | 2026-07-17 00:25 |
| REVIEW_UNMERGED_UNIQUE_COMMITS | `C:/Users/Plotva/OneDrive/Документи/EventGenix-qa-cleanup-isolation` | `codex/qa-cleanup-isolation` | `d07171088` | 0 | 0 | +1/-9 | false | 2026-07-19 15:10 |

## Cleanup Tracks

### 1. Cleanup Register And System Inventory

Goal: keep one current source of truth for cleanup work.

What to do:

- Keep this register updated after every cleanup pack.
- Use `npm run cleanup:inventory` before choosing a new pack.
- Record active modules, ambiguous modules, and deletion candidates.
- Move old one-off plans to `docs/archive/` only when they are clearly
  superseded and no longer operational.

What this gives:

- Prevents stale handoff notes from driving new work.
- Makes cleanup reviewable instead of subjective.
- Lets the team choose the next pack by risk and value.

Status: started.

2026-05-12 update:

- Added `npm run cleanup:inventory`.
- Moved stale root planning/audit markdown files into `docs/archive/`.
- Root markdown is now intentionally limited to active operating documents:
  `AGENTS.md`, `README.md`, `DB_MIGRATION_GOVERNANCE.md`, and `CHANGELOG.md`.
- Added a static-doc guard test so old root planning docs do not drift back.

2026-05-29 update:

- Refreshed `npm run cleanup:inventory`; no unmounted `routes/*.js` files and
  no orphan root HTML files were reported.
- Removed low-risk frontend debug leftovers from `js/api.js`, `js/chat-page.js`,
  `js/timeline.js`, and `checkin.html`.
- Removed the stale `roomData` profile state slot left after the Room tab
  removal.
- Confirmed `checkin.html` is still a live static page owned by `/checkin`, so
  it is not a deletion candidate.
- Current environment risk: the local shell is Node 24/npm 11 while the repo
  baseline requires Node 22/npm 10, so cleanup verification should still be
  repeated under the canonical runtime before broad deletion packs.

### 2. Route, Page, And Ownership Map

Goal: know which backend route, frontend page, and test owns each product area.

What to do:

- Map `server.js` API mounts to files in `routes/`.
- Map static page routes to root HTML or `landing/` files.
- Mark routes as public, authenticated, custom-secret, or API-key guarded.
- Identify API routers mounted under broad paths such as `/api`.
- Add route smoke coverage when a cleanup touches auth boundaries.

What this gives:

- Reduces the chance of deleting a route used by a hidden page.
- Makes access changes safer because UI visibility and server auth can be
  compared.
- Shows which routes need live PostgreSQL tests instead of only static smoke.

Status: inventory command added; auth classification remains a later pack.

2026-05-12 update:

- Added `config/staticSurface.js` as the machine-readable static surface
  manifest.
- Added `docs/STATIC_SURFACE.md` as the human map for root HTML pages, landing
  pages, and legacy redirects.
- Added `npm run check:static-surface` to the full `npm test` baseline so new
  root HTML pages or route changes must update the map in the same commit.
- Added `docs/API_SURFACE.md`, `config/apiSurface.js`, and
  `npm run check:api-surface` so every `routes/*.js` file must be mounted and
  broad `/api` mounts must be explicit.
- Added `docs/ACCESS_SURFACE.md`, `config/accessSurface.js`, and expanded
  `npm run check:access` so static pages, page aliases, sidebar links,
  hash-modal bridges, and public/embedded access exceptions stay aligned.

2026-06-01 update:

- Clarified Sound ownership: `/api/music` (`routes/music.js`) is the primary
  Sound API for uploads, generated TTS/music, projects, announcements, and
  storage metadata.
- Kept `/api/sound-library` (`routes/sound-library.js`) mounted as legacy
  compatibility CRUD instead of deleting it in a broad cleanup.
- Updated `docs/ai-context` Sound references and added focused Sound generation
  tests so the old disabled Suno state does not drift back.

### 3. Safety Net Before Deletion

Goal: make dead-code removal measurable before deleting files.

What to do:

- Keep `tests/static-cleanup.test.js` as the root media and landing redirect
  guard.
- Keep `tests/static-doc-guard.test.js` as the accidental public-doc exposure
  guard.
- Keep `npm run check:auth-boundary` as the ownership guard for public API
  exceptions and approved `?token=` JWT routes.
- Keep `npm run check:access` as the ownership guard for role metadata,
  backend/frontend `PAGE_ACCESS`, sidebar access, static page access, and
  documented modal/public/embedded exceptions.
- Keep `npm run check:static-surface` as the ownership guard for root HTML,
  landing pages, and legacy static redirects.
- Keep `npm run check:css-surface` as the ownership guard for CSS files,
  runtime references, owners, docs, and Service Worker app-shell CSS precache.
- Keep `npm run check:api-surface` as the ownership guard for backend route
  files, broad `/api` route mounts, and server-level API routes.
- Keep `npm run check:storage-surface` as the ownership guard for local
  `/uploads` paths, Supabase Storage buckets, tests, docs, and ignore rules.
- Keep `npm run check:service-worker-policy` as the ownership guard for
  Service Worker API cache allowlists, sensitive API prefixes, private cache
  cleanup messages, and disabled offline mutation replay.
- Extend `tests/route-smoke.test.js` when public/protected boundaries change.
- Add focused tests before deleting or redirecting any page, asset, or API
  alias.

What this gives:

- Turns cleanup into repeatable verification instead of manual browsing only.
- Catches regressions where legacy URLs, redirects, or static files drift.
- Lets old files be removed with confidence.

Status: existing guards present; expand per pack.

2026-05-12 update:

- Static surface guard added to prevent repeating manual root HTML
  classification work.
- API surface guard added to prevent unmounted route files and undocumented
  broad `/api` route mounts.
- Storage surface guard added to prevent undocumented local upload paths or
  Supabase buckets from being introduced without ownership and tests.
- Auth-boundary guard added to prevent new public API or query-token exceptions
  from bypassing the documented manifest and focused tests.
- Access-surface guard expanded to prevent new pages, aliases, sidebar links,
  or hash-modal access paths from bypassing documented ownership.
- Scheduler-surface guard added to prevent background jobs, raw intervals,
  dedup settings, or test anchors from drifting without ownership.
- DB-startup surface guard added to prevent new legacy schema or startup data
  hooks from being added to `db/index.js` without explicit ownership.
- Service Worker cache/offline policy guard added to prevent private CRM API
  data or mutation replay from being cached without an explicit review.
- CSS surface guard added to prevent new, renamed, or removed CSS files from
  bypassing ownership docs and UI verification.

2026-06-24 production-risk guard update:

- Strengthened `npm run check:db-startup-surface` so startup data hooks must use
  a known ownership mode, and startup data-delete hooks must expose an explicit
  `DELETE` marker.
- Strengthened `npm run check:scheduler-surface` with
  `STATIC_ONLY_SCHEDULER_JOBS`, making scheduler jobs without direct behavior
  tests a tracked cleanup debt instead of an implicit risk.
- Strengthened `npm run check:storage-surface` with fallback policies for every
  `/uploads/*` segment, separating local-filesystem-primary paths from
  Postgres-blob-primary legacy fallback paths.
- Strengthened `npm run check:service-worker-policy` and
  `tests/service-worker-policy.test.js` so `CLEAR_PRIVATE_CACHES` must delete
  the private API cache namespace and legacy offline DB.
- Strengthened `npm run check:static-surface` with explicit exposure
  classification for public root pages, root shell pages, public landing files,
  and embedded aliases.
- No legacy routes, static files, upload folders, DB objects, or production data
  were deleted.

### 4. Security And Deploy-Risk Cleanup

Goal: remove risks that can affect production even when product UI looks fine.

What to do:

- Keep runtime pinned to Node 22/npm 10 and verify with `check:runtime`.
- Continue tightening public endpoint allowlists and rate limits.
- Restrict query-token auth to explicitly approved window-open routes.
- Keep public API exceptions and query-token routes in
  `config/authBoundary.js` and `docs/AUTH_BOUNDARY.md`.
- Keep bootstrap credentials explicit through environment variables only.
- Keep local upload fallback behavior documented against Railway persistence.
- Keep `npm run check:storage-surface` green when adding or changing upload
  paths or Supabase buckets.
- Keep service worker cache behavior away from private or stale API data.
- Keep `npm run check:service-worker-policy` green when changing `sw.js`
  API cache, private cache cleanup, or offline mutation behavior.

What this gives:

- Reduces production-only failures and credential leakage risk.
- Makes Railway deploy behavior match local test behavior.
- Prevents cleanup from re-opening old auth/storage/cache problems.

Status: partially addressed by previous packs; service-worker cache ownership
is now guarded, while broader endpoint rate-limit review remains open.

2026-05-12 update:

- Added `docs/AUTH_BOUNDARY.md`, `config/authBoundary.js`, and
  `npm run check:auth-boundary`.
- Public API exceptions now have owners and reasons outside the middleware
  implementation.
- Query-token JWT auth remains limited to the two graduation `window.open`
  endpoints: `GET /graduation/quotes/:id/proposal` and
  `GET /graduation/catalog/export`.
- Removed duplicate route-level `req.query.token` handling from
  `routes/graduation.js`; query-token auth now has one implementation point in
  `middleware/apiAuthBoundary.js`.

Previous 2026-05-12 storage update:

- Added `docs/STORAGE_SURFACE.md`, `config/storageSurface.js`, and
  `npm run check:storage-surface`.
- Current local upload paths are now explicit: `/uploads/chat`,
  `/uploads/sounds`, and `/uploads/designs`.
- Current Supabase Storage buckets are now explicit: `chat-uploads`,
  `audio-library`, and `catalog-images`.
- `/uploads/designs` is documented as the main local-only legacy storage risk
  and a later migration candidate.

2026-05-12 Service Worker cache update:

- Added `docs/SERVICE_WORKER_CACHE_POLICY.md`,
  `config/serviceWorkerPolicy.js`, and
  `npm run check:service-worker-policy`.
- Current Service Worker API GET cache policy is explicit default-deny:
  only `/api/version` and `/api/status/public` are cacheable, and only without
  an `Authorization` header.
- Offline mutation replay remains disabled by an empty
  `MUTATION_QUEUE_ALLOWLIST`; any future endpoint requires conflict handling,
  idempotency, docs, and focused tests in the same commit.

### 5. Database And Migration Cleanup

Goal: reduce split-brain schema ownership without breaking startup.

What to do:

- Follow `DB_MIGRATION_GOVERNANCE.md`.
- Add new durable schema changes only in `db/migrations/`.
- Do not remove `initDatabase()` schema blocks until the equivalent migration
  path is proven on an empty database.
- Move one small startup responsibility at a time into migrations.
- Run `npm run check:migrations` after migration changes.

What this gives:

- Stops future drift between startup bootstrap and migration history.
- Makes schema changes auditable and repeatable across environments.
- Lowers the risk of Railway startup surprises.

Status: governance exists; gradual migration ownership cleanup remains open.

2026-05-12 update:

- Added `docs/DB_STARTUP_SURFACE.md`, `config/dbStartupSurface.js`, and
  `npm run check:db-startup-surface`.
- Current `initDatabase()` compatibility surface is now explicit: 39 startup
  tables, 38 compatibility columns, 66 indexes, the bookings updated-at
  trigger/function pair, and 10 startup data hooks.
- Future DB work should add durable schema through `db/migrations/`; changing
  the startup surface now requires updating the manifest and docs in the same
  commit.

2026-06-24 DB startup guard update:

- Startup data hook modes are now validated against
  `STARTUP_DATA_BOOTSTRAP_MODES`.
- The existing `greetingCacheStartupDelete` hook remains documented as
  `startup-data-delete`; no startup cleanup was executed.

### 6. Static Frontend Cleanup

Goal: reduce root HTML, JS, and CSS sprawl without changing user workflows.

What to do:

- Classify each root HTML file as live, redirected legacy, embedded, public, or
  deletion candidate.
- Avoid broad CSS rewrites; prefer page-scoped removals with visual checks.
- Split large JS only when a stable domain boundary already exists.
- Keep `npm run check:css-surface` green when adding, removing, renaming, or
  consolidating CSS files.
- Keep shared helpers in `js/ui.js`, `js/api.js`, `js/auth.js`, and
  `js/components/sidebar.js` consistent.

What this gives:

- Makes the static frontend easier to reason about.
- Reduces duplicate styling and script drift.
- Avoids breaking standalone pages that depend on shared globals.

Status: CSS ownership guard active; several large CSS entrypoints are now
aggregate-only files with module payloads. Remaining frontend cleanup should be
chosen from the current inventory and only split JS when a stable domain
boundary already exists.

2026-05-12 CSS update:

- Added `docs/CSS_SURFACE.md`, `config/cssSurface.js`, and
  `npm run check:css-surface`.
- CSS ownership became explicit through the manifest instead of relying on
  informal filename conventions.
- Current Service Worker CSS app-shell precache entries are tied to the same
  manifest so cache-sensitive CSS changes require docs and verification.

2026-06-08 CSS cleanup update:

- Split the assistant rail, chat, sidebar aurora, dashboard, and shared page
  CSS entrypoints into ordered modules while preserving the public stylesheet
  URLs used by HTML and JavaScript.
- Updated `docs/CSS_SURFACE.md` and `config/cssSurface.js` so CSS ownership,
  Service Worker precache expectations, and `npm run check:css-surface` match
  the modular layout.
- Current CSS surface from `npm run cleanup:inventory` is 74 files under
  `css/`; `npm run check:css-surface` tracks 75 referenced CSS files including
  `landing/style.css`. `css/dashboard.css` and `css/pages.css` are no longer
  cleanup candidates by size; use their imported modules for any future scoped
  work.

### 7. Backend Domain Cleanup

Goal: clean routes and services by domain instead of by file size.

Suggested packs:

- Chat and Guardian delivery.
- HR and staff accounts.
- Finance, reports, and report-bot.
- Bookings, afisha, and scheduling.
- Landing, leads, and sales funnel.
- Gamification, wallet, shop, quests, and minigame.

What to do:

- For each domain, identify route files, service files, frontend files, tests,
  DB tables, schedulers, and external integrations.
- Keep transaction/idempotency behavior explicit.
- Add focused tests around any side-effect cleanup.

What this gives:

- Keeps cleanup tied to business workflows.
- Avoids cross-domain regressions.
- Makes large files shrink only when the extracted boundary is real.

Status: open.

2026-06-08 HR payroll-period update:

- Extracted the HR salary period range, lock, event journal, and reconciliation
  helpers from `routes/hr.js` into `services/hrPayrollPeriod.js`.
- Kept HR salary route handlers, permission middleware, public URLs, and API
  response shape in `routes/hr.js`; this was a backend helper ownership cleanup,
  not an endpoint split.
- Updated HR salary contract/static guardrails so the route remains responsible
  for `/api/hr/salary*` surfaces while the payroll-period service owns lock and
  event helper behavior.
- Next HR backend candidates should start from a similarly narrow domain slice:
  onboarding task-owner sync or staff resource/document lifecycle, with focused
  tests before moving route handlers.

2026-06-08 HR onboarding assignment update:

- Extracted the HR onboarding responsible-owner assignment, progress metadata,
  transaction wrapper, audit write, and generated task synchronization helpers
  from `routes/hr.js` into `services/hrOnboarding.js`.
- Kept `/api/hr/onboarding*` and `/api/hr/staff/:id/onboarding-assignment`
  route handlers, permission middleware, public URLs, and response shapes in
  `routes/hr.js`.
- Added a focused HR contract guard so onboarding routes stay thin while the
  service owns `hr_onboarding` task sync, owner reassignment history, and audit
  side effects.
- Next HR backend cleanup candidate: staff resource/document lifecycle. Keep it
  separate from account-center or access-control changes unless a regression is
  found.

2026-06-08 HR staff documents update:

- Extracted private HR staff document upload validation, metadata mapping,
  create/list/download/archive SQL, checksum calculation, and safe download
  filename handling from `routes/hr.js` into `services/hrStaffDocuments.js`.
- Kept `/api/hr/staff/:id/documents*` route handlers, `requireHrManage`,
  guarded binary download headers, and HR audit calls in `routes/hr.js`.
- Added a focused HR contract/service test with fake DB coverage for list,
  create, archive, download URL metadata, checksum payloads, and active-only
  filtering.
- Staff resource issue/return remains the next candidate, but it should be a
  separate pack because it mutates warehouse stock, movement history, costumes,
  and HR audit state transactionally.

2026-06-08 HR staff resources update:

- Extracted HR staff resource list/options, issue, return, resource
  normalization, assignment metadata mapping, and warehouse/costume transactional
  side effects from `routes/hr.js` into `services/hrStaffResources.js`.
- Kept `/api/hr/staff/:id/resources*`, `/api/hr/resource-options`,
  `requireHrManage`, response shapes, and HR audit calls in `routes/hr.js`.
- Added a focused HR contract/service test with fake DB coverage for
  `BEGIN`/`COMMIT`, rollback ownership, warehouse stock decrement/increment,
  `warehouse_history`, `warehouse_stock_movements` issue/return rows, and
  costume unassignment on return.
- Next HR backend cleanup candidate: staff payroll-scheme or role-assignment
  helpers only if a similarly narrow boundary is confirmed. Do not continue
  splitting HR route code by file size alone.

2026-06-08 HR payroll-scheme update:

- Extracted HR staff payroll-scheme metadata mapping, scheme type labels,
  hybrid/hourly/manual config normalization, staff scheme workspace loading, and
  create payload assembly from `routes/hr.js` into
  `services/hrPayrollSchemes.js`.
- Kept `/api/hr/staff/:id/payroll-scheme`, `requireHrManage`, response shapes,
  missing-staff handling, and `staff_payroll_scheme_update` audit calls in
  `routes/hr.js`.
- Added a focused HR contract/service test with fake DB coverage for scheme
  workspace loading, active scheme selection, config parsing, hybrid rules,
  invalid date normalization, and create payload/audit mapping.
- Staff role-assignment replacement remains a possible candidate, but it is
  coupled to broader staff edit flows through profession validation and rate
  replacement. Treat it as a separate audit, not as a follow-up by size.

### 8. Scheduler, Event, And Callback Cleanup

Goal: keep background work restart-safe and duplicate-safe.

What to do:

- Treat `services/scheduler.js`, event bus delivery, Telegram callbacks,
  report-bot callbacks, and Guardian outbox as side-effect systems.
- Prefer idempotency keys, atomic claims, and explicit terminal states.
- Keep stale callback cleanup and keyboard cleanup covered by tests.
- Do not remove retry or fallback paths until failure semantics are documented.

What this gives:

- Prevents duplicate messages, duplicate tasks, and partial writes.
- Makes background failures observable instead of silent.
- Protects operational workflows during refactors.

Status: Guardian has recent convergence/repair work; broader scheduler cleanup
remains open.

2026-05-12 update:

- Added `docs/SCHEDULER_SURFACE.md`, `config/schedulerSurface.js`, and
  `npm run check:scheduler-surface`.
- Current `server.js` scheduler startup now has an explicit manifest for
  guarded jobs, raw intervals/starters, dedup cadence, owners, side-effect
  classes, and test anchors.
- `checkBookingPushReminders` was documented as a runtime-risk follow-up: it is
  scheduled every minute and previously relied on `guardScheduler` default
  `daily` dedup. Any change must keep notification-focused tests.

2026-06-24 scheduler guard update:

- `STATIC_ONLY_SCHEDULER_JOBS` now records the guarded and raw scheduler jobs
  that still have only static coverage.
- `npm run check:scheduler-surface` fails if the static-only list stops
  matching jobs without direct test anchors.

2026-06-28 scheduler behavior update:

- Added direct self-contained coverage for `checkBookingPushReminders`.
- Made its scheduler registration explicitly no-dedup at guard level so the
  60-second booking reminder scan is not silently daily-gated.
- Removed `checkBookingPushReminders` from `STATIC_ONLY_SCHEDULER_JOBS`.
- `npm run check:scheduler-surface` now rejects hidden
  `guardScheduler` default daily dedup usage.

2026-06-28 scheduler guard contract update:

- Added direct self-contained coverage for `guardScheduler` dedup behavior.
- `dedup: '5min'` now has real five-minute bucket behavior instead of acting
  like no dedup.
- Explicit `dedup: null` now remains no-skip behavior and writes a minute-level
  tracking key for observability.
- Unsupported dedup values now fail before the scheduler function can run.

2026-06-28 event bus outbox relay update:

- Added direct self-contained coverage for `processOutbox` without a live DB,
  server, Telegram, push, webhook, or external side effects.
- Locked down the outbox relay contract for empty queues, successful publish,
  row-level failure retries, mixed batches, duplicate relay attempts, already
  locked/published rows, retry-limit blocking, and idempotency-key duplicates.
- `processOutbox` now schedules downstream rule processing only after a
  successful transaction `COMMIT`, so rollback or commit failure cannot start
  event rule side effects from an uncommitted relay transaction.
- `eventBusProcessOutbox` was removed from `STATIC_ONLY_SCHEDULER_JOBS`; it
  remains a raw interval and still has no `scheduler_executions` pause/error
  accounting.

2026-06-28 Telegram retry queue hardening:

- Added direct self-contained coverage for `processRetryQueue` without real
  Telegram sends, tokens, server startup, or live database access.
- Locked down empty queue, enqueue metadata, retry success, retry failure,
  retry exhaustion, overlap skip, and guard reset behavior.
- `processRetryQueue` now has an in-process overlap guard with `finally` reset,
  so overlapping raw interval ticks in one Node.js process cannot send the same
  in-memory retry item twice.
- `telegramRetryQueue` was removed from `STATIC_ONLY_SCHEDULER_JOBS`; it
  remains an in-memory raw interval and is still not durable across restarts or
  shared across multiple app instances.

2026-06-28 task lifecycle raw scheduler hardening:

- Added direct self-contained coverage for `runTaskLifecycle` without server
  startup or live database access.
- Locked down empty eligible task scans, health-score updates, automatic
  `auto_expired` archives, repeated archive idempotency, overlap skip, guard
  reset after errors, unchanged raw startup/daily timing, and absence of direct
  Telegram/chat/push/webhook side effects.
- `runTaskLifecycle` now has an in-process overlap guard with `finally` reset,
  so overlapping raw startup/daily executions in one Node.js process cannot run
  the lifecycle mutation loop twice at the same time.
- `taskLifecycleStartup` and `taskLifecycleDaily` were removed from
  `STATIC_ONLY_SCHEDULER_JOBS`; they remain raw scheduler paths and still have
  no durable multi-instance lock or `scheduler_executions` pause/error
  accounting.

2026-06-28 marketing raw scheduler hardening:

- Added direct self-contained coverage for `marketingPublishScheduled` and
  `marketingWeeklyPlan` without server startup, live database access, real
  publishers, Telegram, Instagram, OpenAI, webhooks, or external side effects.
- Scheduler-facing marketing wrappers now guard same-process overlap for
  scheduled publishing and weekly plan generation, with `finally` reset after
  success or error.
- The weekly plan wrapper keeps the Wednesday 08:00-08:05 UTC gate and marks
  the in-memory daily run key only after successful generation, so a failed
  generation can retry during the same window.
- `marketingPublishScheduled` and `marketingWeeklyPlan` were removed from
  `STATIC_ONLY_SCHEDULER_JOBS`; both remain raw intervals and still have no
  durable multi-instance lock or `scheduler_executions` pause/error accounting.

2026-06-28 dashboard alert broadcaster hardening:

- Added direct self-contained coverage for `dashboardAlertBroadcaster` without
  server startup, live database access, real WebSocket clients, or user-facing
  broadcasts.
- `startAlertBroadcaster(60000)` now keeps a single interval per Node.js
  process and returns an `already_started` skip result on duplicate starter
  calls instead of replacing the active interval or adding duplicate initial
  timeouts.
- Broadcaster tick errors are logged and contained, and the alert hash is
  marked delivered only after a successful websocket broadcast.
- `dashboardAlertBroadcaster` was removed from `STATIC_ONLY_SCHEDULER_JOBS`; it
  remains a raw starter and still has no durable multi-instance lock or
 `scheduler_executions` pause/error accounting.

2026-06-28 OpenClaw stale message fallback hardening:

- Added direct self-contained coverage for `openclawBridgeStaleMessages`
  without server startup, live database access, real WebSocket clients,
  OpenClaw, Telegram, AI, webhooks, or external side effects.
- Locked down empty stale scans, one-message success, multiple-message order,
  generator failure behavior, top-level DB select errors, overlap skip, guard
  reset after errors, and unchanged `30000` raw interval timing.
- `processStaleMessages()` now has an in-process overlap guard with `finally`
  reset and returns structured results for success, overlap skip, and
  top-level error paths instead of letting top-level scheduler errors escape.
- `openclawBridgeStaleMessages` was removed from
  `STATIC_ONLY_SCHEDULER_JOBS`; it remains a raw interval and still has no
  durable multi-instance lock or `scheduler_executions` pause/error accounting.

2026-06-28 Kleshnya greeting cleanup hardening:

- Added direct self-contained coverage for `cleanupKleshnyaMessages` without
  server startup, live database access, WebSocket clients, OpenClaw, Telegram,
  AI, webhooks, or external side effects.
- Locked down empty cleanup scans, expired-row delete counts, DB query failure
  handling, overlap skip, guard reset after errors, and unchanged
  `30 * 60 * 1000` raw interval timing.
- `cleanupExpired()` now has an in-process overlap guard with `finally` reset
  and returns structured results for success, overlap skip, and query error
  paths.
- `cleanupKleshnyaMessages` was removed from `STATIC_ONLY_SCHEDULER_JOBS`; it
  remains a raw interval and still has no durable multi-instance lock or
  `scheduler_executions` pause/error accounting.

2026-06-28 Telegram and booking notification scheduler coverage pack:

- Added direct self-contained coverage for `checkAutoDigest`,
  `checkAutoReminder`, `checkAutoBackup`, `checkScheduledDeletions`,
  `checkCertificateExpiry`, `checkTaskReminders`, `checkUpcomingBookings`,
  `checkSLABreach`, `checkScheduledAnnouncements`, and
  `checkCertExpiryReminders`.
- The coverage pack mocks DB, Telegram sends/deletes, backup delivery,
  Kleshnya task reminder delegation, Afisha distribution, and event bus
  publishing. It does not start the server, use live database access, send real
  Telegram messages, or call external services.
- Locked down no-eligible-row/no-op behavior, eligible send or mutation paths,
  Telegram failure containment where the job sends/deletes Telegram messages,
  and DB/delegate failure containment.
- The covered jobs were removed from `STATIC_ONLY_SCHEDULER_JOBS`; timing,
  env vars, Telegram config, schema, CI, deploy config, and dependencies were
  left unchanged.
- `guardScheduler` remains the dedup owner for these jobs. This task did not
  add job-internal dedup or durable multi-instance locks.

### 9. Documentation Cleanup

Goal: make active docs trustworthy and old docs clearly historical.

What to do:

- Keep `README.md`, `AGENTS.md`, `DB_MIGRATION_GOVERNANCE.md`, and this file
  as current operational docs.
- Move or mark old task/audit files as superseded when verified.
- Do not copy production credentials, shared passwords, or stale deployment
  claims into active docs.
- Prefer small doc updates attached to the cleanup pack that changed behavior.

What this gives:

- Prevents future agents from following stale instructions.
- Reduces repeated rediscovery work.
- Keeps deploy and migration rules clear.

Status: started with this register.

2026-05-12 update:

- Archived historical root plan/audit documents and documented them in
  `docs/archive/README.md`.
- Added root markdown coverage in `tests/static-doc-guard.test.js`.

### 10. Cleanup Pack Verification Rhythm

Goal: make every cleanup pack shippable.

Required local flow:

```bash
git status --short --branch
npm run check:version
npm run check:migrations
npm run check:syntax
npm run check:access
npx -y -p node@22 -p npm@10 -c "npm test"
git diff --check
```

Focused tests should run before the full baseline. Use the smallest relevant
`node --test tests/<file>.test.js` command when a pack touches a tested area.

What this gives:

- Keeps cleanup deployable through Railway after push.
- Makes failures local and narrow before the full baseline.
- Avoids reporting Node 18/24 results as representative.

Status: active rule for all packs.

## Current Backlog

| Priority | Pack | Why It Matters | Suggested First Check |
| --- | --- | --- | --- |
| Done | Query-token auth restriction | Reduces JWT leakage through URLs | `npm run check:auth-boundary`, `tests/auth-boundary.test.js`, `tests/route-smoke.test.js` |
| Done | Upload storage inventory | Clarifies Railway persistence risk | `npm run check:storage-surface`, `tests/chat-upload-storage.test.js`, `tests/audio-storage.test.js`, `tests/image-storage.test.js` |
| Done | Root HTML ownership map | Prevents accidental live page deletion | `npm run check:static-surface`, `npm run test:ui` |
| Done | API route ownership guard | Prevents orphan route files and undocumented broad mounts | `npm run check:api-surface`, `tests/route-smoke.test.js` |
| Done | Access/sidebar drift expansion | Keeps UI and backend permission rules aligned | `npm run check:access` |
| Done | Scheduler side-effect map | Finds duplicate-prone background jobs | `npm run check:scheduler-surface`, scheduler-focused tests |
| Done | DB startup ownership slice | Reduces `initDatabase()`/migration split-brain | `npm run check:db-startup-surface`, `npm run check:migrations` |
| Done | Old root markdown archive pass | Reduces stale instruction risk | `tests/static-doc-guard.test.js` |
| Done | Service Worker cache policy guard | Prevents stale/private CRM API data from being cached offline | `npm run check:service-worker-policy`, `tests/service-worker-policy.test.js` |
| Done | CSS surface ownership guard | Prevents frontend cleanup from deleting or renaming live styles blindly | `npm run check:css-surface`, `npm run test:ui` |
| Done | HR payroll-period helper extraction | Keeps salary period locks/events/reconciliation out of the HR route monolith without changing `/api/hr/salary*` contracts | `node --test tests/hr-button-contract.test.js`, `npm run test:ui` |
| Done | Cleanup register production-risk guard pack | Makes DB startup hooks, scheduler static-only jobs, storage fallback paths, Service Worker private cache cleanup, and static page exposure explicit without destructive cleanup | `npm run check:db-startup-surface`, `npm run check:scheduler-surface`, `npm run check:storage-surface`, `npm run check:service-worker-policy`, `npm run check:static-surface`, `npm test` |
| P3 | Large CSS consolidation | Reduces UI drift | `npm run test:ui` plus browser smoke |

## Open Questions To Resolve Before Destructive Cleanup

- Which Railway branch/environment is the production deploy source?
- Which root HTML pages are intentionally public entrypoints?
- Which legacy design upload files should be migrated from local disk to
  Supabase Storage first?
- Which historical planning docs should remain at repo root for humans?
- Which DB seed/bootstrap responsibilities are still required for fresh
  customer environments?
