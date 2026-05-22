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

    const EXPENSE_CATEGORIES = ['Афіша', 'ЗП', 'Майстер-класи', 'ДАР', 'Костюми', 'Квести', 'Реквізит', 'Аквагрим', 'Декорації', 'Офіс', 'Інше'];
    const DEFAULT_HASHTAGS = ['СШ-Парк', 'СШ-Особистий', 'ДАР'];
    const CUSTOM_TEMPLATE_STORAGE_KEY = 'eventgenix_report_table_templates_v1';
    const REPORT_TABLE_TEMPLATES = [
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
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Request failed');
        }
        return res.json();
    }

    function showNotification(msg, type = 'success') {
        const el = document.getElementById('notification');
        const text = document.getElementById('notificationText');
        if (!el || !text) return;
        text.textContent = msg;
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

    function csvCell(value) {
        const text = String(value ?? '');
        return `"${text.replace(/"/g, '""')}"`;
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
                type: ['number', 'date', 'text'].includes(col.type) ? col.type : 'text',
                placeholder: String(col.placeholder || ''),
                total: col.total === 'sum' ? 'sum' : null
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
            title: String(template.title || 'Новий шаблон'),
            category: String(template.category || 'Custom'),
            layout: String(template.layout || 'custom'),
            description: String(template.description || 'Завантажений шаблон таблиці.'),
            purpose: String(template.purpose || ''),
            source,
            defaultReport: {
                type: template.defaultReport?.type === 'income' ? 'income' : 'expense',
                category: String(template.defaultReport?.category || 'Інше'),
                hashtag: String(template.defaultReport?.hashtag || `table-${source}`),
                amountColumn: template.defaultReport?.amountColumn || columns.find(col => col.type === 'number')?.key || null
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

        setupReportTemplateWorkspace();

        const periodFilter = document.getElementById('periodFilter');
        if (periodFilter) {
            periodFilter.addEventListener('change', () => {
                const custom = periodFilter.value === 'custom';
                document.getElementById('dateFromFilter').style.display = custom ? '' : 'none';
                document.getElementById('dateToFilter').style.display = custom ? '' : 'none';
            });
        }

        document.getElementById('addReportBtn')?.addEventListener('click', () => openModal());

        document.getElementById('reportModal')?.addEventListener('click', e => {
            if (e.target === e.currentTarget) closeModal();
        });

        await Promise.all([
            loadSummary(),
            loadReports(),
            loadOnDuty(),
            loadSubmitters(),
            loadHashtags()
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
        } catch (err) {
            console.error('Load reports error:', err);
            const tbody = document.getElementById('reportsTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:20px;color:#EF4444">Помилка завантаження</td></tr>';
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

    function setupReportTemplateWorkspace() {
        _reportTemplates = [
            ...REPORT_TABLE_TEMPLATES.map(template => normalizeTemplate(clone(template), 'standard')),
            ...loadCustomReportTemplates()
        ];

        document.getElementById('reportTemplateUploadBtn')?.addEventListener('click', () => {
            document.getElementById('reportTemplateUpload')?.click();
        });
        document.getElementById('reportTemplateUpload')?.addEventListener('change', importReportTemplateFile);
        document.getElementById('reportTemplateResetBtn')?.addEventListener('click', resetReportTemplateTable);
        document.getElementById('reportTemplateAddRowBtn')?.addEventListener('click', addReportTemplateRow);
        document.getElementById('reportTemplateExportCsvBtn')?.addEventListener('click', exportReportTemplateCsv);
        document.getElementById('reportTemplateSaveBtn')?.addEventListener('click', createReportFromTemplate);

        document.getElementById('reportTemplateCards')?.addEventListener('click', event => {
            const card = event.target.closest('[data-report-template-id]');
            if (!card) return;
            loadReportTemplate(card.dataset.reportTemplateId);
        });

        const table = document.getElementById('reportSheetTable');
        table?.addEventListener('input', handleReportSheetInput);
        table?.addEventListener('click', event => {
            const deleteBtn = event.target.closest('[data-report-row-delete]');
            if (!deleteBtn) return;
            deleteReportTemplateRow(Number(deleteBtn.dataset.reportRowDelete));
        });

        renderReportTemplateCards();
        loadReportTemplate(_activeTemplateId, { silent: true });
    }

    function renderReportTemplateCards() {
        const container = document.getElementById('reportTemplateCards');
        if (!container) return;

        container.innerHTML = _reportTemplates.map(template => `
            <button type="button"
                class="rpt-template-card ${template.id === _activeTemplateId ? 'active' : ''}"
                data-report-template-id="${esc(template.id)}"
                role="option"
                aria-selected="${template.id === _activeTemplateId}">
                <span class="rpt-template-card-title">${esc(template.title)}</span>
                <span class="rpt-template-card-desc">${esc(template.description)}</span>
                <span class="rpt-template-card-meta">
                    <span class="rpt-template-chip">${esc(template.category)}</span>
                    <span class="rpt-template-chip">${template.columns.length} колонок</span>
                    ${template.source === 'uploaded' ? '<span class="rpt-template-chip">uploaded</span>' : ''}
                </span>
            </button>
        `).join('');
    }

    function setTemplateStatus(message = '') {
        const status = document.getElementById('reportTemplateStatus');
        if (status) status.textContent = message;
    }

    function loadReportTemplate(templateId, options = {}) {
        const template = _reportTemplates.find(t => t.id === templateId) || _reportTemplates[0];
        if (!template) return;

        _activeTemplateId = template.id;
        _reportTableState = {
            ...clone(template),
            rows: template.rows.map(row => ({ ...row }))
        };

        renderReportTemplateCards();
        renderReportTableWorkspace();
        if (!options.silent) setTemplateStatus(`Шаблон "${template.title}" завантажено`);
    }

    function renderReportTableWorkspace() {
        const state = _reportTableState;
        const table = document.getElementById('reportSheetTable');
        if (!state || !table) return;

        const title = document.getElementById('reportSheetTitle');
        const meta = document.getElementById('reportSheetMeta');
        if (title) title.textContent = state.title;
        if (meta) {
            meta.textContent = `${state.purpose || state.description} · ${state.rows.length} рядків · ${state.columns.length} колонок`;
        }

        const head = `
            <thead>
                <tr>
                    <th class="rpt-sheet-row-index">#</th>
                    ${state.columns.map(col => `<th>${esc(col.label)}</th>`).join('')}
                    <th aria-label="Дії">Дії</th>
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
                                <input class="rpt-sheet-input"
                                    data-row-index="${rowIndex}"
                                    data-column-key="${esc(col.key)}"
                                    type="${col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}"
                                    step="${col.type === 'number' ? '0.01' : ''}"
                                    value="${esc(row[col.key])}"
                                    placeholder="${esc(col.placeholder)}"
                                    aria-label="${esc(col.label)} рядок ${rowIndex + 1}">
                            </td>
                        `).join('')}
                        <td><button type="button" class="rpt-sheet-delete" data-report-row-delete="${rowIndex}" title="Видалити рядок">×</button></td>
                    </tr>
                `).join('')}
            </tbody>
        `;
        const totals = renderReportSheetTotals();
        table.innerHTML = head + body + totals;
    }

    function renderReportSheetTotals() {
        if (!_reportTableState) return '';
        const totalColumns = _reportTableState.columns.filter(col => col.total === 'sum');
        if (!totalColumns.length) return '';
        const totalsByKey = new Map(totalColumns.map(col => [
            col.key,
            _reportTableState.rows.reduce((sum, row) => sum + parseNumber(row[col.key]), 0)
        ]));
        return `
            <tfoot>
                <tr class="rpt-sheet-total-row">
                    <td>Разом</td>
                    ${_reportTableState.columns.map(col => `<td>${totalsByKey.has(col.key) ? formatAmount(totalsByKey.get(col.key)) : ''}</td>`).join('')}
                    <td></td>
                </tr>
            </tfoot>
        `;
    }

    function handleReportSheetInput(event) {
        const input = event.target.closest('.rpt-sheet-input');
        if (!input || !_reportTableState) return;
        const rowIndex = Number(input.dataset.rowIndex);
        const key = input.dataset.columnKey;
        if (!_reportTableState.rows[rowIndex] || !key) return;
        _reportTableState.rows[rowIndex][key] = input.value;
        setTemplateStatus('Є незбережені зміни в таблиці');
    }

    function addReportTemplateRow() {
        if (!_reportTableState) return;
        const row = Object.fromEntries(_reportTableState.columns.map(col => [col.key, '']));
        _reportTableState.rows.push(row);
        renderReportTableWorkspace();
        setTemplateStatus('Додано рядок');
    }

    function deleteReportTemplateRow(rowIndex) {
        if (!_reportTableState || _reportTableState.rows.length <= 1) {
            setTemplateStatus('У таблиці має лишитися хоча б один рядок');
            return;
        }
        _reportTableState.rows.splice(rowIndex, 1);
        renderReportTableWorkspace();
        setTemplateStatus('Рядок видалено');
    }

    function resetReportTemplateTable() {
        loadReportTemplate(_activeTemplateId);
    }

    async function importReportTemplateFile(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const template = normalizeTemplate({
                ...parsed,
                id: parsed.id || `uploaded-${Date.now()}`
            }, 'uploaded');

            _reportTemplates = _reportTemplates.filter(t => t.id !== template.id);
            _reportTemplates.push(template);
            saveCustomReportTemplates();
            renderReportTemplateCards();
            loadReportTemplate(template.id);
            showNotification('Шаблон таблиці завантажено');
        } catch (err) {
            showNotification('Не вдалося завантажити шаблон: ' + err.message, 'error');
        } finally {
            event.target.value = '';
        }
    }

    function buildReportTablePayload() {
        if (!_reportTableState) return null;
        return {
            reportTableTemplate: {
                id: _reportTableState.id,
                title: _reportTableState.title,
                category: _reportTableState.category,
                layout: _reportTableState.layout,
                source: _reportTableState.source,
                columns: _reportTableState.columns,
                rows: _reportTableState.rows,
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

    function exportReportTemplateCsv() {
        if (!_reportTableState) return;
        const columns = _reportTableState.columns;
        const header = columns.map(col => csvCell(col.label)).join(';');
        const rows = _reportTableState.rows.map(row => columns.map(col => csvCell(row[col.key])).join(';'));
        const csv = '\ufeff' + [header, ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${slugifyKey(_reportTableState.title, 'report')}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setTemplateStatus('CSV експортовано');
    }

    async function createReportFromTemplate() {
        if (!_reportTableState) return;
        const reportDefaults = _reportTableState.defaultReport || {};
        const amount = getTemplateReportAmount();
        const payload = buildReportTablePayload();

        try {
            await apiRequest('POST', '/api/reports', {
                type: reportDefaults.type || 'expense',
                amount,
                description: `Табличний звіт: ${_reportTableState.title}`,
                category: reportDefaults.category || _reportTableState.category || 'Інше',
                hashtags: [reportDefaults.hashtag || 'table-report'].filter(Boolean),
                submittedVia: 'web-template',
                rawData: payload
            });
            showNotification('Табличний звіт створено');
            setTemplateStatus('Звіт створено і збережено в реєстрі');
            await Promise.all([loadReports(), loadSummary(), loadHashtags()]);
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    function renderReportRawTemplatePreview(rawData) {
        const data = normalizeReportRawData(rawData);
        const table = data.reportTableTemplate;
        if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return '';

        const columns = table.columns.slice(0, 6);
        const rows = table.rows.slice(0, 4);
        return `
            <div class="rpt-raw-table-preview">
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

        if (_hashtagStats.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = _hashtagStats.map(h => {
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
        const tags = _hashtagStats.map(h => h.hashtag);
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

    function renderTable() {
        const tbody = document.getElementById('reportsTableBody');
        if (!tbody) return;

        if (_reports.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--gray-400)">Немає звітів за обраний період</td></tr>';
            return;
        }

        tbody.innerHTML = _reports.map(r => {
            const typeClass = r.type === 'income' ? 'income' : 'expense';
            const typeLabel = r.type === 'income' ? '📈 Дохід' : '📉 Витрата';
            const statusLabel = STATUS_LABELS[r.status] || r.status;
            const photoBtn = r.photoUrl
                ? `<button class="rpt-photo-btn" onclick="event.stopPropagation();ReportsPage.showPhoto('${esc(r.photoUrl)}')" title="Переглянути фото">📸</button>`
                : '—';
            const tags = (r.hashtags || []).map(t => `<span class="rpt-hashtag">#${esc(t)}</span>`).join('');
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
                    <td><span class="rpt-status-badge ${r.status}">${statusLabel}</span></td>
                    <td>
                        <div style="display:flex;gap:2px">
                            ${r.status === 'new' ? `<button class="rpt-action-btn" onclick="event.stopPropagation();ReportsPage.markProcessing(${r.id})" title="В обробку">⏳</button>` : ''}
                            ${r.status !== 'done' ? `<button class="rpt-action-btn" onclick="event.stopPropagation();ReportsPage.markDone(${r.id})" title="Опрацьовано">✅</button>` : ''}
                            <button class="rpt-action-btn" onclick="event.stopPropagation();ReportsPage.editReport(${r.id})" title="Редагувати">✏️</button>
                            <button class="rpt-action-btn" onclick="event.stopPropagation();ReportsPage.deleteReport(${r.id})" title="Видалити">🗑️</button>
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

        const tags = (report.hashtags || []).map(t => `<span class="rpt-hashtag">#${esc(t)}</span>`).join(' ');

        const detailRow = document.createElement('tr');
        detailRow.className = 'rpt-detail-row';
        detailRow.dataset.detail = id;
        detailRow.innerHTML = `
            <td colspan="11">
                <div class="rpt-detail-content">
                    ${tags ? `<p><strong>Хештеги:</strong> ${tags}</p>` : ''}
                    ${report.ocrText ? `<p><strong>OCR текст:</strong> ${esc(report.ocrText)}</p>` : ''}
                    ${report.voiceTranscript ? `<p><strong>Голосовий:</strong> ${esc(report.voiceTranscript)}</p>` : ''}
                    <p><strong>Канал:</strong> ${esc(report.submittedVia) || 'web'}</p>
                    ${renderReportRawTemplatePreview(report.rawData)}
                    ${report.accountantName ? `<p><strong>Бухгалтер:</strong> ${esc(report.accountantName)}</p>` : ''}
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
        try {
            await apiRequest('PUT', `/api/reports/${id}`, { status: 'processing' });
            showNotification('Звіт переведено в обробку');
            await loadReports();
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    async function markDone(id) {
        try {
            await apiRequest('PUT', `/api/reports/${id}`, { status: 'done' });
            showNotification('Звіт опрацьовано');
            await Promise.all([loadReports(), loadSummary()]);
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    async function deleteReport(id) {
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
        importReportTemplateFile,
        exportReportTemplateCsv
    };
})();
