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
                document.querySelector('[data-park-task-group="today"]')?.focus({ preventScroll: true });
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
                title.textContent = task.title || `Задача #${taskId}`;
                content.innerHTML = `<dl class="park-task-dialog-facts">
                    <div><dt>Моя роль</dt><dd>${escape(roleLabel(taskRole(task)) || 'Перегляд')}</dd></div>
                    <div><dt>Стан</dt><dd>${escape(statusLabel(task))}</dd></div>
                    <div><dt>Дата</dt><dd>${due ? `<time datetime="${escape(due)}">${escape(due.split('-').reverse().join('.'))}</time>` : 'Без дати'}</dd></div>
                    ${executor ? `<div><dt>Виконавець</dt><dd>${escape(executor)}</dd></div>` : ''}
                </dl>
                ${task.description ? `<p class="park-task-dialog-description">${escape(task.description)}</p>` : ''}
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

    function renderCard({ id, title, status, due, priority, mode, modeLabel, blocked, postponementBadge, isAi, priorityControl, dueState, canReschedule, canMoveToToday, role, executor }) {
        const escape = global.escapeHtml;
        const attrs = `data-task-id="${id || ''}"`;
        const control = (action, label, className, enabled = true, extra = '') => `<button type="button" class="${className}" data-cabinet-task-action="${action}" ${attrs} ${extra} ${id && enabled ? '' : 'disabled'}>${label}</button>`;
        const stateLabel = dueState === 'overdue' ? 'Прострочено' : status === 'in_progress' ? 'У роботі' : 'До виконання';
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

    global.ProfileMyDay = Object.freeze({ preservePosition, renderCard, taskRole, roleLabel, openTaskDialog, transitionCompletion });
}(window));
