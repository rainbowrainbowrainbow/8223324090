# Skill: Security Guard

## Description
Security policies, guardrails, and best practices for the booking system. Prevents common vulnerabilities (OWASP Top 10), enforces safe coding patterns, and provides security review checklists. Acts as an automated security reviewer for all code changes.

## Activation
This skill is **always active**. Apply these rules to every code change, especially:
- API endpoints
- Authentication/authorization logic
- Database queries
- User input handling
- Payment processing
- File uploads
- External integrations

## CRITICAL RULES (Never Break These)

### 1. Never Expose Secrets
```
❌ NEVER commit to git:
- .env files
- API keys, tokens, passwords
- Database connection strings
- Private keys
- JWT secrets
- LiqPay private key
- Telegram bot token

✅ ALWAYS:
- Use environment variables
- Add to .gitignore
- Use .env.example with placeholder values
- Rotate secrets if accidentally exposed
```

### 2. Never Trust User Input
```typescript
// ❌ BAD: Direct use of user input
const user = await db.client.findFirst({
  where: { id: req.params.id } // Could be SQL injection via raw query
});

// ✅ GOOD: Validate and sanitize
const idSchema = z.string().uuid();
const id = idSchema.parse(req.params.id);
const user = await db.client.findUnique({ where: { id } });
```

### 3. Never Use Dangerous Commands
```
❌ FORBIDDEN in any code or scripts:
- rm -rf / (or any root deletion)
- DROP DATABASE without confirmation
- eval() with user input
- exec() with user input
- Any command that could wipe data

✅ Use parameterized queries, ORM methods, safe APIs
```

## OWASP Top 10 Checklist for Booking System

### A01: Broken Access Control
```typescript
// ❌ BAD: No authorization check
app.get('/api/admin/bookings', async (req, res) => {
  const bookings = await db.booking.findMany();
  res.json(bookings);
});

// ✅ GOOD: Role-based access control
app.get('/api/admin/bookings',
  authenticate,       // Verify JWT
  authorize(['ADMIN', 'MANAGER']), // Check role
  async (req, res) => {
    const bookings = await getBookingsForManager(req.user);
    res.json(bookings);
  }
);

// ✅ GOOD: Resource-level authorization (MANAGER sees only assigned events)
async function getBookingsForManager(manager: Manager) {
  if (manager.role === 'ADMIN') {
    return db.booking.findMany({ /* all */ });
  }
  return db.booking.findMany({
    where: { event: { managerId: manager.id } },
  });
}
```

### A02: Cryptographic Failures
```typescript
// Passwords: ALWAYS bcrypt with salt rounds >= 10
import bcrypt from 'bcrypt';
const SALT_ROUNDS = 12;
const hash = await bcrypt.hash(password, SALT_ROUNDS);
const isValid = await bcrypt.compare(password, hash);

// JWT: Use strong secret, set expiry
const token = jwt.sign(
  { sub: manager.id, role: manager.role },
  process.env.JWT_SECRET, // min 256 bits
  { expiresIn: '8h', algorithm: 'HS256' }
);

// Sensitive data: Encrypt at rest
// - Client phone numbers in DB: consider encryption
// - Payment data: NEVER store card numbers (use LiqPay tokens)
// - HTTPS only: redirect all HTTP to HTTPS
```

### A03: Injection
```typescript
// SQL Injection: Use Prisma (parameterized by default)
// ❌ BAD
const result = await db.$queryRaw`SELECT * FROM clients WHERE phone = ${phone}`;
// This IS actually safe in Prisma tagged templates, but avoid raw SQL when possible

// ✅ GOOD: Use Prisma query builder
const client = await db.client.findFirst({ where: { phone } });

// XSS: Sanitize all output
// ❌ BAD (React dangerouslySetInnerHTML with user data)
<div dangerouslySetInnerHTML={{ __html: booking.specialRequests }} />

// ✅ GOOD: Use text content or sanitize
<div>{booking.specialRequests}</div>
// If HTML needed: import DOMPurify; DOMPurify.sanitize(html)

// Command Injection: Never interpolate user input into commands
// ❌ BAD
exec(`convert ${userFilename} output.jpg`);
// ✅ GOOD: Use array args
execFile('convert', [userFilename, 'output.jpg']);
```

