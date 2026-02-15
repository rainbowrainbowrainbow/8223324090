/**
 * booking.js - Панель бронювання, форма, деталі, видалення, перенос часу
 */

// ==========================================
// ПАНЕЛЬ БРОНЮВАННЯ
// ==========================================

async function openBookingPanel(time, lineId) {
    const lines = await getLinesForDate(AppState.selectedDate);
    const line = lines.find(l => l.id === lineId);

    // C1: Show date in panel
    const dateDisplay = document.getElementById('selectedDateDisplay');
    if (dateDisplay) {
        const d = AppState.selectedDate;
        dateDisplay.textContent = `${formatDate(d)} (${DAYS[d.getDay()]})`;
    }
    document.getElementById('selectedTimeDisplay').textContent = time;
    document.getElementById('selectedLineDisplay').textContent = line ? line.name : '-';
    document.getElementById('bookingTime').value = time;
    document.getElementById('bookingLine').value = lineId;

    // Скинути форму
    document.getElementById('roomSelect').value = '';
    document.getElementById('selectedProgram').value = '';
    document.getElementById('bookingNotes').value = '';
    const groupInput = document.getElementById('bookingGroupName');
    if (groupInput) groupInput.value = '';
    document.querySelectorAll('.program-icon').forEach(i => i.classList.remove('selected'));
    // v5.49: Reset program search
    const programSearch = document.getElementById('programSearch');
    if (programSearch) { programSearch.value = ''; filterPrograms(); }
    document.getElementById('programDetails').classList.add('hidden');
    document.getElementById('hostsWarning').classList.add('hidden');
    document.getElementById('customProgramSection').classList.add('hidden');
    document.getElementById('secondAnimatorSection').classList.add('hidden');
    document.getElementById('pinataFillerSection').classList.add('hidden');

    // Скинути toggle додаткового ведучого
    const extraHostToggle = document.getElementById('extraHostToggle');
    if (extraHostToggle) {
        extraHostToggle.checked = false;
        document.getElementById('extraHostAnimatorSection').classList.add('hidden');
    }

    // Скинути костюм
    const costumeSelect = document.getElementById('costumeSelect');
    if (costumeSelect) costumeSelect.value = '';

    // Скинути статус та к-кість дітей
    const statusRadio = document.querySelector('input[name="bookingStatus"][value="confirmed"]');
    if (statusRadio) statusRadio.checked = true;
    const kidsCountSection = document.getElementById('kidsCountSection');
    if (kidsCountSection) kidsCountSection.classList.add('hidden');
    const kidsCountInput = document.getElementById('kidsCountInput');
    if (kidsCountInput) kidsCountInput.value = '';

    // v5.18: Reset focus mode — show all categories when opening panel
    const allHeaders = document.querySelectorAll('#programsIcons .category-header');
    const allGrids = document.querySelectorAll('#programsIcons .category-grid');
    allHeaders.forEach(h => h.style.display = '');
    allGrids.forEach(g => g.style.display = '');
    const changeBtn = document.getElementById('changeProgramBtn');
    if (changeBtn) changeBtn.remove();

    document.getElementById('bookingPanel').classList.remove('hidden');
    document.querySelector('.main-content').classList.add('panel-open');
    // v5.33: Lock body scroll on mobile when panel is open
    document.body.classList.add('panel-open');
    // v5.35: Show backdrop overlay on tablet/mobile
    document.getElementById('panelBackdrop')?.classList.remove('hidden');
}

