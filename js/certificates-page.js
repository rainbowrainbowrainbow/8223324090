/**
 * js/certificates-page.js — standalone certificate list/create/batch page.
 */
(function() {
    const BATCH_CERTIFICATE_TYPE_TEXT = 'на одноразовий вхід';
    const SINGLE_ISSUE_LABEL = 'Видати сертифікат або абонемент';
    const CERTIFICATE_CHECK_CODE_KEY = 'eventgenix_certificate_check_code_v1';
    const IDENTITY_COPY = {
        fio: {
            label: "ПІБ (прізвище та ім'я)",
            placeholder: "Наприклад: Іваненко Марія",
            hint: "Обов'язково: повне ім'я отримувача для унікальної видачі.",
            error: "ПІБ отримувача обов'язковий"
        },
        number: {
            label: 'Номер або ідентифікатор отримувача',
            placeholder: 'Наприклад: номер телефону, картки або договору',
            hint: "Обов'язково: унікальний номер або інший ідентифікатор отримувача.",
            error: "Номер або ідентифікатор отримувача обов'язковий"
        }
    };

    const state = {
        mode: 'list',
        searchTimer: null,
        items: [],
        stats: null,
        detailId: null,
        detailCert: null,
        detailReturnFocus: null,
        singleSubmitting: false,
        batchSubmitting: false,
        checkVersion: 0,
        checkCert: null,
        redeemSubmitting: false
    };

    const STATUS_META = {
        active: { label: 'Активний', tone: 'active' },
        used: { label: 'Використаний', tone: 'used' },
        expired: { label: 'Прострочений', tone: 'expired' },
        revoked: { label: 'Анульований', tone: 'revoked' },
        blocked: { label: 'Заблокований', tone: 'blocked' }
    };

    const CHECK_STATE_META = {
        redeemable: { title: 'Можна активувати вхід', badge: 'Готовий до входу', message: 'Після підтвердження сертифікат одразу стане використаним. Повторний вхід за цим кодом буде неможливий.', tone: 'active' },
        verification_only: { title: 'Сертифікат активний', badge: 'Лише перевірка', message: 'Цей тип можна перевірити, але одноразовий вхід за ним тут недоступний.', tone: 'active' },
        redemption_unavailable: { title: 'Активація входу недоступна', badge: 'Немає права на дію', message: 'Ваш обліковий запис може перевірити сертифікат, але не активувати вхід за ним.', tone: 'blocked' },
        just_activated: { title: 'Вхід активовано', badge: 'Щойно виконано', message: 'Сертифікат щойно використано для одноразового входу. Повторний вхід за цим кодом неможливий.', tone: 'active' },
        used: { title: 'Сертифікат уже використано', badge: 'Використаний раніше', message: 'Повторний вхід за цим кодом неможливий.', tone: 'used' },
        expired: { title: 'Строк дії завершився', message: 'Сертифікат більше не дійсний.', tone: 'expired' },
        revoked: { title: 'Сертифікат анульовано', message: 'Сертифікат не можна використати.', tone: 'revoked' },
        blocked: { title: 'Сертифікат заблоковано', message: 'Сертифікат не можна використати.', tone: 'blocked' },
        missing: { title: 'Сертифікат не знайдено', message: 'Перевірте код і спробуйте ще раз.', tone: 'revoked' },
        denied: { title: 'Доступ відхилено', message: 'Ваш обліковий запис не має доступу до перевірки сертифікатів.', tone: 'revoked' },
        error: { title: 'Не вдалося перевірити сертифікат', message: 'Перевірте з’єднання та повторіть спробу.', tone: 'revoked' }
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

    function syncCertificateAvailability() {
        const availability = getLegacyBusinessSurfaceAvailability('certificates');
        let notice = $('certificateBusinessAvailability');
        if (!notice) {
            notice = document.createElement('div');
            notice.id = 'certificateBusinessAvailability';
            notice.className = 'page-fatal-error';
            notice.setAttribute('role', 'alert');
            $('certificatesListView')?.before(notice);
        }
        notice.hidden = availability.available;
        notice.textContent = availability.message || '';
        for (const id of ['certificatePageForm', 'certificateBatchPageForm']) {
            $(id)?.querySelectorAll('input, select, textarea, button').forEach(element => {
                element.disabled = !availability.available;
            });
        }
        if ($('certPageSubmitBtn')) $('certPageSubmitBtn').disabled = !availability.available || state.singleSubmitting;
        if ($('certBatchPageSubmitBtn')) $('certBatchPageSubmitBtn').disabled = !availability.available || state.batchSubmitting;
        if (!availability.available) {
            invalidateCertificateCheck();
            state.items = [];
            state.stats = null;
            if ($('certPageStats')) $('certPageStats').textContent = '';
            if ($('certPageList')) $('certPageList').textContent = '';
            closeDetail();
            $('certCreateResult')?.classList.add('hidden');
            $('certBatchResult')?.classList.add('hidden');
        }
        return availability.available;
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

    function formatDateTime(value, fallback = '—') {
        if (!value) return fallback;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return fallback;
        return date.toLocaleString('uk-UA', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function issuerLabel(cert) {
        return cert.issuedByName || cert.issuedByUsername || '—';
    }

    function issueSourceMeta(cert) {
        const source = cert.issueSource || 'single';
        if (source === 'batch') return { label: 'Пакетна видача', tone: 'batch' };
        if (source === 'legacy') return { label: 'Legacy', tone: 'legacy' };
        return { label: 'Одинична видача', tone: 'single' };
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

    function displayValueForCert(cert) {
        if (cert?.displayValue) return cert.displayValue;
        if (cert?.issueSource === 'batch') return 'Пакетний код без отримувача';
        return 'Отримувача не вказано';
    }

    function syncHeaderActiveState(mode) {
        document.body?.setAttribute('data-cert-mode', mode);
        document.querySelectorAll('.cert-page-actions [data-cert-mode]').forEach((link) => {
            const active = link.dataset.certMode === mode;
            link.classList.toggle('is-active', active);
            link.toggleAttribute('data-cert-primary-cta', active);
            if (active) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
    }

    function syncCertificateNavigationAccess() {
        document.querySelectorAll('.cert-page-actions [data-cert-mode]').forEach((link) => {
            link.hidden = typeof canAccessPage !== 'function' || !canAccessPage(link.getAttribute('href'));
        });
    }

    function setMode(mode) {
        state.mode = mode;
        const titles = {
            list: ['Сертифікати', 'Переглядайте сертифікати, їхні статуси та деталі.'],
            new: [SINGLE_ISSUE_LABEL, 'Вкажіть отримувача й тип, щоб видати сертифікат або абонемент.'],
            batch: ['Пакет сертифікатів на одноразовий вхід', 'Видайте кілька кодів на одноразовий вхід за раз.'],
            check: ['Перевірка сертифіката', 'Перевірте право на вхід і підтвердьте використання одноразового сертифіката.']
        };
        $('certificatePageTitle').textContent = titles[mode][0];
        $('certificatePageSubtitle').textContent = titles[mode][1];
        syncHeaderActiveState(mode);
        $('certificatesListView').classList.toggle('hidden', mode !== 'list');
        $('certificatesNewView').classList.toggle('hidden', mode !== 'new');
        $('certificatesBatchView').classList.toggle('hidden', mode !== 'batch');
        $('certificatesCheckView').classList.toggle('hidden', mode !== 'check');

        if (mode === 'new') initializeSingleForm();
        if (mode === 'batch') initializeBatchForm();
        if (mode === 'check') loadCertificateCheck();
        if (syncCertificateAvailability() && mode === 'list') loadCertificatesPage();
    }

    function detectMode() {
        const path = window.location.pathname.replace(/\/+$/, '');
        if (path.endsWith('/new')) return 'new';
        if (path.endsWith('/batch')) return 'batch';
        if (path.endsWith('/check')) return 'check';
        return 'list';
    }

    function normalizeCertificateCheckCode(value) {
        return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
    }

    function getKyivDateKey(date = new Date()) {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(date);
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${values.year}-${values.month}-${values.day}`;
    }

    function certificateCheckState(cert) {
        if (!cert) return 'missing';
        if (cert.effectiveStatus && cert.effectiveStatus !== 'active') return CHECK_STATE_META[cert.effectiveStatus] ? cert.effectiveStatus : 'error';
        if (cert.status && cert.status !== 'active') return CHECK_STATE_META[cert.status] ? cert.status : 'error';
        const validUntil = String(cert.validUntil || '').slice(0, 10);
        if (validUntil && validUntil < getKyivDateKey()) return 'expired';
        if (cert.canRedeem === true && (!cert.redemptionReason || cert.redemptionReason === 'available')) return 'redeemable';
        return cert.redemptionReason === 'verification_only' ? 'verification_only' : 'redemption_unavailable';
    }

    function readCertificateCheckCode() {
        const fromQuery = normalizeCertificateCheckCode(new URLSearchParams(window.location.search).get('code'));
        if (fromQuery) return fromQuery;
        try { return normalizeCertificateCheckCode(sessionStorage.getItem(CERTIFICATE_CHECK_CODE_KEY)); } catch { return ''; }
    }

    function retainCertificateCheckCodeAfterLogin(code) {
        if (!code) return;
        try { sessionStorage.removeItem(CERTIFICATE_CHECK_CODE_KEY); } catch {}
        const url = new URL(window.location.href);
        url.searchParams.set('code', code);
        window.history?.replaceState?.(null, '', `${url.pathname}${url.search}`);
    }

    function formatCertificateUseTime(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat('uk-UA', {
            timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        }).format(date);
    }

    function renderCertificateCheck(stateName, cert = null) {
        state.checkCert = cert;
        const result = $('certificateCheckResult');
        const status = $('certificateCheckStatus');
        const meta = CHECK_STATE_META[stateName] || CHECK_STATE_META.error;
        if (status) status.textContent = '';
        if (!result) return;
        result.classList.remove('hidden');
        result.dataset.certCheckState = stateName;
        const useTime = (stateName === 'just_activated' || stateName === 'used')
            ? formatCertificateUseTime(cert?.usedAt) : '';
        const details = cert ? `
            <dl class="cert-check-result-meta">
                <dt>Код</dt><dd>${esc(cert.certCode || '')}</dd>
                <dt>Тип</dt><dd>${esc(cert.typeText || '—')}</dd>
                <dt>Дійсний до</dt><dd>${esc(formatDate(cert.validUntil))}</dd>
                ${useTime ? `<dt>Використано</dt><dd>${esc(useTime)} · Київ</dd>` : ''}
            </dl>` : '';
        const redeem = stateName === 'redeemable' && cert?.canRedeem === true
            ? '<button type="button" class="btn-page-primary" data-cert-redeem>Активувати вхід</button>' : '';
        const icon = stateName === 'just_activated'
            ? '<span class="cert-check-success-icon" aria-hidden="true">✓</span>' : '';
        result.innerHTML = `<div class="cert-check-result-summary">${icon}<div><span class="cert-page-badge cert-page-badge-${esc(meta.tone)}">${esc(meta.badge || meta.title)}</span><h3>${esc(meta.title)}</h3><p>${esc(meta.message)}</p></div></div>${details}${redeem}`;
    }

    function invalidateCertificateCheck() {
        state.checkVersion++;
        state.checkCert = null;
        $('certificateCheckResult')?.classList.add('hidden');
        if ($('certificateCheckStatus')) $('certificateCheckStatus').textContent = '';
    }

    async function redeemCheckedCertificate() {
        const cert = state.checkCert;
        if (state.redeemSubmitting || !cert?.canRedeem || !syncCertificateAvailability()) return;
        const version = state.checkVersion;
        state.redeemSubmitting = true;
        const button = $('certificateCheckResult')?.querySelector('[data-cert-redeem]');
        if (button) button.disabled = true;
        try {
            const confirmed = await confirmCertificateAction(`Активувати вхід за сертифікатом ${cert.certCode}? Після підтвердження він одразу стане використаним. Повторний вхід за цим кодом буде неможливий.`, 'Активувати вхід');
            if (!confirmed || version !== state.checkVersion || !syncCertificateAvailability()) return;
            if ($('certificateCheckStatus')) $('certificateCheckStatus').textContent = 'Активуємо вхід…';
            const result = await apiRedeemCertificate(cert.id);
            if (version !== state.checkVersion) return;
            if (result?.success) renderCertificateCheck('just_activated', result.certificate);
            else {
                notify(result?.error || 'Не вдалося активувати вхід. Перевірте статус сертифіката.', 'error');
                await loadCertificateCheck(cert.certCode);
            }
        } catch {
            if (version === state.checkVersion) {
                renderCertificateCheck('error');
                notify('Перевірте статус сертифіката перед наступною спробою.', 'error');
            }
        } finally {
            state.redeemSubmitting = false;
            if (button) button.disabled = false;
        }
    }

    async function loadCertificateCheck(code = readCertificateCheckCode()) {
        invalidateCertificateCheck();
        if (!syncCertificateAvailability()) return;
        const version = state.checkVersion;
        const input = $('certificateCheckCode');
        const submit = $('certificateCheckSubmit');
        const status = $('certificateCheckStatus');
        const normalizedCode = normalizeCertificateCheckCode(code || input?.value);
        if (input) input.value = normalizedCode;
        if (!normalizedCode) {
            $('certificateCheckResult')?.classList.add('hidden');
            if (status) status.textContent = 'Введіть код сертифіката для перевірки.';
            return;
        }

        retainCertificateCheckCodeAfterLogin(normalizedCode);
        if (status) status.textContent = 'Перевіряємо сертифікат…';
        if (submit) submit.disabled = true;
        try {
            const result = await apiLookupCertificateByCode(normalizedCode);
            if (version !== state.checkVersion) return;
            if (result?.success) renderCertificateCheck(certificateCheckState(result.certificate), result.certificate);
            else if (result?.missing) renderCertificateCheck('missing');
            else if (result?.denied) renderCertificateCheck('denied');
            else renderCertificateCheck('error');
        } catch {
            if (version === state.checkVersion) renderCertificateCheck('error');
        } finally {
            if (submit) submit.disabled = false;
        }
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
        const mode = $('certPageDisplayMode')?.value === 'number' ? 'number' : 'fio';
        const copy = IDENTITY_COPY[mode];
        const label = $('certPageDisplayValueLabel');
        const input = $('certPageDisplayValue');
        const hint = $('certPageDisplayValueHint');
        if (label) label.textContent = copy.label;
        if (input) input.placeholder = copy.placeholder;
        if (hint) hint.textContent = copy.hint;
        setDisplayValueError('');
    }

    function setDisplayValueError(message) {
        const input = $('certPageDisplayValue');
        const error = $('certPageDisplayValueError');
        if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
        if (error) {
            error.textContent = message || '';
            error.classList.toggle('hidden', !message);
        }
    }

    function validateSingleIdentity({ focus = false } = {}) {
        const mode = $('certPageDisplayMode')?.value === 'number' ? 'number' : 'fio';
        const input = $('certPageDisplayValue');
        const value = input?.value.trim() || '';
        if (!value) {
            const message = IDENTITY_COPY[mode].error;
            setDisplayValueError(message);
            notify(message, 'error');
            if (focus) input?.focus();
            return null;
        }
        setDisplayValueError('');
        return value;
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
        if (!container || !syncCertificateAvailability()) return;
        const context = getLegacyBusinessSurfaceContextKey('certificates');
        const filters = {
            status: $('certPageStatus')?.value || '',
            search: $('certPageSearch')?.value.trim() || '',
            limit: 200
        };

        container.innerHTML = '<div class="empty-state">Завантаження...</div>';
        const result = await apiGetCertificates(filters);
        if (context !== getLegacyBusinessSurfaceContextKey('certificates')) return;
        if (result.authTransient) {
            container.innerHTML = '<div class="page-fatal-error" role="alert"><h3>Сесію тимчасово не підтверджено</h3><p>Сертифікати не завантажені, але ваш вхід збережено.</p><button type="button" class="btn-page-primary" data-cert-load-retry>Повторити</button></div>';
            container.querySelector('[data-cert-load-retry]')?.addEventListener('click', () => loadCertificatesPage());
            return;
        }
        if (result.success === false) {
            state.items = [];
            state.stats = null;
            if ($('certPageStats')) $('certPageStats').textContent = '';
            if (!syncCertificateAvailability()) return;
            container.innerHTML = `<div class="page-fatal-error" role="alert"><h3>Не вдалося завантажити сертифікати</h3><p>${esc(result.error || 'Спробуйте ще раз.')}</p><button type="button" class="btn-page-primary" data-cert-load-retry>Повторити</button></div>`;
            container.querySelector('[data-cert-load-retry]')?.addEventListener('click', loadCertificatesPage);
            return;
        }
        state.items = Array.isArray(result.items) ? result.items : [];
        state.stats = result.stats || null;
        renderStats(state.stats, result.total, state.items);

        if (!state.items.length) {
            container.innerHTML = `
                <div class="cert-page-empty">
                    <h3>Сертифікатів не знайдено</h3>
                    <p>Спробуйте змінити фільтр або видати новий сертифікат чи абонемент.</p>
                    <a class="btn-page-primary" href="/certificates/new">${SINGLE_ISSUE_LABEL}</a>
                </div>`;
            return;
        }

        container.innerHTML = state.items.map(renderCertCard).join('');
    }

    function renderStats(stats, total, items = []) {
        const fallback = { active: 0, used: 0, expired: 0, revoked: 0, blocked: 0 };
        items.forEach((item) => {
            if (Object.prototype.hasOwnProperty.call(fallback, item.status)) fallback[item.status] += 1;
        });
        const counts = {
            active: Number(stats?.active ?? fallback.active) || 0,
            used: Number(stats?.used ?? fallback.used) || 0,
            expired: Number(stats?.expired ?? fallback.expired) || 0,
            revoked: Number(stats?.revoked ?? fallback.revoked) || 0,
            blocked: Number(stats?.blocked ?? fallback.blocked) || 0
        };
        const sourceCounts = stats?.bySource || {};
        const trueTotal = Number(stats?.total ?? total ?? items.length) || 0;
        const el = $('certPageStats');
        if (!el) return;
        el.innerHTML = `
            <span><b>${trueTotal}</b> у фільтрі</span>
            <span><b>${counts.active}</b> активні</span>
            <span><b>${counts.used}</b> використані</span>
            <span><b>${counts.expired}</b> прострочені</span>
            <span><b>${counts.revoked + counts.blocked}</b> зупинені</span>
            <span><b>${Number(sourceCounts.batch || 0)}</b> пакетні</span>`;
    }

    function renderCertCard(cert) {
        const modeLabel = cert.displayMode === 'fio' ? 'ПІБ' : 'Номер';
        const source = issueSourceMeta(cert);
        return `
            <article class="cert-page-card" data-cert-id="${esc(cert.id)}">
                <button type="button" class="cert-page-card-main" data-cert-open="${esc(cert.id)}">
                    <span class="cert-page-code">${esc(cert.certCode)}</span>
                    ${statusBadge(cert.status)}
                    <strong>${esc(displayValueForCert(cert))}</strong>
                    <span>${esc(modeLabel)} · ${esc(cert.typeText || 'сертифікат')}</span>
                </button>
                <div class="cert-page-card-meta">
                    <span class="cert-source-chip cert-source-${esc(source.tone)}">${esc(source.label)}</span>
                    <span>Видано: ${formatDateTime(cert.issuedAt)}</span>
                    <span>Дійсний до: ${formatDate(cert.validUntil)}</span>
                    <span>Видав: ${esc(issuerLabel(cert))}</span>
                </div>
            </article>`;
    }

    async function handleSingleSubmit(event) {
        event.preventDefault();
        if (state.singleSubmitting || !syncCertificateAvailability()) return;
        const displayValue = validateSingleIdentity({ focus: true });
        if (!displayValue) return;
        state.singleSubmitting = true;
        const context = getLegacyBusinessSurfaceContextKey('certificates');

        const btn = $('certPageSubmitBtn');
        const original = btn?.textContent || SINGLE_ISSUE_LABEL;
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Видаю...';
        }

        const preset = $('certPageTypePreset')?.value || 'на одноразовий вхід';
        const data = {
            displayMode: $('certPageDisplayMode')?.value || 'fio',
            displayValue,
            typeText: preset === 'custom'
                ? $('certPageTypeText')?.value.trim()
                : preset,
            typeCode: preset === BATCH_CERTIFICATE_TYPE_TEXT ? 'one_time_admission'
                : preset === 'абонемент' ? 'subscription' : 'verification_only',
            validUntil: $('certPageValidUntil')?.value || undefined,
            notes: $('certPageNotes')?.value.trim() || undefined,
            season: $('certPageSeason')?.value || currentSeason()
        };

        try {
            const result = await apiCreateCertificate(data);
            if (context !== getLegacyBusinessSurfaceContextKey('certificates')) return;
            if (!result.success) {
                if (!syncCertificateAvailability()) return;
                notify(result.error || 'Не вдалося видати сертифікат або абонемент', 'error');
                return;
            }
            renderSingleResult(result.certificate);
            $('certificatePageForm')?.reset();
            initializeSingleForm();
            notify(`Сертифікат або абонемент ${result.certificate.certCode} видано`, 'success');
        } catch (error) {
            notify(error.message || 'Не вдалося видати сертифікат', 'error');
        } finally {
            state.singleSubmitting = false;
            if (btn) {
                btn.textContent = original;
            }
            syncCertificateAvailability();
        }
    }

    function renderSingleResult(cert) {
        const box = $('certCreateResult');
        if (!box) return;
        const source = issueSourceMeta(cert);
        box.classList.remove('hidden');
        box.innerHTML = `
            <span class="cert-result-kicker">Видано</span>
            <h3 tabindex="-1">${esc(cert.certCode)}</h3>
            <p>${esc(displayValueForCert(cert))} · ${esc(cert.typeText || '')}</p>
            <div class="cert-result-meta">
                <span class="cert-source-chip cert-source-${esc(source.tone)}">${esc(source.label)}</span>
                <span>Видано: ${formatDateTime(cert.issuedAt)}</span>
                <span>Видав: ${esc(issuerLabel(cert))}</span>
            </div>
            <div id="certCreatePreview" class="cert-standalone-preview cert-standalone-preview-result"></div>
            <div class="cert-result-actions">
                <button type="button" class="btn-page-primary" data-cert-download="${esc(cert.id)}">Відкрити зображення</button>
                <button type="button" class="btn-page-secondary" data-cert-open="${esc(cert.id)}">Переглянути деталі</button>
                <a class="btn-page-secondary" href="/certificates">До реєстру</a>
            </div>`;
        renderCertificatePreview('certCreatePreview', cert);
        revealResult(box, box.querySelector('h3'));
    }

    function revealResult(box, heading) {
        requestAnimationFrame(() => {
            if (!box.isConnected || box.classList.contains('hidden')) return;
            heading?.focus({ preventScroll: true });
            box.scrollIntoView?.({ block: 'start' });
        });
    }

    async function handleBatchSubmit(event) {
        event.preventDefault();
        if (state.batchSubmitting || !syncCertificateAvailability()) return;
        const btn = $('certBatchPageSubmitBtn');
        const original = btn?.textContent || 'Згенерувати пакет';
        const quantity = Number(document.querySelector('input[name="certPageBatchQty"]:checked')?.value || 0);
        const eventName = $('certPageBatchEventName')?.value.trim();

        if (!quantity) {
            notify('Оберіть кількість сертифікатів', 'error');
            return;
        }
        state.batchSubmitting = true;
        const context = getLegacyBusinessSurfaceContextKey('certificates');
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
            if (context !== getLegacyBusinessSurfaceContextKey('certificates')) return;
            if (!result.success) {
                if (!syncCertificateAvailability()) return;
                notify(result.error || 'Не вдалося згенерувати пакет', 'error');
                return;
            }
            renderBatchResult(result.certificates || []);
            notify(`Згенеровано ${quantity} сертифікатів`, 'success');
        } catch (error) {
            notify(error.message || 'Не вдалося згенерувати пакет', 'error');
        } finally {
            state.batchSubmitting = false;
            if (btn) {
                btn.textContent = original;
            }
            syncCertificateAvailability();
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
        revealResult(box, $('certBatchResultTitle'));
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

    async function openDetail(id, trigger) {
        if (!id) return;
        const context = getLegacyBusinessSurfaceContextKey('certificates');
        state.detailId = id;
        const modal = $('certificatePageDetailModal');
        const content = $('certificatePageDetailContent');
        const actions = $('certificatePageDetailActions');
        if (!modal || !content || !actions) return;
        if (modal.classList.contains('hidden')) state.detailReturnFocus = trigger || document.activeElement;
        modal.classList.remove('hidden');
        $('certificatePageDetailClose')?.focus();
        content.innerHTML = '<div class="empty-state">Завантаження...</div>';
        actions.innerHTML = '';

        try {
            const response = await apiFetchWithAuthRetry(`${API_BASE}/certificates/${encodeURIComponent(id)}`, {
                headers: getAuthHeaders(false)
            });
            if (!response) throw new Error('auth_session_unavailable');
            if (!response.ok) throw new Error('not_found');
            const cert = await response.json();
            if (state.detailId !== id || context !== getLegacyBusinessSurfaceContextKey('certificates')) return;
            renderDetail(cert);
        } catch {
            if (state.detailId !== id || context !== getLegacyBusinessSurfaceContextKey('certificates')) return;
            content.innerHTML = '<div class="empty-state">Не вдалося завантажити сертифікат</div>';
        }
    }

    function renderCertificatePreview(containerId, cert) {
        if (window.CertificatePreview && typeof window.CertificatePreview.renderInto === 'function') {
            window.CertificatePreview.renderInto(containerId, cert, {
                apiBase: API_BASE,
                getAuthHeaders
            });
            return;
        }
        const container = $(containerId);
        if (container) {
            container.innerHTML = '<div class="cert-preview-fallback">Не вдалося показати зображення. Оновіть сторінку й повторіть спробу.</div>';
        }
    }

    function renderDetail(cert) {
        const content = $('certificatePageDetailContent');
        const actions = $('certificatePageDetailActions');
        const modeLabel = cert.displayMode === 'fio' ? 'ПІБ' : 'Номер';
        const source = issueSourceMeta(cert);
        const validUntil = String(cert.validUntil || '').slice(0, 10);
        const effectiveStatus = cert.status === 'active' && validUntil && validUntil < getKyivDateKey()
            ? 'expired' : cert.status;
        state.detailCert = cert;
        content.innerHTML = `
            <div class="cert-detail-shell">
                <div class="cert-detail-image">
                    <div id="certificatePagePreview" class="cert-standalone-preview"></div>
                    <button type="button" class="btn-page-secondary" data-cert-download="${esc(cert.id)}">Відкрити зображення</button>
                </div>
                <div class="cert-detail-summary-card">
                    <div class="cert-detail-summary-head">
                        <div>
                            <span class="cert-result-kicker">Сертифікат</span>
                            <h4>${esc(cert.certCode)}</h4>
                        </div>
                        ${statusBadge(effectiveStatus)}
                    </div>
                    <div class="cert-detail-grid">
                        <div class="cert-detail-row"><span class="cert-detail-label">Джерело:</span><span class="cert-detail-val"><span class="cert-source-chip cert-source-${esc(source.tone)}">${esc(source.label)}</span></span></div>
                        <div class="cert-detail-row"><span class="cert-detail-label">${modeLabel}:</span><span class="cert-detail-val">${esc(displayValueForCert(cert))}</span></div>
                        <div class="cert-detail-row"><span class="cert-detail-label">Тип:</span><span class="cert-detail-val">${esc(cert.typeText || '—')}</span></div>
                        <div class="cert-detail-row"><span class="cert-detail-label">Видано:</span><span class="cert-detail-val">${formatDateTime(cert.issuedAt)}</span></div>
                        <div class="cert-detail-row"><span class="cert-detail-label">Дійсний до:</span><span class="cert-detail-val">${formatDate(cert.validUntil)}</span></div>
                        <div class="cert-detail-row"><span class="cert-detail-label">Видав:</span><span class="cert-detail-val">${esc(issuerLabel(cert))}</span></div>
                        ${cert.batchGroupId ? `<div class="cert-detail-row"><span class="cert-detail-label">Пакет:</span><span class="cert-detail-val"><code>${esc(cert.batchGroupId)}</code></span></div>` : ''}
                        ${cert.notes ? `<div class="cert-detail-row"><span class="cert-detail-label">Примітка:</span><span class="cert-detail-val">${esc(cert.notes)}</span></div>` : ''}
                    </div>
                </div>
            </div>`;
        renderCertificatePreview('certificatePagePreview', cert);

        let html = `<button type="button" class="btn-page-secondary" data-cert-copy="${esc(cert.certCode)}">Копіювати код</button>`;
        if (cert.status === 'active') {
            html += `<a class="btn-page-primary" href="/certificates/check?code=${encodeURIComponent(cert.certCode)}">Перевірити сертифікат</a>`;
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
        state.detailCert = null;
        if (state.detailReturnFocus?.isConnected) state.detailReturnFocus.focus();
        state.detailReturnFocus = null;
    }

    function downloadCertificateFromPage(id, trigger) {
        if (!window.CertificateImageExport?.open) {
            notify('Перегляд зображення недоступний. Повторіть після оновлення сторінки.', 'error');
            return;
        }
        window.CertificateImageExport.open({
            trigger, apiBase: API_BASE, getAuthHeaders,
            loadCertificate: async () => {
                const response = await apiFetchWithAuthRetry(`${API_BASE}/certificates/${encodeURIComponent(id)}`, {
                    headers: getAuthHeaders(false)
                });
                if (!response || response.status === 401) throw new Error('auth_session_unavailable');
                if (!response.ok) throw new Error('certificate_load_failed');
                return response.json();
            }
        });
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
        $('certificateCheckResult')?.addEventListener('click', event => {
            if (event.target.closest('[data-cert-redeem]')) redeemCheckedCertificate();
        });
        $('certificateCheckForm')?.addEventListener('submit', (event) => {
            event.preventDefault();
            loadCertificateCheck($('certificateCheckCode')?.value);
        });
        $('certPageRefreshBtn')?.addEventListener('click', loadCertificatesPage);
        $('certPageStatus')?.addEventListener('change', loadCertificatesPage);
        $('certPageSearch')?.addEventListener('input', () => {
            clearTimeout(state.searchTimer);
            state.searchTimer = setTimeout(loadCertificatesPage, 350);
        });
        $('certPageDisplayMode')?.addEventListener('change', updateDisplayModeLabel);
        $('certPageDisplayValue')?.addEventListener('input', () => {
            if ($('certPageDisplayValue')?.value.trim()) setDisplayValueError('');
        });
        $('certPageDisplayValue')?.addEventListener('invalid', (event) => {
            event.preventDefault();
            validateSingleIdentity({ focus: true });
        });
        $('certPageTypePreset')?.addEventListener('change', updateSingleTypeMode);
        $('certificatePageForm')?.addEventListener('submit', handleSingleSubmit);
        $('certificateBatchPageForm')?.addEventListener('submit', handleBatchSubmit);
        $('certBatchCopyBtn')?.addEventListener('click', copyBatchCodes);
        $('certificatePageDetailClose')?.addEventListener('click', closeDetail);
        $('certificatePageDetailModal')?.addEventListener('click', (event) => {
            if (event.target === $('certificatePageDetailModal')) closeDetail();
        });
        $('certificatePageDetailModal')?.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeDetail();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = [...event.currentTarget.querySelectorAll('button:not([disabled]), a[href]')]
                .filter(element => element.getClientRects().length);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
        document.addEventListener('click', (event) => {
            const openBtn = event.target.closest('[data-cert-open]');
            if (openBtn) {
                event.preventDefault();
                openDetail(openBtn.dataset.certOpen, openBtn);
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
            const downloadBtn = event.target.closest('[data-cert-download]');
            if (downloadBtn) {
                event.preventDefault();
                downloadCertificateFromPage(downloadBtn.dataset.certDownload, downloadBtn);
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
        if (detectMode() === 'check') {
            const code = readCertificateCheckCode();
            if (code) {
                try { sessionStorage.setItem(CERTIFICATE_CHECK_CODE_KEY, code); } catch {}
            }
            if (typeof rememberAuthReturnRoute === 'function') rememberAuthReturnRoute('certificate-check-login');
        }
        if (typeof clearAuthenticatedPageShell === 'function') clearAuthenticatedPageShell();
        window.location.href = '/';
    }

    async function bootstrapAuthenticatedShell() {
        if (typeof apiVerifyToken !== 'function'
            || typeof hydrateBusinessOperatingProfile !== 'function'
            || typeof hydrateActionPermissions !== 'function') {
            throw new Error('Shared authentication runtime is unavailable');
        }
        const user = await apiVerifyToken();
        if (!user) {
            const authFailure = typeof getApiAuthSessionFailure === 'function'
                ? getApiAuthSessionFailure()
                : null;
            if (typeof isApiAuthSessionFailureTransient === 'function'
                && isApiAuthSessionFailureTransient(authFailure)) {
                const error = new Error('Не вдалося тимчасово підтвердити сесію');
                error.code = 'auth_session_transient';
                error.authFailure = authFailure;
                throw error;
            }
            if (typeof clearAuthStorage === 'function') clearAuthStorage();
            redirectToLogin();
            return null;
        }

        await hydrateBusinessOperatingProfile(user);
        const permissions = await hydrateActionPermissions(user);
        if (!permissions) {
            const error = new Error('Не вдалося завантажити права доступу');
            error.code = 'permission_bootstrap_failed';
            throw error;
        }
        if (typeof AppState !== 'undefined') AppState.currentUser = user;
        window.WorkingRole?.hydrate?.();
        if (typeof enforceCurrentPageAccess === 'function' && !enforceCurrentPageAccess(user)) return null;

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
                message: 'Оновіть сторінку та спробуйте ще раз.',
                moduleName: 'certificates',
                error
            });
            return;
        }
        const main = $('main-content') || $('mainApp');
        if (main) {
            main.innerHTML = '<div class="page-fatal-error" role="alert"><h3>Не вдалося відкрити сертифікати</h3><p>Оновіть сторінку та спробуйте ще раз.</p></div>';
        }
    }

    async function init() {
        if (typeof initDarkMode === 'function') initDarkMode();
        try {
            const user = await bootstrapAuthenticatedShell();
            if (!user) return;
        } catch (error) {
            const authFailure = typeof getApiAuthSessionFailure === 'function'
                ? getApiAuthSessionFailure()
                : error?.authFailure;
            const terminalAuthFailure = error?.code === 'auth_session_terminal'
                || (typeof isApiAuthSessionFailureTerminal === 'function'
                    && isApiAuthSessionFailureTerminal(authFailure));
            if (terminalAuthFailure) return;
            if (typeof showAuthenticatedPageShell === 'function') {
                showAuthenticatedPageShell({ markRuntimeReady: false });
            }
            if (error?.code === 'auth_session_transient' && typeof renderAuthSessionBootstrapError === 'function') {
                renderAuthSessionBootstrapError({
                    containerId: 'main-content',
                    failure: error.authFailure,
                    retry: () => window.location.reload()
                });
                return;
            }
            if (error?.code === 'permission_bootstrap_failed' && typeof renderPermissionBootstrapError === 'function') {
                renderPermissionBootstrapError({
                    containerId: 'main-content',
                    retry: () => window.location.reload()
                });
                return;
            }
            if (typeof handleStandaloneInitError === 'function') {
                handleStandaloneInitError('certificates', error, renderCertificatePageFatalError);
            } else {
                renderCertificatePageFatalError(error);
            }
            return;
        }

        bindEvents();
        const refreshAvailability = () => {
            invalidateCertificateCheck();
            if (syncCertificateAvailability() && state.mode === 'list') loadCertificatesPage();
        };
        window.addEventListener('crmBusinessContextChanged', refreshAvailability);
        window.addEventListener('crmBusinessProfileChanged', refreshAvailability);
        window.addEventListener('legacyBusinessSurfaceUnavailable', event => {
            if (event.detail?.surface === 'certificates') syncCertificateAvailability();
        });
        syncCertificateNavigationAccess();
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
