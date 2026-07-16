# Контракт даних і шаблонів HR-документів v27

Статус: **зафіксовано для реалізації**

Версія контракту: `v27.1`

Дата фіксації: `2026-07-16`

Цей документ є джерелом правди для генерації двох PDF у CRM:

- `arrival_inout` — «Лист приходу / уходу працівників»;
- `month_grid` — «Місячний табель-відмічалка».

## 1. Еталонні файли

| Template ID | Файл | SHA-256 | Сторінки | Формат |
| --- | --- | --- | ---: | --- |
| `arrival_inout_v27` | `event_genix_series_v27_arrival_inout_print.pdf` | `D5EAA28FA20EBD0EE85746B77B3DC26F7B72A8DD0DA78251762372F34D26C7F1` | 2 | A4 portrait, `595.2 × 841.92 pt` |
| `month_grid_v27` | `event_genix_series_v27_month_grid_print.pdf` | `1FCB67736ACDCAD2BB097F9F0A7117632D148D443B8A1C1C6A5B875E92BC6391` | 3 | A4 landscape, `841.92 × 595.2 pt` |

Еталони є растровими PDF: кожна сторінка містить повносторінковий JPEG приблизно 300 dpi, без текстового шару та form fields. Тому критерієм приймання є візуальна відповідність геометрії, кольорів, текстів і пагінації, а не однаковий checksum з еталоном.

## 2. Зафіксовані продуктові рішення

| Питання | Рішення v27 |
| --- | --- |
| Напис «Уход» чи «Вихід» | Preset `Еталон v27` зберігає еталонне слово **«Уход»** у заголовку, підписах і footer. «Вихід» може бути окремим майбутнім мовним preset, але не default v27. |
| Дні 29–31 у коротких місяцях | Сітка завжди має 31 колонку. Неіснуючі дні отримують світло-сірий inactive-фон, без внутрішнього квадрата для позначки. Ширина колонок і тижневі розділювачі не змінюються. |
| Джерело фактичного часу | Canonical source — `hr_time_records.clock_in/clock_out`; compatibility fallback — `staff_checkins`, лише якщо canonical record для identity/date відсутній. |
| Planned shift | Ніколи не друкується як фактичний прихід або вихід. Використовується лише для режиму roster `scheduled_on_date`. |
| Порядок людей | Усередині категорії: `display_name/name` за українською локаллю, потім `staff.id` для стабільності. |
| Дедуплікація | Одна фізична особа друкується один раз у всьому документі, навіть якщо має декілька вибраних професій або декілька legacy staff records. |
| Default roster | `all_eligible`: усі працівники, які відповідають eligibility-фільтру на roster date. |
| Місячний табель | У v27 клітинки залишаються порожніми для ручної відмітки; автоматичне заповнення місячних статусів не входить у цей контракт. |

## 3. Eligibility та roster date

Працівник може потрапити до документа лише за одночасного виконання всіх умов:

```text
staff.is_active = true
staff.hr_pool_status = 'core'
COALESCE(staff.is_freelance, false) = false
staff.termination_date IS NULL OR staff.termination_date > rosterDate
```

`termination_date = rosterDate` означає, що працівник уже не входить до roster на цю дату. Null/порожні legacy-значення нормалізуються так само, як у `scheduleableStaffWhere(...)`.

| Документ | `rosterDate` |
| --- | --- |
| Daily | Обрана користувачем дата документа |
| Monthly | Перший календарний день обраного місяця |

Це snapshot поточного HR-стану, а не повна історична реконструкція складу команди. Значення `is_active`, `hr_pool_status` та `is_freelance` беруться з актуальної HR-картки на момент генерації.

Доступні roster modes:

- `all_eligible` — default; усі eligible працівники;
- `scheduled_on_date` — eligible працівники, що мають on-site planned shift на дату. `remote`, `dayoff`, `vacation` та `sick` не включаються. Planned time не переноситься у фактичні поля.

Для місячного документа v27 використовується лише `all_eligible`.

## 4. Канонічний набір професій

Перед категоризацією CRM будує `professionKeys` як union без повторів:

1. legacy primary `staff.role_type`;
2. усі значення `staff.secondary_professions`;
3. `staff_role_assignments.profession_key`, де `status = 'active'` і `admission_status = 'approved'`.

Якщо normalized assignment позначений `is_primary = true`, він вважається normalized primary і має пріоритет над legacy `role_type` при виборі єдиної друкованої категорії. Pending, suspended, inactive та blocked assignments не дають членства в категорії.

Поточний `/api/hr/today` не є достатнім джерелом для генератора: він не повертає повну множину secondary/assigned professions. Генератор повинен використовувати окремий backend query/service та не повторювати frontend-фільтр.

