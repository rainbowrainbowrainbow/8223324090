# Skill: Product Context & Domain Model

## Description
Defines the core domain model for a holiday/event booking system with mini-CRM capabilities. This skill ensures all agents share a unified understanding of business entities, their relationships, and domain rules.

## Domain Entities

### Event (Подія/Свято)
```
Event {
  id: UUID
  title: string                    // "Новорічна вечірка", "День народження"
  slug: string                     // URL-friendly identifier
  description: text
  type: EventType                  // BIRTHDAY | CORPORATE | WEDDING | HOLIDAY | CUSTOM
  date_start: datetime
  date_end: datetime
  location: string
  location_coords: {lat, lng}?
  capacity_min: int
  capacity_max: int
  price_per_person: decimal
  base_price: decimal              // fixed part
  deposit_percent: int             // default 30
  status: EventStatus              // DRAFT | PUBLISHED | SOLD_OUT | ARCHIVED | CANCELLED
  images: Image[]
  tags: string[]
  manager_id: UUID                 // assigned manager
  created_at: datetime
  updated_at: datetime
}
```

### Client (Клієнт)
```
Client {
  id: UUID
  full_name: string
  phone: string                    // primary, Ukrainian format +380...
  email: string?
  telegram_chat_id: string?        // for bot notifications
  telegram_username: string?
  source: LeadSource               // WEBSITE | TELEGRAM | PHONE | REFERRAL | INSTAGRAM
  notes: text?
  total_bookings: int              // denormalized counter
  total_spent: decimal             // denormalized
  created_at: datetime
  updated_at: datetime
}
```

### Booking (Бронювання)
```
Booking {
  id: UUID
  booking_number: string           // human-readable, e.g. "BK-2025-0042"
  event_id: UUID
  client_id: UUID
  guests_count: int
  total_price: decimal
  deposit_amount: decimal
  status: BookingStatus            // DRAFT | HOLD | PENDING_PAYMENT | CONFIRMED | PAID | COMPLETED | CANCELLED | NO_SHOW | REFUNDED
  hold_expires_at: datetime?       // 30 min hold by default
  special_requests: text?
  promo_code: string?
  discount_percent: int?
  payment_method: PaymentMethod?   // CARD | CASH | TRANSFER | LiqPay
  paid_at: datetime?
  confirmed_at: datetime?
  cancelled_at: datetime?
  cancellation_reason: text?
  created_at: datetime
  updated_at: datetime
}
```

### Payment (Оплата)
```
Payment {
  id: UUID
  booking_id: UUID
  amount: decimal
  type: PaymentType                // DEPOSIT | FULL | PARTIAL | REFUND
  method: PaymentMethod
  status: PaymentStatus            // PENDING | SUCCESS | FAILED | REFUNDED
  provider_transaction_id: string?
  receipt_url: string?
  created_at: datetime
}
```

### Manager (Менеджер)
```
Manager {
  id: UUID
  name: string
  email: string
  phone: string
  telegram_chat_id: string?
  role: ManagerRole                // ADMIN | MANAGER | VIEWER
  is_active: boolean
  events_assigned: UUID[]          // event IDs
  created_at: datetime
}
```

### Notification (Сповіщення)
```
Notification {
  id: UUID
  recipient_type: 'client' | 'manager'
  recipient_id: UUID
  channel: NotificationChannel     // TELEGRAM | EMAIL | SMS
  template: string                 // template identifier
  payload: jsonb                   // dynamic data for template
  status: NotificationStatus       // QUEUED | SENT | DELIVERED | FAILED | RETRY
  retry_count: int
  scheduled_at: datetime?
  sent_at: datetime?
  error: text?
  created_at: datetime
}
```

## Business Rules

1. **Hold Expiry**: A booking in HOLD status expires after 30 minutes → auto-transitions to CANCELLED
2. **Deposit Rule**: Booking is CONFIRMED only after deposit (default 30%) is paid
3. **Capacity Check**: `sum(confirmed bookings guests) <= event.capacity_max`
4. **Cancellation Policy**:
   - >72h before event: full refund minus 5% fee
   - 24-72h: 50% refund
   - <24h: no refund
5. **Notifications Flow**:
   - Booking created → client gets confirmation (Telegram/Email)
   - 24h before event → reminder
   - 3h before event → final reminder
   - Payment received → receipt notification
   - Status change → manager notification
6. **Booking Number Format**: `BK-{YEAR}-{SEQUENTIAL_4_DIGITS}`
7. **Phone Validation**: Must be valid Ukrainian phone (+380XXXXXXXXX)
8. **Currency**: UAH (Ukrainian Hryvnia), symbol ₴

## Tech Stack Recommendation
- **Backend**: Node.js (TypeScript) + Fastify/Express
- **Database**: PostgreSQL with Prisma ORM
- **Bot**: node-telegram-bot-api or grammY
- **Payments**: LiqPay API
- **Frontend**: Next.js / Astro for landing pages
- **Hosting**: Vercel / Railway / VPS

## Glossary (UA ↔ EN)
| Українська | English | Code |
|---|---|---|
| Подія | Event | Event |
| Бронювання | Booking | Booking |
| Клієнт | Client | Client |
| Менеджер | Manager | Manager |
| Оплата | Payment | Payment |
| Сповіщення | Notification | Notification |
| Свято | Holiday/Celebration | - |
| Депозит | Deposit | deposit |
| Відміна | Cancellation | cancellation |
