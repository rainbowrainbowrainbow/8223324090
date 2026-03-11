/**
 * hr-page.js — HR module frontend (v15.0)
 *
 * 4 tabs: Today (clock-in/out), Schedule (shifts), Team (profiles), Reports
 * API: /api/hr/*
 */

// ==========================================
// CONSTANTS
// ==========================================

const ROLE_LABELS = {
    animator: 'Аніматор', host: 'Ведуча', technician: 'Технік',
    admin: 'Адмін', cleaner: 'Прибиральник', manager: 'Менеджер', intern: 'Стажер'
};

const STATUS_LABELS = {
    present: 'На роботі', late: 'Запізнився', absent: 'Відсутній',
    clocked_in: 'На роботі', early_leave: 'Пішов раніше', no_show: 'Не з\'явився',
    sick: 'Лікарняний', vacation: 'Відпустка', day_off: 'Вихідний',
    auto_closed: 'Авто-закрито', unscheduled: 'Без розкладу'
};

const DAYS_UK = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS_UK = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
    'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
const MONTHS_SHORT = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];

// ==========================================
// STATE
// ==========================================

let canManage = false;
let todayData = null;
let scheduleWeekStart = null;
let scheduleView = 'week'; // week | month
let scheduleShifts = [];
let scheduleStaff = [];
let shiftTemplates = [];
let editingShift = null; // { staffId, date, existing? }
let contextStaffId = null;
let pollTimer = null;

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

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date;
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

function getMonthDates(year, month) {
    const dates = [];
    const d = new Date(year, month, 1);
    while (d.getMonth() === month) {
        dates.push(new Date(d));
        d.setDate(d.getDate() + 1);
    }
    return dates;
}

function todayStr() { return formatDate(new Date()); }

function fmtTime(t) {
    if (!t) return '';
    return String(t).substring(0, 5);
}

function fmtTimeFromISO(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
}

