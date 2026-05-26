/**
 * staff-page.js — Staff schedule page (v39.1)
 *
 * LLM HINT: This is the frontend for the /staff page.
 * Shows a rolling schedule grid: rows = employees grouped by department, columns = days.
 * Click on a cell to edit shift via modal (status, time, note).
 * v39.1: Account linking — ✅/⚠️ indicators, link modal, bulk create, Excel import.
 * API used: GET /api/staff, GET /api/staff/schedule, PUT /api/staff/schedule,
 *   GET /api/staff/link-status, POST /api/staff/:id/link, POST /api/staff/bulk-create-accounts.
 * State is in StaffState object (weekStart, staff[], schedule{}, activeDept).
 */

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==========================================
// STATE
// ==========================================

const StaffState = {
    weekStart: null,    // First date of the current visible schedule window
    staff: [],
    schedule: {},       // { staffId_date: entry }
    departments: {},
    activeDept: 'all',
    editingCell: null,  // { staffId, date }
    hoursData: null,    // { staffId: { totalHours, workingDays, ... } }
    showHours: false,
    showLoadView: false,
    showLinkView: false,    // v39.1: account linking overlay
    linkData: [],           // v39.1: link-status data
    linkStats: null,        // v39.1: { total, linked, unlinked, freelance }
    allUsers: [],           // v39.1: all users for linking
    linkingStaffId: null,   // v39.1: staff being linked
    selectedUserId: null,   // v39.1: selected user in link modal
    bulkResults: null,      // v39.1: bulk create results
};

const DEPT_ICONS = {
    animators: '🎭',
    trampoline: '🤸',
    admin: '💼',
    cafe: '☕',
    tech: '🔧',
    cleaning: '🧹',
    security: '🛡️'
};

const STATUS_LABELS = {
    working: 'Робочий',
    dayoff: 'Вихідний',
    vacation: 'Відпустка',
    sick: 'Лікарняний',
    remote: 'Віддалено',
    unset: 'Не заповнено'
};

const STATUS_ICONS = {
    working: '●',
    dayoff: '○',
    vacation: '✈',
    sick: '✚',
    remote: '◉',
    unset: '·'
};

// Sub-groups within large departments (by role_type)
const DEPT_SUB_GROUPS = {
    animators: [
        { key: 'animator', label: 'Аніматори', icon: '🎭' },
        { key: 'instructor', label: 'Батутисти', icon: '🤸' }
    ],
    admin: [
        { key: 'vice_director,art_director,senior_manager', label: 'Керівники', icon: '👑' },
        { key: 'manager', label: 'Менеджери', icon: '💼' },
        { key: 'admin', label: 'Адміністратори', icon: '📋' },
        { key: 'accountant', label: 'Бухгалтери', icon: '💰' },
        { key: 'hr', label: 'HR', icon: '👥' }
    ],
    cafe: [
        { key: 'cook', label: 'Кухня', icon: '🍳' },
        { key: 'barista', label: 'Бармени', icon: '🍸' },
        { key: 'waiter', label: 'Офіціанти', icon: '🍽️' }
    ],
    cleaning: [
        { key: 'cleaning', label: 'Хозяюшки', icon: '🧹' },
        { key: 'dishwasher', label: 'Мийка', icon: '🧽' },
        { key: 'wardrobe', label: 'Гардероб', icon: '🧥' }
    ]
};

const STAFF_ROLE_OPTIONS = [
    { value: 'animator', label: 'Аніматор' },
    { value: 'instructor', label: 'Інструктор' },
    { value: 'admin', label: 'Адміністратор' },
    { value: 'reception', label: 'Рецепція' },
    { value: 'manager', label: 'Менеджер' },
    { value: 'senior_manager', label: 'Старший менеджер' },
    { value: 'hr', label: 'HR' },
    { value: 'barista', label: 'Бариста' },
    { value: 'cook', label: 'Кухар' },
    { value: 'waiter', label: 'Офіціант' },
    { value: 'cleaning', label: 'Клінінг' },
    { value: 'dishwasher', label: 'Мийка' },
    { value: 'wardrobe', label: 'Гардероб' },
    { value: 'security', label: 'Охорона' },
    { value: 'maintenance', label: 'Технік' },
    { value: 'it_specialist', label: 'IT / техпідтримка' }
];

const STAFF_ROLE_OPTIONS_BY_DEPT = {
    animators: STAFF_ROLE_OPTIONS.filter(r => ['animator', 'instructor'].includes(r.value)),
    trampoline: STAFF_ROLE_OPTIONS.filter(r => ['instructor', 'animator'].includes(r.value)),
    admin: STAFF_ROLE_OPTIONS.filter(r => ['admin', 'reception', 'manager', 'senior_manager', 'hr'].includes(r.value)),
    cafe: STAFF_ROLE_OPTIONS.filter(r => ['barista', 'cook', 'waiter'].includes(r.value)),
    tech: STAFF_ROLE_OPTIONS.filter(r => ['maintenance', 'it_specialist'].includes(r.value)),
    cleaning: STAFF_ROLE_OPTIONS.filter(r => ['cleaning', 'dishwasher', 'wardrobe'].includes(r.value)),
    security: STAFF_ROLE_OPTIONS.filter(r => ['security', 'maintenance'].includes(r.value)),
    __default: STAFF_ROLE_OPTIONS
};

const LEGACY_DEPARTMENT_FALLBACK = {
    animators: 'Аніматори',
    trampoline: 'Батутисти',
    admin: 'Адміністрація',
    cafe: 'Кафе',
    tech: 'Технічний відділ',
    cleaning: 'Прибирання',
    security: 'Охорона'
};

function getDepartmentOptionsFromStaffState() {
    const source = StaffState.departments && Object.keys(StaffState.departments).length
        ? StaffState.departments
        : LEGACY_DEPARTMENT_FALLBACK;
    return Object.entries(source).map(([value, label]) => ({ value, label }));
}

const DAYS_UK = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS_UK = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
const STAFF_SCHEDULE_WINDOW_DAYS = 9;
const STAFF_SCHEDULE_TODAY_OFFSET_DAYS = 1;

// ==========================================
// HELPERS
// ==========================================

function showNotification(message, type = '') {
    let c = document.getElementById('toastContainer');
    if (!c) { c = document.createElement('div'); c.id = 'toastContainer'; c.className = 'toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = message;
    c.appendChild(t);
    setTimeout(() => { t.classList.add('toast-exit'); setTimeout(() => t.remove(), 300); }, 3000);
}

function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date;
}

function getScheduleFocusStart(d) {
    const date = new Date(d);
    date.setDate(date.getDate() - STAFF_SCHEDULE_TODAY_OFFSET_DAYS);
    date.setHours(0, 0, 0, 0);
    return date;
}

function formatDateStr(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getWeekDates(startDate) {
    const dates = [];
    for (let i = 0; i < STAFF_SCHEDULE_WINDOW_DAYS; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        dates.push(d);
    }
    return dates;
}

function getScheduleRangeEnd(dates) {
    return dates[dates.length - 1];
}

function todayStr() {
    return formatDateStr(new Date());
}

// ==========================================
// API CALLS
// ==========================================

async function fetchStaff() {
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch('/api/staff?active=true', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            StaffState.staff = data.data;
            StaffState.departments = data.departments;
        }
        return data;
    } catch (err) {
        console.error('fetchStaff error:', err);
        showNotification('Помилка завантаження персоналу', 'error');
        return { success: false };
    }
}

