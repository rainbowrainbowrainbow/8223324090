# v7.6 — Афіша → Задачі

## Концепція
При створенні події в афіші автоматично (або по кнопці) генеруються пов'язані задачі підготовки. Задачі прив'язуються до афіші через `afisha_id`.

---

## Крок 1: DB міграція
**Файл:** `db/index.js`

Додати до таблиці `tasks`:
```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS afisha_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_tasks_afisha_id ON tasks(afisha_id);
```

Без FK constraint — soft link (afisha може бути видалена, задачі залишаються).

---

## Крок 2: Шаблони задач за типом
**Файл:** `services/taskTemplates.js` (NEW)

Хардкод шаблони для кожного типу події:

```javascript
const TASK_TEMPLATES = {
    event: [
        { title: 'Підготувати реквізит для "{title}"', priority: 'high' },
        { title: 'Перевірити обладнання', priority: 'normal' },
        { title: 'Підготувати зону проведення', priority: 'normal' }
    ],
    birthday: [
        { title: 'Підготувати привітання для {title}', priority: 'high' },
        { title: 'Перевірити подарунок/торт', priority: 'normal' }
    ],
    regular: [
        { title: 'Перевірити готовність до "{title}"', priority: 'normal' }
    ]
};
```

Функція `generateTasksForEvent(event, createdBy)` — повертає масив готових task-об'єктів.

---

## Крок 3: API endpoint
**Файл:** `routes/afisha.js`

Новий endpoint:
```
POST /api/afisha/:id/generate-tasks
```

Логіка:
1. Знайти афішу за id
2. Перевірити, чи вже є задачі з цим `afisha_id` (не дублювати)
3. Згенерувати задачі з шаблону по `event.type`
4. INSERT ALL з `afisha_id = event.id`, `date = event.date`
5. Повернути `{ success: true, tasks: [...], count: N }`

---

## Крок 4: Оновити GET /api/tasks
**Файл:** `routes/tasks.js`

- Додати фільтр `?afisha_id=123` — задачі для конкретної події
- В SELECT додати `afisha_id` (він вже буде в таблиці)

---

## Крок 5: UI — кнопка генерації
**Файл:** `js/settings.js`

В `renderAfishaList()` додати кнопку `📝` на кожному афіша-айтемі:
```html
<button onclick="generateTasksForAfisha(id)" title="Створити задачі">📝</button>
```

Функція `generateTasksForAfisha(id)`:
1. POST /api/afisha/:id/generate-tasks
2. showNotification з кількістю створених
3. Якщо вже є — показати "Задачі вже створені"

В `renderTasksList()`:
- Показувати бейдж `🎭` біля задач з `afisha_id`

---

## Крок 6: Каскад при видаленні афіші
**Файл:** `routes/afisha.js` — DELETE endpoint

При видаленні афіші — видаляти пов'язані задачі зі статусом `todo`:
```sql
DELETE FROM tasks WHERE afisha_id = $1 AND status = 'todo'
```
Задачі `in_progress` та `done` — залишаються (вони вже в роботі).

---

## Крок 7: Тести
**Файл:** `tests/api.test.js`

~8 тестів:
1. POST /api/afisha/:id/generate-tasks — створює задачі
2. Перевірка кількості задач за типом event
3. Перевірка кількості задач за типом birthday
4. Повторна генерація — не дублює
5. GET /api/tasks?afisha_id=X — фільтр працює
6. DELETE /api/afisha/:id — каскадне видалення todo-задач
7. DELETE /api/afisha/:id — done-задачі залишаються
8. POST /api/afisha/:id/generate-tasks — 404 для неіснуючої

---

## Крок 8: Version bump
- `package.json` → 7.6.0
- `index.html` → tags, tagline, changelog
- `CHANGELOG.md`, `SNAPSHOT.md`

---

## Файли, що змінюються
| Файл | Зміни |
|------|-------|
| `db/index.js` | +2 рядки (ALTER + INDEX) |
| `services/taskTemplates.js` | **NEW** (~30 рядків) |
| `routes/afisha.js` | +generate-tasks endpoint, +cascade delete |
| `routes/tasks.js` | +afisha_id filter |
| `js/settings.js` | +generateTasksForAfisha(), +badge в tasks |
| `tests/api.test.js` | +8 тестів |
| `index.html` | version bump + changelog |
| `CHANGELOG.md` | запис v7.6 |
| `SNAPSHOT.md` | оновлення |

**Оцінка:** ~200 рядків нового коду