function fmtMinutes(min) {
    if (!min || min <= 0) return '';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${m}хв`;
    return m > 0 ? `${h}г ${m}хв` : `${h}г`;
}

function fmtMoney(n) {
    return new Intl.NumberFormat('uk-UA').format(n) + ' ₴';
}

async function hrFetch(path, options = {}) {
    const token = localStorage.getItem('pzp_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(`/api/hr${path}`, { headers, ...options });
    if (resp.status === 401 || resp.status === 403) {
        localStorage.removeItem('pzp_token');
        location.href = '/';
        return null;
    }
    return resp.json();
}

// ==========================================
// PAGE INIT
// ==========================================

async function initPage() {
    initDarkMode();
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
    const MANAGE_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager'];
    canManage = MANAGE_ROLES.includes(user.role);

    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('pzp_token');
        localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
        location.href = '/';
    });

    initTabs();
    initScheduleControls();
    initModals();
    initContextMenu();
    await loadToday();
    startPolling();
}

// ==========================================
// TABS
// ==========================================

function initTabs() {
    document.querySelectorAll('.hr-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.hr-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.hr-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            document.getElementById(`tab-${target}`).classList.add('active');

            if (target === 'today') loadToday();
            if (target === 'schedule') loadSchedule();
            if (target === 'team') loadTeam();
            if (target === 'reports') loadReports();
            if (target === 'ai-team') renderAITeam();
        });
    });
}

// ==========================================
// TAB 1: TODAY
// ==========================================

async function loadToday() {
    const data = await hrFetch('/today');
    if (!data || !data.success) return;
    todayData = data;
    renderToday(data);
}

function renderToday(data) {
    const today = new Date();
    const dayName = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', 'П\'ятниця', 'Субота'][today.getDay()];
    document.getElementById('todayDate').textContent =
        `${dayName}, ${today.getDate()} ${MONTHS_UK[today.getMonth()]} ${today.getFullYear()}`;

    const s = data.summary;
    document.getElementById('todaySummary').innerHTML = `
        <div class="hr-summary-card green"><div class="value">${s.present}</div><div class="label">На роботі</div></div>
        <div class="hr-summary-card yellow"><div class="value">${s.late}</div><div class="label">Запізнились</div></div>
        <div class="hr-summary-card red"><div class="value">${s.absent}</div><div class="label">Відсутні</div></div>
        <div class="hr-summary-card"><div class="value">${s.sick + s.on_vacation}</div><div class="label">Хвороба / відпустка</div></div>
    `;

    const list = document.getElementById('todayList');
    if (data.data.length === 0) {
        list.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:40px;">Немає активних співробітників</div>';
        return;
    }

    list.innerHTML = data.data.map(item => {
        const rec = item.record;
        const shift = item.shift;
        let indicator = 'absent';
        let btnClass = 'clock-in';
        let btnText = 'Відмітити прихід';
        let meta = '';
        let disabled = '';

        if (shift) {
            meta = `Зміна: ${fmtTime(shift.planned_start)}–${fmtTime(shift.planned_end)}`;
        }

        if (rec) {
            const st = rec.status;
            if (st === 'present' || st === 'clocked_in' || st === 'unscheduled') {
                indicator = 'present';
                if (rec.clock_out) {
                    indicator = 'done';
                    btnClass = 'done';
                    btnText = `Відпрацював ${fmtMinutes(rec.total_worked_minutes)}`;
                    disabled = 'disabled';
                    meta += ` | Пішов: ${fmtTimeFromISO(rec.clock_out)}`;
                } else {
                    btnClass = 'clock-out';
                    btnText = `На роботі (з ${fmtTimeFromISO(rec.clock_in)})`;
                    meta += ` | Прийшов: ${fmtTimeFromISO(rec.clock_in)}`;
                }
            } else if (st === 'late') {
                indicator = 'late';
                if (rec.clock_out) {
                    indicator = 'done';
                    btnClass = 'done';
                    btnText = `Відпрацював ${fmtMinutes(rec.total_worked_minutes)}`;
                    disabled = 'disabled';
                } else {
                    btnClass = 'clock-out late';
                    btnText = `На роботі (з ${fmtTimeFromISO(rec.clock_in)})`;
                }
                meta += ` | <span class="late-badge">+${rec.late_minutes}хв</span>`;
            } else if (st === 'early_leave') {
                indicator = 'done';
                btnClass = 'done';
                btnText = `Відпрацював ${fmtMinutes(rec.total_worked_minutes)}`;
                disabled = 'disabled';
            } else if (st === 'auto_closed') {
                indicator = 'auto_closed';
                btnClass = 'done';
                btnText = `Авто-закрито (${fmtMinutes(rec.total_worked_minutes)})`;
                disabled = 'disabled';
            } else if (st === 'sick') {
                indicator = 'sick';
                btnClass = 'special';
                btnText = '🏥 Лікарняний';
                disabled = 'disabled';
            } else if (st === 'vacation') {
                indicator = 'vacation';
                btnClass = 'special';
                btnText = '🌴 Відпустка';
                disabled = 'disabled';
            } else if (st === 'day_off') {
                indicator = 'day_off';
                btnClass = 'special';
                btnText = '📴 Вихідний';
                disabled = 'disabled';
            } else if (st === 'no_show') {
                indicator = 'no_show';
                btnClass = 'clock-in';
                btnText = 'Не з\'явився — відмітити';
            }
        }

        const roleLabel = ROLE_LABELS[item.role_type] || item.role_type || '';

        return `<div class="hr-staff-row" data-staff-id="${item.staff_id}" oncontextmenu="showContext(event, ${item.staff_id})">
            <div class="hr-staff-indicator ${indicator}"></div>
            <div class="hr-staff-info">
                <div class="hr-staff-name">${escapeHtml(item.staff_name)}</div>
                <div class="hr-staff-meta">${roleLabel}${meta ? ' · ' + meta : ''}</div>
            </div>
            <button class="hr-clock-btn ${btnClass}" ${disabled}
                onclick="handleClock(${item.staff_id}, '${rec && rec.clock_in && !rec.clock_out ? 'out' : 'in'}', '${escapeHtml(item.staff_name)}', ${rec ? rec.total_worked_minutes || 0 : 0})"
            >${btnText}</button>
        </div>`;
    }).join('');
}

async function handleClock(staffId, action, name, workedMin) {
    if (action === 'out') {
        const worked = fmtMinutes(workedMin) || 'невідомо';
        if (!await confirmModal(`Завершити зміну для ${name}?\nВідпрацьовано: ${worked}`, { type: 'warning', okText: 'Завершити' })) return;
    }
    const endpoint = action === 'out' ? '/clock-out' : '/clock-in';
    const data = await hrFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ staff_id: staffId })
    });
    if (!data) return;
    if (!data.success) {
        showNotification(data.error || 'Помилка', 'error');
        return;
    }
    showNotification(action === 'out' ? 'Зміну завершено' : 'Прихід відмічено', 'success');
    await loadToday();
}

function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
        const activeTab = document.querySelector('.hr-tab.active');
        if (activeTab && activeTab.dataset.tab === 'today') loadToday();
    }, 30000);
}

// ==========================================
// CONTEXT MENU
// ==========================================

function initContextMenu() {
    document.addEventListener('click', () => {
        document.getElementById('contextMenu').classList.remove('visible');
    });

    document.querySelectorAll('.hr-context-item').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            if (action === 'correct') {
                openCorrectionModal(contextStaffId);
            } else {
                const data = await hrFetch('/mark-absent', {
                    method: 'POST',
                    body: JSON.stringify({ staff_id: contextStaffId, status: action })
                });
                if (data && data.success) {
                    showNotification('Статус оновлено', 'success');
                    await loadToday();
                } else {
                    showNotification(data?.error || 'Помилка', 'error');
                }
            }
        });
    });
}

function showContext(e, staffId) {
    e.preventDefault();
    contextStaffId = staffId;
    const menu = document.getElementById('contextMenu');
    menu.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - 200)}px`;
    menu.classList.add('visible');
}

function openCorrectionModal(staffId) {
    if (!todayData) return;
    const item = todayData.data.find(d => d.staff_id === staffId);
    if (!item || !item.record || !item.record.id) {
        showNotification('Немає запису для корекції', 'error');
        return;
    }
    document.getElementById('corrRecordId').value = item.record.id;
    document.getElementById('corrClockIn').value = item.record.clock_in ? fmtTimeFromISO(item.record.clock_in) : '';
    document.getElementById('corrClockOut').value = item.record.clock_out ? fmtTimeFromISO(item.record.clock_out) : '';
    document.getElementById('corrNotes').value = '';
    document.getElementById('correctionModal').style.display = 'flex';
}

