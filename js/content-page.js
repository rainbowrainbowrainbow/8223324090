/**
 * content-page.js — Content Matrix: calendar, posts CRUD, approval, accounts (v42.0)
 */

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ContentPage = (() => {
    // State
    let currentWeekStart = null; // Monday Date
    let currentView = 'week';    // week | month
    let activePlatform = 'all';
    let posts = [];
    let accounts = [];
    let postInitialState = '';
    let cardInitialState = '';

    const PLATFORM_ICONS = {
        instagram: '📸', telegram: '📱', tiktok: '🎵',
        facebook: '📘', threads: '🧵', viber: '📲'
    };
    const TOPIC_ICONS = {
        animation: '🎭', quest: '🔍', birthday: '🎂', show: '🎪',
        masterclass: '🎨', promo: '🔥', event: '🎉', review: '⭐', general: '📱'
    };
    const STATUS_LABELS = {
        draft: 'Чернетка', pending_approval: 'На затвердженні', approved: 'Затверджено',
        scheduled: 'Заплановано', published: 'Опубліковано', failed: 'Помилка'
    };
    const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
    const DAY_NAMES_FULL = ['Понеділок', 'Вівторок', 'Середа', 'Четвер', 'Пʼятниця', 'Субота', 'Неділя'];

    // ── Helpers ──
    function getToken() {
        return localStorage.getItem('pzp_token') || localStorage.getItem('token');
    }
    async function api(url, opts = {}) {
        const token = getToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        try {
            const res = await fetch('/api/content' + url, { ...opts, headers });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            return await res.json();
        } catch (err) {
            console.error('[Content] API error:', url, err.message);
            throw err;
        }
    }
    function notify(msg, type = 'success') {
        if (typeof showNotification === 'function') showNotification(msg, type);
        else if (typeof window.showToast === 'function') window.showToast(msg, type);
    }
    function getMonday(d) {
        const date = new Date(d);
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(date.setDate(diff));
    }
    function formatDate(d) {
        return d.toISOString().split('T')[0];
    }
    function getWeekNumber(d) {
        const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const dayNum = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
        return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    }
    function getWeekDates(monday) {
        const dates = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(d.getDate() + i);
            dates.push(d);
        }
        return dates;
    }

    // ── Init ──
    function init() {
        currentWeekStart = getMonday(new Date());
        initTabs();
        loadCalendar();
    }

    function initTabs() {
        document.querySelectorAll('.content-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.content-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.content-tab-content').forEach(c => { c.style.display = 'none'; c.classList.remove('active'); });
                tab.classList.add('active');
                const target = tab.dataset.tab;
                const panel = document.getElementById('tab-' + target);
                if (panel) { panel.style.display = ''; panel.classList.add('active'); }
                if (target === 'calendar') loadCalendar();
                else if (target === 'posts') loadAllPosts();
                else if (target === 'cards') loadCards();
                else if (target === 'analytics') loadAnalytics();
                else if (target === 'accounts') loadAccounts();
            });
        });
    }

    // ── Calendar ──
    async function loadCalendar() {
        const week = getWeekNumber(currentWeekStart);
        const year = currentWeekStart.getFullYear();
        updateWeekLabel();
        loadStats(week, year);

        try {
            const data = await api(`/posts?week=${week}&year=${year}`);
            posts = data.data || [];
        } catch {
            posts = [];
        }
        renderCalendar();
    }

    function updateWeekLabel() {
        const week = getWeekNumber(currentWeekStart);
        const dates = getWeekDates(currentWeekStart);
        const from = dates[0].toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
        const to = dates[6].toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
        const el = document.getElementById('weekLabel');
        if (el) el.textContent = `Тиждень ${week} (${from} — ${to})`;
    }

    async function loadStats(week, year) {
        const el = document.getElementById('weekStats');
        if (!el) return;
        try {
            const data = await api(`/stats?week=${week}&year=${year}`);
            const s = data.data || {};
            el.innerHTML = [
                { label: 'Всього', value: s.total || 0, color: 'var(--gray-600)' },
                { label: 'Чернетки', value: s.drafts || 0, color: 'var(--gray-500)' },
                { label: 'На затвердженні', value: s.pending || 0, color: '#f59e0b' },
                { label: 'Затверджено', value: s.approved || 0, color: '#22c55e' },
                { label: 'Заплановано', value: s.scheduled || 0, color: '#6366f1' },
                { label: 'Опубліковано', value: s.published || 0, color: 'var(--primary)' },
            ].map(i => `<div class="content-stat-card"><div class="content-stat-value" style="color:${i.color}">${i.value}</div><div class="content-stat-label">${i.label}</div></div>`).join('');
        } catch {
            el.innerHTML = '';
        }
    }

    function renderCalendar() {
        const grid = document.getElementById('calendarGrid');
        if (!grid) return;
        const dates = getWeekDates(currentWeekStart);
        const todayStr = formatDate(new Date());

        let filtered = posts;
        if (activePlatform !== 'all') {
            filtered = posts.filter(p => p.platforms && p.platforms.includes(activePlatform));
        }

        grid.innerHTML = dates.map((d, idx) => {
            const ds = formatDate(d);
            const isToday = ds === todayStr;
            const dayPosts = filtered.filter(p => p.day_of_week === idx + 1);

            const cards = dayPosts.map(p => {
                const topicIcon = TOPIC_ICONS[p.topic] || '📱';
                const platforms = (p.platforms || []).map(pl =>
                    `<span style="background:${pl === 'instagram' ? '#e6683c' : pl === 'telegram' ? '#0088cc' : pl === 'tiktok' ? '#111' : pl === 'facebook' ? '#1877f2' : pl === 'threads' ? '#333' : '#7360f2'}">${PLATFORM_ICONS[pl] || '📱'}</span>`
                ).join('');
                return `<div class="content-card" onclick="ContentPage.openPost(${p.id})">
                    <div class="content-card-title">${topicIcon} ${escapeHtml(p.title)}</div>
                    <div class="content-card-platforms">${platforms}</div>
                    <span class="content-status content-status--${p.status}">${STATUS_LABELS[p.status] || p.status}</span>
                </div>`;
            }).join('');

            return `<div class="content-day ${isToday ? 'today' : ''}">
                <div class="content-day-header">
                    <span>${DAY_NAMES[idx]}</span>
                    <span class="day-num">${d.getDate()}</span>
                </div>
                ${cards || '<div class="content-empty" style="padding:8px;font-size:11px">—</div>'}
            </div>`;
        }).join('');
    }

    function prevWeek() {
        currentWeekStart.setDate(currentWeekStart.getDate() - 7);
        currentWeekStart = new Date(currentWeekStart);
        loadCalendar();
    }
    function nextWeek() {
        currentWeekStart.setDate(currentWeekStart.getDate() + 7);
        currentWeekStart = new Date(currentWeekStart);
        loadCalendar();
    }
    function goToday() {
        currentWeekStart = getMonday(new Date());
        loadCalendar();
    }
    function setView(view) {
        currentView = view;
        document.querySelectorAll('.content-view-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.view === view);
        });
        renderCalendar();
    }
    function filterPlatform(platform) {
        activePlatform = platform;
        document.querySelectorAll('.content-platform-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.platform === platform);
        });
        renderCalendar();
    }

    // ── All Posts Table ──
    async function loadAllPosts() {
        const statusFilter = document.getElementById('postsStatusFilter')?.value || '';
        const platformFilter = document.getElementById('postsPlatformFilter')?.value || '';
        const wrap = document.getElementById('postsTable');
        if (!wrap) return;
        wrap.innerHTML = '<div class="content-empty">⏳ Завантаження...</div>';

        try {
            let url = '/posts?limit=200';
            if (statusFilter) url += '&status=' + statusFilter;
            if (platformFilter) url += '&platform=' + platformFilter;
            const data = await api(url);
            const rows = data.data || [];
            if (!rows.length) { wrap.innerHTML = '<div class="content-empty">Постів не знайдено</div>'; return; }

            wrap.innerHTML = `<table class="content-table"><thead><tr>
                <th>Назва</th><th>Платформи</th><th>Тема</th><th>Статус</th><th>Дата</th><th>Автор</th>
            </tr></thead><tbody>${rows.map(p => {
                const platforms = (p.platforms || []).map(pl => PLATFORM_ICONS[pl] || pl).join(' ');
                const topicIcon = TOPIC_ICONS[p.topic] || '';
                const dateStr = p.scheduled_at ? new Date(p.scheduled_at).toLocaleDateString('uk-UA') : '—';
                return `<tr style="cursor:pointer" onclick="ContentPage.openPost(${p.id})">
                    <td><b>${escapeHtml(p.title)}</b></td>
                    <td>${platforms}</td>
                    <td>${topicIcon} ${escapeHtml(p.topic || '')}</td>
                    <td><span class="content-status content-status--${p.status}">${STATUS_LABELS[p.status] || p.status}</span></td>
                    <td>${dateStr}</td>
                    <td>${escapeHtml(p.creator_name || '—')}</td>
                </tr>`;
            }).join('')}</tbody></table>`;
        } catch (err) {
            wrap.innerHTML = `<div class="content-empty">❌ ${escapeHtml(err.message)}</div>`;
        }
    }

    // ── Analytics ──
    async function loadAnalytics() {
        const statsEl = document.getElementById('analyticsStats');
        const detailsEl = document.getElementById('analyticsDetails');
        if (!statsEl) return;

        try {
            const data = await api('/stats');
            const s = data.data || {};
            statsEl.innerHTML = [
                { label: 'Всього постів', value: s.total || 0 },
                { label: 'Опубліковано', value: s.published || 0 },
                { label: 'Заплановано', value: s.scheduled || 0 },
                { label: 'Чернетки', value: s.drafts || 0 },
                { label: 'На затвердженні', value: s.pending || 0 },
                { label: 'Помилки', value: s.failed || 0 },
            ].map(i => `<div class="content-stat-card"><div class="content-stat-value">${i.value}</div><div class="content-stat-label">${i.label}</div></div>`).join('');

            if (detailsEl) {
                const total = parseInt(s.total) || 0;
                const published = parseInt(s.published) || 0;
                const rate = total > 0 ? Math.round(published / total * 100) : 0;
                detailsEl.innerHTML = `<div style="text-align:center;padding:20px;font-size:14px;color:var(--gray-500)">
                    <div style="font-size:48px;margin-bottom:8px">${rate >= 80 ? '🏆' : rate >= 50 ? '📈' : '📊'}</div>
                    <div>Рівень публікації: <b>${rate}%</b></div>
                    <div style="margin-top:4px;font-size:12px">${published} з ${total} постів опубліковано</div>
                </div>`;
            }
        } catch {
            statsEl.innerHTML = '<div class="content-empty">Помилка завантаження</div>';
        }
    }

    // ── Accounts ──
    async function loadAccounts() {
        const grid = document.getElementById('accountsGrid');
        if (!grid) return;
        grid.innerHTML = '<div class="content-empty">⏳ Завантаження...</div>';

        try {
            const data = await api('/accounts');
            accounts = data.data || [];
            grid.innerHTML = accounts.map(acc => {
                const icon = PLATFORM_ICONS[acc.platform] || '📱';
                const connected = acc.is_connected;
                return `<div class="content-account-card">
                    <div class="content-account-icon content-account-icon--${acc.platform}">${icon}</div>
                    <div class="content-account-info">
                        <div class="content-account-name">${escapeHtml(acc.account_name || acc.platform)}</div>
                        <div class="content-account-status ${connected ? 'connected' : 'disconnected'}">
                            ${connected ? '🟢 Підключено' : '🔴 Не підключено'}
                        </div>
                        ${connected && acc.connected_at ? `<div style="font-size:11px;color:var(--gray-400);margin-top:2px">з ${new Date(acc.connected_at).toLocaleDateString('uk-UA')}</div>` : ''}
                    </div>
                    <button class="content-btn content-btn--small ${connected ? 'content-btn--secondary' : 'content-btn--primary'}"
                            onclick="ContentPage.toggleAccount('${acc.platform}', ${!connected})">
                        ${connected ? 'Відключити' : 'Підключити'}
                    </button>
                </div>`;
            }).join('');
        } catch {
            grid.innerHTML = '<div class="content-empty">❌ Помилка завантаження</div>';
        }
    }

    async function toggleAccount(platform, connect) {
        try {
            await api('/accounts/' + platform, {
                method: 'PUT',
                body: JSON.stringify({ is_connected: connect })
            });
            notify(connect ? 'Акаунт підключено' : 'Акаунт відключено');
            loadAccounts();
        } catch (err) {
            notify('Помилка: ' + err.message, 'error');
        }
    }

    // ── Post Modal ──
    function openNewPost() {
        document.getElementById('postId').value = '';
        document.getElementById('modalTitle').textContent = 'Новий пост';
        document.getElementById('postTitle').value = '';
        document.getElementById('postBody').value = '';
        document.getElementById('postTopic').value = 'general';
        document.getElementById('postHashtags').value = '';
        document.getElementById('postSchedule').value = '';
        document.getElementById('postNotes').value = '';
        document.getElementById('postStatusDisplay').style.display = 'none';
        document.querySelectorAll('#modalPlatforms input').forEach(cb => { cb.checked = false; });
        updateCharCount();
        renderModalActions(null);
        const modal = document.getElementById('postModal');
        modal.classList.add('open');
        postInitialState = JSON.stringify(getFormData());
        if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(modal);
    }

    async function openPost(id) {
        try {
            const data = await api('/posts/' + id);
            const p = data.data;
            document.getElementById('postId').value = p.id;
            document.getElementById('modalTitle').textContent = 'Редагувати пост';
            document.getElementById('postTitle').value = p.title || '';
            document.getElementById('postBody').value = p.body || '';
            document.getElementById('postTopic').value = p.topic || 'general';
            document.getElementById('postHashtags').value = (p.hashtags || []).join(', ');
            document.getElementById('postSchedule').value = p.scheduled_at ? new Date(p.scheduled_at).toISOString().slice(0, 16) : '';
            document.getElementById('postNotes').value = p.notes || '';
            document.querySelectorAll('#modalPlatforms input').forEach(cb => {
                cb.checked = (p.platforms || []).includes(cb.value);
            });
            document.getElementById('postStatusDisplay').style.display = '';
            document.getElementById('postCurrentStatus').innerHTML = `<span class="content-status content-status--${escapeHtml(p.status)}">${escapeHtml(STATUS_LABELS[p.status] || p.status)}</span>`;
            updateCharCount();
            renderModalActions(p);
            const modal = document.getElementById('postModal');
            modal.classList.add('open');
            postInitialState = JSON.stringify(getFormData());
            if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(modal);
        } catch (err) {
            notify('Помилка завантаження посту', 'error');
        }
    }

    async function closeModal(force = false) {
        const modal = document.getElementById('postModal');
        const closeNow = () => {
            modal?.classList.remove('open');
            postInitialState = '';
        };
        if (window.UnsafeDismissGuard && modal) {
            return window.UnsafeDismissGuard.attemptCloseEditableSurface(modal, closeNow, {
                force,
                isDirty: () => JSON.stringify(getFormData()) !== postInitialState,
                message: 'Є незбережені зміни контенту. Закрити без збереження?',
                okText: 'Закрити без збереження',
                cancelText: 'Повернутись'
            });
        }
        closeNow();
        return true;
    }

    function updateCharCount() {
        const body = document.getElementById('postBody')?.value || '';
        const el = document.getElementById('charCount');
        if (el) el.textContent = body.length + ' символів';
    }

    function getFormData() {
        const platforms = [];
        document.querySelectorAll('#modalPlatforms input:checked').forEach(cb => platforms.push(cb.value));
        const hashtagsRaw = document.getElementById('postHashtags')?.value || '';
        const hashtags = hashtagsRaw.split(',').map(h => h.trim()).filter(Boolean);
        const scheduledAt = document.getElementById('postSchedule')?.value || null;
        const weekDate = scheduledAt ? new Date(scheduledAt) : new Date();

        return {
            title: document.getElementById('postTitle')?.value || '',
            body: document.getElementById('postBody')?.value || '',
            platforms,
            topic: document.getElementById('postTopic')?.value || 'general',
            hashtags,
            scheduled_at: scheduledAt || null,
            notes: document.getElementById('postNotes')?.value || null,
            week_number: getWeekNumber(weekDate),
            year: weekDate.getFullYear(),
            day_of_week: weekDate.getDay() === 0 ? 7 : weekDate.getDay(),
        };
    }

    function renderModalActions(post) {
        const el = document.getElementById('modalActions');
        if (!el) return;
        let html = '';

        if (!post) {
            // New post
            html = `<button class="content-btn content-btn--primary" onclick="ContentPage.savePost()">💾 Зберегти</button>
                    <button class="content-btn content-btn--secondary" onclick="ContentPage.closeModal()">Скасувати</button>`;
        } else {
            html = `<button class="content-btn content-btn--primary" onclick="ContentPage.savePost()">💾 Зберегти</button>`;
            if (post.status === 'draft') {
                html += `<button class="content-btn content-btn--secondary" onclick="ContentPage.submitForApproval(${post.id})">✅ На затвердження</button>`;
            }
            if (post.status === 'pending_approval') {
                html += `<button class="content-btn content-btn--primary" onclick="ContentPage.approvePost(${post.id})">✅ Затвердити</button>`;
                html += `<button class="content-btn content-btn--secondary" onclick="ContentPage.rejectPost(${post.id})">↩️ Повернути</button>`;
            }
            if (['draft', 'approved'].includes(post.status)) {
                html += `<button class="content-btn content-btn--secondary" onclick="ContentPage.schedulePost(${post.id})">📅 Запланувати</button>`;
            }
            if (['approved', 'scheduled'].includes(post.status)) {
                html += `<button class="content-btn content-btn--primary" onclick="ContentPage.publishPostNow(${post.id})">🚀 Опублікувати</button>`;
            }
            html += `<button class="content-btn content-btn--secondary" onclick="ContentPage.regeneratePost(${post.id})">🔄 Перегенерувати</button>`;
            html += `<button class="content-btn content-btn--danger" onclick="ContentPage.deletePost(${post.id})">🗑️ Видалити</button>`;
        }
        el.innerHTML = html;
    }

    async function savePost() {
        const id = document.getElementById('postId')?.value;
        const formData = getFormData();
        if (!formData.title) { notify('Назва обовʼязкова', 'error'); return; }

        try {
            if (id) {
                await api('/posts/' + id, { method: 'PUT', body: JSON.stringify(formData) });
                notify('Пост оновлено');
            } else {
                await api('/posts', { method: 'POST', body: JSON.stringify(formData) });
                notify('Пост створено');
            }
            await closeModal(true);
            loadCalendar();
        } catch (err) {
            notify('Помилка: ' + err.message, 'error');
        }
    }

    async function submitForApproval(id) {
        try {
            await api('/posts/' + id, { method: 'PUT', body: JSON.stringify({ status: 'pending_approval' }) });
            notify('Пост відправлено на затвердження');
            await closeModal(true);
            loadCalendar();
        } catch (err) { notify('Помилка: ' + err.message, 'error'); }
    }

    async function approvePost(id) {
        try {
            await api('/posts/' + id + '/approve', { method: 'PUT' });
            notify('Пост затверджено');
            await closeModal(true);
            loadCalendar();
        } catch (err) { notify('Помилка: ' + err.message, 'error'); }
    }

    async function rejectPost(id) {
        try {
            await api('/posts/' + id + '/reject', { method: 'PUT', body: JSON.stringify({ reason: 'Повернуто на доопрацювання' }) });
            notify('Пост повернуто на доопрацювання');
            await closeModal(true);
            loadCalendar();
        } catch (err) { notify('Помилка: ' + err.message, 'error'); }
    }

    async function schedulePost(id) {
        const scheduledAt = document.getElementById('postSchedule')?.value;
        if (!scheduledAt) { notify('Вкажіть дату публікації', 'error'); return; }
        try {
            await api('/posts/' + id + '/schedule', { method: 'PUT', body: JSON.stringify({ scheduled_at: scheduledAt }) });
            notify('Пост заплановано');
            await closeModal(true);
            loadCalendar();
        } catch (err) { notify('Помилка: ' + err.message, 'error'); }
    }

    async function regeneratePost(id) {
        try {
            const token = getToken();
            const res = await fetch('/api/marketing-agent/regenerate/' + id, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Помилка');
            notify('🔄 Текст перегенеровано');
            openPost(id);
        } catch (err) { notify('Помилка: ' + err.message, 'error'); }
    }

    async function publishPostNow(id) {
        try {
            const token = getToken();
            const res = await fetch('/api/marketing-agent/publish/' + id, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Помилка');
            const published = Object.keys(data.results || {}).join(', ');
            const failed = Object.keys(data.errors || {});
            if (failed.length) notify(`⚠️ Опубліковано (з помилками: ${failed.join(', ')})`, 'warning');
            else notify(`🚀 Опубліковано: ${published}`);
            await closeModal(true);
            loadCalendar();
        } catch (err) { notify('Помилка: ' + err.message, 'error'); }
    }

    async function deletePost(id) {
        if (typeof confirmModal === 'function') {
            const ok = await confirmModal('Видалити цей пост?', { confirmText: 'Видалити', danger: true });
            if (!ok) return;
        }
        try {
            await api('/posts/' + id, { method: 'DELETE' });
            notify('Пост видалено');
            await closeModal(true);
            loadCalendar();
        } catch (err) { notify('Помилка: ' + err.message, 'error'); }
    }

    // ── Generate Week ──
    function openGenerate() {
        const week = getWeekNumber(currentWeekStart);
        const year = currentWeekStart.getFullYear();
        document.getElementById('genWeek').value = week;
        document.getElementById('genYear').value = year;
        document.getElementById('generateModal').classList.add('open');
    }
    function closeGenerate() {
        document.getElementById('generateModal').classList.remove('open');
    }
    async function generateWeek() {
        const week = parseInt(document.getElementById('genWeek')?.value);
        const year = parseInt(document.getElementById('genYear')?.value);
        const platforms = [];
        document.querySelectorAll('#genPlatforms input:checked').forEach(cb => platforms.push(cb.value));
        const topics = [];
        document.querySelectorAll('#genTopics input:checked').forEach(cb => topics.push(cb.value));

        if (!week || !year) { notify('Вкажіть тиждень і рік', 'error'); return; }
        if (!platforms.length) { notify('Оберіть хоча б одну платформу', 'error'); return; }

        try {
            const token = getToken();
            const res = await fetch('/api/marketing-agent/generate-plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ week, year, platforms, topics })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Помилка');
            notify(`🧠 Згенеровано ${data.count || 0} постів`);
            closeGenerate();
            // Navigate to generated week
            const jan1 = new Date(year, 0, 1);
            const days = (week - 1) * 7;
            const weekDate = new Date(jan1.getTime() + days * 86400000);
            currentWeekStart = getMonday(weekDate);
            loadCalendar();
        } catch (err) {
            notify('Помилка генерації: ' + err.message, 'error');
        }
    }

    // ══════════════════════════════════════
    // BUSINESS CARDS
    // ══════════════════════════════════════

    async function bcApi(url, opts = {}) {
        const token = getToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const res = await fetch('/api/business-cards' + url, { ...opts, headers });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
        return await res.json();
    }

    const CAT_LABELS = { general: 'Загальне', service: 'Послуга', event: 'Подія', product: 'Товар' };

    async function loadCards() {
        const grid = document.getElementById('cardsGrid');
        if (!grid) return;
        grid.innerHTML = '<div class="content-empty">⏳ Завантаження...</div>';
        const cat = document.getElementById('cardsCategoryFilter')?.value || '';

        try {
            let url = '/?active=true';
            if (cat) url += '&category=' + cat;
            const data = await bcApi(url);
            const cards = data.data || [];
            if (!cards.length) { grid.innerHTML = '<div class="content-empty">Немає карток. Створіть першу!</div>'; loadSocialRulesButtons(); return; }

            grid.innerHTML = cards.map(c => {
                const hashCount = (c.hashtags_instagram || []).length;
                return `<div class="content-bcard" onclick="ContentPage.openCard(${c.id})">
                    <div class="content-bcard-title">${escapeHtml(c.title)}</div>
                    <div class="content-bcard-slug">${escapeHtml(c.slug)}</div>
                    <div class="content-bcard-desc">${escapeHtml(c.short_description || c.full_description || '—')}</div>
                    <div class="content-bcard-meta">
                        <span class="content-bcard-cat">${CAT_LABELS[c.category] || c.category}</span>
                        ${hashCount ? `<span>${hashCount} хештегів IG</span>` : ''}
                        <span>${c.is_active ? '✅ Активна' : '⏸️ Неактивна'}</span>
                    </div>
                </div>`;
            }).join('');
            loadSocialRulesButtons();
        } catch (err) {
            grid.innerHTML = `<div class="content-empty">❌ ${escapeHtml(err.message)}</div>`;
        }
    }

    async function loadSocialRulesButtons() {
        const container = document.getElementById('socialRulesButtons');
        if (!container) return;
        try {
            const data = await bcApi('/social-rules');
            const rules = data.data || [];
            container.innerHTML = rules.map(r => {
                const icon = PLATFORM_ICONS[r.platform] || '📱';
                return `<button class="content-platform-btn" onclick="ContentPage.openRules('${r.platform}')">${icon} ${r.platform}</button>`;
            }).join('');
        } catch { container.innerHTML = ''; }
    }

    function openNewCard() {
        document.getElementById('cardId').value = '';
        document.getElementById('cardModalTitle').textContent = 'Нова бізнес-картка';
        document.getElementById('cardSlug').value = '';
        document.getElementById('cardTitle').value = '';
        document.getElementById('cardCategory').value = 'service';
        document.getElementById('cardShortDesc').value = '';
        document.getElementById('cardFullDesc').value = '';
        document.getElementById('cardAudience').value = '';
        document.getElementById('cardPrice').value = '';
        document.getElementById('cardFeatures').value = '';
        document.getElementById('cardHashtagsIG').value = '';
        document.getElementById('cardHashtagsTT').value = '';
        document.getElementById('cardHashtagsFB').value = '';
        document.getElementById('cardTone').value = '';
        document.getElementById('cardRules').value = '';
        document.getElementById('cardCTA').value = '';
        document.getElementById('cardDoNot').value = '';
        document.getElementById('cardModalActions').innerHTML =
            `<button class="content-btn content-btn--primary" onclick="ContentPage.saveCard()">💾 Зберегти</button>
             <button class="content-btn content-btn--secondary" onclick="ContentPage.closeCardModal()">Скасувати</button>`;
        const modal = document.getElementById('cardModal');
        modal.classList.add('open');
        cardInitialState = JSON.stringify(getCardFormData());
        if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(modal);
    }

    async function openCard(id) {
        try {
            const data = await bcApi('/' + id);
            const c = data.data;
            document.getElementById('cardId').value = c.id;
            document.getElementById('cardModalTitle').textContent = 'Редагування: ' + c.title;
            document.getElementById('cardSlug').value = c.slug || '';
            document.getElementById('cardTitle').value = c.title || '';
            document.getElementById('cardCategory').value = c.category || 'service';
            document.getElementById('cardShortDesc').value = c.short_description || '';
            document.getElementById('cardFullDesc').value = c.full_description || '';
            document.getElementById('cardAudience').value = c.target_audience || '';
            document.getElementById('cardPrice').value = c.price_info || '';
            document.getElementById('cardFeatures').value = (c.key_features || []).join(', ');
            document.getElementById('cardHashtagsIG').value = (c.hashtags_instagram || []).join(', ');
            document.getElementById('cardHashtagsTT').value = (c.hashtags_tiktok || []).join(', ');
            document.getElementById('cardHashtagsFB').value = (c.hashtags_facebook || []).join(', ');
            document.getElementById('cardTone').value = c.tone_of_voice || '';
            document.getElementById('cardRules').value = c.content_rules || '';
            document.getElementById('cardCTA').value = c.call_to_action || '';
            document.getElementById('cardDoNot').value = (c.do_not || []).join(', ');
            document.getElementById('cardModalActions').innerHTML =
                `<button class="content-btn content-btn--primary" onclick="ContentPage.saveCard()">💾 Зберегти</button>
                 <button class="content-btn content-btn--danger" onclick="ContentPage.deleteCard(${c.id})">🗑️ Видалити</button>
                 <button class="content-btn content-btn--secondary" onclick="ContentPage.closeCardModal()">Скасувати</button>`;
            const modal = document.getElementById('cardModal');
            modal.classList.add('open');
            cardInitialState = JSON.stringify(getCardFormData());
            if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(modal);
        } catch (err) { notify('Помилка: ' + err.message, 'error'); }
    }

    function getCardFormData() {
        return {
            slug: document.getElementById('cardSlug')?.value || '',
            title: document.getElementById('cardTitle')?.value || '',
            category: document.getElementById('cardCategory')?.value || '',
            short: document.getElementById('cardShortDesc')?.value || '',
            full: document.getElementById('cardFullDesc')?.value || '',
            audience: document.getElementById('cardAudience')?.value || '',
            price: document.getElementById('cardPrice')?.value || '',
            features: document.getElementById('cardFeatures')?.value || '',
            ig: document.getElementById('cardHashtagsIG')?.value || '',
            tt: document.getElementById('cardHashtagsTT')?.value || '',
            fb: document.getElementById('cardHashtagsFB')?.value || '',
            tone: document.getElementById('cardTone')?.value || '',
            rules: document.getElementById('cardRules')?.value || '',
            cta: document.getElementById('cardCTA')?.value || '',
            doNot: document.getElementById('cardDoNot')?.value || ''
        };
    }

    async function closeCardModal(force = false) {
        const modal = document.getElementById('cardModal');
        const closeNow = () => {
            modal?.classList.remove('open');
            cardInitialState = '';
        };
        if (window.UnsafeDismissGuard && modal) {
            return window.UnsafeDismissGuard.attemptCloseEditableSurface(modal, closeNow, {
                force,
                isDirty: () => JSON.stringify(getCardFormData()) !== cardInitialState,
                message: 'Є незбережені зміни бізнес-картки. Закрити без збереження?',
                okText: 'Закрити без збереження',
                cancelText: 'Повернутись'
            });
        }
        closeNow();
        return true;
    }

    function splitComma(val) { return val ? val.split(',').map(s => s.trim()).filter(Boolean) : []; }

    async function saveCard() {
        const id = document.getElementById('cardId')?.value;
        const body = {
            slug: document.getElementById('cardSlug')?.value?.trim(),
            title: document.getElementById('cardTitle')?.value?.trim(),
            category: document.getElementById('cardCategory')?.value,
            short_description: document.getElementById('cardShortDesc')?.value || null,
            full_description: document.getElementById('cardFullDesc')?.value || null,
            target_audience: document.getElementById('cardAudience')?.value || null,
            price_info: document.getElementById('cardPrice')?.value || null,
            key_features: splitComma(document.getElementById('cardFeatures')?.value),
            hashtags_instagram: splitComma(document.getElementById('cardHashtagsIG')?.value),
            hashtags_tiktok: splitComma(document.getElementById('cardHashtagsTT')?.value),
            hashtags_facebook: splitComma(document.getElementById('cardHashtagsFB')?.value),
            tone_of_voice: document.getElementById('cardTone')?.value || null,
            content_rules: document.getElementById('cardRules')?.value || null,
            call_to_action: document.getElementById('cardCTA')?.value || null,
            do_not: splitComma(document.getElementById('cardDoNot')?.value),
        };
        if (!body.slug || !body.title) { notify('Slug та назва обовʼязкові', 'error'); return; }
        try {
            if (id) {
                await bcApi('/' + id, { method: 'PUT', body: JSON.stringify(body) });
                notify('Картку оновлено');
            } else {
                await bcApi('/', { method: 'POST', body: JSON.stringify(body) });
                notify('Картку створено');
            }
            await closeCardModal(true);
            loadCards();
        } catch (err) { notify('Помилка: ' + err.message, 'error'); }
    }

    async function deleteCard(id) {
        if (typeof confirmModal === 'function') {
            const ok = await confirmModal('Видалити цю картку?', { confirmText: 'Видалити', danger: true });
            if (!ok) return;
        }
        try {
            await bcApi('/' + id, { method: 'DELETE' });
            notify('Картку видалено');
            await closeCardModal(true);
            loadCards();
        } catch (err) { notify('Помилка: ' + err.message, 'error'); }
    }

    // ── Social Rules ──
    async function openRules(platform) {
        try {
            const data = await bcApi('/social-rules');
            const rule = (data.data || []).find(r => r.platform === platform);
            if (!rule) { notify('Правила не знайдено', 'error'); return; }
            const icon = PLATFORM_ICONS[platform] || '📱';
            document.getElementById('rulesModalTitle').textContent = icon + ' ' + platform;
            document.getElementById('rulesPlatform').value = platform;
            document.getElementById('rulesMaxLength').value = rule.max_text_length || '';
            document.getElementById('rulesMediaRequired').value = rule.media_required ? 'true' : 'false';
            document.getElementById('rulesHashtagLimit').value = rule.hashtag_limit || '';
            document.getElementById('rulesTone').value = rule.tone || '';
            document.getElementById('rulesFormatting').value = rule.formatting_rules || '';
            document.getElementById('rulesImageRatio').value = rule.image_ratio || '';
            document.getElementById('rulesHashtagPlacement').value = rule.hashtag_placement || 'end';
            document.getElementById('rulesDefHashtags').value = (rule.default_hashtags || []).join(', ');
            document.getElementById('rulesModal').classList.add('open');
        } catch (err) { notify('Помилка: ' + err.message, 'error'); }
    }

    function closeRulesModal() { document.getElementById('rulesModal').classList.remove('open'); }

    async function saveRules() {
        const platform = document.getElementById('rulesPlatform')?.value;
        if (!platform) return;
        const body = {
            max_text_length: parseInt(document.getElementById('rulesMaxLength')?.value) || null,
            media_required: document.getElementById('rulesMediaRequired')?.value === 'true',
            hashtag_limit: parseInt(document.getElementById('rulesHashtagLimit')?.value) || null,
            tone: document.getElementById('rulesTone')?.value || null,
            formatting_rules: document.getElementById('rulesFormatting')?.value || null,
            image_ratio: document.getElementById('rulesImageRatio')?.value || null,
            hashtag_placement: document.getElementById('rulesHashtagPlacement')?.value || null,
            default_hashtags: splitComma(document.getElementById('rulesDefHashtags')?.value),
        };
        try {
            await bcApi('/social-rules/' + platform, { method: 'PUT', body: JSON.stringify(body) });
            notify('Правила оновлено');
            closeRulesModal();
        } catch (err) { notify('Помилка: ' + err.message, 'error'); }
    }

    // ── Init on load ──
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public API
    return {
        prevWeek, nextWeek, goToday, setView, filterPlatform,
        openNewPost, openPost, closeModal, savePost,
        submitForApproval, approvePost, rejectPost,
        schedulePost, regeneratePost, deletePost, publishPostNow,
        openGenerate, closeGenerate, generateWeek,
        loadAllPosts, loadAccounts, toggleAccount,
        updateCharCount,
        loadCards, openNewCard, openCard, closeCardModal, saveCard, deleteCard,
        openRules, closeRulesModal, saveRules,
    };
})();
