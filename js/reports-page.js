/**
 * js/reports-page.js — Reports page frontend (v32.7)
 *
 * Summary cards, filters, table with sorting/pagination, Chart.js charts,
 * on-duty accountants, hashtag dashboard, add/edit modal with hashtag support.
 */

/* global apiVerifyToken, initDarkMode, Chart */

const ReportsPage = (() => {
    let _reports = [];
    let _summary = null;
    let _hashtagStats = [];
    let _total = 0;
    let _page = 1;
    const _limit = 20;
    let _sortField = 'createdAt';
    let _sortDir = 'desc';
    let _expandedRow = null;
    let _editingId = null;
    let _modalHashtags = [];

    // Chart instances
    let _barChart = null;
    let _pieChart = null;
    let _lineChart = null;

    const EXPENSE_CATEGORIES = ['Афіша', 'ЗП', 'Майстер-класи', 'ДАР', 'Костюми', 'Квести', 'Реквізит', 'Аквагрим', 'Декорації', 'Офіс', 'Інше'];
    const DEFAULT_HASHTAGS = ['СШ-Парк', 'СШ-Особистий', 'ДАР'];

    // ==========================================
    // HELPERS
    // ==========================================

    async function apiRequest(method, url, body) {
        const token = localStorage.getItem('pzp_token');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (body) headers['Content-Type'] = 'application/json';
        const res = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });
        if (res.status === 401 || res.status === 403) {
            localStorage.removeItem('pzp_token');
        window.location.href = '/';
        throw new Error('Unauthorized');
        }
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Request failed');
        }
        return res.json();
    }

    function showNotification(msg, type = 'success') {
        const el = document.getElementById('notification');
        const text = document.getElementById('notificationText');
        if (!el || !text) return;
        text.textContent = msg;
        el.className = `notification ${type}`;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 3000);
    }

    function formatDateTime(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }) +
            ' ' + d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    }

    function formatAmount(amount) {
        return Number(amount).toLocaleString('uk-UA') + ' ₴';
    }

    function esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    const STATUS_LABELS = {
        new: 'Новий',
        processing: 'В обробці',
        done: 'Опрацьовано',
        rejected: 'Відхилено'
    };

    const PIE_COLORS = ['#8B5CF6', '#EC4899', '#F97316', '#EAB308', '#22C55E', '#06B6D4', '#6366F1', '#F43F5E'];

    // ==========================================
    // DATE RANGE HELPERS
    // ==========================================

    function getDateRange() {
        const period = document.getElementById('periodFilter')?.value || 'month';
        const now = new Date();
        const today = now.toISOString().slice(0, 10);

        if (period === 'custom') {
            return {
                dateFrom: document.getElementById('dateFromFilter')?.value || '',
                dateTo: document.getElementById('dateToFilter')?.value || ''
            };
        }
        if (period === 'today') return { dateFrom: today, dateTo: today };
        if (period === 'week') {
            const weekAgo = new Date(now);
            weekAgo.setDate(weekAgo.getDate() - 7);
            return { dateFrom: weekAgo.toISOString().slice(0, 10), dateTo: today };
        }
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        return { dateFrom: monthStart, dateTo: today };
    }

    // ==========================================
    // INIT
    // ==========================================

    async function init() {
        try {
            if (typeof apiVerifyToken === 'function') {
                const user = await apiVerifyToken();
                if (user) AppState.currentUser = user;
            }
        } catch { return; }
        if (typeof initDarkMode === 'function') initDarkMode();

        const periodFilter = document.getElementById('periodFilter');
        if (periodFilter) {
            periodFilter.addEventListener('change', () => {
                const custom = periodFilter.value === 'custom';
                document.getElementById('dateFromFilter')?.style.display = custom ? '' : 'none';
                document.getElementById('dateToFilter')?.style.display = custom ? '' : 'none';
            });
        }

        document.getElementById('addReportBtn')?.addEventListener('click', () => openModal());

        document.getElementById('reportModal')?.addEventListener('click', e => {
            if (e.target === e.currentTarget) closeModal();
        });

        await Promise.all([
            loadSummary(),
            loadReports(),
            loadOnDuty(),
            loadSubmitters(),
            loadHashtags()
        ]);
    }

    // ==========================================
    // DATA LOADING
    // ==========================================

    async function loadSummary() {
        try {
            const period = document.getElementById('periodFilter')?.value || 'month';
            const range = getDateRange();
            let url = `/api/reports/summary?period=${period}`;
            if (range.dateFrom) url += `&dateFrom=${range.dateFrom}`;
            if (range.dateTo) url += `&dateTo=${range.dateTo}`;

            _summary = await apiRequest('GET', url);
            renderSummaryCards();
            renderCharts();
        } catch (err) {
            console.error('Load summary error:', err);
        }
    }

    async function loadReports() {
        try {
            const params = new URLSearchParams();
            const range = getDateRange();
            if (range.dateFrom) params.set('dateFrom', range.dateFrom);
            if (range.dateTo) params.set('dateTo', range.dateTo);

            const type = document.getElementById('typeFilter')?.value;
            const status = document.getElementById('statusFilter')?.value;
            const submittedBy = document.getElementById('submittedByFilter')?.value;
            const category = document.getElementById('categoryFilter')?.value;
            const hashtag = document.getElementById('hashtagFilter')?.value;

            if (type) params.set('type', type);
            if (status) params.set('status', status);
            if (submittedBy) params.set('submittedBy', submittedBy);
            if (category) params.set('category', category);
            if (hashtag) params.set('hashtag', hashtag);

            params.set('limit', _limit);
            params.set('offset', (_page - 1) * _limit);

            const data = await apiRequest('GET', `/api/reports?${params}`);
            _reports = data.reports || [];
            _total = data.total || 0;

            sortReports();
            renderTable();
            renderPagination();
        } catch (err) {
            console.error('Load reports error:', err);
            const tbody = document.getElementById('reportsTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:20px;color:#EF4444">Помилка завантаження</td></tr>';
        }
    }

    async function loadOnDuty() {
        try {
            const data = await apiRequest('GET', '/api/reports/accountants');
            const list = document.getElementById('onDutyList');
            if (!list) return;

            const onDuty = (data || []).filter(a => a.isOnDuty);
            if (onDuty.length === 0) {
                list.innerHTML = '<li style="color:var(--gray-400)">Ніхто не на зміні</li>';
                return;
            }
            list.innerHTML = onDuty.map(a =>
                `<li>👩‍💼 ${esc(a.name)}${a.phone ? ` (${esc(a.phone)})` : ''} ✅</li>`
            ).join('');
        } catch (err) {
            console.error('Load on-duty error:', err);
        }
    }

    async function loadSubmitters() {
        try {
            const data = await apiRequest('GET', '/api/reports?limit=500');
            const names = [...new Set((data.reports || []).map(r => r.submittedBy).filter(Boolean))];
            const select = document.getElementById('submittedByFilter');
            if (!select) return;
            names.sort().forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                select.appendChild(opt);
            });
        } catch (err) {
            console.error('Load submitters error:', err);
        }
    }

    async function loadHashtags() {
        try {
            _hashtagStats = await apiRequest('GET', '/api/reports/hashtags');
            renderHashtagDashboard();
            populateHashtagFilter();
        } catch (err) {
            console.error('Load hashtags error:', err);
        }
    }

    // ==========================================
    // SORTING
    // ==========================================

    function sortReports() {
        _reports.sort((a, b) => {
            let va = a[_sortField];
            let vb = b[_sortField];

            if (_sortField === 'amount') {
                va = parseFloat(va) || 0;
                vb = parseFloat(vb) || 0;
            } else if (_sortField === 'createdAt') {
                va = new Date(va || 0).getTime();
                vb = new Date(vb || 0).getTime();
            } else {
                va = String(va || '').toLowerCase();
                vb = String(vb || '').toLowerCase();
            }

            if (va < vb) return _sortDir === 'asc' ? -1 : 1;
            if (va > vb) return _sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    function sort(field) {
        if (_sortField === field) {
            _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            _sortField = field;
            _sortDir = field === 'amount' || field === 'createdAt' ? 'desc' : 'asc';
        }
        sortReports();
        renderTable();
    }

    // ==========================================
    // RENDER: Summary Cards
    // ==========================================

    function renderSummaryCards() {
        if (!_summary) return;
        const { today } = _summary;
        const inc = today?.income || 0;
        const exp = today?.expense || 0;

        document.getElementById('sumIncome').textContent = formatAmount(inc);
        document.getElementById('sumExpense').textContent = formatAmount(exp);
        document.getElementById('sumProfit').textContent = formatAmount(inc - exp);
        document.getElementById('sumPending').textContent = today?.newReports || _summary.statuses?.new || 0;
    }

    // ==========================================
    // RENDER: Hashtag Dashboard
    // ==========================================

    function renderHashtagDashboard() {
        const container = document.getElementById('hashtagDashboard');
        if (!container) return;

        if (_hashtagStats.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = _hashtagStats.map(h => {
            const isActive = h.inactiveCount === 0;
            return `
                <div class="rpt-hashtag-card" onclick="ReportsPage.filterByHashtag('${esc(h.hashtag)}')">
                    <div class="rpt-hashtag-card-header">
                        <span class="rpt-hashtag-card-name">#${esc(h.hashtag)}</span>
                        <label class="rpt-hashtag-toggle" onclick="event.stopPropagation()">
                            <input type="checkbox" ${isActive ? 'checked' : ''}
                                onchange="ReportsPage.toggleHashtagActive('${esc(h.hashtag)}', this.checked)">
                            <span class="rpt-hashtag-toggle-slider"></span>
                        </label>
                    </div>
                    <div class="rpt-hashtag-card-amount">${formatAmount(h.total)}</div>
                    <div class="rpt-hashtag-card-stats">Звітів: ${h.count} (активних: ${h.activeCount})</div>
                </div>
            `;
        }).join('');
    }

    function populateHashtagFilter() {
        const select = document.getElementById('hashtagFilter');
        if (!select) return;

        // Keep first option, remove rest
        while (select.options.length > 1) select.remove(1);

        // Add from stats
        const tags = _hashtagStats.map(h => h.hashtag);
        // Also add default tags if not present
        DEFAULT_HASHTAGS.forEach(t => { if (!tags.includes(t)) tags.push(t); });

        tags.forEach(tag => {
            const opt = document.createElement('option');
            opt.value = tag;
            opt.textContent = '#' + tag;
            select.appendChild(opt);
        });
    }

    function filterByHashtag(tag) {
        const select = document.getElementById('hashtagFilter');
        if (select) select.value = tag;
        _page = 1;
        loadReports();
    }

    async function toggleHashtagActive(hashtag, active) {
        try {
            const result = await apiRequest('PATCH', '/api/reports/hashtags/toggle', { hashtag, active });
            showNotification(active
                ? `#${hashtag} увімкнено (${result.updated} звітів)`
                : `#${hashtag} вимкнено з підрахунків (${result.updated} звітів)`
            );
            await Promise.all([loadHashtags(), loadSummary(), loadReports()]);
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    // ==========================================
    // RENDER: Table
    // ==========================================

    function renderTable() {
        const tbody = document.getElementById('reportsTableBody');
        if (!tbody) return;

        if (_reports.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--gray-400)">Немає звітів за обраний період</td></tr>';
            return;
        }

        tbody.innerHTML = _reports.map(r => {
            const typeClass = r.type === 'income' ? 'income' : 'expense';
            const typeLabel = r.type === 'income' ? '📈 Дохід' : '📉 Витрата';
            const statusLabel = STATUS_LABELS[r.status] || r.status;
            const photoBtn = r.photoUrl
                ? `<button class="rpt-photo-btn" onclick="event.stopPropagation();ReportsPage.showPhoto('${esc(r.photoUrl)}')" title="Переглянути фото">📸</button>`
                : '—';
            const tags = (r.hashtags || []).map(t => `<span class="rpt-hashtag">#${esc(t)}</span>`).join('');
            const inactiveClass = r.hashtagActive === false ? ' style="opacity:0.5"' : '';

            return `
                <tr onclick="ReportsPage.toggleDetail(${r.id})" data-id="${r.id}"${inactiveClass}>
                    <td>${r.id}</td>
                    <td>${formatDateTime(r.createdAt)}</td>
                    <td><span class="rpt-type-badge ${typeClass}">${typeLabel}</span></td>
                    <td><span class="rpt-amount-${typeClass}">${formatAmount(r.amount)}</span></td>
                    <td>${esc(r.description) || '—'}${tags ? '<br>' + tags : ''}</td>
                    <td>${esc(r.category) || '—'}</td>
                    <td>${esc(r.submittedBy) || '—'}</td>
                    <td>${photoBtn}</td>
                    <td><span class="rpt-status-badge ${r.status}">${statusLabel}</span></td>
                    <td>
                        <div style="display:flex;gap:2px">
                            ${r.status === 'new' ? `<button class="rpt-action-btn" onclick="event.stopPropagation();ReportsPage.markProcessing(${r.id})" title="В обробку">⏳</button>` : ''}
                            ${r.status !== 'done' ? `<button class="rpt-action-btn" onclick="event.stopPropagation();ReportsPage.markDone(${r.id})" title="Опрацьовано">✅</button>` : ''}
                            <button class="rpt-action-btn" onclick="event.stopPropagation();ReportsPage.editReport(${r.id})" title="Редагувати">✏️</button>
                            <button class="rpt-action-btn" onclick="event.stopPropagation();ReportsPage.deleteReport(${r.id})" title="Видалити">🗑️</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function toggleDetail(id) {
        const existing = document.querySelector(`.rpt-detail-row[data-detail="${id}"]`);
        if (existing) {
            existing.remove();
            _expandedRow = null;
            return;
        }

        document.querySelectorAll('.rpt-detail-row').forEach(el => el.remove());

        const report = _reports.find(r => r.id === id);
        if (!report) return;
        _expandedRow = id;

        const row = document.querySelector(`tr[data-id="${id}"]`);
        if (!row) return;

        const tags = (report.hashtags || []).map(t => `<span class="rpt-hashtag">#${esc(t)}</span>`).join(' ');

        const detailRow = document.createElement('tr');
        detailRow.className = 'rpt-detail-row';
        detailRow.dataset.detail = id;
        detailRow.innerHTML = `
            <td colspan="11">
                <div class="rpt-detail-content">
                    ${tags ? `<p><strong>Хештеги:</strong> ${tags}</p>` : ''}
                    ${report.ocrText ? `<p><strong>OCR текст:</strong> ${esc(report.ocrText)}</p>` : ''}
                    ${report.voiceTranscript ? `<p><strong>Голосовий:</strong> ${esc(report.voiceTranscript)}</p>` : ''}
                    <p><strong>Канал:</strong> ${esc(report.submittedVia) || 'web'}</p>
                    ${report.accountantName ? `<p><strong>Бухгалтер:</strong> ${esc(report.accountantName)}</p>` : ''}
                    ${report.processedAt ? `<p><strong>Опрацьовано:</strong> ${formatDateTime(report.processedAt)}</p>` : ''}
                    <p><strong>Створено:</strong> ${formatDateTime(report.createdAt)}</p>
                    <p><strong>Враховується в підсумках:</strong> ${report.hashtagActive !== false ? '✅ Так' : '❌ Ні'}</p>
                </div>
            </td>
        `;
        row.after(detailRow);
    }

    // ==========================================
    // RENDER: Pagination
    // ==========================================

    function renderPagination() {
        const container = document.getElementById('reportsPagination');
        if (!container) return;

        const totalPages = Math.ceil(_total / _limit) || 1;
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        let html = `<button ${_page <= 1 ? 'disabled' : ''} onclick="ReportsPage.goPage(${_page - 1})">←</button>`;
        for (let i = 1; i <= totalPages; i++) {
            if (totalPages > 7 && i > 2 && i < totalPages - 1 && Math.abs(i - _page) > 1) {
                if (i === 3 || i === totalPages - 2) html += '<button disabled>...</button>';
                continue;
            }
            html += `<button class="${i === _page ? 'active' : ''}" onclick="ReportsPage.goPage(${i})">${i}</button>`;
        }
        html += `<button ${_page >= totalPages ? 'disabled' : ''} onclick="ReportsPage.goPage(${_page + 1})">→</button>`;
        container.innerHTML = html;
    }

    function goPage(page) {
        _page = page;
        loadReports();
    }

    // ==========================================
    // RENDER: Charts (Chart.js)
    // ==========================================

    function renderCharts() {
        if (!_summary) return;
        renderBarChart();
        renderPieChart();
        renderLineChart();
    }

    function renderBarChart() {
        const canvas = document.getElementById('barChart');
        if (!canvas || !_summary) return;

        const daily = _summary.daily || [];
        const days = {};
        daily.forEach(d => {
            const key = d.day?.slice(0, 10) || d.day;
            if (!days[key]) days[key] = { income: 0, expense: 0 };
            days[key][d.type] = parseFloat(d.total) || 0;
        });

        const labels = Object.keys(days).sort().map(k => k.slice(5));
        const incomeData = Object.keys(days).sort().map(k => days[k].income);
        const expenseData = Object.keys(days).sort().map(k => days[k].expense);

        if (_barChart) _barChart.destroy();
        _barChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Доходи', data: incomeData, backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 4 },
                    { label: 'Витрати', data: expenseData, backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 4 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top', labels: { font: { family: 'Inter', size: 12 } } } },
                scales: { y: { beginAtZero: true, ticks: { callback: v => (v / 1000) + 'k' } } }
            }
        });
    }

    function renderPieChart() {
        const canvas = document.getElementById('pieChart');
        if (!canvas || !_summary) return;

        const categories = (_summary.categories || []).filter(c => c.type === 'expense');
        if (categories.length === 0) {
            if (_pieChart) _pieChart.destroy();
            _pieChart = null;
            return;
        }

        const labels = categories.map(c => c.category || 'Інше');
        const data = categories.map(c => parseFloat(c.total) || 0);

        if (_pieChart) _pieChart.destroy();
        _pieChart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{ data, backgroundColor: PIE_COLORS.slice(0, labels.length), borderWidth: 2 }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { font: { family: 'Inter', size: 11 }, padding: 12 } }
                }
            }
        });
    }

    function renderLineChart() {
        const canvas = document.getElementById('lineChart');
        if (!canvas || !_summary) return;

        const daily = _summary.daily || [];
        const days = {};
        daily.forEach(d => {
            const key = d.day?.slice(0, 10) || d.day;
            if (!days[key]) days[key] = { income: 0, expense: 0 };
            days[key][d.type] = parseFloat(d.total) || 0;
        });

        const sortedKeys = Object.keys(days).sort();
        const labels = sortedKeys.map(k => k.slice(5));
        const profitData = sortedKeys.map(k => days[k].income - days[k].expense);

        if (_lineChart) _lineChart.destroy();
        _lineChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Прибуток',
                    data: profitData,
                    borderColor: '#6366F1',
                    backgroundColor: 'rgba(99,102,241,0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 3,
                    pointBackgroundColor: '#6366F1'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { ticks: { callback: v => (v / 1000) + 'k' } } }
            }
        });
    }

    // ==========================================
    // ACTIONS
    // ==========================================

    function showPhoto(url) {
        const lb = document.createElement('div');
        lb.className = 'rpt-lightbox';
        lb.onclick = () => lb.remove();
        lb.innerHTML = `<img src="${esc(url)}" alt="Фото звіту">`;
        document.body.appendChild(lb);
    }

    async function markProcessing(id) {
        try {
            await apiRequest('PUT', `/api/reports/${id}`, { status: 'processing' });
            showNotification('Звіт переведено в обробку');
            await loadReports();
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    async function markDone(id) {
        try {
            await apiRequest('PUT', `/api/reports/${id}`, { status: 'done' });
            showNotification('Звіт опрацьовано');
            await Promise.all([loadReports(), loadSummary()]);
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    async function deleteReport(id) {
        if (!confirm('Видалити звіт?')) return;
        try {
            await apiRequest('DELETE', `/api/reports/${id}`);
            showNotification('Звіт видалено');
            await Promise.all([loadReports(), loadSummary(), loadHashtags()]);
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    // ==========================================
    // MODAL (with hashtag support)
    // ==========================================

    function openModal(report) {
        const modal = document.getElementById('reportModal');
        if (!modal) return;

        _editingId = report?.id || null;
        _modalHashtags = report?.hashtags ? [...report.hashtags] : [];

        document.getElementById('reportModalTitle').textContent = _editingId ? 'Редагувати звіт' : 'Додати звіт вручну';
        document.getElementById('reportType').value = report?.type || 'expense';
        document.getElementById('reportAmount').value = report?.amount || '';
        document.getElementById('reportDescription').value = report?.description || '';
        document.getElementById('reportCategory').value = report?.category || '';
        document.getElementById('reportEditId').value = _editingId || '';

        renderModalHashtags();

        modal.classList.remove('hidden');
        modal.classList.add('active');
    }

    function closeModal() {
        const modal = document.getElementById('reportModal');
        if (modal) {
            modal.classList.remove('active');
            modal.classList.add('hidden');
        }
        _editingId = null;
        _modalHashtags = [];
    }

    function renderModalHashtags() {
        const container = document.getElementById('reportHashtagsInput');
        if (!container) return;
        container.innerHTML = _modalHashtags.map(tag =>
            `<span class="rpt-hashtag" onclick="ReportsPage.removeModalHashtag('${esc(tag)}')" title="Клік щоб видалити">#${esc(tag)} ×</span>`
        ).join('');
    }

    function addHashtagFromSelect() {
        const select = document.getElementById('reportHashtagSelect');
        const val = select?.value;
        if (val && !_modalHashtags.includes(val)) {
            _modalHashtags.push(val);
            renderModalHashtags();
        }
        if (select) select.value = '';
    }

    function addHashtagCustom() {
        const input = document.getElementById('reportHashtagNew');
        const val = input?.value?.trim();
        if (val && !_modalHashtags.includes(val)) {
            _modalHashtags.push(val);
            renderModalHashtags();
        }
        if (input) input.value = '';
    }

    function removeModalHashtag(tag) {
        _modalHashtags = _modalHashtags.filter(t => t !== tag);
        renderModalHashtags();
    }

    async function submitReport(event) {
        event.preventDefault();

        const type = document.getElementById('reportType')?.value;
        const amount = document.getElementById('reportAmount')?.value;
        const description = document.getElementById('reportDescription')?.value;
        const category = document.getElementById('reportCategory')?.value;

        if (!amount || parseFloat(amount) <= 0) {
            showNotification('Вкажіть суму', 'error');
            return;
        }

        try {
            if (_editingId) {
                await apiRequest('PUT', `/api/reports/${_editingId}`, {
                    type,
                    amount: parseFloat(amount),
                    description,
                    category,
                    hashtags: _modalHashtags
                });
                showNotification('Звіт оновлено');
            } else {
                await apiRequest('POST', '/api/reports', {
                    type,
                    amount: parseFloat(amount),
                    description,
                    category,
                    hashtags: _modalHashtags,
                    submittedVia: 'web'
                });
                showNotification('Звіт створено');
            }
            closeModal();
            await Promise.all([loadReports(), loadSummary(), loadHashtags()]);
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    function editReport(id) {
        const report = _reports.find(r => r.id === id);
        if (report) openModal(report);
    }

    // ==========================================
    // FILTER ACTIONS (called from HTML)
    // ==========================================

    function applyFilters() {
        _page = 1;
        loadReports();
        loadSummary();
    }

    function resetFilters() {
        document.getElementById('periodFilter').value = 'month';
        document.getElementById('dateFromFilter')?.style.display = 'none';
        document.getElementById('dateToFilter')?.style.display = 'none';
        document.getElementById('dateFromFilter').value = '';
        document.getElementById('dateToFilter').value = '';
        document.getElementById('typeFilter').value = '';
        document.getElementById('statusFilter').value = '';
        document.getElementById('submittedByFilter').value = '';
        document.getElementById('categoryFilter').value = '';
        document.getElementById('hashtagFilter').value = '';
        _page = 1;
        loadReports();
        loadSummary();
    }

    // ==========================================
    // INIT ON LOAD
    // ==========================================

    document.addEventListener('DOMContentLoaded', init);

    return {
        applyFilters,
        resetFilters,
        sort,
        goPage,
        toggleDetail,
        showPhoto,
        markProcessing,
        markDone,
        deleteReport,
        editReport,
        closeModal,
        submitReport,
        filterByHashtag,
        toggleHashtagActive,
        addHashtagFromSelect,
        addHashtagCustom,
        removeModalHashtag
    };
})();
