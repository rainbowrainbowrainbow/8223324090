# Authenticated work readiness

Account creation/linking reports independent staff bridge, active state, current
business membership, effective role, pages, modules and data checks. A successful
database probe cannot establish authenticated API readiness. The account manager
is directed to the employee's own profile for that final check.

Own Profile now includes a native disclosure and a keyboard-accessible
"Перевірити робочий доступ" button. The explicit self-check calls
POST /api/work-access/check with no target identity or supplied proof. It uses the
existing authenticated session; it does not create tokens, sessions or impersonate
another account. Responses and credentials are not persisted, logged or returned
in the diagnostic. Results describe only the current check, with no durable or
cross-instance readiness promise.

The server validates current Park/single-business policy and the unique active
staff bridge, then performs the six actual authenticated reads against fixed
paths on its own listening loopback port. Request Host/forwarded headers and
caller-provided URLs cannot select the destination. Only the existing bearer and
validated business context are forwarded. Two concurrent reads, eight-second
deadlines and two-megabyte response bounds limit work; concurrent checks for the
same account are rejected. JSON shape and own profile identity are validated.
Policy and bridge are reloaded afterwards; intervening policy changes invalidate
the result. No private response content enters the receipt.

The profile and Chat read paths accept accessProbe=1 to skip incidental
achievement grants/default-channel joins while running the same scoped data
queries. Afisha uses its existing read-only list, avoiding recurring-event
materialization. Existing ordinary page behavior is unchanged.

The browser discards results after a session or business-context change, including
an ABA change. It uses a progress element while busy, a polite result status,
native button keyboard behavior and text-only DOM result construction. The result
is absent from another person's profile. Scoped CSS keeps the button at least
44px high and lists within the panel on mobile.

## Verification

- Node22 focused readiness/policy/runner checks:54/54.
- Permission contracts:138 passed, two dedicated PostgreSQL skips; those skips
  are not counted as API evidence.
- Actual disposable PostgreSQL/authenticated HTTP:4/4, no skips,
  output/work-readiness-actual-api-final.log. Six reads pass; no default channel
  membership or achievement changes; supplied identity/proof rejected; foreign
  context, all six page denials and inactive staff link cannot claim readiness.
- Actual-app six-role desktop/mobile check (instructor, reception, animator, HR,
  accountant, waiter):12/12 on the first readiness run. Each actually activates the
  check by Enter, receives all seven positive groups and navigates to the schedule.
  Final styling rerun and full repository baseline are recorded in STATE.md.
- API and CSS surface checks pass; the new route is documented in API_SURFACE.md.

An initial integration fixture used jsonb for a text[] denial column; corrected
before the final API pass. Full-check discoveries (runner wiring expectation and
API surface documentation) were corrected; failed runs are not reported as passes.

Applied Modern Web Guidance security/performance and accessibility. In particular,
native disclosure/button/progress, minimum targets, text APIs and meaningful polite
results avoid custom keyboard controls and repeated loading announcements:

- https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/accessibility/accessibility.md
- https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/security/security.md
- https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/performance.md

No production checks, real-person mutations or release authorization are implied
by local evidence. Rollback is reverting the own unpublished readiness commit.
