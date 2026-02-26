/**
 * js/command-panel.js — Floating Command Panel (v20.2.0)
 * KPI dashboard + quick notes, draggable, collapsible
 */

const CommandPanel = (() => {
    let panelEl = null;
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };
    let refreshInterval = null;
    let isMinimized = false;

    const STORAGE_KEY = 'pzp_cmd_panel';
    const REFRESH_MS = 60000;

    function init() {
        if (panelEl) return;
        createPanel();
        loadState();
        refresh();
        refreshInterval = setInterval(refresh, REFRESH_MS);
    }

    function destroy() {
        if (refreshInterval) clearInterval(refreshInterval);
        if (panelEl) panelEl.remove();
        panelEl = null;
    }

    function createPanel() {
        panelEl = document.createElement('div');
        panelEl.className = 'cmd-panel';
        panelEl.innerHTML = `
            <div class="cmd-panel-header" id="cmdPanelHeader">
                <span class="cmd-panel-title">Командна панель</span>
                <div class="cmd-panel-btns">
                    <button class="cmd-btn-min" id="cmdMinBtn" title="Згорнути">&#8722;</button>
                    <button class="cmd-btn-close" id="cmdCloseBtn" title="Сховати">&#10005;</button>
                </div>
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
        document.getElementById('cmdMinBtn').addEventListener('click', toggleMinimize);
        document.getElementById('cmdCloseBtn').addEventListener('click', hide);
        document.getElementById('cmdAddNote').addEventListener('click', toggleNoteForm);
        document.getElementById('cmdSaveNote').addEventListener('click', saveNote);
        document.getElementById('cmdNoteInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveNote();
        });

        // Drag
        const header = document.getElementById('cmdPanelHeader');
        header.addEventListener('mousedown', startDrag);
        header.addEventListener('touchstart', startDragTouch, { passive: false });

        // Shared notes visibility by role
        const role = typeof getUserRole === 'function' ? getUserRole() : 'admin';
        const SHARED_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager'];
        if (!SHARED_ROLES.includes(role)) {
            document.getElementById('cmdSharedLabel').classList.add('hidden');
        }
    }

    function loadState() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            if (saved.x !== undefined && saved.y !== undefined) {
                panelEl.style.left = saved.x + 'px';
                panelEl.style.top = saved.y + 'px';
                panelEl.style.right = 'auto';
                panelEl.style.bottom = 'auto';
            }
            if (saved.minimized) toggleMinimize();
            if (saved.hidden) panelEl.classList.add('hidden');
        } catch { /* ignore */ }
    }

    function saveState() {
        try {
            const rect = panelEl.getBoundingClientRect();
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                x: rect.left, y: rect.top,
                minimized: isMinimized,
                hidden: panelEl.classList.contains('hidden')
            }));
        } catch { /* ignore */ }
    }

    function toggleMinimize() {
        isMinimized = !isMinimized;
        const body = document.getElementById('cmdPanelBody');
        body.classList.toggle('hidden', isMinimized);
        document.getElementById('cmdMinBtn').innerHTML = isMinimized ? '&#9633;' : '&#8722;';
        saveState();
    }

    function hide() {
        panelEl.classList.add('hidden');
        saveState();
    }

    function show() {
        if (!panelEl) init();
        panelEl.classList.remove('hidden');
        saveState();
        refresh();
    }

    // Drag handlers
    function startDrag(e) {
        if (e.target.tagName === 'BUTTON') return;
        isDragging = true;
        const rect = panelEl.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
        panelEl.style.transition = 'none';
    }

    function startDragTouch(e) {
        if (e.target.tagName === 'BUTTON') return;
        isDragging = true;
        const touch = e.touches[0];
        const rect = panelEl.getBoundingClientRect();
        dragOffset.x = touch.clientX - rect.left;
        dragOffset.y = touch.clientY - rect.top;
        document.addEventListener('touchmove', onDragTouch, { passive: false });
        document.addEventListener('touchend', stopDrag);
        panelEl.style.transition = 'none';
    }

    function onDrag(e) {
        if (!isDragging) return;
        moveTo(e.clientX - dragOffset.x, e.clientY - dragOffset.y);
    }

    function onDragTouch(e) {
        if (!isDragging) return;
        e.preventDefault();
        const touch = e.touches[0];
        moveTo(touch.clientX - dragOffset.x, touch.clientY - dragOffset.y);
    }

    function moveTo(x, y) {
        const maxX = window.innerWidth - panelEl.offsetWidth;
        const maxY = window.innerHeight - 40;
        panelEl.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
        panelEl.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
        panelEl.style.right = 'auto';
        panelEl.style.bottom = 'auto';
    }

    function stopDrag() {
        isDragging = false;
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
        document.removeEventListener('touchmove', onDragTouch);
        document.removeEventListener('touchend', stopDrag);
        panelEl.style.transition = '';
        saveState();
    }

    // Data refresh
    async function refresh() {
        if (!panelEl || panelEl.classList.contains('hidden') || isMinimized) return;
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
                ${d.revenue !== null ? `<div class="cmd-kpi-revenue">${d.revenue.toLocaleString('uk-UA')} &#8372; сьогодні</div>` : ''}
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
            document.getElementById('cmdNoteInput').focus();
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
                document.getElementById('cmdNoteForm').classList.add('hidden');
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