async function fetchSchedule(from, to) {
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`/api/staff/schedule?from=${from}&to=${to}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            StaffState.schedule = {};
            for (const entry of data.data) {
                StaffState.schedule[`${entry.staff_id}_${entry.date}`] = entry;
            }
        }
        return data;
    } catch (err) {
        console.error('fetchSchedule error:', err);
        showNotification('Помилка завантаження розкладу', 'error');
        return { success: false };
    }
}

async function saveScheduleEntry(staffId, date, shiftStart, shiftEnd, status, note) {
    const token = localStorage.getItem('pzp_token');
    const res = await fetch('/api/staff/schedule', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId, date, shiftStart, shiftEnd, status, note })
    });
    return await res.json();
}

async function bulkSaveSchedule(entries) {
    const token = localStorage.getItem('pzp_token');
    const res = await fetch('/api/staff/schedule/bulk', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries })
    });
    return await res.json();
}

async function copyWeekSchedule(fromMonday, toMonday, department) {
    const token = localStorage.getItem('pzp_token');
    const body = { fromMonday, toMonday };
    if (department && department !== 'all') body.department = department;
    const res = await fetch('/api/staff/schedule/copy-week', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return await res.json();
}

async function fetchScheduleHours(from, to) {
    const token = localStorage.getItem('pzp_token');
    const res = await fetch(`/api/staff/schedule/hours?from=${from}&to=${to}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return await res.json();
}

// ==========================================
// RENDERING
// ==========================================

function renderDeptFilter() {
    const container = document.getElementById('deptFilter');
    const depts = StaffState.departments;
    let html = `<button class="dept-chip ${StaffState.activeDept === 'all' ? 'active' : ''}" data-dept="all">Всі</button>`;
    for (const [key, label] of Object.entries(depts)) {
        const count = StaffState.staff.filter(s => s.department === key).length;
        html += `<button class="dept-chip ${StaffState.activeDept === key ? 'active' : ''}" data-dept="${key}">${DEPT_ICONS[key] || ''} ${label} (${count})</button>`;
    }
    container.innerHTML = html;

    container.querySelectorAll('.dept-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            StaffState.activeDept = chip.dataset.dept;
            container.querySelectorAll('.dept-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            renderSchedule();
        });
    });
}

function renderWeekLabel() {
    const dates = getWeekDates(StaffState.weekStart);
    const from = dates[0];
    const to = getScheduleRangeEnd(dates);
    const label = `${from.getDate()} ${MONTHS_UK[from.getMonth()]} — ${to.getDate()} ${MONTHS_UK[to.getMonth()]} ${to.getFullYear()}`;
    document.getElementById('weekLabel').textContent = label;
}

function renderSummary() {
    const container = document.getElementById('scheduleSummary');
    const today = todayStr();
    const filtered = StaffState.activeDept === 'all'
        ? StaffState.staff
        : StaffState.staff.filter(s => s.department === StaffState.activeDept);

    let working = 0, dayoff = 0, vacation = 0, sick = 0, remote = 0, unset = 0;
    for (const s of filtered) {
        const entry = StaffState.schedule[`${s.id}_${today}`];
        if (!entry) unset++;
        else if (entry.status === 'working') working++;
        else if (entry.status === 'dayoff') dayoff++;
        else if (entry.status === 'vacation') vacation++;
        else if (entry.status === 'sick') sick++;
        else if (entry.status === 'remote') remote++;
    }

    container.innerHTML = `
        <div class="summary-chip"><span class="chip-dot" style="background:#10B981"></span> На роботі: <span class="chip-count">${working}</span></div>
        <div class="summary-chip"><span class="chip-dot" style="background:#94A3B8"></span> Вихідні: <span class="chip-count">${dayoff}</span></div>
        <div class="summary-chip"><span class="chip-dot" style="background:#3B82F6"></span> Відпустка: <span class="chip-count">${vacation}</span></div>
        <div class="summary-chip"><span class="chip-dot" style="background:#EF4444"></span> Лікарняний: <span class="chip-count">${sick}</span></div>
        <div class="summary-chip"><span class="chip-dot" style="background:#F59E0B"></span> Віддалено: <span class="chip-count">${remote}</span></div>
        ${unset > 0 ? `<div class="summary-chip"><span class="chip-dot" style="background:#CBD5E1"></span> Не заповнено: <span class="chip-count">${unset}</span></div>` : ''}
    `;
}

function renderEmpRow(emp, dates, today) {
    const initials = emp.name.split(' ').map(w => w[0]).join('').slice(0, 2);
    const hoursData = StaffState.hoursData?.[emp.id];
    const hoursLabel = hoursData ? `${hoursData.totalHours}г / ${hoursData.workingDays}д` : '';
    const isFreelance = emp.is_freelance;
    const linkBadge = renderLinkBadge(emp);
    const faceBadge = emp.has_face_descriptor
        ? '<span class="link-badge linked" title="Фото для камери: є">📸</span>'
        : '<span class="link-badge unlinked" title="Фото для камери: немає">📸❌</span>';
    const hrLink = renderHrCrosslink(emp);
    const avatarColor = emp.color || (isFreelance ? '#94A3B8' : '#6366F1');
    let html = `<tr class="${isFreelance ? 'emp-freelance' : ''}">`;
    html += `<td>
        <div class="emp-cell" data-hr-profile="${emp.id}" role="link" tabindex="0"
             title="Відкрити HR профіль: ${escapeHtml(emp.name)}"
             aria-label="Відкрити HR профіль: ${escapeHtml(emp.name)}">
            <div class="emp-avatar" style="background:${escapeHtml(avatarColor)}">${isFreelance ? '~' : escapeHtml(initials)}</div>
            <div class="emp-info">
                <span class="emp-name">${escapeHtml(emp.name)}${hrLink}</span>
                <span class="emp-position">${escapeHtml(emp.position)} ${linkBadge} ${faceBadge}</span>
                <span class="emp-hours">${hoursLabel}</span>
            </div>
        </div>
    </td>`;

    for (const d of dates) {
        const ds = formatDateStr(d);
        const isToday = ds === today;
        const entry = StaffState.schedule[`${emp.id}_${ds}`];
        const status = entry ? entry.status : 'unset';
        const shiftStart = entry?.shift_start;
        const shiftEnd = entry?.shift_end;
        const icon = STATUS_ICONS[status] || '';

        let cellContent = '';
        if ((status === 'working' || status === 'remote') && shiftStart && shiftEnd) {
            cellContent = `<span class="sch-time">${shiftStart.slice(0,5)}–${shiftEnd.slice(0,5)}</span>`;
            if (status === 'remote') cellContent += `<span class="sch-label"><span class="sch-icon">${icon}</span> Відд.</span>`;
        } else if (status === 'working') {
            cellContent = `<span class="sch-label"><span class="sch-icon">${icon}</span> Роб.</span>`;
        } else if (status === 'unset') {
            cellContent = `<span class="sch-label sch-unset"><span class="sch-icon">${icon}</span></span>`;
        } else {
            cellContent = `<span class="sch-label"><span class="sch-icon">${icon}</span> ${STATUS_LABELS[status] || status}</span>`;
        }

        if (entry?.note) {
            cellContent += `<span class="sch-note">${escapeHtml(entry.note)}</span>`;
        }

        html += `<td>
            <div class="sch-cell status-${status} ${isToday ? 'today-col' : ''}"
                 data-staff="${emp.id}" data-date="${ds}"
                 title="${escapeHtml(emp.name)} — ${ds}${shiftStart ? ' (' + shiftStart.slice(0,5) + '–' + shiftEnd.slice(0,5) + ')' : ''}">
                ${cellContent}
            </div>
        </td>`;
    }
    html += `</tr>`;
    return html;
}

