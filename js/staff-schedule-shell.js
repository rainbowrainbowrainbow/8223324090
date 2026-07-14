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
                </div>
            </section>

            <div class="workspace-command-bar staff-schedule-command-bar" aria-label="Керування періодом і діями графіка">
                <div class="schedule-controls">
                    <div class="week-nav">
                        <button type="button" id="prevWeekBtn" title="Попередній період" aria-label="Показати попередній період">‹</button>
                        <span id="weekLabel" class="week-label"></span>
                        <button type="button" id="nextWeekBtn" title="Наступний період" aria-label="Показати наступний період">›</button>
                        <button type="button" id="todayWeekBtn" title="Вчора, сьогодні і найближчі дні">Сьогодні</button>
                    </div>
                    <div class="staff-schedule-range-row" aria-label="Вибір періоду графіка">
                        <label class="staff-schedule-date-field">
                            <span>Від</span>
                            <input type="date" id="scheduleDateFrom" class="staff-schedule-date-input">
                        </label>
                        <label class="staff-schedule-date-field">
                            <span>До</span>
                            <input type="date" id="scheduleDateTo" class="staff-schedule-date-input">
                        </label>
                        <button type="button" id="applyScheduleRangeBtn" class="staff-schedule-range-apply">Застосувати</button>
                        <div class="staff-schedule-range-presets" aria-label="Швидкі періоди графіка">
                            <button type="button" class="staff-schedule-range-preset" data-schedule-range-preset="first-half" title="Показати 1-15 число місяця" aria-label="Показати 1-15 число місяця">1-15</button>
                            <button type="button" class="staff-schedule-range-preset" data-schedule-range-preset="second-half" title="Показати 16-31 число місяця" aria-label="Показати 16-31 число місяця">16-31</button>
                            <button type="button" class="staff-schedule-range-preset" data-schedule-range-preset="month" title="Показати весь місяць" aria-label="Показати весь місяць">Весь місяць</button>
                        </div>
                    </div>
                    <div class="staff-schedule-header-actions" aria-label="Дії з графіком">
                        <button type="button" id="exportExcelBtn" class="btn-page-toolbar staff-schedule-action-button" title="Експорт графіку в Excel" disabled aria-disabled="true">Експорт</button>
                        <button type="button" id="printBtn" class="btn-page-toolbar staff-schedule-action-button" title="Друк Excel-таблиці графіку" disabled aria-disabled="true">Друк</button>
                    </div>
                    <div class="staff-schedule-search-row" role="search" aria-label="Пошук співробітників у графіку">
                        <input type="search" id="scheduleStaffSearch" class="staff-schedule-search" aria-label="Пошук співробітників у графіку" placeholder="Пошук: ПІБ, професія, відділ, статус..." autocomplete="off">
                        <div id="scheduleStaffFilterInfo" class="staff-schedule-filter-info" aria-live="polite"></div>
                    </div>
                    <div id="deptFilter" class="dept-filter" role="group" aria-label="Фільтр працівників за професійною секцією"></div>
                </div>
            </div>

            <section id="scheduleDataRegion" class="staff-schedule-data-region" data-schedule-state="idle" data-has-committed-range="false" aria-label="Дані графіка роботи" aria-busy="false">
                <div id="scheduleSummary" class="schedule-summary"></div>

                <div id="scheduleRangeState" class="staff-schedule-range-state" data-state="idle" role="status" aria-live="polite" aria-atomic="true" hidden>
                    <span class="staff-schedule-range-state-indicator" aria-hidden="true"></span>
                    <div class="staff-schedule-range-state-copy">
                        <strong id="scheduleRangeStateTitle"></strong>
                        <span id="scheduleRangeStateMessage"></span>
                    </div>
                    <button type="button" id="scheduleRangeRetryBtn" class="staff-schedule-range-retry" hidden>Повторити</button>
                </div>

                <div id="loadViewWrapper" class="schedule-wrapper" style="display:none">
                    <table class="schedule-table load-table">
                        <caption class="staff-schedule-table-caption">Навантаження співробітників за вибраний період</caption>
                        <thead id="loadViewHead"></thead>
                        <tbody id="loadViewBody"></tbody>
                    </table>
                </div>

                <div id="scheduleWrapper" class="schedule-wrapper">
                    <table class="schedule-table">
                        <caption class="staff-schedule-table-caption">Графік роботи співробітників за вибраний період</caption>
                        <thead id="scheduleHead"></thead>
                        <tbody id="scheduleBody"></tbody>
                    </table>
                </div>

                <section class="schedule-secondary-diagnostics" aria-label="Schedule diagnostics">
                    <div id="scheduleAttendanceSummary" class="schedule-attendance-summary" aria-live="polite"></div>
                    <div id="scheduleHealthPanel" class="schedule-health-panel" aria-live="polite" hidden></div>
                    <div id="scheduleForecastPanel" class="schedule-forecast-panel" aria-live="polite" hidden></div>
                    <div id="managerAccountabilityPanel" class="manager-accountability-panel" aria-live="polite" hidden></div>
                </section>
            </section>`;
    }

    function scheduleModalTemplate() {
        return `
            <div id="schModalOverlay" class="sch-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="schModalTitle" aria-busy="false">
                <div class="sch-modal sch-modal--schedule">
                    <h3 id="schModalTitle">План дня</h3>
                    <div class="sch-modal-scroll">
                        <div id="schReadOnlyHint" class="sch-readonly-hint" hidden>Режим перегляду: можна дивитись технічну історію, редагування доступне HR/керівникам.</div>
                        <div class="form-group">
                            <label for="schStatus">Статус дня</label>
                            <select id="schStatus">
                                <option value="working">Робочий день</option>
                                <option value="remote">Віддалено</option>
                                <option value="dayoff">Вихідний</option>
                                <option value="vacation">Відпустка</option>
                                <option value="sick">Лікарняний</option>
                            </select>
                        </div>
                        <div id="schNonWorkingWarning" class="sch-nonworking-warning" hidden>
                            Цей статус видалить усі робочі часові блоки дня.
                        </div>
                        <section id="schDayPlanEditor" class="sch-day-plan-editor" aria-labelledby="schDayPlanTitle">
                            <div class="sch-day-plan-head">
                                <div>
                                    <strong id="schDayPlanTitle">Часові блоки</strong>
                                    <span>Основна й додаткові ролі беруться лише з HR-картки.</span>
                                </div>
                                <button type="button" id="schAddSegmentBtn" class="btn-page-secondary sch-add-segment-btn">+ Додати часовий блок</button>
                            </div>
                            <div id="schSegmentsList" class="sch-segments-list" aria-live="polite"></div>
                            <div id="schShiftPreferencePanel" class="sch-shift-preferences" hidden></div>
                            <div class="form-group sch-primary-profession-group">
                                <label for="schPrimaryProfession">Основна роль дня</label>
                                <select id="schPrimaryProfession"></select>
                                <div class="form-hint">Використовується старими звітами; має бути основною роллю одного з блоків.</div>
                            </div>
                            <div id="schPlanSummary" class="sch-plan-summary" role="status" aria-live="polite"></div>
                        </section>
                        <div class="form-group">
                            <label for="schNote">Примітка дня</label>
                            <input type="text" id="schNote" placeholder="Необов'язково">
                        </div>
                        <div id="schReplacementDetails" class="sch-replacement-details" hidden></div>
                        <div class="modal-actions sch-replacement-actions">
                            <button type="button" id="schReplaceBtn" class="btn-page-secondary sch-replacement-action" hidden>Виставити заміну</button>
                            <button type="button" id="schClearReplacementBtn" class="btn-page-secondary sch-replacement-action sch-clear-replacement-btn" hidden>Скасувати заміну</button>
                        </div>
                        <div class="sch-history-panel" role="region" aria-labelledby="schHistoryTitle">
                            <div class="sch-history-head">
                                <strong id="schHistoryTitle">Історія клітинки</strong>
                                <button type="button" id="schHistoryRefreshBtn" class="sch-history-refresh">Оновити</button>
                            </div>
                            <div id="schHistoryList" class="sch-history-list" aria-live="polite" aria-busy="false">
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
                <div class="sch-modal sch-modal--fill-week">
                    <h3 id="fillWeekTitle">Заповнити тиждень</h3>
                    <p id="fillWeekPeriodHint" class="fill-period-hint"></p>
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
                    <div id="fillNonWorkingWarning" class="sch-nonworking-warning" hidden>
                        Неробочий статус очистить робочий план на вибраних датах.
                    </div>
                    <section id="fillDayPlanEditor" class="sch-day-plan-editor" aria-labelledby="fillDayPlanTitle">
                        <div class="sch-day-plan-head">
                            <div>
                                <strong id="fillDayPlanTitle">Шаблон часових блоків</strong>
                                <span>Повний шаблон застосовується до кожної вибраної дати.</span>
                            </div>
                            <button type="button" id="fillAddSegmentBtn" class="btn-page-secondary sch-add-segment-btn">+ Додати часовий блок</button>
                        </div>
                        <div id="fillSegmentsList" class="sch-segments-list" aria-live="polite"></div>
                        <div class="form-group sch-primary-profession-group">
                            <label for="fillPrimaryProfession">Основна роль дня</label>
                            <select id="fillPrimaryProfession"></select>
                        </div>
                        <div id="fillPlanSummary" class="sch-plan-summary" role="status" aria-live="polite"></div>
                    </section>
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
