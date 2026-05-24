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
const HR_POOL_LABELS = {
    core: 'Основна команда',
    reserve: 'Резерв',
    blacklisted: 'Чорний список'
};

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

function formatResumeFileSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} Б`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} КБ`;
    return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}

async function hrFetch(path, options = {}, legacyBody = undefined) {
    const token = localStorage.getItem('pzp_token');
    const isFormData = typeof FormData !== 'undefined' && options?.body instanceof FormData;
    const headers = isFormData ? {} : { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (typeof options === 'string') {
        options = {
            method: options,
            body: legacyBody !== undefined ? JSON.stringify(legacyBody) : undefined
        };
    } else if (options && options.body && typeof options.body !== 'string' && !(typeof FormData !== 'undefined' && options.body instanceof FormData)) {
        options = { ...options, body: JSON.stringify(options.body) };
    }
    const resp = await fetch(`/api/hr${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    if (resp.status === 401 || resp.status === 403) {
        localStorage.removeItem('pzp_token');
        location.href = '/';
        return null;
    }
    return resp.json();
}

async function crmApiFetch(path, options = {}) {
    const token = localStorage.getItem('pzp_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (options && options.body && typeof options.body !== 'string') {
        options = { ...options, body: JSON.stringify(options.body) };
    }
    const resp = await fetch(path, { headers, ...options });
    if (resp.status === 401) {
        localStorage.removeItem('pzp_token');
        location.href = '/';
        return null;
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { success: false, status: resp.status, error: data.error || `HTTP ${resp.status}` };
    return data;
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
    if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
    else if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
    const MANAGE_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr', 'admin'];
    canManage = MANAGE_ROLES.includes(user.role);

    removeLegacyAnimatorShiftSummary();
    if (typeof bindLogoutButton === 'function') bindLogoutButton();

    initTabs();
    initScheduleControls();
    initModals();
    initContextMenu();
    initNewTabs();
    const initialTab = getInitialHrTab();
    await activateHrTab(initialTab, { updateHash: false });
    const employeeId = new URLSearchParams(window.location.search).get('employee');
    if (employeeId && /^\d+$/.test(employeeId)) {
        await activateHrTab('team', { updateHash: false });
        openStaffEdit(parseInt(employeeId, 10));
    }
    window.addEventListener('hashchange', () => {
        const tab = getInitialHrTab();
        activateHrTab(tab, { updateHash: false });
    });
    startPolling();
    } catch (err) {
        if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
        if (typeof handleStandaloneInitError === 'function') {
            handleStandaloneInitError('hr', err, (failure) => {
                renderStandaloneFatalError({
                    moduleName: 'hr',
                    containerId: 'tab-today',
                    title: 'Не вдалося відкрити HR',
                    message: 'Авторизація пройшла, але ініціалізація HR-модуля впала.',
                    error: failure
                });
            });
        } else {
            console.error('HR initPage failed:', err);
        }
    }
}

function initNewTabs() {
    document.getElementById('leaveStatusFilter')?.addEventListener('change', loadLeaves);
    document.getElementById('btnNewLeave')?.addEventListener('click', showNewLeaveForm);
    document.getElementById('salaryMonth')?.addEventListener('change', loadSalary);
    document.getElementById('btnAddAdjustment')?.addEventListener('click', showAdjustmentForm);
    document.getElementById('btnStartOnboarding')?.addEventListener('click', showStartOnboarding);
    document.getElementById('btnSaveCompanyStructure')?.addEventListener('click', saveCompanyStructure);
    document.getElementById('hrOrgAutoLayoutBtn')?.addEventListener('click', autoArrangeCompanyOrgChart);
    initCompanyOrgChart();
}

// ==========================================
// TABS
// ==========================================

function initTabs() {
    try {
    document.querySelectorAll('.hr-tab').forEach(tab => {
        tab.addEventListener('click', () => activateHrTab(tab.dataset.tab, { updateHash: true }));
    });
    } catch (err) {
        console.error('HR init failed:', err);
        throw err;
    }
}

function getInitialHrTab() {
    const hashTab = window.location.hash ? window.location.hash.slice(1) : '';
    const queryTab = new URLSearchParams(window.location.search).get('tab') || '';
    const target = queryTab || hashTab || 'today';
    if (target === 'costumes') {
        window.location.replace('/art?tab=costumes');
        return 'today';
    }
    return document.getElementById(`tab-${target}`) ? target : 'today';
}

function removeLegacyAnimatorShiftSummary() {
    document.getElementById('shiftsSummarySection')?.remove();
    document.getElementById('shiftsSummaryContainer')?.closest('.page-section')?.remove();
    document.getElementById('shiftsMonthPicker')?.closest('.page-section')?.remove();
}

async function activateHrTab(target, options = {}) {
    removeLegacyAnimatorShiftSummary();
    const tab = document.querySelector(`.hr-tab[data-tab="${target}"]`);
    const panel = document.getElementById(`tab-${target}`);
    if (!tab || !panel) return;
    document.querySelectorAll('.hr-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.hr-tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    panel.classList.add('active');
    if (options.updateHash) {
        const next = target === 'today' ? window.location.pathname : `${window.location.pathname}#${target}`;
        history.replaceState(null, '', next);
    }
    const loaders = {
        today: loadToday, schedule: loadSchedule, team: loadTeam, structure: loadCompanyStructure,
        reports: loadReports, 'ai-team': renderAITeam, leaves: loadLeaves,
        salary: loadSalary, ratings: loadRatings, onboarding: loadOnboarding,
        vacancies: loadVacancies, reserve: loadReservePool,
        blacklist: loadBlacklist, accounts: loadAccountCenter
    };
    await loaders[target]?.();
    removeLegacyAnimatorShiftSummary();
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
    showHrEditableModal('correctionModal');
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
        document.getElementById('shiftReplace').style.display = '';
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
        document.getElementById('shiftReplace').style.display = 'none';
    }

    showHrEditableModal('shiftModal');
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
            await closeHrEditableModal('shiftModal', true);
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
        await closeHrEditableModal('shiftModal', true);
        await loadSchedule();
    } else {
        showNotification(data?.error || 'Помилка', 'error');
    }
}

