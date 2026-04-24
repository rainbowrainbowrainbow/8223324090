/**
 * hr-page.js — HR module frontend (v30.7)
 *
 * 10 tabs: Today, Schedule, Team, Reports, AI Team, Leaves, Salary, Ratings, Onboarding, Costumes
 * API: /api/hr/*
 */

// ==========================================
// CONSTANTS
// ==========================================

const ROLE_LABELS = {
    creator: 'Творець', director: 'Директор', vice_director: 'Зам. директора',
    senior_manager: 'Старший менеджер', manager: 'Менеджер',
    accountant: 'Бухгалтер', art_director: 'Арт-директор', marketer: 'Маркетолог',
    it_specialist: 'IT-спеціаліст', hr: 'HR-менеджер', hr_manager: 'HR-менеджер',
    admin: 'Адмін', security: 'Охорона',
    senior_instructor: 'Старший інструктор', instructor: 'Інструктор',
    trampoline_instructor: 'Інструктор батутів',
    head_chef: 'Шеф-повар', head_cook: 'Шеф-повар', cook: 'Повар',
    head_pastry: 'Шеф-кондитер', pastry_chef: 'Кондитер',
    animator: 'Аніматор', host: 'Ведуча', technician: 'Технік',
    reception: 'Рецепція', barista: 'Бариста', bartender: 'Бармен',
    waiter: 'Офіціант', wardrobe: 'Гардеробник',
    cleaning: 'Клінінг', cleaner: 'Прибиральник', maintenance: 'Технік',
    dishwasher: 'Посудомийник', intern: 'Стажер'
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
    try {
    initDarkMode();
    const token = localStorage.getItem('pzp_token');
    if (!token) { window.location.href = '/'; return; }

    const user = await apiVerifyToken();
    if (!user) { window.location.href = '/'; return; }

    AppState.currentUser = user;
    const userEl = document.getElementById('currentUser');
    if (userEl) userEl.textContent = user.name;
    if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
    const MANAGE_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager'];
    canManage = MANAGE_ROLES.includes(user.role);

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        localStorage.removeItem('pzp_token');
        localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
        location.href = '/';
    });

    initTabs();
    initScheduleControls();
    initModals();
    initContextMenu();
    initNewTabs();
    await loadToday();
    startPolling();
    } catch (err) { console.error('HR initPage failed:', err); }
}

function initNewTabs() {
    document.getElementById('leaveStatusFilter')?.addEventListener('change', loadLeaves);
    document.getElementById('btnNewLeave')?.addEventListener('click', showNewLeaveForm);
    document.getElementById('salaryMonth')?.addEventListener('change', loadSalary);
    document.getElementById('btnAddAdjustment')?.addEventListener('click', showAdjustmentForm);
    document.getElementById('btnStartOnboarding')?.addEventListener('click', showStartOnboarding);
    document.getElementById('btnAddCostume')?.addEventListener('click', showAddCostume);
}

// ==========================================
// TABS
// ==========================================

function initTabs() {
    try {
    document.querySelectorAll('.hr-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.hr-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.hr-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            const panel = document.getElementById(`tab-${target}`);
            if (!panel) { console.error(`[HR] panel #tab-${target} not found`); return; }
            panel.classList.add('active');
            const loaders = {
                today: loadToday, schedule: loadSchedule, team: loadTeam,
                reports: loadReports, 'ai-team': renderAITeam, leaves: loadLeaves,
                salary: loadSalary, ratings: loadRatings, onboarding: loadOnboarding,
                costumes: loadCostumes, vacancies: loadVacancies
            };
            loaders[target]?.();
        });
    });
    } catch (err) { console.error('HR init failed:', err); window.location.href = '/'; }
}

// ==========================================
// TAB 1: TODAY
// ==========================================

async function loadToday() {
    if (typeof _loadStaffLinks === 'function') _loadStaffLinks().catch(() => {});
    const data = await hrFetch('/today');
    if (!data || !data.success) return;
    todayData = data;
    renderToday(data);
}

