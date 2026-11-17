/**
 * js/alerts.js — Global Alert Bell v4.0 (self-injecting, interactive)
 * v39.8.0 — Interactive alerts: inline actions, swipe dismiss, grouped by type
 */
const _ALERTS_KEY = 'crm_alerts_read_v2';
const _ALERTS_DISMISSED_KEY = 'crm_alerts_dismissed';
let _alertsData = [];
let _alertRuntimeStarted = false;
let _alertInterval = null;
let _alertScopeVersion = 0;
let _controlCompletionUnread = 0;

function _alertFetch(path, options = {}) {
    const request = typeof apiFetchWithAuthRetry === 'function' ? apiFetchWithAuthRetry : fetch;
    return request(path, { cache: 'no-store', ...options });
}

async function _loadAlertResponse() {
    const response = await _alertFetch('/api/dashboard/alerts');
    if (response?.ok) return response.json();
    if (response?.status !== 403) throw new Error('Alerts unavailable');
    const personal = await _alertFetch('/api/tasks/control-completions');
    if (!personal?.ok) throw new Error('Completion alerts unavailable');
    const { alerts, unread, nextCursor } = await personal.json();
    return { alerts, controlCompletions: { unread, nextCursor } };
}

function _applyAlertResponse(data) {
    const dismissed = _getDismissed();
    if (Number.isInteger(data.controlCompletions?.unread)) _controlCompletionUnread = data.controlCompletions.unread;
    _replaceAlertsData((data.alerts || []).filter(alert => alert.type === 'control_completion' || !dismissed.has(alert.id)));
    _syncAlertBadge();
    _emitAlertsUpdated();
}

function _syncAlertBadge() {
    const badge = document.getElementById('alertBadge');
    if (!badge) return;
    const read = _getRead();
    const other = _alertsData.filter(alert => alert.type !== 'control_completion' && !read.has(alert.id));
    _updateBadge(badge, other, other.length + _controlCompletionUnread);
}

// ─── Self-inject bell + panel ───────────────────
function _ensureAlertElements() {
    const oldBell = document.getElementById('alertBell');
    if (oldBell) oldBell.remove();

    if (!document.getElementById('alertsPanelBackdrop')) {
        const backdrop = document.createElement('div');
        backdrop.className = 'alerts-panel-backdrop';
        backdrop.id = 'alertsPanelBackdrop';
        backdrop.addEventListener('click', _closeAlertsPanel);
        document.body.appendChild(backdrop);
    }

    // Fix legacy panels with wrong class
    const existingPanel = document.getElementById('alertsPanel');
    if (existingPanel && !existingPanel.classList.contains('alerts-panel-v4')) {
        existingPanel.className = 'alerts-panel-v4';
    }

    if (!document.getElementById('alertsPanel')) {
        const panel = document.createElement('div');
        panel.className = 'alerts-panel-v4';
        panel.id = 'alertsPanel';
        document.body.appendChild(panel);
    }
}

// ─── State helpers ──────────────────────────────
function _getRead() { try { return new Set(JSON.parse(localStorage.getItem(_ALERTS_KEY) || '[]')); } catch { return new Set(); } }
function _saveRead(s) { localStorage.setItem(_ALERTS_KEY, JSON.stringify([...s])); }
function _getDismissed() { try { return new Set(JSON.parse(localStorage.getItem(_ALERTS_DISMISSED_KEY) || '[]')); } catch { return new Set(); } }
function _saveDismissed(s) { localStorage.setItem(_ALERTS_DISMISSED_KEY, JSON.stringify([...s])); }