async function replaceShift() {
    if (!editingShift?.existing) return;
    const candidates = scheduleStaff
        .filter(s => s.id !== editingShift.staffId && s.is_active !== false)
        .map(s => ({ value: String(s.id), label: `${s.name}${s.role_type ? ' · ' + (ROLE_LABELS[s.role_type] || s.role_type) : ''}` }));
    if (!candidates.length) {
        showNotification('Немає активних співробітників для підміни', 'error');
        return;
    }
    const result = await formModal('Підміна зміни', [
        { key: 'replacementStaffId', label: 'Хто замінює', type: 'select', options: candidates, required: true },
        { key: 'reason', label: 'Причина', placeholder: 'Хвороба, прохання менеджера, термінова заміна...' }
    ], { icon: '🔁', okText: 'Зберегти підміну' });
    if (!result) return;
    const data = await hrFetch(`/shifts/${editingShift.existing.id}/replace`, {
        method: 'POST',
        body: {
            replacement_staff_id: parseInt(result.replacementStaffId, 10),
            reason: result.reason || ''
        }
    });
    if (data?.success) {
        showNotification('Підміну збережено', 'success');
        await closeHrEditableModal('shiftModal', true);
        await loadSchedule();
    } else {
        showNotification(data?.error || 'Помилка підміни', 'error');
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
let accountUsers = [];
let accountRoleHierarchy = [];
let accountStaffOptions = [];
let accountCenterLastUpdatedId = null;
let accountConflicts = null;
let accountDeepLinkApplied = false;

function canManageAccountSecurity() {
    return ['creator', 'director'].includes(AppState.currentUser?.role);
}

function canLinkAccounts() {
    return ['creator', 'director', 'hr'].includes(AppState.currentUser?.role);
}

function normalizeAccountListInput(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function getAccountRoleOptions(defaultRole = 'animator') {
    const roles = accountRoleHierarchy.length ? accountRoleHierarchy : Object.keys(ROLE_LABELS);
    const currentRole = AppState.currentUser?.role;
    return roles
        .filter(role => currentRole === 'creator' || role !== 'creator')
        .map(role => ({ value: role, label: ROLE_LABELS[role] || role }))
        .sort((a, b) => a.label.localeCompare(b.label, 'uk'))
        .map(option => ({ ...option, selected: option.value === defaultRole }));
}

async function loadAccountRoleDefinitions() {
    if (accountRoleHierarchy.length) return;
    const data = await crmApiFetch('/api/users/roles');
    if (Array.isArray(data?.hierarchy)) {
        accountRoleHierarchy = data.hierarchy.filter(role => ROLE_LABELS[role] || role);
    }
}

async function loadAccountStaffOptions(force = false) {
    if (accountStaffOptions.length && !force) return;
    const data = await crmApiFetch('/api/users/staff-options');
    if (data?.success && Array.isArray(data.staff)) {
        accountStaffOptions = data.staff;
    }
}

function getAccountStaffSelectOptions(currentUserId = null) {
    const options = [{ value: '', label: 'Без HR staff-профілю' }];
    accountStaffOptions.forEach(staff => {
        const linkedUserId = staff.linked_user_id || staff.linkedUserId;
        const linkedUsername = staff.linked_username || staff.linkedUsername;
        const locked = linkedUserId && Number(linkedUserId) !== Number(currentUserId)
            ? ` · зайнято: ${linkedUsername || 'інший акаунт'}`
            : '';
        options.push({
            value: String(staff.id),
            label: `${staff.name}${staff.department ? ' · ' + staff.department : ''}${staff.position ? ' · ' + staff.position : ''}${locked}`
        });
    });
    return options;
}

function suggestAccountUsernameFromStaff(staff = {}) {
    const key = String(staff.unique_person_key || '').replace(/\.\w+$/, '');
    const raw = key || staff.name || `staff.${staff.id || ''}`;
    const normalized = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '.')
        .replace(/\.+/g, '.')
        .replace(/^\.+|\.+$/g, '');
    return normalized || `staff.${staff.id || Date.now()}`;
}

function staffRoleToAccountRole(roleType) {
    const role = String(roleType || '').trim();
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
    const roles = accountRoleHierarchy.length ? accountRoleHierarchy : Object.keys(ROLE_LABELS);
    return roles.includes(mapped) ? mapped : 'animator';
}

function accountCredentialPassword(credential) {
    return credential?.password || credential?.oneTimePassword || '';
}

function showOneTimeCredentialModal(credential, title = 'One-time credentials') {
    if (!credential) return;
    const username = credential.username || '';
    const password = accountCredentialPassword(credential);
    const text = `Логін: ${username}\nПароль: ${password}`;
    if (typeof confirmModal === 'function') {
        confirmModal(`${title}\n\n${text}\n\nСкопіюйте зараз: старий пароль у CRM не можна переглянути повторно.`, {
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
    window.alert(`${title}\n\n${text}`);
}

function showManualPasswordResetResult(payload = {}, user = {}) {
    const username = payload.login || payload.username || user.username || '';
    const copyText = username ? `Логін: ${username}` : '';
    const active = payload.isActive !== false;
    const message = [
        username ? `Логін для входу: ${username}` : 'Пароль оновлено.',
        active
            ? 'Пароль оновлено, старі сесії скинуто. Користувач може входити з новим паролем.'
            : 'Пароль оновлено, але акаунт вимкнений. Активуйте акаунт перед входом.'
    ].join('\n');

    if (typeof confirmModal === 'function' && username) {
        confirmModal(message, {
            type: active ? 'success' : 'warning',
            okText: 'Скопіювати логін',
            cancelText: 'Закрити'
        }).then(ok => {
            if (ok && navigator.clipboard) {
                navigator.clipboard.writeText(copyText).then(() => showNotification('Логін скопійовано', 'success'));
            }
        });
        return;
    }
    showNotification(active ? message : 'Пароль оновлено, але акаунт вимкнений', active ? 'success' : 'warning');
}

async function loadAccountConflicts() {
    try {
        const data = await crmApiFetch('/api/users/link-conflicts');
        accountConflicts = data?.success ? data : null;
    } catch {
        accountConflicts = null;
    }
    return accountConflicts;
}

function renderAccountConflictSummary() {
    const root = document.getElementById('accountCenterConflictSummary');
    if (!root) return;
    const counts = accountConflicts?.counts || {};
    const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
    root.classList.toggle('hidden', !accountConflicts);
    if (!accountConflicts) {
        root.innerHTML = '';
        return;
    }
    const parts = [
        `unlinked users: ${Number(counts.unlinkedUsers || 0)}`,
        `unlinked staff: ${Number(counts.unlinkedStaff || 0)}`,
        `inactive links: ${Number(counts.inactiveProfileConflicts || 0)}`,
        `telegram duplicates: ${Number(counts.duplicateTelegramIdentities || 0)}`,
        `ambiguous profiles: ${Number(counts.ambiguousProfiles || 0)}`
    ];
    root.innerHTML = `
        <strong>Контроль звʼязків:</strong>
        <span>${total ? parts.join(' · ') : 'конфліктів у швидкому аудиті не знайдено'}</span>
    `;
}

function applyAccountDeepLinkFilters() {
    if (accountDeepLinkApplied) return;
    const params = new URLSearchParams(window.location.search);
    const accountUser = params.get('accountUser');
    const accountStaff = params.get('accountStaff');
    let target = null;
    if (accountUser && /^\d+$/.test(accountUser)) {
        target = accountUsers.find(user => Number(user.id) === Number(accountUser));
    }
    if (!target && accountStaff && /^\d+$/.test(accountStaff)) {
        target = accountUsers.find(user => Number(user.staff_id) === Number(accountStaff));
    }
    if (!target) return;
    accountDeepLinkApplied = true;
    accountCenterLastUpdatedId = target.id;
    setAccountCenterFilters({
        query: target.username || target.name || target.staff_name || '',
        activeOnly: false,
        showSystem: false
    }, { render: false });
}

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
        const poolStatus = s.hr_pool_status || 'core';
        const poolBadge = poolStatus !== 'core'
            ? `<span class="hr-badge ${poolStatus === 'blacklisted' ? 'hr-badge--warn' : 'hr-badge--ok'}">${HR_POOL_LABELS[poolStatus] || escapeHtml(poolStatus)}</span>`
            : '';
        const accountActions = canLinkAccounts()
            ? (s.has_account
                ? `<div class="hr-team-stats"><button type="button" class="hr-account-toggle" onclick="openAccountForStaff(${Number(s.id)}, this)">Керувати акаунтом</button></div>`
                : `<div class="hr-team-stats">
                    <button type="button" class="hr-account-toggle" onclick="openAccountLinkForStaff(${Number(s.id)}, this)">Привʼязати акаунт</button>
                    ${canManageAccountSecurity() ? `<button type="button" class="hr-account-toggle" onclick="openAccountCreateForStaff(${Number(s.id)}, this)">Створити акаунт</button>` : ''}
                </div>`)
            : '';

        return `<div class="hr-team-card ${s.is_active ? '' : 'inactive'}">
            <div class="hr-team-avatar" style="${s.color ? 'background:' + s.color + '30;color:' + s.color : ''}">${avatar}</div>
            <div class="hr-team-details">
                <div class="hr-team-name">${escapeHtml(s.name)} ${s.is_active ? '' : '<span style="color:var(--gray-400);">(звільнений)</span>'}</div>
                <div class="hr-team-role">${s.position ? escapeHtml(s.position) + ' · ' : ''}${roleLabel}${hireStr ? ' · з ' + hireStr : ''}</div>
                <div class="hr-team-badges">${s.has_face_descriptor ? '<span class="hr-badge hr-badge--ok" title="Фото для камери: є">📸</span>' : '<span class="hr-badge hr-badge--warn" title="Фото для камери: немає">📸❌</span>'} ${s.has_account ? '<span class="hr-badge hr-badge--ok" title="Акаунт CRM: є">🔑</span>' : '<span class="hr-badge hr-badge--warn" title="Акаунт CRM: немає">🔑❌</span>'} ${poolBadge}</div>
                <div class="hr-team-contact">
                    ${phone ? '📞 ' + escapeHtml(phone) + '<br>' : ''}
                    ${emergency ? '⚡ ' + emergency : ''}
                    ${s.address ? `${phone || emergency ? '<br>' : ''}📍 ${escapeHtml(s.address)}` : ''}
                </div>
                ${poolStatus === 'blacklisted' && s.blacklist_reason ? `<div class="hr-team-stats" style="color:var(--danger)">Причина: ${escapeHtml(s.blacklist_reason)}</div>` : ''}
                ${s.hourly_rate > 0 ? `<div class="hr-team-stats">Ставка: ${s.hourly_rate} ₴/год</div>` : ''}
                ${accountActions}
                ${canManage ? `<button class="hr-team-edit" onclick="openStaffEdit(${s.id})">Редагувати</button>` : ''}
            </div>
        </div>`;
    }).join('');
}

// ==========================================
// TAB 3B: ACCOUNT CENTER
// ==========================================

function isSystemAccount(u) {
    const username = String(u.username || '').toLowerCase();
    const name = String(u.name || '').toLowerCase();
    return username.startsWith('openclaw')
        || username.startsWith('open_claw')
        || username.startsWith('open-claw')
        || name.startsWith('openclaw')
        || name.startsWith('open claw');
}

function formatAccountLastSeen(value) {
    if (!value) return 'активність невідома';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'активність невідома';
    return d.toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function normalizeAccountArray(value) {
    return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function formatAccountAccess(u) {
    const roles = [u.role, ...normalizeAccountArray(u.extra_roles || u.extraRoles)]
        .filter(Boolean)
        .map(role => ROLE_LABELS[role] || role);
    const pages = normalizeAccountArray(u.page_allowlist || u.pageAllowlist);
    return `${roles.join(' + ') || 'user'}${pages.length ? ' · pages: ' + pages.join(', ') : ''}`;
}

function getAccountCenterFilterState() {
    return {
        query: String(document.getElementById('accountCenterSearch')?.value || '').trim(),
        activeOnly: document.getElementById('accountCenterActiveOnly')?.checked !== false,
        showSystem: document.getElementById('accountCenterShowSystem')?.checked === true
    };
}

function hasAccountCenterFilters(filters = getAccountCenterFilterState()) {
    return !!filters.query || filters.activeOnly === false || filters.showSystem === true;
}

function setAccountCenterFilters({ query = '', activeOnly = true, showSystem = false } = {}, { render = false } = {}) {
    const search = document.getElementById('accountCenterSearch');
    const activeOnlyInput = document.getElementById('accountCenterActiveOnly');
    const showSystemInput = document.getElementById('accountCenterShowSystem');
    if (search) search.value = query;
    if (activeOnlyInput) activeOnlyInput.checked = activeOnly !== false;
    if (showSystemInput) showSystemInput.checked = showSystem === true;
    if (render) renderAccountCenter();
}

function resetAccountCenterFilters(options = {}) {
    setAccountCenterFilters({ query: '', activeOnly: true, showSystem: false }, { render: options.render !== false });
}

window.resetAccountCenterFilters = resetAccountCenterFilters;

function accountMatchesSearch(user, query) {
    if (!query) return true;
    const haystack = [
        user.username,
        user.name,
        user.role,
        ...(normalizeAccountArray(user.extra_roles || user.extraRoles)),
        user.profile_name,
        user.staff_name,
        user.staff_department,
        user.staff_position
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(query.toLowerCase());
}

async function loadAccountCenter(options = {}) {
    const root = document.getElementById('accountCenterList');
    if (root) root.innerHTML = '<div class="hr-account-empty">Завантаження акаунтів...</div>';
    await Promise.all([loadAccountRoleDefinitions(), loadAccountConflicts()]);
    const data = await crmApiFetch('/api/users');
    if (!Array.isArray(data)) {
        if (root) root.innerHTML = `<div class="hr-account-empty">Центр акаунтів недоступний: ${escapeHtml(data?.error || 'немає доступу')}</div>`;
        return;
    }
    accountUsers = data;
    if (options.resetFilters) {
        resetAccountCenterFilters({ render: false });
    }
    applyAccountDeepLinkFilters();
    renderAccountCenter();
    const search = document.getElementById('accountCenterSearch');
    const activeOnly = document.getElementById('accountCenterActiveOnly');
    const showSystem = document.getElementById('accountCenterShowSystem');
    const createBtn = document.getElementById('accountCreateBtn');
    const adminNote = document.getElementById('accountCenterAdminNote');
    const canManageSecurity = canManageAccountSecurity();
    if (createBtn) createBtn.classList.toggle('hidden', !canManageSecurity);
    if (adminNote) adminNote.classList.toggle('hidden', canManageSecurity);
    if (search) search.oninput = renderAccountCenter;
    if (activeOnly) activeOnly.onchange = renderAccountCenter;
    if (showSystem) showSystem.onchange = renderAccountCenter;
}

window.refreshAccountCenter = async function(button) {
    if (button) button.disabled = true;
    try {
        await loadAccountCenter();
    } finally {
        if (button) button.disabled = false;
    }
};

function renderAccountCenter() {
    const root = document.getElementById('accountCenterList');
    if (!root) return;
    renderAccountConflictSummary();
    const canManageSecurity = canManageAccountSecurity();
    const filters = getAccountCenterFilterState();
    const query = filters.query.toLowerCase();
    const activeOnly = filters.activeOnly;
    const showSystem = filters.showSystem;
    let rows = accountUsers;
    if (!showSystem) rows = rows.filter(u => !isSystemAccount(u));
    if (activeOnly) rows = rows.filter(u => u.is_active !== false);
    if (query) {
        rows = rows.filter(u => accountMatchesSearch(u, query));
    }
    const activeHumanCount = accountUsers.filter(u => u.is_active !== false && !isSystemAccount(u)).length;
    const filterNotice = document.getElementById('accountCenterFilterNotice');
    const resetBtn = document.getElementById('accountCenterResetFiltersBtn');
    const hasFilters = hasAccountCenterFilters(filters);
    const stats = document.getElementById('accountCenterStats');
    if (stats) {
        stats.textContent = `${rows.length} показано · ${activeHumanCount} активних · ${accountUsers.length} всього`;
    }
    if (resetBtn) resetBtn.classList.toggle('hidden', !hasFilters);
    if (filterNotice) {
        filterNotice.classList.toggle('hidden', !hasFilters);
        if (hasFilters) {
            const parts = [];
            if (filters.query) parts.push(`пошук “${escapeHtml(filters.query)}”`);
            if (filters.activeOnly === false) parts.push('показ вимкнених');
            if (filters.showSystem) parts.push('system-акаунти');
            filterNotice.innerHTML = `
                <strong>Увімкнено фільтр:</strong>
                <span>${parts.join(' · ') || 'нестандартний режим перегляду'}</span>
                <button type="button" class="hr-account-inline-action" onclick="resetAccountCenterFilters()">Показати всі активні</button>
            `;
        }
    }
    if (!rows.length) {
        root.innerHTML = `<div class="hr-account-empty">
            <strong>${hasFilters ? 'Акаунтів за цим фільтром немає.' : 'Активних акаунтів немає.'}</strong>
            <span>${hasFilters ? 'Список не порожній: зараз його обмежують пошук або чекбокси.' : 'Увімкніть показ вимкнених або створіть новий акаунт.'}</span>
            ${hasFilters ? '<button type="button" class="hr-account-empty-action" onclick="resetAccountCenterFilters()">Скинути фільтри</button>' : ''}
        </div>`;
        return;
    }
    root.innerHTML = rows.map(u => {
        const active = u.is_active !== false;
        const staff = u.staff_name ? `${escapeHtml(u.staff_name)}${u.staff_department ? ' · ' + escapeHtml(u.staff_department) : ''}` : 'не привʼязано до staff';
        const role = formatAccountAccess(u);
        const recentlyUpdated = Number(accountCenterLastUpdatedId) === Number(u.id);
        return `<article class="hr-account-row ${active ? '' : 'is-disabled'} ${recentlyUpdated ? 'is-recently-updated' : ''}">
            <div class="hr-account-avatar">${escapeHtml((u.name || u.username || '?').slice(0, 1).toUpperCase())}</div>
            <div class="hr-account-main">
                <div class="hr-account-title">
                    <strong>${escapeHtml(u.name || u.username || 'Без імені')}</strong>
                    <span>${escapeHtml(u.username || '')}</span>
                </div>
                <div class="hr-account-meta">${escapeHtml(role)} · ${staff} · ${formatAccountLastSeen(u.last_seen_at)}</div>
            </div>
            <div class="hr-account-actions">
                <span class="hr-account-state ${active ? 'ok' : 'off'}">${active ? 'активний' : 'вимкнений'}</span>
                ${u.staff_id ? `<a class="hr-account-link" href="/hr?employee=${encodeURIComponent(u.staff_id)}">HR профіль</a>` : ''}
                ${canManageSecurity ? `<button type="button" class="hr-account-toggle" onclick="openAccountProfileModal(${Number(u.id)}, this)">Профіль</button>` : ''}
                ${canManageSecurity ? `<button type="button" class="hr-account-toggle" onclick="openAccountPasswordModal(${Number(u.id)}, this)">Пароль</button>` : ''}
                ${canManageSecurity ? `<button type="button" class="hr-account-toggle" onclick="openAccountAccessEditor(${Number(u.id)}, this)">Доступ</button>` : ''}
                <button type="button" class="hr-account-toggle" onclick="toggleAccountActive(${Number(u.id)}, ${active ? 'false' : 'true'}, this)">${active ? 'Вимкнути' : 'Активувати'}</button>
            </div>
        </article>`;
    }).join('');
}

window.openAccountCreateModal = async function(button, context = {}) {
    if (!canManageAccountSecurity()) {
        showNotification('Створення акаунтів доступне тільки creator/director', 'error');
        return;
    }
    await loadAccountRoleDefinitions();
    await loadAccountStaffOptions();
    const contextStaff = context.staff || (context.staffId ? teamStaff.find(staff => Number(staff.id) === Number(context.staffId)) : null);
    const defaultStaffId = contextStaff?.id ? String(contextStaff.id) : '';
    const defaultName = contextStaff?.name || '';
    const defaultUsername = context.username || (contextStaff ? suggestAccountUsernameFromStaff(contextStaff) : '');
    const defaultRole = staffRoleToAccountRole(context.role || contextStaff?.role_type || 'animator');
    const result = await formModal('Створити CRM акаунт', [
        { key: 'name', label: 'Імʼя в CRM', required: true, defaultValue: defaultName, placeholder: 'Женя Аніматор' },
        { key: 'username', label: 'Логін', required: true, defaultValue: defaultUsername, placeholder: 'zhenya.animator' },
        { key: 'password', label: 'Пароль вручну або порожньо для one-time', type: 'password', placeholder: 'Порожньо = CRM згенерує одноразовий пароль' },
        { key: 'confirmPassword', label: 'Повторити пароль, якщо вводите вручну', type: 'password' },
        { key: 'role', label: 'Основна роль', type: 'select', defaultValue: defaultRole, options: getAccountRoleOptions(defaultRole) },
        { key: 'staffId', label: 'HR staff-профіль', type: 'select', defaultValue: defaultStaffId, options: getAccountStaffSelectOptions() },
        { key: 'extraRoles', label: 'Додаткові ролі через кому', placeholder: 'manager, accountant' },
        { key: 'pageAllowlist', label: 'Додаткові сторінки через кому', placeholder: '/maysternya-doli' }
    ], {
        icon: '👤',
        type: 'info',
        okText: 'Створити',
        className: 'account-create-modal'
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
    if (button) button.disabled = true;
    const response = await crmApiFetch('/api/users', {
        method: 'POST',
        body: {
            username: String(result.username || '').trim(),
            password: issueOneTime ? undefined : password,
            issueOneTime,
            name: String(result.name || '').trim(),
            role: result.role || 'animator',
            staffId: result.staffId || null,
            extraRoles: normalizeAccountListInput(result.extraRoles),
            pageAllowlist: normalizeAccountListInput(result.pageAllowlist)
        }
    });
    if (button) button.disabled = false;
    if (!response?.success) {
        showNotification(response?.error || 'Не вдалося створити акаунт', 'error');
        return;
    }
    if (response.credential) {
        showOneTimeCredentialModal(response.credential, `Акаунт ${response.user?.username || result.username} створено`);
    } else {
        showNotification(`Акаунт ${response.user?.username || result.username} створено. Передайте пароль користувачу напряму.`, 'success');
    }
    accountCenterLastUpdatedId = response.user?.id || null;
    await loadAccountStaffOptions(true);
    await loadTeam();
    await loadAccountCenter({ resetFilters: true });
};

window.openAccountCreateForStaff = async function(staffId, button) {
    const staff = teamStaff.find(item => Number(item.id) === Number(staffId));
    if (!staff) {
        showNotification('Staff-профіль не знайдено', 'error');
        return;
    }
    await openAccountCreateModal(button, { staff });
};

window.openAccountLinkForStaff = async function(staffId, button) {
    if (!canLinkAccounts()) {
        showNotification('Привʼязка акаунтів доступна тільки creator/director/hr', 'error');
        return;
    }
    const staff = teamStaff.find(item => Number(item.id) === Number(staffId));
    if (!staff) {
        showNotification('Staff-профіль не знайдено', 'error');
        return;
    }
    if (button) button.disabled = true;
    await loadAccountCenter();
    if (button) button.disabled = false;
    const candidates = accountUsers
        .filter(user => user.is_active !== false)
        .filter(user => !user.staff_id || Number(user.staff_id) === Number(staffId))
        .filter(user => !isSystemAccount(user))
        .map(user => ({
            value: String(user.id),
            label: `${user.name || user.username} · ${user.username} · ${user.role}${user.staff_id ? ' · вже привʼязано сюди' : ''}`
        }));
    if (!candidates.length) {
        showNotification('Немає вільних активних акаунтів для привʼязки', 'warning');
        return;
    }
    const result = await formModal(`Привʼязати акаунт · ${staff.name}`, [
        { key: 'userId', label: 'CRM акаунт', type: 'select', required: true, options: candidates }
    ], {
        icon: '🔗',
        type: 'info',
        okText: 'Привʼязати',
        className: 'account-link-modal'
    });
    if (!result?.userId) return;
    const response = await crmApiFetch(`/api/staff/${encodeURIComponent(staffId)}/link`, {
        method: 'POST',
        body: { userId: Number(result.userId) }
    });
    if (!response?.success) {
        showNotification(response?.error || 'Не вдалося привʼязати акаунт', 'error');
        return;
    }
    showNotification('Акаунт привʼязано до staff-профілю', 'success');
    accountCenterLastUpdatedId = Number(result.userId);
    await loadAccountStaffOptions(true);
    await loadTeam();
    await loadAccountCenter({ resetFilters: true });
};

window.openAccountForStaff = async function(staffId, button) {
    if (button) button.disabled = true;
    await activateHrTab('accounts', { updateHash: true });
    if (button) button.disabled = false;
    const target = accountUsers.find(user => Number(user.staff_id) === Number(staffId));
    const staff = teamStaff.find(item => Number(item.id) === Number(staffId));
    if (!target) {
        showNotification('Акаунт для цього staff-профілю не знайдено в центрі акаунтів', 'warning');
        return;
    }
    accountCenterLastUpdatedId = target.id;
    setAccountCenterFilters({
        query: target.username || staff?.name || '',
        activeOnly: false,
        showSystem: false
    }, { render: true });
};

async function openAccountProfileModal(userId, button) {
    if (!canManageAccountSecurity()) {
        showNotification('Редагування профілю доступне тільки creator/director', 'error');
        return;
    }
    const user = accountUsers.find(item => Number(item.id) === Number(userId));
    if (!user) return;
    await loadAccountStaffOptions();
    const result = await formModal(`Профіль акаунта · ${user.username}`, [
        { key: 'name', label: 'Імʼя в CRM', required: true, defaultValue: user.name || user.username || '' },
        { key: 'username', label: 'Логін', required: true, defaultValue: user.username || '', placeholder: 'latin.login' },
        { key: 'staffId', label: 'HR staff-профіль', type: 'select', defaultValue: user.staff_id ? String(user.staff_id) : '', options: getAccountStaffSelectOptions(user.id) }
    ], {
        icon: '👥',
        type: 'info',
        okText: 'Зберегти профіль',
        className: 'account-profile-modal'
    });
    if (!result) return;
    const username = String(result.username || '').trim();
    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
        showNotification('Логін: 3-50 символів, латиниця/цифри/крапка/дефіс/підкреслення', 'error');
        return;
    }
    if (button) button.disabled = true;
    const response = await crmApiFetch(`/api/users/${encodeURIComponent(userId)}/profile`, {
        method: 'PATCH',
        body: {
            name: String(result.name || '').trim(),
            username,
            staffId: result.staffId || null
        }
    });
    if (button) button.disabled = false;
    if (!response?.success) {
        showNotification(response?.error || 'Не вдалося оновити профіль акаунта', 'error');
        return;
    }
    showNotification('Профіль акаунта оновлено', 'success');
    accountCenterLastUpdatedId = userId;
    await loadAccountStaffOptions(true);
    await loadAccountCenter({ resetFilters: true });
}

async function openAccountPasswordModal(userId, button) {
    if (!canManageAccountSecurity()) {
        showNotification('Зміна пароля доступна тільки creator/director', 'error');
        return;
    }
    const user = accountUsers.find(item => Number(item.id) === Number(userId));
    if (!user) return;
    const result = await formModal(`Пароль · ${user.username}`, [
        { key: 'mode', label: 'Режим', type: 'select', defaultValue: 'issue', options: [
            { value: 'issue', label: 'Згенерувати одноразовий пароль' },
            { value: 'manual', label: 'Ввести новий пароль вручну' }
        ] },
        { key: 'newPassword', label: 'Новий пароль вручну', type: 'password', placeholder: 'Заповніть тільки для ручного режиму' },
        { key: 'confirmPassword', label: 'Повторити пароль вручну', type: 'password' }
    ], {
        icon: '🔐',
        type: 'warning',
        okText: 'Оновити доступ',
        className: 'account-password-modal'
    });
    if (!result) return;
    const issueOneTime = result.mode !== 'manual';
    const password = String(result.newPassword || '');
    if (!issueOneTime && password.length < 6) {
        showNotification('Пароль має бути не менше 6 символів', 'error');
        return;
    }
    if (!issueOneTime && password !== String(result.confirmPassword || '')) {
        showNotification('Паролі не збігаються', 'error');
        return;
    }
    if (button) button.disabled = true;
    const response = await crmApiFetch(`/api/users/${encodeURIComponent(userId)}/reset-password`, {
        method: 'POST',
        body: issueOneTime ? { issueOneTime: true } : { newPassword: password }
    });
    if (button) button.disabled = false;
    if (!response?.success) {
        showNotification(response?.error || 'Не вдалося змінити пароль', 'error');
        return;
    }
    if (response.credential) {
        showOneTimeCredentialModal(response.credential, `Пароль для ${response.username || user.username} перевипущено`);
    } else {
        showManualPasswordResetResult(response, user);
    }
    accountCenterLastUpdatedId = userId;
    await loadAccountCenter({ resetFilters: true });
}

async function openAccountAccessEditor(userId, button) {
    if (!canManageAccountSecurity()) {
        showNotification('Зміна доступу доступна тільки creator/director', 'error');
        return;
    }
    const user = accountUsers.find(item => Number(item.id) === Number(userId));
    if (!user) return;
    const currentExtra = normalizeAccountArray(user.extra_roles || user.extraRoles).join(', ');
    const currentPages = normalizeAccountArray(user.page_allowlist || user.pageAllowlist).join(', ');
    await loadAccountRoleDefinitions();
    const formResult = await formModal(`Доступ акаунта · ${user.username}`, [
        { key: 'role', label: 'Основна роль', type: 'select', defaultValue: user.role || 'animator', options: getAccountRoleOptions(user.role || 'animator') },
        { key: 'extraRoles', label: 'Додаткові ролі через кому', defaultValue: currentExtra, placeholder: 'manager, accountant' },
        { key: 'pageAllowlist', label: 'Додаткові сторінки через кому', defaultValue: currentPages, placeholder: '/maysternya-doli' }
    ], {
        icon: '🛂',
        type: 'info',
        okText: 'Оновити доступ',
        className: 'account-access-modal'
    });
    if (!formResult) return;
    const extraRoles = normalizeAccountListInput(formResult.extraRoles);
    const pageAllowlist = normalizeAccountListInput(formResult.pageAllowlist);
    if (button) button.disabled = true;
    const response = await crmApiFetch(`/api/users/${encodeURIComponent(userId)}/role`, {
        method: 'PATCH',
        body: { role: formResult.role || user.role, extraRoles, pageAllowlist }
    });
    if (button) button.disabled = false;
    if (!response?.success) {
        showNotification(response?.error || 'Не вдалося оновити доступ акаунта', 'error');
        return;
    }
    showNotification('Доступ акаунта оновлено. Після нового логіну права перерахуються автоматично.', 'success');
    accountCenterLastUpdatedId = userId;
    await loadAccountCenter({ resetFilters: true });
}

async function toggleAccountActive(userId, isActive, button) {
    if (!Number.isFinite(Number(userId))) return;
    const label = isActive ? 'активувати акаунт' : 'вимкнути акаунт';
    let ok = false;
    if (typeof confirmModal === 'function') {
        ok = await confirmModal(`Підтвердити: ${label}?`, { type: isActive ? 'info' : 'warning', okText: isActive ? 'Активувати' : 'Вимкнути' });
    } else if (typeof showNotification === 'function') {
        showNotification('Підтвердження недоступне. Оновіть сторінку і повторіть дію.', 'error');
    }
    if (!ok) return;
    if (button) button.disabled = true;
    const result = await crmApiFetch(`/api/users/${encodeURIComponent(userId)}/active`, {
        method: 'PATCH',
        body: { isActive }
    });
    if (button) button.disabled = false;
    if (!result?.success) {
        showNotification(result?.error || 'Не вдалося оновити акаунт', 'error');
        return;
    }
    showNotification(isActive ? 'Акаунт активовано' : 'Акаунт вимкнено', 'success');
    await loadAccountCenter();
}

function openStaffEdit(staffId) {
    const s = teamStaff.find(st => st.id === staffId);
    if (!s) return;

    document.getElementById('editStaffId').value = staffId;
    document.getElementById('editRoleType').value = s.role_type || 'animator';
    document.getElementById('editPhone').value = s.phone || '';
    document.getElementById('editBirthDate').value = s.birth_date ? s.birth_date.substring(0, 10) : '';
    document.getElementById('editAddress').value = s.address || '';
    document.getElementById('editEmergencyContact').value = s.emergency_contact || '';
    document.getElementById('editEmergencyPhone').value = s.emergency_phone || '';
    document.getElementById('editHourlyRate').value = s.hourly_rate || 0;
    document.getElementById('editTelegramId').value = s.telegram_id || '';
    document.getElementById('editTelegramUsername').value = s.telegram_username || '';
    document.getElementById('editContractType').value = s.contract_type || 'parttime';
    document.getElementById('editPoolStatus').value = s.hr_pool_status || 'core';
    document.getElementById('editBlacklistReason').value = s.blacklist_reason || '';
    document.getElementById('editSkills').value = (s.skills || []).join(', ');
    document.getElementById('editNotes').value = s.notes || '';

    showHrEditableModal('staffEditModal');
}

async function saveStaffEdit() {
    const staffId = document.getElementById('editStaffId')?.value;
    const body = {
        role_type: document.getElementById('editRoleType')?.value,
        phone: document.getElementById('editPhone')?.value || null,
        birth_date: document.getElementById('editBirthDate')?.value || null,
        address: document.getElementById('editAddress')?.value || null,
        emergency_contact: document.getElementById('editEmergencyContact')?.value || null,
        emergency_phone: document.getElementById('editEmergencyPhone')?.value || null,
        hourly_rate: parseFloat(document.getElementById('editHourlyRate')?.value) || 0,
        telegram_id: document.getElementById('editTelegramId')?.value || null,
        telegram_username: document.getElementById('editTelegramUsername')?.value || null,
        contract_type: document.getElementById('editContractType')?.value || 'parttime',
        hr_pool_status: document.getElementById('editPoolStatus')?.value || 'core',
        blacklist_reason: document.getElementById('editBlacklistReason')?.value || null,
        skills: document.getElementById('editSkills')?.value ? document.getElementById('editSkills')?.value.split(',').map(s => s.trim()).filter(Boolean) : null,
        notes: document.getElementById('editNotes')?.value || null
    };

    const data = await hrFetch(`/staff/${staffId}`, {
        method: 'PUT',
        body: JSON.stringify(body)
    });
    if (data && data.success) {
        showNotification('Профіль оновлено', 'success');
        await closeHrEditableModal('staffEditModal', true);
        await loadTeam();
    } else {
        showNotification(data?.error || 'Помилка', 'error');
    }
}

// ==========================================
// BACKOFFICE FOUNDATION: STRUCTURE / POOLS
// ==========================================

const DEFAULT_COMPANY_STRUCTURE_TEXT = [
    'Директор',
    '  Заступник директора',
    '    Топ-менеджер -> Менеджер(и)',
    '    HR',
    '    Бухгалтер',
    '    Арт-директор -> Адміністратори -> Старший батутіст, Аніматори, Офіціанти, Бариста, Рецепція',
    '    Маркетолог',
    '    IT-спеціаліст',
    '  Шеф-кухар -> Кухарі, Мийка',
    '  Шеф-кондитер -> Кондитери, Мийка цех',
    '  Технічний персонал -> Гардероб, Прибирання, Завгосп'
].join('\n');

const ORG_TONE_LABELS = {
    gold: 'Керівництво',
    blue: 'Управління',
    purple: 'Операції',
    violet: 'Підтримка'
};

const ORG_LANE_LABELS = {
    root: 'Верхній рівень',
    deputy: 'Заступник',
    leadership: 'Керівний контур',
    operations: 'Операційний контур',
    support: 'Підтримка'
};

const ORG_ALLOWED_TONES = Object.keys(ORG_TONE_LABELS);
const ORG_ALLOWED_LANES = Object.keys(ORG_LANE_LABELS);
const ORG_CANVAS_MIN_WIDTH = 1280;
const ORG_CANVAS_MIN_HEIGHT = 900;
const ORG_CANVAS_PADDING = 72;
const ORG_NODE_WIDTH = 168;
const ORG_NODE_HEIGHT = 78;
const ORG_ROOT_NODE_WIDTH = 220;
const ORG_ROOT_NODE_HEIGHT = 98;
const DEFAULT_COMPANY_STRUCTURE_POSITIONS = {
    director: { x: 530, y: 24 },
    deputy_director: { x: 555, y: 158 },
    top_manager: { x: 210, y: 300 },
    managers: { x: 210, y: 438 },
    hr: { x: 390, y: 300 },
    accountant: { x: 570, y: 300 },
    art_director: { x: 750, y: 300 },
    admins: { x: 750, y: 438 },
    marketer: { x: 930, y: 300 },
    it_specialist: { x: 1110, y: 300 },
    senior_trampoline: { x: 260, y: 575 },
    trampoline_instructors: { x: 245, y: 710 },
    animators: { x: 455, y: 575 },
    waiters: { x: 655, y: 575 },
    barista: { x: 855, y: 575 },
    reception: { x: 1055, y: 575 },
    chef: { x: 300, y: 815 },
    cooks: { x: 210, y: 940 },
    dishwash: { x: 390, y: 940 },
    pastry_chef: { x: 605, y: 815 },
    pastry_team: { x: 525, y: 940 },
    pastry_wash: { x: 705, y: 940 },
    technical_staff: { x: 910, y: 815 },
    wardrobe: { x: 830, y: 940 },
    cleaning: { x: 1010, y: 940 },
    facilities: { x: 1190, y: 940 }
};

const DEFAULT_COMPANY_STRUCTURE_NODES = [
    { id: 'director', title: 'Директор', description: 'Фінальне рішення, стратегія, ресурси і правила роботи компанії.', tone: 'gold', lane: 'root', parentId: null, stack: null, order: 10, meta: 'центр рішень' },
    { id: 'deputy_director', title: 'Заступник директора', description: 'Тримає операційний контур, контролює виконання рішень і синхронізує керівників напрямів.', tone: 'blue', lane: 'deputy', parentId: 'director', stack: null, order: 20, meta: 'операційне керування' },
    { id: 'top_manager', title: 'Топ-менеджер', description: 'Веде менеджерський блок, контролює продажі, бронювання і якість сервісного циклу.', tone: 'blue', lane: 'leadership', parentId: 'deputy_director', stack: 'management', order: 30, meta: 'менеджмент' },
    { id: 'managers', title: 'Менеджер(и)', description: 'Працюють із клієнтами, лідами, бронюваннями і щоденними задачами.', tone: 'blue', lane: 'leadership', parentId: 'top_manager', stack: 'management', order: 31, meta: 'оператори CRM' },
    { id: 'hr', title: 'HR', description: 'Набір, структура команди, зміни, onboarding, дисципліна і кадровий контур.', tone: 'blue', lane: 'leadership', parentId: 'deputy_director', stack: null, order: 40, meta: 'люди' },
    { id: 'accountant', title: 'Бухгалтер', description: 'Фінансові документи, зарплати, звірки і контроль обліку.', tone: 'blue', lane: 'leadership', parentId: 'deputy_director', stack: null, order: 50, meta: 'фінанси' },
    { id: 'art_director', title: 'Арт-директор', description: 'Керує творчим виробництвом, програмами, костюмами, дизайнами і випускними матеріалами.', tone: 'purple', lane: 'leadership', parentId: 'deputy_director', stack: 'art', order: 60, meta: 'креатив' },
    { id: 'admins', title: 'Адміністратори', description: 'Підтримують зал, комунікацію з гостями, порядок і операційне закриття змін.', tone: 'purple', lane: 'leadership', parentId: 'art_director', stack: 'art', order: 61, meta: 'зал' },
    { id: 'marketer', title: 'Маркетолог', description: 'Маркетинг, комунікації, контент і кампанії для залучення клієнтів.', tone: 'blue', lane: 'leadership', parentId: 'deputy_director', stack: null, order: 70, meta: 'попит' },
    { id: 'it_specialist', title: 'IT-спеціаліст', description: 'Підтримує CRM, технічні інтеграції, обладнання і цифрові процеси.', tone: 'violet', lane: 'leadership', parentId: 'deputy_director', stack: null, order: 80, meta: 'системи' },
    { id: 'senior_trampoline', title: 'Старший батутіст', description: 'Відповідає за батутну зону, інструкторів, безпеку і якість активностей.', tone: 'purple', lane: 'operations', parentId: 'admins', stack: 'trampoline', order: 90, meta: 'батутна зона' },
    { id: 'trampoline_instructors', title: 'Батутісти-інструктори', description: 'Проводять активності, стежать за безпекою дітей і підтримують правила зони.', tone: 'purple', lane: 'operations', parentId: 'senior_trampoline', stack: 'trampoline', order: 91, meta: 'інструктори' },
    { id: 'animators', title: 'Аніматори', description: 'Проводять програми, інтерактиви та дитячі свята згідно зі сценарієм.', tone: 'purple', lane: 'operations', parentId: 'art_director', stack: null, order: 100, meta: 'програми' },
    { id: 'waiters', title: 'Офіціанти', description: 'Сервіс столів, подача, комунікація з гостями і підтримка банкетів.', tone: 'purple', lane: 'operations', parentId: 'admins', stack: null, order: 110, meta: 'сервіс' },
    { id: 'barista', title: 'Бариста', description: 'Кавовий бар, напої, швидкість видачі і якість продукту.', tone: 'purple', lane: 'operations', parentId: 'admins', stack: null, order: 120, meta: 'бар' },
    { id: 'reception', title: 'Рецепція', description: 'Перша точка контакту гостей, вхідний потік, оплати і навігація.', tone: 'purple', lane: 'operations', parentId: 'admins', stack: null, order: 130, meta: 'вхід' },
    { id: 'chef', title: 'Шеф-кухар', description: 'Керує кухнею, меню, якістю страв, закупками і кухонною дисципліною.', tone: 'violet', lane: 'support', parentId: 'deputy_director', stack: 'kitchen', order: 140, meta: 'кухня' },
    { id: 'cooks', title: 'Кухарі', description: 'Готують страви, тримають стандарти та швидкість видачі.', tone: 'violet', lane: 'support', parentId: 'chef', stack: 'kitchen', order: 141, meta: 'виробництво' },
    { id: 'dishwash', title: 'Мийка', description: 'Посуд, чистота кухонного циклу і санітарна підтримка.', tone: 'violet', lane: 'support', parentId: 'chef', stack: 'kitchen', order: 142, meta: 'санітарія' },
    { id: 'pastry_chef', title: 'Шеф-кондитер', description: 'Керує кондитерським напрямом, виробництвом десертів і стандартами якості.', tone: 'violet', lane: 'support', parentId: 'deputy_director', stack: 'pastry', order: 150, meta: 'кондитерка' },
    { id: 'pastry_team', title: 'Кондитери', description: 'Виготовляють десерти, декор і кондитерські позиції для подій.', tone: 'violet', lane: 'support', parentId: 'pastry_chef', stack: 'pastry', order: 151, meta: 'виробництво' },
    { id: 'pastry_wash', title: 'Мийка цех', description: 'Підтримує чистоту і порядок у кондитерському цеху.', tone: 'violet', lane: 'support', parentId: 'pastry_chef', stack: 'pastry', order: 152, meta: 'санітарія' },
    { id: 'technical_staff', title: 'Технічний персонал', description: 'Технічна готовність простору, ремонт, обладнання і господарські задачі.', tone: 'violet', lane: 'support', parentId: 'deputy_director', stack: 'technical', order: 160, meta: 'інфраструктура' },
    { id: 'wardrobe', title: 'Гардероб', description: 'Одяг гостей, контроль речей і порядок у гардеробній зоні.', tone: 'violet', lane: 'support', parentId: 'technical_staff', stack: 'technical', order: 161, meta: 'гості' },
    { id: 'cleaning', title: 'Прибирання', description: 'Чистота залу, санвузлів, службових зон і підтримка стандартів протягом дня.', tone: 'violet', lane: 'support', parentId: 'technical_staff', stack: 'technical', order: 162, meta: 'чистота' },
    { id: 'facilities', title: 'Завгосп', description: 'Господарський запас, дрібний ремонт, закупки і побутова підтримка.', tone: 'violet', lane: 'support', parentId: 'technical_staff', stack: 'technical', order: 163, meta: 'господарство' }
];

let companyStructureNodes = [];
let selectedCompanyStructureNodeId = 'director';
let companyOrgLinkingNodeId = null;
let companyOrgDragState = null;
let companyOrgSaveTimer = null;
let companyOrgKeyboardBound = false;
let companyOrgSuppressNextClick = false;

function cloneCompanyStructureNodes(nodes) {
    return (nodes || []).map(node => ({ ...node }));
}

function normalizeCompanyStructureNodeId(value, fallback) {
    return String(value || fallback || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_{2,}/g, '_')
        .slice(0, 64) || fallback;
}

function clampCompanyOrgCoord(value, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.max(0, Math.min(max, Math.round(numeric)));
}

function companyOrgNodeSize(node = {}) {
    return node.tone === 'gold'
        ? { width: ORG_ROOT_NODE_WIDTH, height: ORG_ROOT_NODE_HEIGHT }
        : { width: ORG_NODE_WIDTH, height: ORG_NODE_HEIGHT };
}

function companyOrgDefaultPosition(node, index) {
    if (node?.id && DEFAULT_COMPANY_STRUCTURE_POSITIONS[node.id]) {
        return DEFAULT_COMPANY_STRUCTURE_POSITIONS[node.id];
    }
    const laneIndex = Math.max(0, ORG_ALLOWED_LANES.indexOf(node?.lane || 'leadership'));
    const column = index % 6;
    const row = Math.floor(index / 6);
    return {
        x: 80 + column * 190,
        y: 80 + laneIndex * 170 + row * 110
    };
}

function normalizeCompanyStructureNodes(nodes) {
    const source = Array.isArray(nodes) && nodes.length ? nodes : DEFAULT_COMPANY_STRUCTURE_NODES;
    const seen = new Set();
    const normalized = source.map((node, index) => {
        const raw = node && typeof node === 'object' ? node : {};
        const baseId = normalizeCompanyStructureNodeId(raw.id, `node_${index + 1}`);
        let id = baseId;
        const suffixBase = (baseId || `node_${index + 1}`).slice(0, 58);
        let suffix = 2;
        while (seen.has(id)) {
            id = `${suffixBase}_${suffix}`.slice(0, 64);
            suffix += 1;
        }
        seen.add(id);
        const tone = ORG_ALLOWED_TONES.includes(raw.tone) ? raw.tone : 'blue';
        const lane = ORG_ALLOWED_LANES.includes(raw.lane) ? raw.lane : 'leadership';
        const order = Number.isFinite(Number(raw.order)) ? Number(raw.order) : index;
        const fallbackPosition = companyOrgDefaultPosition({ id, lane, tone }, index);
        return {
            id,
            title: String(raw.title || 'Роль').trim().slice(0, 80) || 'Роль',
            description: String(raw.description || 'Роль у структурі компанії.').trim().slice(0, 1200),
            tone,
            lane,
            parentId: raw.parentId ? normalizeCompanyStructureNodeId(raw.parentId, '') : null,
            stack: raw.stack ? String(raw.stack).trim().slice(0, 64) : null,
            order,
            x: clampCompanyOrgCoord(raw.x, 5000) ?? fallbackPosition.x,
            y: clampCompanyOrgCoord(raw.y, 5000) ?? fallbackPosition.y,
            meta: raw.meta ? String(raw.meta).trim().slice(0, 80) : null
        };
    });
    const ids = new Set(normalized.map(node => node.id));
    const byId = new Map(normalized.map(node => [node.id, node]));
    return normalized.map((node, index) => {
        const fallbackPosition = companyOrgDefaultPosition(node, index);
        let parentId = node.parentId && ids.has(node.parentId) && node.parentId !== node.id ? node.parentId : null;
        const visited = new Set([node.id]);
        let cursor = parentId;
        while (cursor) {
            if (visited.has(cursor)) {
                parentId = null;
                break;
            }
            visited.add(cursor);
            cursor = byId.get(cursor)?.parentId || null;
        }
        return {
            ...node,
            parentId,
            x: clampCompanyOrgCoord(node.x, 5000) ?? fallbackPosition.x,
            y: clampCompanyOrgCoord(node.y, 5000) ?? fallbackPosition.y
        };
    });
}

function sortCompanyStructureNodes(nodes) {
    return [...(nodes || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.title).localeCompare(String(b.title), 'uk'));
}

function companyStructureNodeById(id) {
    return companyStructureNodes.find(node => node.id === id) || null;
}

function companyStructureNodesByLane(lane) {
    return sortCompanyStructureNodes(companyStructureNodes.filter(node => node.lane === lane));
}

function companyStructureTextFromNodes(nodes) {
    const byId = new Map((nodes || []).map(node => [node.id, node]));
    return sortCompanyStructureNodes(nodes).map(node => {
        const parent = node.parentId ? byId.get(node.parentId) : null;
        return parent ? `${node.title} <- ${parent.title}` : node.title;
    }).join('\n');
}

function syncCompanyStructureText() {
    const structureText = document.getElementById('companyStructureText');
    if (structureText) {
        structureText.value = companyStructureTextFromNodes(companyStructureNodes) || DEFAULT_COMPANY_STRUCTURE_TEXT;
    }
}

function companyOrgStageSize() {
    const bounds = companyStructureNodes.reduce((max, node) => {
        const size = companyOrgNodeSize(node);
        return {
            width: Math.max(max.width, Number(node.x || 0) + size.width + ORG_CANVAS_PADDING),
            height: Math.max(max.height, Number(node.y || 0) + size.height + ORG_CANVAS_PADDING)
        };
    }, { width: ORG_CANVAS_MIN_WIDTH, height: ORG_CANVAS_MIN_HEIGHT });
    return {
        width: Math.ceil(bounds.width),
        height: Math.ceil(bounds.height)
    };
}

function companyOrgNodeAnchor(node, edge = 'center') {
    const size = companyOrgNodeSize(node);
    const x = Number(node.x || 0);
    const y = Number(node.y || 0);
    if (edge === 'top') return { x: x + size.width / 2, y };
    if (edge === 'bottom') return { x: x + size.width / 2, y: y + size.height };
    return { x: x + size.width / 2, y: y + size.height / 2 };
}

function companyOrgLinkPath(parent, child) {
    const start = companyOrgNodeAnchor(parent, 'bottom');
    const end = companyOrgNodeAnchor(child, 'top');
    const midY = Math.round((start.y + end.y) / 2);
    return `M ${Math.round(start.x)} ${Math.round(start.y)} C ${Math.round(start.x)} ${midY}, ${Math.round(end.x)} ${midY}, ${Math.round(end.x)} ${Math.round(end.y)}`;
}

function renderCompanyOrgLinks() {
    const stage = document.getElementById('companyOrgChart');
    const layer = stage?.querySelector('.hr-org-link-layer');
    if (!stage || !layer) return;
    const { width, height } = companyOrgStageSize();
    layer.setAttribute('viewBox', `0 0 ${width} ${height}`);
    layer.setAttribute('width', String(width));
    layer.setAttribute('height', String(height));
    const byId = new Map(companyStructureNodes.map(node => [node.id, node]));
    layer.innerHTML = companyStructureNodes.map(node => {
        const parent = node.parentId ? byId.get(node.parentId) : null;
        if (!parent) return '';
        const active = node.id === selectedCompanyStructureNodeId || parent.id === selectedCompanyStructureNodeId ? ' is-active' : '';
        return `<path class="hr-org-link${active}" data-org-link-child="${escapeHtml(node.id)}" d="${companyOrgLinkPath(parent, node)}"></path>`;
    }).join('');
}

function renderCompanyOrgNode(node) {
    const tone = ORG_ALLOWED_TONES.includes(node.tone) ? node.tone : 'blue';
    const meta = node.meta || ORG_TONE_LABELS[tone] || '';
    const active = node.id === selectedCompanyStructureNodeId ? ' is-active' : '';
    const linking = node.id === companyOrgLinkingNodeId ? ' is-link-source' : '';
    const size = companyOrgNodeSize(node);
    return `
        <span class="hr-org-node-shell${linking}" data-org-node-shell="${escapeHtml(node.id)}" style="left:${Number(node.x || 0)}px;top:${Number(node.y || 0)}px;width:${size.width}px;height:${size.height}px;">
            <button type="button" class="hr-org-node hr-org-node--${tone}${active}" data-org-node-id="${escapeHtml(node.id)}" aria-label="${escapeHtml(node.title)}. Перетягніть, щоб змінити місце.">
                <span class="hr-org-node-title">${escapeHtml(node.title)}</span>
                <span class="hr-org-node-meta">${escapeHtml(meta)}</span>
            </button>
            <button type="button" class="hr-org-node-link" data-org-link-source="${escapeHtml(node.id)}" aria-label="Змінити лінію для ${escapeHtml(node.title)}">↕</button>
            <button type="button" class="hr-org-node-edit" data-org-edit="${escapeHtml(node.id)}" aria-label="Редагувати ${escapeHtml(node.title)}">✎</button>
        </span>`;
}

function bindCompanyOrgChartEvents(stage) {
    stage.querySelectorAll('[data-org-node-id]').forEach(node => {
        node.addEventListener('click', event => {
            if (companyOrgSuppressNextClick) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const nodeId = node.dataset.orgNodeId;
            if (companyOrgLinkingNodeId) {
                event.preventDefault();
                event.stopPropagation();
                completeCompanyOrgLink(nodeId);
                return;
            }
            selectCompanyOrgNodeById(nodeId);
        });
        node.addEventListener('pointerdown', event => startCompanyOrgDrag(event, node.dataset.orgNodeId));
    });
    stage.querySelectorAll('[data-org-edit]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            openCompanyOrgNodeEditor(button.dataset.orgEdit);
        });
    });
    stage.querySelectorAll('[data-org-link-source]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            startCompanyOrgLinkMode(button.dataset.orgLinkSource);
        });
    });
}

