# Skill: E2E Tests (Playwright)

## Description
End-to-end testing strategy and patterns using Playwright for the booking system. Covers booking flows, admin panel, payment simulation, mobile testing, and CI integration.

## Activation
Use this skill when:
- Writing E2E test scenarios
- Setting up Playwright configuration
- Creating test fixtures and helpers
- Debugging flaky tests
- Adding tests to CI pipeline

## Setup

### Installation
```bash
npm init playwright@latest
# or
npx playwright install --with-deps chromium firefox
```

### Configuration
```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'e2e-results.json' }],
    process.env.CI ? ['github'] : ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    locale: 'uk-UA',
    timezoneId: 'Europe/Kyiv',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
```

## Test Structure

```
e2e/
├── fixtures/
│   ├── auth.fixture.ts          # Login helpers
│   ├── booking.fixture.ts       # Booking test data
│   ├── db.fixture.ts            # Database seeding/cleanup
│   └── api.fixture.ts           # API helpers
├── pages/
│   ├── HomePage.ts              # Page object: public home
│   ├── EventPage.ts             # Page object: event detail
│   ├── BookingForm.ts           # Page object: booking form
│   ├── AdminDashboard.ts        # Page object: admin dashboard
│   ├── AdminBookings.ts         # Page object: admin bookings list
│   └── AdminEvents.ts           # Page object: admin events
├── booking-flow.spec.ts         # Public booking scenarios
├── admin-bookings.spec.ts       # Admin booking management
├── admin-events.spec.ts         # Admin event CRUD
├── admin-clients.spec.ts        # Admin client management
├── payment-flow.spec.ts         # Payment scenarios
├── notifications.spec.ts        # Notification delivery
├── auth.spec.ts                 # Login/logout/roles
├── mobile.spec.ts               # Mobile-specific tests
└── performance.spec.ts          # Performance checks
```

## Page Object Pattern

```typescript
// e2e/pages/BookingForm.ts
import { Page, Locator, expect } from '@playwright/test';

export class BookingForm {
  readonly page: Page;
  readonly nameInput: Locator;
  readonly phoneInput: Locator;
  readonly emailInput: Locator;
  readonly guestsInput: Locator;
  readonly promoInput: Locator;
  readonly specialRequestsInput: Locator;
  readonly submitButton: Locator;
  readonly successMessage: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nameInput = page.locator('[data-testid="booking-name"]');
    this.phoneInput = page.locator('[data-testid="booking-phone"]');
    this.emailInput = page.locator('[data-testid="booking-email"]');
    this.guestsInput = page.locator('[data-testid="booking-guests"]');
    this.promoInput = page.locator('[data-testid="booking-promo"]');
    this.specialRequestsInput = page.locator('[data-testid="booking-requests"]');
    this.submitButton = page.locator('[data-testid="booking-submit"]');
    this.successMessage = page.locator('[data-testid="booking-success"]');
    this.errorMessage = page.locator('[data-testid="booking-error"]');
  }

  async fillForm(data: {
    name: string;
    phone: string;
    email?: string;
    guests: number;
    promo?: string;
    requests?: string;
  }) {
    await this.nameInput.fill(data.name);
    await this.phoneInput.fill(data.phone);
    if (data.email) await this.emailInput.fill(data.email);
    await this.guestsInput.fill(String(data.guests));
    if (data.promo) await this.promoInput.fill(data.promo);
    if (data.requests) await this.specialRequestsInput.fill(data.requests);
  }

  async submit() {
    await this.submitButton.click();
  }

  async expectSuccess() {
    await expect(this.successMessage).toBeVisible({ timeout: 10000 });
  }

  async expectError(message?: string) {
    await expect(this.errorMessage).toBeVisible();
    if (message) {
      await expect(this.errorMessage).toContainText(message);
    }
  }
}
```

## Test Scenarios

### 1. Happy Path: Complete Booking Flow
```typescript
// e2e/booking-flow.spec.ts
import { test, expect } from '@playwright/test';
import { BookingForm } from './pages/BookingForm';

test.describe('Booking Flow', () => {
  test('complete booking: select event → fill form → confirm → pay deposit', async ({ page }) => {
    // 1. Visit homepage
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Наші події');

    // 2. Select an event
    await page.click('[data-testid="event-card"]:first-child');
    await expect(page).toHaveURL(/\/events\/.+/);

    // 3. Click "Book"
    await page.click('[data-testid="book-now-button"]');

    // 4. Fill booking form
    const form = new BookingForm(page);
    await form.fillForm({
      name: 'Тестовий Клієнт',
      phone: '+380501234567',
      email: 'test@example.com',
      guests: 5,
    });

    // 5. Submit
    await form.submit();

    // 6. Expect success
    await form.expectSuccess();
    const bookingNumber = await page
      .locator('[data-testid="booking-number"]')
      .textContent();
    expect(bookingNumber).toMatch(/^BK-\d{4}-\d{4}$/);

    // 7. Payment page should appear
    await expect(page.locator('[data-testid="payment-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="deposit-amount"]')).toBeVisible();
  });

  test('booking fails when event is full', async ({ page }) => {
    // Seed: create event with capacity 1, add 1 existing booking
    await page.goto('/events/sold-out-event');
    await page.click('[data-testid="book-now-button"]');

    const form = new BookingForm(page);
    await form.fillForm({
      name: 'Тестовий Клієнт',
      phone: '+380501234567',
      guests: 1,
    });
    await form.submit();
    await form.expectError('місць');
  });

  test('invalid phone number shows validation error', async ({ page }) => {
    await page.goto('/events/test-event');
    await page.click('[data-testid="book-now-button"]');

    const form = new BookingForm(page);
    await form.fillForm({
      name: 'Test',
      phone: '12345', // invalid
      guests: 1,
    });
    await form.submit();
    await form.expectError('телефону');
  });
});
```

