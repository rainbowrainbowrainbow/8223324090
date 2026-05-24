/**
 * js/reports-page.js — Reports page frontend (v32.7)
 *
 * Summary cards, filters, table with sorting/pagination,
 * on-duty accountants, hashtag dashboard, add/edit modal with hashtag support.
 */

/* global apiVerifyToken, initDarkMode */

const ReportsPage = (() => {
    let _reports = [];
    let _summary = null;
    let _hashtagStats = [];
    let _total = 0;
    let _page = 1;
    const _limit = 20;
    let _sortField = 'createdAt';
    let _sortDir = 'desc';
    let _expandedRow = null;
    let _editingId = null;
    let _modalHashtags = [];
    let _reportTemplates = [];
    let _activeTemplateId = 'finance-day-summary';
    let _reportTableState = null;
    let _reportDrafts = [];
    let _editingDraftId = null;
    let _editingTableReportId = null;
    let _canManageReportTemplates = false;
    let _reportTableDirty = false;
    let _reportTableBusy = false;
    let _reportTemplateWorkspaceReady = false;
    let _reportWorkflowSettings = null;
    let _reportApprovalUsers = [];
    let _pendingOpenReportId = null;

    const EXPENSE_CATEGORIES = ['Афіша', 'ЗП', 'Майстер-класи', 'ДАР', 'Костюми', 'Квести', 'Реквізит', 'Аквагрим', 'Декорації', 'Офіс', 'Інше'];
    const DEFAULT_HASHTAGS = ['СШ-Парк', 'СШ-Особистий', 'ДАР'];
    const CUSTOM_TEMPLATE_STORAGE_KEY = 'eventgenix_report_table_templates_v1';
    const PARK_STANDARD_CATEGORIES = ['афіша', 'костюми', 'анімації', 'розходники', 'дар', 'квест', 'шоу', 'мафія', 'акція'];
    const PARK_STANDARD_DOCUMENTS = ['чек', 'без чека', 'тов чек', 'виписка', 'інше'];
    const REPORT_TABLE_TEMPLATES = [
        {
            id: 'park-standard-report',
            title: 'Стандартний звіт',
            category: 'Парк',
            layout: 'park-standard',
            description: 'Фіксований стандартний звіт парку: дата, категорія, документ, сума і коментар.',
            purpose: 'Щоденний park expense report для передачі бухгалтеру після закриття.',
            defaultReport: {
                type: 'expense',
                category: 'Стандартний звіт',
                hashtag: 'table-park-standard',
                amountColumn: 'amount',
                totalLabel: 'Ітого',
                subtotalRules: [
                    {
                        label: 'Ітого ДАР',
                        categoryColumn: 'category',
                        categoryValue: 'дар',
                        amountColumn: 'amount'
                    }
                ]
            },
            columns: [
                { key: 'date', label: 'Дата', type: 'date', placeholder: '2026-05-23' },
                { key: 'category', label: 'Категорія', type: 'select', options: PARK_STANDARD_CATEGORIES, placeholder: 'Оберіть категорію' },
                { key: 'document', label: 'Документ', type: 'select', options: PARK_STANDARD_DOCUMENTS, placeholder: 'Оберіть документ' },
                { key: 'amount', label: 'Сума', type: 'number', placeholder: '0', total: 'sum' },
                { key: 'comment', label: 'Коментар', type: 'text', placeholder: 'Коментар для бухгалтера' }
            ],
            rows: [
                { date: '', category: '', document: '', amount: '', comment: '' },
                { date: '', category: '', document: '', amount: '', comment: '' },
                { date: '', category: '', document: '', amount: '', comment: '' }
            ]
        },
        {
            id: 'finance-day-summary',
            title: 'Фінансовий підсумок дня',
            category: 'Фінанси',
            layout: 'financial',
            description: 'Доходи, витрати, маржа й короткий коментар по зміні.',
            purpose: 'Швидкий щоденний фінансовий звіт для бухгалтера або директора.',
            defaultReport: { type: 'income', category: 'Інше', hashtag: 'table-finance', amountColumn: 'profit' },
            columns: [
                { key: 'date', label: 'Дата', type: 'date', placeholder: '2026-05-22' },
                { key: 'income', label: 'Доходи', type: 'number', placeholder: '0', total: 'sum' },
                { key: 'expense', label: 'Витрати', type: 'number', placeholder: '0', total: 'sum' },
                { key: 'profit', label: 'Прибуток', type: 'number', placeholder: '0', total: 'sum' },
                { key: 'comment', label: 'Коментар', type: 'text', placeholder: 'Що вплинуло на результат?' }
            ],
            rows: [
                { date: '', income: '', expense: '', profit: '', comment: '' },
                { date: '', income: '', expense: '', profit: '', comment: '' }
            ]
        },
        {
            id: 'operations-checklist',
            title: 'Операційний чекліст',
            category: 'Операції',
            layout: 'checklist',
            description: 'Контроль зон, відповідальних і статусів перед/після зміни.',
            purpose: 'Стандартна таблиця для операційного контролю без фінансового перерахунку.',
            defaultReport: { type: 'expense', category: 'Офіс', hashtag: 'table-ops', amountColumn: null },
            columns: [
                { key: 'zone', label: 'Зона', type: 'text', placeholder: 'Reception / зал / кухня' },
                { key: 'task', label: 'Що перевірити', type: 'text', placeholder: 'Каса, чистота, реквізит...' },
                { key: 'owner', label: 'Відповідальний', type: 'text', placeholder: 'Імʼя' },
                { key: 'status', label: 'Статус', type: 'text', placeholder: 'OK / ризик / зробити' },
                { key: 'note', label: 'Нотатка', type: 'text', placeholder: 'Що потрібно доробити?' }
            ],
            rows: [
                { zone: 'Reception', task: 'Каса і чеки', owner: '', status: '', note: '' },
                { zone: 'Зал', task: 'Чистота та безпека', owner: '', status: '', note: '' },
                { zone: 'Склад', task: 'Реквізит і витратники', owner: '', status: '', note: '' }
            ]
        },
        {
            id: 'payroll-staff',
            title: 'Команда / payroll',
            category: 'HR',
            layout: 'payroll',
            description: 'Години, ставки, бонуси й сума до виплати по працівниках.',
            purpose: 'Таблична заготовка для передачі зарплатного звіту у фінанси.',
            defaultReport: { type: 'expense', category: 'ЗП', hashtag: 'table-payroll', amountColumn: 'total' },
            columns: [
                { key: 'employee', label: 'Працівник', type: 'text', placeholder: 'Імʼя' },
                { key: 'role', label: 'Роль', type: 'text', placeholder: 'Аніматор / адміністратор' },
                { key: 'hours', label: 'Години', type: 'number', placeholder: '0', total: 'sum' },
                { key: 'rate', label: 'Ставка', type: 'number', placeholder: '0' },
                { key: 'bonus', label: 'Бонус', type: 'number', placeholder: '0', total: 'sum' },
                { key: 'total', label: 'До виплати', type: 'number', placeholder: '0', total: 'sum' }
            ],
            rows: [
                { employee: '', role: '', hours: '', rate: '', bonus: '', total: '' },
                { employee: '', role: '', hours: '', rate: '', bonus: '', total: '' }
            ]
        },
        {
            id: 'custom-table',
            title: 'Кастомна таблиця',
            category: 'Custom',
            layout: 'custom',
            description: 'Порожній універсальний формат, коли потрібен нестандартний звіт.',
            purpose: 'Швидкий старт для ручного табличного звіту.',
            defaultReport: { type: 'expense', category: 'Інше', hashtag: 'table-custom', amountColumn: 'value' },
            columns: [
                { key: 'item', label: 'Позиція', type: 'text', placeholder: 'Назва рядка' },
                { key: 'value', label: 'Значення', type: 'number', placeholder: '0', total: 'sum' },
                { key: 'comment', label: 'Коментар', type: 'text', placeholder: 'Деталі' }
            ],
            rows: [
                { item: '', value: '', comment: '' },
                { item: '', value: '', comment: '' },
                { item: '', value: '', comment: '' }
            ]
        }
    ];

    // ==========================================
    // HELPERS
    // ==========================================

    async function apiRequest(method, url, body) {
        const token = localStorage.getItem('pzp_token');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (body) headers['Content-Type'] = 'application/json';
        const res = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });
        if (res.status === 401 || res.status === 403) {
            localStorage.removeItem('pzp_token');
        window.location.href = '/';
        throw new Error('Unauthorized');
        }
        if (!res.ok) {
            if (window.CrmApiErrors?.fromResponse) {
                throw await window.CrmApiErrors.fromResponse(res, 'Request failed');
            }
            const err = await res.json().catch(() => ({}));
            const error = new Error(err.error || 'Request failed');
            error.requestId = err.requestId || err.request_id || '';
            throw error;
        }
        return res.json();
    }

    function showNotification(msg, type = 'success') {
        const el = document.getElementById('notification');
        const text = document.getElementById('notificationText');
        if (!el || !text) return;
        text.textContent = window.CrmApiErrors?.format?.(msg) || String(msg || '');
        el.className = `notification ${type}`;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 3000);
    }

    function formatDateTime(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }) +
            ' ' + d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    }

    function formatAmount(amount) {
        return Number(amount).toLocaleString('uk-UA') + ' ₴';
    }

    function esc(str) {
        if (str === null || str === undefined) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function slugifyKey(value, fallback = 'column') {
        const raw = String(value || fallback).trim().toLowerCase();
        const ascii = raw
            .normalize('NFKD')
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        return ascii || `${fallback}-${Date.now()}`;
    }

    function normalizeReportRawData(rawData) {
        if (!rawData) return {};
        if (typeof rawData === 'object') return rawData;
        try {
            return JSON.parse(rawData);
        } catch {
            return {};
        }
    }

    function parseNumber(value) {
        if (value === null || value === undefined || value === '') return 0;
        const normalized = String(value).replace(/\s/g, '').replace(',', '.');
        const num = Number(normalized);
        return Number.isFinite(num) ? num : 0;
    }

    function normalizedComparable(value) {
        return String(value || '').trim().toLocaleLowerCase('uk-UA');
    }

    function reportTableLifecycleStatus(state = _reportTableState) {
        return state?.lifecycle?.status === 'closed' ? 'closed' : 'open';
    }

    function isReportTableLocked(state = _reportTableState) {
        return reportTableLifecycleStatus(state) === 'closed';
    }

    function isClosedReport(report) {
        if (!report) return false;
        const table = normalizeReportRawData(report.rawData).reportTableTemplate || {};
        return report.lifecycleStatus === 'closed' || table.lifecycle?.status === 'closed';
    }

    function closedLifecycleFromReport(report) {
        const table = normalizeReportRawData(report?.rawData).reportTableTemplate || {};
        if (table.lifecycle) return table.lifecycle;
        return {
            status: report?.lifecycleStatus === 'closed' ? 'closed' : 'open',
            closedAt: report?.closedAt || null,
            closedBy: report?.closedByUsername || null,
            closedByUserId: report?.closedByUserId || null
        };
    }

    function csvCell(value) {
        const text = String(value ?? '');
        return `"${text.replace(/"/g, '""')}"`;
    }

    function isTechnicalReportHashtag(tag) {
        return /^table(?:-|$)/i.test(String(tag || '').trim());
    }

    function visibleReportHashtags(tags) {
        return (Array.isArray(tags) ? tags : []).filter(tag => !isTechnicalReportHashtag(tag));
    }

    function templateReportHashtags(defaultReport = {}) {
        return [defaultReport.hashtag].filter(tag => tag && !isTechnicalReportHashtag(tag));
    }

    function hasMeaningfulTableData() {
        const state = _reportTableState;
        if (!state) return false;
        return state.rows.some(row => state.columns.some(col => String(row?.[col.key] ?? '').trim() !== ''));
    }

    function setReportTableDirty(isDirty = true, message = '') {
        _reportTableDirty = !!isDirty;
        refreshReportWorkspaceControls();
        if (message) setTemplateStatus(message);
    }

    function setReportTableBusy(isBusy, message = '') {
        _reportTableBusy = !!isBusy;
        refreshReportWorkspaceControls();
        if (message) setTemplateStatus(message);
    }

    function normalizeTemplate(template, source = 'standard') {
        if (!template || !Array.isArray(template.columns) || template.columns.length === 0) {
            throw new Error('У шаблоні мають бути columns');
        }
        const columns = template.columns.map((col, index) => {
            const label = String(col.label || col.title || col.key || `Колонка ${index + 1}`).trim();
            return {
                key: slugifyKey(col.key || label, `col-${index + 1}`),
                label,
                type: ['number', 'date', 'text', 'select'].includes(col.type) ? col.type : 'text',
                placeholder: String(col.placeholder || ''),
                total: col.total === 'sum' ? 'sum' : null,
                options: Array.isArray(col.options) ? col.options.map(String).filter(Boolean) : []
            };
        });
        const seen = new Set();
        columns.forEach((col, index) => {
            let key = col.key;
            while (seen.has(key)) key = `${col.key}-${index + 1}`;
            seen.add(key);
            col.key = key;
        });
        const rows = Array.isArray(template.rows) && template.rows.length
            ? template.rows
            : [Object.fromEntries(columns.map(col => [col.key, '']))];

        return {
            id: String(template.id || `${source}-${Date.now()}`),
            templateId: template.templateId || template.backendId || template.id || null,
            code: template.code || null,
            title: String(template.title || 'Новий шаблон'),
            category: String(template.category || 'Custom'),
            layout: String(template.layout || 'custom'),
            description: String(template.description || 'Завантажений шаблон таблиці.'),
            purpose: String(template.purpose || ''),
            source,
            scope: template.scope || (source === 'standard' ? 'global' : 'personal'),
            defaultReport: {
                type: template.defaultReport?.type === 'income' ? 'income' : 'expense',
                category: String(template.defaultReport?.category || 'Інше'),
                hashtag: String(template.defaultReport?.hashtag || `table-${source}`),
                amountColumn: template.defaultReport?.amountColumn || columns.find(col => col.type === 'number')?.key || null,
                totalLabel: String(template.defaultReport?.totalLabel || 'Ітого'),
                subtotalRules: Array.isArray(template.defaultReport?.subtotalRules) ? template.defaultReport.subtotalRules : []
            },
            columns,
            rows: rows.map(row => {
                const normalizedRow = {};
                columns.forEach(col => {
                    normalizedRow[col.key] = row?.[col.key] ?? '';
                });
                return normalizedRow;
            })
        };
    }

    function loadCustomReportTemplates() {
        try {
            const raw = localStorage.getItem(CUSTOM_TEMPLATE_STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.map(item => normalizeTemplate(item, 'uploaded'));
        } catch (err) {
            console.warn('Failed to load custom report templates', err);
            return [];
        }
    }

    function saveCustomReportTemplates() {
        try {
            const custom = _reportTemplates.filter(t => t.source === 'uploaded');
            localStorage.setItem(CUSTOM_TEMPLATE_STORAGE_KEY, JSON.stringify(custom));
        } catch (err) {
            console.warn('Failed to save custom report templates', err);
        }
    }

    const STATUS_LABELS = {
        new: 'Новий',
        processing: 'В обробці',
        done: 'Опрацьовано',
        rejected: 'Відхилено'
    };

    const APPROVAL_LABELS = {
        none: 'Не передано',
        pending: 'Очікує задачі',
        task_created: 'Задача бухгалтеру',
        in_review: 'На перевірці',
        approved: 'Затверджено',
        rejected: 'Повернуто'
    };

    // ==========================================
    // DATE RANGE HELPERS
    // ==========================================

    function getDateRange() {
        const period = document.getElementById('periodFilter')?.value || 'month';
        const now = new Date();
        const today = now.toISOString().slice(0, 10);

        if (period === 'custom') {
            return {
                dateFrom: document.getElementById('dateFromFilter')?.value || '',
                dateTo: document.getElementById('dateToFilter')?.value || ''
            };
        }
        if (period === 'today') return { dateFrom: today, dateTo: today };
        if (period === 'week') {
            const weekAgo = new Date(now);
            weekAgo.setDate(weekAgo.getDate() - 7);
            return { dateFrom: weekAgo.toISOString().slice(0, 10), dateTo: today };
        }
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        return { dateFrom: monthStart, dateTo: today };
    }

    // ==========================================
    // INIT
    // ==========================================

    async function init() {
        try {
            if (typeof apiVerifyToken === 'function') {
                const user = await apiVerifyToken();
                if (user) AppState.currentUser = user;
            }
        } catch { return; }
        if (typeof initDarkMode === 'function') initDarkMode();

        await setupReportTemplateWorkspace();

        const periodFilter = document.getElementById('periodFilter');
        if (periodFilter) {
            periodFilter.addEventListener('change', () => {
                const custom = periodFilter.value === 'custom';
                document.getElementById('dateFromFilter').style.display = custom ? '' : 'none';
                document.getElementById('dateToFilter').style.display = custom ? '' : 'none';
            });
        }

        document.getElementById('addReportBtn')?.addEventListener('click', () => openModal());
        document.getElementById('reportApprovalSaveBtn')?.addEventListener('click', saveWorkflowSettings);

        document.getElementById('reportModal')?.addEventListener('click', e => {
            if (e.target === e.currentTarget) closeModal();
        });

        const reportIdParam = Number(new URLSearchParams(window.location.search).get('reportId') || 0);
        _pendingOpenReportId = Number.isInteger(reportIdParam) && reportIdParam > 0 ? reportIdParam : null;

        await Promise.all([
            loadSummary(),
            loadReports(),
            loadOnDuty(),
            loadSubmitters(),
            loadHashtags(),
            loadWorkflowSettings()
        ]);
        if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
        else if (typeof Sidebar !== 'undefined' && Sidebar.markShellReady) Sidebar.markShellReady();
    }

    // ==========================================
    // DATA LOADING
    // ==========================================

    async function loadSummary() {
        try {
            const period = document.getElementById('periodFilter')?.value || 'month';
            const range = getDateRange();
            let url = `/api/reports/summary?period=${period}`;
            if (range.dateFrom) url += `&dateFrom=${range.dateFrom}`;
            if (range.dateTo) url += `&dateTo=${range.dateTo}`;

            _summary = await apiRequest('GET', url);
            renderSummaryCards();
        } catch (err) {
            console.error('Load summary error:', err);
        }
    }

    async function loadReports() {
        try {
            const params = new URLSearchParams();
            const range = getDateRange();
            if (range.dateFrom) params.set('dateFrom', range.dateFrom);
            if (range.dateTo) params.set('dateTo', range.dateTo);

            const type = document.getElementById('typeFilter')?.value;
            const status = document.getElementById('statusFilter')?.value;
            const submittedBy = document.getElementById('submittedByFilter')?.value;
            const category = document.getElementById('categoryFilter')?.value;
            const hashtag = document.getElementById('hashtagFilter')?.value;

            if (type) params.set('type', type);
            if (status) params.set('status', status);
            if (submittedBy) params.set('submittedBy', submittedBy);
            if (category) params.set('category', category);
            if (hashtag) params.set('hashtag', hashtag);

            params.set('limit', _limit);
            params.set('offset', (_page - 1) * _limit);

            const data = await apiRequest('GET', `/api/reports?${params}`);
            _reports = data.reports || [];
            _total = data.total || 0;

            sortReports();
            renderTable();
            renderPagination();
            if (_pendingOpenReportId && _reports.some(report => Number(report.id) === Number(_pendingOpenReportId))) {
                const id = _pendingOpenReportId;
                _pendingOpenReportId = null;
                setTimeout(() => {
                    if (_expandedRow !== id) toggleDetail(id);
                    document.querySelector(`tr[data-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 0);
            }
        } catch (err) {
            console.error('Load reports error:', err);
            const tbody = document.getElementById('reportsTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:#EF4444">Помилка завантаження</td></tr>';
        }
    }

    async function loadOnDuty() {
        try {
            const data = await apiRequest('GET', '/api/reports/accountants');
            const list = document.getElementById('onDutyList');
            if (!list) return;

            const onDuty = (data || []).filter(a => a.isOnDuty);
            if (onDuty.length === 0) {
                list.innerHTML = '<li style="color:var(--gray-400)">Ніхто не на зміні</li>';
                return;
            }
            list.innerHTML = onDuty.map(a =>
                `<li>👩‍💼 ${esc(a.name)}${a.phone ? ` (${esc(a.phone)})` : ''} ✅</li>`
            ).join('');
        } catch (err) {
            console.error('Load on-duty error:', err);
        }
    }

    async function loadWorkflowSettings() {
        try {
            _reportWorkflowSettings = await apiRequest('GET', '/api/reports/workflow-settings');
            _reportApprovalUsers = Array.isArray(_reportWorkflowSettings.users) ? _reportWorkflowSettings.users : [];
            renderWorkflowSettings();
        } catch (err) {
            console.error('Load report workflow settings error:', err);
            renderWorkflowSettings(true);
        }
    }

    function renderWorkflowSettings(hasError = false) {
        const select = document.getElementById('reportApprovalAssignee');
        const current = document.getElementById('reportApprovalCurrent');
        const hint = document.getElementById('reportApprovalHint');
        if (select) {
            const selectedId = String(_reportWorkflowSettings?.approvalAssigneeUserId || '');
            select.innerHTML = [
                '<option value="">Бухгалтер на зміні / fallback</option>',
                ..._reportApprovalUsers.map(user => {
                    const label = user.label || user.name || user.username || `User #${user.id}`;
                    return `<option value="${esc(user.id)}"${String(user.id) === selectedId ? ' selected' : ''}>${esc(label)}${user.role ? ` · ${esc(user.role)}` : ''}</option>`;
                })
            ].join('');
        }
        if (current) {
            current.textContent = hasError
                ? 'Налаштування недоступне'
                : (_reportWorkflowSettings?.approvalAssigneeLabel
                    ? `Задача піде: ${_reportWorkflowSettings.approvalAssigneeLabel}`
                    : 'Задача піде бухгалтеру на зміні');
        }
        if (hint) {
            hint.textContent = hasError
                ? 'Не вдалося завантажити маршрут перевірки. Закриття звіту все одно збереже сам звіт.'
                : 'Коли звіт закривають або вручну відправляють на перевірку, CRM створює задачу з джерелом report і показує її статус у списку.';
        }
    }

    async function saveWorkflowSettings() {
        const select = document.getElementById('reportApprovalAssignee');
        try {
            _reportWorkflowSettings = await apiRequest('PUT', '/api/reports/workflow-settings', {
                approvalAssigneeUserId: select?.value || null
            });
            _reportApprovalUsers = Array.isArray(_reportWorkflowSettings.users) ? _reportWorkflowSettings.users : [];
            renderWorkflowSettings();
            showNotification('Маршрут перевірки звітів збережено');
        } catch (err) {
            showNotification('Не вдалося зберегти маршрут: ' + err.message, 'error');
        }
    }

    async function loadSubmitters() {
        try {
            const data = await apiRequest('GET', '/api/reports?limit=500');
            const names = [...new Set((data.reports || []).map(r => r.submittedBy).filter(Boolean))];
            const select = document.getElementById('submittedByFilter');
            if (!select) return;
            names.sort().forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                select.appendChild(opt);
            });
        } catch (err) {
            console.error('Load submitters error:', err);
        }
    }

    async function loadHashtags() {
        try {
            _hashtagStats = await apiRequest('GET', '/api/reports/hashtags');
            renderHashtagDashboard();
            populateHashtagFilter();
        } catch (err) {
            console.error('Load hashtags error:', err);
        }
    }

    // ==========================================
    // SORTING
    // ==========================================

    function sortReports() {
        _reports.sort((a, b) => {
            let va = a[_sortField];
            let vb = b[_sortField];

            if (_sortField === 'amount') {
                va = parseFloat(va) || 0;
                vb = parseFloat(vb) || 0;
            } else if (_sortField === 'createdAt') {
                va = new Date(va || 0).getTime();
                vb = new Date(vb || 0).getTime();
            } else {
                va = String(va || '').toLowerCase();
                vb = String(vb || '').toLowerCase();
            }

            if (va < vb) return _sortDir === 'asc' ? -1 : 1;
            if (va > vb) return _sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    function sort(field) {
        if (_sortField === field) {
            _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            _sortField = field;
            _sortDir = field === 'amount' || field === 'createdAt' ? 'desc' : 'asc';
        }
        sortReports();
        renderTable();
    }

    // ==========================================
    // RENDER: Summary Cards
    // ==========================================

    function renderSummaryCards() {
        if (!_summary) return;
        const { today } = _summary;
        const inc = today?.income || 0;
        const exp = today?.expense || 0;

        document.getElementById('sumIncome').textContent = formatAmount(inc);
        document.getElementById('sumExpense').textContent = formatAmount(exp);
        document.getElementById('sumProfit').textContent = formatAmount(inc - exp);
        document.getElementById('sumPending').textContent = today?.newReports || _summary.statuses?.new || 0;
    }

    // ==========================================
    // RENDER: Template-driven report workspace
    // ==========================================

    async function setupReportTemplateWorkspace() {
        if (_reportTemplateWorkspaceReady) return;
        _reportTemplateWorkspaceReady = true;
        await loadReportTemplates();

        document.getElementById('reportTemplateUploadBtn')?.addEventListener('click', () => {
            document.getElementById('reportTemplateUpload')?.click();
        });
        document.getElementById('reportTemplateUpload')?.addEventListener('change', importReportTemplateFile);
        document.getElementById('reportTemplateImportCsvBtn')?.addEventListener('click', () => {
            document.getElementById('reportTableImportCsv')?.click();
        });
        document.getElementById('reportTableImportCsv')?.addEventListener('change', importReportTableCsv);
        document.getElementById('reportTemplateResetBtn')?.addEventListener('click', resetReportTemplateTable);
        document.getElementById('reportTemplateDraftBtn')?.addEventListener('click', saveReportTemplateDraft);
        document.getElementById('reportTemplateAddRowBtn')?.addEventListener('click', addReportTemplateRow);
        document.getElementById('reportTemplateAddColumnBtn')?.addEventListener('click', addReportTemplateColumn);
        document.getElementById('reportTemplateExportCsvBtn')?.addEventListener('click', exportReportTemplateCsv);
        document.getElementById('reportTemplateExportXlsxBtn')?.addEventListener('click', exportReportTemplateXlsx);
        document.getElementById('reportTemplateSaveBtn')?.addEventListener('click', createReportFromTemplate);
        document.getElementById('reportTemplateCloseBtn')?.addEventListener('click', closeReportTemplate);
        document.getElementById('reportSheetTitleInput')?.addEventListener('input', event => {
            if (!_reportTableState || isReportTableLocked()) return;
            _reportTableState.title = event.target.value;
            setReportTableDirty(true, 'Є незбережені зміни в назві звіту');
        });

        document.getElementById('reportTemplatePicker')?.addEventListener('change', async event => {
            const nextTemplateId = event.target.value;
            const previousTemplateId = _activeTemplateId;
            const switched = await selectReportTemplate(nextTemplateId);
            if (!switched) event.target.value = previousTemplateId;
        });

        const table = document.getElementById('reportSheetTable');
        table?.addEventListener('input', handleReportSheetInput);
        table?.addEventListener('click', event => {
            if (isReportTableLocked()) return;
            const columnDeleteBtn = event.target.closest('[data-report-column-delete]');
            if (columnDeleteBtn) {
                deleteReportTemplateColumn(columnDeleteBtn.dataset.reportColumnDelete);
                return;
            }
            const duplicateBtn = event.target.closest('[data-report-row-duplicate]');
            if (duplicateBtn) {
                duplicateReportTemplateRow(Number(duplicateBtn.dataset.reportRowDuplicate));
                return;
            }
            const deleteBtn = event.target.closest('[data-report-row-delete]');
            if (!deleteBtn) return;
            deleteReportTemplateRow(Number(deleteBtn.dataset.reportRowDelete));
        });
        table?.addEventListener('keydown', handleReportSheetKeyboard);
        table?.addEventListener('paste', handleReportSheetPaste);
        window.addEventListener('beforeunload', event => {
            if (!_reportTableDirty || isReportTableLocked()) return;
            event.preventDefault();
            event.returnValue = '';
        });

        renderReportTemplateCards();
        await loadReportDrafts();
        loadReportTemplate(_activeTemplateId, { silent: true });
    }

    async function loadReportTemplates() {
        try {
            const data = await apiRequest('GET', '/api/reports/templates');
            _canManageReportTemplates = !!data.canManage;
            _reportTemplates = (data.templates || []).map(template => normalizeTemplate({
                id: String(template.code || template.id),
                backendId: template.id,
                code: template.code,
                title: template.title,
                category: template.category,
                layout: template.layout,
                description: template.description,
                purpose: template.purpose,
                columns: template.columns,
                rows: template.rows,
                defaultReport: template.defaultReport,
                source: template.source || 'backend',
                scope: template.scope
            }, template.source || 'backend'));
        } catch (err) {
            console.warn('Backend report templates unavailable, using local fallback', err);
            _reportTemplates = [
                ...REPORT_TABLE_TEMPLATES.map(template => normalizeTemplate(clone(template), 'standard')),
                ...loadCustomReportTemplates()
            ];
        }
        if (!_reportTemplates.length) {
            _reportTemplates = REPORT_TABLE_TEMPLATES.map(template => normalizeTemplate(clone(template), 'standard'));
        }
        if (!_reportTemplates.some(t => t.id === _activeTemplateId)) {
            _activeTemplateId = _reportTemplates[0]?.id;
        }
    }

    function renderReportTemplateCards() {
        const picker = document.getElementById('reportTemplatePicker');
        const activeChip = document.getElementById('reportTemplateActiveChip');
        if (picker) {
            const currentValue = picker.value || _activeTemplateId;
            picker.innerHTML = _reportTemplates.map(template => `
                <option value="${esc(template.id)}">${esc(template.title)} · ${esc(template.category)} · ${template.columns.length} колонок</option>
            `).join('');
            picker.value = _reportTemplates.some(t => t.id === currentValue) ? currentValue : _activeTemplateId;
        }
        const active = _reportTemplates.find(template => template.id === _activeTemplateId);
        if (activeChip) {
            activeChip.textContent = active
                ? `${active.title} · ${active.category} · ${active.columns.length} колонок`
                : 'Шаблон не вибрано';
        }
    }

    async function loadReportDrafts() {
        try {
            const data = await apiRequest('GET', '/api/reports/drafts');
            _reportDrafts = data.drafts || [];
            renderReportDrafts();
        } catch (err) {
            console.warn('Report drafts unavailable', err);
            _reportDrafts = [];
            renderReportDrafts();
        }
    }

    function renderReportDrafts() {
        const container = document.getElementById('reportDraftList');
        if (!container) return;
        if (!_reportDrafts.length) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = [
            '<span class="rpt-template-chip">Чернетки</span>',
            ..._reportDrafts.slice(0, 8).map(draft => `
                <button type="button" class="rpt-draft-chip" data-report-draft-id="${draft.id}" title="Відкрити чернетку">
                    ${esc(draft.title)} · ${formatDateTime(draft.updatedAt)}
                </button>
            `)
        ].join('');
        container.querySelectorAll('[data-report-draft-id]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!(await confirmDiscardReportTableChanges())) return;
                openReportDraft(Number(btn.dataset.reportDraftId));
            });
        });
    }

    function setTemplateStatus(message = '') {
        const status = document.getElementById('reportTemplateStatus');
        if (status) status.textContent = message;
    }

    function refreshReportWorkspaceControls() {
        const state = _reportTableState;
        const locked = isReportTableLocked(state);
        const dirty = document.getElementById('reportTemplateDirty');
        if (dirty) dirty.classList.toggle('hidden', !_reportTableDirty);

        const mode = document.getElementById('reportSheetModeChip');
        if (mode) {
            mode.textContent = locked
                ? `Закритий звіт${_editingTableReportId ? ` #${_editingTableReportId}` : ''}`
                : _editingTableReportId
                ? `Редагування звіту #${_editingTableReportId}`
                : _editingDraftId
                    ? `Чернетка #${_editingDraftId}`
                    : 'Новий звіт';
            mode.classList.toggle('closed', locked);
        }

        const draftBtn = document.getElementById('reportTemplateDraftBtn');
        if (draftBtn) draftBtn.textContent = _editingDraftId ? 'Оновити чернетку' : 'Зберегти чернетку';

        const saveBtn = document.getElementById('reportTemplateSaveBtn');
        if (saveBtn) saveBtn.textContent = _editingTableReportId ? 'Оновити звіт з таблиці' : 'Створити звіт з таблиці';

        const finalHandoff = document.getElementById('reportFinalHandoff');
        if (finalHandoff) {
            finalHandoff.classList.toggle('is-locked', locked);
            finalHandoff.classList.toggle('is-busy', _reportTableBusy);
        }

        const closeBtn = document.getElementById('reportTemplateCloseBtn');
        if (closeBtn) {
            closeBtn.classList.toggle('is-locked', locked);
            closeBtn.innerHTML = locked
                ? '<span>Звіт закрито</span><small>Передано на перевірку бухгалтеру</small>'
                : '<span>Закрити і передати бухгалтеру</span><small>Останній крок роботи зі звітом</small>';
        }

        [
            'reportTemplateUploadBtn',
            'reportTemplateImportCsvBtn',
            'reportTemplateResetBtn',
            'reportTemplateDraftBtn',
            'reportTemplateAddRowBtn',
            'reportTemplateAddColumnBtn',
            'reportTemplateSaveBtn',
            'reportSheetTitleInput'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = _reportTableBusy || !state || locked;
        });

        [
            'reportTemplateExportCsvBtn',
            'reportTemplateExportXlsxBtn'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = _reportTableBusy || !state;
        });

        if (closeBtn) closeBtn.disabled = _reportTableBusy || !state || locked || !hasMeaningfulTableData();
    }

    async function confirmDiscardReportTableChanges() {
        if (!_reportTableDirty || _reportTableBusy) return true;
        const message = 'У таблиці є незбережені зміни. Замінити її іншим шаблоном і втратити ці правки?';
        if (typeof confirmModal === 'function') {
            return !!(await confirmModal(message, {
                title: 'Незбережені зміни',
                confirmText: 'Замінити таблицю',
                cancelText: 'Лишитись тут'
            }));
        }
        return false;
    }

    async function selectReportTemplate(templateId) {
        if (!(await confirmDiscardReportTableChanges())) return false;
        loadReportTemplate(templateId);
        return true;
    }

    function loadReportTemplate(templateId, options = {}) {
        const template = _reportTemplates.find(t => t.id === templateId) || _reportTemplates[0];
        if (!template) return;

        _activeTemplateId = template.id;
        _editingDraftId = null;
        _editingTableReportId = null;
        _reportTableState = {
            ...clone(template),
            rows: template.rows.map(row => ({ ...row })),
            lifecycle: { status: 'open' }
        };
        _reportTableDirty = false;

        renderReportTemplateCards();
        renderReportTableWorkspace();
        if (!options.silent) setTemplateStatus(`Шаблон "${template.title}" завантажено`);
    }

    function renderReportTableWorkspace() {
        const state = _reportTableState;
        const table = document.getElementById('reportSheetTable');
        if (!state || !table) return;
        const locked = isReportTableLocked(state);

        const title = document.getElementById('reportSheetTitle');
        const meta = document.getElementById('reportSheetMeta');
        const titleInput = document.getElementById('reportSheetTitleInput');
        if (title) title.textContent = state.title;
        if (titleInput && titleInput.value !== state.title) titleInput.value = state.title;
        if (titleInput) titleInput.readOnly = locked;
        if (meta) {
            const lockMeta = locked && state.lifecycle?.closedAt
                ? ` · закрито ${formatDateTime(state.lifecycle.closedAt)}${state.lifecycle.closedBy ? ` · ${state.lifecycle.closedBy}` : ''}`
                : '';
            meta.textContent = `${state.purpose || state.description} · ${state.rows.length} рядків · ${state.columns.length} колонок${lockMeta}`;
        }

        const head = `
            <thead>
                <tr>
                    <th class="rpt-sheet-row-index">#</th>
                    ${state.columns.map(col => `
                        <th>
                            <span class="rpt-sheet-th-content">
                                <span>${esc(col.label)}</span>
                                ${locked ? '' : `<button type="button" class="rpt-sheet-column-delete" data-report-column-delete="${esc(col.key)}" title="Видалити колонку ${esc(col.label)}">×</button>`}
                            </span>
                        </th>
                    `).join('')}
                    ${locked ? '' : '<th aria-label="Дії">Дії</th>'}
                </tr>
            </thead>
        `;
        const body = `
            <tbody>
                ${state.rows.map((row, rowIndex) => `
                    <tr>
                        <td class="rpt-sheet-row-index">${rowIndex + 1}</td>
                        ${state.columns.map(col => `
                            <td>
                                ${renderReportSheetField(col, row, rowIndex, locked)}
                            </td>
                        `).join('')}
                        ${locked ? '' : `<td>
                            <div class="rpt-sheet-row-actions">
                                <button type="button" class="rpt-sheet-row-action" data-report-row-duplicate="${rowIndex}" title="Дублювати рядок">⧉</button>
                                <button type="button" class="rpt-sheet-delete" data-report-row-delete="${rowIndex}" title="Видалити рядок">×</button>
                            </div>
                        </td>`}
                    </tr>
                `).join('')}
            </tbody>
        `;
        const totals = renderReportSheetTotals();
        table.innerHTML = head + body + totals;
        renderReportSheetSummary();
        refreshReportWorkspaceControls();
    }

    function renderReportSheetField(col, row, rowIndex, locked) {
        const common = `
            data-row-index="${rowIndex}"
            data-column-key="${esc(col.key)}"
            ${locked ? 'disabled aria-readonly="true"' : ''}
            aria-label="${esc(col.label)} рядок ${rowIndex + 1}"`;
        if (col.type === 'select') {
            const current = String(row[col.key] ?? '');
            const options = Array.isArray(col.options) ? col.options : [];
            return `
                <select class="rpt-sheet-input rpt-sheet-select" ${common}>
                    <option value="">${esc(col.placeholder || 'Оберіть')}</option>
                    ${options.map(option => `<option value="${esc(option)}" ${option === current ? 'selected' : ''}>${esc(option)}</option>`).join('')}
                </select>
            `;
        }
        return `
            <input class="rpt-sheet-input"
                ${common}
                type="${col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}"
                step="${col.type === 'number' ? '0.01' : ''}"
                value="${esc(row[col.key])}"
                placeholder="${esc(col.placeholder)}">
        `;
    }

    function renderReportSheetTotals() {
        if (!_reportTableState) return '';
        const state = _reportTableState;
        const totalColumns = state.columns.filter(col => col.total === 'sum');
        if (!totalColumns.length) return '';
        const totalsByKey = new Map(totalColumns.map(col => [
            col.key,
            state.rows.reduce((sum, row) => sum + parseNumber(row[col.key]), 0)
        ]));
        const label = state.defaultReport?.totalLabel || 'Ітого';
        const locked = isReportTableLocked();
        return `
            <tfoot>
                <tr class="rpt-sheet-total-row">
                    <td>${esc(label)}</td>
                    ${state.columns.map(col => `<td data-report-total-key="${esc(col.key)}">${totalsByKey.has(col.key) ? formatAmount(totalsByKey.get(col.key)) : ''}</td>`).join('')}
                    ${locked ? '' : '<td></td>'}
                </tr>
            </tfoot>
        `;
    }

    function reportTableSubtotalRows(state = _reportTableState) {
        if (!state) return [];
        const totalColumns = state.columns.filter(col => col.total === 'sum');
        const totalsByKey = new Map(totalColumns.map(col => [
            col.key,
            state.rows.reduce((sum, row) => sum + parseNumber(row[col.key]), 0)
        ]));
        const rows = [];
        if (state.defaultReport?.amountColumn) {
            rows.push({
                label: state.defaultReport.totalLabel || 'Ітого',
                amount: state.rows.reduce((sum, row) => sum + parseNumber(row[state.defaultReport.amountColumn]), 0),
                kind: 'total'
            });
        } else if (totalColumns.length === 1) {
            rows.push({ label: 'Ітого', amount: totalsByKey.get(totalColumns[0].key) || 0, kind: 'total' });
        }
        const rules = Array.isArray(state.defaultReport?.subtotalRules) ? state.defaultReport.subtotalRules : [];
        rules.forEach(rule => {
            const matchingRows = state.rows.filter(row =>
                normalizedComparable(row?.[rule.categoryColumn]) === normalizedComparable(rule.categoryValue)
            );
            if (!matchingRows.length) return;
            rows.push({
                label: rule.label || 'Ітого',
                amount: matchingRows.reduce((sum, row) => sum + parseNumber(row?.[rule.amountColumn]), 0),
                kind: 'subtotal'
            });
        });
        return rows;
    }

    function renderReportSheetSummary() {
        const container = document.getElementById('reportSheetSummary');
        if (!container || !_reportTableState) return;
        const rows = reportTableSubtotalRows();
        container.classList.toggle('hidden', rows.length === 0);
        container.innerHTML = rows.map(item => `
            <div class="rpt-sheet-summary-card ${item.kind === 'subtotal' ? 'accent' : ''}">
                <span>${esc(item.label)}</span>
                <strong>${formatAmount(item.amount)}</strong>
            </div>
        `).join('');
    }

    function refreshReportSheetTotals() {
        if (!_reportTableState) return;
        const totalColumns = _reportTableState.columns.filter(col => col.total === 'sum');
        const totalsByKey = new Map(totalColumns.map(col => [
            col.key,
            _reportTableState.rows.reduce((sum, row) => sum + parseNumber(row[col.key]), 0)
        ]));
        document.querySelectorAll('[data-report-total-key]').forEach(cell => {
            const key = cell.dataset.reportTotalKey;
            cell.textContent = totalsByKey.has(key) ? formatAmount(totalsByKey.get(key)) : '';
        });
        renderReportSheetSummary();
    }

    function handleReportSheetInput(event) {
        const input = event.target.closest('.rpt-sheet-input');
        if (!input || !_reportTableState || isReportTableLocked()) return;
        const rowIndex = Number(input.dataset.rowIndex);
        const key = input.dataset.columnKey;
        if (!_reportTableState.rows[rowIndex] || !key) return;
        _reportTableState.rows[rowIndex][key] = input.value;
        refreshReportSheetTotals();
        setReportTableDirty(true, 'Є незбережені зміни в таблиці');
    }

    function focusSheetCell(rowIndex, columnIndex) {
        const key = _reportTableState?.columns[columnIndex]?.key;
        if (!key) return;
        const target = Array.from(document.querySelectorAll('.rpt-sheet-input')).find(input =>
            Number(input.dataset.rowIndex) === rowIndex && input.dataset.columnKey === key
        );
        target?.focus();
    }

    function handleReportSheetKeyboard(event) {
        const input = event.target.closest('.rpt-sheet-input');
        if (!input || !_reportTableState || isReportTableLocked()) return;
        const rowIndex = Number(input.dataset.rowIndex);
        const columnIndex = _reportTableState.columns.findIndex(col => col.key === input.dataset.columnKey);
        if (columnIndex < 0) return;

        if (event.key === 'Enter') {
            event.preventDefault();
            if (rowIndex === _reportTableState.rows.length - 1) addReportTemplateRow();
            focusSheetCell(Math.min(rowIndex + 1, _reportTableState.rows.length - 1), columnIndex);
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusSheetCell(Math.min(rowIndex + 1, _reportTableState.rows.length - 1), columnIndex);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusSheetCell(Math.max(rowIndex - 1, 0), columnIndex);
        } else if (event.key === 'Tab' && !event.shiftKey && columnIndex === _reportTableState.columns.length - 1 && rowIndex === _reportTableState.rows.length - 1) {
            addReportTemplateRow();
        }
    }

    function handleReportSheetPaste(event) {
        const input = event.target.closest('.rpt-sheet-input');
        if (!input || !_reportTableState || isReportTableLocked()) return;
        const text = event.clipboardData?.getData('text/plain') || '';
        if (!text.includes('\t') && !text.includes('\n')) return;
        event.preventDefault();
        const startRow = Number(input.dataset.rowIndex);
        const startCol = _reportTableState.columns.findIndex(col => col.key === input.dataset.columnKey);
        const matrix = text.trimEnd().split(/\r?\n/).map(line => line.split('\t'));
        while (_reportTableState.rows.length < startRow + matrix.length) {
            _reportTableState.rows.push(Object.fromEntries(_reportTableState.columns.map(col => [col.key, ''])));
        }
        matrix.forEach((line, rowOffset) => {
            line.forEach((cell, colOffset) => {
                const col = _reportTableState.columns[startCol + colOffset];
                if (!col) return;
                _reportTableState.rows[startRow + rowOffset][col.key] = cell;
            });
        });
        renderReportTableWorkspace();
        focusSheetCell(startRow, startCol);
        setReportTableDirty(true, 'Дані вставлено з буфера');
    }

    function addReportTemplateRow() {
        if (!_reportTableState || isReportTableLocked()) return;
        const row = Object.fromEntries(_reportTableState.columns.map(col => [col.key, '']));
        _reportTableState.rows.push(row);
        renderReportTableWorkspace();
        setReportTableDirty(true, 'Додано рядок');
    }

    function duplicateReportTemplateRow(rowIndex) {
        if (!_reportTableState || isReportTableLocked() || !_reportTableState.rows[rowIndex]) return;
        _reportTableState.rows.splice(rowIndex + 1, 0, { ..._reportTableState.rows[rowIndex] });
        renderReportTableWorkspace();
        setReportTableDirty(true, 'Рядок продубльовано');
    }

    function deleteReportTemplateRow(rowIndex) {
        if (!_reportTableState || isReportTableLocked()) return;
        if (_reportTableState.rows.length <= 1) {
            setTemplateStatus('У таблиці має лишитися хоча б один рядок');
            return;
        }
        _reportTableState.rows.splice(rowIndex, 1);
        renderReportTableWorkspace();
        setReportTableDirty(true, 'Рядок видалено');
    }

    function uniqueReportColumnKey(label) {
        const base = slugifyKey(label, `col-${_reportTableState.columns.length + 1}`);
        const taken = new Set(_reportTableState.columns.map(col => col.key));
        if (!taken.has(base)) return base;
        let index = 2;
        while (taken.has(`${base}-${index}`)) index += 1;
        return `${base}-${index}`;
    }

    async function addReportTemplateColumn() {
        if (!_reportTableState || isReportTableLocked()) return;
        if (typeof promptModal !== 'function') {
            showNotification('Модальне поле для назви колонки недоступне', 'error');
            return;
        }
        const label = await promptModal('Назва колонки:', { defaultValue: '' });
        if (!label || !label.trim()) return;
        const key = uniqueReportColumnKey(label);
        _reportTableState.columns.push({
            key,
            label: label.trim(),
            type: 'text',
            placeholder: ''
        });
        _reportTableState.rows.forEach(row => { row[key] = ''; });
        renderReportTableWorkspace();
        setReportTableDirty(true, 'Додано колонку');
    }

    function deleteReportTemplateColumn(key) {
        if (!_reportTableState || isReportTableLocked() || !key) return;
        if (_reportTableState.columns.length <= 1) {
            setTemplateStatus('У таблиці має лишитися хоча б одна колонка');
            return;
        }
        const column = _reportTableState.columns.find(col => col.key === key);
        _reportTableState.columns = _reportTableState.columns.filter(col => col.key !== key);
        _reportTableState.rows.forEach(row => { delete row[key]; });
        renderReportTableWorkspace();
        setReportTableDirty(true, `Колонку "${column?.label || key}" видалено`);
    }

    async function resetReportTemplateTable() {
        if (isReportTableLocked()) return;
        if (!(await confirmDiscardReportTableChanges())) return;
        loadReportTemplate(_activeTemplateId);
    }

    function openReportDraft(draftId) {
        const draft = _reportDrafts.find(item => item.id === draftId);
        const table = draft?.tableJson?.reportTableTemplate;
        if (!draft || !table) return;
        _editingDraftId = draft.id;
        _editingTableReportId = null;
        _activeTemplateId = String(table.id || draft.templateId || _activeTemplateId);
        _reportTableState = {
            id: String(table.id || draft.templateId || `draft-${draft.id}`),
            templateId: draft.templateId || table.templateId || null,
            title: table.title || draft.title,
            category: table.category || 'Custom',
            layout: table.layout || 'custom',
            source: table.source || 'draft',
            scope: 'personal',
            purpose: table.purpose || '',
            description: table.description || 'Чернетка табличного звіту',
            defaultReport: table.defaultReport || {},
            columns: Array.isArray(table.columns) ? table.columns : [],
            rows: Array.isArray(table.rows) ? table.rows : [],
            lifecycle: table.lifecycle || { status: draft.status === 'closed' ? 'closed' : 'open' }
        };
        _reportTableDirty = false;
        renderReportTemplateCards();
        renderReportTableWorkspace();
        setTemplateStatus(`Відкрито чернетку #${draft.id}`);
    }

    function openReportTableForEditing(report) {
        const table = normalizeReportRawData(report?.rawData).reportTableTemplate;
        if (!table) return;
        _editingDraftId = null;
        _editingTableReportId = report.id;
        _activeTemplateId = String(table.id || _activeTemplateId);
        _reportTableState = {
            id: String(table.id || `report-${report.id}`),
            templateId: table.templateId || null,
            title: table.title || report.description || `Звіт #${report.id}`,
            category: table.category || report.category || 'Custom',
            layout: table.layout || 'custom',
            source: table.source || 'report',
            scope: 'report',
            purpose: table.purpose || '',
            description: table.description || 'Збережений табличний звіт',
            defaultReport: table.defaultReport || {},
            columns: Array.isArray(table.columns) ? table.columns : [],
            rows: Array.isArray(table.rows) ? table.rows : [],
            lifecycle: closedLifecycleFromReport(report)
        };
        _reportTableDirty = false;
        renderReportTemplateCards();
        renderReportTableWorkspace();
        setTemplateStatus(isReportTableLocked() ? `Перегляд закритого звіту #${report.id}` : `Редагування збереженого звіту #${report.id}`);
        document.getElementById('report-template-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function importReportTemplateFile(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (isReportTableLocked()) {
            event.target.value = '';
            return;
        }
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const template = normalizeTemplate({
                ...parsed,
                id: parsed.id || `uploaded-${Date.now()}`
            }, 'uploaded');

            try {
                const saved = await apiRequest('POST', '/api/reports/templates', {
                    title: template.title,
                    category: template.category,
                    layout: template.layout,
                    description: template.description,
                    purpose: template.purpose,
                    scope: _canManageReportTemplates ? 'global' : 'personal',
                    source: 'uploaded',
                    columns: template.columns,
                    rows: template.rows,
                    defaultReport: template.defaultReport
                });
                const backendTemplate = saved.template;
                const normalized = normalizeTemplate({
                    id: String(backendTemplate.code || backendTemplate.id),
                    backendId: backendTemplate.id,
                    code: backendTemplate.code,
                    title: backendTemplate.title,
                    category: backendTemplate.category,
                    layout: backendTemplate.layout,
                    description: backendTemplate.description,
                    purpose: backendTemplate.purpose,
                    columns: backendTemplate.columns,
                    rows: backendTemplate.rows,
                    defaultReport: backendTemplate.defaultReport,
                    source: backendTemplate.source || 'uploaded',
                    scope: backendTemplate.scope
                }, backendTemplate.source || 'uploaded');
                _reportTemplates = _reportTemplates.filter(t => t.id !== normalized.id);
                _reportTemplates.push(normalized);
                renderReportTemplateCards();
                loadReportTemplate(normalized.id);
            } catch (apiErr) {
                _reportTemplates = _reportTemplates.filter(t => t.id !== template.id);
                _reportTemplates.push(template);
                saveCustomReportTemplates();
                renderReportTemplateCards();
                loadReportTemplate(template.id);
                console.warn('Template saved locally because backend save failed', apiErr);
            }
            showNotification('Шаблон таблиці завантажено');
        } catch (err) {
            showNotification('Не вдалося завантажити шаблон: ' + err.message, 'error');
        } finally {
            event.target.value = '';
        }
    }

    function parseCsvLine(line) {
        const result = [];
        let current = '';
        let quoted = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"' && line[i + 1] === '"') {
                current += '"';
                i++;
            } else if (ch === '"') {
                quoted = !quoted;
            } else if ((ch === ';' || ch === ',') && !quoted) {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current);
        return result;
    }

    async function importReportTableCsv(event) {
        const file = event.target.files?.[0];
        if (!file || !_reportTableState || isReportTableLocked()) {
            if (event.target) event.target.value = '';
            return;
        }
        try {
            const text = await file.text();
            const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter(line => line.trim());
            if (lines.length < 2) throw new Error('CSV має містити заголовок і хоча б один рядок');
            const headers = parseCsvLine(lines[0]).map(h => h.trim());
            const columns = headers.map((label, index) => ({
                key: slugifyKey(label || `Колонка ${index + 1}`, `csv-${index + 1}`),
                label: label || `Колонка ${index + 1}`,
                type: 'text',
                placeholder: ''
            }));
            const rows = lines.slice(1).map(line => {
                const cells = parseCsvLine(line);
                return Object.fromEntries(columns.map((col, index) => [col.key, cells[index] || '']));
            });
            _reportTableState.columns = columns;
            _reportTableState.rows = rows.length ? rows : [Object.fromEntries(columns.map(col => [col.key, '']))];
            renderReportTableWorkspace();
            setReportTableDirty(true, 'CSV імпортовано в поточну таблицю');
        } catch (err) {
            showNotification('Не вдалося імпортувати CSV: ' + err.message, 'error');
        } finally {
            event.target.value = '';
        }
    }

    function buildReportTablePayload() {
        if (!_reportTableState) return null;
        return {
            reportTableTemplate: {
                id: _reportTableState.id,
                templateId: _reportTableState.templateId || null,
                schemaVersion: 1,
                title: _reportTableState.title,
                category: _reportTableState.category,
                layout: _reportTableState.layout,
                source: _reportTableState.source,
                purpose: _reportTableState.purpose,
                description: _reportTableState.description,
                defaultReport: _reportTableState.defaultReport || {},
                columns: _reportTableState.columns,
                rows: _reportTableState.rows,
                lifecycle: _reportTableState.lifecycle || { status: 'open' },
                generatedAt: new Date().toISOString()
            }
        };
    }

    function getTemplateReportAmount() {
        const state = _reportTableState;
        if (!state) return 0;
        const amountColumn = state.defaultReport?.amountColumn;
        if (!amountColumn) return 0;
        return Math.max(0, Math.round(state.rows.reduce((sum, row) => sum + parseNumber(row[amountColumn]), 0)));
    }

    async function saveReportTemplateDraft() {
        if (!_reportTableState || isReportTableLocked()) return;
        if (!String(_reportTableState.title || '').trim()) {
            showNotification('Вкажіть назву чернетки', 'error');
            document.getElementById('reportSheetTitleInput')?.focus();
            return;
        }
        const payload = buildReportTablePayload();
        const templateId = Number(_reportTableState.templateId);
        const body = {
            title: _reportTableState.title,
            templateId: Number.isInteger(templateId) ? templateId : null,
            tableJson: payload
        };

        try {
            const data = _editingDraftId
                ? await apiRequest('PUT', `/api/reports/drafts/${_editingDraftId}`, body)
                : await apiRequest('POST', '/api/reports/drafts', body);
            _editingDraftId = data.draft?.id || _editingDraftId;
            _editingTableReportId = null;
            _reportTableDirty = false;
            await loadReportDrafts();
            refreshReportWorkspaceControls();
            showNotification('Чернетку табличного звіту збережено');
            setTemplateStatus(`Чернетка #${_editingDraftId} збережена. Можна повернутися до неї пізніше.`);
        } catch (err) {
            showNotification('Помилка збереження чернетки: ' + err.message, 'error');
        }
    }

    async function downloadReportTableExport(format) {
        if (!_reportTableState) return;
        const payload = buildReportTablePayload();
        const token = localStorage.getItem('pzp_token');
        try {
            const res = await fetch(`/api/reports/table/export-${format}`, {
                method: 'POST',
                headers: {
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Export failed');
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${slugifyKey(_reportTableState.title, 'report')}.${format}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            setTemplateStatus(`${format.toUpperCase()} експортовано`);
        } catch (err) {
            showNotification(`Помилка ${format.toUpperCase()} експорту: ${err.message}`, 'error');
        }
    }

    function exportReportTemplateCsv() {
        return downloadReportTableExport('csv');
    }

    async function exportReportTemplateXlsx() {
        await downloadReportTableExport('xlsx');
    }

    function validateReportTableForCreate() {
        if (!_reportTableState || isReportTableLocked()) return false;
        if (!String(_reportTableState.title || '').trim()) {
            showNotification('Вкажіть назву звіту перед створенням', 'error');
            document.getElementById('reportSheetTitleInput')?.focus();
            return false;
        }
        if (!_reportTableState.columns.length || !_reportTableState.rows.length) {
            showNotification('Таблиця має містити хоча б одну колонку і один рядок', 'error');
            return false;
        }
        if (!hasMeaningfulTableData()) {
            showNotification('Заповніть хоча б одну клітинку таблиці перед створенням звіту', 'error');
            return false;
        }
        return true;
    }

    async function createReportFromTemplate() {
        if (!_reportTableState) return;
        if (_reportTableBusy || isReportTableLocked() || !validateReportTableForCreate()) return;
        const reportDefaults = _reportTableState.defaultReport || {};
        const amount = getTemplateReportAmount();
        const payload = buildReportTablePayload();
        const description = `Табличний звіт: ${_reportTableState.title}`;
        const category = reportDefaults.category || _reportTableState.category || 'Інше';
        const hashtags = templateReportHashtags(reportDefaults);

        try {
            setReportTableBusy(true, _editingTableReportId ? 'Оновлюю звіт...' : 'Створюю звіт з таблиці...');
            let savedReportId = _editingTableReportId;
            if (_editingDraftId) {
                const templateId = Number(_reportTableState.templateId);
                await apiRequest('PUT', `/api/reports/drafts/${_editingDraftId}`, {
                    title: _reportTableState.title,
                    templateId: Number.isInteger(templateId) ? templateId : null,
                    tableJson: payload
                });
                const data = await apiRequest('POST', `/api/reports/drafts/${_editingDraftId}/submit`, {
                    amount,
                    description,
                    category,
                    hashtags
                });
                savedReportId = data.report?.id || savedReportId;
                _editingDraftId = null;
            } else if (_editingTableReportId) {
                const data = await apiRequest('PUT', `/api/reports/${_editingTableReportId}`, {
                    type: reportDefaults.type || 'expense',
                    amount,
                    description,
                    category,
                    hashtags,
                    rawData: payload
                });
                savedReportId = data.id || savedReportId;
            } else {
                const data = await apiRequest('POST', '/api/reports', {
                    type: reportDefaults.type || 'expense',
                    amount,
                    description,
                    category,
                    hashtags,
                    submittedVia: 'web-template',
                    rawData: payload
                });
                savedReportId = data.id || savedReportId;
            }
            const actionLabel = _editingTableReportId ? 'оновлено' : 'створено';
            _editingTableReportId = savedReportId || null;
            _reportTableDirty = false;
            showNotification(`Табличний звіт ${actionLabel}`);
            setTemplateStatus(`Звіт ${actionLabel} і збережено в реєстрі`);
            await Promise.all([loadReports(), loadSummary(), loadHashtags(), loadReportDrafts()]);
            refreshReportWorkspaceControls();
            if (_editingTableReportId) {
                setTimeout(() => {
                    const row = document.querySelector(`tr[data-id="${_editingTableReportId}"]`);
                    if (row && _expandedRow !== _editingTableReportId) toggleDetail(_editingTableReportId);
                }, 0);
            }
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        } finally {
            setReportTableBusy(false);
        }
    }

    async function closeReportTemplate() {
        if (!_reportTableState || _reportTableBusy || isReportTableLocked()) return;
        if (!validateReportTableForCreate()) return;
        if (typeof confirmModal === 'function') {
            const ok = await confirmModal(
                'Закрити звіт і передати бухгалтеру?\n\nПісля закриття таблиця стане доступною лише для перегляду. Редагування рядків, колонок і суми буде заблоковано.',
                { type: 'warning', okText: 'Так, передати бухгалтеру', cancelText: 'Скасувати' }
            );
            if (!ok) return;
        }

        const reportDefaults = _reportTableState.defaultReport || {};
        const amount = getTemplateReportAmount();
        const payload = buildReportTablePayload();
        const description = `Табличний звіт: ${_reportTableState.title}`;
        const category = reportDefaults.category || _reportTableState.category || 'Інше';
        const hashtags = templateReportHashtags(reportDefaults);

        try {
            setReportTableBusy(true, 'Закриваю звіт і передаю бухгалтеру...');
            const data = await apiRequest('POST', '/api/reports/table/close', {
                reportId: _editingTableReportId,
                draftId: _editingDraftId,
                amount,
                description,
                category,
                hashtags,
                tableJson: payload
            });
            const report = data.report;
            if (report) {
                _editingTableReportId = report.id || _editingTableReportId;
                _editingDraftId = null;
                const closedTable = normalizeReportRawData(report.rawData).reportTableTemplate;
                if (closedTable) {
                    _reportTableState = {
                        ...closedTable,
                        lifecycle: closedLifecycleFromReport(report)
                    };
                    _activeTemplateId = String(closedTable.id || _activeTemplateId);
                } else {
                    _reportTableState.lifecycle = closedLifecycleFromReport(report);
                }
            } else {
                _reportTableState.lifecycle = { status: 'closed', closedAt: new Date().toISOString() };
            }
            _reportTableDirty = false;
            const taskSuffix = data.report?.approvalTaskId || data.report?.handoffTaskId ? ` · задача #${data.report?.approvalTaskId || data.report?.handoffTaskId}` : '';
            showNotification(`Звіт закрито і передано бухгалтеру${taskSuffix}`);
            setTemplateStatus(`Звіт #${_editingTableReportId || ''} закрито. Редагування заблоковано${taskSuffix}.`);
            await Promise.all([loadReports(), loadSummary(), loadHashtags(), loadReportDrafts()]);
            renderReportTemplateCards();
            renderReportTableWorkspace();
            if (_editingTableReportId) {
                setTimeout(() => {
                    const row = document.querySelector(`tr[data-id="${_editingTableReportId}"]`);
                    if (row && _expandedRow !== _editingTableReportId) toggleDetail(_editingTableReportId);
                }, 0);
            }
        } catch (err) {
            showNotification('Не вдалося закрити звіт: ' + err.message, 'error');
        } finally {
            setReportTableBusy(false);
        }
    }

    function editTableReport(id) {
        const report = _reports.find(item => item.id === id);
        if (!report) return;
        openReportTableForEditing(report);
    }

    function renderReportRawTemplatePreview(report) {
        const data = normalizeReportRawData(report?.rawData);
        const table = data.reportTableTemplate;
        if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return '';

        const columns = table.columns.slice(0, 6);
        const rows = table.rows.slice(0, 4);
        const closed = isClosedReport(report);
        return `
            <div class="rpt-raw-table-preview">
                <div class="rpt-raw-table-preview-head">
                    <strong>${esc(table.title || 'Табличний звіт')}</strong>
                    <button type="button" class="rpt-template-action" onclick="event.stopPropagation();ReportsPage.editTableReport(${report.id})">${closed ? 'Переглянути' : 'Відкрити в редакторі'}</button>
                </div>
                <table>
                    <thead>
                        <tr>${columns.map(col => `<th>${esc(col.label || col.key)}</th>`).join('')}</tr>
                    </thead>
                    <tbody>
                        ${rows.map(row => `<tr>${columns.map(col => `<td>${esc(row[col.key]) || '—'}</td>`).join('')}</tr>`).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    // ==========================================
    // RENDER: Hashtag Dashboard
    // ==========================================

    function renderHashtagDashboard() {
        const container = document.getElementById('hashtagDashboard');
        if (!container) return;

        const visibleStats = _hashtagStats.filter(h => !isTechnicalReportHashtag(h.hashtag));
        if (visibleStats.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = visibleStats.map(h => {
            const isActive = h.inactiveCount === 0;
            return `
                <div class="rpt-hashtag-card" onclick="ReportsPage.filterByHashtag('${esc(h.hashtag)}')">
                    <div class="rpt-hashtag-card-header">
                        <span class="rpt-hashtag-card-name">#${esc(h.hashtag)}</span>
                        <label class="rpt-hashtag-toggle" onclick="event.stopPropagation()">
                            <input type="checkbox" ${isActive ? 'checked' : ''}
                                onchange="ReportsPage.toggleHashtagActive('${esc(h.hashtag)}', this.checked)">
                            <span class="rpt-hashtag-toggle-slider"></span>
                        </label>
                    </div>
                    <div class="rpt-hashtag-card-amount">${formatAmount(h.total)}</div>
                    <div class="rpt-hashtag-card-stats">Звітів: ${h.count} (активних: ${h.activeCount})</div>
                </div>
            `;
        }).join('');
    }

    function populateHashtagFilter() {
        const select = document.getElementById('hashtagFilter');
        if (!select) return;

        // Keep first option, remove rest
        while (select.options.length > 1) select.remove(1);

        // Add from stats
        const tags = _hashtagStats.map(h => h.hashtag).filter(tag => !isTechnicalReportHashtag(tag));
        // Also add default tags if not present
        DEFAULT_HASHTAGS.forEach(t => { if (!tags.includes(t)) tags.push(t); });

        tags.forEach(tag => {
            const opt = document.createElement('option');
            opt.value = tag;
            opt.textContent = '#' + tag;
            select.appendChild(opt);
        });
    }

    function filterByHashtag(tag) {
        const select = document.getElementById('hashtagFilter');
        if (select) select.value = tag;
        _page = 1;
        loadReports();
    }

    async function toggleHashtagActive(hashtag, active) {
        try {
            const result = await apiRequest('PATCH', '/api/reports/hashtags/toggle', { hashtag, active });
            showNotification(active
                ? `#${hashtag} увімкнено (${result.updated} звітів)`
                : `#${hashtag} вимкнено з підрахунків (${result.updated} звітів)`
            );
            await Promise.all([loadHashtags(), loadSummary(), loadReports()]);
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    // ==========================================
    // RENDER: Table
    // ==========================================

    function reportApprovalStatus(report) {
        return report?.approvalStatus || 'none';
    }

    function renderApprovalBadge(report) {
        const status = reportApprovalStatus(report);
        const label = APPROVAL_LABELS[status] || status;
        const task = report.approvalTaskId
            ? ` <a href="/tasks?related_entity_type=report&related_entity_id=${encodeURIComponent(report.id)}" onclick="event.stopPropagation()" title="Відкрити задачі по звіту">#${report.approvalTaskId}</a>`
            : '';
        const assignee = report.approvalAssigneeName ? `<small>${esc(report.approvalAssigneeName)}</small>` : '';
        return `<span class="rpt-approval-badge ${status}">${label}${task}</span>${assignee}`;
    }

    function renderApprovalActions(report, mode = 'compact') {
        const status = reportApprovalStatus(report);
        const closed = isClosedReport(report);
        const compact = mode === 'compact';
        const buttonClass = compact ? 'rpt-action-btn' : 'rpt-action-btn text';
        const buttons = [];
        if (!report.approvalTaskId && !['approved', 'rejected'].includes(status)) {
            buttons.push(`<button class="${buttonClass} primary" onclick="event.stopPropagation();ReportsPage.requestApproval(${report.id})" title="Поставити задачу на перевірку">${compact ? '📌' : 'Поставити задачу'}</button>`);
        }
        if (['pending', 'task_created', 'none'].includes(status) && !['approved', 'rejected'].includes(status)) {
            buttons.push(`<button class="${buttonClass}" onclick="event.stopPropagation();ReportsPage.startApprovalReview(${report.id})" title="Взяти звіт в перевірку">${compact ? '🔎' : 'Взяти в перевірку'}</button>`);
        }
        if (!['approved', 'rejected'].includes(status)) {
            buttons.push(`<button class="${buttonClass} success" onclick="event.stopPropagation();ReportsPage.approveReport(${report.id})" title="Затвердити звіт">${compact ? '✅' : 'Затвердити'}</button>`);
            buttons.push(`<button class="${buttonClass} danger" onclick="event.stopPropagation();ReportsPage.rejectReport(${report.id})" title="Повернути звіт">${compact ? '↩' : 'Повернути'}</button>`);
        }
        if (!closed) {
            buttons.push(`<button class="${buttonClass}" onclick="event.stopPropagation();ReportsPage.editReport(${report.id})" title="Редагувати">${compact ? '✏️' : 'Редагувати'}</button>`);
            buttons.push(`<button class="${buttonClass} danger" onclick="event.stopPropagation();ReportsPage.deleteReport(${report.id})" title="Видалити">${compact ? '🗑️' : 'Видалити'}</button>`);
        }
        return buttons.join('');
    }

    function renderTable() {
        const tbody = document.getElementById('reportsTableBody');
        if (!tbody) return;

        if (_reports.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--gray-400)">Немає звітів за обраний період</td></tr>';
            return;
        }

        tbody.innerHTML = _reports.map(r => {
            const typeClass = r.type === 'income' ? 'income' : 'expense';
            const typeLabel = r.type === 'income' ? '📈 Дохід' : '📉 Витрата';
            const statusLabel = STATUS_LABELS[r.status] || r.status;
            const closed = isClosedReport(r);
            const photoBtn = r.photoUrl
                ? `<button class="rpt-photo-btn" onclick="event.stopPropagation();ReportsPage.showPhoto('${esc(r.photoUrl)}')" title="Переглянути фото">📸</button>`
                : '—';
            const tags = visibleReportHashtags(r.hashtags).map(t => `<span class="rpt-hashtag">#${esc(t)}</span>`).join('');
            const inactiveClass = r.hashtagActive === false ? ' style="opacity:0.5"' : '';

            return `
                <tr onclick="ReportsPage.toggleDetail(${r.id})" data-id="${r.id}"${inactiveClass}>
                    <td>${r.id}</td>
                    <td>${formatDateTime(r.createdAt)}</td>
                    <td><span class="rpt-type-badge ${typeClass}">${typeLabel}</span></td>
                    <td><span class="rpt-amount-${typeClass}">${formatAmount(r.amount)}</span></td>
                    <td>${esc(r.description) || '—'}${tags ? '<br>' + tags : ''}</td>
                    <td>${esc(r.category) || '—'}</td>
                    <td>${esc(r.submittedBy) || '—'}</td>
                    <td>${photoBtn}</td>
                    <td>
                        <span class="rpt-status-badge ${r.status}">${statusLabel}</span>
                        ${closed ? '<br><span class="rpt-sheet-mode-chip closed">Закритий</span>' : ''}
                        <br>${renderApprovalBadge(r)}
                    </td>
                    <td>
                        <div class="rpt-row-actions">
                            ${renderApprovalActions(r)}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function toggleDetail(id) {
        const existing = document.querySelector(`.rpt-detail-row[data-detail="${id}"]`);
        if (existing) {
            existing.remove();
            _expandedRow = null;
            return;
        }

        document.querySelectorAll('.rpt-detail-row').forEach(el => el.remove());

        const report = _reports.find(r => r.id === id);
        if (!report) return;
        _expandedRow = id;

        const row = document.querySelector(`tr[data-id="${id}"]`);
        if (!row) return;

        const tags = visibleReportHashtags(report.hashtags).map(t => `<span class="rpt-hashtag">#${esc(t)}</span>`).join(' ');

        const detailRow = document.createElement('tr');
        detailRow.className = 'rpt-detail-row';
        detailRow.dataset.detail = id;
        detailRow.innerHTML = `
            <td colspan="10">
                <div class="rpt-detail-content">
                    ${tags ? `<p><strong>Хештеги:</strong> ${tags}</p>` : ''}
                    ${report.ocrText ? `<p><strong>OCR текст:</strong> ${esc(report.ocrText)}</p>` : ''}
                    ${report.voiceTranscript ? `<p><strong>Голосовий:</strong> ${esc(report.voiceTranscript)}</p>` : ''}
                    <p><strong>Канал:</strong> ${esc(report.submittedVia) || 'web'}</p>
                    ${renderReportRawTemplatePreview(report)}
                    ${report.accountantName ? `<p><strong>Бухгалтер:</strong> ${esc(report.accountantName)}</p>` : ''}
                    <div class="rpt-approval-panel">
                        <div>
                            <strong>Погодження:</strong> ${renderApprovalBadge(report)}
                            ${report.approvalRequestedAt ? `<p>Задача поставлена: ${formatDateTime(report.approvalRequestedAt)}</p>` : ''}
                            ${report.approvalReviewedAt ? `<p>Рішення: ${formatDateTime(report.approvalReviewedAt)} · ${esc(report.approvalReviewedByUsername) || 'system'}</p>` : ''}
                            ${report.approvalComment ? `<p>Коментар бухгалтера: ${esc(report.approvalComment)}</p>` : ''}
                        </div>
                        <div class="rpt-detail-actions">${renderApprovalActions(report, 'detail')}</div>
                    </div>
                    ${report.processedAt ? `<p><strong>Опрацьовано:</strong> ${formatDateTime(report.processedAt)}</p>` : ''}
                    <p><strong>Створено:</strong> ${formatDateTime(report.createdAt)}</p>
                    <p><strong>Враховується в підсумках:</strong> ${report.hashtagActive !== false ? '✅ Так' : '❌ Ні'}</p>
                </div>
            </td>
        `;
        row.after(detailRow);
    }

    // ==========================================
    // RENDER: Pagination
    // ==========================================

    function renderPagination() {
        const container = document.getElementById('reportsPagination');
        if (!container) return;

        const totalPages = Math.ceil(_total / _limit) || 1;
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        let html = `<button ${_page <= 1 ? 'disabled' : ''} onclick="ReportsPage.goPage(${_page - 1})">←</button>`;
        for (let i = 1; i <= totalPages; i++) {
            if (totalPages > 7 && i > 2 && i < totalPages - 1 && Math.abs(i - _page) > 1) {
                if (i === 3 || i === totalPages - 2) html += '<button disabled>...</button>';
                continue;
            }
            html += `<button class="${i === _page ? 'active' : ''}" onclick="ReportsPage.goPage(${i})">${i}</button>`;
        }
        html += `<button ${_page >= totalPages ? 'disabled' : ''} onclick="ReportsPage.goPage(${_page + 1})">→</button>`;
        container.innerHTML = html;
    }

    function goPage(page) {
        _page = page;
        loadReports();
    }

    // ==========================================
    // ACTIONS
    // ==========================================

    function showPhoto(url) {
        const lb = document.createElement('div');
        lb.className = 'rpt-lightbox';
        lb.onclick = () => lb.remove();
        lb.innerHTML = `<img src="${esc(url)}" alt="Фото звіту">`;
        document.body.appendChild(lb);
    }

    async function markProcessing(id) {
        return startApprovalReview(id);
    }

    async function markDone(id) {
        return approveReport(id);
    }

    async function requestApproval(id) {
        try {
            const result = await apiRequest('POST', `/api/reports/${id}/request-approval`, {});
            showNotification(result.duplicateSkipped ? 'Задача на перевірку вже існує' : 'Задачу бухгалтеру поставлено');
            await loadReports();
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    async function startApprovalReview(id) {
        try {
            await apiRequest('POST', `/api/reports/${id}/in-review`, {});
            showNotification('Звіт взято в перевірку');
            await Promise.all([loadReports(), loadSummary()]);
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    async function approveReport(id) {
        try {
            const comment = typeof promptModal === 'function' ? ((await promptModal('Коментар бухгалтера до затвердження (необовʼязково)', { defaultValue: '', type: 'info' })) || '') : '';
            await apiRequest('POST', `/api/reports/${id}/approve`, { comment });
            showNotification('Звіт затверджено бухгалтером');
            await Promise.all([loadReports(), loadSummary()]);
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    async function rejectReport(id) {
        const comment = typeof promptModal === 'function' ? await promptModal('Причина повернення звіту бухгалтером', { defaultValue: '', type: 'warning' }) : null;
        if (comment === null) return;
        try {
            await apiRequest('POST', `/api/reports/${id}/reject`, { comment });
            showNotification('Звіт повернуто на доопрацювання');
            await Promise.all([loadReports(), loadSummary()]);
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    async function deleteReport(id) {
        const report = _reports.find(r => r.id === id);
        if (isClosedReport(report)) {
            showNotification('Закритий звіт не можна видалити', 'error');
            return;
        }
        if (!await confirmModal('Видалити звіт?', { type: 'danger' })) return;
        try {
            await apiRequest('DELETE', `/api/reports/${id}`);
            showNotification('Звіт видалено');
            await Promise.all([loadReports(), loadSummary(), loadHashtags()]);
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    // ==========================================
    // MODAL (with hashtag support)
    // ==========================================

    function openModal(report) {
        const modal = document.getElementById('reportModal');
        if (!modal) return;

        _editingId = report?.id || null;
        _modalHashtags = report?.hashtags ? [...report.hashtags] : [];

        document.getElementById('reportModalTitle').textContent = _editingId ? 'Редагувати звіт' : 'Додати звіт вручну';
        document.getElementById('reportType').value = report?.type || 'expense';
        document.getElementById('reportAmount').value = report?.amount || '';
        document.getElementById('reportDescription').value = report?.description || '';
        document.getElementById('reportCategory').value = report?.category || '';
        document.getElementById('reportEditId').value = _editingId || '';

        renderModalHashtags();

        modal.classList.remove('hidden');
        modal.classList.add('active');
    }

    function closeModal() {
        const modal = document.getElementById('reportModal');
        if (modal) {
            modal.classList.remove('active');
            modal.classList.add('hidden');
        }
        _editingId = null;
        _modalHashtags = [];
    }

    function renderModalHashtags() {
        const container = document.getElementById('reportHashtagsInput');
        if (!container) return;
        container.innerHTML = _modalHashtags.map(tag =>
            `<span class="rpt-hashtag" onclick="ReportsPage.removeModalHashtag('${esc(tag)}')" title="Клік щоб видалити">#${esc(tag)} ×</span>`
        ).join('');
    }

    function addHashtagFromSelect() {
        const select = document.getElementById('reportHashtagSelect');
        const val = select?.value;
        if (val && !_modalHashtags.includes(val)) {
            _modalHashtags.push(val);
            renderModalHashtags();
        }
        if (select) select.value = '';
    }

    function addHashtagCustom() {
        const input = document.getElementById('reportHashtagNew');
        const val = input?.value?.trim();
        if (val && !_modalHashtags.includes(val)) {
            _modalHashtags.push(val);
            renderModalHashtags();
        }
        if (input) input.value = '';
    }

    function removeModalHashtag(tag) {
        _modalHashtags = _modalHashtags.filter(t => t !== tag);
        renderModalHashtags();
    }

    async function submitReport(event) {
        event.preventDefault();

        const type = document.getElementById('reportType')?.value;
        const amount = document.getElementById('reportAmount')?.value;
        const description = document.getElementById('reportDescription')?.value;
        const category = document.getElementById('reportCategory')?.value;

        if (!amount || parseFloat(amount) <= 0) {
            showNotification('Вкажіть суму', 'error');
            return;
        }

        try {
            if (_editingId) {
                await apiRequest('PUT', `/api/reports/${_editingId}`, {
                    type,
                    amount: parseFloat(amount),
                    description,
                    category,
                    hashtags: _modalHashtags
                });
                showNotification('Звіт оновлено');
            } else {
                await apiRequest('POST', '/api/reports', {
                    type,
                    amount: parseFloat(amount),
                    description,
                    category,
                    hashtags: _modalHashtags,
                    submittedVia: 'web'
                });
                showNotification('Звіт створено');
            }
            closeModal();
            await Promise.all([loadReports(), loadSummary(), loadHashtags()]);
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    function editReport(id) {
        const report = _reports.find(r => r.id === id);
        if (isClosedReport(report)) {
            openReportTableForEditing(report);
            return;
        }
        if (report) openModal(report);
    }

    // ==========================================
    // FILTER ACTIONS (called from HTML)
    // ==========================================

    function applyFilters() {
        _page = 1;
        loadReports();
        loadSummary();
    }

    function resetFilters() {
        document.getElementById('periodFilter').value = 'month';
        document.getElementById('dateFromFilter').style.display = 'none';
        document.getElementById('dateToFilter').style.display = 'none';
        document.getElementById('dateFromFilter').value = '';
        document.getElementById('dateToFilter').value = '';
        document.getElementById('typeFilter').value = '';
        document.getElementById('statusFilter').value = '';
        document.getElementById('submittedByFilter').value = '';
        document.getElementById('categoryFilter').value = '';
        document.getElementById('hashtagFilter').value = '';
        _page = 1;
        loadReports();
        loadSummary();
    }

    // ==========================================
    // INIT ON LOAD
    // ==========================================

    document.addEventListener('DOMContentLoaded', init);

    return {
        applyFilters,
        resetFilters,
        sort,
        goPage,
        toggleDetail,
        showPhoto,
        markProcessing,
        markDone,
        requestApproval,
        startApprovalReview,
        approveReport,
        rejectReport,
        saveWorkflowSettings,
        deleteReport,
        editReport,
        closeModal,
        submitReport,
        filterByHashtag,
        toggleHashtagActive,
        addHashtagFromSelect,
        addHashtagCustom,
        removeModalHashtag,
        loadReportTemplate,
        saveReportTemplateDraft,
        importReportTemplateFile,
        exportReportTemplateCsv,
        exportReportTemplateXlsx,
        editTableReport
    };
})();
