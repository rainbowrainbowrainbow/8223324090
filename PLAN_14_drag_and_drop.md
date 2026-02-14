# Feature #14: Drag-and-Drop Timeline

> Детальний план реалізації перетягування бронювань на таймлайні.
> Vanilla JS, NO frameworks. Pointer Events API для desktop + mobile.

---

## 1. Current Timeline Structure

### 1.1. DOM Hierarchy

```
.timeline-container
  .timeline-scroll (#timelineScroll)           ← scrollable area, position:relative
    .time-scale (#timeScale)                    ← sticky time labels
      .time-mark (.hour | .half)                ← one per CELL_MINUTES slot
    .timeline-lines (#timelineLines)
      .timeline-line (repeated per animator)
        .line-header                            ← 130px wide, data-line-id
          .line-name
          .line-sub
        .line-grid (data-line-id)               ← flex:1, position:relative
          .grid-cell (repeated)                 ← data-time, data-line
          .booking-block (absolute positioned)  ← per booking
      .timeline-line.afisha-timeline-line       ← afisha row (top)
```

### 1.2. Grid Dimensions & Zoom Levels

| Zoom | CELL_MINUTES | CELL_WIDTH (normal) | CELL_WIDTH (compact) |
|------|-------------|---------------------|---------------------|
| 15   | 15 min      | 50px                | 35px                |
| 30   | 30 min      | 80px                | 56px                |
| 60   | 60 min      | 120px               | 84px                |

The time-to-pixel mapping is consistent across the codebase:

```js
// Time -> Left position (from timeline.js createBookingBlock):
const startMin = timeToMinutes(booking.time) - timeToMinutes(`${startHour}:00`);
const left = (startMin / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH;

// Duration -> Width:
const width = (booking.duration / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH - 4;
// The -4px is the gap/margin between blocks
```

### 1.3. Booking Block Structure

```html
<div class="booking-block {category} [preliminary] [linked-ghost] [status-hidden]"
     style="left: {left}px; width: {width}px;">
  <div class="user-letter">{badge}</div>
  <div class="title">{label}: {room} <span class="duration-badge">{duration}хв</span></div>
  <div class="subtitle">{time} ({kidsCount} діт)</div>
  <div class="note-text">{notes}</div>  <!-- optional -->
</div>
```

Key CSS properties: `position: absolute; top: 4px; bottom: 4px; z-index: 10`.
On hover: `transform: translateY(-2px); z-index: 20`.

### 1.4. Existing Interactions on Booking Blocks

Current event listeners attached in `createBookingBlock()` (timeline.js:351-363):
- `click` -> `showBookingDetails(booking.id)` (or `booking.linkedTo` for linked)
- `mouseenter` -> `showTooltip(e, booking)`
- `mousemove` -> `moveTooltip(e)`
- `mouseleave` -> `hideTooltip()`
- `touchstart` -> `showTooltip(e.touches[0], booking)` (passive)
- `touchend` -> `hideTooltip()` (passive)

These MUST be preserved; drag should not break click/tooltip behavior.

### 1.5. Existing Afisha Drag (Reference Implementation)

The codebase already has a working drag implementation for afisha blocks (timeline.js:567-682):
- Uses `mousedown`/`mousemove`/`mouseup` + `touchstart`/`touchmove`/`touchend`
- State stored in `_afishaDragState` object
- Shows `.afisha-drag-range` zone indicator
- Shows `.afisha-drag-time` floating time label
- Snaps to 5-minute increments: `Math.round((currentMin + deltaMin) / 5) * 5`
- On end: PATCH API call, or fallback to original position on error
- If not moved: triggers click behavior (edit)

This existing pattern will be the foundation for booking drag-and-drop.

### 1.6. Existing Time-Shift Feature

`shiftBookingTime()` in booking.js:1138-1219 already handles:
- Moving main booking by N minutes
- Boundary validation (dayStart/dayEnd)
- Conflict detection on the same line
- Moving ALL linked bookings by the same delta
- Conflict detection for EACH linked booking on its respective line
- `apiUpdateBooking()` for main + each linked
- History entry: `apiAddHistory('shift', ...)`
- Undo support: `pushUndo('shift', { bookingId, minutes: -minutes, linked: [...] })`

### 1.7. Existing Line-Switch Feature

`switchBookingLine()` in booking.js:1225-1264 already handles:
- Moving a booking to a different line (different animator)
- Conflict detection on target line
- `apiUpdateBooking()` with new `lineId`
- Does NOT currently handle linked bookings (potential gap)

---

## 2. Drag Implementation Plan

### 2.1. New File: `js/drag.js`

Create a dedicated module to keep drag logic isolated. This avoids bloating timeline.js.

```
js/drag.js  (~400-500 lines estimated)
```

Include in `index.html` after `timeline.js` and before `app.js`:
```html
<script src="js/drag.js?v=X.XX"></script>
```

### 2.2. State Object

```js
let _bookingDragState = null;

// Shape:
_bookingDragState = {
    // Core drag
    booking: Object,           // the booking being dragged
    block: HTMLElement,         // the DOM .booking-block element
    grid: HTMLElement,          // the .line-grid parent
    startX: Number,            // pointerdown clientX
    startY: Number,            // pointerdown clientY
    startLeft: Number,         // original block.style.left (px)
    startLineId: String,       // original line ID

    // Time math
    startMin: Number,          // original time in minutes from midnight
    startHour: Number,         // timeline start hour (10 or 12)
    currentMin: Number,        // current dragged time in minutes
    newLineId: String,         // target line ID (if cross-line drag)

    // Constraints
    dayStartMin: Number,       // min allowed minute (e.g., 600 for 10:00)
    dayEndMin: Number,         // max allowed minute (e.g., 1200 for 20:00)
    duration: Number,          // booking duration in minutes

    // Related bookings
    relatedBookings: Array,    // linked bookings + second-animator bookings
    relatedBlocks: Array,      // their DOM elements
    relatedOriginals: Array,   // their original {left, lineId, min} for rollback

    // UI elements
    ghostEl: HTMLElement,       // semi-transparent clone during drag
    timeLabel: HTMLElement,     // floating time label
    dropIndicators: Array,     // highlighted drop zones

    // Flags
    moved: Boolean,            // has pointer moved beyond threshold?
    pointerId: Number,         // for pointer capture
    longPressTimer: Number,    // for mobile long-press
    isTouch: Boolean,          // touch vs mouse
    scrollInterval: Number     // auto-scroll near edges
};
```

