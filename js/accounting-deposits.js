(function initAccountingDepositsPage() {
    'use strict';

    const FINAL_STATUSES = [
        'Підтверджено',
        'Оплату не знайдено',
        'Сума не збігається',
        'Скасовано / повернено'
    ];
    const state = {
        filter: 'Не перевірено',
        deposits: [],
        selectedId: null,
        selectedProjection: null,
        loading: false
    };

    function el(id) {
        return document.getElementById(id);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function notify(message, type = 'info') {
        if (typeof showNotification === 'function') {
            showNotification(message, type);
            return;
        }
        const box = el('notification');
        const text = el('notificationText');
        if (!box || !text) return;
        text.textContent = message;
        box.classList.remove('hidden');
        setTimeout(() => box.classList.add('hidden'), 2200);
    }

    function depositProjectionAmount(projection = {}) {
        const deposit = projection.deposit || {};
        const display = projection.display || {};
        const value = deposit.paidAmount ?? deposit.expectedAmount ?? deposit.amount ?? display.amount ?? 0;
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
    }

    function formatMoney(value) {
        const amount = Number(value);
        return `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Number.isFinite(amount) ? amount : 0)} грн`;
    }

    function formatDate(value) {
        const text = String(value || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return value ? String(value) : '-';
        const [year, month, day] = text.split('-');
        return `${day}.${month}.${year}`;
    }

    function projectionTitle(projection = {}) {
        const deposit = projection.deposit || {};
        return deposit.clientNameSnapshot
            || projection.display?.clientName
            || deposit.primaryBookingId
            || 'Банкетний завдаток';
    }

    function projectionSubtitle(projection = {}) {
        const deposit = projection.deposit || {};
        const parts = [
            deposit.eventDate ? formatDate(deposit.eventDate) : '',
            deposit.primaryBookingId ? `#${deposit.primaryBookingId}` : '',
            deposit.banquetGroupId ? `Група #${deposit.banquetGroupId}` : ''
        ].filter(Boolean);
        return parts.join(' · ') || '-';
    }

    function renderList() {
        const rows = el('depositReviewRows');
        const meta = el('depositListMeta');
        if (!rows) return;
        if (meta) meta.textContent = state.loading ? 'Завантаження...' : `${state.deposits.length} записів`;
        if (state.loading) {
            rows.innerHTML = '<div class="deposit-review-state">Завантаження...</div>';
            return;
        }
        if (!state.deposits.length) {
            rows.innerHTML = '<div class="deposit-review-state">Записів для цього фільтра немає.</div>';
            return;
        }
        rows.innerHTML = state.deposits.map(projection => {
            const deposit = projection.deposit || {};
            const status = projection.accountingStatus || deposit.accountingStatus || projection.status || '-';
            const selected = String(state.selectedId || '') === String(deposit.id || '');
            return `
                <button type="button" class="deposit-review-row" data-deposit-id="${escapeHtml(deposit.id || '')}" aria-selected="${selected ? 'true' : 'false'}">
                    <div>
                        <strong>${escapeHtml(projectionTitle(projection))}</strong>
                        <span class="deposit-review-muted">${escapeHtml(projectionSubtitle(projection))}</span>
                    </div>
                    <span>${escapeHtml(formatMoney(depositProjectionAmount(projection)))}</span>
                    <span class="deposit-review-pill">${escapeHtml(status)}</span>
                    <span class="deposit-review-muted">${escapeHtml(deposit.dueDate ? `до ${formatDate(deposit.dueDate)}` : 'без дедлайну')}</span>
                </button>
            `;
        }).join('');
    }

    function renderEmptyDetail(message = 'Відкрийте конкретний завдаток для перевірки.') {
        const body = el('depositDetailBody');
        const title = el('depositDetailTitle');
        const meta = el('depositDetailMeta');
        if (title) title.textContent = 'Запис не вибрано';
        if (meta) meta.textContent = message;
        if (body) body.innerHTML = `<div class="deposit-review-state">${escapeHtml(message)}</div>`;
    }

    function renderDetail(projection = {}) {
        const deposit = projection.deposit || {};
        const body = el('depositDetailBody');
        const title = el('depositDetailTitle');
        const meta = el('depositDetailMeta');
        if (title) title.textContent = projectionTitle(projection);
        if (meta) meta.textContent = projectionSubtitle(projection);
        if (!body) return;
        const paidAmount = deposit.paidAmount ?? depositProjectionAmount(projection);
        body.innerHTML = `
            <div class="deposit-review-facts">
                <div class="deposit-review-fact"><span>Очікувана сума</span><strong>${escapeHtml(formatMoney(deposit.expectedAmount ?? deposit.amount ?? 0))}</strong></div>
                <div class="deposit-review-fact"><span>Фактична сума</span><strong>${escapeHtml(formatMoney(deposit.paidAmount ?? 0))}</strong></div>
                <div class="deposit-review-fact"><span>Менеджер</span><strong>${escapeHtml(deposit.managerStatus || '-')}</strong></div>
                <div class="deposit-review-fact"><span>Бухгалтерія</span><strong>${escapeHtml(projection.accountingStatus || deposit.accountingStatus || '-')}</strong></div>
                <div class="deposit-review-fact"><span>Дедлайн</span><strong>${escapeHtml(formatDate(deposit.dueDate))}</strong></div>
                <div class="deposit-review-fact"><span>Дата події</span><strong>${escapeHtml(formatDate(deposit.eventDate))}</strong></div>
            </div>
            ${deposit.managerNote ? `<div class="deposit-review-fact" style="margin-bottom:16px"><span>Коментар менеджера</span><strong>${escapeHtml(deposit.managerNote)}</strong></div>` : ''}
            <form id="depositAccountingForm" class="deposit-review-form">
                <label>
                    Фактична сума
                    <input type="number" id="depositPaidAmount" min="0" step="1" value="${escapeHtml(paidAmount || '')}">
                </label>
                <label>
                    Фінальний статус
                    <select id="depositAccountingStatus">
                        ${FINAL_STATUSES.map(status => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join('')}
                    </select>
                </label>
                <label>
                    Коментар бухгалтерії
                    <textarea id="depositAccountingNote" rows="4" maxlength="1000">${escapeHtml(deposit.accountingNote || '')}</textarea>
                </label>
                <div class="deposit-review-actions">
                    <button type="button" id="depositReloadBtn" class="deposit-review-btn deposit-review-btn-secondary">Оновити</button>
                    <button type="submit" class="deposit-review-btn deposit-review-btn-primary">Зберегти перевірку</button>
                </div>
            </form>
        `;
        const statusSelect = el('depositAccountingStatus');
        if (statusSelect && FINAL_STATUSES.includes(deposit.accountingStatus)) statusSelect.value = deposit.accountingStatus;
        el('depositReloadBtn')?.addEventListener('click', () => openDeposit(deposit.id));
        el('depositAccountingForm')?.addEventListener('submit', saveSelectedDeposit);
    }

    async function loadDeposits() {
        state.loading = true;
        renderList();
        const result = await apiListBanquetDepositsForAccounting({ accountingStatus: state.filter });
        state.loading = false;
        if (!result?.success) {
            state.deposits = [];
            renderList();
            renderEmptyDetail(result?.error || 'Не вдалося завантажити завдатки.');
            return;
        }
        state.deposits = Array.isArray(result.deposits) ? result.deposits : [];
        renderList();
        if (state.selectedId && !state.deposits.some(item => String(item.deposit?.id || '') === String(state.selectedId))) {
            renderEmptyDetail();
        }
    }

    async function openDeposit(depositId) {
        if (!depositId) return;
        state.selectedId = depositId;
        renderList();
        const body = el('depositDetailBody');
        if (body) body.innerHTML = '<div class="deposit-review-state">Відкриваємо запис...</div>';
        const result = await apiStartBanquetDepositReview(depositId);
        if (!result?.success) {
            renderEmptyDetail(result?.error || 'Не вдалося відкрити запис завдатку.');
            return;
        }
        state.selectedProjection = result;
        renderDetail(result);
        await loadDeposits();
    }

    async function saveSelectedDeposit(event) {
        event.preventDefault();
        const depositId = state.selectedProjection?.deposit?.id || state.selectedId;
        if (!depositId) return;
        const payload = {
            paidAmount: el('depositPaidAmount')?.value || null,
            accountingStatus: el('depositAccountingStatus')?.value || '',
            accountingNote: el('depositAccountingNote')?.value || ''
        };
        const result = await apiUpdateBanquetDepositAccounting(depositId, payload);
        if (!result?.success) {
            notify(result?.error || 'Не вдалося зберегти перевірку.', 'error');
            return;
        }
        state.selectedProjection = result;
        renderDetail(result);
        notify('Перевірку завдатку збережено.', 'success');
        await loadDeposits();
    }

    function bindEvents() {
        el('depositStatusFilter')?.addEventListener('change', event => {
            state.filter = event.target.value || 'Не перевірено';
            state.selectedId = null;
            state.selectedProjection = null;
            renderEmptyDetail();
            loadDeposits();
        });
        el('depositRefreshBtn')?.addEventListener('click', loadDeposits);
        el('depositReviewRows')?.addEventListener('click', event => {
            const row = event.target.closest('[data-deposit-id]');
            if (!row) return;
            openDeposit(row.dataset.depositId);
        });
    }

    async function bootstrapAccountingDepositsShell() {

        try {
            const user = await apiVerifyToken();
            if (!user) throw new Error('Invalid token');
            if (typeof AppState !== 'undefined') AppState.currentUser = user;
            const userEl = el('currentUser');
            if (userEl) userEl.textContent = user.name || user.username || '';
            if (typeof bindLogoutButton === 'function') bindLogoutButton();
            if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
            else if (typeof Sidebar !== 'undefined' && Sidebar.markShellReady) Sidebar.markShellReady();
            return true;
        } catch (error) {
            document.getElementById('mainApp')?.classList.add('hidden');
            if (typeof clearAuthenticatedPageShell === 'function') clearAuthenticatedPageShell();
            window.location.href = '/';
            return false;
        }
    }

    document.addEventListener('DOMContentLoaded', async () => {
        if (typeof initDarkMode === 'function') initDarkMode();
        const ready = await bootstrapAccountingDepositsShell();
        if (!ready) return;
        bindEvents();
        renderEmptyDetail();
        await loadDeposits();
    });
})();
