# Feature #15: Revenue Dashboard (Enhanced)

## Current Stats — What Exists Now

### Existing Backend
- **`GET /api/stats/:dateFrom/:dateTo`** (in `routes/settings.js`, line 12-27):
  - Returns raw booking rows for a date range
  - Filters: `linked_to IS NULL`, `status != 'cancelled'`
  - No aggregation on server side — all computation happens on the client
  - Mounted via `app.use('/api', settingsRouter)` in `server.js`

### Existing Frontend (`js/settings.js`, lines 861-1055)
- **`showDashboard()`** opens `#dashboardModal` (modal-wide)
- Loads 4 parallel API calls: today, week, month, year date ranges via `apiGetStats()`
- **Revenue cards**: 4-card grid (Сьогодні / Тиждень / Місяць / Рік) showing `formatPrice(calcRevenue(...))` and booking count
- **Top programs section**: Top 8 programs by booking count, with revenue per program
- **Category bars section**: CSS bar chart showing category distribution (% of total)
- **Period selector**: tabs for Місяць / Рік / Довільний, with custom date range picker
- `calcRevenue()` — filters `status === 'confirmed'`, sums `b.price || 0`

### Existing CSS (`css/features.css`, lines 244-491)
- `.dashboard-grid` — 4-column grid for revenue cards
- `.dash-card` — gradient cards with hover effects (4 color variants via nth-child)
- `.dash-period-tabs`, `.dash-tab` — period selector pills
- `.dash-custom-range` — date range inputs
- `.dash-list-item`, `.dash-rank`, `.dash-name`, `.dash-count`, `.dash-revenue` — top programs list
- `.dash-bar-row`, `.dash-bar-track`, `.dash-bar-fill` — CSS-only horizontal bar charts
- `.no-data` — empty state with emoji icon

### Available Data in DB

**`bookings` table** (key columns for analytics):
| Column | Type | Notes |
|--------|------|-------|
| `id` | VARCHAR(50) | Format: `BK-YYYY-NNNN` |
| `date` | VARCHAR(20) | `YYYY-MM-DD` string, NOT a DATE type |
| `time` | VARCHAR(10) | `HH:MM` string |
| `line_id` | VARCHAR(100) | Animator line reference |
| `program_id` | VARCHAR(50) | FK-like to products table |
| `program_code` | VARCHAR(20) | Short code (КВ1, АН, etc.) |
| `program_name` | VARCHAR(100) | Full program name |
| `category` | VARCHAR(50) | quest/animation/show/photo/masterclass/pinata/custom |
| `duration` | INTEGER | Minutes |
| `price` | INTEGER | Price in UAH (integer, no decimals) |
| `hosts` | INTEGER | Number of animators |
| `room` | VARCHAR(100) | Room name |
| `status` | VARCHAR(20) | confirmed/preliminary/cancelled |
| `linked_to` | VARCHAR(50) | Parent booking ID (for second-animator bookings) |
| `kids_count` | INTEGER | Number of children |
| `created_by` | VARCHAR(50) | Username |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |

**`products` table** (program catalog):
| Column | Type | Notes |
|--------|------|-------|
| `id` | VARCHAR(50) | e.g., `kv1`, `anim60` |
| `code` | VARCHAR(20) | КВ1, АН, Бульб... |
| `name` | VARCHAR(200) | Full name |
| `category` | VARCHAR(50) | Category |
| `duration` | INTEGER | Default duration |
| `price` | INTEGER | Catalog price (UAH) |
| `is_per_child` | BOOLEAN | Per-child pricing |
| `is_active` | BOOLEAN | Active in catalog |

**`lines_by_date` table**: Animator lines per date (for utilization).

**Existing indexes on bookings**: `idx_bookings_date`, `idx_bookings_date_status`, `idx_bookings_line_date`, `idx_bookings_linked_to`.

---

## New API Endpoints

### 1. `GET /api/stats/revenue`

