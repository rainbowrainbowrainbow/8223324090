/**
 * booking.js - Панель бронювання, форма, деталі, видалення, перенос часу
 */

// ==========================================
// ПАНЕЛЬ БРОНЮВАННЯ
// ==========================================

async function openBookingPanel(time, lineId) {
    const lines = await getLinesForDate(AppState.selectedDate);
    const line = lines.find(l => l.id === lineId);

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
}

function renderProgramIcons() {
    const container = document.getElementById('programsIcons');
    container.innerHTML = '';

    const categoryOrder = ['animation', 'show', 'quest', 'photo', 'masterclass', 'pinata', 'custom'];
    const categoryNames = {
        animation: 'Анімація',
        show: 'Wow-Шоу',
        quest: 'Квести',
        photo: 'Фото послуги',
        masterclass: 'Майстер-класи',
        pinata: 'Піньяти',
        custom: 'Інше'
    };

    categoryOrder.forEach(cat => {
        const programs = PROGRAMS.filter(p => p.category === cat);
        if (programs.length === 0) return;

        const header = document.createElement('div');
        header.className = 'category-header';
        header.textContent = categoryNames[cat] || cat;
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

    const priceText = program.perChild ? `${program.price} грн/дит` : `${program.price} грн`;
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
                        ? `${program.price} x ${count} = ${total} грн`
                        : `${program.price} грн/дит`;
                };
            }
        } else {
            kidsCountSection.classList.add('hidden');
        }
    }
}

async function populateSecondAnimatorSelect() {
    const select = document.getElementById('secondAnimatorSelect');
    const lines = await getLinesForDate(AppState.selectedDate);
    const currentLineId = document.getElementById('bookingLine').value;

    select.innerHTML = '<option value="">Оберіть другого аніматора</option>';

    lines.forEach(line => {
        if (line.id !== currentLineId) {
            const option = document.createElement('option');
            option.value = line.name;
            option.textContent = line.name;
            select.appendChild(option);
        }
    });
}

function updateCustomDuration() {
    const duration = parseInt(document.getElementById('customDuration').value) || 30;
    document.getElementById('detailDuration').textContent = `${duration} хв`;
}

