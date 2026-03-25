/**
 * js/command-panel.js — Slide-in Command Panel (v20.8.0)
 * KPI dashboard + quick notes, slide-in from right edge
 * Always-visible FAB trigger accessible from any page
 */

const CommandPanel = (() => {
    let panelEl = null;
    let fabEl = null;
    let refreshInterval = null;
    let isOpen = false;

    const STORAGE_KEY = 'pzp_cmd_panel';
    const REFRESH_MS = 60000;

    function init() {
        if (panelEl) return;
        createFab();
        createPanel();
        loadState();
        refresh();
        refreshInterval = setInterval(refresh, REFRESH_MS);
    }

    function destroy() {
        if (refreshInterval) clearInterval(refreshInterval);
        if (panelEl) panelEl.remove();
        if (fabEl) fabEl.remove();
        panelEl = null;
        fabEl = null;
    }

    function createFab() {
        fabEl = document.createElement('button');
        fabEl.className = 'cmd-fab';
        fabEl.innerHTML = '&#9776;';
        fabEl.title = 'Командна панель';
        fabEl.setAttribute('aria-label', 'Відкрити командну панель');
        fabEl.addEventListener('click', show);
        document.body.appendChild(fabEl);
    }

    function createPanel() {
        panelEl = document.createElement('div');
        panelEl.className = 'cmd-panel cmd-panel--closed';
        panelEl.innerHTML = `
            <div class="cmd-panel-header">
                <span class="cmd-panel-title">Командна панель</span>
                <button class="cmd-btn-close" id="cmdCloseBtn" title="Закрити">&#10005;</button>
            </div>
            <div class="cmd-panel-body" id="cmdPanelBody">
                <div class="cmd-kpi" id="cmdKpi">
                    <div class="cmd-kpi-loading">Завантаження...</div>
                </div>
                <div class="cmd-notes-section">
                    <div class="cmd-notes-header">
                        <span>Замітки</span>
                        <button class="cmd-btn-add-note" id="cmdAddNote" title="Додати">+</button>
                    </div>
                    <div class="cmd-notes-list" id="cmdNotesList"></div>
                    <div class="cmd-note-form hidden" id="cmdNoteForm">
                        <input type="text" id="cmdNoteInput" maxlength="200" placeholder="Нова замітка...">
                        <label class="cmd-note-shared-label" id="cmdSharedLabel">
                            <input type="checkbox" id="cmdNoteShared"> Спільна
                        </label>
                        <button class="cmd-btn-save-note" id="cmdSaveNote">OK</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(panelEl);

        // Events
        document.getElementById('cmdCloseBtn')?.addEventListener('click', hide);
        document.getElementById('cmdAddNote')?.addEventListener('click', toggleNoteForm);
        document.getElementById('cmdSaveNote')?.addEventListener('click', saveNote);
        document.getElementById('cmdNoteInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveNote();
        });

        // Close on backdrop click (outside panel)
        panelEl.addEventListener('click', (e) => {
            if (e.target === panelEl) hide();
        });

        // Shared notes visibility by role
        const role = typeof getUserRole === 'function' ? getUserRole() : 'admin';
        const SHARED_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager'];
        if (!SHARED_ROLES.includes(role)) {
            document.getElementById('cmdSharedLabel')?.classList.add('hidden');
        }
    }

    function loadState() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            if (saved.open) show();
        } catch { /* ignore */ }
    }

    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ open: isOpen }));
        } catch { /* ignore */ }
    }

    function show() {
        if (!panelEl) init();
        isOpen = true;
        panelEl.classList.remove('cmd-panel--closed');
        panelEl.classList.add('cmd-panel--open');
        if (fabEl) fabEl.classList.add('hidden');
        saveState();
        refresh();
    }

    function hide() {
        isOpen = false;
        panelEl.classList.remove('cmd-panel--open');
        panelEl.classList.add('cmd-panel--closed');
        if (fabEl) fabEl.classList.remove('hidden');
        saveState();
    }

    // Data refresh
    async function refresh() {
        if (!panelEl || !isOpen) return;
        await Promise.all([refreshKpi(), refreshNotes()]);
    }

    async function refreshKpi() {
        try {
            const token = localStorage.getItem('pzp_token');
            const resp = await fetch('/api/board/stats', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!resp.ok) return;
            const d = await resp.json();

            const kpi = document.getElementById('cmdKpi');
            if (!kpi) return;

            kpi.innerHTML = `
                <div class="cmd-kpi-row">
                    <div class="cmd-kpi-item">
                        <span class="cmd-kpi-val cmd-kpi-blue">${d.bookings}</span>
                        <span class="cmd-kpi-lbl">бронювань</span>
                    </div>
                    <div class="cmd-kpi-item">
                        <span class="cmd-kpi-val cmd-kpi-green">${d.confirmed}</span>
                        <span class="cmd-kpi-lbl">підтверд</span>
                    </div>
                </div>
                <div class="cmd-kpi-row">
                    <div class="cmd-kpi-item">
                        <span class="cmd-kpi-val">${d.staffOnShift}</span>
                        <span class="cmd-kpi-lbl">на зміні</span>
                    </div>
                    <div class="cmd-kpi-item">
                        <span class="cmd-kpi-val">${d.tasksDone}/${d.tasksRemaining + d.tasksDone}</span>
                        <span class="cmd-kpi-lbl">задач</span>
                    </div>
                </div>
                ${d.revenue != null ? `<div class="cmd-kpi-revenue">${d.revenue.toLocaleString('uk-UA')} &#8372; сьогодні</div>` : ''}
            `;
        } catch { /* ignore */ }
    }

    async function refreshNotes() {
        try {
            const token = localStorage.getItem('pzp_token');
            const resp = await fetch('/api/board/notes', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!resp.ok) return;
            const notes = await resp.json();

            const list = document.getElementById('cmdNotesList');
            if (!list) return;

            if (notes.length === 0) {
                list.innerHTML = '<div class="cmd-notes-empty">Немає заміток</div>';
                return;
            }

            list.innerHTML = notes.map(n => `
                <div class="cmd-note-item ${n.is_shared ? 'shared' : ''}" data-id="${n.id}">
                    <span class="cmd-note-text">${escapeHtml(n.text)}</span>
                    ${n.is_shared ? '<span class="cmd-note-badge">спільна</span>' : ''}
                    <button class="cmd-note-del" onclick="CommandPanel.deleteNote(${n.id})" title="Видалити">&#10005;</button>
                </div>
            `).join('');
        } catch { /* ignore */ }
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function toggleNoteForm() {
        const form = document.getElementById('cmdNoteForm');
        form.classList.toggle('hidden');
        if (!form.classList.contains('hidden')) {
            document.getElementById('cmdNoteInput')?.focus();
        }
    }

    async function saveNote() {
        const input = document.getElementById('cmdNoteInput');
        const shared = document.getElementById('cmdNoteShared');
        const text = input.value.trim();
        if (!text) return;

        try {
            const token = localStorage.getItem('pzp_token');
            const resp = await fetch('/api/board/notes', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, isShared: shared.checked })
            });
            if (resp.ok) {
                input.value = '';
                shared.checked = false;
                document.getElementById('cmdNoteForm')?.classList.add('hidden');
                await refreshNotes();
            }
        } catch { /* ignore */ }
    }

    async function deleteNote(id) {
        try {
            const token = localStorage.getItem('pzp_token');
            await fetch(`/api/board/notes/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            await refreshNotes();
        } catch { /* ignore */ }
    }

    return { init, destroy, show, hide, refresh, deleteNote };
})();
