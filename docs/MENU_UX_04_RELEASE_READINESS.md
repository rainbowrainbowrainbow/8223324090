# MENU-UX-04: готовність узгодженого UI-релізу

Production impact: yes. Status: готовий локально, production delivery очікує чинного Yellow-блоку.

## Результат

MENU-UX-01/02/03 об'єднано в одному ізольованому worktree. Меню показує повне фото у рамці 3:2 через contain, компактну картку та окремий read-only перегляд. Є один спільний serializer і один набір pf-* полів: для страв форма відкривається у модальному редакторі з логічними групами; для інших продуктів відновлюється попереднє розташування. AI дії перенесено в редактор. На вузьких екранах — одна колонка, native вибір розділу, touch targets від 44 px, safe-area та реакція на visualViewport.

Причина початкових проблем: cover у низькій рамці обрізав фото; inline details/form змінювали геометрію каталогу; shared мінімум ширини та ряд полів не відповідали мобільному контейнеру. Серверну генерацію і її провайдера цей реліз не змінює.

## Перевірки 03.10.2026

- Node 22.23.1 / npm 10.9.8: check:runtime passed.
- Повний npm test: exit 0; repository guards, syntax, unit/UI, SYS-MB baseline passed. Лог: output/playwright/menu-ux04/baseline.log.
- Focused behavioral suite: 78/78 passed, tests/products-menu-form.test.js, products-menu-rendering.test.js, products-menu-image-ui.test.js, products-menu-image-lifecycle.test.js, products-menu-image-autosave.test.js, products-blueprint-loading.test.js.
- Chrome: 8 menu/catalog scenarios passed; 4 aspect scenarios passed; 1 shared-editor regression passed (program/cake/Maysternya at 390/1440). Width matrix: 360/390/430/768/1440, light/dark; keyboard area is emulated through visualViewport resize events.
- Фото 3:2/1:1/2:3: 48 rendered screenshots of card/current/draft/large at 360/390/768/1440. Pixel inspection found all four unique corner colors in every PNG (minimum 256 exact-color pixels per corner). Contact sheet visually reviewed.
- Focus/keyboard/Cancel/Save failure/retry/double click, required timelineCode, hidden 0/false, context drift, editor rerender, tracking after photo-dialog close and file/URL autosave covered by behavioral suites. Current photo stays unchanged until explicit Apply.
- git diff --check passed. No API/schema/auth/provider/billing/settings changes or new dependencies.
- Two fixture-only test failures were corrected: a duplicate hydrated-photo locator and same-document hash navigation between cross-business viewport iterations. Product logic was unchanged for these corrections.

## Production preflight

Live and remote production SHA: 98ad5e139e8409407f7f04bc9ba9ade45567921d, v0.82.51, branch codex/eventgenix-production. Worktree is based on this exact SHA. Railway project fortunate-appreciation (bc28b46c-d4bc-491c-893a-d8401c633668), environment production, service 8223324090 and its live domain verified read-only with explicit project/environment.

Nearby HR review branch currently retains v0.82.51. Proposed next patch: v0.82.52, subject to a fresh live/remote/version check before the authorized push. Same-version helper guard inspected: different SHA with equal live version is rejected. Functional commit precedes the separate version/cache/changelog commit; release notes supplied in MENU_UX_04_RELEASE_NOTES.json. Require exact release-SHA CI before manual Railway helper and exact live version proof.

Read-only menu QA preflight passed: configured test account ID 48 (senior_manager), event_genix, exact disposable ID/code/timelineCode and run ID available; registry/cleanup privileges available. No production product or registry writes occurred. Enabled bounded manual scope is in MENU_UX_04_QA_SCOPE.json. The existing controller has no menu QA kind; its automated timeline QA must not substitute for this scope.

## Evidence and limitations

Screenshots: output/playwright/menu-ux03/ (catalog, viewer, editor, upload errors, loading/failed/cooldown/ready, keyboard area), output/playwright/menu-ux04/ (all aspect PNGs, aspect-contact-sheet.png, four-corner-pixel-evidence.json). Artifacts are local/ignored; no real customer data or credentials captured.

This is actual desktop Chrome with mobile viewport/touch/keyboard-area emulation, not a physical phone or iOS Safari test. Live Save/Apply and exact-SHA CI/deploy are pending authorization. Paid AI generation was not run. The pre-existing unregistered products-demo-flow.test.js has three stale checks reproduced on the base SHA in UX01; registered npm test passes. Do not claim that file passed.

Rollback target: previous production SHA above, via release helper without force-push. Stop on target/base/version/scope drift, failed CI, missing ownership proof or expiry. Main dirty checkout remains untouched.
