# EDU-ASTRA — підтверджені дефекти до правок

## ASTRA-01 · P2 · UX / accessibility
- Симптом: двоє викладачів з однаковим ПІБ не відрізняються у видимих списках групи й заняття; кнопки завершення роботи не називають адресата.
- Expected: оператор бачить однозначні варіанти; accessible name дії називає викладача. Display discriminator не потрапляє в canonical teacherName.
- Actual: distinct IDs 108/109, однаковий текст «марія п’ятницька», однаковий рядок статусу; aria-label відсутній.
- Reproduction: нові викладачі через видимий UI → групи/довідник (390px) → канонічний edit robots-4 → список викладачів. Два нові browser assertions FAIL на production-base source.
- Baseline: output/education-ready/astra/reproduction/attempt-2026-10-14T18-17-29-422Z-teachers-chromium-7a9b48. verification.json містить actual option labels/IDs, row text/names; astra-teacher-manager.png і astra-lesson-teacher-selected.png переглянуто особисто.
- Root cause: js/education-groups.js і setEducationTeacherOptions у js/booking.js показують тільки name. Старий тест обирав за ID, тому проходив за неоднозначного UI.
- Вплив: ризик призначення або деактивації іншої однойменної людини. Backend identity не пошкоджена.
- План: ID лише для однакових імен у pickers, видимий ID у manager, accessible target у кнопці. Зберегти dataset.staffName без display suffix.
- Verification: ті самі UI assertions, SQL/canonical teacherName, existing teachers/group/journey, protected hash gate та final npm test.
- Зауваження до baseline frame: lesson screenshot захопив відкривання панелі; він не є прийманням terminal layout. Остаточний кадр потребує перевірки геометрії після завершення анімації.

## ASTRA-02 · P2 · UX
- Симптом: відмова через місткість групи показує англомовний технічний текст без зрозумілої наступної дії.
- Expected: українське повідомлення пояснює причину й спосіб виправлення, draft збережено, SQL unchanged, HTTP409.
- Actual: Group capacity exceeded / Capacity is below existing membership. Baseline groups suite явно дочекався цих повідомлень у UI й пройшов; це не є UX acceptance.
- Reproduction: повна група → зарахувати другу дитину / зменшити місткість нижче кількості учасників.
- Baseline: output/education-ready/astra/baseline/attempt-2026-10-14T18-15-24-923Z-groups-chromium-0d533e. Новий строгий Ukrainian-message case запускається окремо в reproduction/.
- Root cause: services/educationGroups.js віддає ці англомовні error.message, frontend відображає їх напряму. Попередні тести закріпили цей текст.
- Вплив: незрозуміле відновлення після помилки, без втрати даних у перевіреному сценарії.
- План: змінити тільки дві повідомлення; HTTP statuses, transaction/capacity logic і schema залишити без змін. Оновити точні текстові assertions, не послаблювати SQL/draft перевірки.
- Verification: UI409 → українська причина й дія → unchanged SQL + draft → успішний retry; final groups та integration matrix.

## Межі
Виправлення не потребують schema/auth/permissions/protected-manifest/dependency змін. Новий booking renderer не створюється. Поточний scope — локальний код без release.

## ASTRA-01 / Today filter extension (before edit)
- Новий visible UI case astra-today-same-name-teacher-filter-visible-choice: два однойменні викладачі мають два заняття 2036-01-11, але два filter options мають однаковий видимий текст. FAIL 1 !== 2; різні IDs підтверджені у proof.
- Root cause: ensureFilterOptions у js/education-schedule.js дедуплікує values, але не відрізняє labels.
- Baseline: focused/attempt-2026-10-14T18-22-58-384Z-teachers-chromium-4f8155. astra-today-teachers.png переглянуто. План: discriminator лише teacher filter, без зміни values або predicate; перевірити вибір за видимим label і тільки правильне заняття після фільтрації.

## ASTRA-H01 · P2 · harness defect (before edit)
- Новий manager check прочитав порожній список після відкривання details: helper manager чекав відсутності слова «Завантаження», але читав попередній status до toggle/fetch.
- Actual focused FAIL: rows 0, а не 2. Це race нового тесту, не зникнення викладачів у продукті.
- План: почати waitForResponse перед відкриванням, перевірити GET200 та видимий рядок другого ID. Зберегти assert двох рядків і distinct labels/action names; жодного API repair чи sleep.
- Окрема перевірка terminal editor geometry підтвердила right=1440 на viewport1440 після завершення animation; попереднє обрізання кадру було transient capture. Стабільний focused кадр переглянуто, новий product CSS fix не потрібний.

