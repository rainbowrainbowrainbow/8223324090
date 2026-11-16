# HR onboarding execution status

Base: `89255f1f6ed34e849ccf585169dc91cd5c5db866`, observed on both upstream and live `0.83.94` on 2026-11-17. Branch: `codex/hr-onboarding-ux-20261116`. Worktree: `D:/Codex/EventGenix/hr-onboarding-ux-20261116`.

- A, inventory in progress. Current production base adds a standalone Team creation dialog and idempotent creation service. The Team dialog is the owner-observed “Створити картку” entry point. Candidate conversion, schedule and CRM issuance remain separate entry points.
- B, implementation in progress. Team dialog derives department, position and primary profession from one active catalog entry. Known display aliases share a department choice. Secondary professions remain in the card. Phone formatting runs on blur and preserves the entered digit sequence. Team creation submits given and family names separately. Migration 413 adds nullable storage, and the creation service retains a compatible full display name. The card reads and edits both stored parts under the existing name permission. Older full names remain editable without guessing parts. Department catalog administration and production duplicate identification remain open.
- C, implementation in progress. User-driven tabs save dirty main/work data through the current guarded save functions. Effective payroll and other explicit actions stay outside tab switching. The document picker announces files still awaiting upload, preserves them after failed uploads and ignores old results after the operator switches cards. The profile photo device picker still requires work.
- D/E, protected. Prepare reviewable proposed payroll and CRM permission changes for separate authorization. Check schedule destination and current membership before proposing role or redirect changes. Microsoft reference remains unidentified.
- F, locally implemented. Resource issue can record return when employment ends. The due date is mutually exclusive with that mode, and legacy dates and unspecified terms keep their meaning. The offboarding list displays the term, while the physical return still requires the existing explicit action. PostgreSQL 16 resource integration passed all four cases, and the HR Team browser smoke passed.
- G, pending. No production authorization, push, migration execution, or deploy. Use isolated PostgreSQL and browser suites before preparing a candidate.

Focused browser evidence: `output/playwright/hr-team-ux/`. The creation and tab-save smoke passed at 1366px and 390px in both themes, including failed save, retained edits and retry. The 390px creation screenshot was reviewed. Runtime verification passed with Node 22.22.0/npm 10.9.4. Full PostgreSQL-backed creation and CI remain pending.

Name split verification: migration governance, focused HR card tests, synthetic browser smoke and the full disposable PostgreSQL 16 staff creation browser suite passed. The full suite covered desktop, mobile and Park admin, with database assertions for the newly created and edited name parts. The general test run reported three WebKit bootstrap tooling failures because Git Bash was absent.

Document feedback verification: HR Team browser smoke covered file selection, failure, retry and success. The focused UX browser smoke passed in light and dark themes at 390px and 1366px. The 390px pending document screenshot was reviewed.

Questionnaire follow-up: `D:/Codex/EventGenix/hr-onboarding-cli-handoff-20261116/QUESTIONNAIRE_FOLLOWUP.md`. The external questionnaire is outside this task.
