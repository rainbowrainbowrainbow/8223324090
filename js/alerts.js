/**
 * js/alerts.js — Global Alert Bell v4.0 (self-injecting, interactive)
 * v39.8.0 — Interactive alerts: inline actions, swipe dismiss, grouped by type
 */
const _ALERTS_KEY = 'crm_alerts_read_v2';
const _ALERTS_DISMISSED_KEY = 'crm_alerts_dismissed';
let _alertsData = [];

// ─── Self-inject bell + panel ───────────────────
function _ensureAlertElements() {
    if (document.getElementById('alertBell')) return;
    const header = document.querySelector('.header-actions, .page-header .user-panel, .top-bar, header')
        || document.querySelector('[id$="Header"] .user-panel, .page-header');
    if (!header) return;
    const userPanel = header.querySelector('.user-panel') || header.querySelector('[id="currentUser"]')?.parentElement;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'alert-bell-btn';
    btn.id = 'alertBell';
    btn.onclick = (e) => toggleAlertsPanel(e);
    btn.title = 'Сповіщення';
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg><span class="alert-badge" id="alertBadge">0</span>`;
    if (userPanel) userPanel.parentElement.insertBefore(btn, userPanel);
    else header.appendChild(btn);

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

// ─── Badge update ───────────────────────────────
async function loadAlertBell() {
    const badge = document.getElementById('alertBadge');
    if (!badge) return;
    try {
        const token = localStorage.getItem('pzp_token');
        if (!token) return;
        const res = await fetch('/api/dashboard/alerts', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        const alerts = data.alerts || [];
        const dismissed = _getDismissed();
        _alertsData = alerts.filter(a => !dismissed.has(a.id));
        const read = _getRead();
        const unread = _alertsData.filter(a => !read.has(a.id));
        _updateBadge(badge, unread);
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

// ─── Panel toggle ───────────────────────────────
function toggleAlertsPanel(e) {
    if (e) e.stopPropagation();
    const p = document.getElementById('alertsPanel');
    if (!p) return;
    const isOpen = p.classList.contains('open');
    if (isOpen) { p.classList.remove('open'); }
    else { p.classList.add('open'); _renderPanel(); }
}

// ─── Interactive Panel Render ───────────────────
async function _renderPanel() {
    const p = document.getElementById('alertsPanel');
    if (!p) return;
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch('/api/dashboard/alerts', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        const alerts = data.alerts || [];
        const dismissed = _getDismissed();
        _alertsData = alerts.filter(a => !dismissed.has(a.id));

        if (!_alertsData.length) {
            p.innerHTML = `<div class="ap-header"><span class="ap-title">🔔 Сповіщення</span></div>
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
            <span class="ap-title">🔔 Сповіщення</span>
            <span class="ap-count">${unreadCount ? unreadCount + ' нових' : 'Все прочитано'}</span>
            ${_alertsData.length > 0 ? `<button class="ap-mark-all" onclick="_markAllRead()" title="Позначити все як прочитане">✓</button>` : ''}
        </div>`;

        let body = '';
        if (critical.length) body += _renderGroup('🔴 Терміново', critical, read);
        if (warnings.length) body += _renderGroup('⚠️ Увага', warnings, read);
        if (info.length) body += _renderGroup('ℹ️ Інформація', info, read);

        p.innerHTML = header + `<div class="ap-body">${body}</div>`;
    } catch {
        p.innerHTML = `<div class="ap-header"><span class="ap-title">🔔 Сповіщення</span></div><div class="ap-empty"><div class="ap-empty-icon">❌</div><div class="ap-empty-text">Помилка завантаження</div></div>`;
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

// ─── Quick actions ──────────────────────────────
async function _quickAction(alertId, action) {
    const alert = _alertsData.find(a => a.id === alertId);
    if (!alert) return;
    const token = localStorage.getItem('pzp_token');

    if (action === 'confirm' && alert.bookingId) {
        try {
            const res = await fetch(`/api/bookings/${alert.bookingId}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ status: 'confirmed' })
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
        const newDate = await promptModal('Нова дата дедлайну:', { inputType: 'date', defaultValue: new Date().toISOString().slice(0, 10) });
        if (!newDate) return;
        const taskId = alert.taskId;
        if (taskId) {
            try {
                await fetch(`/api/tasks/${taskId}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ deadline: newDate + 'T23:59:59Z' })
                });
                if (typeof showNotification === 'function') showNotification('Дедлайн перенесено', 'success');
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
            await fetch('/api/tasks', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ title: `Замовити: ${result.name} (${result.qty} шт)`, description: result.note || '', priority: 'high', category: 'purchase', source_type: 'alert' })
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
    if (!_alertsData.length) setTimeout(_renderPanel, 350);
}

function _markAllRead() {
    const r = _getRead();
    _alertsData.forEach(a => r.add(a.id));
    _saveRead(r);
    loadAlertBell();
    _renderPanel();
}

// ─── Navigate ───────────────────────────────────
function _goAlert(link, id) {
    const r = _getRead(); r.add(id); _saveRead(r);
    const p = document.getElementById('alertsPanel');
    if (p) p.classList.remove('open');
    loadAlertBell();
    if (!link) return;
    const currentPath = window.location.pathname;
    const [linkPath, linkQuery] = link.split('?');
    const linkBase = linkPath.split('#')[0];
    const linkHash = linkPath.includes('#') ? linkPath.split('#')[1] : '';
    if (linkBase === currentPath) {
        if (linkHash) window.location.hash = '#' + linkHash;
        if (linkQuery) {
            const params = new URLSearchParams(linkQuery);
            const openTask = params.get('open');
            if (openTask && typeof window.openTaskDetail === 'function') { window.openTaskDetail(parseInt(openTask)); return; }
            const highlight = params.get('highlight');
            if (highlight) { const el = document.querySelector(`[data-booking-id="${highlight}"]`); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('highlight-pulse'); } }
        }
        return;
    }
    window.location.href = link;
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
        const token = localStorage.getItem('pzp_token');
        const resp = await fetch('/api/tasks', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ title: text.slice(0, 100), description: text, date: new Date().toISOString().slice(0, 10), priority: alert?.level === 'critical' ? 'high' : 'normal', source_type: 'alert' })
        });
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
    const b = document.getElementById('alertBell');
    if (p && b && !b.contains(e.target) && !p.contains(e.target)) p.classList.remove('open');
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
            _alertsData = payload.alerts.filter(a => !dismissed.has(a.id));
            const badge = document.getElementById('alertBadge');
            if (badge) { const read = _getRead(); _updateBadge(badge, _alertsData.filter(a => !read.has(a.id))); }
            const p = document.getElementById('alertsPanel');
            if (p?.classList.contains('open')) _renderPanel();
        } else { loadAlertBell(); }
    });
    // Clear old dismissed (>24h)
    try { const d = _getDismissed(); if (d.size > 50) { localStorage.removeItem(_ALERTS_DISMISSED_KEY); } } catch {}
});
