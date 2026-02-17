---
name: design-check
description: Перевірка консистентності дизайн-системи на конкретній сторінці або у всьому проекті. Перевіряє кольори, відступи, типографіку, touch-targets, dark mode. Використовуй для валідації дизайну перед релізом.
allowed-tools: Read, Grep, Glob
---

# Design Consistency Check — Парк Закревського Періоду

Перевір консистентність дизайну відповідно до Design System v4.0.

## Дизайн-система (base.css tokens)

### Кольори
- Primary: `--primary: #10B981`, `--primary-dark: #059669`
- Категорії: quest (#8B5CF6), animation (#3B82F6), show (#F97316), masterclass (#84CC16), pinata (#EC4899), photo (#06B6D4)
- Semantic: success (#10B981), warning (#F59E0B), danger (#EF4444), info (#3B82F6)
- Neutrals: gray-50 через gray-900

### Відступи (кратні 4px)
- xs: 4px, sm: 8px, md: 12px, base: 16px, lg: 24px, xl: 32px, 2xl: 48px

### Border radius
- `--radius-xs: 6px`, `--radius-sm: 8px`, `--radius: 12px`, `--radius-lg: 16px`, `--radius-xl: 20px`

### Типографіка (Nunito)
- xs: 11px, sm: 13px, base: 14px, lg: 16px, xl: 18px, 2xl: 22px, 3xl: 28px

### Touch targets
- Мінімум 44×44px для всіх інтерактивних елементів (WCAG 2.1)
- Input font-size мінімум 16px (iOS zoom prevention)

## Що перевіряти на $ARGUMENTS

### 1. Кольори
- Хардкоджені кольори замість `var(--token)` — знайти ВСІ
- Кольори не з палітри — невідомі hex/rgb значення
- Opacity замість окремого кольору де це зайве

### 2. Відступи
- Значення не кратні 4px (margin, padding, gap)
- Надто великі або маленькі відступи (>64px або <2px)

### 3. Типографіка
- font-size не з токенів
- font-weight не стандартний (400, 600, 700, 800, 900)
- Відсутній font-family: inherit на кнопках/інпутах

### 4. Інтерактивність
- Кнопки/посилання менше 44×44px
- Відсутній hover/focus стан
- Відсутній cursor: pointer на клікабельних елементах
- Відсутній transition на hover-ефектах

### 5. Dark mode
- Елементи з хардкодженим білим/чорним без dark-mode override
- body.dark-mode селектори що відсутні
- Тіні що не адаптовані для темної теми

### 6. Responsive
- Фіксовані ширини що зламають мобільну версію
- Текст що може вилізти за контейнер (overflow)
- Зображення без max-width: 100%

### 7. Мова UI (Українська)
- Англійські тексти в placeholder, label, button (мають бути УКР)
- Формат валюти: "1 000 ₴" (пробіл як роздільник)
- Формат дати: DD.MM.YYYY або "15 лютого 2026"

## Формат звіту

```
## Design Check: [назва сторінки]

### Оцінка: X/10

### Порушення дизайн-системи
| # | Файл:рядок | Проблема | Рекомендація |
|---|-----------|----------|-------------|

### Dark mode покриття: X%

### Touch target порушення: N

### Загальні рекомендації
1. ...
```
