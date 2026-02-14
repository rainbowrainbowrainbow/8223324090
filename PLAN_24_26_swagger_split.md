# Plan: Feature #24 (Swagger/OpenAPI) + Feature #26 (Split Large Files)

---

## Feature #24: Swagger/OpenAPI Documentation

### Approach

- Add `swagger-jsdoc` (parse JSDoc comments into OpenAPI spec) + `swagger-ui-express` (serve interactive UI)
- Write JSDoc `@openapi` / `@swagger` annotations directly in each route file
- Serve Swagger UI at `GET /api-docs`
- Serve raw JSON spec at `GET /api-docs.json` (useful for Postman/Insomnia import)
- Create a dedicated `swagger.js` config file (keeps `server.js` slim)
- Auth: document Bearer JWT token via `securitySchemes`

### Package Installation

```bash
npm install swagger-jsdoc swagger-ui-express
```

### Swagger Config (`swagger.js`)

Create `/swagger.js` with:

```js
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Парк Закревського Періоду — Booking API',
      version: '8.6.1',
      description: 'REST API для системи бронювання дитячого розважального парку'
    },
    servers: [
      { url: '/api', description: 'API base' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      },
      schemas: {
        // Booking, Line, Product, HistoryItem, AfishaEvent,
        // Task, TaskTemplate, StaffMember, StaffSchedule,
        // Certificate, Setting, AutomationRule, etc.
      }
    },
    security: [{ bearerAuth: [] }]
  },
  apis: ['./routes/*.js']
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = { swaggerUi, swaggerSpec };
```

### Mount in `server.js`

Add these lines after the existing middleware block (before route mounts):

```js
const { swaggerUi, swaggerSpec } = require('./swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));
```

The `/api-docs` path is NOT under `/api`, so it will not be subject to rate limiting or JWT auth middleware.

---

### Complete Endpoint Catalog

Below is every endpoint discovered across all 13 route files, grouped by tag.

#### Tag: Auth (`routes/auth.js`, mounted at `/api/auth`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/auth/login` | User login (returns JWT token) | No |
| GET | `/api/auth/verify` | Verify token / get current user | Yes |

#### Tag: Bookings (`routes/bookings.js`, mounted at `/api/bookings`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/bookings/:date` | Get all bookings for a date (YYYY-MM-DD) | Yes |
| POST | `/api/bookings` | Create a single booking | Yes |
| POST | `/api/bookings/full` | Create booking with linked bookings (transactional) | Yes |
| PUT | `/api/bookings/:id` | Update booking by ID (BK-YYYY-NNNN) | Yes |
| DELETE | `/api/bookings/:id` | Soft-delete (or permanent with `?permanent=true`) | Yes |

#### Tag: Lines (`routes/lines.js`, mounted at `/api/lines`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/lines/:date` | Get animator lines for a date | Yes |
| POST | `/api/lines/:date` | Save/replace animator lines for a date | Yes |

#### Tag: History (`routes/history.js`, mounted at `/api/history`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/history` | Get action history (with filters: action, user, from, to, search, limit, offset) | Yes |
| POST | `/api/history` | Add history entry | Yes |

#### Tag: Afisha (`routes/afisha.js`, mounted at `/api/afisha`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/afisha` | Get all afisha events (optional `?type=event\|birthday\|regular`) | Yes |
| GET | `/api/afisha/templates/list` | List recurring afisha templates | Yes |
| POST | `/api/afisha/templates` | Create recurring afisha template | Yes |
| PUT | `/api/afisha/templates/:id` | Update afisha template | Yes |
| DELETE | `/api/afisha/templates/:id` | Delete afisha template | Yes |
| GET | `/api/afisha/distribute/:date` | Preview fair distribution of events to animators | Yes |
| POST | `/api/afisha/distribute/:date` | Execute auto-distribution (persist assignments) | Yes |
| POST | `/api/afisha/undistribute/:date` | Reset distribution (clear line_id, restore original times) | Yes |
| GET | `/api/afisha/:date` | Get afisha events for a specific date | Yes |
| POST | `/api/afisha` | Create afisha event | Yes |
| PUT | `/api/afisha/:id` | Update afisha event | Yes |
| POST | `/api/afisha/:id/generate-tasks` | Generate tasks from afisha event | Yes |
| PATCH | `/api/afisha/:id/time` | Quick time update (drag-to-move) | Yes |
| DELETE | `/api/afisha/:id` | Delete afisha event (cascades todo tasks) | Yes |

