# My Day and Task Center QA

The browser smoke test uses disposable PostgreSQL and synthetic accounts.
Run it with the existing isolated database runner and Playwright.

```bash
npm exec --yes --package=playwright -c 'node scripts/run-isolated-postgres-tests.js my-day-task-center-browser'
node scripts/run-isolated-postgres-tests.js task-cleanup-replay
```

Supply `TEST_DATABASE_URL` for a disposable database and
`TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE`. On a machine with
system Chromium, set `TASK_CENTER_BROWSER_EXECUTABLE` to its executable path.

| Dark theme | 360 px | 1440 px |
| --- | --- | --- |
| My Day | [Mobile](my-day-dark-360.png) | [Desktop](my-day-dark-1440.png) |
| Task Center | [Mobile](task-center-dark-360.png) | [Desktop](task-center-dark-1440.png) |

[Read-only cleanup and replay results](task-cleanup.md)

## Coverage

- Opened the composer from Task Center on mobile, checked focus and verified
  delegation, co-assignment, completion and exactly one completion event.
- Created linked work in a second business, dropped the first response, then
  replayed the same creation key. Tested batch overrides and operation-pack replay.
- Checked the Kyiv date boundary from a browser in another time zone, private
  and observer visibility, server-side filters across 104 matches and retry after
  a collection error.
- Opened a legacy link, read history and a retained checklist, and returned to
  the filtered team list. Checked keyboard actions and both themes in Chromium.
- Ran the existing PostgreSQL My Day integration suites and the Chromium
  co-assignee smoke. The Task Center browser parity suite also passed for the
  retained views, keyboard focus, load states and theme contrast. External AI provider behaviour and production data remain
  outside this validation run.