function _alertCurrentUserId() {
    const user = window.AppState?.currentUser || (() => {
        try { return JSON.parse(localStorage.getItem('pzp_current_user') || 'null'); } catch { return null; }
    })();
    const id = Number(user?.id || user?.userId || 0);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function _alertsFingerprint(alerts) {
    return (alerts || [])
        .map(a => [a.id || '', a.level || '', a.link || '', a.title || '', a.message || ''].join('::'))
        .sort()
        .join('|');
}

function _replaceAlertsData(alerts) {
    const nextAlerts = Array.isArray(alerts) ? alerts : [];
    const changed = _alertsFingerprint(nextAlerts) !== _alertsFingerprint(_alertsData);
    _alertsData = nextAlerts;
    return changed;
}

// ─── Badge update ───────────────────────────────
async function loadAlertBell() {
    if (typeof window.isAuthenticatedRuntimeReady !== 'function' || !window.isAuthenticatedRuntimeReady()) return;
    const scopeVersion = _alertScopeVersion;
    try {
        const data = await _loadAlertResponse();
        if (scopeVersion !== _alertScopeVersion) return;
        _applyAlertResponse(data);
    } catch { /* silent */ }
}

function _updateBadge(badge, unread, count = unread.length) {
    if (!count) { badge.style.display = 'none'; return; }
    badge.style.display = 'flex';
    badge.textContent = count > 99 ? '99+' : count;
    const hasCritical = unread.some(a => a.level === 'critical');
    badge.classList.toggle('critical', hasCritical);
    badge.classList.toggle('pulse', hasCritical);
}

function getUnreadControlCompletionCount() {
    return _controlCompletionUnread;
}

function _emitAlertsUpdated() {
    try {
        window.dispatchEvent(new CustomEvent('crm:alerts-updated', { detail: { alerts: _alertsData } }));
    } catch {}
}

// ─── Panel toggle ───────────────────────────────
function toggleAlertsPanel(e) {
    if (e) e.stopPropagation();
    _ensureAlertElements();
    const p = document.getElementById('alertsPanel');
    if (!p) return;
    const isOpen = p.classList.contains('open');
    if (isOpen) _closeAlertsPanel();
    else _openAlertsPanel();
}

function _openAlertsPanel() {
    const p = document.getElementById('alertsPanel');
    const backdrop = document.getElementById('alertsPanelBackdrop');
    if (!p) return;
    p.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    document.body.classList.add('alerts-center-open');
    _renderPanel();
}

function _closeAlertsPanel() {
    const p = document.getElementById('alertsPanel');
    const backdrop = document.getElementById('alertsPanelBackdrop');
    if (p) p.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    document.body.classList.remove('alerts-center-open');
}

// ─── Interactive Panel Render ───────────────────
async function _renderPanel() {
    const p = document.getElementById('alertsPanel');
    if (!p) return;
    const scopeVersion = _alertScopeVersion;
    try {
        const data = await _loadAlertResponse();
        if (scopeVersion !== _alertScopeVersion) return;
        _applyAlertResponse(data);

        if (!_alertsData.length) {
            p.innerHTML = `<div class="ap-header">
                    <div class="ap-header-main">
                        <span class="ap-kicker">Центр подій</span>
                        <span class="ap-title">Сповіщення</span>
                        <span class="ap-subtitle">Активні попередження, задачі й операційні сигнали</span>
                    </div>
                    <button class="ap-close" type="button" onclick="_closeAlertsPanel()" aria-label="Закрити">×</button>
                </div>
                <div class="ap-empty"><div class="ap-empty-icon">✅</div><div class="ap-empty-text">Все в порядку!</div><div class="ap-empty-sub">Немає активних сповіщень</div></div>`;
            return;
        }

        const read = _getRead();
        const unreadCount = _controlCompletionUnread + _alertsData.filter(a => a.type !== 'control_completion' && !read.has(a.id)).length;

        // Group by level
        const critical = _alertsData.filter(a => a.level === 'critical');
        const warnings = _alertsData.filter(a => a.level === 'warning');
        const info = _alertsData.filter(a => a.level === 'info');

        const header = `<div class="ap-header">
            <div class="ap-header-main">
                <span class="ap-kicker">Центр подій</span>
                <span class="ap-title">Сповіщення</span>
                <span class="ap-subtitle">Працюй зі сповіщеннями тут, без прив'язки до верхнього дзвіночка</span>
            </div>
            <span class="ap-count">${unreadCount ? unreadCount + ' нових' : 'Все прочитано'}</span>
            ${_alertsData.length > 0 ? `<button type="button" class="ap-mark-all" onclick="_markAllRead()" aria-label="Позначити все як прочитане" title="Позначити все як прочитане">✓</button>` : ''}
            <button class="ap-close" type="button" onclick="_closeAlertsPanel()" aria-label="Закрити">×</button>
        </div>`;

        let body = '';
        if (critical.length) body += _renderGroup('🔴 Терміново', critical, read);
        if (warnings.length) body += _renderGroup('⚠️ Увага', warnings, read);
        if (info.length) body += _renderGroup('ℹ️ Інформація', info, read);

        const cursor = data.controlCompletions?.nextCursor;
        const more = cursor ? `<button type="button" class="ap-act ap-act-secondary" data-control-alert-more>Показати попередні завершення</button>` : '';
        p.innerHTML = header + `<div class="ap-body">${body}<div data-control-alert-history></div>${more}<div data-control-alert-status role="status"></div></div>`;
        p.querySelector('[data-control-alert-more]')?.addEventListener('click', event => {
            void _loadMoreControlAlerts(event.currentTarget, cursor, scopeVersion);
        }, { once: true });
    } catch {
        p.innerHTML = `<div class="ap-header">
            <div class="ap-header-main">
                <span class="ap-kicker">Центр подій</span>
                <span class="ap-title">Сповіщення</span>
            </div>
            <button class="ap-close" type="button" onclick="_closeAlertsPanel()" aria-label="Закрити">×</button>
        </div><div class="ap-empty"><div class="ap-empty-icon">❌</div><div class="ap-empty-text">Помилка завантаження</div></div>`;
    }
}

async function _loadMoreControlAlerts(button, cursor, scopeVersion) {
    button.disabled = true;
    const panel = document.getElementById('alertsPanel');
    const history = panel.querySelector('[data-control-alert-history]');
    const status = panel.querySelector('[data-control-alert-status]');
    const before = history.children.length;
    try {
        const response = await _alertFetch(`/api/tasks/control-completions?cursor=${encodeURIComponent(cursor)}`);
        if (!response?.ok) throw new Error('Completion history unavailable');
        const page = await response.json();
        if (scopeVersion !== _alertScopeVersion || !history.isConnected) return;
        history.insertAdjacentHTML('beforeend', page.alerts.map(alert => _renderAlertItem(alert, alert.read)).join(''));
        status.textContent = page.alerts.length ? `Додано сповіщень: ${page.alerts.length}` : 'Усі завершення показано.';
        history.children[before]?.querySelector('a')?.focus();
        if (!page.nextCursor) {
            button.remove();
            return;
        }
        cursor = page.nextCursor;
    } catch {
        status.textContent = 'Не вдалося завантажити попередні завершення. Спробуйте ще раз.';
    }
    button.disabled = false;
    button.addEventListener('click', () => { void _loadMoreControlAlerts(button, cursor, scopeVersion); }, { once: true });
}

async function _saveControlRead(body) {
    try {
        const response = await _alertFetch('/api/tasks/control-completions/read', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        if (!response?.ok) throw new Error('Completion acknowledgement failed');
        return true;
    } catch {
        const status = document.querySelector('[data-control-alert-status]');
        if (status) status.textContent = 'Не вдалося позначити сповіщення як прочитане.';
        return false;
    }
}

async function _readControlAlert(eventKey, button) {
    const scopeVersion = _alertScopeVersion;
    button.disabled = true;
    if (!await _saveControlRead({ eventKey })) {
        button.disabled = false;
        return;
    }
    if (scopeVersion !== _alertScopeVersion || !button.isConnected) return;
    const card = button.closest('.ap-item');
    card.classList.add('read');
    card.querySelector('a')?.focus();
    button.remove();
    void loadAlertBell();
}

async function _openControlAlert(link, eventKey) {
    const scopeVersion = _alertScopeVersion;
    await _saveControlRead({ eventKey });
    if (scopeVersion === _alertScopeVersion) _goAlert(link);
}

function _renderGroup(title, alerts, read) {
    const items = alerts.map(a => _renderAlertItem(a, a.type === 'control_completion' ? a.read : read.has(a.id))).join('');
    return `<div class="ap-group"><div class="ap-group-title">${title} <span class="ap-group-count">${alerts.length}</span></div>${items}</div>`;
}

function _renderAlertItem(a, isRead) {
    const id = _esc(a.id || '');
    const link = _esc(a.link || '');
    const levelClass = a.level || 'info';

    if (a.type === 'control_completion') {
        return `<div class="ap-item info${isRead ? ' read' : ''}" data-alert-id="${id}">
            <div class="ap-item-main">
                <span class="ap-icon" aria-hidden="true">✓</span>
                <div class="ap-content">
                    <a class="ap-item-title" href="${link}" onclick="if (!event.metaKey &amp;&amp; !event.ctrlKey &amp;&amp; !event.shiftKey &amp;&amp; !event.altKey) { event.preventDefault(); _openControlAlert('${link}', '${a.eventKey}'); }">${escapeHtml(a.title || '')}</a>
                    <div class="ap-item-desc">${escapeHtml(a.message || '')}</div>
                </div>
                ${isRead ? '' : `<button type="button" class="ap-act ap-act-secondary" onclick="_readControlAlert('${a.eventKey}', this)" aria-label="Позначити сповіщення як прочитане">✓</button>`}
            </div>
        </div>`;
    }

    // Determine quick actions based on alert type
    let actionsHtml = '';
    if (a.id?.startsWith('unconfirmed_')) {
        actionsHtml = `<div class="ap-actions">
            <button class="ap-act ap-act-primary" onclick="event.stopPropagation();_quickAction('${id}','confirm')">✅ Підтвердити</button>
            <button class="ap-act ap-act-secondary" onclick="event.stopPropagation();_quickAction('${id}','call')">📞 Зателефонувати</button>
            <button class="ap-act ap-act-ghost" onclick="event.stopPropagation();_dismissAlert('${id}')">Сховати</button>
        </div>`;
    } else if (a.id?.startsWith('urgent_task_')) {
        actionsHtml = `<div class="ap-actions">
            <button class="ap-act ap-act-primary" onclick="event.stopPropagation();_goAlert('${link}','${id}')">Відкрити</button>
            <button class="ap-act ap-act-secondary" onclick="event.stopPropagation();_quickAction('${id}','reschedule')">Вказати час</button>
            <button class="ap-act ap-act-ghost" onclick="event.stopPropagation();_dismissAlert('${id}')">Сховати</button>
        </div>`;
    } else if (a.id?.startsWith('overdue_')) {
        actionsHtml = `<div class="ap-actions">
            <button class="ap-act ap-act-primary" onclick="event.stopPropagation();_goAlert('${link}','${id}')">📋 Відкрити</button>
            <button class="ap-act ap-act-secondary" onclick="event.stopPropagation();_quickAction('${id}','reschedule')">📅 Перенести</button>
            <button class="ap-act ap-act-ghost" onclick="event.stopPropagation();_quickAction('${id}','task')">📝 Задача</button>
        </div>`;
    } else if (a.id?.startsWith('stock_')) {
        actionsHtml = `<div class="ap-actions">
            <button class="ap-act ap-act-primary" onclick="event.stopPropagation();_quickAction('${id}','order')">🛒 Замовити</button>
            <button class="ap-act ap-act-ghost" onclick="event.stopPropagation();_dismissAlert('${id}')">Сховати</button>
        </div>`;
    } else if (a.id === 'cold_leads') {
        actionsHtml = `<div class="ap-actions">
            <button class="ap-act ap-act-primary" onclick="event.stopPropagation();_goAlert('${link}','${id}')">📞 Обдзвонити</button>
            <button class="ap-act ap-act-secondary" onclick="event.stopPropagation();_quickAction('${id}','task')">📝 Задача</button>
        </div>`;
    } else if (a.id === 'no_shift') {
        actionsHtml = `<div class="ap-actions">
            <button class="ap-act ap-act-primary" onclick="event.stopPropagation();_goAlert('${link}','${id}')">💰 Відкрити касу</button>
        </div>`;
    } else if (_isOmniAccountAlert(a)) {
        const primaryLabel = _esc(a.action?.label || 'Підключити канал');
        actionsHtml = `<div class="ap-actions">
            <button class="ap-act ap-act-primary" onclick="event.stopPropagation();_goAlert('${link}','${id}')">${primaryLabel}</button>
            <button class="ap-act ap-act-secondary" onclick="event.stopPropagation();_goAlert('${link}','${id}')">Відкрити вкладку</button>
            <button class="ap-act ap-act-ghost" onclick="event.stopPropagation();_dismissAlert('${id}')">Сховати</button>
        </div>`;
    } else if (a.action) {
        actionsHtml = `<div class="ap-actions">
            <button class="ap-act ap-act-primary" onclick="event.stopPropagation();_alertCreateTask('${id}')">${a.action.label}</button>
            <button class="ap-act ap-act-ghost" onclick="event.stopPropagation();_dismissAlert('${id}')">Сховати</button>
        </div>`;
    }

    return `<div class="ap-item ${levelClass}${isRead ? ' read' : ''}" data-alert-id="${id}">
        <div class="ap-item-main" onclick="_goAlert('${link}','${id}')">
            <span class="ap-icon">${a.icon || '⚠️'}</span>
            <div class="ap-content">
                <div class="ap-item-title">${a.title || ''}</div>
                ${a.message ? `<div class="ap-item-desc">${a.type === 'hr_deadline' ? escapeHtml(`${a.message} · ${a.dueDate}`) : a.message}</div>` : ''}
            </div>
            <button class="ap-dismiss" onclick="event.stopPropagation();_dismissAlert('${id}')" title="Сховати">✕</button>
        </div>
        ${actionsHtml}
        <div class="ap-task-area" id="taskArea_${id}"></div>
    </div>`;
}

function _esc(s) { return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

function _alertDateTimeLocalValue(date = new Date()) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    local.setSeconds(0, 0);
    return local.toISOString().slice(0, 16);
}

function _isOmniAccountAlert(a) {
    const id = String(a?.id || '').toLowerCase();
    const source = String(a?.source || '').toLowerCase();
    const link = String(a?.link || '').toLowerCase();
    return source === 'omni_accounts'
        || id.startsWith('omni_')
        || link.startsWith('/omni?panel=accounts');
}

// ─── Quick actions ──────────────────────────────
async function _quickAction(alertId, action) {
    const alert = _alertsData.find(a => a.id === alertId);
    if (!alert) return;

    if (action === 'confirm' && alert.bookingId) {
        try {
            const fetchWithAuth = typeof apiFetchWithAuthRetry === 'function' ? apiFetchWithAuthRetry : fetch;
            const res = await fetchWithAuth(`/api/bookings/${encodeURIComponent(alert.bookingId)}/confirm`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source: 'alerts' })
            });
            if (res.ok) {
                if (typeof showNotification === 'function') showNotification('Бронювання підтверджено!', 'success');
                _dismissAlert(alertId);
                loadAlertBell();
                return;
            }
        } catch {}
        if (typeof showNotification === 'function') showNotification('Помилка підтвердження', 'error');
    } else if (action === 'call') {
        if (typeof showNotification === 'function') showNotification('Відкрийте бронювання для дзвінка', 'info');
        _goAlert(alert.link, alertId);
    } else if (action === 'reschedule') {
        const isUrgentTask = alert.id?.startsWith('urgent_task_');
        const promptText = isUrgentTask
            ? (alert.action?.commitmentQuestion || 'Коли візьмете термінову задачу в роботу?')
            : 'Нова дата дедлайну:';
        const newDate = await promptModal(promptText, {
            inputType: isUrgentTask ? 'datetime-local' : 'date',
            defaultValue: isUrgentTask ? _alertDateTimeLocalValue(new Date(Date.now() + 60 * 60000)) : new Date().toISOString().slice(0, 10),
            okText: isUrgentTask ? 'Зберегти час' : 'Перенести'
        });
        if (!newDate) return;
        const taskId = alert.taskId;
        if (taskId) {
            try {
                const fetchWithAuth = typeof apiFetchWithAuthRetry === 'function' ? apiFetchWithAuthRetry : fetch;
                if (isUrgentTask) {
                    const commitmentAt = new Date(newDate).toISOString();
                    const res = await fetchWithAuth(`/api/tasks/${taskId}/commitment`, {
                        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ commitmentAt, sourceSurface: 'alerts_panel' })
                    });
                    if (!res.ok) throw new Error('commitment failed');
                    if (typeof showNotification === 'function') showNotification('Час для термінової задачі збережено', 'success');
                    _dismissAlert(alertId);
                    loadAlertBell();
                    return;
                }
                await fetchWithAuth(`/api/tasks/${taskId}/reschedule`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        schedule: { date: newDate, slot: 'morning', durationMinutes: 30 },
                        sourceSurface: 'alerts_panel'
                    })
                });
                if (typeof showNotification === 'function') showNotification('Дедлайн перенесено', 'success');
                _dismissAlert(alertId);
                loadAlertBell();
            } catch {
                if (typeof showNotification === 'function') showNotification('Не вдалося оновити час задачі', 'error');
            }
        }
    } else if (action === 'order') {
        const stockName = alert.stockItem || alert.title;
        const result = await formModal('Замовити товар', [
            { key: 'name', label: 'Товар', defaultValue: stockName, required: true },
            { key: 'qty', label: 'Кількість', type: 'number', required: true, placeholder: '10' },
            { key: 'note', label: 'Примітка', placeholder: 'Терміново' }
        ], { icon: '🛒' });
        if (!result) return;
        try {
            const fetchWithAuth = typeof apiFetchWithAuthRetry === 'function' ? apiFetchWithAuthRetry : fetch;
            await fetchWithAuth('/api/tasks', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: `Замовити: ${result.name} (${result.qty} шт)`, description: result.note || '', priority: 'high', category: 'purchase', source_type: 'alert', ownerUserId: _alertCurrentUserId() })
            });
            if (typeof showNotification === 'function') showNotification('Задачу на замовлення створено!', 'success');
            _dismissAlert(alertId);
        } catch {}
    } else if (action === 'task') {
        _alertCreateTask(alertId);
    }
}

