/**
 * js/sound-page.js — Sound Page (Library + Announcements + Projects + Log)
 * v38.2.1: Full tabbed interface
 */
(function() {
    'use strict';

    const _esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

    function rememberSoundEditableModal(modal) {
        if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.remember(modal);
    }

    async function closeSoundEditableModal(modal, closeFn, options = {}) {
        if (!modal) return true;
        if (window.UnsafeDismissGuard) {
            return window.UnsafeDismissGuard.attemptCloseEditableSurface(modal, closeFn, {
                force: options.force || false,
                message: options.message || 'Є незбережені зміни. Закрити без збереження?',
                okText: 'Закрити без збереження',
                cancelText: 'Повернутись'
            });
        }
        if (!options.force && typeof confirmModal === 'function') {
            const confirmed = await confirmModal(options.message || 'Є незбережені зміни. Закрити без збереження?', {
                type: 'warning',
                okText: 'Закрити без збереження',
                cancelText: 'Повернутись'
            });
            if (!confirmed) return false;
        }
        closeFn();
        return true;
    }

    // ==========================================
    // HASH NAVIGATION (sidebar drives tabs)
    // ==========================================
    let _loadedTabs = { library: false, announcements: false, projects: false, log: false };
    const TAB_MAP = { library: 'tabLibrary', announcements: 'tabAnnouncements', projects: 'tabProjects', log: 'tabLog' };

    function showPanel(tabName) {
        if (!TAB_MAP[tabName]) tabName = 'library';

        document.querySelectorAll('.sound-tab-panel').forEach(c => c.classList.remove('active'));
        const target = document.getElementById(TAB_MAP[tabName]);
        if (target) target.classList.add('active');

        // Update header
        const titles = { library: '🎵 Бібліотека звуків', announcements: '📢 Оголошення', projects: '🎬 Звукові проєкти', log: '📊 Лог подій' };
        const subtitles = { library: 'Звукові файли за категоріями', announcements: 'Оголошення для відвідувачів та TTS', projects: 'Звукові проєкти для програм та квестів', log: 'Історія всіх звукових подій' };
        const h1 = document.getElementById('soundPageTitle');
        const sub = document.getElementById('soundPageSubtitle');
        if (h1) h1.textContent = titles[tabName] || titles.library;
        if (sub) sub.textContent = subtitles[tabName] || subtitles.library;

        // Lazy load data
        if (tabName === 'library' && !_loadedTabs.library) loadLibrary();
        if (tabName === 'announcements' && !_loadedTabs.announcements) loadAnnouncements();
        if (tabName === 'projects' && !_loadedTabs.projects) loadProjects();
        if (tabName === 'log' && !_loadedTabs.log) { initLogFilters(); loadLog(); }
    }

    function initHashNav() {
        const hash = (location.hash || '#library').replace('#', '');
        showPanel(hash);
        window.addEventListener('hashchange', () => {
            const h = (location.hash || '#library').replace('#', '');
            showPanel(h);
        });
    }

    // ==========================================
    // LIBRARY
    // ==========================================
    const CATEGORY_ICONS = { music: '🎶', effects: '💥', atmosphere: '🌿', quest: '🧩', announcement: '📢', general: '📁' };
    const CATEGORY_LABELS = { music: 'Музика', effects: 'Ефекти', atmosphere: 'Атмосфера', quest: 'Квести', announcement: 'Оголошення', general: 'Загальне' };

    let _allSounds = [];
    let _libCategory = '';
    let _libSearch = '';

    async function loadLibrary() {
        const container = document.getElementById('libraryContainer');
        if (!container) return;
        container.innerHTML = '<div class="sound-empty"><div class="sound-empty-icon">⏳</div><p>Завантаження...</p></div>';

        try {
            const data = await apiCall('GET', '/music/library');
            _allSounds = data?.sounds || [];
            _loadedTabs.library = true;
            renderLibraryStats();
            renderLibrary();
        } catch (err) {
            container.innerHTML = `<div class="sound-empty"><div class="sound-empty-icon">⚠️</div><p>Помилка: ${_esc(err.message)}</p></div>`;
        }
    }

    function renderLibraryStats() {
        const el = document.getElementById('libraryStats');
        if (!el) return;
        const counts = {};
        for (const s of _allSounds) {
            const c = s.category || 'general';
            counts[c] = (counts[c] || 0) + 1;
        }
        let html = `<div class="sound-stat-card"><div class="sound-stat-num">${_allSounds.length}</div><div class="sound-stat-label">Всього</div></div>`;
        for (const [cat, count] of Object.entries(counts).sort((a,b) => b[1] - a[1])) {
            html += `<div class="sound-stat-card"><div class="sound-stat-num">${CATEGORY_ICONS[cat] || '📁'} ${count}</div><div class="sound-stat-label">${CATEGORY_LABELS[cat] || cat}</div></div>`;
        }
        el.innerHTML = html;
    }

    function renderLibrary() {
        const container = document.getElementById('libraryContainer');
        if (!container) return;

        let filtered = _allSounds;
        if (_libCategory) filtered = filtered.filter(s => s.category === _libCategory);
        if (_libSearch) {
            const q = _libSearch.toLowerCase();
            filtered = filtered.filter(s => (s.name || '').toLowerCase().includes(q) || (s.filename || '').toLowerCase().includes(q));
        }

        if (!filtered.length) {
            container.innerHTML = '<div class="sound-empty"><div class="sound-empty-icon">🎵</div><p>Звуків не знайдено</p><p class="sound-empty-sub">Звуки додаються через API або завантаження</p></div>';
            return;
        }

        let html = '';
        for (const s of filtered) {
            const icon = CATEGORY_ICONS[s.category] || '📁';
            const catLabel = CATEGORY_LABELS[s.category] || s.category || 'загальне';
            const duration = s.duration ? formatDuration(s.duration) : '';
            const size = s.file_size ? formatSize(s.file_size) : '';
            const date = s.created_at ? new Date(s.created_at).toLocaleDateString('uk', { day: 'numeric', month: 'short' }) : '';

            const playable = s.file_path && (s.file_path.startsWith('http') || s.file_path.startsWith('/uploads'));
            html += `<div class="sound-card" data-id="${s.id}">
                <div class="sound-card-icon">${icon}</div>
                <div class="sound-card-body">
                    <div class="sound-card-name">${_esc(s.name)}</div>
                    <div class="sound-card-meta">
                        <span class="sound-card-cat">${catLabel}</span>
                        ${duration ? `<span class="sound-card-sep">•</span><span>⏱ ${duration}</span>` : ''}
                        ${size ? `<span class="sound-card-sep">•</span><span>📁 ${size}</span>` : ''}
                    </div>
                </div>
                <div class="sound-card-actions">
                    ${playable ? `<button class="sound-play-btn" onclick="event.stopPropagation();_playSound('${_esc(s.file_path)}',this)" title="Відтворити">▶</button>` : ''}
                    ${date ? `<span class="sound-card-date">${date}</span>` : ''}
                </div>
            </div>`;
        }
        container.innerHTML = html;
    }

    function initLibraryFilters() {
        // Category filter
        const catFilter = document.getElementById('libraryCategoryFilter');
        if (catFilter) {
            catFilter.addEventListener('click', e => {
                const btn = e.target.closest('.sound-cat-btn');
                if (!btn) return;
                catFilter.querySelectorAll('.sound-cat-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                _libCategory = btn.dataset.cat || '';
                renderLibrary();
            });
        }

        // Search
        const search = document.getElementById('librarySearch');
        if (search) {
            let timer;
            search.addEventListener('input', () => {
                clearTimeout(timer);
                timer = setTimeout(() => { _libSearch = search.value.trim(); renderLibrary(); }, 200);
            });
        }
    }

    // ==========================================
    // ANNOUNCEMENTS
    // ==========================================
    let _announcements = [];

    async function loadAnnouncements() {
        const container = document.getElementById('announcementsContainer');
        if (!container) return;
        container.innerHTML = '<div class="sound-empty"><div class="sound-empty-icon">⏳</div><p>Завантаження...</p></div>';

        try {
            const data = await apiCall('GET', '/music/announcements');
            _announcements = data?.announcements || [];
            _loadedTabs.announcements = true;
            renderAnnouncements();
        } catch (err) {
            container.innerHTML = `<div class="sound-empty"><div class="sound-empty-icon">⚠️</div><p>Помилка: ${_esc(err.message)}</p></div>`;
        }
    }

    function renderAnnouncements() {
        const container = document.getElementById('announcementsContainer');
        if (!container) return;

        if (!_announcements.length) {
            container.innerHTML = '<div class="sound-empty"><div class="sound-empty-icon">📢</div><p>Оголошень немає</p><p class="sound-empty-sub">Створіть перше оголошення</p></div>';
            return;
        }

        const TYPE_ICONS = { general: '📢', safety: '🛡️', event: '🎉', promo: '🏷️' };
        const PRIORITY_BADGES = { urgent: '🔴', high: '🟡', normal: '' };

        let html = '<div class="sound-ann-list">';
        for (const a of _announcements) {
            const icon = TYPE_ICONS[a.type] || '📢';
            const priority = PRIORITY_BADGES[a.priority] || '';
            const date = a.created_at ? new Date(a.created_at).toLocaleDateString('uk', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
            const statusCls = a.is_deleted ? 'sound-ann-deleted' : (a.status === 'active' ? 'sound-ann-active' : '');

            html += `<div class="sound-ann-card ${statusCls}" data-id="${a.id}">
                <div class="sound-ann-icon">${icon} ${priority}</div>
                <div class="sound-ann-body">
                    <div class="sound-ann-title">${_esc(a.title)}</div>
                    ${a.text ? `<div class="sound-ann-text">${_esc(a.text).substring(0, 120)}</div>` : ''}
                    <div class="sound-ann-meta">
                        <span>${_esc(a.type || 'загальне')}</span>
                        ${a.play_count ? `<span class="sound-card-sep">•</span><span>▶ ${a.play_count}×</span>` : ''}
                        ${date ? `<span class="sound-card-sep">•</span><span>${date}</span>` : ''}
                    </div>
                </div>
                <div class="sound-ann-actions">
                    <button class="btn-icon sound-play-ann" data-id="${a.id}" title="Програти">▶</button>
                    ${a.is_deleted ? `<button class="btn-icon sound-restore-ann" data-id="${a.id}" title="Відновити">♻️</button>` : `<button class="btn-icon sound-delete-ann" data-id="${a.id}" title="Видалити">🗑️</button>`}
                </div>
            </div>`;
        }
        html += '</div>';
        container.innerHTML = html;

        // Event delegation for actions
        container.addEventListener('click', handleAnnouncementAction);
    }

    async function handleAnnouncementAction(e) {
        const playBtn = e.target.closest('.sound-play-ann');
        const deleteBtn = e.target.closest('.sound-delete-ann');
        const restoreBtn = e.target.closest('.sound-restore-ann');

        if (playBtn) {
            try {
                await apiCall('POST', `/music/announcements/${playBtn.dataset.id}/play`);
            } catch {}
        } else if (deleteBtn) {
            if (!await confirmModal('Видалити оголошення?', { type: 'danger' })) return;
            try {
                await apiCall('DELETE', `/music/announcements/${deleteBtn.dataset.id}`);
                loadAnnouncements();
            } catch {}
        } else if (restoreBtn) {
            try {
                await apiCall('POST', `/music/announcements/${restoreBtn.dataset.id}/restore`);
                loadAnnouncements();
            } catch {}
        }
    }

    function initAnnouncementModal() {
        const modal = document.getElementById('announcementModal');
        const closeBtn = document.getElementById('announcementModalClose');
        const cancelBtn = document.getElementById('announcementModalCancel');
        const saveBtn = document.getElementById('announcementModalSave');
        const createBtn = document.getElementById('createAnnouncementBtn');
        const refreshBtn = document.getElementById('announcementsRefreshBtn');
        const openAnnouncementModal = () => {
            modal?.classList.remove('hidden');
            rememberSoundEditableModal(modal);
        };
        const closeAnnouncementModal = (force = false) => closeSoundEditableModal(modal, () => modal?.classList.add('hidden'), {
            force,
            message: 'Є незбережені зміни в оголошенні. Закрити без збереження?'
        });

        if (createBtn) createBtn.addEventListener('click', openAnnouncementModal);
        if (closeBtn) closeBtn.addEventListener('click', () => closeAnnouncementModal(false));
        if (cancelBtn) cancelBtn.addEventListener('click', () => closeAnnouncementModal(false));
        if (refreshBtn) refreshBtn.addEventListener('click', () => loadAnnouncements());

        if (saveBtn) saveBtn.addEventListener('click', async () => {
            const title = document.getElementById('annTitle')?.value?.trim();
            if (!title) return showNotification('Введіть назву', 'error');
            const body = {
                title,
                text: document.getElementById('annText')?.value?.trim() || '',
                type: document.getElementById('annType')?.value || 'general',
                priority: document.getElementById('annPriority')?.value || 'normal'
            };
            try {
                await apiCall('POST', '/music/announcements', body);
                if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.markClean(modal);
                await closeAnnouncementModal(true);
                document.getElementById('annTitle').value = '';
                document.getElementById('annText').value = '';
                loadAnnouncements();
            } catch (err) {
                showNotification('Помилка: ' + (err.message || ''), 'error');
            }
        });

        // Close on overlay click
        if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeAnnouncementModal(false); });
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape' || document.querySelector('.confirm-overlay')) return;
            if (modal && !modal.classList.contains('hidden')) {
                e.preventDefault();
                closeAnnouncementModal(false);
            }
        });
    }

    // ==========================================
    // PROJECTS
    // ==========================================
    let _projects = [];

    async function loadProjects() {
        const container = document.getElementById('projectsContainer');
        if (!container) return;
        container.innerHTML = '<div class="sound-empty"><div class="sound-empty-icon">⏳</div><p>Завантаження...</p></div>';

        try {
            const data = await apiCall('GET', '/music/projects');
            _projects = data?.projects || [];
            _loadedTabs.projects = true;
            renderProjects();
        } catch (err) {
            container.innerHTML = `<div class="sound-empty"><div class="sound-empty-icon">⚠️</div><p>Помилка: ${_esc(err.message)}</p></div>`;
        }
    }

    const PROJECT_TYPE_ICONS = { quest: '🧩', program: '🎪', event: '🎉', background: '🌿' };
    const PROJECT_TYPE_LABELS = { quest: 'Квест', program: 'Програма', event: 'Подія', background: 'Фон' };

    function renderProjects() {
        const container = document.getElementById('projectsContainer');
        if (!container) return;

        if (!_projects.length) {
            container.innerHTML = '<div class="sound-empty"><div class="sound-empty-icon">🎬</div><p>Проєктів немає</p><p class="sound-empty-sub">Створіть перший звуковий проєкт</p></div>';
            return;
        }

        let html = '<div class="sound-projects-grid">';
        for (const p of _projects) {
            const icon = PROJECT_TYPE_ICONS[p.type] || '🎬';
            const typeLabel = PROJECT_TYPE_LABELS[p.type] || p.type;
            const trackCount = p.tracks?.length || 0;
            const date = p.created_at ? new Date(p.created_at).toLocaleDateString('uk', { day: 'numeric', month: 'short' }) : '';

            html += `<div class="sound-project-card" data-id="${p.id}">
                <div class="sound-project-header">
                    <span class="sound-project-icon">${icon}</span>
                    <span class="sound-project-type">${typeLabel}</span>
                </div>
                <div class="sound-project-name">${_esc(p.name)}</div>
                ${p.description ? `<div class="sound-project-desc">${_esc(p.description).substring(0, 80)}</div>` : ''}
                <div class="sound-project-footer">
                    <span>🎵 ${trackCount} трек${trackCount === 1 ? '' : trackCount < 5 ? 'и' : 'ів'}</span>
                    ${date ? `<span>${date}</span>` : ''}
                </div>
            </div>`;
        }
        html += '</div>';
        container.innerHTML = html;
    }

    function initProjectModal() {
        const modal = document.getElementById('projectModal');
        const closeBtn = document.getElementById('projectModalClose');
        const cancelBtn = document.getElementById('projectModalCancel');
        const saveBtn = document.getElementById('projectModalSave');
        const createBtn = document.getElementById('createProjectBtn');
        const refreshBtn = document.getElementById('projectsRefreshBtn');
        const openProjectModal = () => {
            modal?.classList.remove('hidden');
            rememberSoundEditableModal(modal);
        };
        const closeProjectModal = (force = false) => closeSoundEditableModal(modal, () => modal?.classList.add('hidden'), {
            force,
            message: 'Є незбережені зміни в звуковому проєкті. Закрити без збереження?'
        });

        if (createBtn) createBtn.addEventListener('click', openProjectModal);
        if (closeBtn) closeBtn.addEventListener('click', () => closeProjectModal(false));
        if (cancelBtn) cancelBtn.addEventListener('click', () => closeProjectModal(false));
        if (refreshBtn) refreshBtn.addEventListener('click', () => loadProjects());

        if (saveBtn) saveBtn.addEventListener('click', async () => {
            const name = document.getElementById('projName')?.value?.trim();
            if (!name) return showNotification('Введіть назву', 'error');
            const body = {
                name,
                type: document.getElementById('projType')?.value || 'quest',
                description: document.getElementById('projDesc')?.value?.trim() || ''
            };
            try {
                await apiCall('POST', '/music/projects', body);
                if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.markClean(modal);
                await closeProjectModal(true);
                document.getElementById('projName').value = '';
                document.getElementById('projDesc').value = '';
                loadProjects();
            } catch (err) {
                showNotification('Помилка: ' + (err.message || ''), 'error');
            }
        });

        if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeProjectModal(false); });
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape' || document.querySelector('.confirm-overlay')) return;
            if (modal && !modal.classList.contains('hidden')) {
                e.preventDefault();
                closeProjectModal(false);
            }
        });
    }

    // ==========================================
    // LOG (preserved from original)
    // ==========================================
    const ACTION_ICONS = { play: '▶️', tts: '🎙️', create: '➕', update: '✏️', delete: '🗑️', upload: '📤', schedule: '⏰' };
    const ACTION_LABELS = { play: 'Програвання', tts: 'TTS генерація', create: 'Створення', update: 'Зміна', delete: 'Видалення', upload: 'Завантаження', schedule: 'Планування' };
    const DELIVERY_CLASSES = { delivered: 'sound-delivery-ok', pending: 'sound-delivery-pending', failed: 'sound-delivery-fail' };
    const TRIGGER_LABELS = { manual: '👤 Вручну', scheduler: '⏰ Планувальник', api: '🔗 API', bot: '🤖 Бот' };

    let _actionFilter = '';
    let _dateFrom = '';
    let _dateTo = '';

    async function loadLog() {
        const container = document.getElementById('logContainer');
        if (!container) return;
        container.innerHTML = '<div class="sound-empty"><div class="sound-empty-icon">⏳</div><p>Завантаження логу...</p></div>';

        try {
            const params = new URLSearchParams({ limit: '200' });
            if (_actionFilter) params.set('action', _actionFilter);
            if (_dateFrom) params.set('from', _dateFrom);
            if (_dateTo) params.set('to', _dateTo);

            const data = await apiCall('GET', '/music/log?' + params.toString());
            if (!data || data.error) {
                container.innerHTML = `<div class="sound-empty"><div class="sound-empty-icon">⚠️</div><p>${_esc(data?.error || 'Немає відповіді від сервера')}</p></div>`;
                renderLogStats([]);
                return;
            }
            const items = data.log || [];
            _loadedTabs.log = true;

            renderLogStats(items);

            if (!items.length) {
                container.innerHTML = '<div class="sound-empty"><div class="sound-empty-icon">📊</div><p>Записів не знайдено</p><p class="sound-empty-sub">Звукові події з\'являться тут автоматично</p></div>';
                return;
            }

            // Group by date
            const grouped = {};
            for (const item of items) {
                const date = new Date(item.created_at || item.played_at).toLocaleDateString('uk', {
                    weekday: 'short', year: 'numeric', month: 'long', day: 'numeric'
                });
                if (!grouped[date]) grouped[date] = [];
                grouped[date].push(item);
            }

            let html = '';
            for (const [date, entries] of Object.entries(grouped)) {
                html += `<div class="sound-log-date-group">
                    <div class="sound-log-date-header">${date} <span class="sound-log-date-count">${entries.length}</span></div>`;
                html += '<div class="sound-log-entries">';
                for (const l of entries) {
                    html += renderLogEntry(l);
                }
                html += '</div></div>';
            }
            container.innerHTML = html;
        } catch (err) {
            container.innerHTML = `<div class="sound-empty"><div class="sound-empty-icon">⚠️</div><p>Помилка завантаження</p><p class="sound-empty-sub">${_esc(err.message || '')}</p></div>`;
        }
    }

    function renderLogEntry(l) {
        const time = new Date(l.created_at || l.played_at).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const action = l.action || 'unknown';
        const icon = ACTION_ICONS[action] || '📝';
        const label = ACTION_LABELS[action] || action;
        const title = l.announcement_title || l.title || '';
        const annType = l.announcement_type || '';
        const trigger = TRIGGER_LABELS[l.triggered_by] || l.triggered_by || '';
        const delivery = l.delivery_status || '';
        const deliveryCls = DELIVERY_CLASSES[delivery] || '';

        let detailsHtml = '';
        if (l.details) {
            const d = typeof l.details === 'string' ? tryParse(l.details) : l.details;
            if (d && typeof d === 'object') {
                const parts = [];
                if (d.zone) parts.push(`📍 ${_esc(d.zone)}`);
                if (d.duration) parts.push(`⏱ ${_esc(d.duration)}с`);
                if (d.voice_engine) parts.push(`🔧 ${_esc(d.voice_engine)}`);
                if (d.file_size) parts.push(`📁 ${(d.file_size / 1024 / 1024).toFixed(1)} MB`);
                if (d.reason) parts.push(`💡 ${_esc(d.reason)}`);
                if (d.old_status && d.new_status) parts.push(`${_esc(d.old_status)} → ${_esc(d.new_status)}`);
                if (parts.length) detailsHtml = parts.join(' <span class="sound-log-sep">•</span> ');
                else if (Object.keys(d).length) detailsHtml = _esc(JSON.stringify(d));
            } else if (typeof l.details === 'string' && l.details.length) {
                detailsHtml = _esc(l.details);
            }
        }
        if (l.delivery_detail) {
            if (detailsHtml) detailsHtml += ' <span class="sound-log-sep">•</span> ';
            detailsHtml += _esc(l.delivery_detail);
        }

        return `<div class="sound-log-entry sound-log-action-${_esc(action)}">
            <div class="sound-log-time">${time}</div>
            <div class="sound-log-icon">${icon}</div>
            <div class="sound-log-body">
                <div class="sound-log-main">
                    <span class="sound-log-label">${label}</span>
                    ${title ? `<span class="sound-log-title">«${_esc(title)}»</span>` : ''}
                    ${annType ? `<span class="sound-log-type-badge">${_esc(annType)}</span>` : ''}
                </div>
                ${detailsHtml ? `<div class="sound-log-details">${detailsHtml}</div>` : ''}
                <div class="sound-log-tags">
                    ${trigger ? `<span class="sound-log-tag">${trigger}</span>` : ''}
                    ${delivery ? `<span class="sound-log-tag ${deliveryCls}">${delivery === 'delivered' ? '✅ Доставлено' : delivery === 'failed' ? '❌ Помилка' : '⏳ Очікує'}</span>` : ''}
                    ${l.delivery_mode ? `<span class="sound-log-tag">📡 ${_esc(l.delivery_mode)}</span>` : ''}
                </div>
            </div>
        </div>`;
    }

    function tryParse(s) {
        try { return JSON.parse(s); } catch { return null; }
    }

    function renderLogStats(items) {
        const el = document.getElementById('logStats');
        if (!el) return;
        if (!items.length) { el.innerHTML = ''; return; }

        const counts = {};
        for (const l of items) { const a = l.action || 'other'; counts[a] = (counts[a] || 0) + 1; }
        const delivered = items.filter(l => l.delivery_status === 'delivered').length;
        const failed = items.filter(l => l.delivery_status === 'failed').length;

        let html = `<div class="sound-stat-card"><div class="sound-stat-num">${items.length}</div><div class="sound-stat-label">Подій</div></div>`;
        for (const [action, count] of Object.entries(counts).sort((a,b) => b[1] - a[1])) {
            html += `<div class="sound-stat-card"><div class="sound-stat-num">${ACTION_ICONS[action] || '📝'} ${count}</div><div class="sound-stat-label">${ACTION_LABELS[action] || action}</div></div>`;
        }
        if (delivered > 0) html += `<div class="sound-stat-card"><div class="sound-stat-num sound-delivery-ok">✅ ${delivered}</div><div class="sound-stat-label">Доставлено</div></div>`;
        if (failed > 0) html += `<div class="sound-stat-card"><div class="sound-stat-num sound-delivery-fail">❌ ${failed}</div><div class="sound-stat-label">Помилок</div></div>`;
        el.innerHTML = html;
    }

    function initLogFilters() {
        document.querySelectorAll('.log-action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.log-action-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
                btn.classList.add('active');
                btn.setAttribute('aria-pressed', 'true');
                _actionFilter = btn.dataset.action || '';
                loadLog();
            });
        });

        const dateFrom = document.getElementById('logDateFrom');
        const dateTo = document.getElementById('logDateTo');
        if (dateFrom) dateFrom.addEventListener('change', () => { _dateFrom = dateFrom.value; loadLog(); });
        if (dateTo) dateTo.addEventListener('change', () => { _dateTo = dateTo.value; loadLog(); });
    }

    // ==========================================
    // UTILS
    // ==========================================
    function formatDuration(sec) {
        if (!sec) return '';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return m > 0 ? `${m}:${String(s).padStart(2,'0')}` : `${s}с`;
    }

    function formatSize(bytes) {
        if (!bytes) return '';
        if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
        return (bytes / 1024).toFixed(0) + ' KB';
    }

    // ==========================================
    // INIT
    // ==========================================
    function init() {
        initLibraryFilters();
        initAnnouncementModal();
        initProjectModal();
        initHashNav();
    }

    document.addEventListener('DOMContentLoaded', init);

    // ==========================================
    // AUDIO PLAYER (v39.8)
    // ==========================================
    let _currentAudio = null;

    window._playSound = function(url, btn) {
        if (_currentAudio) { _currentAudio.pause(); document.querySelectorAll('.sound-play-btn.playing').forEach(b => { b.textContent = '▶'; b.classList.remove('playing'); }); }
        if (btn?.classList.contains('playing')) { _currentAudio = null; return; }
        _currentAudio = new Audio(url);
        _currentAudio.play().catch(() => { if (typeof showNotification === 'function') showNotification('Не вдалось відтворити', 'error'); });
        if (btn) { btn.textContent = '⏸'; btn.classList.add('playing'); }
        _currentAudio.addEventListener('ended', () => { if (btn) { btn.textContent = '▶'; btn.classList.remove('playing'); } _currentAudio = null; });
        _currentAudio.addEventListener('error', () => { if (btn) { btn.textContent = '▶'; btn.classList.remove('playing'); } _currentAudio = null; });
    };

    // ==========================================
    // TTS + MUSIC GENERATION (v39.8)
    // ==========================================
    function pickAudioFile() {
        return new Promise(resolve => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.mp3,.wav,.ogg,.m4a,.aac,audio/*';
            input.style.position = 'fixed';
            input.style.left = '-9999px';
            input.addEventListener('change', () => {
                const file = input.files?.[0] || null;
                input.remove();
                resolve(file);
            }, { once: true });
            input.addEventListener('cancel', () => {
                input.remove();
                resolve(null);
            }, { once: true });
            document.body.appendChild(input);
            input.click();
        });
    }

    function soundNameFromFile(file) {
        return String(file?.name || 'Аудіо').replace(/\.[^.]+$/, '').trim() || 'Аудіо';
    }

    window._openUploadModal = async function() {
        const file = await pickAudioFile();
        if (!file) return;
        const defaultName = soundNameFromFile(file);
        const details = typeof formModal === 'function'
            ? await formModal('📤 Завантажити аудіо', [
                { key: 'name', label: 'Назва', defaultValue: defaultName, placeholder: 'Назва звуку' },
                { key: 'category', label: 'Категорія', type: 'select', defaultValue: 'music', options: [
                    { value: 'music', label: '🎶 Музика' },
                    { value: 'effects', label: '💥 Ефекти' },
                    { value: 'atmosphere', label: '🌿 Атмосфера' },
                    { value: 'quest', label: '🧩 Квести' },
                    { value: 'announcement', label: '📢 Оголошення' }
                ]}
            ], { icon: '📤', okText: 'Завантажити' })
            : { name: defaultName, category: 'music' };
        if (!details) return;

        const body = new FormData();
        body.append('file', file);
        body.append('name', String(details.name || defaultName).trim() || defaultName);
        body.append('category', details.category || 'music');

        if (typeof showNotification === 'function') showNotification('⏳ Завантажуємо аудіо...', 'info');
        try {
            const response = await fetch(`${API_BASE}/music/library/upload`, {
                method: 'POST',
                headers: getAuthHeaders(false),
                body
            });
            if (typeof handleAuthError === 'function' && handleAuthError(response)) return;
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data?.success) throw new Error(data.error || `HTTP ${response.status}`);
            if (typeof showNotification === 'function') showNotification('✅ Аудіо додано до бібліотеки', 'success');
            _loadedTabs.library = false;
            loadLibrary();
            loadLog();
        } catch (err) {
            if (typeof showNotification === 'function') showNotification(err.message || 'Не вдалося завантажити аудіо', 'error');
        }
    };

    window._openTTSModal = async function() {
        if (typeof formModal !== 'function') return;
        const result = await formModal('🎙️ Створити голосовий звук (ElevenLabs)', [
            { key: 'text', label: 'Текст для озвучки', type: 'textarea', required: true, placeholder: 'Ласкаво просимо до Парку Закревського Періоду!' },
            { key: 'name', label: 'Назва файлу', placeholder: 'Привітання' },
            { key: 'voice', label: 'Голос', type: 'select', defaultValue: 'Rachel', options: [
                { value: 'Rachel', label: 'Rachel (жінка, EN)' },
                { value: 'Adam', label: 'Adam (чоловік, EN)' },
                { value: 'Bella', label: 'Bella (жінка, soft)' },
                { value: 'Antoni', label: 'Antoni (чоловік, warm)' },
                { value: 'Elli', label: 'Elli (жінка, young)' },
                { value: 'Josh', label: 'Josh (чоловік, deep)' }
            ]},
            { key: 'category', label: 'Категорія', type: 'select', defaultValue: 'announcement', options: [
                { value: 'announcement', label: '📢 Оголошення' },
                { value: 'effects', label: '💥 Ефекти' },
                { value: 'atmosphere', label: '🌿 Атмосфера' },
                { value: 'quest', label: '🧩 Квести' }
            ]}
        ], { icon: '🎙️', okText: 'Згенерувати' });
        if (!result) return;

        if (typeof showNotification === 'function') showNotification('⏳ Генерація голосу...', 'info');
        try {
            const data = await apiCall('POST', '/music/library/generate-tts', result);
            if (data?.success && data.status === 'ready') {
                if (typeof showNotification === 'function') showNotification('✅ Голос створено!', 'success');
                _loadedTabs.library = false; loadLibrary();
            } else if (data?.taskId) {
                if (typeof showNotification === 'function') showNotification('⏳ Генерація... Зачекайте.', 'info');
                _pollGeneration(data.taskId, result.name, result.category, 'elevenlabs');
            } else {
                if (typeof showNotification === 'function') showNotification(data?.error || 'Помилка TTS', 'error');
            }
        } catch (err) { if (typeof showNotification === 'function') showNotification(err.message, 'error'); }
    };

    window._openMusicModal = async function() {
        if (typeof formModal !== 'function') return;
        const result = await formModal('🎶 Створити музику (Suno)', [
            { key: 'prompt', label: 'Опис музики', type: 'textarea', required: true, placeholder: 'Весела фонова музика для дитячого квесту, 90 секунд, без вокалу' },
            { key: 'name', label: 'Назва файлу', placeholder: 'Квестова фонова музика' },
            { key: 'style', label: 'Стиль / настрій', placeholder: 'pop, cinematic, upbeat, kids party' },
            { key: 'instrumental', label: 'Вокал', type: 'select', defaultValue: 'true', options: [
                { value: 'true', label: 'Без вокалу' },
                { value: 'false', label: 'Можна з вокалом' }
            ]},
            { key: 'category', label: 'Категорія', type: 'select', defaultValue: 'music', options: [
                { value: 'music', label: '🎶 Музика' },
                { value: 'atmosphere', label: '🌿 Атмосфера' },
                { value: 'quest', label: '🧩 Квести' },
                { value: 'effects', label: '💥 Ефекти' }
            ]}
        ], { icon: '🎶', okText: 'Згенерувати' });
        if (!result) return;

        if (typeof showNotification === 'function') showNotification('⏳ Генерація музики через Suno...', 'info');
        try {
            const data = await apiCall('POST', '/music/library/generate-music', {
                ...result,
                instrumental: result.instrumental !== 'false'
            });
            if (data?.success && data?.taskId) {
                if (typeof showNotification === 'function') showNotification('⏳ Музика генерується. Я додам її в бібліотеку після готовності.', 'info');
                _pollGeneration(data.taskId, result.name || data.name || 'AI Music', result.category || data.category || 'music', 'suno');
            } else {
                if (typeof showNotification === 'function') showNotification(data?.error || 'Помилка генерації музики', 'error');
            }
        } catch (err) {
            if (typeof showNotification === 'function') showNotification(err.message || 'Помилка генерації музики', 'error');
        }
    };

    function _pollGeneration(taskId, name, category, provider) {
        let attempts = 0;
        const poll = setInterval(async () => {
            attempts++;
            if (attempts > 60) { clearInterval(poll); if (typeof showNotification === 'function') showNotification('Генерація зайняла надто багато часу', 'error'); return; }
            try {
                const statusUrl = `/music/library/generate-status/${encodeURIComponent(taskId)}${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`;
                const data = await apiCall('GET', statusUrl);
                if (data?.done && data.audioUrl) {
                    clearInterval(poll);
                    const apply = await apiCall('POST', '/music/library/apply-generated', { audioUrl: data.audioUrl, name, category, provider });
                    if (apply?.success) {
                        if (typeof showNotification === 'function') showNotification(`✅ ${provider === 'suno' ? 'Музику' : 'Голос'} створено!`, 'success');
                        _loadedTabs.library = false; loadLibrary();
                    }
                } else if (data?.state === 'failed') {
                    clearInterval(poll);
                    if (typeof showNotification === 'function') showNotification('❌ Генерація не вдалась', 'error');
                }
            } catch { /* continue polling */ }
        }, 3000);
    }

    window.SoundPage = { loadLibrary, loadAnnouncements, loadProjects, loadLog };
})();