function renderSchedule() {
    const dates = getWeekDates(StaffState.weekStart);
    const today = todayStr();

    // Header
    const thead = document.getElementById('scheduleHead');
    let headHtml = '<tr><th>Співробітник</th>';
    for (const d of dates) {
        const ds = formatDateStr(d);
        const isToday = ds === today;
        headHtml += `<th class="${isToday ? 'today' : ''}">
            <span class="th-date">${d.getDate()}</span>
            <span class="th-day">${DAYS_UK[d.getDay()]}</span>
        </th>`;
    }
    headHtml += '</tr>';
    thead.innerHTML = headHtml;

    // Body — group by department
    const tbody = document.getElementById('scheduleBody');
    const depts = StaffState.departments;
    const filtered = StaffState.activeDept === 'all'
        ? StaffState.staff
        : StaffState.staff.filter(s => s.department === StaffState.activeDept);

    // Group staff by department
    const grouped = {};
    for (const s of filtered) {
        if (!grouped[s.department]) grouped[s.department] = [];
        grouped[s.department].push(s);
    }

    let bodyHtml = '';
    const deptOrder = ['animators', 'trampoline', 'admin', 'cafe', 'tech', 'cleaning', 'security'];

    for (const dept of deptOrder) {
        if (!grouped[dept]) continue;
        const deptLabel = depts[dept] || dept;
        const icon = DEPT_ICONS[dept] || '';
        const deptStaff = grouped[dept];
        const subGroups = DEPT_SUB_GROUPS[dept];

        // Department header
        bodyHtml += `<tr class="dept-row" data-dept="${dept}"><td colspan="${dates.length + 1}"><span class="dept-icon">${icon}</span> ${deptLabel} <span class="dept-count">${deptStaff.length}</span></td></tr>`;

        if (subGroups && deptStaff.length > 3) {
            // Render sub-groups within department
            for (const sg of subGroups) {
                const roleKeys = sg.key.split(',');
                const sgStaff = deptStaff.filter(s => roleKeys.includes(s.role_type));
                if (sgStaff.length === 0) continue;

                bodyHtml += `<tr class="sub-group-row"><td colspan="${dates.length + 1}"><span class="sub-group-icon">${sg.icon}</span> ${sg.label} <span class="sub-group-count">${sgStaff.length}</span></td></tr>`;

                for (const emp of sgStaff) {
                    bodyHtml += renderEmpRow(emp, dates, today);
                }
            }
            // Render staff that didn't match any sub-group (edge case)
            const allRoleKeys = subGroups.flatMap(sg => sg.key.split(','));
            const unmatched = deptStaff.filter(s => !allRoleKeys.includes(s.role_type));
            for (const emp of unmatched) {
                bodyHtml += renderEmpRow(emp, dates, today);
            }
        } else {
            // Small department — render without sub-groups
            for (const emp of deptStaff) {
                bodyHtml += renderEmpRow(emp, dates, today);
            }
        }
    }

    tbody.innerHTML = bodyHtml;
    if (StaffState.showHours) {
        tbody.classList.add('show-hours');
    }
    renderSummary();

    // Cell click handlers
    tbody.querySelectorAll('.sch-cell').forEach(cell => {
        cell.addEventListener('click', () => {
            openEditModal(parseInt(cell.dataset.staff), cell.dataset.date);
        });
    });

    // Link badge click handlers (v39.1)
    tbody.querySelectorAll('.link-badge.unlinked').forEach(badge => {
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            openLinkModal(parseInt(badge.dataset.linkStaff));
        });
    });
    tbody.querySelectorAll('.link-badge.linked').forEach(badge => {
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const userId = parseInt(badge.dataset.linkedUser, 10);
            if (Number.isFinite(userId)) {
                window.location.href = `/hr?tab=accounts&accountUser=${encodeURIComponent(userId)}`;
            }
        });
    });

    // Employee profile click handlers: the name/avatar area opens the HR profile,
    // while date cells keep opening shift editing and account badges keep linking accounts.
    tbody.querySelectorAll('[data-hr-profile]').forEach(cell => {
        const open = () => openHrProfile(parseInt(cell.dataset.hrProfile, 10));
        cell.addEventListener('click', (e) => {
            if (e.target.closest('a, button, input, select, textarea, [data-link-staff]')) return;
            open();
        });
        cell.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            open();
        });
    });
}

// ==========================================
// EDIT MODAL
// ==========================================

let _staffScheduleInitialState = '';
let _staffFillInitialState = '';

function getStaffScheduleState() {
    return ['schStatus', 'schStart', 'schEnd', 'schNote'].map(id => {
        const el = document.getElementById(id);
        return el ? String(el.value || '') : '';
    }).join('|');
}

function getStaffFillState() {
    const dayState = Array.from(document.querySelectorAll('#fillDaysRow input[type=checkbox]')).map(cb => cb.checked ? '1' : '0').join('');
    return ['fillStaffSelect', 'fillStatus', 'fillStart', 'fillEnd', 'fillNote'].map(id => {
        const el = document.getElementById(id);
        return el ? String(el.value || '') : '';
    }).join('|') + '|days:' + dayState;
}

function openEditModal(staffId, date) {
    const emp = StaffState.staff.find(s => s.id === staffId);
    if (!emp) return;

    StaffState.editingCell = { staffId, date };
    const entry = StaffState.schedule[`${staffId}_${date}`];

    document.getElementById('schModalTitle').textContent = `${emp.name} — ${date}`;
    document.getElementById('schStatus').value = entry?.status || 'working';
    document.getElementById('schStart').value = entry?.shift_start || '10:00';
    document.getElementById('schEnd').value = entry?.shift_end || '20:00';
    document.getElementById('schNote').value = entry?.note || '';

    toggleTimeFields();
    const overlay = document.getElementById('schModalOverlay');
    _staffScheduleInitialState = getStaffScheduleState();
    overlay?.classList.add('visible');
    if (window.ModalLayer) window.ModalLayer.ensureTopLayer(overlay);
    if (window.UnsafeDismissGuard && overlay) window.UnsafeDismissGuard.remember(overlay);
}