function renderCompanyOrgChart() {
    const stage = document.getElementById('companyOrgChart');
    if (!stage) return;
    if (!companyStructureNodes.length) {
        companyStructureNodes = cloneCompanyStructureNodes(DEFAULT_COMPANY_STRUCTURE_NODES);
    }
    companyStructureNodes = normalizeCompanyStructureNodes(companyStructureNodes);
    const { width, height } = companyOrgStageSize();
    stage.style.width = `${width}px`;
    stage.style.minHeight = `${height}px`;
    stage.classList.toggle('is-linking', Boolean(companyOrgLinkingNodeId));
    stage.innerHTML = companyStructureNodes.length ? `
        <svg class="hr-org-link-layer" aria-hidden="true" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>
        <div class="hr-org-node-plane">
            ${sortCompanyStructureNodes(companyStructureNodes).map(renderCompanyOrgNode).join('')}
        </div>
    ` : '<div class="hr-org-loading">Немає вузлів структури</div>';
    bindCompanyOrgChartEvents(stage);
    renderCompanyOrgLinks();
    updateCompanyOrgLinkStatus();
    bindCompanyOrgKeyboard();
}

function startCompanyOrgDrag(event, nodeId) {
    if (companyOrgLinkingNodeId) return;
    if (!nodeId || event.button !== 0 || event.target.closest('[data-org-edit], [data-org-link-source]')) return;
    const node = companyStructureNodeById(nodeId);
    const shell = event.currentTarget.closest('[data-org-node-shell]');
    if (!node || !shell) return;
    selectCompanyOrgNodeById(nodeId);
    companyOrgDragState = {
        nodeId,
        startPointerX: event.clientX,
        startPointerY: event.clientY,
        startX: Number(node.x || 0),
        startY: Number(node.y || 0),
        moved: false,
        shell
    };
    shell.classList.add('is-dragging');
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', moveCompanyOrgDrag);
    window.addEventListener('pointerup', endCompanyOrgDrag, { once: true });
}

