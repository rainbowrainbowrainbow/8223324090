/**
 * js/alerts.js — Global Alert Bell v2.0
 * Підключити: <script src="js/alerts.js?v=39.4.1"></script>
 * Потрібно: #alertBell (button), #alertBadge (span), #alertsPanel (div)
 */
const _ALERTS_KEY = 'crm_alerts_read_v1';
let _alertsData = []; // cached alerts

function _getRead() {
    try { return new Set(JSON.parse(localStorage.getItem(_ALERTS_KEY) || '[]')); }
    catch { return new Set(); }
}
function _saveRead(s) { localStorage.setItem(_ALERTS_KEY, JSON.stringify([...s])); }

async function loadAlertBell() {
    const badge = document.getElementById('alertBadge');
    if (!badge) return;
    try {
        const token = localStorage.getItem('pzp_token');
        if (!token) return;
        const res = await fetch('/api/dashboard/alerts', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const { alerts = [] } = await res.json();
        _alertsData = alerts;
        const read   = _getRead();
        const unread = alerts.filter(a => !read.has(a.id));
        if (!unread.length) { badge.style.display = 'none'; return; }
        badge.style.display  = 'flex';
        badge.textContent    = unread.length;
        badge.className      = 'alert-badge' + (unread.some(a => a.level === 'critical') ? ' critical' : '');
    } catch { /* silent */ }
}

function toggleAlertsPanel(e) {
    if (e) e.stopPropagation();
    const p = document.getElementById('alertsPanel');
    if (!p) return;
    p.classList.toggle('open');
    if (p.classList.contains('open')) _renderPanel();
}

async function _renderPanel() {
    const p = document.getElementById('alertsPanel');
    if (!p) return;
    try {
        const token = localStorage.getItem('pzp_token');
        const res   = await fetch('/api/dashboard/alerts', { headers: { 'Authorization': `Bearer ${token}` } });
        const { alerts = [] } = await res.json();
        _alertsData = alerts;
        if (!alerts.length) {
            p.innerHTML = '<div class="alerts-empty">✅ Все в порядку</div>';
            return;
        }
        const read = _getRead();
        p.innerHTML = alerts.map(a => {
            const isRead = read.has(a.id);
            const link = _escAttr(a.link || '');
            const id = _escAttr(a.id || '');
            return `
            <div class="alert-item ${a.level}${isRead ? ' read' : ''}" data-alert-id="${id}">
                <div class="alert-item-body" onclick="_goAlert('${link}','${id}')" style="cursor:pointer">
                    <span class="alert-icon">${a.icon || '⚠️'}</span>
                    <div class="alert-text">
                        <strong>${a.title || ''}</strong>
                        ${a.message ? `<div style="font-size:12px;margin-top:2px;opacity:.7">${a.message}</div>` : ''}
                    </div>
                </div>
                ${a.action ? `<button class="alert-action-btn" onclick="event.stopPropagation();_alertCreateTask('${id}')">${a.action.label}</button>` : ''}
            </div>`;
        }).join('');
    } catch { p.innerHTML = '<div class="alerts-empty">Помилка завантаження</div>'; }
}

function _escAttr(s) { return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

function _goAlert(link, id) {
    const r = _getRead(); r.add(id); _saveRead(r);
    document.getElementById('alertsPanel')?.classList.remove('open');
    loadAlertBell();
    if (!link) return;

    // Same-page navigation — don't reload, just scroll/highlight
    const currentPath = window.location.pathname;
    const [linkPath, linkQuery] = link.split('?');
    const linkBase = linkPath.split('#')[0];
    const linkHash = linkPath.includes('#') ? linkPath.split('#')[1] : '';

    if (linkBase === currentPath) {
        // Same page — handle hash change or query params
        if (linkHash) {
            window.location.hash = '#' + linkHash;
        }
        if (linkQuery) {
            // Parse ?open=123 for task modal
            const params = new URLSearchParams(linkQuery);
            const openTask = params.get('open');
            if (openTask && typeof window.openTaskDetail === 'function') {
                window.openTaskDetail(parseInt(openTask));
                return;
            }
        }
        if (!linkHash && !linkQuery) return; // truly same page, nothing to do
        return;
    }

    window.location.href = link;
}

async function _alertCreateTask(alertId) {
    const alert = _alertsData.find(a => a.id === alertId);
    if (!alert || !alert.action) return;

    const el = document.querySelector(`[data-alert-id="${alertId}"]`);
    if (!el) return;
    var existing = el.querySelector('.alert-task-form');
    if (existing) { existing.remove(); return; }

    const prompt = alert.action.prompt || '';
    const assignRole = alert.action.assignRole || '';

    var form = document.createElement('div');
    form.className = 'alert-task-form';
    form.style.cssText = 'margin-top:6px;padding:8px;background:rgba(0,0,0,0.03);border:1px solid var(--primary,#10B981);border-radius:8px';
    form.innerHTML = `<textarea style="width:100%;padding:6px;border:1px solid var(--gray-200);border-radius:6px;font-size:13px;resize:none;height:50px;box-sizing:border-box;font-family:inherit">${prompt}</textarea>
        ${assignRole ? `<div style="font-size:11px;color:var(--gray-500);margin-top:4px">Призначити: <b>${assignRole}</b></div>` : ''}
        <div style="display:flex;gap:6px;margin-top:6px">
        <button onclick="_submitAlertTask(this,'${alertId}')" style="flex:1;padding:6px;background:var(--primary,#10B981);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;font-weight:700">📋 Поставити задачу</button>
        <button onclick="this.closest('.alert-task-form').remove()" style="padding:6px 10px;border:1px solid var(--gray-200);border-radius:6px;background:none;cursor:pointer;font-size:12px;font-family:inherit">✕</button></div>`;
    el.appendChild(form);
    form.querySelector('textarea').focus();
}

async function _submitAlertTask(btn, alertId) {
    const alert = _alertsData.find(a => a.id === alertId);
    var form = btn.closest('.alert-task-form');
    var text = form.querySelector('textarea').value.trim();
    if (!text) return;
    btn.disabled = true; btn.textContent = '⏳';
    try {
        var token = localStorage.getItem('pzp_token');
        const assignRole = alert?.action?.assignRole || null;
        // Find a user with the assigned role to assign the task
        let assignedTo = null;
        if (assignRole) {
            try {
                const usersRes = await fetch('/api/users', { headers: { 'Authorization': 'Bearer ' + token } });
                const users = await usersRes.json();
                const userList = Array.isArray(users) ? users : (users.data || []);
                const match = userList.find(u => u.role === assignRole && u.is_active !== false);
                if (match) assignedTo = match.username;
            } catch {}
        }
        const today = new Date().toISOString().slice(0, 10);
        const body = {
            title: text.slice(0, 100),
            description: text,
            date: today,
            priority: alert?.level === 'critical' ? 'high' : 'normal',
            category: alertId.startsWith('stock') ? 'purchase' : alertId.startsWith('cold') ? 'admin' : 'admin',
            source_type: 'alert',
            assigned_to: assignedTo
        };
        var resp = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify(body)
        });
        if (resp.ok) {
            const data = await resp.json();
            const taskId = data.task?.id || data.id || '';
            form.innerHTML = `<div style="color:#10B981;font-size:12px;padding:4px">✅ Задачу #${taskId} поставлено${assignedTo ? ' → ' + assignedTo : ''}! <a href="/tasks?open=${taskId}" style="color:#10B981;text-decoration:underline">Відкрити</a></div>`;
            setTimeout(() => form.remove(), 5000);
        } else {
            const errData = await resp.json().catch(() => ({}));
            form.innerHTML = `<div style="color:#EF4444;font-size:12px;padding:4px">❌ ${errData.error || 'Помилка створення (HTTP ' + resp.status + ')'}</div>`;
            setTimeout(() => { btn.disabled = false; btn.textContent = '📋 Спробувати ще'; form.querySelector('div')?.remove(); }, 3000);
        }
    } catch { btn.disabled = false; btn.textContent = '📋 Поставити задачу'; }
}

