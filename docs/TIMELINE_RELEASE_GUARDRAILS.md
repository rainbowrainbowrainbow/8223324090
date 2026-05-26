# Timeline release guardrails

Дата: 26.05.2026  
Сфера: deploy/cache/version proof для shared timeline engine на `/` і `/maysternya-doli`.

## Rollout weakness audit

Сильні rails, які вже існують:
- `package.json` є джерелом правди для `version` і `eventGenix.releaseLabel`.
- `scripts/version-sync.js` синхронізує `package-lock.json`, HTML `?v=`, first-screen release text, latest changelog marker, `sw.js` cache names і `/api/version` contract.
- `npm run check:version` ловить drift між локальними release markers.
- `npm run version:smoke -- <live-url>` перевіряє production `/api/version` і login HTML.
- `npm run check:service-worker-policy` тримає приватні CRM API поза offline cache.

Слабке місце до Phase 5:
- `version:smoke` не доводив, що обидва timeline contexts віддають саме нові `timeline.js`, `timeline-interaction-model.js` і `timeline-context.js`.
- Service Worker cache names перевірялись локально, але не були частиною live timeline proof.
- Rollback/fallback кроки існували як знання оператора, а не як repo-native release guardrail.

## New proof command

Після git deploy запускати:

```bash
npm run release:timeline-proof -- https://8223324090-production.up.railway.app
```

Команда перевіряє:
- `/api/version` збігається з `package.json`;
- `/` містить release text і timeline assets з поточним `?v=`;
- `/maysternya-doli` містить ті самі shared timeline assets з поточним `?v=`;
- live `js/timeline-context.js?v=<version>` містить shared context markers;
- live `js/timeline-interaction-model.js?v=<version>` містить drag/resize/undo helper markers;
- live `js/timeline.js?v=<version>` містить interaction model і lifecycle markers;
- live `sw.js?v=<version>` містить `event-genix-v<version>` і `event-genix-api-v<version>`.

Якщо будь-який пункт падає, deploy вважається неповним: не закривати реліз як live.

## Stale-client detection

Операторська перевірка:
1. Відкрити production `/`.
2. Перевірити release badge на login або в `/api/version`.
3. Перевірити source/network для `js/timeline.js?v=<version>` і `js/timeline-interaction-model.js?v=<version>`.
4. Якщо browser показує старий `?v=`, виконати hard reload або очистити Service Worker/cache для домену.
5. Якщо server HTML все ще віддає старий `?v=`, це deploy blocker, а не browser-cache проблема.

Repo-native check:

```bash
npm run release:timeline-proof -- <live-url>
```

## Rollback / fallback path

1. Зафіксувати live branch target:

```bash
git ls-remote origin deployed
```

2. Якщо останній timeline release ламає production interaction, створити rollback commit через revert поганого release commit:

```bash
git revert <bad-release-commit>
npm run version:bump -- patch --label "CRM <next>: rollback таймлайну"
npm test
git push origin HEAD:deployed
```

3. Дочекатися Railway deploy і перевірити:

```bash
npm run version:smoke -- <live-url>
npm run release:timeline-proof -- <live-url>
```

4. Після rollback оператор має перевірити мінімальний timeline smoke:
- `/` відкриває актуальний release marker;
- `/maysternya-doli` відкриває актуальний release marker;
- `timeline.js?v=<version>` не stale;
- один drag/resize smoke в авторизованій сесії не ламає UI.

## Release closure checklist

- `npm run check:version` green.
- `npm run check:service-worker-policy` green.
- `npm test` green на Node 22/npm 10.
- Commit pushed to working branch.
- `git push origin HEAD:deployed` completed.
- `npm run version:smoke -- <live-url>` green.
- `npm run release:timeline-proof -- <live-url>` green.
- Authenticated operator UAT, якщо змінювалась interaction logic.
