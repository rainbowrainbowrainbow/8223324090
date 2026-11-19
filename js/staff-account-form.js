'use strict';

const STAFF_ACCOUNT_FORM_MARKUP = `
<div id="accountOnboardingOverlay" class="hr-account-onboarding-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="accountOnboardingTitle" aria-hidden="true">
    <section class="hr-account-onboarding" tabindex="-1">
        <header class="hr-account-onboarding-head">
            <div>
                <span class="hr-account-eyebrow">Контрольоване створення</span>
                <h3 id="accountOnboardingTitle">Надати CRM-доступ</h3>
                <p id="accountOnboardingIntro">CRM-роль визначається за основною посадою у картці співробітника.</p>
            </div>
            <button type="button" id="accountOnboardingClose" class="hr-account-icon-btn" aria-label="Закрити створення акаунта">×</button>
        </header>
        <div id="accountOnboardingLoading" class="hr-account-onboarding-loading hidden" role="status">Завантаження довідників…</div>
        <form id="accountOnboardingForm" class="hr-account-onboarding-form" novalidate>
            <section class="hr-account-onboarding-panel">
                <div id="accountOnboardingExistingStaffFields" class="hr-account-form-grid">
                    <label for="accountOnboardingStaffId" class="is-wide"><span>Картка співробітника *</span><select id="accountOnboardingStaffId" required><option value="">Оберіть співробітника</option></select><small>Вже зайняті профілі недоступні для вибору.</small></label>
                </div>
                <div id="accountOnboardingIdentityFields" class="hr-account-form-grid">
                    <div id="accountOnboardingPersonalFields" class="hr-account-form-grid is-wide"><label for="accountOnboardingName"><span>Імʼя та прізвище *</span><input id="accountOnboardingName" name="name" required readonly></label></div>
                    <label for="accountOnboardingUsername"><span>Логін для входу *</span><input id="accountOnboardingUsername" name="username" maxlength="50" pattern="[a-zA-Z0-9._-]{3,50}" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="accountOnboardingUsernameHint" required><small id="accountOnboardingUsernameHint">Після створення логін не змінюється.</small></label>
                    <div class="is-wide">
                        <label for="accountOnboardingPassword"><span>Початковий пароль *</span></label>
                        <div class="password-visibility-field">
                            <input id="accountOnboardingPassword" type="password" autocomplete="new-password" minlength="12" maxlength="72" aria-describedby="accountOnboardingPasswordHint" required>
                            <button type="button" id="accountOnboardingPasswordToggle" class="password-visibility-toggle" aria-label="Показати пароль" aria-controls="accountOnboardingPassword" aria-pressed="false"><svg class="password-eye-open" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/></svg><svg class="password-eye-closed" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10 6.2a13 13 0 0 1 2-.2c6.4 0 10 6 10 6a16 16 0 0 1-2.2 2.7M6.5 7.5A16 16 0 0 0 2 12s3.6 6 10 6c1.7 0 3.2-.4 4.5-1"/></svg></button>
                        </div>
                        <small id="accountOnboardingPasswordHint">Можна відредагувати. Від 12 символів, без крайніх пробілів, крапки з комою та переносів рядка.</small>
                    </div>
                </div>
            <div id="accountOnboardingManualRoleFields" class="hr-account-form-grid" hidden>
                <label for="accountOnboardingManualRole"><span>Основна роль *</span><select id="accountOnboardingManualRole" disabled></select></label>
            </div>
            <p id="accountOnboardingAccessSummary" class="hr-account-field-note" role="status" tabindex="-1"></p>
            </section>
        </form>
        <section id="accountOnboardingReceipt" tabindex="-1" class="hr-account-receipt hidden" aria-live="polite"></section>
        <div id="accountOnboardingStatus" tabindex="-1" class="hr-account-onboarding-status"><span role="status"></span><span role="alert"></span></div>
        <footer id="accountOnboardingActions" class="hr-account-onboarding-actions">
            <button type="submit" form="accountOnboardingForm" id="accountOnboardingSubmit" class="hr-account-primary">Створити CRM-акаунт</button>
        </footer>
    </section>
</div>
`;

function mountStaffAccountForm() {
    let overlay = document.getElementById('accountOnboardingOverlay');
    if (overlay) return overlay;
    const template = document.createElement('template');
    template.innerHTML = STAFF_ACCOUNT_FORM_MARKUP;
    overlay = template.content.firstElementChild;
    document.body.append(overlay);
    return overlay;
}