**Purpose**: Aggregated revenue and booking counts, computed server-side instead of fetching all rows to the client.

**Parameters** (query string):
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | string | `month` | Preset: `day`, `week`, `month`, `year` |
| `from` | string | — | Custom start date `YYYY-MM-DD` (overrides `period`) |
| `to` | string | — | Custom end date `YYYY-MM-DD` (overrides `period`) |

**Response**:
```json
{
  "period": { "from": "2026-02-01", "to": "2026-02-28" },
  "totals": {
    "revenue": 128400,
    "count": 47,
    "average": 2731,
    "confirmedCount": 42,
    "preliminaryCount": 5,
    "confirmedRevenue": 118200
  },
  "comparison": {
    "prevRevenue": 105000,
    "prevCount": 38,
    "revenueGrowth": 22.3,
    "countGrowth": 23.7
  },
  "daily": [
    { "date": "2026-02-01", "revenue": 4500, "count": 2 },
    { "date": "2026-02-02", "revenue": 8200, "count": 3 }
  ]
}
```

**SQL query plan**:
```sql
-- Totals for current period
SELECT
  COALESCE(SUM(CASE WHEN status = 'confirmed' THEN price ELSE 0 END), 0) AS confirmed_revenue,
  COALESCE(SUM(price), 0) AS total_revenue,
  COUNT(*) AS total_count,
  COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed_count,
  COUNT(*) FILTER (WHERE status = 'preliminary') AS preliminary_count,
  ROUND(AVG(price)) AS avg_price
FROM bookings
WHERE date >= $1 AND date <= $2
  AND linked_to IS NULL
  AND status != 'cancelled';

-- Same query for previous period (for comparison)
-- Previous period is auto-computed: if current is Feb 1-28, previous is Jan 1-31

-- Daily breakdown
SELECT date,
  COALESCE(SUM(price), 0) AS revenue,
  COUNT(*) AS count
FROM bookings
WHERE date >= $1 AND date <= $2
  AND linked_to IS NULL
  AND status != 'cancelled'
GROUP BY date
ORDER BY date;
```

**Date range computation** (server-side, timezone `Europe/Kyiv`):
- `day` — today only
- `week` — Monday to Sunday of current week
- `month` — 1st to last day of current month
- `year` — Jan 1 to Dec 31 of current year

---

### 2. `GET /api/stats/programs`

**Purpose**: Program popularity and revenue rankings.

**Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `from` | string | 1st of current month | Start date |
| `to` | string | today | End date |
| `limit` | int | 10 | Max results per section |

**Response**:
```json
{
  "byCount": [
    { "programId": "kv1", "programName": "Легендарний тренд", "category": "quest", "count": 12, "revenue": 26400 },
    { "programId": "anim60", "programName": "Анімація 60хв", "category": "animation", "count": 9, "revenue": 13500 }
  ],
  "byRevenue": [
    { "programId": "kv7", "programName": "Гра в Кальмара", "category": "quest", "count": 7, "revenue": 23100 }
  ],
  "byCategory": [
    { "category": "quest", "categoryName": "Квести", "count": 28, "revenue": 72800, "pct": 34.5 },
    { "category": "animation", "categoryName": "Анімація", "count": 22, "revenue": 41000, "pct": 27.1 }
  ]
}
```

**SQL query plan**:
```sql
-- Top programs by booking count
SELECT program_id, program_name, category,
  COUNT(*) AS count,
  COALESCE(SUM(price), 0) AS revenue
FROM bookings
WHERE date >= $1 AND date <= $2
  AND linked_to IS NULL
  AND status = 'confirmed'
GROUP BY program_id, program_name, category
ORDER BY count DESC
LIMIT $3;

-- Top programs by revenue (same query, ORDER BY revenue DESC)

-- By category
SELECT category,
  COUNT(*) AS count,
  COALESCE(SUM(price), 0) AS revenue,
  ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER(), 0) * 100, 1) AS pct
FROM bookings
WHERE date >= $1 AND date <= $2
  AND linked_to IS NULL
  AND status = 'confirmed'
GROUP BY category
ORDER BY count DESC;
```