function moveCompanyOrgDrag(event) {
    if (!companyOrgDragState) return;
    const node = companyStructureNodeById(companyOrgDragState.nodeId);
    if (!node) return;
    const dx = event.clientX - companyOrgDragState.startPointerX;
    const dy = event.clientY - companyOrgDragState.startPointerY;
    const nextX = clampCompanyOrgCoord(companyOrgDragState.startX + dx, 5000) ?? 0;
    const nextY = clampCompanyOrgCoord(companyOrgDragState.startY + dy, 5000) ?? 0;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) companyOrgDragState.moved = true;
    node.x = nextX;
    node.y = nextY;
    companyOrgDragState.shell.style.left = `${nextX}px`;
    companyOrgDragState.shell.style.top = `${nextY}px`;
    renderCompanyOrgLinks();
}

function endCompanyOrgDrag() {
    if (!companyOrgDragState) return;
    const moved = companyOrgDragState.moved;
    companyOrgDragState.shell?.classList.remove('is-dragging');
    companyOrgDragState = null;
    window.removeEventListener('pointermove', moveCompanyOrgDrag);
    if (moved) {
        companyOrgSuppressNextClick = true;
        window.setTimeout(() => {
            companyOrgSuppressNextClick = false;
        }, 0);
        syncCompanyStructureText();
        scheduleCompanyStructureAutosave();
    }
}

