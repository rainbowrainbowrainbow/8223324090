# Skill: Bug Triage & Issue Management

## Description
Standardized bug reporting, prioritization, reproduction, and resolution workflow for the booking system. Ensures bugs are properly categorized, tracked, and resolved with clear acceptance criteria.

## Activation
Use this skill when:
- Reporting or documenting bugs
- Triaging incoming issues
- Creating bug fix PRs
- Writing regression tests
- Analyzing production incidents

## Bug Report Template

```markdown
## 🐛 Bug Report

### Title
[Clear, specific title describing the symptom]
Example: "Booking hold timer doesn't expire for events in UTC+3 timezone"

### Severity
- [ ] 🔴 Critical — System down, data loss, payment failure
- [ ] 🟠 High — Major feature broken, no workaround
- [ ] 🟡 Medium — Feature partially broken, workaround exists
- [ ] 🟢 Low — Minor UI issue, cosmetic

### Priority
- [ ] P0 — Fix immediately (drop everything)
- [ ] P1 — Fix today
- [ ] P2 — Fix this sprint
- [ ] P3 — Backlog

### Environment
- **URL**: production / staging / local
- **Browser**: Chrome 120 / Safari 17 / Firefox 121
- **Device**: Desktop / Mobile (iPhone 15 / Samsung S24)
- **OS**: macOS / Windows / iOS / Android
- **User role**: Client / Manager / Admin
- **Time**: 2025-06-15 14:30 UTC+2

### Steps to Reproduce
1. Go to `/events/new-year-party`
2. Click "Забронювати"
3. Fill form: name="Test", phone="+380501234567", guests=5
4. Click "Підтвердити"
5. Wait 30 minutes without paying

### Expected Result
Booking status should change from HOLD to CANCELLED.
Client should receive "Hold expired" notification.

### Actual Result
Booking remains in HOLD status indefinitely.
No notification sent.

### Screenshots / Recordings
[Attach screenshots, screen recording, or console logs]

### Logs
```
[Paste relevant server/client logs here]
```

### Additional Context
- Only happens for events with dateStart in UTC+3
- Works correctly for UTC+2 events
- Deployed version: v1.2.3
- Related to commit: abc123
```

## Severity Matrix

| Severity | Impact | Examples | Response Time |
|----------|--------|---------|--------------|
| 🔴 Critical | System unusable, data loss, security breach | Payment processing fails for all users; database corruption; auth bypass | < 1 hour |
| 🟠 High | Major feature broken, significant user impact | Booking form submits but doesn't create record; Telegram bot unresponsive; Admin can't view bookings | < 4 hours |
| 🟡 Medium | Feature degraded, workaround available | Export generates wrong date format; Notification sent twice; Search doesn't filter by date | < 24 hours |
| 🟢 Low | Minor issue, cosmetic, edge case | Button alignment on mobile; Typo in notification; Slow load on old device | Next sprint |

## Triage Workflow

```
Bug Reported
    │
    ▼
┌──────────────┐
│  1. Validate  │  Can we reproduce? Is it really a bug?
└──────┬───────┘
       │
  ┌────┴────┐
  │Reproduced│──── No ──→ Request more info / Close
  └────┬─────┘
       │ Yes
       ▼
┌──────────────┐
│ 2. Classify   │  Severity + Priority + Component
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 3. Assign     │  Who owns this component?
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 4. Root Cause │  Why did it happen?
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 5. Fix + Test │  Write fix + regression test
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 6. Verify     │  QA confirms fix, no regressions
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 7. Deploy     │  Release to production
└──────┘
```

## Component Owners

| Component | Owner | Related Files |
|-----------|-------|---------------|
| Booking workflow | Backend lead | `src/services/booking-*` |
| Payment integration | Backend lead | `src/services/payment-*` |
| Telegram bot | Bot developer | `src/telegram/*` |
| Notifications | Backend | `src/services/notification-*` |
| Admin panel | Frontend lead | `src/pages/admin/*` |
| Public pages | Frontend | `src/pages/(public)/*` |
| Database/migrations | DBA/Backend | `prisma/*` |
| Auth/security | Security | `src/middleware/auth*` |
| CI/CD | DevOps | `.github/workflows/*` |