## 5. Print categories

Print category — стабільна категорія документа, яка може відповідати одній або кільком канонічним професіям. Вузький discriminator за `staff.position` або `staff.excel_department` дозволений лише для legacy-груп, які в еталоні ділять одну канонічну професію.

| Priority | `printCategoryId` | Еталонний label | Profession keys | Додатковий discriminator |
| ---: | --- | --- | --- | --- |
| 10 | `art_director` | Арт-директор | `art_director` | — |
| 20 | `leader` | Керівник | `director`, `vice_director` | — |
| 30 | `bartender` | Бармен | `barista`, `bartender` | position/department містить `бармен` |
| 40 | `wardrobe` | Гардеробниця | `wardrobe` | — |
| 50 | `cleaning` | Прибирання | `cleaner`, `cleaning` | position/department містить `прибиран` |
| 60 | `hall_hostess` | Хозяюшка залу | `cleaning` | position/department містить `хозяюшка залу` |
| 70 | `trampoline` | Батутист | `trampoline_instructor`, `instructor`, `senior_instructor` | position/department містить `батутист` |
| 80 | `animator` | Аніматор | `animator` | — |
| 90 | `tech_director` | Тех-директор | `it_specialist`, `maintenance`, `technician` | position/department містить `тех-директор` або `технічний директор` |
| 100 | `hr` | HR-менеджер | `hr`, `hr_manager` | — |
| 110 | `admin` | Адміністратор | `admin` | — |
| 120 | `accountant` | Бухгалтер | `accountant` | — |
| 130 | `sales_manager` | Менеджер з продажу | `manager` | — |
| 140 | `top_manager` | Топ-менеджер | `senior_manager` | — |
| 150 | `cook` | Кухар | `cook`, `head_cook`, `head_chef` | — |
| 160 | `waiter` | Офіціант | `waiter` | — |
| 170 | `dishwasher` | Мийниця | `dishwasher` | — |
| 180 | `security` | Охоронець | `security`, `maintenance` | position/department містить `охорон` |

Discriminator порівнюється case-insensitive після trim і нормалізації пробілів. Він не замінює profession membership: обидві умови мають виконуватися. Категорії, яких немає в таблиці, додаються після v27-категорій у порядку каталогу `sort_order`, потім `title`, потім `profession_key`.

## 6. Multi-select та вибір єдиної категорії

- Одна вибрана категорія створює PDF тільки з цією секцією.
- Декілька вибраних категорій створюють один PDF із кількома секціями.
- Порожні секції не друкуються.
- Порядок секцій не залежить від порядку кліків користувача; він задається шаблоном документа.

Якщо працівник відповідає кільком вибраним категоріям, owner category визначається так:

1. точний збіг legacy discriminator;
2. категорія, що містить normalized primary assignment;
3. категорія, що містить legacy primary `role_type`;
4. найменший `Priority` у таблиці print categories;
5. стабільний tie-breaker за `printCategoryId`.

Після вибору owner category працівник не може повторитися в іншій секції цього PDF.

## 7. Ідентичність і дедуплікація

`personIdentityKey` визначається у такому порядку:

1. linked `employee_profiles.user_id`, якщо він є;
2. нормалізований base `unique_person_key` без legacy role suffix;
3. `staff.id` як fallback.

Професії всіх records з одним identity key об'єднуються. Representative record обирається за пріоритетом: linked active account, збіг primary profession з owner category, найменший `staff.id`.

Фактичні записи часу також збираються на рівні identity group. Якщо на одну дату є два несумісні canonical records, режим `actual_times` не генерує неоднозначний результат: preflight повертає conflict зі списком staff IDs. Ручний порожній бланк можна сформувати, надрукувавши особу один раз.

## 8. Поля та джерела даних

| Поле документа | Джерело | Правило |
| --- | --- | --- |
| `documentDate` | UI input | Обов'язкове для daily; ISO date, відображення `DD / MM / YYYY` |
| `month`, `year` | UI input | Обов'язкові для monthly |
| `locationShift` | UI input | Optional, single line, до 80 символів |
| `markedBy` | UI input | Optional, single line, до 80 символів |
| `employeeName` | `COALESCE(NULLIF(staff.display_name,''), staff.name)` | Trim, без обрізання літер |
| `professionKeys` | primary + secondary + assignments | Union та нормалізація до canonical keys |
| `printCategory` | mapping цього контракту | Після eligibility і dedupe |
| `arrivalTime` | `hr_time_records.clock_in`; fallback `staff_checkins.check_in` | `HH:mm`, timezone `Europe/Kyiv`; порожньо, якщо невідомо |
| `departureTime` | `hr_time_records.clock_out`; fallback `staff_checkins.check_out` | `HH:mm`, timezone `Europe/Kyiv`; порожньо, якщо невідомо |
| `categoryCount` | Результат категоризації | Кількість унікальних physical persons у секції |
| `pageNumber` | PDF renderer | `P{current}/{total}` після остаточної пагінації |
| `generatedAt` | Server clock | Metadata/audit only; не друкується на v27 |