function staffAccountField(suffix) {
    return document.getElementById('accountOnboarding' + suffix);
}

function setStaffAccountFormStatus(message = '', type = 'error') {
    const status = staffAccountField('Status');
    if (!status) return;
    status.querySelector('[role="status"]').textContent = type === 'error' ? '' : message;
    status.querySelector('[role="alert"]').textContent = type === 'error' ? message : '';
    status.dataset.type = message ? type : '';
}

function focusInvalidStaffAccountField(message, element) {
    setStaffAccountFormStatus(message);
    element?.setAttribute('aria-invalid', 'true');
    (element?.getClientRects().length ? element : staffAccountField('Status'))?.focus();
    return false;
}

function validateStaffAccountFields() {
    const username = staffAccountField('Username');
    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username.value.trim())) {
        return focusInvalidStaffAccountField('Логін: 3–50 символів, лише латиниця, цифри, крапка, дефіс або підкреслення.', username);
    }
    const input = staffAccountField('Password');
    const password = input.value;
    if ([...password].length < 12 || new TextEncoder().encode(password).length > 72
        || /[\r\n;]/.test(password) || password.normalize('NFKC').trim() !== password) {
        return focusInvalidStaffAccountField('Вкажіть пароль від 12 символів, до 72 байтів, без крайніх пробілів, крапки з комою та переносів рядка.', input);
    }
    return true;
}

function fillStaffAccountFields(staff, username) {
    staffAccountField('Name').value = staff?.name || '';
    staffAccountField('Username').value = username;
    const password = staffAccountField('Password');
    password.value = staff ? generateInitialAccountPassword() : '';
    password.type = 'password';
    staffAccountField('PasswordToggle').setAttribute('aria-pressed', 'false');
}