function renderToday(data) {
    const today = new Date();
    const dayName = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', 'П\'ятниця', 'Субота'][today.getDay()];
    document.getElementById('todayDate').textContent =         `${dayName}, ${today.getDate()} ${MONTHS_UK[today.getMonth()]} ${today.getFullYear()}`;

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
                <div class="hr-staff-name">${escapeHtml(item.staff_name)} ${typeof staffAccountBadge === 'function' ? staffAccountBadge(item.staff_id, {compact:true}) : ''} <a href="/staff?highlight=${item.staff_id}" class="hr-crosslink" title="Графік" style="font-size:14px;text-decoration:none;opacity:0.5">📅</a></div>
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
        document.getElementById('contextMenu')?.classList.remove('visible');
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

    document.getElementById('schedPrev')?.addEventListener('click', () => {
        if (scheduleView === 'week') {
            scheduleWeekStart.setDate(scheduleWeekStart.getDate() - 7);
        } else {
            scheduleWeekStart.setMonth(scheduleWeekStart.getMonth() - 1);
            scheduleWeekStart.setDate(1);
        }
        loadSchedule();
    });

    document.getElementById('schedNext')?.addEventListener('click', () => {
        if (scheduleView === 'week') {
            scheduleWeekStart.setDate(scheduleWeekStart.getDate() + 7);
        } else {
            scheduleWeekStart.setMonth(scheduleWeekStart.getMonth() + 1);
            scheduleWeekStart.setDate(1);
        }
        loadSchedule();
    });

    document.getElementById('schedToday')?.addEventListener('click', () => {
        scheduleWeekStart = getMonday(new Date());
        loadSchedule();
    });

    document.getElementById('schedCopy')?.addEventListener('click', copyWeek);

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
        document.getElementById('schedLabel').textContent =             `Тиждень ${dates[0].getDate()}–${sun.getDate()} ${MONTHS_UK[sun.getMonth()]} ${sun.getFullYear()}`;
    } else {
        document.getElementById('schedLabel').textContent =             `${MONTHS_SHORT[scheduleWeekStart.getMonth()]} ${scheduleWeekStart.getFullYear()}`;
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
        const tplId = document.getElementById('templateSelect')?.value;
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
    const btn = document.getElementById('shiftSave');
    if (btn && btn.disabled) return;
    const body = {
        staff_id: editingShift.staffId,
        shift_date: editingShift.date,
        planned_start: document.getElementById('shiftStart')?.value,
        planned_end: document.getElementById('shiftEnd')?.value,
        shift_type: document.getElementById('shiftType')?.value,
        break_minutes: parseInt(document.getElementById('shiftBreak')?.value) || 0,
        notes: document.getElementById('shiftNotes')?.value
    };

    if (!body.planned_start || !body.planned_end) {
        showNotification('Вкажіть час початку і кінця', 'error');
        return;
    }

    if (btn) btn.disabled = true;
    try {
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
    } finally {
        if (btn) btn.disabled = false;
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
    const activeOnly = document.getElementById('teamActiveOnly')?.checked ?? true;
    const grid = document.getElementById('teamGrid');
    if (grid) grid.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:32px">⏳ Завантаження...</div>';
    const data = await hrFetch(`/staff?active=${activeOnly}`);
    if (!data) {
        if (grid) grid.innerHTML = '<div style="text-align:center;color:var(--danger);padding:32px">❌ Помилка завантаження. Оновіть сторінку.</div>';
        return;
    }
    if (!data.success) {
        if (grid) grid.innerHTML = `<div style="text-align:center;color:var(--gray-400);padding:32px">${escapeHtml(data.error || 'Помилка сервера')}</div>`;
        return;
    }
    teamStaff = data.data || [];
    // Show missing data banner
    const activeStaff = teamStaff.filter(s => s.is_active);
    const missingFace = activeStaff.filter(s => !s.has_face_descriptor).length;
    const missingAccount = activeStaff.filter(s => !s.has_account).length;
    const banner = document.getElementById('teamMissingBanner');
    if (banner) {
        if (missingFace > 0 || missingAccount > 0) {
            const msgs = [];
            if (missingFace) msgs.push(`📸 ${missingFace} без фото для камери`);
            if (missingAccount) msgs.push(`🔑 ${missingAccount} без акаунту CRM`);
            banner.innerHTML = `<div class="hr-missing-banner">⚠️ ${msgs.join(' · ')}</div>`;
            banner.style.display = '';
        } else {
            banner.style.display = 'none';
        }
    }
    filterAndRenderTeam();
    // Attach filter listeners (idempotent)
    const searchEl = document.getElementById('teamSearch');
    const roleEl = document.getElementById('teamRoleFilter');
    const activeEl = document.getElementById('teamActiveOnly');
    if (searchEl) searchEl.oninput = filterAndRenderTeam;
    if (roleEl) roleEl.onchange = filterAndRenderTeam;
    if (activeEl) activeEl.onchange = loadTeam;
}

function filterAndRenderTeam() {
    const query = document.getElementById('teamSearch')?.value.toLowerCase();
    const role = document.getElementById('teamRoleFilter')?.value;

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
                <div class="hr-team-role">${s.position ? escapeHtml(s.position) + ' · ' : ''}${roleLabel}${hireStr ? ' · з ' + hireStr : ''}</div>
                <div class="hr-team-badges">${s.has_face_descriptor ? '<span class="hr-badge hr-badge--ok" title="Фото для камери: є">📸</span>' : '<span class="hr-badge hr-badge--warn" title="Фото для камери: немає">📸❌</span>'} ${s.has_account ? '<span class="hr-badge hr-badge--ok" title="Акаунт CRM: є">🔑</span>' : '<span class="hr-badge hr-badge--warn" title="Акаунт CRM: немає">🔑❌</span>'}</div>
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
    const staffId = document.getElementById('editStaffId')?.value;
    const body = {
        role_type: document.getElementById('editRoleType')?.value,
        phone: document.getElementById('editPhone')?.value || null,
        birth_date: document.getElementById('editBirthDate')?.value || null,
        emergency_contact: document.getElementById('editEmergencyContact')?.value || null,
        emergency_phone: document.getElementById('editEmergencyPhone')?.value || null,
        hourly_rate: parseFloat(document.getElementById('editHourlyRate')?.value) || 0,
        telegram_id: document.getElementById('editTelegramId')?.value || null,
        telegram_username: document.getElementById('editTelegramUsername')?.value || null,
        contract_type: document.getElementById('editContractType')?.value || 'parttime',
        skills: document.getElementById('editSkills')?.value ? document.getElementById('editSkills')?.value.split(',').map(s => s.trim()).filter(Boolean) : null,
        notes: document.getElementById('editNotes')?.value || null
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
        document.getElementById('reportExport')?.addEventListener('click', exportCSV);
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
    const month = document.getElementById('reportMonth')?.value;
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
        showNotification('Помилка експорту: ' + resp.statusText, 'error');
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
    document.getElementById('shiftSave')?.addEventListener('click', saveShift);
    document.getElementById('shiftDelete')?.addEventListener('click', deleteShift);
    document.getElementById('shiftCancel')?.addEventListener('click', () => {
        document.getElementById('shiftModal').style.display = 'none';
    });

    // Staff edit modal
    document.getElementById('editSave')?.addEventListener('click', saveStaffEdit);
    document.getElementById('editCancel')?.addEventListener('click', () => {
        document.getElementById('staffEditModal').style.display = 'none';
    });

    // Correction modal
    document.getElementById('corrSave')?.addEventListener('click', saveCorrection);
    document.getElementById('corrCancel')?.addEventListener('click', () => {
        document.getElementById('correctionModal').style.display = 'none';
    });

    // Close modals on overlay click
    ['shiftModal', 'staffEditModal', 'correctionModal'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
        });
    });
}

