# Політика одночасної роботи на двох професіях

| Поле | Значення |
| --- | --- |
| Статус | Активна production policy v1; implementation і migration 299 розгорнуті |
| Версія політики | `simultaneous-profession-pay-v1` |
| Дата фіксації проєкту | `2026-07-18` |
| Production impact | yes |
| `effectiveFrom` | `2026-07-18` за `record_date` у `Europe/Kyiv` |

## 1. Мета

Один працівник може фізично перебувати на роботі один проміжок часу, одночасно виконувати обов'язки
двох професій і отримувати:

1. основну оплату за основною професією;
2. окрему додаткову оплату за явно призначену оплачувану професію.

Система не повинна через це подвоювати фізично відпрацьований час, кількість робочих днів,
attendance KPI, запізнення, ранні виходи або понаднормові години.

Ця політика визначає чинну production-семантику додаткових ролей від `2026-07-18`.
`additionalProfessionKeys` зберігає інформаційну backward-compatible семантику і саме по собі не
створює окремої оплати. Окреме нарахування виникає лише для explicit `additionalRoles` із
`compensationMode = paid_hourly`, чинною policy version і валідним attendance snapshot.

## 2. Канонічні поняття

| Поняття | Визначення |
| --- | --- |
| `presenceMinutes` | Сирий інтервал між фактичними `clock_in` і `clock_out`. У реалізації може обчислюватися як `clockIntervalMinutes`, але сам по собі не є сумою до оплати. |
| `physicalWorkedMinutes` (`physicalMinutes` у коротких звітах) | Фактично відпрацьовані хвилини після застосування чинних правил плану, прогалин і неоплачуваної перерви. Рахуються один раз незалежно від кількості професій. |
| `baseRoleMinutes` | Частина `physicalMinutes`, віднесена до основної професії відповідних сегментів. |
| `additionalRoleMinutes` | Фактичні хвилини, протягом яких діяло явне призначення додаткової оплачуваної професії. Можуть перетинатися з `baseRoleMinutes`. |
| `compensationMinutes` | Оплачувані хвилини конкретної професії: основні або додаткові. Сума таких хвилин може перевищувати `physicalMinutes`. |

Обов'язкові інваріанти:

- `physicalWorkedMinutes` ніколи не збільшується через додаткову професію;
- один attendance-запис для `record_date` рахується максимум як один робочий день, навіть якщо
  overnight-зміна перетинає межу цивільних календарних дат;
- `baseRoleMinutes` і `additionalRoleMinutes` можуть перетинатися в часі, але жоден із них не додається повторно до `physicalWorkedMinutes`;
- додаткова роль не змінює attendance-статуси;
- payroll і звіти повинні окремо показувати фізичні та компенсаційні хвилини.

## 3. MVP-модель графіка

- Один фізичний сегмент має одну основну професію.
- На один момент часу і в одному фізичному сегменті може діяти максимум одна додаткова оплачувана
  професія. Різні непересічні сегменти дня можуть мати різні paid-ролі.
- Неоплачуваних інформаційних ролей може бути декілька.
- Фізичні сегменти одного працівника не можуть перетинатися.
- Додаткова оплачувана професія діє всередині фізичного сегмента, тому її перетин з основною
  професією є очікуваним, а не конфліктом графіка.
- Якщо додаткова професія починається або завершується всередині основного блоку, MVP розділяє
  фізичний план по часовій межі ролі.
- Після split:
  - paid-роль діє протягом усього відповідного child segment;
  - envelope і загальна тривалість фізичного плану не змінюються;
  - загальна сума `break_minutes` не змінюється;
  - HR явно обирає, який child segment успадковує перерву; система не вгадує це автоматично;
  - загальна кількість сегментів не може перевищити чинний ліміт `12`, інакше вся операція
    блокується.
- Основна і додаткова професії в одному сегменті не можуть мати однаковий ключ.
- Day-level `primaryProfessionKey` повинен залишатися основною професією хоча б одного фізичного
  сегмента. Paid additional role не може бути єдиною підставою для day primary.