Editable text whitelist:

| Text key | Default | Max length |
| --- | --- | ---: |
| `title` daily | Лист приходу / уходу працівників | 80 |
| `title` monthly | Місячний табель-відмічалка | 80 |
| `locationLabel` | Локація / зміна | 30 |
| `markedByLabel` | Хто відмічає | 30 |
| `monthlyInstruction` | У клітинці ставимо заштриховку з легенди | 80 |
| `footerNote` | Значення з еталонного footer | 120 |

Дозволені лише plain-text overrides. Raw HTML, CSS, template expressions і перенос рядка не приймаються.

## 9. Daily modes

| Mode | Поведінка |
| --- | --- |
| `manual_blank` | Усі чотири time boxes порожні — точна поведінка еталону. |
| `actual_times` | Відомі `clock_in/clock_out` друкуються у відповідних `HH:MM` boxes; невідомі значення залишаються порожніми. |

Частковий record дозволений: відомий прихід може бути надрукований без виходу. Planned start/end, schedule preference та default workday ніколи не підставляються у time boxes.

## 10. Геометрія та кольори

Усі розміри нижче є baseline preset `Еталон v27`; допуск для renderer QA — до `±0.5 mm` на ключових блоках і до `±1 px` на тонких лініях у 300 dpi render.

### 10.1 Daily, A4 portrait

| Елемент | Baseline |
| --- | --- |
| Horizontal outer margin | `4.7 mm` |
| Header top margin | `3.0 mm` |
| Dark header height | `7.4 mm` |
| Meta row height | `6.2 mm` |
| Category band height | `4.3 mm` |
| Employee row height | `10.9 mm` |
| Time box | `11.3 × 7.4 mm` |
| Stroke | чорний, приблизно `0.5–0.75 pt` |

Header містить logo/brand ліворуч, title по центру, `P{n}/{N}` праворуч. Далі йдуть date, location/shift, marked-by, категорії та employee rows. Zebra `#F9F9F9` починається заново в кожній категорії.

### 10.2 Monthly, A4 landscape

| Елемент | Baseline |
| --- | --- |
| Horizontal outer margin | `4.7 mm` |
| Header top margin | `3.0 mm` |
| Dark header height | `7.9 mm` |
| Meta row height | `5.4 mm` |
| Legend height | `6.9 mm` |
| Name column | `59.8 mm` |
| Day column | `7.35 mm` |
| Day header row | `6.2 mm` |
| Category band | `2.9 mm` |
| Employee row | `7.3 mm` |
| Inner mark square | `4.7 × 4.7 mm` |

Сітка завжди містить 31 day column. Після 7, 14, 21 і 28 дня — посилений вертикальний separator. Легенда: порожньо, diagonal hatch «працював», X «не вийшов», horizontal hatch «вихідний».

### 10.3 Palette

| Token | Color |
| --- | --- |
| `header` | `#212429` |
| `dailyMeta` | `#F0F0F0` |
| `monthlyMeta` | `#F6F6F6` |
| `tableHeader` / `categoryBand` | `#E8E8E8` |
| `zebra` | `#F9F9F9` |
| `paper` | `#FFFFFF` |
| `grid` / `text` | `#000000` |
| `inactiveDay` | `#EEEEEE` |

Друк має залишатися читабельним у grayscale без залежності від кольору.

## 11. Font preset `Еталон v27`

Font family — bundled `Nunito`; renderer повинен embed font у PDF. Сімейство не редагується у v27, щоб результат був стабільним на сервері та принтері.

| Token | Default | Allowed range |
| --- | ---: | ---: |
| `title` | `14 pt / 800` | `12–16 pt` |
| `meta` | `9 pt / 700` | `7–10 pt` |
| `footer` | `5 pt / 600` | `4–6 pt` |
| `dailyEmployee` | `15 pt / 800` | `12–16 pt` |
| `dailyCategory` | `8 pt / 700` | `6.5–9 pt` |
| `dailyTimeLabel` | `10 pt / 700` | `8–11 pt` |
| `monthlyEmployee` | `9 pt / 700` | `7–10 pt` |
| `monthlyCategory` | `6 pt / 700` | `5–7.5 pt` |
| `monthlyDayHeader` | `7 pt / 700` | `6–8 pt` |
| `monthlyLegend` | `6.5 pt / 700` | `5.5–8 pt` |