## ASTRA-02 reproduction update
Новий strict UI case FAIL на точній різниці українського expected і англомовного actual. HTTP409, SQL capacity6 unchanged, draft5 збережено. Proof: reproduction/attempt-2026-10-14T18-20-22-871Z-groups-chromium-fd577d. astra-capacity-error.png переглянуто до правки.

## ASTRA-H02 · harness fixture defect
Перший новий layout runner не підготував business cabinet mode education (на відміну від чинних teachers/groups runners). У UI не було education lesson controls; initial rows timeout, не product FAIL. Початковий attempt layout-before збережено як BLOCKED_FIXTURE/INCOMPLETE без PASS; дочірній власний browser harness зупинено, canonical runner виконує disposable cleanup. Виправлення: встановити education cabinet як явну synthetic prerequisite до UI й перевірити preflight; не ремонтувати невдалий user step API-записом.

## ASTRA-03 · P2 · visual UX (before CSS edit)
- Симптом: у desktop education editor кнопка +15 накладається на назву кабінету; стабільний кадр особисто переглянуто.
- Reproduction: desktop1440, light/dark → Today 2026-10-03 → robots-4 → canonical Edit → завершення всіх finite animations → context card.
- Expected: усі три time controls знаходяться у власній колонці, не перетинають назву кабінету; touch targets44px, ±15 працюють, Save доступний.
- Actual: time column width176.859px; +15 right1231.266 > time right1212.125 (overflow19.141px), resource left1222.125 (overlap9.141px). Обидві desktop themes FAIL. Це не transient animation: panel bounds уже terminal.
- Baseline: output/education-ready/astra/layout-before, corrected fixture attempt у layout-before-2.log; raw geometry і screenshots містяться у verification.json. Initial invalid-fixture attempt збережено окремо.
- Root cause: css/panel.css задає repeat(3,minmax(0,1fr)); time grid потребує44+96+44+12=196px. Попередні visual checks прокручували editor до lesson form і не перевіряли containment верхніх time controls.
- Вплив: перекритий текст кабінету та нечітка зона кліку у реальній desktop формі.
- План: тільки education-scoped context card grid з auto-fit та мінімальною шириною220px, без зміни font size, booking source/identity або Park CSS.
- Verification: новий actual-app layout suite, 7 viewports × light/dark на Chromium і WebKit, containment/overlap + real ±15 clicks + Save; повний responsive suite обох engines і Park acceptance.

## ASTRA-H03 · harness navigation boundary (before edit)
- astraLayout/WebKit geometry14/14 passed, але page-errors FAIL: незавершений GET /api/my-day/timer отримав WebKit access-control rejection під час navigation/teardown.
- Новий standalone runner переходив з login відразу після mainApp visible, до terminal hydration спільного timer; чинні journey/teachers runners уже чекають GlobalTaskTimer hydrated/loading/pendingHydrate.
- План: застосувати ті самі terminal runtime waits перед навігацією і teardown, без whitelist pageerrors та без weakening geometry assertions. Повторити suite; якщо rejection залишиться — окреме product/environment investigation.
- Первинний FAIL збережено: final/attempt-2026-10-14T18-34-58-507Z-astraLayout-webkit-1d0aa9. Будь-який PASS на старому harness inventory стає stale; фінальний collector вимагатиме свіжі повні inventories.

## ASTRA-H04 · coverage/required-inventory correction (before edit)
Чинний responsive runner мав7 viewport/theme combinations: desktop/phone320/landscape/tablet768/reflow лишеlight, iphone390/tabletlandscape лишеdark. Нові14 mandatory geometry IDs коректно заблокували acceptance на відсутньому desktop-dark case, хоча фактично виконані checks пройшли. Це не product failure і не повна світла/темна cross-product перевірка.
План: реально виконувати обидві теми на кожному профілі (14 combinations на engine), зберегти14 required IDs, унікальні screenshot/check names і один Park контроль. Не видаляти required case заради PASS. Старий7-combination attempt зберегти. Новий final inventory і перезапуск stale suites обовʼязкові.

