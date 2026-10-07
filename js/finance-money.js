/* Manual account movement UI. Transport, permissions and business scope belong to finance-page.js. */
(function (global) {
    'use strict';

    const BASE = '/api/finance/manual-money';
    const STORAGE_KEY = 'finance.manualMoney.pending.v1';
    const MAX_MINOR = 9223372036854775807n;
    const TITLES = {
        enroll: 'Почати облік рахунку', open_shift: 'Відкрити ручну зміну', close_shift: 'Закрити ручну зміну',
        income: 'Надходження', expense: 'Витрата', booking_receipt: 'Оплата бронювання',
        transfer: 'Переказ між касами', refund: 'Повернення оплати', reverse: 'Сторнувати операцію'
    };
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

    function parseMoney(value, allowZero = false) {
        const match = String(value ?? '').trim().match(/^(\d+)(?:[.,](\d{1,2}))?$/);
        if (!match) throw new Error('Вкажіть суму у гривнях, не більше двох цифр після коми.');
        const amount = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
        if ((!allowZero && amount === 0n) || amount > MAX_MINOR) throw new Error('Сума має бути додатною та в межах доступного обліку.');
        return amount.toString();
    }

    function formatMinor(value) {
        if (value === null || value === undefined || !/^-?\d+$/.test(String(value))) return 'Недоступно';
        const amount = BigInt(value);
        const absolute = amount < 0n ? -amount : amount;
        const major = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        return `${amount < 0n ? '−' : ''}${major},${(absolute % 100n).toString().padStart(2, '0')} ₴`;
    }

    function mount(options) {
        const { container, apiRequest, canManage, getBusinessKey, getCategories = () => [], onCreateAccount, onCreateCategory } = options;
        if (!container || typeof apiRequest !== 'function' || typeof getBusinessKey !== 'function') throw new Error('Manual money workspace requires a container, transport and scope.');
        let storage;
        try { storage = options.storage === undefined ? global.sessionStorage : options.storage; } catch (_) { storage = null; }
        const state = { scope: null, data: null, busy: false, loading: false, pending: null, booking: null, bookingRef: '', generation: 0, bookingGeneration: 0, disposed: false, storageFailed: false, qaVerified: false };
        const memory = new Map();
        // Public context separates retry identities; only the server authorizes QA access.
        const qaContext = () => global.FINANCE_QA_CONTEXT || null;
        const key = () => {
            const base = String(getBusinessKey() ?? '');
            const qa = qaContext();
            return qa ? JSON.stringify([base, 'finance-qa', String(qa.runId || ''), String(qa.actorId || ''), String(qa.businessContext || ''), String(qa.expiresAt || '')]) : base;
        };
        const qaCurrent = () => !qaContext() || (state.qaVerified && Date.parse(qaContext().expiresAt) > Date.now());
        const allowed = () => qaCurrent() && Boolean(typeof canManage === 'function' ? canManage() : canManage);
        const el = id => container.querySelector(`#${id}`);
        const setText = (id, value) => { el(id).textContent = value || ''; };
        const currentAccount = () => state.data?.accounts?.find(account => String(account.id) === el('fmAccount').value);
        const isCurrent = scope => !state.disposed && scope === key() && scope === state.scope;
        const date = value => {
            if (!value) return 'Дата недоступна';
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? 'Дата недоступна' : parsed.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
        };

        container.classList.add('fm-workspace');
        container.innerHTML = `
            <section class="fm-card" aria-labelledby="fmTitle">
                <h3 id="fmTitle">Ручні каси та фактичні кошти</h3>
                <p class="fm-note">Тут враховуються лише операції підключених ручних рахунків. Бронювання саме по собі не є оплатою. Checkbox, зарплати та банкетні депозити ведуться окремо; цей залишок не є загальними коштами компанії або прибутком.</p>
                <p id="fmQaNotice" class="fm-note" role="status" hidden></p>
                <div class="fm-toolbar">
                    <label>Рахунок<select id="fmAccount"><option value="">Оберіть рахунок</option></select></label>
                    <button type="button" id="fmCreateAccount" class="btn-page-secondary">+ Новий рахунок</button>
                    <button type="button" id="fmRefresh" class="btn-page-secondary">Оновити</button>
                </div>
                <p id="fmLoadStatus" class="fm-note" role="status" aria-live="polite"></p>
                <div id="fmAccountSummary" class="fm-summary"></div>
                <p id="fmAccountNote" class="fm-note"></p>
                <p id="fmAvailability" class="fm-note"></p>
            </section>
            <section id="fmEditor" class="fm-card" aria-labelledby="fmActionHeading" hidden>
                <h3 id="fmActionHeading">Операція з рахунком</h3>
                <form id="fmForm" novalidate>
                    <div class="fm-grid">
                        <label class="fm-full">Дія<select id="fmAction"></select></label>
                        <div id="fmCategoryField" class="fm-full" hidden><label for="fmCategory">Категорія</label><div class="fm-category-control"><select id="fmCategory"></select><button type="button" id="fmCreateCategory" class="btn-page-secondary">+ Категорія</button></div></div>
                        <label id="fmToAccountField" class="fm-full" hidden>На рахунок<select id="fmToAccount"></select></label>
                        <div id="fmBookingField" class="fm-full" hidden><label>Номер бронювання<input id="fmBookingRef" maxlength="80" autocomplete="off" placeholder="Номер із бронювання"></label><div class="fm-actions"><button type="button" id="fmFindBooking" class="btn-page-secondary">Перевірити бронювання</button></div><p id="fmBookingSummary" class="fm-note" role="status" aria-live="polite"></p></div>
                        <label id="fmOriginalField" class="fm-full" hidden>Початкова операція<select id="fmOriginal"></select></label>
                        <label id="fmAmountField" hidden><span id="fmAmountLabel">Сума, ₴</span><input id="fmAmount" inputmode="decimal" autocomplete="off" maxlength="24" placeholder="0,00"></label>
                        <label id="fmDescriptionField" hidden>Опис<input id="fmDescription" maxlength="500" autocomplete="off"></label>
                        <label id="fmReasonField" class="fm-full" hidden>Причина / пояснення<textarea id="fmReason" rows="2" maxlength="500"></textarea></label>
                    </div>
                    <p id="fmActionNote" class="fm-note"></p>
                    <p id="fmCommandError" class="fm-error" role="alert"></p>
                    <p id="fmCommandStatus" class="fm-status" role="status" aria-live="polite"></p>
                    <div class="fm-actions"><button type="submit" id="fmSubmit" class="btn-page-primary">Підтвердити</button></div>
                </form>
            </section>
            <section id="fmPendingBox" class="fm-card" hidden aria-labelledby="fmPendingTitle"><h3 id="fmPendingTitle">Перевірте результат попередньої операції</h3><p id="fmPendingDescription" class="fm-note"></p><p class="fm-note">Результат не підтверджено. Не створюйте цю оплату повторно. Кнопка нижче повторить ту саму команду без дублювання.</p><button type="button" id="fmRetry" class="btn-page-primary">Повторити перевірку</button><p id="fmRetryError" class="fm-error" role="alert"></p></section>
            <section class="fm-card"><h3>Історія ручних операцій</h3><p id="fmHistoryNote" class="fm-note"></p><ul id="fmHistory" class="fm-history"></ul></section>
            <section class="fm-card"><h3>Ручні зміни вибраної каси</h3><ul id="fmShifts" class="fm-history"></ul></section>`;

        function persistPending(value) {
            state.pending = value;
            if (value) memory.set(state.scope, value); else memory.delete(state.scope);
            if (!storage) { state.storageFailed = true; return; }
            try {
                const saved = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
                if (value) saved[state.scope] = value; else delete saved[state.scope];
                storage.setItem(STORAGE_KEY, JSON.stringify(saved));
                state.storageFailed = false;
            } catch (_) { state.storageFailed = true; }
        }

        function readPending() {
            let saved = memory.get(state.scope) || null;
            try {
                const candidate = JSON.parse(storage?.getItem(STORAGE_KEY) || '{}')[state.scope];
                if (candidate?.idempotencyKey && TITLES[candidate.command]) saved = candidate;
            } catch (_) { state.storageFailed = true; }
            return saved;
        }

        function retirePending(scope) {
            memory.delete(scope);
            try {
                const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || '{}');
                delete saved[scope];
                storage?.setItem(STORAGE_KEY, JSON.stringify(saved));
            } catch (_) { state.storageFailed = true; }
            if (state.scope === scope) state.pending = null;
        }

        function fillSelect(id, rows, selected, label, prompt) {
            const select = el(id);
            select.innerHTML = `<option value="">${esc(prompt)}</option>` + rows.map(row => `<option value="${esc(row.id)}">${esc(label(row))}</option>`).join('');
            select.value = rows.some(row => String(row.id) === String(selected)) ? String(selected) : '';
        }

        function refreshCategories() {
            const select = el('fmCategory');
            const value = select.value;
            const type = el('fmAction').value;
            const rows = getCategories().filter(row => row.type === type && row.isActive !== false && row.is_active !== false && !row.isSystem && !row.is_system);
            fillSelect('fmCategory', rows, value, row => `${row.icon || ''} ${row.name}`, 'Оберіть категорію');
        }

        function renderAccount() {
            const account = currentAccount();
            el('fmAccountSummary').innerHTML = '';
            setText('fmAccountNote', '');
            if (account) {
                if (account.enrolled) {
                    el('fmAccountSummary').innerHTML = `<div><span>Залишок цього рахунку</span><strong>${esc(formatMinor(account.balanceMinor))}</strong></div><div><span>${account.type === 'cash' ? 'Ручна зміна' : 'Тип рахунку'}</span><strong>${account.type === 'cash' ? (account.openShift ? 'Відкрита' : 'Закрита') : esc({ bank: 'Банк', card: 'Картка' }[account.type] || 'Рахунок')}</strong></div>`;
                    setText('fmAccountNote', `Облік від ${date(account.cutoffAt)}. Початковий залишок ${formatMinor(account.openingMinor)} не є доходом.${account.blockedReason ? ` ${account.blockedReason}` : ''}`);
                } else setText('fmAccountNote', account.blockedReason || 'Рахунок ще не підключено. Підтвердьте фактичний початковий залишок; минулі операції автоматично не переносяться.');
            }
            const previous = el('fmAction').value;
            let actions = [];
            if (account?.eligible) {
                if (!account.enrolled) actions = ['enroll'];
                else if (account.type === 'cash' && !account.openShift) actions = ['open_shift'];
                else actions = ['income', 'expense', 'booking_receipt', ...(account.type === 'cash' ? ['transfer'] : []), 'refund', 'reverse', ...(account.type === 'cash' ? ['close_shift'] : [])];
            }
            el('fmAction').innerHTML = actions.map(action => `<option value="${action}">${TITLES[action]}</option>`).join('');
            el('fmAction').value = actions.includes(previous) ? previous : actions[0] || '';
            fillSelect('fmToAccount', (state.data?.accounts || []).filter(row => row.enrolled && row.eligible && row.type === 'cash' && row.openShift && String(row.id) !== String(account?.id)), el('fmToAccount').value, row => `${row.emoji || ''} ${row.name}`, 'Оберіть іншу відкриту касу');
            renderAction();
            renderHistory();
            updateControls();
        }

        function renderAction() {
            const action = el('fmAction').value;
            const show = (id, enabled) => { el(id).hidden = !enabled; };
            show('fmCategoryField', action === 'income' || action === 'expense');
            show('fmToAccountField', action === 'transfer');
            show('fmBookingField', action === 'booking_receipt');
            show('fmOriginalField', action === 'refund' || action === 'reverse');
            show('fmAmountField', Boolean(action) && !['open_shift', 'reverse'].includes(action));
            show('fmDescriptionField', action === 'income' || action === 'expense');
            show('fmReasonField', ['enroll', 'close_shift', 'transfer', 'refund', 'reverse'].includes(action));
            setText('fmAmountLabel', action === 'enroll' ? 'Початковий залишок, ₴' : action === 'close_shift' ? 'Фактично перерахована готівка, ₴' : 'Сума, ₴');
            setText('fmSubmit', TITLES[action] || 'Підтвердити');
            const notes = {
                enroll: 'Один підтверджений початковий залишок. Нуль допустимий. Це не новий дохід.',
                open_shift: 'Зміна відкривається лише для вибраної ручної каси. Початковий залишок повторно не додається.',
                close_shift: `Очікувана готівка: ${formatMinor(currentAccount()?.openShift?.expectedMinor)}. Різниця буде записана як звірка, без прихованої зміни залишку.`,
                transfer: 'Обидві каси мають бути відкриті. Переказ не створює доходу чи витрати.',
                refund: 'Повернення прив’язується до отриманої оплати та того самого рахунку. Сервер перевіряє доступну суму.',
                reverse: 'Сторно збереже оригінальну операцію та додасть пов’язану корекцію з вашою причиною. Операцію з уже виконаним поверненням сторнувати не можна.',
                booking_receipt: 'Спочатку перевірте бронювання. Часткова оплата зменшить борг лише в ручному обліку; старі платіжні поля автоматично не переписуються.'
            };
            setText('fmActionNote', notes[action] || 'Записуйте лише фактично отримані або видані кошти.');
            refreshCategories();
            const accountId = String(currentAccount()?.id || '');
            const originals = (state.data?.operations || []).filter(operation => operation.legs?.some(leg => String(leg.accountId) === accountId) && (action === 'refund' ? ['income', 'booking_receipt'].includes(operation.command) : ['income', 'expense', 'booking_receipt', 'transfer'].includes(operation.command)));
            fillSelect('fmOriginal', originals, el('fmOriginal').value, operation => `${date(operation.effectiveAt)} · ${TITLES[operation.command] || 'Операція'} · ${formatMinor(operation.amountMinor)}${operation.description ? ` · ${operation.description}` : ''}`, 'Оберіть операцію з історії');
        }

        function renderHistory() {
            const account = currentAccount();
            const operations = (state.data?.operations || []).filter(operation => !account || operation.legs?.some(leg => String(leg.accountId) === String(account.id)));
            setText('fmHistoryNote', state.data ? `${account ? 'Для вибраного рахунку.' : 'Для підключених ручних рахунків.'}${state.data.hasMoreOperations ? ' Показано останню частину історії; це не повний оборот за весь час.' : ''}` : 'Історія недоступна.');
            const names = new Map((state.data?.accounts || []).map(row => [String(row.id), row.name]));
            el('fmHistory').innerHTML = operations.length ? operations.map(operation => `<li><div class="fm-history-heading"><span>${esc(TITLES[operation.command] || 'Операція')}</span><span>${operation.amountMinor === null ? '' : esc(formatMinor(operation.amountMinor))}</span></div><time>${esc(date(operation.effectiveAt))}</time>${operation.description || operation.reason ? `<p class="fm-note">${esc(operation.description || operation.reason)}</p>` : ''}<p class="fm-note">${(operation.legs || []).map(leg => `${esc(names.get(String(leg.accountId)) || 'Рахунок')}: ${esc(formatMinor(leg.amountMinor))}`).join(' · ')}</p>${operation.originalId ? '<p class="fm-note">Корекція пов’язана з початковою операцією.</p>' : ''}</li>`).join('') : `<li>${state.data ? (state.data.hasMoreOperations ? 'У показаній частині історії немає операцій цього рахунку.' : 'Ручних операцій ще немає.') : 'Не вдалося отримати історію.'}</li>`;
            const shifts = (state.data?.shifts || []).filter(shift => account && String(shift.accountId) === String(account.id));
            const shiftsTruncated = account?.type === 'cash' && state.data?.hasMoreShifts;
            const shiftNote = shiftsTruncated ? '<li class="fm-note">Показано останню частину змін бізнесу; це не повна історія вибраної каси.</li>' : '';
            el('fmShifts').innerHTML = shiftNote + (shifts.length ? shifts.map(shift => `<li><div class="fm-history-heading"><span>${shift.status === 'open' ? 'Відкрита зміна' : 'Закрита зміна'}</span><time>${esc(date(shift.openedAt))}</time></div><p class="fm-note">Початок: ${esc(formatMinor(shift.openingMinor))} · Очікувано: ${esc(formatMinor(shift.expectedMinor))}${shift.closedAt ? ` · Фактично: ${esc(formatMinor(shift.actualMinor))} · Різниця: ${esc(formatMinor(shift.differenceMinor))}` : ''}</p>${shift.reason ? `<p class="fm-note">${esc(shift.reason)}</p>` : ''}</li>`).join('') : `<li>${account?.type === 'cash' ? (shiftsTruncated ? 'У показаній частині історії немає змін цієї каси.' : 'Ручних змін цієї каси ще немає.') : 'Оберіть ручну готівкову касу.'}</li>`);
        }

        function updateControls() {
            const writable = allowed() && Boolean(state.data) && state.data.available !== false;
            // A read outage must not prevent checking a previously submitted command.
            const canRetry = allowed() && state.data?.available !== false;
            const locked = state.busy || Boolean(state.pending);
            el('fmCreateAccount').hidden = !writable || typeof onCreateAccount !== 'function';
            el('fmCreateAccount').disabled = locked || state.loading;
            el('fmAccount').disabled = locked || state.loading;
            el('fmRefresh').disabled = state.busy || state.loading;
            el('fmEditor').hidden = !writable || !currentAccount()?.eligible || !el('fmAction').value || Boolean(state.pending);
            container.querySelectorAll('#fmForm input, #fmForm select, #fmForm textarea, #fmForm button').forEach(control => { control.disabled = locked || state.loading || !writable; });
            el('fmCreateCategory').hidden = !writable || typeof onCreateCategory !== 'function';
            el('fmPendingBox').hidden = !state.pending;
            el('fmRetry').disabled = !canRetry || state.busy || state.loading;
            if (state.pending) {
                const account = state.data?.accounts?.find(row => String(row.id) === String(state.pending.accountId));
                setText('fmPendingDescription', `${TITLES[state.pending.command]}${account ? ` · ${account.name}` : ''}${state.pending.amountMinor ? ` · ${formatMinor(state.pending.amountMinor)}` : ''}.${state.storageFailed ? ' Не закривайте вкладку: браузер не зміг зберегти ключ повтору.' : ''}`);
            }
        }

        async function refresh() {
            if (state.disposed) return;
            const scope = key();
            if (state.busy && state.scope === scope) return;
            if (state.scope !== scope) {
                state.scope = scope;
                state.data = null;
                state.qaVerified = false;
                state.booking = null;
                state.bookingRef = '';
                state.pending = readPending();
                el('fmForm').reset();
                setText('fmBookingSummary', '');
                setText('fmCommandError', '');
                setText('fmCommandStatus', '');
                setText('fmRetryError', '');
                fillSelect('fmAccount', [], '', row => row.name, 'Оберіть рахунок');
                renderAccount();
            }
            const generation = ++state.generation;
            state.loading = true;
            setText('fmLoadStatus', 'Завантаження ручного обліку…');
            updateControls();
            try {
                const data = await apiRequest('GET', BASE);
                if (!isCurrent(scope) || generation !== state.generation) return;
                if (!data || data.success === false || (data.available !== false && !Array.isArray(data.accounts))) throw new Error(data?.error || 'Дані ручного обліку недоступні.');
                const expectedQa = qaContext();
                if (expectedQa || data.qa) {
                    const actualQa = data.qa;
                    state.qaVerified = Boolean(expectedQa && actualQa
                        && typeof expectedQa.runId === 'string' && expectedQa.runId.length > 0
                        && actualQa.runId === expectedQa.runId
                        && Number.isSafeInteger(expectedQa.actorId) && expectedQa.actorId > 0
                        && Number(actualQa.actorId) === expectedQa.actorId
                        && typeof expectedQa.businessContext === 'string' && expectedQa.businessContext.length > 0
                        && actualQa.businessContext === expectedQa.businessContext
                        && Number.isFinite(Date.parse(expectedQa.expiresAt))
                        && Date.parse(actualQa.expiresAt) === Date.parse(expectedQa.expiresAt)
                        && Date.parse(expectedQa.expiresAt) > Date.now());
                    if (!state.qaVerified) throw new Error('Тестовий запуск завершено або його контекст не збігається. Оновіть доступ до перевірки.');
                }
                state.data = data;
                fillSelect('fmAccount', data.accounts || [], state.pending?.accountId || el('fmAccount').value, account => `${account.emoji || ''} ${account.name}${account.enrolled ? '' : ' · не підключено'}`, 'Оберіть рахунок');
                setText('fmAvailability', data.available === false ? (data.reason || 'Ручний облік поки недоступний.') : (data.limitations || []).join(' '));
                setText('fmLoadStatus', data.available === false ? '' : data.accounts.length ? '' : 'Додайте рахунок, щоб почати окремий ручний облік.');
            } catch (error) {
                if (!isCurrent(scope) || generation !== state.generation) return;
                state.data = null;
                setText('fmLoadStatus', error.message || 'Не вдалося завантажити ручний облік.');
                setText('fmAvailability', 'Залишки недоступні. Спробуйте оновити; помилка не означає нульовий залишок.');
            } finally {
                if (isCurrent(scope) && generation === state.generation) {
                    el('fmQaNotice').hidden = !qaContext() && !state.data?.qa;
                    setText('fmQaNotice', state.qaVerified && qaCurrent()
                        ? 'Тестовий режим: лише записи поточного перевірочного запуску. Вони не входять до робочих фінансових підсумків.'
                        : 'Тестовий режим: доступ не підтверджено або строк перевірки минув. Нові операції недоступні.');
                    state.loading = false;
                    renderAccount();
                }
            }
        }

        async function findBooking() {
            if (state.busy || state.pending) return;
            const scope = state.scope;
            if (!isCurrent(scope)) { await refresh(); return; }
            const reference = el('fmBookingRef').value.trim();
            state.booking = null;
            state.bookingRef = '';
            const generation = ++state.bookingGeneration;
            if (!reference) { setText('fmBookingSummary', 'Вкажіть номер бронювання.'); return; }
            el('fmFindBooking').disabled = true;
            setText('fmBookingSummary', 'Перевірка бронювання…');
            try {
                const response = await apiRequest('GET', `${BASE}/bookings/${encodeURIComponent(reference)}`);
                if (!isCurrent(scope) || generation !== state.bookingGeneration || reference !== el('fmBookingRef').value.trim()) return;
                const booking = response?.booking || response?.bookingSummary || response;
                if (!booking?.bookingId || booking.remainingMinor == null) throw new Error(response?.error || 'Дані бронювання недоступні.');
                state.booking = booking;
                state.bookingRef = reference;
                setText('fmBookingSummary', `${booking.label || 'Бронювання'}. Вартість: ${formatMinor(booking.totalMinor)}. Отримано вручну: ${formatMinor(booking.paidMinor)}. Залишок до сплати: ${formatMinor(booking.remainingMinor)}.${booking.legacyPaidMinor && BigInt(booking.legacyPaidMinor) !== 0n ? ` Старе платіжне поле: ${formatMinor(booking.legacyPaidMinor)}; це окреме джерело.` : ''}${booking.eligible ? '' : ` ${booking.blockedReason || 'Бронювання недоступне для ручної оплати.'}`}`);
            } catch (error) {
                if (isCurrent(scope) && generation === state.bookingGeneration) setText('fmBookingSummary', error.message || 'Не вдалося перевірити бронювання.');
            } finally {
                if (isCurrent(scope) && generation === state.bookingGeneration) updateControls();
            }
        }

        function buildCommand() {
            const account = currentAccount();
            if (!account?.eligible) throw new Error('Оберіть доступний рахунок.');
            const command = el('fmAction').value;
            const body = { command, accountId: account.id };
            if (!TITLES[command]) throw new Error('Оберіть дію.');
            if (!['enroll', 'open_shift'].includes(command) && (!account.enrolled || (account.type === 'cash' && !account.openShift))) throw new Error('Для операції потрібна відкрита ручна зміна.');
            if (!['open_shift', 'reverse'].includes(command)) {
                const amount = parseMoney(el('fmAmount').value, ['enroll', 'close_shift'].includes(command));
                body[command === 'enroll' ? 'openingMinor' : command === 'close_shift' ? 'actualMinor' : 'amountMinor'] = amount;
            }
            if (command === 'close_shift') body.shiftId = account.openShift.id;
            if (['enroll', 'close_shift', 'transfer', 'refund', 'reverse'].includes(command)) {
                body.reason = el('fmReason').value.trim();
                if (!body.reason) throw new Error('Додайте причину або пояснення.');
            }
            if (command === 'income' || command === 'expense') {
                const category = getCategories().find(row => String(row.id) === el('fmCategory').value && row.type === command && row.isActive !== false && row.is_active !== false && !row.isSystem && !row.is_system);
                if (!category) throw new Error('Оберіть активну категорію.');
                body.categoryId = category.id;
                body.description = el('fmDescription').value.trim();
            }
            if (command === 'transfer') {
                const destination = state.data.accounts.find(row => String(row.id) === el('fmToAccount').value && String(row.id) !== String(account.id) && row.enrolled && row.eligible && row.type === 'cash' && row.openShift);
                if (!destination) throw new Error('Оберіть іншу відкриту ручну касу.');
                body.toAccountId = destination.id;
            }
            if (command === 'booking_receipt') {
                if (!state.booking?.eligible || state.bookingRef !== el('fmBookingRef').value.trim()) throw new Error('Спочатку перевірте доступне бронювання.');
                if (BigInt(body.amountMinor) > BigInt(state.booking.remainingMinor)) throw new Error('Сума перевищує залишок до сплати.');
                body.bookingId = state.booking.bookingId;
            }
            if (command === 'refund' || command === 'reverse') {
                const original = (state.data.operations || []).find(row => String(row.id) === el('fmOriginal').value && row.legs?.some(leg => String(leg.accountId) === String(account.id)));
                if (!original) throw new Error('Оберіть початкову операцію.');
                body.originalId = original.id;
                delete body.accountId;
            }
            return body;
        }

        async function submit(event) {
            event?.preventDefault();
            if (state.busy || state.loading || state.pending) return;
            if (!allowed()) { setText('fmCommandError', 'Немає дозволу керувати фінансами.'); return; }
            if (!isCurrent(state.scope)) { await refresh(); return; }
            setText('fmCommandError', '');
            setText('fmCommandStatus', '');
            try {
                const body = buildCommand();
                if (!global.crypto?.randomUUID) throw new Error('Браузер не підтримує безпечний ключ операції. Оновіть браузер.');
                body.idempotencyKey = global.crypto.randomUUID();
                persistPending(body);
                await sendPending();
            } catch (error) { setText('fmCommandError', error.message || 'Перевірте дані операції.'); }
        }

        async function sendPending() {
            if (state.busy || !state.pending || !allowed() || state.data?.available === false) return;
            if (!isCurrent(state.scope)) { await refresh(); return; }
            const scope = state.scope;
            const body = state.pending;
            state.busy = true;
            setText('fmRetryError', '');
            updateControls();
            let confirmed = false;
            try {
                const result = await apiRequest('POST', `${BASE}/commands`, body);
                if (!result?.success) throw new Error(result?.error || 'Сервер не підтвердив результат.');
                confirmed = true;
                // Retire the original scope's retry identity even if the user changed scope during the request.
                retirePending(scope);
                if (!isCurrent(scope)) return;
                el('fmAmount').value = '';
                el('fmDescription').value = '';
                el('fmReason').value = '';
                state.booking = null;
                state.bookingRef = '';
                setText('fmBookingSummary', result.bookingSummary ? `Оплату підтверджено. Залишок до сплати: ${formatMinor(result.bookingSummary.remainingMinor)}.` : '');
                setText('fmCommandStatus', result.replayed ? 'Операція вже була записана. Дубль не створено.' : 'Операцію підтверджено.');
            } catch (error) {
                if (error.status === 401 || error.status === 403) {
                    if (isCurrent(scope)) setText('fmRetryError', 'Доступ до перевірки операції недоступний. Її попередній результат невідомий; ключ збережено. Відновіть доступ і повторіть перевірку цієї операції.');
                } else if (error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
                    retirePending(scope);
                    if (!isCurrent(scope)) return;
                    setText('fmCommandError', error.message || 'Операцію відхилено. Перевірте дані.');
                } else if (isCurrent(scope)) setText('fmRetryError', `${error.message || 'Зв’язок із сервером втрачено.'} Результат невідомий; повторіть перевірку цієї операції.`);
            } finally {
                state.busy = false;
                if (isCurrent(scope)) {
                    updateControls();
                    if (confirmed) await refresh();
                    else (state.pending ? el('fmRetry') : el('fmSubmit')).focus();
                } else await refresh();
            }
        }

        const handlers = {
            account: () => { state.booking = null; state.bookingRef = ''; setText('fmBookingSummary', ''); renderAccount(); },
            action: () => { el('fmAmount').value = ''; el('fmReason').value = ''; setText('fmCommandError', ''); setText('fmCommandStatus', ''); renderAction(); },
            bookingInput: () => { state.booking = null; state.bookingRef = ''; ++state.bookingGeneration; setText('fmBookingSummary', 'Перевірте номер перед оплатою.'); updateControls(); },
            category: () => { if (!state.busy && !state.loading && !state.pending && state.data && state.data.available !== false && allowed() && isCurrent(state.scope)) onCreateCategory?.({ targetId: 'fmCategory', type: el('fmAction').value }); },
            accountCreate: () => { if (!state.busy && !state.loading && !state.pending && state.data && state.data.available !== false && allowed() && isCurrent(state.scope)) onCreateAccount?.(); },
            categories: () => { if (isCurrent(state.scope)) refreshCategories(); },
            accounts: () => { if (!state.busy) refresh(); },
            beforeUnload: event => { if (state.pending || memory.size) { event.preventDefault(); event.returnValue = ''; } }
        };
        el('fmAccount').addEventListener('change', handlers.account);
        el('fmAction').addEventListener('change', handlers.action);
        el('fmBookingRef').addEventListener('input', handlers.bookingInput);
        el('fmCreateCategory').addEventListener('click', handlers.category);
        el('fmCreateAccount').addEventListener('click', handlers.accountCreate);
        el('fmRefresh').addEventListener('click', refresh);
        el('fmFindBooking').addEventListener('click', findBooking);
        el('fmForm').addEventListener('submit', submit);
        el('fmRetry').addEventListener('click', sendPending);
        global.addEventListener('finance:categories-updated', handlers.categories);
        global.addEventListener('finance:accounts-updated', handlers.accounts);
        global.addEventListener('beforeunload', handlers.beforeUnload);
        const ready = refresh();
        return {
            ready, refresh,
            destroy() {
                state.disposed = true;
                global.removeEventListener('finance:categories-updated', handlers.categories);
                global.removeEventListener('finance:accounts-updated', handlers.accounts);
                global.removeEventListener('beforeunload', handlers.beforeUnload);
                container.replaceChildren();
            }
        };
    }

    global.FinanceMoneyWorkspace = { mount, parseMoney, formatMinor };
})(window);