async function saveCorrection() {
    const recordId = document.getElementById('corrRecordId')?.value;
    const clockIn = document.getElementById('corrClockIn')?.value;
    const clockOut = document.getElementById('corrClockOut')?.value;
    const notes = document.getElementById('corrNotes')?.value;

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
// TAB 6: LEAVES (#2)
// ==========================================

async function loadLeaves() {
    const statusFilter = document.getElementById('leaveStatusFilter')?.value || '';
    const data = await hrFetch(`/leave-requests?status=${statusFilter}`);
    if (!data || !data.success) return;
    renderLeaves(data.data);
}

function renderLeaves(leaves) {
    const el = document.getElementById('leavesList');
    if (!leaves.length) {
        el.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:40px;">Немає заявок</div>';
        return;
    }
    const typeLabels = { vacation: 'Відпустка', sick: 'Лікарняний', day_off: 'Вихідний', unpaid: 'За свій рахунок' };
    const statusColors = { pending: '#F59E0B', approved: '#10B981', rejected: '#EF4444', cancelled: '#9CA3AF' };
    const statusLabels = { pending: 'Очікує', approved: 'Затверджено', rejected: 'Відхилено', cancelled: 'Скасовано' };

    el.innerHTML = leaves.map(l => `
        <div style="background:var(--white);border:1px solid var(--gray-100);border-radius:var(--radius);padding:16px;margin-bottom:12px;box-shadow:var(--shadow-xs);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div>
                    <strong>${escapeHtml(l.staff_name)}</strong>
                    <span style="margin-left:8px;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;background:${statusColors[l.status]}20;color:${statusColors[l.status]};">${statusLabels[l.status]}</span>
                </div>
                <span style="font-size:12px;color:var(--gray-500);">${typeLabels[l.type] || l.type}</span>
            </div>
            <div style="font-size:13px;color:var(--gray-600);margin-bottom:6px;">
                ${l.date_from?.split('T')[0]} — ${l.date_to?.split('T')[0]} (${l.days} дн.)
            </div>
            ${l.reason ? `<div style="font-size:12px;color:var(--gray-500);">Причина: ${escapeHtml(l.reason)}</div>` : ''}
            ${l.status === 'pending' && canManage ? `
                <div style="display:flex;gap:8px;margin-top:10px;">
                    <button onclick="reviewLeave(${l.id}, 'approved')" style="padding:6px 16px;border:none;background:#10B981;color:#fff;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;">Затвердити</button>
                    <button onclick="reviewLeave(${l.id}, 'rejected')" style="padding:6px 16px;border:none;background:#EF4444;color:#fff;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;">Відхилити</button>
                </div>
            ` : ''}
        </div>
    `).join('');
}

window.reviewLeave = async function(id, status) {
    let comment = '';
    if (status === 'rejected') {
        comment = await promptModal('Причина відхилення:', { placeholder: 'Вкажіть причину...' });
        if (comment === null) return;
    }
    const data = await hrFetch(`/leave-requests/${id}/review`, 'PUT', { status, comment });
    if (data?.success) { showNotification(status === 'approved' ? 'Заявку затверджено' : 'Заявку відхилено', 'success'); loadLeaves(); }
};

window.showNewLeaveForm = async function() {
    const staff = await hrFetch('/staff?active=true');
    if (!staff?.success) return;
    const staffOptions = staff.data.map(s => ({ value: String(s.id), label: `${s.name}` }));
    const typeOptions = [
        { value: 'vacation', label: 'Відпустка' },
        { value: 'sick', label: 'Лікарняний' },
        { value: 'day_off', label: 'Відгул' },
        { value: 'unpaid', label: 'За свій рахунок' }
    ];
    const result = await formModal('Нова заявка на відпустку', [
        { key: 'staffId', label: 'Співробітник', type: 'select', options: staffOptions, required: true },
        { key: 'type', label: 'Тип', type: 'select', options: typeOptions, defaultValue: 'vacation' },
        { key: 'dateFrom', label: 'Дата з', type: 'date', required: true },
        { key: 'dateTo', label: 'Дата по', type: 'date', required: true },
        { key: 'reason', label: 'Причина', placeholder: 'Необов\'язково' }
    ], { icon: '🏖️' });
    if (!result) return;
    const data = await hrFetch('/leave-requests', 'POST', { staff_id: parseInt(result.staffId), type: result.type, date_from: result.dateFrom, date_to: result.dateTo, reason: result.reason || '' });
    if (data?.success) { showNotification('Заявку створено', 'success'); loadLeaves(); }
};

// ==========================================
// TAB 7: SALARY (#7)
// ==========================================

async function loadSalary() {
    const monthSelect = document.getElementById('salaryMonth');
    if (monthSelect && !monthSelect.options.length) {
        const now = new Date();
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
            monthSelect.add(new Option(label, val));
        }
    }
    const month = monthSelect?.value || '';
    const data = await hrFetch(`/salary?month=${month}`);
    if (!data || !data.success) return;
    renderSalary(data);
}

function renderSalary(data) {
    const totals = data.totals;
    document.getElementById('salaryTotals').innerHTML = `
        <div class="hr-summary">
            <div class="hr-summary-card"><div class="value">${(totals.total_salary || 0).toLocaleString('uk-UA')} ₴</div><div class="label">Всього</div></div>
            <div class="hr-summary-card green"><div class="value">${(totals.total_base || 0).toLocaleString('uk-UA')} ₴</div><div class="label">Базова</div></div>
            <div class="hr-summary-card"><div class="value">${(totals.total_overtime || 0).toLocaleString('uk-UA')} ₴</div><div class="label">Переробки</div></div>
            <div class="hr-summary-card green"><div class="value">${(totals.total_bonuses || 0).toLocaleString('uk-UA')} ₴</div><div class="label">Бонуси</div></div>
            <div class="hr-summary-card red"><div class="value">${(totals.total_deductions || 0).toLocaleString('uk-UA')} ₴</div><div class="label">Утримання</div></div>
        </div>
    `;

    document.getElementById('salaryHead').innerHTML = `<tr>
        <th>Співробітник</th><th>Роль</th><th>Ставка</th><th>Днів</th><th>Годин</th>
        <th>Базова</th><th>Переробки</th><th>Бонуси</th><th>Утримання</th><th>Всього</th>
    </tr>`;

    document.getElementById('salaryBody').innerHTML = data.data.map(s => `<tr>
        <td><strong>${escapeHtml(s.staff_name)}</strong></td>
        <td>${ROLE_LABELS[s.role_type] || s.role_type || ''}</td>
        <td>${s.hourly_rate} ₴/год</td>
        <td>${s.days_worked}</td>
        <td>${s.hours_worked}</td>
        <td>${s.base_salary.toLocaleString('uk-UA')} ₴</td>
        <td>${s.overtime_pay ? s.overtime_pay.toLocaleString('uk-UA') + ' ₴' : '—'}</td>
        <td style="color:#10B981;">${(s.bonuses + s.tips) ? '+' + (s.bonuses + s.tips).toLocaleString('uk-UA') + ' ₴' : '—'}</td>
        <td style="color:#EF4444;">${(s.deductions + s.penalties) ? '-' + (s.deductions + s.penalties).toLocaleString('uk-UA') + ' ₴' : '—'}</td>
        <td><strong>${s.total_salary.toLocaleString('uk-UA')} ₴</strong></td>
    </tr>`).join('');
}