## ASTRA-H05 · harness unhandled promise (before edit)
- Додатковий teachers/WebKit attempt завершився аварійно після двох checks: waitForResponse(POST bookings) відхилився через12s, поки код ще очікував click. Promise не мав rejection handler до наступного await; Node завершив процес замість штатного FAIL case.
- Evidence: final/attempt-2026-10-14T18-47-41-824Z-teachers-webkit-e51797/run.log. Повтор без зміни source на третьому owned cluster пройшов той самий create case; первинна причина затримки не встановлена, product fix не заявляється.
- План: Promise.all для response+click у цьому case, зі збереженням12s timeout, status200 та SQL assertions. Це виправлення достовірності harness, а не перетворення timeout на PASS. Повторний timeout має стати збереженим FAIL із ненульовим exit.
- Наслідок: новий final inventory; усі stale записи зберегти, завершальну матрицю повторити на ньому.


## ASTRA-H05 follow-up / H06 terminal navigation (before edit)
Другий WebKit attempt пройшов18 checks і зупинився на такій самій необробленій waitForResponse promise у createCloseLesson. Також зафіксовано2 pageerrors незавершеного refreshCreatedBookingTimelineSnapshot після create, коли тест одразу робив page.goto. Proof: final/attempt-2026-10-14T18-50-50-904Z-teachers-webkit-e5f6d2.
План: застосувати Promise.all до чотирьох shared write helpers; чекати terminal runtime/network перед helper navigation та після успішного create. Додати synthetic form diagnostics у catch перед context close, щоб наступний timeout мав фактичні validity/disabled/error дані. Не збільшувати timeout, не прибирати pageerror assertion, не додавати API repair.

## ASTRA-H06 follow-up (before edit)
R5 teachers/WebKit виконав усі29 functional checks PASS, але strict page-errors відхилив2 timer unload rejections. Початкова pageFor groups prerequisite чекала лише довідник груп, тому короткий case міг навігувати до timer hydration. Додається той самий waitTeacherRuntimeReads після початкового groups-ready і до action; pageerror assertion залишається порожнім масивом, без whitelist. Evidence: attempt-2026-10-14T18-55-36-940Z-teachers-webkit-0680bd.


## ASTRA-04 / H07 · P2 · accessibility product defect + measurement defect (before edit)
- Симптом: date input boundaries у groups/journal/reports/editor візуально бліді. Очікування: rendered boundary contrast>=3:1 з урахуванням alpha й поверхні.
- Computed CSS probe (COMPONENT, file origin, JS disabled): light rgba(14,165,134,0.35) on white; dark rgba(32,214,176,0.35) on rgb(17,24,39). Proof boundary-style-probe.json; screenshot desktop-light-reports і desktop-dark-groups особисто переглянуто раніше.
- Root cause product: пізніші global date rules з important перекривають education solid border. Root cause harness: rgb helper відкидав alpha; input-boundaries gate порівнював непрозорі RGB.
- План: спочатку compositor у responsive capture і actual-app reproduction; потім scoped date border #64748b important, як у чинних education controls. Не зменшувати threshold, не змінювати глобальний Park date style.
- Verification: actual-app before FAIL з rendered ratios; той самий check після fix,7profiles×2themes×2engines; npm/full source-bound matrix на фінальному коді.

ASTRA-04 actual-app reproduction: corrected capture отримав1.46:1 на white замість>=3 для educationMemberStart/End, educationAttendanceDate, educationReportFrom/To. Exact proof: contrast-before/attempt-2026-10-14T19-11-02-227Z-responsive-chromium-27c86e/artifacts/final-chromium-2026-10-14T19-11-11-455Z/verification.json. Перед правкою CSS вже є5 strict input-boundaries FAIL. Groups/reports frames особисто переглянуто. Це підтверджений UI defect, не тільки component inference.

ASTRA-04 follow-up before edit: corrected compositor також знайшов bookingTime у dark editor: conservative gradient minimum2.94:1 against exterior, хоча interior contrast проходив. Chromium/WebKit desktop-dark date-edit/edit/edit-save checks FAIL, proof final/attempt-2026-10-14T19-13-01-625Z-responsive-chromium-4729c8. Інші date borders після solid fix проходять. Додається тільки dark education bookingTime border #94a3b8 (чинний slate token family); measurement threshold не змінюється.