async function populateExtraHostAnimatorSelect() {
    const select = document.getElementById('extraHostAnimatorSelect');
    const lines = await getLinesForDate(AppState.selectedDate);
    const currentLineId = document.getElementById('bookingLine').value;

    select.innerHTML = '<option value="">Оберіть аніматора</option>';

    lines.forEach(line => {
        if (line.id !== currentLineId) {
            const option = document.createElement('option');
            option.value = line.name;
            option.textContent = line.name;
            select.appendChild(option);
        }
    });
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

async function validateBookingConflicts(lineId, time, duration, program, secondAnimator) {
    delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
    const conflict = await checkConflicts(lineId, time, duration);

    if (conflict.overlap) {
        showNotification('❌ ПОМИЛКА: Цей час вже зайнятий!', 'error');
        return false;
    }

    if (secondAnimator) {
        const lines = await getLinesForDate(AppState.selectedDate);
        const secondLine = lines.find(l => l.name === secondAnimator);
        if (secondLine) {
            const secondConflict = await checkConflicts(secondLine.id, time, duration);
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

async function checkDuplicateProgram(programId, program, time, duration) {
    if (program.category === 'animation' || programId === 'anim_extra') return true;

    const allBookings = await getBookingsForDate(AppState.selectedDate);
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;

    const duplicate = allBookings.find(b => {
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
        id: 'BK' + Date.now().toString(36).toUpperCase(),
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

async function createLinkedBookings(booking, program) {
    // Другий ведучий
    if (program.hosts > 1 && booking.secondAnimator) {
        const lines = await getLinesForDate(AppState.selectedDate);
        const secondLine = lines.find(l => l.name === booking.secondAnimator);
        if (secondLine) {
            await apiCreateBooking({
                ...booking,
                id: 'BK' + (Date.now() + 1).toString(36).toUpperCase(),
                lineId: secondLine.id,
                linkedTo: booking.id
            });
        }
    }

    // Додатковий ведучий (700 грн/год)
    const extraHostToggle = document.getElementById('extraHostToggle');
    if (extraHostToggle && extraHostToggle.checked) {
        const extraHostAnimator = document.getElementById('extraHostAnimatorSelect').value;
        if (extraHostAnimator) {
            const lines = await getLinesForDate(AppState.selectedDate);
            const extraLine = lines.find(l => l.name === extraHostAnimator);
            if (extraLine) {
                const extraPrice = Math.round(700 * (booking.duration / 60));
                await apiCreateBooking({
                    id: 'BK' + (Date.now() + 2).toString(36).toUpperCase(),
                    date: booking.date, time: booking.time, lineId: extraLine.id,
                    programId: 'anim_extra', programCode: '+Вед',
                    label: `+Вед(${booking.duration})`, programName: 'Додатковий ведучий',
                    category: 'animation', duration: booking.duration, price: extraPrice,
                    hosts: 1, room: booking.room, linkedTo: booking.id,
                    createdBy: booking.createdBy, createdAt: booking.createdAt
                });
            }
        }
    }
}

async function handleBookingSubmit(e) {
    e.preventDefault();

    const formData = getBookingFormData();

    if (!formData.programId) { showNotification('Оберіть програму', 'error'); return; }
    if (!formData.room) { showNotification('Оберіть кімнату', 'error'); return; }
    if (formData.program.hasFiller && !formData.pinataFiller) {
        showNotification('Оберіть наповнювач для піньяти', 'error'); return;
    }

    // Валідація конфліктів
    const valid = await validateBookingConflicts(
        formData.lineId, formData.time, formData.duration,
        formData.program, formData.secondAnimator
    );
    if (!valid) return;

    // Перевірка дублікатів
    const noDuplicate = await checkDuplicateProgram(
        formData.programId, formData.program, formData.time, formData.duration
    );
    if (!noDuplicate) return;

    // Створити та зберегти
    try {
        const booking = buildBookingObject(formData, formData.program);
        await apiCreateBooking(booking);
        await apiAddHistory('create', AppState.currentUser?.username, booking);
        await createLinkedBookings(booking, formData.program);

        pushUndo('create', [booking]);
        notifyBookingCreated(booking);

        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
        closeBookingPanel();
        await renderTimeline();
        showNotification('Бронювання створено!', 'success');
    } catch (error) {
        handleError('Створення бронювання', error);
    }
}

async function checkConflicts(lineId, time, duration) {
    const allBookings = await getBookingsForDate(AppState.selectedDate);
    const bookings = allBookings.filter(b => b.lineId === lineId);
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
            <button onclick="deleteBooking('${booking.id}')">Видалити бронювання</button>
        </div>
    `;

    document.getElementById('bookingDetails').innerHTML = `
        <div class="booking-detail-header">
            <h3>${booking.label || booking.programCode}: ${booking.programName}</h3>
            <p>${booking.room}</p>
        </div>
        <div class="booking-detail-row">
            <span class="label">Дата:</span>
            <span class="value">${booking.date}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">Час:</span>
            <span class="value">${booking.time} - ${endTime}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">Аніматор:</span>
            <span class="value">${line ? line.name : '-'}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">Ведучих:</span>
            <span class="value">${booking.hosts}${booking.secondAnimator ? ` (+ ${booking.secondAnimator})` : ''}</span>
        </div>
        ${booking.costume ? `<div class="booking-detail-row"><span class="label">Костюм:</span><span class="value">${booking.costume}</span></div>` : ''}
        ${booking.pinataFiller ? `<div class="booking-detail-row"><span class="label">Піньята:</span><span class="value">${booking.pinataFiller}</span></div>` : ''}
        <div class="booking-detail-row">
            <span class="label">Ціна:</span>
            <span class="value">${booking.price} грн</span>
        </div>
        ${booking.kidsCount ? `<div class="booking-detail-row"><span class="label">Дітей:</span><span class="value">${booking.kidsCount}</span></div>` : ''}
        <div class="booking-detail-row">
            <span class="label">Статус:</span>
            <span class="value status-value ${booking.status === 'preliminary' ? 'preliminary' : 'confirmed'}">${booking.status === 'preliminary' ? '⏳ Попереднє' : '✅ Підтверджене'}</span>
        </div>
        ${booking.notes ? `<div class="booking-detail-row"><span class="label">Примітки:</span><span class="value">${booking.notes}</span></div>` : ''}
        ${descriptionHtml}
        ${!isViewer() ? `<div class="status-toggle-section">
            <button class="btn-status-toggle" onclick="changeBookingStatus('${booking.id}', '${booking.status === 'preliminary' ? 'confirmed' : 'preliminary'}')">
                ${booking.status === 'preliminary' ? '✅ Підтвердити' : '⏳ Зробити попереднім'}
            </button>
        </div>` : ''}
        ${editControls}
    `;

    document.getElementById('bookingModal').classList.remove('hidden');
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
        notifyBookingDeleted(booking);

        for (const b of allToDelete) {
            await apiAddHistory('delete', AppState.currentUser?.username, b);
            await apiDeleteBooking(b.id);
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
        await apiUpdateBooking(bookingId, newBooking);

        // Оновити пов'язані
        for (const linked of linkedBookings) {
            const linkedNewTime = addMinutesToTime(linked.time, minutes);
            const updatedLinked = { ...linked, time: linkedNewTime, linkedTo: newBooking.id };
            await apiUpdateBooking(linked.id, updatedLinked);
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
