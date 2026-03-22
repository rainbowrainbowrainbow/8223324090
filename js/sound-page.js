/**
 * js/sound-page.js — Sound Log Page
 * v38.2.0: Log-only view with filters, stats, date range
 */
(function() {
    'use strict';

    const _esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    const ACTION_ICONS = {
        play:    '▶️',
        tts:     '🎙️',
        create:  '➕',
        update:  '✏️',
        delete:  '🗑️',
        upload:  '📤',
        schedule:'⏰',
    };

    const ACTION_LABELS = {
        play:     'Програвання',
        tts:      'TTS генерація',
        create:   'Створення',
        update:   'Зміна',
        delete:   'Видалення',
        upload:   'Завантаження',
        schedule: 'Планування',
    };

    const DELIVERY_COLORS = {
        delivered: '#10b981',
        pending:   '#f59e0b',
        failed:    '#ef4444',
    };

    const TRIGGER_LABELS = {
        manual:    '👤 Вручну',
        scheduler: '⏰ Планувальник',
        api:       '🔗 API',
        bot:       '🤖 Бот',
    };

    let _actionFilter = '';
    let _dateFrom = '';
    let _dateTo = '';

    // ==========================================
    // LOAD LOG
    // ==========================================
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
            const items = data.log || [];

            renderStats(items);

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
        const deliveryColor = DELIVERY_COLORS[delivery] || '#94a3b8';

        // Parse details
        let detailsHtml = '';
        if (l.details) {
            const d = typeof l.details === 'string' ? tryParse(l.details) : l.details;
            if (d && typeof d === 'object') {
                const parts = [];
                if (d.zone) parts.push(`📍 ${_esc(d.zone)}`);
                if (d.duration) parts.push(`⏱ ${d.duration}с`);
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
                    ${delivery ? `<span class="sound-log-tag" style="color:${deliveryColor}">${delivery === 'delivered' ? '✅ Доставлено' : delivery === 'failed' ? '❌ Помилка' : '⏳ Очікує'}</span>` : ''}
                    ${l.delivery_mode ? `<span class="sound-log-tag">📡 ${_esc(l.delivery_mode)}</span>` : ''}
                </div>
            </div>
        </div>`;
    }

    function tryParse(s) {
        try { return JSON.parse(s); } catch { return null; }
    }

    // ==========================================
    // STATS
    // ==========================================
    function renderStats(items) {
        const el = document.getElementById('logStats');
        if (!el) return;

        if (!items.length) {
            el.innerHTML = '';
            return;
        }

        const counts = {};
        for (const l of items) {
            const a = l.action || 'other';
            counts[a] = (counts[a] || 0) + 1;
        }

        const delivered = items.filter(l => l.delivery_status === 'delivered').length;
        const failed = items.filter(l => l.delivery_status === 'failed').length;

        let html = `<div class="sound-stat-card"><div class="sound-stat-num">${items.length}</div><div class="sound-stat-label">Подій</div></div>`;
        for (const [action, count] of Object.entries(counts).sort((a,b) => b[1] - a[1])) {
            const icon = ACTION_ICONS[action] || '📝';
            const label = ACTION_LABELS[action] || action;
            html += `<div class="sound-stat-card"><div class="sound-stat-num">${icon} ${count}</div><div class="sound-stat-label">${label}</div></div>`;
        }
        if (delivered > 0) {
            html += `<div class="sound-stat-card"><div class="sound-stat-num" style="color:#10b981">✅ ${delivered}</div><div class="sound-stat-label">Доставлено</div></div>`;
        }
        if (failed > 0) {
            html += `<div class="sound-stat-card"><div class="sound-stat-num" style="color:#ef4444">❌ ${failed}</div><div class="sound-stat-label">Помилок</div></div>`;
        }

        el.innerHTML = html;
    }

    // ==========================================
    // FILTERS
    // ==========================================
    function initFilters() {
        // Action filter
        document.querySelectorAll('.log-action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.log-action-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                _actionFilter = btn.dataset.action || '';
                loadLog();
            });
        });

        // Date filters
        const dateFrom = document.getElementById('logDateFrom');
        const dateTo = document.getElementById('logDateTo');
        if (dateFrom) dateFrom.addEventListener('change', () => { _dateFrom = dateFrom.value; loadLog(); });
        if (dateTo) dateTo.addEventListener('change', () => { _dateTo = dateTo.value; loadLog(); });

        // Refresh
        const refreshBtn = document.getElementById('logRefreshBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => loadLog());
    }

    // ==========================================
    // INIT
    // ==========================================
    function init() {
        initFilters();
        loadLog();
    }

    document.addEventListener('DOMContentLoaded', init);

    window.SoundPage = { loadLog };
})();