### 2.3. Pointer Events API Strategy

Use Pointer Events (unified mouse + touch + pen):

```js
function initBookingDrag(block, booking, startHour) {
    // Viewer cannot drag
    if (isViewer()) return;
    // Linked-ghost blocks cannot be dragged directly
    if (booking.linkedTo) return;

    block.addEventListener('pointerdown', (e) => {
        // Only primary button (left click / single touch)
        if (e.button !== 0) return;

        if (e.pointerType === 'touch') {
            // Mobile: start long-press timer
            _bookingDragState = { ...initialState, longPressTimer: setTimeout(() => {
                beginDrag(block, booking, startHour, e);
            }, 300) };
            // Store pointer for cancel detection
            _bookingDragState.pointerId = e.pointerId;
            _bookingDragState.startX = e.clientX;
            _bookingDragState.startY = e.clientY;
            _bookingDragState.isTouch = true;
        } else {
            // Desktop: immediate drag start (after 8px movement threshold)
            _bookingDragState = { ...initialState };
            _bookingDragState.pointerId = e.pointerId;
            _bookingDragState.startX = e.clientX;
            _bookingDragState.startY = e.clientY;
            _bookingDragState.isTouch = false;
            _bookingDragState.block = block;
            _bookingDragState.booking = booking;
            _bookingDragState.startHour = startHour;
        }
    });
}

// Global listeners (on document)
document.addEventListener('pointermove', handleDragMove);
document.addEventListener('pointerup', handleDragEnd);
document.addEventListener('pointercancel', handleDragCancel);
```

### 2.4. Movement Threshold

```js
const DRAG_THRESHOLD_PX = 8;   // Minimum pixels before drag activates
const LONG_PRESS_MS = 300;     // Mobile long-press duration
const SNAP_MINUTES = 5;        // Snap grid for time positioning
```

On `pointermove`:
```js
function handleDragMove(e) {
    if (!_bookingDragState) return;

    const s = _bookingDragState;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Touch: if moved before long-press triggers, cancel (user is scrolling)
    if (s.isTouch && !s.moved && s.longPressTimer) {
        if (dist > DRAG_THRESHOLD_PX) {
            clearTimeout(s.longPressTimer);
            cancelDrag();
            return;
        }
        return; // Wait for long-press timer
    }

    // Desktop: activate on threshold
    if (!s.isTouch && !s.moved && dist > DRAG_THRESHOLD_PX) {
        beginDrag(s.block, s.booking, s.startHour, e);
    }

    if (!s.moved) return;

    // Prevent text selection and scrolling during drag
    e.preventDefault();

    updateDragPosition(e.clientX, e.clientY);
}
```

### 2.5. beginDrag() — Initialize Visual Drag

```js
function beginDrag(block, booking, startHour, e) {
    const s = _bookingDragState;
    s.moved = true;

    // Hide tooltip immediately
    hideTooltip();

    // Capture pointer for reliable tracking
    block.setPointerCapture(s.pointerId);

    // Calculate time constraints
    const selectedDate = AppState.selectedDate;
    const dayOfWeek = selectedDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    s.dayStartMin = (isWeekend ? CONFIG.TIMELINE.WEEKEND_START : CONFIG.TIMELINE.WEEKDAY_START) * 60;
    s.dayEndMin = CONFIG.TIMELINE.WEEKEND_END * 60; // always 20:00
    s.startHour = startHour;
    s.duration = booking.duration;
    s.startMin = timeToMinutes(booking.time);
    s.currentMin = s.startMin;
    s.startLeft = parseFloat(block.style.left);
    s.startLineId = booking.lineId;
    s.newLineId = booking.lineId;

    // Collect related bookings
    s.relatedBookings = collectRelatedBookings(booking);
    s.relatedBlocks = findRelatedBlocks(s.relatedBookings);
    s.relatedOriginals = s.relatedBlocks.map(rb => ({
        left: parseFloat(rb.el.style.left),
        lineId: rb.booking.lineId,
        min: timeToMinutes(rb.booking.time)
    }));

    // Add visual feedback
    block.classList.add('dragging');
    s.relatedBlocks.forEach(rb => rb.el.classList.add('dragging-related'));

    // Create floating time label
    s.timeLabel = document.createElement('div');
    s.timeLabel.className = 'drag-time-label';
    s.timeLabel.textContent = booking.time;
    block.appendChild(s.timeLabel);

    // Prevent default touch behavior (scrolling)
    document.body.classList.add('dragging-active');
}
```

### 2.6. updateDragPosition() — Move Block