async function closeEditModal(force = false) {
    const overlay = document.getElementById('schModalOverlay');
    const closeNow = () => {
        overlay?.classList.remove('visible');
        StaffState.editingCell = null;
        _staffScheduleInitialState = getStaffScheduleState();
    };
    if (window.UnsafeDismissGuard && overlay) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(overlay, closeNow, {
            force,
            isDirty: () => getStaffScheduleState() !== _staffScheduleInitialState,
            message: 'Є незбережені зміни розкладу. Закрити без збереження?',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
    }
    closeNow();
    return true;
}

function toggleTimeFields() {
    const status = document.getElementById('schStatus')?.value;
    document.getElementById('schTimeFields').style.display = (status === 'working' || status === 'remote') ? '' : 'none';
}

async function handleSave() {
    const { staffId, date } = StaffState.editingCell;
    const status = document.getElementById('schStatus')?.value;
    const showTime = status === 'working' || status === 'remote';
    const shiftStart = showTime ? document.getElementById('schStart')?.value : null;
    const shiftEnd = showTime ? document.getElementById('schEnd')?.value : null;
    const note = document.getElementById('schNote')?.value.trim() || null;

    const result = await saveScheduleEntry(staffId, date, shiftStart, shiftEnd, status, note);
    if (result.success) {
        StaffState.schedule[`${staffId}_${date}`] = result.data;
        renderSchedule();
        closeEditModal(true);
        showNotification('Зміну збережено');
    } else {
        showNotification(result.error || 'Помилка збереження', 'error');
    }
}

// ==========================================
// WEEK NAVIGATION
// ==========================================

async function goToWeek(monday) {
    StaffState.weekStart = monday;
    renderWeekLabel();
    const dates = getWeekDates(monday);
    await fetchSchedule(formatDateStr(dates[0]), formatDateStr(getScheduleRangeEnd(dates)));
    renderSchedule();
    if (StaffState.showLoadView) renderLoadView();
}

function prevWeek() {
    const d = new Date(StaffState.weekStart);
    d.setDate(d.getDate() - 7);
    goToWeek(d);
}

function nextWeek() {
    const d = new Date(StaffState.weekStart);
    d.setDate(d.getDate() + 7);
    goToWeek(d);
}

function goToday() {
    goToWeek(getScheduleFocusStart(new Date()));
}

// ==========================================
// FILL WEEK MODAL
// ==========================================

function openFillWeekModal() {
    const select = document.getElementById('fillStaffSelect');
    const filtered = StaffState.activeDept === 'all'
        ? StaffState.staff
        : StaffState.staff.filter(s => s.department === StaffState.activeDept);

    select.innerHTML = '<option value="all">Всі видимі працівники</option>';
    for (const emp of filtered) {
        select.innerHTML += `<option value="${emp.id}">${escapeHtml(emp.name)} — ${escapeHtml(emp.position)}</option>`;
    }

    document.getElementById('fillStatus').value = 'working';
    document.getElementById('fillStart').value = '10:00';
    document.getElementById('fillEnd').value = '20:00';
    document.getElementById('fillNote').value = '';
    toggleFillTimeFields();
    const overlay = document.getElementById('fillWeekOverlay');
    _staffFillInitialState = getStaffFillState();
    overlay?.classList.add('visible');
    if (window.ModalLayer) window.ModalLayer.ensureTopLayer(overlay);
    if (window.UnsafeDismissGuard && overlay) window.UnsafeDismissGuard.remember(overlay);
}

async function closeFillWeekModal(force = false) {
    const overlay = document.getElementById('fillWeekOverlay');
    const closeNow = () => {
        overlay?.classList.remove('visible');
        _staffFillInitialState = getStaffFillState();
    };
    if (window.UnsafeDismissGuard && overlay) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(overlay, closeNow, {
            force,
            isDirty: () => getStaffFillState() !== _staffFillInitialState,
            message: 'Є незбережені зміни заповнення тижня. Закрити без збереження?',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
    }
    closeNow();
    return true;
}

function toggleFillTimeFields() {
    const status = document.getElementById('fillStatus')?.value;
    document.getElementById('fillTimeFields').style.display = (status === 'working' || status === 'remote') ? '' : 'none';
}

async function handleFillWeekSave() {
    const staffValue = document.getElementById('fillStaffSelect')?.value;
    const status = document.getElementById('fillStatus')?.value;
    const showTime = status === 'working' || status === 'remote';
    const shiftStart = showTime ? document.getElementById('fillStart')?.value : null;
    const shiftEnd = showTime ? document.getElementById('fillEnd')?.value : null;
    const note = document.getElementById('fillNote')?.value.trim() || null;

    // Get selected days (checkboxes)
    const checkedDays = [];
    document.querySelectorAll('#fillDaysRow input[type=checkbox]:checked').forEach(cb => {
        checkedDays.push(parseInt(cb.value));
    });
    if (checkedDays.length === 0) {
        showNotification('Оберіть хоча б один день', 'error');
        return;
    }

    // Determine which staff to fill
    let targetStaff;
    if (staffValue === 'all') {
        targetStaff = StaffState.activeDept === 'all'
            ? StaffState.staff
            : StaffState.staff.filter(s => s.department === StaffState.activeDept);
    } else {
        targetStaff = StaffState.staff.filter(s => s.id === parseInt(staffValue));
    }

    // Build entries for the current week's selected days
    const dates = getWeekDates(StaffState.weekStart);
    const entries = [];
    for (const emp of targetStaff) {
        for (const d of dates) {
            if (checkedDays.includes(d.getDay())) {
                entries.push({
                    staffId: emp.id,
                    date: formatDateStr(d),
                    shiftStart, shiftEnd, status, note
                });
            }
        }
    }

    if (entries.length === 0) {
        showNotification('Нічого заповнювати', 'error');
        return;
    }

    const result = await bulkSaveSchedule(entries);
    if (result.success) {
        closeFillWeekModal(true);
        showNotification(`Заповнено ${result.count} записів`);
        await goToWeek(StaffState.weekStart);
    } else {
        showNotification(result.error || 'Помилка збереження', 'error');
    }
}

// ==========================================
// COPY WEEK
// ==========================================

async function handleCopyWeek() {
    const fromMonday = formatDateStr(StaffState.weekStart);
    const nextMon = new Date(StaffState.weekStart);
    nextMon.setDate(nextMon.getDate() + 7);
    const toMonday = formatDateStr(nextMon);

    const deptLabel = StaffState.activeDept === 'all'
        ? 'всіх відділів'
        : (StaffState.departments[StaffState.activeDept] || StaffState.activeDept);

    if (!await confirmModal(`Скопіювати графік ${deptLabel} з тижня ${fromMonday} на тиждень ${toMonday}?\n\nІснуючі записи будуть перезаписані.`, { type: 'warning', okText: 'Копіювати' })) return;

    const result = await copyWeekSchedule(fromMonday, toMonday, StaffState.activeDept);
    if (result.success) {
        showNotification(`Скопійовано ${result.count} записів на наступний тиждень`);
        // Jump to the target week to see the result
        await goToWeek(nextMon);
    } else {
        showNotification(result.error || 'Помилка копіювання', 'error');
    }
}

// ==========================================
// HOURS TOGGLE
// ==========================================

async function toggleHours() {
    StaffState.showHours = !StaffState.showHours;
    const tbody = document.getElementById('scheduleBody');
    const btn = document.getElementById('toggleHoursBtn');

    if (StaffState.showHours) {
        // Fetch hours for the current visible period.
        const dates = getWeekDates(StaffState.weekStart);
        const from = formatDateStr(dates[0]);
        const to = formatDateStr(getScheduleRangeEnd(dates));
        const result = await fetchScheduleHours(from, to);
        if (result.success) {
            StaffState.hoursData = result.data;
        }
        btn.style.background = 'var(--primary)';
        btn.style.color = '#fff';
        btn.style.borderColor = 'var(--primary)';
    } else {
        StaffState.hoursData = null;
        btn.style.background = '';
        btn.style.color = '';
        btn.style.borderColor = '';
    }
    renderSchedule();
    // Apply show-hours class after render (tbody is re-created)
    if (StaffState.showHours) {
        document.getElementById('scheduleBody')?.classList.add('show-hours');
    }
}

// ==========================================
// LOAD VIEW (Excel-like daily workload)
// ==========================================

function toggleLoadView() {
    StaffState.showLoadView = !StaffState.showLoadView;
    const loadWrapper = document.getElementById('loadViewWrapper');
    const schedWrapper = document.getElementById('scheduleWrapper');
    const btn = document.getElementById('toggleLoadViewBtn');

    if (StaffState.showLoadView) {
        loadWrapper.style.display = '';
        schedWrapper.style.display = 'none';
        btn.style.background = 'var(--primary)';
        btn.style.color = '#fff';
        btn.style.borderColor = 'var(--primary)';
        renderLoadView();
    } else {
        loadWrapper.style.display = 'none';
        schedWrapper.style.display = '';
        btn.style.background = '';
        btn.style.color = '';
        btn.style.borderColor = '';
    }
}

function renderLoadView() {
    const dates = getWeekDates(StaffState.weekStart);
    const today = todayStr();
    const depts = StaffState.departments;
    const filtered = StaffState.activeDept === 'all'
        ? StaffState.staff
        : StaffState.staff.filter(s => s.department === StaffState.activeDept);

    // Header
    const thead = document.getElementById('loadViewHead');
    let headHtml = '<tr><th>Показник</th>';
    for (const d of dates) {
        const ds = formatDateStr(d);
        const isToday = ds === today;
        headHtml += `<th class="${isToday ? 'today' : ''}">
            <span class="th-date">${d.getDate()}</span>
            <span class="th-day">${DAYS_UK[d.getDay()]}</span>
        </th>`;
    }
    headHtml += '<th>Разом</th></tr>';
    thead.innerHTML = headHtml;

    // Calculate stats per day
    const statuses = ['working', 'remote', 'dayoff', 'vacation', 'sick', 'unset'];
    const statusNames = { working: 'На роботі', remote: 'Віддалено', dayoff: 'Вихідні', vacation: 'Відпустка', sick: 'Лікарняний', unset: 'Не заповнено' };
    const statusCss = { working: 'working', remote: 'remote', dayoff: 'dayoff', vacation: 'vacation', sick: 'sick', unset: 'unset' };

    const dayStats = dates.map(d => {
        const ds = formatDateStr(d);
        const counts = { working: 0, remote: 0, dayoff: 0, vacation: 0, sick: 0, unset: 0, total: filtered.length };
        for (const emp of filtered) {
            const entry = StaffState.schedule[`${emp.id}_${ds}`];
            const status = entry ? entry.status : 'unset';
            if (counts[status] !== undefined) counts[status]++;
            else counts.unset++;
        }
        return counts;
    });

    // Render rows per status
    const tbody = document.getElementById('loadViewBody');
    let bodyHtml = '';

    for (const status of statuses) {
        const weekTotal = dayStats.reduce((sum, d) => sum + d[status], 0);
        bodyHtml += `<tr class="load-row-status">`;
        bodyHtml += `<td>${statusNames[status]}</td>`;
        for (const day of dayStats) {
            const val = day[status];
            bodyHtml += `<td class="${val > 0 ? 'load-cell-' + statusCss[status] : ''}">${val || '-'}</td>`;
        }
        bodyHtml += `<td class="load-cell-total">${weekTotal}</td>`;
        bodyHtml += `</tr>`;
    }

    // Total active row
    bodyHtml += `<tr class="load-total"><td>Всього працює</td>`;
    for (const day of dayStats) {
        const active = day.working + day.remote;
        bodyHtml += `<td class="load-cell-working">${active}</td>`;
    }
    const totalActive = dayStats.reduce((sum, d) => sum + d.working + d.remote, 0);
    bodyHtml += `<td class="load-cell-total">${totalActive}</td></tr>`;

    // Department breakdown (if showing all departments)
    if (StaffState.activeDept === 'all') {
        const deptOrder = ['animators', 'trampoline', 'admin', 'cafe', 'tech', 'cleaning', 'security'];
        bodyHtml += `<tr><td colspan="${dates.length + 2}" style="padding:8px 16px;font-weight:800;font-size:12px;color:var(--gray-500);background:var(--gray-50);border-top:2px solid var(--gray-200)">По відділах (на роботі + віддалено)</td></tr>`;

        for (const dept of deptOrder) {
            const deptStaff = StaffState.staff.filter(s => s.department === dept);
            if (deptStaff.length === 0) continue;
            const icon = DEPT_ICONS[dept] || '';
            const label = depts[dept] || dept;
            bodyHtml += `<tr class="load-row-status"><td>${icon} ${label}</td>`;
            for (const d of dates) {
                const ds = formatDateStr(d);
                let active = 0;
                for (const emp of deptStaff) {
                    const entry = StaffState.schedule[`${emp.id}_${ds}`];
                    const status = entry ? entry.status : 'unset';
                    if (status === 'working' || status === 'remote') active++;
                }
                const ratio = active / deptStaff.length;
                const cls = ratio >= 0.7 ? 'load-cell-working' : ratio >= 0.4 ? 'load-cell-remote' : 'load-cell-sick';
                bodyHtml += `<td class="${cls}">${active}/${deptStaff.length}</td>`;
            }
            const weekActive = dates.reduce((sum, d) => {
                const ds = formatDateStr(d);
                let cnt = 0;
                for (const emp of deptStaff) {
                    const entry = StaffState.schedule[`${emp.id}_${ds}`];
                    const status = entry ? entry.status : 'working';
                    if (status === 'working' || status === 'remote') cnt++;
                }
                return sum + cnt;
            }, 0);
            bodyHtml += `<td class="load-cell-total">${weekActive}</td></tr>`;
        }
    }

    tbody.innerHTML = bodyHtml;
}

// ==========================================
// ACCOUNT LINKING (v39.1)
// ==========================================

async function fetchLinkStatus() {
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch('/api/staff/link-status', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            StaffState.linkData = data.data;
            StaffState.linkStats = data.stats;
        }
        return data;
    } catch (err) {
        console.error('fetchLinkStatus error:', err);
        return { success: false };
    }
}

async function fetchAllUsers() {
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch('/api/users', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        StaffState.allUsers = Array.isArray(data) ? data : (data.data || []);
        return StaffState.allUsers;
    } catch (err) {
        console.error('fetchAllUsers error:', err);
        return [];
    }
}

function getCredentialPassword(credential) {
    return credential?.password || credential?.oneTimePassword || '';
}

function showOneTimeCredential(credential, title = 'One-time credentials', payload = {}) {
    if (!credential) return;
    const text = `Логін: ${credential.username || ''}\nПароль: ${getCredentialPassword(credential)}`;
    const hasReadiness = Object.prototype.hasOwnProperty.call(payload, 'loginReady');
    const readinessMessage = hasReadiness
        ? (payload.loginReady
            ? '\n\nПеревірено сервером: цей логін і пароль готові до входу.'
            : `\n\nУвага: сервер не підтвердив готовність входу (${payload.loginReadyReason || 'невідомо'}).`)
        : '';
    if (typeof confirmModal === 'function') {
        confirmModal(`${title}\n\n${text}${readinessMessage}\n\nСкопіюйте зараз: старий пароль у CRM не можна переглянути повторно.`, {
            type: 'warning',
            okText: 'Скопіювати',
            cancelText: 'Закрити'
        }).then(ok => {
            if (ok && navigator.clipboard) {
                navigator.clipboard.writeText(text).then(() => showNotification('One-time credentials скопійовано', 'success'));
            }
        });
        return;
    }
    if (typeof showNotification === 'function') {
        showNotification(text, 'info');
    } else {
        console.info(`${title}\n\n${text}`);
    }
}

function suggestUsernameFromStaffInfo(info = {}) {
    const key = String(info.unique_person_key || '').replace(/\.\w+$/, '');
    const raw = key || info.name || `staff.${info.id || ''}`;
    const normalized = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '.')
        .replace(/\.+/g, '.')
        .replace(/^\.+|\.+$/g, '');
    return normalized || `staff.${info.id || Date.now()}`;
}

