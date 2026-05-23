/**
 * js/certificates-page.js — standalone certificate list/create/batch page.
 */
(function() {
    const BATCH_CERTIFICATE_TYPE_TEXT = 'на одноразовий вхід';

    const state = {
        mode: 'list',
        searchTimer: null,
        items: [],
        detailId: null
    };

    const STATUS_META = {
        active: { label: 'Активний', tone: 'active' },
        used: { label: 'Використаний', tone: 'used' },
        expired: { label: 'Прострочений', tone: 'expired' },
        revoked: { label: 'Анульований', tone: 'revoked' },
        blocked: { label: 'Заблокований', tone: 'blocked' }
    };

    function $(id) {
        return document.getElementById(id);
    }

    function esc(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function notify(message, type = '') {
        if (typeof showNotification === 'function') {
            showNotification(message, type);
        }
    }

    async function confirmCertificateAction(message, okText = 'Видалити') {
        if (typeof confirmModal === 'function') {
            return confirmModal(message, { type: 'danger', okText, cancelText: 'Скасувати' });
        }
        if (typeof customConfirm === 'function') {
            return customConfirm(message, 'Підтвердження');
        }
        notify('Підтвердження недоступне. Оновіть сторінку і повторіть дію.', 'error');
        return false;
    }

    function formatDate(value, fallback = '—') {
        if (!value) return fallback;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return fallback;
        return date.toLocaleDateString('uk-UA');
    }

    function currentSeason() {
        const month = new Date().getMonth() + 1;
        if (month === 12 || month <= 2) return 'winter';
        if (month <= 5) return 'spring';
        if (month <= 8) return 'summer';
        return 'autumn';
    }

    function defaultValidUntil() {
        const date = new Date();
        date.setDate(date.getDate() + 45);
        return date;
    }

    function setDefaultDate(inputId, labelId) {
        const date = defaultValidUntil();
        const input = $(inputId);
        const label = $(labelId);
        if (input) input.value = date.toISOString().split('T')[0];
        if (label) {
            label.textContent = date.toLocaleDateString('uk-UA', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
        }
    }

    function statusBadge(status) {
        const meta = STATUS_META[status] || { label: status || 'Невідомо', tone: 'default' };
        return `<span class="cert-page-badge cert-page-badge-${esc(meta.tone)}">${esc(meta.label)}</span>`;
    }

    function setMode(mode) {
        state.mode = mode;
        const titles = {
            list: ['Сертифікати', 'Реєстр, фільтри, статуси і швидкий перехід до видачі.'],
            new: ['Видати сертифікат', 'Окрема робоча сторінка для створення одного сертифіката.'],
            batch: ['Пакет сертифікатів на одноразовий вхід', 'Пакетна генерація одноразових кодів без вибору іншого типу.']
        };
        $('certificatePageTitle').textContent = titles[mode][0];
        $('certificatePageSubtitle').textContent = titles[mode][1];
        $('certificatesListView').classList.toggle('hidden', mode !== 'list');
        $('certificatesNewView').classList.toggle('hidden', mode !== 'new');
        $('certificatesBatchView').classList.toggle('hidden', mode !== 'batch');

        if (mode === 'new') initializeSingleForm();
        if (mode === 'batch') initializeBatchForm();
        if (mode === 'list') loadCertificatesPage();
    }

    function detectMode() {
        const path = window.location.pathname.replace(/\/+$/, '');
        if (path.endsWith('/new')) return 'new';
        if (path.endsWith('/batch')) return 'batch';
        return 'list';
    }

    function initializeSingleForm() {
        const season = $('certPageSeason');
        if (season) season.value = currentSeason();
        setDefaultDate('certPageValidUntil', 'certPageValidUntilDisplay');
        updateSingleTypeMode();
        updateDisplayModeLabel();
    }

    function initializeBatchForm() {
        const season = $('certPageBatchSeason');
        if (season) season.value = currentSeason();
        setDefaultDate('certPageBatchValidUntil', 'certPageBatchValidUntilDisplay');
    }

    function updateDisplayModeLabel() {
        const mode = $('certPageDisplayMode')?.value;
        const label = $('certPageDisplayValueLabel');
        if (label) label.textContent = mode === 'fio' ? "ПІБ (прізвище та ім'я)" : 'Номер або ідентифікатор';
    }

    function updateSingleTypeMode() {
        const preset = $('certPageTypePreset')?.value || 'на одноразовий вхід';
        const wrap = $('certPageCustomTypeWrap');
        const input = $('certPageTypeText');
        const isCustom = preset === 'custom';
        if (wrap) wrap.classList.toggle('hidden', !isCustom);
        if (input && !isCustom) input.value = preset;
        if (input && isCustom && !input.value) input.focus();
    }

    async function loadCertificatesPage() {
        const container = $('certPageList');
        if (!container) return;
        const filters = {
            status: $('certPageStatus')?.value || '',
            search: $('certPageSearch')?.value.trim() || '',
            limit: 200
        };

        container.innerHTML = '<div class="empty-state">Завантаження...</div>';
        const result = await apiGetCertificates(filters);
        state.items = Array.isArray(result.items) ? result.items : [];
        renderStats(state.items);

        if (!state.items.length) {
            container.innerHTML = `
                <div class="cert-page-empty">
                    <h3>Сертифікатів не знайдено</h3>
                    <p>Спробуйте змінити фільтр або видати новий сертифікат.</p>
                    <a class="btn-page-primary" href="/certificates/new">Видати сертифікат</a>
                </div>`;
            return;
        }

        container.innerHTML = state.items.map(renderCertCard).join('');
    }

    function renderStats(items) {
        const counts = { active: 0, used: 0, expired: 0, revoked: 0, blocked: 0 };
        items.forEach((item) => {
            if (Object.prototype.hasOwnProperty.call(counts, item.status)) counts[item.status] += 1;
        });
        const el = $('certPageStats');
        if (!el) return;
        el.innerHTML = `
            <span><b>${items.length}</b> у вибірці</span>
            <span><b>${counts.active}</b> активні</span>
            <span><b>${counts.used}</b> використані</span>
            <span><b>${counts.expired}</b> прострочені</span>
            <span><b>${counts.revoked + counts.blocked}</b> зупинені</span>`;
    }

    function renderCertCard(cert) {
        const modeLabel = cert.displayMode === 'fio' ? 'ПІБ' : 'Номер';
        return `
            <article class="cert-page-card" data-cert-id="${esc(cert.id)}">
                <button type="button" class="cert-page-card-main" data-cert-open="${esc(cert.id)}">
                    <span class="cert-page-code">${esc(cert.certCode)}</span>
                    ${statusBadge(cert.status)}
                    <strong>${esc(cert.displayValue || 'Без імені / номера')}</strong>
                    <span>${esc(modeLabel)} · ${esc(cert.typeText || 'сертифікат')}</span>
                </button>
                <div class="cert-page-card-meta">
                    <span>Видано: ${formatDate(cert.issuedAt)}</span>
                    <span>Дійсний до: ${formatDate(cert.validUntil)}</span>
                    ${cert.issuedByName ? `<span>${esc(cert.issuedByName)}</span>` : ''}
                </div>
            </article>`;
    }

    async function handleSingleSubmit(event) {
        event.preventDefault();
        const btn = $('certPageSubmitBtn');
        const original = btn?.textContent || 'Видати сертифікат';
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Видаю...';
        }

        const preset = $('certPageTypePreset')?.value || 'на одноразовий вхід';
        const data = {
            displayMode: $('certPageDisplayMode')?.value || 'fio',
            displayValue: $('certPageDisplayValue')?.value.trim() || undefined,
            typeText: preset === 'custom'
                ? $('certPageTypeText')?.value.trim()
                : preset,
            validUntil: $('certPageValidUntil')?.value || undefined,
            notes: $('certPageNotes')?.value.trim() || undefined,
            season: $('certPageSeason')?.value || currentSeason()
        };

        try {
            const result = await apiCreateCertificate(data);
            if (!result.success) {
                notify(result.error || 'Не вдалося видати сертифікат', 'error');
                return;
            }
            renderSingleResult(result.certificate);
            $('certificatePageForm')?.reset();
            initializeSingleForm();
            notify(`Сертифікат ${result.certificate.certCode} видано`, 'success');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = original;
            }
        }
    }

    function renderSingleResult(cert) {
        const box = $('certCreateResult');
        if (!box) return;
        box.classList.remove('hidden');
        box.innerHTML = `
            <span class="cert-result-kicker">Видано</span>
            <h3>${esc(cert.certCode)}</h3>
            <p>${esc(cert.displayValue || 'Порожній сертифікат')} · ${esc(cert.typeText || '')}</p>
            <div class="cert-result-actions">
                <button type="button" class="btn-page-secondary" data-cert-open="${esc(cert.id)}">Переглянути</button>
                <a class="btn-page-primary" href="/certificates">До реєстру</a>
            </div>`;
    }

    async function handleBatchSubmit(event) {
        event.preventDefault();
        const btn = $('certBatchPageSubmitBtn');
        const original = btn?.textContent || 'Згенерувати пакет';
        const quantity = Number(document.querySelector('input[name="certPageBatchQty"]:checked')?.value || 0);
        const eventName = $('certPageBatchEventName')?.value.trim();

        if (!quantity) {
            notify('Оберіть кількість сертифікатів', 'error');
            return;
        }
        if (btn) {
            btn.disabled = true;
            btn.textContent = `Генерую ${quantity} шт...`;
        }

        try {
            const result = await apiBatchCreateCertificates({
                quantity,
                typeText: BATCH_CERTIFICATE_TYPE_TEXT,
                eventName: eventName || undefined,
                validUntil: $('certPageBatchValidUntil')?.value || undefined,
                season: $('certPageBatchSeason')?.value || currentSeason()
            });
            if (!result.success) {
                notify(result.error || 'Не вдалося згенерувати пакет', 'error');
                return;
            }
            renderBatchResult(result.certificates || []);
            notify(`Згенеровано ${quantity} сертифікатів`, 'success');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = original;
            }
        }
    }

    function renderBatchResult(certificates) {
        const box = $('certBatchResult');
        const codes = $('certBatchCodes');
        if (!box || !codes) return;
        box.classList.remove('hidden');
        codes.innerHTML = certificates.map((cert, index) => `
            <div class="cert-batch-code-row">
                <span>${index + 1}.</span>
                <strong>${esc(cert.certCode)}</strong>
                <small>${esc(cert.typeText || '')}</small>
            </div>`).join('');
    }

    function copyBatchCodes() {
        const codes = [...document.querySelectorAll('#certBatchCodes strong')]
            .map(node => node.textContent)
            .filter(Boolean)
            .join('\n');
        if (!codes) return;
        const fallback = () => {
            const textarea = document.createElement('textarea');
            textarea.value = codes;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch { ok = false; }
            textarea.remove();
            notify(ok ? 'Коди скопійовано' : 'Не вдалося скопіювати коди', ok ? 'success' : 'error');
        };
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(codes)
                .then(() => notify('Коди скопійовано', 'success'))
                .catch(fallback);
        } else {
            fallback();
        }
    }

    async function openDetail(id) {
        if (!id) return;
        state.detailId = id;
        const modal = $('certificatePageDetailModal');
        const content = $('certificatePageDetailContent');
        const actions = $('certificatePageDetailActions');
        if (!modal || !content || !actions) return;
        modal.classList.remove('hidden');
        content.innerHTML = '<div class="empty-state">Завантаження...</div>';
        actions.innerHTML = '';

        try {
            const response = await fetch(`${API_BASE}/certificates/${encodeURIComponent(id)}`, {
                headers: getAuthHeaders(false)
            });
            if (!response.ok) throw new Error('not_found');
            const cert = await response.json();
            renderDetail(cert);
        } catch {
            content.innerHTML = '<div class="empty-state">Не вдалося завантажити сертифікат</div>';
        }
    }

    function renderDetail(cert) {
        const content = $('certificatePageDetailContent');
        const actions = $('certificatePageDetailActions');
        const modeLabel = cert.displayMode === 'fio' ? 'ПІБ' : 'Номер';
        content.innerHTML = `
            <div class="cert-detail-grid">
                <div class="cert-detail-row"><span class="cert-detail-label">Код:</span><span class="cert-detail-val"><code>${esc(cert.certCode)}</code></span></div>
                <div class="cert-detail-row"><span class="cert-detail-label">Статус:</span><span class="cert-detail-val">${statusBadge(cert.status)}</span></div>
                <div class="cert-detail-row"><span class="cert-detail-label">${modeLabel}:</span><span class="cert-detail-val">${esc(cert.displayValue || '—')}</span></div>
                <div class="cert-detail-row"><span class="cert-detail-label">Тип:</span><span class="cert-detail-val">${esc(cert.typeText || '—')}</span></div>
                <div class="cert-detail-row"><span class="cert-detail-label">Видано:</span><span class="cert-detail-val">${formatDate(cert.issuedAt)}</span></div>
                <div class="cert-detail-row"><span class="cert-detail-label">Дійсний до:</span><span class="cert-detail-val">${formatDate(cert.validUntil)}</span></div>
                ${cert.issuedByName ? `<div class="cert-detail-row"><span class="cert-detail-label">Видав:</span><span class="cert-detail-val">${esc(cert.issuedByName)}</span></div>` : ''}
                ${cert.notes ? `<div class="cert-detail-row"><span class="cert-detail-label">Примітка:</span><span class="cert-detail-val">${esc(cert.notes)}</span></div>` : ''}
            </div>`;

        let html = `<button type="button" class="btn-page-secondary" data-cert-copy="${esc(cert.certCode)}">Копіювати код</button>`;
        if (cert.status === 'active') {
            html += `<button type="button" class="btn-page-primary" data-cert-status="${esc(cert.id)}" data-next-status="used">Використано</button>`;
            html += `<button type="button" class="btn-page-danger" data-cert-status="${esc(cert.id)}" data-next-status="revoked">Анульувати</button>`;
            html += `<button type="button" class="btn-page-secondary" data-cert-status="${esc(cert.id)}" data-next-status="blocked">Заблокувати</button>`;
        }
        if (cert.status === 'blocked' || cert.status === 'revoked') {
            html += `<button type="button" class="btn-page-primary" data-cert-status="${esc(cert.id)}" data-next-status="active">Відновити</button>`;
        }
        html += `<button type="button" class="btn-page-danger" data-cert-delete="${esc(cert.id)}">Видалити</button>`;
        actions.innerHTML = html;
    }

    function closeDetail() {
        $('certificatePageDetailModal')?.classList.add('hidden');
        state.detailId = null;
    }

    async function updateStatus(id, status) {
        const result = await apiUpdateCertificateStatus(id, status, null);
        if (!result.success) {
            notify(result.error || 'Не вдалося змінити статус', 'error');
            return;
        }
        notify('Статус сертифіката оновлено', 'success');
        await openDetail(id);
        if (state.mode === 'list') loadCertificatesPage();
    }

    async function deleteCertificateFromPage(id) {
        if (!(await confirmCertificateAction('Видалити сертифікат?'))) return;
        const result = await apiDeleteCertificate(id);
        if (!result.success) {
            notify(result.error || 'Не вдалося видалити сертифікат', 'error');
            return;
        }
        notify('Сертифікат видалено', 'success');
        closeDetail();
        if (state.mode === 'list') loadCertificatesPage();
    }

    function copyText(value) {
        const text = String(value || '');
        if (!text) return;
        const fallback = () => {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch { ok = false; }
            textarea.remove();
            notify(ok ? 'Скопійовано' : 'Не вдалося скопіювати', ok ? 'success' : 'error');
        };
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => notify('Скопійовано', 'success')).catch(fallback);
        } else {
            fallback();
        }
    }

    function bindEvents() {
        $('certPageRefreshBtn')?.addEventListener('click', loadCertificatesPage);
        $('certPageStatus')?.addEventListener('change', loadCertificatesPage);
        $('certPageSearch')?.addEventListener('input', () => {
            clearTimeout(state.searchTimer);
            state.searchTimer = setTimeout(loadCertificatesPage, 350);
        });
        $('certPageDisplayMode')?.addEventListener('change', updateDisplayModeLabel);
        $('certPageTypePreset')?.addEventListener('change', updateSingleTypeMode);
        $('certificatePageForm')?.addEventListener('submit', handleSingleSubmit);
        $('certificateBatchPageForm')?.addEventListener('submit', handleBatchSubmit);
        $('certBatchCopyBtn')?.addEventListener('click', copyBatchCodes);
        $('certificatePageDetailClose')?.addEventListener('click', closeDetail);
        $('certificatePageDetailModal')?.addEventListener('click', (event) => {
            if (event.target === $('certificatePageDetailModal')) closeDetail();
        });
        document.addEventListener('click', (event) => {
            const openBtn = event.target.closest('[data-cert-open]');
            if (openBtn) {
                event.preventDefault();
                openDetail(openBtn.dataset.certOpen);
                return;
            }
            const statusBtn = event.target.closest('[data-cert-status]');
            if (statusBtn) {
                event.preventDefault();
                updateStatus(statusBtn.dataset.certStatus, statusBtn.dataset.nextStatus);
                return;
            }
            const deleteBtn = event.target.closest('[data-cert-delete]');
            if (deleteBtn) {
                event.preventDefault();
                deleteCertificateFromPage(deleteBtn.dataset.certDelete);
                return;
            }
            const copyBtn = event.target.closest('[data-cert-copy]');
            if (copyBtn) {
                event.preventDefault();
                copyText(copyBtn.dataset.certCopy);
            }
        });
    }

    function redirectToLogin() {
        if (typeof clearAuthenticatedPageShell === 'function') clearAuthenticatedPageShell();
        window.location.href = '/';
    }

    async function bootstrapAuthenticatedShell() {
        const token = localStorage.getItem('pzp_token');
        if (!token) {
            redirectToLogin();
            return null;
        }

        const user = await apiVerifyToken();
        if (!user) {
            if (typeof clearAuthStorage === 'function') clearAuthStorage();
            redirectToLogin();
            return null;
        }

        if (typeof AppState !== 'undefined') AppState.currentUser = user;
        const userEl = $('currentUser');
        if (userEl) userEl.textContent = user.name || user.username || '';
        if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
        else if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
        if (typeof bindLogoutButton === 'function') bindLogoutButton();
        return user;
    }

    function renderCertificatePageFatalError(error) {
        if (typeof renderStandaloneFatalError === 'function') {
            renderStandaloneFatalError({
                containerId: 'main-content',
                title: 'Не вдалося відкрити сертифікати',
                message: 'Standalone сторінка сертифікатів пройшла auth, але впала під час ініціалізації.',
                moduleName: 'certificates',
                error
            });
            return;
        }
        const main = $('main-content') || $('mainApp');
        if (main) {
            main.innerHTML = `<div class="page-fatal-error" role="alert"><h3>Не вдалося відкрити сертифікати</h3><pre>${esc(error?.message || error || 'Unknown error')}</pre></div>`;
        }
    }

    async function init() {
        if (typeof initDarkMode === 'function') initDarkMode();
        try {
            const user = await bootstrapAuthenticatedShell();
            if (!user) return;
        } catch (error) {
            if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
            if (typeof handleStandaloneInitError === 'function') {
                handleStandaloneInitError('certificates', error, renderCertificatePageFatalError);
            } else {
                renderCertificatePageFatalError(error);
            }
            return;
        }

        bindEvents();
        setMode(detectMode());
        if (window.Sidebar && typeof window.Sidebar.markShellReady === 'function') {
            window.Sidebar.markShellReady();
        }
    }

    window.CertificatePage = {
        load: loadCertificatesPage,
        openDetail,
        setMode
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
