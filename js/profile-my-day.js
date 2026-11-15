(function (global) {
    'use strict';

    const views = [['today', 'Сьогодні'], ['overdue', 'Прострочені'], ['future', 'Майбутні']];
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

    function setView(scope, view) {
        const selected = validateView(view);
        selectedViews.set(scope, selected);
        try { global.localStorage.setItem(`${scope}:list`, selected); } catch {}
    }

    function renderViews(selected) {
        return `<div class="park-my-day-views" role="group" aria-label="Період задач">
            ${views.map(([id, label]) => `<button type="button" data-park-my-day-view="${id}" aria-pressed="${selected === id}">${label}</button>`).join('')}
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

    function renderCard({ id, title, status, due, priority, modeLabel, detailed, checklist, blocked, report, postponementBadge, isAi, priorityControl, dueState }) {
        const escape = global.escapeHtml;
        const attrs = `data-task-id="${id || ''}"`;
        const control = (action, label, className, extra = '') => `<button type="button" class="${className}" data-cabinet-task-action="${action}" ${attrs} ${extra} ${id ? '' : 'disabled'}>${label}</button>`;
        return `<article class="cabinet-task-card park-task-card priority-${escape(priority)}" ${attrs} data-task-status="${escape(status)}" data-task-due-state="${escape(dueState)}">
            ${control('open', `${isAi ? '<span class="task-ai-created-marker" aria-label="Створено з допомогою AI">AI</span> ' : ''}${escape(title)}`, 'park-task-title')}
            <div class="park-task-facts">
                <span><time ${due ? `datetime="${escape(due)}"` : ''}>${due ? escape(due.split('-').reverse().join('.')) : 'Без дати'}</time></span>
                ${priorityControl}
                ${checklist.total ? `<span>${checklist.done}/${checklist.total} · Чекліст</span>` : ''}
                ${detailed ? `<span>${escape(modeLabel)}</span>` : ''}
                ${postponementBadge || ''}
                ${report || ''}
            </div>
            ${blocked ? `<p id="park-task-blocked-${id}" class="park-task-blocked">${escape(blocked)}</p>` : ''}
            <div class="park-task-actions">
                ${control('done', 'Виконати', 'cabinet-task-action-done park-task-done', blocked ? `disabled aria-describedby="park-task-blocked-${id}"` : '')}
                ${control('more', 'Ще', 'cabinet-task-more park-task-secondary', 'aria-haspopup="dialog"')}
            </div>
        </article>`;
    }

    global.ProfileMyDay = Object.freeze({ getView, setView, renderViews, bindViews, preservePosition, renderCard });
}(window));