#### Tag: Telegram (`routes/telegram.js`, mounted at `/api/telegram`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/telegram/chats` | List known Telegram chats | Yes |
| GET | `/api/telegram/threads` | List known threads/topics for a chat | Yes |
| POST | `/api/telegram/notify` | Send text notification to configured chat | Yes |
| GET | `/api/telegram/digest/:date` | Build and send daily digest for date | Yes |
| GET | `/api/telegram/reminder/:date` | Send tomorrow reminder for date | Yes |
| POST | `/api/telegram/ask-animator` | Send animator request via Telegram (inline keyboard) | Yes |
| GET | `/api/telegram/animator-status/:id` | Check pending animator request status | Yes |
| POST | `/api/telegram/webhook` | Telegram webhook handler (callback queries, commands) | No (secret token) |

#### Tag: Backup (`routes/backup.js`, mounted at `/api/backup`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/backup/create` | Create and send backup to Telegram | Yes |
| GET | `/api/backup/download` | Download backup as SQL file | Yes |
| POST | `/api/backup/restore` | Restore from SQL (INSERT/DELETE only) | Yes |

#### Tag: Products (`routes/products.js`, mounted at `/api/products`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/products` | List all products (optional `?active=true`) | Yes |
| GET | `/api/products/:id` | Get single product by ID | Yes |
| POST | `/api/products` | Create new product | Yes (admin/manager) |
| PUT | `/api/products/:id` | Update product | Yes (admin/manager) |
| DELETE | `/api/products/:id` | Soft-delete (deactivate) product | Yes (admin) |

#### Tag: Tasks (`routes/tasks.js`, mounted at `/api/tasks`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/tasks` | List tasks (filters: status, date, date_from, date_to, assigned_to, afisha_id, type, category) | Yes |
| GET | `/api/tasks/:id` | Get single task | Yes |
| POST | `/api/tasks` | Create task | Yes |
| PUT | `/api/tasks/:id` | Full update task | Yes |
| PATCH | `/api/tasks/:id/status` | Quick status change (todo/in_progress/done) | Yes |
| DELETE | `/api/tasks/:id` | Delete task | Yes |

#### Tag: Task Templates (`routes/task-templates.js`, mounted at `/api/task-templates`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/task-templates` | List all task templates (optional `?active=true`) | Yes |
| POST | `/api/task-templates` | Create recurring task template | Yes |
| PUT | `/api/task-templates/:id` | Update task template | Yes |
| DELETE | `/api/task-templates/:id` | Delete task template | Yes |

#### Tag: Staff (`routes/staff.js`, mounted at `/api/staff`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/staff/departments` | List department names | Yes |
| GET | `/api/staff/schedule` | Get schedule for date range (`?from=&to=`) | Yes |
| PUT | `/api/staff/schedule` | Upsert single schedule entry | Yes |
| POST | `/api/staff/schedule/bulk` | Upsert multiple schedule entries | Yes |
| POST | `/api/staff/schedule/copy-week` | Copy schedule from one week to another | Yes |
| GET | `/api/staff/schedule/hours` | Calculate worked hours for date range | Yes |
| GET | `/api/staff/schedule/check/:date` | Check animator availability on a date | Yes |
| GET | `/api/staff` | List all staff (optional `?department=&active=`) | Yes |
| POST | `/api/staff` | Create new employee | Yes |
| PUT | `/api/staff/:id` | Update employee | Yes |
| DELETE | `/api/staff/:id` | Delete employee | Yes |

