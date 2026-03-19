/**
 * js/reports-page.js — Reports module frontend (v32.4)
 *
 * Summary dashboard with charts, reports table, gallery, accountant settings.
 */

/* global apiVerifyToken, initDarkMode */

const ReportsPage = (() => {
    let _reports = [];
    let _summary = null;
    let _accountants = [];
    let _currentPeriod = 'month';
    let _editingId = null;

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
            document.getElementById('loginOverlay')?.classList.remove('hidden');
            if (document.getElementById('mainApp')) document.getElementById('mainApp').style.display = 'none';
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

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: undefined });
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
        new: '🆕 Новий',
        processing: '⏳ В обробці',
        done: '✅ Опрацьовано',
        rejected: '❌ Відхилено'
    };

    const TYPE_LABELS = {
        income: '📈 Дохід',
        expense: '📉 Витрата'
    };

    const PIE_COLORS = ['#8B5CF6', '#EC4899', '#F97316', '#EAB308', '#22C55E', '#06B6D4', '#6366F1', '#F43F5E'];

    // ==========================================
    // INIT
    // ==========================================

    async function init() {
        try {
            if (typeof apiVerifyToken === 'function') await apiVerifyToken();
        } catch { return; }
        if (typeof initDarkMode === 'function') initDarkMode();

        initTabs();
        initPeriodSelector();
        initFilters();
        initModal();

        await Promise.all([
            loadSummary(),
            loadReports(),
            loadAccountants()
        ]);
    }

    function initTabs() {
        document.querySelectorAll('.rep-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.rep-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.rep-tab-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                const panel = document.querySelector(`.rep-tab-panel[data-tab="${tab.dataset.tab}"]`);
                if (panel) panel.classList.add('active');

                if (tab.dataset.tab === 'gallery') renderGallery();
                if (tab.dataset.tab === 'settings') renderSettings();
            });
        });
    }

    function initPeriodSelector() {
        document.querySelectorAll('.rep-period-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.rep-period-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                _currentPeriod = btn.dataset.period;
                loadSummary();
            });
        });
    }

    function initFilters() {
        document.getElementById('applyFiltersBtn')?.addEventListener('click', () => {
            loadReports();
        });

        // Enter key triggers filter
        ['filterDateFrom', 'filterDateTo', 'filterSubmittedBy'].forEach(id => {
            document.getElementById(id)?.addEventListener('keydown', e => {
                if (e.key === 'Enter') loadReports();
            });
        });

        ['filterType', 'filterStatus'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => loadReports());
        });
    }

    function initModal() {
        document.getElementById('addReportBtn')?.addEventListener('click', () => openModal());

        // Close on overlay click
        document.getElementById('reportModal')?.addEventListener('click', e => {
            if (e.target === e.currentTarget) closeModal();
        });
    }

    // ==========================================
    // DATA LOADING
    // ==========================================

    async function loadSummary() {
        try {
            _summary = await apiRequest('GET', `/api/reports/summary?period=${_currentPeriod}`);
            renderSummary();
        } catch (err) {
            console.error('Load summary error:', err);
        }
    }

    async function loadReports() {
        try {
            const params = new URLSearchParams();
            const dateFrom = document.getElementById('filterDateFrom')?.value;
            const dateTo = document.getElementById('filterDateTo')?.value;
            const type = document.getElementById('filterType')?.value;
            const status = document.getElementById('filterStatus')?.value;
            const submittedBy = document.getElementById('filterSubmittedBy')?.value;

            if (dateFrom) params.set('dateFrom', dateFrom);
            if (dateTo) params.set('dateTo', dateTo);
            if (type) params.set('type', type);
            if (status) params.set('status', status);
            if (submittedBy) params.set('submittedBy', submittedBy);

            const data = await apiRequest('GET', `/api/reports?${params}`);
            _reports = data.reports || [];
            renderTable();
        } catch (err) {
            console.error('Load reports error:', err);
        }
    }

    async function loadAccountants() {
        try {
            _accountants = await apiRequest('GET', '/api/reports/accountants');
        } catch (err) {
            console.error('Load accountants error:', err);
        }
    }

    // ==========================================
    // RENDER: Summary
    // ==========================================

    function renderSummary() {
        if (!_summary) return;
        const { totals, today } = _summary;

        // Stats cards
        document.getElementById('repStats').innerHTML = `
            <div class="rep-stat-card income">
                <div class="rep-stat-icon">📈</div>
                <div class="rep-stat-value income">${formatAmount(totals.income)}</div>
                <div class="rep-stat-label">Доходи (${totals.incomeCount})</div>
            </div>
            <div class="rep-stat-card expense">
                <div class="rep-stat-icon">📉</div>
                <div class="rep-stat-value expense">${formatAmount(totals.expense)}</div>
                <div class="rep-stat-label">Витрати (${totals.expenseCount})</div>
            </div>
            <div class="rep-stat-card profit">
                <div class="rep-stat-icon">💰</div>
                <div class="rep-stat-value profit">${formatAmount(totals.profit)}</div>
                <div class="rep-stat-label">Прибуток</div>
            </div>
            <div class="rep-stat-card count">
                <div class="rep-stat-icon">📊</div>
                <div class="rep-stat-value">${today.newReports}</div>
                <div class="rep-stat-label">Сьогодні звітів</div>
            </div>
        `;

        renderBarChart();
        renderPieChart();
        renderLineChart();
    }

    // ==========================================
    // RENDER: Bar chart (income vs expense by day/week)
    // ==========================================

    function renderBarChart() {
        const container = document.getElementById('repBarChart');
        if (!container || !_summary) return;

        const daily = _summary.daily || [];
        // Group by day
        const days = {};
        daily.forEach(d => {
            const key = d.day?.slice(0, 10) || d.day;
            if (!days[key]) days[key] = { income: 0, expense: 0 };
            days[key][d.type] = d.total;
        });

        const dayKeys = Object.keys(days).sort();
        if (dayKeys.length === 0) {
            container.innerHTML = '<div class="rep-empty" style="padding:20px">Немає даних</div>';
            return;
        }

        const maxVal = Math.max(...dayKeys.map(k => Math.max(days[k].income, days[k].expense)), 1);

        container.innerHTML = dayKeys.map(key => {
            const d = days[key];
            const incH = Math.max((d.income / maxVal) * 180, 4);
            const expH = Math.max((d.expense / maxVal) * 180, 4);
            const label = key.slice(5); // MM-DD
            return `
                <div class="rep-bar-group">
                    <div class="rep-bar-pair">
                        <div class="rep-bar income" style="height:${incH}px" title="Дохід: ${formatAmount(d.income)}"></div>
                        <div class="rep-bar expense" style="height:${expH}px" title="Витрата: ${formatAmount(d.expense)}"></div>
                    </div>
                    <div class="rep-bar-label">${label}</div>
                </div>
            `;
        }).join('');
    }

    // ==========================================
    // RENDER: Pie chart (top expense categories)
    // ==========================================

    function renderPieChart() {
        const container = document.getElementById('repPieChart');
        if (!container || !_summary) return;

        const categories = (_summary.categories || []).filter(c => c.type === 'expense');
        if (categories.length === 0) {
            container.innerHTML = '<div class="rep-empty" style="padding:20px">Немає витрат</div>';
            return;
        }

        const total = categories.reduce((sum, c) => sum + c.total, 0);
        let cumPercent = 0;
        const gradientParts = [];
        const legendItems = [];

        categories.slice(0, 8).forEach((cat, i) => {
            const percent = (cat.total / total) * 100;
            const color = PIE_COLORS[i % PIE_COLORS.length];
            gradientParts.push(`${color} ${cumPercent}% ${cumPercent + percent}%`);
            cumPercent += percent;

            legendItems.push(`
                <div class="rep-pie-legend-item">
                    <div class="rep-pie-color" style="background:${color}"></div>
                    <span>${esc(cat.category)}</span>
                    <span class="rep-pie-amount">${formatAmount(cat.total)}</span>
                </div>
            `);
        });

        container.innerHTML = `
            <div class="rep-pie" style="background: conic-gradient(${gradientParts.join(', ')})"></div>
            <div class="rep-pie-legend">${legendItems.join('')}</div>
        `;
    }

    // ==========================================
    // RENDER: Line chart (canvas)
    // ==========================================

    function renderLineChart() {
        const canvas = document.getElementById('repLineChart');
        if (!canvas || !_summary) return;

        const ctx = canvas.getContext('2d');
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width - 40;
        canvas.height = 160;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const daily = _summary.daily || [];
        const days = {};
        daily.forEach(d => {
            const key = d.day?.slice(0, 10) || d.day;
            if (!days[key]) days[key] = { income: 0, expense: 0 };
            days[key][d.type] = d.total;
        });

        const dayKeys = Object.keys(days).sort();
        if (dayKeys.length < 2) {
            ctx.fillStyle = '#999';
            ctx.font = '13px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Недостатньо даних для графіка', canvas.width / 2, 80);
            return;
        }

        const incomeVals = dayKeys.map(k => days[k].income);
        const expenseVals = dayKeys.map(k => days[k].expense);
        const maxVal = Math.max(...incomeVals, ...expenseVals, 1);

        const padX = 30;
        const padY = 20;
        const w = canvas.width - padX * 2;
        const h = canvas.height - padY * 2;

        function drawLine(values, color) {
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.lineJoin = 'round';
            values.forEach((val, i) => {
                const x = padX + (i / (values.length - 1)) * w;
                const y = padY + h - (val / maxVal) * h;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();

            // Dots
            ctx.fillStyle = color;
            values.forEach((val, i) => {
                const x = padX + (i / (values.length - 1)) * w;
                const y = padY + h - (val / maxVal) * h;
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
            });
        }

        drawLine(incomeVals, '#38A169');
        drawLine(expenseVals, '#E53E3E');

        // X-axis labels
        ctx.fillStyle = '#999';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        const step = Math.max(1, Math.floor(dayKeys.length / 8));
        dayKeys.forEach((key, i) => {
            if (i % step === 0 || i === dayKeys.length - 1) {
                const x = padX + (i / (dayKeys.length - 1)) * w;
                ctx.fillText(key.slice(5), x, canvas.height - 4);
            }
        });

        // Legend
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#38A169';
        ctx.fillRect(padX, 4, 12, 3);
        ctx.fillText('Доходи', padX + 16, 10);
        ctx.fillStyle = '#E53E3E';
        ctx.fillRect(padX + 80, 4, 12, 3);
        ctx.fillText('Витрати', padX + 96, 10);
    }

    // ==========================================
    // RENDER: Reports Table
    // ==========================================

    function renderTable() {
        const tbody = document.getElementById('reportsTableBody');
        const emptyEl = document.getElementById('reportsEmpty');
        if (!tbody) return;

        if (_reports.length === 0) {
            tbody.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';

        tbody.innerHTML = _reports.map(r => `
            <tr>
                <td>${formatDateTime(r.createdAt)}</td>
                <td><span class="rep-type-badge ${r.type}">${TYPE_LABELS[r.type] || r.type}</span></td>
                <td><span class="rep-amount ${r.type}">${formatAmount(r.amount)}</span></td>
                <td>${esc(r.description) || '—'}</td>
                <td>${esc(r.category) || '—'}</td>
                <td>${esc(r.submittedBy) || '—'}</td>
                <td>${r.photoUrl ? `<button class="rep-photo-btn" onclick="ReportsPage.showPhoto('${esc(r.photoUrl)}')">📸</button>` : '—'}</td>
                <td><span class="rep-status-badge ${r.status}">${STATUS_LABELS[r.status] || r.status}</span></td>
                <td>${esc(r.accountantName) || '—'}</td>
                <td>
                    <div class="rep-actions-cell">
                        ${r.status === 'new' ? `<button class="rep-action-btn" onclick="ReportsPage.markProcessing(${r.id})">⏳</button>` : ''}
                        ${r.status !== 'done' ? `<button class="rep-action-btn" onclick="ReportsPage.markDone(${r.id})">✅</button>` : ''}
                        <button class="rep-action-btn" onclick="ReportsPage.editReport(${r.id})">✏️</button>
                        <button class="rep-action-btn" onclick="ReportsPage.deleteReport(${r.id})">🗑️</button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    // ==========================================
    // RENDER: Gallery
    // ==========================================

    function renderGallery() {
        const container = document.getElementById('repGallery');
        const emptyEl = document.getElementById('galleryEmpty');
        if (!container) return;

        const withPhotos = _reports.filter(r => r.photoUrl);
        if (withPhotos.length === 0) {
            container.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';

        container.innerHTML = withPhotos.map(r => `
            <div class="rep-gallery-card" onclick="ReportsPage.showPhoto('${esc(r.photoUrl)}')">
                <img class="rep-gallery-img" src="${esc(r.photoUrl)}" alt="Чек" onerror="this.outerHTML='<div class=\\'rep-gallery-img\\'>📄</div>'">
                <div class="rep-gallery-info">
                    <div class="rep-gallery-amount ${r.type}">${formatAmount(r.amount)}</div>
                    <div class="rep-gallery-desc">${esc(r.description) || 'Без опису'}</div>
                    ${r.ocrText ? `<div class="rep-gallery-ocr">${esc(r.ocrText)}</div>` : ''}
                    <div class="rep-gallery-meta">
                        <span>${esc(r.submittedBy)}</span>
                        <span>${formatDateTime(r.createdAt)}</span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    // ==========================================
    // RENDER: Settings
    // ==========================================

    function renderSettings() {
        const container = document.getElementById('accountantsList');
        if (!container) return;

        if (_accountants.length === 0) {
            container.innerHTML = '<p style="color:var(--gray-400);font-size:13px">Бухгалтерів не додано</p>';
            return;
        }

        container.innerHTML = _accountants.map(a => `
            <div class="rep-accountant-row">
                <span class="rep-accountant-name">${esc(a.name)}</span>
                <span style="font-size:12px;color:var(--gray-400)">${a.phone || ''}</span>
                <label class="rep-duty-toggle" title="${a.isOnDuty ? 'На зміні' : 'Не на зміні'}">
                    <input type="checkbox" ${a.isOnDuty ? 'checked' : ''} onchange="ReportsPage.toggleDuty(${a.id}, this.checked)">
                    <span class="rep-duty-slider"></span>
                </label>
            </div>
        `).join('');
    }

    // ==========================================
    // ACTIONS
    // ==========================================

    function showPhoto(url) {
        const modal = document.getElementById('photoModal');
        const img = document.getElementById('photoModalImg');
        if (modal && img) {
            img.src = url;
            modal.classList.add('active');
        }
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
            await loadReports();
            loadSummary();
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    async function deleteReport(id) {
        if (!confirm('Видалити звіт?')) return;
        try {
            await apiRequest('DELETE', `/api/reports/${id}`);
            showNotification('Звіт видалено');
            await loadReports();
            loadSummary();
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    async function toggleDuty(accountantId, isOnDuty) {
        try {
            await apiRequest('PUT', `/api/reports/accountants/${accountantId}`, { isOnDuty });
            showNotification(isOnDuty ? 'Бухгалтер на зміні' : 'Бухгалтер знятий зі зміни');
            await loadAccountants();
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    // ==========================================
    // MODAL
    // ==========================================

    function openModal(report) {
        const modal = document.getElementById('reportModal');
        if (!modal) return;

        _editingId = report?.id || null;
        document.getElementById('reportModalTitle').textContent = _editingId ? '✏️ Редагувати звіт' : '📝 Новий звіт';
        document.getElementById('reportAmount').value = report?.amount || '';
        document.getElementById('reportDescription').value = report?.description || '';
        document.getElementById('reportCategory').value = report?.category || '';
        document.getElementById('reportSubmittedBy').value = report?.submittedBy || '';
        document.getElementById('reportEditId').value = _editingId || '';

        selectType(report?.type || 'income');
        modal.classList.add('active');
    }

    function closeModal() {
        document.getElementById('reportModal')?.classList.remove('active');
        _editingId = null;
    }

    function selectType(type) {
        document.querySelectorAll('.rep-type-option').forEach(el => {
            el.classList.toggle('selected', el.dataset.type === type);
        });
    }

    async function saveReport() {
        const type = document.querySelector('.rep-type-option.selected')?.dataset.type || 'income';
        const amount = document.getElementById('reportAmount')?.value;
        const description = document.getElementById('reportDescription')?.value;
        const category = document.getElementById('reportCategory')?.value;
        const submittedBy = document.getElementById('reportSubmittedBy')?.value;

        if (!amount || parseFloat(amount) <= 0) {
            showNotification('Вкажіть суму', 'error');
            return;
        }

        try {
            if (_editingId) {
                await apiRequest('PUT', `/api/reports/${_editingId}`, {
                    type, amount: parseFloat(amount), description, category
                });
                showNotification('Звіт оновлено');
            } else {
                await apiRequest('POST', '/api/reports', {
                    type,
                    amount: parseFloat(amount),
                    description,
                    category,
                    submittedBy: submittedBy || undefined,
                    submittedVia: 'web'
                });
                showNotification('Звіт створено');
            }
            closeModal();
            await loadReports();
            loadSummary();
        } catch (err) {
            showNotification('Помилка: ' + err.message, 'error');
        }
    }

    function editReport(id) {
        const report = _reports.find(r => r.id === id);
        if (report) openModal(report);
    }

    // ==========================================
    // EXPOSE
    // ==========================================

    document.addEventListener('DOMContentLoaded', init);

    return {
        selectType,
        saveReport,
        closeModal,
        showPhoto,
        markProcessing,
        markDone,
        deleteReport,
        editReport,
        toggleDuty
    };
})();