function getStaffAccountRole(info = {}) {
    const role = String(info.role_type || '').trim();
    const aliases = {
        trampoline_instructor: 'instructor',
        cleaner: 'cleaning',
        technician: 'maintenance',
        head_cook: 'head_chef',
        bartender: 'barista',
        hr_manager: 'hr',
        host: 'animator',
        intern: 'animator'
    };
    const mapped = aliases[role] || role;
    const allowed = new Set(['animator', 'instructor', 'manager', 'hr', 'admin', 'cook', 'barista', 'waiter', 'maintenance', 'cleaning']);
    return allowed.has(mapped) ? mapped : 'animator';
}

function getLinkInfo(staffId) {
    return StaffState.linkData.find(r => r.id === staffId);
}

async function toggleLinkView() {
    StaffState.showLinkView = !StaffState.showLinkView;
    const btn = document.getElementById('toggleLinkViewBtn');

    if (StaffState.showLinkView) {
        btn.style.background = 'var(--primary)';
        btn.style.color = '#fff';
        btn.style.borderColor = 'var(--primary)';
        await fetchLinkStatus();
        renderLinkStatsBar();
    } else {
        btn.style.background = '';
        btn.style.color = '';
        btn.style.borderColor = '';
        const bar = document.getElementById('linkStatsBar');
        if (bar) bar.remove();
    }
    renderSchedule();
}

