# Skill: Admin Panel CRUD

## Description
Defines patterns and conventions for building admin panel interfaces with data tables, filters, forms, modals, and role-based access. Covers both backend API patterns and frontend UI components for managing events, bookings, clients, and system settings.

## Activation
Use this skill when:
- Building admin dashboard pages
- Creating data tables with sorting/filtering
- Implementing CRUD forms
- Adding role-based access controls
- Building export/import functionality

## Admin Routes Structure

```
/admin
├── /dashboard              # KPI overview
├── /events
│   ├── /                   # List with filters
│   ├── /new                # Create form
│   ├── /:id                # Detail view
│   └── /:id/edit           # Edit form
├── /bookings
│   ├── /                   # List with filters
│   ├── /:id                # Detail + status management
│   └── /export             # CSV/Excel export
├── /clients
│   ├── /                   # Client list + search
│   ├── /:id                # Profile + booking history
│   └── /:id/edit           # Edit client
├── /payments
│   ├── /                   # Payment log
│   └── /:id                # Payment detail
├── /promo
│   ├── /                   # Promo code list
│   └── /new                # Create promo code
├── /notifications
│   ├── /                   # Notification log
│   └── /stats              # Delivery stats
├── /managers
│   ├── /                   # Team management
│   └── /new                # Invite manager
└── /settings
    ├── /general            # Business settings
    ├── /templates          # Notification templates
    └── /integrations       # Telegram, LiqPay, etc.
```

## Role-Based Access Control

```typescript
enum ManagerRole {
  ADMIN = 'ADMIN',       // Full access
  MANAGER = 'MANAGER',   // CRUD on assigned events/bookings, read clients
  VIEWER = 'VIEWER',     // Read-only everywhere
}

const permissions: Record<string, ManagerRole[]> = {
  // Events
  'events.list':    ['ADMIN', 'MANAGER', 'VIEWER'],
  'events.create':  ['ADMIN', 'MANAGER'],
  'events.update':  ['ADMIN', 'MANAGER'], // MANAGER only assigned
  'events.delete':  ['ADMIN'],

  // Bookings
  'bookings.list':    ['ADMIN', 'MANAGER', 'VIEWER'],
  'bookings.update':  ['ADMIN', 'MANAGER'],
  'bookings.cancel':  ['ADMIN', 'MANAGER'],
  'bookings.export':  ['ADMIN', 'MANAGER'],

  // Clients
  'clients.list':     ['ADMIN', 'MANAGER', 'VIEWER'],
  'clients.update':   ['ADMIN'],
  'clients.delete':   ['ADMIN'],

  // Payments
  'payments.list':    ['ADMIN', 'MANAGER', 'VIEWER'],
  'payments.refund':  ['ADMIN'],

  // Managers
  'managers.list':    ['ADMIN'],
  'managers.create':  ['ADMIN'],
  'managers.update':  ['ADMIN'],

  // Settings
  'settings.view':    ['ADMIN'],
  'settings.update':  ['ADMIN'],

  // Promo
  'promo.list':       ['ADMIN', 'MANAGER'],
  'promo.create':     ['ADMIN'],
  'promo.update':     ['ADMIN'],
};
```

## Data Table Component Pattern

```typescript
// Generic reusable table configuration
interface TableConfig<T> {
  columns: ColumnDef<T>[];
  filters: FilterDef[];
  defaultSort: { field: keyof T; order: 'asc' | 'desc' };
  actions: ActionDef[];
  bulkActions?: BulkActionDef[];
  exportFormats?: ('csv' | 'xlsx' | 'pdf')[];
  rowsPerPage: number;
}

// Example: Bookings table
const bookingsTableConfig: TableConfig<Booking> = {
  columns: [
    { key: 'bookingNumber', label: '№', sortable: true, width: 120 },
    { key: 'client.fullName', label: 'Клієнт', sortable: true },
    { key: 'event.title', label: 'Подія', sortable: true },
    { key: 'guestsCount', label: 'Гостей', sortable: true, align: 'center' },
    { key: 'totalPrice', label: 'Сума', sortable: true, format: 'currency' },
    { key: 'status', label: 'Статус', sortable: true, component: 'StatusBadge' },
    { key: 'createdAt', label: 'Створено', sortable: true, format: 'datetime' },
    { key: 'actions', label: '', component: 'ActionMenu' },
  ],
  filters: [
    { key: 'status', type: 'multi-select', label: 'Статус', options: bookingStatuses },
    { key: 'eventId', type: 'select', label: 'Подія', async: true },
    { key: 'dateRange', type: 'date-range', label: 'Період' },
    { key: 'search', type: 'text', label: 'Пошук', placeholder: 'Номер, клієнт, телефон...' },
  ],
  defaultSort: { field: 'createdAt', order: 'desc' },
  actions: [
    { label: 'Переглянути', icon: 'eye', action: 'view' },
    { label: 'Змінити статус', icon: 'edit', action: 'changeStatus', permission: 'bookings.update' },
    { label: 'Скасувати', icon: 'x', action: 'cancel', permission: 'bookings.cancel', confirm: true },
  ],
  bulkActions: [
    { label: 'Експорт вибраних', action: 'export' },
    { label: 'Надіслати нагадування', action: 'sendReminder', permission: 'bookings.update' },
  ],
  exportFormats: ['csv', 'xlsx'],
  rowsPerPage: 20,
};
```

