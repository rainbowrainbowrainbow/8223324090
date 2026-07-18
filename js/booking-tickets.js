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
        conversionOrigin: null,
        priceChangePending: false,
        priceDiff: [],
        conflictPreviousQuote: null,
        quoteEpoch: 0,
        bookingId: null,
        pricingBaselineKey: null,
        pricingQuoteInputKey: null,
        pricingDirty: false,
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
        const lines = pkg.ticketLines ?? pkg.ticket_lines;
        return Array.isArray(lines) ? lines : [];
    }

    function packageSchemaVersion(booking = {}) {
        const pkg = snapshotPackage(booking) || {};
        const version = Number(pkg.schemaVersion ?? pkg.schema_version);
        return Number.isInteger(version) && version >= 0 ? version : 0;
    }

    function hasV3TicketSnapshot(booking = {}) {
        const pkg = snapshotPackage(booking) || {};
        const lines = pkg.ticketLines ?? pkg.ticket_lines;
        return packageSchemaVersion(booking) >= 3 && Array.isArray(lines);
    }

    function hasLegacyEntrySnapshot(booking = {}) {
        if (packageSchemaVersion(booking) >= 3) return false;
        const pkg = snapshotPackage(booking) || {};
        const entry = pkg.entryCharge ?? pkg.entry_charge;
        return Boolean(entry && typeof entry === 'object' && !Array.isArray(entry));
    }

    function legacyEntrySubtotal(booking = {}) {
        const pkg = snapshotPackage(booking) || {};
        const entry = pkg.entryCharge || pkg.entry_charge || {};
        const raw = pkg.entrySubtotal ?? pkg.entry_subtotal ?? entry.subtotal;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
    }

    function quoteFromPackage(booking = {}) {
        if (!hasV3TicketSnapshot(booking)) return null;
        const pkg = snapshotPackage(booking) || {};
        const ticketLines = packageTicketLines(booking);
        return {
            quoteContractVersion: Number(pkg.ticketQuoteContractVersion ?? pkg.ticket_quote_contract_version) || null,
            quoteFingerprint: pkg.ticketQuoteFingerprint || pkg.ticket_quote_fingerprint || null,
            businessContext: pkg.ticketBusinessContext || pkg.ticket_business_context || null,
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

    function isPendingTicketOptIn() {
        return ['legacy_entry', 'no_tickets'].includes(state.mode)
            && !state.conversionConfirmed;
    }

    function invalidateQuoteLifecycle() {
        clearTimeout(state.timer);
        state.timer = null;
        state.quoteEpoch += 1;
        return state.quoteEpoch;
    }

    function normalizeGuestArrivalTime(value) {
        const time = String(value || '').trim();
        return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time) ? time : '';
    }

    function quoteBanquetContext() {
        const drawerState = window.BookingDrawerState;
        if (drawerState?.banquetCreationMode !== 'new') return null;
        const input = document.getElementById('bookingGuestArrivalTime');
        const inputTime = input
            ? input.value
            : drawerState.arrivalDraft?.guestArrivalTime;
        const guestArrivalTime = normalizeGuestArrivalTime(
            inputTime
        );
        return guestArrivalTime
            ? { mode: 'new', groupId: null, guestArrivalTime }
            : null;
    }

    function quoteExistingBanquetGroupContext() {
        if (window.AppState?.editingBookingId) return null;
        const drawerState = window.BookingDrawerState || {};
        const selectedContext = typeof window.selectedBookingBanquetGroupContext === 'function'
            ? window.selectedBookingBanquetGroupContext()
            : null;
        const selectedGroupId = String(
            selectedContext?.groupId
            || drawerState.selectedBanquetGroupId
            || ''
        ).trim();
        const explicitContext = drawerState.explicitBanquetContext
            && String(drawerState.explicitBanquetContext.groupId || '').trim() === selectedGroupId
            ? drawerState.explicitBanquetContext
            : null;
        const roomContext = drawerState.roomSelectionBanquetContext
            && String(drawerState.roomSelectionBanquetContext.groupId || '').trim() === selectedGroupId
            ? drawerState.roomSelectionBanquetContext
            : null;
        const bridgeContext = drawerState.roomBookingAnimationBridge
            && String(drawerState.roomBookingAnimationBridge.groupId || '').trim() === selectedGroupId
            ? drawerState.roomBookingAnimationBridge
            : null;
        const verifiedContext = selectedContext?.groupId && selectedContext?.sourceBookingId
            ? selectedContext
            : (explicitContext || roomContext || bridgeContext);
        const banquetGroupId = String(verifiedContext?.groupId || '').trim();
        const sourceBookingId = String(
            verifiedContext?.sourceBookingId
            || verifiedContext?.primaryBookingId
            || ''
        ).trim();
        return banquetGroupId && sourceBookingId
            ? { banquetGroupId, sourceBookingId }
            : null;
    }

    function pricingInputSnapshot() {
        const existingGroup = quoteExistingBanquetGroupContext();
        const newBanquet = quoteBanquetContext();
        return {
            bookingId: String(state.bookingId || '').trim() || null,
            date: bookingDate(),
            roomResourceId: roomResourceId() || null,
            banquetGuests: readCount('banquetGuests', { allowBlank: true }),
            banquetAdults: readCount('banquetAdults', { allowBlank: true }),
            ticketQuantities: manualQuantities()
                .map(item => ({ code: item.code, quantity: item.quantity }))
                .sort((a, b) => a.code.localeCompare(b.code)),
            banquetGroupId: existingGroup?.banquetGroupId || null,
            sourceBookingId: existingGroup?.sourceBookingId || null,
            newBanquetArrivalTime: newBanquet?.guestArrivalTime || null
        };
    }

    function pricingInputKey() {
        return JSON.stringify(pricingInputSnapshot());
    }

    function refreshPricingDirty() {
        if (state.mode !== 'v3' || !state.pricingBaselineKey) {
            state.pricingDirty = false;
            return state.pricingDirty;
        }
        state.pricingDirty = pricingInputKey() !== state.pricingBaselineKey;
        return state.pricingDirty;
    }

    function quoteAllocationSummary(lines = []) {
        const childrenTotal = readCount('banquetGuests', { allowBlank: true });
        const adultsTotal = readCount('banquetAdults', { allowBlank: true });
        const allocated = lines.reduce((totals, line) => {
            const quantity = Number(line.quantity || 0);
            if (!Number.isFinite(quantity) || quantity < 0) return totals;
            const audience = lineValue(line, 'audience', 'audience');
            if (audience === 'adult') totals.adults += quantity;
            else totals.children += quantity;
            return totals;
        }, { children: 0, adults: 0 });
        return `Діти ${allocated.children}/${childrenTotal ?? '—'} · Дорослі ${allocated.adults}/${adultsTotal ?? '—'}`;
    }

    function quoteLineForCode(quote = {}, code = '') {
        const rawLines = quote?.ticketLines ?? quote?.ticket_lines;
        const lines = Array.isArray(rawLines) ? rawLines : [];
        return lines.find(line => lineCode(line) === code) || null;
    }

    function diffValueProvided(value) {
        return value !== null && value !== undefined && value !== '';
    }

    function diffValuesChanged(previousValue, currentValue) {
        if (!diffValueProvided(previousValue) && !diffValueProvided(currentValue)) return false;
        const previousNumber = Number(previousValue);
        const currentNumber = Number(currentValue);
        if (Number.isFinite(previousNumber) && Number.isFinite(currentNumber)) {
            return previousNumber !== currentNumber;
        }
        return String(previousValue ?? '') !== String(currentValue ?? '');
    }

    function scalarDiffLabel(field = '') {
        return {
            businessContext: 'Бізнес-контекст',
            admissionContext: 'Контекст входу',
            dayType: 'Тип дня',
            pricingDate: 'Дата розрахунку',
            currency: 'Валюта',
            ticketSubtotal: 'Загальна сума квитків',
            ticketLineCount: 'Кількість позицій'
        }[field] || field || 'Параметр розрахунку';
    }

    function scalarDiffValue(field, value) {
        if (!diffValueProvided(value)) return '—';
        if (field === 'ticketSubtotal') return money(value);
        if (field === 'admissionContext') {
            return value === 'reserved_table_room'
                ? 'бронювання столика / кімнатки'
                : value === 'standard'
                    ? 'стандартний вхід'
                    : String(value);
        }
        if (field === 'dayType') {
            return value === 'weekend'
                ? 'вихідний'
                : value === 'weekday'
                    ? 'будній день'
                    : String(value);
        }
        return String(value);
    }

    function moneyDiffValue(value) {
        return diffValueProvided(value) && Number.isFinite(Number(value))
            ? money(value)
            : '—';
    }

    function priceDiffHtml() {
        if (!Array.isArray(state.priceDiff) || !state.priceDiff.length) return '';
        return `<ul class="booking-ticket-price-diff">${state.priceDiff.map(item => {
            if (item.field) {
                const label = scalarDiffLabel(item.field);
                const previousValue = scalarDiffValue(item.field, item.previousValue);
                const currentValue = scalarDiffValue(item.field, item.currentValue);
                return `<li><strong>${escapeHtml(label)}</strong>: ${escapeHtml(previousValue)} → ${escapeHtml(currentValue)}</li>`;
            }
            const code = item.ticketTypeCode || item.ticket_type_code || '';
            const previousLine = quoteLineForCode(state.conflictPreviousQuote, code);
            const currentLine = quoteLineForCode(state.quote, code);
            const label = lineName(currentLine || previousLine || { ticketTypeCode: code });
            const previousQuantity = item.previousQuantity
                ?? lineValue(previousLine || {}, 'quantity', 'quantity');
            const currentQuantity = item.currentQuantity
                ?? lineValue(currentLine || {}, 'quantity', 'quantity');
            const previousPrice = item.previousUnitPriceUah
                ?? lineValue(previousLine || {}, 'unitPriceUah', 'unit_price_uah');
            const currentPrice = item.currentUnitPriceUah
                ?? lineValue(currentLine || {}, 'unitPriceUah', 'unit_price_uah');
            const previousSubtotal = item.previousSubtotalUah
                ?? lineValue(previousLine || {}, 'subtotalUah', 'subtotal_uah');
            const currentSubtotal = item.currentSubtotalUah
                ?? lineValue(currentLine || {}, 'subtotalUah', 'subtotal_uah');
            const changes = [];
            if (diffValuesChanged(previousQuantity, currentQuantity)) {
                changes.push(`кількість ${previousQuantity ?? '—'} → ${currentQuantity ?? '—'}`);
            }
            if (diffValuesChanged(previousPrice, currentPrice)) {
                changes.push(`ціна ${moneyDiffValue(previousPrice)} → ${moneyDiffValue(currentPrice)}`);
            }
            if (diffValuesChanged(previousSubtotal, currentSubtotal)) {
                changes.push(`сума ${moneyDiffValue(previousSubtotal)} → ${moneyDiffValue(currentSubtotal)}`);
            }
            if (diffValuesChanged(item.previousTariffVersionId, item.currentTariffVersionId)) {
                changes.push(`версія тарифу #${item.previousTariffVersionId ?? '—'} → #${item.currentTariffVersionId ?? '—'}`);
            }
            if (!changes.length) changes.push('параметри позиції змінено');
            return `<li><strong>${escapeHtml(label)}</strong>: ${escapeHtml(changes.join('; '))}</li>`;
        }).join('')}</ul>`;
    }

    function ticketTypeLabel(code = '') {
        return {
            regular_child: 'Звичайний дитячий квиток',
            birthday_child: 'Квиток іменинника',
            under_3_child: 'Квиток для дитини до 3 років',
            discounted_child: 'Пільговий дитячий квиток',
            adult_companion: 'Квиток дорослого-супроводжуючого',
            adult_game: 'Ігровий квиток для дорослого'
        }[code] || 'Обраний квиток';
    }

    function ticketTypeField(code = '') {
        return manualFields[code]
            || (code === 'regular_child' ? 'banquetGuests' : null)
            || (code === 'adult_companion' ? 'banquetAdults' : null);
    }

    function quantityErrorField(details = {}) {
        const field = String(details.field || '').trim();
        if (['banquetGuests', 'banquetAdults'].includes(field)) return field;
        const match = field.match(/^ticketQuantities\[(\d+)\]\.quantity$/);
        if (!match) return null;
        const code = Object.keys(manualFields)[Number(match[1])];
        return code ? manualFields[code] : null;
    }

    function positiveManualFields(codes = []) {
        return codes
            .map(code => manualFields[code])
            .filter(id => Number(document.getElementById(id)?.value || 0) > 0);
    }

    function localizedQuoteErrorMessage(value) {
        const message = String(value || '').trim();
        return /[А-Яа-яІіЇїЄєҐґ]/u.test(message)
            ? message
            : 'Не вдалося розрахувати квитки. Перевірте дані та повторіть спробу.';
    }

    function quoteErrorPresentation(error = {}) {
        const code = String(error.code || '').trim();
        const details = error.details && typeof error.details === 'object'
            ? error.details
            : {};
        const ticketTypeCode = String(details.ticketTypeCode || details.ticket_type_code || '').trim();
        const retryFields = ['bookingTicketRetryQuote', 'bookingTicketQuoteState'];
        if (code === 'TICKET_QUANTITY_INVALID') {
            return {
                message: 'Кількості гостей і квитків мають бути цілими числами від 0.',
                fields: [quantityErrorField(details) || 'bookingTicketQuoteState']
            };
        }
        if (code === 'TICKET_CHILD_TOTAL_EXCEEDED') {
            const specialFields = positiveManualFields([
                'birthday_child',
                'under_3_child',
                'discounted_child'
            ]);
            const specialTotal = Number(details.specialChildTotal);
            const guestTotal = Number(details.banquetGuests);
            return {
                message: Number.isFinite(specialTotal) && Number.isFinite(guestTotal)
                    ? `Спеціальних дитячих квитків (${specialTotal}) більше, ніж дітей у бронюванні (${guestTotal}).`
                    : 'Спеціальних дитячих квитків більше, ніж дітей у бронюванні.',
                fields: [...specialFields, 'banquetGuests']
            };
        }
        if (code === 'TICKET_ADULT_TOTAL_EXCEEDED') {
            const adultGame = Number(details.adultGame);
            const adultTotal = Number(details.banquetAdults);
            return {
                message: Number.isFinite(adultGame) && Number.isFinite(adultTotal)
                    ? `Ігрових квитків для дорослих (${adultGame}) більше, ніж дорослих у бронюванні (${adultTotal}).`
                    : 'Ігрових квитків більше, ніж дорослих у бронюванні.',
                fields: [manualFields.adult_game, 'banquetAdults']
            };
        }
        if (code === 'TICKET_TYPE_UNAVAILABLE') {
            return {
                message: ticketTypeCode === 'under_3_child' && details.dayType === 'weekend'
                    ? 'Квиток для дитини до 3 років доступний лише у будні.'
                    : `${ticketTypeLabel(ticketTypeCode)} недоступний для обраної дати.`,
                fields: [ticketTypeField(ticketTypeCode) || 'bookingTicketQuoteState']
            };
        }
        if (code === 'TICKET_TYPE_INACTIVE') {
            const field = ticketTypeField(ticketTypeCode);
            return {
                message: `${ticketTypeLabel(ticketTypeCode)} зараз вимкнений. Оберіть інший тип квитка або зверніться до старшого менеджера.`,
                fields: field
                    ? [field]
                    : retryFields
            };
        }
        if (code === 'TICKET_TARIFF_MISSING') {
            return {
                message: 'Для цієї дати або контексту не налаштовано повний набір тарифів. Повторіть розрахунок після перевірки тарифів старшим менеджером.',
                fields: retryFields
            };
        }
        if (code === 'TICKET_GUEST_COUNT_CONFLICT') {
            return {
                message: 'Кількість дітей у бронюванні не збігається з даними для розрахунку квитків.',
                fields: ['banquetGuests']
            };
        }
        return {
            message: localizedQuoteErrorMessage(error.message),
            fields: retryFields
        };
    }

    function normalizedQuoteError(error = {}) {
        const presentation = quoteErrorPresentation(error);
        return {
            code: error.code || null,
            details: error.details && typeof error.details === 'object'
                ? error.details
                : null,
            message: presentation.message,
            fields: presentation.fields
        };
    }

    function render() {
        const section = document.getElementById('bookingTicketsSection');
        if (!section) return;
        section.classList.toggle('hidden', !state.active);
        const conversionBanner = document.getElementById('bookingTicketsLegacyBanner');
        const showConversionBanner = isPendingTicketOptIn();
        conversionBanner?.classList.toggle('hidden', !showConversionBanner);
        const conversionTitle = conversionBanner?.querySelector('strong');
        if (conversionTitle) {
            conversionTitle.textContent = state.mode === 'legacy_entry'
                ? 'Legacy-сума входу збережена без переоцінки.'
                : 'У цьому бронюванні ще немає квитків.';
        }
        const legacyAmount = document.getElementById('bookingTicketsLegacyAmount');
        if (legacyAmount) {
            legacyAmount.textContent = state.mode === 'no_tickets'
                ? 'Додайте квитки лише якщо вони потрібні для цього бронювання.'
                : state.legacySubtotal === null
                    ? 'Історична сума відображається без змін.'
                    : `Стара сума: ${money(state.legacySubtotal)}.`;
        }
        const convert = document.getElementById('bookingTicketsConvert');
        if (convert) {
            if (state.conversionPreview && state.quote) {
                convert.textContent = state.mode === 'legacy_entry'
                    ? 'Підтвердити перехід на нові квитки'
                    : 'Підтвердити додавання квитків';
            } else if (state.conversionPreview && state.status === 'loading') {
                convert.textContent = 'Розраховуємо…';
            } else if (state.conversionPreview && state.status === 'error') {
                convert.textContent = 'Повторити розрахунок';
            } else {
                convert.textContent = state.mode === 'no_tickets'
                    ? 'Додати квитки'
                    : 'Розрахувати перехід на нові квитки';
            }
        }
        setManualDisabled(showConversionBanner && !state.conversionPreview);

        const status = document.getElementById('bookingTicketQuoteState');
        if (status) {
            status.tabIndex = -1;
            status.classList.toggle('is-loading', state.status === 'loading');
            status.classList.toggle('is-error', state.status === 'error');
            status.textContent = state.status === 'loading'
                ? 'Сервер перераховує квитки…'
                : state.status === 'error'
                    ? (state.error?.message || 'Не вдалося розрахувати квитки.')
                    : state.quote
                        ? 'Серверний розрахунок актуальний.'
                        : state.mode === 'legacy_entry'
                            ? 'Legacy-сума не зміниться без явного переходу.'
                            : state.mode === 'no_tickets'
                                ? 'Квитки не додані. Поточне бронювання збережеться без них.'
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
            const allocation = quoteAllocationSummary(lines);
            meta.textContent = state.quote
                ? `${allocation} · ${day} · ${context} · дата ціни ${state.quote.pricingDate || bookingDate()}`
                : '';
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
                ? 'Розрахунок квитків змінився після попереднього перегляду. Перевірте відмінності та підтвердьте актуальний розрахунок.'
                : (state.status === 'error' ? state.error?.message : '');
            const showRetry = state.status === 'error' && ['new', 'v3'].includes(state.mode);
            sticky.innerHTML = state.priceChangePending
                ? `${escapeHtml(message)}${priceDiffHtml()} <button type="button" id="bookingTicketAcceptPrice">Підтвердити новий розрахунок</button>`
                : message
                    ? `${escapeHtml(message)}${showRetry ? ' <button type="button" id="bookingTicketRetryQuote">Повторити розрахунок</button>' : ''}`
                    : '';
            sticky.classList.toggle('hidden', !message);
        }
    }

    function quotePayload() {
        const guests = readCount('banquetGuests', { allowBlank: true });
        const adults = readCount('banquetAdults', { allowBlank: true });
        const resourceId = roomResourceId();
        if (guests === null || adults === null || !resourceId || !bookingDate()) return null;
        const banquetContext = quoteBanquetContext();
        const existingGroupContext = quoteExistingBanquetGroupContext();
        const convertLegacy = state.conversionOrigin === 'legacy_entry'
            && state.conversionPreview;
        const bookingId = String(state.bookingId || '').trim();
        return {
            ...(bookingId ? { bookingId } : {}),
            ...(banquetContext ? { banquetContext } : {}),
            ...(existingGroupContext || {}),
            ...(convertLegacy ? { convertLegacy: true } : {}),
            date: bookingDate(),
            roomResourceId: resourceId,
            banquetGuests: guests,
            kidsCount: guests,
            banquetAdults: adults,
            ticketQuantities: manualQuantities()
        };
    }

    async function quoteNow(expectedEpoch = null) {
        const requestEpoch = Number.isInteger(expectedEpoch)
            ? expectedEpoch
            : invalidateQuoteLifecycle();
        if (requestEpoch !== state.quoteEpoch) return null;
        if (!state.active || (isPendingTicketOptIn() && !state.conversionPreview)) {
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
        const invalidCountField = ['banquetGuests', 'banquetAdults']
            .find(field => !Number.isInteger(payload[field]) || payload[field] < 0);
        const invalidTicketIndex = payload.ticketQuantities
            .findIndex(item => !Number.isInteger(item.quantity) || item.quantity < 0);
        if (invalidCountField || invalidTicketIndex >= 0) {
            state.status = 'error';
            state.quote = null;
            state.error = normalizedQuoteError({
                code: 'TICKET_QUANTITY_INVALID',
                message: 'Кількості квитків мають бути цілими числами від 0.',
                details: {
                    field: invalidCountField || `ticketQuantities[${invalidTicketIndex}].quantity`
                }
            });
            render();
            window.renderBookingPackageSummary?.();
            return null;
        }
        state.status = 'loading';
        state.error = null;
        state.priceChangePending = false;
        state.priceDiff = [];
        state.conflictPreviousQuote = null;
        render();
        window.renderBookingPackageSummary?.();
        const result = await apiQuoteAdmissionTickets(payload, {
            sequenceKey: `booking-ticket-quote:${state.bookingId || 'new'}`
        });
        if (requestEpoch !== state.quoteEpoch) return null;
        if (result?.stale || result?.aborted) return null;
        if (!result?.success) {
            state.status = 'error';
            state.quote = null;
            state.error = normalizedQuoteError({
                code: result?.code || null,
                message: result?.error || 'Не вдалося розрахувати квитки.',
                details: result?.details || null
            });
            render();
            window.renderBookingPackageSummary?.();
            return result;
        }
        const serverQuote = result.quote || result;
        state.status = 'ready';
        state.quote = serverQuote;
        state.pricingQuoteInputKey = pricingInputKey();
        state.error = null;
        render();
        window.renderBookingPackageSummary?.();
        return serverQuote;
    }

    function scheduleQuote() {
        const requestEpoch = invalidateQuoteLifecycle();
        refreshPricingDirty();
        if (!state.active || (isPendingTicketOptIn() && !state.conversionPreview)) {
            render();
            return;
        }
        if (state.quote && state.baselineSubtotal === null) {
            state.comparisonSubtotal = Number(state.quote.ticketSubtotal || 0);
        }
        state.status = 'loading';
        state.quote = null;
        state.error = null;
        render();
        window.renderBookingPackageSummary?.();
        state.timer = setTimeout(() => void quoteNow(requestEpoch), 220);
    }

    function markDirtyAndScheduleQuote() {
        if (window.BookingForm) window.BookingForm._dirty = true;
        scheduleQuote();
    }

    function setActive(active) {
        const changed = state.active !== Boolean(active);
        state.active = Boolean(active);
        if (!state.active) invalidateQuoteLifecycle();
        render();
        if (changed && state.active && !isPendingTicketOptIn()) scheduleQuote();
    }

    function reset() {
        invalidateQuoteLifecycle();
        state.mode = 'new';
        state.status = 'idle';
        state.quote = null;
        state.baselineSubtotal = null;
        state.comparisonSubtotal = null;
        state.legacySubtotal = null;
        state.error = null;
        state.conversionPreview = false;
        state.conversionConfirmed = false;
        state.conversionOrigin = null;
        state.priceChangePending = false;
        state.priceDiff = [];
        state.conflictPreviousQuote = null;
        state.bookingId = null;
        state.pricingBaselineKey = null;
        state.pricingQuoteInputKey = null;
        state.pricingDirty = false;
        Object.values(manualFields).forEach(id => {
            const input = document.getElementById(id);
            if (input) input.value = '0';
        });
        render();
    }

    function hydrate(booking = {}, options = {}) {
        invalidateQuoteLifecycle();
        const storedQuote = quoteFromPackage(booking);
        const duplicateFlow = !window.AppState?.editingBookingId;
        const requestedBookingId = options.bookingId
            ?? options.booking_id
            ?? booking.id
            ?? booking.bookingId
            ?? booking.booking_id;
        state.bookingId = duplicateFlow
            ? null
            : (String(requestedBookingId || window.AppState?.editingBookingId || '').trim() || null);
        const legacyEntry = hasLegacyEntrySnapshot(booking);
        const historicalSubtotal = legacyEntry ? legacyEntrySubtotal(booking) : null;
        state.error = null;
        state.priceChangePending = false;
        state.priceDiff = [];
        state.conflictPreviousQuote = null;
        state.conversionPreview = false;
        state.conversionConfirmed = false;
        state.conversionOrigin = null;
        state.pricingBaselineKey = null;
        state.pricingQuoteInputKey = null;
        state.pricingDirty = false;
        if (duplicateFlow) {
            state.mode = 'new';
            state.status = 'idle';
            state.quote = null;
            state.baselineSubtotal = storedQuote
                ? Number(storedQuote.ticketSubtotal || 0)
                : historicalSubtotal;
            state.comparisonSubtotal = null;
            state.legacySubtotal = null;
            setManualValuesFromLines(storedQuote?.ticketLines || []);
            state.pricingQuoteInputKey = storedQuote ? pricingInputKey() : null;
            render();
            if (state.active) scheduleQuote();
            return;
        }
        if (storedQuote) {
            state.mode = 'v3';
            state.status = 'ready';
            state.quote = storedQuote;
            state.baselineSubtotal = Number(storedQuote.ticketSubtotal || 0);
            state.comparisonSubtotal = null;
            state.legacySubtotal = null;
            setManualValuesFromLines(storedQuote.ticketLines);
            state.pricingBaselineKey = pricingInputKey();
            state.pricingQuoteInputKey = state.pricingBaselineKey;
            state.pricingDirty = false;
            render();
            return;
        }
        state.mode = legacyEntry ? 'legacy_entry' : 'no_tickets';
        state.status = 'idle';
        state.quote = null;
        state.legacySubtotal = historicalSubtotal;
        state.baselineSubtotal = legacyEntry ? state.legacySubtotal : 0;
        state.comparisonSubtotal = null;
        state.conversionOrigin = state.mode;
        setManualValuesFromLines([]);
        render();
    }

    function collect() {
        if (!state.active) return {};
        if (isPendingTicketOptIn()) return {};
        const pricingDirty = refreshPricingDirty();
        if (state.mode === 'v3' && !state.conversionOrigin && !pricingDirty) return {};
        if (state.pricingQuoteInputKey !== pricingInputKey()) return {};
        return {
            ticketQuantities: manualQuantities(),
            ticketQuote: state.quote,
            ...(state.conversionOrigin === 'legacy_entry' && state.conversionConfirmed
                ? { convertLegacy: true }
                : {})
        };
    }

    function validationIssue() {
        if (!state.active) return null;
        if (isPendingTicketOptIn() && !state.conversionPreview) return null;
        const pricingDirty = refreshPricingDirty();
        if (state.priceChangePending) {
            return {
                key: 'ticket_price_confirmation',
                message: 'Підтвердьте актуальний розрахунок квитків після його зміни.',
                fields: ['bookingTicketAcceptPrice']
            };
        }
        if (state.mode === 'v3' && !state.conversionOrigin && !pricingDirty) return null;
        if (state.status === 'loading') {
            return { key: 'ticket_quote_loading', message: 'Дочекайтеся серверного розрахунку квитків.', fields: ['bookingTicketQuoteState'] };
        }
        if (state.status === 'error') {
            return {
                key: 'ticket_quote_error',
                message: state.error?.message || 'Виправте дані квитків.',
                fields: isPendingTicketOptIn()
                    ? ['bookingTicketsConvert']
                    : (state.error?.fields || ['bookingTicketRetryQuote', 'bookingTicketQuoteState'])
            };
        }
        if (!state.quote) {
            return {
                key: 'ticket_quote_required',
                message: 'Вкажіть кількість дітей і дорослих та отримайте серверний розрахунок квитків.',
                fields: ['banquetGuests', 'banquetAdults']
            };
        }
        if (state.pricingQuoteInputKey !== pricingInputKey()) {
            return {
                key: 'ticket_quote_required',
                message: 'Дані, що впливають на квитки, змінилися. Дочекайтеся нового серверного розрахунку.',
                fields: ['bookingTicketQuoteState']
            };
        }
        if (isPendingTicketOptIn()) {
            return {
                key: 'ticket_conversion_confirmation',
                message: state.mode === 'legacy_entry'
                    ? 'Перевірте різницю сум і підтвердьте перехід legacy-бронювання на нові квитки.'
                    : 'Перевірте розрахунок і підтвердьте додавання квитків.',
                fields: ['bookingTicketsConvert']
            };
        }
        return null;
    }

    function getSubtotal() {
        if (state.mode === 'legacy_entry' && !state.conversionConfirmed) return Number(state.legacySubtotal || 0);
        if (state.quote) return Number(state.quote.ticketSubtotal || 0);
        if (state.mode === 'v3' && state.baselineSubtotal !== null) {
            return Number(state.baselineSubtotal || 0);
        }
        return 0;
    }

    function getComparison() {
        if (state.status !== 'ready' || !state.quote || state.baselineSubtotal === null) return null;
        if (state.pricingQuoteInputKey !== pricingInputKey()) return null;
        const isFreshQuote = state.priceChangePending
            || Boolean(state.conversionPreview)
            || (state.mode === 'v3' && refreshPricingDirty());
        if (!isFreshQuote) return null;
        const previousSubtotal = Number(state.baselineSubtotal);
        const currentSubtotal = Number(state.quote.ticketSubtotal || 0);
        if (!Number.isFinite(previousSubtotal) || !Number.isFinite(currentSubtotal)) return null;
        if (getSubtotal() !== currentSubtotal) return null;
        const delta = Math.round((currentSubtotal - previousSubtotal) * 100) / 100;
        if (delta === 0) return null;
        return Object.freeze({ previousSubtotal, currentSubtotal, delta });
    }

    function getQuote() {
        return state.quote;
    }

    function handleSaveConflict(result = {}) {
        if (!['TICKET_PRICE_CHANGED', 'TICKET_QUOTE_CHANGED', 'TICKET_QUOTE_REQUIRED'].includes(result.code)) return false;
        const previousQuote = state.quote;
        invalidateQuoteLifecycle();
        const nextQuote = result.details?.quote;
        if (nextQuote) {
            state.quote = nextQuote;
            state.status = 'ready';
            state.error = null;
            state.pricingQuoteInputKey = pricingInputKey();
        }
        state.conflictPreviousQuote = previousQuote;
        state.priceDiff = Array.isArray(result.details?.diff) ? result.details.diff : [];
        state.priceChangePending = true;
        render();
        window.renderBookingPackageSummary?.();
        document.getElementById('bookingTicketsSection')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.requestAnimationFrame?.(() => {
            document.getElementById('bookingTicketAcceptPrice')?.focus();
        });
        return true;
    }

    function confirmCurrentPrice() {
        state.priceChangePending = false;
        state.priceDiff = [];
        state.conflictPreviousQuote = null;
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
        ['banquetGuests', 'banquetAdults', 'roomSelect', 'bookingGuestArrivalTime'].forEach(id => {
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
                return;
            }
            scheduleQuote();
        });
        document.getElementById('bookingTicketStickyError')?.addEventListener('click', event => {
            if (event.target.closest('#bookingTicketAcceptPrice')) {
                confirmCurrentPrice();
                return;
            }
            if (event.target.closest('#bookingTicketRetryQuote')) {
                void quoteNow();
            }
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
        getComparison,
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
