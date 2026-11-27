/**
 * settings-afisha.js - Afisha (event schedule) management helpers
 * Load after settings.js in index.html
 *
 * Provides: window.SettingsAfisha = { init, render, create, update, remove, shift, autoPosition }
 */

window.SettingsAfisha = {
    /**
     * Initialize Afisha workspace.
     */
    async init() {
        window.location.href = '/afisha';
    },

    /**
     * Render afisha list (delegates to renderAfishaList)
     */
    async render() {
        if (typeof renderAfishaList === 'function') {
            await renderAfishaList();
        }
    },

    /**
     * Create new afisha item (delegates to addAfishaItem)
     */
    async create() {
        if (typeof addAfishaItem === 'function') {
            await addAfishaItem();
        }
    },

    /**
     * Update afisha item (delegates to handleAfishaEditSubmit)
     * @param {Event} e - Form submit event
     */
    async update(e) {
        if (typeof handleAfishaEditSubmit === 'function') {
            await handleAfishaEditSubmit(e);
        }
    },

    /**
     * Delete afisha item
     * @param {string} id - Afisha item ID
     */
    async remove(id) {
        if (typeof deleteAfishaItem === 'function') {
            await deleteAfishaItem(id);
        }
    },

    /**
     * Shift afisha time by delta minutes
     * @param {string} id - Afisha item ID
     * @param {number} deltaMinutes - Minutes to shift (positive or negative)
     */
    async shift(id, deltaMinutes) {
        if (typeof shiftAfishaItem === 'function') {
            await shiftAfishaItem(id, deltaMinutes);
        }
    },

    /**
     * Auto-position afisha items (delegates to autoPositionAfisha)
     */
    async autoPosition() {
        if (typeof autoPositionAfisha === 'function') {
            await autoPositionAfisha();
        }
    },

    /**
     * Generate tasks for afisha item
     * @param {string} id - Afisha item ID
     */
    async generateTasks(id) {
        if (typeof generateTasksForAfisha === 'function') {
            await generateTasksForAfisha(id);
        }
    },

    /**
     * Export afisha in bulk (delegates to exportAfishaBulk)
     */
    async exportBulk() {
        if (typeof exportAfishaBulk === 'function') {
            await exportAfishaBulk();
        }
    },

    /**
     * Import afisha in bulk (delegates to importAfishaBulk)
     */
    async importBulk() {
        if (typeof importAfishaBulk === 'function') {
            await importAfishaBulk();
        }
    }
};


