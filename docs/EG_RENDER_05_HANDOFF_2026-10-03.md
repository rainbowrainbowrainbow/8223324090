# EG-RENDER-05 — локальне CSS-виправлення та незавершений графічний gate

Результат: **частково виконано**. Чотири контрольні A/B-пари показали причинний вплив кінцевого стану вхідної анімації меню на білі області в browser captures. Внесено вузьку CSS-зміну, повторено навігацію та взаємодію. Це не доказ повного виправлення проблемного сеансу користувача: незалежне порівняння видимого вікна з capture та hover без кліку недоступні.

**Production impact: yes.** Commit, push, deploy, version bump, auth, БД, settings, нові залежності та production-записи не виконувалися. Попередній diff EG02–04 збережено.

## Worktree та база

- Worktree: `C:\Users\Plotva\.codex\worktrees\eg-render-01-diagnosis\EventGenix`.
- Гілка: `codex/eg-render-remediation`.
- HEAD/base: `1a23ea0d0ad0772a02bdc102ce511e13afef1588`, 0.82.45.
- Публічний `/api/version`, прочитаний у EG05: **0.82.49**, `d072a9de4165560a6efe81ed1127d097f78179fd`, `codex/eventgenix-production`, complete manifest.
- Основний checkout залишається брудним/застарілим; продуктове виправлення зроблено тільки в попередньому worktree. Перед EG06 треба узгодити його зміни з актуальним production-кодом.

## Bug report

- Симптом: великі прямокутні порожні області в меню, частина sidebar відсутня на кадрах; користувач також повідомив про hover-відновлення та повільні переходи.
- Очікування: картки та sidebar повністю видимі при відкритті, scroll і поверненні; hover не повинен відновлювати зниклий вміст.
- Фактична поведінка в preview: 100 карток у DOM, opacity/visibility нормальні, hit-test знаходить деталі картки в порожній ділянці screenshot. Помилки JavaScript у вибраних записах відсутні. Без production API проблема теж відтворюється.
- Відтворення: synthetic preview, light, creator, actual viewport 1707×791, DPR 1.5, 100 позицій, body group `art`; відкрити меню, дочекатися карток, scroll 800 px, зняти повторний кадр після перевірки DOM. Повторити зі старим/поточним CSS.
- Підтверджений керований фактор: `animation-fill-mode: both` залишає кінцеву `ptRotateIn` і perspective matrix3d на великому main. Зміна тільки fill mode на `backwards` прибирає кінцевий transform і білі області у контрольних кадрах. Це причинний доказ на рівні CSS → browser capture, а не GPU/driver/paint pipeline diagnosis.
- Перевірка: поодинока CSS-зміна, зворотний контроль зі старим CSS, незмінні дані/viewport/DOM; light/dark, 20/100, scroll/top/reentry, menu↔HR, keyboard details і фільтри.

## Preview та достовірність

Артефакти: `C:\Users\Plotva\OneDrive\Документи\EventGenix\output\eg-render-05`.

Frontend preview використовує справжні `programs.html`, `hr.html`, `designs.html`, їхні CSS, sidebar і відповідні page scripts. Products fixture походить із існуючого browser harness, body group не підмінено. HR запускає справжній `hr-page.js` та його helpers з 40 synthetic employees; today API має штучну server delay 150 ms. Products мають штучне очікування 100 ms, blueprint — 0 ms. Auth/permission bootstrap — fixture. Це **actual-page frontend preview**, не повний Express/PostgreSQL/auth integration test і не доказ production latency. Шрифти/Clarity/WS/боєві endpoints не запускаються.

Сервер прив'язаний до loopback 24685, CSP обмежує мережу цим origin, assets мають no-store. Mock generation заборонена; status/generation counters у menu records — 0. Відсутнє та broken фото — навмисні fixtures, окремі від white-block symptom. Їх не підмінено випадковими картинками.

`source-identity.json` / `source-identity-after.json` містять точні SHA256. `served-identity.json` довів збіг 6 ключових JS/CSS файлів із worktree; `served-identity-after.json` — збіг поточного product CSS після зміни. `summary.json` перевіряє ідентичність viewport/DOM та контроль transform у вибраних A/B-парах. Перевірка metadata не є автоматичним visual assertion; screenshots оглянуто окремо.

## Причинний контроль та capture

Перші три A/B-пари: baseline проти preview-only `animation-fill-mode:backwards` на main. Четверта: збережений CSS до EG05 проти фактичного worktree CSS після EG05, без експериментального override. У всіх парах 100 карток, DOM 6212, scrollY 800, той самий viewport/тема/роль. Дані, JS, card animations, contain та blur не змінювалися.

