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
    document.querySelectorAll('.program-icon').forEach(i => i.classList.remove('selected'));
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

    document.getElementById('bookingPanel').classList.remove('hidden');
    document.querySelector('.main-content').classList.add('panel-open');
}

function closeBookingPanel() {
    document.getElementById('bookingPanel').classList.add('hidden');
    document.querySelector('.main-content').classList.remove('panel-open');
    document.querySelectorAll('.grid-cell.selected').forEach(c => c.classList.remove('selected'));

    // v5.5: Скинути режим редагування
    if (AppState.editingBookingId) {
        AppState.editingBookingId = null;
        document.querySelector('#bookingPanel .panel-header h3').textContent = 'Нове бронювання';
        document.querySelector('#bookingForm .btn-submit').textContent = 'Додати бронювання';
    }
}

function renderProgramIcons() {
    const container = document.getElementById('programsIcons');
    container.innerHTML = '';

    CATEGORY_ORDER_BOOKING.forEach(cat => {
        const programs = PROGRAMS.filter(p => p.category === cat);
        if (programs.length === 0) return;

        const header = document.createElement('div');
        header.className = 'category-header';
        header.textContent = CATEGORY_NAMES_BOOKING[cat] || cat;
        container.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'category-grid';
        programs.forEach(p => {
            const icon = document.createElement('div');
            icon.className = `program-icon ${p.category}`;
            icon.dataset.programId = p.id;
            icon.innerHTML = `
                <span class="icon">${p.icon}</span>
                <span class="name">${p.label}</span>
            `;
            icon.addEventListener('click', () => selectProgram(p.id));
            grid.appendChild(icon);
        });
        container.appendChild(grid);
    });
}