// ==========================================
// TAB 2: SCHEDULE
// ==========================================

function initScheduleControls() {
    scheduleWeekStart = getMonday(new Date());

    document.getElementById('schedPrev').addEventListener('click', () => {
        if (scheduleView === 'week') {
            scheduleWeekStart.setDate(scheduleWeekStart.getDate() - 7);
        } else {
            scheduleWeekStart.setMonth(scheduleWeekStart.getMonth() - 1);
            scheduleWeekStart.setDate(1);
        }
        loadSchedule();
    });

    document.getElementById('schedNext').addEventListener('click', () => {
        if (scheduleView === 'week') {
            scheduleWeekStart.setDate(scheduleWeekStart.getDate() + 7);
        } else {
            scheduleWeekStart.setMonth(scheduleWeekStart.getMonth() + 1);
            scheduleWeekStart.setDate(1);
        }
        loadSchedule();
    });

    document.getElementById('schedToday').addEventListener('click', () => {
        scheduleWeekStart = getMonday(new Date());
        loadSchedule();
    });

    document.getElementById('schedCopy').addEventListener('click', copyWeek);

    document.querySelectorAll('.hr-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.hr-view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            scheduleView = btn.dataset.view;
            if (scheduleView === 'month') {
                scheduleWeekStart = new Date(scheduleWeekStart.getFullYear(), scheduleWeekStart.getMonth(), 1);
            } else {
                scheduleWeekStart = getMonday(scheduleWeekStart);
            }
            loadSchedule();
        });
    });
}

async function loadSchedule() {
    // Load staff and templates
    const [staffData, tplData] = await Promise.all([
        hrFetch('/staff?active=true'),
        hrFetch('/shift-templates')
    ]);
    if (staffData && staffData.success) scheduleStaff = staffData.data;
    if (tplData && tplData.success) {
        shiftTemplates = tplData.data;
        renderTemplateSelect();
    }

    let dates;
    if (scheduleView === 'week') {
        dates = getWeekDates(scheduleWeekStart);
    } else {
        dates = getMonthDates(scheduleWeekStart.getFullYear(), scheduleWeekStart.getMonth());
    }

    const from = formatDate(dates[0]);
    const to = formatDate(dates[dates.length - 1]);

    const shiftsData = await hrFetch(`/shifts?from=${from}&to=${to}`);
    if (shiftsData && shiftsData.success) scheduleShifts = shiftsData.data;

    renderSchedule(dates);
}

function renderTemplateSelect() {
    const sel = document.getElementById('templateSelect');
    sel.innerHTML = shiftTemplates.map(t =>
        `<option value="${t.id}">${escapeHtml(t.name)} (${fmtTime(t.planned_start)}–${fmtTime(t.planned_end)})</option>`
    ).join('');
}

function renderSchedule(dates) {
    const today = todayStr();

    // Update label
    if (scheduleView === 'week') {
        const sun = dates[6];
        document.getElementById('schedLabel').textContent =
            `Тиждень ${dates[0].getDate()}–${sun.getDate()} ${MONTHS_UK[sun.getMonth()]} ${sun.getFullYear()}`;
    } else {
        document.getElementById('schedLabel').textContent =
            `${MONTHS_SHORT[scheduleWeekStart.getMonth()]} ${scheduleWeekStart.getFullYear()}`;
    }

    // Build shift lookup: staffId_date → shift
    const shiftMap = {};
    for (const s of scheduleShifts) {
        const d = typeof s.shift_date === 'string' ? s.shift_date.substring(0, 10) : s.shift_date;
        shiftMap[`${s.staff_id}_${d}`] = s;
    }

    // Header
    const head = document.getElementById('schedHead');
    let headHtml = '<tr><th>Ім\'я</th>';
    for (const d of dates) {
        const ds = formatDate(d);
        const isToday = ds === today;
        const label = scheduleView === 'week'
            ? `${DAYS_UK[d.getDay()]} ${d.getDate()}`
            : `${d.getDate()}`;
        headHtml += `<th class="${isToday ? 'today' : ''}">${label}</th>`;
    }
    headHtml += '</tr>';
    head.innerHTML = headHtml;

    // Body
    const body = document.getElementById('schedBody');
    body.innerHTML = scheduleStaff.map(staff => {
        let row = `<tr><td>${escapeHtml(staff.name)}</td>`;
        for (const d of dates) {
            const ds = formatDate(d);
            const isToday = ds === today;
            const isPast = ds < today;
            const shift = shiftMap[`${staff.id}_${ds}`];
            let cellContent;
            if (shift) {
                const cls = isPast ? 'past ' + (shift.shift_type || 'regular') : (shift.shift_type || 'regular');
                cellContent = `<span class="hr-shift-cell ${cls}">${fmtTime(shift.planned_start)}–${fmtTime(shift.planned_end)}</span>`;
            } else {
                cellContent = '<span class="hr-shift-cell empty">—</span>';
            }
            row += `<td class="${isToday ? 'today' : ''}" onclick="openShiftModal(${staff.id}, '${ds}')">${cellContent}</td>`;
        }
        row += '</tr>';
        return row;
    }).join('');
}

