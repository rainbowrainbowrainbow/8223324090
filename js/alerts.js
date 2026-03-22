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
        if (!alerts.length) {
            p.innerHTML = '<div class="alerts-empty">✅ Все в порядку</div>';
            return;
        }
        p.innerHTML = alerts.map(a => `
            <div class="alert-item ${a.level}" data-alert-id="${a.id}">
                <div onclick="_goAlert('${a.link}','${a.id}')" style="cursor:pointer">
                    <strong>${a.title}</strong>
                    ${a.message ? `<div style="font-size:12px;margin-top:3px;opacity:.7">${a.message}</div>` : ''}
                </div>
                ${a.action ? `<button class="alert-action-btn" onclick="event.stopPropagation();_alertCreateTask('${a.id}',\`${(a.action.prompt||'').replace(/`/g,"'")}\`)">${a.action.label}</button>` : ''}
            </div>`).join('');
    } catch { p.innerHTML = '<div class="alerts-empty">Помилка завантаження</div>'; }
}

function _goAlert(link, id) {
    const r = _getRead(); r.add(id); _saveRead(r);
    document.getElementById('alertsPanel')?.classList.remove('open');
    loadAlertBell();
    if (link) window.location.href = link;
}

async function _alertCreateTask(alertId, prompt) {
    var el = document.querySelector(`[data-alert-id="${alertId}"]`);
    if (!el) return;
    var existing = el.querySelector('.alert-task-form');
    if (existing) { existing.remove(); return; }
    var form = document.createElement('div');
    form.className = 'alert-task-form';
    form.style.cssText = 'margin-top:6px;padding:8px;background:var(--bg-secondary,#f8f9fa);border:1px solid var(--primary,#6366f1);border-radius:8px';
    form.innerHTML = `<textarea style="width:100%;padding:6px;border:1px solid var(--border-color);border-radius:6px;font-size:12px;resize:none;height:50px;box-sizing:border-box">${prompt}</textarea>
        <div style="display:flex;gap:6px;margin-top:6px">
        <button onclick="_submitAlertTask(this)" style="flex:1;padding:5px;background:var(--primary,#6366f1);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px">📋 Поставити задачу</button>
        <button onclick="this.closest('.alert-task-form').remove()" style="padding:5px 8px;border:1px solid var(--border-color);border-radius:6px;background:none;cursor:pointer;font-size:11px">✕</button></div>`;
    el.appendChild(form);
    form.querySelector('textarea').focus();
}
async function _submitAlertTask(btn) {
    var form = btn.closest('.alert-task-form');
    var text = form.querySelector('textarea').value.trim();
    if (!text) return;
    btn.disabled = true; btn.textContent = '⏳';
    try {
        var token = localStorage.getItem('pzp_token');
        var resp = await fetch('/api/tasks', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
            body: JSON.stringify({title:text.slice(0,100),description:text,priority:'normal',source_type:'alert'})});
        if (resp.ok) { form.innerHTML='<div style="color:green;font-size:12px;padding:4px">✅ Задачу поставлено!</div>'; setTimeout(()=>form.remove(),2000); }
    } catch { btn.disabled=false; btn.textContent='📋 Поставити задачу'; }
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