## Bug Fix PR Template

```markdown
## 🔧 Bug Fix: [Brief description]

### Bug Reference
Fixes #123

### Root Cause
[Explain WHY the bug occurred, not just WHAT was wrong]

Example: "The hold expiry cron job was comparing `holdExpiresAt` with
`new Date()` which uses server's local timezone (UTC), but holdExpiresAt
was stored in UTC+2. This caused a 2-hour delay in expiry detection."

### Changes
- [ ] `src/services/booking-cron.ts` — Use UTC consistently for date comparison
- [ ] `src/utils/dates.ts` — Add `toUTC()` helper
- [ ] `e2e/booking-flow.spec.ts` — Add regression test for timezone handling

### Testing
- [ ] Unit test for the specific fix
- [ ] Regression test that would have caught this
- [ ] Manual verification on staging
- [ ] E2E test passes

### Acceptance Criteria
- [ ] Booking in HOLD status expires after exactly 30 minutes regardless of timezone
- [ ] Client receives "hold expired" notification
- [ ] Event capacity is released
- [ ] No impact on existing bookings

### Rollback Plan
If this fix causes issues: revert commit and redeploy previous version.
No database migration needed.
```

## Common Bug Categories for Booking System

### Timing / Timezone Issues
- Hold expiry not triggering
- Scheduled notifications sent at wrong time
- Event dates displaying incorrectly across timezones
- "Daily summary" sent at wrong hour

### Concurrency Issues
- Two users booking last remaining spot simultaneously
- Race condition on payment confirmation
- Duplicate notifications from parallel workers

### Data Integrity
- Booking total doesn't match sum of guests × price
- Denormalized counters (totalBookings, totalSpent) out of sync
- Orphaned notifications after booking cancellation

### Integration Issues
- LiqPay webhook not received (firewall, URL change)
- Telegram bot stops responding (webhook expired)
- Email provider rate limiting

### UI/UX Issues
- Form validation messages in wrong language
- Currency formatting inconsistent
- Mobile layout broken on specific devices

## Regression Test Pattern

```typescript
// Always write a test that would have caught the bug BEFORE the fix

// e2e/regressions/hold-expiry-timezone.spec.ts
test('REGRESSION #123: booking hold expires correctly in UTC+2', async () => {
  // Arrange: create a booking in HOLD with holdExpiresAt in UTC+2
  const booking = await createBooking({
    status: 'HOLD',
    holdExpiresAt: subMinutes(new Date(), 1), // expired 1 minute ago
  });

  // Act: run the expiry cron
  await expireHoldBookings();

  // Assert: booking should be CANCELLED
  const updated = await db.booking.findUnique({ where: { id: booking.id } });
  expect(updated.status).toBe('CANCELLED');

  // Assert: notification should be sent
  const notification = await db.notification.findFirst({
    where: { bookingId: booking.id, template: 'hold_expired' },
  });
  expect(notification).not.toBeNull();
  expect(notification.status).toBe('QUEUED');
});
```

## Incident Postmortem Template

```markdown
## Incident Postmortem: [Title]

**Date**: YYYY-MM-DD
**Duration**: X hours Y minutes
**Severity**: Critical / High
**Impact**: [What was affected and how many users]

### Timeline (UTC+2)
- 14:00 — First client reports booking not going through
- 14:15 — Alert triggered: booking API error rate > 5%
- 14:20 — Investigation started
- 14:35 — Root cause identified: DB connection pool exhausted
- 14:40 — Fix applied: increased pool size, restarted service
- 14:45 — Service restored, error rate back to normal

### Root Cause
[Detailed technical explanation]

### Resolution
[What was done to fix it]

### Action Items
- [ ] Add connection pool monitoring alert
- [ ] Set up auto-scaling for DB connections
- [ ] Add circuit breaker for DB operations
- [ ] Write runbook for this scenario

### Lessons Learned
- What went well: quick detection via alerts
- What went poorly: no runbook existed, took 15 min to find cause
- Where we got lucky: happened during low-traffic period
```