---

### 3. `GET /api/stats/load`

**Purpose**: Workload analytics — time-of-day heatmap, day-of-week distribution, room utilization, animator workload.

**Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `from` | string | 1st of current month | Start date |
| `to` | string | today | End date |

**Response**:
```json
{
  "byDayOfWeek": [
    { "day": 1, "dayName": "Понеділок", "count": 5, "revenue": 12000 },
    { "day": 6, "dayName": "Субота", "count": 18, "revenue": 52000 }
  ],
  "byHour": [
    { "hour": 10, "count": 3 },
    { "hour": 12, "count": 8 },
    { "hour": 14, "count": 12 },
    { "hour": 16, "count": 10 }
  ],
  "roomUtilization": [
    { "room": "Зал 1", "bookingCount": 22, "totalMinutes": 1540, "utilizationPct": 45.2 },
    { "room": "Зал 2", "bookingCount": 18, "totalMinutes": 1260, "utilizationPct": 37.1 }
  ],
  "animatorWorkload": [
    { "lineId": "line-1", "animatorName": "Віталіна", "bookingCount": 15, "totalMinutes": 900 },
    { "lineId": "line-2", "animatorName": "Даша", "bookingCount": 12, "totalMinutes": 780 }
  ]
}
```

**SQL query plan**:
```sql
-- Bookings by day of week
-- Note: date is VARCHAR 'YYYY-MM-DD', cast to DATE for EXTRACT
SELECT
  EXTRACT(ISODOW FROM date::date)::int AS day_num,
  COUNT(*) AS count,
  COALESCE(SUM(price), 0) AS revenue
FROM bookings
WHERE date >= $1 AND date <= $2
  AND linked_to IS NULL AND status = 'confirmed'
GROUP BY day_num
ORDER BY day_num;

-- Bookings by hour of day
-- time is VARCHAR 'HH:MM', extract hour via substring
SELECT
  CAST(SUBSTRING(time FROM 1 FOR 2) AS INTEGER) AS hour,
  COUNT(*) AS count
FROM bookings
WHERE date >= $1 AND date <= $2
  AND linked_to IS NULL AND status = 'confirmed'
GROUP BY hour
ORDER BY hour;

-- Room utilization
-- Total available minutes = business_days * (end_hour - start_hour) * 60
-- Weekday: 12-20 (480min), Weekend: 10-20 (600min)
SELECT room,
  COUNT(*) AS booking_count,
  COALESCE(SUM(duration), 0) AS total_minutes
FROM bookings
WHERE date >= $1 AND date <= $2
  AND linked_to IS NULL AND status = 'confirmed'
  AND room IS NOT NULL AND room != ''
GROUP BY room
ORDER BY total_minutes DESC;
-- Utilization % computed in JS: totalMinutes / (available_slots * slot_duration)

-- Animator workload (via lines_by_date join)
SELECT b.line_id,
  l.name AS animator_name,
  COUNT(*) AS booking_count,
  COALESCE(SUM(b.duration), 0) AS total_minutes
FROM bookings b
JOIN lines_by_date l ON b.line_id = l.line_id AND b.date = l.date
WHERE b.date >= $1 AND b.date <= $2
  AND b.linked_to IS NULL AND b.status = 'confirmed'
GROUP BY b.line_id, l.name
ORDER BY booking_count DESC;
```

---

### 4. `GET /api/stats/trends`

**Purpose**: Period-over-period comparison with growth percentages.

**Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | string | `month` | `week`, `month`, `year` |

