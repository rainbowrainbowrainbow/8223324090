# Промт-продукт для Vibe Coding (v4)

> **Призначення:** це наш **універсальний ключ-набір інструкцій** для створення та редагування **програм / продуктів / застосунків / вебсайтів / Chrome-розширень / автоматизацій / ботів** за допомогою AI у середовищі **Claude Code** (оптимізовано під **Claude Opus 4.6**). Результат має бути **контрольований, передбачуваний і зрозумілий для не-програміста**.

> **Додаткова мета:** під час роботи AI має **потрохи навчати мене кодінгу** — без перевантаження, через короткі пояснення «чому так» і мікро-вправи.

---

## Зміст

0. [Налаштування за замовчуванням](#0-налаштування-за-замовчуванням)
1. [Що таке Vibe Coding](#1-що-таке-vibe-coding)
2. [Базові принципи вайб-кодера](#2-базові-принципи-вайб-кодера)
3. [Покрокова система (від ідеї до продукту)](#3-покрокова-система)
4. [Як працювати з існуючим кодом](#4-як-працювати-з-існуючим-кодом)
5. [Типові помилки і як їх уникати](#5-типові-помилки)
6. [**ГОЛОВНИЙ ПРОМТ** (копіюй в Claude Code)](#6-головний-промт)
7. [Як користуватися промтом](#7-як-користуватися)
8. [Швидкі модифікатори](#8-модифікатори)
9. [Versioning](#9-versioning)
10. [Міні-шаблони запитів](#10-шаблони)
11. [Debugging для не-програміста](#11-debugging)
12. [Guardrails — що AI НЕ повинен робити](#12-guardrails)
13. [Quality Gates — контрольні точки](#13-quality-gates)
14. [Контекст-менеджмент між сесіями](#14-контекст-менеджмент)
15. [Deployment](#15-deployment)
16. [Робота з Git](#16-git)
17. [Приклади реальних сесій](#17-приклади)
18. [Фічі Claude Code для вайб-кодера](#18-фічі-claude-code)
19. [5 анти-патернів (як НЕ треба)](#19-анти-патерни)
20. [Швидкий довідник (cheatsheet)](#20-cheatsheet)

---

## 0) Налаштування за замовчуванням

Фіксуємо правила цього документа:

* **Середовище:** `Claude Code` + `Claude Opus 4.6`
* **Мова процесу (робочі кроки, команди, технічні пояснення):** **English**
* **Мова звітів (підсумки, прогрес, що зроблено/що далі, changelog):** **Українська**

Плейсхолдери для індивідуальних даних задачі:

| Плейсхолдер | Що писати | Приклад |
|---|---|---|
| **{{ідея_застосунку}}** | Опис ідеї 1–3 речення | «Бот у Telegram для запису на стрижку» |
| **{{тип_платформи}}** | web / telegram bot / crm integration / chrome extension / automation / api / mobile / desktop | `telegram bot` |
| **{{бажаний_результат}}** | Що має бути на виході | «Робочий бот, який приймає заявки і пише в Google Sheet» |
| **{{рівень_деталізації}}** | brief / normal / maximum | `normal` |

---

## 1) Що таке Vibe Coding

**Vibe Coding** — термін від Andrej Karpathy (2025). Це спосіб створювати продукт, коли ти описуєш **що має робити система** людською мовою, а AI допомагає перетворити це на рішення: структуру, екрани, логіку, дані, інтеграції та код.

Суть:

* ти мислиш **не кодом**, а **поведінкою продукту**;
* замість «як це написати?» питаєш «як це має працювати?»;
* працюєш маленькими кроками: *опис → генерація → перевірка → уточнення*;
* ти — **делегатор**, AI — **виконавець**. Ти описуєш *що* і *чому*, AI вирішує *як*.

**Аналогія:** Ти — архітектор, який малює план будинку. AI — бригада будівельників. Ти кажеш «тут двері, тут вікно, стіна — синя». Бригада будує. Ти перевіряєш. Якщо двері не там — кажеш «пересунь двері вліво». Тобі не треба вміти класти цеглу.

**Важливо:** Claude Code — це не чат-бот. Це **агентне середовище**, яке може читати файли, виконувати команди, вносити зміни і автономно вирішувати проблеми. Працюй з ним як з компетентним колегою: давай контекст і напрямок, довіряй йому деталі.

---

## 2) Базові принципи вайб-кодера

### 2.1. Один крок — одна ціль

Не проси AI «зробити все». Краще:

* спочатку **збір вимог**,
* потім **прототип**,
* потім **один екран / один сценарій / одна фіча**,
* потім **перевірка і фікси**.

> **Приклад ПОГАНО:** «Зроби мені інтернет-магазин з каталогом, кошиком, оплатою і доставкою.»
>
> **Приклад ДОБРЕ:** «Крок 1: Створи сторінку каталогу — список товарів з назвою, ціною і фото. Без кошика, без оплати. Просто список.»

Для складних задач — розбивай на пронумеровані кроки:
```
1. Create a new database table for user profiles
2. Create an API endpoint to get and update profiles
3. Build a webpage that shows and edits profile info
```

### 2.2. AI любить конкретику

Найсильніші запити мають 5 складових:

| Складова | Питання | Приклад |
|---|---|---|
| *Контекст* | Для чого і кому? | «Це сайт для салону краси, клієнти — жінки 25–45» |
| *Вхідні дані* | Що вводимо? | «Ім'я, телефон, бажана дата» |
| *Вихід* | Що отримуємо? | «Підтвердження запису + повідомлення адміну» |
| *Обмеження* | Рамки? | «Без бази даних, зберігати в Google Sheets» |
| *Приклади* | Як має виглядати? | «Ось скріншот макету: [вставити зображення]» |

**До/після конкретики (з офіційних рекомендацій Anthropic):**

| Розмито | Конкретно |
|---|---|
| «Fix the bug» | «Fix the login bug where users see a blank screen after entering wrong credentials» |
| «Add tests» | «Write tests covering the edge case where user is logged out — avoid mocks» |
| «Make it look better» | «[вставити скріншот] Implement this design, take a screenshot and compare» |
| «Create a dashboard» | «Create an analytics dashboard. Include charts, filters, export to CSV. Go beyond basics.» |

### 2.3. «Не знаю як» — це ок

Ти не мусиш розуміти код. Але ти мусиш:

* вміти описувати поведінку («коли натискаю кнопку — має з'явитися форма»),
* бачити помилки («натискаю — нічого не відбувається»),
* вимагати пояснень **простими словами**,
* просити AI робити зміни **малими порціями**.

**Твої фрази-щити (копіюй коли треба):**

```
«Поясни простими словами, без жаргону.»
«Що зміниться після цієї дії? Що може зламатися?»
«Покажи мінімальний варіант, без зайвого.»
«Я не зрозумів. Дай аналогію з реального життя.»
«Перед тим як щось змінювати — прочитай файл і покажи що планується.»
```

### 2.4. Завжди тестуй і завжди верифікуй

Після кожного кроку:

* перевір «чи працює» — **руками**, не тільки словами AI,
* попроси AI скласти **чек-ліст тестів** (що натиснути, що ввести, що очікувати),
* якщо щось зламалось — проси виправляти **тільки конкретні баги**, не «переписати все»,
* **вимагай верифікацію**: «Run the tests after implementing and confirm they pass.»

**Правило трьох спроб:** якщо AI не може пофіксити баг за 3 спроби — зупинись. Попроси його:
1. Пояснити **чому** не працює (корінна причина).
2. Запропонувати **інший підхід** замість того ж фіксу.
3. Якщо і це не допомогло — **відкатити** до останньої робочої версії.

> **Або:** набери `/clear` і перепиши запит краще — часто це швидше ніж 5-й фікс того ж бага.

---

## 3) Покрокова система

### Етап A — Формулювання ідеї (без коду)

Склади 5 речей:

1. **Хто** користувач? (вік, контекст, тех. рівень)
2. **Яка** головна проблема? (одне речення)
3. **Яка «перемога»** користувача? (що він отримає)
4. **Які 3–7 ключових функцій?** (не більше на старті)
5. **Які обмеження?** (час/бюджет/платформа/дані/безпека)

> **Приклад:**
> 1. Власники малого бізнесу, не технічні
> 2. Втрачають клієнтів бо не встигають відповідати на заявки
> 3. Автоматичне підтвердження заявки + нагадування
> 4. Форма на сайті → повідомлення в Telegram → запис у таблицю → автовідповідь клієнту
> 5. Бюджет $0, тільки безкоштовні сервіси, запуск за 1 день

**Альтернатива: Interview Pattern** (нехай AI поставить питання за тебе):
```
I want to build [brief description]. Interview me in detail.
Ask about technical implementation, UI/UX, edge cases, and tradeoffs.
Don't ask obvious questions — dig into the hard parts I might not have considered.
Keep interviewing until we've covered everything, then write a complete spec to SPEC.md.
```

### Етап B — Дизайн поведінки

Описуєш три речі:

**User Flow** — кроки користувача:
```
1. Клієнт відкриває сайт
2. Заповнює форму (ім'я, телефон, послуга, дата)
3. Натискає "Записатися"
4. Бачить "Дякуємо, ми зв'яжемося"
5. Адмін отримує повідомлення в Telegram
6. Запис з'являється в Google Sheets
```

**Сценарії:**
* Нормальний: все заповнено правильно — запис створено
* Помилковий: телефон без коду країни — показати підказку
* Крайній: 50 заявок за хвилину — чергування, не падати

**Дані — що зберігаємо:**
```
Заявка: {ім'я, телефон, послуга, дата, статус, час_створення}
```

### Етап C — Прототип

AI робить **мінімально працюючу версію**:

* структуру файлів/екранів,
* базову логіку (без краси — лише щоб працювало),
* макет даних,
* інтерфейсні тексти.

**Критерій готовності прототипу:** можна пройти весь User Flow від початку до кінця, навіть якщо виглядає некрасиво.

### Етап D — Реалізація фіч (спринти)

Працюєш маленькими шматками:

```
Спринт 1: Форма заявки → тест → фікси
Спринт 2: Telegram повідомлення → тест → фікси
Спринт 3: Google Sheets інтеграція → тест → фікси
Спринт 4: Стилі і UX → тест → фікси
```

**Правило:** не починай Спринт N+1 поки Спринт N не працює стабільно.

### Етап E — Якість і стабільність

AI допомагає з:

* **тест-кейсами** (список: «натисни тут → очікуй це»),
* **обробкою помилок** (що бачить користувач якщо щось зламалось),
* **валідацією даних** (чи формат телефону правильний, чи email валідний),
* **базовою безпекою** (не показуємо API ключі, не зберігаємо паролі у відкритому вигляді).

### Етап F — Масштабування (тільки після стабільної версії)

AI допомагає:

* оптимізувати UX (швидкість, зручність),
* додати нові фічі,
* підключити інтеграції,
* підготувати документацію (якщо потрібна),
* налаштувати моніторинг (щоб знати коли щось падає).

---

## 4) Як працювати з існуючим кодом

### Крок 1 — Розвідка (використовуй Plan Mode!)

Натисни `Shift+Tab` для переключення в **Plan Mode** — AI буде тільки читати і аналізувати, не змінюючи нічого.

```
«Поясни структуру цього проекту. Що за файли, папки, за що відповідають.
Дай відповідь як таблицю: папка/файл → що робить → коли змінювати.»
```

### Крок 2 — Мапа

```
«Покажи мапу проекту: де інтерфейс (UI), де логіка (business logic),
де дані (database/storage), де налаштування (config).»
```

### Крок 3 — Точкова зміна

Переключися назад у нормальний режим (`Shift+Tab`):

```
«Я хочу змінити [конкретна річ]. Перед тим як змінювати, покажи:
1. Які файли будеш змінювати
2. Що саме зміниться (покажи до/після)
3. Що може зламатися
4. Як перевірити що все ок»
```

### Крок 4 — Валідація

Після зміни перевір:
- [ ] Те що змінювали — працює?
- [ ] Те що НЕ змінювали — не зламалось?
- [ ] Можеш повернутися назад якщо щось не так?

**Фраза-щит для складного коду:**

> «Пояснюй простими словами. Не використовуй жаргон. Якщо без термінів не можна — поясни термін одним реченням. Використовуй аналогії з реального життя.»

---

## 5) Типові помилки

| Помилка | Чому погано | Як правильно |
|---|---|---|
| **Занадто широкий запит** | AI зробить не те, що хочеш | Розбий на кроки по 1 фічі |
| **Немає критеріїв готовності** | Незрозуміло коли зупинитися | Додай «що вважається успіхом» |
| **AI "зламав" робоче** | Ти втрачаєш прогрес | git commit перед кожною зміною |
| **Немає тестів** | Не знаєш що зламалось | Завжди проси чек-ліст тестів |
| **Зміни без логіки** | AI може зробити гірше | Проси обґрунтування: «чому так краще?» |
| **Забув зберегти (commit)** | Зміни втрачені назавжди | Commit після кожного працюючого кроку |
| **Прийняв першу відповідь** | Може бути не найкраще рішення | Проси 2 варіанти і порівняй |
| **Копіюєш код не розуміючи** | Не зможеш потім змінити | Проси пояснення кожного блоку |
| **Мішаєш задачі в одній сесії** | Контекст засмічується | `/clear` між різними задачами |
| **Фіксиш той самий баг 5+ разів** | Даремна трата часу | Після 3-ї спроби: `/clear` і новий підхід |

---

## 6) Головний промт

> Копіюй все що в блоці ` ``` ` нижче і вставляй у Claude Code як перше повідомлення (або в CLAUDE.md).

```markdown
<system>
You are **Vibe Coding Assistant** — a "product-to-implementation translator" for a
non-programmer working in **Claude Code** with **Claude Opus 4.6**.

Your job: help me **build or modify** software — apps, products, websites, Chrome
extensions, automations, Telegram bots, CRM-integrated systems, APIs, internal tools.
</system>

<core-priorities>
P1. CONTROLLABILITY — every change must be explainable, testable, and reversible.
P2. SMALL SAFE ITERATIONS — one goal per step. Never change more than needed.
P3. EXPLORE → PLAN → IMPLEMENT → VERIFY — always in this order.
P4. TEACHING MODE — while solving the task, teach me coding gradually (light, not overwhelming).
P5. PRESERVE WORKING STATE — never break what already works. Commit before risky changes.
</core-priorities>

<language-policy>
• Working process (steps, tasks, technical explanations, file paths, commands): **English**
• Reports (end-of-step summary, changelog, next actions): **Українська**
• Code comments: **English**
• Variable/function names: **English** (never transliteration)
</language-policy>

<my-input>
• Idea / task: **{{ідея_застосунку}}**
• Platform type: **{{тип_платформи}}**
• Desired outcome: **{{бажаний_результат}}**
• Detail level: **{{рівень_деталізації}}**
</my-input>

<workflow-rules>

RULE 1 — CLARIFY FIRST
  If information is missing, ask **up to 7 precise questions** before acting.
  If you can proceed safely with assumptions — proceed but **label every assumption**
  with [ASSUMPTION] tag so I can confirm or correct.
  Alternative: use the Interview Pattern — ask me probing questions about edge cases,
  tradeoffs, and hard parts I might not have considered.

RULE 2 — CHANGE PLAN (before every edit)
  Before editing anything, provide a Change Plan:
  • What will change
  • Where (files/modules)
  • Why (motivation, not just description)
  • What could break
  • How to verify
  • Estimated scope: small / medium / large

RULE 3 — AFTER EVERY CHANGE
  After each change, provide:
  • Test checklist (what to click/enter/check, expected results)
  • Rollback plan (exact steps or command to revert)
  • Files changed (list with 1-line description per file)
  • Git commit suggestion

RULE 4 — MINIMAL DIFFS (anti-overengineering)
  Because unexpected changes can break working features and confuse a non-programmer:
  • Do NOT refactor unless it is necessary for the requested outcome.
  • Do NOT add features I didn't ask for.
  • Do NOT change code style, formatting, or naming in files you didn't need to touch.
  • Do NOT add docstrings, comments, or type annotations to code you didn't change.
  • Do NOT create helpers, utilities, or abstractions for one-time operations.
  • Do NOT design for hypothetical future requirements.
  • Prefer editing 3 lines over rewriting 30.
  • If you create temporary files for testing, clean them up when done.

RULE 5 — GIT DISCIPLINE
  • Suggest `git commit` after every successful step.
  • Commit message format: "type: short description" (feat/fix/refactor/docs/style)
  • Never force-push without explicit permission.
  • Before risky changes: commit current working state first.

RULE 6 — WHEN STUCK (3-strike rule)
  If a fix doesn't work after 3 attempts:
  1. Stop and explain the root cause in plain language.
  2. Propose a fundamentally different approach.
  3. If that fails too — rollback to last working state and ask me how to proceed.

RULE 7 — AUTONOMY TIERS
  AUTO (no confirmation needed):
    reading files, running tests, editing < 20 lines, local reversible actions, git commits
  CONFIRM FIRST:
    deleting files, installing packages, changing config, edits > 50 lines,
    changes to multiple modules, anything affecting shared systems
  ALWAYS ASK:
    destructive operations (rm -rf, DROP TABLE, git reset --hard),
    publishing/deploying, sending external messages, force-push

RULE 8 — CONTEXT PERSISTENCE
  Your context window will be automatically compacted as it approaches its limit.
  This allows you to continue working indefinitely. Therefore:
  • Do not stop tasks early due to token budget concerns.
  • As you approach context limits, save progress to CONTEXT.md and commit.
  • Be as persistent and autonomous as possible — complete tasks fully.
  • After completing a group of tool calls, provide a quick summary of work done.

RULE 9 — EFFICIENCY
  When you need to read multiple files, run multiple searches, or execute independent
  commands, do them in parallel rather than sequentially. This speeds up the workflow.
  However, if actions depend on each other, run them sequentially.

</workflow-rules>

<investigate-before-answering>
Never speculate about code you have not opened. If I reference a specific file, you
MUST read the file before answering. Investigate and read relevant files BEFORE answering
questions about the codebase. Never guess about code structure or behavior.
</investigate-before-answering>

<special-focus>
When relevant, optimize for these common domains:
• Web systems & booking-style sites (forms, calendars, confirmation flows)
• CRM interactions (sync, webhooks, data mapping, auth, rate limits)
• Telegram bots (flows, commands, inline keyboards, notifications, state management)
• Automations (scheduled jobs, triggers, integrations, error alerts)
• Chrome extensions (manifest v3, content scripts, popup, storage)
</special-focus>

<guardrails>
NEVER-1: Delete or overwrite working code without explicit request and backup.
  (Because: losing working code means losing progress that may take hours to recreate.)
NEVER-2: Store secrets (API keys, passwords, tokens) in code or public files.
  (Because: anyone who sees the code gets access to your accounts.)
NEVER-3: Install packages/dependencies without listing them and getting approval.
  (Because: each package is code someone else wrote — it must be trusted.)
NEVER-4: Make "improvements" or "cleanups" I didn't ask for.
  (Because: unexpected changes break working features and confuse non-programmers.)
NEVER-5: Skip error handling for user-facing features.
  (Because: users see cryptic errors instead of helpful messages.)
NEVER-6: Give me a wall of code without explanation.
  (Because: I need to understand what changed and why.)
NEVER-7: Use deprecated libraries or APIs without warning.
  (Because: they may stop working without notice.)
NEVER-8: Assume I understand technical terms — always explain or offer to explain.
  (Because: unexplained jargon stops non-programmers from following along.)
NEVER-9: Speculate about code you have not read.
  (Because: guessing about code leads to wrong fixes and wasted time.)
NEVER-10: Remove or weaken existing tests.
  (Because: tests protect against bugs; weakening them hides problems.)
</guardrails>

<teaching-mode>
At the end of each step, add a **Learning Nugget** block:

  LEARNING NUGGET
  • Concept: [1 concept explained in plain language, max 5 lines]
  • Analogy: [real-life analogy to make it stick]
  • Try it: [optional micro-exercise: "Try changing X to Y and see what happens"]
  • Quick check: [1 yes/no question to confirm understanding]

Difficulty progression:
  Steps 1–3:  fundamentals (files, folders, what is HTML/CSS/JS, what is a server)
  Steps 4–7:  intermediate (functions, data flow, APIs, databases)
  Steps 8+:   practical (debugging, performance, deployment, security)
</teaching-mode>

<protocol>

STEP 1 — CLARIFY
  Ask questions if needed (max 7) or use Interview Pattern for complex projects.
  Confirm the "definition of done".
  Output: numbered list of confirmed requirements + labeled assumptions.

STEP 2 — PRODUCT SKELETON
  Provide:
  • Key features list (3–9 items, prioritized: must / should / nice-to-have)
  • User flow (numbered steps from start to finish)
  • Screens/modules map (what pages or components exist)
  • Data model (entities -> fields, shown as simple table)
  • Integrations needed (external services, APIs)
  • Tech stack recommendation with reasoning (why this and not that)

STEP 3 — IMPLEMENTATION PLAN
  Break into sprints/iterations. For each sprint:
  • Scope (what gets built)
  • Acceptance criteria (how to know it's done)
  • Tests (what to check)
  • Dependencies (what must be ready before this sprint)

STEP 4 — IMPLEMENT ITERATIVELY
  Implement **one unit at a time** (one screen, one feature, one integration).
  For every unit always include:
  • Files changed/created (list)
  • What changed (plain language)
  • How to test (step-by-step for non-programmer)
  • Rollback (how to undo)
  • Git commit suggestion

STEP 5 — PATCH MODE (editing existing product)
  When I request a change/fix:
  1. Restate: current behavior vs desired behavior.
  2. Root cause: what's causing the issue (plain language).
  3. Two solutions: simple (quick fix) vs robust (proper fix) with tradeoffs.
  4. Implement chosen option with minimal diff.
  5. Tests + rollback.

</protocol>

<response-format>
For every response use this structure:

1. **Step Goal** (EN) — what we're achieving right now
2. **What We Do** (EN) — technical actions, file changes
3. **Instructions For You** (EN) — what you need to do (click, test, approve)
4. **Test Checklist** (EN) — numbered list of what to verify
5. **Rollback** (EN) — how to undo if something breaks
6. **Звіт українською** (UA) — що зроблено, що перевірити, що далі
7. **Learning Nugget** (EN) — concept + analogy + exercise + question
</response-format>
```

---

## 7) Як користуватися

### Швидкий старт (5 кроків)

1. **Скопіюй** весь блок з розділу 6.
2. **Заповни** 4 плейсхолдери:
   - `{{ідея_застосунку}}` — що будуємо
   - `{{тип_платформи}}` — де воно буде працювати
   - `{{бажаний_результат}}` — що маємо отримати
   - `{{рівень_деталізації}}` — скільки пояснень хочеш
3. **Встав** у Claude Code як перше повідомлення **або** збережи в `CLAUDE.md` (автоматично завантажиться).
4. **Відповідай** на питання AI коротко і конкретно.
5. **Рухайся ітераціями:** один крок → тест → фікс → наступний крок.

### Ще краще: зберегти як CLAUDE.md

Замість вставляти промт кожен раз, створи файл `CLAUDE.md` в корені проекту. Claude Code **автоматично** читає його на початку кожної сесії.

Або запусти `/init` — Claude сам проаналізує проект і створить стартовий `CLAUDE.md`.

### Золоте правило

> **Ніколи не переходь до наступного кроку, поки поточний не працює.**

---

## 8) Модифікатори

Додай одну з цих фраз **в кінець промта** щоб змінити поведінку AI:

| Модифікатор | Фраза (копіюй) | Коли використовувати |
|---|---|---|
| **Швидкий прототип** | `MODE: rapid prototype. Simplest working version, no polish. I need to see it work. Auto-approve small changes.` | Побачити ідею в дії за 10–30 хв |
| **Стабільність** | `MODE: stability. Priority: error handling, edge cases, test coverage. Use max effort for analysis.` | Зробити продукт надійним |
| **UX/Дизайн** | `MODE: ux-focus. Priority: simplicity, clarity, modern aesthetics. Give 3 UI alternatives for each screen.` | Фокус на зовнішньому вигляді |
| **Інтеграції** | `MODE: integration. Describe step-by-step: setup, keys, verification, common errors, rate limits.` | Підключаєш зовнішній сервіс |
| **Командна робота** | `MODE: team. Add versioning rules, changelog format, and task structure for a team.` | Працюєш не один |
| **Навчання MAX** | `MODE: learning-max. Explain every decision. Show alternatives. Quiz me after each step.` | Максимально вчитися |
| **Авто-режим** | `MODE: auto. Implement changes rather than only suggesting them. Auto-approve small changes. Only confirm on large/risky changes.` | Довіряєш AI і хочеш швидше |
| **Дослідження** | `MODE: research. Search in structured way, develop competing hypotheses, track confidence levels, self-critique, update research notes.` | Дослідити API, бібліотеку перед будівництвом |
| **Красивий UI** | `MODE: beautiful-ui. Use modern design: clean typography, consistent spacing, subtle shadows, smooth animations, professional color palette.` | Хочеш щоб виглядало професійно |

**Можна комбінувати:** `MODE: rapid prototype + learning-max`

---

## 9) Versioning

### Що таке версії і навіщо

Версія — це як **фото стану проекту**. Якщо зламаєш — повертаєшся до попереднього фото.

### Формат

```
Version: vX.Y
```
* **X** (мажор) — великі зміни (нова фіча, нова сторінка, нова інтеграція)
* **Y** (мінор) — дрібні зміни (фікс бага, зміна тексту, зміна стилю)

### Шаблон (проси AI використовувати)

```
Version: v1.3
Changelog:
  - Added phone validation to booking form
  - Fixed date picker not showing weekends
  - Updated confirmation message text
Rollback:
  - git checkout v1.2 (or: git revert HEAD)
```

### Коли збільшувати версію

| Дія | Приклад | Версія |
|---|---|---|
| Новий функціонал | Додали оплату | v1.0 → v**2**.0 |
| Фікс бага | Кнопка не працювала | v2.0 → v2.**1** |
| Зміна тексту/стилю | Змінили колір кнопки | v2.1 → v2.**2** |
| Перший запуск | MVP готовий | v**1**.0 |

---

## 10) Шаблони

### 10.1 Додати фічу

```
Додай фічу: [опис].
Перед реалізацією:
1. Уточни до 5 питань
2. Покажи план змін
3. Тільки після мого "ок" — реалізуй
4. Після реалізації дай тест-чеклист
```

### 10.2 Виправити баг

```
Є баг:
• Що роблю: [кроки відтворення]
• Очікую: [що мало статися]
• Фактично: [що сталося замість]
• Скріншот/помилка: [якщо є]

Дай 2 варіанти фіксу (швидкий і правильний) з поясненням різниці.
Address the root cause, don't suppress the error.
```

### 10.3 Поліпшити UI

```
Оціни поточний UI і дай 10 конкретних покращень.
Для кожного:
• Що змінити
• Чому це краще (для користувача)
• Як перевірити
Сортуй від найважливішого до найменш важливого.
```

### 10.4 Оптимізувати швидкість

```
Проаналізуй продуктивність і дай топ-7 вузьких місць.
Для кожного:
• Де проблема
• Чому це повільно (проста аналогія)
• Як пофіксити
• Як перевірити що стало швидше
```

### 10.5 Пояснити код

```
Поясни цей файл/функцію простими словами:
@[шлях до файлу]

Формат відповіді:
1. Що це робить (1 речення)
2. Аналогія з реального життя
3. Покрокове пояснення (як рецепт)
4. Що станеться якщо це видалити
```

### 10.6 Додати інтеграцію

```
Підключи [назва сервісу] до мого проекту.
Покажи повний план:
1. Що потрібно налаштувати (акаунти, ключі)
2. Кроки підключення
3. Як перевірити що працює
4. Типові помилки і як їх вирішувати
5. Безпека: де зберігати ключі
```

### 10.7 Розпочати новий проект

```
Хочу створити: [опис].
Платформа: [web/bot/extension/etc].

Почни з STEP 1 (Clarify) згідно протоколу.
Не пиши код поки не пройдемо кроки 1–3.
```

### 10.8 Аналіз UI по скріншоту

```
Ось скріншот мого поточного UI: [вставити зображення або перетягнути файл]

1. Що працює добре з точки зору UX?
2. Які 5 конкретних проблем бачиш?
3. Для кожної проблеми: що змінити і чому
4. Покажи план змін перед реалізацією
5. Implement the design, then take a screenshot and compare
```

### 10.9 Interview мене (для складних проектів)

```
I want to build [brief description]. Interview me in detail.
Ask about:
- Who are the users and what problem they face
- Technical requirements and constraints
- UI/UX preferences
- Edge cases and error scenarios
- Integrations needed
- Budget and timeline

Don't ask obvious questions — dig into the hard parts.
Keep interviewing until we've covered everything.
Then write a complete spec to SPEC.md.
```

### 10.10 Продовжити роботу (нова сесія)

```
Start of new session. Do the following:
1. Read CONTEXT.md, CLAUDE.md, and tests.json if they exist
2. Run git log --oneline -10 to see recent history
3. Run any init.sh if it exists
4. Check test status
5. Report: what was done, what's next, any known issues
Then continue with the next planned task.
```

---

## 11) Debugging

### Що таке помилка (просто)

Помилка — це коли програма каже «я не зрозуміла що робити». Як коли GPS каже «маршрут не знайдено» — не означає що дороги немає, а означає що щось пішло не так у процесі пошуку.

### Типи помилок (3 основних)

| Тип | Що бачиш | Аналогія | Що робити |
|---|---|---|---|
| **Синтаксична** | Червоний текст, "SyntaxError" | Граматична помилка в реченні | Покажи AI повний текст помилки |
| **Логічна** | Програма працює, але результат неправильний | Правильно написав адресу, але не в те місто | Опиши: «очікував X, отримав Y» |
| **Runtime** | Програма падає під час роботи | Машина заводиться, але глохне на перехресті | Опиши коли саме падає + скопіюй помилку |

### Алгоритм: що робити коли щось зламалось

```
КРОК 1: Не панікуй. Нічого не видаляй.

КРОК 2: Скопіюй ПОВНИЙ текст помилки (червоний текст в терміналі/консолі).
         Не переказуй своїми словами — копіюй дослівно.

КРОК 3: Відправ AI цей шаблон:
         «Ось помилка: [вставити].
          Що я робив: [кроки].
          Що було до цього: [контекст].
          Поясни що сталось простими словами і дай фікс.
          Fix it and verify the build/tests succeed.»

КРОК 4: Перед фіксом AI має сказати що він буде змінювати.
         Якщо не сказав — запитай.

КРОК 5: Після фіксу протестуй.
         Якщо не допомогло → повтори КРОК 3 з новою помилкою.
         Якщо 3 рази не допомогло → /clear і новий підхід.
```

### Фрази для debugging (копіюй)

```
«Ось помилка. Поясни простими словами що сталось і чому.»
«Не фікси поки не поясниш. Що саме зламалось?»
«Ти вже 2 рази пробував це фіксити. Давай інший підхід.»
«Відкати до останнього робочого стану. Який коміт був останнім робочим?»
«Покажи різницю між тим що було і що ти змінив.»
«Address the root cause, don't just suppress the error.»
```

---

## 12) Guardrails

Ці правила вбудовані в промт (розділ 6), але ось пояснення **для тебе** — коли насторожитися:

| # | Guardrail | Червоний прапорець | Що робити |
|---|---|---|---|
| 1 | Не видаляти робочий код | AI каже «я переписав/переробив...» | «Стоп. Покажи що видалив. Поверни як було.» |
| 2 | Не зберігати секрети в коді | Бачиш API ключ у файлі | «Винеси в .env файл. Поясни як.» |
| 3 | Не ставити пакети без дозволу | AI каже «встановив бібліотеку X» | «Що це? Навіщо? Є альтернатива без неї?» |
| 4 | Не робити "покращення" без запиту | Код змінився більше ніж просив | «Я просив тільки X. Поверни решту.» |
| 5 | Не пропускати обробку помилок | Немає повідомлення при помилці | «Додай повідомлення якщо це не спрацює.» |
| 6 | Не давати стіну коду | 200 рядків коду без пояснень | «Розбий на частини. Поясни кожну.» |
| 7 | Не використовувати застарілі бібліотеки | Стара версія чогось | «Це актуальна версія?» |
| 8 | Завжди пояснювати терміни | Незнайомі слова | «Поясни [термін] одним реченням.» |
| 9 | Не вгадувати код не читаючи | AI каже «я вважаю що...» | «Спочатку прочитай файл, потім відповідай.» |
| 10 | Не видаляти тести | Тести зникли або змінились | «Поверни тести як були. Не міняй тести.» |

---

## 13) Quality Gates

**Quality Gate** — це «стоп-контроль» перед тим як рухатися далі. Як паспортний контроль: поки не пройдеш — далі не пускають.

### Gate 1: Після формулювання ідеї (Етап A)

- [ ] Є чіткий опис хто користувач
- [ ] Є 1 головна проблема (не 5)
- [ ] Є 3–7 функцій (не 20)
- [ ] Є обмеження (бюджет, час, платформа)
- [ ] Ти можеш пояснити ідею іншій людині за 30 секунд

### Gate 2: Після дизайну поведінки (Етап B)

- [ ] Є повний User Flow (від першого кліку до результату)
- [ ] Є мінімум 3 сценарії (нормальний, помилковий, крайній)
- [ ] Зрозуміло які дані зберігаються і де
- [ ] AI підтвердив що все зрозуміло і немає протиріч

### Gate 3: Після прототипу (Етап C)

- [ ] Можна пройти весь User Flow від початку до кінця
- [ ] Дані зберігаються (або хоча б симулюються)
- [ ] Немає "мертвих" кнопок (кожна щось робить)
- [ ] Зроблено git commit з позначкою "prototype-v1"

### Gate 4: Після кожного спринту (Етап D)

- [ ] Нова фіча працює
- [ ] Старі фічі НЕ зламались (регресія)
- [ ] Є тест-чеклист і він пройдений
- [ ] Зроблено git commit
- [ ] Changelog оновлено

### Gate 5: Перед запуском (Етап E)

- [ ] Всі фічі працюють
- [ ] Помилки мають зрозумілі повідомлення для користувача
- [ ] Секрети не в коді (в .env або аналогу)
- [ ] Базова безпека перевірена
- [ ] Є план «що робити якщо впаде»
- [ ] .gitignore налаштований (не пушимо .env, node_modules)

---

## 14) Контекст-менеджмент між сесіями

### Проблема

Claude Code може забути контекст між сесіями. Це як повернутися на будівництво — а бригада не пам'ятає що вчора робили.

### Рішення 1: CLAUDE.md (автоматичне завантаження)

Claude Code **автоматично** читає файл `CLAUDE.md` на початку кожної сесії. Це найважливіший файл для контексту.

**Де створювати (ієрархія, все завантажується автоматично):**

| Файл | Для чого | Видно іншим? |
|---|---|---|
| `~/.claude/CLAUDE.md` | Глобальні правила для всіх проектів | Ні |
| `./CLAUDE.md` | Правила проекту | Так (через git) |
| `./CLAUDE.local.md` | Твої особисті правила проекту | Ні (auto-gitignored) |
| `.claude/rules/*.md` | Модульні правила по темах | Так |

**Шаблон CLAUDE.md:**
```markdown
# Project: [Назва]
[1 речення опис]

## Build & Test
- npm install        # встановити залежності
- npm run dev        # запустити для розробки
- npm test           # запустити тести

## Rules
- Follow Vibe Coding protocol
- Always read CONTEXT.md first
- Commit after every successful change
- Never delete working code without backup
- Explain changes in plain language
- Keep code simple — this is maintained by a non-programmer

## Tech stack
[Що використовуємо і чому]

## Architecture
- /src/pages/     — сторінки/екрани
- /src/components/ — компоненти UI
- /src/api/       — серверна логіка
- /src/data/      — робота з даними

## Key decisions
- [Рішення]: [чому]

@CONTEXT.md
```

**Порада:** Тримай `CLAUDE.md` до ~500 рядків. Якщо більше — Claude починає ігнорувати інструкції. Використовуй `@path/to/file` для імпорту деталей з інших файлів.

**Швидкий старт:** запусти `/init` — Claude сам проаналізує проект і створить стартовий `CLAUDE.md`.

### Рішення 2: CONTEXT.md (стан проекту)

```markdown
# Project Context (auto-updated)

## Current state
- Version: v1.3
- Last completed: Sprint 3 (Telegram integration)
- Next planned: Sprint 4 (Google Sheets sync)
- Known bugs: [список]

## Key decisions made
- [Рішення 1]: [чому]
- [Рішення 2]: [чому]

## Environment
- Node.js v20, npm
- API keys in .env
- Deploy: [де]
```

### Рішення 3: tests.json (трекінг тестів)

Попроси AI створити і підтримувати файл тестів:

```json
{
  "tests": [
    {"id": 1, "name": "booking_form_submit", "status": "passing"},
    {"id": 2, "name": "telegram_notification", "status": "failing", "note": "API key expired"},
    {"id": 3, "name": "google_sheets_sync", "status": "not_started"}
  ]
}
```

**Важливо:** Не дозволяй AI видаляти або послаблювати існуючі тести. Тести — це захист від багів.

### Рішення 4: init.sh (автоматичний запуск)

Для проектів де треба щось запускати при старті:

```bash
#!/bin/bash
# Project initialization script
npm install
npm test
echo "Project ready. Tests status above."
```

### Як використовувати

**На початку нової сесії:**
```
Start of new session. Read CONTEXT.md, check git log --oneline -10,
run init.sh if exists. Report what was done and what's next.
```

**В кінці сесії:**
```
Update CONTEXT.md with: what we did, where we stopped, what's next.
Commit everything.
```

**Продовжити попередню сесію:**
Використовуй `claude --continue` для продовження останньої сесії або `claude --resume` для вибору з списку.

### Дисципліна /clear

Набирай `/clear` між **різними задачами** в одній сесії. Це очищає контекст і дає AI "свіжу голову".

Також `/clear` допомагає коли:
- AI зациклився на одному фіксі (3+ спроб)
- Відповіді стали плутаними або неточними
- Переходиш від однієї фічі до іншої

---

## 15) Deployment

### Що таке deployment (просто)

**Deployment** — це як переїзд з тимчасової кімнати (твій комп'ютер) у власну квартиру (сервер в інтернеті). Після цього інші люди можуть зайти за адресою (URL) і побачити твій продукт.

### Вибір платформи (для не-програміста)

| Тип проекту | Платформа | Ціна | Складність |
|---|---|---|---|
| Статичний сайт (візитка) | GitHub Pages, Netlify | Безкоштовно | Проста |
| Веб-додаток (з логікою) | Vercel, Railway, Render | Безкоштовно/дешево | Середня |
| Telegram бот | Railway, Render, fly.io | Безкоштовно/дешево | Середня |
| API / Backend | Railway, Render, fly.io | Безкоштовно/дешево | Складніша |
| Chrome Extension | Chrome Web Store | $5 одноразово | Середня |

### Шаблон запиту для deployment

```
Допоможи задеплоїти мій проект.
Тип: [web app / bot / api / extension].
Бюджет: [безкоштовно / до $X на місяць].
Вимоги: [домен? SSL? кількість користувачів?].

Дай покроковий план з описом кожного кроку.
Що може піти не так і як це пофіксити.
```

### Чеклист перед deployment

- [ ] Проект працює локально
- [ ] Всі тести пройдені
- [ ] Секрети в .env (не в коді)
- [ ] .gitignore налаштований (не пушимо .env, node_modules, тощо)
- [ ] README.md описує як запустити проект
- [ ] Є план що робити якщо щось зламається на сервері

---

## 16) Git

### Що таке Git (просто)

**Git** — це як машина часу для твого проекту. Кожен `commit` — це знімок (фото) стану всіх файлів. Якщо щось зламав — повертаєшся до будь-якого попереднього знімку.

### Команди які тобі треба знати

| Що хочу | Команда | Аналогія |
|---|---|---|
| Зберегти поточний стан | `git add . && git commit -m "опис"` | Зробити фото |
| Подивитись історію | `git log --oneline` | Переглянути фотоальбом |
| Повернутись назад | `git checkout [commit_id]` | Повернутись до старого фото |
| Подивитись що змінилось | `git diff` | Порівняти два фото |
| Відмінити останню зміну | `git revert HEAD` | Скасувати останнє фото |

### Правила Git для вайб-кодера

1. **Commit після кожного працюючого кроку** — не чекай поки «все буде готове».
2. **Пиши зрозумілі повідомлення** — не "fix" а "fix: booking form date picker not showing weekends".
3. **Commit ПЕРЕД ризикованою зміною** — щоб було куди повертатися.
4. **Ніколи не коміть секрети** — .env файли мають бути в .gitignore.

### Фрази для AI (копіюй)

```
«Зроби коміт з описом що ми зробили.»
«Покажи які файли змінились від останнього коміту.»
«Поверни проект до стану [опис / версія].»
«Що буде якщо я зараз зроблю коміт? Що увійде?»
```

---

## 17) Приклади

### Приклад 1: Telegram бот для запису на стрижку

**Заповнені плейсхолдери:**
```
{{ідея_застосунку}}: Telegram бот для барбершопу. Клієнт обирає майстра,
  послугу, дату/час. Бот підтверджує і нагадує за годину.
{{тип_платформи}}: telegram bot
{{бажаний_результат}}: Працюючий бот, який пише заявки в Google Sheets
  і надсилає нагадування.
{{рівень_деталізації}}: normal
```

**Спринти які отримаєш:**
```
Sprint 1: Базовий бот (відповідає на /start)
Sprint 2: Меню послуг (inline keyboard)
Sprint 3: Вибір дати/часу
Sprint 4: Збереження в Google Sheets
Sprint 5: Підтвердження + нагадування
Sprint 6: Обробка помилок + тести
```

### Приклад 2: Chrome Extension для збереження закладок

```
{{ідея_застосунку}}: Розширення яке дозволяє зберігати поточну вкладку
  з тегами і нотатками, і потім шукати по тегах.
{{тип_платформи}}: chrome extension
{{бажаний_результат}}: Розширення в Chrome Web Store.
{{рівень_деталізації}}: maximum
```

### Приклад 3: Лендінг з формою зворотного зв'язку

```
{{ідея_застосунку}}: Односторінковий сайт для фотографа. Портфоліо
  (галерея робіт) + форма "замовити зйомку" яка пише в Telegram.
{{тип_платформи}}: web
{{бажаний_результат}}: Сайт на Netlify з власним доменом.
{{рівень_деталізації}}: normal
```

### Приклад 4: Interview Pattern у дії

```
User: I want to build a booking system for a small yoga studio.
      Interview me in detail.

Claude: Great! Let me ask some questions to build a complete spec:

1. How many instructors does the studio have? Do clients book with a
   specific instructor or just a time slot?
2. What's the cancellation policy? Can users cancel online?
3. Do you need payment integration or just booking?
4. How far in advance can people book? Is there a maximum?
5. Do instructors set their own availability or is it fixed?
6. Do you need waitlists for full classes?
7. What happens if two people book the same slot simultaneously?

[User answers, Claude writes SPEC.md, then implements from spec]
```

---

## 18) Фічі Claude Code для вайб-кодера

### Клавіатурні скорочення

| Комбінація | Що робить | Коли використовувати |
|---|---|---|
| `Shift+Tab` | Переключити режим (Normal → Plan → Normal) | Перед аналізом — Plan Mode |
| `Esc` | Зупинити AI (контекст зберігається) | Коли AI пішов не туди |
| `Esc+Esc` | Зупинити + відмінити останню дію | Повернути як було |
| `Ctrl+V` | Вставити зображення | Скріншоти UI, макети |

### Plan Mode (безпечна розвідка)

`Shift+Tab` переключає в Plan Mode — AI **тільки читає і аналізує**, нічого не змінює. Ідеально для:
- Розвідки нового проекту
- Планування перед змінами
- Аналізу бага перед фіксом

### @ — посилання на файли

Замість описувати де знаходиться код, просто вкажи файл:
```
@src/components/Header.tsx — fix the navigation menu
@src/api/ — explain what API endpoints exist
```

### Сесії

| Команда | Що робить |
|---|---|
| `claude --continue` | Продовжити останню сесію |
| `claude --resume` | Вибрати сесію зі списку |
| `/rename booking-bot` | Назвати сесію (легше знайти потім) |
| `/clear` | Очистити контекст (свіжий старт) |
| `/compact` | Стиснути контекст (зберегти головне) |

### Рівні зусиль (effort)

Claude Opus 4.6 має **адаптивне мислення** — автоматично вирішує скільки зусиль витратити. Але ти можеш контролювати:

| Рівень | Коли | Як задати |
|---|---|---|
| `low` | Зміна тексту, перейменування | Швидкі тривіальні задачі |
| `medium` | Проста фіча, фікс бага | Стандартна робота |
| `high` (default) | Більшість задач | За замовчуванням |
| `max` | Архітектура, security audit, складний debug | Складні рішення |

### Skills (готові команди)

Claude Code підтримує **Skills** — готові воркфлоу які можна викликати однією командою. Вони зберігаються в `.claude/skills/`.

Приклад: ти можеш створити скіл `/deploy` який автоматично:
1. Запускає тести
2. Будує проект
3. Деплоїть на сервер
4. Перевіряє що все працює

### MCP (підключення зовнішніх сервісів)

Claude Code може підключатися до зовнішніх сервісів через MCP:
- Notion, Figma, Jira, Slack
- Бази даних
- Google Drive
- Кастомні API

Додаєш командою: `claude mcp add [назва]`

---

## 19) 5 анти-патернів

Що НЕ треба робити (з офіційних рекомендацій і досвіду):

### 1. "Каша-сесія" (Kitchen Sink Session)
**Що:** мішаєш різні задачі в одній сесії без `/clear`.
**Чому погано:** контекст засмічується, AI плутається, відповіді стають неточними.
**Як правильно:** `/clear` між різними задачами. Одна сесія — одна тема.

### 2. "Спіраль виправлень" (Correction Spiral)
**Що:** фіксиш той самий баг 5+ разів тими ж методами.
**Чому погано:** кожна спроба може зламати щось нове.
**Як правильно:** після 3-ї спроби — `/clear` і перепиши запит. Або попроси інший підхід.

### 3. "Товстий CLAUDE.md" (Bloated Instructions)
**Що:** CLAUDE.md на 2000 рядків з усіма деталями.
**Чому погано:** Claude починає **ігнорувати** інструкції коли їх забагато.
**Як правильно:** тримай до ~500 рядків. Деталі — в окремих файлах через `@import`.

### 4. "Довіряй-але-не-перевіряй" (Trust Gap)
**Що:** AI каже "все працює" і ти йдеш далі не тестуючи.
**Чому погано:** баги накопичуються і потім складніше фіксити.
**Як правильно:** завжди давай критерії перевірки: «Run tests and confirm they pass.»

### 5. "Нескінченна розвідка" (Infinite Exploration)
**Що:** просиш AI «дослідити все» без конкретної мети.
**Чому погано:** AI витрачає весь контекст на дослідження і не залишає місця для роботи.
**Як правильно:** давай конкретну ціль дослідження. Або використовуй subagents: «Use a subagent to investigate X.»

---

## 20) Cheatsheet

```
┌──────────────────────────────────────────────────────────────┐
│              VIBE CODING v4 CHEATSHEET                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ПОЧИНАЄШ ПРОЕКТ:                                           │
│    1. Заповни 4 плейсхолдери (розділ 0)                      │
│    2. Встав промт (розділ 6) в CLAUDE.md або як повідомлення  │
│    3. Додай модифікатор (розділ 8) якщо треба                │
│    4. Відповідай на питання AI → один крок → тест            │
│    або: /init для автоматичного старту                        │
│                                                              │
│  ЩОСЬ ЗЛАМАЛОСЬ:                                            │
│    1. Скопіюй помилку дослівно                               │
│    2. Шаблон з розділу 11                                     │
│    3. Правило 3 спроб → /clear → новий підхід                │
│                                                              │
│  НОВА СЕСІЯ:                                                 │
│    claude --continue   (продовжити останню)                   │
│    claude --resume     (вибрати з списку)                     │
│    або: шаблон 10.10                                         │
│                                                              │
│  ПЕРЕД ПЕРЕХОДОМ ДАЛІ:                                       │
│    Пройди Quality Gate (розділ 13)                            │
│                                                              │
│  ЗБЕРЕГТИ ПРОГРЕС:                                           │
│    «Зроби коміт з описом що ми зробили»                      │
│                                                              │
│  AI РОБИТЬ ЗАЙВЕ:                                            │
│    «Стоп. Я просив тільки X. Поверни решту як було.»        │
│                                                              │
│  НЕ РОЗУМІЮ:                                                 │
│    «Поясни простими словами з аналогією»                      │
│                                                              │
│  КЛАВІШІ:                                                    │
│    Shift+Tab  → Plan Mode (безпечна розвідка)                │
│    Esc        → зупинити AI                                  │
│    Esc+Esc    → зупинити + відмінити                         │
│    /clear     → очистити контекст                            │
│    /compact   → стиснути контекст                            │
│    /init      → створити CLAUDE.md автоматично               │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

**Версія: v4.0**
**Оптимізовано для: Claude Opus 4.6 + Claude Code**
**Останнє оновлення: Лютий 2026**

**Джерела:**
- [Anthropic: Claude Opus 4.6 Release](https://www.anthropic.com/news/claude-opus-4-6)
- [Anthropic: Claude Prompting Best Practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Claude Code: Official Documentation](https://code.claude.com/docs/en/overview)
- [Anthropic: Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Andrej Karpathy: Vibe Coding](https://x.com/karpathy/status/1886192184808149383)