#### Tag: Certificates (`routes/certificates.js`, mounted at `/api/certificates`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/certificates` | List certificates (filters: status, search, limit, offset) | Yes |
| GET | `/api/certificates/qr/:code` | Generate QR code deep link for certificate | Yes |
| GET | `/api/certificates/code/:code` | Find certificate by cert_code | Yes |
| GET | `/api/certificates/:id` | Get single certificate | Yes |
| POST | `/api/certificates` | Create new certificate | Yes (admin/user) |
| POST | `/api/certificates/batch` | Batch-generate N blank certificates | Yes (admin/user) |
| PATCH | `/api/certificates/:id/status` | Change certificate status | Yes (admin/user) |
| PUT | `/api/certificates/:id` | Update certificate details | Yes (admin/user) |
| DELETE | `/api/certificates/:id` | Delete certificate | Yes (admin/user) |
| POST | `/api/certificates/:id/send-image` | Send certificate image to Telegram | Yes (admin/user) |

#### Tag: Settings (`routes/settings.js`, mounted at `/api` directly)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/stats/:dateFrom/:dateTo` | Get booking stats for date range | Yes |
| GET | `/api/settings/:key` | Get setting value by key | Yes |
| POST | `/api/settings` | Create/update setting (key + value) | Yes |
| GET | `/api/rooms/free/:date/:time/:duration` | Get free rooms for time slot | Yes |
| GET | `/api/health` | Health check (DB connectivity) | No |
| GET | `/api/automation-rules` | List automation rules | Yes |
| POST | `/api/automation-rules` | Create automation rule | Yes |
| PUT | `/api/automation-rules/:id` | Update automation rule | Yes |
| DELETE | `/api/automation-rules/:id` | Delete automation rule | Yes |

**Total: 77 endpoints across 13 route files.**

---

### JSDoc Format Example

Each route endpoint gets a JSDoc block like this:

```js
/**
 * @openapi
 * /bookings/{date}:
 *   get:
 *     tags: [Bookings]
 *     summary: Get all bookings for a date
 *     parameters:
 *       - in: path
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-02-14"
 *     responses:
 *       200:
 *         description: Array of bookings
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Booking'
 *       400:
 *         description: Invalid date format
 *     security:
 *       - bearerAuth: []
 */
router.get('/:date', async (req, res) => { ... });
```

### Key Schemas to Define

1. **Booking** -- id, date, time, lineId, programId, programCode, label, programName, category, duration, price, hosts, secondAnimator, pinataFiller, costume, room, notes, createdBy, createdAt, status, kidsCount, groupName, extraData, linkedTo, updatedAt
2. **Line** -- id, name, color, fromSheet
3. **Product** -- id, code, label, name, icon, category, duration, price, hosts, ageRange, kidsCapacity, description, isPerChild, hasFiller, isCustom, isActive, sortOrder
4. **HistoryItem** -- id, action, user, data (JSON), timestamp
5. **AfishaEvent** -- id, date, time, title, duration, type, description, template_id, original_time, line_id
6. **AfishaTemplate** -- id, title, time, duration, type, description, recurrence_pattern, recurrence_days, date_from, date_to, is_active
7. **Task** -- id, title, description, date, status, priority, assigned_to, created_by, type, template_id, afisha_id, category, completed_at
8. **TaskTemplate** -- id, title, description, priority, category, assignedTo, recurrencePattern, recurrenceDays, isActive
9. **StaffMember** -- id, name, department, position, phone, hire_date, is_active, color, telegram_username
10. **StaffSchedule** -- id, staff_id, date, shift_start, shift_end, status, note
11. **Certificate** -- id, certCode, displayMode, displayValue, typeText, validUntil, issuedAt, issuedByUserId, issuedByName, status, usedAt, invalidatedAt, invalidReason, notes, season, telegramAlertSent
12. **Setting** -- key (string), value (string)
13. **AutomationRule** -- id, name, trigger_type, trigger_condition (JSON), actions (JSON), days_before, is_active
14. **LoginRequest** -- username, password
15. **LoginResponse** -- token, user (username, role, name)
16. **ErrorResponse** -- error (string)
17. **SuccessResponse** -- success (boolean)