## ASTRA-H06 final pending-preflight boundary (before edit)
R8 teachers/WebKit пройшов29 functional cases, але page-errors містив1 unload rejection із validateBookingTimeChangePreflight, не timer. Existing continuous journey helper уже чекає bookingTimePreflightState().status!='checking'; teachers helper не враховував цей terminal state. Evidence: final/attempt-2026-10-14T19-17-33-543Z-teachers-webkit-6e6443. План: використати той самий predicate у waitTeacherRuntimeReads і перед shared clickResponse; не whitelist pageerror, не sleep, не послаблювати checks. First-group submit також використовує shared helper.
## ASTRA-E01 — збережені final-r9 intermittent failures (діагностика)
- teachers/WebKit attempt-2026-10-14T19-23-57-549Z-teachers-webkit-944dda: create response timeout, valid form, enabled submit, dependent cases failed. Passive probe activation-diagnostic-r9e.log уточнив: locator.click 12s чекав element stable; mousedown/click/submit для create не відбулися. Успішний edit у тому самому probe мав trusted click+submit. Це не HTTP/server rejection і не підтвердження product fix.
- Діагностичні attempts activation-diagnostic зупинено після потрібних спостережень; усі їхні logs/FAIL збережені. Зовнішні passive wrappers не входять у final acceptance.
- journey/Chromium attempt-2026-10-14T19-38-00-369Z-journey-chromium-27cec0: після створення представника Requests did not settle before navigation; наступні cases BLOCKED_DEPENDENCY, без API repair.
- План перевірки: після завершення конкурентних browser suites повторити незмінені mandatory assertions/timeouts послідовно. Вплив конкуренції є гіпотезою; PASS повтору сам по собі не доводить її й не стирає первинні FAIL.
## ASTRA-H08 — WebKit offscreen Save actionability (before edit)
- Symptom: teachers/WebKit create waits12s for POST without sending any request. The same source fails with no concurrent browser suites, so concurrency is not the established cause.
- Passive geometry proof: output/education-ready/astra/geometry-diagnostic-r9.log. After duration input focus, submit rect alternates y2277.59375/y2278.59375 at12 consecutive animation frames; width204.328125/height44 remain equal. Button is below viewport, form scrollTop~928, no active button animation/transform. The successful edit rect stays constant. click log: element is not stable; no trusted mousedown/click/submit.
- Expected test method: use ordinary scrolling to bring the offscreen Save into view, then normal trusted click, unchanged response/status/SQL checks and12s timeout. No force click, DOM submit, API repair or disabled pageerror gate.
- Plan: test a passive wrapper with real mouse wheel over bookingForm and a viewport-containment predicate. If it proves normal click/submit and durable create, add the same explicit visible-scroll step to the shared booking submit helper. This is a harness actionability correction; no claim that the browser's1px scroll jitter itself was fixed in product CSS.
## ASTRA-01 follow-up — inactive current assignment (before edit)
Code review found a remaining duplicate-label path: active teacher options use duplicate counts, but a current inactive teacher is appended separately. With one active namesake, both labels remain identical. Group fallback uses teacher_name directly; lesson fallback uses teacherName directly and clones it after loading. Expected: current inactive assignment stays selectable/editable and visibly distinguishable; canonical teacherName remains unchanged. Add actual-app UI reproduction that assigns a same-name teacher, deactivates through manager, reopens group/lesson, captures both option lists and screenshots, then asserts distinct labels. Product fix will be confined to fallback display labels; no membership/permission/SQL changes.
ASTRA01 inactive actual-app reproduction confirmed before fix: inactive-before/attempt-2026-10-14T19-55-04-109Z-teachers-chromium-8e0ca3. Required case FAIL1!=2; both groupChoices/lessonChoices IDs108/109 had identical visible labels and canonical names. Group screenshot personally viewed. Lesson baseline screenshot was taken mid-animation and is diagnostic only; final new-case screenshot waits existing finite animation completion. Fix: current inactive fallback label includes ID in group, initial lesson fallback and retained selected-option clone; dataset.staffName remains canonical. Final freeze r11; all earlier inventories stale.
