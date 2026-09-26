# CERT-CLOSE-03 release plan and pending proof

Production impact: yes. Prepared on 2026-09-26. This is a pre-release record;
it does not claim a production deploy or live redemption.

## Verified baseline and candidate

- Live `/api/version`: `0.82.17`, `814900eab52278a4bd81231aba494f99e9678bbf`, branch `codex/eventgenix-production`.
- Railway: project `fortunate-appreciation` (`bc28b46c-d4bc-491c-893a-d8401c633668`), production service `8223324090` (Railway service UUID `3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`), deployment `edde823c-8296-447a-9df0-e7d15b40dc05` (`SUCCESS`).
- Isolated candidate branch `codex/cert-close-03`, initial integrated SHA `6f2824ee4a8daa8dd12a7c616ca231f4746f1f1d`, descendant of the live SHA. Six CERT-CLOSE-01/02 commits cherry-picked without conflict; no unrelated source changes.
- Previous source CI: [CERT-CLOSE-02 SHA `c1ef108c…`](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36235326279), successful. This is not exact-SHA CI for the integrated candidate.
- Migration `371_trusted_qa_certificate_lookup.sql`: additive, repeatable partial lookup index; no certificate data backfill or status changes. Stop new QA issuance and finish/inventory existing runs before any runtime rollback. Preserve business-read exclusions for all historical QA records. Drop the index only after separate review if necessary.
- Local Node 22.23.1/npm 10.9.8: 35/35 focused certificate/finance/legacy tests passed; synthetic certificate browser smoke passed. The full Windows `npm test` completed 3098/3099 tests, with one failure in unchanged `tests/checkin-reliability-contract.test.js`: its LF literal does not match CRLF in `checkin.html`. This is not a green full baseline; Linux exact-SHA CI is still required.
- Read-only QA account review: the available smoke account is QA-labelled, active, has Park membership and no staff profile. Its `senior_manager` role is already permitted to issue by the legacy `admin` expansion in `requireRole`, and to redeem by the existing redemption policy. The new operator script had an incorrectly narrow preflight list; the candidate corrects only that list. A full operator `--mode plan` then passed in an explicit `READ ONLY` transaction: exact account 48, isolated, zero open certificate QA-runs, 30-minute TTL. No token or run was created. No account, credential, role, or production data was changed.

## Proposed patch release notes (Ukrainian)

Цільова версія після дозволеного release controller: `0.82.18` (остаточний
номер визначає `npm run version:bump` під час виконання блоку).

- Перевірка сертифіката у формі бронювання показує, чи дозволено його використати саме в поточному бізнес-контексті, і пояснює заборону. Остаточне рішення залишається в транзакції створення бронювання.
- Додано серверно перевірюваний disposable QA-run для одного сертифіката: прив'язка до тестового акаунта, Парку, короткого строку дії, точного endpoint і одноразового token/request ID.
- QA operator preflight узгоджено з уже чинними ролями, які можуть і видати, і погасити сертифікат; права API не розширено.
- QA-сертифікат не потрапляє до бізнес-лічильників і клієнтських каналів; фінансове прив'язування, друк та бронювання ним заборонені. Історія прямого погашення зберігається після закриття QA-run.
- Додано адитивний індекс для пошуку записів certificate QA у trusted registry. Правила ролей, стабільних типів і транзакційного погашення не розширено.

## Release gate

`npm run codex:production-block -- prepare -- --release-label "Сертифікати: узгоджена перевірка та ізольований QA" --qa-scope none` returned `PRODUCTION_BLOCK_RED_PATHS` for `routes/auth.js` and `routes/finance.js`. These files respectively exclude QA records from the staff profile and reject QA certificate finance links. The paths remain Red; they must not be relabelled as ordinary Yellow changes or passed as the unrelated SYS-MB protected workflow. The current controller only accepts automated `timeline`/`canary` QA scopes, so certificate QA cannot be represented as its `allowedQaScope` without a separate, scoped controller change.

Pending before production: resolve this Red gate through a specific authorized workflow; then produce exact release SHA and green CI, deploy through the canonical controller, confirm live identity and migration, verify the server QA mechanism, run one isolated browser issue/redeem/retry scenario, close the run, and append the exact evidence to this plan and the certificate reports. No production record has been created for CERT-CLOSE-03.
