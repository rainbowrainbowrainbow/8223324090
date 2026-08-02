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
    let _businessContext = 'event_genix';
    let _staffOptions = [];
    let _staffOptionsAvailable = false;
    let _staffOptionsWarning = '';
    let _payrollReviewFilter = 'all';
    let _reportQualityFilter = 'all';
    let _reportQualityIssueFilter = '';
    let _payrollScheduleIndex = {};
    let _payrollAttendanceIndex = {};
    let _payrollReconciliationSignature = '';
    let _payrollReconciliationLoading = false;

    const ATTENDANCE_GRACE_MINUTES = Object.freeze({ late: 5, overtime: 15 });

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
                { key: 'owner', label: 'Відповідальний', type: 'staff', placeholder: 'Оберіть працівника', staffIdKey: 'owner_staff_id' },
                { key: 'status', label: 'Статус', type: 'text', placeholder: 'OK / ризик / зробити' },
                { key: 'note', label: 'Нотатка', type: 'text', placeholder: 'Що потрібно доробити?' }
            ],
            rows: [
                { zone: 'Reception', task: 'Каса і чеки', owner: '', owner_staff_id: '', status: '', note: '' },
                { zone: 'Зал', task: 'Чистота та безпека', owner: '', owner_staff_id: '', status: '', note: '' },
                { zone: 'Склад', task: 'Реквізит і витратники', owner: '', owner_staff_id: '', status: '', note: '' }
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
                { key: 'date', label: 'Дата', type: 'date', placeholder: '2026-06-28' },
                { key: 'employee', label: 'Працівник', type: 'staff', placeholder: 'Оберіть працівника', staffIdKey: 'employee_staff_id', roleKey: 'role' },
                { key: 'role', label: 'Роль', type: 'text', placeholder: 'Аніматор / адміністратор' },
                { key: 'planned_start', label: 'План прихід', type: 'text', placeholder: '09:00' },
                { key: 'planned_end', label: 'План вихід', type: 'text', placeholder: '18:00' },
                { key: 'clock_in', label: 'Факт прихід', type: 'text', placeholder: '09:00' },
                { key: 'clock_out', label: 'Факт вихід', type: 'text', placeholder: '18:00' },
                { key: 'late_minutes', label: 'Запізнення хв', type: 'number', placeholder: '0', total: 'sum' },
                { key: 'early_leave_minutes', label: 'Ранній вихід хв', type: 'number', placeholder: '0', total: 'sum' },
                { key: 'overtime_minutes', label: 'Overtime хв', type: 'number', placeholder: '0', total: 'sum' },
                { key: 'plan_warning', label: 'Попередження плану', type: 'text', placeholder: '' },
                { key: 'planned_hours', label: 'План', type: 'number', placeholder: '0', total: 'sum' },
                { key: 'actual_hours', label: 'Факт', type: 'number', placeholder: '0', total: 'sum' },
                { key: 'hours', label: 'Опл. години', type: 'number', placeholder: '0', total: 'sum' },
                { key: 'rate', label: 'Ставка', type: 'number', placeholder: '0' },
                { key: 'bonus', label: 'Бонус', type: 'number', placeholder: '0', total: 'sum' },
                { key: 'penalty', label: 'Штраф', type: 'number', placeholder: '0', total: 'sum' },
                { key: 'manual_amount', label: 'Ручна сума', type: 'number', placeholder: '0', total: 'sum' },
                { key: 'notes', label: 'Нотатки', type: 'text', placeholder: 'Причина корекції / коментар' },
                { key: 'total', label: 'До виплати', type: 'number', placeholder: '0', total: 'sum' }
            ],
            rows: [
                { date: '', employee: '', employee_staff_id: '', role: '', planned_hours: '', actual_hours: '', hours: '', rate: '', bonus: '', penalty: '', manual_amount: '', notes: '', total: '' },
                { date: '', employee: '', employee_staff_id: '', role: '', planned_hours: '', actual_hours: '', hours: '', rate: '', bonus: '', penalty: '', manual_amount: '', notes: '', total: '' }
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

    function reportsBusinessContext() {
        return window.CrmBusinessContext?.normalize?.(_businessContext) || _businessContext || 'event_genix';
    }

    function reportsBusinessScope() {
        return window.CrmBusinessContext?.scope?.() || { mode: 'single', activeContext: reportsBusinessContext() };
    }

    function isReportsBusinessReadOnly() {
        return Boolean(window.CrmBusinessContext?.isReadOnly?.(reportsBusinessScope()));
    }

    function reportsReadOnlyMessage(actionLabel = 'змінювати звіти') {
        return window.CrmBusinessContext?.readOnlyMessage?.(reportsBusinessScope(), actionLabel)
            || 'Огляд кількох бізнесів працює тільки для перегляду. Оберіть один бізнес, щоб змінювати звіти.';
    }

    function guardReportsWrite(actionLabel = 'змінювати звіти') {
        return window.CrmBusinessContext?.guardWrite
            ? window.CrmBusinessContext.guardWrite(actionLabel, reportsBusinessScope())
            : !isReportsBusinessReadOnly();
    }

    function canManageReportWorkflowSettings() {
        return typeof canAccess === 'function' && canAccess('manage_settings') === true;
    }

    function syncReportWorkflowSettingsAccess() {
        const allowed = canManageReportWorkflowSettings();
        const section = document.getElementById('reportApprovalWorkflow');
        if (section) {
            section.hidden = !allowed;
            section.setAttribute('aria-hidden', allowed ? 'false' : 'true');
        }
        const saveButton = document.getElementById('reportApprovalSaveBtn');
        if (saveButton && !allowed) saveButton.disabled = true;
        return allowed;
    }

    function reportsApiUrl(url) {
        return window.CrmBusinessContext?.apiUrl
            ? window.CrmBusinessContext.apiUrl(url, reportsBusinessContext())
            : url;
    }

    function reportsPayload(payload = {}) {
        return window.CrmBusinessContext?.payload
            ? window.CrmBusinessContext.payload(payload, reportsBusinessContext())
            : { ...(payload || {}), businessContext: reportsBusinessContext() };
    }

    function syncReportsReadOnlyUi() {
        const readOnly = isReportsBusinessReadOnly();
        if (document.body) document.body.dataset.crmBusinessReadOnly = readOnly ? 'true' : 'false';
        let notice = document.getElementById('reportsBusinessReadOnlyNotice');
        if (readOnly && !notice) {
            notice = document.createElement('div');
            notice.id = 'reportsBusinessReadOnlyNotice';
            notice.className = 'crm-business-readonly-banner';
            notice.setAttribute('role', 'status');
            document.querySelector('.rpt-header')?.insertAdjacentElement('afterend', notice);
        }
        if (notice) {
            notice.textContent = reportsReadOnlyMessage('редагувати звіти');
            notice.hidden = !readOnly;
        }
        [
            'addReportBtn',
            'reportApprovalSaveBtn',
            'reportTemplateUploadBtn',
            'reportTemplateImportCsvBtn',
            'reportTemplateResetBtn',
            'reportTemplateDraftBtn',
            'reportTemplateAddRowBtn',
            'reportTemplateAddColumnBtn',
            'reportTemplateSaveBtn',
            'reportTemplateCloseBtn',
            'reportSheetTitleInput'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (readOnly || id === 'addReportBtn' || id === 'reportApprovalSaveBtn') {
                el.disabled = readOnly;
            }
            el.setAttribute('aria-disabled', readOnly ? 'true' : 'false');
            if (readOnly) el.title = reportsReadOnlyMessage('редагувати звіти');
            else el.removeAttribute('title');
        });
        document.querySelectorAll('.rpt-action-btn, [onclick^="ReportsPage.toggleHashtagActive"]').forEach(el => {
            el.disabled = readOnly;
            el.setAttribute('aria-disabled', readOnly ? 'true' : 'false');
            el.classList.toggle('crm-business-readonly-control', readOnly);
            if (readOnly) el.title = reportsReadOnlyMessage('редагувати звіти');
            else el.removeAttribute('title');
        });
    }

    function initReportsBusinessContext(user) {
        const api = window.CrmBusinessContext;
        _businessContext = api?.initPage?.({
            pageId: 'reports',
            user,
            beforeChange: async () => {
                closeModal();
                return true;
            },
            onChange: async ({ current }) => {
                _businessContext = current;
                _page = 1;
                _expandedRow = null;
                syncReportsReadOnlyUi();
                await Promise.all([loadSummary(), loadReports(), loadOnDuty(), loadSubmitters(), loadHashtags(), loadWorkflowSettings()]);
                refreshReportWorkspaceControls();
            }
        }) || 'event_genix';
        syncReportsReadOnlyUi();
    }

    async function apiRequest(method, url, body) {
        const normalizedMethod = String(method || 'GET').toUpperCase();
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod) && !guardReportsWrite('змінювати звіти')) {
            throw new Error(reportsReadOnlyMessage('змінювати звіти'));
        }
        const token = localStorage.getItem('pzp_token');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (body) headers['Content-Type'] = 'application/json';
        const requestBody = body ? reportsPayload(body) : undefined;
        const res = await fetch(reportsApiUrl(url), {
            method,
            headers,
            body: requestBody ? JSON.stringify(requestBody) : undefined
        });
        if (res.status === 403) {
            const payload = await res.clone().json().catch(() => ({}));
            if (payload.code === 'business_scope_read_only') {
                const message = payload.error || reportsReadOnlyMessage('змінювати звіти');
                showNotification(message, 'warning');
                throw new Error(message);
            }
        }
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

    function isPayrollTemplateLike(template = {}) {
        const identity = [
            template.id,
            template.code,
            template.layout,
            template.category,
            template.defaultReport?.hashtag
        ].map(value => String(value || '').toLowerCase()).join(' ');
        return identity.includes('payroll') || identity.includes('table-payroll');
    }

    function isPayrollTableState(state = _reportTableState) {
        return !!state && isPayrollTemplateLike(state);
    }

    function normalizeLegacyPayrollColumn(column = {}) {
        const key = String(column.key || '').trim().toLowerCase();
        const label = String(column.label || '').trim().toLowerCase();
        if (['advance', 'advances', 'advance_amount', 'advances_amount'].includes(key)
            || ['аванс', 'аванси'].includes(label)) {
            return { ...column, label: 'ЗРС' };
        }
        return column;
    }

    function normalizePayrollColumns(columns = [], table = _reportTableState) {
        return isPayrollTemplateLike(table) && Array.isArray(columns)
            ? columns.map(normalizeLegacyPayrollColumn)
            : columns;
    }

    function payrollTableMonth(state = _reportTableState) {
        const candidates = [
            state?.month,
            state?.payrollMonth,
            state?.periodMonth,
            state?.defaultReport?.month,
            state?.defaultReport?.payrollMonth,
            state?.payrollReconciliation?.month
        ].map(value => String(value || '').trim()).filter(Boolean);
        const direct = candidates.find(value => /^\d{4}-\d{2}$/.test(value));
        if (direct) return direct;
        const months = (Array.isArray(state?.rows) ? state.rows : [])
            .map(row => payrollDateKey(row))
            .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
            .map(value => value.slice(0, 7));
        const unique = [...new Set(months)];
        return unique.length === 1 ? unique[0] : '';
    }

    function payrollCanonicalExportUrl(format, state = _reportTableState) {
        const month = payrollTableMonth(state);
        const endpoint = format === 'xlsx' ? '/api/payroll/export-xlsx' : '/api/payroll/export';
        return `${endpoint}${month ? `?month=${encodeURIComponent(month)}` : ''}`;
    }

    function reportsPayrollDeprecatedMessage() {
        return 'Payroll у Reports переведено у read-only режим. Суми, виплати й exports беруться тільки з canonical Payroll API.';
    }

    function deprecatedPayrollReconciliation(state = _reportTableState) {
        const rows = Array.isArray(state?.rows) ? state.rows : [];
        return {
            rows,
            rowMeta: rows.map((row, index) => ({ index, row, status: 'deprecated_read_only', issues: ['reports_payroll_deprecated'] })),
            totals: { planned: null, actual: null, paid: null, amount: 0 },
            status: 'deprecated_read_only',
            issueCounts: { reports_payroll_deprecated: Math.max(1, rows.length || 0) },
            source: 'canonical_payroll_service_required',
            canonicalExports: {
                csv: payrollCanonicalExportUrl('csv', state),
                xlsx: payrollCanonicalExportUrl('xlsx', state)
            }
        };
    }

    const PAYROLL_RECONCILIATION_FILTERS = [
        { key: 'all', label: 'Всі' },
        { key: 'needs_review', label: 'Review' },
        { key: 'reconciled', label: 'OK' },
        { key: 'draft', label: 'Draft' },
        { key: 'approved', label: 'Approved' },
        { key: 'deprecated_read_only', label: 'Read-only' }
    ];

    const PAYROLL_RECONCILIATION_LABELS = {
        draft: 'Draft',
        needs_review: 'Review',
        reconciled: 'OK',
        approved: 'Approved',
        deprecated_read_only: 'Read-only'
    };

    const PAYROLL_ISSUE_LABELS = {
        missing_staff_id: 'немає staff_id',
        missing_payroll_date: 'немає дати',
        staff_not_active_or_missing: 'не в активному HR pool',
        no_shift: 'немає зміни',
        no_attendance: 'немає факту',
        profession_card_fallback: 'план із картки професії',
        attendance_unscheduled: 'attendance без плану',
        actual_paid_hours_mismatch: 'факт != оплата',
        duplicate_payroll_row: 'дубль payroll',
        amount_missing_or_zero: 'сума 0',
        offboarded_staff: 'offboarded',
        reports_payroll_deprecated: 'canonical Payroll API only'
    };

    const REPORT_QUALITY_FILTERS = [
        { key: 'all', label: 'Всі' },
        { key: 'needs_review', label: 'Review' },
        { key: 'warning', label: 'Warnings' },
        { key: 'ok', label: 'OK' }
    ];

    const REPORT_QUALITY_STATUS_LABELS = {
        ok: 'OK',
        warning: 'Warnings',
        needs_review: 'Needs review'
    };

    const REPORT_QUALITY_ISSUE_LABELS = {
        payroll_employee_missing: 'payroll: немає працівника',
        payroll_employee_staff_id_missing: 'payroll: немає staff_id',
        payroll_duplicate_employee_date: 'payroll: дубль працівник/дата',
        payroll_amount_missing: 'payroll: сума порожня',
        payroll_amount_zero: 'payroll: сума 0',
        payroll_no_shift_link: 'payroll: немає зміни',
        payroll_no_attendance_link: 'payroll: немає факту',
        payroll_profession_card_fallback: 'payroll: план із картки професії',
        payroll_attendance_unscheduled: 'payroll: attendance без плану',
        payroll_actual_hours_mismatch: 'payroll: факт != оплата',
        payroll_offboarded_staff: 'payroll: offboarded staff',
        payroll_staff_not_active_or_missing: 'payroll: staff не в active pool',
        report_date_missing: 'немає дати звіту',
        report_context_missing: 'немає department/context',
        report_submitted_by_missing: 'немає submitted by',
        report_required_sections_incomplete: 'обовʼязкові секції неповні',
        report_totals_mismatch: 'підсумки не збігаються',
        operations_owner_missing: 'operations: немає owner',
        operations_owner_staff_id_missing: 'operations: owner без staff_id',
        operations_task_status_missing: 'operations: немає статусу задачі',
        operations_open_critical_task: 'operations: відкритий критичний пункт',
        staff_options_unavailable: 'staff API недоступний'
    };

    const REPORT_QUALITY_ISSUE_STATUS = {
        payroll_no_attendance_link: 'warning',
        payroll_profession_card_fallback: 'warning',
        payroll_attendance_unscheduled: 'warning',
        payroll_staff_not_active_or_missing: 'warning',
        report_context_missing: 'warning',
        report_submitted_by_missing: 'warning',
        staff_options_unavailable: 'warning'
    };

    const REPORT_QUALITY_AUTOFILL_ZERO_KEYS = new Set([
        'manual_amount',
        'late_minutes',
        'early_leave_minutes',
        'overtime_minutes'
    ]);

    function ensurePayrollColumn(columns, column, insertAfter = '') {
        if (columns.some(col => col.key === column.key)) return;
        if (insertAfter === '__first__') {
            columns.unshift(column);
            return;
        }
        const index = insertAfter ? columns.findIndex(col => col.key === insertAfter) : -1;
        if (index >= 0) columns.splice(index + 1, 0, column);
        else columns.push(column);
    }

    function upgradePayrollTemplate(template) {
        if (!isPayrollTemplateLike(template)) return template;
        const columns = Array.isArray(template.columns) ? [...template.columns] : [];
        ensurePayrollColumn(columns, { key: 'date', label: 'Дата', type: 'date', placeholder: '2026-06-28' }, '__first__');
        ensurePayrollColumn(columns, { key: 'planned_start', label: 'План прихід', type: 'text', placeholder: '09:00' }, 'role');
        ensurePayrollColumn(columns, { key: 'planned_end', label: 'План вихід', type: 'text', placeholder: '18:00' }, 'planned_start');
        ensurePayrollColumn(columns, { key: 'clock_in', label: 'Факт прихід', type: 'text', placeholder: '09:00' }, 'planned_end');
        ensurePayrollColumn(columns, { key: 'clock_out', label: 'Факт вихід', type: 'text', placeholder: '18:00' }, 'clock_in');
        ensurePayrollColumn(columns, { key: 'late_minutes', label: 'Запізнення хв', type: 'number', placeholder: '0', total: 'sum' }, 'clock_out');
        ensurePayrollColumn(columns, { key: 'early_leave_minutes', label: 'Ранній вихід хв', type: 'number', placeholder: '0', total: 'sum' }, 'late_minutes');
        ensurePayrollColumn(columns, { key: 'overtime_minutes', label: 'Overtime хв', type: 'number', placeholder: '0', total: 'sum' }, 'early_leave_minutes');
        ensurePayrollColumn(columns, { key: 'plan_warning', label: 'Попередження плану', type: 'text', placeholder: '' }, 'overtime_minutes');
        ensurePayrollColumn(columns, { key: 'planned_hours', label: 'План', type: 'number', placeholder: '0', total: 'sum' }, 'role');
        ensurePayrollColumn(columns, { key: 'actual_hours', label: 'Факт', type: 'number', placeholder: '0', total: 'sum' }, 'planned_hours');
        ensurePayrollColumn(columns, { key: 'hours', label: 'Опл. години', type: 'number', placeholder: '0', total: 'sum' }, 'actual_hours');
        ensurePayrollColumn(columns, { key: 'penalty', label: 'Штраф', type: 'number', placeholder: '0', total: 'sum' }, 'bonus');
        ensurePayrollColumn(columns, { key: 'manual_amount', label: 'Ручна сума', type: 'number', placeholder: '0', total: 'sum' }, 'penalty');
        ensurePayrollColumn(columns, { key: 'notes', label: 'Нотатки', type: 'text', placeholder: 'Причина корекції / коментар' }, 'manual_amount');
        const rows = (Array.isArray(template.rows) && template.rows.length ? template.rows : [emptyReportTableRow(columns)]).map(row => ({
            date: row?.date || row?.shift_date || '',
            employee: row?.employee || row?.name || '',
            employee_staff_id: row?.employee_staff_id || row?.staff_id || '',
            role: row?.role || row?.role_snapshot || '',
            planned_start: row?.planned_start || '',
            planned_end: row?.planned_end || '',
            clock_in: row?.clock_in || '',
            clock_out: row?.clock_out || '',
            late_minutes: row?.late_minutes ?? '',
            early_leave_minutes: row?.early_leave_minutes ?? '',
            overtime_minutes: row?.overtime_minutes ?? '',
            plan_warning: row?.plan_warning || '',
            planned_hours: row?.planned_hours || '',
            actual_hours: row?.actual_hours || '',
            hours: row?.hours || row?.paid_hours || '',
            rate: row?.rate || '',
            bonus: row?.bonus || row?.bonuses || '',
            penalty: row?.penalty || row?.penalties || '',
            manual_amount: row?.manual_amount || '',
            notes: row?.notes || '',
            total: row?.total || row?.amount || '',
            ...row
        }));
        return {
            ...template,
            layout: template.layout || 'payroll',
            defaultReport: {
                ...(template.defaultReport || {}),
                type: template.defaultReport?.type === 'income' ? 'income' : 'expense',
                category: template.defaultReport?.category || 'ЗП',
                hashtag: template.defaultReport?.hashtag || 'table-payroll',
                amountColumn: template.defaultReport?.amountColumn || 'total'
            },
            columns,
            rows
        };
    }

    function payrollStaffId(row = {}) {
        return String(row.staff_id || row.employee_staff_id || row.staffId || '').trim();
    }

    function payrollDateKey(row = {}) {
        return String(row.date || row.shift_date || row.work_date || '').slice(0, 10);
    }

    function payrollLookupKey(staffId, date) {
        return `${staffId}_${date}`;
    }

    function payrollStaffOption(staffId) {
        return _staffOptions.find(staff => String(staff.id) === String(staffId));
    }

    function timeToMinutes(value) {
        const text = String(value || '').slice(0, 5);
        const match = text.match(/^(\d{1,2}):(\d{2})$/);
        if (!match) return null;
        return Number(match[1]) * 60 + Number(match[2]);
    }

    function hoursBetween(start, end) {
        const startMinutes = timeToMinutes(start);
        const endMinutes = timeToMinutes(end);
        if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) return 0;
        let diff = endMinutes - startMinutes;
        if (diff < 0) diff += 24 * 60;
        return Math.round((diff / 60) * 100) / 100;
    }

    function nonNegativeMinutes(value) {
        if (value === null || value === undefined || String(value).trim() === '') return null;
        const minutes = Number(value);
        return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
    }

    function segmentPlannedMinutes(segment = {}) {
        const startMinutes = timeToMinutes(
            segment.shiftStart || segment.shift_start || segment.plannedStart || segment.planned_start
        );
        const endMinutes = timeToMinutes(
            segment.shiftEnd || segment.shift_end || segment.plannedEnd || segment.planned_end
        );
        if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || startMinutes === endMinutes) return 0;
        let duration = endMinutes - startMinutes;
        if (duration < 0) duration += 24 * 60;
        const breakMinutes = nonNegativeMinutes(segment.breakMinutes ?? segment.break_minutes) || 0;
        return Math.max(0, duration - breakMinutes);
    }

    function schedulePlannedTime(entry = {}) {
        if (!entry || !['working', 'work'].includes(String(entry.status || 'working'))) {
            return { minutes: 0, hours: 0, source: 'non_working_status' };
        }

        const snakeCaseMinutes = nonNegativeMinutes(entry.planned_minutes);
        const camelCaseMinutes = nonNegativeMinutes(entry.plannedMinutes);
        let minutes;
        let source;
        if (snakeCaseMinutes !== null) {
            minutes = snakeCaseMinutes;
            source = 'schedule_planned_minutes';
        } else if (camelCaseMinutes !== null) {
            minutes = camelCaseMinutes;
            source = 'schedule_planned_minutes';
        } else if (Array.isArray(entry.segments)) {
            minutes = entry.segments.reduce((sum, segment) => sum + segmentPlannedMinutes(segment), 0);
            source = 'schedule_segments';
        } else {
            minutes = hoursBetween(
                entry.shift_start || entry.planned_start || entry.shiftStart || entry.plannedStart,
                entry.shift_end || entry.planned_end || entry.shiftEnd || entry.plannedEnd
            ) * 60;
            source = 'legacy_envelope';
        }
        return {
            minutes: Math.round(minutes),
            hours: Math.round((minutes / 60) * 100) / 100,
            source
        };
    }

    function diffDateHours(start, end) {
        if (!start || !end) return 0;
        const startTime = new Date(start).getTime();
        const endTime = new Date(end).getTime();
        if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return 0;
        return Math.round(((endTime - startTime) / 3600000) * 100) / 100;
    }

    function schedulePlannedHours(entry = {}) {
        return schedulePlannedTime(entry).hours;
    }

    function scheduleSegmentRefs(entry = {}) {
        if (!Array.isArray(entry.segments)) return [];
        return [...new Set(entry.segments
            .map(segment => segment?.id ?? segment?.segmentId ?? segment?.segment_id)
            .filter(id => id !== null && id !== undefined && String(id).trim() !== '')
            .map(id => Number(id))
            .filter(Number.isFinite))];
    }

    function schedulePrimaryProfession(entry = {}) {
        return String(
            entry.primary_profession_key
            || entry.primaryProfessionKey
            || entry.profession_key
            || entry.professionKey
            || ''
        ).trim();
    }

    function attendanceActualHours(record = {}) {
        const minutes = Number(record.total_worked_minutes || 0);
        if (minutes > 0) return Math.round((minutes / 60) * 100) / 100;
        return diffDateHours(record.clock_in || record.checkin_at, record.clock_out || record.checkout_at);
    }

    function attendanceTimeLabel(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value).slice(0, 5);
        return date.toLocaleTimeString('uk-UA', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Kyiv'
        });
    }

    function attendanceFactNumber(value) {
        const num = Number(value || 0);
        return Number.isFinite(num) ? Math.max(0, num) : 0;
    }

    function payrollAttendanceFacts(record = {}) {
        const serverFacts = record.attendance_facts || record.attendanceFacts || {};
        const lateRaw = attendanceFactNumber(serverFacts.lateMinutes ?? serverFacts.late_minutes ?? record.late_minutes);
        const earlyLeaveMinutes = attendanceFactNumber(serverFacts.earlyLeaveMinutes ?? serverFacts.early_leave_minutes ?? record.early_leave_minutes);
        const overtimeRaw = attendanceFactNumber(serverFacts.overtimeMinutes ?? serverFacts.overtime_minutes ?? record.overtime_minutes);
        const lateMinutes = lateRaw > ATTENDANCE_GRACE_MINUTES.late ? lateRaw : 0;
        const overtimeMinutes = overtimeRaw > ATTENDANCE_GRACE_MINUTES.overtime ? overtimeRaw : 0;
        const events = [];
        if (lateMinutes > 0) events.push('late');
        if (earlyLeaveMinutes > 0) events.push('left_early');
        if (overtimeMinutes > 0) events.push('overtime');
        return { lateMinutes, earlyLeaveMinutes, overtimeMinutes, events };
    }

    function payrollAttendanceStatus(record = null) {
        if (!record) return '';
        const raw = String(record.time_status || '').trim();
        if (['sick', 'vacation', 'day_off', 'excused'].includes(raw)) return 'excused';
        if (['absent', 'no_show'].includes(raw)) return 'absent';
        const facts = payrollAttendanceFacts(record);
        if (facts.events.length) return facts.events.join('+');
        if ((record.clock_in || record.checkin_at) && (record.clock_out || record.checkout_at)) return 'completed';
        if (record.clock_in || record.checkin_at) return 'checked_in';
        return raw || 'planned';
    }

    function payrollDateRange(state = _reportTableState) {
        const dates = (state?.rows || []).map(payrollDateKey).filter(Boolean).sort();
        if (!dates.length) return null;
        return { from: dates[0], to: dates[dates.length - 1], signature: `${dates[0]}:${dates[dates.length - 1]}` };
    }

    async function loadPayrollReconciliationSources(state = _reportTableState) {
        if (!isPayrollTableState(state)) return;
        const range = payrollDateRange(state);
        _payrollScheduleIndex = {};
        _payrollAttendanceIndex = {};
        _payrollReconciliationSignature = range?.signature || 'reports-payroll-deprecated';
    }

    function queuePayrollReconciliationRefresh() {
        const state = _reportTableState;
        if (!isPayrollTableState(state) || _payrollReconciliationLoading) return;
        const range = payrollDateRange(state);
        if (!range || _payrollReconciliationSignature === range.signature) return;
        loadPayrollReconciliationSources(state).then(() => {
            if (state === _reportTableState && isPayrollTableState(state)) renderReportTableWorkspace();
        }).catch(() => {});
    }

    function payrollIssue(code, issues) {
        if (code && !issues.includes(code)) issues.push(code);
    }

    function normalizePayrollRows(state = _reportTableState, options = {}) {
        if (!isPayrollTableState(state)) return { rows: [], rowMeta: [], totals: { planned: 0, actual: 0, paid: 0, amount: 0 }, status: 'draft', issueCounts: {} };
        return deprecatedPayrollReconciliation(state);
    }

    function isOperationsTableState(state = _reportTableState) {
        const identity = [
            state?.id,
            state?.code,
            state?.layout,
            state?.category,
            state?.defaultReport?.hashtag
        ].map(value => String(value || '').toLowerCase()).join(' ');
        if (identity.includes('operations-checklist') || identity.includes('table-ops')) return true;
        const keys = new Set((state?.columns || []).map(col => col.key));
        return String(state?.layout || '').toLowerCase() === 'checklist'
            && keys.has('owner')
            && keys.has('task')
            && keys.has('status');
    }

    function reportQualityIssueStatus(code) {
        return REPORT_QUALITY_ISSUE_STATUS[code] || 'needs_review';
    }

    function reportQualityStatusFromIssues(issues = []) {
        if (issues.some(code => reportQualityIssueStatus(code) === 'needs_review')) return 'needs_review';
        if (issues.length) return 'warning';
        return 'ok';
    }

    function reportQualityHasRowValue(state = _reportTableState, row = {}) {
        return (state?.columns || []).some(col => {
            const value = row?.[col.key];
            if (value === null || value === undefined || String(value).trim() === '') return false;
            if (REPORT_QUALITY_AUTOFILL_ZERO_KEYS.has(col.key) && Number(value) === 0) return false;
            return true;
        });
    }

    function reportQualityAddIssue(rowIssues, rowIndex, code) {
        if (!code) return;
        if (!rowIssues.has(rowIndex)) rowIssues.set(rowIndex, new Set());
        rowIssues.get(rowIndex).add(code);
    }

    function reportQualityAmountValue(state = _reportTableState, row = {}) {
        const amountKey = state?.defaultReport?.amountColumn
            || (state?.columns || []).find(col => col.key === 'total' || col.key === 'amount')?.key
            || '';
        if (!amountKey) return { key: '', raw: '', number: 0 };
        return { key: amountKey, raw: row?.[amountKey], number: parseNumber(row?.[amountKey]) };
    }

    function reportQualityCriticalTaskOpen(row = {}) {
        const text = [row.status, row.note, row.notes, row.task]
            .map(value => String(value || '').toLocaleLowerCase('uk-UA'))
            .join(' ');
        if (!/(critical|urgent|blocker|крит|термінов|ризик|блок)/i.test(text)) return false;
        return !/(ok|done|closed|resolved|готов|закрит|виріш|виконан)/i.test(text);
    }

    function buildReportQuality(state = _reportTableState, options = {}) {
        if (!state) {
            return {
                status: 'needs_review',
                issueCounts: { report_required_sections_incomplete: 1 },
                rowMeta: [],
                totals: { issueRows: 0, okRows: 0 },
                blockingPolicy: 'informational_only_until_policy_confirmed',
                generatedAt: new Date().toISOString(),
                source: 'reports_rawData_quality_v1'
            };
        }

        const rows = Array.isArray(state.rows) ? state.rows : [];
        const rowIssues = new Map();
        const reportIssues = new Set();
        const meaningfulRows = rows
            .map((row, index) => ({ row, index, hasValue: reportQualityHasRowValue(state, row) }))
            .filter(item => item.hasValue);

        if (!rows.length || !meaningfulRows.length || !Array.isArray(state.columns) || !state.columns.length) {
            reportIssues.add('report_required_sections_incomplete');
        }
        if (!String(state.category || state.defaultReport?.category || '').trim()) {
            reportIssues.add('report_context_missing');
        }
        if (!AppState.currentUser?.id && !AppState.currentUser?.username && !AppState.currentUser?.name) {
            reportIssues.add('report_submitted_by_missing');
        }
        if (_staffOptionsWarning && (state.columns || []).some(col => col.type === 'staff')) {
            reportIssues.add('staff_options_unavailable');
        }

        const dateColumn = (state.columns || []).find(col => col.key === 'date' || col.type === 'date');
        if (dateColumn) {
            meaningfulRows.forEach(({ row, index }) => {
                if (!String(row?.[dateColumn.key] || '').trim()) {
                    reportQualityAddIssue(rowIssues, index, 'report_date_missing');
                }
            });
        }

        const amountColumn = state.defaultReport?.amountColumn;
        const previousAmount = Number(state.reportQuality?.totals?.amount);
        if (amountColumn && Number.isFinite(previousAmount)) {
            const currentAmount = rows.reduce((sum, row) => sum + parseNumber(row?.[amountColumn]), 0);
            if (Math.abs(currentAmount - previousAmount) > 0.05) reportIssues.add('report_totals_mismatch');
        }

        if (isPayrollTableState(state)) {
            const reconciliation = options.payrollReconciliation || normalizePayrollRows(state, { mutate: false });
            const payrollIssueMap = {
                missing_staff_id: 'payroll_employee_staff_id_missing',
                missing_payroll_date: 'report_date_missing',
                staff_not_active_or_missing: 'payroll_staff_not_active_or_missing',
                no_shift: 'payroll_no_shift_link',
                no_attendance: 'payroll_no_attendance_link',
                profession_card_fallback: 'payroll_profession_card_fallback',
                attendance_unscheduled: 'payroll_attendance_unscheduled',
                actual_paid_hours_mismatch: 'payroll_actual_hours_mismatch',
                duplicate_payroll_row: 'payroll_duplicate_employee_date',
                amount_missing_or_zero: 'payroll_amount_zero',
                offboarded_staff: 'payroll_offboarded_staff'
            };
            (reconciliation.rowMeta || []).forEach(meta => {
                const row = meta.row || rows[meta.index] || {};
                const hasValue = reportQualityHasRowValue(state, row);
                if (!hasValue) return;
                if (!String(row.employee || row.display_snapshot || '').trim()) {
                    reportQualityAddIssue(rowIssues, meta.index, 'payroll_employee_missing');
                }
                if (!String(row.employee_staff_id || row.staff_id || '').trim()) {
                    reportQualityAddIssue(rowIssues, meta.index, 'payroll_employee_staff_id_missing');
                }
                const amount = reportQualityAmountValue(state, row);
                if (amount.key && (amount.raw === null || amount.raw === undefined || String(amount.raw).trim() === '')) {
                    reportQualityAddIssue(rowIssues, meta.index, 'payroll_amount_missing');
                } else if (amount.key && amount.number === 0) {
                    reportQualityAddIssue(rowIssues, meta.index, 'payroll_amount_zero');
                }
                (meta.issues || []).forEach(code => {
                    const qualityCode = payrollIssueMap[code];
                    if (qualityCode) reportQualityAddIssue(rowIssues, meta.index, qualityCode);
                });
            });
        }

        if (isOperationsTableState(state)) {
            const ownerCol = (state.columns || []).find(col => col.key === 'owner');
            const ownerIdKey = ownerCol ? reportStaffIdKey(ownerCol) : 'owner_staff_id';
            meaningfulRows.forEach(({ row, index }) => {
                if (!String(row.owner || '').trim()) reportQualityAddIssue(rowIssues, index, 'operations_owner_missing');
                if (!String(row[ownerIdKey] || '').trim()) reportQualityAddIssue(rowIssues, index, 'operations_owner_staff_id_missing');
                if (!String(row.status || '').trim()) reportQualityAddIssue(rowIssues, index, 'operations_task_status_missing');
                if (reportQualityCriticalTaskOpen(row)) reportQualityAddIssue(rowIssues, index, 'operations_open_critical_task');
            });
        }

        const rowMeta = rows.map((row, index) => {
            const issues = [...(rowIssues.get(index) || [])];
            return {
                index,
                status: reportQualityStatusFromIssues(issues),
                issues
            };
        });
        const issueCounts = {};
        [...reportIssues].forEach(code => { issueCounts[code] = (issueCounts[code] || 0) + 1; });
        rowMeta.forEach(meta => meta.issues.forEach(code => { issueCounts[code] = (issueCounts[code] || 0) + 1; }));
        const status = reportQualityStatusFromIssues(Object.keys(issueCounts));
        const amount = state.defaultReport?.amountColumn
            ? rows.reduce((sum, row) => sum + parseNumber(row?.[state.defaultReport.amountColumn]), 0)
            : 0;
        return {
            status,
            issueCounts,
            rowMeta,
            totals: {
                issueRows: rowMeta.filter(meta => meta.issues.length).length,
                okRows: rowMeta.filter(meta => !meta.issues.length).length,
                amount: Math.round(amount * 100) / 100
            },
            blockingPolicy: 'informational_only_until_policy_confirmed',
            generatedAt: new Date().toISOString(),
            source: 'reports_rawData_quality_v1'
        };
    }

    function reportStaffIdKey(col = {}) {
        return col.staffIdKey || `${col.key}_staff_id`;
    }

    function reportStaffRoleLabel(staff = {}) {
        return String(staff.role_type || staff.roleType || staff.position || '').trim();
    }

    function reportStaffOptionLabel(staff = {}) {
        const role = reportStaffRoleLabel(staff);
        const dept = String(staff.department || '').trim();
        return [staff.display_name || staff.name, role, dept].filter(Boolean).join(' · ');
    }

    function emptyReportTableRow(columns = []) {
        const row = {};
        columns.forEach(col => {
            row[col.key] = '';
            if (col.type === 'staff') row[reportStaffIdKey(col)] = '';
        });
        return row;
    }

    function staffColumnBinding(template = {}, col = {}, key = '') {
        const templateIdentity = String(template.code || template.id || template.layout || '').toLowerCase();
        if (col.type === 'staff') return true;
        if (templateIdentity.includes('payroll-staff') && key === 'employee') return true;
        if (templateIdentity.includes('operations-checklist') && key === 'owner') return true;
        return false;
    }

    function applyReportStaffSelection(row, col, staffId) {
        if (!row || !col) return;
        const idKey = reportStaffIdKey(col);
        const normalizedId = String(staffId || '').trim();
        const staff = _staffOptions.find(item => String(item.id) === normalizedId);
        row[idKey] = normalizedId;
        row[col.key] = staff ? staff.name : '';
        if (col.roleKey && staff) {
            row[col.roleKey] = reportStaffRoleLabel(staff);
        }
        if (isPayrollTableState() && col.key === 'employee') {
            row.staff_id = normalizedId;
            row.display_snapshot = staff ? staff.name : (row.employee || row.display_snapshot || '');
            row.role_snapshot = staff ? reportStaffRoleLabel(staff) : (row.role || row.role_snapshot || '');
            if (staff && !row.role) row.role = row.role_snapshot;
        }
    }

    function normalizedComparable(value) {
        return String(value || '').trim().toLocaleLowerCase('uk-UA');
    }

    function reportTableLifecycleStatus(state = _reportTableState) {
        return state?.lifecycle?.status === 'closed' ? 'closed' : 'open';
    }

    function isReportTableLocked(state = _reportTableState) {
        return reportTableLifecycleStatus(state) === 'closed' || isPayrollTableState(state);
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
        let columns = template.columns.map((col, index) => {
            const label = String(col.label || col.title || col.key || `Колонка ${index + 1}`).trim();
            const key = slugifyKey(col.key || label, `col-${index + 1}`);
            const bindStaff = staffColumnBinding(template, col, key);
            return {
                key,
                label,
                type: bindStaff ? 'staff' : ['number', 'date', 'text', 'select'].includes(col.type) ? col.type : 'text',
                placeholder: String(col.placeholder || ''),
                total: col.total === 'sum' ? 'sum' : null,
                options: Array.isArray(col.options) ? col.options.map(String).filter(Boolean) : [],
                staffIdKey: bindStaff ? String(col.staffIdKey || col.staff_id_key || `${key}_staff_id`) : null,
                roleKey: bindStaff && (col.roleKey || col.role_key || key === 'employee')
                    ? String(col.roleKey || col.role_key || 'role')
                    : null
            };
        });
        columns = normalizePayrollColumns(columns, template);
        const seen = new Set();
        columns.forEach((col, index) => {
            let key = col.key;
            while (seen.has(key)) key = `${col.key}-${index + 1}`;
            seen.add(key);
            col.key = key;
        });
        const rows = Array.isArray(template.rows) && template.rows.length
            ? template.rows
            : [emptyReportTableRow(columns)];

        const normalizedTemplate = {
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
                    if (col.type === 'staff') {
                        const idKey = reportStaffIdKey(col);
                        normalizedRow[idKey] = row?.[idKey] ?? row?.[col.staff_id_key] ?? '';
                        if (col.roleKey && row?.[col.roleKey] !== undefined) normalizedRow[col.roleKey] = row[col.roleKey];
                    }
                });
                return normalizedRow;
            })
        };
        return upgradePayrollTemplate(normalizedTemplate);
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
        syncReportWorkflowSettingsAccess();
        initReportsBusinessContext(AppState.currentUser);

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
        syncReportsReadOnlyUi();
        if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
        else if (typeof Sidebar !== 'undefined' && Sidebar.markShellReady) Sidebar.markShellReady();
    }

    // ==========================================
    // DATA LOADING
    // ==========================================

    async function loadStaffOptions() {
        try {
            const data = await apiRequest('GET', '/api/staff?active=true');
            const rows = Array.isArray(data.data) ? data.data : [];
            _staffOptions = rows
                .filter(staff => staff && staff.id && (staff.display_name || staff.name))
                .map(staff => ({
                    id: String(staff.id),
                    name: String(staff.display_name || staff.name),
                    display_name: String(staff.display_name || staff.name),
                    department: staff.department || '',
                    position: staff.position || '',
                    role_type: staff.role_type || '',
                    roleType: staff.roleType || '',
                    label: reportStaffOptionLabel(staff)
                }));
            _staffOptionsAvailable = true;
            _staffOptionsWarning = '';
        } catch (_err) {
            _staffOptions = [];
            _staffOptionsAvailable = false;
            _staffOptionsWarning = 'Список працівників недоступний. Staff-поля працюють у snapshot fallback.';
        }
    }

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
        if (!syncReportWorkflowSettingsAccess()) return;
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
        if (!canManageReportWorkflowSettings()) {
            showNotification('Недостатньо прав для зміни маршруту перевірки звітів', 'error');
            return;
        }
        if (!guardReportsWrite('зберігати маршрут перевірки звітів')) return;
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
            const data = await apiRequest('GET', '/api/reports/submitters');
            const names = Array.isArray(data.submitters) ? data.submitters : [];
            const select = document.getElementById('submittedByFilter');
            if (!select) return;
            while (select.options.length > 1) select.remove(1);
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
        await Promise.all([loadStaffOptions(), loadReportTemplates()]);

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
        document.getElementById('reportSheetSummary')?.addEventListener('click', event => {
            const qualityIssueBtn = event.target.closest('[data-report-quality-issue-filter]');
            if (qualityIssueBtn) {
                _reportQualityIssueFilter = qualityIssueBtn.dataset.reportQualityIssueFilter || '';
                _reportQualityFilter = _reportQualityIssueFilter ? 'issue' : 'all';
                renderReportTableWorkspace();
                return;
            }
            const qualityFilterBtn = event.target.closest('[data-report-quality-filter]');
            if (qualityFilterBtn) {
                _reportQualityFilter = qualityFilterBtn.dataset.reportQualityFilter || 'all';
                _reportQualityIssueFilter = '';
                renderReportTableWorkspace();
                return;
            }
            const filterBtn = event.target.closest('[data-payroll-review-filter]');
            if (!filterBtn) return;
            _payrollReviewFilter = filterBtn.dataset.payrollReviewFilter || 'all';
            renderReportTableWorkspace();
        });
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
        const payrollDeprecated = isPayrollTableState(state);
        const readOnly = isReportsBusinessReadOnly();
        const dirty = document.getElementById('reportTemplateDirty');
        if (dirty) dirty.classList.toggle('hidden', !_reportTableDirty);

        const mode = document.getElementById('reportSheetModeChip');
        if (mode && payrollDeprecated) {
            mode.textContent = 'Payroll read-only · canonical API';
            mode.classList.toggle('closed', true);
        } else if (mode) {
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
        if (saveBtn && payrollDeprecated) saveBtn.textContent = 'Payroll read-only';

        const finalHandoff = document.getElementById('reportFinalHandoff');
        if (finalHandoff) {
            finalHandoff.classList.toggle('is-locked', locked);
            finalHandoff.classList.toggle('is-busy', _reportTableBusy);
        }

        const closeBtn = document.getElementById('reportTemplateCloseBtn');
        if (closeBtn) {
            closeBtn.classList.toggle('is-locked', locked);
            closeBtn.innerHTML = payrollDeprecated
                ? '<span>Payroll read-only</span><small>Use canonical Payroll API/export</small>'
                : locked
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
            if (el) el.disabled = readOnly || _reportTableBusy || !state || locked;
        });

        const canExportTable = isPayrollTableState() || (typeof canAccess === 'function'
            && canAccess('export_data')
            && canAccess('view_revenue'));
        [
            'reportTemplateExportCsvBtn',
            'reportTemplateExportXlsxBtn'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = _reportTableBusy || !state || !canExportTable;
        });

        if (closeBtn) closeBtn.disabled = readOnly || _reportTableBusy || !state || locked || !hasMeaningfulTableData();
        syncReportsReadOnlyUi();
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
        _payrollReviewFilter = 'all';
        _reportQualityFilter = 'all';
        _reportQualityIssueFilter = '';
        _payrollReconciliationSignature = '';
        _reportTableState = {
            ...clone(template),
            rows: template.rows.map(row => ({ ...row })),
            lifecycle: { status: 'open' },
            reportQuality: null
        };
        _reportTableDirty = false;

        renderReportTemplateCards();
        renderReportTableWorkspace();
        if (!options.silent) setTemplateStatus(`Шаблон "${template.title}" завантажено`);
        if (!options.silent && isPayrollTableState()) setTemplateStatus(reportsPayrollDeprecatedMessage());
    }

    function renderPayrollRowBadge(meta) {
        if (!meta) return '';
        const label = PAYROLL_RECONCILIATION_LABELS[meta.status] || meta.status;
        const issueTitle = meta.issues.map(code => PAYROLL_ISSUE_LABELS[code] || code).join(', ');
        return `
            <span class="rpt-payroll-row-status ${esc(meta.status)}" title="${esc(issueTitle || label)}">
                ${esc(label)}
            </span>
            ${meta.issues.length ? `<span class="rpt-payroll-row-issues">${meta.issues.length}</span>` : ''}
        `;
    }

    function renderQualityRowBadge(meta) {
        if (!meta || !meta.issues?.length) return '';
        const label = REPORT_QUALITY_STATUS_LABELS[meta.status] || meta.status;
        const issueTitle = meta.issues.map(code => REPORT_QUALITY_ISSUE_LABELS[code] || code).join(', ');
        return `
            <span class="rpt-quality-row-status ${esc(meta.status)}" title="${esc(issueTitle || label)}">
                ${esc(label)}
            </span>
            <span class="rpt-quality-row-issues">${meta.issues.length}</span>
        `;
    }

    function payrollVisibleRowEntries(state, reconciliation) {
        const entries = (state.rows || []).map((row, index) => ({
            row,
            rowIndex: index,
            meta: reconciliation.rowMeta[index]
        }));
        if (_payrollReviewFilter === 'all') return entries;
        return entries.filter(item => item.meta?.status === _payrollReviewFilter);
    }

    function qualityVisibleRowEntries(entries, quality) {
        if (_reportQualityFilter === 'all' || !quality) return entries;
        if (_reportQualityFilter === 'issue') {
            return entries.filter(item => quality.rowMeta?.[item.rowIndex]?.issues?.includes(_reportQualityIssueFilter));
        }
        return entries.filter(item => {
            const meta = quality.rowMeta?.[item.rowIndex];
            return (meta?.status || 'ok') === _reportQualityFilter;
        });
    }

    function renderPayrollReconciliationPanel(reconciliation) {
        if (!reconciliation) return '';
        if (reconciliation.status === 'deprecated_read_only') {
            const exports = reconciliation.canonicalExports || {};
            return `
            <div class="rpt-payroll-reconciliation">
                <div class="rpt-payroll-reconciliation-head">
                    <div>
                        <span class="rpt-template-chip">Payroll read-only</span>
                        <strong class="rpt-payroll-status deprecated_read_only">Canonical API</strong>
                    </div>
                </div>
                <div class="rpt-payroll-issues">
                    <span>${esc(reportsPayrollDeprecatedMessage())}</span>
                    ${exports.csv ? `<span>CSV: ${esc(exports.csv)}</span>` : ''}
                    ${exports.xlsx ? `<span>XLSX: ${esc(exports.xlsx)}</span>` : ''}
                </div>
            </div>`;
        }
        const totals = reconciliation.totals || {};
        const issueEntries = Object.entries(reconciliation.issueCounts || {});
        const hasIssues = issueEntries.length > 0;
        return `
            <div class="rpt-payroll-reconciliation">
                <div class="rpt-payroll-reconciliation-head">
                    <div>
                        <span class="rpt-template-chip">Payroll reconciliation</span>
                        <strong class="rpt-payroll-status ${esc(reconciliation.status)}">${esc(PAYROLL_RECONCILIATION_LABELS[reconciliation.status] || reconciliation.status)}</strong>
                    </div>
                    <div class="rpt-payroll-filter" aria-label="Payroll review filter">
                        ${PAYROLL_RECONCILIATION_FILTERS.map(filter => `
                            <button type="button"
                                class="rpt-payroll-filter-btn ${_payrollReviewFilter === filter.key ? 'active' : ''}"
                                data-payroll-review-filter="${esc(filter.key)}">
                                ${esc(filter.label)}
                            </button>
                        `).join('')}
                    </div>
                </div>
                <div class="rpt-payroll-metrics">
                    <span>План <b>${totals.planned || 0}</b> год</span>
                    <span>Факт <b>${totals.actual || 0}</b> год</span>
                    <span>Оплата <b>${totals.paid || 0}</b> год</span>
                    <span>Сума <b>${formatAmount(totals.amount || 0)}</b></span>
                </div>
                <div class="rpt-payroll-issues ${hasIssues ? '' : 'is-ok'}">
                    ${hasIssues
                        ? issueEntries.map(([code, count]) => `<span title="${esc(code)}">${esc(PAYROLL_ISSUE_LABELS[code] || code)} <b>${count}</b></span>`).join('')
                        : '<span>Розбіжностей не знайдено</span>'}
                </div>
            </div>
        `;
    }

    function renderReportQualityPanel(quality, options = {}) {
        if (!quality) return '';
        const issueEntries = Object.entries(quality.issueCounts || {});
        const hasIssues = issueEntries.length > 0;
        const interactive = options.interactive !== false;
        const compact = options.compact === true;
        return `
            <div class="rpt-report-quality ${compact ? 'compact' : ''}">
                <div class="rpt-report-quality-head">
                    <div>
                        <span class="rpt-template-chip">Report quality</span>
                        <strong class="rpt-report-quality-status ${esc(quality.status)}">${esc(REPORT_QUALITY_STATUS_LABELS[quality.status] || quality.status)}</strong>
                    </div>
                    ${interactive ? `<div class="rpt-report-quality-filter" aria-label="Report quality filter">
                        ${REPORT_QUALITY_FILTERS.map(filter => `
                            <button type="button"
                                class="rpt-report-quality-filter-btn ${_reportQualityFilter === filter.key && !_reportQualityIssueFilter ? 'active' : ''}"
                                data-report-quality-filter="${esc(filter.key)}">
                                ${esc(filter.label)}
                            </button>
                        `).join('')}
                    </div>` : ''}
                </div>
                <div class="rpt-report-quality-metrics">
                    <span>Рядків з issues <b>${quality.totals?.issueRows || 0}</b></span>
                    <span>OK <b>${quality.totals?.okRows || 0}</b></span>
                    <span>Policy <b>informational</b></span>
                </div>
                <div class="rpt-report-quality-issues ${hasIssues ? '' : 'is-ok'}">
                    ${hasIssues
                        ? issueEntries.map(([code, count]) => interactive
                            ? `<button type="button" class="rpt-report-quality-issue-btn ${_reportQualityIssueFilter === code ? 'active' : ''}" data-report-quality-issue-filter="${esc(code)}" title="${esc(code)}">${esc(REPORT_QUALITY_ISSUE_LABELS[code] || code)} <b>${count}</b></button>`
                            : `<span title="${esc(code)}">${esc(REPORT_QUALITY_ISSUE_LABELS[code] || code)} <b>${count}</b></span>`
                        ).join('')
                        : '<span>Якість звіту OK</span>'}
                </div>
            </div>
        `;
    }

    function renderReportTableWorkspace() {
        const state = _reportTableState;
        const table = document.getElementById('reportSheetTable');
        if (!state || !table) return;
        const locked = isReportTableLocked(state);
        const payrollReconciliation = isPayrollTableState(state) ? normalizePayrollRows(state, { mutate: true }) : null;
        const reportQuality = buildReportQuality(state, { payrollReconciliation });
        const baseRowEntries = payrollReconciliation
            ? payrollVisibleRowEntries(state, payrollReconciliation)
            : state.rows.map((row, rowIndex) => ({ row, rowIndex, meta: null }));
        const rowEntries = qualityVisibleRowEntries(baseRowEntries, reportQuality);

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
                ${rowEntries.length ? rowEntries.map(({ row, rowIndex, meta }) => `
                    <tr class="${meta ? `has-payroll-${esc(meta.status)}` : ''} has-quality-${esc(reportQuality.rowMeta?.[rowIndex]?.status || 'ok')}">
                        <td class="rpt-sheet-row-index">
                            ${rowIndex + 1}
                            ${renderPayrollRowBadge(meta)}
                            ${renderQualityRowBadge(reportQuality.rowMeta?.[rowIndex])}
                        </td>
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
                `).join('') : `
                    <tr>
                        <td colspan="${state.columns.length + (locked ? 1 : 2)}" class="rpt-sheet-empty-filter">
                            Немає рядків для вибраного filter.
                        </td>
                    </tr>
                `}
            </tbody>
        `;
        const totals = renderReportSheetTotals();
        table.innerHTML = head + body + totals;
        renderReportSheetSummary(payrollReconciliation, reportQuality);
        refreshReportWorkspaceControls();
        queuePayrollReconciliationRefresh();
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
        if (col.type === 'staff') {
            const idKey = reportStaffIdKey(col);
            const currentId = String(row[idKey] || '').trim();
            const currentName = String(row[col.key] || '').trim();
            const hasCurrent = currentId && _staffOptions.some(staff => String(staff.id) === currentId);
            const snapshotOption = currentId && !hasCurrent
                ? `<option value="${esc(currentId)}" selected>${esc(currentName || `Staff #${currentId}`)} · snapshot</option>`
                : !currentId && currentName
                    ? `<option value="" selected>${esc(currentName)} · snapshot</option>`
                    : '';
            const placeholderSelected = !currentId && !currentName ? ' selected' : '';
            return `
                <select class="rpt-sheet-input rpt-sheet-select rpt-sheet-staff-select"
                    data-staff-field="true"
                    data-staff-id-key="${esc(idKey)}"
                    ${common}>
                    <option value=""${placeholderSelected}>${esc(col.placeholder || 'Оберіть працівника')}</option>
                    ${snapshotOption}
                    ${_staffOptions.map(staff => `<option value="${esc(staff.id)}" ${staff.id === currentId ? 'selected' : ''}>${esc(staff.label || staff.name)}</option>`).join('')}
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

    function renderReportSheetSummary(payrollReconciliation = null, reportQuality = null) {
        const container = document.getElementById('reportSheetSummary');
        if (!container || !_reportTableState) return;
        const rows = reportTableSubtotalRows();
        const qualityPanel = renderReportQualityPanel(reportQuality || buildReportQuality(_reportTableState, { payrollReconciliation }));
        const payrollPanel = renderPayrollReconciliationPanel(payrollReconciliation);
        const staffWarningPanel = _staffOptionsWarning && _reportTableState.columns.some(col => col.type === 'staff')
            ? `<div class="rpt-sheet-warning-card" role="status">${esc(_staffOptionsWarning)}</div>`
            : '';
        container.classList.toggle('hidden', rows.length === 0 && !payrollPanel && !qualityPanel && !staffWarningPanel);
        container.innerHTML = staffWarningPanel + qualityPanel + payrollPanel + rows.map(item => `
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
        const payrollReconciliation = isPayrollTableState() ? normalizePayrollRows(_reportTableState, { mutate: true }) : null;
        renderReportSheetSummary(payrollReconciliation, buildReportQuality(_reportTableState, { payrollReconciliation }));
    }

    function handleReportSheetInput(event) {
        const input = event.target.closest('.rpt-sheet-input');
        if (!input || !_reportTableState || isReportTableLocked()) return;
        const rowIndex = Number(input.dataset.rowIndex);
        const key = input.dataset.columnKey;
        if (!_reportTableState.rows[rowIndex] || !key) return;
        const col = _reportTableState.columns.find(item => item.key === key);
        if (col?.type === 'staff') {
            applyReportStaffSelection(_reportTableState.rows[rowIndex], col, input.value);
            _payrollReconciliationSignature = '';
            renderReportTableWorkspace();
        } else {
            _reportTableState.rows[rowIndex][key] = input.value;
            if (isPayrollTableState() && ['date', 'hours', 'paid_hours', 'planned_hours', 'actual_hours', 'total', 'bonus', 'penalty', 'manual_amount'].includes(key)) {
                _payrollReconciliationSignature = '';
            }
        }
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
            _reportTableState.rows.push(emptyReportTableRow(_reportTableState.columns));
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
        const row = emptyReportTableRow(_reportTableState.columns);
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
        _payrollReviewFilter = 'all';
        _reportQualityFilter = 'all';
        _reportQualityIssueFilter = '';
        _payrollReconciliationSignature = '';
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
            columns: normalizePayrollColumns(Array.isArray(table.columns) ? table.columns : [], table),
            rows: Array.isArray(table.rows) ? table.rows : [],
            lifecycle: table.lifecycle || { status: draft.status === 'closed' ? 'closed' : 'open' },
            reportQuality: table.reportQuality || null
        };
        _reportTableDirty = false;
        renderReportTemplateCards();
        renderReportTableWorkspace();
        setTemplateStatus(`Відкрито чернетку #${draft.id}`);
        if (isPayrollTableState()) setTemplateStatus(reportsPayrollDeprecatedMessage());
    }

    function openReportTableForEditing(report) {
        const table = normalizeReportRawData(report?.rawData).reportTableTemplate;
        if (!table) return;
        _editingDraftId = null;
        _editingTableReportId = report.id;
        _activeTemplateId = String(table.id || _activeTemplateId);
        _payrollReviewFilter = 'all';
        _reportQualityFilter = 'all';
        _reportQualityIssueFilter = '';
        _payrollReconciliationSignature = '';
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
            columns: normalizePayrollColumns(Array.isArray(table.columns) ? table.columns : [], table),
            rows: Array.isArray(table.rows) ? table.rows : [],
            lifecycle: closedLifecycleFromReport(report),
            reportQuality: table.reportQuality || null
        };
        _reportTableDirty = false;
        renderReportTemplateCards();
        renderReportTableWorkspace();
        setTemplateStatus(isReportTableLocked() ? `Перегляд закритого звіту #${report.id}` : `Редагування збереженого звіту #${report.id}`);
        if (isPayrollTableState()) setTemplateStatus(reportsPayrollDeprecatedMessage());
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
            if (file && isPayrollTableState()) showNotification(reportsPayrollDeprecatedMessage(), 'warning');
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
        const payrollReconciliation = isPayrollTableState(_reportTableState)
            ? normalizePayrollRows(_reportTableState, { mutate: true })
            : null;
        const reportQuality = buildReportQuality(_reportTableState, { payrollReconciliation });
        _reportTableState.reportQuality = reportQuality;
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
                columns: normalizePayrollColumns(_reportTableState.columns, _reportTableState),
                rows: payrollReconciliation ? payrollReconciliation.rows : _reportTableState.rows,
                payrollReconciliation,
                reportQuality,
                lifecycle: _reportTableState.lifecycle || { status: 'open' },
                generatedAt: new Date().toISOString()
            }
        };
    }

    function getTemplateReportAmount() {
        const state = _reportTableState;
        if (!state) return 0;
        if (isPayrollTableState(state)) return 0;
        const amountColumn = state.defaultReport?.amountColumn;
        if (!amountColumn) return 0;
        return Math.max(0, Math.round(state.rows.reduce((sum, row) => sum + parseNumber(row[amountColumn]), 0)));
    }

    async function saveReportTemplateDraft() {
        if (!guardReportsWrite('зберігати чернетки звітів')) return;
        if (!_reportTableState) return;
        if (isPayrollTableState()) {
            showNotification(reportsPayrollDeprecatedMessage(), 'warning');
            setTemplateStatus(reportsPayrollDeprecatedMessage());
            return;
        }
        if (isReportTableLocked()) return;
        if (!String(_reportTableState.title || '').trim()) {
            showNotification('Вкажіть назву чернетки', 'error');
            document.getElementById('reportSheetTitleInput')?.focus();
            return;
        }
        if (isPayrollTableState()) await loadPayrollReconciliationSources(_reportTableState);
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

    async function downloadCanonicalPayrollExport(format) {
        if (!_reportTableState) return;
        const month = payrollTableMonth();
        if (!month) {
            showNotification('Для canonical payroll export потрібен один місяць у payroll table', 'warning');
            setTemplateStatus(reportsPayrollDeprecatedMessage());
            return;
        }
        const token = localStorage.getItem('pzp_token');
        const filename = `payroll_${month}.${format}`;
        let touchWindow = null;
        try {
            touchWindow = typeof openTouchDownloadWindow === 'function'
                ? openTouchDownloadWindow(`${format.toUpperCase()} payroll`)
                : null;
            const res = await fetch(payrollCanonicalExportUrl(format), {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Payroll export failed');
            }
            const blob = await res.blob();
            if (typeof finishBlobDownload === 'function') {
                finishBlobDownload(blob, filename, { touchWindow, successMessage: `${format.toUpperCase()} payroll export ready` });
            } else {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
            }
            setTemplateStatus(`${format.toUpperCase()} payroll export from canonical API`);
        } catch (err) {
            if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(touchWindow);
            showNotification(`Помилка ${format.toUpperCase()} експорту: ${err.message}`, 'error');
        }
    }

    async function downloadReportTableExport(format) {
        if (!_reportTableState) return;
        if (isPayrollTableState()) {
            return downloadCanonicalPayrollExport(format);
        }
        if (typeof canAccess !== 'function' || !canAccess('export_data') || !canAccess('view_revenue')) {
            showNotification('Недостатньо прав для експорту звіту', 'error');
            return;
        }
        const payload = buildReportTablePayload();
        const token = localStorage.getItem('pzp_token');
        const filename = `${slugifyKey(_reportTableState.title, 'report')}.${format}`;
        let touchWindow = null;
        try {
            touchWindow = typeof openTouchDownloadWindow === 'function'
                ? openTouchDownloadWindow(`${format.toUpperCase()} звіт`)
                : null;
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
            if (typeof finishBlobDownload === 'function') {
                finishBlobDownload(blob, filename, { touchWindow, successMessage: `${format.toUpperCase()} експортовано` });
            } else {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
            }
            setTemplateStatus(`${format.toUpperCase()} експортовано`);
        } catch (err) {
            if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(touchWindow);
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
        if (!guardReportsWrite('створювати звіти')) return;
        if (!_reportTableState) return;
        if (isPayrollTableState()) {
            showNotification(reportsPayrollDeprecatedMessage(), 'warning');
            setTemplateStatus(reportsPayrollDeprecatedMessage());
            return;
        }
        if (_reportTableBusy || isReportTableLocked() || !validateReportTableForCreate()) return;
        const reportDefaults = _reportTableState.defaultReport || {};
        const amount = getTemplateReportAmount();
        if (isPayrollTableState()) await loadPayrollReconciliationSources(_reportTableState);
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
        if (!guardReportsWrite('закривати звіти')) return;
        if (!_reportTableState) return;
        if (isPayrollTableState()) {
            showNotification(reportsPayrollDeprecatedMessage(), 'warning');
            setTemplateStatus(reportsPayrollDeprecatedMessage());
            return;
        }
        if (_reportTableBusy || isReportTableLocked()) return;
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
        if (isPayrollTableState()) await loadPayrollReconciliationSources(_reportTableState);
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
        const reportQuality = table.reportQuality || buildReportQuality(table, { payrollReconciliation: table.payrollReconciliation });
        return `
            <div class="rpt-raw-table-preview">
                <div class="rpt-raw-table-preview-head">
                    <strong>${esc(table.title || 'Табличний звіт')}</strong>
                    <button type="button" class="rpt-template-action" onclick="event.stopPropagation();ReportsPage.editTableReport(${report.id})">${closed ? 'Переглянути' : 'Відкрити в редакторі'}</button>
                </div>
                ${renderReportQualityPanel(reportQuality, { interactive: false, compact: true })}
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
        syncReportsReadOnlyUi();
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
        if (!guardReportsWrite('змінювати хештеги звітів')) return;
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
            buttons.push(`<button class="${buttonClass} primary" onclick="event.stopPropagation();ReportsPage.requestApproval(${report.id})" title="Поставити задачу на перевірку">${compact ? 'Task' : 'Поставити задачу'}</button>`);
        }
        if (['pending', 'task_created', 'none'].includes(status) && !['approved', 'rejected'].includes(status)) {
            buttons.push(`<button class="${buttonClass}" onclick="event.stopPropagation();ReportsPage.startApprovalReview(${report.id})" title="Взяти звіт в перевірку">${compact ? 'Review' : 'Взяти в перевірку'}</button>`);
        }
        if (!['approved', 'rejected'].includes(status)) {
            buttons.push(`<button class="${buttonClass} success" onclick="event.stopPropagation();ReportsPage.approveReport(${report.id})" title="Затвердити звіт">${compact ? 'OK' : 'Затвердити'}</button>`);
            buttons.push(`<button class="${buttonClass} danger" onclick="event.stopPropagation();ReportsPage.rejectReport(${report.id})" title="Повернути звіт">${compact ? 'Back' : 'Повернути'}</button>`);
        }
        if (!closed) {
            buttons.push(`<button class="${buttonClass}" onclick="event.stopPropagation();ReportsPage.editReport(${report.id})" title="Редагувати">${compact ? 'Edit' : 'Редагувати'}</button>`);
            buttons.push(`<button class="${buttonClass} danger" onclick="event.stopPropagation();ReportsPage.deleteReport(${report.id})" title="Видалити">${compact ? 'Del' : 'Видалити'}</button>`);
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
            const typeLabel = r.type === 'income' ? 'Дохід' : 'Витрата';
            const statusLabel = STATUS_LABELS[r.status] || r.status;
            const closed = isClosedReport(r);
            const photoBtn = r.photoUrl
                ? `<button class="rpt-photo-btn" onclick="event.stopPropagation();ReportsPage.showPhoto('${esc(r.photoUrl)}')" title="Переглянути фото">Фото</button>`
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
        if (!guardReportsWrite('передавати звіти на перевірку')) return;
        try {
            const result = await apiRequest('POST', `/api/reports/${id}/request-approval`, {});
            showNotification(result.duplicateSkipped ? 'Задача на перевірку вже існує' : 'Задачу бухгалтеру поставлено');
            await loadReports();
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    async function startApprovalReview(id) {
        if (!guardReportsWrite('брати звіти в перевірку')) return;
        try {
            await apiRequest('POST', `/api/reports/${id}/in-review`, {});
            showNotification('Звіт взято в перевірку');
            await Promise.all([loadReports(), loadSummary()]);
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    async function approveReport(id) {
        if (!guardReportsWrite('затверджувати звіти')) return;
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
        if (!guardReportsWrite('повертати звіти')) return;
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
        if (!guardReportsWrite('видаляти звіти')) return;
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
        if (!guardReportsWrite(report?.id ? 'редагувати звіти' : 'створювати звіти')) return;
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
        if (!guardReportsWrite(_editingId ? 'редагувати звіти' : 'створювати звіти')) return;

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
