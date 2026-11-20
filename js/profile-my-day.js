(function (global) {
    'use strict';

    const positionAttrs = ['data-cabinet-my-day-view-mode', 'data-cabinet-bucket-more',
        'data-cabinet-task-priority-select', 'data-cabinet-task-action', 'data-cabinet-completion-toggle',
        'data-cabinet-completion-all', 'data-cabinet-completion-tab', 'data-cabinet-refresh'];

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
    function clearSessionDrafts() {
        try {
            for (let i = sessionStorage.length - 1; i >= 0; --i) {
                const key = sessionStorage.key(i);
                if (key?.startsWith(sessionDraftPrefix)) sessionStorage.removeItem(key);
            }
        } catch {}
    }

    function openTaskDialog({ taskId, load, selectDate, statusLabel, opener, onClose, mode, save, complete, reschedule, draftScope, onReconciled }) {
        const draftKey = draftScope?.actor && draftScope?.business && Number.isSafeInteger(taskId)
            ? sessionDraftPrefix + JSON.stringify([draftScope.actor, draftScope.business, taskId]) : null;
        const dialog = document.createElement('dialog');
        dialog.className = 'park-task-dialog';
        dialog.dataset.myDayTask = taskId;
        dialog.dataset.myDayMode = mode || '';
        dialog.taskLocation = global.location.href;
        dialog.setAttribute('aria-labelledby', 'park-task-dialog-title');
        dialog.innerHTML = `<header class="park-task-dialog-head">
            <h2 id="park-task-dialog-title">Задача #${taskId}</h2>
            <form method="dialog"><button type="submit" autofocus>Закрити</button></form>
        </header><p id="my-day-task-guard" class="park-task-dialog-guard" aria-live="polite" style="visibility:hidden">Є незбережені зміни. Збережіть їх або відкиньте.</p>
        <button type="button" class="park-task-dialog-discard" aria-describedby="my-day-task-guard" style="visibility:hidden" disabled>Відкинути зміни та закрити</button>
        <div class="park-task-dialog-content"><p role="status">Завантаження задачі…</p></div>`;
        const controller = new AbortController();
        const title = dialog.querySelector('h2');
        const content = dialog.querySelector('.park-task-dialog-content');
        const guard = dialog.querySelector('.park-task-dialog-guard');
        const discard = dialog.querySelector('.park-task-dialog-discard');
        const escape = global.escapeHtml;
        let task, busy = false, needsRefresh = false;
        let editorDraft = null, scheduleDraft = null, editorVisible = mode === 'edit';
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
        const isDirty = () => editorDraft !== null || scheduleDraft !== null;
        function syncDraftState() {
            dialog.dataset.dirty = String(isDirty());
            // Progressive enhancement; cancel remains the Safari fallback.
            dialog.setAttribute('closedby', busy || isDirty() ? 'none' : 'closerequest');
            guard.textContent = busy ? 'Дочекайтеся завершення збереження.'
                : 'Є незбережені зміни. Збережіть їх або відкиньте.';
            guard.style.visibility = busy || isDirty() ? 'visible' : 'hidden';
            discard.style.visibility = !busy && isDirty() ? 'visible' : 'hidden';
            discard.disabled = busy || !isDirty();
        }
        function hideDiscard() { discard.style.visibility = 'hidden'; discard.disabled = true; }
        const beforeUnload = event => {
            if (!isDirty() && !busy && !awaitingSessionChange) return;
            event.preventDefault(); event.returnValue = '';
        };
        global.addEventListener('beforeunload', beforeUnload);
        function preventLoss(event) {
            if (!busy && !isDirty()) return;
            event.preventDefault();
            guard.textContent = busy ? 'Дочекайтеся завершення збереження.' : 'Є незбережені зміни. Збережіть їх або відкиньте.';
            guard.style.visibility = 'visible';
            discard.style.visibility = busy ? 'hidden' : 'visible';
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
            title.textContent = 'Активний бізнес змінився';
            guard.style.visibility = 'hidden';
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
            const discardDraft = action(isDirty() ? 'Відкинути чернетку та перейти' : 'Перейти та перевірити результат', finish);
            if (isDirty()) {
                action('Зберегти чернетку в цій вкладці та перейти', () => {
                    try {
                        sessionStorage.setItem(draftKey, JSON.stringify({ savedAt: Date.now(), version: task.version,
                            fields: editorPatch(editorSnapshot(task), editorDraft), scheduleDate: scheduleDraft }));
                    } catch {
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
            if (operation.kind === 'editor') { editorDraft = null; editorConflict = null; editorVisible = false; }
            if (operation.kind === 'schedule') scheduleDraft = null;
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
                    await refresh();
                    if (awaitingSessionChange || !dialog.open) return;
                    const receipt = task.myDayOperation;
                    if (receipt?.id === operation.id && receipt.kind === operation.kind && receipt.version === operation.version) {
                        settleOperation(operation);
                        render();
                        onReconciled?.(operation.kind);
                        content.querySelector('button')?.focus({ preventScroll: true });
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
                    if (awaitingSessionChange) return;
                    settleOperation(operation);
                    // Once the server accepted a mutation, recovery must reload, not repeat it.
                    needsRefresh = true;
                }
                await refresh();
                needsRefresh = false;
                content.querySelector('button')?.focus({ preventScroll: true });
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
                        || editorSubmitBlocked() && control.matches('[data-dialog-editor] button[type=submit]'));
                });
            }
        }
        function render() {
            const due = selectDate(task);
            const executor = task.ownerLabel || task.owner_name || task.owner_username;
            const actions = task.drawer?.actions || {};
            const priorities = global.TaskUiShared?.TASK_PRIORITY_OPTIONS || [];
            const editorBase = editorSnapshot(task);
            const editorValue = editorDraft || editorBase;
            const editorLabels = { title: 'Назва', description: 'Опис', priority: 'Пріоритет' };
            title.textContent = task.title || `Задача #${taskId}`;
            const description = typeof task.description === 'string' ? task.description.trim() : '';
            content.innerHTML = `<dl class="park-task-dialog-facts">
                <div><dt>Моя роль</dt><dd>${escape(roleLabel(taskRole(task)) || 'Перегляд')}</dd></div>
                <div><dt>Стан</dt><dd>${escape(statusLabel(task))}</dd></div>
                <div><dt>Дата</dt><dd>${due ? `<time datetime="${escape(due)}">${escape(due.split('-').reverse().join('.'))}</time>` : 'Без дати'}</dd></div>
                ${executor ? `<div><dt>Виконавець</dt><dd>${escape(executor)}</dd></div>` : ''}
            </dl>
            ${description && description !== title.textContent.trim() ? `<p class="park-task-dialog-description">${escape(description)}</p>` : ''}
            <div class="park-task-dialog-buttons">
                ${actions.edit && save ? '<button type="button" data-dialog-edit>Редагувати</button>' : ''}
                ${actions.complete && complete ? '<button type="button" data-dialog-complete>Виконати</button>' : ''}
            </div>
            ${actions.edit && save ? `<form data-dialog-editor ${editorVisible ? '' : 'hidden'}>
                <label for="my-day-edit-title">Назва</label><input id="my-day-edit-title" name="title" required value="${escape(editorValue.title)}">
                <label for="my-day-edit-description">Опис</label><textarea id="my-day-edit-description" name="description" rows="4">${escape(editorValue.description)}</textarea>
                ${editorConflict?.current ? `<div role="status"><p>Перевірте актуальні значення перед збереженням чернетки.</p><ul>${Object.keys(editorConflict.patch).map(field => `<li>${editorLabels[field]}: ${escape(field === 'priority' ? priorities.find(item => item.value === editorConflict.current[field])?.label || editorConflict.current[field] : editorConflict.current[field] || '—')}</li>`).join('')}</ul></div>` : ''}
                <label for="my-day-edit-priority">Пріоритет</label><select id="my-day-edit-priority" name="priority">${priorities.map(item => `<option value="${escape(item.value)}" ${item.value === editorValue.priority ? 'selected' : ''}>${escape(item.label)}</option>`).join('')}</select>
                <button type="submit">Зберегти</button>
            </form>` : ''}
            ${actions.reschedule && reschedule ? `<form data-dialog-schedule>
                <label for="my-day-reschedule-date">Нова дата</label><input id="my-day-reschedule-date" name="date" type="date" required value="${escape(scheduleDraft ?? due ?? '')}">
                <button type="submit">Перенести</button>
            </form>` : ''}`;
            const editor = content.querySelector('[data-dialog-editor]');
            content.querySelector('[data-dialog-edit]')?.addEventListener('click', () => { editorVisible = true; editor.hidden = false; editor.elements.title.focus(); });
            editor?.addEventListener('input', () => {
                const value = Object.fromEntries(new FormData(editor));
                editorDraft = Object.keys(editorPatch(editorBase, value)).length ? value : null;
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
                submitOperation('complete', complete);
            });
            const schedule = content.querySelector('[data-dialog-schedule]');
            schedule?.addEventListener('input', () => {
                scheduleDraft = schedule.elements.date.value === (due || '') ? null : schedule.elements.date.value;
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
                try {
                    const stored = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
                    if (stored) sessionStorage.removeItem(draftKey);
                    if (stored && Number.isFinite(stored.savedAt) && stored.savedAt <= Date.now()
                        && Date.now() - stored.savedAt < 2 * 60 * 60 * 1000
                        && (task.business_context || task.businessContext) === draftScope.business) {
                        const current = editorSnapshot(task);
                        const patch = editorPatch(current, stored.fields);
                        if (task.drawer?.actions?.edit && Object.keys(patch).length) {
                            editorVisible = true;
                            editorDraft = { ...current, ...patch };
                            if (Number(stored.version) !== Number(task.version)) editorConflict = { patch, current };
                        }
                        if (task.drawer?.actions?.reschedule && /^\d{4}-\d{2}-\d{2}$/.test(stored.scheduleDate || '')) {
                            scheduleDraft = stored.scheduleDate;
                        }
                        syncDraftState();
                    }
                } catch {}
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
        urgency: 'M12 4 2 21h20L12 4Z M12 10v4 M12 17h.01',
        overdue: 'M12 8v5 M12 16h.01 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'
    };

    function icon(name) {
        return `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${iconPaths[name]}"/></svg>`;
    }

    function renderCard({ id, title, status, due, priority, mode, modeLabel, blocked, postponementBadge, substitution,
        isAi, priorityControl, dueState, canReschedule, canMoveToToday, role, executor, canEdit = true }) {
        const escape = global.escapeHtml;
        const attrs = `data-task-id="${id || ''}"`;
        const control = (action, label, className, enabled = true, extra = '') => `<button type="button" class="${className}" data-cabinet-task-action="${action}" ${attrs} ${extra} ${id && enabled ? '' : 'disabled'}>${label}</button>`;
        const stateLabel = dueState === 'overdue' ? 'Прострочено' : status === 'in_progress' ? 'У роботі' : 'До виконання';
        const substitutionStates = { active: 'Погоджено', completed: 'Завершено' };
        const agreementState = substitutionStates[substitution?.state];
        return `<article class="cabinet-task-card park-task-card priority-${escape(priority)}" ${attrs} data-task-status="${escape(status)}" data-task-due-state="${escape(dueState)}">
            ${control('open', `${isAi ? '<span class="task-ai-created-marker" aria-label="Створено з допомогою AI">AI</span> ' : ''}${escape(title)}`, 'park-task-title', true, 'aria-haspopup="dialog"')}
            <div class="park-task-heading">
                <span class="park-task-state">${dueState === 'overdue' ? icon('overdue') : ''}${stateLabel}</span>
                ${role === 'executor' ? `<span class="park-task-priority">${priority === 'urgent' ? icon('urgency') : ''}${priorityControl}</span>` : ''}
            </div>
            ${role === 'executor' && dueState === 'overdue' && canMoveToToday
                ? control('move-to-today', `${icon('calendar')}<span>На сьогодні</span>`, 'park-task-move-today') : ''}
            <div class="park-task-facts">
                <span class="park-task-date">${icon('calendar')}${due ? `<time datetime="${escape(due)}">${escape(due.split('-').reverse().join('.'))}</time>` : 'Без дати'}</span>
                <span class="park-task-kind" data-park-task-mode="${escape(mode)}">${escape(modeLabel)}</span>
                ${role !== 'executor' && executor ? `<span>Виконує ${escape(executor)}</span>` : ''}
                ${postponementBadge || ''}
                ${substitution?.id && agreementState ? `<span data-task-substitution>Підміна №${escape(substitution.id)} · ${agreementState}</span>` : ''}
            </div>
            ${blocked ? `<p id="park-task-blocked-${id}" class="park-task-blocked">${escape(blocked)}</p>` : ''}
            <div class="park-task-actions">
                ${role === 'executor' ? `
                ${control('done', `${icon('done')}<span>Виконати</span>`, 'cabinet-task-action-done park-task-done', !blocked, blocked ? `aria-describedby="park-task-blocked-${id}"` : '')}
                ${control('reschedule-date', `${icon('calendar')}<span>Перенести</span>`, 'park-task-secondary', canReschedule, 'aria-haspopup="dialog"')}
                ${control('edit', `${icon('edit')}<span>Редагувати</span>`, 'park-task-secondary', canEdit)}
                ` : ''}
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

    global.ProfileMyDay = Object.freeze({ preservePosition, renderCard, taskRole, roleLabel, openTaskDialog, transitionCompletion, clearSessionDrafts });
}(window));