Крок зміни — `0.5 pt`. Reset повертає всі значення preset. Якщо користувач змінив хоча б один token, UI показує `Еталон v27 — змінено`.

Для довгого ПІБ renderer спочатку зменшує лише цей рядок до мінімуму allowed range. Ellipsis і видалення частини ПІБ заборонені. Якщо текст усе ще не вміщується, preflight блокує генерацію та повертає ПІБ/категорію; користувач може виправити `display_name` або зменшити дозволений font token.

## 12. Порядок секцій і пагінація

Default template order відрізняється для двох документів і повторює еталон.

### Daily order

1. `art_director`
2. `leader`
3. `bartender`
4. `wardrobe`
5. `cleaning`
6. `hall_hostess`
7. `trampoline`
8. `animator`
9. `tech_director`
10. `hr`
11. `admin`
12. `accountant`
13. `sales_manager`
14. `top_manager`
15. `cook`
16. `waiter`
17. `dishwasher`
18. `security`

Еталонний preferred break — перед `hr`: перші дев'ять категорій на сторінці 1, решта на сторінці 2, якщо склад і розміри відповідають еталону.

### Monthly order and preferred pages

1. Page lane 1: `hr`, `accountant`, `top_manager`, `waiter`, `animator`, `tech_director`.
2. Page lane 2: `admin`, `sales_manager`, `cook`, `hall_hostess`, `security`.
3. Page lane 3: `art_director`, `leader`, `bartender`, `wardrobe`, `dishwasher`, `cleaning`, `trampoline`.

Overflow rules:

- category header не залишається останнім рядком сторінки без хоча б одного employee row;
- категорія переноситься цілком, якщо вона вміщується на наступній сторінці;
- якщо одна категорія більша за повну page capacity, вона ділиться між сторінками, а повторний header отримує suffix `— продовження`;
- при subset selection порожні lane/pages видаляються, сторінки перенумеровуються;
- якщо font overrides змінюють capacity, preflight пагінація виконується до побудови footer;
- footer і page counter друкуються на кожній сторінці;
- жодний employee row, time box або day grid не може заходити в footer safe area.

## 13. Preflight і помилки

PDF не генерується, якщо є хоча б одна критична помилка:

- не вибрано жодної категорії;
- selected date/month невалідні;
- неоднозначні actual-time records для одного identity/date;
- ПІБ або category label не вміщується навіть на мінімальному font size;
- після фільтрації немає жодного працівника — UI має запропонувати явно надрукувати порожній шаблон;
- renderer не може завантажити або embed font/logo.

Preflight preview показує: template, mode, date/month, roster mode, вибрані категорії, кількість унікальних людей, кількість сторінок, font preset state та warnings.

## 14. Acceptance criteria

### Data contract

- Eligibility збігається з `scheduleableStaffWhere(...)` для відповідної roster date.
- Profession membership враховує primary, secondary і approved active assignments.
- У PDF немає повторних physical persons.
- Planned times ніколи не з'являються як actual.
- У `actual_times` відомі значення збігаються з canonical attendance у timezone `Europe/Kyiv`.

### Visual contract

- A4 orientation, margins, header/meta/footer, palette і line hierarchy відповідають еталону.
- На складі еталону daily отримує 2 сторінки, monthly — 3.
- Page counter має формат `P1/2`, `P2/2` або `P1/3` … `P3/3`.
- Default texts і `Уход` повністю збігаються з еталоном.
- 31-day month збігається з еталонною сіткою; у короткому місяці зайві колонки inactive, але геометрія незмінна.

### Live-site QA після реалізації

1. Відкрити HR-картки test employees у категоріях «Батутисти» та «Офіціанти».
2. Звірити primary, secondary і normalized assignments.
3. Згенерувати кожну категорію окремо та обидві разом.
4. Переконатися, що counts і names збігаються з HR-картками, а спільна особа надрукована один раз.
5. Для daily перевірити `manual_blank` та `actual_times` на test date з частковим clock record.
6. Перевірити preview і PDF для 28-, 29-, 30- та 31-денного місяця.
7. Надрукувати одну portrait і одну landscape сторінку на цільовому принтері зі scale `100% / Actual size`.

## 15. Межі Task 1

Цей контракт не змінює database schema, API, frontend, PDF renderer, scheduler або printer integration. Реалізація генератора, UI у «Пульсі компанії», автоматичного розкладу та підключення printer є наступними задачами.