**Response**:
```json
{
  "current": {
    "from": "2026-02-01", "to": "2026-02-14",
    "revenue": 68000, "count": 24, "average": 2833
  },
  "previous": {
    "from": "2026-01-01", "to": "2026-01-31",
    "revenue": 105000, "count": 38, "average": 2763
  },
  "growth": {
    "revenue": -35.2,
    "count": -36.8,
    "average": 2.5
  },
  "note": "Порівняння неповного періоду"
}
```

**Note**: This endpoint could be merged into `/api/stats/revenue` via the `comparison` field. If the team prefers a unified endpoint, the trends data will be included in the revenue response under `comparison`. Separate endpoint keeps concerns clean and allows independent caching.

**SQL**: Same queries as `/api/stats/revenue` but run for both current and previous period ranges.

---

## Route File & Mounting

**New file**: `routes/stats.js`

All 4 endpoints will be grouped in a single new route file:
```
routes/stats.js
  GET /revenue
  GET /programs
  GET /load
  GET /trends
```

**Mounting in `server.js`**:
```js
app.use('/api/stats', require('./routes/stats'));
```

The existing `GET /api/stats/:dateFrom/:dateTo` in `routes/settings.js` stays as-is for backward compatibility. New endpoints use `/api/stats/revenue`, `/api/stats/programs`, `/api/stats/load`, `/api/stats/trends` — no conflicts because existing route expects two path params (dates), new routes use fixed path segments.

---

## Frontend Dashboard — Enhanced

### Approach: CSS-Only Charts (No External Libraries)

**Decision**: CSS-only bar/pie charts. Rationale:
- The existing dashboard already uses CSS bar charts (`.dash-bar-fill` with `width: N%`), which work well
- Chart.js is ~60KB gzipped, adds a dependency to a zero-dependency vanilla JS SPA
- CSS-only charts match the existing design system (gradients, rounded corners, Nunito font)
- For the level of analytics needed (bar charts, horizontal bars, simple pie/donut), CSS is sufficient
- If complex interactive charts are needed later, Chart.js can be added incrementally

### New Metric Cards (top of dashboard)

Replace the current 4-card grid with a richer set of computed metrics:

| Card | Label (UA) | Value | Sub-text |
|------|-----------|-------|----------|
| 1 | Виручка | `128 400 ₴` | `+22% vs мин. міс.` (green/red arrow) |
| 2 | Бронювань | `47` | `42 підтв. / 5 попер.` |
| 3 | Середній чек | `2 731 ₴` | `+2.5% vs мин. міс.` |
| 4 | Завантаженість | `68%` | `Пік: Сб 14:00-16:00` |

**Implementation**: Use server-computed data from `/api/stats/revenue` and `/api/stats/load` instead of counting client-side.

### Period Selector Tabs (enhanced)

Keep existing tab design, add more granularity:
- Tabs: **Сьогодні** | **Тиждень** | **Місяць** | **Квартал** | **Рік** | **Довільний**
- Custom range: existing date pickers, already styled

### New Dashboard Sections

#### Section 1: Revenue Cards (existing, enhanced with growth arrows)
Same 4-card grid, now with comparison data.

```html
<div class="dash-card-sub">
  <span class="dash-trend dash-trend-up">+22%</span> vs мин. період
</div>
```

#### Section 2: Top Programs (existing, enhanced with revenue toggle)
- Toggle: "За кількістю" / "За виручкою" — two buttons above the list
- Existing `.dash-list-item` design reused

#### Section 3: Category Breakdown (existing CSS bars, enhanced)
- Existing `.dash-bar-row` + `.dash-bar-fill` design
- Add revenue column next to count

#### Section 4: Day-of-Week Heatmap (NEW)
CSS vertical bar chart showing booking counts per day of week:

```html
<div class="dash-weekday-chart">
  <div class="dash-weekday-bar" style="--pct: 25%">
    <div class="dash-weekday-fill"></div>
    <span class="dash-weekday-label">Пн</span>
    <span class="dash-weekday-count">5</span>
  </div>
  <!-- ... Вт, Ср, Чт, Пт, Сб, Нд -->
</div>
```

