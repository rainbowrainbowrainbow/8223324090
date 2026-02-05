# Skill: DB Schema & Migrations

## Description
Manages database schema design, migrations, and data integrity for the booking system. Ensures consistent database practices using PostgreSQL with Prisma ORM.

## Activation
Use this skill when:
- Creating or modifying database tables
- Writing migrations
- Setting up seed data
- Optimizing queries or adding indexes
- Reviewing data model changes

## Schema Conventions

### Naming
- Tables: `snake_case`, plural (`events`, `bookings`, `clients`)
- Columns: `snake_case` (`created_at`, `booking_number`)
- Indexes: `idx_{table}_{columns}` (`idx_bookings_event_id`)
- Foreign keys: `fk_{table}_{ref_table}` (`fk_bookings_client`)
- Enums: `PascalCase` in Prisma, `snake_case` in raw SQL

### Required Columns (every table)
```prisma
id        String   @id @default(uuid())
createdAt DateTime @default(now()) @map("created_at")
updatedAt DateTime @updatedAt @map("updated_at")
```

### Soft Delete Pattern
```prisma
deletedAt DateTime? @map("deleted_at")
```

## Prisma Schema Template

```prisma
// schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum EventType {
  BIRTHDAY
  CORPORATE
  WEDDING
  HOLIDAY
  CUSTOM
}

enum EventStatus {
  DRAFT
  PUBLISHED
  SOLD_OUT
  ARCHIVED
  CANCELLED
}

enum BookingStatus {
  DRAFT
  HOLD
  PENDING_PAYMENT
  CONFIRMED
  PAID
  COMPLETED
  CANCELLED
  NO_SHOW
  REFUNDED
}

enum PaymentType {
  DEPOSIT
  FULL
  PARTIAL
  REFUND
}

enum PaymentMethod {
  CARD
  CASH
  TRANSFER
  LIQPAY
}

enum PaymentStatus {
  PENDING
  SUCCESS
  FAILED
  REFUNDED
}

enum NotificationChannel {
  TELEGRAM
  EMAIL
  SMS
}

enum NotificationStatus {
  QUEUED
  SENT
  DELIVERED
  FAILED
  RETRY
}

enum LeadSource {
  WEBSITE
  TELEGRAM
  PHONE
  REFERRAL
  INSTAGRAM
}

enum ManagerRole {
  ADMIN
  MANAGER
  VIEWER
}

model Event {
  id            String      @id @default(uuid())
  title         String
  slug          String      @unique
  description   String?     @db.Text
  type          EventType
  dateStart     DateTime    @map("date_start")
  dateEnd       DateTime    @map("date_end")
  location      String
  locationLat   Float?      @map("location_lat")
  locationLng   Float?      @map("location_lng")
  capacityMin   Int         @map("capacity_min")
  capacityMax   Int         @map("capacity_max")
  pricePerPerson Decimal    @map("price_per_person") @db.Decimal(10, 2)
  basePrice     Decimal     @map("base_price") @db.Decimal(10, 2)
  depositPercent Int        @default(30) @map("deposit_percent")
  status        EventStatus @default(DRAFT)
  images        Json?       @default("[]")
  tags          String[]    @default([])
  managerId     String?     @map("manager_id")
  manager       Manager?    @relation(fields: [managerId], references: [id])
  bookings      Booking[]
  createdAt     DateTime    @default(now()) @map("created_at")
  updatedAt     DateTime    @updatedAt @map("updated_at")
  deletedAt     DateTime?   @map("deleted_at")

  @@map("events")
  @@index([status])
  @@index([dateStart])
  @@index([slug])
  @@index([managerId])
}

model Client {
  id              String     @id @default(uuid())
  fullName        String     @map("full_name")
  phone           String     @unique
  email           String?
  telegramChatId  String?    @map("telegram_chat_id")
  telegramUsername String?   @map("telegram_username")
  source          LeadSource @default(WEBSITE)
  notes           String?    @db.Text
  totalBookings   Int        @default(0) @map("total_bookings")
  totalSpent      Decimal    @default(0) @map("total_spent") @db.Decimal(12, 2)
  bookings        Booking[]
  createdAt       DateTime   @default(now()) @map("created_at")
  updatedAt       DateTime   @updatedAt @map("updated_at")
  deletedAt       DateTime?  @map("deleted_at")

  @@map("clients")
  @@index([phone])
  @@index([telegramChatId])
  @@index([source])
}

model Booking {
  id                String        @id @default(uuid())
  bookingNumber     String        @unique @map("booking_number")
  eventId           String        @map("event_id")
  event             Event         @relation(fields: [eventId], references: [id])
  clientId          String        @map("client_id")
  client            Client        @relation(fields: [clientId], references: [id])
  guestsCount       Int           @map("guests_count")
  totalPrice        Decimal       @map("total_price") @db.Decimal(10, 2)
  depositAmount     Decimal       @map("deposit_amount") @db.Decimal(10, 2)
  status            BookingStatus @default(DRAFT)
  holdExpiresAt     DateTime?     @map("hold_expires_at")
  specialRequests   String?       @map("special_requests") @db.Text
  promoCode         String?       @map("promo_code")
  discountPercent   Int?          @map("discount_percent")
  paymentMethod     PaymentMethod?@map("payment_method")
  paidAt            DateTime?     @map("paid_at")
  confirmedAt       DateTime?     @map("confirmed_at")
  cancelledAt       DateTime?     @map("cancelled_at")
  cancellationReason String?      @map("cancellation_reason") @db.Text
  payments          Payment[]
  notifications     Notification[]
  createdAt         DateTime      @default(now()) @map("created_at")
  updatedAt         DateTime      @updatedAt @map("updated_at")

  @@map("bookings")
  @@index([eventId])
  @@index([clientId])
  @@index([status])
  @@index([bookingNumber])
  @@index([holdExpiresAt])
}

model Payment {
  id                    String        @id @default(uuid())
  bookingId             String        @map("booking_id")
  booking               Booking       @relation(fields: [bookingId], references: [id])
  amount                Decimal       @db.Decimal(10, 2)
  type                  PaymentType
  method                PaymentMethod
  status                PaymentStatus @default(PENDING)
  providerTransactionId String?       @map("provider_transaction_id")
  receiptUrl            String?       @map("receipt_url")
  createdAt             DateTime      @default(now()) @map("created_at")

  @@map("payments")
  @@index([bookingId])
  @@index([status])
}

model Manager {
  id              String      @id @default(uuid())
  name            String
  email           String      @unique
  phone           String
  telegramChatId  String?     @map("telegram_chat_id")
  role            ManagerRole @default(MANAGER)
  isActive        Boolean     @default(true) @map("is_active")
  passwordHash    String      @map("password_hash")
  events          Event[]
  createdAt       DateTime    @default(now()) @map("created_at")
  updatedAt       DateTime    @updatedAt @map("updated_at")

  @@map("managers")
  @@index([email])
  @@index([telegramChatId])
}

model Notification {
  id            String              @id @default(uuid())
  recipientType String              @map("recipient_type")
  recipientId   String              @map("recipient_id")
  bookingId     String?             @map("booking_id")
  booking       Booking?            @relation(fields: [bookingId], references: [id])
  channel       NotificationChannel
  template      String
  payload       Json                @default("{}")
  status        NotificationStatus  @default(QUEUED)
  retryCount    Int                 @default(0) @map("retry_count")
  scheduledAt   DateTime?           @map("scheduled_at")
  sentAt        DateTime?           @map("sent_at")
  error         String?             @db.Text
  createdAt     DateTime            @default(now()) @map("created_at")

  @@map("notifications")
  @@index([recipientType, recipientId])
  @@index([status])
  @@index([scheduledAt])
  @@index([bookingId])
}

model PromoCode {
  id              String    @id @default(uuid())
  code            String    @unique
  discountPercent Int       @map("discount_percent")
  maxUses         Int?      @map("max_uses")
  currentUses     Int       @default(0) @map("current_uses")
  validFrom       DateTime  @map("valid_from")
  validUntil      DateTime  @map("valid_until")
  isActive        Boolean   @default(true) @map("is_active")
  createdAt       DateTime  @default(now()) @map("created_at")

  @@map("promo_codes")
  @@index([code])
}

model AuditLog {
  id         String   @id @default(uuid())
  entityType String   @map("entity_type")
  entityId   String   @map("entity_id")
  action     String
  changes    Json?
  actorType  String   @map("actor_type")
  actorId    String   @map("actor_id")
  ipAddress  String?  @map("ip_address")
  createdAt  DateTime @default(now()) @map("created_at")

  @@map("audit_logs")
  @@index([entityType, entityId])
  @@index([actorType, actorId])
  @@index([createdAt])
}
```

## Migration Rules

1. **Never** drop columns in production without a deprecation period
2. **Always** add new columns as nullable or with defaults
3. **Always** create indexes for foreign keys and frequently queried fields
4. **Use** transactions for multi-step migrations
5. **Seed** data should be idempotent (safe to run multiple times)

## Migration Commands
```bash
# Create migration
npx prisma migrate dev --name <descriptive_name>

# Apply in production
npx prisma migrate deploy

# Reset (dev only!)
npx prisma migrate reset

# Generate client
npx prisma generate

# Seed
npx prisma db seed
```

## Seed Data Template
```typescript
// prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Create default admin
  await prisma.manager.upsert({
    where: { email: 'admin@booking.ua' },
    update: {},
    create: {
      name: 'Адміністратор',
      email: 'admin@booking.ua',
      phone: '+380501234567',
      role: 'ADMIN',
      passwordHash: '$2b$10$...' // bcrypt hash of default password
    }
  });

  // Create sample events
  // Create sample clients
  // Create sample bookings
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```