### Auth Requirement Markers

- **No auth**: `POST /api/auth/login`, `GET /api/health`, `POST /api/telegram/webhook`
- **Auth required (any role)**: Most GET endpoints
- **Admin/Manager**: `POST/PUT/DELETE /api/products`
- **Admin/User**: All certificate mutation endpoints
- **Admin only**: Settings Telegram section, automation rules (enforced in frontend only)

### Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `swagger-jsdoc` and `swagger-ui-express` to dependencies |
| `swagger.js` (NEW) | Swagger config, schema definitions, export spec |
| `server.js` | Mount `/api-docs` and `/api-docs.json` (3 lines) |
| `routes/auth.js` | Add JSDoc for 2 endpoints |
| `routes/bookings.js` | Add JSDoc for 5 endpoints |
| `routes/lines.js` | Add JSDoc for 2 endpoints |
| `routes/history.js` | Add JSDoc for 2 endpoints |
| `routes/afisha.js` | Add JSDoc for 14 endpoints |
| `routes/telegram.js` | Add JSDoc for 8 endpoints |
| `routes/backup.js` | Add JSDoc for 3 endpoints |
| `routes/products.js` | Add JSDoc for 5 endpoints |
| `routes/tasks.js` | Add JSDoc for 6 endpoints |
| `routes/task-templates.js` | Add JSDoc for 4 endpoints |
| `routes/staff.js` | Add JSDoc for 11 endpoints |
| `routes/certificates.js` | Add JSDoc for 10 endpoints |
| `routes/settings.js` | Add JSDoc for 9 endpoints |

### Implementation Order

1. Install packages, create `swagger.js`
2. Mount in `server.js`
3. Define all schemas in `swagger.js`
4. Add JSDoc to route files (start with `auth.js`, `bookings.js` -- highest value)
5. Test at `/api-docs`
6. Iterate on remaining route files

---

## Feature #26: Split Large Files

### Current State

| File | Lines | Size |
|------|-------|------|
| `js/booking.js` | 1,264 lines | Booking panel, form, create, details, edit, duplicate, delete, time shift, line switch |
| `js/settings.js` | 2,681 lines | History, programs catalog, lines/animators, Telegram, settings, dashboard, afisha, tasks, improvements, automation, certificates |

Current `index.html` script loading order:
```html
<script src="js/config.js?v=8.6.1"></script>
<script src="js/api.js?v=8.6.1"></script>
<script src="js/ui.js?v=8.6.1"></script>
<script src="js/auth.js?v=8.6.1"></script>
<script src="js/timeline.js?v=8.6.1"></script>
<script src="js/booking.js?v=8.6.1"></script>
<script src="js/settings.js?v=8.6.2"></script>
<script src="js/app.js?v=8.6.1"></script>
```

All functions are in the **global namespace** (no module system). Files depend on functions from earlier scripts.

---

### js/booking.js Analysis (1,264 lines)

#### Logical Sections Identified

| Section | Line Range | Lines | Functions |
|---------|-----------|-------|-----------|
| **Booking Panel (open/close/UI)** | 1-178 | 178 | `openBookingPanel()`, `showFreeRooms()`, `closeBookingPanel()`, `renderProgramIcons()`, `filterPrograms()` |
| **Program Selection** | 202-365 | 164 | `selectProgram()`, `populateAnimatorSelectById()`, `populateSecondAnimatorSelect()`, `populateExtraHostAnimatorSelect()`, `resolveSecondAnimatorSelect()`, `updateCustomDuration()` |
| **Booking Creation (validation + submit)** | 367-708 | 342 | `getBookingFormData()`, `validateBookingConflicts()`, `checkDuplicateProgram()`, `buildBookingObject()`, `buildExtraData()`, `buildLinkedBookings()`, `checkAnimatorAvailability()`, `STATUS_LABELS_BOOKING`, `unlockSubmitBtn()`, `handleBookingSubmit()`, `checkConflicts()` |
| **Booking Details Modal** | 742-895 | 154 | `generateBookingHeaderGradient()`, `getCategoryIcon()`, `showBookingDetails()` |
| **Edit Booking** | 897-971 | 75 | `editBooking()` |
| **Duplicate Booking** | 973-1041 | 69 | `duplicateBooking()` |
| **Invite Helpers** | 1043-1078 | 36 | `copyInviteLink()`, `shareInviteLink()` |
| **Delete Booking** | 1080-1132 | 53 | `deleteBooking()` |
| **Time Shift** | 1134-1219 | 86 | `shiftBookingTime()` |
| **Line Switch** | 1221-1265 | 45 | `switchBookingLine()` |