### 2. Admin Panel Tests
```typescript
// e2e/admin-bookings.spec.ts
test.describe('Admin Bookings', () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin
    await page.goto('/admin/login');
    await page.fill('[data-testid="email"]', 'admin@booking.ua');
    await page.fill('[data-testid="password"]', 'admin-test-password');
    await page.click('[data-testid="login-button"]');
    await expect(page).toHaveURL('/admin/dashboard');
  });

  test('view bookings list with filters', async ({ page }) => {
    await page.goto('/admin/bookings');

    // Table should be visible
    await expect(page.locator('table')).toBeVisible();

    // Filter by status
    await page.click('[data-testid="filter-status"]');
    await page.click('[data-testid="status-option-CONFIRMED"]');
    await expect(page.locator('table tbody tr')).toHaveCount(await getCount());

    // Search
    await page.fill('[data-testid="search-input"]', 'BK-2025');
    await expect(page.locator('table tbody tr').first()).toContainText('BK-2025');
  });

  test('change booking status', async ({ page }) => {
    await page.goto('/admin/bookings');
    await page.click('[data-testid="booking-row"]:first-child [data-testid="actions-menu"]');
    await page.click('[data-testid="action-change-status"]');
    await page.click('[data-testid="status-CONFIRMED"]');
    await page.click('[data-testid="confirm-action"]');
    await expect(page.locator('[data-testid="toast-success"]')).toBeVisible();
  });

  test('export bookings to CSV', async ({ page }) => {
    await page.goto('/admin/bookings');
    const downloadPromise = page.waitForEvent('download');
    await page.click('[data-testid="export-csv"]');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/bookings.*\.csv$/);
  });
});
```

### 3. Mobile Tests
```typescript
// e2e/mobile.spec.ts
test.describe('Mobile Booking', () => {
  test.use({ ...devices['iPhone 13'] });

  test('complete booking on mobile', async ({ page }) => {
    await page.goto('/');

    // Hamburger menu
    await page.click('[data-testid="mobile-menu-toggle"]');
    await page.click('[data-testid="nav-events"]');

    // Event cards should be stacked
    const card = page.locator('[data-testid="event-card"]').first();
    await expect(card).toBeVisible();
    await card.click();

    // Book button should be sticky on mobile
    const bookBtn = page.locator('[data-testid="book-now-button"]');
    await expect(bookBtn).toBeVisible();
    await bookBtn.click();

    // Form should be full-width
    const form = new BookingForm(page);
    await form.fillForm({
      name: 'Мобільний Тест',
      phone: '+380671234567',
      guests: 3,
    });
    await form.submit();
    await form.expectSuccess();
  });
});
```

## Test Data Fixtures

```typescript
// e2e/fixtures/db.fixture.ts
import { test as base } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const test = base.extend({
  seedData: async ({}, use) => {
    // Seed before test
    const event = await prisma.event.create({
      data: {
        title: 'Тестова Подія',
        slug: 'test-event-' + Date.now(),
        type: 'BIRTHDAY',
        dateStart: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        dateEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
        location: 'Тестова Локація',
        capacityMin: 5,
        capacityMax: 50,
        pricePerPerson: 500,
        basePrice: 2000,
        status: 'PUBLISHED',
      },
    });

    await use({ event });

    // Cleanup after test
    await prisma.booking.deleteMany({ where: { eventId: event.id } });
    await prisma.event.delete({ where: { id: event.id } });
  },
});
```

## CI Integration

```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on: [push, pull_request]
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

## Best Practices

1. **data-testid** attributes on all interactive elements
2. **Never** use CSS selectors that depend on styling
3. **Always** wait for network idle before assertions on data
4. **Use** `expect.soft()` for non-critical checks
5. **Clean up** test data in `afterEach`/`afterAll`
6. **Parallelize** tests that don't share state
7. **Screenshot** on failure for debugging
8. **Test** Ukrainian text rendering (UTF-8)
9. **Mock** payment provider in tests (never hit real LiqPay)
10. **Run** on both desktop and mobile viewports
