(function (global) {
    'use strict';

    const views = [['overdue', 'Прострочені'], ['today', 'Сьогодні'], ['future', 'Майбутні']];
    const selectedViews = new Map();
    const positionAttrs = ['data-park-my-day-view', 'data-cabinet-my-day-view-mode', 'data-cabinet-bucket-more',
        'data-cabinet-task-priority-select', 'data-cabinet-task-action', 'data-cabinet-completion-toggle',
        'data-cabinet-completion-all', 'data-cabinet-completion-tab', 'data-cabinet-refresh'];

    function getView(scope) {
        try {
            const stored = global.localStorage.getItem(`${scope}:list`);
            if (!selectedViews.has(scope)) selectedViews.set(scope, validateView(stored));
        } catch {}
        return selectedViews.get(scope) || 'today';
    }

    function validateView(view) {
        return views.some(([key]) => key === view) ? view : 'today';
    }

    function setView(scope, view, { persist = true } = {}) {
        const selected = validateView(view);
        selectedViews.set(scope, selected);
        if (persist) {
            try { global.localStorage.setItem(`${scope}:list`, selected); } catch {}
        }
    }

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

    function openTaskDialog({ taskId, load, selectDate, statusLabel, opener, onClose }) {
        const dialog = document.createElement('dialog');
        dialog.className = 'park-task-dialog';
        dialog.dataset.myDayTask = taskId;
        dialog.setAttribute('aria-labelledby', 'park-task-dialog-title');
        dialog.innerHTML = `<header class="park-task-dialog-head">
            <h2 id="park-task-dialog-title">Задача #${taskId}</h2>
            <form method="dialog"><button type="submit" autofocus>Закрити</button></form>
        </header><div class="park-task-dialog-content"><p role="status">Завантаження задачі…</p></div>`;
        const controller = new AbortController();
        dialog.addEventListener('close', () => {
            controller.abort();
            dialog.remove();
            onClose(dialog);
            if (!opener?.isConnected && !document.querySelector('dialog[open]')) {
                document.querySelector('[data-park-my-day-view][aria-pressed="true"]')?.focus({ preventScroll: true });
            }
        }, { once: true });
        document.body.append(dialog);
        dialog.showModal();

        const title = dialog.querySelector('h2');
        const content = dialog.querySelector('.park-task-dialog-content');
        const escape = global.escapeHtml;
        void (async () => {
            try {
                const task = await load(controller.signal);
                if (!dialog.open) return;
                if (!task?.id) throw new Error('Task unavailable');
                const due = selectDate(task);
                const executor = task.ownerLabel || task.owner_name || task.owner_username;
                const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
                title.textContent = task.title || `Задача #${taskId}`;
                content.innerHTML = `<dl class="park-task-dialog-facts">
                    <div><dt>Моя роль</dt><dd>${escape(roleLabel(taskRole(task)) || 'Перегляд')}</dd></div>
                    <div><dt>Стан</dt><dd>${escape(statusLabel(task))}</dd></div>
                    <div><dt>Дата</dt><dd>${due ? `<time datetime="${escape(due)}">${escape(due.split('-').reverse().join('.'))}</time>` : 'Без дати'}</dd></div>
                    ${executor ? `<div><dt>Виконавець</dt><dd>${escape(executor)}</dd></div>` : ''}
                </dl>
                ${task.description ? `<p class="park-task-dialog-description">${escape(task.description)}</p>` : ''}
                ${subtasks.length ? `<h3>Чекліст</h3><ul>${subtasks.map(item => `<li>${escape(item.title || '')} · ${item.is_done || item.isDone ? 'виконано' : 'до виконання'}</li>`).join('')}</ul>` : ''}
                <a class="park-task-dialog-actions" href="/tasks?view=my&amp;open=${taskId}">Усі дії із задачею</a>`;
            } catch (error) {
                if (!dialog.open) return;
                content.innerHTML = '<p role="alert"></p>';
                content.firstElementChild.textContent = [403, 404].includes(error.status)
                    ? 'Задача недоступна або її видалено.'
                    : 'Не вдалося завантажити задачу. Спробуйте відкрити її ще раз.';
            }
        })();
        return dialog;
    }

    function renderViews(selected, counts) {
        return `<div class="park-my-day-views" role="group" aria-label="Період задач">
            ${views.map(([id, label]) => `<button type="button" data-park-my-day-view="${id}" aria-pressed="${selected === id}"><span>${label}</span><b>${counts[id] ?? '—'}</b></button>`).join('')}
        </div>`;
    }

    function bindViews(root, chooseView) {
        if (!root || root.dataset.parkViewsBound) return;
        root.dataset.parkViewsBound = 'true';
        root.addEventListener('click', event => {
            const button = event.target.closest('[data-park-my-day-view]');
            if (button) chooseView(button.dataset.parkMyDayView);
        });
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
                || byGroup || root.querySelector('[data-park-my-day-view][aria-pressed="true"]'));
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
        urgency: 'M5 19v-4 M12 19V9 M19 19V5',
        overdue: 'M12 8v5 M12 16h.01 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'
    };

    function icon(name) {
        return `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${iconPaths[name]}"/></svg>`;
    }

    function renderCard({ id, title, status, due, priority, mode, modeLabel, checklist, blocked, report, postponementBadge, isAi, priorityControl, dueState, canReschedule, role, executor }) {
        const escape = global.escapeHtml;
        const attrs = `data-task-id="${id || ''}"`;
        const control = (action, label, className, enabled = true, extra = '') => `<button type="button" class="${className}" data-cabinet-task-action="${action}" ${attrs} ${extra} ${id && enabled ? '' : 'disabled'}>${label}</button>`;
        return `<article class="cabinet-task-card park-task-card priority-${escape(priority)}" ${attrs} data-task-status="${escape(status)}" data-task-due-state="${escape(dueState)}">
            <div class="park-task-heading">
                <span class="park-task-kind" data-park-task-mode="${escape(mode)}">${icon(mode === 'work' ? 'work' : 'personal')}${escape(modeLabel)}</span>
                ${dueState === 'overdue' ? `<span class="park-task-overdue">${icon('overdue')}Прострочено</span>` : ''}
            </div>
            ${control('open', `${isAi ? '<span class="task-ai-created-marker" aria-label="Створено з допомогою AI">AI</span> ' : ''}${escape(title)}`, 'park-task-title', true, 'aria-haspopup="dialog"')}
            <div class="park-task-facts">
                <span class="park-task-date">${icon('calendar')}${due ? `<time datetime="${escape(due)}">${escape(due.split('-').reverse().join('.'))}</time>` : 'Без дати'}</span>
                ${roleLabel(role) ? `<span>${escape(roleLabel(role))}</span>` : ''}
                ${role === 'executor' ? `<span class="park-task-priority">${icon('urgency')}${priorityControl}</span>` : executor ? `<span>Виконує ${escape(executor)}</span>` : ''}
                ${checklist.total ? `<span>${checklist.done}/${checklist.total} · Чекліст</span>` : ''}
                ${postponementBadge || ''}
                ${report || ''}
            </div>
            ${blocked ? `<p id="park-task-blocked-${id}" class="park-task-blocked">${escape(blocked)}</p>` : ''}
            <div class="park-task-actions">
                ${role === 'executor' ? `
                ${control('done', `${icon('done')}<span>Виконати</span>`, 'cabinet-task-action-done park-task-done', !blocked, blocked ? `aria-describedby="park-task-blocked-${id}"` : '')}
                ${control('reschedule-date', `${icon('calendar')}<span>Перенести</span>`, 'park-task-secondary', canReschedule, 'aria-haspopup="dialog"')}
                ${control('edit', `${icon('edit')}<span>Редагувати</span>`, 'park-task-secondary')}
                ` : ''}
            </div>
        </article>`;
    }

    global.ProfileMyDay = Object.freeze({ getView, setView, renderViews, bindViews, preservePosition, renderCard, taskRole, roleLabel, openTaskDialog });
}(window));