#### Proposed Split

| New File | Sections Included | Approx Lines | Description |
|----------|-------------------|--------------|-------------|
| `js/booking-panel.js` | Panel UI + Program Selection | ~342 | Opening/closing panel, program icons, program selection, free rooms, animators dropdowns |
| `js/booking-form.js` | Creation + Validation | ~342 | Form data extraction, conflict validation, duplicate checks, building booking objects, submit handler |
| `js/booking-details.js` | Details + Edit + Duplicate + Invite + Delete + Shift + Switch | ~518 | Detail modal, edit mode, duplicate mode, invite links, delete, time shift, line switch |

Alternatively, a simpler 2-file split:

| New File | Content | Lines |
|----------|---------|-------|
| `js/booking-panel.js` | Panel + Programs + Form + Validation + Submit (lines 1-740) | ~740 |
| `js/booking-actions.js` | Details + Edit + Duplicate + Invite + Delete + Shift + Switch (lines 742-1265) | ~524 |

**Recommendation**: Use the 2-file split. Simpler, fewer cross-references, clearer boundary.

#### Shared State / Cross-Dependencies

- `AppState.selectedDate`, `AppState.editingBookingId`, `AppState.cachedBookings`, `AppState.currentUser` -- all from `config.js` (global)
- `formatDate()`, `addMinutesToTime()`, `timeToMinutes()`, `formatPrice()`, `escapeHtml()`, `showNotification()`, `showWarning()`, `customConfirm()` -- from `ui.js`
- `getAuthHeaders()`, `handleAuthError()` -- from `api.js`
- `getLinesForDate()`, `getBookingsForDate()`, `saveLinesForDate()` -- from `api.js`
- `getProducts()`, `getProductsSync()` -- from `api.js`
- `apiCreateBooking()`, `apiCreateBookingFull()`, `apiUpdateBooking()`, `apiDeleteBooking()`, `apiAddHistory()` -- from `api.js`
- `renderTimeline()` -- from `timeline.js`
- `closeAllModals()`, `isViewer()`, `isAdmin()` -- from `ui.js` or `auth.js`
- `CONFIG`, `DAYS`, `CATEGORY_ORDER_BOOKING`, `CATEGORY_NAMES_BOOKING`, `CATEGORY_NAMES` -- from `config.js`
- `pushUndo()` -- from `ui.js` or `app.js`
- Cross-calls between sections: `editBooking()` calls `openBookingPanel()` + `selectProgram()`, `duplicateBooking()` calls `openBookingPanel()` + `selectProgram()`

All dependencies are resolved via global scope, so as long as load order is correct, no changes are needed beyond splitting the file and updating script tags.

---

### js/settings.js Analysis (2,681 lines)

#### Logical Sections Identified

