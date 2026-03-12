# TASK: Training Page Redesign + Full Feature Implementation
## Target: v25.0.0 (current main = v24.3.0)

---

## КОНТЕКСТ

Сторінка `training.html` має 2 проблеми:
1. **Візуально** — виглядає застаріло: білі картки на світлому фоні, немає dark-theme, текст "Навчання персоналу" злипається, нестильно
2. **Функціонально** — вкладка є, але функціонал не реалізований: бази знань по вакансіях є в БД, але не відображаються; тести не генеруються

---

## ЧАСТИНА 1: РЕДИЗАЙН (ОБОВ'ЯЗКОВО)

### 1.1 Загальний стиль
- **Dark theme** — фон `#0D0D0D` або `var(--bg-dark)`, картки `rgba(255,255,255,0.04)`
- Glassmorphism картки з `backdrop-filter: blur(12px)` і `border: 1px solid rgba(255,255,255,0.08)`
- Шрифт — Space Grotesk для заголовків, Inter для тексту
- Акценти — gold `#C9A84C`, indigo `#6366F1`

### 1.2 Заголовок сторінки
**Проблема:** "Навчання" і "Навчання персоналу" — два заголовки стоять впритул, виглядає некрасиво.
**Рішення:**
```html
<!-- Замінити поточний h1 на: -->
<div class="page-hero">
  <div class="page-hero__icon">🎓</div>
  <div>
    <h1 class="page-hero__title">Навчання</h1>
    <p class="page-hero__sub">База знань · Тести · Прогрес команди</p>
  </div>
</div>
```

### 1.3 Stats row
Поточні `.training-stat` мають `background: #fff` — некрасиво в dark mode.
**Замінити на:** glassmorphism картки з gold-акцентом на цифрі.

### 1.4 Картки матеріалів
- Поточні `.material-card` — `background: #fff; box-shadow: ...` → ПОГАНО
- **Нові:** dark glassmorphism, hover з gold border, badge категорії gold-кольором
- Розмір тексту: заголовок 16px bold, категорія 11px uppercase letter-spacing

### 1.5 Left sidebar
- Поточні `.contributors` — `background: #fff` → темні картки
- `.send-prompt-btn` → gold gradient button зі shimmer hover ефектом

### 1.6 Filter chips
- Поточні — `background: rgba(0,0,0,0.05)` виглядає погано в dark
- **Нові:** `border: 1px solid rgba(255,255,255,0.1)`, active = gold bg

### 1.7 Видалити дублікати CSS в <head>
В `training.html` рядки 10-21 — один і той самий набір CSS підключено ДВІЧІ:
```html
<!-- ВИДАЛИТИ перший набір (рядки 10-15), залишити тільки рядки 16-22 -->
```

---

## ЧАСТИНА 2: ФУНКЦІОНАЛЬНА РЕАЛІЗАЦІЯ (ОСНОВНА РОБОТА)

### Архітектура навчання

```
База знань (per-role)
    ↓
Матеріали (training_materials)
    ↓
AI генерує тест (5-10 питань)
    ↓
Співробітник проходить тест
    ↓
Результат → прогрес + бейдж
```

---

### 2.1 База знань по вакансіях

**БД (вже існує):** `training_materials` таблиця з полем `category`.

**Нові поля до таблиці** (нова міграція `046_training_knowledge_base.sql`):
```sql
-- Нова таблиця: knowledge_base (по вакансіях/ролях)
CREATE TABLE IF NOT EXISTS knowledge_base (
    id SERIAL PRIMARY KEY,
    role VARCHAR(100) NOT NULL,          -- 'admin', 'animator', 'cashier', etc.
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,               -- markdown content
    tags TEXT[],                         -- ['booking', 'safety', 'rules']
    difficulty VARCHAR(20) DEFAULT 'basic',  -- 'basic', 'intermediate', 'advanced'
    is_required BOOLEAN DEFAULT FALSE,   -- обов'язкові матеріали
    version INTEGER DEFAULT 1,
    created_by_telegram_id BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Прогрес читання матеріалів
CREATE TABLE IF NOT EXISTS knowledge_base_progress (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE,
    kb_id INTEGER REFERENCES knowledge_base(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(staff_id, kb_id)
);

-- Тести
CREATE TABLE IF NOT EXISTS training_tests (
    id SERIAL PRIMARY KEY,
    kb_id INTEGER REFERENCES knowledge_base(id) ON DELETE CASCADE,
    role VARCHAR(100),
    title VARCHAR(255),
    questions JSONB NOT NULL,  -- [{q: '...', options: [...], correct: 0}]
    generated_by VARCHAR(50) DEFAULT 'ai',  -- 'ai' або 'manual'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Результати тестів
CREATE TABLE IF NOT EXISTS training_test_results (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE,
    test_id INTEGER REFERENCES training_tests(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,              -- 0-100
    answers JSONB,                       -- [{q_idx: 0, answer: 2}]
    passed BOOLEAN DEFAULT FALSE,
    attempt_number INTEGER DEFAULT 1,
    completed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Бейджі за навчання
CREATE TABLE IF NOT EXISTS training_badges (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE,
    badge_type VARCHAR(50),  -- 'first_test', 'perfect_score', 'all_roles', etc.
    earned_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 2.2 API Endpoints

Файл: `routes/training.js` — доповнити наступними ендпоінтами:

```
GET  /api/training/knowledge-base?role=admin     — список матеріалів по ролі
GET  /api/training/knowledge-base/:id            — конкретний матеріал
POST /api/training/knowledge-base                — додати матеріал (директор/менеджер)
PUT  /api/training/knowledge-base/:id            — редагувати
DELETE /api/training/knowledge-base/:id          — видалити

