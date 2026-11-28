(function (global) {
    'use strict';

    const positionAttrs = ['data-cabinet-my-day-view-mode', 'data-cabinet-bucket-more',
        'data-cabinet-task-priority-select', 'data-cabinet-task-action', 'data-cabinet-completion-toggle',
        'data-cabinet-completion-all', 'data-cabinet-completion-tab', 'data-cabinet-refresh'];
    const dialogDateFormat = new Intl.DateTimeFormat('uk-UA', { dateStyle: 'long', timeZone: 'UTC' });

    function taskRole(task) {
        if (!Array.isArray(task.viewerRoles)) return 'executor';
        const roles = task.viewerRoles;
        if (roles.includes('executor')) return 'executor';
        if (roles.includes('author')) return 'author';
        return roles.includes('participant') ? 'participant' : 'viewer';
    }

    function roleLabel(role) {
        return { executor: 'Виконую', author: 'На контролі', participant: 'Спостерігаю', viewer: 'Перегляд' }[role] || '';
    }

    const sessionDraftPrefix = 'crm:my-day:draft:';
    const sessionDraftTtl = 2 * 60 * 60 * 1000;
    function sessionDraftKey(scope, subject) {
        return scope?.actor && scope?.business
            ? sessionDraftPrefix + JSON.stringify([scope.actor, scope.business, subject]) : null;
    }
    function writeSessionDraft(key, draft) {
        if (!key) return false;
        try {
            if (draft) sessionStorage.setItem(key, JSON.stringify({ ...draft, savedAt: Date.now() }));
            else sessionStorage.removeItem(key);
            return true;
        } catch { return false; }
    }
    function readSessionDraft(key) {
        if (!key) return null;
        try {
            const draft = JSON.parse(sessionStorage.getItem(key) || 'null');
            if (draft && Number.isFinite(draft.savedAt) && draft.savedAt <= Date.now()
                && Date.now() - draft.savedAt < sessionDraftTtl) return draft;
        } catch {}
        writeSessionDraft(key, null);
        return null;
    }
    function clearSessionDrafts() {
        try {
            for (let i = sessionStorage.length - 1; i >= 0; --i) {
                const key = sessionStorage.key(i);
                if (key?.startsWith(sessionDraftPrefix)) sessionStorage.removeItem(key);
            }
        } catch {}
    }

    function bindTaskHistory(details, load, signal) {
        if (!details || !load) return;
        const log = details.querySelector('[data-task-history-content]');
        async function refresh() {
            if (log.dataset.state === 'loaded' || log.dataset.state === 'loading') return;
            log.dataset.state = 'loading';
            log.textContent = 'Завантаження історії…';
            try {
                const result = await load(signal);
                const history = Array.isArray(result?.history) ? result.history : [];
                log.dataset.state = 'loaded';
                if (global.ActionHistoryView) {
                    log.innerHTML = global.ActionHistoryView.renderList(history, { kind: 'task', emptyMessage: 'Історія поки порожня.' });
                } else if (history.length) {
                    const list = document.createElement('ul');
                    history.forEach(event => {
                        const date = event.createdAt && new Date(event.createdAt);
                        const when = date && !Number.isNaN(date.valueOf())
                            ? date.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' }) : '';
                        const item = document.createElement('li');
                        item.textContent = [event.summary, event.actor?.name, when].filter(Boolean).join(' · ');
                        list.append(item);
                    });
                    log.replaceChildren(list);
                } else log.textContent = 'Історія поки порожня.';
            } catch (error) {
                if (signal.aborted) return;
                log.dataset.state = 'error';
                log.textContent = 'Не вдалося завантажити історію. ';
                const retry = document.createElement('button');
                retry.type = 'button';
                retry.textContent = 'Повторити';
                retry.addEventListener('click', refresh);
                log.append(retry);
            }
        }
        details.addEventListener('toggle', () => { if (details.open) void refresh(); });
    }

    function isConfirmedDeposit(projection) {
        const deposit = projection?.deposit;
        const status = projection?.status || deposit?.status;
        return status !== 'cancelled' && (['accountant_verified', 'corrected'].includes(status)
            || (projection?.accountingStatus || deposit?.accountingStatus) === 'Підтверджено');
    }

    function bindDetailAction(root, { kind, task, depositId, api, signal, labels, dirty, back, submit }) {
        const escape = global.escapeHtml;
        const headings = { review: 'Оцінити виконання', people: 'Змінити співвиконавців', deposit: 'Підтвердити завдаток',
            observers: 'Спостерігачі і матеріали', advanced: 'Розширені параметри',
            schedule: 'Запланувати точний час', reassign: 'Змінити відповідального', status: 'Змінити стан' };
        const buttons = `<div class="park-task-dialog-buttons">
            <button type="submit" class="park-dialog-primary">${kind === 'deposit' ? headings.deposit : 'Зберегти'}</button>
            <button type="button" data-detail-back>Назад до перегляду</button></div>`;
        const heading = `<h3>${headings[kind]}</h3>`;
        function bindForm(apply, { requireChange = false, readOnly = false, trackFields = true } = {}) {
            const form = root.querySelector('form');
            const saveButton = form.querySelector('[type="submit"]');
            const initial = JSON.stringify([...new FormData(form)]);
            function syncForm() {
                const changed = initial !== JSON.stringify([...new FormData(form)]);
                const disabled = readOnly || (requireChange && !changed);
                saveButton.disabled = disabled;
                saveButton.toggleAttribute('data-detail-disabled', disabled);
                dirty(changed);
            }
            if (requireChange || readOnly) syncForm();
            if (trackFields) form.addEventListener('input', syncForm);
            form.addEventListener('submit', event => {
                event.preventDefault();
                if (saveButton.disabled) return;
                const values = Object.fromEntries(new FormData(form));
                submit((previous, operationId) => apply(values, operationId));
            });
            form.querySelector('[data-detail-back]').addEventListener('click', back);
            form.querySelector('input, [data-detail-back]').focus();
            return form;
        }
        const shared = global.TaskUiShared;
        function options(entries, value) {
            const values = new Map(entries);
            if (value && !values.has(value)) values.set(value, value);
            return [...values].map(([id, label]) => `<option value="${escape(id)}"${String(id) === String(value) ? ' selected' : ''}>${escape(label)}</option>`).join('');
        }
        function datetime(value, timeZone) {
            const date = value && new Date(value);
            if (!date || Number.isNaN(date.valueOf())) return '';
            return new Intl.DateTimeFormat('sv-SE', {
                timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
            }).format(date).replace(' ', 'T');
        }
        if (kind === 'status') {
            root.innerHTML = `<form>${heading}
                <label for="my-day-execution-status">Стан</label>
                <select id="my-day-execution-status" name="status">${options([
                    ['todo', 'До виконання'], ['in_progress', 'У роботі']
                ], task.status)}</select>${buttons}</form>`;
            bindForm(({ status }) => api.status(status));
            return;
        }
        if (kind === 'advanced') {
            const value = {
                category: task.category || 'admin', subcategory: task.subcategory || '',
                task_mode: shared.taskMode(task), task_kind: shared.taskKind(task), visibility: shared.taskVisibility(task),
                workflow_state: shared.taskWorkflow(task), deadline: datetime(task.deadline), remind_at: datetime(task.remindAt ?? task.remind_at),
                pack_status: task.packStatus ?? task.pack_status ?? '', owner_role: task.ownerRole ?? task.owner_role ?? '',
                sla_minutes: task.slaMinutes ?? task.sla_minutes ?? ''
            };
            const field = (name, label, body) => `<label for="my-day-advanced-${name}">${label}</label>${body}`;
            const select = (name, label, entries) => field(name, label,
                `<select name="${name}" id="my-day-advanced-${name}">${options(entries, value[name])}</select>`);
            const input = (name, label, attrs = '') => field(name, label,
                `<input name="${name}" id="my-day-advanced-${name}" value="${escape(value[name])}" ${attrs}>`);
            const subcategories = category => [['', 'Без підкатегорії'], ...(shared.SUBCATEGORY_RAILS[category] || [])
                .filter(item => item.id !== 'all').map(item => [item.id, item.label])];
            root.innerHTML = `<form>${heading}
                ${select('category', 'Категорія', api.categories)}
                ${select('subcategory', 'Підкатегорія', subcategories(value.category))}
                ${select('task_mode', 'Режим', Object.entries({ work: 'Робоча', personal: 'Особиста', private: 'Приватна', system: 'Системна' }))}
                ${select('task_kind', 'Тип задачі', Object.entries(shared.TASK_KIND_LABELS))}
                ${select('visibility', 'Видимість', Object.entries({ team: 'Командна', me_only: 'Тільки мені', private: 'Приватна' }))}
                ${select('workflow_state', 'Стан процесу', Object.entries(shared.WORKFLOW_LABELS).filter(([key]) => key !== 'done'))}
                ${task.drawer.actions.reschedule ? input('deadline', 'Дедлайн (місцевий час)', 'type="datetime-local"') : ''}
                ${input('remind_at', 'Нагадування (місцевий час)', 'type="datetime-local"')}
                ${select('pack_status', 'Стан пакета', [['', 'Без стану'], ...Object.entries(shared.PACK_STATUS_LABELS)])}
                ${input('owner_role', 'Роль відповідального')}
                ${input('sla_minutes', 'SLA, хв', 'type="number" min="1" step="1"')}
                ${buttons}</form>`;
            const form = bindForm(fields => {
                const patch = Object.fromEntries(Object.entries(fields).filter(([key, next]) => String(value[key]) !== next)
                    .map(([key, next]) => [key, next && ['deadline', 'remind_at'].includes(key) ? new Date(next).toISOString() : next.trim() || null]));
                if (Object.keys(patch).length) return api.advanced(patch, task.version);
            });
            form.elements.category.addEventListener('change', () => {
                form.elements.subcategory.innerHTML = options(subcategories(form.elements.category.value), '');
            });
            return;
        }
        if (kind === 'schedule') {
            const start = datetime(shared.taskScheduledStart(task), 'Europe/Kyiv');
            const day = start.slice(0, 10) || shared.taskDueDate(task) || api.today();
            const slots = [['manual', 'Точний час'], ...shared.TASK_SCHEDULE_SLOTS.map(slot => [slot.key, slot.label])];
            root.innerHTML = `<form>${heading}
                <label for="my-day-slot">Тип часу</label><select id="my-day-slot" name="slot">${options(slots, shared.taskScheduleSlot(task) || 'manual')}</select>
                <label for="my-day-slot-date">Дата</label><input id="my-day-slot-date" name="date" type="date" required value="${escape(day)}">
                <label for="my-day-slot-start">Точний час (Київ)</label><input id="my-day-slot-start" name="start" type="time" value="${escape(start.slice(11))}">
                <label for="my-day-slot-duration">Тривалість, хв</label><input id="my-day-slot-duration" name="duration" type="number" min="5" max="480" required value="${escape(task.schedule?.durationMinutes || task.effortMinutes || 30)}">
                ${buttons}</form>`;
            const form = bindForm(({ slot, date, start, duration }, id) => api.schedule({
                date, durationMinutes: Number(duration), ...(slot === 'manual' ? { scheduledStartAt: `${date}T${start}` } : { slot })
            }, id));
            const updateTime = () => {
                const manual = form.elements.slot.value === 'manual';
                form.elements.start.hidden = !manual;
                form.elements.start.labels[0].hidden = !manual;
                form.elements.start.required = manual;
            };
            form.elements.slot.addEventListener('change', updateTime);
            updateTime();
            return;
        }
        if (kind === 'review') {
            root.innerHTML = `<form>${heading}
                <label for="my-day-review-score">Оцінка (1–10)</label>
                <input id="my-day-review-score" name="score" type="number" min="1" max="10" required value="${escape(task.review_score ?? 10)}">
                <label for="my-day-review-comment">Коментар</label>
                <textarea id="my-day-review-comment" name="comment" rows="3">${escape(task.review_comment || '')}</textarea>
                ${buttons}</form>`;
            bindForm(values => api.review({ score: Number(values.score), comment: values.comment.trim() || null }));
            return;
        }
        if (['people', 'observers', 'reassign'].includes(kind)) {
            const observerMode = kind === 'observers';
            const observers = task.observers || [];
            const previousUserIds = (observerMode ? observers.map(person => person.userId || person.user_id)
                : kind === 'people' ? task.co_assignee_user_ids || [] : []).map(Number);
            const observerLabels = new Map(observers.map(person => [Number(person.userId || person.user_id), shared.taskPersonLabel(person)]));
            const selected = new Map(previousUserIds.map(id => [id, (observerMode ? observerLabels : labels).get(id) || `Користувач №${id}`]));
            const ownerId = Number(global.TaskUiShared.taskOwnerUserId(task));
            root.innerHTML = `<form>${heading}
                ${observerMode ? '<p>Спостерігачі бачать задачу й матеріали, але не можуть змінювати її стан.</p>' : ''}
                <div data-detail-selected aria-label="Обрані люди"></div>
                <label for="my-day-co-search">Знайти людину</label><input id="my-day-co-search" type="search">
                <button type="button" data-detail-search>Знайти</button>
                <div data-detail-people></div><p data-detail-status role="status"></p>
                <button type="button" data-detail-more hidden>Показати ще</button>${buttons}</form>`;
            const form = bindForm(() => {
                const userIds = [...selected.keys()];
                if (kind === 'reassign') return userIds.length ? api.reassign(userIds[0], root.closest('dialog')) : undefined;
                return observerMode ? api.observers({ observerUserIds: userIds }) : api.people({ userIds, previousUserIds });
            }, { trackFields: false });
            const search = form.querySelector('input');
            const result = form.querySelector('[data-detail-people]');
            const status = form.querySelector('[data-detail-status]');
            const more = form.querySelector('[data-detail-more]');
            let candidates = [], nextAfter = null, request = 0;
            function paint() {
                const picked = form.querySelector('[data-detail-selected]');
                picked.innerHTML = [...selected].map(([id, label]) =>
                    `<button type="button" data-person-remove="${id}" aria-label="Зняти: ${escape(label)}">${escape(label)} ×</button>`).join('');
                result.innerHTML = candidates.filter(person => !selected.has(person.id)).map(person =>
                    `<button type="button" data-person-add="${person.id}">${escape(person.label)}</button>`).join('');
            }
            form.addEventListener('click', event => {
                const add = Number(event.target.closest('[data-person-add]')?.dataset.personAdd);
                const remove = Number(event.target.closest('[data-person-remove]')?.dataset.personRemove);
                if (remove) selected.delete(remove);
                else if (add) {
                    if (kind === 'reassign') selected.clear();
                    selected.set(add, candidates.find(person => person.id === add).label);
                }
                else return;
                dirty(selected.size !== previousUserIds.length || previousUserIds.some(id => !selected.has(id)));
                paint();
                (form.querySelector(add ? `[data-person-remove="${add}"]` : `[data-person-add="${remove}"]`) || search).focus();
            });
            async function find(append = false) {
                const id = ++request;
                more.hidden = true;
                status.textContent = 'Завантаження…';
                try {
                    const data = await api.findPeople(search.value.trim(), append ? nextAfter : null, signal);
                    if (id !== request || signal.aborted || !form.isConnected) return;
                    if (!Array.isArray(data?.users)) throw new Error('Owner directory unavailable');
                    const names = new Map(data.users.map(person => [Number(person.id), global.TaskUiShared.taskPersonLabel(person)]));
                    const personLabels = global.TaskUiShared.taskParticipantLabels(names);
                    const people = [...personLabels].filter(([id]) => id && id !== ownerId).map(([id, label]) => ({ id, label }));
                    candidates = append ? [...candidates, ...people] : people;
                    nextAfter = data?.nextAfter || null;
                    status.textContent = candidates.length ? '' : 'Нікого не знайдено.';
                    more.hidden = !nextAfter;
                    paint();
                } catch {
                    if (id === request && form.isConnected && !signal.aborted) status.textContent = 'Не вдалося завантажити список. Повторіть пошук.';
                }
            }
            search.addEventListener('keydown', event => {
                if (event.key === 'Enter') { event.preventDefault(); void find(); }
            });
            form.querySelector('[data-detail-search]').addEventListener('click', () => { void find(); });
            more.addEventListener('click', () => { void find(true); });
            paint();
            void find();
            return;
        }
        root.innerHTML = `${heading}<p role="status">Завантаження завдатку…</p>
            <button type="button" data-detail-back>Назад до перегляду</button>`;
        const backButton = root.querySelector('[data-detail-back]');
        backButton.addEventListener('click', back);
        backButton.focus();
        const status = root.querySelector('[role="status"]');
        async function loadDeposit() {
            try {
                const projection = await api.loadDeposit(depositId, signal);
                if (!status.isConnected || signal.aborted) return;
                if (!api.canViewDeposit()) { status.textContent = 'Фінансові дані недоступні.'; return; }
                const deposit = projection.deposit || {};
                const display = projection.display || {};
                const confirmation = deposit.sourcePayload?.accountantConfirmation || deposit.meta?.accountantConfirmation || {};
                const paymentMethod = display.paymentMethod || deposit.paymentMethod;
                const verified = isConfirmedDeposit(projection);
                const date = value => /^\d{4}-\d{2}-\d{2}/.test(value || '') ? value.slice(0, 10) : '';
                if (!api.canConfirmDeposit()) {
                    status.textContent = [verified ? 'Завдаток підтверджено' : 'Завдаток очікує підтвердження',
                        display.clientName || deposit.clientNameSnapshot, display.amount ?? deposit.amount].filter(value => value != null && value !== '').join(' · ');
                    return;
                }
                const input = (name, label, value, attrs = '') => `<label for="my-day-deposit-${name}">${label}</label>
                    <input id="my-day-deposit-${name}" name="${name}" value="${escape(value ?? '')}" required ${attrs}>`;
                root.innerHTML = `<form>${heading}
                    ${verified ? '<p role="status">Завдаток уже підтверджено.</p>' : ''}
                    ${projection.needsBookingLink ? '<p>Завдаток ще треба прив’язати до запису.</p>' : ''}
                    ${input('clientName', 'Прізвище та ім’я клієнта', display.clientName || deposit.clientNameSnapshot)}
                    ${input('receivedDate', 'Дата отримання', date(confirmation.receivedDate || deposit.verifiedAt) || api.today(), 'type="date"')}
                    ${input('eventDate', 'Дата святкування', date(display.eventDate || deposit.eventDate), 'type="date"')}
                    ${input('banquetNumber', 'Номер банкету', display.banquetNumber || deposit.banquetNumberSnapshot || projection.banquetGroupId || projection.bookingId)}
                    ${input('amount', 'Сума', display.amount ?? deposit.amount, 'type="number" min="1" step="1"')}
                    <label for="my-day-deposit-method">Спосіб внесення</label>
                    <select id="my-day-deposit-method" name="paymentMethod" required><option value="">Оберіть спосіб внесення</option>
                        <option value="cash"${paymentMethod === 'cash' ? ' selected' : ''}>Готівка</option>
                        <option value="card"${paymentMethod === 'card' ? ' selected' : ''}>Карта</option>
                    </select>${buttons}</form>`;
                bindForm(values => api.deposit(depositId, values), {
                    requireChange: verified,
                    readOnly: deposit.status === 'cancelled' || projection.status === 'cancelled'
                });
            } catch {
                if (!status.isConnected || signal.aborted) return;
                status.textContent = 'Не вдалося завантажити завдаток.';
                const retry = document.createElement('button');
                retry.type = 'button'; retry.textContent = 'Повторити завантаження';
                retry.addEventListener('click', () => { retry.remove(); void loadDeposit(); });
                status.after(retry);
            }
        }
        void loadDeposit();
    }

    function openTaskDialog({ taskId, load, loadHistory, selectDate, statusLabel, opener, onClose, mode, save, complete, cancel, reschedule, detailActions, draftScope, onReconciled }) {
        const draftKey = Number.isSafeInteger(taskId) ? sessionDraftKey(draftScope, taskId) : null;
        const dialog = document.createElement('dialog');
        dialog.className = 'park-task-dialog';
        dialog.dataset.myDayTask = taskId;
        dialog.dataset.myDayMode = mode || '';
        dialog.taskLocation = global.location.href;
        dialog.setAttribute('aria-labelledby', 'park-task-dialog-title');
        dialog.innerHTML = `<header class="park-task-dialog-head">
            <span class="park-task-dialog-status" aria-live="polite" hidden></span>
            <h2 id="park-task-dialog-title">Задача #${taskId}</h2>
            <form method="dialog"><button type="submit" aria-label="Закрити" autofocus><span aria-hidden="true">×</span></button></form>
        </header><p id="my-day-task-guard" class="park-task-dialog-guard" aria-live="polite" hidden>Є незбережені зміни. Збережіть їх або відкиньте.</p>
        <button type="button" class="park-task-dialog-discard" aria-describedby="my-day-task-guard" hidden disabled>Відкинути зміни та закрити</button>
        <div class="park-task-dialog-content"><p role="status">Завантаження задачі…</p></div>`;
        const controller = new AbortController();
        const title = dialog.querySelector('h2');
        const status = dialog.querySelector('.park-task-dialog-status');
        const content = dialog.querySelector('.park-task-dialog-content');
        const guard = dialog.querySelector('.park-task-dialog-guard');
        const discard = dialog.querySelector('.park-task-dialog-discard');
        const escape = global.escapeHtml;
        let task, busy = false, needsRefresh = false;
        let editorDraft = null, scheduleDraft = null, panel = mode === 'edit' ? 'edit' : 'view';
        let detailDirty = false;
        let editorConflict = null;
        let unknownOperation = null;
        let awaitingSessionChange = false;
        let checkedSessionDraft = false;
        const editorSnapshot = current => ({
            title: current.title || '', description: current.description || '',
            priority: global.TaskUiShared?.normalizeTaskPriority(current.priority) || 'normal'
        });
        const editorPatch = (baseline, values) => Object.fromEntries(Object.entries(values || {})
            .filter(([field, value]) => Object.hasOwn(baseline, field) && value !== baseline[field]));
        const editorSubmitBlocked = () => editorConflict && !editorConflict.current;
        function persistDraft() {
            return writeSessionDraft(draftKey, editorDraft || scheduleDraft ? {
                version: editorConflict?.version ?? task.version,
                fields: editorPatch(editorSnapshot(task), editorDraft),
                scheduleDate: scheduleDraft
            } : null);
        }
        function showEditorConflict() {
            showError(new Error('Задачу змінили після відкриття. Завантажте актуальну версію, щоб порівняти її з чернеткою.'), true);
            if (content.querySelector('[data-dialog-review-version]')) return;
            const review = document.createElement('button');
            review.type = 'button';
            review.dataset.dialogReviewVersion = '';
            review.textContent = 'Переглянути актуальну версію';
            review.addEventListener('click', () => { void run(null); });
            content.prepend(review);
            review.focus({ preventScroll: true });
        }
        const isDirty = () => editorDraft !== null || scheduleDraft !== null || detailDirty;
        function syncDraftState() {
            dialog.dataset.dirty = String(isDirty());
            // Progressive enhancement; cancel remains the Safari fallback.
            dialog.setAttribute('closedby', busy || isDirty() ? 'none' : 'closerequest');
            guard.textContent = busy ? 'Дочекайтеся завершення збереження.'
                : 'Є незбережені зміни. Збережіть їх або відкиньте.';
            guard.hidden = !busy && !isDirty();
            discard.hidden = busy || !isDirty();
            discard.disabled = busy || !isDirty();
        }
        function hideDiscard() { discard.hidden = true; discard.disabled = true; }
        const beforeUnload = event => {
            if (!isDirty() && !busy && !awaitingSessionChange) return;
            event.preventDefault(); event.returnValue = '';
        };
        global.addEventListener('beforeunload', beforeUnload);
        for (const event of ['workingRoleChanged', 'rolePreviewChanged']) {
            global.addEventListener(event, () => {
                if (panel !== 'detail' || !content.querySelector('[data-dialog-detail-action="deposit"]')) return;
                detailDirty = false;
                panel = 'view';
                render();
                syncDraftState();
            }, { signal: controller.signal });
        }
        function preventLoss(event) {
            if (!busy && !isDirty()) return;
            event.preventDefault();
            guard.textContent = busy ? 'Дочекайтеся завершення збереження.' : 'Є незбережені зміни. Збережіть їх або відкиньте.';
            guard.hidden = false;
            discard.hidden = busy;
            discard.disabled = busy;
            if (!busy) discard.focus();
        }
        dialog.addEventListener('cancel', event => {
            if (awaitingSessionChange) event.preventDefault();
            else preventLoss(event);
        });
        dialog.endForSessionChange = () => {
            controller.abort();
            global.removeEventListener('beforeunload', beforeUnload);
            dialog.dataset.keepTaskIntent = 'true';
            dialog.close();
        };
        dialog.offerSessionChange = proceed => {
            if (!draftKey || (!isDirty() && !busy)) return false;
            awaitingSessionChange = true;
            controller.abort();
            dialog.querySelector('.park-task-dialog-head form').hidden = true;
            status.hidden = true;
            title.textContent = 'Активний бізнес змінився';
            guard.hidden = true;
            hideDiscard();
            content.removeAttribute('aria-busy');
            content.replaceChildren();
            const status = document.createElement('p');
            status.setAttribute('role', 'status');
            status.textContent = 'Перейдіть до активного бізнесу. Чернетку можна залишити в цій вкладці для повернення до задачі.';
            content.append(status);
            function action(label, callback) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = label;
                button.addEventListener('click', callback);
                content.append(button);
                return button;
            }
            const finish = () => { dialog.endForSessionChange(); proceed(); };
            const discardDraft = action(isDirty() ? 'Відкинути чернетку та перейти' : 'Перейти та перевірити результат', () => {
                writeSessionDraft(draftKey, null);
                finish();
            });
            if (editorDraft || scheduleDraft) {
                action('Зберегти чернетку в цій вкладці та перейти', () => {
                    if (!persistDraft()) {
                        status.textContent = 'Чернетку не вдалося зберегти. Спробуйте ще раз або відкиньте її.';
                        return;
                    }
                    finish();
                }).focus();
            } else discardDraft.focus();
            return true;
        };
        dialog.querySelector('form').addEventListener('submit', preventLoss);
        discard.addEventListener('click', () => {
            if (busy) return;
            editorDraft = scheduleDraft = null;
            persistDraft();
            syncDraftState();
            dialog.close();
        });
        // History-driven replacement must honor the same dirty-form guard.
        dialog.canLeave = () => {
            if (!busy && !isDirty()) return true;
            preventLoss({ preventDefault() {} });
            return false;
        };
        dialog.addEventListener('close', () => {
            controller.abort();
            global.removeEventListener('beforeunload', beforeUnload);
            dialog.remove();
            onClose(dialog);
            if (!opener?.isConnected && !document.querySelector('dialog[open]')) {
                document.querySelector('[data-park-task-group="today"]')?.focus({ preventScroll: true });
            }
        }, { once: true });
        document.body.append(dialog);
        dialog.showModal();
        function errorText(error) {
            if (error.status === 400) return 'Некоректне посилання на задачу.';
            if (error.status === 401) return 'Потрібно увійти, щоб відкрити задачу.';
            if ([403, 404].includes(error.status)) return 'Задача недоступна або її видалено.';
            return 'Не вдалося завантажити або зберегти задачу. Перевірте з’єднання та спробуйте ще раз.';
        }
        function showError(error, mutation = false) {
            let alert = content.querySelector('[role="alert"]');
            if (!alert) { alert = document.createElement('p'); alert.setAttribute('role', 'alert'); content.prepend(alert); }
            alert.textContent = mutation && error.name !== 'TypeError' && error.message ? error.message : errorText(error);
        }
        function settleOperation(operation) {
            unknownOperation = null;
            if (operation.kind === 'editor') { editorDraft = null; editorConflict = null; panel = 'view'; }
            if (operation.kind === 'schedule') { scheduleDraft = null; panel = 'view'; }
            if (operation.kind === 'detail') { detailDirty = false; panel = 'view'; }
            if (operation.kind === 'editor' || operation.kind === 'schedule') persistDraft();
        }
        function showOperationRecovery(canRetry = false) {
            const operation = unknownOperation;
            const note = canRetry ? 'Задача ще має попередню версію. Можна повторити ту саму дію.'
                : 'З’єднання перервалося. Перевірте, чи збережено дію, перш ніж повторювати.';
            showError(new Error(note), true);
            content.querySelectorAll('[data-dialog-operation-recovery]').forEach(button => button.remove());
            const button = document.createElement('button');
            button.type = 'button'; button.dataset.dialogOperationRecovery = '';
            button.textContent = canRetry ? 'Повторити ту саму дію' : 'Перевірити результат';
            button.addEventListener('click', () => { void run(operation, !canRetry); });
            content.prepend(button);
            button.focus({ preventScroll: true });
        }
        function submitOperation(kind, apply, patch = null) {
            if (unknownOperation || awaitingSessionChange || busy || needsRefresh) return;
            const previous = task;
            const id = global.crypto.randomUUID();
            void run({ id, kind, version: Number(previous.version), patch, execute: () => apply(previous, id) });
        }
        function focusViewAction() {
            const action = content.querySelector('[data-dialog-view]:not([hidden]) [data-dialog-complete]')
                || content.querySelector('[data-dialog-view]:not([hidden]) [data-dialog-edit]')
                || content.querySelector('[data-dialog-view]:not([hidden]) .park-dialog-more > summary');
            (action || dialog.querySelector('.park-task-dialog-head button')).focus({ preventScroll: true });
        }
        async function run(operation, reconcile = false) {
            if (awaitingSessionChange || busy || (needsRefresh && operation) || (unknownOperation && unknownOperation !== operation)) return;
            const draft = operation?.kind || '';
            busy = true;
            syncDraftState();
            hideDiscard();
            content.setAttribute('aria-busy', 'true');
            content.querySelectorAll('button, input, textarea, select').forEach(control => { control.disabled = true; });
            try {
                if (reconcile) {
                    if (operation.kind === 'detail') {
                        // These APIs have no operation receipt. Reload without replaying the write.
                        await refresh();
                        if (!dialog.open || awaitingSessionChange) return;
                        settleOperation(operation);
                        render();
                        return;
                    }
                    await refresh();
                    if (awaitingSessionChange || !dialog.open) return;
                    const receipt = task.myDayOperation;
                    if ((operation.kind === 'cancel' && task.status === 'cancelled')
                        || (receipt?.id === operation.id && receipt.kind === operation.kind && receipt.version === operation.version)) {
                        settleOperation(operation);
                        render();
                        onReconciled?.(operation.kind);
                        focusViewAction();
                    } else if (Number(task.version) === operation.version) {
                        showOperationRecovery(true);
                    } else {
                        unknownOperation = null;
                        if (draft === 'editor') {
                            const current = editorSnapshot(task);
                            editorDraft = { ...current, ...operation.patch };
                            editorConflict = { patch: operation.patch, current };
                            render();
                        }
                        showError(new Error('Версія задачі змінилася. Перевірте поточні дані перед новою дією.'), true);
                    }
                    return;
                }
                if (operation) {
                    await operation.execute();
                    if (!dialog.open || awaitingSessionChange) return;
                    settleOperation(operation);
                    // Once the server accepted a mutation, recovery must reload, not repeat it.
                    needsRefresh = true;
                }
                await refresh();
                needsRefresh = false;
                focusViewAction();
            } catch (error) {
                if (dialog.open && !awaitingSessionChange) {
                    if (reconcile || (operation && !needsRefresh && (error.outcomeUnknown || error.name === 'TypeError'))) {
                        unknownOperation = operation;
                        showOperationRecovery();
                        return;
                    }
                    if (!needsRefresh && operation === unknownOperation) unknownOperation = null;
                    if (draft === 'editor' && error.status === 409 && !needsRefresh) {
                        editorConflict = { patch: editorPatch(editorSnapshot(task), editorDraft) };
                        showEditorConflict();
                    } else if (editorSubmitBlocked() && !needsRefresh) {
                        showEditorConflict();
                    } else showError(error, !needsRefresh);
                    if (needsRefresh) {
                        content.querySelector('[role="alert"]').textContent = 'Зміни збережено, але не вдалося оновити задачу. Повторіть завантаження.';
                        if (!content.querySelector('[data-dialog-reload]')) {
                            const retry = document.createElement('button');
                            retry.type = 'button'; retry.dataset.dialogReload = '';
                            retry.textContent = 'Повторити завантаження';
                            retry.addEventListener('click', () => { void run(null); });
                            content.prepend(retry);
                        }
                    }
                }
            }
            finally {
                busy = false;
                if (!awaitingSessionChange) syncDraftState();
                content.removeAttribute('aria-busy');
                content.querySelectorAll('button, input, textarea, select').forEach(control => {
                    if (awaitingSessionChange) return;
                    control.disabled = Boolean(unknownOperation && !control.hasAttribute('data-dialog-operation-recovery')
                        || needsRefresh && !control.hasAttribute('data-dialog-reload')
                        || control.hasAttribute('data-detail-disabled')
                        || editorSubmitBlocked() && control.matches('[data-dialog-editor] button[type=submit]'));
                });
            }
        }
        function render() {
            const due = selectDate(task);
            const executor = global.TaskUiShared?.taskOwnerLabel?.(task) || task.ownerLabel || task.owner_name || task.owner_username;
            const coAssignees = Array.isArray(task.co_assignees) ? task.co_assignees : [];
            const actor = Number(draftScope?.actor);
            const isAuthor = actor > 0 && actor === Number(task.createdByUserId ?? task.created_by_user_id);
            const isCoAssignee = actor > 0 && (task.co_assignee_user_ids || []).some(id => Number(id) === actor);
            const viewerLabel = isCoAssignee ? (isAuthor ? 'Постановник · Співвиконавець' : 'Співвиконавець') : roleLabel(taskRole(task));
            const ownerId = global.TaskUiShared?.taskOwnerUserId?.(task);
            const people = new Map(coAssignees.map(person => [Number(person.userId), actor === Number(person.userId) ? 'Я'
                : global.TaskUiShared?.taskPersonLabel?.(person) || person.name || person.username]));
            if (executor) people.set(ownerId, executor);
            const labels = global.TaskUiShared?.taskParticipantLabels?.(people) || people;
            const executorLabel = executor ? labels.get(ownerId) : '';
            const [executorInitial = ''] = executorLabel || '';
            const coAssigneeLabels = coAssignees.map(person => labels.get(Number(person.userId))).filter(Boolean);
            const actions = task.drawer?.actions || {};
            const depositRef = global.TaskUiShared?.taskBanquetDepositRef?.(task);
            const depositId = depositRef?.id;
            const extra = {
                review: actions.review && detailActions?.review ? 'Оцінити виконання' : null,
                people: actions.manageCoAssignees && detailActions?.people ? 'Змінити співвиконавців' : null,
                observers: actions.manageObservers && detailActions?.observers ? 'Спостерігачі і матеріали' : null,
                reassign: actions.reassign && detailActions?.reassign ? 'Змінити відповідального' : null,
                advanced: actions.edit && detailActions?.advanced ? 'Розширені параметри' : null,
                schedule: actions.reschedule && !['done', 'archived', 'cancelled'].includes(task.status) && detailActions?.schedule
                    ? 'Запланувати точний час' : null,
                status: actions.changeStatus && detailActions?.status ? 'Змінити стан' : null,
                deposit: depositId && detailActions?.canViewDeposit?.()
                    ? (detailActions.canConfirmDeposit() ? 'Підтвердити завдаток' : 'Переглянути завдаток') : null
            };
            const priorities = global.TaskUiShared?.TASK_PRIORITY_OPTIONS || [];
            const editorBase = editorSnapshot(task);
            const editorValue = editorDraft || editorBase;
            const editorLabels = { title: 'Назва', description: 'Опис', priority: 'Пріоритет' };
            title.textContent = task.title || `Задача #${taskId}`;
            status.textContent = statusLabel(task);
            status.classList.toggle('is-done', task.status === 'done');
            const description = typeof task.description === 'string' ? task.description.trim() : '';
            const source = task.drawer?.source;
            const dependencyTitles = (task.dependencies || []).map(item => item?.title).filter(Boolean);
            const expectedResult = task.expectedResult || task.expected_result || task.controlMeta?.expectedResult;
            const substitution = task.substitution;
            const substitutionState = { active: 'Погоджено', completed: 'Завершено' }[substitution?.state];
            const date = new Date(due ? `${due}T00:00:00Z` : NaN);
            const dateLabel = Number.isNaN(date.getTime()) ? due : dialogDateFormat.format(date);
            content.innerHTML = `<section data-dialog-view>
            ${description && description !== title.textContent.trim() ? `<p class="park-task-dialog-description">${escape(description)}</p>` : ''}
            <dl class="park-task-dialog-facts">
                <div><dt>${global.TaskUiShared?.taskDateLabel?.(task) || 'Дата'}</dt><dd>${due ? `${icon('calendar')}<time datetime="${escape(due)}">${escape(dateLabel)}</time>` : 'Без дати'}</dd></div>
                ${executor ? `<div><dt>Відповідальний</dt><dd><span class="park-task-dialog-avatar" aria-hidden="true">${escape(executorInitial.toLocaleUpperCase('uk-UA'))}</span><span>${escape(executorLabel)}</span></dd></div>` : ''}
                <div><dt>Моя роль</dt><dd>${escape(viewerLabel || 'Перегляд')}</dd></div>
                ${coAssigneeLabels.length ? `<div><dt>Співвиконавці</dt><dd>${escape(coAssigneeLabels.join(', '))}</dd></div>` : ''}
                ${task.review_score != null ? `<div><dt>Оцінка</dt><dd>${escape(task.review_score)} / 10</dd></div>` : ''}
            </dl>
            ${substitution?.id && substitutionState ? `<p data-task-substitution>Підміна №${escape(substitution.id)} · ${substitutionState}</p>` : ''}
            ${expectedResult ? `<p><strong>Очікуваний результат</strong> · ${escape(expectedResult)}</p>` : ''}
            ${dependencyTitles.length ? `<p><strong>Залежності</strong> · ${escape(dependencyTitles.join(', '))}</p>` : ''}
            ${(actions.readHistory && loadHistory) || source ? `<div class="park-task-dialog-context">
                ${actions.readHistory && loadHistory ? `<details data-task-dialog-history><summary>${icon('history')}Історія<span aria-hidden="true"></span></summary><div data-task-history-content aria-live="polite"></div></details>` : ''}
                ${source ? `<p class="park-task-dialog-source">${source.href ? `<a href="${escape(source.href)}">${escape(source.label)}</a>` : escape(source.label)}</p>` : ''}
            </div>` : ''}
            <div class="park-task-dialog-buttons park-task-dialog-footer">
                ${(actions.reschedule && reschedule) || (actions.cancel && cancel) || Object.values(extra).some(Boolean) ? `<details class="park-dialog-more"><summary><span aria-hidden="true"></span>Ще</summary><div>
                    ${actions.reschedule && reschedule ? '<button type="button" data-open-schedule>Перенести</button>' : ''}
                    ${Object.entries(extra).filter(([, label]) => label).map(([kind, label]) => `<button type="button" data-open-detail-action="${kind}">${label}</button>`).join('')}
                    ${actions.cancel && cancel ? '<button type="button" data-dialog-cancel-task>Скасувати задачу</button>' : ''}
                </div></details>` : ''}
                ${actions.edit && save ? `<button type="button" data-dialog-edit>${icon('edit')}Редагувати</button>` : ''}
                ${actions.complete && complete ? `<button type="button" class="park-dialog-primary" data-dialog-complete>${icon('done')}Виконати</button>` : ''}
            </div></section>
            ${actions.edit && save ? `<form data-dialog-editor hidden>
                <h3>Редагування задачі</h3>
                <label for="my-day-edit-title">Назва</label><input id="my-day-edit-title" name="title" required value="${escape(editorValue.title)}">
                <label for="my-day-edit-description">Опис</label><textarea id="my-day-edit-description" name="description" rows="4">${escape(editorValue.description)}</textarea>
                ${editorConflict?.current ? `<div role="status"><p>Перевірте актуальні значення перед збереженням чернетки.</p><ul>${Object.keys(editorConflict.patch).map(field => `<li>${editorLabels[field]}: ${escape(field === 'priority' ? priorities.find(item => item.value === editorConflict.current[field])?.label || editorConflict.current[field] : editorConflict.current[field] || '—')}</li>`).join('')}</ul></div>` : ''}
                <label for="my-day-edit-priority">Пріоритет</label><select id="my-day-edit-priority" name="priority">${priorities.map(item => `<option value="${escape(item.value)}" ${item.value === editorValue.priority ? 'selected' : ''}>${escape(item.label)}</option>`).join('')}</select>
                <div class="park-task-dialog-buttons"><button type="submit" class="park-dialog-primary">Зберегти зміни</button><button type="button" data-dialog-back>Назад до перегляду</button></div>
            </form>` : ''}
            ${actions.reschedule && reschedule ? `<form data-dialog-schedule hidden><h3>Перенесення задачі</h3>
                <label for="my-day-reschedule-date">Нова дата</label><input id="my-day-reschedule-date" name="date" type="date" required value="${escape(scheduleDraft ?? due ?? '')}">
                <div class="park-task-dialog-buttons"><button type="submit" class="park-dialog-primary">Перенести на обрану дату</button><button type="button" data-dialog-back>Назад до перегляду</button></div>
            </form>` : ''}
            <section data-dialog-detail-action hidden></section>`;
            bindTaskHistory(content.querySelector('[data-task-dialog-history]'), loadHistory, controller.signal);
            const editor = content.querySelector('[data-dialog-editor]');
            const schedule = content.querySelector('[data-dialog-schedule]');
            const view = content.querySelector('[data-dialog-view]');
            const detail = content.querySelector('[data-dialog-detail-action]');
            function showPanel(next, focus = true) {
                const previous = panel;
                panel = (next === 'edit' && editor) || (next === 'schedule' && schedule) || next === 'detail' ? next : 'view';
                view.hidden = panel !== 'view';
                status.hidden = view.hidden;
                if (editor) editor.hidden = panel !== 'edit';
                if (schedule) schedule.hidden = panel !== 'schedule';
                detail.hidden = panel !== 'detail';
                const more = view.querySelector('details.park-dialog-more');
                if (more) more.open = false;
                if (focus) {
                    const target = panel === 'edit' ? editor.elements.title : panel === 'schedule' ? schedule.elements.date
                        : previous === 'schedule' ? more?.querySelector('summary') : view.querySelector('[data-dialog-edit]');
                    target?.focus();
                }
            }
            showPanel(panel, false);
            content.querySelector('[data-dialog-edit]')?.addEventListener('click', () => showPanel('edit'));
            content.querySelector('[data-open-schedule]')?.addEventListener('click', () => showPanel('schedule'));
            content.querySelectorAll('[data-open-detail-action]').forEach(button => {
                button.addEventListener('click', () => {
                    if (isDirty()) { preventLoss({ preventDefault() {} }); return; }
                    const kind = button.dataset.openDetailAction;
                    detail.dataset.dialogDetailAction = kind;
                    showPanel('detail');
                    bindDetailAction(detail, {
                        kind, task, depositId, api: detailActions, signal: controller.signal, labels,
                        dirty(value) { detailDirty = value; syncDraftState(); },
                        back() { detailDirty = false; detail.replaceChildren(); showPanel('view'); syncDraftState(); },
                        submit(apply) { submitOperation('detail', apply); }
                    });
                });
            });
            content.querySelectorAll('[data-dialog-back]').forEach(button => button.addEventListener('click', () => showPanel('view')));
            editor?.addEventListener('input', () => {
                const value = Object.fromEntries(new FormData(editor));
                editorDraft = Object.keys(editorPatch(editorBase, value)).length ? value : null;
                persistDraft();
                syncDraftState();
            });
            editor?.addEventListener('submit', event => {
                event.preventDefault();
                if (editorSubmitBlocked()) return;
                const patch = editorPatch(editorBase, Object.fromEntries(new FormData(editor)));
                if (!Object.keys(patch).length) return;
                editorDraft = { ...editorBase, ...patch };
                submitOperation('editor', (previous, id) => save(previous, patch, id), patch);
            });
            content.querySelector('[data-dialog-complete]')?.addEventListener('click', () => {
                if (isDirty()) { preventLoss({ preventDefault() {} }); return; }
                submitOperation('complete', async (previous, id) => {
                    if (depositRef) {
                        if (!depositId) {
                            throw Object.assign(new Error('У задачі немає коректного посилання на завдаток.'), { status: 409 });
                        }
                        const projection = detailActions?.canViewDeposit?.()
                            ? await detailActions.loadDeposit(depositId, controller.signal).catch(() => null) : null;
                        if (!isConfirmedDeposit(projection) || controller.signal.aborted) {
                            throw Object.assign(new Error('Спочатку підтвердьте завдаток або зверніться до бухгалтера.'), { status: 409 });
                        }
                    }
                    return complete(previous, id);
                });
            });
            content.querySelector('[data-dialog-cancel-task]')?.addEventListener('click', async () => {
                if (isDirty()) { preventLoss({ preventDefault() {} }); return; }
                const confirmed = await global.confirmModal?.('Скасувати цю задачу? Виконавці побачать її в історії.', {
                    type: 'warning', okText: 'Скасувати задачу', cancelText: 'Залишити задачу',
                    initialFocus: '.confirm-cancel', container: dialog
                });
                if (confirmed && dialog.open) submitOperation('cancel', cancel);
            });
            schedule?.addEventListener('input', () => {
                scheduleDraft = schedule.elements.date.value === (due || '') ? null : schedule.elements.date.value;
                persistDraft();
                syncDraftState();
            });
            schedule?.addEventListener('submit', event => {
                event.preventDefault();
                const selectedDate = schedule.elements.date.value;
                submitOperation('schedule', (previous, id) => reschedule(selectedDate, previous, id));
            });
        }
        async function refresh() {
            const loaded = await load(controller.signal);
            if (!dialog.open || awaitingSessionChange) return;
            task = loaded?.task || loaded?.data || loaded;
            if (!task?.id) throw Object.assign(new Error('Task unavailable'), { status: 401 });
            if (editorSubmitBlocked()) {
                editorConflict.current = editorSnapshot(task);
                editorDraft = { ...editorConflict.current, ...editorConflict.patch };
            }
            if (!checkedSessionDraft && draftKey) {
                checkedSessionDraft = true;
                const stored = readSessionDraft(draftKey);
                if (stored && (task.business_context || task.businessContext) === draftScope.business) {
                    const current = editorSnapshot(task);
                    const patch = editorPatch(current, stored.fields);
                    if (task.drawer?.actions?.edit && Object.keys(patch).length) {
                        panel = 'edit';
                        editorDraft = { ...current, ...patch };
                        if (Number(stored.version) !== Number(task.version)) editorConflict = { patch, current, version: stored.version };
                    }
                    if (task.drawer?.actions?.reschedule && /^\d{4}-\d{2}-\d{2}$/.test(stored.scheduleDate || '')) {
                        scheduleDraft = stored.scheduleDate;
                        if (!editorDraft) panel = 'schedule';
                    }
                    syncDraftState();
                }
                if (stored && !editorDraft && !scheduleDraft) writeSessionDraft(draftKey, null);
            }
            render();
        }
        async function initialLoad() {
            try { await refresh(); }
            catch (error) {
                if (!dialog.open || awaitingSessionChange) return;
                content.replaceChildren();
                showError(error);
                const retry = document.createElement('button');
                retry.type = 'button'; retry.textContent = 'Спробувати ще раз';
                retry.addEventListener('click', () => { retry.disabled = true; void initialLoad(); });
                if (![400, 403, 404].includes(error.status)) content.append(retry);
            }
        }
        void initialLoad();
        return dialog;
    }

    function preservePosition(root) {
        if (!root) return null;
        const previous = document.activeElement;
        const within = root.contains(previous);
        const task = within ? previous.closest('.cabinet-task-card') : null;
        const id = task?.getAttribute('data-task-id');
        const attr = within ? positionAttrs.find(name => previous.hasAttribute(name)) : null;
        const value = attr && previous.getAttribute(attr);
        const group = within && previous.closest('[data-park-task-group]')?.dataset.parkTaskGroup;
        const nextId = task?.nextElementSibling?.getAttribute('data-task-id')
            || task?.previousElementSibling?.getAttribute('data-task-id');
        const fieldId = within && previous.id;
        const previousTop = within ? previous.getBoundingClientRect().top : 0;
        const x = global.scrollX;
        const y = global.scrollY;
        return () => {
            const byTask = identifier => identifier && root.querySelector(`.cabinet-task-card[data-task-id="${CSS.escape(identifier)}"]`);
            const byAttr = scope => attr && scope.querySelector(`[${attr}="${CSS.escape(value)}"]`);
            const byGroup = group && root.querySelector(`[data-park-task-group="${CSS.escape(group)}"]`);
            const card = byTask(id);
            const replacement = within && ((id && card && byAttr(card)) || (!id && byAttr(root))
                || (fieldId && root.querySelector(`#${CSS.escape(fieldId)}`))
                || byTask(nextId)?.querySelector('[data-cabinet-task-action="open"]')
                || byGroup || root.querySelector('[data-park-task-group="today"]'));
            global.scrollTo(x, y);
            if (replacement && !previous.isConnected) {
                const nextTop = replacement.getBoundingClientRect().top;
                if (previousTop >= 0 && previousTop < global.innerHeight && (nextTop < 0 || nextTop >= global.innerHeight)) {
                    global.scrollBy(0, nextTop - previousTop);
                }
                replacement.focus({ preventScroll: true });
            }
        };
    }

    const iconPaths = {
        work: 'M4 7h16v13H4z M8 7V4h8v3 M4 12h16',
        personal: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2',
        calendar: 'M4 6h16v14H4z M4 10h16 M8 4v4 M16 4v4',
        done: 'm5 12 4 4L19 6',
        edit: 'm4 20 4-1L20 7l-3-3L5 16z M14 7l3 3',
        history: 'M3 12a9 9 0 1 1 3 6.7 M3 6v6h6 M12 7v5l3 2',
        urgency: 'M12 4 2 21h20L12 4Z M12 10v4 M12 17h.01',
        overdue: 'M12 8v5 M12 16h.01 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'
    };

    function icon(name) {
        return `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${iconPaths[name]}"/></svg>`;
    }

    function renderCard({ id, title, status, due, priority, mode, modeLabel, blocked, postponementBadge, substitution,
        isAi, dueState, overdueDays, time, canReschedule, canMoveToToday, role, executor, canEdit = true, canComplete = true }) {
        const escape = global.escapeHtml;
        const attrs = `data-task-id="${id || ''}"`;
        const control = (action, label, className, enabled = true, extra = '') => `<button type="button" class="${className}" data-cabinet-task-action="${action}" ${attrs} ${extra} ${id && enabled ? '' : 'disabled'}>${label}</button>`;
        const stateLabel = blocked ? 'Заблоковано' : dueState === 'waiting' ? 'Чекаю'
            : status === 'in_progress' ? 'У роботі' : 'До виконання';
        const substitutionStates = { active: 'Погоджено', completed: 'Завершено' };
        const agreementState = substitutionStates[substitution?.state];
        return `<article class="cabinet-task-card park-task-card priority-${escape(priority)}" ${attrs} data-task-status="${escape(status)}" data-task-due-state="${escape(dueState)}">
            ${control('open', `${isAi ? '<span class="task-ai-created-marker" aria-label="Створено з допомогою AI">AI</span> ' : ''}${escape(title)}`, 'park-task-title', true, 'aria-haspopup="dialog"')}
            <div class="park-task-heading">
                <span class="park-task-state">${stateLabel}</span>
                ${overdueDays > 0 ? `<span class="park-task-overdue">${icon('overdue')}Прострочено: ${overdueDays} дн.</span>` : ''}
            </div>
            <div class="park-task-facts">
                <span class="park-task-date">${icon('calendar')}${due ? `<time datetime="${escape(due)}">${escape(due.split('-').reverse().join('.'))}${time ? ` · ${escape(time)}` : ''}</time>` : 'Без дати'}</span>
                <span class="park-task-kind" data-park-task-mode="${escape(mode)}">${escape(modeLabel)}</span>
                ${role !== 'executor' && executor ? `<span>Виконує ${escape(executor)}</span>` : ''}
                ${postponementBadge || ''}
                ${substitution?.id && agreementState ? `<span data-task-substitution>Підміна №${escape(substitution.id)} · ${agreementState}</span>` : ''}
            </div>
            ${blocked ? `<p id="park-task-blocked-${id}" class="park-task-blocked">${escape(blocked)}</p>` : ''}
            <div class="park-task-actions">
                ${role === 'executor' && canComplete && !blocked
                    ? control('done', `${icon('done')}<span>Виконати</span>`, 'cabinet-task-action-done park-task-done') : ''}
                ${canReschedule || canEdit ? `<details class="park-task-menu">
                    <summary aria-label="Більше дій">⋯</summary>
                    <div class="park-task-menu-items">
                        ${canMoveToToday ? control('move-to-today', 'На сьогодні', 'park-task-secondary', true, 'data-cabinet-move-undo="true"') : ''}
                        ${canReschedule ? control('reschedule-date', 'Перенести', 'park-task-secondary', true, 'aria-haspopup="dialog"') : ''}
                        ${canEdit ? control('edit', 'Редагувати', 'park-task-secondary') : ''}
                    </div>
                </details>` : ''}
            </div>
        </article>`;
    }

    function transitionCompletion(card, update) {
        const lane = card?.closest('[data-park-period]');
        if (!lane || typeof document.startViewTransition !== 'function'
            || global.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
        const period = lane.dataset.parkPeriod;
        const scope = lane.closest('.park-my-day');
        const names = new Map();
        const markCards = current => current?.querySelectorAll('.park-task-card[data-task-id]').forEach(item => {
            const name = `park-${period}-${item.dataset.taskId}`;
            if ([...names.values()].includes(name)) return;
            item.style.viewTransitionName = name;
            names.set(item, name);
        });
        markCards(lane);
        scope.classList.add('is-completing-task');
        const transition = document.startViewTransition(() => {
            update();
            names.clear();
            markCards(scope.querySelector(`[data-park-period="${period}"]`));
        });
        transition.finished.catch(() => {}).finally(() => {
            names.forEach((_, item) => item.style.removeProperty('view-transition-name'));
            scope.classList.remove('is-completing-task');
        });
        return true;
    }

    global.ProfileMyDay = Object.freeze({ preservePosition, renderCard, taskRole, roleLabel, openTaskDialog, transitionCompletion,
        clearSessionDrafts, sessionDraftKey, readSessionDraft, writeSessionDraft });
}(window));