// v5.18: Show free rooms for selected time/duration
async function showFreeRooms() {
    const date = formatDate(AppState.selectedDate);
    let time = document.getElementById('bookingTime')?.value;
    // v5.19: fallback to selected cell time
    if (!time && AppState.selectedCell) time = AppState.selectedCell.dataset.time;
    const programId = document.getElementById('selectedProgram')?.value;
    const program = programId ? getProductsSync().find(p => p.id === programId) : null;
    const duration = program ? program.duration : 60;

    if (!time) {
        showNotification('Спочатку оберіть час', 'error');
        return;
    }

    const panel = document.getElementById('freeRoomsPanel');
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="loading-spinner">Завантаження...</div>';

    try {
        const response = await fetch(`${API_BASE}/rooms/free/${date}/${time}/${duration}`, {
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return;
        const data = await response.json();

        if (data.free && data.free.length > 0) {
            panel.innerHTML = data.free.map(room =>
                `<span class="free-room-chip" onclick="document.getElementById('roomSelect').value='${escapeHtml(room)}';document.getElementById('freeRoomsPanel').classList.add('hidden')">${escapeHtml(room)}</span>`
            ).join('') +
            (data.occupied.length > 0 ? `<div class="occupied-rooms">Зайняті: ${data.occupied.map(r => escapeHtml(r)).join(', ')}</div>` : '');
        } else {
            panel.innerHTML = '<span class="no-free-rooms">Всі кімнати зайняті в цей час</span>';
        }
    } catch (err) {
        panel.innerHTML = '<span class="no-free-rooms">Помилка завантаження</span>';
    }
}

function closeBookingPanel() {
    document.getElementById('bookingPanel').classList.add('hidden');
    document.querySelector('.main-content').classList.remove('panel-open');
    // v5.33: Unlock body scroll
    document.body.classList.remove('panel-open');
    // v5.35: Hide backdrop overlay
    document.getElementById('panelBackdrop')?.classList.add('hidden');
    document.querySelectorAll('.grid-cell.selected').forEach(c => c.classList.remove('selected'));

    // v5.5: Скинути режим редагування
    if (AppState.editingBookingId) {
        AppState.editingBookingId = null;
        AppState.editingBookingUpdatedAt = null; // Clear optimistic lock
        document.querySelector('#bookingPanel .panel-header h3').textContent = 'Нове бронювання';
        document.querySelector('#bookingForm .btn-submit').textContent = 'Додати бронювання';
    }
}

async function renderProgramIcons() {
    const container = document.getElementById('programsIcons');

    // v7.0: Load products from API (with fallback to PROGRAMS)
    // Don't clear DOM until data is ready — prevents blank flash
    const allProducts = await getProducts();

    container.innerHTML = '';

    CATEGORY_ORDER_BOOKING.forEach(cat => {
        const programs = allProducts.filter(p => p.category === cat);
        if (programs.length === 0) return;

        const header = document.createElement('div');
        header.className = 'category-header';
        header.dataset.category = cat;
        header.textContent = CATEGORY_NAMES_BOOKING[cat] || cat;
        container.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'category-grid';
        grid.dataset.category = cat;
        programs.forEach(p => {
            const icon = document.createElement('div');
            icon.className = `program-icon ${p.category}`;
            icon.dataset.programId = p.id;
            icon.dataset.search = `${p.code} ${p.name} ${p.label}`.toLowerCase();
            const durationBadge = p.duration > 0
                ? `<span class="program-duration ${p.duration <= 60 ? 'short' : 'long'}">${p.duration}'</span>`
                : '';
            icon.innerHTML = `
                ${durationBadge}
                <span class="icon-circle"><span class="icon">${p.icon}</span></span>
                <span class="name">${p.code}</span>
            `;
            icon.addEventListener('click', () => selectProgram(p.id));
            grid.appendChild(icon);
        });
        container.appendChild(grid);
    });

    // v5.49: Bind search input (remove old listener to avoid duplicates)
    const searchInput = document.getElementById('programSearch');
    if (searchInput) {
        searchInput.removeEventListener('input', filterPrograms);
        searchInput.addEventListener('input', filterPrograms);
    }
}

function filterPrograms() {
    const query = (document.getElementById('programSearch')?.value || '').toLowerCase().trim();
    const icons = document.querySelectorAll('#programsIcons .program-icon');
    const headers = document.querySelectorAll('#programsIcons .category-header');
    const grids = document.querySelectorAll('#programsIcons .category-grid');

    icons.forEach(icon => {
        const match = !query || icon.dataset.search.includes(query);
        icon.style.display = match ? '' : 'none';
    });

    // Hide empty categories
    grids.forEach(grid => {
        const cat = grid.dataset.category;
        const visible = grid.querySelectorAll('.program-icon:not([style*="display: none"])');
        const hidden = visible.length === 0;
        grid.style.display = hidden ? 'none' : '';
        const header = document.querySelector(`.category-header[data-category="${cat}"]`);
        if (header) header.style.display = hidden ? 'none' : '';
    });
}

function selectProgram(programId) {
    const program = getProductsSync().find(p => p.id === programId);
    if (!program) return;

    document.querySelectorAll('.program-icon').forEach(i => i.classList.remove('selected'));
    const selectedEl = document.querySelector(`[data-program-id="${programId}"]`);
    if (selectedEl) selectedEl.classList.add('selected');
    document.getElementById('selectedProgram').value = programId;

    const priceText = program.perChild ? `${formatPrice(program.price)}/дит` : formatPrice(program.price);
    document.getElementById('detailDuration').textContent = program.duration > 0 ? `${program.duration} хв` : '—';
    document.getElementById('detailHosts').textContent = program.hosts;
    document.getElementById('detailPrice').textContent = priceText;

    const ageEl = document.getElementById('detailAge');
    const kidsEl = document.getElementById('detailKids');
    if (ageEl) ageEl.textContent = program.age || '—';
    if (kidsEl) kidsEl.textContent = program.kids || '—';

    document.getElementById('programDetails').classList.remove('hidden');

    if (program.isCustom) {
        document.getElementById('customProgramSection').classList.remove('hidden');
    } else {
        document.getElementById('customProgramSection').classList.add('hidden');
    }

    if (program.hasFiller) {
        document.getElementById('pinataFillerSection').classList.remove('hidden');
        document.getElementById('pinataFillerSelect').value = '';
    } else {
        document.getElementById('pinataFillerSection').classList.add('hidden');
    }

    if (program.hosts > 1) {
        document.getElementById('hostsWarning').classList.remove('hidden');
        document.getElementById('secondAnimatorSection').classList.remove('hidden');
        populateSecondAnimatorSelect();
    } else {
        document.getElementById('hostsWarning').classList.add('hidden');
        document.getElementById('secondAnimatorSection').classList.add('hidden');
    }

    // v5.9: Focus mode — collapse unselected categories (Progressive Disclosure)
    const allHeaders = document.querySelectorAll('#programsIcons .category-header');
    const allGrids = document.querySelectorAll('#programsIcons .category-grid');
    const selectedIcon = document.querySelector(`[data-program-id="${programId}"]`);
    const selectedGrid = selectedIcon ? selectedIcon.closest('.category-grid') : null;

    allHeaders.forEach(h => h.style.display = 'none');
    allGrids.forEach(g => {
        if (g !== selectedGrid) g.style.display = 'none';
    });

    let changeBtn = document.getElementById('changeProgramBtn');
    if (changeBtn) changeBtn.remove();
    changeBtn = document.createElement('button');
    changeBtn.type = 'button';
    changeBtn.id = 'changeProgramBtn';
    changeBtn.className = 'btn-change-program';
    changeBtn.textContent = '🔄 Змінити програму';
    changeBtn.addEventListener('click', () => {
        allHeaders.forEach(h => h.style.display = '');
        allGrids.forEach(g => g.style.display = '');
        changeBtn.remove();
    });
    const iconsContainer = document.getElementById('programsIcons');
    if (iconsContainer) iconsContainer.parentNode.insertBefore(changeBtn, iconsContainer);

    // К-кість дітей для МК (perChild)
    const kidsCountSection = document.getElementById('kidsCountSection');
    if (kidsCountSection) {
        if (program.perChild) {
            kidsCountSection.classList.remove('hidden');
            const kidsInput = document.getElementById('kidsCountInput');
            if (kidsInput) {
                kidsInput.value = '';
                kidsInput.oninput = () => {
                    const count = parseInt(kidsInput.value) || 0;
                    const total = count * program.price;
                    document.getElementById('detailPrice').textContent = count > 0
                        ? `${formatPrice(program.price)} x ${count} = ${formatPrice(total)}`
                        : `${formatPrice(program.price)}/дит`;
                };
            }
        } else {
            kidsCountSection.classList.add('hidden');
        }
    }

    // v8.3.1: T-shirt sizes section
    const tshirtSection = document.getElementById('tshirtSizesSection');
    if (tshirtSection) {
        if (programId === 'mk_tshirt') {
            tshirtSection.classList.remove('hidden');
            ['XS', 'S', 'M', 'L', 'XL'].forEach(s => {
                const inp = document.getElementById('tshirt' + s);
                if (inp) inp.value = '0';
            });
        } else {
            tshirtSection.classList.add('hidden');
        }
    }
}

async function populateAnimatorSelectById(selectId, placeholder) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const lines = await getLinesForDate(AppState.selectedDate);
    const currentLineId = document.getElementById('bookingLine').value;

    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;

    lines.forEach(line => {
        if (line.id !== currentLineId) {
            const option = document.createElement('option');
            option.value = line.name;
            option.textContent = line.name;
            select.appendChild(option);
        }
    });
}

async function populateSecondAnimatorSelect() {
    await populateAnimatorSelectById('secondAnimatorSelect', 'Оберіть другого аніматора');
}

async function populateExtraHostAnimatorSelect() {
    await populateAnimatorSelectById('extraHostAnimatorSelect', 'Оберіть аніматора');
}

// v7.9.3: Resolve secondAnimator name when line was renamed
// If the stored name doesn't match any current line, tries to find via linked booking
async function resolveSecondAnimatorSelect(storedName, bookingId) {
    const select = document.getElementById('secondAnimatorSelect');
    if (!select) return;
    select.value = storedName;
    // If the stored name matches an option, we're done
    if (select.value === storedName) return;

    // Name doesn't match — try to resolve via linked booking's line_id
    if (bookingId) {
        const bookings = await getBookingsForDate(AppState.selectedDate);
        const mainBooking = bookings.find(b => b.id === bookingId);
        if (mainBooking) {
            const linked = bookings.find(b => b.linkedTo === bookingId && b.lineId !== mainBooking.lineId);
            if (linked) {
                const lines = await getLinesForDate(AppState.selectedDate);
                const resolvedLine = lines.find(l => l.id === linked.lineId);
                if (resolvedLine) {
                    select.value = resolvedLine.name;
                    if (select.value === resolvedLine.name) return;
                }
            }
        }
    }
    // Couldn't resolve — show warning
    showNotification(`⚠️ Другий аніматор "${storedName}" не знайдений (лінію перейменовано?)`, 'warning');
}

function updateCustomDuration() {
    const duration = parseInt(document.getElementById('customDuration').value) || 30;
    document.getElementById('detailDuration').textContent = `${duration} хв`;
}

// ==========================================
// СТВОРЕННЯ БРОНЮВАННЯ
// ==========================================

function getBookingFormData() {
    const programId = document.getElementById('selectedProgram').value;
    const room = document.getElementById('roomSelect').value;
    const program = programId ? getProductsSync().find(p => p.id === programId) : null;
    const time = document.getElementById('bookingTime').value;
    const lineId = document.getElementById('bookingLine').value;

    let duration = program ? program.duration : 0;
    let label = program ? program.label : '';

    if (program && program.isCustom) {
        duration = parseInt(document.getElementById('customDuration').value) || 30;
        const customName = document.getElementById('customName').value || 'Інше';
        label = `${customName}(${duration})`;
    }

    let pinataFiller = '';
    if (program && program.hasFiller) {
        pinataFiller = document.getElementById('pinataFillerSelect').value;
        if (pinataFiller) label = `Пін+${pinataFiller}`;
    }

    const secondAnimator = program && program.hosts > 1
        ? document.getElementById('secondAnimatorSelect').value : null;

    return { programId, room, program, time, lineId, duration, label, pinataFiller, secondAnimator };
}

async function validateBookingConflicts(lineId, time, duration, program, secondAnimator, excludeId = null) {
    delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
    const conflict = await checkConflicts(lineId, time, duration, excludeId);

    if (conflict.overlap) {
        showNotification('❌ ПОМИЛКА: Цей час вже зайнятий!', 'error');
        return false;
    }

    if (secondAnimator) {
        const lines = await getLinesForDate(AppState.selectedDate);
        const secondLine = lines.find(l => l.name === secondAnimator);
        if (secondLine) {
            // v5.5: При редагуванні виключити linked бронювання цього ж запису
            const allBookings = excludeId ? await getBookingsForDate(AppState.selectedDate) : [];
            const linkedId = allBookings.find(b => b.linkedTo === excludeId && b.lineId === secondLine.id)?.id || null;
            const secondConflict = await checkConflicts(secondLine.id, time, duration, linkedId);
            if (secondConflict.overlap) {
                showNotification(`❌ ПОМИЛКА: Час зайнятий у ${secondAnimator}!`, 'error');
                return false;
            }
        }
    }

    if (conflict.noPause && program.category !== 'pinata') {
        showWarning('⚠️ УВАГА! Немає 15-хвилинної паузи між програмами. Це ДУЖЕ НЕБАЖАНО!');
    }

    return true;
}

async function checkDuplicateProgram(programId, program, time, duration, excludeId = null) {
    if (program.category === 'animation' || programId === 'anim_extra') return true;

    const allBookings = await getBookingsForDate(AppState.selectedDate);
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;

    const duplicate = allBookings.find(b => {
        if (b.id === excludeId) return false;
        if (b.programId !== programId) return false;
        const start = timeToMinutes(b.time);
        const end = start + b.duration;
        return newStart < end && newEnd > start;
    });

    if (duplicate) {
        showNotification(`❌ ПОМИЛКА: ${program.name} вже є о ${duplicate.time}!`, 'error');
        return false;
    }
    return true;
}

function buildBookingObject(formData, program) {
    const costume = document.getElementById('costumeSelect').value;
    const statusEl = document.querySelector('input[name="bookingStatus"]:checked');
    const status = statusEl ? statusEl.value : 'confirmed';
    const kidsCountInput = document.getElementById('kidsCountInput');
    const kidsCount = (program.perChild && kidsCountInput) ? (parseInt(kidsCountInput.value) || 0) : 0;
    const finalPrice = program.perChild && kidsCount > 0 ? program.price * kidsCount : program.price;

    const obj = {
        date: formatDate(AppState.selectedDate),
        time: formData.time,
        lineId: formData.lineId,
        programId: formData.programId,
        programCode: program.code,
        label: formData.label,
        programName: program.isCustom ? (document.getElementById('customName').value || 'Інше') : program.name,
        category: program.category,
        duration: formData.duration,
        price: finalPrice,
        hosts: program.hosts,
        secondAnimator: formData.secondAnimator,
        pinataFiller: formData.pinataFiller,
        costume: costume,
        room: formData.room,
        notes: document.getElementById('bookingNotes').value,
        createdBy: AppState.currentUser ? AppState.currentUser.username : '',
        createdAt: new Date().toISOString(),
        status: status,
        kidsCount: kidsCount || null,
        groupName: document.getElementById('bookingGroupName')?.value.trim() || null,
        extraData: buildExtraData(formData.programId)
    };

    // Optimistic locking: include updatedAt from the booking being edited
    if (AppState.editingBookingId) {
        obj.updatedAt = AppState.editingBookingUpdatedAt || null;
    }

    return obj;
}

function buildExtraData(programId) {
    if (programId === 'mk_tshirt') {
        const sizes = {};
        ['XS', 'S', 'M', 'L', 'XL'].forEach(s => {
            const val = parseInt(document.getElementById('tshirt' + s)?.value) || 0;
            if (val > 0) sizes[s] = val;
        });
        if (Object.keys(sizes).length > 0) return { tshirt_sizes: sizes };
    }
    return null;
}

// v5.7: Build linked bookings array (for transactional create)
async function buildLinkedBookings(booking, program) {
    const linked = [];
    const lines = await getLinesForDate(AppState.selectedDate);

    // Другий ведучий
    if (program.hosts > 1 && booking.secondAnimator) {
        const secondLine = lines.find(l => l.name === booking.secondAnimator);
        if (secondLine) {
            linked.push({
                date: booking.date, time: booking.time, lineId: secondLine.id,
                programId: booking.programId, programCode: booking.programCode,
                label: booking.label, programName: booking.programName,
                category: booking.category, duration: booking.duration,
                price: booking.price, hosts: booking.hosts,
                secondAnimator: booking.secondAnimator,
                pinataFiller: booking.pinataFiller,
                costume: booking.costume, room: booking.room,
                notes: booking.notes, createdBy: booking.createdBy,
                status: booking.status, kidsCount: booking.kidsCount
            });
        }
    }

    // Додатковий ведучий (700 ₴/год)
    const extraHostToggle = document.getElementById('extraHostToggle');
    if (extraHostToggle && extraHostToggle.checked) {
        const extraHostAnimator = document.getElementById('extraHostAnimatorSelect').value;
        if (extraHostAnimator) {
            const extraLine = lines.find(l => l.name === extraHostAnimator);
            if (extraLine) {
                const extraPrice = Math.round(700 * (booking.duration / 60));
                linked.push({
                    date: booking.date, time: booking.time, lineId: extraLine.id,
                    programId: 'anim_extra', programCode: '+Вед',
                    label: `+Вед(${booking.duration})`, programName: 'Додатковий ведучий',
                    category: 'animation', duration: booking.duration, price: extraPrice,
                    hosts: 1, room: booking.room, createdBy: booking.createdBy,
                    status: booking.status
                });
            }
        }
    }

    return linked;
}

/**
 * v7.10: Check if the primary/secondary animator is off duty on the booking date.
 * Uses GET /api/staff/schedule/check/:date which returns available/unavailable animators.
 * Shows a warning (non-blocking) if an animator has dayoff/vacation/sick status.
 */
async function checkAnimatorAvailability(lineId, secondAnimatorName) {
    try {
        const dateStr = formatDate(AppState.selectedDate);
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`/api/staff/schedule/check/${dateStr}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!data.success) return;

        const lines = await getLinesForDate(AppState.selectedDate);
        const primaryLine = lines.find(l => l.id === lineId);
        const primaryName = primaryLine?.name;

        // Check primary animator
        if (primaryName) {
            const off = data.unavailable.find(u => u.name === primaryName);
            if (off) {
                showNotification(`⚠️ ${primaryName}: ${STATUS_LABELS_BOOKING[off.status] || off.status} на ${dateStr}`, 'warning');
            }
        }

        // Check second animator
        if (secondAnimatorName) {
            const off = data.unavailable.find(u => u.name === secondAnimatorName);
            if (off) {
                showNotification(`⚠️ ${secondAnimatorName}: ${STATUS_LABELS_BOOKING[off.status] || off.status} на ${dateStr}`, 'warning');
            }
        }
    } catch (err) {
        // Non-critical: don't block booking if check fails
    }
}

const STATUS_LABELS_BOOKING = {
    dayoff: 'вихідний',
    vacation: 'відпустка',
    sick: 'лікарняний'
};

function unlockSubmitBtn() {
    const btn = document.getElementById('bookingSubmitBtn');
    if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.originalText || 'Додати бронювання';
    }
}

async function handleBookingSubmit(e) {
    e.preventDefault();

    const submitBtn = document.getElementById('bookingSubmitBtn');
    if (submitBtn && submitBtn.disabled) return;
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.originalText = submitBtn.textContent;
        submitBtn.textContent = 'Збереження...';
    }

    const formData = getBookingFormData();

    if (!formData.programId) { showNotification('Оберіть програму', 'error'); unlockSubmitBtn(); return; }
    if (!formData.room) { showNotification('Оберіть кімнату', 'error'); unlockSubmitBtn(); return; }
    if (formData.program.hasFiller && !formData.pinataFiller) {
        showNotification('Оберіть наповнювач для піньяти', 'error'); unlockSubmitBtn(); return;
    }
    // v8.7: Require second animator for multi-host programs
    if (formData.program.hosts > 1 && !formData.secondAnimator) {
        showNotification('Оберіть другого аніматора — ця програма потребує 2 ведучих', 'error'); unlockSubmitBtn(); return;
    }

    // v7.10: Check if animator is off duty on this date
    await checkAnimatorAvailability(formData.lineId, formData.secondAnimator);

    // v5.5: excludeId для режиму редагування
    const excludeId = AppState.editingBookingId || null;

    // Валідація конфліктів
    const valid = await validateBookingConflicts(
        formData.lineId, formData.time, formData.duration,
        formData.program, formData.secondAnimator, excludeId
    );
    if (!valid) { unlockSubmitBtn(); return; }

    // Перевірка дублікатів
    const noDuplicate = await checkDuplicateProgram(
        formData.programId, formData.program, formData.time, formData.duration, excludeId
    );
    if (!noDuplicate) { unlockSubmitBtn(); return; }

    try {
        const booking = buildBookingObject(formData, formData.program);

        if (AppState.editingBookingId) {
            // ===== РЕЖИМ РЕДАГУВАННЯ (v5.5) =====
            booking.id = AppState.editingBookingId;

            // Зберегти оригінального автора
            const oldBookings = await getBookingsForDate(AppState.selectedDate);
            const oldBooking = oldBookings.find(b => b.id === booking.id);
            if (oldBooking) {
                booking.createdBy = oldBooking.createdBy;
                booking.createdAt = oldBooking.createdAt;
                // v8.3.2: Don't restore old extraData — respect user's choice to clear sizes
            }

            const updateResult = await apiUpdateBooking(booking.id, booking);
            if (updateResult && updateResult.success === false) {
                // Optimistic locking: check if it's a version conflict
                if (updateResult.conflict) {
                    await handleOptimisticLockConflict(updateResult, booking);
                    unlockSubmitBtn();
                    return;
                }
                showNotification(updateResult.error || 'Помилка оновлення бронювання', 'error');
                unlockSubmitBtn(); return;
            }
            // Update stored updatedAt from server response
            if (updateResult && updateResult.booking) {
                AppState.editingBookingUpdatedAt = updateResult.booking.updatedAt;
            }
            await apiAddHistory('edit', AppState.currentUser?.username, booking);

            // v5.51: Save undo for edit (store old state)
            if (oldBooking) pushUndo('edit', { old: { ...oldBooking }, updated: { ...booking } });

            AppState.editingBookingId = null;

            delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
            closeBookingPanel();
            unlockSubmitBtn();
            await renderTimeline();
            showNotification('Бронювання оновлено!', 'success');
        } else {
            // ===== РЕЖИМ СТВОРЕННЯ (v5.7: transactional with linked) =====
            const linked = await buildLinkedBookings(booking, formData.program);
            let createResult;

            if (linked.length > 0) {
                createResult = await apiCreateBookingFull(booking, linked);
            } else {
                createResult = await apiCreateBooking(booking);
            }

            if (createResult && createResult.success === false) {
                showNotification(createResult.error || 'Помилка створення бронювання', 'error');
                unlockSubmitBtn(); return;
            }
            // v5.27: API now returns { booking: { id, ... } }
            if (createResult && createResult.booking) {
                booking.id = createResult.booking.id;
            } else if (createResult && createResult.id) {
                booking.id = createResult.id;
            }
            // History + Telegram handled by server

            pushUndo('create', [booking]);

            delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
            closeBookingPanel();
            unlockSubmitBtn();
            await renderTimeline();
            showNotification('Бронювання створено!', 'success');
        }
    } catch (error) {
        handleError('Збереження бронювання', error);
        unlockSubmitBtn();
    }
}

// ==========================================
// OPTIMISTIC LOCKING CONFLICT HANDLER
// ==========================================

async function handleOptimisticLockConflict(result, localBooking) {
    const serverData = result.currentData;
    if (!serverData) {
        showNotification('Бронювання було змінено іншим користувачем. Оновіть сторінку.', 'error');
        return;
    }

    // Build a summary of what changed
    const changes = [];
    if (serverData.time !== localBooking.time) changes.push(`Час: ${serverData.time}`);
    if (serverData.room !== localBooking.room) changes.push(`Кімната: ${serverData.room}`);
    if (serverData.status !== localBooking.status) changes.push(`Статус: ${serverData.status}`);
    if (serverData.lineId !== localBooking.lineId) changes.push('Лінія змінена');
    if (serverData.notes !== localBooking.notes) changes.push('Примітки змінені');
    if (serverData.kidsCount !== localBooking.kidsCount) changes.push(`К-сть дітей: ${serverData.kidsCount}`);

    const changesText = changes.length > 0
        ? `\n\nЗміни на сервері:\n${changes.map(c => `  - ${c}`).join('\n')}`
        : '';

    const message = `Бронювання було змінено іншим користувачем.${changesText}\n\nЩо зробити?`;

    // Show custom conflict dialog with two options
    const overwrite = await customConfirm(
        message,
        'Конфлікт редагування',
        'Перезаписати',
        'Оновити дані'
    );

    if (overwrite) {
        // Force overwrite: re-send with current server's updatedAt
        localBooking.updatedAt = serverData.updatedAt;
        const retryResult = await apiUpdateBooking(localBooking.id, localBooking);
        if (retryResult && retryResult.success) {
            delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
            closeBookingPanel();
            await renderTimeline();
            showNotification('Бронювання перезаписано!', 'success');
        } else if (retryResult && retryResult.conflict) {
            // Another conflict happened -- extremely unlikely
            showNotification('Повторний конфлікт. Оновіть сторінку.', 'error');
        } else {
            showNotification(retryResult?.error || 'Помилка збереження', 'error');
        }
    } else {
        // Refresh data: reload bookings and re-open edit form
        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
        await renderTimeline();
        // Re-open editing with fresh data
        await editBooking(localBooking.id);
        showNotification('Дані оновлено з сервера', 'info');
    }
}

async function checkConflicts(lineId, time, duration, excludeId = null) {
    const allBookings = await getBookingsForDate(AppState.selectedDate);
    const bookings = allBookings.filter(b => b.lineId === lineId && b.id !== excludeId);
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;

    let overlap = false;
    let noPause = false;

    for (const b of bookings) {
        const start = timeToMinutes(b.time);
        const end = start + b.duration;

        if (newStart < end && newEnd > start) {
            overlap = true;
            break;
        }

        if (newStart === end || newEnd === start) {
            noPause = true;
        }
        if (newStart > end && newStart < end + CONFIG.MIN_PAUSE) {
            noPause = true;
        }
        if (newEnd > start - CONFIG.MIN_PAUSE && newEnd <= start) {
            noPause = true;
        }
    }

    return { overlap, noPause };
}

// ==========================================
// ДЕТАЛІ БРОНЮВАННЯ
// ==========================================

// v8.6.1: Generate unique gradient for each booking based on its ID
function generateBookingHeaderGradient(booking) {
    const str = String(booking.id || '') + (booking.programName || '') + (booking.time || '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    const hue1 = Math.abs(hash % 360);
    const hue2 = (hue1 + 40 + Math.abs((hash >> 8) % 30)) % 360;
    const angle = Math.abs((hash >> 16) % 180);
    return `linear-gradient(${angle}deg, hsl(${hue1}, 70%, 45%), hsl(${hue2}, 65%, 40%))`;
}

// v8.6.1: Category icon mapping
function getCategoryIcon(category) {
    const icons = {
        quest: '🗝️', animation: '🎭', show: '🎪',
        photo: '📸', masterclass: '🎨', pinata: '🪅', custom: '⭐'
    };
    return icons[category] || '📋';
}

async function showBookingDetails(bookingId) {
    const bookings = await getBookingsForDate(AppState.selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    const endTime = addMinutesToTime(booking.time, booking.duration);
    const bookingDate = new Date(booking.date);
    const lines = await getLinesForDate(bookingDate);
    const line = lines.find(l => l.id === booking.lineId);

    const program = getProductsSync().find(p => p.id === booking.programId);
    const descriptionHtml = program && program.description
        ? `<div class="booking-detail-description"><span class="label">Опис:</span><p>${escapeHtml(program.description)}</p></div>`
        : '';

    // B2: Per-event invite URL with booking details
    const inviteParams = new URLSearchParams({
        date: booking.date,
        time: booking.time,
        program: booking.programName || booking.label,
        room: booking.room
    });
    const inviteUrl = `/invite?${inviteParams.toString()}`;

    const fullInviteUrl = `${window.location.origin}/invite?${inviteParams.toString()}`;
    const inviteShareText = `Запрошуємо на ${escapeHtml(booking.programName || booking.label)} ${escapeHtml(booking.date)}! Парк Закревського Періоду — вул. Закревського 31/2, 3 поверх`;

    // v7.6.1: Line switch buttons
    const otherLines = lines.filter(l => l.id !== booking.lineId);
    const lineSwitchHtml = otherLines.length > 0 ? `
        <div class="booking-line-switch">
            <span class="label">Перемістити на лінію:</span>
            <div class="line-switch-buttons">
                ${otherLines.map(l => `<button onclick="switchBookingLine('${escapeHtml(booking.id)}', '${escapeHtml(l.id)}')" style="border-color: ${escapeHtml(l.color)}; color: ${escapeHtml(l.color)}">${escapeHtml(l.name)}</button>`).join('')}
            </div>
        </div>` : '';

    const editControls = isViewer() ? '' : `
        <div class="booking-time-shift">
            <span class="label">Перенести час:</span>
            <div class="time-shift-buttons">
                <button onclick="shiftBookingTime('${escapeHtml(booking.id)}', -30)">-30</button>
                <button onclick="shiftBookingTime('${escapeHtml(booking.id)}', -15)">-15</button>
                <button onclick="shiftBookingTime('${escapeHtml(booking.id)}', 15)">+15</button>
                <button onclick="shiftBookingTime('${escapeHtml(booking.id)}', 30)">+30</button>
                <button onclick="shiftBookingTime('${escapeHtml(booking.id)}', 45)">+45</button>
                <button onclick="shiftBookingTime('${escapeHtml(booking.id)}', 60)">+60</button>
            </div>
        </div>
        ${lineSwitchHtml}
        <div class="invite-section">
            <div class="invite-section-header">🎉 Запрошення для клієнта</div>
            <div class="invite-preview">
                <span>📅 ${escapeHtml(booking.date)}</span>
                <span>🕐 ${escapeHtml(booking.time)}</span>
                <span>🎪 ${escapeHtml(booking.programName || booking.label)}</span>
                <span>🏠 ${escapeHtml(booking.room)}</span>
            </div>
            <div class="invite-actions">
                <a href="${inviteUrl}" target="_blank" class="btn-invite-open">👁 Відкрити</a>
                <button onclick="copyInviteLink(this)" class="btn-invite-copy" data-url="${escapeHtml(fullInviteUrl)}">📋 Копіювати</button>
                ${navigator.share ? '<button onclick="shareInviteLink()" class="btn-invite-share">📤 Поділитися</button>' : ''}
            </div>
        </div>
        <div class="booking-actions modal-footer-sticky">
            <button onclick="editBooking('${escapeHtml(booking.id)}')" class="btn-edit-booking">✏️ Редагувати</button>
            <button onclick="duplicateBooking('${escapeHtml(booking.id)}')" class="btn-duplicate-booking">📋 Повторити</button>
            <button onclick="deleteBooking('${escapeHtml(booking.id)}')" class="btn-delete-booking">Видалити</button>
        </div>
    `;

    // v8.6.1: Generate unique header color based on booking ID
    const headerGradient = generateBookingHeaderGradient(booking);
    const categoryIcon = getCategoryIcon(booking.category);
    const uniqueCode = booking.id ? String(booking.id).slice(-4).toUpperCase() : '----';

    document.getElementById('bookingDetails').innerHTML = `
        <div class="booking-detail-header booking-detail-header--unique" style="background:${headerGradient};color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;margin:-20px -20px 16px -20px;">
            <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:28px;">${categoryIcon}</span>
                <div>
                    <h3 style="margin:0;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.3);">${escapeHtml(booking.label || booking.programCode)}: ${escapeHtml(booking.programName)}</h3>
                    <p style="margin:4px 0 0;opacity:0.9;font-size:13px;">${escapeHtml(booking.room)}${booking.category ? ' · ' + escapeHtml(CATEGORY_NAMES[booking.category] || booking.category) : ''} · #${escapeHtml(uniqueCode)}</p>
                </div>
            </div>
        </div>
        <div class="booking-detail-row">
            <span class="label">Дата:</span>
            <span class="value">${escapeHtml(booking.date)}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">Час:</span>
            <span class="value">${escapeHtml(booking.time)} - ${escapeHtml(endTime)}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">Аніматор:</span>
            <span class="value">${escapeHtml(line ? line.name : '-')}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">Ведучих:</span>
            <span class="value">${escapeHtml(String(booking.hosts))}${booking.secondAnimator ? ` (+ ${escapeHtml(booking.secondAnimator)})` : ''}</span>
        </div>
        ${booking.costume ? `<div class="booking-detail-row"><span class="label">Костюм:</span><span class="value">${escapeHtml(booking.costume)}</span></div>` : ''}
        ${booking.pinataFiller ? `<div class="booking-detail-row"><span class="label">Піньята:</span><span class="value">${escapeHtml(booking.pinataFiller)}</span></div>` : ''}
        <div class="booking-detail-row">
            <span class="label">Ціна:</span>
            <span class="value">${escapeHtml(formatPrice(booking.price))}</span>
        </div>
        ${booking.kidsCount ? `<div class="booking-detail-row"><span class="label">Дітей:</span><span class="value">${escapeHtml(String(booking.kidsCount))}</span></div>` : ''}
        <div class="booking-detail-row">
            <span class="label">Статус:</span>
            <span class="status-badge status-badge--${booking.status === 'preliminary' ? 'preliminary' : 'confirmed'}">${booking.status === 'preliminary' ? '⏳ Попереднє' : '✅ Підтверджене'}</span>
        </div>
        ${booking.notes ? `<div class="booking-detail-row"><span class="label">Примітки:</span><span class="value">${escapeHtml(booking.notes)}</span></div>` : ''}
        ${booking.groupName ? `<div class="booking-detail-row"><span class="label">Група:</span><span class="value">🎪 ${escapeHtml(booking.groupName)}</span></div>` : ''}
        ${booking.updatedAt ? `<div class="booking-detail-row"><span class="label">Оновлено:</span><span class="value">${new Date(booking.updatedAt).toLocaleString('uk-UA')}</span></div>` : ''}
        ${descriptionHtml}
        ${!isViewer() ? `<div class="status-toggle-section">
            <button class="btn-status-toggle" onclick="changeBookingStatus('${escapeHtml(booking.id)}', '${booking.status === 'preliminary' ? 'confirmed' : 'preliminary'}')">
                ${booking.status === 'preliminary' ? '✅ Підтвердити' : '⏳ Зробити попереднім'}
            </button>
        </div>` : ''}
        ${editControls}
    `;

    document.getElementById('bookingModal').classList.remove('hidden');
}

// ==========================================
// РЕДАГУВАННЯ БРОНЮВАННЯ (v5.5)
// ==========================================

async function editBooking(bookingId) {
    const bookings = await getBookingsForDate(AppState.selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    closeAllModals();

    // Встановити режим редагування
    AppState.editingBookingId = bookingId;
    // Store updatedAt for optimistic locking
    AppState.editingBookingUpdatedAt = booking.updatedAt || null;

    // Відкрити панель з даними бронювання
    await openBookingPanel(booking.time, booking.lineId);

    // Змінити заголовок і кнопку
    document.querySelector('#bookingPanel .panel-header h3').textContent = 'Редагувати бронювання';
    document.querySelector('#bookingForm .btn-submit').textContent = 'Зберегти зміни';

    // Заповнити форму
    document.getElementById('roomSelect').value = booking.room || '';
    document.getElementById('costumeSelect').value = booking.costume || '';
    document.getElementById('bookingNotes').value = booking.notes || '';
    const groupEditInput = document.getElementById('bookingGroupName');
    if (groupEditInput) groupEditInput.value = booking.groupName || '';

    // Вибрати програму
    if (booking.programId) {
        selectProgram(booking.programId);

        // Кастомна програма
        const program = getProductsSync().find(p => p.id === booking.programId);
        if (program && program.isCustom) {
            const customName = document.getElementById('customName');
            const customDuration = document.getElementById('customDuration');
            if (customName) customName.value = booking.programName || '';
            if (customDuration) customDuration.value = booking.duration || 30;
        }

        // Піньята наповнювач
        if (program && program.hasFiller && booking.pinataFiller) {
            document.getElementById('pinataFillerSelect').value = booking.pinataFiller;
        }

        // К-кість дітей (МК)
        if (program && program.perChild && booking.kidsCount) {
            const kidsInput = document.getElementById('kidsCountInput');
            if (kidsInput) {
                kidsInput.value = booking.kidsCount;
                kidsInput.dispatchEvent(new Event('input'));
            }
        }

        // v8.3.1: T-shirt sizes
        if (booking.programId === 'mk_tshirt' && booking.extraData?.tshirt_sizes) {
            const sizes = booking.extraData.tshirt_sizes;
            ['XS', 'S', 'M', 'L', 'XL'].forEach(s => {
                const inp = document.getElementById('tshirt' + s);
                if (inp) inp.value = sizes[s] || 0;
            });
        }
    }

    // Статус
    const statusRadio = document.querySelector(`input[name="bookingStatus"][value="${booking.status || 'confirmed'}"]`);
    if (statusRadio) statusRadio.checked = true;

    // Другий аніматор
    if (booking.secondAnimator) {
        await populateSecondAnimatorSelect();
        await resolveSecondAnimatorSelect(booking.secondAnimator, booking.id);
    }
}

// ==========================================
// DUPLICATE BOOKING (v5.50)
// ==========================================

async function duplicateBooking(bookingId) {
    const bookings = await getBookingsForDate(AppState.selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    closeAllModals();

    // НЕ встановлюємо editingBookingId — це створення нового
    AppState.editingBookingId = null;

    await openBookingPanel(booking.time, booking.lineId);

    // Заголовок для дублювання
    document.querySelector('#bookingPanel .panel-header h3').textContent = 'Повторити бронювання';
    document.querySelector('#bookingForm .btn-submit').textContent = 'Створити копію';

    // Pre-fill форму (ідентично editBooking)
    document.getElementById('roomSelect').value = booking.room || '';
    document.getElementById('costumeSelect').value = booking.costume || '';
    document.getElementById('bookingNotes').value = booking.notes || '';
    const groupInput = document.getElementById('bookingGroupName');
    if (groupInput) groupInput.value = booking.groupName || '';

    if (booking.programId) {
        selectProgram(booking.programId);

        const program = getProductsSync().find(p => p.id === booking.programId);
        if (program && program.isCustom) {
            const customName = document.getElementById('customName');
            const customDuration = document.getElementById('customDuration');
            if (customName) customName.value = booking.programName || '';
            if (customDuration) customDuration.value = booking.duration || 30;
        }

        if (program && program.hasFiller && booking.pinataFiller) {
            document.getElementById('pinataFillerSelect').value = booking.pinataFiller;
        }

        if (program && program.perChild && booking.kidsCount) {
            const kidsInput = document.getElementById('kidsCountInput');
            if (kidsInput) {
                kidsInput.value = booking.kidsCount;
                kidsInput.dispatchEvent(new Event('input'));
            }
        }

        // v8.3.2: Copy tshirt sizes from extraData
        if (booking.extraData?.tshirt_sizes) {
            ['XS', 'S', 'M', 'L', 'XL'].forEach(s => {
                const input = document.getElementById('tshirt' + s);
                if (input) input.value = booking.extraData.tshirt_sizes[s] || 0;
            });
        }
    }

    const statusRadio = document.querySelector(`input[name="bookingStatus"][value="${booking.status || 'confirmed'}"]`);
    if (statusRadio) statusRadio.checked = true;

    if (booking.secondAnimator) {
        await populateSecondAnimatorSelect();
        await resolveSecondAnimatorSelect(booking.secondAnimator, booking.id);
    }

    showNotification('Форму заповнено — оберіть час та аніматора', 'info');
}

// ==========================================
// INVITE HELPERS (v5.48)
// ==========================================

function copyInviteLink(btn) {
    const url = btn && btn.dataset.url ? btn.dataset.url : '';
    navigator.clipboard.writeText(url).then(() => {
        if (btn) {
            const original = btn.innerHTML;
            btn.innerHTML = '✅ Скопійовано!';
            setTimeout(() => { btn.innerHTML = original; }, 2000);
        }
    }).catch(() => showNotification('Не вдалося скопіювати', 'error'));
}

function shareInviteLink() {
    try {
        const modal = document.getElementById('bookingDetails');
        if (!modal) return;
        const preview = modal.querySelector('.invite-preview');
        const link = modal.querySelector('.btn-invite-open');
        if (!link) return;
        const url = link.href;
        const spans = preview ? preview.querySelectorAll('span') : [];
        const text = spans.length > 0
            ? `Запрошуємо! ${Array.from(spans).map(s => s.textContent).join(' | ')} — Парк Закревського Періоду`
            : 'Запрошуємо на свято! Парк Закревського Періоду';
        if (navigator.share) {
            navigator.share({ title: 'Парк Закревського Періоду', text, url }).catch(() => {});
        } else {
            copyInviteLink(url);
        }
    } catch (e) {
        showNotification('Поділитися не вдалося', 'error');
    }
}

// ==========================================
// ВИДАЛЕННЯ БРОНЮВАННЯ
// ==========================================

async function deleteBooking(bookingId) {
    try {
        const bookings = await getBookingsForDate(AppState.selectedDate);
        const booking = bookings.find(b => b.id === bookingId);
        if (!booking) return;

        let mainBookingId = bookingId;
        let allToDelete = [];

        if (booking.linkedTo) {
            mainBookingId = booking.linkedTo;
            const mainBooking = bookings.find(b => b.id === mainBookingId);
            if (mainBooking) {
                allToDelete = bookings.filter(b => b.linkedTo === mainBookingId);
                allToDelete.push(mainBooking);
            } else {
                allToDelete = [booking];
            }
        } else {
            allToDelete = bookings.filter(b => b.linkedTo === bookingId);
            allToDelete.push(booking);
        }

        const othersCount = allToDelete.length - 1;

        const confirmMsg = othersCount > 0
            ? `Видалити це бронювання разом з ${othersCount} пов'язаним(и)?`
            : 'Видалити це бронювання?';

        const confirmed = await customConfirm(confirmMsg, 'Видалення бронювання');
        if (!confirmed) return;

        pushUndo('delete', [...allToDelete]);

        // v5.7: Single server call — server handles linked deletion, history, Telegram
        const delResult = await apiDeleteBooking(mainBookingId);
        if (delResult && delResult.success === false) {
            showNotification(delResult.error || 'Помилка видалення бронювання', 'error');
            return;
        }

        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
        closeAllModals();
        await renderTimeline();
        showNotification(othersCount > 0 ? `Видалено ${allToDelete.length} бронювань` : 'Бронювання видалено', 'success');
    } catch (error) {
        handleError('Видалення бронювання', error);
    }
}

// ==========================================
// ПЕРЕНОС ЧАСУ
// ==========================================

async function shiftBookingTime(bookingId, minutes) {
    try {
        const bookings = await getBookingsForDate(AppState.selectedDate);
        const booking = bookings.find(b => b.id === bookingId);
        if (!booking) return;

        const newTime = addMinutesToTime(booking.time, minutes);
        const newStart = timeToMinutes(newTime);
        const newEnd = newStart + booking.duration;

        const bookingDate = new Date(booking.date);
        const isWeekend = bookingDate.getDay() === 0 || bookingDate.getDay() === 6;
        const dayStart = isWeekend ? CONFIG.TIMELINE.WEEKEND_START * 60 : CONFIG.TIMELINE.WEEKDAY_START * 60;
        const dayEnd = CONFIG.TIMELINE.WEEKEND_END * 60;

        if (newStart < dayStart || newEnd > dayEnd) {
            showNotification('Час виходить за межі робочого дня!', 'error');
            return;
        }

        const otherBookings = bookings.filter(b => b.lineId === booking.lineId && b.id !== bookingId);
        for (const other of otherBookings) {
            const start = timeToMinutes(other.time);
            const end = start + other.duration;

            if (newStart < end && newEnd > start) {
                showNotification('Неможливо перенести - є накладка з іншим бронюванням!', 'error');
                return;
            }
        }

        // Пов'язані бронювання
        const linkedBookings = bookings.filter(b => b.linkedTo === bookingId);

        for (const linked of linkedBookings) {
            const linkedNewTime = addMinutesToTime(linked.time, minutes);
            const linkedNewStart = timeToMinutes(linkedNewTime);
            const linkedNewEnd = linkedNewStart + linked.duration;

            const linkedOthers = bookings.filter(b => b.lineId === linked.lineId && b.id !== linked.id);
            for (const other of linkedOthers) {
                const start = timeToMinutes(other.time);
                const end = start + other.duration;
                if (linkedNewStart < end && linkedNewEnd > start) {
                    showNotification(`Неможливо перенести - накладка у пов'язаного аніматора!`, 'error');
                    return;
                }
            }
        }

        // v3.9: Use PUT for atomic update instead of DELETE+CREATE
        const newBooking = { ...booking, time: newTime };
        const shiftResult = await apiUpdateBooking(bookingId, newBooking);
        if (shiftResult && shiftResult.success === false) {
            if (shiftResult.conflict) {
                delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
                closeAllModals();
                await renderTimeline();
                showNotification('Бронювання змінено іншим користувачем. Оновіть таймлайн.', 'error');
                return;
            }
            showNotification(shiftResult.error || 'Помилка переносу бронювання', 'error');
            return;
        }

        // Оновити пов'язані
        for (const linked of linkedBookings) {
            const linkedNewTime = addMinutesToTime(linked.time, minutes);
            const updatedLinked = { ...linked, time: linkedNewTime, linkedTo: newBooking.id };
            const linkedResult = await apiUpdateBooking(linked.id, updatedLinked);
            if (linkedResult && linkedResult.success === false) {
                if (linkedResult.conflict) {
                    delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
                    closeAllModals();
                    await renderTimeline();
                    showNotification('Пов\'язане бронювання змінено іншим користувачем. Оновіть таймлайн.', 'error');
                    return;
                }
                console.warn(`Failed to shift linked booking ${linked.id}`);
            }
        }

        await apiAddHistory('shift', AppState.currentUser?.username, { ...newBooking, shiftMinutes: minutes });

        // v5.51: Push undo for shift (stores bookingId, reverse minutes, linked bookings)
        pushUndo('shift', { bookingId, minutes: -minutes, linked: linkedBookings.map(l => l.id) });

        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
        closeAllModals();
        await renderTimeline();
        const linkedMsg = linkedBookings.length > 0 ? ` (+ ${linkedBookings.length} пов'язаних)` : '';
        showNotification(`Час перенесено на ${minutes > 0 ? '+' : ''}${minutes} хв${linkedMsg}`, 'success');
    } catch (error) {
        handleError('Перенос часу', error);
    }
}

// ==========================================
// ПЕРЕКЛЮЧЕННЯ ЛІНІЇ (v7.6.1)
// ==========================================

async function switchBookingLine(bookingId, targetLineId) {
    try {
        const bookings = await getBookingsForDate(AppState.selectedDate);
        const booking = bookings.find(b => b.id === bookingId);
        if (!booking) return;

        if (booking.lineId === targetLineId) return;

        // Перевірка конфліктів на цільовій лінії
        const targetLineBookings = bookings.filter(b => b.lineId === targetLineId && b.id !== bookingId);
        const myStart = timeToMinutes(booking.time);
        const myEnd = myStart + booking.duration;

        for (const other of targetLineBookings) {
            const start = timeToMinutes(other.time);
            const end = start + other.duration;
            if (myStart < end && myEnd > start) {
                showNotification(`Неможливо — накладка з "${other.label || other.programCode}" о ${other.time}`, 'error');
                return;
            }
        }

        const updated = { ...booking, lineId: targetLineId };
        const result = await apiUpdateBooking(bookingId, updated);
        if (result && result.success === false) {
            if (result.conflict) {
                delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
                closeAllModals();
                await renderTimeline();
                showNotification('Бронювання змінено іншим користувачем. Оновіть таймлайн.', 'error');
                return;
            }
            showNotification(result.error || 'Помилка переключення лінії', 'error');
            return;
        }

        const lines = await getLinesForDate(AppState.selectedDate);
        const targetLine = lines.find(l => l.id === targetLineId);

        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
        closeAllModals();
        await renderTimeline();
        showNotification(`Переміщено на: ${targetLine ? targetLine.name : 'іншу лінію'}`, 'success');
    } catch (error) {
        handleError('Переключення лінії', error);
    }
}