// ─── Dismiss / Mark read ────────────────────────
function _dismissAlert(alertId) {
    const d = _getDismissed(); d.add(alertId); _saveDismissed(d);
    const el = document.querySelector(`[data-alert-id="${alertId}"]`);
    if (el) { el.style.transition = 'all 0.3s'; el.style.opacity = '0'; el.style.maxHeight = '0'; el.style.margin = '0'; el.style.padding = '0'; setTimeout(() => el.remove(), 300); }
    _alertsData = _alertsData.filter(a => a.id !== alertId);
    _syncAlertBadge();
    _emitAlertsUpdated();
    if (!_alertsData.length) setTimeout(_renderPanel, 350);
}

async function _markAllRead() {
    const scopeVersion = _alertScopeVersion;
    if (_controlCompletionUnread && !await _saveControlRead({ all: true })) return;
    if (scopeVersion !== _alertScopeVersion) return;
    const r = _getRead();
    _alertsData.filter(a => a.type !== 'control_completion').forEach(a => r.add(a.id));
    _saveRead(r);
    _emitAlertsUpdated();
    void _renderPanel();
}

// ─── Navigate ───────────────────────────────────
function _goAlert(link, id) {
    if (id) { const r = _getRead(); r.add(id); _saveRead(r); }
    _closeAlertsPanel();
    _emitAlertsUpdated();
    loadAlertBell();
    if (!link) return;
    let targetUrl;
    try {
        targetUrl = new URL(link, window.location.origin);
    } catch {
        window.location.href = link;
        return;
    }
    if (targetUrl.origin !== window.location.origin) {
        window.location.href = targetUrl.href;
        return;
    }
    const currentPath = window.location.pathname;
    const linkBase = targetUrl.pathname;
    if (linkBase === currentPath) {
        if (targetUrl.hash === '#hr-personal-reminders' && typeof window.switchTab === 'function') {
            Promise.resolve(window.switchTab('myday')).then(() => {
                document.getElementById('hr-personal-reminders')?.scrollIntoView({ block: 'start' });
            });
            return;
        }
        const nextPath = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
        const currentFullPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (nextPath !== currentFullPath) window.history.pushState(null, '', nextPath);
        const openTask = targetUrl.searchParams.get('open');
        if (openTask && typeof window.openTaskDetail === 'function') { window.openTaskDetail(parseInt(openTask)); return; }
        const highlight = targetUrl.searchParams.get('highlight');
        if (highlight) {
            const el = document.querySelector(`[data-booking-id="${highlight}"]`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('highlight-pulse');
            }
        }
        try {
            window.dispatchEvent(new CustomEvent('crm:alert-navigate', { detail: { url: targetUrl, alertId: id } }));
        } catch {}
        return;
    }
    window.location.href = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
}

