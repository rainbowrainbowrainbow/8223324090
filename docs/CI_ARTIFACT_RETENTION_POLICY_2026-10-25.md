# Політика зберігання CI artifacts — 2026-10-25

Погоджений блок: `EG-CI-STORAGE-RECOVERY-20261025`.

У семи upload-кроках `.github/workflows/ci.yml` задано явний retention:
- `codex/eventgenix-production`: 14 днів;
- feature-гілки та pull-request runs: 7 днів.

Назви artifacts, upload paths, матриці, assertions, `if: always()` і `if-no-files-found` не змінені. Скриншоти, traces, логи та source-bound proof залишаються у складі evidence.

Нове значення застосовується до нових uploads і не скорочує строк уже створених artifacts. Потрібні довгострокові release/rollback докази слід окремо архівувати до завершення retention.

Історичний cleanup має окремий exact-ID manifest та приватні перевірені ZIP backups. Ця політика не дозволяє нових видалень, billing-змін, production push/deploy або послаблення тестових gates. Видалення не зменшує вже накопичене використання storage за billing-період і не гарантує негайного розблокування квоти.
