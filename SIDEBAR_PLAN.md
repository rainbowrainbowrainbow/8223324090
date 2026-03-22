# Sidebar Fix Plan — v35.2.0

## Оцінка поточного стану (зі скріншота)

### Критичні проблеми:
1. **Подвійний active indicator** — `border-left: 3px` + `::before { width:3px }` = жирна зелена смуга зліва. Треба залишити тільки один.
2. **Nav items занадто високі** — `padding: 10px 12px` = кожен пункт 40px+. При 20+ пунктах sidebar не влізає без скролу.
3. **Vertical track line** — `::before` на `.sidebar-group-inner` малює вертикальну лінію зліва, яка конфліктує з active border.
4. **Group header** — "CRM" / "Управління" / "Творче" виглядають як звичайні text labels, стрілка chevron ледь помітна (5px лінії на сірому).
5. **Забагато пунктів відкрито** — всі 4 групи `defaultOpen: true`, sidebar = нескінченний скрол.

### UX проблеми:
6. **Немає візуальної різниці** між group header та nav-link — все виглядає як плоский список.
7. **Hover translateX(3px)** — рухає весь пункт вправо, виглядає дивно на sidebar.
8. **Active state з padding зміщенням** — `padding-left: 9px` (замість 12px через border-left) ламає вирівнювання тексту з іншими пунктами.

---

## План фіксів

### FIX 1: Компактні nav-links
```
padding: 10px 12px → 7px 12px
font-size: 14px → 13px
gap: 10px → 8px
```
**Результат:** кожен пункт ~32px замість ~40px. Економія ~160px на 20 пунктах.

### FIX 2: Прибрати подвійний active indicator
- Видалити `border-left: 3px solid` з `.nav-link.active`
- Залишити тільки `::before` pseudo-element (чистіший підхід, не ламає padding)
- Прибрати `padding-left: 9px` (залишити стандартний 12px, а в group — 14px)
- В `.sidebar-group-inner .nav-link.active` прибрати зменшення padding

### FIX 3: Прибрати vertical track line
- Видалити `::before` на `.sidebar-group-inner` — ця лінія конфліктує з active indicator і виглядає зайвою

### FIX 4: Покращити group header
- Зробити помітнішу стрілку (8px, товщина 2px, зелений колір)
- Додати легкий background на group header щоб виділяти від nav-links
- Або: зробити group header як роздільник-label (без emoji, тільки текст + стрілка)

### FIX 5: Розумний defaultOpen
- Тільки група з поточною сторінкою = `open`
- Решта груп = `closed` за замовчуванням (але збережений стан в localStorage перезаписує)
- При першому завантаженні: відкрита тільки 1 група → sidebar компактний

### FIX 6: Прибрати hover translateX
- `transform: translateX(3px)` → прибрати
- Залишити тільки `background: var(--gray-50)` на hover (чистіший hover)

### FIX 7: Active state — чистий, без зміщення
```css
.nav-link.active {
    background: var(--primary-50);
    color: var(--primary-dark);
    font-weight: 700;
    /* Без border-left, без padding зміщення */
}
.nav-link.active::before {
    /* Тонка зелена смуга зліва */
    width: 3px;
}
```

---

## Файли для зміни
1. `css/layout.css` — всі CSS фікси (FIX 1-7)
2. `js/components/sidebar.js` — defaultOpen logic (FIX 5)
3. `index.html` — version bump v35.2.0
4. 23 standalone HTML — sidebar.js?v=35.2.0

## Перевірки після
- [ ] Sidebar вміщується без скролу (desktop 900px+)
- [ ] Active state чистий, без подвійного indicator
- [ ] Group headers клікабельні, стрілка видна
- [ ] Hover чистий, без рухання тексту
- [ ] Collapsed mode працює
- [ ] Dark mode коректний
- [ ] 346 тестів pass