- Працівник повинен бути active; професія — active; нормалізований `staff_role_assignments` для
  працівника і професії повинен мати `status = active` та `admission_status = approved`.
- Legacy `role_type`/`secondary_professions` без approved assignment недостатньо для нової paid-ролі.
- Наявні правила одного overnight-сегмента і заборони неоднозначного multi-segment overnight-плану
  не змінюються цією політикою.
- У overnight MVP paid-роль може охоплювати лише весь єдиний overnight-сегмент. Часткова paid-роль,
  що потребує split overnight-сегмента, блокується до впровадження explicit day-offset model.

Приклад внутрішнього поділу плану:

| Фізичний сегмент | Основна професія | Додаткова оплачувана професія |
| --- | --- | --- |
| 11:00–11:30 | Гардеробник | — |
| 11:30–20:00 | Гардеробник | Господарочка залу |

## 4. Умови виникнення додаткової оплати

Додаткова оплата виникає лише тоді, коли одночасно виконані всі умови:

1. глобальне `effectiveFrom` встановлене;
2. attendance work date (`record_date` у `Europe/Kyiv`) не раніше `effectiveFrom`;
3. роль явно збережена як `paid_hourly`;
4. роль належить до політики `simultaneous-profession-pay-v1`;
5. працівник має чинний допуск до професії;
6. для пари працівник/професія/дата визначена професійна погодинна ставка `> 0`;
7. attendance підтверджує фактичні хвилини в межах відповідного сегмента.

Для майбутніх policy versions значення `effectiveFrom = NULL` означає fail-closed стан: система не
має права створювати нові автоматичні нарахування за одночасну професію. Активна v1 має
`effectiveFrom = 2026-07-18`.

`effectiveFrom` зберігається у канонічному versioned payroll-policy store разом із policy version
та audit metadata. Це не UI-only стан і не неверсійована environment-змінна. Після появи першого
plan snapshot версія політики та її `effectiveFrom` не змінюються in-place: наступна зміна створює
нову версію з новою датою.

Schedule single-save, bulk і copy writers fail closed:

- при `effectiveFrom = NULL` вони відхиляють `paid_hourly` і не зберігають приховану paid-ознаку;
- вони відхиляють paid-роль для target `shift_date < effectiveFrom`;
- unpaid-роль копіюється як unpaid;
- paid-роль копіюється лише на target date `>= effectiveFrom` після повторної перевірки допуску,
  ставки та ліміту ролей;
- якщо хоча б один target не проходить перевірку, вся транзакція блокується без мовчазного downgrade
  paid → unpaid.

Migration 299 активувала тільки policy `simultaneous-profession-pay-v1` з
`effectiveFrom = 2026-07-18` і multiplier `1.0`. Activation не змінювала legacy
`additionalProfessionKeys`, наявні unpaid-ролі, attendance snapshots, payroll reports або finance
history. Дата `2026-07-22` залишається лише канонічною датою регресійного сценарію.

`effectiveFrom` порівнюється саме з `record_date` у `Europe/Kyiv`, а не з UTC timestamp, датою
`clock_out`, календарною датою post-midnight частини сегмента, датою створення ролі або датою
генерації payroll.

## 5. Формула додаткової оплати

Для MVP:

```text
payMultiplier = 1.0

additionalAmount =
    roundMoney(
        additionalRoleMinutes
        / 60
        * resolvedAdditionalProfessionHourlyRate
        * payMultiplier
    )
```

Правила формули:

- хвилини не округлюються до повних або десятих годин перед множенням;
- сума округлюється один раз на payroll-line чинним правилом `roundMoney`;
- MVP зберігає чинне `roundMoney = Math.round` до цілої гривні; перехід на копійки є окремою
  фінансовою зміною;
- перед округленням хвилини агрегуються за
  `staff + record_date + profession + profileVersion/rate + multiplier`;
- додаткова роль завжди створює окремий тип нарахування;
- канонічний `lineType = simultaneous_additional`, а сума потрапляє в `summary.additional`,
  збільшує gross earnings і далі проходить через чинні deductions/advances до net;