// Close on outside click
document.addEventListener('click', e => {
    const p = document.getElementById('alertsPanel');
    const b = document.getElementById('alertBell');
    if (p && b && !b.contains(e.target) && !p.contains(e.target))
        p.classList.remove('open');
});

document.addEventListener('DOMContentLoaded', () => {
    loadAlertBell();

    // v39.7.0 — WebSocket push for real-time alerts (fallback polling every 30 min)
    const _alertInterval = setInterval(loadAlertBell, 1800000);
    window.addEventListener('beforeunload', () => clearInterval(_alertInterval));

    // Listen for WS alert push events
    window.addEventListener('ws:alert', (e) => {
        const { payload } = e.detail || {};
        if (payload && payload.alerts) {
            // Direct alert data from WS — update immediately
            _alertsData = payload.alerts;
            const badge = document.getElementById('alertBadge');
            if (badge) {
                const read = _getRead();
                const unread = _alertsData.filter(a => !read.has(a.id));
                if (!unread.length) { badge.style.display = 'none'; }
                else {
                    badge.style.display = 'flex';
                    badge.textContent = unread.length > 99 ? '99+' : unread.length;
                    badge.className = 'alert-badge' + (unread.some(a => a.level === 'critical') ? ' critical' : '');
                }
            }
            // Re-render panel if it's open
            const p = document.getElementById('alertsPanel');
            if (p && p.classList.contains('open')) _renderPanel();
        } else {
            // No inline data — refetch
            loadAlertBell();
        }
    });

    // Auto-open task from URL ?open=ID
    const params = new URLSearchParams(window.location.search);
    const openTask = params.get('open');
    if (openTask) {
        // Wait for page to load, then try to open task
        setTimeout(() => {
            if (typeof window.openTaskDetail === 'function') {
                window.openTaskDetail(parseInt(openTask));
            }
        }, 500);
    }
});
