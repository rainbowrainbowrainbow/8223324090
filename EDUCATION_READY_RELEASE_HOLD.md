# EDU-READY-09 — RELEASE HOLD

**Статус: HOLD. Реліз не виконано.** Чинний `EDUCATION_READY_FINAL_ACCEPTANCE.md` має **NO-GO**; дозвіл задачі09 поширюється лише на пакет із GO. Його передумова не виконана.

Production impact: yes для майбутнього release; у09 production не змінювали. Commit/push/CI/deploy/migrations/version/cache/changelog — **NOT RUN**. Deployment attempts:0; нового release SHA немає. Позитивний read-only preflight не означає release acceptance.

## Причини HOLD

| Blocker | Чинний результат | Доказ |
|---|---|---|
| ACCEPT-01: landscape education editor | FAIL: sidebar перекриває ліві краї date/Save на844×390 у Chromium/WebKit | `output/education-ready/08/occlusion-edge/verification.json` |
| ACCEPT-02: visible WebKit create | FAIL: valid UI activation не генерує click/submit/POST; root cause NOT PROVEN | `output/education-ready/08/regressions/journey/attempt-2026-10-04T09-42-43-457Z/verification.json` |
| Physical devices08C | BLOCKED_DEVICE:42 planned cases,0 PASS | `output/education-ready/08/current-device-verification.json` |
| Native keyboard/pickers/VoiceOver/TalkBack | NOT RUN; emulation не підміняє hardware | `output/education-ready/08/truth-verification.json` |

Попередні Chromium/F01–F06/npm/PostgreSQL PASS не перекривають ці blockers. Нових продуктових fixes у09 не внесено; задача09 не використана для обходу acceptance.

## Свіжий read-only preflight

`output/education-ready/09/preflight.json` містить точний час нової перевірки; старий SHA з handoff не використаний як єдиний доказ.

- Worktree: `C:/Users/Plotva/.codex/worktrees/education-ready-pack/EventGenix`, branch`codex/education-ready-pack-20261003`; dirty package збережено.
- Live `/api/version`:0.82.59, SHA`56fe29bf2134f0d67f1d98b43e8fa0af1c490e2e`, branch`codex/eventgenix-production`; deployment manifest complete.
- Fresh remote production HEAD: той самий SHA. Production не просунувся від verified package base; release worktree/integration не запускали через NO-GO.
- Read-only `railway status --json`: project`fortunate-appreciation` (`bc28b46c-d4bc-491c-893a-d8401c633668`), environment`production` (`d9f9b984-d54d-4620-a8bf-c48882ad5158`), service`8223324090` (Railway UUID`3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`) підтверджені. CLI invoked only status through the already linked primary checkout; no link/settings/deploy command.
- Railway status не повертає configured Git source branch/repository. **NOT_EXPOSED_BY_STATUS**, не підтвердження конфігурації branch. Branch завантаженого live коду доведений version manifest; перед майбутнім deploy повторно підтвердити чинний release/source target. Settings не змінювали.
- Source1061/harness909 file hashes досі збігаються з фінальним08 acceptance; stale files0. Read-only status/diff переглянуто. Це код із NO-GO, не прийнятий release diff.

## Release stages та rollback reference

- Release diff/inventory/migration approval/version bump/cache/changelog preparation: NOT RUN; їх потрібно виконати після нового GO на актуальній базі. Additive migration08A не застосовувалась у production.
- Functional/release commits, production push, exact-SHA CI, manual release helper, post-deploy read-only education/Park smoke: NOT RUN.
- Rollback reference для можливого майбутнього release: свіжо спостережений попередній production SHA`56fe29bf2134f0d67f1d98b43e8fa0af1c490e2e`, branch`codex/eventgenix-production`. Це запис ідентичності, не новий git tag/branch і не виконаний rollback. Заново звірити перед наступним release.
- Production business writes/seed/messages/payments/customer changes, destructive SQL/backfill, force-push/infrastructure changes: не виконувалися.

## Докази та перевірки09

- `node output/education-ready/09/check-release-gate.js` → **HOLD / exit1**, current source/harness match true. `release-gate.json` містить input hashes, open statuses і NOT RUN для невиконаних stages.
- Live/version, `git ls-remote`, Railway status — свіжі read-only observations у `preflight.json`; ніяких secrets/customer data у результаті.
- `prior08-evidence-hashes.json` зберігає710 hashes попередніх08 файлів;09 не переписує їх. `handoff-before09.md` — exact snapshot попереднього handoff, який був hash-bound у08.
- `preservation.json`:710 попередніх файлів перевірено, змінених0; primary dirty status незмінний; snapshot handoff відповідає08 hash. Parser і `git diff --check` exit0.
- Primary dirty checkout, продукт, package/lockfile, retained synthetic datasets і попередні QA artifacts залишаються чинними.09 додає лише HOLD documentation/output та оновлює handoff.

## Наступна дія

Закрити ACCEPT-01, встановити й усунути причину ACCEPT-02, провести source-bound фізичні08C перевірки та повторний комплексний acceptance. Тільки після нового **GO** відновлювати09 з повторною live/remote/Railway identity перевіркою, release diff review, exact-SHA CI та manual deploy за чинним helper. Підміна missing hardware/FAIL на PASS не дозволена.