- додаткова роль не змінює формулу основної зарплати;
- multiplier у MVP зафіксований як `1.0` і не редагується довільно в UI.

### Джерело ставки

`resolvedAdditionalProfessionHourlyRate` — професійно-специфічна ставка, застосовна до працівника
на дату роботи. Дозволений порядок resolution:

1. active temporary hourly payroll-profile assignment для працівника і професії;
2. active explicit hourly payroll-profile assignment для працівника і професії;
3. active default hourly profile цієї професії;
4. legacy `staff_profession_rates.hourly_rate` для точної пари `staff_id + profession_key`.

Якщо перше знайдене джерело з вищим пріоритетом має `rate_unit = day/month`, ставку `<= 0` або
невалідну effective-date версію, resolution завершується fail-closed. Система не переходить
мовчки до default/legacy джерела, щоб обійти некоректне вище призначення.

Профіль із `rate_unit = day` або `rate_unit = month` не конвертується в погодинну ставку. Для
додаткової оплати чинний загальний rate resolver використовується лише через strict-wrapper, який
забороняє його fallback на `payroll_scheme` і `staff.hourly_rate`.

Для додаткової професії заборонені:

- fallback на загальну `staff.hourly_rate`;
- fallback на ставку основної професії;
- автоматичне перетворення денної або місячної ставки на погодинну;
- ставка `0` або відсутня ставка без явного ручного фінансового рішення.

Якщо ставку неможливо визначити, графік не повинен мовчки створювати нульову оплату. До закриття
payroll запис має отримати blocking reconciliation error.

## 6. Поведінка основних схем зарплати

| Основна схема | Основна оплата | Додаткова професія |
| --- | --- | --- |
| `hourly` | Чинний base payroll result не змінюється | Окрема погодинна line за фактичні `additionalRoleMinutes` |
| `per_shift` | Чинний base payroll result не змінюється | Окрема snapshot hourly top-up line за фактичні `additionalRoleMinutes` |
| `monthly_fixed` | Чинний base payroll result не змінюється | Окрема snapshot hourly top-up line за фактичні `additionalRoleMinutes` |
| `hybrid` | Чинний base payroll result не змінюється | Автоматична подвійна оплата заблокована до окремої формули |

Автоматична одночасна доплата v1 підтримується для `hourly`, `per_shift` і `monthly_fixed` лише як
окрема погодинна top-up line з immutable snapshot ставки додаткової професії. Вона не конвертує
денну або місячну базову ставку в погодинну. Для `hybrid`, `percent` і `manual` система повинна
блокувати автоматичне призначення `paid_hourly` або вимагати окреме аудоване ручне коригування.

Режим attendance settlement `scheduled_shift` може зберігати чинну базову денну або місячну
виплату, але не має права створювати планові додаткові хвилини. `additionalRoleMinutes` завжди
визначаються фактичним перетином attendance-інтервалу з інтервалом paid-ролі.
`physicalWorkedMinutes` також походить із фактичного інтервалу і не переймає можливе планове
значення legacy `total_worked_minutes` у scheduled settlement.

## 7. Запізнення та ранній вихід

Фактичні хвилини кожної професії визначаються перетином фактичного attendance-інтервалу з інтервалом
відповідної ролі.

- Запізнення зменшує лише ті ролі, які мали бути активними у пропущений час.
- Ранній вихід зменшує лише ті ролі, які мали бути активними після фактичного виходу.
- Якщо запізнення відбулося до початку додаткової ролі, воно зменшує основну роль, але не додаткову.
- Attendance-факти late/early залишаються одними на день і не дублюються по професіях.
- Чинні grace thresholds attendance-звітів не змінюються цією політикою.
- Grace threshold впливає лише на звітний факт і не повертає пропущені хвилини ні до погодинних
  `baseRoleMinutes`, ні до `additionalRoleMinutes`.
- Основна фіксована оплата `per_shift` або `monthly_fixed` залишається під правилами своєї схеми;
  це не дозволяє додатковій ролі перейти з фактичних на планові хвилини.