| Section | Line Range | Lines | Functions |
|---------|-----------|-------|-----------|
| **History** | 1-124 | 124 | `showHistory()`, `getHistoryFilters()`, `loadHistoryPage()`, `HISTORY_PAGE_SIZE`, `historyCurrentOffset` |
| **Programs Catalog** | 126-313 | 188 | `showProgramsCatalog()`, `openProductForm()`, `saveProduct()`, `deleteProduct()` |
| **Lines / Animators** | 315-516 | 202 | `showNoteModal()`, `cleanupPendingPoll()`, `addNewLine()`, `editLineModal()`, `getSavedAnimators()`, `saveAnimatorsList()`, `showAnimatorsModal()`, `populateAnimatorsSelect()`, `handleEditLine()`, `deleteLine()` |
| **Telegram Notifications** | 518-677 | 160 | `handleTelegramResult()`, `notifyBookingCreated()`, `notifyBookingDeleted()`, `notifyBookingEdited()`, `notifyStatusChanged()`, `sendDailyDigest()`, `fetchAndRenderTelegramChats()`, `fetchAndRenderThreads()`, `showTelegramSetup()`, `saveTelegramChatId()` |
| **Settings UI** | 680-858 | 179 | `showSettings()`, `saveDigestTime()`, `sendTestDigest()`, `sendTestReminder()`, `saveAnimatorsListFromSettings()`, `saveTelegramChatIdFromSettings()`, `saveThreadIdFromSettings()` |
| **Dashboard** | 860-1055 | 196 | `getDashboardDateRanges()`, `calcRevenue()`, `renderRevenueCards()`, `renderTopProgramsSection()`, `renderCategoryBarsSection()`, `dashboardPeriod`, `dashboardAllData`, `showDashboard()`, `renderDashboardContent()`, `switchDashboardPeriod()`, `loadDashboardCustomRange()` |
| **Afisha (events CRUD + UI)** | 1057-1575 | 519 | `apiGetAfisha()`, `apiGetAfishaByDate()`, `apiCreateAfisha()`, `apiDeleteAfisha()`, `apiUpdateAfisha()`, `shiftAfishaItem()`, `editAfishaItem()`, `handleAfishaEditSubmit()`, `showAfishaModal()`, `renderAfishaList()`, `addAfishaItem()`, `deleteAfishaItem()`, `generateTasksForAfisha()`, `autoPositionAfisha()`, `exportAfishaBulk()`, `importAfishaBulk()`, `loadAfishaTemplates()`, `renderAfishaTemplates()`, `addAfishaTemplate()`, `toggleAfishaTemplate()`, `deleteAfishaTemplate()` |
| **Tasks (CRUD + UI)** | 1577-1804 | 228 | `apiGetTasks()`, `apiCreateTask()`, `apiUpdateTask()`, `apiChangeTaskStatus()`, `apiDeleteTask()`, `showTasksModal()`, `renderTasksList()`, `addTask()`, `cycleTaskStatus()`, `editTask()`, `handleTaskEditSubmit()`, `deleteTask()` |
| **Improvements** | 1806-1842 | 37 | `showImprovementFab()`, `handleImprovementSubmit()` |
| **Automation Rules** | 1844-1987 | 144 | `renderAutomationRules()`, `toggleAutomationRule()`, `deleteAutomationRule()`, `showAddAutomationRule()`, `handleAutomationRuleSubmit()` |
| **Certificates** | 1989-2681 | 693 | `debounceCertSearch()`, `openCertificatesPanel()`, `closeCertificatesPanel()`, `loadCertificates()`, `renderCertStats()`, `getCertStatusBadge()`, `showCreateCertificateModal()`, `showBatchCertificateModal()`, `handleBatchCertSubmit()`, `copyBatchCodes()`, `onCertDisplayModeChange()`, `onCertTypePresetChange()`, `initCertSeasonButtons()`, `handleCertificateSubmit()`, `sendCertImageToTelegram()`, `showCertDetail()`, `changeCertStatus()`, `deleteCertificate()`, `copyCertCode()`, `copyCertText()`, `CERT_SEASON_BG`, `_certBgCache`, `getCertCurrentSeason()`, `loadCertBg()`, `certRoundRect()`, `generateCertificateCanvas()`, `drawCertDynamicContent()`, `drawCertQRCode()`, `downloadCertificateImage()` |

#### Proposed Split (5 files)

