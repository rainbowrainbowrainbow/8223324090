---
name: deploy-check
description: Pre-deployment checklist — verify tests, versions, and changelog
user_invocable: true
---

# Pre-Deploy Check

Run the full pre-deployment checklist for the park booking system.

## Steps:

1. **Version consistency** — Check that the version in `package.json` matches the `?v=` query strings in `index.html` CSS/JS tags.

2. **Changelog** — Verify that `CHANGELOG.md` has an entry for the current version from `package.json`.

3. **Run tests** — Execute the test suite:
   ```bash
   node --test tests/api.test.js
   ```

4. **Check for uncommitted changes**:
   ```bash
   git status
   ```

5. **Verify index.html changelog modal** — Check that the changelog button text and modal content in `index.html` include the current version.

6. **Report** — Provide a clear pass/fail summary for each check. If anything fails, explain what needs to be fixed before deploying.
