# OPEN-RISKS.md — Реєстр відкритих ризиків Event Genix CRM
# Оновлюється: Claude Code після кожної таски + Клешня при верифікації
# Правило: ризик старший 7 днів → Клешня нагадує Сергію автоматично

---

## OPEN RISKS

*(поки порожньо — заповнюється з першою тасою)*

---

## CLOSED RISKS

*(поки порожньо)*

---

## Як додати ризик:

```markdown
### RISK-[NNN]
date_opened: YYYY-MM-DD
source_log: "dev-logs/YYYY-MM-DD.md SESSION N"
risk: "[Опис ризику — конкретно]"
deadline: "YYYY-MM-DD або ASAP"
owner: "Claude Code / Сергій / Клешня"
related_module: "[Назва модуля CRM]"
severity: HIGH / MEDIUM / LOW
```

## Як закрити ризик:

Перенести запис в ## CLOSED RISKS і додати:
```
closed_date: YYYY-MM-DD
closed_by: "[Що зроблено]"
```
