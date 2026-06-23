# TASK: Banquet Deposit Release And Changelog

- Status: proposed after analysis
- Type: release/documentation task
- Production impact: yes

## Goal

Prepare the user-visible banquet deposit accountant workflow for release.

## Scope

- Bump project version only after implementation is complete and approved.
- Update `index.html` changelog modal in Ukrainian.
- Update `CHANGELOG.md` in Ukrainian if release-relevant.
- Run version sync using the repository release flow.
- Run the local verification baseline on Node 22/npm 10.
- Do not deploy unless explicitly asked.

## Required Commands

```bash
npm run check:runtime
npm run version:bump -- patch --label "Banquet Deposit Verification"
npm run version:sync
npm run check:version
npm test
```

## Acceptance Criteria

- Version metadata is consistent.
- User-facing release notes are in Ukrainian.
- No production deploy or push happens without explicit request.
