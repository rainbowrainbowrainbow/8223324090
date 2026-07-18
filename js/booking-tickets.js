/**
 * Canonical booking ticket UI.
 * Prices and remainder quantities always come from POST /api/bookings/ticket-quote.
 */
const BookingTickets = (() => {
    const manualFields = Object.freeze({
        birthday_child: 'ticketBirthdayChildQuantity',
        under_3_child: 'ticketUnder3ChildQuantity',
        discounted_child: 'ticketDiscountedChildQuantity',
        adult_game: 'ticketAdultGameQuantity'
    });
    const state = {
        active: false,
        mode: 'new',
        status: 'idle',
        quote: null,
        baselineSubtotal: null,
        comparisonSubtotal: null,
        legacySubtotal: null,
        error: null,
        conversionPreview: false,
        conversionConfirmed: false,
        priceChangePending: false,
        timer: null
    };

    function money(value) {
        const number = Number(value || 0);
        return `${number.toLocaleString('uk-UA', { maximumFractionDigits: 2 })} грн`;
    }

    function bookingDate() {
        if (typeof formatDate === 'function' && window.AppState?.selectedDate) {
            return formatDate(window.AppState.selectedDate);
        }
        const date = window.AppState?.selectedDate instanceof Date
            ? window.AppState.selectedDate
            : new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function roomResourceId() {
        const select = document.getElementById('roomSelect');
        const option = select?.selectedOptions?.[0];
        if (String(select?.value || '').trim().toLowerCase() === 'takeaway') return 'room-takeaway';
        return String(option?.dataset?.resourceId || '').trim();
    }

    function readCount(id, { allowBlank = false } = {}) {
        const raw = String(document.getElementById(id)?.value ?? '').trim();
        if (!raw && allowBlank) return null;
        const value = Number(raw || 0);
        return Number.isInteger(value) && value >= 0 ? value : NaN;
    }

    function manualQuantities() {
        return Object.entries(manualFields).map(([code, id]) => ({
            code,
            quantity: readCount(id)
        }));
    }

    function snapshotPackage(booking = {}) {
        const extra = booking.extraData || booking.extra_data || {};
        return booking.bookingPackage
            || booking.booking_package
            || extra.bookingPackage
            || extra.booking_package
            || null;
    }

    function packageTicketLines(booking = {}) {
        const pkg = snapshotPackage(booking) || {};
        const lines = pkg.ticketLines || pkg.ticket_lines;
        return Array.isArray(lines) ? lines : [];
    }

    function legacyEntrySubtotal(booking = {}) {
        const pkg = snapshotPackage(booking) || {};
        const entry = pkg.entryCharge || pkg.entry_charge || {};
        const raw = pkg.entrySubtotal ?? pkg.entry_subtotal ?? entry.subtotal;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
    }

    function quoteFromPackage(booking = {}) {
        const pkg = snapshotPackage(booking) || {};
        const ticketLines = packageTicketLines(booking);
        if (!ticketLines.length) return null;
        return {
            ticketLines,
            ticketSubtotal: Number(pkg.ticketSubtotal ?? pkg.ticket_subtotal ?? pkg.entrySubtotal ?? 0),
            admissionContext: pkg.ticketPricingContext || pkg.ticket_pricing_context || ticketLines[0]?.admissionContext,
            dayType: pkg.ticketDayType || pkg.ticket_day_type || ticketLines[0]?.dayType,
            pricingDate: pkg.ticketPricingDate || pkg.ticket_pricing_date || booking.date,
            pricedAt: pkg.ticketPricedAt || pkg.ticket_priced_at || null,
            currency: 'UAH'
        };
    }

    function setManualValuesFromLines(lines = []) {
        const byCode = new Map(lines.map(line => [
            line.ticketTypeCode || line.ticket_type_code,
            Number(line.quantity || 0)
        ]));
        Object.entries(manualFields).forEach(([code, id]) => {
            const input = document.getElementById(id);
            if (input) input.value = String(byCode.get(code) || 0);
        });
    }

    function setManualDisabled(disabled) {
        Object.values(manualFields).forEach(id => {
            const input = document.getElementById(id);
            if (input) input.disabled = disabled;
        });
    }

    function lineCode(line = {}) {
        return line.ticketTypeCode || line.ticket_type_code || '';
    }

    function lineName(line = {}) {
        return line.ticketTypeName || line.ticket_type_name || lineCode(line);
    }

    function lineValue(line = {}, camel, snake) {
        return line[camel] ?? line[snake];
    }

    function render() {
        const section = document.getElementById('bookingTicketsSection');
        if (!section) return;
        section.classList.toggle('hidden', !state.active);
        const legacy = document.getElementById('bookingTicketsLegacyBanner');
        const isLegacy = state.mode === 'legacy' && !state.conversionConfirmed;
        legacy?.classList.toggle('hidden', !isLegacy);
        const legacyAmount = document.getElementById('bookingTicketsLegacyAmount');
        if (legacyAmount) legacyAmount.textContent = state.legacySubtotal === null
            ? 'Історична сума відображається без змін.'
            : `Стара сума: ${money(state.legacySubtotal)}.`;
        const convert = document.getElementById('bookingTicketsConvert');
        if (convert) {
            convert.textContent = state.conversionPreview && state.quote
                ? 'Підтвердити перехід на нові квитки'
                : 'Розрахувати перехід на нові квитки';
        }
        setManualDisabled(isLegacy && !state.conversionPreview);

        const status = document.getElementById('bookingTicketQuoteState');
        if (status) {
            status.classList.toggle('is-loading', state.status === 'loading');
            status.classList.toggle('is-error', state.status === 'error');
            status.textContent = state.status === 'loading'
                ? 'Сервер перераховує квитки…'
                : state.status === 'error'
                    ? (state.error?.message || 'Не вдалося розрахувати квитки.')
                    : state.quote
                        ? 'Серверний розрахунок актуальний.'
                        : isLegacy
                            ? 'Legacy-сума не зміниться без явного переходу.'
                            : 'Вкажіть кількість дітей і дорослих.';
        }

        const lines = Array.isArray(state.quote?.ticketLines) ? state.quote.ticketLines : [];
        const byCode = new Map(lines.map(line => [lineCode(line), line]));
        document.getElementById('ticketRegularChildQuantity').textContent = String(byCode.get('regular_child')?.quantity || 0);
        document.getElementById('ticketAdultCompanionQuantity').textContent = String(byCode.get('adult_companion')?.quantity || 0);
        const meta = document.getElementById('bookingTicketQuoteMeta');
        if (meta) {
            const day = state.quote?.dayType === 'weekend' ? 'вихідний' : 'будній день';
            const context = state.quote?.admissionContext === 'reserved_table_room'
                ? 'бронювання столика / кімнатки'
                : 'стандартний вхід';
            meta.textContent = state.quote ? `${day} · ${context} · дата ціни ${state.quote.pricingDate || bookingDate()}` : '';
        }
        const linesContainer = document.getElementById('bookingTicketQuoteLines');
        if (linesContainer) {
            linesContainer.innerHTML = lines
                .filter(line => Number(line.quantity || 0) > 0)
                .map(line => {
                    const audienceUnit = line.audience === 'adult' ? 'дорослих' : 'дітей';
                    return `<div class="booking-ticket-line">
                        <span>${escapeHtml(lineName(line))} <small>${Number(line.quantity)} ${audienceUnit} × ${escapeHtml(money(lineValue(line, 'unitPriceUah', 'unit_price_uah')))}</small></span>
                        <strong>${escapeHtml(money(lineValue(line, 'subtotalUah', 'subtotal_uah')))}</strong>
                    </div>`;
                }).join('');
        }
        const total = document.getElementById('bookingTicketQuoteTotal');
        if (total) {
            const subtotal = Number(state.quote?.ticketSubtotal || 0);
            const previousSubtotal = state.baselineSubtotal ?? state.comparisonSubtotal;
            const delta = previousSubtotal !== null && subtotal !== Number(previousSubtotal)
                ? `<small class="booking-ticket-delta">Було ${escapeHtml(money(previousSubtotal))}; різниця ${escapeHtml(money(subtotal - Number(previousSubtotal)))}</small>`
                : '';
            total.innerHTML = state.quote
                ? `<span>Квитки ${delta}</span><strong>${escapeHtml(money(subtotal))}</strong>`
                : '';
        }
        const sticky = document.getElementById('bookingTicketStickyError');
        if (sticky) {
            const message = state.priceChangePending
                ? 'Тариф змінився після preview. Перевірте нові суми та підтвердьте їх у секції квитків.'
                : (state.status === 'error' ? state.error?.message : '');
            sticky.innerHTML = state.priceChangePending
                ? `${escapeHtml(message)} <button type="button" id="bookingTicketAcceptPrice">Підтвердити нову ціну</button>`
                : escapeHtml(message || '');
            sticky.classList.toggle('hidden', !message);
        }
    }

    function quotePayload() {
        const guests = readCount('banquetGuests', { allowBlank: true });
        const adults = readCount('banquetAdults', { allowBlank: true });
        const resourceId = roomResourceId();
        if (guests === null || adults === null || !resourceId || !bookingDate()) return null;
        return {
            ...(window.AppState?.editingBookingId ? { bookingId: window.AppState.editingBookingId } : {}),
            date: bookingDate(),
            roomResourceId: resourceId,
            banquetGuests: guests,
            banquetAdults: adults,
            ticketQuantities: manualQuantities()
        };
    }

    async function quoteNow() {
        if (!state.active || (state.mode === 'legacy' && !state.conversionPreview && !state.conversionConfirmed)) {
            render();
            return null;
        }
        const payload = quotePayload();
        if (!payload) {
            state.status = 'idle';
            state.quote = null;
            state.error = null;
            render();
            window.renderBookingPackageSummary?.();
            return null;
        }
        if (payload.ticketQuantities.some(item => !Number.isInteger(item.quantity) || item.quantity < 0)) {
            state.status = 'error';
            state.error = { code: 'TICKET_QUANTITY_INVALID', message: 'Кількості квитків мають бути цілими числами від 0.' };
            render();
            window.renderBookingPackageSummary?.();
            return null;
        }
        state.status = 'loading';
        state.error = null;
        state.priceChangePending = false;
        render();
        window.renderBookingPackageSummary?.();
        const result = await apiQuoteAdmissionTickets(payload, {
            sequenceKey: `booking-ticket-quote:${window.AppState?.editingBookingId || 'new'}`
        });
        if (result?.stale || result?.aborted) return null;
        if (!result?.success) {
            state.status = 'error';
            state.quote = null;
            state.error = {
                code: result?.code || null,
                message: result?.error || 'Не вдалося розрахувати квитки.'
            };
            render();
            window.renderBookingPackageSummary?.();
            return result;
        }
        const serverQuote = result.quote || result;
        state.status = 'ready';
        state.quote = serverQuote;
        state.error = null;
        render();
        window.renderBookingPackageSummary?.();
        return serverQuote;
    }

    function scheduleQuote() {
        clearTimeout(state.timer);
        if (state.quote && state.baselineSubtotal === null) {
            state.comparisonSubtotal = Number(state.quote.ticketSubtotal || 0);
        }
        state.status = 'loading';
        state.quote = null;
        state.error = null;
        render();
        window.renderBookingPackageSummary?.();
        state.timer = setTimeout(() => void quoteNow(), 220);
    }

    function markDirtyAndScheduleQuote() {
        if (window.BookingForm) window.BookingForm._dirty = true;
        scheduleQuote();
    }

    function setActive(active) {
        const changed = state.active !== Boolean(active);
        state.active = Boolean(active);
        render();
        if (changed && state.active && state.mode !== 'legacy') scheduleQuote();
    }

    function reset() {
        clearTimeout(state.timer);
        state.mode = 'new';
        state.status = 'idle';
        state.quote = null;
        state.baselineSubtotal = null;
        state.comparisonSubtotal = null;
        state.legacySubtotal = null;
        state.error = null;
        state.conversionPreview = false;
        state.conversionConfirmed = false;
        state.priceChangePending = false;
        Object.values(manualFields).forEach(id => {
            const input = document.getElementById(id);
            if (input) input.value = '0';
        });
        render();
    }

    function hydrate(booking = {}) {
        clearTimeout(state.timer);
        const storedQuote = quoteFromPackage(booking);
        state.error = null;
        state.priceChangePending = false;
        state.conversionPreview = false;
        state.conversionConfirmed = false;
        if (storedQuote) {
            state.mode = 'v3';
            state.status = 'ready';
            state.quote = storedQuote;
            state.baselineSubtotal = Number(storedQuote.ticketSubtotal || 0);
            state.comparisonSubtotal = null;
            state.legacySubtotal = null;
            setManualValuesFromLines(storedQuote.ticketLines);
            render();
            scheduleQuote();
            return;
        }
        state.mode = 'legacy';
        state.status = 'idle';
        state.quote = null;
        state.legacySubtotal = legacyEntrySubtotal(booking);
        state.baselineSubtotal = state.legacySubtotal;
        state.comparisonSubtotal = null;
        setManualValuesFromLines([]);
        render();
    }

    function collect() {
        if (!state.active) return {};
        if (state.mode === 'legacy' && !state.conversionConfirmed) return {};
        return {
            ticketQuantities: manualQuantities(),
            ticketQuote: state.quote,
            convertLegacy: state.mode === 'legacy' && state.conversionConfirmed
        };
    }

    function validationIssue() {
        if (!state.active) return null;
        if (state.mode === 'legacy' && !state.conversionPreview && !state.conversionConfirmed) return null;
        if (state.mode === 'legacy' && state.conversionPreview && !state.conversionConfirmed) {
            return {
                key: 'ticket_conversion_confirmation',
                message: 'Перевірте різницю сум і підтвердьте перехід legacy-бронювання на нові квитки.',
                fields: ['bookingTicketsConvert']
            };
        }
        if (state.priceChangePending) {
            return {
                key: 'ticket_price_confirmation',
                message: 'Підтвердьте актуальний тариф після зміни ціни.',
                fields: ['bookingTicketsConvert']
            };
        }
        if (state.status === 'loading') {
            return { key: 'ticket_quote_loading', message: 'Дочекайтеся серверного розрахунку квитків.', fields: ['bookingTicketQuoteState'] };
        }
        if (state.status === 'error') {
            return { key: 'ticket_quote_error', message: state.error?.message || 'Виправте дані квитків.', fields: [manualFields.under_3_child] };
        }
        if (!state.quote) {
            return {
                key: 'ticket_quote_required',
                message: 'Вкажіть кількість дітей і дорослих та отримайте серверний розрахунок квитків.',
                fields: ['banquetGuests', 'banquetAdults']
            };
        }
        return null;
    }

    function getSubtotal() {
        if (state.mode === 'legacy' && !state.conversionConfirmed) return Number(state.legacySubtotal || 0);
        return Number(state.quote?.ticketSubtotal || 0);
    }

    function getQuote() {
        return state.quote;
    }

    function handleSaveConflict(result = {}) {
        if (!['TICKET_PRICE_CHANGED', 'TICKET_QUOTE_REQUIRED'].includes(result.code)) return false;
        const nextQuote = result.details?.quote;
        if (nextQuote) {
            state.quote = nextQuote;
            state.status = 'ready';
            state.error = null;
        }
        state.priceChangePending = true;
        render();
        window.renderBookingPackageSummary?.();
        document.getElementById('bookingTicketsSection')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
    }

    function confirmCurrentPrice() {
        state.priceChangePending = false;
        render();
        window.renderBookingPackageSummary?.();
    }

    function init() {
        Object.values(manualFields).forEach(id => {
            const input = document.getElementById(id);
            if (!input) return;
            input.addEventListener('input', markDirtyAndScheduleQuote);
            input.addEventListener('change', markDirtyAndScheduleQuote);
        });
        ['banquetGuests', 'banquetAdults', 'roomSelect'].forEach(id => {
            const input = document.getElementById(id);
            if (!input) return;
            input.addEventListener(id === 'roomSelect' ? 'change' : 'input', scheduleQuote);
        });
        document.getElementById('bookingTicketsConvert')?.addEventListener('click', () => {
            if (state.priceChangePending) {
                confirmCurrentPrice();
                return;
            }
            if (!state.conversionPreview) {
                state.conversionPreview = true;
                render();
                scheduleQuote();
                return;
            }
            if (state.quote) {
                state.conversionConfirmed = true;
                state.mode = 'v3';
                render();
                window.renderBookingPackageSummary?.();
            }
        });
        document.getElementById('bookingTicketStickyError')?.addEventListener('click', event => {
            if (!event.target.closest('#bookingTicketAcceptPrice')) return;
            confirmCurrentPrice();
        });
        reset();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    return {
        collect,
        getQuote,
        getSubtotal,
        handleSaveConflict,
        hydrate,
        quoteNow,
        reset,
        scheduleQuote,
        setActive,
        validationIssue
    };
})();

if (typeof window !== 'undefined') window.BookingTickets = BookingTickets;