## 8. Неоплачувана перерва

`break_minutes` належить фізичному сегменту. У поточному MVP немає точного вікна перерви, тому
зберігається детермінована політика `segment_minutes_mvp`.

- У `physicalWorkedMinutes` перерва сегмента віднімається один раз.
- У compensation allocation кожної професії, активної в цьому сегменті, та сама перерва зменшує
  оплачувані хвилини, тому що під час перерви не виконується жодна з цих професій.
- Це не є подвійним відніманням фізичного часу: фізичний підсумок зменшується один раз, а окремо
  зменшується база оплати кожної активної професії.
- Attendance/payroll не повинні повторно віднімати перерву після того, як allocation уже містить
  хвилини після перерви.
- Якщо paid-роль починається всередині початкового блоку, план спочатку розділяється по межі ролі,
  а `break_minutes` належить рівно одному отриманому фізичному сегменту. Без такого поділу MVP не
  може достовірно визначити, чи належить приблизна перерва до додаткової ролі.

До впровадження точних break windows для кожної активної ролі використовується:

```text
actualRoleMinutes =
    max(
        0,
        overlap(actualInterval, roleSegment)
        - min(overlap(actualInterval, roleSegment), segmentBreakMinutes)
    )
```

Якщо продукту потрібне точне визначення, чи потрапила часткова присутність у перерву, це окрема
additive time-model migration і не входить у цю політику.

## 9. Понаднормові та прогалини плану

- Чинне визначення attendance overtime і його grace threshold не змінюються.
- Час до першого або після останнього фізичного сегмента за замовчуванням відноситься лише до
  primary profession дня для reconciliation, але це призначення саме по собі не створює право
  на payroll-виплату.
- Додаткова роль не успадковує overtime автоматично.
- Додаткове overtime-нарахування можливе лише через окреме явне призначення з profession key,
  інтервалом, ставкою, multiplier і audit trail.
- Автоматичне додаткове overtime-призначення не входить у MVP.
- Час усередині прогалини між фізичними сегментами не є оплачуваним і не стає overtime.
- Чинний overtime multiplier основної погодинної професії не змінюється цією політикою.
- `allocation overtime` поза envelope не перетворюється автоматично на додаткову зарплату:
  payable overtime має походити з погодженого attendance fact або аудованої корекції.

Для звірки часу:

```text
physicalWorkedMinutes =
    uniqueNetInPlanSegmentMinutes
    + allocationOvertimeMinutes
```

`baseRoleMinutes` містить лише in-plan хвилини основних професій. Фізичний час поза envelope
рахується один раз в окремій overtime allocation. Його payroll-компенсація визначається окремо
і не виникає автоматично лише через наявність `allocationOvertimeMinutes`.

## 10. Snapshot і ненадійні attendance-дані

- При першому `clock_in` фіксується immutable plan snapshot: фізичні сегменти, перерви, основні
  професії, paid-ролі, policy version, застосовний `effectiveFrom`, а також resolved rate/profile
  version для paid-ролі на `record_date`.
- Редагування графіка між `clock_in` і `clock_out` не змінює зафіксований plan snapshot.
- Редагування або backdated-версія ставки між `clock_in` і `clock_out` не змінює resolved rate,
  зафіксований у plan snapshot.
- При першому `clock_out` розрахунок використовує лише plan snapshot першого `clock_in`, а не
  поточний графік.
- У транзакції `clock_out` фіксується result snapshot: `physicalWorkedMinutes`, base/additional
  allocations, multiplier, rate/profile version із plan snapshot і розрахована грошова сума.
- Сума заморожується атомарно під час першого `clock_out`; payroll пізніше споживає цей snapshot
  і не виконує повторний незалежний rate resolution.
- Наступні read/payroll операції використовують snapshot, а не актуальний на момент читання графік.
- Manual correction використовує зафіксований plan snapshot і створює нову версію result snapshot
  із `before`, `after`, причиною та автором.
