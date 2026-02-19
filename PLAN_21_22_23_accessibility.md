# PLAN: Features #21, #22, #23 — Accessibility Improvements

---

## Feature #21: Focus Trap for Modals

### Current Modals

All modals found in `index.html` (22 total):

| # | ID | Purpose | ARIA attributes | Close button |
|---|-----|---------|-----------------|--------------|
| 1 | `bookingModal` | Booking details / edit controls | `role="dialog" aria-modal="true" aria-label="Деталі бронювання"` | `.modal-close` |
| 2 | `editLineModal` | Edit animator line name/color | `role="dialog" aria-modal="true" aria-label="Редагувати аніматора"` | `.modal-close` |
| 3 | `animatorsModal` | Animators list management | **none** | `.modal-close` |
| 4 | `settingsModal` | System settings (tabs: animators, telegram, automation, etc.) | `role="dialog" aria-modal="true" aria-label="Налаштування"` | `.modal-close` |
| 5 | `automationRuleModal` | Create automation rule | `role="dialog" aria-modal="true" aria-label="Нове правило"` | `.modal-close` |
| 6 | `certificateModal` | Issue certificate | `role="dialog" aria-modal="true" aria-label="Видати сертифікат"` | `.modal-close` |
| 7 | `certDetailModal` | Certificate details | `role="dialog" aria-modal="true" aria-label="Деталі сертифіката"` | `.modal-close` |
| 8 | `batchCertModal` | Batch certificates | `role="dialog" aria-modal="true" aria-label="Пакет сертифікатів"` | `.modal-close` |
| 9 | `historyModal` | Change history with filters/pagination | `role="dialog" aria-modal="true" aria-label="Історія змін"` | `.modal-close` |
| 10 | `confirmModal` | Confirmation dialog (Yes/No) | `role="alertdialog" aria-modal="true" aria-label="Підтвердження дії"` | No close button (Yes/No only) |
| 11 | `noteModal` | Note input dialog (for add-line request) | **none** | Cancel/Ok buttons |
| 12 | `dashboardModal` | Financial statistics dashboard | `role="dialog" aria-modal="true" aria-label="Дашборд статистики"` | `.modal-close` |
| 13 | `telegramModal` | Telegram setup | `role="dialog" aria-modal="true" aria-label="Налаштування Telegram"` | `.modal-close` |
| 14 | `changelogModal` | Changelog / what's new | `role="dialog" aria-modal="true" aria-label="Що нового"` | `.modal-close` |
| 15 | `programsCatalogModal` | Programs catalog | **none** | `.modal-close` |
| 16 | `productFormModal` | Product/program create/edit form | `role="dialog" aria-modal="true" aria-label="Форма програми"` | `.modal-close` |
| 17 | `tasksModal` | Tasks manager | `role="dialog" aria-modal="true" aria-label="Задачник"` | `.modal-close` |
| 18 | `afishaModal` | Events poster (afisha) management | `role="dialog" aria-modal="true" aria-label="Афіша подій"` | `.modal-close` |
| 19 | `afishaEditModal` | Edit single afisha event | `role="dialog" aria-modal="true" aria-label="Редагувати подію"` | `.modal-close` |
| 20 | `taskEditModal` | Edit single task | `role="dialog" aria-modal="true" aria-label="Редагувати завдання"` | `.modal-close` |
| 21 | `improvementModal` | Submit improvement suggestion | `role="dialog" aria-modal="true" aria-label="Пропозиція покращення"` | `.modal-close` (inside `modal-confirm`) |
| 22 | `bookingPanel` (aside) | Booking create/edit side panel | **Not a `.modal`** — it is an `<aside>` with `panelBackdrop` overlay | `#closePanel` button |

**Note:** `bookingPanel` is structurally different (a sliding aside panel), but should also trap focus when open.

### How openModal / closeModal Works Currently

There is **no** centralized `openModal()` function. Each feature opens its modal by directly calling:
```js
document.getElementById('someModal').classList.remove('hidden');
```

Closing is handled in two ways:
1. **`closeAllModals()`** in `js/ui.js` (line 36-41) — iterates all `.modal` elements, adds `hidden` class (skips `confirmModal`).
2. **`initModalListeners()`** in `js/app.js` (line 404-412) — attaches click handlers:
   - All `.modal-close` buttons call `closeAllModals()`.
   - Clicking on the `.modal` backdrop (the overlay itself) calls `closeAllModals()`.