| Пара | Кадр до: білі області | Кадр після: колонки видимі |
|---|---|---|
| 1 | `capture-1790976428828.jpg` | `capture-1790976655951.jpg` |
| 2 | `capture-1790976697911.jpg` | `capture-1790976724601.jpg` |
| 3 | `capture-1790976782904.jpg` | `capture-1790976798861.jpg` |
| 4, frozen/current CSS | `capture-1790977561720.jpg` | `capture-1790977593473.jpg` |

Файли лежать у `output/eg-render-05/evidence`. Повторний baseline без нової навігації `capture-1790976710512.jpg` також залишився білим: симптом не пояснюється лише одним раннім кадром.

Окремо доведено невідповідність capture моменту DOM: після scroll DOM мав y=800, заголовок y=-711.33, але `capture-1790976641247.jpg` ще показав верх сторінки. Наступний `capture-1790976655951.jpg` уже відповідав scroll. Такий ранній кадр не зараховано як fail контрольного CSS. Це доводить несинхронність DOM/кадру, **не визначає**, чи запізнився screenshot API, paint або compositor.

Простий HTML-контроль із 100 кольоровими блоками без EventGenix CSS/JS нормально відображався до/після scroll у перевірених кадрах (`capture-1790976446191.jpg` після scroll). Один контроль не виключає проблему оточення, яка залежить від складності сторінки.

## Зміна продуктового коду

Єдина нова зміна EG05: **`css/pages-products.css:615`**, 5 доданих рядків:

```css
/* Release the product page's final animation state after its entry transition. */
body.shell-ready[data-page-group="art"] #main-content {
    animation-fill-mode: backwards;
}
```

Стилі сторінки продуктів підключаються в programs.html. Правило зберігає вхідну анімацію та її початковий стан; після завершення відпускає кінцевий animation state. Немає blanket transform/contain override, forced repaint, runtime timer або зміни спільного layout/sidebar/HR CSS. HR і designs зберегли computed fill mode `both`. EG05 diff окремо збережено у `eg05-css.diff`; CSS до/після — у `pages-products-before.css` / `pages-products-after.css`.

Це локально перевірене виправлення керованого CSS-фактора. Через відсутні докази нижче його не оголошено повним production graphics fix.

## Меню, HR та повільність — окремі висновки

| Вибраний preview record | DOM | Scripts-end marker, ms | Synthetic API, ms | Sync render, ms | First DOM rows/card, ms | Long tasks total, ms |
|---|---:|---:|---:|---:|---:|---:|
| Menu 100, frozen CSS, остання пара | 6212 | 135.9 | products 106.8 | 48.2 | 297.2 | 81 |
| Menu 100, current CSS, остання пара | 6212 | 109.6 | products 103.9 | 40.9 | 258.2 | 70 |
| Menu 20, current CSS | 2064 | 111.5 | products 102.3 | 11.3 | 229.1 | 0 |
| HR light, reload | 3083 | 174.0 | today 165.4 | 8.1 | 395.9 | 54 |
| HR light, sidebar navigation | 3083 | 183.5 | today 158.2 | 6.9 | 398.8 | 58 |
| HR dark, navigation | 3083 | 173.2 | today 161.2 | 5.4 | 376.2 | 0 |

HR precise render values are retained in summary.json; first-row timing comes from MutationObserver. Scripts-end includes parsing, asset loading and preview setup; it is not isolated JavaScript CPU time. First DOM and two-rAF markers are not card paint times. Network/resource/navigation entries and long-task entries are saved in each record. These samples do not establish a production speedup, statistical performance comparison or cause of real HR slowness.

У HR світла/темна тема, scroll, меню→HR через реальний sidebar-handler та HR→меню пройшли в доступному frontend preview. Aurora залишалася `display:none`, 0×0. Активний header у меню мав backdrop blur(14px), але його не змінювали; прихований Aurora blur не оголошено причиною. Наявність identity transform у HR сама по собі не відтворила зникнення в цих сценаріях. Переносити причинний висновок меню на HR не можна.

У light меню перевірено native Enter на details summary: open=true, фокус SUMMARY, створено один detail content. Фільтр «Бургери»: 20→16 карток; «Усі розділи»: 16→20; повернення вгору y=0. Повторний прихід із HR та designs, dark menu scroll, light 20 і 100 — без білих областей у повторних післязмінних кадрах. Ці сценарії не замінюють no-click hover чи повного тесту всіх редакторів/модалок.

HR у цьому fixture робить штатний today polling раз на 30 s; повторні GET у довшому HR record відповідають цьому інтервалу. Доказу дублювання таймерів або причини production slowness не отримано; HR polling не змінювався.

## Перевірки