| New File | Sections | Lines | Description |
|----------|----------|-------|-------------|
| `js/settings-history.js` | History + Lines/Animators + Settings UI + Dashboard | ~701 | History viewer, animator management, settings panel, dashboard/stats |
| `js/settings-telegram.js` | Telegram Notifications | ~160 | All Telegram notification builders and setup |
| `js/settings-afisha.js` | Afisha (events + templates) | ~519 | Afisha CRUD, import/export, recurring templates |
| `js/settings-tasks.js` | Tasks + Improvements + Automation | ~409 | Task CRUD, improvement suggestions, automation rules |
| `js/settings-certificates.js` | Certificates | ~693 | Certificate panel, CRUD, image generation, QR, batch |

Alternatively, a simpler 3-file split:

| New File | Content | Lines |
|----------|---------|-------|
| `js/settings-core.js` | History + Programs Catalog + Lines + Telegram + Settings UI + Dashboard (lines 1-1055) | ~1,055 |
| `js/settings-afisha.js` | Afisha + Tasks + Improvements + Automation (lines 1057-1987) | ~931 |
| `js/settings-certificates.js` | Certificates (lines 1989-2681) | ~693 |

**Recommendation**: Use the 3-file split. The certificate section (693 lines) is self-contained and the largest logical unit. Afisha+Tasks share the `apiGet/Create/Update/Delete` pattern. Core settings functions are tightly coupled.

#### Shared State / Cross-Dependencies

- `AppState`, `API_BASE`, `CONFIG` -- from `config.js`
- `formatDate()`, `escapeHtml()`, `showNotification()`, `customConfirm()`, `closeAllModals()`, `formatPrice()`, `timeToMinutes()`, `minutesToTime()`, `addMinutesToTime()` -- from `ui.js`
- `getAuthHeaders()`, `handleAuthError()`, `getBookingsForDate()`, `getLinesForDate()`, `saveLinesForDate()` -- from `api.js`
- `renderTimeline()` -- from `timeline.js`
- `apiGetSetting()`, `apiSaveSetting()`, `apiTelegramNotify()`, `apiGetStats()` etc. -- from `api.js`
- `CATEGORY_ORDER_CATALOG`, `CATEGORY_NAMES_CATALOG`, `CATEGORY_ICONS_CATALOG`, `CATEGORY_NAMES_SHORT` -- from `config.js`
- `renderPendingLine()`, `removePendingLine()`, `updatePendingLineTimer()` -- from `timeline.js`
- `canViewHistory()`, `canManageProducts()`, `isAdmin()`, `isViewer()` -- from `auth.js`
- Cross-calls:
  - `showSettings()` calls `fetchAndRenderTelegramChats()`, `fetchAndRenderThreads()`, `renderAutomationRules()`
  - `addAfishaItem()` calls `getBookingsForDate()`
  - `handleCertificateSubmit()` calls `sendCertImageToTelegram()` which calls `generateCertificateCanvas()`
  - `apiGetAfisha()` (in afisha section) used by dashboard could be needed; but dashboard calls `apiGetStats()` from `api.js`, not afisha API functions

All resolved via global scope. Load order ensures earlier files available to later ones.

---

### Migration Strategy

#### 1. Script Tag Updates in `index.html`

**Load order must be preserved**. New files replace their parent and must maintain position:

```html
<!-- Before (2 files) -->
<script src="js/booking.js?v=8.6.1"></script>
<script src="js/settings.js?v=8.6.2"></script>

<!-- After (5 files, same position in order) -->
<script src="js/booking-panel.js?v=8.7.0"></script>
<script src="js/booking-actions.js?v=8.7.0"></script>
<script src="js/settings-core.js?v=8.7.0"></script>
<script src="js/settings-afisha.js?v=8.7.0"></script>
<script src="js/settings-certificates.js?v=8.7.0"></script>
```

Critical load order constraints:
- `booking-panel.js` must load BEFORE `booking-actions.js` (actions call `openBookingPanel()`, `selectProgram()`)
- `settings-core.js` must load BEFORE `settings-afisha.js` (afisha uses `getSavedAnimators()`, Telegram helpers)
- `settings-afisha.js` must load BEFORE `settings-certificates.js` (no direct dependency, but consistent ordering)
- ALL new files must load AFTER `timeline.js` (uses `renderTimeline()`)
- ALL new files must load BEFORE `app.js` (app.js initializes everything)