```js
function updateDragPosition(clientX, clientY) {
    const s = _bookingDragState;
    const cellW = CONFIG.TIMELINE.CELL_WIDTH;
    const cellM = CONFIG.TIMELINE.CELL_MINUTES;

    // --- Horizontal: time shift ---
    const deltaX = clientX - s.startX;
    const deltaMin = (deltaX / cellW) * cellM;
    let newMin = Math.round((s.startMin + deltaMin) / SNAP_MINUTES) * SNAP_MINUTES;

    // Clamp to day boundaries
    newMin = Math.max(s.dayStartMin, Math.min(s.dayEndMin - s.duration, newMin));
    s.currentMin = newMin;

    // Update main block position
    const newLeft = ((newMin - s.startHour * 60) / cellM) * cellW;
    s.block.style.left = `${newLeft}px`;

    // Update time label
    s.timeLabel.textContent = minutesToTime(newMin);

    // --- Vertical: line switch ---
    const targetLine = detectTargetLine(clientY);
    if (targetLine && targetLine !== s.newLineId) {
        s.newLineId = targetLine;
        highlightTargetLine(targetLine);
    }

    // --- Move related bookings by same delta ---
    const timeDelta = newMin - s.startMin;
    s.relatedBlocks.forEach((rb, i) => {
        const orig = s.relatedOriginals[i];
        const relNewMin = orig.min + timeDelta;
        const relNewLeft = ((relNewMin - s.startHour * 60) / cellM) * cellW;
        rb.el.style.left = `${relNewLeft}px`;
    });

    // --- Auto-scroll near edges ---
    handleEdgeScroll(clientX);

    // --- Conflict preview ---
    updateConflictPreview(newMin, s.newLineId, timeDelta);
}
```

### 2.7. detectTargetLine() — Cross-Line Drag

```js
function detectTargetLine(clientY) {
    // Find which .line-grid the pointer is over
    const lines = document.querySelectorAll('.line-grid[data-line-id]');
    for (const lineGrid of lines) {
        if (lineGrid.dataset.lineId === 'afisha') continue; // skip afisha line
        const rect = lineGrid.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
            return lineGrid.dataset.lineId;
        }
    }
    return null;
}
```

### 2.8. handleDragEnd() — Validate & Save

```js
async function handleDragEnd(e) {
    if (!_bookingDragState) return;
    const s = _bookingDragState;

    // Clear long-press timer
    if (s.longPressTimer) clearTimeout(s.longPressTimer);

    // Clear auto-scroll
    if (s.scrollInterval) clearInterval(s.scrollInterval);

    // Release pointer capture
    try { s.block.releasePointerCapture(s.pointerId); } catch(e) {}

    // Remove visual feedback
    s.block.classList.remove('dragging');
    s.relatedBlocks.forEach(rb => rb.el.classList.remove('dragging-related'));
    clearDropIndicators();
    document.body.classList.remove('dragging-active');

    if (!s.moved) {
        // No drag happened — pass through to click handler
        if (s.timeLabel) s.timeLabel.remove();
        _bookingDragState = null;
        return; // click event will fire naturally
    }

    // Check if position actually changed
    const timeDelta = s.currentMin - s.startMin;
    const lineChanged = s.newLineId !== s.startLineId;

    if (timeDelta === 0 && !lineChanged) {
        // No change — revert visuals
        rollbackDragVisuals(s);
        _bookingDragState = null;
        return;
    }

    // --- Validate all positions ---
    const validationResult = await validateDragDrop(s);

    if (!validationResult.valid) {
        showNotification(validationResult.error, 'error');
        rollbackDragVisuals(s);
        _bookingDragState = null;
        return;
    }

    // --- Save to server ---
    const saved = await saveDragResult(s, timeDelta, lineChanged);

    if (!saved) {
        rollbackDragVisuals(s);
    }

    // Remove time label
    if (s.timeLabel) s.timeLabel.remove();
    _bookingDragState = null;
}
```

---

## 3. Visual Feedback

### 3.1. CSS Classes

Add to `css/timeline.css`:

```css
/* ==========================================
   DRAG & DROP (Feature #14)
   ========================================== */

/* Active drag state on body — prevent scroll and selection */
body.dragging-active {
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
}

/* The block being dragged */
.booking-block.dragging {
    opacity: 0.85;
    z-index: 100 !important;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25), 0 2px 8px rgba(0, 0, 0, 0.15);
    transform: scale(1.03);
    transition: box-shadow 0.15s, opacity 0.15s;
    cursor: grabbing;
    /* Disable the normal hover transform */
}

/* Related blocks (second animator, linked) move with reduced opacity */
.booking-block.dragging-related {
    opacity: 0.5;
    z-index: 90 !important;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    border: 2px dashed rgba(255, 255, 255, 0.5);
    transition: opacity 0.15s;
}

/* Floating time label during drag */
.drag-time-label {
    position: absolute;
    top: -28px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--gray-800);
    color: var(--white);
    padding: 3px 10px;
    border-radius: var(--radius-full);
    font-size: 12px;
    font-weight: 800;
    white-space: nowrap;
    z-index: 110;
    pointer-events: none;
    box-shadow: var(--shadow-md);
}

/* Target line highlight when dragging across lines */
.line-grid.drag-target {
    background: rgba(16, 185, 129, 0.08) !important;
    outline: 2px dashed var(--primary);
    outline-offset: -2px;
    transition: background 0.15s, outline 0.15s;
}

/* Invalid drop zone */
.line-grid.drag-invalid {
    background: rgba(239, 68, 68, 0.08) !important;
    outline: 2px dashed var(--danger);
    outline-offset: -2px;
}

/* Ghost "landing position" preview */
.drag-ghost {
    position: absolute;
    top: 4px;
    bottom: 4px;
    border-radius: 8px;
    background: var(--primary);
    opacity: 0.15;
    z-index: 5;
    pointer-events: none;
    border: 2px dashed var(--primary);
}

/* Conflict indicator on ghost */
.drag-ghost.conflict {
    background: var(--danger);
    border-color: var(--danger);
    opacity: 0.2;
}

/* Resize handle on right edge */
.booking-block .resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 8px;
    bottom: 0;
    cursor: col-resize;
    border-radius: 0 8px 8px 0;
    transition: background 0.15s;
    z-index: 11;
}

.booking-block .resize-handle:hover,
.booking-block .resize-handle:active {
    background: rgba(255, 255, 255, 0.3);
}

/* Grab cursor for draggable blocks */
.booking-block:not(.linked-ghost) {
    cursor: grab;
}

.booking-block:not(.linked-ghost):active {
    cursor: grabbing;
}

/* Undo toast for drag operations */
.drag-undo-toast {
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--gray-800);
    color: var(--white);
    padding: 12px 20px;
    border-radius: var(--radius-full);
    font-size: var(--font-sm);
    font-weight: 700;
    z-index: var(--z-toast, 9000);
    box-shadow: var(--shadow-lg);
    display: flex;
    align-items: center;
    gap: 12px;
    animation: slideUp 0.3s var(--ease-smooth);
}

.drag-undo-toast button {
    background: var(--primary);
    color: var(--white);
    border: none;
    padding: 6px 14px;
    border-radius: var(--radius-full);
    font-weight: 800;
    cursor: pointer;
    font-size: var(--font-sm);
    font-family: inherit;
}

@keyframes slideUp {
    from { transform: translateX(-50%) translateY(20px); opacity: 0; }
    to { transform: translateX(-50%) translateY(0); opacity: 1; }
}
```