- Переведення correction на інший план є окремою явною аудованою дією `plan rebase`; воно не може
  відбутися як побічний ефект звичайного виправлення часу.
- Зміна rate/profile version у correction є окремою явною аудованою дією `rate rebase`.
- Manual correction не може створити paid allocation для `record_date < effectiveFrom` або
  перетворити legacy `additionalProfessionKeys` на paid. Таке фінансове виправлення проходить лише
  через окремий salary adjustment/reversal flow.
- Поточний `proportional_fallback` не має права автоматично створювати `additionalRoleMinutes`.
  Ненадійний clock interval переводить додаткову оплату в manual review до аудованої корекції.

## 11. Старі дані та історична незмінність

- Усі `additionalProfessionKeys` і рядки `hr_shift_segment_roles`, що існують на момент migration,
  отримують `unpaid` незалежно від дати їхнього графіка, наявності ставки або майбутнього
  `effectiveFrom`.
- Міграція не має права автоматично backfill-ити їх як оплачувані.
- Наявність професійної ставки сама по собі не перетворює стару роль на paid.
- Повторне відкриття, звичайне збереження або copy legacy-плану не конвертує роль у paid.
- Paid-стан виникає лише після окремої явної дії користувача після активації політики для допустимої
  target date.
- Графік до `effectiveFrom` не створює додаткової оплати навіть після повторного відкриття.
- Зміна графіка після clock-out не повинна непомітно змінювати зафіксовані compensation allocations.
- Manual correction повинна створювати новий аудований snapshot із причиною зміни.
- `approved` і `paid` payroll reports є незмінними.
- Виправлення закритого періоду виконується окремим salary adjustment/reversal flow, а не
  переписуванням історичного графіка.
- Attendance до `effectiveFrom` і legacy unpaid-ролі без compensation snapshot проходять чинну
  base-only логіку без blocking warning і не отримують ретроактивну доплату.
- Missing compensation snapshot є blocking error лише для `record_date >= effectiveFrom`, де
  існувала явна `paid_hourly` роль.

## 12. Приклади

У прикладах:

- ставка гардеробника — `120 грн/год`;
- ставка господарочки залу — `100 грн/год`;
- `payMultiplier = 1.0`;
- основна схема — `hourly`.

### 12.1. Базовий сценарій без перерви

План:

- Гардеробник: 11:00–20:00;
- Господарочка залу як додаткова paid-роль: 11:30–20:00;
- фактична присутність: 11:00–20:00.

| Показник | Хвилини | Розрахунок | Сума |
| --- | ---: | --- | ---: |
| `physicalWorkedMinutes` (`physicalMinutes`) | 540 | рахується один раз | — |
| `baseRoleMinutes` | 540 | 540 / 60 × 120 | 1080 грн |
| `additionalRoleMinutes` | 510 | 510 / 60 × 100 × 1.0 | 850 грн |
| Разом | — | 1080 + 850 | 1930 грн |

Payroll і attendance повинні показувати `9` фізичних годин, а не `17.5`. Компенсаційні години
професій можуть окремо показувати `9` і `8.5`.

### 12.2. Запізнення до початку додаткової ролі

Фактична присутність: 11:15–20:00, перерви немає.

| Показник | Значення |
| --- | ---: |
| `physicalWorkedMinutes` | 525 |
| Гардеробник | 525 хв / 1050 грн |
| Господарочка залу | 510 хв / 850 грн |
| Разом | 1900 грн |

П'ятнадцять пропущених хвилин зменшують лише основну роль, тому що додаткова роль ще не почалася.

### 12.3. Ранній вихід під час обох ролей

Фактична присутність: 11:00–19:00, перерви немає.

| Показник | Значення |
| --- | ---: |
| `physicalWorkedMinutes` | 480 |
| Гардеробник | 480 хв / 960 грн |
| Господарочка залу | 450 хв / 750 грн |
| Разом | 1710 грн |

### 12.4. Тридцятихвилинна неоплачувана перерва

Внутрішній план:

