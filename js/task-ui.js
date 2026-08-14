/**
 * Shared task UI primitives for the profile My Day surface and Tasks queue.
 * Keeps interaction chrome shared while each surface owns its task semantics.
 */
(function () {
    const MENU_ROOT_ID = 'taskUiActionSurface';
    const DOCK_ROOT_ID = 'taskUiDropDock';
    const ACTION_MENU_FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    let menuLastFocus = null;
    let menuAnchorObserver = null;
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
        if (typeof menuLastFocus?.setAttribute === 'function') {
            menuLastFocus.setAttribute('aria-expanded', 'false');
        }
        const root = document.getElementById(MENU_ROOT_ID);
        if (menuAnchorObserver) {
            menuAnchorObserver.disconnect();
            menuAnchorObserver = null;
        }
        if (root) {
            if (typeof root.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                root.dispatchEvent(new CustomEvent('task-ui:surface-close', { bubbles: true }));
            }
            root.remove();
        }
        lockBodyScroll(false);
        if (menuLastFocus?.isConnected) {
            try { menuLastFocus.focus({ preventScroll: true }); } catch {}
        }
        menuLastFocus = null;
    }

    function stableActionAnchor(anchor) {
        if (anchor?.isConnected) return anchor;
        const active = document.activeElement;
        return active?.isConnected && active !== document.body ? active : null;
    }

    function positionPopover(root, anchor) {
        const panel = root.querySelector('.task-ui-action-panel');
        if (!panel) return;
        if (!anchor?.isConnected) {
            panel.style.left = '50%';
            panel.style.top = '50%';
            panel.style.transform = 'translate(-50%, -50%)';
            panel.style.width = `${Math.min(360, window.innerWidth - 24)}px`;
            return;
        }
        panel.style.transform = '';
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

    function actionMenuFocusableElements(root) {
        return Array.from(root?.querySelectorAll?.(ACTION_MENU_FOCUSABLE_SELECTOR) || [])
            .filter(element => !element.disabled && element.getAttribute?.('aria-hidden') !== 'true');
    }

    function handleActionMenuKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeActionMenu();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = actionMenuFocusableElements(event.currentTarget);
        if (!focusable.length) {
            event.preventDefault();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const current = document.activeElement;
        if (event.shiftKey && (current === first || !focusable.includes(current))) {
            event.preventDefault();
            last.focus({ preventScroll: true });
        } else if (!event.shiftKey && current === last) {
            event.preventDefault();
            first.focus({ preventScroll: true });
        }
    }

    function openActionMenu(anchor, html, options = {}) {
        closeActionMenu();
        menuLastFocus = stableActionAnchor(anchor);
        const mobile = options.mobile ?? isSmallScreen();
        const presentation = String(options.presentation || '').trim().toLowerCase();
        const dialog = presentation === 'dialog' && !mobile;
        const surfaceMode = mobile ? 'sheet' : (dialog ? 'dialog' : 'popover');
        const root = document.createElement('div');
        const surfaceClassName = String(options.surfaceClassName || '').trim().replace(/[^a-zA-Z0-9 _-]/g, '');
        root.id = MENU_ROOT_ID;
        if (typeof root.setAttribute === 'function') {
            root.setAttribute('data-task-ui-presentation', surfaceMode);
        } else {
            root.taskUiPresentation = surfaceMode;
        }
        if (typeof menuLastFocus?.setAttribute === 'function') {
            menuLastFocus.setAttribute('aria-expanded', 'true');
            menuLastFocus.setAttribute('aria-controls', MENU_ROOT_ID);
        }
        root.className = `task-ui-action-surface is-${surfaceMode}`;
        if (surfaceClassName) root.classList.add(...surfaceClassName.split(/\s+/).filter(Boolean));
        const title = options.title || 'Дії задачі';
        root.innerHTML = `
            <div class="task-ui-action-backdrop" data-task-ui-close></div>
            <section class="task-ui-action-panel" role="dialog" aria-modal="${mobile || dialog ? 'true' : 'false'}" aria-label="${escapeHtml(title)}">
                <div class="task-ui-action-head">
                    <strong>${escapeHtml(title)}</strong>
                    <button type="button" class="task-ui-icon-btn" data-task-ui-close aria-label="Закрити">×</button>
                </div>
                <div class="task-ui-action-body">${html}</div>
            </section>`;
        root.addEventListener('keydown', handleActionMenuKeydown);
        root.addEventListener('click', event => {
            if (event.target.closest('[data-task-ui-close]')) {
                event.preventDefault();
                closeActionMenu();
            }
        });
        document.body.appendChild(root);
        if (typeof MutationObserver !== 'undefined') {
            menuAnchorObserver = new MutationObserver(() => {
                const currentRoot = document.getElementById(MENU_ROOT_ID);
                if (!currentRoot?.isConnected || (menuLastFocus && !menuLastFocus.isConnected)) {
                    closeActionMenu();
                }
            });
            menuAnchorObserver.observe(document.body, { childList: true, subtree: true });
        }
        if (mobile || dialog) lockBodyScroll(true);
        requestAnimationFrame(() => {
            if (!mobile && !dialog) positionPopover(root, menuLastFocus);
            actionMenuFocusableElements(root)[0]?.focus({ preventScroll: true });
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