function openShiftModal(staffId, date) {
    if (!canManage) return;
    const shiftMap = {};
    for (const s of scheduleShifts) {
        const d = typeof s.shift_date === 'string' ? s.shift_date.substring(0, 10) : s.shift_date;
        shiftMap[`${s.staff_id}_${d}`] = s;
    }
    const existing = shiftMap[`${staffId}_${date}`];
    editingShift = { staffId, date, existing };

    const staff = scheduleStaff.find(s => s.id === staffId);
    document.getElementById('shiftModalTitle').textContent = existing
        ? `Редагувати зміну — ${staff?.name || ''}`
        : `Додати зміну — ${staff?.name || ''}`;

    if (existing) {
        document.getElementById('shiftStart').value = fmtTime(existing.planned_start);
        document.getElementById('shiftEnd').value = fmtTime(existing.planned_end);
        document.getElementById('shiftType').value = existing.shift_type || 'regular';
        document.getElementById('shiftBreak').value = existing.break_minutes || 30;
        document.getElementById('shiftNotes').value = existing.notes || '';
        document.getElementById('shiftDelete').style.display = '';
    } else {
        // Use selected template
        const tplId = document.getElementById('templateSelect').value;
        const tpl = shiftTemplates.find(t => t.id === parseInt(tplId));
        document.getElementById('shiftStart').value = tpl ? fmtTime(tpl.planned_start) : '12:00';
        document.getElementById('shiftEnd').value = tpl ? fmtTime(tpl.planned_end) : '20:00';
        document.getElementById('shiftType').value = tpl ? tpl.shift_type : 'regular';
        document.getElementById('shiftBreak').value = tpl ? tpl.break_minutes : 30;
        document.getElementById('shiftNotes').value = '';
        document.getElementById('shiftDelete').style.display = 'none';
    }

    document.getElementById('shiftModal').style.display = 'flex';
}

