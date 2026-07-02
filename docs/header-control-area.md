# Header Control Area Decision Record

Status: active
Date: 2026-07-02
Production impact: no

## Context

Authenticated CRM pages currently keep their top-right header/control markup as
duplicated static HTML. This is intentional for the current release scope:
the timeline settings divider was a narrow UI fix, not a global header refactor.

## Current Ownership

- Header/control markup remains duplicated in root-level static HTML pages.
- Shared behavior for login/session/logout and common authenticated page setup is
  owned by `js/auth.js`.
- The timeline settings gear is owned by `js/timeline-visibility.js`.
- The timeline settings gear visual divider is a CSS contract attached to the
  timeline gear class, not a new DOM element.

## Product Decision

Do not add a global settings gear to every CRM page without a separate product
decision. A future rollout must explicitly define:

- which pages should show a settings gear;
- which route each gear opens;
- which roles can see it;
- whether pages without settings hide the control completely.

## Future Refactor Rule

If the duplicated header markup is centralized later, do it through a shared
runtime/helper contract. Do not mass-copy new button markup across pages.
The refactor should preserve existing theme toggle, logout binding, settings
handlers, mobile layout, focus behavior, and auth/access differences.

## Browser QA Limitation

The timeline divider release was manually checked with static/mocked browser
coverage. Full live browser smoke requires a running CRM URL and valid auth:

- set `TIMELINE_BROWSER_SMOKE_URL` or `TEST_URL`;
- provide either an auth token or `TIMELINE_BROWSER_SMOKE_USER` /
  `TIMELINE_BROWSER_SMOKE_PASS`;
- without those values, `npm run test:browser:timeline` is not runnable and
  should be reported as not run, not as passed.

Do not commit secrets, `.env` files, or local auth tokens for this smoke check.

## Static Guardrail Limitation

`tests/ui-check.js` is a static guardrail, not a replacement for browser or live
QA. New header-control checks should prefer token, DOM, and selector-based
assertions over exact-line or formatting-sensitive string checks. Do not expand
fragile source-string checks unless there is a clear reason and no stable
selector/contract is available.

## Line Ending Note

On Windows, Git may report LF to CRLF warnings for files touched by this release.
Those warnings are not a blocker for the header divider release. Do not run a
mass formatting pass or change `.gitattributes` as part of this release; any
line-ending normalization should be handled as a separate cleanup task.
