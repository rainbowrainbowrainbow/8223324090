/* Own-account Telegram connection. Proofs stay in this tab's memory, never in URLs/storage. */
(function (global) {
    'use strict';
    if (global.TelegramCrmProfile) return;
    const pending = new Map();
    const currentUserId = () => String(typeof AppState !== 'undefined' ? AppState.currentUser?.id || '' : '');
    const element = (tag, text, attributes = {}) => {
        const node = document.createElement(tag);
        if (text) node.textContent = text;
        for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
        return node;
    };

    async function request(path = '', body) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(`/api/auth/telegram-crm${path}`, {
                method: body === undefined ? 'GET' : 'POST', headers: getAuthHeaders(body !== undefined),
                body: body === undefined ? undefined : JSON.stringify(body),
                cache: 'no-store', signal: controller.signal
            });
            const data = await response.json();
            if (!response.ok || data.success !== true) {
                throw Object.assign(new Error(data.error || 'Не вдалося виконати дію.'), { code: data.code });
            }
            return data;
        } catch (error) {
            if (error.code) throw error;
            throw new Error('Немає відповіді CRM. Натисніть «Оновити стан», щоб перевірити результат.');
        } finally { clearTimeout(timeout); }
    }

    async function mount(root) {
        if (!root || root.dataset.telegramMounted) return;
        root.dataset.telegramMounted = 'true';
        root.classList.add('telegram-crm-panel');
        const userId = currentUserId();
        let binding;
        let busy = false;
        const heading = element('h2', 'Telegram і задачі CRM', { id: 'telegramCrmHeading', tabindex: '-1' });
        const info = element('div');
        const actions = element('div', '', { class: 'telegram-crm-actions' });
        const flow = element('div');
        const status = element('p', '', { id: 'telegramCrmStatus', role: 'status', 'aria-atomic': 'true' });
        root.replaceChildren(heading, info, actions, flow, status);

        function button(text, handler, parent = actions) {
            const control = element('button', text, { type: 'button' });
            control.addEventListener('click', () => run(handler, control));
            parent.append(control);
            return control;
        }
        async function run(work, trigger) {
            if (busy || currentUserId() !== userId) return;
            busy = true;
            root.setAttribute('aria-busy', 'true');
            if (trigger) trigger.disabled = true;
            try { await work(); }
            catch (error) { status.textContent = error.message; }
            finally {
                busy = false;
                root.removeAttribute('aria-busy');
                if (trigger?.isConnected) trigger.disabled = false;
            }
        }
        function passwordForm(disconnect) {
            flow.replaceChildren();
            const form = element('form', '', { method: 'post', action: `/api/auth/telegram-crm/${disconnect ? 'disconnect' : 'link'}`, 'aria-labelledby': 'telegramCrmHeading' });
            const help = element('p', disconnect
                ? 'Від’єднання одразу закриє доступ до CRM через бота та скасує старі чернетки.'
                : 'Підтвердьте пароль CRM. Потім відкрийте Telegram і поверніться в цю вкладку. Старий Telegram працює до підтвердження нового.', { id: 'telegramCrmHelp' });
            const label = element('label', 'Поточний пароль CRM (обов’язково)', { for: 'telegramCrmPassword' });
            const input = element('input', '', { id: 'telegramCrmPassword', name: 'password', type: 'password', autocomplete: 'current-password', required: '', 'aria-invalid': 'false', 'aria-describedby': 'telegramCrmHelp' });
            const toggle = element('button', 'Показати пароль', { type: 'button', 'aria-pressed': 'false' });
            toggle.addEventListener('click', () => {
                const shown = input.type === 'password';
                input.type = shown ? 'text' : 'password';
                toggle.setAttribute('aria-pressed', String(shown));
                toggle.textContent = shown ? 'Приховати пароль' : 'Показати пароль';
            });
            input.addEventListener('invalid', () => input.setAttribute('aria-invalid', 'true'));
            input.addEventListener('input', () => {
                input.setAttribute('aria-invalid', 'false');
                input.setAttribute('aria-describedby', 'telegramCrmHelp');
            });
            const submit = element('button', disconnect ? 'Від’єднати Telegram зараз' : 'Отримати посилання', { type: 'submit' });
            form.append(help, label, input, toggle, submit);
            form.addEventListener('submit', event => {
                event.preventDefault();
                void run(async () => {
                    let password = input.value;
                    input.value = '';
                    try {
                        const data = await request(disconnect ? '/disconnect' : '/link', { password });
                        if (currentUserId() !== userId) return;
                        if (disconnect) {
                            pending.delete(userId);
                            await refresh();
                            status.textContent = 'Telegram від’єднано. Доступ і старі чернетки відкликані.';
                        } else {
                            pending.set(userId, data);
                            showPending();
                        }
                    } catch (error) {
                        if (error.code === 'TELEGRAM_REAUTH_REQUIRED') {
                            status.textContent = error.message;
                            input.setAttribute('aria-invalid', 'true');
                            input.setAttribute('aria-describedby', 'telegramCrmHelp telegramCrmStatus');
                            input.focus();
                        }
                        throw error;
                    } finally { password = ''; }
                }, submit);
            });
            flow.append(form);
            button('Скасувати', () => { flow.replaceChildren(); actions.querySelector('button')?.focus(); }, form);
            input.focus();
        }
        function showPending(candidate) {
            const state = pending.get(userId);
            flow.replaceChildren();
            if (!state) return;
            const title = element('h3', candidate?.telegramId ? 'Підтвердьте свій Telegram' : 'Продовжіть у Telegram', { tabindex: '-1' });
            flow.append(title);
            if (candidate?.telegramId) {
                flow.append(element('p', `Telegram ID: ${candidate.telegramId}${candidate.username ? ` · @${candidate.username}` : ''}. Перевірте, що це ваш акаунт.`));
                button('Це мій Telegram — підключити', async () => {
                    await request('/link/confirm', { requestId: state.requestId, browserProof: state.browserProof });
                    pending.delete(userId);
                    await refresh();
                    status.textContent = 'Telegram підтверджено. У боті доступні ваші задачі CRM.';
                    heading.focus();
                }, flow);
            } else {
                const url = new URL(state.url);
                if (url.origin !== 'https://t.me') throw new Error('Недійсне посилання Telegram.');
                flow.append(element('p', '1. Відкрийте посилання й натисніть Start. 2. Поверніться сюди та перевірте підключення. Посилання діє 10 хвилин.'));
                flow.append(element('a', 'Відкрити Telegram', { href: url.href, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' }));
            }
            button('Перевірити підключення', async () => {
                const data = await request('/link/status', { requestId: state.requestId, browserProof: state.browserProof });
                if (currentUserId() !== userId) return;
                showPending(data);
                status.textContent = data.telegramId ? 'Telegram знайдено. Підтвердьте акаунт нижче.' : 'Очікуємо натискання Start у Telegram.';
            }, flow);
            title.focus();
        }
        async function refresh() {
            const data = await request();
            if (currentUserId() !== userId || !root.isConnected) return;
            binding = data;
            info.replaceChildren(); actions.replaceChildren(); flow.replaceChildren();
            const labels = { connected: 'Підтверджено', preassigned: 'Попередньо внесено — потрібне підтвердження', disconnected: 'Не підключено' };
            info.append(element('p', labels[data.status] || 'Не підключено'));
            const id = data.telegramId || data.proposedTelegramId;
            if (id) {
                const label = element('label', data.telegramId ? 'Telegram ID' : 'Попередньо внесений Telegram ID', { for: 'telegramCrmId' });
                const field = element('input', '', { id: 'telegramCrmId', readonly: '', type: 'text' });
                field.value = id;
                info.append(label, field);
                button('Копіювати Telegram ID', async () => {
                    try { await navigator.clipboard.writeText(id); status.textContent = 'Telegram ID скопійовано.'; }
                    catch { field.focus(); field.select(); status.textContent = 'ID виділено. Скопіюйте його через меню або Ctrl+C.'; }
                }, info);
            }
            if (data.username) info.append(element('p', `@${data.username}`));
            if (!data.pilotEnabled) info.append(element('p', 'Підключення CRM через бота поки доступне учасникам пілоту.'));
            else if (data.mode === 'off') info.append(element('p', 'Пілот тимчасово вимкнений. CRM працює як звичайно.'));
            else button(data.telegramId ? 'Змінити Telegram' : 'Підключити Telegram', () => passwordForm(false));
            if (data.telegramId || data.proposedTelegramId) button('Від’єднати Telegram', () => passwordForm(true));
            button('Оновити стан', refresh);
            if (pending.has(userId)) showPending();
        }
        await run(refresh);
        // A failed initial fetch must remain recoverable without reloading the page.
        if (!binding) button('Оновити стан', refresh);
    }

    async function offer() {
        const userId = currentUserId();
        if (!userId || document.querySelector('[data-telegram-crm-profile]')) return;
        const key = `telegram-crm-offer:${userId}`;
        try {
            if (localStorage.getItem(key) || sessionStorage.getItem(key)) return;
            sessionStorage.setItem(key, 'checked');
            const data = await request();
            if (currentUserId() !== userId || !data.pilotEnabled || data.mode === 'off' || data.status === 'connected') return;
            const host = document.querySelector('main') || document.querySelector('#mainApp');
            if (!host) return;
            const banner = element('section', '', { class: 'telegram-crm-offer' });
            banner.append(element('h2', 'Ваші задачі в Telegram'), element('p', 'За бажанням підключіть Telegram у профілі. Цей крок можна пропустити — CRM працюватиме як звичайно.'));
            banner.append(element('a', 'Підключити Telegram у профілі', { href: '/profile?tab=settings#telegram-crm' }));
            const later = element('button', 'Поки пропустити', { type: 'button' });
            later.addEventListener('click', () => { localStorage.setItem(key, 'dismissed'); banner.remove(); });
            banner.append(later); host.prepend(banner);
        } catch { /* Optional onboarding never blocks login or exposes technical errors. */ }
    }
    global.TelegramCrmProfile = { mount, offer };
})(window);