CSS implementation:
```css
.dash-weekday-chart {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  height: 120px;
  padding: 10px 0;
}
.dash-weekday-bar {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  justify-content: flex-end;
}
.dash-weekday-fill {
  width: 100%;
  height: calc(var(--pct) * 1%);
  background: linear-gradient(180deg, var(--primary), var(--primary-dark));
  border-radius: var(--radius-xs) var(--radius-xs) 0 0;
  min-height: 4px;
  transition: height 0.5s var(--ease-smooth);
}
```

#### Section 5: Time-of-Day Distribution (NEW)
Horizontal bar chart (reuse existing `.dash-bar-row` pattern) showing bookings per hour (10:00-20:00).

#### Section 6: Room Utilization (NEW)
Horizontal progress bars per room, showing `utilizationPct%`:

```html
<div class="dash-bar-row">
  <span class="dash-bar-label">Зал 1</span>
  <div class="dash-bar-track">
    <div class="dash-bar-fill" style="width: 72%"></div>
  </div>
  <span class="dash-bar-value">72%</span>
</div>
```

Reuses existing CSS classes entirely.

### Ukrainian Labels and Formatting

All labels are already in Ukrainian in the existing dashboard. New additions:
- `formatPrice()` already formats as `"1 000 ₴"` (from `js/config.js`, line 146)
- Day names: `DAYS` array in `js/config.js` (line 101) — `['Неділя', 'Понеділок', ...]`
- Category names: `CATEGORY_NAMES_SHORT` in `js/config.js` (line 137)
- New label strings:
  - "Виручка" (Revenue)
  - "Бронювань" (Bookings)
  - "Середній чек" (Average check)
  - "Завантаженість" (Load/utilization)
  - "Топ програм" (Top programs)
  - "Категорії" (Categories)
  - "По днях тижня" (By day of week)
  - "По годинах" (By hour)
  - "Завантаженість кімнат" (Room utilization)
  - "Навантаження аніматорів" (Animator workload)
  - "vs мин. період" (vs previous period)

---

## Layout

### Desktop (>768px)
```
┌─────────────────────────────────────────────────┐
│ 📊 Дашборд                                  [X] │
├─────────────────────────────────────────────────┤
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│ │Виручка│ │Бронюв│ │Сер.чек│ │Завант│ ← 4 cards │
│ │128 400₴│ │  47  │ │2 731₴│ │ 68% │            │
│ │ +22%  │ │      │ │ +2.5%│ │     │            │
│ └──────┘ └──────┘ └──────┘ └──────┘            │
│                                                 │
│ [Місяць] [Квартал] [Рік] [Довільний]    ← tabs  │
│                                                 │
│ 🏆 Топ програм (Місяць)                        │
│  1. Легендарний тренд    12x   26 400 ₴        │
│  2. Анімація 60хв         9x   13 500 ₴        │
│  ...                                            │
│                                                 │
│ 📊 Категорії (Місяць)                           │
│  Квести    ████████████░░░  28 (34%)            │
│  Анімація  █████████░░░░░░  22 (27%)            │
│  ...                                            │
│                                                 │
│ 📅 По днях тижня                                │
│       ▇                                         │
│    ▅  ▇     ▇                                   │
│  ▃ ▅  ▇  ▅  ▇  ▇                               │
│  Пн Вт Ср Чт Пт Сб Нд                         │
│                                                 │
│ 🕐 По годинах                                   │
│  10:00  ███░░░░░░░  3                           │
│  12:00  ████████░░  8                           │
│  14:00  ██████████  12                          │
│  ...                                            │
│                                                 │
│ 🏠 Завантаженість кімнат                        │
│  Зал 1   ███████░░░  72%                        │
│  Зал 2   ████░░░░░░  45%                        │
│  ...                                            │
└─────────────────────────────────────────────────┘
```