function renderLinkStatsBar() {
    let bar = document.getElementById('linkStatsBar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'linkStatsBar';
        bar.className = 'link-stats-bar';
        const summary = document.getElementById('scheduleSummary');
        summary.parentNode.insertBefore(bar, summary);
    }

    const s = StaffState.linkStats || { total: 0, linked: 0, unlinked: 0, freelance: 0 };
    bar.innerHTML = `
        <div class="link-stat">🔗 Акаунти CRM:</div>
        <div class="link-stat"><span class="link-stat-value" style="color:#22c55e">${s.linked}</span> з акаунтом</div>
        <div class="link-stat"><span class="link-stat-value" style="color:#f59e0b">${s.unlinked}</span> без акаунту</div>
        <div class="link-stat"><span class="link-stat-value" style="color:var(--gray-400)">${s.freelance}</span> фріланс</div>
    `;
}

function renderLinkBadge(emp) {
    if (!StaffState.showLinkView) return '';
    const info = getLinkInfo(emp.id);
    if (!info) return '';

    if (info.is_freelance) {
        return '<span class="link-badge freelance-badge" title="Фріланс-слот">~</span>';
    }
    if (info.user_id) {
        return `<span class="link-badge linked" title="Акаунт: ${escapeHtml(info.username)} (${escapeHtml(info.user_role)}) — натисніть для керування" data-linked-user="${Number(info.user_id)}">✅ ${escapeHtml(info.username)}</span>`;
    }
    return `<span class="link-badge unlinked" title="Немає акаунту — натисніть для зв'язки" data-link-staff="${emp.id}">⚠️ Зв'язати</span>`;
}

function renderHrCrosslink(emp) {
    return `<a href="/hr?employee=${emp.id}" class="hr-crosslink" title="HR профіль">👤</a>`;
}

function openHrProfile(staffId) {
    if (!Number.isFinite(staffId)) return;
    window.location.href = `/hr?employee=${encodeURIComponent(staffId)}`;
}

// Open link modal for a specific staff member
async function openLinkModal(staffId) {
    const info = getLinkInfo(staffId);
    if (!info) return;

    StaffState.linkingStaffId = staffId;
    StaffState.selectedUserId = null;

    document.getElementById('linkModalTitle').textContent = `🔗 Зв'язати: ${info.name}`;
    document.getElementById('linkModalSubtitle').textContent = `${info.department} — ${info.position}`;
    document.getElementById('linkConfirmBtn').disabled = true;
    document.getElementById('linkSearchInput').value = '';

    // Fetch users if not loaded
    if (StaffState.allUsers.length === 0) await fetchAllUsers();

    renderLinkUsersList('');
    document.getElementById('linkModalOverlay')?.classList.add('visible');
    document.getElementById('linkSearchInput')?.focus();
}

function closeLinkModal() {
    document.getElementById('linkModalOverlay')?.classList.remove('visible');
    StaffState.linkingStaffId = null;
    StaffState.selectedUserId = null;
}

function renderLinkUsersList(searchTerm) {
    const container = document.getElementById('linkUsersList');
    const term = searchTerm.toLowerCase().trim();

    // Filter users — exclude system accounts
    const systemUsers = ['openclaw', 'guardian', 'system'];
    let users = StaffState.allUsers.filter(u =>
        !systemUsers.includes(u.username) && u.role !== 'bot' && u.role !== 'viewer'
    );

    if (term) {
        users = users.filter(u =>
            (u.name || '').toLowerCase().includes(term) ||
            (u.username || '').toLowerCase().includes(term)
        );
    }

    // Mark which users are already linked
    const linkedUserIds = new Set(StaffState.linkData.filter(r => r.user_id).map(r => r.user_id));

    let html = '';
    for (const u of users) {
        const isLinked = linkedUserIds.has(u.id);
        const linkedTo = isLinked ? StaffState.linkData.find(r => r.user_id === u.id) : null;
        const linkedLabel = isLinked ? ` (→ ${linkedTo?.name || '?'})` : '';
        const selected = StaffState.selectedUserId === u.id;

        html += `<div class="link-user-item ${selected ? 'selected' : ''} ${isLinked ? 'opacity-50' : ''}" data-user-id="${u.id}">
            <input type="radio" name="linkUser" class="user-radio" ${selected ? 'checked' : ''} value="${u.id}">
            <div class="link-user-info">
                <span class="link-user-name">${escapeHtml(u.name)} ${isLinked ? '🔗' : ''}</span>
                <span class="link-user-role">@${escapeHtml(u.username)} · ${escapeHtml(u.role)}${linkedLabel}</span>
            </div>
        </div>`;
    }

    if (users.length === 0) {
        html = '<div style="padding:16px;text-align:center;color:var(--gray-400);font-size:13px">Нічого не знайдено</div>';
    }

    container.innerHTML = html;

    // Click handlers
    container.querySelectorAll('.link-user-item').forEach(item => {
        item.addEventListener('click', () => {
            StaffState.selectedUserId = parseInt(item.dataset.userId);
            document.getElementById('linkConfirmBtn').disabled = false;
            renderLinkUsersList(document.getElementById('linkSearchInput')?.value || '');
        });
    });
}

async function confirmLinkAccount() {
    if (!StaffState.linkingStaffId || !StaffState.selectedUserId) return;

    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`/api/staff/${StaffState.linkingStaffId}/link`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: StaffState.selectedUserId })
        });
        const data = await res.json();

        if (data.success) {
            showNotification('Акаунт зв\'язано');
            closeLinkModal();
            await fetchLinkStatus();
            renderLinkStatsBar();
            renderSchedule();
        } else {
            showNotification(data.error || 'Помилка зв\'язування', 'error');
        }
    } catch (err) {
        showNotification('Помилка мережі', 'error');
    }
}