### 3.2. Ghost / Landing Preview

While dragging, show a semi-transparent ghost in the DROP position on the target line:

```js
function showDropGhost(targetLineId, newMin, duration, startHour) {
    removeDropGhost();

    const targetGrid = document.querySelector(`.line-grid[data-line-id="${targetLineId}"]`);
    if (!targetGrid) return;

    const cellW = CONFIG.TIMELINE.CELL_WIDTH;
    const cellM = CONFIG.TIMELINE.CELL_MINUTES;
    const left = ((newMin - startHour * 60) / cellM) * cellW;
    const width = (duration / cellM) * cellW - 4;

    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.id = 'dragGhostPreview';
    ghost.style.left = `${left}px`;
    ghost.style.width = `${width}px`;
    targetGrid.appendChild(ghost);

    return ghost;
}

function removeDropGhost() {
    const ghost = document.getElementById('dragGhostPreview');
    if (ghost) ghost.remove();
}
```

### 3.3. Snap to Grid

Time snapping based on zoom level:

```js
// SNAP_MINUTES = 5 always, regardless of zoom.
// This gives fine control while still being grid-aligned at 15-min zoom.
// At 30-min zoom, visual snapping still every 5 min.
// At 60-min zoom, visual snapping still every 5 min.
//
// Alternative: snap to CELL_MINUTES for coarser control.
// Decision: 5-min snapping is better UX (matches existing afisha drag).
```

---

## 4. Complex Interactions (CRITICAL)

### 4.1. Collecting Related Bookings

```js
function collectRelatedBookings(mainBooking) {
    // Get all bookings for the current date (from cache)
    const dateStr = formatDate(AppState.selectedDate);
    const cached = AppState.cachedBookings[dateStr];
    if (!cached) return [];
    const allBookings = cached.data;

    const related = [];

    // 1. Linked bookings (second animator, extra host)
    //    These are bookings where linkedTo === mainBooking.id
    const linked = allBookings.filter(b => b.linkedTo === mainBooking.id);
    linked.forEach(lb => {
        related.push({
            booking: lb,
            type: 'linked',       // second animator or extra host
            moveWith: true,       // always moves with main
            checkConflict: true   // must check conflicts on its line
        });
    });

    // Note: If mainBooking itself is a linked booking (linkedTo set),
    // drag is disabled in initBookingDrag(). User must drag the main booking.

    return related;
}
```

### 4.2. Two-Animator Programs (hosts > 1)

When a program has `hosts > 1` (e.g., "Шпигунська історія", "Паперове Неон-шоу"):
- Main booking is on the primary animator's line
- A linked booking (`linkedTo = mainBooking.id`) exists on the second animator's line

**Drag behavior:**
1. When main is dragged horizontally (time shift):
   - Both blocks move in sync (same time delta)
   - Conflict check on BOTH lines simultaneously
   - If second animator's line has conflict -> show specific error: "Накладка у {secondAnimatorName} о {conflictTime}"

2. When main is dragged vertically (line switch):
   - Main booking moves to new line
   - Linked booking STAYS on its original line (different animator)
   - Conflict check: new line for main, same line for linked (with new time)
   - Warning: "Другий аніматор залишається на {lineName}"

**Visual feedback:**
- Both blocks highlighted with `.dragging` / `.dragging-related`
- Ghost preview shown on both lines
- If either has conflict -> `.drag-ghost.conflict` on the conflicting line

### 4.3. Linked Bookings (main + linked for multi-room events)

Linked bookings include:
- Second animator (from `program.hosts > 1`)
- Extra host (from `extraHostToggle`, programId = 'anim_extra')

**Rules:**
- All linked bookings move with the main (same time delta)
- Dragging a linked booking is DISABLED (click navigates to parent)
- If any linked booking would conflict -> entire drag is rejected
- Show which specific linked booking conflicts in the error message

