# UI Design Unification Discovery - 2026-07-01

## Scope

Цей документ фіксує статус дизайн-уніфікації внутрішніх HR/workspace екранів:

- `/hr`
- `/staff`
- `/reports`

Production impact: no.

## Виконано

1. Shared UI contract додано в `css/pages-core.css`:
   - `.btn-page-primary`
   - `.btn-page-secondary`
   - `.btn-page-danger`
   - `.btn-page-ghost`
   - `.btn-page-toolbar`
   - `.ui-chip`
   - `.ui-tab-card`
   - `.workspace-hero`
   - `.workspace-command-bar`

2. Верхні HR tabs уніфіковано через `.ui-tab-card` для навігації:
   - Сьогодні
   - Графік
   - Звіти

3. `/staff` і `/reports` переведено на compact hero + command bar pattern.

4. Action buttons нормалізовано:
   - primary лишається для головної дії;
   - toolbar/secondary для звичайних дій;
   - emoji text icons прибрано з action buttons.

5. Inline CSS extraction:
   - великий `<style>` з `reports.html` перенесено в `css/pages-reports.css`;
   - великий `<style>` з `staff.html` перенесено в `css/pages-hr-staff.css`;
   - частину presentation-only inline attrs у `staff.html` винесено в CSS;
   - JS-керовані `display:none` залишені inline, щоб не зламати поведінку.

## Budget Lock

Поточні debt budgets у `config/themeSurface.js`:

| Page | maxStyleBytes | maxInlineStyleAttrs | maxHardColors |
| --- | ---: | ---: | ---: |
| `hr.html` | 0 | 28 | 0 |
| `staff.html` | 0 | 7 | 0 |
| `reports.html` | 0 | 7 | 0 |

Фактичні метрики після змін:

| Page | styleBytes | inlineStyleAttrs | hardColors |
| --- | ---: | ---: | ---: |
| `hr.html` | 0 | 28 | 0 |
| `staff.html` | 0 | 7 | 0 |
| `reports.html` | 0 | 7 | 0 |

## Static Guards

Додано guard-и в `tests/ui-check.js`:

- shared UI primitives існують у `css/pages-core.css`;
- `/hr`, `/staff`, `/reports` не мають inline `<style>` blocks;
- action buttons на `/hr`, `/staff`, `/reports` не використовують emoji text icons.

Оновлено guard-и, які раніше шукали перенесені CSS правила прямо в HTML:

- staff modal layer/profile affordance checks читають CSS aggregate;
- reports manual modal polished controls читають `css/pages-reports.css`;
- HR/invite/changelog polish check читає staff CSS aggregate.

## Verification

Пройшли локальні перевірки через Node 22/npm 10:

```powershell
npx -y -p node@22 -p npm@10 -c "npm run check:runtime"
npx -y -p node@22 -p npm@10 -c "npm run check:css-surface"
npx -y -p node@22 -p npm@10 -c "npm run check:theme-surface"
npx -y -p node@22 -p npm@10 -c "npm run test:ui"
npx -y -p node@22 -p npm@10 -c "node --test tests/hr-button-contract.test.js"
```

Останній відомий результат:

- `check:runtime`: passed
- `check:css-surface`: passed
- `check:theme-surface`: passed
- `test:ui`: passed, `1122/0`
- `tests/hr-button-contract.test.js`: passed, `22/0`

## Screenshot Proof

Згенеровано static preview screenshots:

- `output/playwright/task3-hr-desktop.png`
- `output/playwright/task3-hr-mobile.png`
- `output/playwright/task3-staff-desktop.png`
- `output/playwright/task3-staff-mobile.png`
- `output/playwright/task3-reports-desktop.png`
- `output/playwright/task3-reports-mobile.png`

Перевірено вручну:

- кнопки не ріжуть текст;
- tabs мають однакову логіку active state;
- command bar не перекриває hero/content;
- mobile layout не розвалюється;
- desktop layout читається як одна система.

## Known Limitations

- Screenshot proof зроблено через static preview/mock, не через повний CRM із реальною PostgreSQL/API сесією.
- Static preview reports harness має старі mock API console errors для `reports-page.js`; вони не пов'язані з CSS extraction.
- `css/pages-hr-staff.css` і `css/pages-reports.css` після extraction можуть містити дубльовані правила. Dedupe треба робити окремою малоризиковою задачею з screenshot comparison.

## Recommended Next Tasks

1. CSS dedupe pass для `css/pages-hr-staff.css` і `css/pages-reports.css`.
2. Browser QA на реальному `npm start` з локальною DB/API сесією.
3. Якщо dedupe буде робитись, після нього повторити:
   - `npm run check:theme-surface`
   - `npm run check:css-surface`
   - `npm run test:ui`
   - screenshots для `/hr`, `/staff`, `/reports` desktop/mobile.
