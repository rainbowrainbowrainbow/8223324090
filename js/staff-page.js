/**
 * staff-page.js — Staff schedule page (v7.10)
 *
 * LLM HINT: This is the frontend for the /staff page.
 * Shows a weekly schedule grid: rows = employees grouped by department, columns = days.
 * Click on a cell to edit shift via modal (status, time, note).
 * API used: GET /api/staff, GET /api/staff/schedule, PUT /api/staff/schedule.
 * State is in StaffState object (weekStart, staff[], schedule{}, activeDept).
 */

// ==========================================
// STATE
// ==========================================

const StaffState = {
    weekStart: null,    // Monday of current view
    staff: [],
    schedule: {},       // { staffId_date: entry }
    departments: {},
    activeDept: 'all',
    editingCell: null,  // { staffId, date }
    hoursData: null,    // { staffId: { totalHours, workingDays, ... } }
    showHours: false,
};

const DEPT_ICONS = {
    animators: '🎭',
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
    sick: 'Лікарняний'
};

const DAYS_UK = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS_UK = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];

// ==========================================
// HELPERS
// ==========================================

function showNotification(message, type = '') {
    const el = document.getElementById('notification');
    if (!el) return;
    document.getElementById('notificationText').textContent = message;
    el.className = 'notification' + (type ? ` ${type}` : '');
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date;
}

function formatDateStr(d) {
    return d.toISOString().split('T')[0];
}

function getWeekDates(monday) {
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        dates.push(d);
    }
    return dates;
}

function todayStr() {
    return formatDateStr(new Date());
}

// ==========================================
// API CALLS
// ==========================================

async function fetchStaff() {
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
}

async function fetchSchedule(from, to) {
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
    const to = dates[6];
    const label = `${from.getDate()} ${MONTHS_UK[from.getMonth()]} — ${to.getDate()} ${MONTHS_UK[to.getMonth()]} ${to.getFullYear()}`;
    document.getElementById('weekLabel').textContent = label;
}