### A04: Insecure Design
```typescript
// Rate limiting on sensitive endpoints
import rateLimit from 'express-rate-limit';

const bookingLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 5,                // 5 booking attempts per minute
  message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Забагато спроб' } },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                    // 5 login attempts
  message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Забагато спроб входу' } },
});

app.post('/api/v1/bookings', bookingLimiter, createBookingHandler);
app.post('/api/v1/auth/login', authLimiter, loginHandler);
```

### A05: Security Misconfiguration
```typescript
// Helmet for HTTP security headers
import helmet from 'helmet';
app.use(helmet());

// CORS: restrict to known origins
import cors from 'cors';
app.use(cors({
  origin: [
    'https://yourdomain.com',
    'https://admin.yourdomain.com',
    process.env.NODE_ENV === 'development' && 'http://localhost:3000',
  ].filter(Boolean),
  credentials: true,
}));

// Remove server header
app.disable('x-powered-by');

// Error handling: never expose stack traces in production
app.use((err, req, res, next) => {
  console.error(err); // log full error
  res.status(err.status || 500).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'Внутрішня помилка сервера'
        : err.message,
      // NEVER include err.stack in production
    },
  });
});
```

### A07: Authentication Failures
```typescript
// Brute force protection
// - Rate limit login endpoint (5 attempts / 15 min)
// - Lock account after 10 failed attempts
// - Log all auth failures

// Session management
// - JWT expiry: 8h for web, 30d for mobile
// - Refresh token rotation
// - Invalidate on password change
// - Invalidate on role change

// Password policy
const passwordSchema = z.string()
  .min(8, 'Мінімум 8 символів')
  .regex(/[A-Z]/, 'Потрібна велика літера')
  .regex(/[0-9]/, 'Потрібна цифра')
  .regex(/[^A-Za-z0-9]/, 'Потрібен спеціальний символ');
```

## Payment Security (LiqPay)

```typescript
// 1. ALWAYS verify webhook signature
function verifyLiqPaySignature(data: string, signature: string): boolean {
  const expected = crypto
    .createHash('sha1')
    .update(process.env.LIQPAY_PRIVATE_KEY + data + process.env.LIQPAY_PRIVATE_KEY)
    .digest('base64');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// 2. NEVER store card numbers
// 3. ALWAYS verify amount matches booking total
// 4. ALWAYS verify order_id matches booking_id
// 5. Log all payment events for audit
// 6. Use idempotency keys for payment operations
```

## Security Headers

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.telegram.org
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

## .gitignore Security

```gitignore
# Secrets
.env
.env.local
.env.production
*.pem
*.key

# Credentials
credentials.json
service-account.json
firebase-adminsdk*.json

# Database
*.sqlite
*.db
prisma/dev.db

# Logs (may contain sensitive data)
*.log
logs/

# IDE
.idea/
.vscode/settings.json

# OS
.DS_Store
Thumbs.db
```

## Security Review Checklist (for every PR)

```markdown
### Security Review
- [ ] No secrets/credentials in code
- [ ] All user inputs validated (Zod schemas)
- [ ] API endpoints have proper authentication
- [ ] API endpoints have proper authorization (role check)
- [ ] No SQL injection vectors (using ORM/parameterized)
- [ ] No XSS vectors (output escaped/sanitized)
- [ ] Rate limiting on public endpoints
- [ ] Error messages don't leak internal details
- [ ] Logging doesn't contain PII/passwords
- [ ] File uploads validated (type, size, name)
- [ ] CSRF protection for state-changing operations
- [ ] Payment operations verified server-side
- [ ] Webhook signatures verified
```

## Audit Logging

```typescript
// Log security-relevant events
async function auditLog(event: {
  action: string;        // 'login', 'booking.create', 'payment.process'
  entityType: string;    // 'manager', 'booking', 'payment'
  entityId: string;
  actorType: string;     // 'manager', 'client', 'system'
  actorId: string;
  changes?: object;      // { field: { old, new } }
  ipAddress?: string;
  userAgent?: string;
}) {
  await db.auditLog.create({ data: event });
}

// What to audit:
// ✅ Login success/failure
// ✅ Booking status changes
// ✅ Payment operations
// ✅ Manager CRUD operations
// ✅ Role changes
// ✅ Settings changes
// ✅ Data exports
// ✅ Client data modifications
```