function selectProgram(programId) {
    const program = PROGRAMS.find(p => p.id === programId);
    if (!program) return;

    document.querySelectorAll('.program-icon').forEach(i => i.classList.remove('selected'));
    document.querySelector(`[data-program-id="${programId}"]`).classList.add('selected');
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
    if (!changeBtn) {
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
    }

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
    const program = programId ? PROGRAMS.find(p => p.id === programId) : null;
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

    return {
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
        kidsCount: kidsCount || null
    };
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

async function handleBookingSubmit(e) {
    e.preventDefault();

    const formData = getBookingFormData();

    if (!formData.programId) { showNotification('Оберіть програму', 'error'); return; }
    if (!formData.room) { showNotification('Оберіть кімнату', 'error'); return; }
    if (formData.program.hasFiller && !formData.pinataFiller) {
        showNotification('Оберіть наповнювач для піньяти', 'error'); return;
    }

    // v5.5: excludeId для режиму редагування
    const excludeId = AppState.editingBookingId || null;

    // Валідація конфліктів
    const valid = await validateBookingConflicts(
        formData.lineId, formData.time, formData.duration,
        formData.program, formData.secondAnimator, excludeId
    );
    if (!valid) return;

    // Перевірка дублікатів
    const noDuplicate = await checkDuplicateProgram(
        formData.programId, formData.program, formData.time, formData.duration, excludeId
    );
    if (!noDuplicate) return;

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
            }

            const updateResult = await apiUpdateBooking(booking.id, booking);
            if (updateResult && updateResult.success === false) {
                showNotification(updateResult.error || 'Помилка оновлення бронювання', 'error');
                return;
            }
            await apiAddHistory('edit', AppState.currentUser?.username, booking);
            notifyBookingEdited(booking);

            AppState.editingBookingId = null;

            delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
            closeBookingPanel();
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
                return;
            }
            if (createResult && createResult.id) {
                booking.id = createResult.id;
            }
            // History + Telegram handled by server

            pushUndo('create', [booking]);

            delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
            closeBookingPanel();
            await renderTimeline();
            showNotification('Бронювання створено!', 'success');
        }
    } catch (error) {
        handleError('Збереження бронювання', error);
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

async function showBookingDetails(bookingId) {
    const bookings = await getBookingsForDate(AppState.selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    const endTime = addMinutesToTime(booking.time, booking.duration);
    const bookingDate = new Date(booking.date);
    const lines = await getLinesForDate(bookingDate);
    const line = lines.find(l => l.id === booking.lineId);

    const program = PROGRAMS.find(p => p.id === booking.programId);
    const descriptionHtml = program && program.description
        ? `<div class="booking-detail-description"><span class="label">Опис:</span><p>${program.description}</p></div>`
        : '';

    // B2: Per-event invite URL with booking details
    const inviteParams = new URLSearchParams({
        date: booking.date,
        time: booking.time,
        program: booking.programName || booking.label,
        room: booking.room
    });
    const inviteUrl = `/invite?${inviteParams.toString()}`;

    const editControls = isViewer() ? '' : `
        <div class="booking-time-shift">
            <span class="label">Перенести час:</span>
            <div class="time-shift-buttons">
                <button onclick="shiftBookingTime('${booking.id}', -30)">-30</button>
                <button onclick="shiftBookingTime('${booking.id}', -15)">-15</button>
                <button onclick="shiftBookingTime('${booking.id}', 15)">+15</button>
                <button onclick="shiftBookingTime('${booking.id}', 30)">+30</button>
                <button onclick="shiftBookingTime('${booking.id}', 45)">+45</button>
                <button onclick="shiftBookingTime('${booking.id}', 60)">+60</button>
            </div>
        </div>
        <div class="booking-actions">
            <button onclick="editBooking('${booking.id}')" class="btn-edit-booking">✏️ Редагувати</button>
            <a href="${inviteUrl}" target="_blank" class="btn-invite-event">🎉 Запрошення</a>
            <button onclick="deleteBooking('${booking.id}')">Видалити бронювання</button>
        </div>
    `;

    document.getElementById('bookingDetails').innerHTML = `
        <div class="booking-detail-header">
            <h3>${escapeHtml(booking.label || booking.programCode)}: ${escapeHtml(booking.programName)}</h3>
            <p>${escapeHtml(booking.room)}</p>
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
            <span class="value status-value ${booking.status === 'preliminary' ? 'preliminary' : 'confirmed'}">${booking.status === 'preliminary' ? '⏳ Попереднє' : '✅ Підтверджене'}</span>
        </div>
        ${booking.notes ? `<div class="booking-detail-row"><span class="label">Примітки:</span><span class="value">${escapeHtml(booking.notes)}</span></div>` : ''}
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

    // Відкрити панель з даними бронювання
    await openBookingPanel(booking.time, booking.lineId);

    // Змінити заголовок і кнопку
    document.querySelector('#bookingPanel .panel-header h3').textContent = 'Редагувати бронювання';
    document.querySelector('#bookingForm .btn-submit').textContent = 'Зберегти зміни';

    // Заповнити форму
    document.getElementById('roomSelect').value = booking.room || '';
    document.getElementById('costumeSelect').value = booking.costume || '';
    document.getElementById('bookingNotes').value = booking.notes || '';

    // Вибрати програму
    if (booking.programId) {
        selectProgram(booking.programId);

        // Кастомна програма
        const program = PROGRAMS.find(p => p.id === booking.programId);
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
    }

    // Статус
    const statusRadio = document.querySelector(`input[name="bookingStatus"][value="${booking.status || 'confirmed'}"]`);
    if (statusRadio) statusRadio.checked = true;

    // Другий аніматор
    if (booking.secondAnimator) {
        await populateSecondAnimatorSelect();
        document.getElementById('secondAnimatorSelect').value = booking.secondAnimator;
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
            showNotification(shiftResult.error || 'Помилка переносу бронювання', 'error');
            return;
        }

        // Оновити пов'язані
        for (const linked of linkedBookings) {
            const linkedNewTime = addMinutesToTime(linked.time, minutes);
            const updatedLinked = { ...linked, time: linkedNewTime, linkedTo: newBooking.id };
            const linkedResult = await apiUpdateBooking(linked.id, updatedLinked);
            if (linkedResult && linkedResult.success === false) {
                console.warn(`Failed to shift linked booking ${linked.id}`);
            }
        }

        await apiAddHistory('shift', AppState.currentUser?.username, { ...newBooking, shiftMinutes: minutes });

        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
        closeAllModals();
        await renderTimeline();
        const linkedMsg = linkedBookings.length > 0 ? ` (+ ${linkedBookings.length} пов'язаних)` : '';
        showNotification(`Час перенесено на ${minutes > 0 ? '+' : ''}${minutes} хв${linkedMsg}`, 'success');
    } catch (error) {
        handleError('Перенос часу', error);
    }
}