function renderSummary() {
    const container = document.getElementById('scheduleSummary');
    const today = todayStr();
    const filtered = StaffState.activeDept === 'all'
        ? StaffState.staff
        : StaffState.staff.filter(s => s.department === StaffState.activeDept);

    let working = 0, dayoff = 0, vacation = 0, sick = 0;
    for (const s of filtered) {
        const entry = StaffState.schedule[`${s.id}_${today}`];
        if (!entry || entry.status === 'working') working++;
        else if (entry.status === 'dayoff') dayoff++;
        else if (entry.status === 'vacation') vacation++;
        else if (entry.status === 'sick') sick++;
    }

    container.innerHTML = `
        <div class="summary-chip"><span class="chip-dot" style="background:#10B981"></span> На роботі: <span class="chip-count">${working}</span></div>
        <div class="summary-chip"><span class="chip-dot" style="background:#94A3B8"></span> Вихідні: <span class="chip-count">${dayoff}</span></div>
        <div class="summary-chip"><span class="chip-dot" style="background:#3B82F6"></span> Відпустка: <span class="chip-count">${vacation}</span></div>
        <div class="summary-chip"><span class="chip-dot" style="background:#EF4444"></span> Лікарняний: <span class="chip-count">${sick}</span></div>
    `;
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
    const deptOrder = ['animators', 'admin', 'cafe', 'tech', 'cleaning', 'security'];

    for (const dept of deptOrder) {
        if (!grouped[dept]) continue;
        const deptLabel = depts[dept] || dept;
        const icon = DEPT_ICONS[dept] || '';

        bodyHtml += `<tr class="dept-row"><td colspan="${dates.length + 1}"><span class="dept-icon">${icon}</span>${deptLabel} (${grouped[dept].length})</td></tr>`;

        for (const emp of grouped[dept]) {
            const initials = emp.name.split(' ').map(w => w[0]).join('').slice(0, 2);
            const hoursData = StaffState.hoursData?.[emp.id];
            const hoursLabel = hoursData ? `${hoursData.totalHours}г / ${hoursData.workingDays}д` : '';
            bodyHtml += `<tr>`;
            bodyHtml += `<td>
                <div class="emp-cell">
                    <div class="emp-avatar" style="background:${emp.color || '#94A3B8'}">${initials}</div>
                    <div class="emp-info">
                        <span class="emp-name">${emp.name}</span>
                        <span class="emp-position">${emp.position}</span>
                        <span class="emp-hours">${hoursLabel}</span>
                    </div>
                </div>
            </td>`;

            for (const d of dates) {
                const ds = formatDateStr(d);
                const isToday = ds === today;
                const entry = StaffState.schedule[`${emp.id}_${ds}`];
                const status = entry ? entry.status : 'working';
                const shiftStart = entry?.shift_start;
                const shiftEnd = entry?.shift_end;

                let cellContent = '';
                if (status === 'working' && shiftStart && shiftEnd) {
                    cellContent = `<span class="sch-time">${shiftStart.slice(0,5)}–${shiftEnd.slice(0,5)}</span>`;
                } else if (status === 'working') {
                    cellContent = `<span class="sch-label">${STATUS_LABELS[status]}</span>`;
                } else {
                    cellContent = `<span class="sch-label">${STATUS_LABELS[status] || status}</span>`;
                }

                if (entry?.note) {
                    cellContent += `<span class="sch-label" style="font-size:8px;margin-top:1px;opacity:0.7">${entry.note}</span>`;
                }

                bodyHtml += `<td>
                    <div class="sch-cell status-${status} ${isToday ? 'today-col' : ''}"
                         data-staff="${emp.id}" data-date="${ds}"
                         title="${emp.name} — ${ds}">
                        ${cellContent}
                    </div>
                </td>`;
            }
            bodyHtml += `</tr>`;
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
}

// ==========================================
// EDIT MODAL
// ==========================================

function openEditModal(staffId, date) {
    const emp = StaffState.staff.find(s => s.id === staffId);
    if (!emp) return;

    StaffState.editingCell = { staffId, date };
    const entry = StaffState.schedule[`${staffId}_${date}`];

    document.getElementById('schModalTitle').textContent = `${emp.name} — ${date}`;
    document.getElementById('schStatus').value = entry?.status || 'working';
    document.getElementById('schStart').value = entry?.shift_start || '09:00';
    document.getElementById('schEnd').value = entry?.shift_end || '18:00';
    document.getElementById('schNote').value = entry?.note || '';

    toggleTimeFields();
    document.getElementById('schModalOverlay').classList.add('visible');
}

function closeEditModal() {
    document.getElementById('schModalOverlay').classList.remove('visible');
    StaffState.editingCell = null;
}

function toggleTimeFields() {
    const status = document.getElementById('schStatus').value;
    document.getElementById('schTimeFields').style.display = status === 'working' ? '' : 'none';
}

async function handleSave() {
    const { staffId, date } = StaffState.editingCell;
    const status = document.getElementById('schStatus').value;
    const shiftStart = status === 'working' ? document.getElementById('schStart').value : null;
    const shiftEnd = status === 'working' ? document.getElementById('schEnd').value : null;
    const note = document.getElementById('schNote').value.trim() || null;

    const result = await saveScheduleEntry(staffId, date, shiftStart, shiftEnd, status, note);
    if (result.success) {
        StaffState.schedule[`${staffId}_${date}`] = result.data;
        renderSchedule();
        closeEditModal();
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
    await fetchSchedule(formatDateStr(dates[0]), formatDateStr(dates[6]));
    renderSchedule();
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
    goToWeek(getMonday(new Date()));
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
        select.innerHTML += `<option value="${emp.id}">${emp.name} — ${emp.position}</option>`;
    }

    document.getElementById('fillStatus').value = 'working';
    document.getElementById('fillStart').value = '09:00';
    document.getElementById('fillEnd').value = '18:00';
    document.getElementById('fillNote').value = '';
    toggleFillTimeFields();
    document.getElementById('fillWeekOverlay').classList.add('visible');
}

function closeFillWeekModal() {
    document.getElementById('fillWeekOverlay').classList.remove('visible');
}

function toggleFillTimeFields() {
    const status = document.getElementById('fillStatus').value;
    document.getElementById('fillTimeFields').style.display = status === 'working' ? '' : 'none';
}

async function handleFillWeekSave() {
    const staffValue = document.getElementById('fillStaffSelect').value;
    const status = document.getElementById('fillStatus').value;
    const shiftStart = status === 'working' ? document.getElementById('fillStart').value : null;
    const shiftEnd = status === 'working' ? document.getElementById('fillEnd').value : null;
    const note = document.getElementById('fillNote').value.trim() || null;

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
        closeFillWeekModal();
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

    const ok = confirm(`Скопіювати графік ${deptLabel} з тижня ${fromMonday} на тиждень ${toMonday}?\n\nІснуючі записи будуть перезаписані.`);
    if (!ok) return;

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
        // Fetch hours for current week
        const dates = getWeekDates(StaffState.weekStart);
        const from = formatDateStr(dates[0]);
        const to = formatDateStr(dates[6]);
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
        document.getElementById('scheduleBody').classList.add('show-hours');
    }
}

// ==========================================
// DARK MODE
// ==========================================

function loadDarkMode() {
    const saved = localStorage.getItem('pzp_dark_mode');
    if (saved === 'true') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}

// ==========================================
// INIT
// ==========================================

async function initPage() {
    loadDarkMode();

    const token = localStorage.getItem('pzp_token');
    if (!token) {
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    const user = await apiVerifyToken();
    if (!user) {
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    AppState.currentUser = user;
    document.getElementById('currentUser').textContent = user.name;

    const canManage = user.role === 'admin' || user.role === 'manager';
    const addBtn = document.getElementById('addStaffBtn');
    if (addBtn) addBtn.style.display = canManage ? '' : 'none';

    // Show admin-only buttons
    const copyBtn = document.getElementById('copyWeekBtn');
    const fillBtn = document.getElementById('fillWeekBtn');
    if (copyBtn) copyBtn.style.display = canManage ? '' : 'none';
    if (fillBtn) fillBtn.style.display = canManage ? '' : 'none';

    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('pzp_token');
        localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
        window.location = '/';
    });

    // Load data
    await fetchStaff();
    renderDeptFilter();

    // Init week
    StaffState.weekStart = getMonday(new Date());
    renderWeekLabel();

    const dates = getWeekDates(StaffState.weekStart);
    await fetchSchedule(formatDateStr(dates[0]), formatDateStr(dates[6]));
    renderSchedule();

    // Event listeners
    document.getElementById('prevWeekBtn').addEventListener('click', prevWeek);
    document.getElementById('nextWeekBtn').addEventListener('click', nextWeek);
    document.getElementById('todayWeekBtn').addEventListener('click', goToday);
    document.getElementById('schSaveBtn').addEventListener('click', handleSave);
    document.getElementById('schCancelBtn').addEventListener('click', closeEditModal);
    document.getElementById('schStatus').addEventListener('change', toggleTimeFields);

    document.getElementById('schModalOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeEditModal();
    });

    // Fill week modal
    document.getElementById('fillWeekBtn').addEventListener('click', openFillWeekModal);
    document.getElementById('fillSaveBtn').addEventListener('click', handleFillWeekSave);
    document.getElementById('fillCancelBtn').addEventListener('click', closeFillWeekModal);
    document.getElementById('fillStatus').addEventListener('change', toggleFillTimeFields);
    document.getElementById('fillWeekOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeFillWeekModal();
    });

    // Copy week
    document.getElementById('copyWeekBtn').addEventListener('click', handleCopyWeek);

    // Hours toggle
    document.getElementById('toggleHoursBtn').addEventListener('click', toggleHours);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeEditModal();
            closeFillWeekModal();
        }
    });
}

document.addEventListener('DOMContentLoaded', initPage);