// Announcement delivery settings are loaded on demand inside the existing settings modal.
(function () {
    'use strict';
    const section = document.getElementById('settingsAfishaAnnouncements');
    if (!section) return;
    const list = section.querySelector('[data-announcement-recipients]');
    const add = section.querySelector('[data-add-announcement-recipient]');
    const status = section.querySelector('[data-announcement-settings-status]');
    const path = '/afisha/announcements/recipients';
    const functions = section.querySelector('[data-telegram-functions]');
    const functionsStatus = functions.querySelector('[data-telegram-functions-status]');
    const routing = section.querySelector('[data-telegram-routing]');
    const routingList = routing.querySelector('[data-telegram-routing-list]');
    const directoryList = section.querySelector('[data-telegram-directory-list]');
    let directory = [];
    let approvalTarget = null;
    let loadSequence = 0;
    let digestDestination = null;

    const modeLabels = { off: 'Афіша вимкнена', monthly: 'Афіша 1-го числа', publication: 'При публікації' };
    const stateLabels = {
        pending: 'У черзі', sent: 'Доставлено', retry: 'Очікує повтору', partial: 'Доставлено частково',
        failed: 'Помилка доставки', uncertain: 'Потрібна перевірка', skipped: 'Пропущено'
    };
    const platformLabel = platform => platform === 'telegram' ? 'Telegram' : 'Google Chat';

    function deliveryDate(value) {
        if (value == null) return '';
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return '';
        return date.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short' });
    }

    const addressKey = (chatId, threadId) => chatId ? String(chatId) + ':' + (threadId ?? '') : '';
    const optionText = item => (item.chatTitle || 'Група ' + item.chatId) + ' · ' +
        (item.threadTitle || (item.threadId ? 'Тема ' + item.threadId : 'Загальний чат'));

    function fillTelegramOptions(select, placeholder, selected) {
        select.replaceChildren(new Option(placeholder, ''));
        for (const item of directory) select.add(new Option(optionText(item), item.key));
        if (selected && !directory.some(item => item.key === selected)) {
            const [chatId, threadId] = selected.split(':');
            select.add(new Option(optionText({ chatId, threadId }), selected));
        }
        select.value = selected;
    }

    function renderRouting(routes, selections = {}, business) {
        const labels = { approval: 'Погодження аніматорів', digest: 'Щоденне зведення', reminder: 'Нагадування на завтра' };
        routing.hidden = !Array.isArray(routes) || routes.length === 0;
        routingList.replaceChildren();
        for (const route of routes || []) {
            const row = document.createElement('li');
            const bot = route.botProfile === 'operational' ? 'Службовий бот' : 'Поточне підключення сповіщень';
            const address = route.chatId ? [route.chatId, route.threadId ? 'тема ' + route.threadId : 'без теми'].join(' · ') : 'Групу не визначено';
            const schedule = route.feature === 'digest' ? [route.weekday && 'будні ' + route.weekday,
                route.weekend && 'вихідні ' + route.weekend].filter(Boolean).join(', ') : route.time;
            const description = document.createElement('span');
            const entry = directory.find(item => item.key === addressKey(route.chatId, route.threadId));
            description.textContent = [labels[route.feature], bot, entry ? optionText(entry) : address, schedule,
                route.matchingRecipient && 'Збіг з отримувачем афіші: ' + route.matchingRecipient].filter(Boolean).join(' · ');
            const form = document.createElement('form');
            form.className = 'tg-btn-row';
            const select = document.createElement('select');
            select.setAttribute('aria-label', 'Маршрут: ' + labels[route.feature]);
            fillTelegramOptions(select, 'Поточні налаштування', selections[route.feature] || '');
            const save = document.createElement('button');
            save.type = 'submit';
            save.className = 'btn-secondary';
            save.textContent = 'Зберегти маршрут';
            const result = document.createElement('span');
            result.setAttribute('role', 'status');
            form.append(select, save, result);
            form.addEventListener('submit', async event => {
                event.preventDefault();
                if (save.disabled || business !== window.TimelineMarketing.context()) return;
                save.disabled = true;
                try {
                    await window.TimelineMarketing.request('/afisha/announcements/telegram-routes/' + route.feature,
                        'PUT', { target: select.value || null }, business);
                    await refresh();
                } catch (error) {
                    result.textContent = error.message;
                } finally {
                    save.disabled = false;
                }
            });
            row.append(description, form);
            routingList.appendChild(row);
        }
    }

    async function refresh() {
        const M = window.TimelineMarketing;
        const sequence = ++loadSequence;
        const business = M.context();
        add.disabled = true;
        list.replaceChildren();
        renderRouting([]);
        directory = [];
        directoryList.replaceChildren();
        functions.hidden = true;
        status.textContent = 'Завантажуємо групи…';
        try {
            const { recipients, dailyDigest, telegramFeatures, approvalTarget: currentApprovalTarget, routingPreview, telegramDirectory, routeSelections } = await M.request(path, 'GET', null, business);
            if (sequence !== loadSequence || business !== M.context()) return;
            digestDestination = dailyDigest || null;
            approvalTarget = currentApprovalTarget || null;
            directory = telegramDirectory || [];
            for (const item of directory) {
                const row = document.createElement('li');
                row.textContent = optionText(item);
                directoryList.appendChild(row);
            }
            renderRouting(routingPreview, routeSelections, business);
            functions.hidden = business !== 'event_genix' || !telegramFeatures;
            functions.elements.animatorApprovals.checked = telegramFeatures?.animatorApprovals === true;
            functions.elements.afishaAnnouncements.checked = telegramFeatures?.afishaAnnouncements === true;
            status.textContent = recipients.length ? '' : 'Додайте першу групу для розсилки.';
            for (const recipient of recipients) {
                const row = document.createElement('article');
                row.className = 'telegram-setup tg-subsection';
                const mode = modeLabels[recipient.afishaMode] || modeLabels.off;
                const schedule = [
                    recipient.active ? (recipient.platform === 'telegram' && telegramFeatures?.afishaAnnouncements === false
                        ? 'Розсилку вимкнено для бота' : 'Увімкнено') : 'Вимкнено',
                    mode,
                    recipient.afishaMode === 'monthly' && recipient.monthlyTime,
                    recipient.eventsToday && 'Події дня',
                    recipient.promotionsToday && 'Старт акцій',
                    (recipient.eventsToday || recipient.promotionsToday) && recipient.dailyTime
                ].filter(Boolean).join(' · ');
                const next = deliveryDate(recipient.nextAt);
                const last = recipient.lastDelivery;
                row.innerHTML = `<strong>${M.esc(recipient.name)}</strong>
                    <p>${platformLabel(recipient.platform)} · ${M.esc(schedule)}</p>
                    ${next ? `<p>Наступна доставка · ${M.esc(next)}</p>` : ''}
                    ${last ? `<p>Остання доставка · ${M.esc(stateLabels[last.status] || 'Оновлюється')}</p>` : ''}
                    ${recipient.digestOverlap ? '<p>Ця група вже отримує афішу в щоденному зведенні.</p>' : ''}
                    <div class="tg-btn-row"><button type="button" class="btn-secondary" data-edit>Редагувати</button>
                    <button type="button" class="btn-secondary" data-history>Історія доставки</button>
                    ${next ? '<button type="button" class="btn-secondary" data-next-preview>Переглянути допис</button>' : ''}</div>`;
                row.querySelector('[data-edit]').addEventListener('click', event => editRecipient(recipient, event.currentTarget, business));
                row.querySelector('[data-next-preview]')?.addEventListener('click', event => showNextPreview(recipient, event.currentTarget, business));
                row.querySelector('[data-history]').addEventListener('click', event => showHistory(recipient, event.currentTarget, business));
                list.append(row);
            }
            add.disabled = false;
        } catch (error) {
            if (sequence === loadSequence && business === M.context()) status.textContent = error.message;
        }
    }

    function editRecipient(recipient, trigger, business) {
        const M = window.TimelineMarketing;
        const modal = M.dialog(recipient.id ? 'Редагувати групу' : 'Додати групу', `
            <form class="timeline-marketing-form" data-recipient-form>
                <label>Назва <input name="name" required maxlength="100" value="${M.esc(recipient.name)}"></label>
                <label>Платформа <select name="platform" ${recipient.id ? 'disabled' : ''}>
                    <option value="telegram">Telegram</option><option value="google_chat">Google Chat</option></select></label>
                <div data-telegram class="timeline-marketing-form">
                    <label>Група або тема Telegram <select name="telegramTarget" required></select></label>
                    ${approvalTarget?.chatId ? '<button type="button" class="btn-secondary" data-use-approval-chat>Вибрати групу погоджень</button>' : ''}
                    <p data-chat-status role="status"></p>
                </div>
                <div data-google-chat class="timeline-marketing-form" hidden>
                    <label>Вхідний вебхук Google Chat <input type="password" name="webhook" autocomplete="new-password"></label>
                    ${recipient.webhookConfigured ? '<small>Залиште поле порожнім, щоб зберегти підключення.</small>' : ''}
                </div>
                <label>Місячна афіша <select name="afishaMode">
                    <option value="off">Вимкнено</option><option value="monthly">1-го числа</option>
                    <option value="publication">При публікації</option></select></label>
                <label data-monthly-time>Час місячної афіші за Києвом <input type="time" name="monthlyTime" value="${M.esc(recipient.monthlyTime || '09:00')}"></label>
                <label><span><input type="checkbox" name="eventsToday" ${recipient.eventsToday ? 'checked' : ''}> Події дня</span></label>
                <label><span><input type="checkbox" name="promotionsToday" ${recipient.promotionsToday ? 'checked' : ''}> Старт акцій</span></label>
                <label data-daily-time>Час денного анонсу за Києвом <input type="time" name="dailyTime" value="${M.esc(recipient.dailyTime || '08:00')}"></label>
                <label ${recipient.id ? '' : 'hidden'}><span><input type="checkbox" name="active" ${recipient.active ? 'checked' : ''}> Увімкнути розсилку для групи</span></label>
                <p data-digest-warning role="status" hidden>Ця група вже отримує афішу в щоденному зведенні.</p>
                <div data-save-status role="status" aria-live="polite"></div>
                <button type="submit" class="btn-primary">Зберегти групу</button>
            </form>`, trigger);
        const form = modal.querySelector('[data-recipient-form]');
        const fields = form.elements;
        const chatStatus = form.querySelector('[data-chat-status]');
        const saveStatus = form.querySelector('[data-save-status]');
        const submit = form.querySelector('[type=submit]');
        const digestWarning = form.querySelector('[data-digest-warning]');
        fields.platform.value = recipient.platform || 'telegram';
        fields.afishaMode.value = recipient.afishaMode || 'off';
        fillTelegramOptions(fields.telegramTarget, 'Оберіть групу або тему', addressKey(recipient.chatId, recipient.threadId));
        if (!directory.length && !recipient.chatId) chatStatus.textContent = 'У довіднику поки немає груп Telegram.';

        function refreshFields() {
            const telegram = fields.platform.value === 'telegram';
            form.querySelector('[data-telegram]').hidden = !telegram;
            form.querySelector('[data-google-chat]').hidden = telegram;
            fields.telegramTarget.required = telegram;
            fields.webhook.required = !telegram && !recipient.webhookConfigured;
            digestWarning.hidden = !(telegram && digestDestination &&
                fields.telegramTarget.value === addressKey(digestDestination.chatId, digestDestination.threadId));
            form.querySelector('[data-monthly-time]').hidden = fields.afishaMode.value !== 'monthly';
            form.querySelector('[data-daily-time]').hidden = !fields.eventsToday.checked && !fields.promotionsToday.checked;
        }

        form.querySelector('[data-use-approval-chat]')?.addEventListener('click', () => {
            fillTelegramOptions(fields.telegramTarget, 'Оберіть групу або тему', addressKey(approvalTarget.chatId, approvalTarget.threadId));
            refreshFields();
        });
        form.addEventListener('change', refreshFields);
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (submit.disabled) return;
            submit.disabled = true;
            const config = {
                name: fields.name.value.trim(), platform: fields.platform.value, active: fields.active.checked,
                afishaMode: fields.afishaMode.value, monthlyTime: fields.monthlyTime.value, dailyTime: fields.dailyTime.value,
                eventsToday: fields.eventsToday.checked, promotionsToday: fields.promotionsToday.checked
            };
            if (config.platform === 'telegram') {
                const [chatId, threadId] = fields.telegramTarget.value.split(':');
                config.chatId = chatId;
                config.threadId = threadId || null;
            } else if (fields.webhook.value) {
                config.webhook = fields.webhook.value;
            }
            if (recipient.id) config.version = recipient.version;
            saveStatus.textContent = 'Зберігаємо…';
            try {
                await M.request(recipient.id ? path + '/' + encodeURIComponent(recipient.id) : path,
                    recipient.id ? 'PUT' : 'POST', config, business);
                if (!modal.isConnected) return;
                closeModal(modal);
                await refresh();
            } catch (error) {
                if (modal.isConnected) saveStatus.textContent = error.message;
            } finally {
                if (modal.isConnected) submit.disabled = false;
            }
        });

        refreshFields();
    }

    async function showNextPreview(recipient, trigger, business) {
        const M = window.TimelineMarketing;
        const modal = M.dialog('Наступний допис · ' + recipient.name, '<div data-next-preview-results role="status">Готуємо перегляд…</div>', trigger);
        const result = modal.querySelector('[data-next-preview-results]');
        try {
            const { parts, scheduledAt } = await M.request(path + '/' + encodeURIComponent(recipient.id) + '/preview', 'GET', null, business);
            if (!modal.isConnected) return;
            result.innerHTML = parts.length
                ? '<p>' + M.esc(deliveryDate(scheduledAt)) + '</p>' + parts.map(part =>
                    '<pre class="timeline-afisha-publication-text">' + M.esc(part) + '</pre>').join('')
                : 'На цей час немає записів для анонсу.';
        } catch (error) {
            if (modal.isConnected) result.textContent = error.message;
        }
    }

    async function showHistory(recipient, trigger, business) {
        const M = window.TimelineMarketing;
        const modal = M.dialog('Історія доставки · ' + recipient.name, '<div data-history-results role="status">Завантажуємо…</div>', trigger);
        const result = modal.querySelector('[data-history-results]');
        try {
            const { deliveries } = await M.request(path + '/' + encodeURIComponent(recipient.id) + '/history', 'GET', null, business);
            if (!modal.isConnected) return;
            result.innerHTML = deliveries.length ? deliveries.map(delivery => `<details>
                <summary>${M.esc(deliveryDate(delivery.at))} · ${M.esc(stateLabels[delivery.status] || 'Оновлюється')}</summary>
                ${delivery.text ? `<pre class="timeline-afisha-publication-text">${M.esc(delivery.text)}</pre>` : ''}
                ${delivery.detail === 'publication_changed' ? '<p>Афішу змінено після підтвердження. Перегляньте й опублікуйте допис знову.</p>'
                    : delivery.detail ? `<p>${M.esc(delivery.detail)}</p>` : ''}</details>`).join('') : 'Історія доставки порожня.';
        } catch (error) {
            if (modal.isConnected) result.textContent = error.message;
        }
    }

    functions.addEventListener('submit', async event => {
        event.preventDefault();
        const button = functions.querySelector('[type=submit]');
        if (button.disabled) return;
        button.disabled = true;
        functionsStatus.textContent = '';
        try {
            await window.TimelineMarketing.request('/afisha/announcements/telegram-features', 'PUT', {
                animatorApprovals: functions.elements.animatorApprovals.checked,
                afishaAnnouncements: functions.elements.afishaAnnouncements.checked
            });
            await refresh();
            functionsStatus.textContent = 'Функції збережено.';
        } catch (error) {
            functionsStatus.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    });
    section.addEventListener('toggle', () => { if (section.open) void refresh(); });
    add.addEventListener('click', event => editRecipient({}, event.currentTarget, window.TimelineMarketing.context()));
    window.addEventListener('timeline:business-context-changed', () => { if (section.open) void refresh(); });
})();
