/**
 * js/alerts.js — Global Alert Bell v1.0
 * Підключити: <script src="js/alerts.js?v=33.5.0"></script>
 * Потрібно: #alertBell (button), #alertBadge (span), #alertsPanel (div)
 */
const _ALERTS_KEY = 'crm_alerts_read_v1';
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
        const read   = _getRead();
        const unread = alerts.filter(a => !read.has(a.id));
        if (!unread.length) { badge.style.display = 'none'; return; }
        badge.style.display  = 'flex';
        badge.textContent    = unread.length;
        badge.className      = 'alert-badge' + (unread.some(a => a.level === 'critical') ? ' critical' : '');
    } catch { /* silent */ }
}

function toggleAlertsPanel() {
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
        if (!alerts.length) {
            p.innerHTML = '<div class="alerts-empty">✅ Все в порядку</div>';
            return;
        }
        p.innerHTML = alerts.map(a => `
            <div class="alert-item ${a.level}" onclick="_goAlert('${a.link}','${a.id}')">
                <strong>${a.title}</strong>
                ${a.message ? `<div style="font-size:12px;margin-top:3px;opacity:.7">${a.message}</div>` : ''}
            </div>`).join('');
    } catch { p.innerHTML = '<div class="alerts-empty">Помилка завантаження</div>'; }
}

function _goAlert(link, id) {
    const r = _getRead(); r.add(id); _saveRead(r);
    document.getElementById('alertsPanel')?.classList.remove('open');
    loadAlertBell();
    if (link) window.location.href = link;
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
    setInterval(loadAlertBell, 300000);
});
