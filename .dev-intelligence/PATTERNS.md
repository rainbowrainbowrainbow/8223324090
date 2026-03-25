# PATTERNS.md — Патерни розробки Event Genix CRM
# Заповнюється автоматично з dev-logs після Pattern Extraction
# Перший Pattern Extraction: запланований через ~тиждень після старту

---

## Статус: ПОРОЖНІЙ (чекаємо накопичення dev-logs)

Коли запускати:
```
bash: запусти dev-prompts/pattern-extractor.md в Claude Code
умова: мінімум 5 dev-log записів
```

---

## Структура патерну (шаблон)

```yaml
pattern_id: P001
name: "Назва патерну"
frequency: 0
last_seen: "YYYY-MM-DD"
context: "Коли застосовувати"
template: |
  # Приклад коду або підходу
success_rate: "100%"
risks: []
sergiy_note: "Специфіка підходу Сергія"
related_tags: []
```

---

## Відомі патерни (додані вручну на старті)

### P001 — IIFE Module Pattern
```yaml
pattern_id: P001
name: "IIFE Module Pattern"
frequency: "~12 (оцінка)"
context: "Кожен новий JS файл — ізолювати в IIFE щоб не забруднювати глобальний scope"
template: |
  const ModuleName = (() => {
    // private state
    let _data = [];
    
    // private functions
    function _helper() { ... }
    
    // public API
    return {
      init,
      publicMethod
    };
  })();
  
  ModuleName.init();
success_rate: "100%"
risks:
  - "Забути повернути метод у return {} → TypeError"
  - "Залежності між модулями: якщо A потребує B — порядок підключення важливий"
sergiy_note: "Сергій завжди загортає в IIFE — ніколи не пише голі глобальні функції"
related_tags: ["#iife-module"]
```

### P002 — SQLite New Table Pattern
```yaml
pattern_id: P002
name: "SQLite New Table Pattern"
frequency: "~8 (оцінка)"
context: "Кожна нова сутність = нова таблиця + міграція"
template: |
  // В server.js або окремому migrations.js:
  db.exec(`
    CREATE TABLE IF NOT EXISTS table_name (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
success_rate: "100%"
risks:
  - "IF NOT EXISTS — обов'язково, інакше крашиться при повторному запуску"
  - "updated_at не оновлюється автоматично — потрібен trigger або ручне оновлення"
sergiy_note: "Завжди INTEGER PRIMARY KEY AUTOINCREMENT, завжди created_at"
related_tags: ["#sqlite-new-table"]
```

### P003 — Route Auth Pattern
```yaml
pattern_id: P003
name: "Route Auth Pattern"
frequency: "~15 (оцінка)"
context: "Кожен новий API route обов'язково має authenticate middleware"
template: |
  const { authenticate, requireRole } = require('../middleware/auth');
  
  // Звичайний route (всі авторизовані):
  router.get('/api/resource', authenticate, (req, res) => { ... });
  
  // Route тільки для директора:
  router.post('/api/sensitive', authenticate, requireRole('director'), (req, res) => { ... });
success_rate: "100%"
risks:
  - "Забути authenticate → публічний route (security hole)"
  - "requireRole порядок: authenticate ПЕРЕД requireRole"
sergiy_note: "Правило залізне: якщо route є — authenticate є. Без виключень."
related_tags: ["#route-auth-required"]
```

---

## ANTI-PATTERNS (що НЕ робити)

### AP001 — Global querySelector в циклі
```yaml
id: AP001
name: "Global querySelector в циклі"
description: "document.querySelectorAll('.btn') всередині циклу або render функції"
consequence: "Повільно + може зачепити кнопки інших модулів"
fix: "Кешувати в змінну поза циклом, або використовувати closest('section')"
seen_in: ["js/quiz.js (виправлено)", "js/chat.js (виправлено)"]
```

### AP002 — Price/Calculation в Frontend
```yaml
id: AP002  
name: "Фінансові розрахунки в Frontend JS"
description: "Рахувати ціни, знижки, суми в frontend"
consequence: "Легко обійти через DevTools, дані можуть розходитись"
fix: "Завжди backend: POST /api/calculate → повертає результат"
seen_in: []  # заповнити при знаходженні
```

### AP003 — Missing null-check
```yaml
id: AP003
name: "getElementById без null-check"
description: "const el = document.getElementById('x'); el.classList.add(...)"
consequence: "TypeError якщо елемент не існує на сторінці"
fix: "const el = document.getElementById('x'); if (!el) return; el.classList..."
seen_in: ["виявлено 23 місця → batch-fixed 22.03.2026"]
```