window.showAdjustmentForm = async function() {
    const staff = await hrFetch('/staff?active=true');
    if (!staff?.success) return;
    const staffOptions = staff.data.map(s => ({ value: String(s.id), label: `${s.name}` }));
    const typeOptions = [
        { value: 'bonus', label: 'Бонус' },
        { value: 'deduction', label: 'Утримання' },
        { value: 'penalty', label: 'Депреміювання' },
        { value: 'tip', label: 'Чайові' }
    ];
    const result = await formModal('Коригування зарплати', [
        { key: 'staffId', label: 'Співробітник', type: 'select', options: staffOptions, required: true },
        { key: 'type', label: 'Тип', type: 'select', options: typeOptions, defaultValue: 'bonus' },
        { key: 'amount', label: 'Сума (₴)', type: 'number', required: true, placeholder: '500' },
        { key: 'reason', label: 'Причина', placeholder: 'Необов\'язково' }
    ], { icon: '💰' });
    if (!result) return;
    const amount = parseInt(result.amount);
    if (!amount) return;
    const month = document.getElementById('salaryMonth')?.value || '';

    // For penalty/deduction — show template picker
    if (result.type === 'penalty' || result.type === 'deduction') {
        const tplResult = await showDepremiumPicker(parseInt(result.staffId), amount, result.reason, month);
        if (tplResult === false) return; // cancelled
        if (tplResult) {
            const data = await hrFetch('/salary/adjustment', 'POST', {
                staff_id: parseInt(result.staffId), month, type: result.type,
                amount: tplResult.amount, reason: tplResult.reason, template_id: tplResult.template_id
            });
            if (data?.success) {
                if (data.needsReview) showNotification('Депреміювання створено — потрібне погодження директора', 'warning');
                else showNotification('Депреміювання застосовано', 'success');
                loadSalary();
            }
            return;
        }
    }

    const data = await hrFetch('/salary/adjustment', 'POST', { staff_id: parseInt(result.staffId), month, type: result.type, amount, reason: result.reason || '' });
    if (data?.success) { showNotification('Коригування додано', 'success'); loadSalary(); }
};

// v43.0: Depremium template picker with decision panel
const SEVERITY_LABELS = { low: '🟢 Низький', medium: '🟡 Середній', high: '🟠 Високий', critical: '🔴 Критичний' };
const CATEGORY_LABELS = { attendance: 'Відвідуваність', behavior: 'Поведінка', appearance: 'Зовнішній вигляд', service: 'Обслуговування', safety: 'Безпека', theft: 'Крадіжка', substance: 'Речовини', workplace: 'Робоче місце', phone: 'Телефон', general: 'Загальне' };

