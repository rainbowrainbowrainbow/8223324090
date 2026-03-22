/**
 * js/sound-page.js — Sound Module UI
 * v38.0.0: Announcements, Library, Playlists, Log
 */
(function() {
    'use strict';

    const _esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    const TYPE_LABELS = { promo: '📢 Промо', safety: '⚠️ Безпека', event: '🎉 Подія', info: 'ℹ️ Інфо' };
    const CAT_LABELS = { quest: '🎯 Квест', atmosphere: '🌙 Атмосфера', effects: '💥 Ефекти', music: '🎵 Музика', general: '📁 Загальне', announcement: '📢 Оголошення' };

    // ==========================================
    // TABS
    // ==========================================
    function initTabs() {
        document.querySelectorAll('.sound-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.sound-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.sound-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const target = tab.dataset.tab;
                const el = document.getElementById('tab-' + target);
                if (el) el.classList.add('active');
                if (target === 'announcements') loadAnnouncements();
                if (target === 'library') loadLibrary();
                if (target === 'playlists') loadPlaylists();
                if (target === 'log') loadLog();
            });
        });
    }

    // ==========================================
    // ANNOUNCEMENTS
    // ==========================================
    let _annStatusFilter = '';

    async function loadAnnouncements() {
        const grid = document.getElementById('announcementsGrid');
        if (!grid) return;
        try {
            const data = await apiCall('GET', '/music/announcements' + (_annStatusFilter ? `?status=${_annStatusFilter}` : ''));
            const items = data.announcements || [];
            if (!items.length) {
                grid.innerHTML = '<div class="sound-empty"><div class="sound-empty-icon">📢</div><p>Немає оголошень</p></div>';
                return;
            }
            grid.innerHTML = items.map(a => `
                <div class="announcement-card" data-id="${a.id}">
                    <div class="ann-header">
                        <div>
                            <div class="ann-title">${_esc(a.title)}</div>
                            <span class="ann-status ${a.status}">${a.status}</span>
                        </div>
                        <span class="ann-type-badge ${a.announcement_type || 'info'}">${TYPE_LABELS[a.announcement_type] || a.announcement_type || 'info'}</span>
                    </div>
                    <div class="ann-text">${_esc(a.text_content)}</div>
                    <div class="ann-meta">
                        <span>▶ ${a.played_count || 0} разів</span>
                        <span>⏱ ${a.duration_seconds || 30}с</span>
                        ${a.zone_id ? `<span>📍 ${_esc(a.zone_id)}</span>` : ''}
                        ${a.voice_url ? '<span>🎙️ TTS</span>' : ''}
                    </div>
                    <div class="ann-actions">
                        <button class="btn-play" onclick="SoundPage.play(${a.id}, this)">▶ Програти</button>
                        <button class="btn-tts" onclick="SoundPage.tts(${a.id})">🎙️ TTS</button>
                        <button class="btn-edit" onclick="SoundPage.editAnn(${a.id})">✏️</button>
                        <button class="btn-delete" onclick="SoundPage.deleteAnn(${a.id})">🗑️</button>
                    </div>
                </div>
            `).join('');
        } catch (err) {
            grid.innerHTML = '<div class="sound-empty"><p>Помилка завантаження</p></div>';
        }
    }

    function initAnnStatusFilter() {
        document.querySelectorAll('.ann-status-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.ann-status-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                _annStatusFilter = btn.dataset.status || '';
                loadAnnouncements();
            });
        });
    }

    async function playAnnouncement(id, btn) {
        if (btn) btn.disabled = true;
        try {
            await apiCall('POST', `/music/announcements/${id}/play`);
            // Update count in UI
            const card = document.querySelector(`.announcement-card[data-id="${id}"]`);
            if (card) {
                const meta = card.querySelector('.ann-meta span');
                if (meta) {
                    const cur = parseInt(meta.textContent.match(/\d+/)?.[0] || 0);
                    meta.textContent = `▶ ${cur + 1} разів`;
                }
            }
        } catch (err) {
            alert('Помилка: ' + (err.message || err));
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function generateTTS(id) {
        if (!confirm('Згенерувати озвучку через TTS (~$0.03)?')) return;
        try {
            const res = await apiCall('POST', `/music/announcements/${id}/generate-tts`);
            if (res.status === 'ready') {
                alert('TTS готовий!');
                loadAnnouncements();
            } else {
                alert('TTS генерується, перевірте через хвилину');
            }
        } catch (err) {
            alert('TTS помилка: ' + (err.message || err));
        }
    }

    function showAnnModal(data = {}) {
        const existing = document.getElementById('annModal');
        if (existing) existing.remove();

        const div = document.createElement('div');
        div.id = 'annModal';
        div.className = 'sound-modal-overlay';
        div.innerHTML = `
            <div class="sound-modal">
                <h3>${data.id ? 'Редагувати' : 'Нове'} оголошення</h3>
                <form id="annForm" class="upload-form">
                    <div class="form-group">
                        <label>Назва</label>
                        <input type="text" name="title" value="${_esc(data.title || '')}" required>
                    </div>
                    <div class="form-group">
                        <label>Текст</label>
                        <textarea name="text_content" required>${_esc(data.text_content || '')}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Тип</label>
                        <select name="announcement_type">
                            <option value="promo" ${data.announcement_type === 'promo' ? 'selected' : ''}>📢 Промо</option>
                            <option value="safety" ${data.announcement_type === 'safety' ? 'selected' : ''}>⚠️ Безпека</option>
                            <option value="event" ${data.announcement_type === 'event' ? 'selected' : ''}>🎉 Подія</option>
                            <option value="info" ${(!data.announcement_type || data.announcement_type === 'info') ? 'selected' : ''}>ℹ️ Інфо</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Тривалість (секунди)</label>
                        <input type="number" name="duration_seconds" value="${data.duration_seconds || 30}" min="5" max="300">
                    </div>
                    <div class="form-group">
                        <label>Зона</label>
                        <select name="zone_id">
                            <option value="all" ${(data.zone_id || 'all') === 'all' ? 'selected' : ''}>Всі</option>
                            <option value="lobby" ${data.zone_id === 'lobby' ? 'selected' : ''}>Лобі</option>
                            <option value="quest" ${data.zone_id === 'quest' ? 'selected' : ''}>Квест</option>
                            <option value="cafe" ${data.zone_id === 'cafe' ? 'selected' : ''}>Кафе</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Статус</label>
                        <select name="status">
                            <option value="draft" ${(data.status || 'draft') === 'draft' ? 'selected' : ''}>Чернетка</option>
                            <option value="active" ${data.status === 'active' ? 'selected' : ''}>Активне</option>
                            <option value="scheduled" ${data.status === 'scheduled' ? 'selected' : ''}>Заплановане</option>
                        </select>
                    </div>
                    <input type="hidden" name="id" value="${data.id || ''}">
                    <div class="modal-actions">
                        <button type="button" class="btn-cancel" onclick="document.getElementById('annModal').remove()">Скасувати</button>
                        <button type="submit" class="btn-save">Зберегти</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(div);
        div.addEventListener('click', e => { if (e.target === div) div.remove(); });
        document.getElementById('annForm').addEventListener('submit', async e => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const body = Object.fromEntries(fd.entries());
            const id = body.id;
            delete body.id;
            body.duration_seconds = parseInt(body.duration_seconds) || 30;
            try {
                if (id) {
                    await apiCall('PUT', `/music/announcements/${id}`, body);
                } else {
                    await apiCall('POST', '/music/announcements', body);
                }
                div.remove();
                loadAnnouncements();
            } catch (err) {
                alert('Помилка: ' + (err.message || err));
            }
        });
    }

    async function editAnnouncement(id) {
        try {
            const data = await apiCall('GET', '/music/announcements');
            const ann = (data.announcements || []).find(a => a.id === id);
            if (ann) showAnnModal(ann);
        } catch (err) { alert('Помилка'); }
    }

    async function deleteAnnouncement(id) {
        if (!confirm('Видалити оголошення?')) return;
        try {
            await apiCall('DELETE', `/music/announcements/${id}`);
            loadAnnouncements();
        } catch (err) { alert('Помилка: ' + (err.message || err)); }
    }

    // ==========================================
    // LIBRARY
    // ==========================================
    let _libFilter = '';

    async function loadLibrary() {
        const grid = document.getElementById('libraryGrid');
        if (!grid) return;
        try {
            const data = await apiCall('GET', '/music/library' + (_libFilter ? `?category=${_libFilter}` : ''));
            const items = data.sounds || [];
            if (!items.length) {
                grid.innerHTML = '<div class="sound-empty"><div class="sound-empty-icon">🎵</div><p>Бібліотека порожня</p><p style="font-size:12px">Завантажте перший звуковий файл</p></div>';
                return;
            }
            grid.innerHTML = items.map(s => `
                <div class="sound-card">
                    <div class="sound-card-header">
                        <span class="sound-card-name">${_esc(s.name)}</span>
                        <span class="sound-card-cat">${CAT_LABELS[s.category] || s.category}</span>
                    </div>
                    <div class="sound-card-meta">${s.file_size ? (s.file_size / 1024 / 1024).toFixed(1) + ' MB' : ''} • ${new Date(s.created_at).toLocaleDateString('uk')}</div>
                    ${s.file_path ? `<audio controls preload="metadata" src="${_esc(s.file_path)}"></audio>` : ''}
                    <div class="sound-card-actions">
                        <button class="btn-delete" onclick="SoundPage.deleteSound(${s.id})">🗑️ Видалити</button>
                    </div>
                </div>
            `).join('');
        } catch (err) {
            grid.innerHTML = '<div class="sound-empty"><p>Помилка завантаження</p></div>';
        }
    }

    function initLibFilter() {
        document.querySelectorAll('.lib-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.lib-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                _libFilter = btn.dataset.cat || '';
                loadLibrary();
            });
        });
    }

    async function uploadSound(form) {
        const fileInput = form.querySelector('#soundFile');
        const nameInput = form.querySelector('#soundName');
        const catSelect = form.querySelector('#soundCategory');
        if (!fileInput.files.length) { alert('Оберіть файл'); return; }
        const fd = new FormData();
        fd.append('file', fileInput.files[0]);
        fd.append('name', nameInput.value || fileInput.files[0].name);
        fd.append('category', catSelect.value);
        try {
            const token = localStorage.getItem('pzp_token');
            const res = await fetch('/api/music/library/upload', {
                method: 'POST', body: fd,
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upload failed');
            form.reset();
            // Switch to library tab
            document.querySelector('.sound-tab[data-tab="library"]')?.click();
        } catch (err) {
            alert('Помилка: ' + (err.message || err));
        }
    }

    async function deleteSound(id) {
        if (!confirm('Видалити звук?')) return;
        try {
            await apiCall('DELETE', `/music/library/${id}`);
            loadLibrary();
        } catch (err) { alert('Помилка: ' + (err.message || err)); }
    }

    // ==========================================
    // PLAYLISTS
    // ==========================================
    async function loadPlaylists() {
        const container = document.getElementById('playlistsContainer');
        if (!container) return;
        try {
            const data = await apiCall('GET', '/music/playlists');
            const items = data.playlists || [];
            if (!items.length) {
                container.innerHTML = '<div class="sound-empty"><div class="sound-empty-icon">📋</div><p>Немає плейлистів</p></div>';
                return;
            }
            container.innerHTML = items.map(p => `
                <div class="sound-card">
                    <div class="sound-card-header">
                        <span class="sound-card-name">${_esc(p.name)}</span>
                        <span class="sound-card-cat">${_esc(p.category || 'загальне')}</span>
                    </div>
                    <div class="sound-card-meta">${p.tracks_count || 0} треків</div>
                </div>
            `).join('');
        } catch (err) {
            container.innerHTML = '<div class="sound-empty"><p>Помилка</p></div>';
        }
    }

    // ==========================================
    // LOG
    // ==========================================
    async function loadLog() {
        const container = document.getElementById('logContainer');
        if (!container) return;
        try {
            const data = await apiCall('GET', '/music/log?limit=50');
            const items = data.log || [];
            if (!items.length) {
                container.innerHTML = '<div class="sound-empty"><div class="sound-empty-icon">📊</div><p>Лог порожній</p></div>';
                return;
            }
            container.innerHTML = `<table class="sound-log-table">
                <thead><tr><th>Час</th><th>Дія</th><th>Оголошення</th><th>Деталі</th></tr></thead>
                <tbody>${items.map(l => `<tr>
                    <td>${new Date(l.played_at || l.created_at).toLocaleString('uk')}</td>
                    <td>${_esc(l.action)}</td>
                    <td>${_esc(l.title || l.announcement_id || '—')}</td>
                    <td>${_esc(typeof l.details === 'string' ? l.details : JSON.stringify(l.details || ''))}</td>
                </tr>`).join('')}</tbody>
            </table>`;
        } catch (err) {
            container.innerHTML = '<div class="sound-empty"><p>Помилка</p></div>';
        }
    }

    // ==========================================
    // INIT
    // ==========================================
    function init() {
        initTabs();
        initAnnStatusFilter();
        initLibFilter();
        // Upload form
        const form = document.getElementById('uploadForm');
        if (form) form.addEventListener('submit', e => { e.preventDefault(); uploadSound(form); });
        // Load default tab
        loadAnnouncements();
    }

    document.addEventListener('DOMContentLoaded', init);

    // Public API
    window.SoundPage = {
        play: playAnnouncement,
        tts: generateTTS,
        editAnn: editAnnouncement,
        deleteAnn: deleteAnnouncement,
        deleteSound: deleteSound,
        newAnn: () => showAnnModal(),
        loadAnnouncements,
        loadLibrary,
    };
})();