function scheduleCompanyStructureAutosave() {
    window.clearTimeout(companyOrgSaveTimer);
    companyOrgSaveTimer = window.setTimeout(() => {
        saveCompanyStructure({ silent: true, preserveRender: true });
    }, 650);
}

function companyOrgWouldCreateCycle(childId, parentId) {
    if (!childId || !parentId) return false;
    let cursor = parentId;
    const guard = new Set();
    while (cursor && !guard.has(cursor)) {
        if (cursor === childId) return true;
        guard.add(cursor);
        cursor = companyStructureNodeById(cursor)?.parentId;
    }
    return false;
}

function startCompanyOrgLinkMode(nodeId = selectedCompanyStructureNodeId) {
    const node = companyStructureNodeById(nodeId);
    if (!node) return;
    selectedCompanyStructureNodeId = node.id;
    companyOrgLinkingNodeId = node.id;
    renderCompanyOrgChart();
    selectCompanyOrgNodeById(node.id);
}

function cancelCompanyOrgLinkMode() {
    if (!companyOrgLinkingNodeId) return;
    companyOrgLinkingNodeId = null;
    renderCompanyOrgChart();
    selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
}

function completeCompanyOrgLink(parentId) {
    const childId = companyOrgLinkingNodeId;
    if (!childId) return;
    const child = companyStructureNodeById(childId);
    const parent = companyStructureNodeById(parentId);
    if (!child || !parent) return cancelCompanyOrgLinkMode();
    if (child.id === parent.id) {
        showNotification('Вузол не може бути підпорядкований самому собі', 'warning');
        return;
    }
    if (companyOrgWouldCreateCycle(child.id, parent.id)) {
        showNotification('Таке з’єднання створить цикл у структурі', 'warning');
        return;
    }
    child.parentId = parent.id;
    companyOrgLinkingNodeId = null;
    companyStructureNodes = normalizeCompanyStructureNodes(companyStructureNodes);
    syncCompanyStructureText();
    renderCompanyOrgChart();
    selectCompanyOrgNodeById(child.id);
    saveCompanyStructure({ silent: true, preserveRender: true }).then(saved => {
        if (saved) showNotification('Лінію підпорядкування оновлено', 'success');
    });
}