async function showDepremiumPicker(staffId, initialAmount, initialReason, month) {
    const tplData = await hrFetch('/depremium-templates');
    if (!tplData?.success || !tplData.data?.length) return null; // no templates, use custom

    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'hr-modal-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9500;display:flex;align-items:center;justify-content:center;padding:16px';

        const modal = document.createElement('div');
        modal.style.cssText = 'background:#1E1E38;border-radius:16px;max-width:600px;width:100%;max-height:85vh;overflow-y:auto;padding:24px;color:#E2E8F0;box-shadow:0 20px 60px rgba(0,0,0,0.4)';

        let selectedTpl = null;
        const templates = tplData.data;

        function render(filter = '') {
            const filtered = templates.filter(t => !filter || t.title.toLowerCase().includes(filter) || t.code.toLowerCase().includes(filter) || t.official_reason.toLowerCase().includes(filter));
            modal.innerHTML = `
                <h3 style="margin:0 0 16px;font-size:18px;font-weight:800">📋 Офіційне правило депреміювання</h3>
                <div style="display:grid;grid-template-columns:1.4fr .8fr;gap:8px;margin-bottom:12px">
                    <input id="dpSearch" class="eg-input" placeholder="Пошук: запізнення, телефон..." value="${escapeHtml(filter)}" style="padding:10px 12px;border:1px solid #3D3D5C;border-radius:10px;background:#2A2A4A;color:#E2E8F0;font-size:14px;min-height:44px">
                    <select id="dpCatFilter" style="padding:10px;border:1px solid #3D3D5C;border-radius:10px;background:#2A2A4A;color:#E2E8F0;font-size:13px;min-height:44px">
                        <option value="">Всі категорії</option>
                        ${Object.entries(CATEGORY_LABELS).map(([k,v]) => '<option value="'+k+'">'+v+'</option>').join('')}
                    </select>
                </div>
                <div style="max-height:280px;overflow-y:auto;display:grid;gap:8px;margin-bottom:16px">
                    ${filtered.map(t => `<button class="dp-tpl-item" data-id="${t.id}" style="width:100%;text-align:left;padding:12px 14px;border-radius:12px;border:1px solid ${selectedTpl?.id===t.id?'#a78bfa':'rgba(255,255,255,0.08)'};background:${selectedTpl?.id===t.id?'rgba(168,85,247,0.15)':'rgba(255,255,255,0.03)'};cursor:pointer;transition:all .15s;color:#E2E8F0">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                            <span style="font-size:11px;font-weight:800;letter-spacing:.08em;color:#c084fc">${escapeHtml(t.code)}</span>
                            <span style="font-size:11px;font-weight:600" class="severity-${t.severity}">${SEVERITY_LABELS[t.severity]||t.severity}</span>
                        </div>
                        <div style="font-size:14px;font-weight:700;margin-bottom:3px">${escapeHtml(t.title)}</div>
                        <div style="font-size:12px;color:#94A3B8;line-height:1.4">${escapeHtml(t.official_reason)}</div>
                        ${t.amount ? '<div style="margin-top:6px;font-size:13px;font-weight:700;color:#fda4af">-'+t.amount+' ₴</div>' : '<div style="margin-top:6px;font-size:12px;color:#fca5a5;font-weight:600">Повне ненарахування / звільнення</div>'}
                    </button>`).join('')}
                    ${!filtered.length ? '<div style="text-align:center;color:#6B7280;padding:20px">Нічого не знайдено</div>' : ''}
                </div>
                <div id="dpDecisionPanel" style="display:${selectedTpl?'block':'none'}">
                    ${selectedTpl ? renderDecisionPanel(selectedTpl) : ''}
                </div>
                <div style="display:flex;gap:8px;margin-top:16px">
                    <button id="dpApply" style="flex:1;padding:12px;border:none;border-radius:12px;background:${selectedTpl?'#7c3aed':'#3D3D5C'};color:#fff;font-size:14px;font-weight:700;cursor:pointer;min-height:44px;transition:all .15s" ${selectedTpl?'':'disabled'}>✅ Застосувати</button>
                    <button id="dpCustom" style="padding:12px 20px;border:1px solid #3D3D5C;border-radius:12px;background:transparent;color:#9CA3AF;font-size:13px;cursor:pointer;min-height:44px">Довільна причина</button>
                    <button id="dpCancel" style="padding:12px 20px;border:1px solid #3D3D5C;border-radius:12px;background:transparent;color:#9CA3AF;font-size:13px;cursor:pointer;min-height:44px">Скасувати</button>
                </div>`;

            // Bind events
            modal.querySelector('#dpSearch')?.addEventListener('input', (e) => render(e.target.value.toLowerCase()));
            modal.querySelectorAll('.dp-tpl-item').forEach(btn => {
                btn.addEventListener('click', () => {
                    selectedTpl = templates.find(t => t.id === parseInt(btn.dataset.id));
                    render(modal.querySelector('#dpSearch')?.value?.toLowerCase() || '');
                    // Load staff history for this template
                    loadStaffHistory(staffId, selectedTpl.id);
                });
            });
            modal.querySelector('#dpApply')?.addEventListener('click', () => {
                if (!selectedTpl) return;
                overlay.remove();
                resolve({ template_id: selectedTpl.id, amount: selectedTpl.amount || initialAmount, reason: selectedTpl.official_reason });
            });
            modal.querySelector('#dpCustom')?.addEventListener('click', () => { overlay.remove(); resolve(null); });
            modal.querySelector('#dpCancel')?.addEventListener('click', () => { overlay.remove(); resolve(false); });
        }

        function renderDecisionPanel(tpl) {
            let warnings = '';
            if (tpl.severity === 'critical') warnings += '<div style="margin-top:8px;padding:8px 12px;border-radius:10px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);color:#fca5a5;font-size:12px">🔴 Критичне порушення — потрібне погодження директора</div>';
            if (tpl.requires_manual_review) warnings += '<div style="margin-top:8px;padding:8px 12px;border-radius:10px;background:rgba(250,204,21,0.1);border:1px solid rgba(250,204,21,0.2);color:#fde68a;font-size:12px">⚠️ Потрібне ручне погодження</div>';
            if (tpl.is_repeat_offense) warnings += '<div style="margin-top:8px;padding:8px 12px;border-radius:10px;background:rgba(250,204,21,0.1);border:1px solid rgba(250,204,21,0.2);color:#fde68a;font-size:12px">🔁 Це повторне порушення</div>';
            if (!tpl.can_be_edited) warnings += '<div style="margin-top:8px;padding:8px 12px;border-radius:10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);color:#f87171;font-size:12px">🔒 Суму не можна змінювати</div>';

            return `<div style="padding:14px;border-radius:14px;background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.2)">
                <div style="font-size:12px;font-weight:800;color:#c084fc;letter-spacing:.08em;margin-bottom:4px">${escapeHtml(tpl.code)}</div>
                <div style="font-size:15px;font-weight:700;margin-bottom:4px">${escapeHtml(tpl.title)}</div>
                <div style="font-size:13px;color:#94A3B8;line-height:1.4;margin-bottom:8px">${escapeHtml(tpl.official_reason)}</div>
                <div style="display:flex;gap:12px;font-size:12px;flex-wrap:wrap">
                    ${tpl.amount ? '<span style="color:#fda4af;font-weight:700">-'+tpl.amount+' ₴</span>' : '<span style="color:#fca5a5;font-weight:700">Повне ненарахування</span>'}
                    <span class="severity-${tpl.severity}">${SEVERITY_LABELS[tpl.severity]||''}</span>
                    <span style="color:#94A3B8">${CATEGORY_LABELS[tpl.discipline_category]||''}</span>
                </div>
                ${warnings}
                <div id="dpStaffHistory" style="margin-top:10px"></div>
            </div>`;
        }

        async function loadStaffHistory(sId, tplId) {
            const el = modal.querySelector('#dpStaffHistory');
            if (!el) return;
            const hist = await hrFetch('/depremium-templates/' + tplId + '/staff-history/' + sId);
            if (!hist?.success || !hist.data?.length) { el.innerHTML = '<div style="font-size:11px;color:#6B7280;margin-top:4px">Попередніх порушень не знайдено</div>'; return; }
            el.innerHTML = '<div style="font-size:11px;font-weight:700;color:#fde68a;margin-bottom:4px">⚠️ Попередні порушення (' + hist.data.length + '):</div>' +
                hist.data.slice(0, 3).map(h => '<div style="font-size:11px;color:#94A3B8;padding:2px 0">' + new Date(h.created_at).toLocaleDateString('uk-UA') + ' — ' + (h.amount || 0) + '₴ — ' + escapeHtml(h.reason || '').substring(0, 50) + '</div>').join('');
        }

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
        render();
    });
};

// ==========================================
// TAB 8: RATINGS (#3)
// ==========================================

