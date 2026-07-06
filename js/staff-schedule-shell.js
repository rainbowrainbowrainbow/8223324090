/**
 * staff-schedule-shell.js - shared DOM shell for the staff schedule workspace.
 *
 * Used by /staff as the standalone page and by HR Pulse -> Schedule as an
 * in-page schedule surface. It intentionally owns markup only; data loading
 * and interactions stay in js/staff-page.js.
 */
(function () {
    function scheduleWorkspaceTemplate(options = {}) {
        const includePulseNav = options.includePulseNav !== false;
        const nav = includePulseNav
            ? `
            <nav class="staff-pulse-nav" aria-label="Навігація пульсу компанії">
                <div class="staff-pulse-nav-items" id="staffPulseNavItems" data-pulse-switcher="staff"></div>
            </nav>`
            : '';

        return `
            ${nav}
            <section class="staff-schedule-command" aria-label="Керування графіком роботи">
                <div class="staff-schedule-command-content">
                    <div class="staff-schedule-command-copy">
                        <h2>Графік роботи</h2>
                        <p>Період, фільтр і активні зміни команди.</p>
                    </div>
                    <div class="staff-schedule-command-metrics" aria-label="Стан графіка" aria-live="polite">
                        <div class="staff-schedule-metric-chip staff-schedule-metric-chip--period">
                            <span>Період</span>
                            <strong id="scheduleHeaderPeriod">-</strong>
                        </div>
                        <div class="staff-schedule-metric-chip staff-schedule-metric-chip--dept">
                            <span>Фільтр</span>
                            <strong id="scheduleHeaderDepartment">Всі</strong>
                        </div>
                        <div class="staff-schedule-metric-chip staff-schedule-metric-chip--staff">
                            <span>Працівники</span>
                            <strong id="scheduleHeaderStaffCount">0</strong>
                        </div>
                        <div class="staff-schedule-metric-chip staff-schedule-metric-chip--status">
                            <span>Сьогодні</span>
                            <strong id="scheduleHeaderStatus">0 активні</strong>
                        </div>
                    </div>
                </div>
            </section>

            <div class="workspace-command-bar staff-schedule-command-bar" aria-label="Керування періодом і діями графіка">
                <div class="schedule-controls">
                    <div class="week-nav">
                        <button type="button" id="prevWeekBtn" title="Попередній період">‹</button>
                        <span id="weekLabel" class="week-label"></span>
                        <button type="button" id="nextWeekBtn" title="Наступний період">›</button>
                        <button type="button" id="todayWeekBtn" title="Вчора, сьогодні і найближчі дні">Сьогодні</button>
                    </div>
                    <div id="deptFilter" class="dept-filter"></div>
                </div>
                <div class="schedule-toolbar">
                    <button type="button" id="addStaffBtn" class="btn-page-primary staff-schedule-add-staff-btn" style="display:none">+ Додати співробітника</button>
                    <button type="button" id="copyWeekBtn" class="btn-page-toolbar" style="display:none" title="Скопіювати цей тиждень на наступний">Копія тижня</button>
                    <button type="button" id="fillWeekBtn" class="btn-page-toolbar" style="display:none" title="Масове заповнення тижня">Заповнити тиждень</button>
                    <button type="button" id="toggleHoursBtn" class="btn-page-toolbar" title="Показати/сховати години">Години</button>
                    <button type="button" id="toggleLoadViewBtn" class="btn-page-toolbar" title="Навантаження по дням">Навантаження</button>
                    <button type="button" id="toggleLinkViewBtn" class="btn-page-toolbar" title="Зв'язки з акаунтами CRM">Акаунти</button>
                    <button type="button" id="bulkCreateBtn" class="btn-page-toolbar" style="display:none" title="Створити акаунти всім без акаунту">Масове створення</button>
                    <button type="button" id="importExcelBtn" class="btn-page-toolbar" style="display:none" title="Імпорт з Excel">Excel</button>
                    <button type="button" id="exportExcelBtn" class="btn-page-toolbar" title="Експорт графіку в CSV">Експорт</button>
                    <button type="button" id="printBtn" class="btn-page-toolbar" title="Друк графіку">Друк</button>
                    <input type="file" id="excelImportInput" accept=".xlsx,.xls">
                </div>
            </div>

            <div id="scheduleSummary" class="schedule-summary"></div>

            <div id="loadViewWrapper" class="schedule-wrapper" style="display:none">
                <table class="schedule-table load-table">
                    <thead id="loadViewHead"></thead>
                    <tbody id="loadViewBody"></tbody>
                </table>
            </div>

            <div id="scheduleWrapper" class="schedule-wrapper">
                <table class="schedule-table">
                    <thead id="scheduleHead"></thead>
                    <tbody id="scheduleBody"></tbody>
                </table>
            </div>

            <section class="schedule-secondary-diagnostics" aria-label="Schedule diagnostics">
                <div id="scheduleAttendanceSummary" class="schedule-attendance-summary" aria-live="polite"></div>
                <div id="scheduleHealthPanel" class="schedule-health-panel" aria-live="polite" hidden></div>
                <div id="scheduleForecastPanel" class="schedule-forecast-panel" aria-live="polite" hidden></div>
                <div id="managerAccountabilityPanel" class="manager-accountability-panel" aria-live="polite" hidden></div>
            </section>`;
    }

    function scheduleModalTemplate() {
        return `
            <div id="schModalOverlay" class="sch-modal-overlay" role="dialog" aria-modal="true" aria-label="Редагувати зміну">
                <div class="sch-modal sch-modal--schedule">
                    <h3 id="schModalTitle">Редагувати зміну</h3>
                    <div class="sch-modal-scroll">
                        <div id="schReadOnlyHint" class="sch-readonly-hint" hidden>Режим перегляду: можна дивитись технічну історію, редагування доступне HR/керівникам.</div>
                        <div id="schShiftPreferencePanel" class="sch-shift-preferences" hidden></div>
                        <div class="form-group">
                            <label>Статус</label>
                            <select id="schStatus">
                                <option value="working">Робочий день</option>
                                <option value="remote">Віддалено</option>
                                <option value="dayoff">Вихідний</option>
                                <option value="vacation">Відпустка</option>
                                <option value="sick">Лікарняний</option>
                            </select>
                        </div>
                        <div id="schProfessionGroup" class="form-group">
                            <label>Професія у зміні</label>
                            <select id="schProfession"></select>
                            <div class="form-hint">Доступні тільки професії з картки співробітника.</div>
                        </div>
                        <div id="schTimeFields">
                            <div class="form-group">
                                <label>Початок зміни</label>
                                <input type="time" id="schStart" value="10:00">
                            </div>
                            <div class="form-group">
                                <label>Кінець зміни</label>
                                <input type="time" id="schEnd" value="20:00">
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Примітка</label>
                            <input type="text" id="schNote" aria-label="Необов'язково" placeholder="Необов'язково">
                        </div>
                        <div id="schReplacementDetails" class="sch-replacement-details" hidden></div>
                        <div class="modal-actions sch-replacement-actions">
                            <button type="button" id="schReplaceBtn" class="btn-page-secondary sch-replacement-action" hidden>Виставити заміну</button>
                            <button type="button" id="schClearReplacementBtn" class="btn-page-secondary sch-replacement-action sch-clear-replacement-btn" hidden>Скасувати заміну</button>
                        </div>
                        <div class="sch-history-panel">
                            <div class="sch-history-head">
                                <strong>Історія клітинки</strong>
                                <button type="button" id="schHistoryRefreshBtn" class="sch-history-refresh">Оновити</button>
                            </div>
                            <div id="schHistoryList" class="sch-history-list">
                                <div class="sch-history-empty">Історія завантажиться після відкриття клітинки</div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-actions sch-primary-actions">
                        <button type="button" id="schSaveBtn" class="btn-page-primary">Зберегти</button>
                        <button type="button" id="schCancelBtn" class="btn-page-secondary">Скасувати</button>
                    </div>
                </div>
            </div>

            <div id="fillWeekOverlay" class="sch-modal-overlay" role="dialog" aria-modal="true" aria-label="Заповнити тиждень">
                <div class="sch-modal">
                    <h3>Заповнити тиждень</h3>
                    <div class="form-group">
                        <label>Працівник</label>
                        <select id="fillStaffSelect"></select>
                    </div>
                    <div class="form-group">
                        <label>Дні тижня</label>
                        <div id="fillDaysRow">
                            <label><input type="checkbox" value="1" checked> Пн</label>
                            <label><input type="checkbox" value="2" checked> Вт</label>
                            <label><input type="checkbox" value="3" checked> Ср</label>
                            <label><input type="checkbox" value="4" checked> Чт</label>
                            <label><input type="checkbox" value="5" checked> Пт</label>
                            <label><input type="checkbox" value="6"> Сб</label>
                            <label><input type="checkbox" value="0"> Нд</label>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Статус</label>
                        <select id="fillStatus">
                            <option value="working">Робочий день</option>
                            <option value="remote">Віддалено</option>
                            <option value="dayoff">Вихідний</option>
                            <option value="vacation">Відпустка</option>
                            <option value="sick">Лікарняний</option>
                        </select>
                    </div>
                    <div id="fillTimeFields">
                        <div class="form-group">
                            <label>Початок зміни</label>
                            <input type="time" id="fillStart" value="10:00">
                        </div>
                        <div class="form-group">
                            <label>Кінець зміни</label>
                            <input type="time" id="fillEnd" value="20:00">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Примітка</label>
                        <input type="text" id="fillNote" aria-label="Необов'язково" placeholder="Необов'язково">
                    </div>
                    <div class="modal-actions">
                        <button type="button" id="fillSaveBtn" class="btn-page-primary">Заповнити</button>
                        <button type="button" id="fillCancelBtn" class="btn-page-secondary">Скасувати</button>
                    </div>
                </div>
            </div>

            <div id="linkModalOverlay" class="sch-modal-overlay">
                <div class="sch-modal">
                    <h3 id="linkModalTitle">Зв'язати акаунт</h3>
                    <p id="linkModalSubtitle"></p>
                    <div class="form-group">
                        <label>Пошук акаунту</label>
                        <input type="text" id="linkSearchInput" placeholder="Пошук по імені або логіну...">
                    </div>
                    <div id="linkUsersList"></div>
                    <div class="modal-actions">
                        <button type="button" id="linkConfirmBtn" class="btn-page-primary" disabled>Зв'язати</button>
                        <button type="button" id="linkCreateAccountBtn" class="btn-page-secondary">Створити акаунт</button>
                        <button type="button" id="linkCancelBtn" class="btn-page-secondary">Скасувати</button>
                    </div>
                </div>
            </div>

            <div id="bulkResultsOverlay" class="sch-modal-overlay">
                <div class="sch-modal">
                    <h3 id="bulkResultsTitle">Результати створення</h3>
                    <div id="bulkResultsBody"></div>
                    <div class="modal-actions">
                        <button type="button" id="bulkCopyBtn" class="btn-page-secondary">Копіювати</button>
                        <button type="button" id="bulkCsvBtn" class="btn-page-secondary hidden">CSV</button>
                        <button type="button" id="bulkPdfBtn" class="btn-page-secondary hidden">PDF</button>
                        <button type="button" id="bulkCloseBtn" class="btn-page-primary">Закрити</button>
                    </div>
                </div>
            </div>`;
    }

    function ensureScheduleModals() {
        if (document.getElementById('schModalOverlay')) return;
        const root = document.createElement('div');
        root.id = 'staffScheduleModalRoot';
        root.innerHTML = scheduleModalTemplate();
        document.body.appendChild(root);
    }

    function resolveHost(options = {}) {
        if (options.host instanceof Element) return options.host;
        if (typeof options.host === 'string') return document.querySelector(options.host);
        if (options.mode === 'hr') return document.getElementById('hrStaffScheduleShell');
        return document.querySelector('[data-staff-schedule-shell]');
    }

    function ensure(options = {}) {
        const host = resolveHost(options);
        if (!host) return null;
        if (host.dataset.staffScheduleReady !== 'true') {
            host.innerHTML = scheduleWorkspaceTemplate({
                includePulseNav: options.includePulseNav !== false
            });
            host.dataset.staffScheduleReady = 'true';
            host.dataset.staffScheduleMode = options.mode || host.dataset.staffScheduleShell || 'standalone';
        }
        ensureScheduleModals();
        return host;
    }

    window.StaffScheduleShell = {
        ensure,
        scheduleWorkspaceTemplate,
        scheduleModalTemplate
    };
})();