#### 2. Cache Busting

All new files get fresh `?v=` parameter matching the next version:
```
?v=8.7.0
```

Update ALL CSS and JS tags to the new version simultaneously (per project versioning workflow).

#### 3. No Broken References

Since all functions are global:
- No `import`/`export` statements needed
- No `require()` needed
- Just ensure correct `<script>` order
- Verify no function is called before its script loads

#### 4. Global Namespace Management

Current approach: all functions are global. This works because:
- Functions don't collide (unique names like `showBookingDetails`, `showCertDetail`)
- State is in `AppState` (single global object from `config.js`)
- Module-level variables (`HISTORY_PAGE_SIZE`, `dashboardPeriod`, `certSearchTimeout`, etc.) become global in their respective new files

No namespace changes needed. Keep the existing pattern for now.

#### 5. Standalone Pages

Check if `tasks.html`, `programs.html`, `staff.html` reference `settings.js` directly. If yes, update their script tags too. These pages likely have their own script loading and may not use settings.js functions, but verify.

---

### Cross-Dependencies Between #24 and #26

These features are independent on the backend vs frontend axis:
- **#24 (Swagger)** modifies only backend files (`routes/*.js`, `server.js`, `package.json`, new `swagger.js`)
- **#26 (Split)** modifies only frontend files (`js/*.js`, `index.html`)

No conflicts. Can be implemented in parallel or in any order.

---

### Implementation Checklist

#### Feature #24: Swagger
- [ ] `npm install swagger-jsdoc swagger-ui-express`
- [ ] Create `swagger.js` with OpenAPI 3.0 config + all 17 schemas
- [ ] Add 3 lines to `server.js` for mounting
- [ ] Add JSDoc `@openapi` blocks to `routes/auth.js` (2 endpoints)
- [ ] Add JSDoc to `routes/bookings.js` (5 endpoints)
- [ ] Add JSDoc to `routes/lines.js` (2 endpoints)
- [ ] Add JSDoc to `routes/history.js` (2 endpoints)
- [ ] Add JSDoc to `routes/afisha.js` (14 endpoints)
- [ ] Add JSDoc to `routes/telegram.js` (8 endpoints)
- [ ] Add JSDoc to `routes/backup.js` (3 endpoints)
- [ ] Add JSDoc to `routes/products.js` (5 endpoints)
- [ ] Add JSDoc to `routes/tasks.js` (6 endpoints)
- [ ] Add JSDoc to `routes/task-templates.js` (4 endpoints)
- [ ] Add JSDoc to `routes/staff.js` (11 endpoints)
- [ ] Add JSDoc to `routes/certificates.js` (10 endpoints)
- [ ] Add JSDoc to `routes/settings.js` (9 endpoints)
- [ ] Verify `/api-docs` renders correctly
- [ ] Run existing tests to confirm no regressions

#### Feature #26: Split Files
- [ ] Create `js/booking-panel.js` (lines 1-740 from booking.js)
- [ ] Create `js/booking-actions.js` (lines 742-1265 from booking.js)
- [ ] Create `js/settings-core.js` (lines 1-1055 from settings.js)
- [ ] Create `js/settings-afisha.js` (lines 1057-1987 from settings.js)
- [ ] Create `js/settings-certificates.js` (lines 1989-2681 from settings.js)
- [ ] Delete original `js/booking.js`
- [ ] Delete original `js/settings.js`
- [ ] Update `index.html` script tags (5 new files, remove 2 old, correct order)
- [ ] Update `?v=` cache busting on ALL CSS/JS tags
- [ ] Check `tasks.html`, `programs.html`, `staff.html` for references
- [ ] Smoke test: login, create booking, view details, edit, delete, shift time
- [ ] Smoke test: history, dashboard, afisha, tasks, certificates
- [ ] Run existing tests to confirm no regressions
- [ ] Update version in `package.json`, `index.html` tagline, changelog