GET  /api/training/tests?role=admin              — тести по ролі
POST /api/training/tests/generate/:kb_id         — AI генерація тесту по матеріалу
POST /api/training/tests/:id/submit              — здати тест {answers: [...]}
GET  /api/training/progress/:staff_id            — прогрес співробітника
GET  /api/training/leaderboard                   — топ по балах

POST /api/training/materials/approve/:input_id   — існуючий (AI Trainer)
```

**AI генерація тесту** (`POST /api/training/tests/generate/:kb_id`):
- Бере `content` з `knowledge_base` по `kb_id`
- Надсилає в Claude API (або OpenAI):
```
Prompt: "На основі цього матеріалу створи 5 питань з 4 варіантами відповіді кожне. 
Поверни JSON: [{q: '...', options: ['...','...','...','...'], correct: 0}]
Матеріал: {content}"
```
- Зберігає в `training_tests`

---

### 2.3 Frontend: training.html — повна переробка

#### Структура tabs (4 вкладки):

```
[📚 Матеріали] [✅ Тести] [📊 Прогрес] [🏆 Рейтинг]
```

#### Tab 1: Матеріали
- **Ліва колонка:** список ролей (фільтр) — Адміністратор / Аніматор / Касир / Менеджер / Арт-директор
- **Права колонка:** список матеріалів по обраній ролі
- Кожна картка: назва, теги, `difficulty` badge (Базовий/Середній/Просунутий), кнопка "Читати"
- При кліку "Читати" → modal з markdown-вмістом + кнопка "Пройти тест"

#### Tab 2: Тести
- Список доступних тестів по ролі поточного юзера
- Статус: Не пройдено / Пройдено (score%) / Треба повторити (<70%)
- При кліку → Quiz modal:
  - Одне питання за раз з progress bar
  - 4 варіанти відповіді (radio або button)
  - Після фінального → результат + анімація (конфетті якщо >80%)
  - Зберегти результат в БД

#### Tab 3: Прогрес
- Картка поточного юзера: аватар, роль, загальний score%, прочитано матеріалів X/Y
- Progress bars по розділах
- Бейджі (earned badges зі описом)
- Графік активності по тижнях (sparkline або bar chart)

#### Tab 4: Рейтинг
- Топ-10 співробітників по загальному score
- Аватар, ім'я, роль, бали, бейджі
- Виділити поточного юзера gold кольором

---

### 2.4 Seeding — початкові дані

Файл: `db/seeds/training_knowledge_base.js`

Заповнити базу знань для 3 ролей по 3-5 матеріали кожна:

**Адміністратор:**
- "Правила бронювання та скасування"
- "Обробка конфліктних ситуацій з клієнтами"
- "Касові операції та звітність"

**Аніматор:**
- "Правила безпеки з дітьми"
- "Сценарії квестів та ігор"
- "Комунікація з батьками"

**Касир:**
- "Обробка платежів та сертифікатів"
- "Правила знижок та акцій"
- "Закриття зміни"

---

## ПОСЛІДОВНІСТЬ ВИКОНАННЯ

```
1. [ ] Видалити дублікати CSS в training.html
2. [ ] Редизайн training.html (dark theme, glassmorphism)
3. [ ] Міграція 046_training_knowledge_base.sql
4. [ ] Оновити routes/training.js (нові endpoints + AI генерація)
5. [ ] Seed початкові матеріали (3 ролі × 3-5 матеріалів)
6. [ ] Tabs структура (4 вкладки)
7. [ ] Tab 1: Матеріали (список + modal читання)
8. [ ] Tab 2: Тести (quiz modal + submit + результат)
9. [ ] Tab 3: Прогрес (stats + badges)
10. [ ] Tab 4: Рейтинг (leaderboard)
11. [ ] Перевірка на мобільному
12. [ ] Версія → v25.0.0 (node scripts/version-sync.js --bump minor)
```

---

## ВАЖЛИВІ ПРАВИЛА

- **Темна тема обов'язкова** — весь inline CSS у training.html тільки dark
- **Без білих карток** — `background: #fff` ЗАБОРОНЕНО
- **Версія** — після всіх змін: `node scripts/version-sync.js --bump minor` → v25.0.0
- **Changelog** — додати запис у `#changelogModal` в index.html
- **Дублікати CSS** — видалити першу копію (рядки 10-15 у поточному training.html)
- **AI ключ для генерації тестів** — `process.env.ANTHROPIC_API_KEY` (або OpenAI)

---

## ТЕХНІЧНА ДОВІДКА

**Поточна БД:**
- `training_materials` — матеріали від персоналу (вже є)
- `staff_training_inputs` — сирі відповіді персоналу (вже є)
- `training_prompts_sent` — трекер відправлених промптів (вже є)
- Нові таблиці: `knowledge_base`, `knowledge_base_progress`, `training_tests`, `training_test_results`, `training_badges`

**Файли:**
- `training.html` — основна сторінка (379 рядків, треба переробити)
- `routes/training.js` — API routes
- `db/migrations/022_staff_trainer.sql` — існуюча міграція
- `db/migrations/046_training_knowledge_base.sql` — НОВА міграція

**Поточна версія main:** v24.3.0
**Цільова версія:** v25.0.0
