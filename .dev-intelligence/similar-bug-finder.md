# SIMILAR BUG FINDER
# Копіпаст в Claude Code коли знайдена будь-яка помилка
# Замінити [ОПИС ПОМИЛКИ] і [GREP КОМАНДА]

---

SIMILAR BUG FINDER — Event Genix CRM

Знайдена проблема: [ОПИС ПОМИЛКИ — конкретно, файл і рядок]

Зроби:
1. Знайди всі місця в /tmp/crm-repo де є такий самий патерн:
   [GREP КОМАНДА]

2. Для кожного знайденого місця:
   - Файл і рядок
   - Чи є та сама проблема? (так/ні/можливо)
   - Конкретний фікс (не "можливо варто...")

3. Склади batch-fix для всіх проблемних місць одразу

4. Оціни масштаб: скільки файлів зачеплено?

Формат:
[файл:рядок] — [суть проблеми] — [конкретний фікс]

---

## Готові grep команди за типами помилок:

### Null-check відсутній:
grep -rn "getElementById\." js/ | grep -v "if (\|?\.\|&&\||| "

### apiCall без METHOD:
grep -rn "apiCall('[^A-Z]\|apiCall(\"[^A-Z]" js/

### Hover без media query:
grep -rn ":hover" css/ | grep -v "@media (hover"

### backdrop-filter без webkit:
grep -rn "backdrop-filter" css/ | grep -v "-webkit-backdrop-filter"

### vh без svh fallback:
grep -rn "\bvh\b" css/ | grep -v "svh\|dvh\|@supports\|100vh.*fallback"

### Route без auth:
grep -rn "router\.\(get\|post\|put\|delete\)" routes/ | grep -v "authenticate"

### console.log в production:
grep -rn "console\.log" js/ | grep -v "console\.\(warn\|error\)"
