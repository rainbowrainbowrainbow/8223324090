# Skill: API Contract & Design

## Description
Defines REST API conventions, endpoint structure, request/response formats, error handling, and authentication patterns for the booking system. All APIs follow OpenAPI 3.0 specification.

## Activation
Use this skill when:
- Designing new API endpoints
- Implementing controllers/route handlers
- Writing API documentation
- Creating API tests
- Reviewing API changes

## Base URL Structure
```
Production:  https://api.booking.example.com/v1
Development: http://localhost:3000/api/v1
```

## Authentication
```
Authorization: Bearer <jwt_token>

JWT Payload:
{
  "sub": "manager-uuid",
  "role": "ADMIN" | "MANAGER" | "VIEWER",
  "iat": 1234567890,
  "exp": 1234567890
}
```

Public endpoints (no auth): booking form submission, event listing, payment webhooks (with signature verification).

## Response Format

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "perPage": 20,
    "total": 142,
    "totalPages": 8
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "BOOKING_CAPACITY_EXCEEDED",
    "message": "Кількість гостей перевищує ліміт",
    "details": [
      {
        "field": "guestsCount",
        "message": "Максимум 50 гостей для цієї події"
      }
    ]
  }
}
```

### HTTP Status Codes
| Code | When |
|------|------|
| 200 | Success (GET, PUT, PATCH) |
| 201 | Created (POST) |
| 204 | Deleted (DELETE) |
| 400 | Validation error |
| 401 | Not authenticated |
| 403 | Not authorized (wrong role) |
| 404 | Resource not found |
| 409 | Conflict (duplicate booking, capacity exceeded) |
| 422 | Business rule violation |
| 429 | Rate limit exceeded |
| 500 | Server error |

## Error Codes Registry
```typescript
enum ApiErrorCode {
  // Auth
  AUTH_INVALID_TOKEN = 'AUTH_INVALID_TOKEN',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_INSUFFICIENT_ROLE = 'AUTH_INSUFFICIENT_ROLE',

  // Validation
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  INVALID_PHONE_FORMAT = 'INVALID_PHONE_FORMAT',

  // Events
  EVENT_NOT_FOUND = 'EVENT_NOT_FOUND',
  EVENT_NOT_PUBLISHED = 'EVENT_NOT_PUBLISHED',
  EVENT_CAPACITY_FULL = 'EVENT_CAPACITY_FULL',

  // Bookings
  BOOKING_NOT_FOUND = 'BOOKING_NOT_FOUND',
  BOOKING_CAPACITY_EXCEEDED = 'BOOKING_CAPACITY_EXCEEDED',
  BOOKING_HOLD_EXPIRED = 'BOOKING_HOLD_EXPIRED',
  BOOKING_INVALID_TRANSITION = 'BOOKING_INVALID_TRANSITION',
  BOOKING_ALREADY_CANCELLED = 'BOOKING_ALREADY_CANCELLED',

  // Payments
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  PAYMENT_AMOUNT_MISMATCH = 'PAYMENT_AMOUNT_MISMATCH',
  REFUND_NOT_ELIGIBLE = 'REFUND_NOT_ELIGIBLE',

  // Promo
  PROMO_CODE_INVALID = 'PROMO_CODE_INVALID',
  PROMO_CODE_EXPIRED = 'PROMO_CODE_EXPIRED',
  PROMO_CODE_LIMIT_REACHED = 'PROMO_CODE_LIMIT_REACHED',