async function createAccountForLinkingStaff() {
    const info = getLinkInfo(StaffState.linkingStaffId);
    if (!info || typeof formModal !== 'function') return;
    const result = await formModal(`Створити акаунт · ${info.name}`, [
        { key: 'name', label: 'Імʼя в CRM', required: true, defaultValue: info.name || '' },
        { key: 'username', label: 'Логін', required: true, defaultValue: suggestUsernameFromStaffInfo(info) },
        { key: 'password', label: 'Пароль вручну або порожньо для one-time', type: 'password', placeholder: 'Порожньо = CRM згенерує одноразовий пароль' },
        { key: 'confirmPassword', label: 'Повторити пароль, якщо вводите вручну', type: 'password' },
        { key: 'role', label: 'Основна роль', type: 'select', defaultValue: getStaffAccountRole(info), options: [
            { value: 'animator', label: 'Аніматор' },
            { value: 'instructor', label: 'Інструктор' },
            { value: 'manager', label: 'Менеджер' },
            { value: 'hr', label: 'HR' },
            { value: 'admin', label: 'Адмін' },
            { value: 'cook', label: 'Повар' },
            { value: 'barista', label: 'Бармен' },
            { value: 'waiter', label: 'Офіціант' },
            { value: 'maintenance', label: 'Технік' },
            { value: 'cleaning', label: 'Клінінг' }
        ] }
    ], {
        icon: '👤',
        type: 'info',
        okText: 'Створити',
        className: 'staff-account-create-modal'
    });
    if (!result) return;
    const password = String(result.password || '');
    const issueOneTime = !password;
    if (password && password.length < 6) {
        showNotification('Пароль має бути не менше 6 символів', 'error');
        return;
    }
    if (password && password !== String(result.confirmPassword || '')) {
        showNotification('Паролі не збігаються', 'error');
        return;
    }
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: String(result.username || '').trim(),
                password: issueOneTime ? undefined : password,
                issueOneTime,
                name: String(result.name || '').trim(),
                role: result.role || 'animator',
                staffId: info.id
            })
        });
        const data = await res.json();
        if (!data.success) {
            showNotification(data.error || 'Не вдалося створити акаунт', 'error');
            return;
        }
        closeLinkModal();
        if (data.credential) {
            showOneTimeCredential(data.credential, `Акаунт ${data.user?.username || result.username} створено`, data);
        } else {
            showNotification(`Акаунт ${data.user?.username || result.username} створено`, 'success');
        }
        await fetchAllUsers();
        await fetchLinkStatus();
        renderLinkStatsBar();
        renderSchedule();
    } catch (err) {
        showNotification('Помилка мережі', 'error');
    }
}

// Bulk create accounts
async function handleBulkCreate() {
    const unlinked = StaffState.linkStats?.unlinked || 0;
    if (unlinked === 0) {
        showNotification('Всі працівники вже мають акаунти', 'success');
        return;
    }

    if (!await confirmModal(`Створити акаунти для ${unlinked} працівників без акаунтів?\n\nCRM покаже одноразові логіни і паролі тільки в цьому вікні. CSV/PDF експорт паролів вимкнено.`, { type: 'warning', okText: 'Створити' })) return;

    showNotification('Створюємо акаунти...');
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch('/api/staff/bulk-create-accounts', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (data.success) {
            StaffState.bulkResults = data;
            showBulkResults(data);
            await fetchLinkStatus();
            renderLinkStatsBar();
            renderSchedule();
        } else {
            showNotification(data.error || 'Помилка створення', 'error');
        }
    } catch (err) {
        showNotification('Помилка мережі', 'error');
    }
}