function setStaffAccountBackgroundInert(inert) {
    const overlay = staffAccountField('Overlay');
    if (!overlay) return;
    for (const element of document.body.children) {
        if (element === overlay || ['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName)) continue;
        if (inert && !element.inert) {
            element.inert = true;
            element.dataset.accountOnboardingInert = 'true';
        } else if (!inert && element.dataset.accountOnboardingInert === 'true') {
            element.inert = false;
            delete element.dataset.accountOnboardingInert;
        }
    }
}

function hideStaffAccountForm() {
    const overlay = staffAccountField('Overlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    const form = staffAccountField('Form');
    form.inert = false;
    staffAccountField('Close').disabled = false;
    form.reset();
    form.querySelectorAll('[aria-invalid="true"]').forEach(element => element.removeAttribute('aria-invalid'));
    staffAccountField('Password').type = 'password';
    staffAccountField('PasswordToggle').setAttribute('aria-pressed', 'false');
    staffAccountField('Submit').disabled = false;
    form.classList.remove('hidden');
    staffAccountField('Actions').classList.remove('hidden');
    const receipt = staffAccountField('Receipt');
    receipt.classList.add('hidden');
    receipt.replaceChildren();
    setStaffAccountFormStatus();
    setStaffAccountBackgroundInert(false);
}

function bindStaffAccountForm({ getState, submit, close }) {
    const overlay = mountStaffAccountForm();
    if (overlay.dataset.bound === 'true') return;
    overlay.dataset.bound = 'true';
    const password = staffAccountField('Password');
    staffAccountField('PasswordToggle').addEventListener('click', event => {
        const visible = password.type === 'password';
        password.type = visible ? 'text' : 'password';
        event.currentTarget.setAttribute('aria-pressed', String(visible));
    });
    for (const eventName of ['input', 'change']) {
        staffAccountField('Form').addEventListener(eventName, event => {
            const state = getState();
            if (!state || state.submitting) return;
            state.dirty = true;
            event.target.removeAttribute('aria-invalid');
            setStaffAccountFormStatus();
        });
    }
    staffAccountField('Close').addEventListener('click', close);
    staffAccountField('Form').addEventListener('submit', event => {
        event.preventDefault();
        void submit();
    });
    overlay.addEventListener('click', event => {
        if (event.target === overlay) staffAccountField(getState()?.submitting ? 'Status' : 'Close').focus();
    });
    overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            void close();
            return;
        }
        if (event.key !== 'Tab') return;
        if (getState()?.submitting) {
            event.preventDefault();
            staffAccountField('Status').focus();
            return;
        }
        const focusable = Array.from(overlay.querySelectorAll('button, input, select, a[href], summary, [tabindex="0"]')).filter(element => {
            return !element.matches(':disabled') && element.getClientRects().length
                && !element.closest('[hidden], .hidden, [inert]');
        });
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
}

async function confirmStaffAccountFormClose(state) {
    if (!state || state.submitting || state.confirmingClose) return false;
    if (!state.dirty || state.receipt) return true;
    state.confirmingClose = true;
    try {
        return await confirmModal('Є незбережені зміни. Закрити без збереження?', {
            type: 'warning', okText: 'Закрити без збереження', cancelText: 'Продовжити редагування'
        });
    } finally {
        state.confirmingClose = false;
    }
}

async function submitStaffAccountForm(state, isCurrent, request, complete) {
    const form = staffAccountField('Form');
    const submit = staffAccountField('Submit');
    const close = staffAccountField('Close');
    const returnFocus = form.contains(document.activeElement) ? document.activeElement : staffAccountField('Username');
    state.submitting = true;
    setStaffAccountFormStatus('Зберігаємо дані та створюємо CRM-акаунт…', 'progress');
    staffAccountField('Status').focus();
    form.inert = true;
    close.disabled = true;
    submit.disabled = true;
    try {
        const response = await request();
        if (!isCurrent()) return;
        if (!response.result?.success) {
            setStaffAccountFormStatus(response.result?.error || 'Не вдалося завершити створення акаунта.');
            return;
        }
        complete(response);
    } catch {
        if (isCurrent()) setStaffAccountFormStatus('Не вдалося підтвердити результат. Повторіть із тими самими даними.');
    } finally {
        if (isCurrent()) {
            state.submitting = false;
            form.inert = false;
            close.disabled = false;
            submit.disabled = false;
            if (!form.classList.contains('hidden')) returnFocus.focus();
        }
    }
}

function renderStaffAccountFormReceipt({ title, accessMessage, loginMessage, rows, credential, actions = '', nextSteps = '', warnings = [] }) {
    const receipt = staffAccountField('Receipt');
    const copy = credential ? '<button type="button" class="hr-account-primary" data-account-onboarding-copy>Скопіювати дані для входу</button>' : '';
    const details = rows.map(([label, value]) => `<div class="hr-account-detail-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || 'Не задано')}</strong></div>`).join('');
    receipt.innerHTML = `
        <h4>${escapeHtml(title)}</h4>
        <p class="hr-account-receipt-access" role="status" aria-live="polite">${escapeHtml(accessMessage)}</p>
        <p class="hr-account-receipt-access" role="status" aria-live="polite">${escapeHtml(loginMessage)}</p>
        <div class="hr-account-detail-actions">${copy}${actions}</div>
        ${nextSteps}
        <div class="hr-account-receipt-grid">${details}</div>
        ${credential ? `<div class="hr-account-credential"><strong>Тимчасовий пароль, показується один раз</strong><code>Логін: ${escapeHtml(credential.username || '')}</code><code>Тимчасовий пароль: ${escapeHtml(credential.password || '')}</code></div>` : ''}
        ${warnings.length ? `<div class="hr-account-receipt-warnings"><strong>Створено з попередженнями:</strong><ul>${warnings.map(warning => `<li>${escapeHtml(warning.message || warning.code || '')}</li>`).join('')}</ul></div>` : ''}
        <div class="hr-account-detail-actions"><button type="button" class="hr-account-primary" data-account-onboarding-finish>Готово</button></div>`;
    receipt.classList.remove('hidden');
    staffAccountField('Form').classList.add('hidden');
    staffAccountField('Actions').classList.add('hidden');
    staffAccountField('Password').value = '';
    setStaffAccountFormStatus(warnings.length ? 'Основні дані створено. Перевірте попередження у квитанції.' : '', 'warning');
    receipt.scrollTop = 0;
    receipt.focus({ preventScroll: true });
}

async function copyStaffAccountFormCredential(credential, businessLabel, name) {
    if (!navigator.clipboard?.writeText) {
        showNotification('Буфер обміну недоступний. Скопіюйте дані вручну.', 'error');
        return;
    }
    try {
        await navigator.clipboard.writeText(`CRM: ${location.origin}/\nБізнес: ${businessLabel}${name ? `\nІмʼя та прізвище: ${name}` : ''}\nЛогін для входу: ${credential.username}\nПароль: ${credential.password}`);
        showNotification('Логін і тимчасовий пароль скопійовано', 'success');
    } catch {
        showNotification('Не вдалося скопіювати. Скопіюйте дані вручну.', 'error');
    }
}
