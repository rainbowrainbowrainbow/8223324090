# Android navigation repair

## Confirmed causes

On Chromium's Android touch path, opening the sidebar on `pointerup` changes
hit testing before the native `click`. That click can target the newly visible
overlay and close the menu immediately. The previous per-element 360 ms
deduplication cannot connect events delivered to two different elements.
Use the native button/overlay `click` activation once, preserving keyboard,
Escape, ARIA state, focus and scroll-lock behavior.

A navigation that returns HTTP 204 or is aborted can leave the existing document
alive with `page-exiting`, `aria-busy` and a hidden main shell. Neither `pageshow`
nor `visibilitychange` is guaranteed in that case. A bounded 1800 ms watchdog
restores only the already authenticated and visible shell using the existing
lifecycle recovery guard. It does not retry a request, change access decisions,
or write business data. Page hide and shell readiness cancel the timer; an
attempt identifier prevents a superseded deferred navigation callback.

## Regression coverage

`tests/browser/mobile-sidebar-navigation-browser-smoke.js` uses real touch input
on the actual frontend markup and scripts with synthetic API responses. It is
also invoked by the existing Park timeline navigation browser CI gate.

The default gate covers creator/browser and admin/standalone. Set
`MOBILE_NAVIGATION_FULL=true` to cover creator, director, admin and animator in
both modes, at widths 360, 390 and 412. Cases cover repeated menu/overlay taps,
a busy 550 ms pointer-release handler, Escape, a real page transition to Staff,
back navigation, guarded persisted-page recovery, HTTP 204, an aborted request,
and a reload controlled by the real local service worker. Fault recovery must
send only one navigation request. The service worker case checks that private
API responses are absent from Cache Storage.

Screenshots must be reviewed after the opening transition finishes. The report
records whether a native BFCache restoration was actually observed; synthetic
persisted-event coverage is reported separately. Browser emulation and
display-mode emulation are not a physical Android device or an installed PWA.
There is no real employee impersonation or production business-data mutation.

Local command (with Playwright and Chromium available):

```text
MOBILE_NAVIGATION_FULL=true node tests/browser/mobile-sidebar-navigation-browser-smoke.js
```

Use `MOBILE_NAVIGATION_OUTPUT` for standalone evidence, or
`PARK_TIMELINE_NAVIGATION_OUTPUT` when running the enclosing Park navigation gate.

## Release boundary

Functional changes are limited to the shared sidebar. Permission, session,
service-worker and protected booking source contracts are unchanged. Normal
version/cache markers must be advanced for deployment. The independently
approved CI-only commit `d5e848fa30d9cd9d52d8bb464918faf50e237e08` must be
preserved verbatim in any release based on the current production branch.