There is **no** Escape key handler for modals on the main page (only `staff-page.js` has one).

`confirmModal` and `noteModal` have higher z-index (`--z-modal-confirm: 1050`) and are treated as "nested" modals that appear on top of other modals. `confirmModal` is skipped by `closeAllModals()` and has its own cleanup function.

### Implementation Plan

#### 1. Create `focusTrap` utility in `js/ui.js`

```js
// Focus trap state — stack for nested modals
const _focusTrapStack = [];

function openModal(modalEl, triggerEl) {
    // Save trigger element for focus restoration
    const trapState = {
        modal: modalEl,
        trigger: triggerEl || document.activeElement,
        previousTrap: _focusTrapStack[_focusTrapStack.length - 1] || null
    };
    _focusTrapStack.push(trapState);

    // Show modal
    modalEl.classList.remove('hidden');

    // Find all focusable elements inside the modal
    const focusableSelector = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled]):not([type="hidden"])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])'
    ].join(', ');

    // Use requestAnimationFrame to ensure DOM is rendered
    requestAnimationFrame(() => {
        const focusableEls = modalEl.querySelectorAll(focusableSelector);
        if (focusableEls.length > 0) {
            focusableEls[0].focus();
        } else {
            // If no focusable elements, make modal-content focusable
            const content = modalEl.querySelector('.modal-content');
            if (content) {
                content.setAttribute('tabindex', '-1');
                content.focus();
            }
        }
    });

    // Attach keydown listener for Tab trap + Escape
    modalEl._focusTrapHandler = (e) => {
        if (e.key === 'Tab') {
            // Re-query focusable elements (content may change dynamically)
            const focusable = Array.from(
                modalEl.querySelectorAll(focusableSelector)
            ).filter(el => el.offsetParent !== null); // only visible

            if (focusable.length === 0) return;

            const firstEl = focusable[0];
            const lastEl = focusable[focusable.length - 1];

            if (e.shiftKey) {
                // Shift+Tab: if on first element, wrap to last
                if (document.activeElement === firstEl) {
                    e.preventDefault();
                    lastEl.focus();
                }
            } else {
                // Tab: if on last element, wrap to first
                if (document.activeElement === lastEl) {
                    e.preventDefault();
                    firstEl.focus();
                }
            }
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeModal(modalEl);
        }
    };

    modalEl.addEventListener('keydown', modalEl._focusTrapHandler);
}

function closeModal(modalEl) {
    // Find this modal in the stack
    const idx = _focusTrapStack.findIndex(s => s.modal === modalEl);
    if (idx === -1) {
        // Fallback: just hide
        modalEl.classList.add('hidden');
        return;
    }

    const trapState = _focusTrapStack.splice(idx, 1)[0];

    // Remove keydown handler
    if (modalEl._focusTrapHandler) {
        modalEl.removeEventListener('keydown', modalEl._focusTrapHandler);
        delete modalEl._focusTrapHandler;
    }

    // Hide modal
    modalEl.classList.add('hidden');

    // Restore focus to trigger element
    if (trapState.trigger && typeof trapState.trigger.focus === 'function') {
        trapState.trigger.focus();
    }
}
```

#### 2. Refactor `closeAllModals()` to use the new `closeModal()`

```js
function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => {
        if (m.id === 'confirmModal') return;
        if (!m.classList.contains('hidden')) {
            closeModal(m);
        }
    });
}
```

#### 3. Handle nested modals (confirmModal on top of another modal)