- 11:00–11:30 — гардеробник, перерва `0`;
- 11:30–20:00 — гардеробник + господарочка залу, перерва `30`.

| Показник | Значення |
| --- | ---: |
| `presenceMinutes` | 540 |
| `physicalWorkedMinutes` | 510 |
| Гардеробник | 510 хв / 1020 грн |
| Господарочка залу | 480 хв / 800 грн |
| Разом | 1820 грн |

Перерва один раз зменшує фізичний підсумок і зменшує compensation minutes обох професій,
активних у сегменті з перервою.

### 12.5. Стара інформаційна роль

Історичний сегмент має `additionalProfessionKeys = ["hall_keeper"]`, але не має явного
`compensationMode = "paid_hourly"`.

Очікування:

- додаткові хвилини: `0`;
- додаткова сума: `0`;
- автоматичного backfill немає;
- payroll може показати роль як інформаційну, але не як нарахування.

## 13. Вимоги до звітів і звірки

Payroll breakdown і експорт повинні окремо показувати:

- `physical_minutes` / `physical_hours`;
- `base_role_minutes` / `base_role_hours`;
- `additional_role_minutes` / `additional_role_hours`;
- додаткову професію;
- ставку та її джерело;
- multiplier;
- додаткову суму;
- policy version;
- attendance/segment reference.

Система повинна пояснювати, що сума годин професій може перевищувати фізичні години через одночасну
роботу. Це допустимо. Подвоєння `physicalWorkedMinutes`, робочих днів або attendance KPI — недопустиме.

Payroll commit повинен блокуватися, якщо:

- paid-роль не має ставки;
- схема не підтримується MVP;
- відсутній обов'язковий snapshot;
- одна хвилина додаткової ролі створена більше одного разу;
- policy/effective date неможливо підтвердити;
- на один момент призначено більше однієї додаткової paid-ролі.

## 14. Стан документації після релізу

Після activation operational documentation і regression tests повинні одночасно описувати чинний
контракт:

- `docs/HR_SHIFT_SEGMENTS_OPERATIONS.md`;
- `docs/HR_SHIFT_SEGMENTS_TIME_MODEL_PROPOSAL.md`;
- attendance/payroll operational docs;
- focused regression tests для `540` physical minutes і `510` additional paid minutes.

## 15. Pre-activation read-only production audit — історичний snapshot від 2026-07-18

Цей розділ фіксує стан **до** розгортання migrations 297–299 і не описує поточний production.
Історичні цифри нижче навмисно не редагуються. Актуальний post-activation стан зафіксовано в
`docs/PAYROLL_POST_ACTIVATION_RECONCILIATION_2026-07-18.md`.

Аудит виконано в PostgreSQL-транзакції `READ ONLY`. ПІБ, ставки, суми та ідентифікатори не
виводилися; schedule, attendance і payroll не змінювалися.

| Перевірка | Результат |
| --- | --- |
| Наявні додаткові ролі | 16 role rows у 16 фізичних сегментах/змінах, 3 працівники |
| Діапазон дат | `2026-07-14` — `2026-07-31`; 4 rows до `2026-07-18`, 12 rows від цієї дати |
| Допуск ролей | 16/16 мають active assignment; 9/16 мають одночасно active + approved assignment |
| Явна позитивна погодинна ставка додаткової професії | 0/16; усі 16 є reconciliation blockers |
| Пов'язаний attendance | 2 records у `2026-07` |
| Payroll для `2026-07` | reports відсутні |
| Інші незакриті payroll reports | `2026-05`: 64 draft reports, period lock відсутній |
| Нова compensation/profile schema у production | `payroll_profiles`, `staff_payroll_profile_assignments` і `hr_compensation_policies` відсутні |
| Активна схема 3 пов'язаних працівників | legacy fallback; явної активної `payroll_schemes` немає |

Історичний висновок на момент цього pre-activation snapshot: автоматична activation була
небезпечною без погодженого `effectiveFrom`, професійних погодинних ставок, завершених допусків 7
role rows і перевіреного payroll preview. Історичні 4 rows до потенційної дати старту не можна
перераховувати автоматично.

