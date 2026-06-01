/**
 * js/alerts.js — Global Alert Bell v4.0 (self-injecting, interactive)
 * v39.8.0 — Interactive alerts: inline actions, swipe dismiss, grouped by type
 */
const _ALERTS_KEY = 'crm_alerts_read_v2';
const _ALERTS_DISMISSED_KEY = 'crm_alerts_dismissed';
let _alertsData = [];

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
    const badge = document.getElementById('alertBadge');
    try {
        const fetchWithAuth = typeof apiFetchWithAuthRetry === 'function' ? apiFetchWithAuthRetry : fetch;
        const res = await fetchWithAuth('/api/dashboard/alerts', { headers: {} });
        if (!res) return;
        if (!res.ok) return;
        const data = await res.json();
        const alerts = data.alerts || [];
        const dismissed = _getDismissed();
        _replaceAlertsData(alerts.filter(a => !dismissed.has(a.id)));
        const read = _getRead();
        const unread = _alertsData.filter(a => !read.has(a.id));
        if (badge) _updateBadge(badge, unread);
        _emitAlertsUpdated();
    } catch { /* silent */ }
}

function _updateBadge(badge, unread) {
    if (!unread.length) { badge.style.display = 'none'; return; }
    badge.style.display = 'flex';
    badge.textContent = unread.length > 99 ? '99+' : unread.length;
    const hasCritical = unread.some(a => a.level === 'critical');
    badge.classList.toggle('critical', hasCritical);
    badge.classList.toggle('pulse', hasCritical);
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
    try {
        const fetchWithAuth = typeof apiFetchWithAuthRetry === 'function' ? apiFetchWithAuthRetry : fetch;
        const res = await fetchWithAuth('/api/dashboard/alerts', { headers: {} });
        if (!res) return;
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        const alerts = data.alerts || [];
        const dismissed = _getDismissed();
        _replaceAlertsData(alerts.filter(a => !dismissed.has(a.id)));
        _emitAlertsUpdated();

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
        const unreadCount = _alertsData.filter(a => !read.has(a.id)).length;

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
            ${_alertsData.length > 0 ? `<button class="ap-mark-all" onclick="_markAllRead()" title="Позначити все як прочитане">✓</button>` : ''}
            <button class="ap-close" type="button" onclick="_closeAlertsPanel()" aria-label="Закрити">×</button>
        </div>`;

        let body = '';
        if (critical.length) body += _renderGroup('🔴 Терміново', critical, read);
        if (warnings.length) body += _renderGroup('⚠️ Увага', warnings, read);
        if (info.length) body += _renderGroup('ℹ️ Інформація', info, read);

        p.innerHTML = header + `<div class="ap-body">${body}</div>`;
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

function _renderGroup(title, alerts, read) {
    const items = alerts.map(a => _renderAlertItem(a, read.has(a.id))).join('');
    return `<div class="ap-group"><div class="ap-group-title">${title} <span class="ap-group-count">${alerts.length}</span></div>${items}</div>`;
}

function _renderAlertItem(a, isRead) {
    const id = _esc(a.id || '');
    const link = _esc(a.link || '');
    const levelClass = a.level || 'info';

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
                ${a.message ? `<div class="ap-item-desc">${a.message}</div>` : ''}
            </div>
            <button class="ap-dismiss" onclick="event.stopPropagation();_dismissAlert('${id}')" title="Сховати">✕</button>
        </div>
        ${actionsHtml}
        <div class="ap-task-area" id="taskArea_${id}"></div>
    </div>`;
}

function _esc(s) { return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

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
        const promptText = isUrgentTask ? 'Коли візьмете термінову задачу в роботу?' : 'Нова дата дедлайну:';
        const newDate = await promptModal(promptText, { inputType: 'date', defaultValue: new Date().toISOString().slice(0, 10) });
        if (!newDate) return;
        const taskId = alert.taskId;
        if (taskId) {
            try {
                const fetchWithAuth = typeof apiFetchWithAuthRetry === 'function' ? apiFetchWithAuthRetry : fetch;
                await fetchWithAuth(`/api/tasks/${taskId}/reschedule`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        schedule: { date: newDate, slot: 'morning', durationMinutes: 30 },
                        sourceSurface: 'alerts_panel'
                    })
                });
                if (typeof showNotification === 'function') showNotification(isUrgentTask ? 'Час для термінової задачі оновлено' : 'Дедлайн перенесено', 'success');
                _dismissAlert(alertId);
                loadAlertBell();
            } catch {}
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
    const badge = document.getElementById('alertBadge');
    if (badge) { const read = _getRead(); _updateBadge(badge, _alertsData.filter(a => !read.has(a.id))); }
    _emitAlertsUpdated();
    if (!_alertsData.length) setTimeout(_renderPanel, 350);
}

function _markAllRead() {
    const r = _getRead();
    _alertsData.forEach(a => r.add(a.id));
    _saveRead(r);
    _emitAlertsUpdated();
    loadAlertBell();
    _renderPanel();
}

// ─── Navigate ───────────────────────────────────
function _goAlert(link, id) {
    const r = _getRead(); r.add(id); _saveRead(r);
    _closeAlertsPanel();
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

document.addEventListener('DOMContentLoaded', () => {
    _ensureAlertElements();
    loadAlertBell();
    const _alertInterval = setInterval(loadAlertBell, 1800000);
    window.addEventListener('beforeunload', () => clearInterval(_alertInterval));
    window.addEventListener('ws:alert', (e) => {
        const { payload } = e.detail || {};
        if (payload?.alerts) {
            const dismissed = _getDismissed();
            const changed = _replaceAlertsData(payload.alerts.filter(a => !dismissed.has(a.id)));
            const badge = document.getElementById('alertBadge');
            if (badge) { const read = _getRead(); _updateBadge(badge, _alertsData.filter(a => !read.has(a.id))); }
            _emitAlertsUpdated();
            const p = document.getElementById('alertsPanel');
            if (p?.classList.contains('open') && changed) _renderPanel();
        } else { loadAlertBell(); }
    });
    // Clear old dismissed (>24h)
    try { const d = _getDismissed(); if (d.size > 50) { localStorage.removeItem(_ALERTS_DISMISSED_KEY); } } catch {}
});

window._closeAlertsPanel = _closeAlertsPanel;