function showBulkResults(data) {
    const body = document.getElementById('bulkResultsBody');
    const created = Array.isArray(data.created) ? data.created : [];
    const skipped = Array.isArray(data.skipped) ? data.skipped : [];
    let html = `<p style="margin:0 0 8px;font-size:14px;font-weight:700">Створено: ${created.length} акаунтів</p>`;
    html += '<p style="margin:0 0 8px;font-size:12px;color:var(--warning,#f59e0b)">Паролі показані один раз. CSV/PDF експорт паролів вимкнено.</p>';

    if (skipped.length > 0) {
        html += `<p style="margin:0 0 8px;font-size:12px;color:var(--gray-500)">Пропущено: ${skipped.length} (дублі або вже привʼязані)</p>`;
    }

    html += `<table class="bulk-results-table">
        <thead><tr><th>Ім'я</th><th>Логін</th><th>Пароль</th><th>Роль</th></tr></thead>
        <tbody>`;

    for (const c of created) {
        const password = getCredentialPassword(c.credential) || c.password || '';
        html += `<tr>
            <td style="font-family:inherit;font-weight:600">${escapeHtml(c.name)}</td>
            <td>${escapeHtml(c.username)}</td>
            <td>${escapeHtml(password)}</td>
            <td>${escapeHtml(c.role)}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    body.innerHTML = html;
    document.getElementById('bulkCsvBtn')?.classList.add('hidden');
    document.getElementById('bulkPdfBtn')?.classList.add('hidden');
    document.getElementById('bulkResultsOverlay')?.classList.add('visible');
}

function closeBulkResults() {
    document.getElementById('bulkResultsOverlay')?.classList.remove('visible');
}

function copyBulkResults() {
    if (!StaffState.bulkResults) return;
    const lines = ['Ім\'я\tЛогін\tПароль\tРоль'];
    for (const c of (StaffState.bulkResults.created || [])) {
        lines.push(`${c.name}\t${c.username}\t${getCredentialPassword(c.credential) || c.password || ''}\t${c.role}`);
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
        showNotification('Скопійовано в буфер обміну');
    });
}

function downloadBulkCsv() {
    showNotification('CSV експорт паролів вимкнено: one-time credentials можна тільки скопіювати зараз.', 'warning');
}

async function downloadBulkPdf() {
    showNotification('PDF експорт паролів вимкнено: one-time credentials можна тільки скопіювати зараз.', 'warning');
}

// Excel import
function triggerExcelImport() {
    document.getElementById('excelImportInput')?.click();
}

async function handleExcelImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    showNotification('Імпортуємо з Excel...');
    const token = localStorage.getItem('pzp_token');
    const res = await fetch('/api/staff/import-excel', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
    });
    const data = await res.json();

    if (data.success) {
        showNotification(`Імпорт: ${data.created} створено, ${data.updated} оновлено, ${data.skipped} пропущено`);
        await fetchStaff();
        await fetchLinkStatus();
        renderSchedule();
        renderLinkStatsBar();
    } else {
        showNotification(data.error || 'Помилка імпорту', 'error');
    }
    e.target.value = '';
}

// ==========================================
// EXCEL EXPORT
// ==========================================

function handleExcelExport() {
    const dates = getWeekDates(StaffState.weekStart);
    const depts = StaffState.departments;
    const deptOrder = ['animators', 'trampoline', 'admin', 'cafe', 'tech', 'cleaning', 'security'];

    // Build CSV (BOM for Excel)
    let csv = '\ufeff';
    csv += 'Відділ,Підгрупа,Ім\'я,Посада';
    for (const d of dates) {
        csv += `,${d.getDate()} ${MONTHS_UK[d.getMonth()]} (${DAYS_UK[d.getDay()]})`;
    }
    csv += '\n';

    for (const dept of deptOrder) {
        const deptStaff = StaffState.staff.filter(s => s.department === dept);
        if (deptStaff.length === 0) continue;
        const deptLabel = depts[dept] || dept;
        const subGroups = DEPT_SUB_GROUPS[dept];

        const renderStaffCsv = (emp, sgLabel) => {
            let row = `"${deptLabel}","${sgLabel}","${emp.name}","${emp.position}"`;
            for (const d of dates) {
                const ds = formatDateStr(d);
                const entry = StaffState.schedule[`${emp.id}_${ds}`];
                const status = entry ? entry.status : 'working';
                const time = (entry?.shift_start && entry?.shift_end)
                    ? `${entry.shift_start.slice(0,5)}-${entry.shift_end.slice(0,5)}`
                    : '';
                const label = STATUS_LABELS[status] || status;
                row += `,"${time || label}"`;
            }
            csv += row + '\n';
        };

        if (subGroups) {
            for (const sg of subGroups) {
                const roleKeys = sg.key.split(',');
                const sgStaff = deptStaff.filter(s => roleKeys.includes(s.role_type));
                for (const emp of sgStaff) renderStaffCsv(emp, sg.label);
            }
            const allRoleKeys = subGroups.flatMap(sg => sg.key.split(','));
            const unmatched = deptStaff.filter(s => !allRoleKeys.includes(s.role_type));
            for (const emp of unmatched) renderStaffCsv(emp, '');
        } else {
            for (const emp of deptStaff) renderStaffCsv(emp, '');
        }
    }

    const from = dates[0];
    const to = getScheduleRangeEnd(dates);
    const filename = `grafik_${formatDateStr(from)}_${formatDateStr(to)}.csv`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('Графік експортовано');
}

// ==========================================
// PRINT
// ==========================================

function handlePrint() {
    window.print();
}

// v39.11: Add staff modal
async function openAddStaffModal() {
    const DEPTS = getDepartmentOptionsFromStaffState();
    const defaultDepartment = DEPTS[0]?.value || 'animators';
    if (typeof formModal !== 'function') return;
    const result = await formModal('Додати співробітника', [
        { key: 'name', label: 'ПІБ', required: true, placeholder: 'Прізвище Ім\'я По батькові' },
        { key: 'department', label: 'Відділ', type: 'select', options: DEPTS, defaultValue: defaultDepartment, required: true },
        { key: 'position', label: 'Посада', placeholder: 'Аніматор, Менеджер...', required: true },
        {
            key: 'role_type',
            label: 'Роль',
            type: 'select',
            options: STAFF_ROLE_OPTIONS_BY_DEPT[defaultDepartment] || STAFF_ROLE_OPTIONS,
            optionsBy: STAFF_ROLE_OPTIONS_BY_DEPT,
            dependsOn: 'department'
        },
        {
            key: 'secondary_professions',
            label: 'Додаткові професії',
            type: 'textarea',
            placeholder: 'host, instructor',
            hint: 'Основна роль лишається джерелом групування графіка.'
        },
        { key: 'phone', label: 'Телефон', placeholder: '+380...' },
        { key: 'address', label: 'Адреса', placeholder: 'Місто, вулиця, будинок' }
    ], { icon: '👤', okText: 'Додати' });
    if (!result) return;
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch('/api/staff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                name: result.name.trim(),
                department: result.department,
                position: result.position || '',
                role_type: result.role_type || 'animator',
                secondary_professions: String(result.secondary_professions || '').split(/[\n,;]+/).map(item => item.trim()).filter(Boolean),
                phone: result.phone || '',
                address: result.address || ''
            })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            if (typeof showNotification === 'function') showNotification(err.error || 'Помилка додавання', 'error');
            return;
        }
        if (typeof showNotification === 'function') showNotification('Співробітника додано!', 'success');
        await fetchStaff();
        renderSchedule();
    } catch (e) { if (typeof showNotification === 'function') showNotification(e.message, 'error'); }
}

// Dark mode: handled by shared initDarkMode() from config.js

// ==========================================
// INIT
// ==========================================

async function initPage() {
    initDarkMode();

    const user = await apiVerifyToken();
    if (!user) {
        window.location.href = '/';
        return;
    }

    AppState.currentUser = user;
    const _userEl = document.getElementById('currentUser'); if (_userEl) _userEl.textContent = user.name;
    if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
    else if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();

    const MANAGE_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr'];
    const canManage = MANAGE_ROLES.includes(user.role);
    const ADMIN_ROLES = ['creator', 'director'];
    const isAdmin = ADMIN_ROLES.includes(user.role);
    const addBtn = document.getElementById('addStaffBtn');
    if (addBtn) addBtn.style.display = canManage ? '' : 'none';

    // Show admin-only buttons
    const copyBtn = document.getElementById('copyWeekBtn');
    const fillBtn = document.getElementById('fillWeekBtn');
    if (copyBtn) copyBtn.style.display = canManage ? '' : 'none';
    if (fillBtn) fillBtn.style.display = canManage ? '' : 'none';

    // v39.1: Show bulk create and import buttons only for creator/director
    const bulkBtn = document.getElementById('bulkCreateBtn');
    const importBtn = document.getElementById('importExcelBtn');
    if (bulkBtn) bulkBtn.style.display = isAdmin ? '' : 'none';
    if (importBtn) importBtn.style.display = isAdmin ? '' : 'none';

    if (typeof bindLogoutButton === 'function') bindLogoutButton();

    // Load data
    await fetchStaff();
    renderDeptFilter();

    // Init the rolling window: yesterday, today, and the upcoming days.
    StaffState.weekStart = getScheduleFocusStart(new Date());
    renderWeekLabel();

    const dates = getWeekDates(StaffState.weekStart);
    await fetchSchedule(formatDateStr(dates[0]), formatDateStr(getScheduleRangeEnd(dates)));
    renderSchedule();

    // Event listeners
    document.getElementById('prevWeekBtn')?.addEventListener('click', prevWeek);
    document.getElementById('nextWeekBtn')?.addEventListener('click', nextWeek);
    document.getElementById('todayWeekBtn')?.addEventListener('click', goToday);
    document.getElementById('schSaveBtn')?.addEventListener('click', handleSave);
    document.getElementById('schCancelBtn')?.addEventListener('click', () => closeEditModal(false));
    document.getElementById('schStatus')?.addEventListener('change', toggleTimeFields);

    document.getElementById('schModalOverlay')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeEditModal(false);
    });

    // Fill week modal
    document.getElementById('fillWeekBtn')?.addEventListener('click', openFillWeekModal);
    document.getElementById('fillSaveBtn')?.addEventListener('click', handleFillWeekSave);
    document.getElementById('fillCancelBtn')?.addEventListener('click', () => closeFillWeekModal(false));
    document.getElementById('fillStatus')?.addEventListener('change', toggleFillTimeFields);
    document.getElementById('fillWeekOverlay')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeFillWeekModal(false);
    });

    // Copy week
    document.getElementById('copyWeekBtn')?.addEventListener('click', handleCopyWeek);

    // Hours toggle
    document.getElementById('toggleHoursBtn')?.addEventListener('click', toggleHours);

    // Load view toggle
    document.getElementById('toggleLoadViewBtn')?.addEventListener('click', toggleLoadView);

    // v39.1: Account linking
    document.getElementById('toggleLinkViewBtn')?.addEventListener('click', toggleLinkView);
    document.getElementById('bulkCreateBtn')?.addEventListener('click', handleBulkCreate);
    document.getElementById('importExcelBtn')?.addEventListener('click', triggerExcelImport);
    document.getElementById('excelImportInput')?.addEventListener('change', handleExcelImport);
    document.getElementById('exportExcelBtn')?.addEventListener('click', handleExcelExport);
    document.getElementById('printBtn')?.addEventListener('click', handlePrint);

    // v39.11: Add staff button
    document.getElementById('addStaffBtn')?.addEventListener('click', openAddStaffModal);

    // Link modal
    document.getElementById('linkConfirmBtn')?.addEventListener('click', confirmLinkAccount);
    document.getElementById('linkCreateAccountBtn')?.addEventListener('click', createAccountForLinkingStaff);
    document.getElementById('linkCancelBtn')?.addEventListener('click', closeLinkModal);
    document.getElementById('linkSearchInput')?.addEventListener('input', (e) => {
        renderLinkUsersList(e.target.value);
    });
    document.getElementById('linkModalOverlay')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeLinkModal();
    });

    // Bulk results modal
    document.getElementById('bulkCloseBtn')?.addEventListener('click', closeBulkResults);
    document.getElementById('bulkCopyBtn')?.addEventListener('click', copyBulkResults);
    document.getElementById('bulkCsvBtn')?.addEventListener('click', downloadBulkCsv);
    document.getElementById('bulkPdfBtn')?.addEventListener('click', downloadBulkPdf);
    document.getElementById('bulkResultsOverlay')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeBulkResults();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeEditModal(false);
            closeFillWeekModal(false);
            closeLinkModal();
            closeBulkResults();
        }
    });
}

document.addEventListener('DOMContentLoaded', initPage);