`confirmModal` sits at z-index 1050, above regular modals (z-index 1000). The stack approach naturally handles this:
- When `confirmModal` opens on top of `bookingModal`, it pushes to the stack.
- Escape closes `confirmModal` first (it has its own keydown handler since it's on top).
- The `bookingModal` trap resumes after `confirmModal` closes.

Update `customConfirm()` in `ui.js` to use `openModal()` / `closeModal()` for the confirm dialog.

#### 4. Handle the booking side panel (`bookingPanel`)

The aside panel is not a `.modal` but should also trap focus when visible. Apply the same `openModal()` / `closeModal()` pattern to `openBookingPanel()` / `closeBookingPanel()` in `js/booking.js`.

#### 5. Update all modal-opening code across JS files

Every place that currently does `modal.classList.remove('hidden')` must be replaced with `openModal(modal, triggerElement)`. Key locations:

| File | Function / Location | Modal ID |
|------|---------------------|----------|
| `js/booking.js:894` | `showBookingDetails()` | `bookingModal` |
| `js/booking.js:67,91` | `openBookingPanel()` | `bookingPanel` (aside) |
| `js/settings.js:17` | `showHistory()` | `historyModal` |
| `js/settings.js:137` | `showDashboard()` | `dashboardModal` |
| `js/settings.js:247` | `showTelegramSetup()` | `telegramModal` |
| `js/settings.js:329` | `showAfishaModal()` | `afishaModal` |
| `js/settings.js:422` | `editLine()` | `editLineModal` |
| `js/settings.js:450` | `showAnimatorsModal()` | `animatorsModal` |
| `js/settings.js:657` | settings sub-modal | `automationRuleModal` |
| `js/settings.js:735` | `showSettings()` | `settingsModal` |
| `js/settings.js:967` | open certificate modal | `certificateModal` |
| `js/settings.js:1173` | certificate detail | `certDetailModal` |
| `js/settings.js:1214` | batch cert modal | `batchCertModal` |
| `js/settings.js:1660` | afisha edit | `afishaEditModal` |
| `js/settings.js:1763` | task edit | `taskEditModal` |
| `js/settings.js:1935` | product form | `productFormModal` |
| `js/settings.js:2130` | programs catalog | `programsCatalogModal` |
| `js/settings.js:2151` | tasks modal | `tasksModal` |
| `js/settings.js:2287` | improvement modal | `improvementModal` |
| `js/app.js:104` | changelog button | `changelogModal` |
| `js/app.js:347` | improvement FAB | `improvementModal` |
| `js/ui.js:53` | `customConfirm()` | `confirmModal` |
| `js/timeline.js:555` | timeline context | various |

#### 6. Add missing ARIA attributes

Modals missing `role="dialog" aria-modal="true"`:
- `animatorsModal` — add `role="dialog" aria-modal="true" aria-label="Список аніматорів"`
- `noteModal` — add `role="dialog" aria-modal="true" aria-label="Введіть примітку"`
- `programsCatalogModal` — add `role="dialog" aria-modal="true" aria-label="Каталог програм"`

### Files to Modify

- **`js/ui.js`** — Add `openModal()`, `closeModal()`, `_focusTrapStack`, refactor `closeAllModals()`, refactor `customConfirm()`
- **`js/booking.js`** — Update `showBookingDetails()`, `openBookingPanel()`, `closeBookingPanel()`
- **`js/settings.js`** — Update all ~15 places that open modals
- **`js/app.js`** — Update `initModalListeners()`, changelog button, improvement FAB
- **`js/timeline.js`** — Update modal opening in timeline context menu
- **`index.html`** — Add missing ARIA attributes to `animatorsModal`, `noteModal`, `programsCatalogModal`

### Edge Cases

- **Dynamic content inside modals**: Focusable elements list must be re-queried on each Tab press (not cached), because modal content is often populated dynamically via `innerHTML`.
- **Hidden elements**: Filter focusable elements by `offsetParent !== null` to skip hidden/collapsed sections within modals.
- **Booking panel on mobile**: The aside panel takes full width on mobile with `panelBackdrop` overlay; focus trap should apply here too.
- **confirmModal stacking**: Must remain operational when opened on top of another modal. The stack-based approach handles this naturally.

---

## Feature #22: ARIA Live Regions

### Current Notifications

**Notification element** in `index.html` (line 2093):
```html
<div id="notification" class="notification hidden">
    <span id="notificationText"></span>
</div>
```

**`showNotification()` function** in `js/ui.js` (line 88-95):
```js
function showNotification(message, type = '') {
    const el = document.getElementById('notification');
    document.getElementById('notificationText').textContent = message;
    el.className = 'notification' + (type ? ` ${type}` : '');
    el.classList.remove('hidden');
    if (_notificationTimer) clearTimeout(_notificationTimer);
    _notificationTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}
```

Notification types used:
- `'success'` — green, for successful operations
- `'error'` — red, for errors
- `'warning'` — amber, for undo operations and cautions
- `''` (no type) — default styling

**Warning banner** in `index.html` (line 155-158):
```html
<div id="warningBanner" class="warning-banner hidden">
    <span id="warningText"></span>
    <button id="closeWarning" class="btn-close-warning">✕</button>
</div>
```

**`handleError()` function** in `js/ui.js` (line 97-100):
```js
function handleError(context, error) {
    console.error(`[${context}]`, error);
    showNotification(`Помилка: ${context}`, 'error');
}
```

**Loading states**: The app uses inline loading spinners (`.loading-spinner` class with text like "Завантаження...") inserted via innerHTML. There is no centralized loading indicator with ARIA.

**Current ARIA live region status**: **None** exist. No `aria-live`, `role="status"`, or `role="alert"` attributes are present anywhere in the codebase.

### Implementation Plan

#### 1. Add `aria-live` to notification container in `index.html`

```html
<div id="notification" class="notification hidden" role="status" aria-live="polite" aria-atomic="true">
    <span id="notificationText"></span>
</div>
```

Using `aria-live="polite"` as default — the notification will be announced after the current screen reader utterance finishes.

#### 2. Use `aria-live="assertive"` for error notifications

Since the notification container changes its role dynamically based on type, update `showNotification()` in `js/ui.js`:

```js
function showNotification(message, type = '') {
    const el = document.getElementById('notification');
    document.getElementById('notificationText').textContent = message;
    el.className = 'notification' + (type ? ` ${type}` : '');

    // Assertive for errors (interrupts screen reader), polite for rest
    el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');

    el.classList.remove('hidden');
    if (_notificationTimer) clearTimeout(_notificationTimer);
    _notificationTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}
```

#### 3. Add `role="alert"` to warning banner

```html
<div id="warningBanner" class="warning-banner hidden" role="alert" aria-live="assertive">
    <span id="warningText"></span>
    <button id="closeWarning" class="btn-close-warning" aria-label="Закрити попередження">✕</button>
</div>
```

#### 4. Add `role="status"` to loading spinners

In the loading spinner CSS pattern, add ARIA via JS when creating loading spinners. Where loading spinners are created via innerHTML:

```js
// Pattern used in settings.js, booking.js etc:
container.innerHTML = '<div class="loading-spinner" role="status" aria-live="polite">Завантаження...</div>';
```

Update all `loading-spinner` insertions to include `role="status"`.

#### 5. Add screen-reader-only live region for booking operations

Add a visually-hidden live region for programmatic announcements that do not use the notification toast:

```html
<!-- At the end of body, before scripts -->
<div id="srAnnouncer" class="sr-only" aria-live="polite" aria-atomic="true"></div>
```

CSS:
```css
.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
}
```

Utility function:
```js
function announceToScreenReader(message) {
    const el = document.getElementById('srAnnouncer');
    if (el) {
        el.textContent = '';
        // Force re-announcement by clearing then setting
        requestAnimationFrame(() => { el.textContent = message; });
    }
}
```

#### 6. Announce form validation errors

When booking form validation fails, announce the error:
```js
// In handleBookingSubmit() error handling:
announceToScreenReader('Помилка валідації: ' + errorMessage);
```

#### 7. Add `aria-label` to close buttons

The warning close button and other icon-only buttons (e.g., "✕") need `aria-label`:
```html
<button id="closeWarning" class="btn-close-warning" aria-label="Закрити попередження">✕</button>
```

Also ensure all `.modal-close` spans are buttons or have proper ARIA:
- Currently they are `<span class="modal-close">&times;</span>` — these should ideally be `<button>` elements, or at minimum have `role="button"` and `tabindex="0"` and `aria-label="Закрити"`.

#### 8. Quick Stats Bar announcement

```html
<div id="quickStatsBar" class="quick-stats-bar hidden" role="status" aria-live="polite">
    <span id="quickStatsContent"></span>
</div>
```

### Files to Modify

- **`index.html`**:
  - Add `role="status" aria-live="polite" aria-atomic="true"` to `#notification`
  - Add `role="alert" aria-live="assertive"` to `#warningBanner`
  - Add `aria-label="Закрити попередження"` to `#closeWarning`
  - Add `role="status" aria-live="polite"` to `#quickStatsBar`
  - Add `<div id="srAnnouncer">` visually-hidden live region
  - Add `aria-label="Закрити"` to all `.modal-close` spans (or convert to `<button>`)
  - Add missing ARIA to `animatorsModal`, `noteModal`, `programsCatalogModal`
- **`js/ui.js`**:
  - Update `showNotification()` to set `aria-live` and `role` dynamically based on type
  - Add `announceToScreenReader()` utility function
- **`js/booking.js`** — Add screen reader announcements for booking create/edit/delete operations
- **`js/settings.js`** — Add `role="status"` to dynamically created loading spinners
- **`css/base.css`** — Add `.sr-only` class for screen-reader-only content

### ARIA Attributes Summary

| Element | Attribute | Value | Purpose |
|---------|-----------|-------|---------|
| `#notification` | `role` | `"status"` / `"alert"` (dynamic) | Announce notifications |
| `#notification` | `aria-live` | `"polite"` / `"assertive"` (dynamic) | Polite for success/warning, assertive for errors |
| `#notification` | `aria-atomic` | `"true"` | Announce full content on change |
| `#warningBanner` | `role` | `"alert"` | Announce warnings immediately |
| `#warningBanner` | `aria-live` | `"assertive"` | Interrupt current reading |
| `#quickStatsBar` | `role` | `"status"` | Announce stats updates |
| `.loading-spinner` | `role` | `"status"` | Announce loading state |
| `#srAnnouncer` | `aria-live` | `"polite"` | Programmatic announcements |
| `.modal-close` | `aria-label` | `"Закрити"` | Label for close buttons |
| `#closeWarning` | `aria-label` | `"Закрити попередження"` | Label for close button |

---

## Feature #23: Dark Mode Flash Fix (FOUC Prevention)

### Current Behavior

**How dark mode preference is saved:**
- localStorage key: `pzp_dark_mode` (string `"true"` or `"false"`)
- Set in `js/ui.js` line 208: `localStorage.setItem('pzp_dark_mode', AppState.darkMode)`
- The toggle function `toggleDarkMode()` (ui.js line 205-213) flips `AppState.darkMode`, toggles `body.dark-mode` class, updates localStorage, updates checkbox and icon.

**When dark class is applied (current flow):**
1. Browser loads `index.html`
2. Browser parses `<head>`, starts loading 11 CSS files (base.css through responsive.css)
3. Browser renders `<body>` — **white background** (from `base.css: body { background: #F0F4F8 }`)
4. Browser loads JS files (config.js, api.js, ui.js, auth.js, timeline.js, booking.js, settings.js, app.js)
5. `DOMContentLoaded` fires → `initializeApp()` → `loadPreferences()` (app.js line 35-46)
6. `loadPreferences()` reads `localStorage.getItem('pzp_dark_mode')`, and if `'true'`, adds `document.body.classList.add('dark-mode')`
7. **Only now** does `dark-mode.css` take effect via `body.dark-mode { ... }`

**The flash:** Between step 3 (initial render with white background) and step 6 (dark class applied), the user sees a bright white flash. This can be several hundred milliseconds or more, especially on slower connections where JS files take time to load.

**System preference handling:** `prefers-color-scheme` is **not** used anywhere in the codebase currently. Users who prefer dark mode at the OS level get no automatic dark mode.

### Fix: Inline Script in `<head>`

#### 1. Add inline `<script>` in `<head>`, immediately after `<meta>` tags and before CSS `<link>` tags

In `index.html`, add between line 15 (`manifest.json` link) and line 16 (CSS comment):

```html
<script>
// Dark mode flash prevention — runs before CSS is parsed
(function() {
    var saved = localStorage.getItem('pzp_dark_mode');
    // Explicit preference takes priority
    if (saved === 'true') {
        document.documentElement.classList.add('dark-mode');
    } else if (saved === null) {
        // No saved preference: respect system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.classList.add('dark-mode');
            localStorage.setItem('pzp_dark_mode', 'true');
        }
    }
    // If saved === 'false', do nothing (user explicitly chose light mode)
})();
</script>
```

**Why `document.documentElement` (i.e., `<html>`) instead of `document.body`:**
- `<body>` does not exist yet when `<head>` scripts execute.
- `<html>` is always available.
- CSS must be updated to target `html.dark-mode` (or `:root.dark-mode`) instead of `body.dark-mode`.

**Alternative: keep `body.dark-mode`** by placing the script at the very start of `<body>`:
```html
<body>
<script>
if (localStorage.getItem('pzp_dark_mode') === 'true' ||
    (localStorage.getItem('pzp_dark_mode') === null &&
     window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.body.classList.add('dark-mode');
}
</script>
```
This approach requires **no CSS changes** since `body.dark-mode` selectors remain valid. The script runs synchronously before any rendering of `<body>` content.

**Recommended approach: script at start of `<body>`** — minimizes CSS changes and risk.

#### 2. Update `dark-mode.css` (if using `<html>` approach)

If choosing the `<html>` approach, all selectors in `css/dark-mode.css` must change from `body.dark-mode` to `html.dark-mode` (or `.dark-mode`). This is a global find-and-replace across the entire file.

**If using the `<body>` approach (recommended), no CSS changes are needed.**

#### 3. Update `loadPreferences()` in `js/app.js`

The inline script handles early application. `loadPreferences()` should now:
- Read from `body.classList` instead of applying from localStorage (the class is already there).
- Sync `AppState.darkMode` with the actual DOM state.
- Still set the checkbox and icon.

```js
function loadPreferences() {
    // Dark mode: class is already applied by inline script in <body>
    AppState.darkMode = document.body.classList.contains('dark-mode');

    // Sync checkbox and icon
    const toggle = document.getElementById('darkModeToggle');
    if (toggle) toggle.checked = AppState.darkMode;
    const icon = document.getElementById('darkModeIcon');
    if (icon) icon.textContent = AppState.darkMode ? '☀️' : '🌙';

    // Other preferences (unchanged)
    AppState.compactMode = localStorage.getItem('pzp_compact_mode') === 'true';
    AppState.zoomLevel = parseInt(localStorage.getItem('pzp_zoom_level')) || 15;
    AppState.statusFilter = localStorage.getItem('pzp_status_filter') || 'all';
    if (AppState.compactMode) {
        CONFIG.TIMELINE.CELL_WIDTH = 35;
        document.querySelector('.timeline-container')?.classList.add('compact');
    }
    CONFIG.TIMELINE.CELL_MINUTES = AppState.zoomLevel;
}
```

#### 4. Handle `prefers-color-scheme` change at runtime

Add a listener for system preference changes (e.g., user switches OS from light to dark while the app is open):

```js
// In initializeApp() or loadPreferences():
if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        // Only auto-switch if user has no explicit preference saved
        const saved = localStorage.getItem('pzp_dark_mode');
        if (saved !== null) return; // User made explicit choice, don't override

        AppState.darkMode = e.matches;
        document.body.classList.toggle('dark-mode', e.matches);
        const toggle = document.getElementById('darkModeToggle');
        if (toggle) toggle.checked = AppState.darkMode;
        const icon = document.getElementById('darkModeIcon');
        if (icon) icon.textContent = AppState.darkMode ? '☀️' : '🌙';
    });
}
```

#### 5. Update `toggleDarkMode()` in `js/ui.js`

No changes needed to `toggleDarkMode()` — it already correctly toggles the class, updates AppState, and saves to localStorage. Once user explicitly toggles, `pzp_dark_mode` is saved as `"true"` or `"false"`, overriding system preference.

#### 6. Update `theme-color` meta tag

For a complete fix, the inline script should also update the `<meta name="theme-color">` to match the dark mode:

```html
<script>
(function() {
    var saved = localStorage.getItem('pzp_dark_mode');
    var isDark = saved === 'true' || (saved === null && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) {
        document.body.classList.add('dark-mode');
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = '#1a1a2e';
    }
    if (saved === null && isDark) localStorage.setItem('pzp_dark_mode', 'true');
})();
</script>
```

#### 7. Handle `staff-page.js` and other standalone pages

`js/staff-page.js` (line 696) also reads `pzp_dark_mode` from localStorage. The standalone pages (`/programs`, `/tasks`, `/staff`) likely have their own HTML files. Each needs the same inline `<script>` fix in their `<body>` tag.

### Files to Modify

- **`index.html`** — Add inline `<script>` at start of `<body>` (before any visible content)
- **`js/app.js`** — Update `loadPreferences()` to read dark mode state from DOM instead of localStorage, add `prefers-color-scheme` change listener
- **`js/ui.js`** — No changes to `toggleDarkMode()` (already correct)
- **`css/dark-mode.css`** — No changes needed (if using `<body>` approach)
- **Other standalone pages** (programs-page, tasks-page, staff-page HTML) — Add same inline script if they exist as separate HTML files

### Testing Checklist

- [ ] Load page with `pzp_dark_mode = 'true'` in localStorage — no white flash
- [ ] Load page with `pzp_dark_mode = 'false'` — stays light, no dark flash
- [ ] Load page with no `pzp_dark_mode` key + OS dark mode on — auto-applies dark
- [ ] Load page with no `pzp_dark_mode` key + OS light mode — stays light
- [ ] Toggle dark mode manually — saves to localStorage, works as before
- [ ] After manual toggle, OS preference changes are ignored (explicit choice honored)
- [ ] Clear `pzp_dark_mode` from localStorage — returns to system preference behavior

---

## Cross-Dependencies

### Focus Trap (#21) affects ALL modals
- All 22 modal/panel elements must use `openModal()` / `closeModal()`.
- Every JS file that opens a modal must be updated.
- Nested modals (`confirmModal` on top of any other modal) must work correctly with the focus trap stack.
- `closeAllModals()` must iterate the stack properly.

### ARIA Live Regions (#22) affects ALL notifications
- Every call to `showNotification()` automatically gets ARIA (the function handles it).
- `handleError()` also goes through `showNotification()`, so errors are covered.
- Loading spinners created via innerHTML throughout the codebase need manual updates.
- The `announceToScreenReader()` utility should be used for important state changes that do not trigger a toast.

### Features #21 and #22 interact
- When a modal opens, the screen reader should announce the modal label (already handled by `aria-label` on the modal + `role="dialog"`).
- When a modal closes and focus returns to the trigger, the screen reader should read the trigger element context.
- Notifications that appear while a modal is open should still be announced via ARIA live region (they are outside the modal in the DOM, so they remain accessible).

### Feature #23 is independent
- Dark mode flash fix has no dependencies on #21 or #22.
- However, if ARIA attributes are being added to `index.html` for #22, and the inline script is added for #23, coordinate the changes to avoid merge conflicts in `index.html`.

### Implementation Order (recommended)
1. **#23 (Dark Mode Flash Fix)** — smallest change, self-contained, least risk
2. **#22 (ARIA Live Regions)** — adds attributes to HTML and modifies `showNotification()`, no breaking changes
3. **#21 (Focus Trap)** — largest change, touches many files, introduces new API (`openModal`/`closeModal`)

### Testing Strategy
- All 157 existing API tests must pass (no backend changes).
- Manual testing with screen reader (VoiceOver, NVDA, or Orca) for #21 and #22.
- Visual testing for #23 (dark mode flash).
- Tab navigation testing through all modals for #21.
- Test all modal open/close flows to verify focus trap does not break existing functionality.

---

## Summary of All Files to Modify

| File | Feature(s) | Changes |
|------|-----------|---------|
| `index.html` | #21, #22, #23 | Inline dark mode script, ARIA attributes on notification/warning/modals, sr-only announcer div, missing ARIA on 3 modals |
| `js/ui.js` | #21, #22 | Add `openModal()`, `closeModal()`, `_focusTrapStack`, refactor `closeAllModals()`, refactor `customConfirm()`, update `showNotification()` with ARIA, add `announceToScreenReader()` |
| `js/app.js` | #21, #23 | Update `loadPreferences()` for dark mode DOM read + system preference listener, update `initModalListeners()` for focus trap, update modal opening calls |
| `js/booking.js` | #21, #22 | Use `openModal()` for booking modal/panel, add SR announcements for booking operations |
| `js/settings.js` | #21, #22 | Use `openModal()` for ~15 modal openings, add `role="status"` to loading spinners |
| `js/timeline.js` | #21 | Use `openModal()` for timeline context modals |
| `css/base.css` | #22 | Add `.sr-only` utility class |
| `css/dark-mode.css` | #23 | No changes if using `<body>` approach |