async function saveShift() {
    if (!editingShift) return;
    const body = {
        staff_id: editingShift.staffId,
        shift_date: editingShift.date,
        planned_start: document.getElementById('shiftStart').value,
        planned_end: document.getElementById('shiftEnd').value,
        shift_type: document.getElementById('shiftType').value,
        break_minutes: parseInt(document.getElementById('shiftBreak').value) || 0,
        notes: document.getElementById('shiftNotes').value
    };

    if (!body.planned_start || !body.planned_end) {
        showNotification('Вкажіть час початку і кінця', 'error');
        return;
    }

    let data;
    if (editingShift.existing) {
        data = await hrFetch(`/shifts/${editingShift.existing.id}`, {
            method: 'PUT',
            body: JSON.stringify(body)
        });
    } else {
        data = await hrFetch('/shifts', {
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    if (data && data.success) {
        showNotification('Зміну збережено', 'success');
        document.getElementById('shiftModal').style.display = 'none';
        await loadSchedule();
    } else {
        showNotification(data?.error || 'Помилка', 'error');
    }
}

async function deleteShift() {
    if (!editingShift || !editingShift.existing) return;
    if (!await confirmModal('Видалити зміну?', { type: 'danger', okText: 'Видалити' })) return;
    const data = await hrFetch(`/shifts/${editingShift.existing.id}`, { method: 'DELETE' });
    if (data && data.success) {
        showNotification('Зміну видалено', 'success');
        document.getElementById('shiftModal').style.display = 'none';
        await loadSchedule();
    } else {
        showNotification(data?.error || 'Помилка', 'error');
    }
}

async function copyWeek() {
    if (!canManage) return;
    const sourceWeek = formatDate(scheduleWeekStart);
    const nextWeek = new Date(scheduleWeekStart);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const targetWeek = formatDate(nextWeek);

    if (!await confirmModal(`Копіювати розклад тижня ${sourceWeek} → ${targetWeek}?`, { type: 'warning', okText: 'Копіювати' })) return;

    const data = await hrFetch('/shifts/copy-week', {
        method: 'POST',
        body: JSON.stringify({ source_week: sourceWeek, target_week: targetWeek })
    });
    if (data && data.success) {
        showNotification(`Скопійовано ${data.count} змін`, 'success');
        scheduleWeekStart = nextWeek;
        await loadSchedule();
    } else {
        showNotification(data?.error || 'Помилка', 'error');
    }
}

// ==========================================
// TAB 3: TEAM
// ==========================================

let teamStaff = [];

async function loadTeam() {
    const activeOnly = document.getElementById('teamActiveOnly').checked;
    const data = await hrFetch(`/staff?active=${activeOnly}`);
    if (data && data.success) {
        teamStaff = data.data;
        filterAndRenderTeam();
    }

    // Attach filter listeners (idempotent — ok to re-attach)
    document.getElementById('teamSearch').oninput = filterAndRenderTeam;
    document.getElementById('teamRoleFilter').onchange = filterAndRenderTeam;
    document.getElementById('teamActiveOnly').onchange = loadTeam;
}

function filterAndRenderTeam() {
    const query = document.getElementById('teamSearch').value.toLowerCase();
    const role = document.getElementById('teamRoleFilter').value;

    let filtered = teamStaff;
    if (query) {
        filtered = filtered.filter(s =>
            s.name.toLowerCase().includes(query) ||
            (s.phone && s.phone.includes(query))
        );
    }
    if (role) {
        filtered = filtered.filter(s => s.role_type === role);
    }

    renderTeam(filtered);
}

function renderTeam(staff) {
    const grid = document.getElementById('teamGrid');
    if (staff.length === 0) {
        grid.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:40px;">Нікого не знайдено</div>';
        return;
    }

    grid.innerHTML = staff.map(s => {
        const initials = s.name.split(' ').map(w => w[0]).join('').substring(0, 2);
        const avatar = s.photo_url
            ? `<img src="${escapeHtml(s.photo_url)}" alt="${escapeHtml(s.name)}">`
            : initials;
        const roleLabel = ROLE_LABELS[s.role_type] || s.role_type || '';
        const hireStr = s.hire_date ? new Date(s.hire_date).toLocaleDateString('uk-UA') : '';
        const phone = s.phone || '';
        const emergency = s.emergency_contact
            ? `Екстр: ${escapeHtml(s.emergency_contact)}${s.emergency_phone ? ', ' + escapeHtml(s.emergency_phone) : ''}`
            : '';

        return `<div class="hr-team-card ${s.is_active ? '' : 'inactive'}">
            <div class="hr-team-avatar" style="${s.color ? 'background:' + s.color + '30;color:' + s.color : ''}">${avatar}</div>
            <div class="hr-team-details">
                <div class="hr-team-name">${escapeHtml(s.name)} ${s.is_active ? '' : '<span style="color:var(--gray-400);">(звільнений)</span>'}</div>
                <div class="hr-team-role">${roleLabel}${hireStr ? ' · з ' + hireStr : ''}</div>
                <div class="hr-team-contact">
                    ${phone ? '📞 ' + escapeHtml(phone) + '<br>' : ''}
                    ${emergency ? '⚡ ' + emergency : ''}
                </div>
                ${s.hourly_rate > 0 ? `<div class="hr-team-stats">Ставка: ${s.hourly_rate} ₴/год</div>` : ''}
                ${canManage ? `<button class="hr-team-edit" onclick="openStaffEdit(${s.id})">Редагувати</button>` : ''}
            </div>
        </div>`;
    }).join('');
}

function openStaffEdit(staffId) {
    const s = teamStaff.find(st => st.id === staffId);
    if (!s) return;

    document.getElementById('editStaffId').value = staffId;
    document.getElementById('editRoleType').value = s.role_type || 'animator';
    document.getElementById('editPhone').value = s.phone || '';
    document.getElementById('editBirthDate').value = s.birth_date ? s.birth_date.substring(0, 10) : '';
    document.getElementById('editEmergencyContact').value = s.emergency_contact || '';
    document.getElementById('editEmergencyPhone').value = s.emergency_phone || '';
    document.getElementById('editHourlyRate').value = s.hourly_rate || 0;
    document.getElementById('editTelegramId').value = s.telegram_id || '';
    document.getElementById('editTelegramUsername').value = s.telegram_username || '';
    document.getElementById('editContractType').value = s.contract_type || 'parttime';
    document.getElementById('editSkills').value = (s.skills || []).join(', ');
    document.getElementById('editNotes').value = s.notes || '';

    document.getElementById('staffEditModal').style.display = 'flex';
}

async function saveStaffEdit() {
    const staffId = document.getElementById('editStaffId').value;
    const body = {
        role_type: document.getElementById('editRoleType').value,
        phone: document.getElementById('editPhone').value || null,
        birth_date: document.getElementById('editBirthDate').value || null,
        emergency_contact: document.getElementById('editEmergencyContact').value || null,
        emergency_phone: document.getElementById('editEmergencyPhone').value || null,
        hourly_rate: parseFloat(document.getElementById('editHourlyRate').value) || 0,
        telegram_id: document.getElementById('editTelegramId').value || null,
        telegram_username: document.getElementById('editTelegramUsername').value || null,
        contract_type: document.getElementById('editContractType').value || 'parttime',
        skills: document.getElementById('editSkills').value ? document.getElementById('editSkills').value.split(',').map(s => s.trim()).filter(Boolean) : null,
        notes: document.getElementById('editNotes').value || null
    };

    const data = await hrFetch(`/staff/${staffId}`, {
        method: 'PUT',
        body: JSON.stringify(body)
    });
    if (data && data.success) {
        showNotification('Профіль оновлено', 'success');
        document.getElementById('staffEditModal').style.display = 'none';
        await loadTeam();
    } else {
        showNotification(data?.error || 'Помилка', 'error');
    }
}

// ==========================================
// TAB 4: REPORTS
// ==========================================

async function loadReports() {
    // Fill month selector
    const sel = document.getElementById('reportMonth');
    if (sel.options.length === 0) {
        const now = new Date();
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
            sel.innerHTML += `<option value="${val}">${label}</option>`;
        }
        sel.addEventListener('change', loadReports);
        document.getElementById('reportExport').addEventListener('click', exportCSV);
    }

    const month = sel.value;
    const data = await hrFetch(`/report/monthly?month=${month}`);
    if (!data || !data.success) return;

    renderReports(data);
}

function renderReports(data) {
    // Summary
    const rows = data.data;
    let totalPresent = 0, totalLate = 0, totalAbsent = 0, totalOvertime = 0;
    for (const r of rows) {
        totalPresent += r.days_worked;
        totalLate += r.late_count;
        totalAbsent += r.days_absent;
        totalOvertime += r.total_overtime_hours;
    }
    const totalScheduled = rows.reduce((a, r) => a + r.days_scheduled, 0);
    const attendanceRate = totalScheduled > 0 ? Math.round(totalPresent / totalScheduled * 100) : 0;

    document.getElementById('reportSummary').innerHTML = `
        <div class="hr-report-stat"><div class="stat-value">${attendanceRate}%</div><div class="stat-label">Присутність</div></div>
        <div class="hr-report-stat"><div class="stat-value">${totalLate}</div><div class="stat-label">Запізнень</div></div>
        <div class="hr-report-stat"><div class="stat-value">${totalAbsent}</div><div class="stat-label">Відсутностей</div></div>
        <div class="hr-report-stat"><div class="stat-value">${totalOvertime.toFixed(0)}г</div><div class="stat-label">Переробка</div></div>
    `;

    // Table
    document.getElementById('reportHead').innerHTML = `<tr>
        <th>ПІБ</th><th>Зміни</th><th>Відпрац.</th><th>Запізн.</th>
        <th>Сер. запізн.</th><th>Годин</th><th>Сума</th></tr>`;

    document.getElementById('reportBody').innerHTML = rows.map(r => `<tr>
        <td>${escapeHtml(r.staff_name)}</td>
        <td class="num">${r.days_scheduled}</td>
        <td class="num">${r.days_worked}</td>
        <td class="num">${r.late_count}</td>
        <td class="num">${r.avg_late_minutes > 0 ? r.avg_late_minutes + 'хв' : '—'}</td>
        <td class="num">${r.total_worked_hours}г</td>
        <td class="num">${fmtMoney(r.estimated_salary)}</td>
    </tr>`).join('');
}

async function exportCSV() {
    const month = document.getElementById('reportMonth').value;
    const from = `${month}-01`;
    const d = new Date(from);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    const to = formatDate(d);

    const token = localStorage.getItem('pzp_token');
    const resp = await fetch(`/api/hr/report/export?from=${from}&to=${to}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) {
        showNotification('Помилка експорту', 'error');
        return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hr_report_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ==========================================
// MODALS
// ==========================================

function initModals() {
    // Shift modal
    document.getElementById('shiftSave').addEventListener('click', saveShift);
    document.getElementById('shiftDelete').addEventListener('click', deleteShift);
    document.getElementById('shiftCancel').addEventListener('click', () => {
        document.getElementById('shiftModal').style.display = 'none';
    });

    // Staff edit modal
    document.getElementById('editSave').addEventListener('click', saveStaffEdit);
    document.getElementById('editCancel').addEventListener('click', () => {
        document.getElementById('staffEditModal').style.display = 'none';
    });

    // Correction modal
    document.getElementById('corrSave').addEventListener('click', saveCorrection);
    document.getElementById('corrCancel').addEventListener('click', () => {
        document.getElementById('correctionModal').style.display = 'none';
    });

    // Close modals on overlay click
    ['shiftModal', 'staffEditModal', 'correctionModal'].forEach(id => {
        document.getElementById(id).addEventListener('click', (e) => {
            if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
        });
    });
}

async function saveCorrection() {
    const recordId = document.getElementById('corrRecordId').value;
    const clockIn = document.getElementById('corrClockIn').value;
    const clockOut = document.getElementById('corrClockOut').value;
    const notes = document.getElementById('corrNotes').value;

    if (!clockIn && !clockOut) {
        showNotification('Вкажіть час', 'error');
        return;
    }

    const today = todayStr();
    const body = { notes };
    if (clockIn) body.clock_in = `${today}T${clockIn}:00+02:00`;
    if (clockOut) body.clock_out = `${today}T${clockOut}:00+02:00`;

    const data = await hrFetch(`/records/${recordId}/correct`, {
        method: 'PUT',
        body: JSON.stringify(body)
    });
    if (data && data.success) {
        showNotification('Час виправлено', 'success');
        document.getElementById('correctionModal').style.display = 'none';
        await loadToday();
    } else {
        showNotification(data?.error || 'Помилка', 'error');
    }
}

// ==========================================
// TAB 5: AI TEAM (Electronic Workers)
// ==========================================

const AI_WORKERS = [
    {
        id: 'leo',
        name: 'Лєо',
        avatar: '🦁',
        role: 'Взаємодія з підрядниками',
        department: 'Зовнішні комунікації',
        status: 'active',
        statusLabel: 'Готовий до роботи',
        description: 'Відповідає за комунікацію з постачальниками, підрядниками та партнерами. ' +
            'Формує запити, відстежує статуси замовлень, нагадує про дедлайни та веде архів контрактів.',
        capabilities: [
            'Автоматичні запити постачальникам',
            'Відстеження статусів замовлень',
            'Нагадування про дедлайни контрактів',
            'Архів комунікацій з партнерами'
        ],
        integration: 'Telegram-бот @LeoParkBot. Автоматично отримує задачі на друк піньят, рейтинги контракторів та ескалації.'
    },
    {
        id: 'svitlana',
        name: 'Світлана',
        avatar: '📋',
        role: 'Ранкові задачі аніматорів',
        department: 'Операційний контроль',
        status: 'active',
        statusLabel: 'Готова до роботи',
        description: 'Щоранку надсилає список задач аніматорам в групу. ' +
            'Відстежує виконання через inline-кнопки, ввечері звітує директору про невиконані задачі.',
        capabilities: [
            'Ранкова розсилка задач по графіку змін',
            'Inline-кнопки "✅ Виконав" → автооновлення CRM',
            'Вечірній звіт: виконано/невиконано',
            'Ескалація невиконаних задач директору',
            'Ручне додавання задач: /add_task'
        ],
        integration: 'Telegram-бот @SvitlanaParkBot. Група "Аніматорська". Синхронізація з CRM /api/svitlana.'
    },
    {
        id: 'taras',
        name: 'Тарас',
        avatar: '📊',
        role: 'Звіти та аналітика',
        department: 'Аналітичний відділ',
        status: 'planned',
        statusLabel: 'В розробці',
        description: 'Приймає звіти від працівників, обробляє та структурує дані, ' +
            'публікує результати на сайті. Автоматично генерує зведені звіти за період.',
        capabilities: [
            'Прийом та валідація звітів',
            'Автоматична обробка даних',
            'Генерація зведених звітів',
            'Публікація результатів на сайт'
        ],
        integration: 'Буде інтегрований з модулями Фінанси, Аналітика та HR-звітами.'
    },
    {
        id: 'sklad',
        name: 'Склад',
        avatar: '🏪',
        role: 'Складський облік та Vision-аналіз',
        department: 'Матеріально-технічне забезпечення',
        status: 'active',
        statusLabel: 'Готовий до роботи',
        description: 'Веде облік матеріалів та реквізиту. Розпізнає товари на фото через Gemini Vision AI, ' +
            'приймає прибуткові накладні, фіксує витрати та залишки. Сповіщає про критично низькі запаси.',
        capabilities: [
            'Vision-розпізнавання товарів через Gemini AI',
            'Прийом та облік прибуткових накладних',
            'Фіксація витрат матеріалів по заходах',
            'Алерти про критично низькі залишки',
            'Журнал складських операцій'
        ],
        integration: 'Telegram-бот на warehouse-bot-production-932b.up.railway.app. Gemini 2.5-flash Vision + GPT-4o-mini fallback.'
    }
];

// AI worker task journal (in-memory, per session)
const aiJournal = { leo: [], svitlana: [], taras: [], sklad: [] };

function renderAITeam() {
    const list = document.getElementById('aiTeamList');
    if (!list) return;

    list.innerHTML = AI_WORKERS.map(w => {
        const badgeCls = w.status === 'active' ? 'active' : 'planned';
        const statusIcon = w.status === 'active' ? '●' : '◐';
        const capsList = w.capabilities.map(c => `<li>${escapeHtml(c)}</li>`).join('');
        const isLeo = w.id === 'leo';
        const journal = aiJournal[w.id] || [];
        const journalHTML = journal.length > 0
            ? journal.map(j => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-100);">
                <span>${escapeHtml(j.task)}</span>
                <span style="color:var(--gray-400);font-size:11px;white-space:nowrap;margin-left:12px;">${j.time}</span>
              </div>`).join('')
            : `<div class="ai-journal-empty">Ще немає записів</div>`;

        return `
        <div class="ai-worker" id="ai-worker-${w.id}">
            <div class="ai-worker-header">
                <div class="ai-worker-avatar">${w.avatar}</div>
                <div class="ai-worker-info">
                    <div class="ai-worker-name">${escapeHtml(w.name)}</div>
                    <div class="ai-worker-dept">${escapeHtml(w.department)}</div>
                </div>
                <div class="ai-worker-badge ${badgeCls}">${statusIcon} ${escapeHtml(w.statusLabel)}</div>
            </div>

            <div class="ai-worker-role">${escapeHtml(w.role)}</div>
            <div class="ai-worker-desc">${escapeHtml(w.description)}</div>

            <div class="ai-worker-actions">
                <button class="ai-worker-toggle" onclick="toggleAIPanel('${w.id}','caps')">
                    Можливості
                </button>
                <button class="ai-worker-toggle" onclick="toggleAIPanel('${w.id}','integration')">
                    Інтеграція
                </button>
                <button class="ai-worker-toggle" onclick="toggleAIPanel('${w.id}','journal')">
                    Журнал
                </button>
                ${isLeo ? `<button class="ai-worker-toggle" onclick="toggleAIPanel('leo','leaderboard'); loadLeaderboard()">
                    🏆 Рейтинг
                </button>` : ''}
                <button class="ai-worker-send-btn" onclick="toggleAIPanel('${w.id}','send')">
                    Відправити на завдання
                </button>
            </div>

            <div class="ai-worker-panel" id="ai-panel-${w.id}-caps">
                <h5>Можливості</h5>
                <ul>${capsList}</ul>
            </div>

            <div class="ai-worker-panel" id="ai-panel-${w.id}-integration">
                <h5>Інтеграція</h5>
                <p style="margin:0;">${escapeHtml(w.integration)}</p>
            </div>

            <div class="ai-worker-panel" id="ai-panel-${w.id}-journal">
                <h5>Журнал виконання</h5>
                <div id="ai-journal-${w.id}">${journalHTML}</div>
            </div>

            <div class="ai-worker-panel" id="ai-panel-${w.id}-send">
                <h5>Відправити на завдання</h5>
                <div class="ai-task-form">
                    <input type="text" id="ai-task-input-${w.id}" placeholder="Опишіть завдання..." maxlength="200">
                    <button onclick="sendAITask('${w.id}')">Відправити</button>
                </div>
            </div>

            ${isLeo ? `
            <div class="ai-worker-panel" id="ai-panel-leo-leaderboard">
                <h5>🏆 Рейтинг підрядників</h5>
                <div id="leo-leaderboard-content">
                    <div style="color:var(--gray-400);font-size:13px;padding:8px 0;">Завантаження...</div>
                </div>
            </div>` : ''}
        </div>`;
    }).join('');
}