function clearSelectedCompanyOrgParent() {
    const node = companyStructureNodeById(selectedCompanyStructureNodeId);
    if (!node || !node.parentId) return;
    node.parentId = null;
    companyOrgLinkingNodeId = null;
    syncCompanyStructureText();
    renderCompanyOrgChart();
    selectCompanyOrgNodeById(node.id);
    saveCompanyStructure({ silent: true, preserveRender: true }).then(saved => {
        if (saved) showNotification('Лінію прибрано', 'success');
    });
}

function autoArrangeCompanyOrgChart() {
    companyStructureNodes = normalizeCompanyStructureNodes(companyStructureNodes).map((node, index) => {
        const position = companyOrgDefaultPosition(node, index);
        return {
            ...node,
            x: position.x,
            y: position.y
        };
    });
    companyOrgLinkingNodeId = null;
    syncCompanyStructureText();
    renderCompanyOrgChart();
    selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
    saveCompanyStructure({ silent: true, preserveRender: true }).then(saved => {
        if (saved) showNotification('Структуру впорядковано', 'success');
    });
}

function updateCompanyOrgLinkStatus() {
    const status = document.getElementById('hrOrgLinkStatus');
    const relinkButton = document.getElementById('hrOrgRelinkSelectedBtn');
    const clearButton = document.getElementById('hrOrgClearParentBtn');
    const node = companyStructureNodeById(selectedCompanyStructureNodeId);
    if (status) {
        if (companyOrgLinkingNodeId) {
            const source = companyStructureNodeById(companyOrgLinkingNodeId);
            status.textContent = source ? `Оберіть керівника для: ${source.title}` : 'Оберіть керівника';
            status.classList.add('is-active');
        } else {
            status.textContent = 'Перетягуйте вузли або змінюйте лінії підпорядкування';
            status.classList.remove('is-active');
        }
    }
    if (relinkButton) {
        relinkButton.disabled = !node;
        relinkButton.onclick = () => node && startCompanyOrgLinkMode(node.id);
    }
    if (clearButton) {
        clearButton.disabled = !node || !node.parentId;
        clearButton.onclick = clearSelectedCompanyOrgParent;
    }
}

function bindCompanyOrgKeyboard() {
    if (companyOrgKeyboardBound) return;
    companyOrgKeyboardBound = true;
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && companyOrgLinkingNodeId) {
            cancelCompanyOrgLinkMode();
        }
    });
}

function ensureCompanyOrgDetailMeta() {
    let meta = document.getElementById('hrOrgDetailMeta');
    const title = document.getElementById('hrOrgDetailTitle');
    if (!meta && title) {
        meta = document.createElement('div');
        meta.id = 'hrOrgDetailMeta';
        meta.className = 'hr-org-detail-meta';
        title.insertAdjacentElement('afterend', meta);
    }
    return meta;
}

function updateCompanyOrgDetail(node) {
    const title = document.getElementById('hrOrgDetailTitle');
    const text = document.getElementById('hrOrgDetailText');
    const meta = ensureCompanyOrgDetailMeta();
    const editButton = document.getElementById('hrOrgEditSelectedBtn');
    if (title) title.textContent = node?.title || 'Роль';
    if (text) text.textContent = node?.description || 'Роль у структурі компанії.';
    if (meta) {
        const parent = node?.parentId ? companyStructureNodeById(node.parentId) : null;
        meta.innerHTML = node ? `
            <span>${escapeHtml(ORG_LANE_LABELS[node.lane] || 'Рівень')}</span>
            <span>${escapeHtml(ORG_TONE_LABELS[node.tone] || 'Тип')}</span>
            ${parent ? `<span>Підпорядкування: ${escapeHtml(parent.title)}</span>` : '<span>Кореневий вузол</span>'}
        ` : '';
    }
    if (editButton) {
        editButton.disabled = !node;
        editButton.onclick = () => node && openCompanyOrgNodeEditor(node.id);
    }
    updateCompanyOrgLinkStatus();
}

function selectCompanyOrgNodeById(id) {
    const node = companyStructureNodeById(id) || companyStructureNodes[0] || null;
    if (!node) return;
    selectedCompanyStructureNodeId = node.id;
    document.querySelectorAll('.hr-org-node.is-active').forEach(item => item.classList.remove('is-active'));
    document.querySelectorAll('[data-org-node-id]').forEach(item => {
        if (item.dataset.orgNodeId === node.id) item.classList.add('is-active');
    });
    updateCompanyOrgDetail(node);
    renderCompanyOrgLinks();
}

function selectCompanyOrgNode(node) {
    const id = typeof node === 'string' ? node : node?.dataset?.orgNodeId;
    selectCompanyOrgNodeById(id);
}

function closeCompanyOrgNodeEditor() {
    document.getElementById('hrOrgNodeEditorOverlay')?.remove();
}

function companyOrgNodeEditorOptions(source, selectedValue, labels) {
    return source.map(value => `<option value="${escapeHtml(value)}"${value === selectedValue ? ' selected' : ''}>${escapeHtml(labels[value] || value)}</option>`).join('');
}