```js
async function validateDragDrop(state) {
    const s = state;
    const newTime = minutesToTime(s.currentMin);
    const timeDelta = s.currentMin - s.startMin;

    // 1. Validate main booking on target line
    const mainConflict = await checkConflicts(s.newLineId, newTime, s.duration, s.booking.id);
    if (mainConflict.overlap) {
        return { valid: false, error: `Час зайнятий на цій лінії!` };
    }

    // 2. Validate each related booking
    for (const rb of s.relatedBookings) {
        if (!rb.checkConflict) continue;
        const rbNewMin = timeToMinutes(rb.booking.time) + timeDelta;
        const rbNewTime = minutesToTime(rbNewMin);

        // Boundary check
        if (rbNewMin < s.dayStartMin || rbNewMin + rb.booking.duration > s.dayEndMin) {
            return { valid: false, error: `Пов'язане бронювання виходить за межі дня` };
        }

        const rbConflict = await checkConflicts(
            rb.booking.lineId, rbNewTime, rb.booking.duration, rb.booking.id
        );
        if (rbConflict.overlap) {
            // Determine which animator
            const lines = await getLinesForDate(AppState.selectedDate);
            const conflictLine = lines.find(l => l.id === rb.booking.lineId);
            const lineName = conflictLine ? conflictLine.name : 'пов\'язаний аніматор';
            return { valid: false, error: `Накладка у ${lineName}!` };
        }
    }

    // 3. Check "no pause" warning (non-blocking)
    if (mainConflict.noPause) {
        // Show warning but allow drop
        showWarning('Немає 15-хвилинної паузи між програмами');
    }

    return { valid: true };
}
```

### 4.4. Pinata Filler / Additional Staff

When booking has a `pinataFiller` set:
- There may be a separate booking for the filler on another line
- This booking is typically a linked booking with `programId === 'pinata'`

When booking has `extraHostToggle` enabled:
- Creates a linked booking with `programId === 'anim_extra'`
- This is already covered by linked bookings logic (section 4.3)

**Drag UX for additional staff:**
- Auto-move if the additional staff booking is on the same time slot
- All linked bookings (including extra hosts) move together automatically
- No separate confirmation needed -- they are just linked bookings

---

## 5. Resize (Drag Edge)

### 5.1. Resize Handle

Add a resize handle to the right edge of each booking block:

```js
function createBookingBlock(booking, startHour) {
    // ... existing code ...

    // Add resize handle (only for non-viewer, non-linked)
    if (!isViewer() && !booking.linkedTo) {
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        block.appendChild(resizeHandle);
        initBookingResize(resizeHandle, block, booking, startHour);
    }

    return block;
}
```

### 5.2. Resize Logic

```js
let _resizeState = null;

function initBookingResize(handle, block, booking, startHour) {
    handle.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); // Prevent drag initiation
        e.preventDefault();

        const program = getProductsSync().find(p => p.id === booking.programId);
        // Minimum duration: program's default, or 15 minutes for custom
        const minDuration = program?.isCustom ? 15 : (program?.duration || 15);

        _resizeState = {
            block,
            booking,
            startHour,
            startX: e.clientX,
            startWidth: parseFloat(block.style.width),
            originalDuration: booking.duration,
            minDuration,
            maxDuration: 240, // 4 hours max
            pointerId: e.pointerId,
            newDuration: booking.duration
        };

        handle.setPointerCapture(e.pointerId);
        block.classList.add('resizing');
        document.body.classList.add('dragging-active');
    });
}

// On pointermove (combined with drag handler):
function handleResizeMove(e) {
    if (!_resizeState) return;
    const s = _resizeState;
    const cellW = CONFIG.TIMELINE.CELL_WIDTH;
    const cellM = CONFIG.TIMELINE.CELL_MINUTES;

    const deltaX = e.clientX - s.startX;
    const deltaMin = Math.round((deltaX / cellW) * cellM / SNAP_MINUTES) * SNAP_MINUTES;
    let newDuration = s.originalDuration + deltaMin;

    // Clamp
    newDuration = Math.max(s.minDuration, Math.min(s.maxDuration, newDuration));

    // Check end-of-day boundary
    const endMin = timeToMinutes(s.booking.time) + newDuration;
    const dayEnd = CONFIG.TIMELINE.WEEKEND_END * 60;
    if (endMin > dayEnd) {
        newDuration = dayEnd - timeToMinutes(s.booking.time);
    }

    s.newDuration = newDuration;

    // Update visual width
    const newWidth = (newDuration / cellM) * cellW - 4;
    s.block.style.width = `${newWidth}px`;

    // Update duration badge
    const badge = s.block.querySelector('.duration-badge');
    if (badge) badge.textContent = `${newDuration}хв`;
}