## Dashboard KPIs

```typescript
interface DashboardStats {
  // Today
  todayBookings: number;
  todayRevenue: number;
  todayConfirmed: number;
  todayCancelled: number;

  // This week
  weekBookings: number;
  weekRevenue: number;

  // This month
  monthBookings: number;
  monthRevenue: number;
  monthNewClients: number;

  // Overall
  totalActiveBookings: number;
  totalClients: number;
  avgBookingValue: number;
  conversionRate: number;       // bookings / holds * 100
  cancellationRate: number;

  // Charts data
  revenueByDay: { date: string; amount: number }[];
  bookingsByStatus: { status: string; count: number }[];
  topEvents: { eventId: string; title: string; bookings: number; revenue: number }[];
  clientSources: { source: string; count: number }[];

  // Upcoming
  upcomingEvents: { event: Event; bookedCapacity: number }[];
  pendingActions: {
    unconfirmedBookings: number;
    pendingPayments: number;
    failedNotifications: number;
    expiringHolds: number;
  };
}
```

## Form Validation Patterns

```typescript
// Event creation form
const eventFormSchema = z.object({
  title: z.string().min(3, 'Мінімум 3 символи').max(200),
  type: z.nativeEnum(EventType),
  dateStart: z.date().min(new Date(), 'Дата має бути в майбутньому'),
  dateEnd: z.date(),
  location: z.string().min(3),
  capacityMin: z.number().int().min(1),
  capacityMax: z.number().int().min(1),
  pricePerPerson: z.number().min(0),
  basePrice: z.number().min(0),
  depositPercent: z.number().int().min(0).max(100),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string()).max(10),
}).refine(
  data => data.dateEnd > data.dateStart,
  { message: 'Дата завершення має бути після дати початку', path: ['dateEnd'] }
).refine(
  data => data.capacityMax >= data.capacityMin,
  { message: 'Макс. місткість >= мін. місткість', path: ['capacityMax'] }
);
```

## Export Pattern

```typescript
// CSV export for bookings
async function exportBookingsCSV(filters: BookingFilters): Promise<Buffer> {
  const bookings = await db.booking.findMany({
    where: buildWhereClause(filters),
    include: { event: true, client: true, payments: true },
    orderBy: { createdAt: 'desc' },
  });

  const rows = bookings.map(b => ({
    '№ Бронювання': b.bookingNumber,
    'Клієнт': b.client.fullName,
    'Телефон': b.client.phone,
    'Email': b.client.email || '',
    'Подія': b.event.title,
    'Дата події': formatDate(b.event.dateStart),
    'Гостей': b.guestsCount,
    'Сума': Number(b.totalPrice),
    'Депозит': Number(b.depositAmount),
    'Оплачено': b.payments
      .filter(p => p.status === 'SUCCESS')
      .reduce((s, p) => s + Number(p.amount), 0),
    'Статус': translateStatus(b.status),
    'Створено': formatDate(b.createdAt),
  }));

  return generateCSV(rows, { encoding: 'utf-8-bom' }); // BOM for Excel UA support
}
```

## UI Component Checklist

For every admin page, ensure:
- [ ] Responsive layout (works on tablet)
- [ ] Loading states (skeleton/spinner)
- [ ] Empty states with helpful message
- [ ] Error states with retry button
- [ ] Confirmation dialogs for destructive actions
- [ ] Toast notifications for success/error
- [ ] Keyboard navigation support
- [ ] Ukrainian language for all labels
- [ ] Proper number/date formatting (UA locale)
- [ ] Currency displayed as "X XXX ₴" format