- Node **22.23.1** / npm **10.9.8**, check:runtime — passed.
- check:css-surface — **96 CSS files**, passed.
- test:ui — **1327 static checks**, **4 code-splitting tests**, **16 timeline settings tests**, passed, 0 failed.
- git diff --check — passed; CRLF warnings не є whitespace failure.
- Diagnostic scripts: node --check — passed.
- Browser evidence: чотири A/B-пари, реальна CSS-зміна без override, synthetic menu/HR/designs, keyboard details/filter/scroll. Scope та обмеження наведено вище.
- Новий DOM/static тест не додавався як «paint regression»: він не виявив би цей дефект. Релевантна перевірка — збережений відтворюваний browser A/B та огляд повторних кадрів. Автоматичний graphical acceptance ще відсутній.
- Повний npm test, CI, production UI QA та deploy не виконувалися; останні етапи заборонені до EG06. EG02–04 targeted tests у цьому CSS-блоці не перезапускалися; їхні попередні результати збережено в handoff EG04, не подано як новий прогін.

## Збої та відновлення

Кожен збій повідомлено CAPS між !!!!!. Пошук неіснуючих `js/page-transitions.js` і `tests/css-surface-ownership.test.js` замінено фактичними layout.css та check:css-surface. Runbook відсутній у старому main checkout — прочитаний у worktree. Перший restricted shell version read відхилено; authorized read-only повтор отримав 0.82.49. Перший HR light fixture відновив dark через ui.js — theme bootstrap виправлено, запис виключено. Один browser selector deadline після HR scroll: група Продукт була закрита; після свіжого DOM розгорнуто й навігацію повторено. Перший test:ui не мав jsdom; process-local NODE_PATH до існуючого main node_modules дозволив фінальний зелений run без install. Designs fixture спершу повертав об'єкт замість tags array — контракт виправлено й сторінку повторено; старий console error зберігався в tab log, новий navigation record мав errors=[]. Один patch anchor harness не збігся — файл не змінено, патч повторено з точним рядком.

## Незавершені етапи та умова продовження

!!!!! EG-RENDER-05 НЕ МАЄ ПОВНОГО ГРАФІЧНОГО ACCEPTANCE. EG-RENDER-06 ЗАЛИШАЄТЬСЯ HOLD: НЕ МОЖНА ОГОЛОШУВАТИ ВЕСЬ САЙТ ВИПРАВЛЕНИМ ЗА SCREENSHOTS АБО DOM-ТЕСТАМИ. !!!!!

1. **No-click mouse hover**: підтримувані locator API не мають hover/mouse-move, native control вимкнено. Потрібен запис ручного hover у synthetic preview або підтримувана hover surface; клік не є заміною.
2. **Видиме вікно проти capture**: немає незалежного OS/window capture у цій сесії. Потрібно одночасно спостерігати видиме Chrome-вікно та повторні browser captures на тих самих before/after URL. Без цього не відокремлено graphics від capture-only defect.
3. **GPU/layer/raster/paint trace**: browser API не надає DevTools trace; chrome://gpu недоступний через URL policy, обмеження не обходилось. Для продовження користувач може вручну зняти Performance recording із screenshots/paint/layers та скопіювати GPU report з Chrome на synthetic preview. Не змінювати acceleration/flags/profile settings. Trace має охопити before/after load, scroll та hover з однаковими даними/темою/viewport.
4. **Production HR/shell latency**: fixture bootstrap не вимірює реальні verify/permissions/profile/today, мережу production чи його повний cache/SW lifecycle. Потрібен read-only trace тестової сесії з endpoint timings, bootstrap/DOM/paint і повторними навігаціями. Не заходити в старе production меню, якщо воно може автоматично викликати mutating status GET. Спочатку безпечна ізоляція або контрольований preview повного актуального app.
5. **Реліз**: узгодити з 0.82.49/актуальним production SHA, зберегти всі EG02–05 зміни, закрити перелічені visual gates, потім exact-release CI/deploy/live QA у EG06. MENU-027 справжнє фото цим блоком не відновлено.

Умова завершення EG05: незалежно підтвердити, що before/after CSS усуває саме зникнення у видимому вікні та no-click hover сценарії; якщо ні — продовжити причинний пошук без розширення blanket CSS. Жодних постійних browser settings не змінено.

## Повторення

З основного workspace: `node output/eg-render-05/server.cjs`. **Не повторювати apply-css.cjs**: він одноразовий. Сервер читає поточний worktree; hashes треба звірити з source-identity-after.json. Артефакти не слід видаляти до завершення EG06.

- Before CSS: `http://127.0.0.1:24685/programs?count=100&theme=light&phase=after&cssPhase=before#kitchen-menu`.
- Current CSS: `http://127.0.0.1:24685/programs?count=100&theme=light&phase=after&cssPhase=after#kitchen-menu`.
- HR: `http://127.0.0.1:24685/hr?theme=light` або `theme=dark`.
- Plain control: `http://127.0.0.1:24685/control?theme=light`.

Використовувати `phase=after`: це поточний EG02–04 JavaScript в обох CSS-парах. Viewport у цій задачі не змінювався; власні вкладки закрито, loopback server зупинено після QA. Звіт збережено в основному docs та скопійовано в worktree для handoff.