// ─── Task creation (expanded inline) ────────────
async function _alertCreateTask(alertId) {
    const alert = _alertsData.find(a => a.id === alertId);
    if (!alert) return;
    const area = document.getElementById('taskArea_' + alertId.replace(/'/g, ''));
    if (!area) return;
    if (area.innerHTML) { area.innerHTML = ''; return; }
    const prompt = alert.action?.prompt || alert.title || '';
    area.innerHTML = `<div class="ap-task-form">
        <textarea class="ap-task-input" placeholder="Опис задачі...">${prompt}</textarea>
        <div class="ap-task-form-actions">
            <button class="ap-act ap-act-primary" onclick="_submitAlertTask(this,'${_esc(alertId)}')">📋 Поставити задачу</button>
            <button class="ap-act ap-act-ghost" onclick="this.closest('.ap-task-form').parentElement.innerHTML=''">Скасувати</button>
        </div>
    </div>`;
    area.querySelector('textarea').focus();
}

async function _submitAlertTask(btn, alertId) {
    const alert = _alertsData.find(a => a.id === alertId);
    const form = btn.closest('.ap-task-form');
    const text = form.querySelector('textarea').value.trim();
    if (!text) return;
    btn.disabled = true; btn.textContent = '⏳';
    try {
        const fetchWithAuth = typeof apiFetchWithAuthRetry === 'function' ? apiFetchWithAuthRetry : fetch;
        const resp = await fetchWithAuth('/api/tasks', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: text.slice(0, 100),
                description: text,
                date: new Date().toISOString().slice(0, 10),
                priority: alert?.level === 'critical' ? 'high' : 'normal',
                task_mode: 'work',
                task_kind: alert?.level === 'critical' ? 'followup' : 'reminder',
                visibility: 'team',
                workflow_state: 'inbox',
                source_type: 'alert',
                source_id: alertId,
                source_module: 'alerts',
                ownerUserId: _alertCurrentUserId(),
                related_entity_type: alert?.type || 'alert',
                related_entity_id: alertId
            })
        });
        if (!resp) return;
        if (resp.ok) {
            const data = await resp.json();
            const taskId = data.task?.id || data.id || '';
            form.innerHTML = `<div style="color:#22c55e;font-size:12px;padding:6px">✅ Задачу #${taskId} створено! <a href="/tasks?open=${taskId}" style="color:#22c55e;text-decoration:underline">Відкрити</a></div>`;
            setTimeout(() => { form.parentElement.innerHTML = ''; _dismissAlert(alertId); }, 3000);
        } else { btn.disabled = false; btn.textContent = '📋 Спробувати ще'; }
    } catch { btn.disabled = false; btn.textContent = '📋 Поставити задачу'; }
}