async function loadRatings() {
    const data = await hrFetch('/ratings');
    if (!data || !data.success) return;
    renderRatings(data.data);
}

function renderRatings(staff) {
    const el = document.getElementById('ratingsBoard');
    if (!staff.length) {
        el.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:40px;">Немає даних</div>';
        return;
    }

    el.innerHTML = staff.map((s, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        const stars = '★'.repeat(Math.round(parseFloat(s.avg_rating))) + '☆'.repeat(5 - Math.round(parseFloat(s.avg_rating)));
        return `
        <div style="display:flex;align-items:center;gap:16px;padding:14px 16px;background:var(--white);border:1px solid var(--gray-100);border-radius:var(--radius);margin-bottom:8px;box-shadow:var(--shadow-xs);">
            <span style="font-size:20px;min-width:36px;text-align:center;">${medal}</span>
            <div style="width:36px;height:36px;border-radius:50%;background:${s.color || '#6366F1'};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px;">
                ${escapeHtml(s.name?.charAt(0) || '?')}
            </div>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:700;">${escapeHtml(s.name)}</div>
                <div style="font-size:12px;color:var(--gray-500);">${ROLE_LABELS[s.role_type] || s.role_type || ''}</div>
            </div>
            <div style="text-align:center;">
                <div style="color:#F59E0B;font-size:14px;letter-spacing:1px;">${stars}</div>
                <div style="font-size:12px;color:var(--gray-500);">${parseFloat(s.avg_rating).toFixed(1)} (${s.total_ratings} відгуків)</div>
            </div>
            <div style="text-align:center;min-width:60px;">
                <div style="font-weight:800;font-size:18px;color:var(--gray-800);">${s.total_events}</div>
                <div style="font-size:11px;color:var(--gray-500);">подій</div>
            </div>
            <div style="text-align:center;min-width:50px;">
                <div style="font-weight:700;font-size:14px;color:#6366F1;">${s.events_30d}</div>
                <div style="font-size:10px;color:var(--gray-400);">за 30 дн</div>
            </div>
        </div>`;
    }).join('');
}

// ==========================================
// TAB 9: ONBOARDING (#5)
// ==========================================

async function loadOnboarding() {
    const data = await hrFetch('/onboarding');
    if (!data || !data.success) return;
    renderOnboarding(data.data);
}

function renderOnboarding(list) {
    const el = document.getElementById('onboardingList');
    if (!list.length) {
        el.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:40px;">Немає активних онбордингів</div>';
        return;
    }

    el.innerHTML = list.map(o => {
        const pct = o.total_items > 0 ? Math.round(o.completed_items / o.total_items * 100) : 0;
        const items = o.items || [];
        return `
        <div style="background:var(--white);border:1px solid var(--gray-100);border-radius:var(--radius);padding:16px;margin-bottom:12px;box-shadow:var(--shadow-xs);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div>
                    <strong>${escapeHtml(o.staff_name)}</strong>
                    <span style="font-size:12px;color:var(--gray-500);margin-left:8px;">${escapeHtml(o.template_name || '')}</span>
                </div>
                <span style="font-weight:800;color:${pct === 100 ? '#10B981' : '#6366F1'};">${pct}%</span>
            </div>
            <div style="background:var(--gray-100);border-radius:99px;height:6px;margin-bottom:12px;overflow:hidden;">
                <div style="background:${pct === 100 ? '#10B981' : '#6366F1'};height:100%;width:${pct}%;border-radius:99px;transition:width 0.3s;"></div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
                ${items.map(it => `
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;${it.done ? 'color:var(--gray-400);text-decoration:line-through;' : ''}">
                        <input type="checkbox" ${it.done ? 'checked' : ''} onchange="toggleOnboardingItem(${o.id}, ${it.id}, this.checked)" style="width:16px;height:16px;">
                        <span>${escapeHtml(it.title)}</span>
                    </label>
                `).join('')}
            </div>
        </div>`;
    }).join('');
}

window.toggleOnboardingItem = async function(progressId, itemId, done) {
    const data = await hrFetch(`/onboarding/${progressId}/check`, 'PUT', { item_id: itemId, done });
    if (data?.success) loadOnboarding();
};

window.showStartOnboarding = async function() {
    const [staff, templates] = await Promise.all([
        hrFetch('/staff?active=true'),
        hrFetch('/onboarding/templates')
    ]);
    if (!staff?.success || !templates?.success) return;
    const staffOptions = staff.data.map(s => ({ value: String(s.id), label: `${s.name}` }));
    const templateOptions = templates.data.map(t => ({ value: String(t.id), label: `${t.name}` }));
    const result = await formModal('Запустити онбординг', [
        { key: 'staffId', label: 'Співробітник', type: 'select', options: staffOptions, required: true },
        { key: 'templateId', label: 'Шаблон', type: 'select', options: templateOptions, required: true }
    ], { icon: '🚀' });
    if (!result) return;
    const data = await hrFetch('/onboarding/start', 'POST', { staff_id: parseInt(result.staffId), template_id: parseInt(result.templateId) });
    if (data?.success) { showNotification('Онбординг запущено', 'success'); loadOnboarding(); }
};

// ==========================================
// TAB 10: COSTUMES (#8)
// ==========================================

async function loadCostumes() {
    const data = await hrFetch('/costumes');
    if (!data || !data.success) return;
    renderCostumes(data.data);
}