## 15.1 Non-hourly simultaneous pay decision

Production impact: yes.

Рішення станом на `2026-07-18`: `per_shift` і `monthly_fixed` підтримують simultaneous additional
pay тільки як окрему snapshot hourly top-up line з formula version
`simultaneous-profession-pay-v1`. `hybrid` залишається fail-closed і повинен створювати
reconciliation blocker `PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED`, а не суму `0` і не
вигаданий fallback.

| Payroll scheme | Погоджене рішення v1 | Що явно не робимо | effectiveFrom |
| --- | --- | --- | --- |
| `per_shift` | Додаткова роль оплачується пропорційно хвилинам за immutable hourly snapshot ставки додаткової професії | Не рахуємо окрему повну зміну, не ділимо base day rate і не створюємо фіксовану доплату | `2026-07-18` |
| `monthly_fixed` | Додаткова роль створює окрему погодинну top-up line за immutable hourly snapshot ставки додаткової професії | Не включаємо роль у місячну ставку і не створюємо monthly allowance | `2026-07-18` |
| `hybrid` | Залишити fail-closed для paid additional role | Не дублюємо base-компонент і не обираємо пріоритет між компонентами без окремої формули | Немає; потрібне окреме policy-рішення |

Для всіх non-hourly схем фізичні факти залишаються одинарними:

- `actualMinutes`, `hoursWorked` і `daysWorked` не збільшуються через paid additional role;
- break, запізнення і ранній вихід зменшують фізичні хвилини інтервалу та відповідні
  `additionalRoleMinutes`;
- overtime не дублюється і до окремого рішення лишається один раз на основній ролі дня, без
  додаткового overtime multiplier для simultaneous line;
- missing immutable hourly snapshot ставки додаткової професії є blocker-ом, а не ставкою `0`;
- preview може показати чинний base payroll result, але generation/commit має блокуватися, якщо
  є unsupported paid additional role.

Acceptance-приклад для `540` physical minutes / `510` additional paid minutes:

```text
physicalMinutes = 540
baseRoleMinutes = 540
additionalRoleMinutes = 510
additionalHourlyRate = 200

per_shift:
  baseAmount = 900
  additionalAmount = 510 / 60 * 200 * 1 = 1700
  totalAmount = 2600

monthly_fixed:
  baseAmount = 30000
  additionalAmount = 510 / 60 * 200 * 1 = 1700
  totalAmount = 31700

hybrid:
  additionalAmount = blocked by PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED
  payrollGeneration = blocked until a formula version is explicitly approved
```

Нова non-hourly formula для `hybrid` може з'явитися лише після окремого письмового рішення з
формулою, числовим прикладом, `effectiveFrom` і правилом retroactivity.

## 16. Acceptance contract

Чинна реалізація для сценарію 11:00–20:00 / 11:30–20:00 без перерви повинна давати:

```text
physicalMinutes = 540
baseRoleMinutes = 540
additionalRoleMinutes = 510
additionalAmount = 510 / 60 × resolvedAdditionalProfessionHourlyRate × 1.0
```

Task 1 погоджує цей приклад як `9` фізичних годин, `9` годин оплати Гардеробника та `8` годин
`30` хвилин оплати Господарочки залу за її власною професійною погодинною ставкою.

Також погоджено:

1. `payMultiplier = 1.0`;
2. автоматичну simultaneous top-up оплату для `hourly`, `per_shift` і `monthly_fixed` через
   immutable hourly snapshot ставки додаткової професії;
3. blocker замість ставки `0` або fallback на ставку основної професії;
4. overtime один раз за основною роллю дня;
5. відсутність автоматичного ретроактивного перерахунку.

Після activation залишаються обов'язковими operational rules:

1. paid-роль не зберігається без чинної професійної погодинної ставки;
2. v1 застосовується лише для `record_date >= 2026-07-18`;
3. `hybrid`, `percent` і `manual` не отримують додаткове нарахування без окремої погодженої
   формули.
