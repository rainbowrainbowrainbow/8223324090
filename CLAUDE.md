# Booking System — Claude Code Project Context

## Project Overview
Holiday/event booking system with mini-CRM, Telegram bot integration, payment processing (LiqPay), and multi-channel notifications. Target market: Ukraine.

## Language
- Code: English (variables, functions, comments)
- UI/UX: Ukrainian (labels, messages, notifications)
- Domain terms: see glossary in `01-product-context` skill

## Skills Index
All project skills are in `.claude/skills/`:

| # | Skill | Purpose |
|---|-------|---------|
| 01 | Product Context & Domain Model | Core entities, relationships, business rules |
| 02 | DB Schema & Migrations | PostgreSQL + Prisma schema, migration rules |
| 03 | API Contract | REST API design, endpoints, error codes |
| 04 | Booking Workflow | State machine, transitions, guards, effects |
| 05 | Notification Orchestrator | Multi-channel notifications, templates, scheduling |
| 06 | Telegram Integration | Bot commands, callbacks, webhooks |
| 07 | Admin Panel CRUD | Dashboard, tables, forms, RBAC |
| 08 | E2E Tests | Playwright test patterns, page objects |
| 09 | Performance & SEO | Lighthouse, Core Web Vitals, structured data |
| 10 | Release & Versioning | SemVer, changelog, CI/CD release flow |
| 11 | Bug Triage | Bug reporting, prioritization, postmortems |
| 12 | Security Guard | OWASP Top 10, auth, input validation, audit |

## Tech Stack
- **Runtime**: Node.js 20+ (TypeScript)
- **Backend**: Fastify (or Express)
- **Database**: PostgreSQL + Prisma ORM
- **Bot**: grammY (Telegram Bot API)
- **Payments**: LiqPay
- **Frontend**: Next.js / Astro
- **Testing**: Vitest (unit) + Playwright (E2E)
- **CI/CD**: GitHub Actions

## Key Conventions
- All dates stored in UTC, displayed in Europe/Kyiv (UTC+2/+3)
- Currency: UAH (₴), format: "1 000 ₴"
- Phone: Ukrainian format +380XXXXXXXXX
- Booking numbers: BK-YYYY-NNNN
- Commit messages: Conventional Commits (feat/fix/chore/etc.)
- Branch naming: feature/, fix/, hotfix/, chore/