function toggleAIPanel(workerId, panel) {
    const panelEl = document.getElementById(`ai-panel-${workerId}-${panel}`);
    if (!panelEl) return;
    const isOpen = panelEl.classList.contains('open');

    // Close all panels for this worker
    document.querySelectorAll(`#ai-worker-${workerId} .ai-worker-panel`).forEach(p => p.classList.remove('open'));
    document.querySelectorAll(`#ai-worker-${workerId} .ai-worker-toggle`).forEach(b => b.classList.remove('open'));

    // Toggle the clicked one
    if (!isOpen) {
        panelEl.classList.add('open');
        // Find the matching toggle button
        const btns = document.querySelectorAll(`#ai-worker-${workerId} .ai-worker-toggle`);
        const panels = workerId === 'leo'
            ? ['caps', 'integration', 'journal', 'leaderboard']
            : ['caps', 'integration', 'journal'];
        const idx = panels.indexOf(panel);
        if (idx >= 0 && btns[idx]) btns[idx].classList.add('open');
    }
}

async function loadLeaderboard() {
    const container = document.getElementById('leo-leaderboard-content');
    if (!container) return;
    container.innerHTML = '<div style="color:var(--gray-400);font-size:13px;padding:8px 0;">Завантаження...</div>';
    try {
        const res = await fetch('https://tymur-bot-production.up.railway.app/vendors/leaderboard');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const vendors = data.leaderboard || [];
        if (!vendors.length) {
            container.innerHTML = '<div class="ai-journal-empty">Підрядників ще немає</div>';
            return;
        }
        const stars = (r) => {
            const full = Math.round(r);
            return '★'.repeat(full) + '☆'.repeat(5 - full);
        };
        const rows = vendors.map(v => {
            const resp = v.avg_response_min ? `${Math.round(v.avg_response_min)} хв` : '—';
            const ontime = v.on_time_pct != null ? `${Math.round(v.on_time_pct)}%` : '—';
            const badgeStyle = v.active
                ? 'background:#d1fae5;color:#065f46;'
                : 'background:#fee2e2;color:#991b1b;';
            return `
            <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--gray-100);">
                <div style="font-size:18px;font-weight:700;color:var(--gray-300);width:20px;">${v.rank}</div>
                <div style="flex:1;">
                    <div style="font-weight:600;font-size:13px;">${escapeHtml(v.name)}</div>
                    <div style="font-size:11px;color:#f59e0b;">${stars(v.rating)} ${v.rating.toFixed(1)}</div>
                </div>
                <div style="text-align:right;font-size:11px;color:var(--gray-400);line-height:1.6;">
                    <div>Виконано: <b>${v.completed_orders}</b></div>
                    <div>Відповідь: <b>${resp}</b></div>
                    <div>Вчасно: <b>${ontime}</b></div>
                </div>
                <span style="font-size:10px;padding:2px 6px;border-radius:4px;${badgeStyle}">${v.active ? 'Активний' : 'Вимкнений'}</span>
            </div>`;
        }).join('');
        const updated = new Date(data.last_updated).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
        container.innerHTML = rows + `<div style="font-size:10px;color:var(--gray-300);margin-top:8px;">Оновлено: ${updated}</div>`;
    } catch (e) {
        container.innerHTML = `<div style="color:#ef4444;font-size:12px;padding:8px 0;">⚠️ Не вдалося завантажити рейтинг</div>`;
    }
}