// ─── Outside click + init ───────────────────────
document.addEventListener('click', e => {
    const p = document.getElementById('alertsPanel');
    const trigger = e.target.closest?.('#sidebarAlertWidget');
    if (p?.classList.contains('open') && !trigger && !p.contains(e.target)) _closeAlertsPanel();
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') _closeAlertsPanel();
});

function startAlertRuntime() {
    if (_alertRuntimeStarted) return false;
    if (typeof window.isAuthenticatedRuntimeReady !== 'function' || !window.isAuthenticatedRuntimeReady()) return false;

    _alertRuntimeStarted = true;
    _ensureAlertElements();
    void loadAlertBell();
    const refreshVisibleAlerts = () => {
        if (document.hidden) return;
        if (document.getElementById('alertsPanel')?.classList.contains('open')) void _renderPanel();
        else void loadAlertBell();
    };
    _alertInterval = setInterval(refreshVisibleAlerts, 60000);
    document.addEventListener('visibilitychange', refreshVisibleAlerts);
    window.addEventListener('online', refreshVisibleAlerts);
    window.addEventListener('beforeunload', () => {
        clearInterval(_alertInterval);
        document.removeEventListener('visibilitychange', refreshVisibleAlerts);
        window.removeEventListener('online', refreshVisibleAlerts);
    });
    window.addEventListener('ws:alert', (e) => {
        if (document.hidden) return;
        const { payload } = e.detail || {};
        // Empty broadcasts carry no business data; refresh through the scoped HTTP API.
        if (payload?.alerts?.length) {
            const dismissed = _getDismissed();
            const personal = _alertsData.filter(a => a.type === 'hr_deadline' || a.type === 'control_completion');
            const changed = _replaceAlertsData([...personal, ...payload.alerts].filter(a => !dismissed.has(a.id)));
            _syncAlertBadge();
            _emitAlertsUpdated();
            const p = document.getElementById('alertsPanel');
            if (p?.classList.contains('open') && changed) _renderPanel();
        } else if (document.getElementById('alertsPanel')?.classList.contains('open')) {
            void _renderPanel();
        } else {
            void loadAlertBell();
        }
    });
    // Clear old dismissed (>24h)
    try { const d = _getDismissed(); if (d.size > 50) { localStorage.removeItem(_ALERTS_DISMISSED_KEY); } } catch {}
    return true;
}

document.addEventListener('DOMContentLoaded', () => {
    startAlertRuntime();
});

window.addEventListener('crm:authenticated-runtime-ready', startAlertRuntime);
window.addEventListener('crmBusinessScopeChanged', () => {
    _alertScopeVersion++;
    _controlCompletionUnread = 0;
    _replaceAlertsData([]);
    _closeAlertsPanel();
    const badge = document.getElementById('alertBadge');
    if (badge) _updateBadge(badge, []);
    _emitAlertsUpdated();
    void loadAlertBell();
});

window._closeAlertsPanel = _closeAlertsPanel;
