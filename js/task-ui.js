/**
 * Shared task UI primitives for the profile My Day surface and Tasks queue.
 * Keeps interaction chrome shared while each surface owns its task semantics.
 */
(function () {
    const MENU_ROOT_ID = 'taskUiActionSurface';
    const DOCK_ROOT_ID = 'taskUiDropDock';
    let menuLastFocus = null;
    let dockController = null;

    const LABELS = {
        kinds: {
            action: 'Дія',
            reminder: 'Нагадування',
            followup: 'Дотиск',
            deep_work: 'Глибока робота',
            checklist: 'Чеклист',
            routine: 'Рутина',
            waiting: 'Чекаю',
            idea: 'Ідея',
            decision: 'Рішення'
        },
        modes: {
            work: 'Робоча',
            personal: 'Особиста',
            private: 'Приватна',
            system: 'Системна'
        },
        priorities: {
            urgent: 'Терміново',
            high: 'Високий',
            normal: 'Звичайний',
            low: 'Низький'
        },
        moveTargets: {
            today: 'Сьогодні',
            tomorrow: 'Завтра',
            snooze_hour: '+1 год',
            snooze_custom: 'Інша дата',
            no_date: 'Без дати',
            waiting: 'Чекаю',
            private: 'Приватне',
            open: 'Відкрити'
        }
    };

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function isSmallScreen() {
        return window.matchMedia?.('(max-width: 768px), (hover: none) and (pointer: coarse)')?.matches
            || window.innerWidth <= 768;
    }

    function lockBodyScroll(lock) {
        document.documentElement.classList.toggle('task-ui-scroll-lock', Boolean(lock));
        document.body?.classList.toggle('task-ui-scroll-lock', Boolean(lock));
    }

    function closeActionMenu() {
        const root = document.getElementById(MENU_ROOT_ID);
        if (root) root.remove();
        lockBodyScroll(false);
        if (menuLastFocus?.isConnected) {
            try { menuLastFocus.focus({ preventScroll: true }); } catch {}
        }
        menuLastFocus = null;
    }

    function positionPopover(root, anchor) {
        const panel = root.querySelector('.task-ui-action-panel');
        if (!panel || !anchor) return;
        const rect = anchor.getBoundingClientRect();
        const padding = 12;
        const panelRect = panel.getBoundingClientRect();
        const width = Math.min(panelRect.width || 280, window.innerWidth - padding * 2);
        let left = rect.right - width;
        left = Math.max(padding, Math.min(left, window.innerWidth - width - padding));
        let top = rect.bottom + 8;
        const height = panelRect.height || 240;
        if (top + height > window.innerHeight - padding) {
            top = Math.max(padding, rect.top - height - 8);
        }
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.width = `${width}px`;
    }

    function openActionMenu(anchor, html, options = {}) {
        closeActionMenu();
        menuLastFocus = anchor || document.activeElement;
        const mobile = options.mobile ?? isSmallScreen();
        const root = document.createElement('div');
        root.id = MENU_ROOT_ID;
        root.className = `task-ui-action-surface ${mobile ? 'is-sheet' : 'is-popover'}`;
        const title = options.title || 'Дії задачі';
        root.innerHTML = `
            <div class="task-ui-action-backdrop" data-task-ui-close></div>
            <section class="task-ui-action-panel" role="dialog" aria-modal="${mobile ? 'true' : 'false'}" aria-label="${escapeHtml(title)}">
                <div class="task-ui-action-head">
                    <strong>${escapeHtml(title)}</strong>
                    <button type="button" class="task-ui-icon-btn" data-task-ui-close aria-label="Закрити">×</button>
                </div>
                <div class="task-ui-action-body">${html}</div>
            </section>`;
        root.addEventListener('click', event => {
            if (event.target.closest('[data-task-ui-close]')) {
                event.preventDefault();
                closeActionMenu();
            }
        });
        document.body.appendChild(root);
        if (mobile) lockBodyScroll(true);
        requestAnimationFrame(() => {
            if (!mobile) positionPopover(root, anchor);
            root.querySelector('button, [href], input, select, textarea')?.focus({ preventScroll: true });
        });
        return root;
    }

    function renderMenuItems(items = []) {
        return items
            .filter(Boolean)
            .map(item => {
                const attrs = Object.entries(item.attrs || {})
                    .map(([key, value]) => value === false || value === null || value === undefined
                        ? ''
                        : `${key}="${escapeHtml(value === true ? '' : value)}"`)
                    .filter(Boolean)
                    .join(' ');
                const tone = item.tone ? ` task-ui-menu-item--${escapeHtml(item.tone)}` : '';
                const disabled = item.disabled ? ' disabled aria-disabled="true"' : '';
                const detail = item.detail ? `<small>${escapeHtml(item.detail)}</small>` : '';
                return `<button type="button" class="task-ui-menu-item${tone}" ${attrs}${disabled}>
                    <span>${escapeHtml(item.label)}</span>${detail}
                </button>`;
            })
            .join('');
    }

    function closeDropDock() {
        const root = document.getElementById(DOCK_ROOT_ID);
        if (root) root.remove();
        dockController = null;
        document.body?.classList.remove('task-ui-dock-open');
    }

    function showDropDock(options = {}) {
        closeDropDock();
        const targets = Array.isArray(options.targets) ? options.targets.filter(Boolean) : [];
        if (!targets.length) return null;
        const root = document.createElement('div');
        root.id = DOCK_ROOT_ID;
        root.className = 'task-ui-drop-dock';
        root.setAttribute('role', 'region');
        root.setAttribute('aria-label', options.label || 'Швидке перенесення задачі');
        root.innerHTML = `
            <div class="task-ui-drop-dock-title">${escapeHtml(options.title || 'Перенести в')}</div>
            <div class="task-ui-drop-dock-targets">
                ${targets.map(target => `
                    <button type="button"
                            class="task-ui-drop-target ${target.enabled === false ? 'is-disabled' : ''}"
                            data-task-ui-drop-target="${escapeHtml(target.id)}"
                            ${target.enabled === false ? 'disabled aria-disabled="true"' : ''}>
                        <span>${escapeHtml(target.label || LABELS.moveTargets[target.id] || target.id)}</span>
                        ${target.detail ? `<small>${escapeHtml(target.detail)}</small>` : ''}
                    </button>`).join('')}
            </div>`;
        root.addEventListener('click', event => {
            const button = event.target.closest('[data-task-ui-drop-target]');
            if (!button || button.disabled) return;
            options.onSelect?.(button.dataset.taskUiDropTarget, button);
        });
        document.body.appendChild(root);
        document.body?.classList.add('task-ui-dock-open');
        dockController = { root, close: closeDropDock };
        return dockController;
    }

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            closeActionMenu();
            closeDropDock();
        }
    });
    window.addEventListener('resize', () => closeActionMenu());

    window.TaskUI = {
        labels: LABELS,
        escapeHtml,
        isSmallScreen,
        openActionMenu,
        closeActionMenu,
        renderMenuItems,
        showDropDock,
        closeDropDock
    };
})();