function sendAITask(workerId) {
    const input = document.getElementById(`ai-task-input-${workerId}`);
    if (!input) return;
    const task = input.value.trim();
    if (!task) {
        showNotification('Введіть опис завдання', 'error');
        return;
    }

    const now = new Date();
    const time = now.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
    const date = now.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Kyiv' });

    aiJournal[workerId].unshift({ task, time: `${date} ${time}`, status: 'sent' });
    input.value = '';

    // Refresh journal panel
    const journalEl = document.getElementById(`ai-journal-${workerId}`);
    if (journalEl) {
        const journal = aiJournal[workerId];
        journalEl.innerHTML = journal.map(j =>
            `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-100);">
                <span>${escapeHtml(j.task)}</span>
                <span style="color:var(--gray-400);font-size:11px;white-space:nowrap;margin-left:12px;">${j.time}</span>
            </div>`
        ).join('');
    }

    // Open journal panel to show the result
    toggleAIPanel(workerId, 'journal');

    const worker = AI_WORKERS.find(w => w.id === workerId);
    showNotification(`Завдання відправлено ${worker ? worker.name : 'працівнику'}`, 'success');
}

// ==========================================
// DARK MODE
// ==========================================

function initDarkMode() {
    if (localStorage.getItem('pzp_dark_mode') === 'true') {
        document.body.classList.add('dark-mode');
    }
}

// ==========================================
// BOOT
// ==========================================

document.addEventListener('DOMContentLoaded', initPage);