function renderCostumes(costumes) {
    const el = document.getElementById('costumesList');
    if (!costumes.length) {
        el.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:40px;">Немає костюмів</div>';
        return;
    }

    const condLabels = { new: 'Новий', good: 'Добрий', worn: 'Потертий', damaged: 'Пошкоджений', retired: 'Списаний' };
    const condColors = { new: '#10B981', good: '#6366F1', worn: '#F59E0B', damaged: '#EF4444', retired: '#9CA3AF' };

    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
        ${costumes.map(c => `
            <div style="background:var(--white);border:1px solid var(--gray-100);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow-xs);">
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
                    <strong style="font-size:14px;">${escapeHtml(c.name)}</strong>
                    <span style="padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;background:${condColors[c.condition] || '#9CA3AF'}20;color:${condColors[c.condition] || '#9CA3AF'};">${condLabels[c.condition] || c.condition}</span>
                </div>
                ${c.category ? `<div style="font-size:12px;color:var(--gray-500);margin-bottom:4px;">Категорія: ${escapeHtml(c.category)}</div>` : ''}
                ${c.size ? `<div style="font-size:12px;color:var(--gray-500);margin-bottom:4px;">Розмір: ${escapeHtml(c.size)}</div>` : ''}
                <div style="font-size:12px;color:var(--gray-500);margin-bottom:4px;">
                    ${c.assigned_name ? `Призначено: <strong>${escapeHtml(c.assigned_name)}</strong>` : '<span style="color:var(--gray-400);">Не призначено</span>'}
                </div>
                ${c.notes ? `<div style="font-size:11px;color:var(--gray-400);margin-top:4px;">${escapeHtml(c.notes)}</div>` : ''}
            </div>
        `).join('')}
    </div>`;
}

// v39.8: commitSalaries — was missing, button existed but function didn't
window.commitSalaries = async function() {
    const month = document.getElementById('salaryMonth')?.value;
    if (!month) { showNotification('Виберіть місяць', 'error'); return; }
    if (!await confirmModal(`Нарахувати зарплати за ${month}?`, { type: 'danger', okText: 'Нарахувати' })) return;
    const data = await hrFetch('/salary/commit', 'POST', { month });
    if (data?.success) {
        showNotification(`Зарплати нараховано (${data.count || 0} транзакцій)`, 'success');
        loadSalary();
    } else {
        showNotification(data?.error || 'Помилка нарахування', 'error');
    }
};

window.showAddCostume = async function() {
    const result = await formModal('Додати костюм', [
        { key: 'name', label: 'Назва костюму', required: true, placeholder: 'Наприклад: Пірат Джек' },
        { key: 'category', label: 'Категорія', placeholder: 'піратський, казковий, спортивний', defaultValue: 'general' },
        { key: 'size', label: 'Розмір', placeholder: 'S / M / L або 42-44' }
    ], { icon: '🦸' });
    if (!result) return;
    const data = await hrFetch('/costumes', 'POST', { name: result.name, category: result.category || 'general', size: result.size || '' });
    if (data?.success) { showNotification('Костюм додано', 'success'); loadCostumes(); }
};

// ==========================================
// DARK MODE
// ==========================================

function initDarkMode() {
    if (localStorage.getItem('pzp_dark_mode') === 'true') {
        document.body.classList.add('dark-mode');
    }
}

// ==========================================
// VACANCIES
// ==========================================

let currentVacancyId = null;
const VAC_STATUS_LABEL = {
    open: '🟢 Відкрита', paused: '⏸ Призупинена',
    filled: '✅ Заповнена', closed: '❌ Закрита'
};
const APP_STATUS_LABEL = {
    new: '🆕 Новий', contacted: '📞 Зв\'язались', interview: '🎙️ Співбесіда',
    offer: '📝 Оффер', hired: '✅ Найнятий', rejected: '❌ Відхилено'
};
const APP_STATUS_COLOR = {
    new: '#64748B', contacted: '#3B82F6', interview: '#8B5CF6',
    offer: '#F59E0B', hired: '#10B981', rejected: '#EF4444'
};

async function loadVacancies() {
    const status = document.getElementById('vacStatusFilter')?.value || 'open';
    const list = document.getElementById('vacanciesList');
    if (list) list.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:24px">⏳</div>';
    const sec = document.getElementById('candidatesSection');
    if (sec) sec.style.display = 'none';

    const data = await hrFetch(`/vacancies?status=${status}`);
    if (!data?.success) {
        if (list) list.innerHTML = '<div style="text-align:center;color:var(--danger);padding:24px">Помилка завантаження</div>';
        return;
    }
    const vacancies = data.vacancies || [];

    const urgent = vacancies.filter(v => v.priority === 'urgent' && v.status === 'open').length;
    const open = vacancies.filter(v => v.status === 'open').length;
    const totalC = vacancies.reduce((s, v) => s + (parseInt(v.active_candidates) || 0), 0);
    const stats = document.getElementById('vacStats');
    if (stats) stats.innerHTML = `
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
            <div class="vac-stat-card"><span class="vac-stat-num">${open}</span><span class="vac-stat-label">Відкритих</span></div>
            ${urgent ? `<div class="vac-stat-card urgent"><span class="vac-stat-num">${urgent}</span><span class="vac-stat-label">🔴 Терміново</span></div>` : ''}
            <div class="vac-stat-card"><span class="vac-stat-num">${totalC}</span><span class="vac-stat-label">Кандидатів</span></div>
        </div>`;

    if (!vacancies.length) {
        if (list) list.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:40px">Вакансій немає. Натисни "+ Вакансія"</div>';
        return;
    }
    if (list) list.innerHTML = vacancies.map(v => `
        <div class="hr-vacancy-card" onclick="openCandidates(${v.id},'${escapeHtml(v.title).replace(/'/g,"\\'")}')">
            <div class="vac-header">
                ${v.priority === 'urgent' ? '<span class="vac-badge urgent">🔴 ТЕРМІНОВО</span>' : ''}
                <span class="vac-badge">${VAC_STATUS_LABEL[v.status] || v.status}</span>
                <span class="vac-apps" title="Кандидатів">👥 ${v.active_candidates || 0}</span>
            </div>
            <div class="vac-title">${escapeHtml(v.title)}</div>
            <div class="vac-role">${ROLE_LABELS[v.role_type] || v.role_type}</div>
            ${v.schedule ? `<div class="vac-meta">🕐 ${escapeHtml(v.schedule)}</div>` : ''}
            ${v.salary_from || v.salary_to ? `<div class="vac-meta">💰 ${v.salary_from || '?'}–${v.salary_to || '?'} ₴</div>` : ''}
            ${v.description ? `<div class="vac-desc">${escapeHtml(v.description.slice(0, 120))}${v.description.length > 120 ? '…' : ''}</div>` : ''}
            <div class="vac-actions" onclick="event.stopPropagation()">
                ${v.status === 'open' ? `<button class="btn-vac-action" onclick="patchVacancy(${v.id},'paused')">⏸</button>` : ''}
                ${v.status !== 'filled' && v.status !== 'closed' ? `<button class="btn-vac-action filled" onclick="patchVacancy(${v.id},'filled')">✅ Заповнено</button>` : ''}
                ${v.status === 'paused' ? `<button class="btn-vac-action" onclick="patchVacancy(${v.id},'open')">▶ Відкрити</button>` : ''}
                <button class="btn-vac-action danger" onclick="patchVacancy(${v.id},'closed')">✕</button>
            </div>
        </div>
    `).join('');
    document.getElementById('vacStatusFilter').onchange = loadVacancies;
}

async function patchVacancy(id, status) {
    await hrFetch(`/vacancies/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    loadVacancies();
}