  // Generic
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
```

## Endpoints

### Events (Public + Admin)
```
GET    /api/v1/events                    # List published events (public)
GET    /api/v1/events/:slug              # Get event by slug (public)
POST   /api/v1/admin/events              # Create event (ADMIN, MANAGER)
PUT    /api/v1/admin/events/:id          # Update event
PATCH  /api/v1/admin/events/:id/status   # Change status
DELETE /api/v1/admin/events/:id          # Soft delete
GET    /api/v1/admin/events              # List all events (inc. drafts)
GET    /api/v1/admin/events/:id/bookings # Bookings for event
```

### Bookings (Public + Admin)
```
POST   /api/v1/bookings                  # Create booking (public form)
GET    /api/v1/bookings/:id              # Get by ID (with auth token or booking token)
POST   /api/v1/bookings/:id/confirm      # Confirm (after payment)
POST   /api/v1/bookings/:id/cancel       # Cancel
GET    /api/v1/admin/bookings            # List all bookings
PATCH  /api/v1/admin/bookings/:id/status # Force status change
GET    /api/v1/admin/bookings/export     # Export CSV/Excel
```

### Clients (Admin)
```
GET    /api/v1/admin/clients             # List clients
GET    /api/v1/admin/clients/:id         # Get client details + history
PUT    /api/v1/admin/clients/:id         # Update client
DELETE /api/v1/admin/clients/:id         # Soft delete
GET    /api/v1/admin/clients/:id/bookings # Client's bookings
```

### Payments
```
POST   /api/v1/payments/initiate         # Start payment (LiqPay)
POST   /api/v1/payments/webhook/liqpay   # LiqPay callback (signature verified)
GET    /api/v1/admin/payments             # List payments
GET    /api/v1/admin/payments/:id         # Payment details
POST   /api/v1/admin/payments/:id/refund  # Initiate refund
```

### Notifications (Admin)
```
GET    /api/v1/admin/notifications        # List notifications
POST   /api/v1/admin/notifications/send   # Manual send
GET    /api/v1/admin/notifications/stats  # Delivery stats
```

### Auth
```
POST   /api/v1/auth/login                # Email + password → JWT
POST   /api/v1/auth/refresh              # Refresh token
POST   /api/v1/auth/logout               # Invalidate token
GET    /api/v1/auth/me                   # Current user profile
```

### Dashboard (Admin)
```
GET    /api/v1/admin/dashboard/stats      # Key metrics
GET    /api/v1/admin/dashboard/revenue    # Revenue chart data
GET    /api/v1/admin/dashboard/upcoming   # Upcoming events/bookings
```

### Promo Codes (Admin)
```
POST   /api/v1/promo/validate             # Validate promo code (public)
GET    /api/v1/admin/promo                 # List promo codes
POST   /api/v1/admin/promo                # Create promo code
PUT    /api/v1/admin/promo/:id            # Update
DELETE /api/v1/admin/promo/:id            # Deactivate
```

## Query Parameters Convention
```
?page=1&perPage=20           # Pagination
?sort=createdAt&order=desc   # Sorting
?search=Іванов               # Text search
?status=CONFIRMED,PAID       # Filter (comma-separated)
?dateFrom=2025-01-01&dateTo=2025-12-31  # Date range
?eventId=uuid                # Filter by relation
```

## Validation Rules (Zod schemas)
```typescript
// Booking creation (public)
const createBookingSchema = z.object({
  eventId: z.string().uuid(),
  fullName: z.string().min(2).max(100),
  phone: z.string().regex(/^\+380\d{9}$/, 'Невірний формат телефону'),
  email: z.string().email().optional(),
  guestsCount: z.number().int().min(1).max(200),
  specialRequests: z.string().max(1000).optional(),
  promoCode: z.string().max(50).optional(),
});
```

## Rate Limiting
```
Public endpoints:    60 req/min per IP
Authenticated:       300 req/min per user
Webhooks:            no limit (signature-verified)
Booking creation:    5 req/min per IP (anti-spam)
```

## Webhook Signature Verification (LiqPay)
```typescript
// Verify LiqPay callback
const data = req.body.data;
const signature = req.body.signature;
const expectedSignature = crypto
  .createHash('sha1')
  .update(LIQPAY_PRIVATE_KEY + data + LIQPAY_PRIVATE_KEY)
  .digest('base64');

if (signature !== expectedSignature) {
  throw new ApiError(401, 'INVALID_WEBHOOK_SIGNATURE');
}
```