### Mobile (<768px)
- Revenue cards: 2x2 grid (existing `.dashboard-grid` already has responsive override in `css/responsive.css`)
- All sections stack vertically
- Day-of-week chart: bars become shorter (height: 80px)
- Tab pills: horizontal scroll if too many

### CSS Changes
- New classes to add in `css/features.css`:
  - `.dash-trend`, `.dash-trend-up`, `.dash-trend-down` — growth indicator arrows
  - `.dash-weekday-chart`, `.dash-weekday-bar`, `.dash-weekday-fill`, `.dash-weekday-label`, `.dash-weekday-count` — vertical bar chart
  - `.dash-toggle-group`, `.dash-toggle-btn` — toggle for "by count" / "by revenue"
- Responsive overrides in `css/responsive.css` for `.dash-weekday-chart`

---

## Performance

### Server-Side Caching (5-minute TTL)

Implement a simple in-memory cache for heavy aggregate queries:

```js
// In routes/stats.js
const statsCache = new Map();
const STATS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key) {
  const entry = statsCache.get(key);
  if (entry && Date.now() - entry.ts < STATS_CACHE_TTL) return entry.data;
  return null;
}

function setCache(key, data) {
  statsCache.set(key, { data, ts: Date.now() });
  // Cleanup: limit cache size
  if (statsCache.size > 50) {
    const oldest = [...statsCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    statsCache.delete(oldest[0]);
  }
}
```

**Cache key strategy**: `${endpoint}:${from}:${to}` (e.g., `revenue:2026-02-01:2026-02-28`).

**Cache invalidation**: Not needed for stats — 5-minute TTL is acceptable for dashboard data. Bookings change infrequently enough that stale data for up to 5 minutes is fine for analytics.

### Index Recommendations

Existing indexes that already help:
- `idx_bookings_date` — covers date range queries
- `idx_bookings_date_status` — covers date + status filter

**New indexes to add** (in `db/index.js` `initDatabase()`):

```sql
-- Composite index for stats queries (date range + linked_to IS NULL + status)
CREATE INDEX IF NOT EXISTS idx_bookings_stats
  ON bookings(date, status)
  WHERE linked_to IS NULL AND status != 'cancelled';

-- For room utilization queries
CREATE INDEX IF NOT EXISTS idx_bookings_room_date
  ON bookings(room, date)
  WHERE linked_to IS NULL AND status = 'confirmed';

-- For category breakdown
CREATE INDEX IF NOT EXISTS idx_bookings_category_date
  ON bookings(category, date)
  WHERE linked_to IS NULL AND status = 'confirmed';
```

**Note**: The `date` column is VARCHAR, not DATE. Ordering and range comparisons (`>=`, `<=`) work correctly on `YYYY-MM-DD` strings because they sort lexicographically identically to date order. No migration needed.

### Client-Side Optimizations

- The enhanced dashboard calls 4 new aggregate endpoints instead of fetching raw rows, reducing payload from ~100KB (hundreds of booking objects) to ~2KB (aggregated JSON)
- `apiGetStats()` (existing) still used for backward compat if needed, but new `apiGetRevenue()`, `apiGetPrograms()`, `apiGetLoad()` functions call the new aggregate endpoints
- Loading spinner already present in `showDashboard()`

---

## Cross-Dependencies

### 1. Product Prices
- **Status**: Products table already has `price INTEGER NOT NULL DEFAULT 0` — all products have prices
- **Risk**: Custom bookings (`program_id = 'custom'`) may have `price = 0`. The `calcRevenue()` function already handles this with `b.price || 0`
- **Action**: No migration needed

### 2. Booking Price Stored at Booking Time
- **Status**: The `bookings.price` column already stores the price at time of booking (not a reference to the product price). This is correct — if a product price changes later, historical bookings retain their original price.
- **Risk**: None. Verified in `routes/bookings.js` line 76: `b.price` is stored directly in the INSERT
- **Action**: No change needed