// On pointerup:
async function handleResizeEnd(e) {
    if (!_resizeState) return;
    const s = _resizeState;

    s.block.classList.remove('resizing');
    document.body.classList.remove('dragging-active');

    if (s.newDuration === s.originalDuration) {
        _resizeState = null;
        return;
    }

    // Check for conflicts with next booking on the same line
    const newTime = s.booking.time;
    const conflict = await checkConflicts(s.booking.lineId, newTime, s.newDuration, s.booking.id);

    if (conflict.overlap) {
        showNotification('Неможливо змінити тривалість — накладка з наступним бронюванням', 'error');
        // Rollback visual
        const origWidth = (s.originalDuration / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH - 4;
        s.block.style.width = `${origWidth}px`;
        _resizeState = null;
        return;
    }

    // Save to server
    const updated = { ...s.booking, duration: s.newDuration };
    const result = await apiUpdateBooking(s.booking.id, updated);

    if (result && result.success === false) {
        showNotification(result.error || 'Помилка зміни тривалості', 'error');
        // Rollback
        const origWidth = (s.originalDuration / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH - 4;
        s.block.style.width = `${origWidth}px`;
    } else {
        // Update linked bookings duration too
        const dateStr = formatDate(AppState.selectedDate);
        const allBookings = AppState.cachedBookings[dateStr]?.data || [];
        const linked = allBookings.filter(b => b.linkedTo === s.booking.id);
        for (const lb of linked) {
            await apiUpdateBooking(lb.id, { ...lb, duration: s.newDuration });
        }

        pushUndo('resize', {
            bookingId: s.booking.id,
            oldDuration: s.originalDuration,
            newDuration: s.newDuration,
            linked: linked.map(l => l.id)
        });

        delete AppState.cachedBookings[dateStr];
        await renderTimeline();
        showNotification(`Тривалість: ${s.newDuration} хв`, 'success');
    }

    _resizeState = null;
}
```

---

## 6. Mobile Support

### 6.1. Long-Press to Initiate

```js
// In initBookingDrag:
if (e.pointerType === 'touch') {
    // 300ms long-press to start drag
    // Any movement > 8px before timer fires = cancel (user scrolling)

    // Visual feedback during long-press:
    // - Slight scale up (CSS transition)
    // - Haptic feedback via navigator.vibrate(50) if available
}
```

### 6.2. Touch Scroll vs Drag Distinction

**Problem:** Timeline has horizontal scroll. Touch drag must not interfere.

**Solution:**
- Long-press (300ms) distinguishes drag from scroll
- During long-press wait period: any movement > 8px cancels drag → normal scroll
- After drag begins: `touch-action: none` on body prevents scrolling
- `pointerup` / `pointercancel` always cleans up

```js
// During long-press timer, track movement:
if (s.isTouch && !s.moved) {
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) {
        clearTimeout(s.longPressTimer);
        _bookingDragState = null;
        return; // Let browser handle scroll
    }
}
```

### 6.3. Auto-Scroll Near Edges

When dragging near the left/right edge of `#timelineScroll`, auto-scroll:

```js
function handleEdgeScroll(clientX) {
    const s = _bookingDragState;
    const scroll = document.getElementById('timelineScroll');
    if (!scroll) return;

    const rect = scroll.getBoundingClientRect();
    const edgeZone = 60; // px from edge to trigger scroll
    const scrollSpeed = 5; // px per frame

    if (s.scrollInterval) clearInterval(s.scrollInterval);

    if (clientX < rect.left + edgeZone) {
        // Scroll left
        s.scrollInterval = setInterval(() => {
            scroll.scrollLeft -= scrollSpeed;
        }, 16); // ~60fps
    } else if (clientX > rect.right - edgeZone) {
        // Scroll right
        s.scrollInterval = setInterval(() => {
            scroll.scrollLeft += scrollSpeed;
        }, 16);
    }
}
```

### 6.4. Touch Target Compliance (WCAG 2.1)

- Booking blocks: minimum height 56px (current: `min-height: 64px` for line) -- OK
- Resize handle: 8px width is too small for touch. On touch devices, use a wider hit area:

```css
/* Mobile: wider touch zone for resize handle */
@media (pointer: coarse) {
    .booking-block .resize-handle {
        width: 20px;
        right: -6px;
    }
}
```

### 6.5. Haptic Feedback

```js
function triggerHaptic(type = 'light') {
    if (!navigator.vibrate) return;
    switch (type) {
        case 'light': navigator.vibrate(30); break;
        case 'medium': navigator.vibrate(50); break;
        case 'success': navigator.vibrate([30, 50, 30]); break;
        case 'error': navigator.vibrate([50, 30, 50, 30, 50]); break;
    }
}
```

---

## 7. API Integration

### 7.1. Save Drag Result

```js
async function saveDragResult(state, timeDelta, lineChanged) {
    const s = state;
    const newTime = minutesToTime(s.currentMin);

    try {
        // 1. Update main booking
        const mainUpdate = {
            ...s.booking,
            time: newTime,
            lineId: s.newLineId
        };

        const mainResult = await apiUpdateBooking(s.booking.id, mainUpdate);
        if (mainResult && mainResult.success === false) {
            showNotification(mainResult.error || 'Помилка переміщення', 'error');
            return false;
        }

        // 2. Update all related bookings
        for (const rb of s.relatedBookings) {
            if (!rb.moveWith) continue;
            const rbNewMin = timeToMinutes(rb.booking.time) + timeDelta;
            const rbNewTime = minutesToTime(rbNewMin);

            const rbUpdate = { ...rb.booking, time: rbNewTime };
            // Note: linked bookings stay on their own line (not switched)
            const rbResult = await apiUpdateBooking(rb.booking.id, rbUpdate);
            if (rbResult && rbResult.success === false) {
                console.warn(`Failed to move related booking ${rb.booking.id}`);
            }
        }

        // 3. History entry
        const historyData = {
            ...mainUpdate,
            shiftMinutes: timeDelta,
            lineSwitched: lineChanged,
            oldLineId: s.startLineId,
            oldTime: minutesToTime(s.startMin)
        };
        await apiAddHistory('drag', AppState.currentUser?.username, historyData);

        // 4. Undo support
        pushUndo('drag', {
            bookingId: s.booking.id,
            oldTime: minutesToTime(s.startMin),
            oldLineId: s.startLineId,
            newTime: newTime,
            newLineId: s.newLineId,
            timeDelta: -timeDelta,  // reverse delta for undo
            linked: s.relatedBookings.map(rb => ({
                id: rb.booking.id,
                oldTime: rb.booking.time,
                newTime: minutesToTime(timeToMinutes(rb.booking.time) + timeDelta)
            }))
        });

        // 5. Invalidate cache & re-render
        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
        await renderTimeline();

        // 6. Show undo toast
        showDragUndoToast(s.booking, timeDelta, lineChanged);

        return true;
    } catch (error) {
        handleError('Перетягування бронювання', error);
        return false;
    }
}
```

### 7.2. Handle 409 Conflict Response

The server-side PUT endpoint (`routes/bookings.js:264-406`) already returns 409 for conflicts:

```js
// Server response:
{ success: false, error: "Час зайнятий: КВ4(60) о 14:00" }
```

The existing `apiUpdateBooking()` in `api.js:98-115` already parses error bodies:

```js
if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return { success: false, error: body.error || 'API error' };
}
```

No server changes needed for basic drag-and-drop. The existing PUT endpoint handles:
- Conflict detection (`checkServerConflicts`)
- Room conflict detection (`checkRoomConflict`)
- Linked booking cascade (time/duration/status sync)
- History recording
- Telegram notifications

### 7.3. Undo Toast

```js
function showDragUndoToast(booking, timeDelta, lineChanged) {
    // Remove existing toast
    const existingToast = document.querySelector('.drag-undo-toast');
    if (existingToast) existingToast.remove();

    const label = booking.label || booking.programCode;
    let message;
    if (lineChanged && timeDelta !== 0) {
        message = `${label} переміщено на іншу лінію та ${timeDelta > 0 ? '+' : ''}${timeDelta} хв`;
    } else if (lineChanged) {
        message = `${label} переміщено на іншу лінію`;
    } else {
        message = `${label} перенесено на ${timeDelta > 0 ? '+' : ''}${timeDelta} хв`;
    }

    const toast = document.createElement('div');
    toast.className = 'drag-undo-toast';
    toast.innerHTML = `
        <span>${escapeHtml(message)}</span>
        <button onclick="handleUndo(); this.parentElement.remove();">Скасувати</button>
    `;
    document.body.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }
    }, 5000);
}
```

### 7.4. Undo Handler Extension

Add 'drag' action to the existing `handleUndo()` in `ui.js`:

```js
// In handleUndo() switch/if chain, add:
} else if (item.action === 'drag') {
    const { bookingId, oldTime, oldLineId, timeDelta, linked } = item.data;
    const bookings = await getBookingsForDate(AppState.selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (booking) {
        // Restore main booking
        await apiUpdateBooking(bookingId, { ...booking, time: oldTime, lineId: oldLineId });
        // Restore linked bookings
        for (const lb of linked) {
            const lbBooking = bookings.find(b => b.id === lb.id);
            if (lbBooking) {
                await apiUpdateBooking(lb.id, { ...lbBooking, time: lb.oldTime });
            }
        }
        await apiAddHistory('undo_drag', AppState.currentUser?.username, {
            ...booking, time: oldTime, lineId: oldLineId
        });
    }
    showNotification('Перетягування скасовано', 'warning');

} else if (item.action === 'resize') {
    const { bookingId, oldDuration, linked } = item.data;
    const bookings = await getBookingsForDate(AppState.selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (booking) {
        await apiUpdateBooking(bookingId, { ...booking, duration: oldDuration });
        for (const lbId of linked) {
            const lb = bookings.find(b => b.id === lbId);
            if (lb) await apiUpdateBooking(lbId, { ...lb, duration: oldDuration });
        }
    }
    showNotification('Зміну тривалості скасовано', 'warning');
}
```

---

## 8. Cross-Dependencies with Other Features

### 8.1. Feature #8: Optimistic Locking (updated_at)

When #8 is implemented:
- Each booking will have an `updated_at` timestamp used for conflict resolution
- Drag-and-drop PUT requests should include `updated_at` from the cached booking
- If server detects stale data (another user modified since), return 409
- Frontend shows: "Бронювання було змінено іншим користувачем. Оновіть сторінку."
- On 409 from stale data: force cache invalidation + re-render

```js
// When #8 is ready, add to apiUpdateBooking body:
body: JSON.stringify({
    ...booking,
    expectedUpdatedAt: booking.updatedAt  // optimistic lock
})
```

### 8.2. Feature #10: WebSocket Real-Time Updates

When #10 is implemented:
- After successful drag → server broadcasts update via WebSocket
- Other connected clients receive the update and re-render
- Drag should NOT trigger re-render from incoming WebSocket if the current user initiated it
- Use a "pending operation ID" to deduplicate:

```js
// On drag save:
const opId = `drag_${Date.now()}_${Math.random()}`;
AppState.pendingOpId = opId;
// Include opId in PUT request body

// On WebSocket message:
if (msg.opId === AppState.pendingOpId) {
    // Ignore — this is our own update
    return;
}
// Otherwise: re-render timeline
```

### 8.3. Feature #11: Multi-User Awareness

When #11 is implemented:
- Show which user is currently dragging a booking (presence indicator)
- If another user starts dragging the same booking → block or warn
- Release lock on drag end / disconnect

---

## 9. Rollback Strategy

```js
function rollbackDragVisuals(state) {
    const s = state;

    // Restore main block position
    s.block.style.left = `${s.startLeft}px`;
    s.block.classList.remove('dragging');

    // Restore related blocks
    s.relatedBlocks.forEach((rb, i) => {
        rb.el.style.left = `${s.relatedOriginals[i].left}px`;
        rb.el.classList.remove('dragging-related');
    });

    // Remove UI elements
    if (s.timeLabel) s.timeLabel.remove();
    removeDropGhost();
    clearDropIndicators();
    document.body.classList.remove('dragging-active');

    // Clear scroll interval
    if (s.scrollInterval) clearInterval(s.scrollInterval);
}
```

---

## 10. Integration Points in Existing Code

### 10.1. timeline.js Changes

In `createBookingBlock()` (line ~320):
```diff
+ // Feature #14: Initialize drag
+ if (!isViewer() && !booking.linkedTo) {
+     initBookingDrag(block, booking, startHour);
+ }
+ // Feature #14: Add resize handle
+ if (!isViewer() && !booking.linkedTo) {
+     const resizeHandle = document.createElement('div');
+     resizeHandle.className = 'resize-handle';
+     block.appendChild(resizeHandle);
+     initBookingResize(resizeHandle, block, booking, startHour);
+ }
```

### 10.2. ui.js Changes

In `handleUndo()` (line ~278):
```diff
+ } else if (item.action === 'drag') {
+     // ... (see section 7.4)
+ } else if (item.action === 'resize') {
+     // ... (see section 7.4)
```

### 10.3. app.js Changes

In `initializeApp()`:
```diff
+ // Feature #14: Initialize drag system
+ initDragSystem();
```

### 10.4. index.html Changes

```diff
+ <script src="js/drag.js?v=X.XX"></script>
```

### 10.5. css/timeline.css Changes

Add all CSS from section 3.1 at the end of the file.

---

## 11. Edge Cases & Error Handling

### 11.1. Multi-Day Mode

Drag is **DISABLED** in multi-day mode (`AppState.multiDayMode === true`).
Multi-day renders mini-blocks with different dimensions; drag math would be wrong.

### 11.2. Status-Filtered Bookings

If a booking is hidden by status filter (`.status-hidden`):
- It cannot be dragged (not visible)
- BUT it still exists for conflict detection
- `checkConflicts()` checks ALL bookings, not just visible ones

### 11.3. Afisha Blocks

Afisha blocks already have their own drag system (`_afishaDragState`).
Booking drag (`_bookingDragState`) and afisha drag are mutually exclusive.
Guard: `if (_afishaDragState) return;` at the start of booking drag handler.

### 11.4. Viewer Role

Viewers (`isViewer()`) cannot drag. `initBookingDrag()` exits early for viewers.

### 11.5. Concurrent Operations

- If drag is in progress and user presses Ctrl+Z → ignore undo until drag ends
- If drag is in progress and date changes → cancel drag
- If drag is in progress and booking panel opens → cancel drag

### 11.6. Network Errors

On API failure during save:
- Rollback visual position
- Show error notification
- Do NOT push to undo stack (nothing to undo)

### 11.7. Zoom Change During Drag

If user changes zoom while dragging → cancel drag. Add guard in `changeZoom()`:
```js
if (_bookingDragState) { rollbackDragVisuals(_bookingDragState); _bookingDragState = null; }
```

---

## 12. Testing Plan

### 12.1. Manual Testing Scenarios

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Drag single booking +30 min | Block moves, API updated, undo toast shows |
| 2 | Drag booking into occupied slot | Rollback + error notification |
| 3 | Drag 2-host booking | Both blocks move in sync |
| 4 | Drag 2-host into conflict on 2nd line | Rollback + error with animator name |
| 5 | Drag to different line (same time) | Line switch, API updated |
| 6 | Drag to different line + time | Both line and time change |
| 7 | Click undo after drag | Booking returns to original position |
| 8 | Resize by dragging right edge | Duration changes, width updates |
| 9 | Resize into next booking | Rollback + error |
| 10 | Mobile long-press + drag | Works same as desktop |
| 11 | Mobile scroll (no long-press) | Normal scroll, no drag |
| 12 | Drag near edge of timeline | Auto-scroll activates |
| 13 | Drag linked booking (click instead) | Opens parent booking details |
| 14 | Drag in viewer mode | Nothing happens |
| 15 | Drag in multi-day mode | Disabled |
| 16 | Network error during save | Rollback + error notification |
| 17 | Drag with zoom 30 | Correct pixel-to-time mapping |
| 18 | Drag with compact mode | Correct pixel-to-time mapping |
| 19 | Drag preliminary booking | Works, maintains status |
| 20 | Drag booking with notes/extras | All data preserved in PUT |

### 12.2. Automated Tests (tests/api.test.js)

```js
// New test suite: Drag-and-Drop
describe('Drag and Drop (API)', () => {
    test('PUT updates time and line_id', async () => { /* ... */ });
    test('PUT returns 409 on conflict', async () => { /* ... */ });
    test('PUT cascades to linked bookings', async () => { /* ... */ });
    test('PUT preserves all booking fields', async () => { /* ... */ });
});
```

---

## 13. Implementation Order

### Phase 1: Core Drag (MVP)
1. Create `js/drag.js` with state management
2. Add CSS for `.dragging`, `.drag-time-label`, `.drag-ghost`
3. Implement horizontal drag (time shift only)
4. Snap to 5-minute grid
5. API save + cache invalidation + re-render
6. Undo support for drag

### Phase 2: Cross-Line Drag
7. Detect target line from Y position
8. Highlight target line (`.drag-target`)
9. Ghost preview on target line
10. Line switch + time shift combined

### Phase 3: Related Bookings
11. Collect linked bookings on drag start
12. Move related blocks in sync
13. Validate ALL positions before save
14. Specific error messages per conflicting line

### Phase 4: Resize
15. Add resize handle element
16. Resize logic (width change + duration save)
17. Conflict detection for resize
18. Undo support for resize

### Phase 5: Mobile
19. Long-press detection (300ms)
20. Touch scroll vs drag distinction
21. Auto-scroll near edges
22. Wider touch targets for resize handle
23. Haptic feedback

### Phase 6: Polish
24. Undo toast with "Скасувати" button
25. "No pause" warning during drag
26. Dark mode compatibility
27. Compact mode testing
28. All zoom levels testing

---

## 14. Performance Considerations

- **No re-render during drag**: Only manipulate `style.left` and `style.width` on existing DOM elements
- **requestAnimationFrame**: Consider batching position updates for smooth 60fps
- **Conflict checks during drag**: Use cached bookings (`AppState.cachedBookings`), NOT fresh API calls
- **Final validation on drop**: Single fresh conflict check via existing `checkConflicts()` (uses cache)
- **Server validation**: The PUT endpoint does its own conflict check, providing a safety net

---

## 15. Accessibility (a11y)

- Keyboard alternative: Existing time-shift buttons (+15, +30, etc.) and line-switch buttons remain as non-drag alternatives for keyboard users
- Screen reader: `aria-grabbed` and `aria-dropeffect` on booking blocks (optional enhancement)
- Focus management: After drag completes, focus returns to the dragged block

---

## 16. Version & Changelog

When implementing, bump version in `package.json` and `index.html`:
```
v8.7.0: Drag-and-Drop таймлайн — перетягування бронювань мишкою/пальцем,
зміна часу та лінії, ресайз тривалості, підтримка пов'язаних бронювань
```
