/**
 * js/agents-panel.js — Agent Status Bar + Activity Feed
 * Contour 2: Monitor LLM agents from chat UI.
 */
(function () {
    'use strict';

    const AGENT_ICONS = {
        'claude-code': '🤖',
        'kleshnya': '🦀',
        'anthropic': '🧠',
        'human': '👤',
        'github': '🔗',
        'unknown': '❓'
    };

    let _feedOpen = false;
    let _currentFilter = 'all';
    let _statusBarVisible = false;

    // ==========================================
    // INIT
    // ==========================================

    function init() {
        const bar = document.getElementById('agentStatusBar');
        if (!bar) return;

        // Show status bar for admin users
        const role = localStorage.getItem('pzp_role') || sessionStorage.getItem('pzp_role');
        if (role !== 'admin' && role !== 'director') return;

        bar.style.display = 'flex';
        _statusBarVisible = true;

        // Load agent status
        loadAgentStatus();

        // Wire up buttons
        const feedToggle = document.getElementById('agentFeedToggle');
        const feedClose = document.getElementById('agentFeedClose');
        const syncBtn = document.getElementById('agentSyncBtn');
        const summaryRefresh = document.getElementById('agentSummaryRefresh');

        if (feedToggle) feedToggle.addEventListener('click', toggleFeed);
        if (feedClose) feedClose.addEventListener('click', closeFeed);
        if (syncBtn) syncBtn.addEventListener('click', syncGit);
        if (summaryRefresh) summaryRefresh.addEventListener('click', refreshSummary);

        // Filter buttons
        document.querySelectorAll('.agent-feed-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.agent-feed-filter').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                _currentFilter = btn.dataset.agent;
                loadActivityFeed();
            });
        });

        // Refresh every 2 minutes
        setInterval(loadAgentStatus, 120000);
    }

    // ==========================================
    // AGENT STATUS BAR
    // ==========================================

    async function loadAgentStatus() {
        try {
            const token = localStorage.getItem('pzp_token') || sessionStorage.getItem('pzp_token');
            const resp = await fetch('/api/agents/status', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!resp.ok) return;
            const agents = await resp.json();

            const container = document.getElementById('agentStatusItems');
            if (!container) return;

            if (agents.length === 0) {
                container.innerHTML = '<span class="agent-status-empty">Немає даних агентів</span>';
                return;
            }

            container.innerHTML = agents.map(a => {
                const icon = AGENT_ICONS[a.agentTag] || '❓';
                const statusDot = a.isOnline ? '🟢' : '⚪';
                const shortSummary = (a.lastSummary || '').substring(0, 40);
                return `<div class="agent-status-item" title="${a.lastSummary || 'Немає даних'}">
                    <span class="agent-status-dot">${statusDot}</span>
                    <span class="agent-status-icon">${icon}</span>
                    <span class="agent-status-name">${a.agentTag}</span>
                    <span class="agent-status-summary">${shortSummary}</span>
                </div>`;
            }).join('');
        } catch (err) {
            console.error('Agent status load error:', err);
        }
    }

    // ==========================================
    // ACTIVITY FEED
    // ==========================================

    function toggleFeed() {
        _feedOpen = !_feedOpen;
        const panel = document.getElementById('agentFeedPanel');
        if (!panel) return;

        if (_feedOpen) {
            panel.style.display = 'block';
            loadActivityFeed();
            loadSummary();
        } else {
            panel.style.display = 'none';
        }
    }

    function closeFeed() {
        _feedOpen = false;
        const panel = document.getElementById('agentFeedPanel');
        if (panel) panel.style.display = 'none';
    }

    async function loadActivityFeed() {
        try {
            const token = localStorage.getItem('pzp_token') || sessionStorage.getItem('pzp_token');
            let url = '/api/agents/activity?limit=30';
            if (_currentFilter !== 'all') {
                url += '&agent=' + encodeURIComponent(_currentFilter);
            }

            const resp = await fetch(url, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!resp.ok) return;
            const feed = await resp.json();

            const container = document.getElementById('agentFeedEntries');
            if (!container) return;

            if (feed.length === 0) {
                container.innerHTML = '<div class="agent-feed-empty">Стрічка порожня. Натисніть 🔄 для синхронізації git.</div>';
                return;
            }

            container.innerHTML = feed.map(a => {
                const time = new Date(a.createdAt).toLocaleTimeString('uk-UA', {
                    timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit'
                });
                const date = new Date(a.createdAt).toLocaleDateString('uk-UA', {
                    timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit'
                });
                const icon = AGENT_ICONS[a.agentTag] || '❓';
                const typeIcon = getTypeIcon(a.actionType);
                const diffStat = a.details?.diff_stat ? `<span class="agent-feed-diff">${a.details.diff_stat}</span>` : '';

                return `<div class="agent-feed-entry">
                    <div class="agent-feed-time">${date} ${time}</div>
                    <div class="agent-feed-content">
                        <span class="agent-feed-icon">${icon}</span>
                        <span class="agent-feed-type">${typeIcon}</span>
                        <span class="agent-feed-tag">[${a.agentTag}]</span>
                        <span class="agent-feed-msg">${escapeHtml(a.summary)}</span>
                        ${diffStat}
                    </div>
                </div>`;
            }).join('');
        } catch (err) {
            console.error('Activity feed load error:', err);
        }
    }

    function getTypeIcon(type) {
        switch (type) {
            case 'feature': return '✨';
            case 'fix': return '🔧';
            case 'chore': return '📦';
            case 'docs': return '📄';
            case 'deploy': return '🚀';
            case 'pr_merged': return '🔀';
            case 'refactor': return '♻️';
            case 'test': return '🧪';
            default: return '📝';
        }
    }

    // ==========================================
    // SUMMARY
    // ==========================================

    async function loadSummary() {
        try {
            const token = localStorage.getItem('pzp_token') || sessionStorage.getItem('pzp_token');
            const resp = await fetch('/api/agents/summary?period=today', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!resp.ok) return;
            const data = await resp.json();

            const panel = document.getElementById('agentFeedSummary');
            const content = document.getElementById('agentFeedSummaryContent');
            if (!panel || !content) return;

            if (data.summary) {
                content.innerHTML = escapeHtml(data.summary).replace(/\n/g, '<br>');
                panel.style.display = 'block';
            }
        } catch (err) {
            console.error('Summary load error:', err);
        }
    }

    async function refreshSummary() {
        try {
            const btn = document.getElementById('agentSummaryRefresh');
            if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерую...'; }

            const token = localStorage.getItem('pzp_token') || sessionStorage.getItem('pzp_token');
            const resp = await fetch('/api/agents/summary/generate', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ period: 'today' })
            });
            if (!resp.ok) throw new Error('Failed');
            const data = await resp.json();

            const content = document.getElementById('agentFeedSummaryContent');
            if (content && data.summary) {
                content.innerHTML = escapeHtml(data.summary).replace(/\n/g, '<br>');
            }

            if (btn) { btn.disabled = false; btn.textContent = '🔄 Оновити саммарі'; }
        } catch (err) {
            console.error('Summary refresh error:', err);
            const btn = document.getElementById('agentSummaryRefresh');
            if (btn) { btn.disabled = false; btn.textContent = '🔄 Оновити саммарі'; }
        }
    }

    // ==========================================
    // SYNC GIT
    // ==========================================

    async function syncGit() {
        try {
            const btn = document.getElementById('agentSyncBtn');
            if (btn) btn.classList.add('spinning');

            const token = localStorage.getItem('pzp_token') || sessionStorage.getItem('pzp_token');
            const resp = await fetch('/api/agents/sync-git', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ hours: 48 })
            });
            if (!resp.ok) throw new Error('Sync failed');
            const data = await resp.json();

            if (btn) btn.classList.remove('spinning');

            // Refresh feed
            await loadAgentStatus();
            if (_feedOpen) await loadActivityFeed();

            // Show toast if available
            if (typeof showNotification === 'function') {
                showNotification(`Синхронізовано: ${data.added} нових записів`, 'success');
            }
        } catch (err) {
            console.error('Git sync error:', err);
            const btn = document.getElementById('agentSyncBtn');
            if (btn) btn.classList.remove('spinning');
        }
    }

    // ==========================================
    // UTILS
    // ==========================================

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ==========================================
    // AUTO-INIT
    // ==========================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose for external use
    window.AgentsPanel = { loadAgentStatus, loadActivityFeed, toggleFeed };
})();
