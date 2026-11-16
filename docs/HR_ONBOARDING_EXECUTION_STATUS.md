# HR onboarding execution status

Base: `89255f1f6ed34e849ccf585169dc91cd5c5db866`, observed on both upstream and live `0.83.94` on 2026-11-17. Branch: `codex/hr-onboarding-ux-20261116`. Worktree: `D:/Codex/EventGenix/hr-onboarding-ux-20261116`.

- A, inventory in progress. Current production base adds a standalone Team creation dialog and idempotent creation service. The Team dialog is the owner-observed “Створити картку” entry point. Candidate conversion, schedule and CRM issuance remain separate entry points.
- B, implementation in progress. Team dialog derives department, position and primary profession from one active catalog entry. Known display aliases share a department choice. Secondary professions remain in the card. Phone formatting runs on blur and preserves the entered digit sequence. Team creation now submits given and family names separately. Migration 413 adds nullable storage, and the creation service retains a compatible full display name. The existing card still edits the legacy full name. The next step is to round-trip the separate fields in the card and reconcile legacy edits. Department catalog administration and production duplicate identification remain open.
- C, implementation in progress. User-driven tabs save dirty main/work data through the current guarded save functions. Effective payroll and other explicit actions stay outside tab switching. Pending uploads and the profile photo device picker still require work.
- D/E, protected. Prepare reviewable proposed payroll and CRM permission changes for separate authorization. Check schedule destination and current membership before proposing role or redirect changes. Microsoft reference remains unidentified.
- F, pending. Design the return mode against existing lifecycle and due date semantics.
- G, pending. No production authorization, push, migration execution, or deploy. Use isolated PostgreSQL and browser suites before preparing a candidate.

Focused browser evidence: `output/playwright/hr-team-ux/`. The creation and tab-save smoke passed at 1366px and 390px in both themes, including failed save, retained edits and retry. The 390px creation screenshot was reviewed. Runtime verification passed with Node 22.22.0/npm 10.9.4. Full PostgreSQL-backed creation and CI remain pending.

Name split verification: migration governance and repeat browser smoke passed. The PostgreSQL browser suite was invoked and stopped before creating any fixture because `TEST_DATABASE_URL` was absent. It contains assertions for both persisted names.

Questionnaire follow-up: `D:/Codex/EventGenix/hr-onboarding-cli-handoff-20261116/QUESTIONNAIRE_FOLLOWUP.md`. The external questionnaire is outside this task.