function openCompanyOrgNodeEditor(nodeId = selectedCompanyStructureNodeId) {
    const node = companyStructureNodeById(nodeId);
    if (!node) return;
    closeCompanyOrgNodeEditor();
    const parentOptions = [
        '<option value="">Без батьківського вузла</option>',
        ...sortCompanyStructureNodes(companyStructureNodes)
            .filter(item => item.id !== node.id)
            .map(item => `<option value="${escapeHtml(item.id)}"${item.id === node.parentId ? ' selected' : ''}>${escapeHtml(item.title)}</option>`)
    ].join('');
    const overlay = document.createElement('div');
    overlay.id = 'hrOrgNodeEditorOverlay';
    overlay.className = 'candidate-detail-overlay';
    overlay.innerHTML = `
        <div class="candidate-detail-modal hr-org-node-modal" role="dialog" aria-modal="true" aria-labelledby="hrOrgNodeEditorTitle">
            <form id="hrOrgNodeForm" class="hr-org-node-form" data-node-id="${escapeHtml(node.id)}">
                <div class="candidate-detail-head">
                    <div>
                        <div class="candidate-detail-kicker">Оргструктура</div>
                        <h3 id="hrOrgNodeEditorTitle">Редагувати вузол</h3>
                    </div>
                    <button type="button" class="candidate-detail-close" id="hrOrgNodeEditorClose" aria-label="Закрити">×</button>
                </div>
                <label>
                    Назва ролі
                    <input type="text" name="title" maxlength="80" required value="${escapeHtml(node.title)}">
                </label>
                <label>
                    Опис / відповідальність
                    <textarea name="description" rows="4" maxlength="1200">${escapeHtml(node.description)}</textarea>
                </label>
                <div class="hr-org-node-form-row">
                    <label>
                        Візуальний тип
                        <select name="tone">${companyOrgNodeEditorOptions(ORG_ALLOWED_TONES, node.tone, ORG_TONE_LABELS)}</select>
                    </label>
                    <label>
                        Рівень
                        <select name="lane">${companyOrgNodeEditorOptions(ORG_ALLOWED_LANES, node.lane, ORG_LANE_LABELS)}</select>
                    </label>
                </div>
                <div class="hr-org-node-form-row">
                    <label>
                        Батьківський вузол
                        <select name="parentId">${parentOptions}</select>
                    </label>
                    <label>
                        Порядок
                        <input type="number" name="order" step="1" value="${Number(node.order) || 0}">
                    </label>
                </div>
                <div class="hr-org-node-form-row">
                    <label>
                        Група / стек
                        <input type="text" name="stack" maxlength="64" value="${escapeHtml(node.stack || '')}" placeholder="Напр. kitchen">
                    </label>
                    <label>
                        Підпис
                        <input type="text" name="meta" maxlength="80" value="${escapeHtml(node.meta || '')}" placeholder="Напр. сервіс">
                    </label>
                </div>
                <div class="hr-org-node-form-actions">
                    <button type="button" class="btn-secondary" id="hrOrgNodeEditorCancel">Скасувати</button>
                    <button type="submit" class="btn-primary">Зберегти вузол</button>
                </div>
            </form>
        </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', event => {
        if (event.target === overlay) closeCompanyOrgNodeEditor();
    });
    overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeCompanyOrgNodeEditor();
    });
    document.getElementById('hrOrgNodeEditorClose')?.addEventListener('click', closeCompanyOrgNodeEditor);
    document.getElementById('hrOrgNodeEditorCancel')?.addEventListener('click', closeCompanyOrgNodeEditor);
    document.getElementById('hrOrgNodeForm')?.addEventListener('submit', saveCompanyOrgNodeFromEditor);
    overlay.querySelector('input[name="title"]')?.focus();
}

async function saveCompanyOrgNodeFromEditor(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const nodeId = form.dataset.nodeId;
    const index = companyStructureNodes.findIndex(node => node.id === nodeId);
    if (index === -1) return;
    const formData = new FormData(form);
    const order = Number(formData.get('order'));
    const parentId = String(formData.get('parentId') || '').trim();
    if (parentId && companyOrgWouldCreateCycle(nodeId, parentId)) {
        showNotification('Таке підпорядкування створить цикл у структурі', 'warning');
        return;
    }
    const nextNode = {
        ...companyStructureNodes[index],
        title: String(formData.get('title') || '').trim().slice(0, 80) || 'Роль',
        description: String(formData.get('description') || '').trim().slice(0, 1200) || 'Роль у структурі компанії.',
        tone: ORG_ALLOWED_TONES.includes(String(formData.get('tone'))) ? String(formData.get('tone')) : 'blue',
        lane: ORG_ALLOWED_LANES.includes(String(formData.get('lane'))) ? String(formData.get('lane')) : 'leadership',
        parentId: parentId && parentId !== nodeId ? parentId : null,
        stack: String(formData.get('stack') || '').trim().slice(0, 64) || null,
        order: Number.isFinite(order) ? order : companyStructureNodes[index].order,
        meta: String(formData.get('meta') || '').trim().slice(0, 80) || null
    };
    companyStructureNodes[index] = nextNode;
    companyStructureNodes = normalizeCompanyStructureNodes(companyStructureNodes);
    selectedCompanyStructureNodeId = nextNode.id;
    syncCompanyStructureText();
    renderCompanyOrgChart();
    selectCompanyOrgNodeById(nextNode.id);
    closeCompanyOrgNodeEditor();
    const saved = await saveCompanyStructure({ silent: true });
    if (saved) showNotification('Вузол структури збережено', 'success');
}

function updateCompanyStructureStatus(updatedAt) {
    const statusEl = document.getElementById('companyStructureStatus');
    if (!statusEl) return;
    statusEl.textContent = updatedAt ? `Оновлено: ${new Date(updatedAt).toLocaleString('uk-UA')}` : '';
}

function initCompanyOrgChart() {
    if (!companyStructureNodes.length) {
        companyStructureNodes = cloneCompanyStructureNodes(DEFAULT_COMPANY_STRUCTURE_NODES);
    }
    companyStructureNodes = normalizeCompanyStructureNodes(companyStructureNodes);
    syncCompanyStructureText();
    renderCompanyOrgChart();
    selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
}

async function loadCompanyStructure() {
    const statusEl = document.getElementById('companyStructureStatus');
    if (statusEl) statusEl.textContent = 'Завантаження...';
    const data = await hrFetch('/company-structure');
    if (!data?.success) {
        if (statusEl) statusEl.textContent = data?.error || 'Не вдалося завантажити структуру';
        return;
    }
    const structure = data.data || data.structure || {};
    const notesText = document.getElementById('companyStructureNotes');
    const instructionsText = document.getElementById('companyInstructionsText');
    const savedStructure = structure.structure || structure.structure_text || '';
    companyStructureNodes = normalizeCompanyStructureNodes(structure.nodes);
    const generatedStructure = companyStructureTextFromNodes(companyStructureNodes);
    if (notesText) notesText.value = savedStructure && savedStructure !== DEFAULT_COMPANY_STRUCTURE_TEXT && savedStructure !== generatedStructure ? savedStructure : '';
    if (instructionsText) instructionsText.value = structure.instructions || structure.instructions_text || '';
    syncCompanyStructureText();
    renderCompanyOrgChart();
    selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
    updateCompanyStructureStatus(structure.updatedAt);
}

async function saveCompanyStructure(options = {}) {
    const notes = document.getElementById('companyStructureNotes')?.value || '';
    window.clearTimeout(companyOrgSaveTimer);
    syncCompanyStructureText();
    const payload = {
        schemaVersion: 1,
        structure: notes.trim() || document.getElementById('companyStructureText')?.value || DEFAULT_COMPANY_STRUCTURE_TEXT,
        instructions: document.getElementById('companyInstructionsText')?.value || '',
        nodes: normalizeCompanyStructureNodes(companyStructureNodes)
    };
    const data = await hrFetch('/company-structure', {
        method: 'PUT',
        body: JSON.stringify(payload)
    });
    if (data?.success) {
        const saved = data.data || payload;
        companyStructureNodes = normalizeCompanyStructureNodes(saved.nodes);
        syncCompanyStructureText();
        if (!options.preserveRender) {
            renderCompanyOrgChart();
            selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
        } else {
            renderCompanyOrgLinks();
            updateCompanyOrgLinkStatus();
        }
        updateCompanyStructureStatus(saved.updatedAt);
        if (!options.silent) showNotification('Структуру та інструкції збережено', 'success');
        return true;
    }
    showNotification(data?.error || 'Не вдалося зберегти', 'error');
    return false;
}

async function loadReservePool() {
    await loadPoolList('reserve', 'reservePoolList');
}

async function loadBlacklist() {
    await loadPoolList('blacklisted', 'blacklistList');
}

async function loadPoolList(status, targetId) {
    const target = document.getElementById(targetId);
    if (target) target.innerHTML = '<div style="padding:24px;color:var(--gray-400)">Завантаження...</div>';
    const data = await hrFetch(`/pool?status=${status}`);
    if (!data?.success) {
        if (target) target.innerHTML = `<div style="padding:24px;color:var(--danger)">${escapeHtml(data?.error || 'Помилка завантаження')}</div>`;
        return;
    }
    renderPoolList(targetId, data.data || [], status);
}

function renderPoolList(targetId, staff, status) {
    const target = document.getElementById(targetId);
    if (!target) return;
    if (staff.length === 0) {
        target.innerHTML = '<div style="padding:24px;color:var(--gray-400)">Список порожній</div>';
        return;
    }
    target.innerHTML = staff.map(s => {
        const reason = s.blacklist_reason ? `<div class="hr-team-stats">Причина: ${escapeHtml(s.blacklist_reason)}</div>` : '';
        const phone = s.phone ? `<div class="hr-team-contact">📞 ${escapeHtml(s.phone)}</div>` : '';
        const actions = canManage ? `
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
                ${status !== 'reserve' ? `<button class="btn-secondary" onclick="setPoolStatus(${s.id}, 'reserve')">У резерв</button>` : ''}
                ${status !== 'blacklisted' ? `<button class="btn-secondary" onclick="setPoolStatus(${s.id}, 'blacklisted')">У blacklist</button>` : ''}
                <button class="btn-secondary" onclick="setPoolStatus(${s.id}, 'core')">В основну команду</button>
            </div>` : '';
        return `<div class="hr-team-card">
            <div class="hr-team-avatar">${escapeHtml(s.name || '?').slice(0, 2).toUpperCase()}</div>
            <div class="hr-team-details">
                <div class="hr-team-name">${escapeHtml(s.name)}</div>
                <div class="hr-team-role">${escapeHtml(ROLE_LABELS[s.role_type] || s.role_type || '')} ${s.department ? ' · ' + escapeHtml(s.department) : ''}</div>
                ${phone}
                ${reason}
                ${actions}
            </div>
        </div>`;
    }).join('');
}

async function setPoolStatus(staffId, status) {
    let reason = null;
    if (status === 'blacklisted') {
        const result = await formModal('Причина чорного списку', [
            { key: 'reason', label: 'Причина', type: 'textarea', required: true }
        ], { icon: '⚠️', type: 'warning' });
        if (!result?.reason?.trim()) return;
        reason = result.reason.trim();
    }
    const data = await hrFetch(`/staff/${staffId}/pool-status`, {
        method: 'PUT',
        body: JSON.stringify({ status, reason })
    });
    if (data?.success) {
        showNotification('HR-статус оновлено', 'success');
        await Promise.all([
            loadTeam().catch(() => {}),
            loadReservePool().catch(() => {}),
            loadBlacklist().catch(() => {})
        ]);
    } else {
        showNotification(data?.error || 'Не вдалося оновити статус', 'error');
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
    let totalTasksAssigned = 0, totalTasksDone = 0, totalTasksOverdue = 0;
    for (const r of rows) {
        totalPresent += r.days_worked;
        totalLate += r.late_count;
        totalAbsent += r.days_absent;
        totalOvertime += r.total_overtime_hours;
        totalTasksAssigned += r.task_kpi?.tasks_assigned || 0;
        totalTasksDone += r.task_kpi?.tasks_done || 0;
        totalTasksOverdue += r.task_kpi?.tasks_overdue || 0;
    }
    const totalScheduled = rows.reduce((a, r) => a + r.days_scheduled, 0);
    const attendanceRate = totalScheduled > 0 ? Math.round(totalPresent / totalScheduled * 100) : 0;
    const taskDoneRate = totalTasksAssigned > 0 ? Math.round(totalTasksDone / totalTasksAssigned * 100) : 0;

    document.getElementById('reportSummary').innerHTML = `
        <div class="hr-report-stat"><div class="stat-value">${attendanceRate}%</div><div class="stat-label">Присутність</div></div>
        <div class="hr-report-stat"><div class="stat-value">${totalLate}</div><div class="stat-label">Запізнень</div></div>
        <div class="hr-report-stat"><div class="stat-value">${totalAbsent}</div><div class="stat-label">Відсутностей</div></div>
        <div class="hr-report-stat"><div class="stat-value">${totalOvertime.toFixed(0)}г</div><div class="stat-label">Переробка</div></div>
        <div class="hr-report-stat"><div class="stat-value">${totalTasksDone}/${totalTasksAssigned}</div><div class="stat-label">Задачі виконано</div></div>
        <div class="hr-report-stat"><div class="stat-value">${taskDoneRate}%</div><div class="stat-label">KPI задач</div></div>
        <div class="hr-report-stat"><div class="stat-value">${totalTasksOverdue}</div><div class="stat-label">Прострочені</div></div>
    `;

    // Table
    document.getElementById('reportHead').innerHTML = `<tr>
        <th>ПІБ</th><th>Зміни</th><th>Відпрац.</th><th>Запізн.</th>
        <th>Сер. запізн.</th><th>Годин</th><th>Сума</th><th>Задачі</th><th>KPI</th></tr>`;

    document.getElementById('reportBody').innerHTML = rows.map(r => `<tr>
        <td>${escapeHtml(r.staff_name)}</td>
        <td class="num">${r.days_scheduled}</td>
        <td class="num">${r.days_worked}</td>
        <td class="num">${r.late_count}</td>
        <td class="num">${r.avg_late_minutes > 0 ? r.avg_late_minutes + 'хв' : '—'}</td>
        <td class="num">${r.total_worked_hours}г</td>
        <td class="num">${fmtMoney(r.estimated_salary)}</td>
        <td class="num">${r.task_kpi?.tasks_done || 0}/${r.task_kpi?.tasks_assigned || 0}${r.task_kpi?.tasks_overdue ? ` · ${r.task_kpi.tasks_overdue} простр.` : ''}</td>
        <td class="num">${r.task_completion_rate || 0}%</td>
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

function showHrEditableModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.style.display = 'flex';
    if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(modal);
}

