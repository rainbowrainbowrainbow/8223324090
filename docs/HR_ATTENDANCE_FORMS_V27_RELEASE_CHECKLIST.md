# HR attendance forms v27 — physical print and release checklist

Статус: **manual CRM MVP випущено; фізичне приймання відкладено до підключення принтера**

Автоматизовані перевірки цього checklist є release gate для manual CRM MVP двох документів. Розділи фізичного друку та owner sign-off є gate лише для майбутнього print-agent/автодруку:

- `arrival_inout` — лист приходу / уходу;
- `month_grid` — місячний табель-відмічалка.

## 1. Автоматизований visual audit

Еталонні PDF з персональними даними залишаються поза репозиторієм. Локальний audit перевіряє їх SHA-256, генерує анонімні CRM fixtures, рендерить першу сторінку кожного PDF у 300 dpi та порівнює виміряні геометричні anchors із контрактом v27.

```powershell
$env:HR_ATTENDANCE_REFERENCE_ARRIVAL = 'C:\path\event_genix_series_v27_arrival_inout_print.pdf'
$env:HR_ATTENDANCE_REFERENCE_MONTH = 'C:\path\event_genix_series_v27_month_grid_print.pdf'
$env:PDFTOPPM_PATH = 'C:\path\pdftoppm.exe'
npm run audit:hr-attendance-documents:visual
```

Очікуваний результат: `HR attendance visual audit: PASS`.

CI окремо виконує 300 dpi generated-only guard на анонімізованих fixtures без локальних еталонів і персональних даних:

```bash
npm run audit:hr-attendance-documents:visual:ci
```

Artifacts у `output/pdf/`:

- `event-genix-v27-arrival-anonymized.pdf`;
- `event-genix-v27-month-anonymized.pdf`;
- `event-genix-v27-arrival-max-font.pdf`;
- `event-genix-v27-month-max-font.pdf`;
- `hr-attendance-v27-visual-audit.md`;
- `hr-attendance-v27-visual-audit.json`.

Generated artifacts анонімізовані та не мають потрапляти в git.

## 2. Налаштування фізичного друку

Для кожного з чотирьох calibration PDF:

1. Відкрити завантажений PDF у системному PDF viewer.
2. Обрати принтер і правильний лоток A4.
3. Paper size: `A4`.
4. Scale: **`100%` / `Actual size`**.
5. Вимкнути `Fit`, `Shrink oversized pages`, `Scale to fit` та browser headers/footers.
6. Orientation: `Auto` або явно `Portrait` для arrival і `Landscape` для month grid.
7. Margins у print dialog не додавати: геометрія вже є всередині PDF.
8. Надрукувати по одному примірнику default preset і max-font preset.

## 3. Вимірювання лінійкою

Допуск physical acceptance: `±0.5 mm` для ключових блоків. Тонкі лінії мають залишатися видимими, але їх товщина залежить від принтера.

| Перевірка | Arrival | Month grid | Результат |
| --- | ---: | ---: | --- |
| Горизонтальний відступ від краю аркуша | 4.7 mm | 4.7 mm | ☐ |
| Верхній відступ до dark header | 3.0 mm | 3.0 mm | ☐ |
| Висота dark header | 7.4 mm | 7.9 mm | ☐ |
| Висота category band | 4.3 mm | 2.9 mm | ☐ |
| Висота employee row | 10.9 mm | 7.3 mm | ☐ |
| Ширина name column | — | 59.8 mm | ☐ |
| Ширина однієї day column | — | 7.35 mm | ☐ |
| Ширина time box | 11.3 mm | — | ☐ |
| Inner mark square | — | 4.7 × 4.7 mm | ☐ |

Додатково візуально перевірити:

- header, meta, legend і footer є на кожній сторінці;
- `P1/N`, `P2/N` тощо відповідають реальній кількості сторінок;
- жоден ПІБ, category label або footer не обрізаний;
- zebra rows, weekly separators та inactive days 29–31 читаються у grayscale;
- на max-font preset текст не торкається рамок і не накладається на сусідні клітинки;
- рядки та mark squares не зміщуються між сторінками.

## 4. Live manual MVP QA

Використовувати лише тестові HR-картки та test attendance records.

1. `Пульс компанії → Документи для друку`.
2. Arrival, одна професія → preview → download → print.
3. Arrival, «Батутисти» + «Офіціанти» → переконатися, що працівник із двома професіями надрукований один раз.
4. Arrival, `Порожній бланк` → усі time boxes порожні.
5. Arrival, `Заповнити відомим фактом` → виконувати лише на тестових attendance records; planned shift не має з'явитися як fact.
6. Month grid, одна і кілька професій → 31 day columns, правильна orientation і page headers.
7. Змінити кожен доступний font control до максимуму → preview → download → physical print.
8. `Скинути до еталону v27` → warning зникає, повторний PDF повертається до baseline.

## 5. Owner sign-off

| Поле | Значення |
| --- | --- |
| Принтер / драйвер | |
| Дата перевірки | |
| Arrival default | ☐ прийнято / ☐ відхилено |
| Arrival max font | ☐ прийнято / ☐ відхилено |
| Month default | ☐ прийнято / ☐ відхилено |
| Month max font | ☐ прийнято / ☐ відхилено |
| Коментарі | |
| Owner approval | ім'я / дата |

Owner sign-off обов'язковий перед автоматичним фізичним друком. Він не блокує manual CRM preview/download/print, які вже пройшли software release gate.