async function openCandidates(vacancyId, title) {
    currentVacancyId = vacancyId;
    document.getElementById('candidatesTitle').textContent = `Кандидати: ${title}`;
    document.getElementById('candidatesSection').style.display = 'block';
    document.getElementById('candidatesSection')?.scrollIntoView({ behavior: 'smooth' });
    await refreshCandidates();
    document.getElementById('btnAddCandidate').onclick = () => addCandidatePrompt(vacancyId);
}

async function refreshCandidates() {
    if (!currentVacancyId) return;
    const data = await hrFetch(`/vacancies/${currentVacancyId}/applications`);
    if (!data?.success) return;
    const apps = data.applications || [];
    const statuses = ['new', 'contacted', 'interview', 'offer'];
    const kanban = document.getElementById('candidatesKanban');
    if (!kanban) return;
    kanban.innerHTML = statuses.map(s => `
        <div class="kanban-col">
            <div class="kanban-col-title" style="border-top:3px solid ${APP_STATUS_COLOR[s]}">
                ${APP_STATUS_LABEL[s]} <span class="kanban-count">${apps.filter(a => a.status === s).length}</span>
            </div>
            <div class="kanban-cards">
                ${apps.filter(a => a.status === s).map(a => `
                    <div class="kanban-card">
                        <div class="kc-name">${escapeHtml(a.name)}</div>
                        ${a.phone ? `<div class="kc-meta">📞 ${escapeHtml(a.phone)}</div>` : ''}
                        ${a.telegram_username ? `<div class="kc-meta">✈️ @${escapeHtml(a.telegram_username)}</div>` : ''}
                        ${a.salary_expectation ? `<div class="kc-meta">💰 ${a.salary_expectation} ₴</div>` : ''}
                        ${a.interview_date ? `<div class="kc-meta">📅 ${new Date(a.interview_date).toLocaleDateString('uk-UA')}</div>` : ''}
                        <div class="kc-actions">
                            ${s !== 'offer' ? `<button class="kc-btn" onclick="moveCandidate(${a.id},'${nextCandidateStatus(s)}')">→ ${APP_STATUS_LABEL[nextCandidateStatus(s)]}</button>` : ''}
                            ${s === 'offer' ? `<button class="kc-btn success" onclick="hireCandidate(${a.id})">✅ Найняти</button>` : ''}
                            <button class="kc-btn danger" onclick="moveCandidate(${a.id},'rejected')">✕</button>
                        </div>
                    </div>
                `).join('') || '<div style="color:var(--gray-400);font-size:12px;padding:8px">Порожньо</div>'}
            </div>
        </div>
    `).join('');
}

function nextCandidateStatus(s) {
    const chain = ['new', 'contacted', 'interview', 'offer', 'hired'];
    return chain[chain.indexOf(s) + 1] || 'hired';
}

async function moveCandidate(id, status) {
    await hrFetch(`/applications/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    refreshCandidates();
}

async function hireCandidate(id) {
    if (!await confirmModal('Найняти кандидата? Буде створений запис у команді.', { type: 'danger' })) return;
    const res = await hrFetch(`/applications/${id}/hire`, { method: 'POST', body: JSON.stringify({}) });
    if (res?.success) {
        showNotification(res.message || 'Кандидата найнято!', 'success');
        loadVacancies();
        refreshCandidates();
    }
}

async function addCandidatePrompt(vacancyId) {
    const result = await formModal('Додати кандидата', [
        { key: 'name', label: 'Ім\'я кандидата', required: true, placeholder: 'Іван Петренко' },
        { key: 'phone', label: 'Телефон', placeholder: '+380...' },
        { key: 'tg', label: 'Telegram username', placeholder: '@username' }
    ], { icon: '👤' });
    if (!result) return;
    await hrFetch(`/vacancies/${vacancyId}/applications`, {
        method: 'POST',
        body: JSON.stringify({ name: result.name.trim(), phone: result.phone || null, telegram_username: result.tg || null })
    });
    refreshCandidates();
}

// Vacancy create button
document.getElementById('btnAddVacancy')?.addEventListener('click', async () => {
    const roleKeys = Object.keys(ROLE_LABELS);
    const roleOptions = roleKeys.map(k => ({ value: k, label: ROLE_LABELS[k] }));
    const result = await formModal('Нова вакансія', [
        { key: 'title', label: 'Назва вакансії', required: true, placeholder: 'Аніматор на свята' },
        { key: 'role_type', label: 'Роль', type: 'select', options: roleOptions, required: true },
        { key: 'salary_from', label: 'Зарплата від (₴)', type: 'number', placeholder: '0' },
        { key: 'salary_to', label: 'Зарплата до (₴)', type: 'number', placeholder: '0' },
        { key: 'schedule', label: 'Графік', placeholder: 'Пн-Пт 10:00-18:00' }
    ], { icon: '📋' });
    if (!result) return;
    const priority = (await confirmModal('Терміново?', { type: 'danger' })) ? 'urgent' : 'normal';
    hrFetch('/vacancies', {
        method: 'POST',
        body: JSON.stringify({
            title: result.title.trim(),
            role_type: result.role_type,
            salary_from: parseInt(result.salary_from) || null,
            salary_to: parseInt(result.salary_to) || null,
            schedule: result.schedule || null,
            priority
        })
    }).then(r => { if (r?.success) loadVacancies(); });
});

// ==========================================
// BOOT
// ==========================================

document.addEventListener('DOMContentLoaded', initPage);