async function closeHrEditableModal(id, force = false, message = 'Є незбережені зміни. Закрити без збереження?') {
    const modal = document.getElementById(id);
    if (!modal) return true;
    const closeNow = () => { modal.style.display = 'none'; };
    if (force) {
        closeNow();
        if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.markClean(modal);
        return true;
    }
    if (window.UnsafeDismissGuard) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(modal, closeNow, {
            message,
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
    }
    closeNow();
    return true;
}

function initModals() {
    // Shift modal
    document.getElementById('shiftSave')?.addEventListener('click', saveShift);
    document.getElementById('shiftDelete')?.addEventListener('click', deleteShift);
    document.getElementById('shiftReplace')?.addEventListener('click', replaceShift);
    document.getElementById('shiftCancel')?.addEventListener('click', () => closeHrEditableModal('shiftModal', false, 'Є незбережені зміни у зміні. Закрити без збереження?'));

    // Staff edit modal
    document.getElementById('editSave')?.addEventListener('click', saveStaffEdit);
    document.getElementById('editCancel')?.addEventListener('click', () => closeHrEditableModal('staffEditModal', false, 'Є незбережені зміни співробітника. Закрити без збереження?'));

    // Correction modal
    document.getElementById('corrSave')?.addEventListener('click', saveCorrection);
    document.getElementById('corrCancel')?.addEventListener('click', () => closeHrEditableModal('correctionModal', false, 'Є незбережені зміни корекції. Закрити без збереження?'));

    // Close modals on overlay click
    ['shiftModal', 'staffEditModal', 'correctionModal'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeHrEditableModal(id);
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
        await closeHrEditableModal('correctionModal', true);
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

// ==========================================
// DARK MODE
// ==========================================

function initDarkMode() {
    if (localStorage.getItem('pzp_dark_mode') !== 'false') {
        document.body.classList.add('dark-mode');
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.style.colorScheme = 'dark';
    }
}

// ==========================================
// VACANCIES
// ==========================================

let currentVacancyId = null;
let currentApplications = [];
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
const RESUME_ACCEPT = '.txt,.md,.csv,.json,.pdf,.doc,.docx,.rtf,.odt';

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
    currentApplications = apps;
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
                        ${a.birth_date ? `<div class="kc-meta">🎂 ${new Date(a.birth_date).toLocaleDateString('uk-UA')}</div>` : ''}
                        ${a.address ? `<div class="kc-meta">📍 ${escapeHtml(a.address)}</div>` : ''}
                        ${a.availability ? `<div class="kc-meta">🕒 ${escapeHtml(a.availability)}</div>` : ''}
                        ${a.salary_expectation ? `<div class="kc-meta">💰 ${a.salary_expectation} ₴</div>` : ''}
                        ${a.interview_date ? `<div class="kc-meta">📅 ${new Date(a.interview_date).toLocaleDateString('uk-UA')}</div>` : ''}
                        ${a.experience ? `<div class="kc-meta">${escapeHtml(a.experience).slice(0, 120)}</div>` : ''}
                        ${a.interview_notes ? `<div class="kc-meta">${escapeHtml(a.interview_notes).slice(0, 120)}</div>` : ''}
                        ${candidateResumeBadgeHtml(a)}
                        <div class="kc-actions">
                            <button class="kc-btn" onclick="openCandidateDetail(${a.id})">Резюме</button>
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

function candidateResumeBadgeHtml(candidate) {
    const files = Array.isArray(candidate.resume_files) ? candidate.resume_files : [];
    const hasText = Boolean(String(candidate.raw_application_text || '').trim());
    if (!hasText && !files.length) return '';
    const parts = [];
    if (hasText) parts.push('текст');
    if (files.length) parts.push(`${files.length} файл${files.length === 1 ? '' : 'и'}`);
    return `<div class="kc-resume-pill">Резюме: ${escapeHtml(parts.join(' + '))}</div>`;
}

function findCurrentApplication(id) {
    return currentApplications.find(app => parseInt(app.id, 10) === parseInt(id, 10)) || null;
}

function renderResumeFiles(files = []) {
    if (!files.length) {
        return '<div class="candidate-detail-empty">Файли резюме ще не додані.</div>';
    }
    return files.map(file => `
        <div class="candidate-resume-file">
            <div>
                <strong>${escapeHtml(file.original_name || 'resume')}</strong>
                <span>${escapeHtml(file.mime_type || file.file_ext || 'файл')} · ${formatResumeFileSize(file.file_size)}</span>
                <em>${escapeHtml(file.extraction_note || (file.extraction_status === 'extracted' ? 'Текст імпортовано' : 'Збережено як вкладення'))}</em>
            </div>
            <button type="button" class="kc-btn" onclick="downloadResumeFile(${file.application_id}, ${file.id})">Завантажити</button>
        </div>
        ${file.extracted_text ? `<pre class="candidate-resume-extracted">${escapeHtml(file.extracted_text)}</pre>` : ''}
    `).join('');
}

function closeCandidateDetailModal() {
    document.getElementById('candidateDetailModal')?.remove();
}

function openCandidateDetail(id) {
    const candidate = findCurrentApplication(id);
    if (!candidate) return;
    closeCandidateDetailModal();
    const files = Array.isArray(candidate.resume_files) ? candidate.resume_files : [];
    const overlay = document.createElement('div');
    overlay.id = 'candidateDetailModal';
    overlay.className = 'candidate-detail-overlay';
    overlay.innerHTML = `
        <div class="candidate-detail-modal" role="dialog" aria-modal="true" aria-labelledby="candidateDetailTitle">
            <div class="candidate-detail-head">
                <div>
                    <span class="candidate-detail-kicker">Картка кандидата</span>
                    <h3 id="candidateDetailTitle">${escapeHtml(candidate.name || 'Кандидат')}</h3>
                    <p>${escapeHtml(APP_STATUS_LABEL[candidate.status] || candidate.status || '')}</p>
                </div>
                <button type="button" class="candidate-detail-close" onclick="closeCandidateDetailModal()" aria-label="Закрити">×</button>
            </div>
            <div class="candidate-detail-grid">
                <section>
                    <h4>Контакти і рекрутерські нотатки</h4>
                    ${candidate.phone ? `<div class="candidate-detail-row"><span>Телефон</span><strong>${escapeHtml(candidate.phone)}</strong></div>` : ''}
                    ${candidate.telegram_username ? `<div class="candidate-detail-row"><span>Telegram</span><strong>@${escapeHtml(candidate.telegram_username)}</strong></div>` : ''}
                    ${candidate.availability ? `<div class="candidate-detail-row"><span>Доступність</span><strong>${escapeHtml(candidate.availability)}</strong></div>` : ''}
                    ${candidate.experience ? `<p>${escapeHtml(candidate.experience)}</p>` : '<div class="candidate-detail-empty">Досвід не заповнений.</div>'}
                    ${candidate.interview_notes ? `<p><strong>Нотатки:</strong> ${escapeHtml(candidate.interview_notes)}</p>` : ''}
                </section>
                <section>
                    <h4>Текст резюме / анкети</h4>
                    ${candidate.raw_application_text ? `<pre class="candidate-resume-text">${escapeHtml(candidate.raw_application_text)}</pre>` : '<div class="candidate-detail-empty">Текст ще не доданий. Можна вставити вручну або імпортувати з TXT/CSV/MD/JSON файлу.</div>'}
                </section>
                <section class="candidate-detail-wide">
                    <h4>Вкладені файли</h4>
                    ${renderResumeFiles(files)}
                </section>
            </div>
        </div>
    `;
    overlay.addEventListener('click', event => {
        if (event.target === overlay) closeCandidateDetailModal();
    });
    document.body.appendChild(overlay);
}

async function downloadResumeFile(applicationId, fileId) {
    const candidate = findCurrentApplication(applicationId);
    const file = (candidate?.resume_files || []).find(item => parseInt(item.id, 10) === parseInt(fileId, 10));
    const filename = file?.original_name || 'resume';
    const token = localStorage.getItem('pzp_token');
    const response = await fetch(`/api/hr/applications/${applicationId}/resume-files/${fileId}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!response.ok) {
        showNotification('Не вдалося завантажити файл резюме', 'error');
        return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'resume';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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

function closeCandidateIntakeModal() {
    document.getElementById('candidateIntakeModal')?.remove();
}

function candidateNameFromFile(file) {
    return String(file?.name || 'Кандидат')
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .trim() || 'Кандидат з резюме';
}

function renderCandidateIntakeFiles(input) {
    const list = document.getElementById('candidateResumeFilesList');
    const help = document.getElementById('candidateResumeImportHelp');
    const files = Array.from(input?.files || []);
    if (list) {
        list.innerHTML = files.length
            ? files.map(file => `<span class="candidate-file-chip">${escapeHtml(file.name)} · ${formatResumeFileSize(file.size)}</span>`).join('')
            : '<span class="candidate-file-empty">Файли не вибрані</span>';
    }
    if (help) {
        const hasOnlyText = files.some(file => /\.(txt|md|csv|json)$/i.test(file.name || '') || String(file.type || '').startsWith('text/'));
        help.textContent = files.length
            ? (hasOnlyText ? 'Текстові файли будуть імпортовані у резюме. PDF/DOC/DOCX збережуться як вкладення.' : 'Файли будуть збережені як вкладення; для PDF/DOC/DOCX вставте текст резюме вручну, якщо потрібно.')
            : 'Можна додати текст, файли або обидва варіанти.';
    }
}

function addCandidatePrompt(vacancyId) {
    closeCandidateIntakeModal();
    const overlay = document.createElement('div');
    overlay.id = 'candidateIntakeModal';
    overlay.className = 'candidate-detail-overlay candidate-intake-overlay';
    overlay.innerHTML = `
        <form class="candidate-intake-modal" id="candidateIntakeForm" role="dialog" aria-modal="true" aria-labelledby="candidateIntakeTitle">
            <div class="candidate-detail-head">
                <div>
                    <span class="candidate-detail-kicker">HR вакансії</span>
                    <h3 id="candidateIntakeTitle">Додати кандидата</h3>
                    <p>Заповніть картку вручну, вставте текст резюме або додайте файл.</p>
                </div>
                <button type="button" class="candidate-detail-close" onclick="closeCandidateIntakeModal()" aria-label="Закрити">×</button>
            </div>
            <div class="candidate-intake-grid">
                <label>Ім'я кандидата<input name="name" placeholder="Іван Петренко"></label>
                <label>Телефон<input name="phone" placeholder="+380..."></label>
                <label>Telegram<input name="telegram_username" placeholder="@username"></label>
                <label>Дата народження<input name="birth_date" type="date"></label>
                <label class="wide">Адреса<input name="address" placeholder="Місто, район, вулиця"></label>
                <label class="wide">Доступність<input name="availability" placeholder="Будні після 16:00, вихідні повний день"></label>
                <label class="wide">Досвід<textarea name="experience" rows="3" placeholder="Коротко про досвід і ролі"></textarea></label>
                <label class="wide">Нотатки інтерв'ю<textarea name="interview_notes" rows="3" placeholder="Що важливо перевірити або уточнити"></textarea></label>
                <label class="wide">Текст резюме / анкети<textarea name="raw_application_text" rows="6" placeholder="Вставте резюме, анкету або текст із форми"></textarea></label>
                <div class="candidate-upload-card wide">
                    <div>
                        <strong>Файли резюме</strong>
                        <span id="candidateResumeImportHelp">Можна додати текст, файли або обидва варіанти.</span>
                    </div>
                    <input id="candidateResumeFiles" name="resume_files" type="file" accept="${RESUME_ACCEPT}" multiple>
                    <div id="candidateResumeFilesList" class="candidate-file-list"><span class="candidate-file-empty">Файли не вибрані</span></div>
                </div>
            </div>
            <div class="candidate-intake-actions">
                <span id="candidateIntakeStatus"></span>
                <button type="button" class="btn-secondary" onclick="closeCandidateIntakeModal()">Скасувати</button>
                <button type="submit" class="btn-add">Зберегти кандидата</button>
            </div>
        </form>
    `;
    overlay.addEventListener('click', event => {
        if (event.target === overlay) closeCandidateIntakeModal();
    });
    document.body.appendChild(overlay);
    const fileInput = document.getElementById('candidateResumeFiles');
    fileInput?.addEventListener('change', () => renderCandidateIntakeFiles(fileInput));
    document.getElementById('candidateIntakeForm')?.addEventListener('submit', event => handleCandidateIntakeSubmit(event, vacancyId));
}

async function handleCandidateIntakeSubmit(event, vacancyId) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.getElementById('candidateIntakeStatus');
    const submit = form.querySelector('button[type="submit"]');
    const files = Array.from(document.getElementById('candidateResumeFiles')?.files || []);
    const formData = new FormData(form);
    let name = String(formData.get('name') || '').trim();
    if (!name && files.length) name = candidateNameFromFile(files[0]);
    if (!name) {
        if (status) status.textContent = 'Вкажіть імʼя або додайте файл резюме.';
        return;
    }
    if (submit) submit.disabled = true;
    if (status) status.textContent = 'Створюю кандидата...';
    try {
        const created = await hrFetch(`/vacancies/${vacancyId}/applications`, {
            method: 'POST',
            body: {
                name,
                phone: String(formData.get('phone') || '').trim() || null,
                telegram_username: String(formData.get('telegram_username') || '').trim() || null,
                birth_date: formData.get('birth_date') || null,
                address: String(formData.get('address') || '').trim() || null,
                availability: String(formData.get('availability') || '').trim() || null,
                experience: String(formData.get('experience') || '').trim() || null,
                interview_notes: String(formData.get('interview_notes') || '').trim() || null,
                raw_application_text: String(formData.get('raw_application_text') || '').trim() || null
            }
        });
        if (!created?.success || !created.application?.id) {
            throw new Error(created?.error || 'Не вдалося створити кандидата');
        }
        if (files.length) {
            if (status) status.textContent = 'Завантажую резюме...';
            const uploadBody = new FormData();
            files.forEach(file => uploadBody.append('files', file));
            const uploaded = await hrFetch(`/applications/${created.application.id}/resume-files`, {
                method: 'POST',
                body: uploadBody
            });
            if (!uploaded?.success) {
                showNotification(uploaded?.error || 'Кандидата створено, але файл резюме не завантажився', 'error');
            } else if (!uploaded.extracted_text_appended) {
                showNotification('Файл резюме збережено. Для PDF/DOC/DOCX текст можна додати вручну у картці кандидата.', 'info');
            }
        }
        closeCandidateIntakeModal();
        await refreshCandidates();
    } catch (err) {
        if (status) status.textContent = err.message || 'Помилка збереження кандидата';
        if (submit) submit.disabled = false;
    }
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