### 3. Per-Child Pricing
- **Status**: Some products (masterclasses) have `is_per_child = true` and are priced per child (e.g., 370 UAH/child). When booked, the `price` field in bookings stores the UNIT price, not the total.
- **Risk**: Revenue totals may be inaccurate if `price` stores per-child amount without multiplication by `kids_count`
- **Investigation needed**: Check how the booking form calculates price for per-child products. If `price` = unit price, revenue needs: `SUM(CASE WHEN is_per_child_flag THEN price * COALESCE(kids_count, 1) ELSE price END)`
- **Fallback**: If the price in `bookings.price` is already the total (multiplied by kids_count at booking time), no change needed. **This must be verified before implementation**.

### 4. Linked Bookings (Second Animator)
- **Status**: Linked bookings (`linked_to IS NOT NULL`) are already excluded from stats queries. This is correct — the parent booking contains the price; the linked booking is just a slot reservation for the second animator.
- **Action**: All new queries include `AND linked_to IS NULL`

### 5. Cancelled Bookings
- **Status**: Cancelled bookings (`status = 'cancelled'`) are excluded from stats. Soft-delete via `status = 'cancelled'` means the row persists but is filtered.
- **Action**: All new queries include `AND status != 'cancelled'` (or `AND status = 'confirmed'` for revenue-specific queries)

### 6. Date Format
- **Status**: Dates are stored as VARCHAR `YYYY-MM-DD`. PostgreSQL can cast `VARCHAR` to `DATE` for `EXTRACT(DOW ...)`, but range comparisons on the string work correctly.
- **Risk**: None for stats. The `EXTRACT(ISODOW FROM date::date)` cast may fail if any row has an invalid date string.
- **Mitigation**: Use `WHERE date ~ '^\d{4}-\d{2}-\d{2}$'` or rely on the existing `validateDate()` that ensures format on insert.

### 7. Dashboard Access Control
- **Status**: `showDashboard()` has `if (isViewer()) return;` — viewers are excluded
- **Action**: New API endpoints should also respect roles. Add role check in the route or rely on the existing `authenticateToken` middleware. Stats endpoints should be accessible to `admin` and `user` roles, not `viewer`.

---

## Implementation Plan (ordered steps)

### Step 1: New Route File `routes/stats.js`
- Create `routes/stats.js` with all 4 endpoints
- Add server-side date range computation
- Add in-memory cache layer
- Mount in `server.js` as `app.use('/api/stats', authenticateToken, require('./routes/stats'))`

### Step 2: Database Indexes
- Add 3 new partial indexes in `db/index.js` `initDatabase()`

### Step 3: Frontend API Functions
- Add `apiGetRevenue()`, `apiGetPrograms()`, `apiGetLoad()`, `apiGetTrends()` in `js/api.js`

### Step 4: Enhanced Dashboard Rendering
- Update `showDashboard()` to call new endpoints
- Update `renderRevenueCards()` to include growth indicators
- Add `renderWeekdayChart()`, `renderHourlyChart()`, `renderRoomUtilization()`, `renderAnimatorWorkload()`
- Add toggle for top programs (by count / by revenue)
- Keep backward compatibility: if new endpoints fail, fall back to existing `apiGetStats()` behavior

### Step 5: CSS Additions
- Add new CSS classes in `css/features.css`
- Add responsive overrides in `css/responsive.css`

### Step 6: Verify Per-Child Pricing
- Test with masterclass bookings to confirm what value `bookings.price` stores
- Adjust revenue calculation if needed

### Estimated Files Changed
| File | Change |
|------|--------|
| `routes/stats.js` | **NEW** (~200 lines) |
| `server.js` | 1 line (mount route) |
| `db/index.js` | 3 lines (new indexes) |
| `js/api.js` | ~40 lines (4 new API functions) |
| `js/settings.js` | ~150 lines (enhanced dashboard rendering) |
| `css/features.css` | ~60 lines (new chart styles) |
| `css/responsive.css` | ~15 lines (mobile overrides) |
