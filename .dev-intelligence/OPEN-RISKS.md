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

### RISK-017
date_opened: 2026-05-14
source_log: "dev-logs/2026-05-14.md SESSION 17"
risk: "Legacy pinata records with ambiguous text may require manual review instead of aggressive fuzzy backfill; local verification was run on Node 24/npm 11, while production baseline is Node 22/npm 10."
deadline: "ASAP before production deploy validation"
owner: "Codex / ����� / ������"
related_module: "Bookings / Pinata service separation"
severity: MEDIUM

### RISK-018
date_opened: 2026-05-14
source_log: "dev-logs/2026-05-14.md SESSION 18"
risk: "Unsafe dismiss v2 has focused guard/unit/static UI coverage, but route/tab destructive transitions still need deeper browser-level e2e validation under the canonical Node 22/npm 10 runtime."
deadline: "ASAP before production deploy validation"
owner: "Codex / Sergii / Kleshnia"
related_module: "Unsafe dismiss / legacy dynamic editing surfaces"
severity: MEDIUM

### RISK-019
date_opened: 2026-05-14
source_log: "dev-logs/2026-05-14.md SESSION 19"
risk: "Unsafe dismiss full cluster now has expanded jsdom behavior coverage, but future newly-added route/tab dynamic surfaces still need browser-level e2e expansion under the canonical Node 22/npm 10 runtime."
deadline: "ASAP before future modal-heavy releases"
owner: "Codex / Sergii / Kleshnia"
related_module: "Unsafe dismiss / legacy dynamic editing surfaces"
severity: MEDIUM

### RISK-020
date_opened: 2026-05-14
source_log: "dev-logs/2026-05-14.md SESSION 20"
risk: "Booking visibility hardening could not introduce true team/line/location object scope because the repo does not have durable booking scope fields for those dimensions yet; current implementation is deny-safe for ambiguous scope and uses compatible fallback only for existing role/legacy truths."
deadline: "Before adding team/location-scoped booking operations"
owner: "Codex / Sergii / Kleshnia"
related_module: "Bookings / Event risk visibility"
severity: MEDIUM

### RISK-021
date_opened: 2026-05-14
source_log: "dev-logs/2026-05-14.md SESSION 20"
risk: "Booking-derived linked routes now avoid obvious booking leaks, but full parity between booking visibility and task/customer/lead object rules may need a follow-up if those entity policies diverge materially."
deadline: "Before expanding booking-derived linked route actions"
owner: "Codex / Sergii / Kleshnia"
related_module: "Bookings / Linked entity route-outs"
severity: MEDIUM

2026-05-14 S22 update: Booking Visibility v1.1 promoted durable staff-host assignment scope and added linked-route parity helper. RISK-020 remains for true team/line/location booking scope; RISK-021 remains only for lead/customer exact-route parity until those entity object policies are proven. Booking-derived tasks now route to exact visible task context with parent booking fallback metadata.
