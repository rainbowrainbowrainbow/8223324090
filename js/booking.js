/**
 * booking.js - панель бронювання, форма, деталі, видалення, перенос часу
 */

function _escB(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getBookingEventCardRecord(booking = {}, program = {}) {
    return {
        ...booking,
        category: program?.category || booking.category,
        programName: booking.programName || program?.name || booking.label,
        programCode: booking.programCode || program?.code || booking.programId,
        title: booking.programName || booking.label || program?.name,
        name: booking.programName || booking.label || program?.name,
        description: booking.description || booking.notes || booking.comment || program?.description,
        notes: booking.notes || booking.comment || program?.description
    };
}

// v33.3: Toggle booking tag selection
function toggleBookingTag(el) {
    el.classList.toggle('active');
}

function isPinataProgram(program) {
    if (!program) return false;
    const category = String(program.category || program.category_id || '').trim().toLowerCase();
    if (category === 'pinata') return true;
    const id = String(program.id || program.programId || program.program_id || '').trim().toLowerCase();
    if (id.startsWith('pinata') || id.includes('pinata')) return true;
    const text = [
        program.code,
        program.programCode,
        program.program_code,
        program.label,
        program.name,
        program.title,
        program.programName,
        program.program_name
    ].filter(Boolean).join(' ').toLocaleLowerCase('uk-UA');
    return text.includes('pinata') || text.includes('пін');
}

// Canonical readable labels kept in source for UI/runtime guards:
// Клієнтська піньята (послуга)
// Піньята парку
// Свій наповнювач клієнта

const CLIENT_PINATA_FILLER_VALUE = 'client_filler';
const CLIENT_PINATA_FILLER_LABEL = 'Свій наповнювач клієнта';

function bookingPinataNumbersHelper() {
    return (typeof window !== 'undefined' && window.PinataNumbers)
        || (typeof globalThis !== 'undefined' && globalThis.PinataNumbers)
        || null;
}

const PINATA_OPERATIONAL_NUMBER_BASE = bookingPinataNumbersHelper()?.OPERATIONAL_BASE || 500;

const PINATA_PICKER_FALLBACK_DESIGNS = Array.from({ length: 36 }, (_, index) => {
    const number = String(PINATA_OPERATIONAL_NUMBER_BASE + index + 1);
    return { id: number, number, name: `Піньята №${number}`, emoji: '🪅', meta: 'Каталог піньят' };
});

const PinataPickerState = {
    status: null,
    promise: null,
    designChoices: [],
    fillerChoices: []
};

function isClientPinataFillerChoice(value) {
    return String(value || '').trim() === CLIENT_PINATA_FILLER_VALUE;
}

function isClientPinataFillerNumber(value) {
    const text = String(value || '').trim();
    return text === CLIENT_PINATA_FILLER_VALUE || text === CLIENT_PINATA_FILLER_LABEL;
}

function pinataFillerNumberLabel(value) {
    return isClientPinataFillerNumber(value) ? CLIENT_PINATA_FILLER_LABEL : value;
}

function normalizeBookingPinataNumber(value) {
    return bookingPinataNumbersHelper()?.normalize?.(value) || String(value ?? '').replace(/^(?:№|#)\s*/u, '').trim();
}

function extractBookingPinataNumberFromText(value) {
    return bookingPinataNumbersHelper()?.extractFromText?.(value) || '';
}

function bookingPinataNumberDisplay(value) {
    return bookingPinataNumbersHelper()?.display?.(value) || normalizeBookingPinataNumber(value);
}

function pinataTitleContainsNumber(title, number) {
    const normalizedNumber = normalizeBookingPinataNumber(number);
    const normalizedTitle = String(title || '').trim();
    if (!normalizedNumber || !normalizedTitle) return false;
    const extracted = normalizeBookingPinataNumber(extractBookingPinataNumberFromText(normalizedTitle));
    if (extracted && extracted === normalizedNumber) return true;
    const escaped = normalizedNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^0-9])(?:№|#)?\\s*${escaped}(?:$|[^0-9])`, 'u').test(normalizedTitle);
}

function pinataChoiceDisplayLabel(choice = {}) {
    const number = normalizeBookingPinataNumber(choice.number || choice.value || '');
    const title = String(choice.title || choice.name || '').trim();
    if (!number) return title;
    if (!title) return bookingPinataNumberDisplay(number);
    if (pinataTitleContainsNumber(title, number)) return title;
    return `${bookingPinataNumberDisplay(number)} · ${title}`;
}

function bookingPinataField(booking = {}, camelKey, snakeKey) {
    if (booking?.[camelKey] !== undefined && booking?.[camelKey] !== null) return booking[camelKey];
    if (booking?.[snakeKey] !== undefined && booking?.[snakeKey] !== null) return booking[snakeKey];
    return null;
}

function bookingPinataNumberValue(booking = {}) {
    return bookingPinataNumbersHelper()?.valueFromBooking?.(booking) || '';
}

function syncPinataClientFillerChoice() {
    const fillerSelect = document.getElementById('pinataFillerSelect');
    const pinataFillerNumber = document.getElementById('pinataFillerNumber');
    if (!pinataFillerNumber) return;

    const isClientFiller = isClientPinataFillerChoice(fillerSelect?.value);
    const wrapper = pinataFillerNumber.closest('.form-section');
    wrapper?.classList.toggle('pinata-client-filler-active', isClientFiller);

    if (isClientFiller) {
        if (pinataFillerNumber.value && !isClientPinataFillerNumber(pinataFillerNumber.value)) {
            pinataFillerNumber.dataset.previousPinataFillerNumber = pinataFillerNumber.value;
        }
        pinataFillerNumber.value = CLIENT_PINATA_FILLER_LABEL;
        pinataFillerNumber.disabled = true;
        pinataFillerNumber.setAttribute('aria-label', CLIENT_PINATA_FILLER_LABEL);
        return;
    }

    pinataFillerNumber.disabled = false;
    pinataFillerNumber.removeAttribute('aria-label');
    if (isClientPinataFillerNumber(pinataFillerNumber.value)) {
        pinataFillerNumber.value = pinataFillerNumber.dataset.previousPinataFillerNumber || '';
    }
    delete pinataFillerNumber.dataset.previousPinataFillerNumber;
}

function getClientPinataDefaultPrice() {
    const ownPinata = getProductsSync().find(p => p.id === 'pinata_own');
    return Number(ownPinata?.price || 300);
}

function getPinataModeValue() {
    return document.getElementById('pinataMode')?.value || 'none';
}

function pinataNormalizeChoiceValue(value) {
    return String(value || '').trim();
}

function pinataOperationalNumberFromDesignId(id) {
    return bookingPinataNumbersHelper()?.fromCatalogId?.(id) || normalizeBookingPinataNumber(id);
}

function pinataNumberFromId(prefix, id) {
    return pinataOperationalNumberFromDesignId(id);
}

function pinataEmojiForText(text, fallback = '🪅') {
    const normalized = String(text || '').toLowerCase();
    if (normalized.includes('client') || normalized.includes('клієнт') || normalized.includes('свій')) return '🤝';
    if (normalized.includes('pro') || normalized.includes('фігур')) return '⭐';
    if (normalized.includes('xl')) return '🎁';
    if (normalized.includes('l')) return '🍬';
    if (normalized.includes('m')) return '🍭';
    return fallback;
}

function renderPinataChoiceThumb(choice) {
    if (choice.imageUrl) {
        return `<img src="${_escB(choice.imageUrl)}" loading="lazy" alt="">`;
    }
    return `<span aria-hidden="true">${_escB(choice.emoji || '🪅')}</span>`;
}

function renderPinataChoiceCard(choice, selectedValue) {
    const selected = pinataNormalizeChoiceValue(choice.value) === pinataNormalizeChoiceValue(selectedValue);
    const number = normalizeBookingPinataNumber(choice.number || choice.value || '');
    const title = String(choice.title || choice.name || '').trim() || pinataChoiceDisplayLabel(choice) || 'Піньята';
    const numberBadge = number && !pinataTitleContainsNumber(title, number)
        ? `<span class="pinata-choice-number">${_escB(bookingPinataNumberDisplay(number))}</span>`
        : '';
    return `
        <button type="button" class="pinata-choice-card${selected ? ' selected' : ''}" data-pinata-choice="${_escB(choice.value)}" role="option" aria-selected="${selected ? 'true' : 'false'}" aria-pressed="${selected ? 'true' : 'false'}">
            <span class="pinata-choice-thumb">${renderPinataChoiceThumb(choice)}</span>
            <span class="pinata-choice-body">
                <strong>${_escB(title)}</strong>
                <small>${_escB(choice.meta || 'Каталог')}</small>
            </span>
            ${numberBadge}
        </button>
    `;
}

async function loadPinataPickerStatus() {
    if (PinataPickerState.status) return PinataPickerState.status;
    if (PinataPickerState.promise) return PinataPickerState.promise;
    PinataPickerState.promise = (async () => {
        try {
            const res = await fetch('/api/warehouse/pinata-status', {
                headers: typeof getAuthHeaders === 'function'
                    ? getAuthHeaders(false)
                    : { 'Authorization': `Bearer ${localStorage.getItem('pzp_token') || localStorage.getItem('pzp_access_token') || ''}` }
            });
            const data = await res.json();
            PinataPickerState.status = data?.success ? data : { success: false };
        } catch {
            PinataPickerState.status = { success: false };
        } finally {
            PinataPickerState.promise = null;
        }
        return PinataPickerState.status;
    })();
    return PinataPickerState.promise;
}

function buildPinataDesignChoices(status = PinataPickerState.status) {
    const designs = Array.isArray(status?.designs) ? status.designs : [];
    const source = designs.length ? designs : PINATA_PICKER_FALLBACK_DESIGNS;
    return source.map((design, index) => {
        const operationalNumber = pinataNormalizeChoiceValue(design.pinata_number || design.number || design.code);
        const number = operationalNumber
            ? normalizeBookingPinataNumber(operationalNumber)
            : pinataOperationalNumberFromDesignId(design.id || (index + 1));
        const title = design.name || design.title || `Піньята ${number}`;
        return {
            kind: 'design',
            value: number,
            title,
            number,
            meta: design.prints_qty || design.printsQty ? `Друків: ${design.prints_qty || design.printsQty}` : (design.meta || 'Дизайн піньяти'),
            emoji: design.emoji || pinataEmojiForText(title, '🪅'),
            imageUrl: design.image_url || design.imageUrl || ''
        };
    });
}

function findPinataFillerStock(value, status = PinataPickerState.status) {
    const stock = Array.isArray(status?.stock) ? status.stock : [];
    const needle = pinataNormalizeChoiceValue(value).toLowerCase();
    if (!needle) return null;
    return stock.find(item => String(item.name || '').toLowerCase().includes(needle)) || null;
}

function buildPinataFillerChoices(status = PinataPickerState.status) {
    const select = document.getElementById('pinataFillerSelect');
    const options = Array.from(select?.querySelectorAll('option[value]') || [])
        .filter(option => option.value);
    return options.map(option => {
        const value = option.value;
        const isClientFiller = isClientPinataFillerChoice(value);
        const group = option.closest('optgroup')?.label || '';
        const stock = findPinataFillerStock(value, status);
        const number = isClientFiller ? 'Свій' : value;
        return {
            kind: 'filler',
            value,
            title: isClientFiller ? CLIENT_PINATA_FILLER_LABEL : (group ? `${group} · ${option.textContent.trim()}` : option.textContent.trim()),
            number,
            meta: isClientFiller
                ? 'Наповнювач клієнта'
                : (stock ? `Склад: ${stock.quantity} ${stock.unit || 'шт'}` : (group || 'Наповнювач')),
            emoji: pinataEmojiForText(isClientFiller ? CLIENT_PINATA_FILLER_LABEL : value, '🍬'),
            imageUrl: ''
        };
    });
}

function bindPinataChoicePicker(kind) {
    const list = document.getElementById(kind === 'design' ? 'pinataDesignPickerList' : 'pinataFillerPickerList');
    if (!list || list.dataset.bound === 'true') return;
    list.dataset.bound = 'true';
    list.addEventListener('click', event => {
        const card = event.target.closest('[data-pinata-choice]');
        if (!card) return;
        selectPinataChoice(kind, card.dataset.pinataChoice || '');
    });
}

function currentPinataChoice(kind, value) {
    const choices = kind === 'design' ? PinataPickerState.designChoices : PinataPickerState.fillerChoices;
    return choices.find(choice => pinataNormalizeChoiceValue(choice.value) === pinataNormalizeChoiceValue(value)) || null;
}

function updatePinataChoiceStatus(kind, choice) {
    const status = document.getElementById(kind === 'design' ? 'pinataDesignPickerStatus' : 'pinataFillerPickerStatus');
    if (!status) return;
    status.textContent = choice ? pinataChoiceDisplayLabel(choice) : 'Оберіть';
}

function renderPinataChoicePicker(kind, choices, selectedValue) {
    const list = document.getElementById(kind === 'design' ? 'pinataDesignPickerList' : 'pinataFillerPickerList');
    if (!list) return;
    list.innerHTML = choices.length
        ? choices.map(choice => renderPinataChoiceCard(choice, selectedValue)).join('')
        : '<div class="pinata-choice-empty">Немає доступних варіантів</div>';
    updatePinataChoiceStatus(kind, currentPinataChoice(kind, selectedValue));
    bindPinataChoicePicker(kind);
}

function renderPinataVisualPickers(options = {}) {
    const mode = getPinataModeValue();
    const designValue = document.getElementById('pinataNumber')?.value || '';
    const fillerValue = document.getElementById('pinataFillerSelect')?.value || '';

    PinataPickerState.designChoices = buildPinataDesignChoices();
    if (designValue && !currentPinataChoice('design', designValue)) {
        PinataPickerState.designChoices.unshift({
            kind: 'design',
            value: designValue,
            title: 'Збережена піньята',
            number: designValue,
            meta: 'Із бронювання',
            emoji: '🪅',
            imageUrl: ''
        });
    }
    PinataPickerState.fillerChoices = buildPinataFillerChoices();
    if (fillerValue && !currentPinataChoice('filler', fillerValue)) {
        PinataPickerState.fillerChoices.unshift({
            kind: 'filler',
            value: fillerValue,
            title: 'Збережений наповнювач',
            number: fillerValue,
            meta: 'Із бронювання',
            emoji: '🍬',
            imageUrl: ''
        });
    }
    renderPinataChoicePicker('design', PinataPickerState.designChoices, designValue);
    if (mode === 'park') {
        renderPinataChoicePicker('filler', PinataPickerState.fillerChoices, fillerValue);
    }

    if (!options.skipFetch && !PinataPickerState.status && !PinataPickerState.promise) {
        loadPinataPickerStatus().then(() => renderPinataVisualPickers({ skipFetch: true }));
    }
}

function selectPinataChoice(kind, value) {
    const choice = currentPinataChoice(kind, value);
    if (!choice) return;

    if (kind === 'design') {
        const pinataNumber = document.getElementById('pinataNumber');
        if (pinataNumber) {
            pinataNumber.value = choice.number || choice.value || '';
            pinataNumber.dispatchEvent(new Event('input', { bubbles: true }));
            pinataNumber.dispatchEvent(new Event('change', { bubbles: true }));
        }
        updatePinataChoiceStatus('design', choice);
    } else {
        const fillerSelect = document.getElementById('pinataFillerSelect');
        const fillerNumber = document.getElementById('pinataFillerNumber');
        if (fillerSelect) fillerSelect.value = choice.value || '';
        if (fillerNumber) {
            fillerNumber.disabled = false;
            fillerNumber.value = isClientPinataFillerChoice(choice.value) ? CLIENT_PINATA_FILLER_LABEL : (choice.number || choice.value || '');
        }
        syncPinataClientFillerChoice();
        fillerSelect?.dispatchEvent(new Event('change', { bubbles: true }));
        fillerNumber?.dispatchEvent(new Event('input', { bubbles: true }));
        fillerNumber?.dispatchEvent(new Event('change', { bubbles: true }));
        updatePinataChoiceStatus('filler', choice);
    }

    renderPinataVisualPickers({ skipFetch: true });
    if (typeof renderBookingPackageSummary === 'function') renderBookingPackageSummary();
    if (window.BookingForm) BookingForm._dirty = true;
}

function syncPinataModeFields(mode = getPinataModeValue()) {
    const modeSection = document.getElementById('pinataModeSection');
    const sharedSection = document.getElementById('pinataSharedFields');
    const parkSection = document.getElementById('pinataFillerSection');
    const clientSection = document.getElementById('clientPinataServiceFields');
    const pinataNumber = document.getElementById('pinataNumber');
    const pinataFillerNumber = document.getElementById('pinataFillerNumber');
    const fillerSelect = document.getElementById('pinataFillerSelect');
    const servicePrice = document.getElementById('clientPinataServicePrice');
    const serviceNote = document.getElementById('clientPinataServiceNote');
    const selectedProgramId = document.getElementById('selectedProgram')?.value;
    const program = selectedProgramId ? getProductsSync().find(p => p.id === selectedProgramId) : null;

    if (modeSection) modeSection.classList.toggle('hidden', !isPinataProgram(program));
    if (sharedSection) sharedSection.classList.toggle('hidden', mode === 'none' || !isPinataProgram(program));
    if (parkSection) parkSection.classList.toggle('hidden', mode !== 'park');
    if (clientSection) clientSection.classList.toggle('hidden', mode !== 'client');
    if (mode !== 'park' && fillerSelect) fillerSelect.value = '';
    if (mode === 'none') {
        if (pinataNumber) pinataNumber.value = '';
        if (pinataFillerNumber) pinataFillerNumber.value = '';
    }
    if (mode === 'client' && servicePrice && !servicePrice.value) {
        servicePrice.value = String(getClientPinataDefaultPrice());
    }
    if (mode !== 'client') {
        if (servicePrice) servicePrice.value = '';
        if (serviceNote) serviceNote.value = '';
    }
    syncPinataClientFillerChoice();
    renderPinataVisualPickers();
}

function resetPinataModeFields() {
    const mode = document.getElementById('pinataMode');
    if (mode) mode.value = 'none';
    const fillerSelect = document.getElementById('pinataFillerSelect');
    if (fillerSelect) fillerSelect.value = '';
    const pinataNumber = document.getElementById('pinataNumber');
    if (pinataNumber) pinataNumber.value = '';
    const pinataFillerNumber = document.getElementById('pinataFillerNumber');
    if (pinataFillerNumber) {
        pinataFillerNumber.disabled = false;
        pinataFillerNumber.value = '';
        delete pinataFillerNumber.dataset.previousPinataFillerNumber;
        pinataFillerNumber.closest('.form-section')?.classList.remove('pinata-client-filler-active');
    }
    const servicePrice = document.getElementById('clientPinataServicePrice');
    if (servicePrice) servicePrice.value = '';
    const serviceNote = document.getElementById('clientPinataServiceNote');
    if (serviceNote) serviceNote.value = '';
    document.getElementById('pinataModeSection')?.classList.add('hidden');
    document.getElementById('pinataSharedFields')?.classList.add('hidden');
    document.getElementById('pinataFillerSection')?.classList.add('hidden');
    document.getElementById('clientPinataServiceFields')?.classList.add('hidden');
    renderPinataVisualPickers({ skipFetch: true });
}

const BookingPackageState = {
    menuPositions: [],
    serviceEvents: [],
    editIndex: null,
    catalogFilter: 'all',
    catalogEditing: null,
    catalogInsight: null,
    catalogInsightNudgeTimer: null,
    catalogProductsLoading: false,
    catalogProductsLastLoadKey: null
};

// Booking drawer state lives in js/booking-drawer-state.js.

const BOOKING_ENTRY_PRICE_RULE_CODES = Object.freeze({
    weekday: 'banquet_entry_weekday_child',
    weekend: 'banquet_entry_weekend_child'
});
const BOOKING_ENTRY_PRICE_RULE_SOURCE = 'banquet_entry_price_rules';

const BOOKING_WORKSPACE_SCHEMA_VERSION = 1;
const NO_EVENT_TIMELINE_DURATION = 30;
const ROOM_SELECTION_CUSTOMER_CHANGED_MESSAGE = 'Клієнта змінено, прив’язку до банкета з кімнати скинуто. Оберіть банкет вручну, якщо потрібно.';
const BOOKING_PROGRAM_ONLY_WORKSPACE = true;
const ROOM_FIRST_BANQUET_SERVICE_LINE_ID = 'banquet-service';
const BOOKING_TAKEAWAY_ROOM_VALUE = 'На виніс';
const MAYSTERNYA_ONLINE_ROOM = 'Онлайн';
const MAYSTERNYA_CLOSED_ROOM = 'Зайнято';
const MAYSTERNYA_DEFAULT_PROGRAM_ID = 'md_full_consult_40';

function isMaysternyaBookingContext() {
    if (typeof IS_MAYSTERNYA_DOLI_TIMELINE !== 'undefined' && IS_MAYSTERNYA_DOLI_TIMELINE) return true;
    return window.TimelineBusinessContext?.current?.().key === 'maysternya_doli';
}

function getTimelineBookingPresentation() {
    return window.TimelineBusinessContext?.presentation?.() || {
        mode: 'park',
        bookingTitle: 'Нове бронювання',
        submitLabel: 'Додати бронювання',
        groupLabel: 'Назва заявки / група (legacy)',
        notesLabel: 'Внутрішній коментар',
        customerNameLabel: 'Імʼя клієнта',
        phoneLabel: 'Телефон',
        roomOptionLabel: 'Кімната',
        parkKitchenEnabled: true
    };
}

function invalidateBookingTimelineDateCache(date, options) {
    if (typeof window.invalidateTimelineDateCache === 'function') {
        window.invalidateTimelineDateCache(date, options);
        return;
    }
    const key = formatDate(date);
    const clearFrom = cache => {
        if (!cache) return;
        Object.keys(cache).forEach(cacheKey => {
            if (cacheKey === key || cacheKey.endsWith(`|${key}`)) {
                delete cache[cacheKey];
            }
        });
    };
    if (options?.bookings !== false) clearFrom(AppState.cachedBookings);
    if (options?.lines !== false) clearFrom(AppState.cachedLines);
}

function bookingMutationBookingIds(result = null, fallbackIds = []) {
    const ids = new Set((Array.isArray(fallbackIds) ? fallbackIds : [fallbackIds])
        .map(value => String(value || '').trim())
        .filter(Boolean));
    const add = item => {
        const id = String(item?.id || item?.bookingId || item?.booking_id || '').trim();
        if (id) ids.add(id);
    };
    [
        result?.booking,
        result?.mainBooking,
        result?.updatedBooking
    ].forEach(add);
    [
        result?.bookings,
        result?.allBookings,
        result?.linkedBookings,
        result?.updatedBookings,
        result?.activityBookings,
        result?.banquetGroup?.bookings?.activities
    ].forEach(list => {
        if (Array.isArray(list)) list.forEach(add);
    });
    return [...ids];
}

function invalidateBookingBanquetPreviewFreshness(options = {}) {
    const bookingIds = bookingMutationBookingIds(null, [
        options.bookingId,
        ...(Array.isArray(options.bookingIds) ? options.bookingIds : [])
    ]);
    const groupIds = [
        options.groupId,
        ...(Array.isArray(options.groupIds) ? options.groupIds : [])
    ].map(value => String(value || '').trim()).filter(Boolean);
    if (typeof window.invalidateTimelineBanquetPreviewFreshness === 'function') {
        window.invalidateTimelineBanquetPreviewFreshness({
            bookingIds,
            groupIds,
            clearAll: options.clearAll === true
        });
    } else if (typeof window.invalidateTimelineBanquetSnapshotCache === 'function' && (bookingIds.length || groupIds.length || options.clearAll === true)) {
        window.invalidateTimelineBanquetSnapshotCache({
            bookingIds,
            groupIds,
            clearAll: options.clearAll === true
        });
    }
}

function isParkTimelineBookingMode() {
    return getTimelineBookingPresentation().mode === 'park';
}

function canDeleteTimelineBooking() {
    if (typeof canAccess === 'function') return canAccess('delete_booking');
    return !isViewer();
}

function canEditTimelineBooking() {
    if (typeof canAccess === 'function') return canAccess('edit_booking');
    return !isViewer();
}

function isMinimalTimelineBookingMode() {
    const mode = getTimelineBookingPresentation().mode;
    return mode === 'simple' || mode === 'specialist';
}

function isEducationTimelineBookingMode() {
    return getTimelineBookingPresentation().mode === 'education';
}

function isTimelineResourceBackedBookingMode() {
    const presentation = getTimelineBookingPresentation();
    return presentation.mode !== 'park' && Boolean(presentation.resourceType);
}

function defaultTimelineBookingRoom(presentation = getTimelineBookingPresentation()) {
    if (presentation.defaultBookingRoom) return presentation.defaultBookingRoom;
    if (presentation.resourceModel === 'online' || presentation.resourceType === 'online') return MAYSTERNYA_ONLINE_ROOM;
    return '';
}

function isOptionalTimelineRoomBookingMode(presentation = getTimelineBookingPresentation()) {
    return Boolean(defaultTimelineBookingRoom(presentation))
        || presentation.mode === 'simple'
        || presentation.mode === 'specialist'
        || presentation.resourceModel === 'online'
        || presentation.resourceType === 'online';
}

function timelineKitchenEnabled() {
    const presentation = getTimelineBookingPresentation();
    return presentation.mode === 'park' && presentation.parkKitchenEnabled !== false;
}

function bookingWorkspaceFromBooking(booking = {}) {
    const extra = bookingExtraDataObjectFromBooking(booking);
    return extra.bookingWorkspace || extra.booking_workspace || {};
}

function bookingWorkspaceCommentsFromBooking(booking = {}) {
    const comments = bookingWorkspaceFromBooking(booking).comments || {};
    return comments && typeof comments === 'object' && !Array.isArray(comments) ? comments : {};
}

function normalizeBookingCommentText(value, maxLength = 2000) {
    const text = String(value || '').trim();
    return text ? text.slice(0, maxLength) : null;
}

function emptyBookingWorkspaceComments() {
    return {
        kitchen: null,
        activity: null,
        internal: null
    };
}

function normalizeBookingWorkspaceComments(comments = {}) {
    return {
        kitchen: normalizeBookingCommentText(comments.kitchen),
        activity: normalizeBookingCommentText(comments.activity),
        internal: normalizeBookingCommentText(comments.internal)
    };
}

function bookingCommentTypeForFormData(formData = {}) {
    if (!isParkTimelineBookingMode()) return 'legacy';
    if (formData.scenario === 'kitchen_only' || formData.kitchenEnabled) return 'kitchen';
    if (BookingDrawerState.roomBookingAnimationBridge || formData.hasEvent) return 'activity';
    return 'internal';
}

function bookingCommentTypeForBooking(booking = {}) {
    if (!isParkTimelineBookingMode()) return 'legacy';
    const workspace = bookingWorkspaceFromBooking(booking);
    if (workspace.scenario === 'kitchen_only' || workspace.scenario === 'event_kitchen' || workspace.kitchen) return 'kitchen';
    if (workspace.hasEvent !== false && (booking.programId || booking.program_id || booking.programName || booking.program_name)) return 'activity';
    return 'internal';
}

function bookingCommentPresentationForType(type) {
    if (type === 'kitchen') {
        return {
            label: 'Коментар до кухні',
            placeholder: 'Побажання або внутрішній коментар для кухні'
        };
    }
    if (type === 'activity') {
        return {
            label: 'Коментар до активності',
            placeholder: 'Внутрішній коментар для активної програми'
        };
    }
    return {
        label: 'Внутрішній коментар',
        placeholder: 'Коментар для менеджерів'
    };
}

function buildBookingWorkspaceComments(commentType, rawComment) {
    const comments = emptyBookingWorkspaceComments();
    if (['kitchen', 'activity', 'internal'].includes(commentType)) {
        comments[commentType] = normalizeBookingCommentText(rawComment);
    }
    return comments;
}

function bookingCommentValueForType(comments = {}, type = 'internal') {
    if (['kitchen', 'activity', 'internal'].includes(type)) {
        return normalizeBookingCommentText(comments[type]) || '';
    }
    return '';
}

function bookingWorkspaceCommentForDisplay(booking = {}, options = {}) {
    const type = options.type || bookingCommentTypeForBooking(booking);
    const comments = bookingWorkspaceCommentsFromBooking(booking);
    const workspaceComment = bookingCommentValueForType(comments, type);
    const legacyComment = normalizeBookingCommentText(booking.notes, options.maxLength || 2000);
    const text = workspaceComment || legacyComment;
    if (!text) return null;
    return {
        text,
        type,
        label: workspaceComment
            ? bookingCommentPresentationForType(type).label
            : (options.legacyLabel || 'Примітки'),
        source: workspaceComment ? 'bookingWorkspace.comments' : 'bookings.notes'
    };
}

function renderBookingCommentDetailRow(booking = {}, options = {}) {
    const comment = bookingWorkspaceCommentForDisplay(booking, options);
    if (!comment) return '';
    return `<div class="booking-detail-row"><span class="label">${escapeHtml(comment.label)}:</span><span class="value">${escapeHtml(comment.text)}</span></div>`;
}

function bookingExtraDataObjectFromBooking(booking = {}) {
    const raw = booking.extraData !== undefined && booking.extraData !== null && booking.extraData !== ''
        ? booking.extraData
        : (booking.extra_data || {});
    if (!raw) return {};
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function bookingBanquetGroupRoleFromBooking(booking = {}) {
    const extra = bookingExtraDataObjectFromBooking(booking);
    const group = extra.banquetGroup || extra.banquet_group || {};
    return String(group.role || '').trim().toLowerCase();
}

function isOperationalBanquetMemberBooking(booking = {}) {
    const role = bookingBanquetGroupRoleFromBooking(booking);
    if (role === 'kitchen' || role === 'activity') return true;
    const workspace = bookingWorkspaceFromBooking(booking);
    const scenario = String(workspace.scenario || '').trim().toLowerCase();
    return scenario === 'kitchen_only';
}

function recurringLegacyNotesForBooking(booking = {}) {
    return isOperationalBanquetMemberBooking(booking) ? null : (booking.notes || null);
}

function recurringLegacyGroupNameForBooking(booking = {}) {
    return isOperationalBanquetMemberBooking(booking) ? null : (booking.groupName || null);
}

function recurringExtraDataForBooking(booking = {}) {
    const workspace = bookingWorkspaceFromBooking(booking);
    const comments = normalizeBookingWorkspaceComments(workspace.comments || {});
    const hasComment = Object.values(comments).some(Boolean);
    if (!hasComment) return null;
    const recurringWorkspace = { comments };
    if (workspace.scenario) recurringWorkspace.scenario = workspace.scenario;
    if (workspace.hasEvent !== undefined) recurringWorkspace.hasEvent = workspace.hasEvent;
    if (workspace.kitchen !== undefined) recurringWorkspace.kitchen = workspace.kitchen;
    return { bookingWorkspace: recurringWorkspace };
}

function syncParkBookingGroupNameVisibility() {
    const section = document.getElementById('bookingGroupNameSection')
        || document.getElementById('bookingGroupName')?.closest('.form-section');
    const hidden = isParkTimelineBookingMode();
    if (!section) return;
    section.classList.toggle('hidden', hidden);
    section.hidden = hidden;
    section.setAttribute('aria-hidden', hidden ? 'true' : 'false');
}

function syncBookingCommentFieldPresentation(formData = null) {
    syncParkBookingGroupNameVisibility();
    if (!isParkTimelineBookingMode()) return;
    const data = formData || (typeof getBookingFormData === 'function' ? getBookingFormData() : {});
    const type = bookingCommentTypeForFormData(data || {});
    const presentation = bookingCommentPresentationForType(type);
    const notes = document.getElementById('bookingNotes');
    const label = notes?.closest('.form-section')?.querySelector('label');
    if (label) label.textContent = presentation.label;
    if (notes) notes.placeholder = presentation.placeholder;
}

function bookingBanquetGroupDateValue() {
    if (!AppState.selectedDate) return '';
    if (typeof AppState.selectedDate === 'string') return AppState.selectedDate.slice(0, 10);
    return formatDate(AppState.selectedDate);
}

function bookingBanquetGroupSelectedCustomerId() {
    return String(document.getElementById('selectedCustomerId')?.value || '').trim();
}

// Banquet selector state helpers live in js/booking-banquet-selector.js.

// Booking save path resolver lives in js/booking-save-path.js.

if (typeof window !== 'undefined') {
    window.syncBookingCommentFieldPresentation = syncBookingCommentFieldPresentation;
}

function isRoomFirstTimelineView() {
    return window.TimelineView?.isRooms?.() === true;
}

function isMaysternyaClosedSlotBooking(booking = {}) {
    const extra = booking.extraData || booking.extra_data || {};
    const md = extra.maysternyaBooking || extra.maysternya || {};
    const resourceBlock = extra.timelineResourceBlock || extra.timeline_resource_block || {};
    return md.slotClosed === true || md.mode === 'closed_slot'
        || resourceBlock.resourceBlocked === true || resourceBlock.mode === 'resource_blackout';
}

function ensureMaysternyaRoomOption(value = MAYSTERNYA_ONLINE_ROOM) {
    const room = document.getElementById('roomSelect');
    if (!room) return;
    let option = Array.from(room.options).find(opt => opt.value === value);
    if (!option) {
        option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        room.appendChild(option);
    }
    option.dataset.roomLabel = option.dataset.roomLabel || value;
    room.value = value;
    room.setAttribute('aria-invalid', 'false');
}

function ensureTimelineRoomOption(value, options = {}) {
    const label = String(value || options.name || getTimelineBookingPresentation().roomOptionLabel || 'Кабінет').trim();
    ensureMaysternyaRoomOption(label);
    const room = document.getElementById('roomSelect');
    const option = Array.from(room?.options || []).find(opt => opt.value === label);
    if (!option) return;
    option.textContent = options.text || label;
    option.dataset.roomLabel = options.roomLabel || options.name || label;
    if (options.resourceId) option.dataset.resourceId = options.resourceId;
    if (options.resourceType) option.dataset.resourceType = options.resourceType;
    if (options.currentBookingRoom) option.dataset.currentBookingRoom = 'true';
    option.disabled = options.disabled === true;
}

const BOOKING_ROOM_FALLBACK_GROUP = '__ungrouped__';
const BOOKING_ROOM_NON_OPERATIONAL_VALUES = new Set(['Інше', 'Other']);
const BookingRoomCatalogState = {
    resources: [],
    loadedAt: 0,
    loading: null
};
const BookingRoomAvailabilityState = {
    baseGroups: null,
    defaultHint: '',
    occupiedRooms: new Set(),
    occupiedNowRooms: new Set(),
    roomDayBookings: new Map(),
    availableRooms: new Set()
};

function resetBookingRoomResourceCatalog() {
    BookingRoomCatalogState.resources = [];
    BookingRoomCatalogState.loadedAt = 0;
    BookingRoomCatalogState.loading = null;
    BookingRoomAvailabilityState.baseGroups = null;
}

function bookingRoomResourceOptionData(resource = {}) {
    const name = String(resource.name || resource.resourceName || '').trim();
    if (!name) return null;
    return {
        value: name,
        text: name,
        disabled: resource.isActive === false,
        resourceId: resource.resourceId || resource.resource_id || '',
        resourceType: resource.type || resource.resourceType || 'room',
        color: resource.color || '',
        sortOrder: resource.sortOrder ?? resource.sort_order ?? 0
    };
}

function applyBookingRoomOptionDataset(option, optionData = {}) {
    option.dataset.roomLabel = optionData.text || optionData.value || '';
    if (optionData.resourceId) option.dataset.resourceId = optionData.resourceId;
    if (optionData.resourceType) option.dataset.resourceType = optionData.resourceType;
    if (optionData.color) option.dataset.resourceColor = optionData.color;
    if (optionData.currentBookingRoom) option.dataset.currentBookingRoom = 'true';
    if (optionData.sortOrder !== undefined && optionData.sortOrder !== null) option.dataset.sortOrder = String(optionData.sortOrder);
}

function renderBookingRoomCatalogOptions(resources = [], options = {}) {
    const select = document.getElementById('roomSelect');
    if (!select) return;
    const selectedRoom = String(options.selectedRoom ?? select.value ?? '').trim();
    const activeOptions = (Array.isArray(resources) ? resources : [])
        .filter(resource => resource && resource.isActive !== false)
        .map(bookingRoomResourceOptionData)
        .filter(Boolean);
    const fragment = document.createDocumentFragment();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Оберіть кімнату';
    fragment.appendChild(empty);

    if (activeOptions.length) {
        const group = document.createElement('optgroup');
        group.label = 'Кімнати';
        activeOptions.forEach(optionData => {
            const option = document.createElement('option');
            option.value = optionData.value;
            option.textContent = optionData.text;
            option.disabled = optionData.disabled === true;
            applyBookingRoomOptionDataset(option, optionData);
            group.appendChild(option);
        });
        fragment.appendChild(group);
    }

    const hasSelectedRoom = selectedRoom && activeOptions.some(option => option.value === selectedRoom);
    if (selectedRoom && !hasSelectedRoom && options.includeCurrentRoom) {
        const current = document.createElement('option');
        current.value = selectedRoom;
        current.textContent = `${selectedRoom} (поточна, неактивна або legacy)`;
        current.disabled = options.currentRoomDisabled !== false;
        applyBookingRoomOptionDataset(current, {
            value: selectedRoom,
            text: selectedRoom,
            currentBookingRoom: true,
            resourceId: options.currentResourceId || '',
            resourceType: 'room'
        });
        fragment.appendChild(current);
    }

    select.innerHTML = '';
    select.appendChild(fragment);
    if (selectedRoom && Array.from(select.options).some(option => option.value === selectedRoom)) {
        select.value = selectedRoom;
    }
    BookingRoomAvailabilityState.baseGroups = null;
    snapshotBookingRoomOptions();
}

async function loadBookingRoomResourcesForSelect(options = {}) {
    if (!isParkTimelineBookingMode()) {
        snapshotBookingRoomOptions();
        return BookingRoomCatalogState.resources;
    }
    const maxAgeMs = 60 * 1000;
    if (!options.force
        && BookingRoomCatalogState.loadedAt
        && (Date.now() - BookingRoomCatalogState.loadedAt) < maxAgeMs
        && BookingRoomCatalogState.resources.length) {
        renderBookingRoomCatalogOptions(BookingRoomCatalogState.resources, options);
        return BookingRoomCatalogState.resources;
    }
    if (!BookingRoomCatalogState.loading || options.force) {
        BookingRoomCatalogState.loading = (typeof apiGetTimelineResources === 'function'
            ? apiGetTimelineResources('room', { includeInactive: true })
            : Promise.resolve([]))
            .then(resources => {
                BookingRoomCatalogState.resources = Array.isArray(resources) ? resources : [];
                BookingRoomCatalogState.loadedAt = Date.now();
                return BookingRoomCatalogState.resources;
            })
            .catch(error => {
                console.warn('[BookingRooms] room resource catalog unavailable', error);
                return BookingRoomCatalogState.resources;
            })
            .finally(() => {
                BookingRoomCatalogState.loading = null;
            });
    }
    const resources = await BookingRoomCatalogState.loading;
    if (resources.length) renderBookingRoomCatalogOptions(resources, options);
    else snapshotBookingRoomOptions();
    return resources;
}

if (typeof window !== 'undefined') {
    window.resetBookingRoomResourceCatalog = resetBookingRoomResourceCatalog;
}

function isOperationalBookingRoomValue(value) {
    const room = String(value || '').trim();
    return Boolean(room && !BOOKING_ROOM_NON_OPERATIONAL_VALUES.has(room));
}

function snapshotBookingRoomOptions() {
    const select = document.getElementById('roomSelect');
    if (!select || BookingRoomAvailabilityState.baseGroups) return;
    const groups = [];
    Array.from(select.children).forEach(child => {
        if (child.tagName === 'OPTGROUP') {
            const options = Array.from(child.children)
                .filter(option => option.tagName === 'OPTION' && option.value)
                .map(option => ({
                    value: option.value,
                    text: option.textContent || option.value,
                    disabled: option.disabled,
                    resourceId: option.dataset.resourceId || '',
                    resourceType: option.dataset.resourceType || '',
                    color: option.dataset.resourceColor || '',
                    currentBookingRoom: option.dataset.currentBookingRoom === 'true',
                    sortOrder: option.dataset.sortOrder || ''
                }));
            if (options.length) groups.push({ label: child.label || BOOKING_ROOM_FALLBACK_GROUP, options });
            return;
        }
        if (child.tagName === 'OPTION' && child.value) {
            groups.push({
                label: BOOKING_ROOM_FALLBACK_GROUP,
                options: [{
                    value: child.value,
                    text: child.textContent || child.value,
                    disabled: child.disabled,
                    resourceId: child.dataset.resourceId || '',
                    resourceType: child.dataset.resourceType || '',
                    color: child.dataset.resourceColor || '',
                    currentBookingRoom: child.dataset.currentBookingRoom === 'true',
                    sortOrder: child.dataset.sortOrder || ''
                }]
            });
        }
    });
    BookingRoomAvailabilityState.baseGroups = groups;
    BookingRoomAvailabilityState.defaultHint = document.getElementById('bookingRoomHint')?.textContent || '';
}

function collectOccupiedRoomsForBookingDay(bookings = [], excludeId = '') {
    return new Set(collectRoomDayBookingsForBookingDay(bookings, excludeId).keys());
}

function bookingRoomDayBookingName(booking = {}) {
    const name = booking.customerName || booking.customer_name || booking.groupName || booking.group_name
        || booking.label || booking.programName || booking.program_name || booking.programCode || booking.program_code
        || booking.id || 'бронь';
    const text = String(name || '').trim();
    return text.length > 28 ? `${text.slice(0, 25)}...` : text;
}

function bookingRoomDayBookingTime(booking = {}) {
    return String(booking.time || '').slice(0, 5) || '--:--';
}

function normalizeRoomDayBookingEntry(booking = {}) {
    const id = booking.id || null;
    const customerId = booking.customerId ?? booking.customer_id ?? null;
    const businessContext = booking.businessContext || booking.business_context || null;
    const room = booking.room || booking.resourceName || booking.resource_name || null;
    const banquetGroupId = booking.banquetGroupId || booking.banquet_group_id || null;
    const banquetGroupRole = booking.banquetGroupRole || booking.banquet_group_role || null;
    const banquetGroupPrimaryBookingId = booking.banquetGroupPrimaryBookingId || booking.banquet_group_primary_booking_id || null;
    const banquetGroupCustomerId = booking.banquetGroupCustomerId ?? booking.banquet_group_customer_id ?? null;
    return {
        id,
        date: String(booking.date || booking.bookingDate || booking.booking_date || '').slice(0, 10),
        time: booking.time || '',
        duration: parseInt(booking.duration, 10) || 0,
        customerId,
        customerName: booking.customerName || booking.customer_name || booking.groupName || booking.group_name
            || booking.label || booking.programName || booking.program_name || booking.programCode || booking.program_code || id || null,
        lineId: booking.lineId || booking.line_id || null,
        resourceId: booking.resourceId || booking.resource_id || null,
        category: booking.category || booking.category_id || null,
        programCode: booking.programCode || booking.program_code || null,
        programId: booking.programId || booking.program_id || null,
        room,
        businessContext,
        banquetGroupId,
        banquetGroupRole,
        banquetGroupPrimaryBookingId,
        banquetGroupCustomerId,
        isBanquetGroupMember: Boolean(booking.isBanquetGroupMember ?? booking.is_banquet_group_member ?? banquetGroupId),
        isBanquetPrimary: Boolean(
            booking.isBanquetPrimary
            ?? booking.is_banquet_primary
            ?? (banquetGroupPrimaryBookingId && id && String(banquetGroupPrimaryBookingId) === String(id))
        ),
        kidsCount: booking.kidsCount ?? booking.kids_count ?? null,
        status: booking.status || null,
        linkedTo: booking.linkedTo ?? booking.linked_to ?? null,
        label: booking.label || null,
        programName: booking.programName || booking.program_name || null,
        banquetGuests: booking.banquetGuests ?? booking.banquet_guests ?? null,
        banquetAdults: booking.banquetAdults ?? booking.banquet_adults ?? null,
        banquetTables: booking.banquetTables ?? booking.banquet_tables ?? null,
        banquetMenu: booking.banquetMenu || booking.banquet_menu || null,
        extraData: bookingExtraDataObjectFromBooking(booking)
    };
}

function selectedRoomDayBookings(roomName) {
    const room = String(roomName || document.getElementById('roomSelect')?.value || '').trim();
    if (!room || !isParkTimelineBookingMode()) return [];
    const entries = BookingRoomAvailabilityState.roomDayBookings instanceof Map
        ? BookingRoomAvailabilityState.roomDayBookings
        : normalizeRoomDayBookingsIndex(BookingRoomAvailabilityState.roomDayBookings || new Map());
    if (entries.has(room)) return sortRoomDayBookings(entries.get(room) || []);
    for (const [key, value] of entries.entries()) {
        if (sameBookingRoom(key, room)) return sortRoomDayBookings(value || []);
    }
    return [];
}

function roomBookingCustomerId(booking = {}) {
    return booking.customerId ?? booking.customer_id ?? null;
}

function roomBookingKidsCount(booking = {}) {
    const value = booking.kidsCount ?? booking.kids_count ?? booking.banquetGuests ?? booking.banquet_guests;
    const number = parseInt(value, 10);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function roomBookingHasBanquetContext(booking = {}) {
    return Boolean(booking.banquetGroupId || booking.banquet_group_id);
}

function roomBookingLooksLikeKitchen(booking = {}) {
    const extra = bookingExtraDataObjectFromBooking(booking);
    const workspace = bookingWorkspaceFromBooking({ ...booking, extraData: extra });
    const packageData = extra.bookingPackage || extra.booking_package || {};
    const positions = packageData.menuPositions || packageData.menu_positions || [];
    const serviceEvents = packageData.serviceEvents || packageData.service_events || [];
    const lineId = String(booking.lineId || booking.line_id || booking.resourceId || booking.resource_id || '').trim();
    const category = String(booking.category || booking.category_id || '').trim().toLowerCase();
    const programCode = String(booking.programCode || booking.program_code || '').trim().toUpperCase();
    const scenario = String(workspace.scenario || '').trim().toLowerCase();
    return lineId === ROOM_FIRST_BANQUET_SERVICE_LINE_ID
        || category === 'kitchen'
        || category === 'banquet'
        || programCode === 'KITCHEN'
        || scenario === 'kitchen_only'
        || (Array.isArray(positions) && positions.length > 0)
        || (Array.isArray(serviceEvents) && serviceEvents.length > 0)
        || Boolean(booking.banquetGuests ?? booking.banquet_guests ?? booking.banquetAdults ?? booking.banquet_adults ?? booking.banquetTables ?? booking.banquet_tables);
}

function roomBookingIsLinkedChild(booking = {}) {
    return Boolean(String(booking.linkedTo ?? booking.linked_to ?? '').trim());
}

function roomBookingIsCancelled(booking = {}) {
    return String(booking.status || '').trim().toLowerCase() === 'cancelled';
}

function clearAutoFilledBanquetGuestsFromRoom() {
    BookingDrawerState.autoFilledBanquetGuestsFromRoom = null;
}

function syncAutoFilledBanquetGuestsFromRoom(sourceBooking = {}) {
    const guests = document.getElementById('banquetGuests');
    if (!guests) return false;
    const source = normalizeRoomDayBookingEntry(sourceBooking);
    const sourceBookingId = String(source.id || '').trim();
    const sourceKidsCount = roomBookingKidsCount(source);
    const marker = BookingDrawerState.autoFilledBanquetGuestsFromRoom;
    if (marker?.sourceBookingId && sourceBookingId && String(marker.sourceBookingId) !== sourceBookingId) {
        clearAutoFilledBanquetGuestsFromRoom();
    }
    if (!sourceBookingId || !sourceKidsCount) return false;
    const current = String(guests.value || '').trim();
    if (current) return Boolean(marker && String(marker.sourceBookingId) === sourceBookingId && String(marker.value) === current);
    guests.value = String(sourceKidsCount);
    BookingDrawerState.autoFilledBanquetGuestsFromRoom = {
        sourceBookingId,
        value: String(sourceKidsCount),
        room: source.room || null
    };
    return true;
}

function markBanquetGuestsManualOverride() {
    const marker = BookingDrawerState.autoFilledBanquetGuestsFromRoom;
    if (!marker) return;
    const guests = document.getElementById('banquetGuests');
    const current = String(guests?.value || '').trim();
    if (!current) {
        clearAutoFilledBanquetGuestsFromRoom();
        return;
    }
    if (String(marker.value) !== current) {
        BookingDrawerState.autoFilledBanquetGuestsFromRoom = {
            ...marker,
            manualOverride: true
        };
    }
}

function roomBookingTargetOverlapRank(booking = {}, targetTime = '') {
    const targetStart = timeToMinutes(targetTime || '00:00');
    const start = timeToMinutes(booking.time || '00:00');
    const duration = Number(booking.duration || 0) || 0;
    const end = start + duration;
    return targetStart >= start && targetStart < end ? 0 : 1;
}

function pickBestRoomBanquetSourceBooking(candidates = [], targetTime = '') {
    return candidates.sort((a, b) =>
        roomBookingTargetOverlapRank(a, targetTime) - roomBookingTargetOverlapRank(b, targetTime)
        || scoreRoomCustomerSourceBooking(a, targetTime) - scoreRoomCustomerSourceBooking(b, targetTime)
        || Number(roomBookingHasBanquetContext(b)) - Number(roomBookingHasBanquetContext(a))
        || Number(Boolean(roomBookingCustomerId(b))) - Number(Boolean(roomBookingCustomerId(a)))
        || String(a.time || '').localeCompare(String(b.time || ''))
        || String(a.id || '').localeCompare(String(b.id || ''))
    )[0] || null;
}

function pickRoomBanquetSourceBookingFromBookings(bookings = [], roomName, targetTime = '') {
    const room = String(roomName || document.getElementById('roomSelect')?.value || '').trim();
    if (!room || !isParkTimelineBookingMode()) return null;
    const candidates = (Array.isArray(bookings) ? bookings : [])
        .map(normalizeRoomDayBookingEntry)
        .filter(booking =>
            booking.id
            && !roomBookingIsCancelled(booking)
            && !roomBookingIsLinkedChild(booking)
            && sameBookingRoom(booking.room, room)
        );
    if (!candidates.length) return null;
    return pickBestRoomBanquetSourceBooking(candidates, targetTime);
}

function pickRoomBanquetSourceBooking(roomName, targetTime = document.getElementById('bookingTime')?.value || '') {
    if (!isParkTimelineBookingMode()) return null;
    const room = String(roomName || document.getElementById('roomSelect')?.value || '').trim();
    if (!room) return null;
    const candidates = selectedRoomDayBookings(room)
        .map(normalizeRoomDayBookingEntry)
        .filter(booking => booking.id && !roomBookingIsCancelled(booking) && !roomBookingIsLinkedChild(booking));
    if (!candidates.length) return null;
    return pickBestRoomBanquetSourceBooking(candidates, targetTime);
}

async function fetchFreshRoomBanquetSourceBooking(roomName, targetTime = document.getElementById('bookingTime')?.value || '') {
    if (!isParkTimelineBookingMode() || typeof getBookingsForDate !== 'function') return null;
    const bookings = await getBookingsForDate(AppState.selectedDate, { force: true }).catch(error => {
        console.warn('[Booking] Не вдалося оновити бронювання для прив’язки банкету', error);
        return [];
    });
    return pickRoomBanquetSourceBookingFromBookings(bookings, roomName, targetTime);
}

function sourceBookingToBanquetContext(booking = {}) {
    const source = normalizeRoomDayBookingEntry(booking);
    const groupId = source.banquetGroupId || null;
    const sourceBookingId = source.banquetGroupPrimaryBookingId || source.id || null;
    return {
        groupId,
        sourceBookingId,
        groupName: source.label || source.programName || source.customerName || null,
        sourceRoom: source.room || null,
        sourceTime: source.time || '',
        sourceBooking: source,
        sourceCustomerId: source.customerId ?? null,
        sourceCustomerName: source.customerName || null,
        banquetGroupRole: source.banquetGroupRole || null,
        banquetGroupCustomerId: source.banquetGroupCustomerId ?? null,
        isBanquetPrimary: Boolean(source.isBanquetPrimary),
        source: groupId ? 'room_selection' : 'activity_first_kitchen_bridge'
    };
}

function roomSelectionBanquetContextLabel(context = {}) {
    const booking = context.sourceBooking || {};
    const time = bookingRoomDayBookingTime({ time: context.sourceTime || booking.time });
    const name = bookingRoomDayBookingName({
        customerName: context.sourceCustomerName || booking.customerName,
        label: context.groupName || booking.label,
        programName: booking.programName,
        id: context.sourceBookingId || booking.id
    });
    const room = context.sourceRoom || booking.room || document.getElementById('roomSelect')?.value || '';
    return `${time} ${name}${room ? ` — ${room}` : ''}`;
}

function sortRoomDayBookings(bookings = []) {
    return [...bookings].sort((a, b) =>
        String(a.time || '').localeCompare(String(b.time || ''))
        || String(a.id || '').localeCompare(String(b.id || ''))
    );
}

function collectRoomDayBookingsForBookingDay(bookings = [], excludeId = '') {
    const excludedId = String(excludeId || '').trim();
    const byRoom = new Map();
    (bookings || []).forEach(booking => {
        if (!booking || String(booking.status || '').toLowerCase() === 'cancelled') return;
        if (excludedId && String(booking.id || '') === excludedId) return;
        if (String(booking.linkedTo || booking.linked_to || '').trim()) return;
        const room = String(booking.room || '').trim();
        if (!isOperationalBookingRoomValue(room)) return;
        if (!byRoom.has(room)) byRoom.set(room, []);
        byRoom.get(room).push(normalizeRoomDayBookingEntry(booking));
    });
    byRoom.forEach((roomBookings, room) => byRoom.set(room, sortRoomDayBookings(roomBookings)));
    return byRoom;
}

function normalizeRoomDayBookingsIndex(input = new Map()) {
    if (input instanceof Map) {
        const normalized = new Map();
        input.forEach((value, key) => {
            normalized.set(String(key), sortRoomDayBookings((Array.isArray(value) ? value : []).map(normalizeRoomDayBookingEntry)));
        });
        return normalized;
    }
    if (input && typeof input === 'object' && !(input instanceof Set)) {
        const normalized = new Map();
        Object.entries(input).forEach(([key, value]) => {
            normalized.set(String(key), sortRoomDayBookings((Array.isArray(value) ? value : []).map(normalizeRoomDayBookingEntry)));
        });
        return normalized;
    }
    return new Map();
}

function roomDayBookingSuffix(roomBookings = []) {
    const sorted = sortRoomDayBookings(roomBookings);
    if (!sorted.length) return '';
    const first = sorted[0];
    const extra = sorted.length > 1 ? ` +${sorted.length - 1}` : '';
    return ` — ${bookingRoomDayBookingTime(first)} ${bookingRoomDayBookingName(first)}${extra}`;
}

function roomDayBookingInlineSummary(roomBookings = []) {
    return roomDayBookingSuffix(roomBookings).replace(/^ — /, '');
}

function renderBookingRoomOptionsForDay(roomDayBookingsInput = new Map(), options = {}) {
    const select = document.getElementById('roomSelect');
    if (!select) return;
    snapshotBookingRoomOptions();
    const groups = BookingRoomAvailabilityState.baseGroups || [];
    const roomDayBookings = normalizeRoomDayBookingsIndex(roomDayBookingsInput);
    const occupiedNowRooms = options.occupiedNowRooms instanceof Set
        ? options.occupiedNowRooms
        : new Set(Array.isArray(options.occupiedNowRooms) ? options.occupiedNowRooms : []);
    const selectedRoom = String(options.selectedRoom ?? select.value ?? '').trim();
    const selectedLabel = String(options.selectedLabel || selectedRoom).trim();
    const placeholder = isParkTimelineBookingMode() ? 'кімнату' : (getTimelineBookingPresentation().roomOptionLabel || 'кімнату');
    const availableRooms = new Set();
    const fragment = document.createDocumentFragment();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = `Оберіть ${String(placeholder).toLowerCase()}`;
    fragment.appendChild(empty);

    if (isRoomFirstTimelineView()) {
        const takeawayOption = document.createElement('option');
        takeawayOption.value = BOOKING_TAKEAWAY_ROOM_VALUE;
        takeawayOption.textContent = BOOKING_TAKEAWAY_ROOM_VALUE;
        takeawayOption.dataset.roomLabel = BOOKING_TAKEAWAY_ROOM_VALUE;
        takeawayOption.dataset.serviceRoom = 'takeaway';
        fragment.appendChild(takeawayOption);
        availableRooms.add(BOOKING_TAKEAWAY_ROOM_VALUE);
    }

    groups.forEach(group => {
        const visibleOptions = group.options.filter(option => {
            const value = String(option.value || '').trim();
            return Boolean(value);
        });
        if (!visibleOptions.length) return;
        const parent = group.label === BOOKING_ROOM_FALLBACK_GROUP
            ? fragment
            : document.createElement('optgroup');
        if (parent.tagName === 'OPTGROUP') parent.label = group.label;
        visibleOptions.forEach(optionData => {
            const option = document.createElement('option');
            option.value = optionData.value;
            const dayBookings = roomDayBookings.get(optionData.value) || [];
            applyBookingRoomOptionDataset(option, optionData);
            option.textContent = `${optionData.text}${isOperationalBookingRoomValue(optionData.value) ? roomDayBookingSuffix(dayBookings) : ''}`;
            option.disabled = optionData.disabled;
            if (dayBookings.length > 0) option.dataset.hasDayBookings = 'true';
            if (occupiedNowRooms.has(optionData.value)) option.dataset.occupiedNow = 'true';
            if (isOperationalBookingRoomValue(option.value)) {
                availableRooms.add(option.value);
            }
            parent.appendChild(option);
        });
        if (parent !== fragment) fragment.appendChild(parent);
    });

    if (selectedRoom && !Array.from(fragment.querySelectorAll?.('option') || []).some(option => option.value === selectedRoom)) {
        const option = document.createElement('option');
        option.value = selectedRoom;
        option.textContent = selectedLabel || selectedRoom;
        option.dataset.roomLabel = selectedLabel || selectedRoom;
        option.dataset.currentBookingRoom = 'true';
        fragment.appendChild(option);
    }

    select.innerHTML = '';
    select.appendChild(fragment);
    if (selectedRoom && Array.from(select.options).some(option => option.value === selectedRoom)) {
        select.value = selectedRoom;
    } else {
        select.value = '';
    }

    BookingRoomAvailabilityState.occupiedRooms = new Set(roomDayBookings.keys());
    BookingRoomAvailabilityState.occupiedNowRooms = occupiedNowRooms;
    BookingRoomAvailabilityState.roomDayBookings = roomDayBookings;
    BookingRoomAvailabilityState.availableRooms = availableRooms;

    const hint = document.getElementById('bookingRoomHint');
    if (hint && isParkTimelineBookingMode()) {
        const totalRooms = groups.flatMap(group => group.options).filter(option => isOperationalBookingRoomValue(option.value)).length;
        const roomsWithBookings = Array.from(roomDayBookings.entries()).filter(([, value]) => value.length > 0);
        if (roomsWithBookings.length > 0) {
            hint.textContent = 'Кімнати з підписом уже мають бронювання цього дня. Їх можна вибрати для іншої активності; перетин часу система заблокує.';
        } else if (totalRooms > 0) {
            hint.textContent = BookingRoomAvailabilityState.defaultHint || 'Без кімнати бронювання не зберігається.';
        }
    }
}

function roomDayBookingsFromAvailabilityResponse(data = {}) {
    if (data.dayBookingsByRoom && typeof data.dayBookingsByRoom === 'object') {
        return normalizeRoomDayBookingsIndex(data.dayBookingsByRoom);
    }
    if (Array.isArray(data.rooms)) {
        const byRoom = new Map();
        data.rooms.forEach(room => {
            byRoom.set(String(room.name || room.room || ''), Array.isArray(room.dayBookings) ? room.dayBookings.map(normalizeRoomDayBookingEntry) : []);
        });
        return normalizeRoomDayBookingsIndex(byRoom);
    }
    return new Map();
}

function occupiedNowRoomsFromAvailabilityResponse(data = {}) {
    if (Array.isArray(data.rooms)) {
        return new Set(data.rooms.filter(room => room.occupied).map(room => String(room.name || room.room || '')).filter(Boolean));
    }
    return new Set(Array.isArray(data.occupied) ? data.occupied.map(room => String(room || '')).filter(Boolean) : []);
}

function getBookingRoomAvailabilityRequest() {
    const date = formatDate(AppState.selectedDate);
    let time = document.getElementById('bookingTime')?.value;
    if (!time && AppState.selectedCell) time = AppState.selectedCell.dataset.time;
    const programId = document.getElementById('selectedProgram')?.value;
    const program = programId ? getProductsSync().find(p => String(p.id) === String(programId)) : null;
    const customDuration = parseInt(document.getElementById('customDuration')?.value || '', 10);
    const duration = Number.isFinite(customDuration) && customDuration > 0 ? customDuration : (program ? program.duration : 60);
    return { date, time, duration: parseInt(duration, 10) || 60 };
}

async function fetchBookingRoomAvailabilityForSelectedSlot(options = {}) {
    const request = getBookingRoomAvailabilityRequest();
    if (!request.time) return null;
    let path = window.TimelineBusinessContext?.appendApiContext?.(`/rooms/free/${request.date}/${request.time}/${request.duration}`)
        || `/rooms/free/${request.date}/${request.time}/${request.duration}`;
    const params = [];
    const excludeId = String(options.excludeId ?? AppState.editingBookingId ?? '').trim();
    if (excludeId) params.push(`excludeId=${encodeURIComponent(excludeId)}`);
    const requestedCapacity = resolveBookingChildrenCountSource().value;
    if (Number.isFinite(requestedCapacity) && requestedCapacity > 0) params.push(`capacity=${encodeURIComponent(String(requestedCapacity))}`);
    if (params.length) path += `${path.includes('?') ? '&' : '?'}${params.join('&')}`;
    const response = await fetch(`${API_BASE}${path}`, { headers: getAuthHeaders(false) });
    if (handleAuthError(response)) return null;
    if (!response.ok) throw new Error(`rooms/free ${response.status}`);
    return response.json();
}

async function refreshBookingRoomAvailabilityForSelectedDate(options = {}) {
    if (!isParkTimelineBookingMode()) return;
    const selectedRoom = String(options.selectedRoom ?? document.getElementById('roomSelect')?.value ?? '').trim();
    await loadBookingRoomResourcesForSelect({
        selectedRoom,
        includeCurrentRoom: Boolean(selectedRoom && AppState.editingBookingId),
        currentRoomDisabled: true,
        force: options.forceRoomCatalog === true
    });
    snapshotBookingRoomOptions();
    try {
        if (!Array.isArray(options.bookings)) {
            const availability = await fetchBookingRoomAvailabilityForSelectedSlot(options);
            if (availability) {
                renderBookingRoomOptionsForDay(roomDayBookingsFromAvailabilityResponse(availability), {
                    selectedRoom,
                    occupiedNowRooms: occupiedNowRoomsFromAvailabilityResponse(availability)
                });
                return;
            }
        }
        const bookings = Array.isArray(options.bookings)
            ? options.bookings
            : await getBookingsForDate(AppState.selectedDate);
        const roomDayBookings = collectRoomDayBookingsForBookingDay(bookings, options.excludeId ?? AppState.editingBookingId);
        renderBookingRoomOptionsForDay(roomDayBookings, { selectedRoom });
    } catch (err) {
        console.warn('Booking room availability refresh failed', err);
    }
}

function isBookingRoomAvailableForSelectedDay(roomValue) {
    const room = String(roomValue || '').trim();
    if (!room || !isParkTimelineBookingMode()) return true;
    return BookingRoomAvailabilityState.availableRooms.has(room)
        || Array.from(document.getElementById('roomSelect')?.options || []).some(option => option.value === room);
}

function getSelectedTimelineResourceLine() {
    const dateStr = formatDate(AppState.selectedDate);
    const lineId = document.getElementById('bookingLine')?.value || AppState.selectedLineId;
    const lines = AppState.lines || AppState.linesByDate?.[dateStr] || [];
    return lines.find(line => String(line.id) === String(lineId)) || null;
}

function getBookingLineSnapshot(lineId = document.getElementById('bookingLine')?.value) {
    const dateStr = normalizeBookingDateKey(AppState.selectedDate);
    const lines = [
        ...(AppState.linesByDate?.[dateStr] || []),
        ...(AppState.lines || [])
    ];
    const line = lines.find(item => String(item?.id || '') === String(lineId || ''));
    if (line) return line;
    const label = document.getElementById('selectedLineDisplay')?.textContent?.trim();
    return label ? { id: lineId, name: label } : null;
}

function bookingLineSnapshotForBoundary(lineId, fallback = {}) {
    const line = getBookingLineSnapshot(lineId);
    if (line) return line;
    const id = String(lineId || fallback.id || fallback.resourceId || '').trim();
    return id ? { ...fallback, id } : fallback;
}

function bookingBoundaryWarningsForFormData(formData = null) {
    if (!formData?.hasEvent || !formData.time || !(Number(formData.duration || 0) > 0)) return [];

    const boundaryResolver = typeof window !== 'undefined' && typeof window.timelineBookingBoundaryStatus === 'function'
        ? window.timelineBookingBoundaryStatus
        : (typeof timelineBookingBoundaryStatus === 'function' ? timelineBookingBoundaryStatus : null);
    if (!boundaryResolver) return [];

    const warnings = [];
    const bookingDate = normalizeBookingDateKey(AppState.selectedDate);
    const addBoundaryWarning = (lineId, fallback, role) => {
        if (!lineId) return;
        const line = bookingLineSnapshotForBoundary(lineId, fallback);
        const status = boundaryResolver({
            time: formData.time,
            duration: formData.duration,
            date: bookingDate,
            lineId
        }, line, AppState.selectedDate);
        if (!status?.overrun) return;

        warnings.push({
            ...status,
            key: role === 'second' ? 'second_animator_shift_overrun' : 'primary_animator_shift_overrun',
            lineId,
            message: role === 'second'
                ? `Другий ведучий: ${status.message}`
                : status.message
        });
    };

    addBoundaryWarning(formData.lineId, {
        name: formData.lineName,
        resourceType: formData.lineResourceType
    }, 'primary');

    if (formData.secondAnimatorLineId && String(formData.secondAnimatorLineId) !== String(formData.lineId)) {
        addBoundaryWarning(formData.secondAnimatorLineId, {
            name: formData.secondAnimatorLineName
        }, 'second');
    }

    return warnings;
}

function syncBookingBoundaryWarningUi(validation = {}) {
    const hasBoundaryWarning = Array.isArray(validation.boundaryWarnings)
        && validation.boundaryWarnings.some(warning => warning?.overrun);
    document.getElementById('bookingPanel')?.classList.toggle('booking-panel--time-overrun', hasBoundaryWarning);

    document.querySelectorAll('.grid-cell.selected.timeline-selected-overrun').forEach(cell => {
        cell.classList.remove('timeline-selected-overrun');
    });
    if (hasBoundaryWarning) {
        document.querySelector('.grid-cell.selected')?.classList.add('timeline-selected-overrun');
    }
}

function bookingContextHeaderText(value, fallback = '-') {
    const text = String(value || '').trim();
    if (!text) return fallback;
    return text.length > 42 ? `${text.slice(0, 39)}...` : text;
}

function bookingContextCustomerName() {
    const selectedCustomerId = document.getElementById('selectedCustomerId')?.value;
    return document.querySelector('#bookingSelectedCustomerCard strong')?.textContent?.trim()
        || (selectedCustomerId ? document.getElementById('customerName')?.value?.trim() : '')
        || (selectedCustomerId ? document.getElementById('customerSearch')?.value?.trim() : '')
        || (selectedCustomerId ? 'Існуючий клієнт' : '');
}

function bookingContextGuestsText() {
    const childrenCount = resolveBookingChildrenCountSource().value;
    if (childrenCount) return String(childrenCount);
    return document.getElementById('bookingLeadChildrenInfo')?.value?.trim() || '';
}

function updateBookingContextHeaderSummary() {
    const customer = document.getElementById('selectedCustomerDisplay');
    const child = document.getElementById('selectedChildDisplay');
    const guests = document.getElementById('selectedGuestsDisplay');
    if (customer) customer.textContent = bookingContextHeaderText(bookingContextCustomerName());
    if (child) child.textContent = bookingContextHeaderText(document.getElementById('customerChildName')?.value);
    if (guests) guests.textContent = bookingContextHeaderText(bookingContextGuestsText());
}

function timelineResourceCapacityError(formData = getBookingFormData()) {
    if (!isTimelineResourceBackedBookingMode()) return null;
    const line = getSelectedTimelineResourceLine();
    const capacity = parseInt(line?.capacity, 10);
    const kidsCount = normalizeBookingCountValue(formData?.kidsCount ?? resolveBookingChildrenCountSource().value);
    if (!Number.isFinite(capacity) || capacity <= 0 || !Number.isFinite(kidsCount) || kidsCount <= capacity) return null;
    return `${line.name || getTimelineBookingPresentation().roomOptionLabel} має місткість ${capacity}, а в записі ${kidsCount}`;
}

function getMaysternyaContactSnapshot() {
    const customerName = document.getElementById('customerName')?.value?.trim() || '';
    const phone = document.getElementById('customerPhone')?.value?.trim() || '';
    const instagram = document.getElementById('customerInstagram')?.value?.trim() || '';
    const topic = document.getElementById('bookingGroupName')?.value?.trim() || '';
    return { customerName, phone, instagram, topic };
}

function getMaysternyaSlotCloseDuration() {
    const selected = parseInt(document.getElementById('maysternyaSlotCloseDuration')?.value, 10);
    if (Number.isFinite(selected) && selected > 0) return selected;
    const programId = document.getElementById('selectedProgram')?.value || MAYSTERNYA_DEFAULT_PROGRAM_ID;
    const program = getProductsSync().find(p => p.id === programId);
    return parseInt(program?.duration, 10) || 60;
}

function getBookingWorkspaceHasEvent() {
    if (isRoomFirstTimelineView()) return false;
    return true;
}

function isBookingKitchenEnabled() {
    return isRoomFirstTimelineView() && timelineKitchenEnabled();
}

function setBookingKitchenEnabled(enabled, options = {}) {
    const toggle = document.getElementById('bookingKitchenToggle');
    if (toggle) toggle.checked = isRoomFirstTimelineView() && timelineKitchenEnabled();
    syncBookingWorkspaceMode(options);
}

function isBookingLeadDetailsEnabled() {
    return false;
}

function setBookingLeadDetailsEnabled(enabled, options = {}) {
    const toggle = document.getElementById('bookingLeadDetailsToggle');
    if (toggle) toggle.checked = false;
    syncBookingWorkspaceMode(options);
}

function getBookingLeadDetails() {
    return {
        source: document.getElementById('bookingLeadSource')?.value || null,
        status: document.getElementById('bookingLeadStatus')?.value || null,
        interestDate: document.getElementById('bookingLeadInterestDate')?.value || null,
        budget: document.getElementById('bookingLeadBudget')?.value?.trim() || null,
        childrenInfo: document.getElementById('bookingLeadChildrenInfo')?.value?.trim() || null,
        notes: document.getElementById('bookingLeadNotes')?.value?.trim() || null
    };
}

function hasBookingLeadDetails(details = getBookingLeadDetails()) {
    return Object.values(details || {}).some(value => String(value || '').trim());
}

function setBookingLeadDetails(details = {}) {
    const map = {
        bookingLeadSource: details.source || details.sourceChannel || '',
        bookingLeadStatus: details.status || details.pipelineStage || '',
        bookingLeadInterestDate: details.interestDate || details.eventDate || '',
        bookingLeadBudget: details.budget || details.potentialValue || '',
        bookingLeadChildrenInfo: details.childrenInfo || details.childAge || details.childrenCount || '',
        bookingLeadNotes: details.notes || ''
    };
    Object.entries(map).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value || '';
    });
    const section = document.getElementById('bookingLeadDetailsSection');
    if (section) {
        section.open = false;
        section.classList.add('hidden');
    }
    setBookingLeadDetailsEnabled(false, { markDirty: false });
}

function resetBookingLeadDetails() {
    ['bookingLeadSource', 'bookingLeadStatus', 'bookingLeadInterestDate', 'bookingLeadBudget', 'bookingLeadChildrenInfo', 'bookingLeadNotes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const section = document.getElementById('bookingLeadDetailsSection');
    if (section) section.open = false;
}

function setBookingClientMode(mode = 'search', options = {}) {
    const nextMode = mode === 'existing' || mode === 'new' ? mode : 'search';
    BookingDrawerState.clientMode = nextMode;
    const selectedCard = document.getElementById('bookingSelectedCustomerCard');
    const newCustomerForm = document.getElementById('bookingNewCustomerForm');
    const searchState = document.getElementById('bookingCustomerSearchState');
    const searchResults = document.getElementById('customerSearchResults');
    const createBtn = document.getElementById('bookingCreateCustomerBtn');
    const changeBtn = document.getElementById('bookingChangeCustomerBtn');
    const modeLabel = document.getElementById('bookingCustomerModeLabel');
    const customerSearch = document.getElementById('customerSearch');
    const customerName = document.getElementById('customerName');
    const hasSelected = Boolean(document.getElementById('selectedCustomerId')?.value);
    const isNew = nextMode === 'new';

    if (selectedCard) selectedCard.classList.toggle('hidden', nextMode !== 'existing');
    if (newCustomerForm) {
        newCustomerForm.classList.toggle('hidden', !isNew);
        newCustomerForm.hidden = !isNew;
        newCustomerForm.setAttribute('aria-hidden', String(!isNew));
    }
    if (searchState && nextMode !== 'search') {
        searchState.classList.add('hidden');
        searchState.innerHTML = '';
    }
    if (searchResults && nextMode !== 'search') searchResults.classList.add('hidden');
    if (createBtn) {
        createBtn.classList.toggle('hidden', nextMode === 'existing');
        createBtn.textContent = isNew ? 'До пошуку' : 'Новий клієнт';
        createBtn.setAttribute('aria-expanded', String(isNew));
    }
    if (changeBtn) changeBtn.classList.toggle('hidden', nextMode !== 'existing' || !hasSelected);
    if (modeLabel) {
        if (nextMode === 'existing') modeLabel.textContent = 'Прикріплено існуючу картку клієнта.';
        else if (isNew) modeLabel.textContent = 'Введіть дані нового клієнта.';
        else modeLabel.textContent = 'Знайдіть і виберіть існуючу картку клієнта.';
    }
    if (customerSearch) customerSearch.setAttribute('aria-expanded', nextMode === 'search' ? 'true' : 'false');
    if (isNew && customerName && !customerName.value.trim()) {
        customerName.value = customerSearch?.value?.trim() || '';
    }
    if (options.focusSearch) customerSearch?.focus();
    if (options.focusNew) customerName?.focus();
}

function bookingCustomerCleanText(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function bookingCustomerVisitWord(count) {
    const value = Math.abs(Number(count));
    const mod10 = value % 10;
    const mod100 = value % 100;
    if (mod10 === 1 && mod100 !== 11) return 'візит';
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'візити';
    return 'візитів';
}

function bookingCustomerVisitLabel(value) {
    const count = Number(value);
    if (!Number.isFinite(count) || count <= 0) return '';
    const visits = Math.trunc(count);
    return `${visits} ${bookingCustomerVisitWord(visits)}`;
}

function bookingCustomerInstagramDisplay(value) {
    const text = bookingCustomerCleanText(value);
    if (!text) return '';
    return `@${text.replace(/^@+/, '')}`;
}

const BOOKING_SELECTED_CUSTOMER_NOTE_EXPAND_THRESHOLD = 130;
const BOOKING_CUSTOMER_DIETARY_TAGS = Object.freeze({
    nuts: 'Горіхи',
    peanuts: 'Арахіс',
    lactose: 'Лактоза',
    dairy: 'Молочне',
    gluten: 'Глютен',
    eggs: 'Яйця',
    sugar: 'Цукор',
    other: 'Інше'
});

function bookingCustomerNormalizeDietaryTag(value) {
    const text = String(value?.tag ?? value?.key ?? value?.id ?? value?.value ?? value ?? '')
        .trim()
        .toLowerCase()
        .replace(/^#+/, '')
        .replace(/[\s./]+/g, '_')
        .replace(/[^a-z0-9_:-]/g, '')
        .replace(/_+/g, '_')
        .replace(/^[_:-]+|[_:-]+$/g, '')
        .slice(0, 40);
    return /^[a-z0-9][a-z0-9_:-]{0,39}$/.test(text) ? text : '';
}

function bookingCustomerDietaryTags(value) {
    const raw = Array.isArray(value)
        ? value
        : String(value || '').split(/[,;\n|]+/);
    const tags = [];
    raw.forEach(item => {
        const tag = bookingCustomerNormalizeDietaryTag(item);
        if (tag && !tags.includes(tag)) tags.push(tag);
    });
    return tags.slice(0, 20);
}

function bookingCustomerDietaryTagLabel(tag) {
    const key = bookingCustomerNormalizeDietaryTag(tag);
    return BOOKING_CUSTOMER_DIETARY_TAGS[key] || key;
}

function bookingCustomerDietaryTagsLabel(tags = []) {
    return bookingCustomerDietaryTags(tags)
        .map(bookingCustomerDietaryTagLabel)
        .filter(Boolean)
        .join(', ');
}

function bookingCustomerChildHasContext(child = {}) {
    const ageSnapshot = child.ageSnapshot ?? child.age_snapshot ?? null;
    const dietaryTags = child.dietaryTags ?? child.dietary_tags;
    const dietaryNote = child.dietaryNote ?? child.dietary_note;
    return Boolean(
        child.name
        || child.birthday
        || ageSnapshot !== null
        || child.note
        || (Array.isArray(dietaryTags) && dietaryTags.length)
        || dietaryNote
    );
}

function bookingSelectedCustomerFactHtml(label, value) {
    const text = bookingCustomerCleanText(value);
    if (!text) return '';
    const safeText = escapeHtml(text);
    return `
        <div class="booking-selected-customer__fact">
            <span>${escapeHtml(label)}</span>
            <strong title="${safeText}">${safeText}</strong>
        </div>
    `;
}

function bookingSelectedCustomerNoteNeedsToggle(text) {
    const note = bookingCustomerCleanText(text);
    if (!note) return false;
    if (note.length > BOOKING_SELECTED_CUSTOMER_NOTE_EXPAND_THRESHOLD) return true;
    if (note.split(/\r\n|\r|\n/).length > 2) return true;
    return note.split(/\s+/).some(part => part.length > 44);
}

function bookingSelectedCustomerSafeNoteId(value) {
    return String(value || 'booking-selected-customer-note')
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || 'booking-selected-customer-note';
}

function bookingSelectedCustomerExpandableNoteHtml(text, options = {}) {
    const note = bookingCustomerCleanText(text);
    if (!note) return '';
    const tag = ['p', 'small'].includes(options.tag) ? options.tag : 'p';
    const noteId = bookingSelectedCustomerSafeNoteId(options.id);
    const longNote = bookingSelectedCustomerNoteNeedsToggle(note);
    const safeNote = escapeHtml(note);
    const safeId = escapeHtml(noteId);
    const className = [
        'booking-selected-customer__expandable-note',
        longNote ? 'is-clamped' : ''
    ].filter(Boolean).join(' ');
    return `
        <${tag} id="${safeId}" class="${className}" title="${safeNote}">${safeNote}</${tag}>
        ${longNote ? `
            <button type="button"
                class="booking-selected-customer__note-toggle"
                data-booking-note-toggle
                aria-expanded="false"
                aria-controls="${safeId}"
                data-expand-label="Показати повністю"
                data-collapse-label="Згорнути">
                Показати повністю
            </button>
        ` : ''}
    `;
}

function bookingSelectedCustomerNoteHtml(label, text) {
    const note = bookingCustomerCleanText(text);
    if (!note) return '';
    return `
        <div class="booking-selected-customer__note">
            <span>${escapeHtml(label)}</span>
            ${bookingSelectedCustomerExpandableNoteHtml(note, { id: 'booking-selected-customer-note-customer', tag: 'p' })}
        </div>
    `;
}

function setBookingSelectedCustomerNoteExpanded(button, expanded) {
    if (!button) return;
    const noteId = button.getAttribute?.('aria-controls') || '';
    const note = noteId ? document.getElementById(noteId) : null;
    if (!note) return;
    note.classList?.toggle?.('is-expanded', Boolean(expanded));
    note.classList?.toggle?.('is-clamped', !expanded);
    button.setAttribute?.('aria-expanded', expanded ? 'true' : 'false');
    const expandLabel = button.dataset?.expandLabel || 'Показати повністю';
    const collapseLabel = button.dataset?.collapseLabel || 'Згорнути';
    button.textContent = expanded ? collapseLabel : expandLabel;
}

function handleBookingSelectedCustomerNoteToggle(event) {
    const button = event?.currentTarget || event?.target;
    if (!button) return;
    const expanded = button.getAttribute?.('aria-expanded') === 'true';
    setBookingSelectedCustomerNoteExpanded(button, !expanded);
}

function bindBookingSelectedCustomerNoteToggles(card) {
    card?.querySelectorAll?.('[data-booking-note-toggle]')?.forEach(button => {
        button.addEventListener?.('click', handleBookingSelectedCustomerNoteToggle);
    });
}

function bookingCustomerKitchenNoteIsPriority(note) {
    const text = bookingCustomerCleanText(note).toLocaleLowerCase('uk-UA');
    if (!text) return false;
    return /алерг|аллерг|не можна|нельзя|заборон|без\s+(горіх|орех|арахіс|арахис|глютен|лактоз|молок|цукр|сахар|яєць|яиц|мед)|горіх|орех|арахіс|арахис|nut|peanut|gluten|lactose|milk|dairy|egg|seafood|fish|риба|морепроду|шоколад|полуниц|клубник|цитрус|діабет|диабет/.test(text);
}

function bookingCustomerKitchenNoteRows(customer = {}) {
    return bookingCustomerChildrenProjection(customer)
        .map((child, index) => {
            const note = bookingCustomerCleanText(child.note);
            const dietaryTags = bookingCustomerDietaryTags(child.dietaryTags);
            const dietaryNote = bookingCustomerCleanText(child.dietaryNote);
            const tagLabel = bookingCustomerDietaryTagsLabel(dietaryTags);
            if (!note && !dietaryTags.length && !dietaryNote) return null;
            const childLabel = bookingCustomerCleanText(child.name) || `Дитина ${index + 1}`;
            const noteParts = [
                tagLabel ? `Теги: ${tagLabel}` : '',
                dietaryNote ? `Харчова примітка: ${dietaryNote}` : '',
                note ? `Нотатка: ${note}` : ''
            ].filter(Boolean);
            return {
                childLabel,
                note: noteParts.join('; '),
                priority: Boolean(dietaryTags.length || dietaryNote || bookingCustomerKitchenNoteIsPriority(note))
            };
        })
        .filter(Boolean)
        .sort((a, b) => Number(b.priority) - Number(a.priority));
}

function bookingKitchenContextNotesInput() {
    return document.getElementById('bookingNotes') || null;
}

function bookingSelectedCustomerKitchenNoteBlock(customer = {}) {
    const rows = bookingCustomerKitchenNoteRows(customer);
    if (!rows.length) return '';
    return [
        'Важливо для кухні:',
        ...rows.map(row => `- ${row.childLabel}: ${row.note}`)
    ].join('\n');
}

function bookingKitchenContextNotesAlreadyAdded(noteBlock, currentValue) {
    const block = bookingCustomerCleanText(noteBlock).replace(/\r\n/g, '\n').replace(/\s+/g, '');
    if (!block) return false;
    return String(currentValue || '').replace(/\r\n/g, '\n').replace(/\s+/g, '').includes(block);
}

function bookingKitchenContextNotesValueForInput(noteBlock, input) {
    const block = String(noteBlock || '');
    if (String(input?.tagName || '').toUpperCase() === 'TEXTAREA') return block;
    return block.replace(/\r?\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function bookingKitchenContextNotesSeparatorForInput(input) {
    return String(input?.tagName || '').toUpperCase() === 'TEXTAREA' ? '\n\n' : ' | ';
}

function bookingSelectedCustomerContextFromCard(card = document.getElementById('bookingSelectedCustomerCard')) {
    if (typeof BookingDrawerState !== 'undefined' && BookingDrawerState.selectedCustomerContext) {
        return BookingDrawerState.selectedCustomerContext;
    }
    return card?.__bookingSelectedCustomerContext || null;
}

function bookingSelectedCustomerKitchenActionHtml(customer = {}) {
    if (typeof isBookingKitchenEnabled !== 'function' || !isBookingKitchenEnabled()) return '';
    if (!bookingKitchenContextNotesInput()) return '';
    const noteBlock = bookingSelectedCustomerKitchenNoteBlock(customer);
    if (!noteBlock) return '';
    const alreadyAdded = bookingKitchenContextNotesAlreadyAdded(noteBlock, bookingKitchenContextNotesInput().value);
    return `
        <div class="booking-selected-customer__kitchen-actions">
            <button type="button"
                class="booking-selected-customer__kitchen-add${alreadyAdded ? ' is-added' : ''}"
                data-booking-kitchen-context-add
                aria-pressed="${alreadyAdded ? 'true' : 'false'}">
                Додати в примітки кухні
            </button>
            <span class="booking-selected-customer__kitchen-status" aria-live="polite">${alreadyAdded ? 'Додано' : ''}</span>
        </div>
    `;
}

function setBookingKitchenContextAddState(button, added) {
    if (!button) return;
    button.classList?.toggle?.('is-added', Boolean(added));
    button.setAttribute?.('aria-pressed', added ? 'true' : 'false');
    const status = button.closest?.('.booking-selected-customer__kitchen-actions')
        ?.querySelector?.('.booking-selected-customer__kitchen-status');
    if (status) status.textContent = added ? 'Додано' : '';
}

function dispatchBookingKitchenNotesChanged(input) {
    if (!input?.dispatchEvent) return;
    ['input', 'change'].forEach(type => {
        const event = typeof Event === 'function'
            ? new Event(type, { bubbles: true })
            : { type };
        input.dispatchEvent(event);
    });
}

function appendBookingKitchenContextToNotes(customer = bookingSelectedCustomerContextFromCard(), button = null) {
    if (typeof isBookingKitchenEnabled !== 'function' || !isBookingKitchenEnabled()) return false;
    const input = bookingKitchenContextNotesInput();
    if (!input) return false;
    const noteBlock = bookingSelectedCustomerKitchenNoteBlock(customer);
    if (!noteBlock) return false;
    if (bookingKitchenContextNotesAlreadyAdded(noteBlock, input.value)) {
        setBookingKitchenContextAddState(button, true);
        return true;
    }
    const current = String(input.value || '').trimEnd();
    const valueBlock = bookingKitchenContextNotesValueForInput(noteBlock, input);
    input.value = current ? `${current}${bookingKitchenContextNotesSeparatorForInput(input)}${valueBlock}` : valueBlock;
    dispatchBookingKitchenNotesChanged(input);
    setBookingKitchenContextAddState(button, true);
    if (typeof window !== 'undefined' && window.BookingForm) window.BookingForm._dirty = true;
    if (typeof renderBookingPackageSummary === 'function') renderBookingPackageSummary();
    if (typeof updateBookingContextHeaderSummary === 'function') updateBookingContextHeaderSummary();
    return true;
}

function syncBookingSelectedCustomerLayoutState(hasSelected) {
    const section = document.getElementById('customerDataSection');
    if (!section) return;
    if (hasSelected) {
        section.classList.add('has-selected-customer');
    } else {
        section.classList.remove('has-selected-customer');
    }
}

function bookingSelectedCustomerKitchenHtml(customer = {}) {
    const rows = bookingCustomerKitchenNoteRows(customer);
    if (!rows.length) return '';
    const visible = rows.slice(0, 4);
    const hiddenCount = rows.length - visible.length;
    const rowHtml = visible.map(row => {
        const safeLabel = escapeHtml(row.childLabel);
        const safeNote = escapeHtml(row.note);
        return `
            <div class="booking-selected-customer__kitchen-row${row.priority ? ' is-priority' : ''}">
                <strong title="${safeLabel}">${safeLabel}</strong>
                <span title="${safeNote}">${safeNote}</span>
            </div>
        `;
    }).join('');
    return `
        <div class="booking-selected-customer__kitchen">
            <span class="booking-selected-customer__section-label">Важливо для кухні</span>
            ${rowHtml}
            ${hiddenCount > 0 ? `<small>+${escapeHtml(String(hiddenCount))} ще у списку дітей</small>` : ''}
            ${bookingSelectedCustomerKitchenActionHtml(customer)}
        </div>
    `;
}

function bookingSelectedCustomerDietaryHtml(child = {}) {
    const dietaryTags = bookingCustomerDietaryTags(child.dietaryTags);
    const dietaryNote = bookingCustomerCleanText(child.dietaryNote);
    if (!dietaryTags.length && !dietaryNote) return '';
    const tagHtml = dietaryTags.map(tag => {
        const label = bookingCustomerDietaryTagLabel(tag);
        return `<span class="booking-selected-customer__dietary-tag" title="${escapeHtml(label)}">${escapeHtml(label)}</span>`;
    }).join('');
    const safeDietaryNote = escapeHtml(dietaryNote);
    return `
        <div class="booking-selected-customer__dietary">
            ${tagHtml ? `<div class="booking-selected-customer__dietary-tags">${tagHtml}</div>` : ''}
            ${dietaryNote ? `<small class="booking-selected-customer__dietary-note" title="${safeDietaryNote}">${safeDietaryNote}</small>` : ''}
        </div>
    `;
}

function bookingSelectedCustomerChildrenHtml(customer = {}) {
    const children = bookingCustomerChildrenProjection(customer);
    if (!children.length) {
        return `
            <div class="booking-selected-customer__section">
                <span class="booking-selected-customer__section-label">Діти</span>
                <div class="booking-selected-customer__empty">Діти не вказані</div>
            </div>
        `;
    }

    const childRows = children.map((child, index) => {
        const line = bookingCustomerChildLine(child) || bookingCustomerCleanText(child.name) || 'Дитина';
        const note = bookingCustomerCleanText(child.note);
        const safeLine = escapeHtml(line);
        const dietary = bookingSelectedCustomerDietaryHtml(child);
        return `
            <div class="booking-selected-customer__child">
                <strong title="${safeLine}">${safeLine}</strong>
                ${dietary}
                ${note ? bookingSelectedCustomerExpandableNoteHtml(note, {
                    id: `booking-selected-customer-note-child-${index}`,
                    tag: 'small'
                }) : ''}
            </div>
        `;
    }).join('');

    return `
        <div class="booking-selected-customer__section">
            <span class="booking-selected-customer__section-label">Діти</span>
            <div class="booking-selected-customer__children">${childRows}</div>
        </div>
    `;
}

function renderSelectedCustomerCard(customer = null) {
    const card = document.getElementById('bookingSelectedCustomerCard');
    if (!card) return;
    if (!customer) {
        card.__bookingSelectedCustomerContext = null;
        if (typeof BookingDrawerState !== 'undefined') BookingDrawerState.selectedCustomerContext = null;
        syncBookingSelectedCustomerLayoutState(false);
        card.innerHTML = '';
        card.classList.add('hidden');
        return;
    }
    card.__bookingSelectedCustomerContext = customer;
    if (typeof BookingDrawerState !== 'undefined') BookingDrawerState.selectedCustomerContext = customer;
    syncBookingSelectedCustomerLayoutState(true);
    const name = bookingCustomerCleanText(customer.name) || 'Клієнт';
    const visits = bookingCustomerVisitLabel(customer.totalBookings ?? customer.total_bookings);
    const facts = [
        bookingSelectedCustomerFactHtml('Телефон', customer.phone ?? customer.customerPhone ?? customer.customer_phone),
        bookingSelectedCustomerFactHtml('Instagram', bookingCustomerInstagramDisplay(customer.instagram))
    ].filter(Boolean).join('');
    const notes = bookingSelectedCustomerNoteHtml('Примітки клієнта', customer.notes ?? customer.customerNotes ?? customer.customer_notes);
    const kitchenNotes = bookingSelectedCustomerKitchenHtml(customer);
    card.innerHTML = `
        <div class="booking-selected-customer__header">
            <strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
            ${visits ? `<span>${escapeHtml(visits)}</span>` : ''}
        </div>
        ${facts ? `<div class="booking-selected-customer__facts">${facts}</div>` : ''}
        ${kitchenNotes}
        ${notes}
        ${bookingSelectedCustomerChildrenHtml(customer)}
    `;
    card.classList.remove('hidden');
    card.querySelector?.('[data-booking-kitchen-context-add]')?.addEventListener?.('click', event => {
        appendBookingKitchenContextToNotes(bookingSelectedCustomerContextFromCard(card), event.currentTarget || event.target);
    });
    bindBookingSelectedCustomerNoteToggles(card);
}

function bookingCustomerDateOnly(value) {
    if (!value) return '';
    return String(value).trim().slice(0, 10);
}

function bookingCustomerChildrenProjection(customer = {}) {
    const explicit = Array.isArray(customer.children)
        ? customer.children
            .map(child => ({
                name: String(child?.name ?? child?.childName ?? child?.child_name ?? '').trim(),
                birthday: bookingCustomerDateOnly(child?.birthday ?? child?.birthDate ?? child?.childBirthday ?? child?.child_birthday),
                ageSnapshot: child?.ageSnapshot ?? child?.age_snapshot ?? null,
                note: child?.note ?? child?.notes ?? null,
                dietaryTags: bookingCustomerDietaryTags(child?.dietaryTags ?? child?.dietary_tags ?? child?.allergyTags ?? child?.allergy_tags ?? child?.allergens),
                dietaryNote: bookingCustomerCleanText(child?.dietaryNote ?? child?.dietary_note ?? child?.dietaryNotes ?? child?.dietary_notes ?? child?.foodNote ?? child?.food_note ?? child?.allergyNote ?? child?.allergy_note)
            }))
            .filter(bookingCustomerChildHasContext)
        : [];
    if (explicit.length) return explicit;

    const legacyName = String(customer.childName ?? customer.child_name ?? '').trim();
    const legacyBirthday = bookingCustomerDateOnly(customer.childBirthday ?? customer.child_birthday);
    if (!legacyName && !legacyBirthday) return [];
    return [{ name: legacyName, birthday: legacyBirthday, ageSnapshot: null, note: null, dietaryTags: [], dietaryNote: '', legacy: true }];
}

function bookingCustomerPrimaryChild(customer = {}) {
    return bookingCustomerChildrenProjection(customer)[0] || null;
}

function bookingCustomerChildrenDisplay(customer = {}, options = {}) {
    const limit = Number.isInteger(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 5;
    const names = bookingCustomerChildrenProjection(customer)
        .map(child => child.name)
        .filter(Boolean);
    if (!names.length) return '';
    const visible = names.slice(0, limit);
    return `${visible.join(', ')}${names.length > visible.length ? ` +${names.length - visible.length}` : ''}`;
}

function bookingCustomerChildAge(child = {}) {
    const birthday = bookingCustomerDateOnly(child.birthday);
    if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return null;
    const [year, month, day] = birthday.split('-').map(Number);
    const today = new Date();
    let age = today.getFullYear() - year;
    const passedBirthday = (today.getMonth() + 1 > month)
        || (today.getMonth() + 1 === month && today.getDate() >= day);
    if (!passedBirthday) age -= 1;
    return Number.isFinite(age) && age >= 0 ? age : null;
}

function bookingCustomerChildLine(child = {}) {
    const parts = [];
    if (child.name) parts.push(child.name);
    const birthday = bookingCustomerDateOnly(child.birthday);
    const age = child.ageSnapshot ?? bookingCustomerChildAge(child);
    if (age !== null && age !== undefined && age !== '') parts.push(`${age} р.`);
    if (birthday) parts.push(`ДН ${birthday}`);
    return parts.join(' · ');
}

function renderBookingCustomerSearchState(message = '', options = {}) {
    const state = document.getElementById('bookingCustomerSearchState');
    if (!state) return;
    if (!message) {
        state.classList.add('hidden');
        state.innerHTML = '';
    } else {
        state.textContent = message;
        state.classList.remove('hidden');
    }
}

function bookingCustomerDraftFromForm() {
    return {
        search: document.getElementById('customerSearch')?.value?.trim() || '',
        name: document.getElementById('customerName')?.value?.trim() || '',
        phone: document.getElementById('customerPhone')?.value?.trim() || '',
        instagram: document.getElementById('customerInstagram')?.value?.trim() || '',
        childName: document.getElementById('customerChildName')?.value?.trim() || '',
        childBirthday: document.getElementById('customerChildBirthday')?.value || '',
        source: document.getElementById('customerSource')?.value || ''
    };
}

function bookingNewCustomerDraftIsValid(draft = bookingCustomerDraftFromForm()) {
    return Boolean(String(draft?.name || '').trim());
}

function bookingCustomerPayloadFromDraft(draft = bookingCustomerDraftFromForm()) {
    if (!bookingNewCustomerDraftIsValid(draft)) return null;
    const customer = {
        name: String(draft.name || '').trim()
    };
    if (draft.phone) customer.phone = draft.phone;
    if (draft.instagram) customer.instagram = draft.instagram;
    if (draft.childName) customer.childName = draft.childName;
    if (draft.childBirthday) customer.childBirthday = draft.childBirthday;
    if (draft.source) customer.source = draft.source;
    return customer;
}

function addBookingValidationIssue(state, key, message, fields = []) {
    if (!state || !message) return;
    const issue = {
        key: key || `issue_${state.issues.length + 1}`,
        message,
        fields: (Array.isArray(fields) ? fields : [fields]).filter(Boolean)
    };
    state.issues.push(issue);
    if (!state.errors.includes(message)) state.errors.push(message);
    issue.fields.forEach(field => {
        if (!state.invalidFields.includes(field)) state.invalidFields.push(field);
    });
}

function selectedActivityScheduleValidationBlockers(formData = {}) {
    const programs = Array.isArray(formData.activityPrograms)
        ? formData.activityPrograms.filter(Boolean)
        : (typeof getSelectedActivityPrograms === 'function' ? getSelectedActivityPrograms() : []);
    if (!formData.hasEvent || !programs.length) return [];
    if (typeof getSelectedActivityScheduleRows !== 'function') return [];

    const rows = getSelectedActivityScheduleRows(programs);
    const blockers = [];
    const seen = new Set();
    const push = (row, message) => {
        if (!row || !message) return;
        const key = `${row.programId}:${message}`;
        if (seen.has(key)) return;
        seen.add(key);
        blockers.push({
            key: `activity_time_${row.programId}`,
            message,
            fields: [`activityTime:${row.programId}`]
        });
    };

    const workday = selectedActivityScheduleWorkday();
    rows.forEach(row => {
        const label = row.program?.code || row.program?.name || `активність #${row.index + 1}`;
        if (!row.time) push(row, `Вкажіть старт для ${label}.`);
        if (row.time && !isSelectedActivityScheduleSlotTime(row.time, row)) {
            push(row, `${label}: старт має бути в робочих годинах ${workday.start}-${workday.end} з кроком 15 хв.`);
        }
        if (row.duration <= 0) push(row, `${label}: некоректна тривалість.`);
        if (Number.isFinite(row.endMinutes) && row.endMinutes > workday.endMinutes) {
            push(row, `${label}: активність виходить за межі робочого дня (${workday.end}).`);
        }
        if (row.endMinutes > 1440) push(row, `${label}: активність виходить за межі дня.`);
        const issueText = typeof selectedActivityScheduleIssueText === 'function'
            ? selectedActivityScheduleIssueText(row.programId)
            : '';
        if (issueText) push(row, `${label}: ${issueText}`);
    });

    if (typeof selectedActivityScheduleOverlaps !== 'function') return blockers;
    for (let i = 0; i < rows.length; i += 1) {
        for (let j = i + 1; j < rows.length; j += 1) {
            if (!selectedActivityScheduleOverlaps(rows[i], rows[j])) continue;
            const firstLabel = rows[i].program?.code || rows[i].program?.name || `#${i + 1}`;
            const secondLabel = rows[j].program?.code || rows[j].program?.name || `#${j + 1}`;
            push(rows[i], `${firstLabel}: перетин з ${secondLabel}.`);
            push(rows[j], `${secondLabel}: перетин з ${firstLabel}.`);
        }
    }

    return blockers;
}

function getSmartBookingValidationState() {
    const formData = getBookingFormData();
    const presentation = window.TimelineBusinessContext?.presentation?.() || { mode: 'park' };
    const roomOptional = isOptionalTimelineRoomBookingMode(presentation);
    const hasDateTime = Boolean(formData?.time) && Boolean(AppState.selectedDate);
    const hasRoom = Boolean(formData?.room);
    const hasSelectedCustomer = Boolean(document.getElementById('selectedCustomerId')?.value);
    const customerDraft = bookingCustomerDraftFromForm();
    const hasNewCustomer = !hasSelectedCustomer
        && BookingDrawerState.clientMode === 'new'
        && bookingNewCustomerDraftIsValid(customerDraft);
    const hasClient = hasSelectedCustomer || hasNewCustomer;
    const isEducation = presentation.mode === 'education';
    const lessonTitle = document.getElementById('educationLessonTitle')?.value?.trim() || '';
    const hasProgram = Boolean(formData?.programId) || (isEducation && Boolean(lessonTitle));
    const programRequired = getBookingWorkspaceHasEvent();
    const primaryAnimatorRequired = false;
    const hasActivityPinataSubflow = typeof useSelectedActivityPinataSubflow === 'function'
        && useSelectedActivityPinataSubflow();
    const state = {
        warnings: [],
        errors: [],
        invalidFields: [],
        issues: []
    };

    if (!hasDateTime) addBookingValidationIssue(state, 'date_time', 'Не вдалося визначити дату або час для бронювання.', ['bookingTime']);
    if (!hasRoom && !roomOptional) {
        addBookingValidationIssue(state, 'room', presentation.mode === 'education' ? 'Оберіть кабінет.' : 'Оберіть кімнату.', ['roomSelect']);
    }
    if (!hasClient) {
        const hasSearchOnly = Boolean(customerDraft.search && !customerDraft.name);
        addBookingValidationIssue(state, 'client', hasSearchOnly
            ? 'Вкажіть імʼя нового клієнта або оберіть існуючого клієнта з пошуку.'
            : 'Оберіть існуючого клієнта з пошуку або введіть імʼя нового клієнта.', [hasSearchOnly ? 'customerName' : 'customerSearch']);
    }
    if (programRequired && !hasProgram) {
        addBookingValidationIssue(state, 'program', isEducation ? 'Оберіть заняття або вкажіть тему.' : 'Оберіть програму події.', [isEducation ? 'educationLessonTitle' : 'selectedProgram']);
    }
    if (primaryAnimatorRequired) {
        addBookingValidationIssue(state, 'primary_animator', 'Оберіть аніматора для активної програми.', ['bookingPrimaryAnimatorSelect']);
    }

    if (programRequired && formData?.program) {
        if (isPinataProgram(formData.program) && !hasActivityPinataSubflow) {
            if (!formData.pinataMode || formData.pinataMode === 'none') {
                addBookingValidationIssue(state, 'pinata_mode', 'Оберіть тип піньяти.', ['pinataMode']);
            }
            if (formData.pinataMode === 'park') {
                if (!formData.pinataNumber) {
                    addBookingValidationIssue(state, 'pinata_number', 'Оберіть номер піньяти парку.', ['pinataNumber']);
                }
                if (formData.program.hasFiller && !formData.pinataFiller) {
                    addBookingValidationIssue(state, 'pinata_filler', 'Оберіть наповнювач для піньяти.', ['pinataFillerSelect']);
                }
                if (formData.program.hasFiller && formData.pinataFiller && !formData.pinataFillerNumber) {
                    addBookingValidationIssue(state, 'pinata_filler_number', 'Оберіть номер наповнювача для піньяти.', ['pinataFillerNumber', 'pinataFillerSelect']);
                }
            }
        }

        if (Number(formData.program.hosts || 0) > 1 && !formData.secondAnimator) {
            addBookingValidationIssue(state, 'second_animator', 'Оберіть другого ведучого для цієї програми.', ['secondAnimatorSelect']);
        }
    }

    const extraHostToggle = document.getElementById('extraHostToggle');
    if (extraHostToggle?.checked && !document.getElementById('extraHostAnimatorSelect')?.value) {
        addBookingValidationIssue(state, 'extra_host', 'Оберіть додаткового ведучого або вимкніть додаткового ведучого.', ['extraHostAnimatorSelect']);
    }

    selectedActivityScheduleValidationBlockers(formData).forEach(issue => {
        addBookingValidationIssue(state, issue.key, issue.message, issue.fields);
    });
    if (typeof selectedActivityPinataValidationBlockers === 'function') {
        selectedActivityPinataValidationBlockers(formData).forEach(issue => {
            addBookingValidationIssue(state, issue.key, issue.message, issue.fields);
        });
    }
    if (typeof selectedActivitySecondAnimatorValidationBlockers === 'function') {
        selectedActivitySecondAnimatorValidationBlockers(formData).forEach(issue => {
            addBookingValidationIssue(state, issue.key, issue.message, issue.fields);
        });
    }

    const boundaryWarnings = bookingBoundaryWarningsForFormData(formData);
    boundaryWarnings.forEach(warning => {
        if (warning?.message && !state.warnings.includes(warning.message)) {
            state.warnings.push(warning.message);
        }
    });
    state.boundaryWarnings = boundaryWarnings;

    return {
        valid: state.errors.length === 0,
        canSubmit: state.errors.length === 0,
        warnings: state.warnings,
        boundaryWarnings: state.boundaryWarnings || [],
        errors: state.errors,
        issues: state.issues,
        invalidFields: state.invalidFields,
        error: state.errors[0] || ''
    };
}

function formatBookingValidationList(validation) {
    const errors = Array.isArray(validation?.issues) && validation.issues.length
        ? validation.issues.map(issue => issue.message).filter(Boolean)
        : (Array.isArray(validation?.errors) && validation.errors.length
            ? validation.errors
            : (validation?.error ? [validation.error] : []));
    return errors.map((error, index) => `${index + 1}. ${error}`).join('\n');
}

function renderBookingValidationIssues(validation) {
    const issues = Array.isArray(validation?.issues) && validation.issues.length
        ? validation.issues
        : (Array.isArray(validation?.errors) ? validation.errors.map((message, index) => ({ key: `error_${index}`, message })) : []);
    if (!issues.length) return '';
    return `
        <div class="booking-summary-note booking-summary-note--error booking-validation-checklist">
            <strong>Ще треба заповнити:</strong>
            <ul>
                ${issues.map(issue => `<li data-validation-key="${escapeHtml(String(issue.key || ''))}">${escapeHtml(issue.message || '')}</li>`).join('')}
            </ul>
        </div>
    `;
}

function bookingValidationFieldTarget(fieldId) {
    if (!fieldId) return null;
    if (String(fieldId).startsWith('activityTime:')) {
        const activityId = String(fieldId).slice('activityTime:'.length);
        return Array.from(document.querySelectorAll('[data-activity-time-id]'))
            .find(input => String(input.dataset.activityTimeId || '') === activityId) || null;
    }
    if (String(fieldId).startsWith('activityPinata:')) {
        const [, activityId, fieldName] = String(fieldId).split(':');
        const input = Array.from(document.querySelectorAll('[data-activity-pinata-id][data-activity-pinata-field]'))
            .find(item => String(item.dataset.activityPinataId || '') === activityId
                && String(item.dataset.activityPinataField || '') === fieldName);
        if (input) return input;
        return Array.from(document.querySelectorAll('[data-activity-pinata-id]'))
            .find(item => String(item.dataset.activityPinataId || '') === activityId) || null;
    }
    if (String(fieldId).startsWith('activitySecondAnimator:')) {
        const activityId = String(fieldId).slice('activitySecondAnimator:'.length);
        return Array.from(document.querySelectorAll('[data-activity-second-animator-id]'))
            .find(input => String(input.dataset.activitySecondAnimatorId || '') === activityId)
            || Array.from(document.querySelectorAll('[data-activity-second-host-id]'))
                .find(item => String(item.dataset.activitySecondHostId || '') === activityId)
            || null;
    }
    const direct = document.getElementById(fieldId);
    if (direct && direct.type !== 'hidden') return direct;
    const containerByField = {
        selectedProgram: 'programsIcons',
        pinataNumber: 'pinataDesignPicker',
        pinataFillerSelect: 'pinataFillerPicker',
        pinataFillerNumber: 'pinataFillerPicker',
        secondAnimatorSelect: 'secondAnimatorSection',
        extraHostAnimatorSelect: 'extraHostAnimatorSection'
    };
    const containerId = containerByField[fieldId];
    return containerId ? document.getElementById(containerId) : direct;
}

function applyBookingValidationInvalidFields(validation) {
    const fieldIds = [
        'roomSelect',
        'customerSearch',
        'customerName',
        'customerPhone',
        'customerInstagram',
        'selectedProgram',
        'bookingTime',
        'educationLessonTitle',
        'bookingPrimaryAnimatorSelect',
        'pinataMode',
        'pinataNumber',
        'pinataFillerSelect',
        'pinataFillerNumber',
        'secondAnimatorSelect',
        'extraHostAnimatorSelect'
    ];
    const invalid = new Set(validation?.invalidFields || []);
    fieldIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.setAttribute('aria-invalid', invalid.has(id) ? 'true' : 'false');
        const target = bookingValidationFieldTarget(id);
        if (target && target !== el) target.setAttribute('aria-invalid', invalid.has(id) ? 'true' : 'false');
    });
    document.querySelectorAll('[data-activity-time-id]').forEach(input => {
        const key = `activityTime:${input.dataset.activityTimeId || ''}`;
        input.setAttribute('aria-invalid', invalid.has(key) ? 'true' : 'false');
    });
    document.querySelectorAll('[data-activity-pinata-id][data-activity-pinata-field]').forEach(input => {
        const key = `activityPinata:${input.dataset.activityPinataId || ''}:${input.dataset.activityPinataField || ''}`;
        input.setAttribute('aria-invalid', invalid.has(key) ? 'true' : 'false');
    });
    document.querySelectorAll('[data-activity-pinata-id]:not([data-activity-pinata-field])').forEach(container => {
        const activityId = container.dataset.activityPinataId || '';
        const hasInvalid = Array.from(invalid).some(field => String(field).startsWith(`activityPinata:${activityId}:`));
        container.setAttribute('aria-invalid', hasInvalid ? 'true' : 'false');
    });
    document.querySelectorAll('[data-activity-second-animator-id]').forEach(input => {
        const key = `activitySecondAnimator:${input.dataset.activitySecondAnimatorId || ''}`;
        input.setAttribute('aria-invalid', invalid.has(key) ? 'true' : 'false');
    });
    document.querySelectorAll('[data-activity-second-host-id]').forEach(container => {
        const key = `activitySecondAnimator:${container.dataset.activitySecondHostId || ''}`;
        container.setAttribute('aria-invalid', invalid.has(key) ? 'true' : 'false');
    });
}

function focusFirstBookingInvalidField(validation) {
    const fields = Array.isArray(validation?.invalidFields) ? validation.invalidFields : [];
    const target = fields.map(bookingValidationFieldTarget).find(Boolean);
    if (!target) return;
    const focusable = target.matches?.('input, select, textarea, button, [tabindex]:not([tabindex="-1"])')
        ? target
        : target.querySelector?.('input:not([type="hidden"]), select, textarea, button, [tabindex]:not([tabindex="-1"])');
    target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    focusable?.focus?.({ preventScroll: true });
}

function showBookingValidationErrors(validation) {
    BookingDrawerState.validationAttempted = true;
    applyBookingValidationInvalidFields(validation);
    renderBookingPackageSummary();
    focusFirstBookingInvalidField(validation);
    const list = formatBookingValidationList(validation);
    const message = list
        ? `Не можна створити бронювання. Заповніть:\n${list}`
        : 'Перевірте форму бронювання.';
    showNotification(message, 'error');
    const hint = document.getElementById('bookingSubmitHint');
    if (hint) hint.textContent = validation?.error || 'Заповніть обовʼязкові поля.';
}

function getBookingWorkspaceScenario(options = {}) {
    const hasEvent = options.hasEvent !== undefined ? Boolean(options.hasEvent) : getBookingWorkspaceHasEvent();
    const hasKitchen = options.hasKitchen !== undefined ? Boolean(options.hasKitchen) : isBookingKitchenEnabled();
    if (hasEvent && hasKitchen) return 'event_kitchen';
    if (hasEvent) return 'event';
    if (hasKitchen) return 'kitchen_only';
    return 'lead_only';
}

function getBookingWorkspaceScenarioMeta(scenario) {
    const meta = {
        lead_only: {
            label: 'Заявка',
            text: 'Подія вимкнена: кімната вже вибрана, зберігаємо контакт, контекст і нотатки без програми.'
        },
        event: {
            label: 'Подія',
            text: 'Подія увімкнена: програма і ведучі входять у валідацію та збереження після вибору кімнати.'
        },
        kitchen_only: {
            label: 'Кухня',
            text: 'Кухонний сценарій без події: меню або торт зберігаються як комерційні позиції заявки.'
        },
        event_kitchen: {
            label: 'Подія + кухня',
            text: 'Змішаний сценарій: подія і кухонні позиції формують спільний підсумок.'
        }
    };
    return meta[scenario] || meta.lead_only;
}

function syncBookingWorkspaceMode(options = {}) {
    const eventFields = document.getElementById('bookingEventFields');
    const banquetFields = document.getElementById('banquetFields');
    const leadSection = document.getElementById('bookingLeadDetailsSection');
    const room = document.getElementById('roomSelect');
    const eventToggle = document.getElementById('bookingHasEventToggle');
    const kitchenToggle = document.getElementById('bookingKitchenToggle');
    const leadToggle = document.getElementById('bookingLeadDetailsToggle');
    const roomFirst = isRoomFirstTimelineView();
    const hasEvent = roomFirst ? false : true;
    const kitchenEnabled = roomFirst && timelineKitchenEnabled();
    if (eventToggle) eventToggle.checked = hasEvent;
    if (kitchenToggle) kitchenToggle.checked = kitchenEnabled;
    if (leadToggle) leadToggle.checked = false;
    if (eventFields) {
        eventFields.classList.toggle('hidden', roomFirst);
        eventFields.hidden = roomFirst;
    }
    if (banquetFields) {
        banquetFields.classList.toggle('hidden', !kitchenEnabled);
        banquetFields.hidden = !kitchenEnabled;
    }
    if (leadSection) {
        leadSection.classList.add('hidden');
        leadSection.open = false;
    }
    if (room) {
        room.required = true;
        room.setAttribute('aria-required', 'true');
    }
    syncBookingCommentFieldPresentation({
        hasEvent,
        kitchenEnabled,
        scenario: getBookingWorkspaceScenario({ hasEvent, positions: BookingPackageState.menuPositions, hasKitchen: kitchenEnabled })
    });
    const primaryAnimatorSection = document.getElementById('bookingPrimaryAnimatorSection');
    if (primaryAnimatorSection) {
        primaryAnimatorSection.classList.add('hidden');
    }
    renderBookingPackageSummary();
    if (kitchenEnabled) requestBookingEntryPriceRulesPreview();
    updateBookingSubmitState();
    const selectedCustomerContext = bookingSelectedCustomerContextFromCard();
    if (selectedCustomerContext && document.getElementById('selectedCustomerId')?.value) {
        renderSelectedCustomerCard(selectedCustomerContext);
    }
    if (options.markDirty && window.BookingForm) BookingForm._dirty = true;
}

function setBookingWorkspaceHasEvent(hasEvent, options = {}) {
    const toggle = document.getElementById('bookingHasEventToggle');
    if (toggle) toggle.checked = !isRoomFirstTimelineView();
    syncBookingWorkspaceMode(options);
}

function prepareMaysternyaBookingPanel(options = {}) {
    if (!isMaysternyaBookingContext()) return;
    const panel = document.getElementById('bookingPanel');
    if (panel) panel.classList.add('booking-panel--maysternya');

    ensureMaysternyaRoomOption(MAYSTERNYA_ONLINE_ROOM);
    setBookingWorkspaceHasEvent(true, { markDirty: false });

    const title = document.querySelector('#bookingPanel .panel-header h3');
    if (title && !AppState.editingBookingId) title.textContent = 'Онлайн запис';
    const submit = document.getElementById('bookingSubmitBtn');
    if (submit && !AppState.editingBookingId) {
        submit.textContent = 'Записати прийом';
        submit.dataset.readyText = submit.textContent;
    }

    const groupName = document.getElementById('bookingGroupName');
    if (groupName) groupName.placeholder = 'Тема запиту або коротка примітка';
    const notes = document.getElementById('bookingNotes');
    if (notes) notes.placeholder = 'Коментар для Олександри';
    const customerName = document.getElementById('customerName');
    if (customerName) customerName.placeholder = 'Імʼя клієнта';
    const phone = document.getElementById('customerPhone');
    if (phone) phone.placeholder = 'Телефон або WhatsApp';
    const customerMode = document.getElementById('bookingCustomerModeLabel');
    if (customerMode) customerMode.textContent = 'Опційно для онлайн-прийому';

    const shouldSelectDefault = options.selectDefaultProgram !== false
        && !document.getElementById('selectedProgram')?.value
        && getProductsSync().some(p => p.id === MAYSTERNYA_DEFAULT_PROGRAM_ID);
    if (shouldSelectDefault) {
        selectProgram(MAYSTERNYA_DEFAULT_PROGRAM_ID);
    }
    prepareTimelineQuickCloseTools(options);
    renderBookingPackageSummary();
}

function prepareTimelineQuickCloseTools(options = {}) {
    const tools = document.getElementById('maysternyaQuickBookingTools');
    if (!tools) return;
    const title = tools.querySelector('strong');
    const hint = tools.querySelector('small');
    const durationLabel = tools.querySelector('label span');
    const button = document.getElementById('maysternyaCloseSlotBtn');
    const lineName = options.line?.name || getSelectedTimelineResourceLine()?.name || getTimelineBookingPresentation().roomOptionLabel || 'Ресурс';
    if (isMaysternyaBookingContext()) {
        if (title) title.textContent = 'Онлайн прийом';
        if (hint) hint.textContent = 'Мінімальний запис для лінії Олександри';
        if (durationLabel) durationLabel.textContent = 'Закрити на';
        if (button) button.textContent = 'Закрити слот';
        return;
    }
    if (isEducationTimelineBookingMode()) {
        // Canonical quick-close label for education resource mode: Закрити кабінет
        if (title) title.textContent = 'Кабінет недоступний';
        if (hint) hint.textContent = `${lineName}: швидко закрийте час, якщо аудиторія зайнята або недоступна.`;
        if (durationLabel) durationLabel.textContent = 'Закрити на';
        if (button) button.textContent = 'Закрити кабінет';
        return;
    }
    if (isTimelineResourceBackedBookingMode()) {
        if (title) title.textContent = 'Ресурс недоступний';
        if (hint) hint.textContent = `${lineName}: швидко закрийте час без створення клієнтського запису.`;
        if (durationLabel) durationLabel.textContent = 'Закрити на';
        if (button) button.textContent = 'Закрити ресурс';
    }
}

function prepareDisplayModeBookingPanel(options = {}) {
    const presentation = getTimelineBookingPresentation();
    const panel = document.getElementById('bookingPanel');
    if (panel) {
        panel.classList.toggle('booking-panel--minimal-timeline', isMinimalTimelineBookingMode());
        panel.classList.toggle('booking-panel--education-timeline', isEducationTimelineBookingMode());
    }
    prepareEducationLessonPanel(options);
    if (isParkTimelineBookingMode()) return;

    const lineName = options.line?.name || presentation.roomOptionLabel || 'Кабінет';
    if (isEducationTimelineBookingMode()) {
        ensureTimelineRoomOption(lineName);
    } else {
        ensureTimelineRoomOption(isMaysternyaBookingContext() ? MAYSTERNYA_ONLINE_ROOM : presentation.roomOptionLabel);
    }
    setBookingWorkspaceHasEvent(true, { markDirty: false });
    setBookingKitchenEnabled(false, { markDirty: false });
    setBookingLeadDetailsEnabled(false, { markDirty: false });

    const title = document.querySelector('#bookingPanel .panel-header h3');
    if (title && !AppState.editingBookingId) title.textContent = presentation.bookingTitle;
    const submit = document.getElementById('bookingSubmitBtn');
    if (submit && !AppState.editingBookingId) {
        submit.textContent = presentation.submitLabel;
        submit.dataset.readyText = submit.textContent;
    }

    const groupName = document.getElementById('bookingGroupName');
    if (groupName) groupName.placeholder = isEducationTimelineBookingMode() ? 'Група, клас або курс' : 'Коротка тема запису';
    const notes = document.getElementById('bookingNotes');
    if (notes) notes.placeholder = isEducationTimelineBookingMode() ? 'Тема заняття, викладач або примітки' : 'Коментар до запису';
    const customerName = document.getElementById('customerName');
    if (customerName) customerName.placeholder = presentation.customerNameLabel;
    const phone = document.getElementById('customerPhone');
    if (phone) phone.placeholder = presentation.phoneLabel;
    const customerMode = document.getElementById('bookingCustomerModeLabel');
    if (customerMode) customerMode.textContent = isEducationTimelineBookingMode() ? 'Опційно для заняття' : 'Опційно для запису';
    prepareTimelineQuickCloseTools(options);
    renderBookingPackageSummary();
}

const EDUCATION_STAFF_KEYWORDS = [
    'teacher', 'mentor', 'instructor', 'coach', 'tutor',
    'викладач', 'вчитель', 'учитель', 'педагог', 'тренер', 'наставник'
];
let _educationLessonTeachersLoaded = false;
let _educationLessonTeachers = [];

function isEducationStaffMember(staff) {
    const haystack = [
        staff?.roleType, staff?.role_type, staff?.position, staff?.department,
        staff?.profession, staff?.specialization, staff?.name
    ].filter(Boolean).join(' ').toLowerCase();
    return EDUCATION_STAFF_KEYWORDS.some(keyword => haystack.includes(keyword));
}

function educationLessonDetailsFromBooking(booking = {}) {
    const extra = booking.extraData || booking.extra_data || {};
    return extra.educationLesson
        || extra.education_lesson
        || extra.bookingWorkspace?.lesson
        || {};
}

function normalizeEducationLessonRepeatEvery(value) {
    return ['daily', 'weekly', 'biweekly'].includes(value) ? value : 'weekly';
}

function educationLessonRepeatEveryLabel(value) {
    const normalized = normalizeEducationLessonRepeatEvery(value);
    if (normalized === 'daily') return 'Щодня';
    if (normalized === 'biweekly') return 'Раз на два тижні';
    return 'Щотижня';
}

function resetEducationLessonFields() {
    ['educationLessonTitle', 'educationLessonGroup', 'educationLessonCourse', 'educationLessonSeriesSize'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const teacher = document.getElementById('educationLessonTeacher');
    if (teacher) teacher.value = '';
    const repeatEvery = document.getElementById('educationLessonRepeatEvery');
    if (repeatEvery) repeatEvery.value = 'weekly';
    const type = document.getElementById('educationLessonType');
    if (type) type.value = 'lesson';
}

function setEducationTeacherOptions(teachers = []) {
    const select = document.getElementById('educationLessonTeacher');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">Без викладача</option>';
    teachers.forEach(staff => {
        const option = document.createElement('option');
        option.value = String(staff.id || staff.userId || staff.username || staff.name || '');
        option.textContent = staff.name || staff.fullName || staff.username || `ID ${option.value}`;
        option.dataset.staffName = option.textContent;
        select.appendChild(option);
    });
    if (current && Array.from(select.options).some(opt => opt.value === current)) {
        select.value = current;
    }
}

async function loadEducationLessonTeachers() {
    if (_educationLessonTeachersLoaded) {
        setEducationTeacherOptions(_educationLessonTeachers);
        return _educationLessonTeachers;
    }
    try {
        const response = await fetch(`${API_BASE}/staff?active=true`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('staff unavailable');
        const data = await response.json();
        const staff = Array.isArray(data.staff) ? data.staff : (Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []));
        const preferred = staff.filter(isEducationStaffMember);
        _educationLessonTeachers = (preferred.length ? preferred : staff)
            .filter(item => item && (item.id || item.userId || item.username || item.name))
            .sort((a, b) => String(a.name || a.username || '').localeCompare(String(b.name || b.username || ''), 'uk'));
        _educationLessonTeachersLoaded = true;
        setEducationTeacherOptions(_educationLessonTeachers);
        return _educationLessonTeachers;
    } catch (err) {
        _educationLessonTeachersLoaded = true;
        _educationLessonTeachers = [];
        setEducationTeacherOptions([]);
        return [];
    }
}

function syncEducationGroupToBookingGroup() {
    const lessonGroup = document.getElementById('educationLessonGroup')?.value?.trim() || '';
    const bookingGroup = document.getElementById('bookingGroupName');
    if (bookingGroup && lessonGroup && !bookingGroup.value.trim()) {
        bookingGroup.value = lessonGroup;
        bookingGroup.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function prepareEducationLessonPanel(options = {}) {
    const section = document.getElementById('educationLessonSection');
    if (!section) return;
    const enabled = isEducationTimelineBookingMode();
    section.classList.toggle('hidden', !enabled);
    section.setAttribute('aria-hidden', enabled ? 'false' : 'true');
    if (!enabled) return;

    const lineName = options.line?.name || getSelectedTimelineResourceLine()?.name || getTimelineBookingPresentation().roomOptionLabel || 'Кабінет';
    const group = document.getElementById('educationLessonGroup');
    if (group && !group.placeholder) group.placeholder = 'Група або клас';
    const title = document.getElementById('educationLessonTitle');
    if (title) title.placeholder = `Заняття у ${lineName}`;
    const kidsSection = document.getElementById('kidsCountSection');
    if (kidsSection) kidsSection.classList.remove('hidden');
    const kidsLabel = kidsSection?.querySelector('label');
    if (kidsLabel) kidsLabel.textContent = 'Кількість учнів';
    const kidsInput = document.getElementById('kidsCountInput');
    if (kidsInput) kidsInput.placeholder = 'Кількість учнів';
    loadEducationLessonTeachers();
}

function getEducationLessonDetails(formData = {}) {
    if (!isEducationTimelineBookingMode()) return null;
    const teacherSelect = document.getElementById('educationLessonTeacher');
    const selectedTeacher = teacherSelect?.selectedOptions?.[0];
    const teacherId = teacherSelect?.value || '';
    const teacherName = teacherId
        ? (selectedTeacher?.dataset.staffName || selectedTeacher?.textContent || '').trim()
        : '';
    const seriesSize = parseInt(document.getElementById('educationLessonSeriesSize')?.value || '1', 10);
    const resource = getSelectedTimelineResourceLine();
    const groupName = document.getElementById('educationLessonGroup')?.value?.trim()
        || document.getElementById('bookingGroupName')?.value?.trim()
        || '';
    return {
        schemaVersion: 1,
        mode: 'education_lesson',
        lessonType: document.getElementById('educationLessonType')?.value || 'lesson',
        title: document.getElementById('educationLessonTitle')?.value?.trim() || formData.program?.name || formData.label || '',
        teacherId: teacherId || null,
        teacherName: teacherName || null,
        groupName: groupName || null,
        courseCode: document.getElementById('educationLessonCourse')?.value?.trim() || null,
        seriesSize: Number.isFinite(seriesSize) && seriesSize > 0 ? Math.min(seriesSize, 120) : 1,
        repeatEvery: normalizeEducationLessonRepeatEvery(document.getElementById('educationLessonRepeatEvery')?.value || 'weekly'),
        studentCount: resolveBookingChildrenCountSource({ kitchenEnabled: false, standaloneEditable: true }).value || null,
        resourceId: formData.lineId || document.getElementById('bookingLine')?.value || null,
        resourceName: resource?.name || formData.room || document.getElementById('roomSelect')?.value || null,
        source: 'education_timeline_booking'
    };
}

function hydrateEducationLessonFields(booking = {}) {
    const lesson = educationLessonDetailsFromBooking(booking);
    if (!lesson || Object.keys(lesson).length === 0) return;
    const title = document.getElementById('educationLessonTitle');
    if (title) title.value = lesson.title || '';
    const group = document.getElementById('educationLessonGroup');
    if (group) group.value = lesson.groupName || booking.groupName || '';
    const course = document.getElementById('educationLessonCourse');
    if (course) course.value = lesson.courseCode || '';
    const seriesSize = document.getElementById('educationLessonSeriesSize');
    if (seriesSize) seriesSize.value = lesson.seriesSize || '';
    const repeatEvery = document.getElementById('educationLessonRepeatEvery');
    if (repeatEvery) repeatEvery.value = normalizeEducationLessonRepeatEvery(lesson.repeatEvery || 'weekly');
    const type = document.getElementById('educationLessonType');
    if (type) type.value = lesson.lessonType || 'lesson';
    const teacher = document.getElementById('educationLessonTeacher');
    if (teacher && lesson.teacherId) {
        const applyTeacher = () => {
            if (!Array.from(teacher.options).some(opt => opt.value === String(lesson.teacherId))) {
                const opt = document.createElement('option');
                opt.value = String(lesson.teacherId);
                opt.textContent = lesson.teacherName || String(lesson.teacherId);
                opt.dataset.staffName = opt.textContent;
                teacher.appendChild(opt);
            }
            teacher.value = String(lesson.teacherId);
        };
        if (_educationLessonTeachersLoaded) applyTeacher();
        else loadEducationLessonTeachers().then(applyTeacher);
    }
}

function bookingKitchenType(product) {
    const raw = product?.kitchenType || product?.kitchen_type || product?.category || '';
    if (raw === 'cake') return 'cake';
    if (raw === 'menu') return 'menu';
    return 'menu';
}

function normalizeBookingCountValue(value) {
    const count = parseInt(value, 10);
    return Number.isFinite(count) && count > 0 ? count : null;
}

function getBookingChildrenCountInputValue() {
    return normalizeBookingCountValue(document.getElementById('kidsCountInput')?.value);
}

function getKitchenChildrenCountInputValue() {
    return normalizeBookingCountValue(document.getElementById('banquetGuests')?.value);
}

function bookingProgramUsesStandaloneChildrenInput(program = null) {
    const educationMode = typeof isEducationTimelineBookingMode === 'function'
        ? isEducationTimelineBookingMode()
        : false;
    return Boolean(program?.perChild || educationMode);
}

function resolveBookingChildrenCountSource(options = {}) {
    const kitchenEnabled = options.kitchenEnabled ?? isBookingKitchenEnabled();
    const standaloneEditable = options.standaloneEditable ?? bookingProgramUsesStandaloneChildrenInput(options.program || null);
    const kitchenValue = options.kitchenValue !== undefined
        ? normalizeBookingCountValue(options.kitchenValue)
        : getKitchenChildrenCountInputValue();
    const standaloneValue = options.standaloneValue !== undefined
        ? normalizeBookingCountValue(options.standaloneValue)
        : getBookingChildrenCountInputValue();
    const fallbackValue = options.fallbackValue !== undefined
        ? normalizeBookingCountValue(options.fallbackValue)
        : null;

    if (kitchenEnabled) {
        return {
            source: 'kitchen',
            value: kitchenValue || fallbackValue || null,
            kitchenValue,
            standaloneValue,
            showStandaloneInput: false,
            editableElementId: 'banquetGuests'
        };
    }

    if (standaloneEditable) {
        const value = standaloneValue || fallbackValue || kitchenValue || null;
        return {
            source: standaloneValue ? 'kidsCount' : (kitchenValue ? 'legacyBanquetGuests' : 'kidsCount'),
            value,
            kitchenValue,
            standaloneValue,
            showStandaloneInput: true,
            editableElementId: 'kidsCountInput'
        };
    }

    const value = fallbackValue || kitchenValue || standaloneValue || null;
    return {
        source: kitchenValue ? 'legacyBanquetGuests' : (standaloneValue ? 'kidsCount' : 'none'),
        value,
        kitchenValue,
        standaloneValue,
        showStandaloneInput: false,
        editableElementId: null
    };
}

function shouldShowStandaloneKidsCountInput(program = null, options = {}) {
    return resolveBookingChildrenCountSource({ ...options, program }).showStandaloneInput;
}

function bookingChildrenCountFromBooking(booking = {}) {
    const value = booking?.kidsCount ?? booking?.kids_count ?? booking?.banquetGuests ?? booking?.banquet_guests;
    return value === null || value === undefined ? '' : String(value);
}

function bookingKitchenChildrenCountFromBooking(booking = {}) {
    const value = booking?.banquetGuests ?? booking?.banquet_guests ?? booking?.kidsCount ?? booking?.kids_count;
    return value === null || value === undefined ? '' : String(value);
}

function bookingKitchenTypeLabel(type) {
    return type === 'cake' ? 'Торт' : 'Меню';
}

function toBookingMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
}

const BOOKING_MENU_PORTION_UNITS = new Set(['порція', 'порції', 'порцій', 'порц', 'portion', 'portions']);
const BOOKING_MENU_ADDON_UNITS = new Set(['додаток', 'додатки', 'додатків']);

function formatBookingMenuQuantityNumber(value) {
    const quantity = Math.max(Number(value || 1), 0.1);
    const rounded = Math.round(quantity * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
}

function bookingMenuPortionWord(value) {
    const quantity = Math.max(Number(value || 1), 0.1);
    const rounded = Math.round(quantity * 100) / 100;
    if (!Number.isInteger(rounded)) return 'порції';
    const absolute = Math.abs(rounded);
    const lastTwo = absolute % 100;
    const last = absolute % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return 'порцій';
    if (last === 1) return 'порція';
    if (last >= 2 && last <= 4) return 'порції';
    return 'порцій';
}

function bookingMenuAddonWord(value) {
    const quantity = Math.max(Number(value || 1), 0.1);
    const rounded = Math.round(quantity * 100) / 100;
    if (!Number.isInteger(rounded)) return 'додатки';
    const absolute = Math.abs(rounded);
    const lastTwo = absolute % 100;
    const last = absolute % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return 'додатків';
    if (last === 1) return 'додаток';
    if (last >= 2 && last <= 4) return 'додатки';
    return 'додатків';
}

function normalizeBookingMenuServingUnitDisplay(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.replace(/^(\d+(?:[,.]\d+)?)\s*(кг|г|гр|мг|л|мл)$/iu, '$1 $2');
}

function isBookingMenuPortionServingUnit(value) {
    const unit = normalizeBookingMenuServingUnitDisplay(value).toLowerCase().replace(/\.$/, '');
    return !unit || BOOKING_MENU_PORTION_UNITS.has(unit);
}

function isBookingMenuAddonServingUnit(value) {
    const unit = normalizeBookingMenuServingUnitDisplay(value).toLowerCase().replace(/\.$/, '');
    return BOOKING_MENU_ADDON_UNITS.has(unit);
}

function isBookingMenuPackServingUnit(value) {
    return /^\d+(?:[,.]\d+)?\s*(кг|г|гр|мг|л|мл)$/iu.test(normalizeBookingMenuServingUnitDisplay(value));
}

function formatBookingMenuQuantityWithServingUnit(quantity, servingUnit) {
    const quantityLabel = formatBookingMenuQuantityNumber(quantity);
    const unit = normalizeBookingMenuServingUnitDisplay(servingUnit);
    if (isBookingMenuPortionServingUnit(unit)) return `${quantityLabel} ${bookingMenuPortionWord(quantity)}`;
    if (isBookingMenuAddonServingUnit(unit)) return `${quantityLabel} ${bookingMenuAddonWord(quantity)}`;
    if (isBookingMenuPackServingUnit(unit)) return `${quantityLabel} ${bookingMenuPortionWord(quantity)} по ${unit}`;
    return `${quantityLabel} ${unit}`.trim();
}

function formatBookingMenuPositionQuantity(item = {}) {
    return formatBookingMenuQuantityWithServingUnit(
        item.quantity ?? item.qty,
        item.servingUnit || item.serving_unit || item.priceUnit || item.price_unit
    );
}

function isBookingMenuCatalogProduct(product = {}) {
    const type = bookingKitchenType(product);
    const isKitchenMenu = product.domain === 'kitchen' && (type === 'menu' || type === 'cake');
    return (isKitchenMenu || product.category === 'menu' || product.category === 'cake')
        && product.isActive !== false
        && product.availabilityStatus !== 'hidden'
        && product.availabilityStatus !== 'sold_out';
}

function getBookingMenuProductsFromList(products = []) {
    return products
        .filter(isBookingMenuCatalogProduct)
        .sort((a, b) => {
            const typeCompare = bookingKitchenType(a).localeCompare(bookingKitchenType(b), 'uk');
            return typeCompare
                || String(a.menuSection || '').localeCompare(String(b.menuSection || ''), 'uk')
                || (a.sortOrder || 0) - (b.sortOrder || 0);
        });
}

function getBookingMenuProducts() {
    if (!timelineKitchenEnabled()) return [];
    const products = typeof getProductsSync === 'function' ? getProductsSync() : [];
    return getBookingMenuProductsFromList(Array.isArray(products) ? products : []);
}

function normalizeBookingMenuPosition(raw, index = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const title = String(raw.title || raw.label || raw.name || '').trim();
    if (!title) return null;
    const quantity = Math.max(Number(raw.quantity || raw.qty || 1), 0.1);
    const unitPrice = toBookingMoney(raw.unitPrice ?? raw.unit_price ?? raw.price);
    const servingTime = normalizeBookingServingTime(raw.servingTime || raw.serving_time);
    const servingGroupId = String(raw.servingGroupId || raw.serving_group_id || raw.servingBatchId || raw.serving_batch_id || '').trim() || null;
    return {
        id: raw.id || `menu-${Date.now()}-${index}`,
        productId: raw.productId || raw.product_id || null,
        code: raw.code || raw.productCode || null,
        title,
        quantity: Math.round(quantity * 100) / 100,
        unitPrice,
        subtotal: toBookingMoney(raw.subtotal ?? quantity * unitPrice),
        note: String(raw.note || raw.notes || '').trim() || null,
        menuSection: raw.menuSection || raw.menu_section || null,
        servingUnit: raw.servingUnit || raw.serving_unit || raw.priceUnit || null,
        kitchenType: raw.kitchenType || raw.kitchen_type || raw.itemType || 'menu',
        servingTime,
        servingNote: String(raw.servingNote || raw.serving_note || '').trim() || null,
        servingGroupId,
        servingBatchId: String(raw.servingBatchId || raw.serving_batch_id || servingGroupId || '').trim() || null,
        weightValue: raw.weightValue || raw.weight_value || null,
        cakeDecoration: raw.cakeDecoration || raw.cake_decoration || null,
        source: raw.source || (raw.productId || raw.product_id ? 'product' : 'custom')
    };
}

function normalizeBookingServingTime(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return match ? `${match[1]}:${match[2]}` : null;
}

function bookingServingGroupId(value) {
    const time = normalizeBookingServingTime(value);
    return time ? `serve-${time.replace(':', '')}` : null;
}

function getBookingDefaultServingTime() {
    return normalizeBookingServingTime(
        document.getElementById('bookingTime')?.value
        || AppState.selectedCell?.dataset?.time
    );
}

const BOOKING_SERVICE_EVENT_TYPES = {
    cake: 'Винос торта',
    custom: 'Інше',
    food_service: 'Видача страв',
    drinks: 'Напої',
    room_setup: 'Підготувати кімнату'
};

const BOOKING_SERVICE_EVENT_CREATE_TYPES = ['food_service', 'drinks', 'room_setup', 'custom'];

function normalizeBookingServiceEvent(raw, index = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const rawType = raw.type || raw.eventType || raw.event_type;
    const type = Object.prototype.hasOwnProperty.call(BOOKING_SERVICE_EVENT_TYPES, rawType)
        ? rawType
        : 'custom';
    const title = String(raw.title || raw.label || BOOKING_SERVICE_EVENT_TYPES[type] || 'Подія').trim();
    if (!title) return null;
    const duration = Number(raw.durationMinutes || raw.duration_minutes);
    return {
        id: String(raw.id || raw.uid || `service-event-${Date.now()}-${index}`),
        type,
        title,
        time: normalizeBookingServingTime(raw.time || raw.servingTime || raw.serving_time),
        durationMinutes: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
        relatedMenuPositionIds: Array.isArray(raw.relatedMenuPositionIds || raw.related_menu_position_ids)
            ? (raw.relatedMenuPositionIds || raw.related_menu_position_ids).map(item => String(item || '').trim()).filter(Boolean)
            : [],
        note: String(raw.note || raw.notes || raw.comment || '').trim() || null,
        status: ['planned', 'done', 'skipped'].includes(raw.status) ? raw.status : 'planned',
        source: raw.source || 'booking_workspace'
    };
}

function getBookingServiceEvents() {
    if (!Array.isArray(BookingPackageState.serviceEvents)) BookingPackageState.serviceEvents = [];
    return BookingPackageState.serviceEvents.map((item, index) => normalizeBookingServiceEvent(item, index)).filter(Boolean);
}

const BOOKING_CREATE_PAST_VALIDATION_TIME_ZONE = 'Europe/Kyiv';

function bookingCreateKyivClock(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: BOOKING_CREATE_PAST_VALIDATION_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(now).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
    }, {});
    const hour = Number(parts.hour || 0);
    const minute = Number(parts.minute || 0);
    const second = Number(parts.second || 0);
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        seconds: (hour * 3600) + (minute * 60) + second
    };
}

function bookingCreateTimeSeconds(time) {
    const normalized = normalizeBookingServingTime(time);
    if (!normalized) return null;
    const [hour, minute] = normalized.split(':').map(Number);
    return (hour * 3600) + (minute * 60);
}

function shouldUseKitchenOperationalCreateTime(formData = {}) {
    return formData.kitchenEnabled === true
        || String(formData.scenario || '').trim().toLowerCase() === 'kitchen_only'
        || String(formData.lineId || '').trim() === ROOM_FIRST_BANQUET_SERVICE_LINE_ID;
}

function bookingCreateOperationalTimeCandidates(formData = {}) {
    const candidates = [];
    if (Array.isArray(formData.menuPositions)) {
        formData.menuPositions.forEach(item => {
            const time = normalizeBookingServingTime(item?.servingTime || item?.serving_time);
            if (time) candidates.push({ time, label: 'Час видачі' });
        });
    }
    if (Array.isArray(formData.serviceEvents)) {
        formData.serviceEvents.forEach(item => {
            const time = normalizeBookingServingTime(item?.time || item?.servingTime || item?.serving_time);
            if (time) candidates.push({ time, label: 'Час події' });
        });
    }
    return candidates;
}

function bookingCreateTimeCandidates(formData = {}) {
    const operationalCandidates = shouldUseKitchenOperationalCreateTime(formData)
        ? bookingCreateOperationalTimeCandidates(formData)
        : [];
    if (operationalCandidates.length) return operationalCandidates;
    const fallbackTime = normalizeBookingServingTime(formData.time);
    return fallbackTime ? [{ time: fallbackTime, label: 'Час бронювання' }] : [];
}

function bookingCreatePastValidationError(formData = {}, selectedDate = AppState.selectedDate, now = new Date()) {
    if (!selectedDate) return null;
    const date = typeof selectedDate === 'string' ? selectedDate : formatDate(selectedDate);
    const kyivNow = bookingCreateKyivClock(now);
    const pastCandidate = bookingCreateTimeCandidates(formData).find(candidate => {
        if (date < kyivNow.date) return true;
        if (date > kyivNow.date) return false;
        const seconds = bookingCreateTimeSeconds(candidate.time);
        return seconds !== null && seconds < kyivNow.seconds;
    });
    if (!pastCandidate) return null;
    return `${pastCandidate.label} ${pastCandidate.time} вже в минулому. Оберіть майбутній час.`;
}

function setBookingServiceEvents(events, { render = true } = {}) {
    BookingPackageState.serviceEvents = (Array.isArray(events) ? events : [])
        .map((item, index) => normalizeBookingServiceEvent(item, index))
        .filter(Boolean);
    if (render) renderBookingMenuPositions();
}

function getBookingMenuPositions() {
    return BookingPackageState.menuPositions.map((item, index) => normalizeBookingMenuPosition(item, index)).filter(Boolean);
}

function bookingMenuPositionsSubtotal(positions = getBookingMenuPositions()) {
    return toBookingMoney(positions.reduce((sum, item) => sum + toBookingMoney(item.subtotal), 0));
}

function bookingEntryNormalizeDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDate(value);
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
}

function bookingEntryDateType(value = AppState.selectedDate) {
    const dateText = bookingEntryNormalizeDate(value);
    if (!dateText) return null;
    const [year, month, day] = dateText.split('-').map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return weekday === 0 || weekday === 6 ? 'weekend' : 'weekday';
}

function bookingEntryPriceRuleRows() {
    const candidates = [
        BookingDrawerState.entryPriceRules,
        window.BOOKING_ENTRY_PRICE_RULES,
        window.BANQUET_ENTRY_PRICE_RULES,
        window.bookingEntryPriceRules,
        AppState.priceRules,
        AppState.centerPrices
    ];
    const byCode = new Map();
    candidates.forEach(source => {
        (Array.isArray(source) ? source : []).forEach(rule => {
            const code = String(rule?.code || '').trim();
            if (code && !byCode.has(code)) byCode.set(code, rule);
        });
    });
    return [...byCode.values()];
}

function normalizeBookingEntryPriceRule(rule = {}) {
    const code = String(rule.code || '').trim();
    if (!Object.values(BOOKING_ENTRY_PRICE_RULE_CODES).includes(code)) return null;
    const value = Number(rule.value);
    if (!Number.isFinite(value) || value < 0) return null;
    return {
        ...rule,
        code,
        value,
        unit: rule.unit || 'грн/дитина',
        category: rule.category || 'banquet'
    };
}

function mergeBookingEntryPriceRules(rules = []) {
    const byCode = new Map((Array.isArray(BookingDrawerState.entryPriceRules) ? BookingDrawerState.entryPriceRules : [])
        .map(rule => [String(rule?.code || '').trim(), rule])
        .filter(([code]) => code));
    (Array.isArray(rules) ? rules : []).forEach(rule => {
        const normalized = normalizeBookingEntryPriceRule(rule);
        if (normalized) byCode.set(normalized.code, normalized);
    });
    BookingDrawerState.entryPriceRules = Object.values(BOOKING_ENTRY_PRICE_RULE_CODES)
        .map(code => byCode.get(code))
        .filter(Boolean);
    BookingDrawerState.entryPriceRulesLoaded = Object.values(BOOKING_ENTRY_PRICE_RULE_CODES)
        .every(code => BookingDrawerState.entryPriceRules.some(rule => rule.code === code));
    return BookingDrawerState.entryPriceRules;
}

function bookingEntryPriceRulesNeedFetch() {
    const existingCodes = new Set(bookingEntryPriceRuleRows().map(rule => String(rule?.code || '').trim()).filter(Boolean));
    return Object.values(BOOKING_ENTRY_PRICE_RULE_CODES).filter(code => !existingCodes.has(code));
}

function shouldRenderBookingEntryPreviewAfterLoad() {
    const panel = document.getElementById('bookingPanel');
    return Boolean(panel && !panel.classList.contains('hidden') && isBookingKitchenEnabled());
}

async function preloadBookingEntryPriceRules(options = {}) {
    if (!options.force && !isBookingKitchenEnabled()) return false;
    const missingCodes = bookingEntryPriceRulesNeedFetch();
    if (!missingCodes.length) {
        BookingDrawerState.entryPriceRulesLoaded = true;
        return true;
    }
    if (BookingDrawerState.entryPriceRulesPromise) return BookingDrawerState.entryPriceRulesPromise;
    if (typeof apiGetCenterPriceRule !== 'function') {
        BookingDrawerState.entryPriceRulesError = 'entry_price_rules_api_missing';
        return false;
    }
    BookingDrawerState.entryPriceRulesLoading = true;
    BookingDrawerState.entryPriceRulesError = null;
    BookingDrawerState.entryPriceRulesPromise = (async () => {
        try {
            const results = await Promise.all(missingCodes.map(code => apiGetCenterPriceRule(code)));
            const loadedRules = results
                .map((result, index) => (result?.success ? (result.price || { ...result, code: missingCodes[index] }) : null))
                .filter(Boolean);
            mergeBookingEntryPriceRules(loadedRules);
            const failed = results.find(result => !result?.success);
            if (failed) BookingDrawerState.entryPriceRulesError = failed.error || failed.code || 'entry_price_rules_unavailable';
            if (loadedRules.length && options.render !== false && shouldRenderBookingEntryPreviewAfterLoad()) {
                renderBookingPackageSummary();
            }
            return loadedRules.length === missingCodes.length;
        } catch (err) {
            BookingDrawerState.entryPriceRulesError = err?.message || 'entry_price_rules_unavailable';
            return false;
        } finally {
            BookingDrawerState.entryPriceRulesLoading = false;
            BookingDrawerState.entryPriceRulesPromise = null;
        }
    })();
    return BookingDrawerState.entryPriceRulesPromise;
}

function requestBookingEntryPriceRulesPreview() {
    if (!isBookingKitchenEnabled()) return;
    preloadBookingEntryPriceRules({ render: true }).catch(err => {
        BookingDrawerState.entryPriceRulesError = err?.message || 'entry_price_rules_unavailable';
    });
}

function bookingEntryPriceRuleForDate(dateValue = AppState.selectedDate) {
    const dateType = bookingEntryDateType(dateValue);
    if (!dateType) return null;
    const code = BOOKING_ENTRY_PRICE_RULE_CODES[dateType];
    const rule = bookingEntryPriceRuleRows().find(item => String(item?.code || '').trim() === code);
    const value = Number(rule?.value);
    if (!rule || !Number.isFinite(value) || value < 0) return null;
    return {
        code,
        dateType,
        unitPrice: toBookingMoney(value)
    };
}

function bookingEntryNormalizeTitle(value) {
    return String(value || '')
        .normalize('NFC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function bookingEntryIdentifier(value) {
    const text = String(value || '').trim().toLowerCase();
    return text === 'entry'
        || text === 'banquet_entry'
        || text === BOOKING_ENTRY_PRICE_RULE_SOURCE
        || Object.values(BOOKING_ENTRY_PRICE_RULE_CODES).includes(text);
}

function bookingMenuPositionIsEntry(item = {}) {
    if (!item || typeof item !== 'object') return false;
    if (item.isEntryCharge === true || item.entryCharge === true || item.entry_charge === true) return true;
    if (bookingEntryIdentifier(item.source) || bookingEntryIdentifier(item.type) || bookingEntryIdentifier(item.kitchenType || item.kitchen_type)) return true;
    if (bookingEntryIdentifier(item.id) || bookingEntryIdentifier(item.productId || item.product_id) || bookingEntryIdentifier(item.code || item.productCode || item.product_code)) return true;
    return bookingEntryNormalizeTitle(item.title || item.label || item.name || item.productName) === 'вхід';
}

function bookingEntryQuantityFromForm() {
    const roomSource = BookingDrawerState.roomSelectionBanquetContext?.sourceBooking || null;
    const resolvedChildrenCount = resolveBookingChildrenCountSource({
        fallbackValue: roomSource?.kidsCount ?? roomSource?.kids_count ?? roomSource?.banquetGuests ?? roomSource?.banquet_guests
    }).value;
    if (resolvedChildrenCount) return resolvedChildrenCount;
    const values = [
        roomSource?.kidsCount,
        roomSource?.kids_count,
        roomSource?.banquetGuests,
        roomSource?.banquet_guests
    ];
    for (const value of values) {
        const count = normalizeBookingCountValue(value);
        if (count) return count;
    }
    return null;
}

function getBookingEntryChargeEstimate(positions = getBookingMenuPositions()) {
    if (!isBookingKitchenEnabled()) return { entryCharge: null, entrySubtotal: 0, warnings: [] };
    if ((positions || []).some(bookingMenuPositionIsEntry)) {
        return {
            entryCharge: null,
            entrySubtotal: 0,
            warnings: [{
                code: 'manual_entry_position_present',
                message: 'У меню вже є позиція "Вхід", автоматичний вхід не додається.'
            }]
        };
    }
    const rule = bookingEntryPriceRuleForDate(AppState.selectedDate);
    const quantity = bookingEntryQuantityFromForm();
    if (!rule || !quantity) return { entryCharge: null, entrySubtotal: 0, warnings: [] };
    const subtotal = toBookingMoney(quantity * rule.unitPrice);
    return {
        entryCharge: {
            title: 'Вхід',
            quantity,
            unitPrice: rule.unitPrice,
            subtotal,
            ruleCode: rule.code,
            dateType: rule.dateType,
            source: BOOKING_ENTRY_PRICE_RULE_SOURCE
        },
        entrySubtotal: subtotal,
        warnings: []
    };
}

function bookingMenuPositionsToLegacyText(positions = getBookingMenuPositions()) {
    return positions.map(item => {
        const price = item.unitPrice ? ` × ${item.unitPrice} грн` : '';
        const note = item.note ? ` (${item.note})` : '';
        return `${item.title} - ${formatBookingMenuPositionQuantity(item)}${price}${note}`;
    }).join('\n');
}

function renderBookingMenuProductOptions() {
    const select = document.getElementById('bookingMenuProductSelect');
    if (!select) return;
    const current = select.value;
    const products = getBookingMenuProducts();
    const groups = new Map();
    products.forEach(product => {
        const type = bookingKitchenType(product);
        const sectionPrefix = type === 'cake' ? 'Торти' : 'Меню';
        const section = `${sectionPrefix}${product.menuSection ? ` · ${product.menuSection}` : ''}`;
        if (!groups.has(section)) groups.set(section, []);
        groups.get(section).push(product);
    });
    select.innerHTML = '<option value="">Оберіть позицію з меню або торт</option>';
    groups.forEach((items, section) => {
        const group = document.createElement('optgroup');
        group.label = section;
        items.forEach(product => {
            const opt = document.createElement('option');
            opt.value = product.id;
            opt.textContent = `${product.name || product.label || product.code} - ${formatPrice(product.price || 0)}`;
            opt.dataset.price = String(product.price || 0);
            opt.dataset.title = product.name || product.label || product.code || product.id;
            opt.dataset.kitchenType = bookingKitchenType(product);
            group.appendChild(opt);
        });
        select.appendChild(group);
    });
    if (current && products.some(p => p.id === current)) select.value = current;
    renderBookingMenuCatalog();
}

function bookingMenuProductTitle(product = {}) {
    return String(product.name || product.label || product.code || product.id || '').trim();
}

function bookingMenuSafeImageUrl(value) {
    const url = String(value || '').trim();
    if (!url) return '';
    return /^(https?:|data:image\/|\/|uploads\/|images\/)/i.test(url) ? url : '';
}

function bookingMenuImageManifestUrl(product = {}) {
    const manifest = (typeof window !== 'undefined' && window.KITCHEN_MENU_IMAGES) ? window.KITCHEN_MENU_IMAGES : null;
    if (!manifest) return '';
    const basePath = String(manifest.basePath || '/images/kitchen-menu/').replace(/\/?$/, '/');
    const byId = manifest.byId || {};
    const byCode = manifest.byCode || {};
    const byName = manifest.byName || {};
    const nameKey = String(bookingMenuProductTitle(product)).trim().toLowerCase();
    const manifestValue = byId[String(product.id || '')]
        || byCode[String(product.code || '').trim().toUpperCase()]
        || byCode[String(product.code || '').trim()]
        || byName[nameKey]
        || '';
    if (!manifestValue) return '';
    const url = bookingMenuSafeImageUrl(manifestValue);
    if (url) return url;
    return bookingMenuSafeImageUrl(`${basePath}${String(manifestValue).replace(/^\/+/, '')}`);
}

function bookingMenuProductExplicitImageUrl(product = {}) {
    return bookingMenuSafeImageUrl(
        product.imageUrl
        || product.image_url
        || product.photoUrl
        || product.photo_url
        || product.coverUrl
        || product.cover_url
        || product.thumbnailUrl
        || product.thumbnail_url
        || product.iconUrl
        || product.icon_url
        || ''
    );
}

function bookingMenuProductImageUrl(product = {}) {
    return bookingMenuProductExplicitImageUrl(product);
}

function bookingMenuProductImageFallbackUrl(product = {}, currentUrl = '') {
    return '';
}

function bookingMenuProductEmoji(product = {}) {
    const icon = String(product.icon || product.emoji || '').trim();
    if (icon) return Array.from(icon).slice(0, 4).join('');
    const text = [
        bookingMenuProductTitle(product),
        product.menuSection,
        product.menu_section,
        product.category,
        product.kitchenType,
        product.kitchen_type
    ].filter(Boolean).join(' ').toLowerCase();
    if (/торт|cake|нутел|наполеон|прага|медовик|естерхаз|орео|чіз|чиз|йогурт|десерт/.test(text)) return '🎂';
    if (/піца|пиц|pizza/.test(text)) return '🍕';
    if (/бургер|burger/.test(text)) return '🍔';
    if (/картоп|фрі|fri|fries|діпи|гарнір|пюре/.test(text)) return '🍟';
    if (/салат|цезар|salad/.test(text)) return '🥗';
    if (/кава|американо|еспресо|капуч|лате|чай|coffee|tea/.test(text)) return '☕';
    if (/сік|сок|лимонад|молочн|коктейл|вода|напій|напої|juice|drink|cola/.test(text)) return '🥤';
    if (/сир|закуск|нагет|фрі|гаряч/.test(text)) return '🍽️';
    return bookingKitchenType(product) === 'cake' ? '🎂' : '🍽️';
}

const BOOKING_MENU_CATALOG_FALLBACK_IMAGE = '';

function bookingMenuCatalogVisualHtml(product = {}, title = '', modifier = '') {
    const productImageUrl = bookingMenuProductImageUrl(product);
    const imageUrl = productImageUrl;
    const manifestFallbackUrl = '';
    const usesFallback = false;
    const emoji = bookingMenuProductEmoji(product);
    const classes = [
        'booking-menu-catalog-thumb',
        imageUrl ? 'has-image' : '',
        usesFallback ? 'uses-fallback-image' : '',
        modifier
    ].filter(Boolean).join(' ');
    return `
        <div class="${classes}" title="${escapeHtml(title || bookingMenuProductTitle(product) || 'Позиція меню')}">
            ${imageUrl
                ? `<img loading="lazy" decoding="async" src="${escapeHtml(imageUrl)}" alt="" data-menu-catalog-fallback="${usesFallback ? '1' : '0'}" data-menu-catalog-next-src="${escapeHtml(manifestFallbackUrl)}" onerror="window.bookingMenuCatalogHandleImageError && window.bookingMenuCatalogHandleImageError(this)">`
                : ''}
            <span aria-hidden="true">${escapeHtml(emoji)}</span>
        </div>
    `;
}

function bookingMenuCatalogHandleImageError(img) {
    const thumb = img?.closest?.('.booking-menu-catalog-thumb');
    if (!img || !thumb) return;
    const nextSrc = bookingMenuSafeImageUrl(img.dataset.menuCatalogNextSrc || '');
    if (nextSrc && img.getAttribute('src') !== nextSrc) {
        img.dataset.menuCatalogNextSrc = '';
        img.src = nextSrc;
        thumb.classList.add('uses-manifest-fallback-image');
        return;
    }
    thumb.classList.add('is-image-missing');
    img.removeAttribute('src');
}

if (typeof window !== 'undefined') {
    window.bookingMenuCatalogHandleImageError = bookingMenuCatalogHandleImageError;
}

const BOOKING_MENU_CATALOG_ALL_FILTER = { key: 'all', label: 'Усе' };
const BOOKING_MENU_CATALOG_CAKE_FILTER = { key: 'cake', label: 'Торти' };
const BOOKING_MENU_CATALOG_OTHER_FILTER = { key: 'section:other-menu', label: 'Інше меню' };
const BOOKING_MENU_CATALOG_ADMIN_REVIEW_ACTIONS_ENABLED = false;
const BOOKING_MENU_CATALOG_FOOD_SECTION_FILTERS = [
    {
        key: 'section:cold-appetizers',
        label: 'Холодні закуски',
        aliases: ['холодні закуски'],
        patterns: [/закуск|плато|нарізк|брускет|канап|оливки|сирн/]
    },
    {
        key: 'section:salads',
        label: 'Салати',
        aliases: ['салати'],
        patterns: [/салат|цезар|грецьк|овочев/]
    },
    {
        key: 'section:hot-appetizers',
        label: 'Гарячі закуски',
        aliases: ['гарячі закуски'],
        patterns: [/гаряч.*закуск|нагет|крил|сирн.*пал|кільц|лаваш|кесадил|жульєн|жульен/]
    },
    {
        key: 'section:burgers',
        label: 'Бургери',
        aliases: ['бургери'],
        patterns: [/бургер|burger/]
    },
    {
        key: 'section:pizza',
        label: 'Піца',
        aliases: ['піца', 'пицца', 'pizza'],
        patterns: [/піца|пиц|pizza|маргарит|пеперон|чотири сир|гавайськ/]
    },
    {
        key: 'section:pizza-addons',
        label: 'До піци',
        aliases: ['додатки до піци', 'додатки до пиц', 'до піци'],
        patterns: [/бортик|додат.*піц|соус.*піц|до піц|моцарел|пармезан/]
    },
    {
        key: 'section:grill',
        label: 'Мангал',
        aliases: ['мангальне меню', 'мангал'],
        patterns: [/мангал|шашлик|гриль|люля|ребер|ковбаск|барбекю/]
    },
    {
        key: 'section:mains',
        label: 'Основні',
        aliases: ['основні страви', 'основные блюда'],
        patterns: [/паста|стейк|котлет|курк|свинин|теляч|риба|основн/]
    },
    {
        key: 'section:soups',
        label: 'Перші',
        aliases: ['перші страви', 'первые блюда'],
        patterns: [/суп|борщ|бульйон|крем-суп|перш/]
    },
    {
        key: 'section:sides',
        label: 'Гарніри',
        aliases: ['гарніри'],
        patterns: [/гарнір|картоп|фрі|діпи|рис|пюре|овочі гриль/]
    },
    {
        key: 'section:hot-drinks',
        label: 'Гарячі напої',
        aliases: ['гарячі напої'],
        patterns: [/чай|кава|американо|еспресо|капуч|лате|какао|гаряч.*нап/]
    },
    {
        key: 'section:cold-drinks',
        label: 'Холодні напої',
        aliases: ['коктейлі та холодні напої', 'холодні напої', 'коктейлі'],
        patterns: [/сік|сок|вода|лимонад|коктейл|молочн|морс|компот|кола|cola|швепс|schweppes|холодн.*нап/]
    },
    {
        key: 'section:cake-decorations',
        label: 'Оформлення торта',
        aliases: ['оформлення торта', 'оформлення', 'декор', 'декор торта'],
        patterns: [/оформл|декор|солодощ|ягід|ягод|рисов|картинк|крем\s*\+\s*напис|крем.*напис|напис.*торт|індивідуальн/]
    }
];
const BOOKING_MENU_CATALOG_INSIGHT_MODES = Object.freeze({
    details: {
        label: 'Відкрити',
        title: 'Деталі по блюду',
        badge: 'деталі',
        status: 'Сценарій для короткої картки страви',
        aiBlockKey: 'nameDescription'
    },
    promo: {
        label: 'Промо',
        title: 'Промо-опис',
        badge: 'промо',
        status: 'Сценарій для продаючого опису',
        aiBlockKey: 'nameDescription'
    },
    allergens: {
        label: 'Алергени',
        title: 'Перевірка алергенів',
        badge: 'алергени',
        status: 'Сценарій для технічної перевірки складу',
        aiBlockKey: 'allergens'
    },
    pairings: {
        label: 'Комбінації',
        title: 'З чим комбінувати',
        badge: 'комбо',
        status: 'Сценарій для рекомендацій у замовленні',
        aiBlockKey: 'priceCost'
    }
});

function bookingMenuProductCatalogText(product = {}) {
    return [
        bookingMenuProductTitle(product),
        product.code,
        product.label,
        product.category,
        product.domain,
        product.menuSection || product.menu_section,
        product.shortDescription,
        product.description,
        bookingKitchenTypeLabel(bookingKitchenType(product))
    ].filter(Boolean).join(' ').toLowerCase();
}

function bookingMenuCatalogNormalizeText(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/ʼ/g, "'")
        .replace(/\s+/g, ' ');
}

function bookingMenuCatalogSectionFilterByKey(key) {
    return BOOKING_MENU_CATALOG_FOOD_SECTION_FILTERS.find(item => item.key === key) || null;
}

function bookingMenuCatalogSectionFilterByLabel(label = '') {
    const normalized = bookingMenuCatalogNormalizeText(label);
    if (!normalized) return null;
    return BOOKING_MENU_CATALOG_FOOD_SECTION_FILTERS.find(item => {
        if (bookingMenuCatalogNormalizeText(item.label) === normalized) return true;
        return (item.aliases || []).some(alias => bookingMenuCatalogNormalizeText(alias) === normalized);
    }) || null;
}

function bookingMenuCatalogInferSectionFilter(product = {}) {
    const exact = bookingMenuCatalogSectionFilterByLabel(product.menuSection || product.menu_section || '');
    if (exact) return exact;
    const text = bookingMenuCatalogNormalizeText(bookingMenuProductCatalogText(product));
    if (!text) return null;
    return BOOKING_MENU_CATALOG_FOOD_SECTION_FILTERS.find(item => (item.patterns || []).some(pattern => pattern.test(text))) || null;
}

function bookingMenuProductCatalogFilter(product = {}) {
    const type = bookingKitchenType(product);
    if (type === 'cake' || product.category === 'cake') return 'cake';
    const section = bookingMenuCatalogInferSectionFilter(product);
    if (section) return section.key;
    if (type === 'menu' || product.domain === 'kitchen' || product.category === 'menu') return BOOKING_MENU_CATALOG_OTHER_FILTER.key;
    return BOOKING_MENU_CATALOG_OTHER_FILTER.key;
}

function bookingMenuCatalogFilterLabel(filter) {
    if (filter === BOOKING_MENU_CATALOG_ALL_FILTER.key) return BOOKING_MENU_CATALOG_ALL_FILTER.label;
    if (filter === BOOKING_MENU_CATALOG_CAKE_FILTER.key) return BOOKING_MENU_CATALOG_CAKE_FILTER.label;
    if (filter === BOOKING_MENU_CATALOG_OTHER_FILTER.key) return BOOKING_MENU_CATALOG_OTHER_FILTER.label;
    return bookingMenuCatalogSectionFilterByKey(filter)?.label || BOOKING_MENU_CATALOG_OTHER_FILTER.label;
}

function bookingMenuCatalogSelectedIds() {
    return new Set(getBookingMenuPositions()
        .map(item => String(item.productId || ''))
        .filter(Boolean));
}

function bookingMenuCatalogMatchesFilter(product = {}, filter = 'all', products = getBookingMenuProducts()) {
    if (filter === 'all') return true;
    if (filter === 'cake') return bookingMenuProductCatalogFilter(product) === 'cake';
    return bookingMenuProductCatalogFilter(product) === filter;
}

function bookingMenuCatalogTabs(products = getBookingMenuProducts()) {
    const tabs = [{
        ...BOOKING_MENU_CATALOG_ALL_FILTER,
        count: products.length
    }];
    BOOKING_MENU_CATALOG_FOOD_SECTION_FILTERS.forEach(section => {
        const count = products.filter(product => bookingMenuCatalogMatchesFilter(product, section.key, products)).length;
        if (count > 0) tabs.push({ key: section.key, label: section.label, count });
    });
    const cakeCount = products.filter(product => bookingMenuCatalogMatchesFilter(product, 'cake', products)).length;
    if (cakeCount > 0) tabs.push({ ...BOOKING_MENU_CATALOG_CAKE_FILTER, count: cakeCount });
    const otherCount = products.filter(product => bookingMenuCatalogMatchesFilter(product, BOOKING_MENU_CATALOG_OTHER_FILTER.key, products)).length;
    if (otherCount > 0) tabs.push({ ...BOOKING_MENU_CATALOG_OTHER_FILTER, count: otherCount });
    return tabs;
}

function bookingMenuCatalogSearchText(product = {}) {
    return bookingMenuProductCatalogText(product);
}

function bookingMenuCatalogPositionIndex(productId, positions = getBookingMenuPositions()) {
    return positions.findIndex(item => String(item.productId || '') === String(productId || ''));
}

function bookingMenuCatalogPosition(productId, positions = getBookingMenuPositions()) {
    const index = bookingMenuCatalogPositionIndex(productId, positions);
    return index >= 0 ? positions[index] : null;
}

function bookingMenuCatalogProductById(productId) {
    return getBookingMenuProducts().find(item => String(item.id || '') === String(productId || '')) || null;
}

function bookingMenuCatalogInsightActionsHtml(product = {}, title = '') {
    if (!BOOKING_MENU_CATALOG_ADMIN_REVIEW_ACTIONS_ENABLED) return '';
    const productId = String(product.id || '').trim();
    if (!productId) return '';
    const safeTitle = escapeHtml(title || bookingMenuProductTitle(product) || 'позиція меню');
    return `
        <div class="booking-menu-catalog-actions" aria-label="Дії для ${safeTitle}">
            ${Object.entries(BOOKING_MENU_CATALOG_INSIGHT_MODES).map(([mode, config]) => `
                <button type="button" class="booking-menu-catalog-action booking-menu-catalog-action--${escapeHtml(mode)}"
                    data-menu-catalog-insight="${escapeHtml(mode)}"
                    data-menu-catalog-product-id="${escapeHtml(productId)}"
                    aria-label="${escapeHtml(config.title)}: ${safeTitle}">
                    ${escapeHtml(config.label)}
                </button>
            `).join('')}
        </div>
    `;
}

function bookingMenuCatalogInsightContext(product = {}) {
    const title = bookingMenuProductTitle(product) || 'Позиція меню';
    const typeLabel = bookingKitchenTypeLabel(bookingKitchenType(product));
    const section = product.menuSection || product.menu_section || product.section || '';
    const unit = product.servingUnit || product.priceUnit || product.unit || '';
    const weightValue = product.weightValue || product.weight_value || '';
    const price = toBookingMoney(product.price || product.unitPrice || 0);
    return {
        title,
        typeLabel,
        section,
        unit,
        weightValue,
        price,
        code: product.code || '',
        description: product.description || product.shortDescription || product.label || '',
        ingredients: product.ingredients || product.composition || '',
        techCard: product.techCard || product.tech_card || '',
        allergens: product.allergens || [],
        category: product.category || product.domain || ''
    };
}

function bookingMenuCatalogPromptFor(product = {}, mode = 'details') {
    const config = BOOKING_MENU_CATALOG_INSIGHT_MODES[mode] || BOOKING_MENU_CATALOG_INSIGHT_MODES.details;
    const ctx = bookingMenuCatalogInsightContext(product);
    const base = [
        `Страва: ${ctx.title}`,
        `Тип: ${ctx.typeLabel}`,
        ctx.section ? `Розділ меню: ${ctx.section}` : '',
        ctx.unit ? `Одиниця продажу: ${ctx.unit}` : '',
        ctx.weightValue ? `Вага/вихід: ${ctx.weightValue}` : '',
        ctx.price ? `Поточна ціна в CRM: ${formatPrice(ctx.price)}` : '',
        ctx.code ? `Код позиції: ${ctx.code}` : '',
        ctx.category ? `Категорія/домен: ${ctx.category}` : '',
        ctx.description ? `Опис із CRM: ${ctx.description}` : '',
        ctx.ingredients ? `Склад із CRM: ${ctx.ingredients}` : '',
        ctx.techCard ? `Техкарта: ${ctx.techCard}` : '',
        Array.isArray(ctx.allergens) && ctx.allergens.length ? `Алергени: ${ctx.allergens.map(item => item.label || item.name || item.key || item).join(', ')}` : ''
    ].filter(Boolean).join('\n');
    const sharedRules = [
        'Пиши українською для оператора Event Genix.',
        'Не вигадуй склад, вагу, сертифікацію або медичні твердження, якщо цього немає у вхідних даних.',
        'Якщо даних бракує, окремо переліч питання, які має підтвердити людина.',
        'Фінальний текст має бути придатний для ручної перевірки перед публікацією в CRM.'
    ].join('\n');
    const tasks = {
        details: [
            'Задача: підготуй компактну картку деталей страви для оператора.',
            'Формат відповіді:',
            '1. Короткий опис для менеджера.',
            '2. Що уточнити перед замовленням.',
            '3. Як краще показати цю позицію клієнту.'
        ].join('\n'),
        promo: [
            'Задача: підготуй 3 промо-описи для продажу цієї позиції.',
            'Формат відповіді:',
            '1. Короткий опис до 120 символів.',
            '2. Теплий опис для батьків.',
            '3. Дуже коротка фраза для меню/месенджера.',
            'Не обіцяй властивості, яких немає у вхідних даних.'
        ].join('\n'),
        allergens: [
            'Задача: склади чекліст потенційних алергенів і ризиків для кухні.',
            'Формат відповіді:',
            '1. Потенційні алергени, які треба перевірити.',
            '2. Що уточнити у кухні або постачальника.',
            '3. Безпечне формулювання для CRM після людського підтвердження.',
            'Обовʼязково додай, що це не медична порада і фінальний склад має підтвердити відповідальна людина.'
        ].join('\n'),
        pairings: [
            'Задача: запропонуй, з чим краще комбінувати цю позицію у дитячому парку.',
            'Формат відповіді:',
            '1. 3 комбінації з їжею/напоями/тортом.',
            '2. Для яких сценаріїв події підходить кожна комбінація.',
            '3. Що запропонувати як upsell без навʼязування.'
        ].join('\n')
    };
    return [
        `Режим: ${config.title}`,
        '',
        'Вхідні дані з CRM:',
        base,
        '',
        tasks[mode] || tasks.details,
        '',
        'Правила:',
        sharedRules,
        '',
        'Після відповіді людина має перевірити факти й тільки тоді переносити текст у CRM.'
    ].join('\n');
}

function bookingMenuCatalogAiBlockKey(mode = 'details') {
    return BOOKING_MENU_CATALOG_INSIGHT_MODES[mode]?.aiBlockKey || 'nameDescription';
}

function bookingMenuCatalogAiBusinessContext() {
    if (typeof getTimelineProductsBusinessContext === 'function') {
        return getTimelineProductsBusinessContext();
    }
    return AppState.productsBusinessContext || 'event_genix';
}

function bookingMenuCatalogCurrentCardForAi(product = {}, mode = 'details') {
    const ctx = bookingMenuCatalogInsightContext(product);
    return {
        id: product.id || null,
        productId: product.id || null,
        code: ctx.code || product.code || '',
        name: ctx.title,
        title: ctx.title,
        domain: product.domain || 'kitchen',
        category: product.category || '',
        kitchenType: bookingKitchenType(product),
        menuSection: ctx.section,
        price: ctx.price,
        unit: ctx.unit,
        weightValue: ctx.weightValue,
        servingUnit: product.servingUnit || product.priceUnit || product.unit || '',
        shortDescription: product.shortDescription || product.short_description || '',
        description: product.description || ctx.description || '',
        promoDescription: product.promoDescription || product.promo_description || '',
        ingredients: product.ingredients || product.composition || '',
        techCard: product.techCard || product.tech_card || '',
        allergens: product.allergens || [],
        priceVariantNote: product.priceVariantNote || product.price_variant_note || '',
        source: 'booking-menu-catalog',
        promptMode: mode,
        operatorPrompt: bookingMenuCatalogPromptFor(product, mode)
    };
}

function bookingMenuCatalogInsightDraftBlock(insight = {}) {
    const blockKey = bookingMenuCatalogAiBlockKey(insight.mode);
    return insight.draft?.blocks?.[blockKey] || null;
}

function bookingMenuCatalogInsightApprovedBlocks(insight = {}) {
    const blockKey = bookingMenuCatalogAiBlockKey(insight.mode);
    const block = bookingMenuCatalogInsightDraftBlock(insight);
    const data = block?.proposal || {};
    if (!block || !Object.keys(data).length) return {};
    return {
        [blockKey]: {
            key: blockKey,
            status: 'approved',
            approvedAt: new Date().toISOString(),
            data
        }
    };
}

function bookingMenuCatalogInsightDraftText(insight = {}) {
    const blockKey = bookingMenuCatalogAiBlockKey(insight.mode);
    const proposal = bookingMenuCatalogInsightDraftBlock(insight)?.proposal || {};
    if (!Object.keys(proposal).length) return '';
    if (blockKey === 'nameDescription') {
        return [
            proposal.name ? `Назва: ${proposal.name}` : '',
            proposal.shortDescription ? `Коротко: ${proposal.shortDescription}` : '',
            proposal.description ? `Опис: ${proposal.description}` : '',
            proposal.promoDescription ? `Промо: ${proposal.promoDescription}` : ''
        ].filter(Boolean).join('\n\n');
    }
    if (blockKey === 'allergens') {
        const allergens = Array.isArray(proposal.allergens) ? proposal.allergens : [];
        return allergens.length
            ? allergens.map(item => {
                const label = item.label || item.name || item.key || 'Алерген';
                return `• ${label}${item.reason ? ` — ${item.reason}` : ''}`;
            }).join('\n')
            : 'AI не знайшов явних алергенів. Перевірте склад вручну.';
    }
    if (blockKey === 'priceCost') {
        return [
            proposal.suggestedPrice ? `Рекомендована ціна: ${proposal.suggestedPrice}` : '',
            proposal.estimatedCost !== null && proposal.estimatedCost !== undefined ? `Оцінка собівартості: ${proposal.estimatedCost}` : '',
            proposal.priceVariantNote ? `Комбінації / upsell: ${proposal.priceVariantNote}` : '',
            proposal.note ? `Коментар: ${proposal.note}` : ''
        ].filter(Boolean).join('\n\n') || JSON.stringify(proposal, null, 2);
    }
    if (blockKey === 'ingredients') {
        const rows = Array.isArray(proposal.ingredients) ? proposal.ingredients : [];
        return rows.length
            ? rows.map(row => `• ${row.label || row.name || 'Інгредієнт'} — ${row.quantity || ''} ${row.unit || ''}${row.notes ? ` (${row.notes})` : ''}`.trim()).join('\n')
            : JSON.stringify(proposal, null, 2);
    }
    return JSON.stringify(proposal, null, 2);
}

function closeBookingMenuCatalogInsight() {
    window.clearTimeout(BookingPackageState.catalogInsightNudgeTimer);
    BookingPackageState.catalogInsightNudgeTimer = null;
    BookingPackageState.catalogInsight = null;
    renderBookingMenuCatalogInsight();
}

function nudgeBookingMenuCatalogInsightCard() {
    const card = document.querySelector('#bookingMenuInsightPanel .booking-menu-insight-card');
    if (!card) return;
    card.classList.remove('is-nudged');
    void card.offsetWidth;
    card.classList.add('is-nudged');
    window.clearTimeout(BookingPackageState.catalogInsightNudgeTimer);
    BookingPackageState.catalogInsightNudgeTimer = window.setTimeout(() => {
        card.classList.remove('is-nudged');
    }, 260);
}

function setBookingMenuCatalogInsight(productId, mode = 'details') {
    const product = bookingMenuCatalogProductById(productId);
    if (!product || !BOOKING_MENU_CATALOG_INSIGHT_MODES[mode]) {
        closeBookingMenuCatalogInsight();
        return;
    }
    BookingPackageState.catalogInsight = {
        productId: String(product.id || productId),
        mode,
        approved: false,
        copied: false,
        generating: false,
        saving: false,
        saved: false,
        error: '',
        draft: null,
        approvedBlocks: {}
    };
    renderBookingMenuCatalogInsight();
    setTimeout(() => document.getElementById('bookingMenuInsightPrompt')?.focus(), 0);
}

function bookingMenuCatalogCurrentInsight() {
    const insight = BookingPackageState.catalogInsight;
    if (!insight) return null;
    const product = bookingMenuCatalogProductById(insight.productId);
    const config = BOOKING_MENU_CATALOG_INSIGHT_MODES[insight.mode];
    if (!product || !config) return null;
    return {
        ...insight,
        product,
        config,
        prompt: bookingMenuCatalogPromptFor(product, insight.mode),
        aiBlockKey: bookingMenuCatalogAiBlockKey(insight.mode)
    };
}

function renderBookingMenuCatalogInsight() {
    const panel = document.getElementById('bookingMenuInsightPanel');
    const body = document.getElementById('bookingMenuInsightBody');
    const title = document.getElementById('bookingMenuInsightTitle');
    if (!panel || !body || !title) return;
    const insight = bookingMenuCatalogCurrentInsight();
    if (!insight) {
        panel.hidden = true;
        panel.classList.add('hidden');
        panel.setAttribute('aria-hidden', 'true');
        body.innerHTML = '';
        return;
    }
    const productContext = bookingMenuCatalogInsightContext(insight.product);
    panel.hidden = false;
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
    title.textContent = `${insight.config.title}: ${productContext.title}`;
    const draftText = bookingMenuCatalogInsightDraftText(insight);
    const statusClass = insight.error ? ' error' : (insight.saved ? ' success' : (insight.generating || insight.saving ? ' saving' : ''));
    body.innerHTML = `
        <div class="booking-menu-insight-product">
            ${bookingMenuCatalogVisualHtml(insight.product, productContext.title, 'booking-menu-catalog-thumb--insight')}
            <div>
                <span class="booking-menu-insight-badge">${escapeHtml(insight.config.badge)}</span>
                <strong>${escapeHtml(productContext.title)}</strong>
                <small>${escapeHtml(insight.config.status)}${productContext.section ? ` · ${escapeHtml(productContext.section)}` : ''} · AI block: ${escapeHtml(insight.aiBlockKey)}</small>
            </div>
        </div>
        <div class="booking-menu-insight-flow">
            <div class="booking-menu-insight-step active">1. Перевірити страву</div>
            <div class="booking-menu-insight-step${insight.draft ? ' active' : ''}">2. Згенерувати AI</div>
            <div class="booking-menu-insight-step${insight.approved ? ' active' : ''}">3. Затвердити людиною</div>
            <div class="booking-menu-insight-step${insight.saved ? ' active' : ''}">4. Зберегти</div>
        </div>
        <textarea id="bookingMenuInsightPrompt" class="booking-menu-insight-prompt" readonly>${escapeHtml(insight.prompt)}</textarea>
        ${draftText ? `
            <div class="booking-menu-insight-result">
                <strong>AI-чернетка для перевірки</strong>
                <pre>${escapeHtml(draftText)}</pre>
            </div>
        ` : ''}
        <div class="booking-menu-insight-status${statusClass}" aria-live="polite">
            ${insight.error
                ? escapeHtml(insight.error)
                : insight.saving
                    ? 'Зберігаю перевірений AI-блок у картку продукту...'
                    : insight.generating
                        ? 'Генерую AI-чернетку для цієї конкретної позиції...'
                        : insight.saved
                            ? 'Перевірку збережено в картці продукту. Позиції бронювання не змінювались.'
                            : insight.approved
                                ? 'AI-чернетку підтверджено людиною. Тепер її можна зберегти як review state продукту.'
                                : insight.draft
                                    ? 'AI-чернетку отримано. Перевірте факти й тільки потім підтвердьте.'
                                    : insight.copied
                                        ? 'Промпт скопійовано. Можна також згенерувати через підключений AI endpoint.'
                                        : 'Промпт зібрано для цієї конкретної страви. Згенеруйте AI або скопіюйте промпт вручну.'}
        </div>
        <div class="booking-menu-insight-actions">
            <button type="button" data-menu-insight-copy>Скопіювати промпт</button>
            <button type="button" data-menu-insight-generate ${insight.generating || insight.saving ? 'disabled' : ''}>Згенерувати AI</button>
            <button type="button" data-menu-insight-approve ${insight.approved || !insight.draft || insight.generating || insight.saving ? 'disabled' : ''}>Підтвердити перевірку</button>
            <button type="button" data-menu-insight-save ${!insight.approved || insight.saved || insight.generating || insight.saving ? 'disabled' : ''}>Зберегти перевірку</button>
        </div>
    `;
}

async function generateBookingMenuCatalogInsightDraft() {
    const insight = bookingMenuCatalogCurrentInsight();
    if (!insight || insight.generating || insight.saving) return;
    if (typeof apiGenerateProductMenuAiDraft !== 'function') {
        BookingPackageState.catalogInsight = {
            ...BookingPackageState.catalogInsight,
            error: 'AI endpoint не підключений на цій сторінці. Скопіюйте промпт вручну.'
        };
        renderBookingMenuCatalogInsight();
        return;
    }
    BookingPackageState.catalogInsight = {
        ...BookingPackageState.catalogInsight,
        generating: true,
        error: '',
        saved: false
    };
    renderBookingMenuCatalogInsight();
    try {
        const response = await apiGenerateProductMenuAiDraft({
            businessContext: bookingMenuCatalogAiBusinessContext(),
            currentCard: bookingMenuCatalogCurrentCardForAi(insight.product, insight.mode),
            blockKey: insight.aiBlockKey,
            feedback: insight.prompt,
            draft: insight.draft || {}
        });
        if (!response?.success) {
            throw new Error(response?.error || 'Не вдалося згенерувати AI-чернетку');
        }
        BookingPackageState.catalogInsight = {
            ...BookingPackageState.catalogInsight,
            generating: false,
            draft: response.draft || null,
            aiAvailable: response.aiAvailable !== false,
            source: response.source || null,
            reason: response.reason || '',
            approved: false,
            approvedBlocks: {},
            error: response.aiAvailable === false && response.reason
                ? `AI тимчасово недоступний, використано fallback: ${response.reason}`
                : ''
        };
    } catch (err) {
        BookingPackageState.catalogInsight = {
            ...BookingPackageState.catalogInsight,
            generating: false,
            error: err.message || 'Не вдалося згенерувати AI-чернетку'
        };
    }
    renderBookingMenuCatalogInsight();
}

async function copyBookingMenuCatalogInsightPrompt() {
    const insight = bookingMenuCatalogCurrentInsight();
    if (!insight) return;
    const prompt = insight.prompt;
    let copied = false;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prompt);
        copied = true;
    } else {
        const input = document.getElementById('bookingMenuInsightPrompt');
        input?.focus();
        input?.select?.();
        copied = Boolean(document.execCommand?.('copy'));
    }
    BookingPackageState.catalogInsight = {
        ...BookingPackageState.catalogInsight,
        copied
    };
    renderBookingMenuCatalogInsight();
}

function approveBookingMenuCatalogInsightPrompt() {
    if (!BookingPackageState.catalogInsight) return;
    const approvedBlocks = bookingMenuCatalogInsightApprovedBlocks(bookingMenuCatalogCurrentInsight() || {});
    const hasDraftApproval = Object.keys(approvedBlocks).length > 0;
    const draft = BookingPackageState.catalogInsight.draft
        ? {
            ...BookingPackageState.catalogInsight.draft,
            status: hasDraftApproval ? 'approved' : BookingPackageState.catalogInsight.draft.status
        }
        : null;
    BookingPackageState.catalogInsight = {
        ...BookingPackageState.catalogInsight,
        approved: true,
        copied: true,
        saved: false,
        draft,
        approvedBlocks,
        error: ''
    };
    renderBookingMenuCatalogInsight();
}

async function saveBookingMenuCatalogInsightDraft() {
    const insight = bookingMenuCatalogCurrentInsight();
    if (!insight || !insight.approved || !insight.draft || insight.saving) return;
    if (typeof apiSaveProductMenuAiDraft !== 'function') {
        BookingPackageState.catalogInsight = {
            ...BookingPackageState.catalogInsight,
            error: 'Збереження AI review state не підключене на цій сторінці.'
        };
        renderBookingMenuCatalogInsight();
        return;
    }
    const approvedBlocks = Object.keys(insight.approvedBlocks || {}).length
        ? insight.approvedBlocks
        : bookingMenuCatalogInsightApprovedBlocks(insight);
    if (!Object.keys(approvedBlocks).length) {
        BookingPackageState.catalogInsight = {
            ...BookingPackageState.catalogInsight,
            error: 'Немає підтвердженого AI-блоку для збереження.'
        };
        renderBookingMenuCatalogInsight();
        return;
    }
    BookingPackageState.catalogInsight = {
        ...BookingPackageState.catalogInsight,
        saving: true,
        error: ''
    };
    renderBookingMenuCatalogInsight();
    try {
        const response = await apiSaveProductMenuAiDraft(insight.productId, {
            businessContext: bookingMenuCatalogAiBusinessContext(),
            status: 'approved',
            draft: {
                ...insight.draft,
                status: 'approved'
            },
            approvedBlocks
        });
        if (!response?.success) {
            throw new Error(response?.error || 'Не вдалося зберегти AI review state');
        }
        BookingPackageState.catalogInsight = {
            ...BookingPackageState.catalogInsight,
            saving: false,
            saved: true,
            approvedBlocks: response.approvedBlocks || approvedBlocks,
            error: ''
        };
        if (typeof showNotification === 'function') {
            showNotification('AI-перевірку меню збережено', 'success');
        }
    } catch (err) {
        BookingPackageState.catalogInsight = {
            ...BookingPackageState.catalogInsight,
            saving: false,
            error: err.message || 'Не вдалося зберегти AI review state'
        };
    }
    renderBookingMenuCatalogInsight();
}

function bookingMenuCatalogQuantity(productId, positions = getBookingMenuPositions()) {
    return positions
        .filter(item => String(item.productId || '') === String(productId || ''))
        .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function bookingMenuCatalogQuantityLabel(value) {
    const qty = Math.round((Number(value || 0) || 0) * 100) / 100;
    if (!qty) return '0';
    return Number.isInteger(qty) ? String(qty) : String(qty).replace('.', ',');
}

function bookingMenuCatalogPositionFromProduct(product = {}, quantity = 1, overrides = {}) {
    const safeQuantity = Math.max(Number(quantity || 1), 0.1);
    const unitPrice = toBookingMoney(overrides.unitPrice ?? product.price ?? 0);
    const servingTime = Object.prototype.hasOwnProperty.call(overrides, 'servingTime')
        ? normalizeBookingServingTime(overrides.servingTime)
        : getBookingDefaultServingTime();
    const servingGroupId = servingTime
        ? (overrides.servingGroupId || bookingServingGroupId(servingTime))
        : null;
    return normalizeBookingMenuPosition({
        id: overrides.id || `menu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        productId: product.id || null,
        code: product.code || null,
        title: bookingMenuProductTitle(product),
        quantity: safeQuantity,
        unitPrice,
        subtotal: safeQuantity * unitPrice,
        note: overrides.note || '',
        menuSection: product.menuSection || null,
        servingUnit: product.servingUnit || product.priceUnit || null,
        kitchenType: bookingKitchenType(product),
        servingTime,
        servingNote: overrides.servingNote || null,
        servingGroupId,
        servingBatchId: servingGroupId ? (overrides.servingBatchId || servingGroupId) : null,
        weightValue: product.weightValue || null,
        cakeDecoration: product.cakeDecoration || null,
        source: 'product'
    });
}

function commitBookingMenuCatalogPositions(nextPositions, options = {}) {
    BookingPackageState.menuPositions = (Array.isArray(nextPositions) ? nextPositions : [])
        .map((item, index) => normalizeBookingMenuPosition(item, index))
        .filter(Boolean);
    BookingPackageState.editIndex = null;
    BookingPackageState.catalogEditing = null;
    renderBookingMenuPositions({ renderCatalog: options.renderCatalog !== false });
    syncLegacyBanquetMenuFromPositions(true);
    renderBookingPackageSummary();
    syncBookingWorkspaceMode();
    if (window.BookingForm) BookingForm._dirty = true;
}

function upsertBookingMenuCatalogProduct(productId, delta) {
    const product = getBookingMenuProducts().find(item => String(item.id) === String(productId));
    if (!product) return;
    const positions = getBookingMenuPositions();
    const firstIndex = positions.findIndex(item => String(item.productId || '') === String(product.id));
    const currentQty = positions
        .filter(item => String(item.productId || '') === String(product.id))
        .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const nextQty = Math.max(0, Math.round((currentQty + delta) * 100) / 100);
    const nextPositions = positions.filter((item, index) =>
        index === firstIndex || String(item.productId || '') !== String(product.id)
    );
    if (nextQty <= 0) {
        commitBookingMenuCatalogPositions(
            positions.filter(item => String(item.productId || '') !== String(product.id)),
            { renderCatalog: false }
        );
    } else if (firstIndex >= 0) {
        const current = positions[firstIndex];
        const position = bookingMenuCatalogPositionFromProduct(product, nextQty, {
            id: current.id,
            unitPrice: current.unitPrice,
            note: current.note || '',
            servingTime: current.servingTime || null,
            servingNote: current.servingNote || null,
            servingGroupId: current.servingGroupId || null,
            servingBatchId: current.servingBatchId || null
        });
        nextPositions[firstIndex] = position;
        commitBookingMenuCatalogPositions(nextPositions.filter(Boolean), { renderCatalog: false });
    } else {
        commitBookingMenuCatalogPositions(
            [...positions, bookingMenuCatalogPositionFromProduct(product, nextQty)].filter(Boolean),
            { renderCatalog: false }
        );
    }
    refreshBookingMenuCatalogAfterPositionChange({ preserveScroll: true });
}

function updateBookingMenuCatalogProduct(productId, updates = {}) {
    const product = getBookingMenuProducts().find(item => String(item.id) === String(productId));
    if (!product) return;
    const positions = getBookingMenuPositions();
    const firstIndex = bookingMenuCatalogPositionIndex(productId, positions);
    const current = firstIndex >= 0
        ? positions[firstIndex]
        : bookingMenuCatalogPositionFromProduct(product, 1);
    const quantity = updates.quantity !== undefined
        ? Math.max(Math.round(Number(updates.quantity || 0) * 10) / 10, 0.1)
        : Number(current.quantity || 1);
    const unitPrice = updates.unitPrice !== undefined
        ? toBookingMoney(updates.unitPrice)
        : toBookingMoney(current.unitPrice ?? product.price ?? 0);
    const note = updates.note !== undefined
        ? String(updates.note || '').trim()
        : (current.note || '');
    const nextPosition = bookingMenuCatalogPositionFromProduct(product, quantity, {
        id: current.id,
        unitPrice,
        note,
        servingTime: current.servingTime || null,
        servingNote: current.servingNote || null,
        servingGroupId: current.servingGroupId || null,
        servingBatchId: current.servingBatchId || null
    });
    const nextPositions = firstIndex >= 0
        ? positions.map((item, index) => index === firstIndex ? nextPosition : item)
        : [...positions, nextPosition];
    commitBookingMenuCatalogPositions(nextPositions, { renderCatalog: false });
    refreshBookingMenuCatalogAfterPositionChange({ preserveScroll: true });
}

function setBookingMenuCatalogEditing(productId, field, options = {}) {
    BookingPackageState.catalogEditing = productId && field
        ? { productId: String(productId), field }
        : null;
    renderBookingMenuCatalogList();
    renderBookingMenuCatalogCart();
    if (productId && field) {
        setTimeout(() => {
            const safeId = typeof CSS !== 'undefined' && CSS.escape
                ? CSS.escape(String(productId))
                : String(productId).replace(/"/g, '\\"');
            const selector = `[data-menu-catalog-${field}-input="${safeId}"]`;
            const roots = [];
            if (options.preferCart) roots.push(document.getElementById('bookingMenuCatalogCart'));
            roots.push(
                document.getElementById('bookingMenuCatalogList'),
                document.getElementById('bookingMenuCatalogPanel'),
                document
            );
            const input = roots
                .filter(Boolean)
                .map(root => root.querySelector?.(selector))
                .find(Boolean);
            input?.focus();
            input?.select?.();
        }, 0);
    }
}

function isBookingMenuCatalogEditing(productId, field) {
    return BookingPackageState.catalogEditing?.field === field
        && BookingPackageState.catalogEditing?.productId === String(productId || '');
}

function bookingMenuCatalogNumberValue(value, fallback = 0) {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function commitBookingMenuCatalogInlineInput(input) {
    if (!input) return;
    const quantityProductId = input.dataset.menuCatalogQuantityInput;
    const priceProductId = input.dataset.menuCatalogPriceInput;
    const noteProductId = input.dataset.menuCatalogNoteInput;
    if (quantityProductId) {
        const quantity = Math.max(Math.round(bookingMenuCatalogNumberValue(input.value, 1) * 10) / 10, 0.1);
        updateBookingMenuCatalogProduct(quantityProductId, { quantity });
        return;
    }
    if (priceProductId) {
        updateBookingMenuCatalogProduct(priceProductId, { unitPrice: toBookingMoney(bookingMenuCatalogNumberValue(input.value, 0)) });
        return;
    }
    if (noteProductId) {
        updateBookingMenuCatalogProduct(noteProductId, { note: input.value || '' });
    }
}

function commitActiveBookingMenuCatalogInput() {
    const active = document.activeElement;
    if (!active || !active.closest?.('#bookingMenuCatalogPanel')) return;
    if (active.matches('[data-menu-catalog-quantity-input], [data-menu-catalog-price-input], [data-menu-catalog-note-input]')) {
        commitBookingMenuCatalogInlineInput(active);
    }
}

function bookingMenuCatalogProductGroupLabel(product = {}, filter = 'all', selected = false) {
    const type = bookingKitchenType(product);
    if (type === 'cake' || product.category === 'cake') return BOOKING_MENU_CATALOG_CAKE_FILTER.label;
    const section = bookingMenuCatalogInferSectionFilter(product);
    if (section) return section.label;
    return bookingMenuCatalogFilterLabel(bookingMenuProductCatalogFilter(product));
}

function bookingMenuCatalogGroupSortRank(product = {}) {
    const type = bookingKitchenType(product);
    if (type === 'cake' || product.category === 'cake') return 1000;
    const section = bookingMenuCatalogInferSectionFilter(product);
    if (!section) return 2000;
    const index = BOOKING_MENU_CATALOG_FOOD_SECTION_FILTERS.findIndex(item => item.key === section.key);
    return index >= 0 ? index : 2000;
}

function bookingMenuCatalogSortedProducts(products = [], filter = 'all') {
    const selectedIds = bookingMenuCatalogSelectedIds();
    return [...products].sort((a, b) => {
        const rankCompare = bookingMenuCatalogGroupSortRank(a) - bookingMenuCatalogGroupSortRank(b);
        if (rankCompare) return rankCompare;
        const groupCompare = bookingMenuCatalogProductGroupLabel(a, filter, selectedIds.has(String(a.id || '')))
            .localeCompare(bookingMenuCatalogProductGroupLabel(b, filter, selectedIds.has(String(b.id || ''))), 'uk');
        if (groupCompare) return groupCompare;
        const sortA = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 999999;
        const sortB = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 999999;
        return sortA - sortB
            || bookingMenuProductTitle(a).localeCompare(bookingMenuProductTitle(b), 'uk');
    });
}

function bookingMenuCatalogLoadState(products = getBookingMenuProducts()) {
    if (!timelineKitchenEnabled()) return 'disabled';
    if (bookingMenuCatalogShouldLoadProducts(products)) {
        return 'loading';
    }
    return products.length ? 'ready' : 'empty';
}

function bookingMenuCatalogProductsLoadKey() {
    const context = typeof getTimelineProductsBusinessContext === 'function'
        ? getTimelineProductsBusinessContext()
        : 'event_genix';
    const priceDate = typeof getTimelineProductsPriceDate === 'function'
        ? getTimelineProductsPriceDate()
        : '';
    return `${context}|${priceDate}`;
}

function bookingMenuCatalogProductsCacheMatchesTimeline() {
    if (typeof AppState === 'undefined') return false;
    if (!Array.isArray(AppState.products)) return false;
    const businessContext = typeof getTimelineProductsBusinessContext === 'function'
        ? getTimelineProductsBusinessContext()
        : 'event_genix';
    const priceDate = typeof getTimelineProductsPriceDate === 'function'
        ? getTimelineProductsPriceDate()
        : '';
    return AppState.productsBusinessContext === businessContext
        && AppState.productsPriceDate === priceDate;
}

function bookingMenuCatalogShouldLoadProducts(products = getBookingMenuProducts()) {
    if (typeof getProducts !== 'function') return false;
    if (typeof timelineDisplayUsesApiProducts !== 'function' || !timelineDisplayUsesApiProducts()) return false;
    if (!bookingMenuCatalogProductsCacheMatchesTimeline()) return true;
    if (products.length) return false;
    return BookingPackageState.catalogProductsLastLoadKey !== bookingMenuCatalogProductsLoadKey();
}

function ensureBookingMenuCatalogProductsLoaded() {
    if (BookingPackageState.catalogProductsLoading || typeof getProducts !== 'function') return;
    const products = getBookingMenuProducts();
    if (!bookingMenuCatalogShouldLoadProducts(products)) return;
    const loadKey = bookingMenuCatalogProductsLoadKey();
    BookingPackageState.catalogProductsLoading = true;
    renderBookingMenuCatalogList();
    getProducts()
        .then(() => {
            BookingPackageState.catalogProductsLastLoadKey = loadKey;
            renderBookingMenuProductOptions();
        })
        .catch(() => renderBookingMenuCatalog())
        .finally(() => {
            BookingPackageState.catalogProductsLoading = false;
            renderBookingMenuCatalog();
        });
}

function bookingMenuCatalogSummaryText() {
    const positions = getBookingMenuPositions();
    const count = positions.length;
    const subtotal = bookingMenuPositionsSubtotal(positions);
    const countText = `${count} ${count === 1 ? 'позиція' : count > 1 && count < 5 ? 'позиції' : 'позицій'}`;
    return { countText, subtotalText: formatPrice(subtotal), combined: `${countText} · ${formatPrice(subtotal)}` };
}

function updateBookingMenuCatalogSummary() {
    const summary = bookingMenuCatalogSummaryText();
    const inline = document.getElementById('bookingMenuCatalogEntrySummary');
    const header = document.getElementById('bookingMenuCatalogSummary');
    const cartSummary = document.getElementById('bookingMenuCatalogCartSummary');
    const footerCount = document.getElementById('bookingMenuCatalogFooterCount');
    const footerTotal = document.getElementById('bookingMenuCatalogFooterTotal');
    const mobileCart = document.getElementById('bookingMenuCatalogMobileCartBtn');
    const panel = document.getElementById('bookingMenuCatalogPanel');
    if (inline) inline.textContent = summary.combined;
    if (header) header.textContent = summary.countText;
    if (cartSummary) cartSummary.textContent = summary.countText;
    if (footerCount) footerCount.textContent = summary.countText;
    if (footerTotal) footerTotal.textContent = summary.subtotalText;
    if (mobileCart) mobileCart.textContent = `Вибрано · ${summary.countText}`;
    panel?.classList.toggle('booking-menu-catalog-has-selection', getBookingMenuPositions().length > 0);
}

function isBookingMenuCatalogMobileCartLayout() {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(max-width: 900px)').matches;
}

function setBookingMenuCatalogCartOpen(open) {
    const panel = document.getElementById('bookingMenuCatalogPanel');
    if (!panel) return;
    const nextOpen = Boolean(open);
    const cart = document.getElementById('bookingMenuCatalogCart');
    const trigger = document.getElementById('bookingMenuCatalogMobileCartBtn');
    const hideCartForA11y = isBookingMenuCatalogMobileCartLayout() && !nextOpen;
    panel.classList.toggle('booking-menu-catalog-cart-open', nextOpen);
    if (trigger) trigger.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    if (cart) {
        cart.setAttribute('aria-hidden', hideCartForA11y ? 'true' : 'false');
        if (hideCartForA11y) cart.setAttribute('inert', '');
        else cart.removeAttribute('inert');
    }
}

function setBookingMenuCatalogOpen(open, options = {}) {
    const panel = document.getElementById('bookingMenuCatalogPanel');
    if (!panel) return;
    const nextOpen = Boolean(open);
    const openBtn = document.getElementById('bookingMenuCatalogOpenBtn');
    const hadFocusInside = panel.contains(document.activeElement);
    if (!nextOpen && !options.skipCommit) {
        commitActiveBookingMenuCatalogInput();
    }
    panel.classList.toggle('hidden', !nextOpen);
    panel.hidden = !nextOpen;
    panel.setAttribute('aria-hidden', nextOpen ? 'false' : 'true');
    document.body?.classList.toggle('booking-menu-catalog-active', nextOpen);
    if (openBtn) openBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    if (nextOpen) {
        ensureBookingMenuCatalogProductsLoaded();
        renderBookingMenuCatalog();
        setBookingMenuCatalogCartOpen(panel.classList.contains('booking-menu-catalog-cart-open'));
        setTimeout(() => document.getElementById('bookingMenuCatalogSearch')?.focus(), 0);
    } else {
        BookingPackageState.catalogEditing = null;
        BookingPackageState.catalogFilter = 'all';
        closeBookingMenuCatalogInsight();
        setBookingMenuCatalogCartOpen(false);
        const search = document.getElementById('bookingMenuCatalogSearch');
        if (search) search.value = '';
        if (hadFocusInside) openBtn?.focus();
    }
}

function initBookingMenuCatalogOpenControl() {
    const openCatalog = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        setBookingMenuCatalogOpen(true);
    };
    const openBtn = document.getElementById('bookingMenuCatalogOpenBtn');
    if (openBtn && openBtn.dataset.menuCatalogOpenBound !== '1') {
        openBtn.dataset.menuCatalogOpenBound = '1';
        openBtn.addEventListener('pointerdown', openCatalog);
        openBtn.addEventListener('click', openCatalog);
    }
    const root = document.documentElement;
    if (!root || root.dataset.menuCatalogOpenDelegatedBound === '1') return;
    root.dataset.menuCatalogOpenDelegatedBound = '1';
    const handleDelegatedOpen = (event) => {
        const trigger = event.target?.closest?.('#bookingMenuCatalogOpenBtn');
        if (!trigger) return;
        openCatalog(event);
    };
    document.addEventListener('pointerdown', handleDelegatedOpen, true);
    document.addEventListener('click', handleDelegatedOpen, true);
}

function initBookingMenuCatalogOpenControlWhenReady() {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBookingMenuCatalogOpenControl, { once: true });
        return;
    }
    initBookingMenuCatalogOpenControl();
}

initBookingMenuCatalogOpenControlWhenReady();

function renderBookingMenuCatalogTabs(products = getBookingMenuProducts()) {
    const tabsEl = document.getElementById('bookingMenuCatalogTabs');
    if (!tabsEl) return;
    const tabs = bookingMenuCatalogTabs(products);
    if (!tabs.some(tab => tab.key === BookingPackageState.catalogFilter)) {
        BookingPackageState.catalogFilter = 'all';
    }
    tabsEl.innerHTML = tabs.map(tab => `
        <button type="button" class="booking-menu-catalog-tab${tab.key === BookingPackageState.catalogFilter ? ' active' : ''}"
            data-menu-catalog-filter="${escapeHtml(tab.key)}"
            aria-pressed="${tab.key === BookingPackageState.catalogFilter ? 'true' : 'false'}">
            ${escapeHtml(tab.label)} <span>${escapeHtml(String(tab.count))}</span>
        </button>
    `).join('');
}

function renderBookingMenuCatalogList(products = getBookingMenuProducts()) {
    const list = document.getElementById('bookingMenuCatalogList');
    if (!list) return;
    const query = String(document.getElementById('bookingMenuCatalogSearch')?.value || '').trim().toLowerCase();
    const filter = BookingPackageState.catalogFilter || 'all';
    list.classList.toggle('booking-menu-catalog-list--all', filter === BOOKING_MENU_CATALOG_ALL_FILTER.key);
    const loadState = bookingMenuCatalogLoadState(products);
    if (loadState === 'loading' || BookingPackageState.catalogProductsLoading) {
        list.innerHTML = '<div class="booking-menu-catalog-state">Завантажую меню...</div>';
        return;
    }
    if (loadState === 'disabled') {
        list.innerHTML = '<div class="booking-menu-catalog-state">Кухня для цього режиму вимкнена.</div>';
        return;
    }
    if (loadState === 'empty') {
        list.innerHTML = '<div class="booking-menu-catalog-state">Меню ще не налаштоване.</div>';
        return;
    }
    const positions = getBookingMenuPositions();
    const selectedIds = bookingMenuCatalogSelectedIds();
    const filtered = products.filter(product => {
        const matchesFilter = bookingMenuCatalogMatchesFilter(product, filter, products);
        const matchesQuery = !query || bookingMenuCatalogSearchText(product).includes(query);
        return matchesFilter && matchesQuery;
    });
    if (!filtered.length) {
        list.innerHTML = `
            <div class="booking-menu-catalog-state">
                <div>Нічого не знайдено.</div>
                ${query ? '<button type="button" data-menu-catalog-clear-search>Очистити пошук</button>' : ''}
            </div>
        `;
        return;
    }
    const rows = [];
    let currentGroup = '';
    bookingMenuCatalogSortedProducts(filtered, filter).forEach(product => {
        const title = bookingMenuProductTitle(product);
        const selectedPosition = bookingMenuCatalogPosition(product.id, positions);
        const selected = Boolean(selectedPosition);
        const qty = bookingMenuCatalogQuantity(product.id, positions);
        const unitPrice = selectedPosition ? toBookingMoney(selectedPosition.unitPrice) : toBookingMoney(product.price || 0);
        const note = selectedPosition?.note || '';
        const typeLabel = bookingKitchenTypeLabel(bookingKitchenType(product));
        const groupLabel = bookingMenuCatalogProductGroupLabel(product, filter, selectedIds.has(String(product.id || '')));
        const section = product.menuSection ? String(product.menuSection) : '';
        const unit = normalizeBookingMenuServingUnitDisplay(product.servingUnit || product.priceUnit || '');
        const customCakeDecorationHint = bookingMenuCustomCakeDecorationPriceHint(product.id);
        const customCakeDecorationWarning = selectedPosition
            ? bookingMenuCustomCakeDecorationZeroPriceWarning([selectedPosition])
            : '';
        if (groupLabel !== currentGroup) {
            currentGroup = groupLabel;
            rows.push(`<div class="booking-menu-catalog-group-heading">${escapeHtml(groupLabel)}</div>`);
        }
        const quantityControl = isBookingMenuCatalogEditing(product.id, 'quantity')
            ? `<input class="booking-menu-catalog-inline-input booking-menu-catalog-qty-input" type="number" min="0.1" step="0.1" value="${escapeHtml(String(qty || 1))}" data-menu-catalog-quantity-input="${escapeHtml(product.id)}" aria-label="Кількість ${escapeHtml(title)}">`
            : `<button type="button" class="booking-menu-catalog-qty" data-menu-catalog-edit-quantity="${escapeHtml(product.id)}" aria-label="Змінити кількість ${escapeHtml(title)}">${escapeHtml(bookingMenuCatalogQuantityLabel(qty))}</button>`;
        const priceControl = isBookingMenuCatalogEditing(product.id, 'price')
            ? `<input class="booking-menu-catalog-inline-input booking-menu-catalog-price-input" type="number" min="0" step="1" value="${escapeHtml(String(unitPrice))}" data-menu-catalog-price-input="${escapeHtml(product.id)}" aria-label="Ціна ${escapeHtml(title)}">`
            : `<button type="button" class="booking-menu-catalog-price" data-menu-catalog-edit-price="${escapeHtml(product.id)}" aria-label="Змінити ціну ${escapeHtml(title)}">${escapeHtml(formatPrice(unitPrice))}</button>`;
        const noteEditor = selected && isBookingMenuCatalogEditing(product.id, 'note')
            ? `<div class="booking-menu-catalog-note-editor"><input type="text" maxlength="500" value="${escapeHtml(note)}" data-menu-catalog-note-input="${escapeHtml(product.id)}" placeholder="Напр: без горіхів, подати о 16:30"></div>`
            : '';
        rows.push(`
            <div class="booking-menu-catalog-item${selected ? ' selected' : ''}" data-menu-catalog-product="${escapeHtml(product.id)}">
                ${bookingMenuCatalogVisualHtml(product, title)}
                <div class="booking-menu-catalog-stepper">
                    <button type="button" data-menu-catalog-dec="${escapeHtml(product.id)}" aria-label="Зменшити ${escapeHtml(title)}">−</button>
                    ${quantityControl}
                    <button type="button" data-menu-catalog-add="${escapeHtml(product.id)}" aria-label="Додати ${escapeHtml(title)}">+</button>
                    ${selected ? `<button type="button" class="booking-menu-catalog-note-btn" data-menu-catalog-edit-note="${escapeHtml(product.id)}" aria-label="Примітка ${escapeHtml(title)}">✎</button>` : ''}
                    ${selected ? `<button type="button" class="booking-menu-catalog-remove" data-menu-catalog-remove="${escapeHtml(product.id)}" aria-label="Видалити ${escapeHtml(title)}">×</button>` : ''}
                </div>
                <div class="booking-menu-catalog-content">
                    <div class="booking-menu-catalog-main">
                        <div class="booking-menu-catalog-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
                        <div class="booking-menu-catalog-meta">
                            <span class="booking-menu-catalog-kind">${escapeHtml(typeLabel)}</span>
                            <span>${priceControl}${unit ? ` / ${escapeHtml(unit)}` : ''}</span>
                            ${section ? `<span>${escapeHtml(section)}</span>` : ''}
                            ${customCakeDecorationHint ? `<span class="booking-menu-catalog-price-hint">${escapeHtml(customCakeDecorationHint)}</span>` : ''}
                            ${note ? `<span class="booking-menu-catalog-note-preview">${escapeHtml(note)}</span>` : ''}
                        </div>
                        ${customCakeDecorationWarning ? `<div class="booking-menu-catalog-price-warning">${escapeHtml(customCakeDecorationWarning)}</div>` : ''}
                    </div>
                    ${bookingMenuCatalogInsightActionsHtml(product, title)}
                </div>
                ${noteEditor}
            </div>
        `);
    });
    list.innerHTML = rows.join('');
}

function renderBookingMenuCatalogListPreservingScroll(products = getBookingMenuProducts()) {
    const list = document.getElementById('bookingMenuCatalogList');
    const scrollTop = list ? list.scrollTop : 0;
    const scrollLeft = list ? list.scrollLeft : 0;
    renderBookingMenuCatalogList(products);
    const refreshedList = document.getElementById('bookingMenuCatalogList');
    if (!refreshedList) return;
    refreshedList.scrollTop = scrollTop;
    refreshedList.scrollLeft = scrollLeft;
}

function renderBookingMenuCatalogCart() {
    const list = document.getElementById('bookingMenuCatalogCartList');
    if (!list) return;
    const positions = getBookingMenuPositions();
    if (!positions.length) {
        list.innerHTML = '<div class="booking-menu-catalog-cart-empty">Позиції ще не додані. Оберіть їжу, напої або торт з каталогу.</div>';
        return;
    }
    list.innerHTML = positions.map((item, index) => {
        const productId = item.productId ? String(item.productId) : '';
        const product = productId
            ? getBookingMenuProducts().find(menuProduct => String(menuProduct.id || '') === productId)
            : null;
        const title = item.title || 'Позиція меню';
        const quantity = Number(item.quantity || 1);
        const unitPrice = toBookingMoney(item.unitPrice || 0);
        const note = item.note || '';
        const cartQuantityLabel = formatBookingMenuPositionQuantity(item);
        const customCakeDecorationWarning = bookingMenuCustomCakeDecorationZeroPriceWarning([item]);
        const quantityControl = productId && isBookingMenuCatalogEditing(productId, 'quantity')
            ? `<input class="booking-menu-catalog-inline-input booking-menu-catalog-qty-input" type="number" min="0.1" step="0.1" value="${escapeHtml(String(quantity))}" data-menu-catalog-quantity-input="${escapeHtml(productId)}" aria-label="Кількість ${escapeHtml(title)}">`
            : productId
                ? `<button type="button" class="booking-menu-catalog-qty" data-menu-catalog-edit-quantity="${escapeHtml(productId)}" aria-label="Змінити кількість ${escapeHtml(title)}">${escapeHtml(bookingMenuCatalogQuantityLabel(quantity))}</button>`
                : `<span class="booking-menu-catalog-cart-static">${escapeHtml(bookingMenuCatalogQuantityLabel(quantity))}</span>`;
        const priceControl = productId && isBookingMenuCatalogEditing(productId, 'price')
            ? `<input class="booking-menu-catalog-inline-input booking-menu-catalog-price-input" type="number" min="0" step="1" value="${escapeHtml(String(unitPrice))}" data-menu-catalog-price-input="${escapeHtml(productId)}" aria-label="Ціна ${escapeHtml(title)}">`
            : productId
                ? `<button type="button" class="booking-menu-catalog-price" data-menu-catalog-edit-price="${escapeHtml(productId)}" aria-label="Змінити ціну ${escapeHtml(title)}">${escapeHtml(formatPrice(unitPrice))}</button>`
                : `<span>${escapeHtml(formatPrice(unitPrice))}</span>`;
        const noteEditor = productId && isBookingMenuCatalogEditing(productId, 'note')
            ? `<div class="booking-menu-catalog-note-editor"><input type="text" maxlength="500" value="${escapeHtml(note)}" data-menu-catalog-note-input="${escapeHtml(productId)}" placeholder="Напр: без горіхів, подати о 16:30"></div>`
            : '';
        return `
            <div class="booking-menu-catalog-cart-item">
                <div class="booking-menu-catalog-cart-item-head">
                    ${bookingMenuCatalogVisualHtml(product || item, title, 'booking-menu-catalog-thumb--cart')}
                    <div class="booking-menu-catalog-cart-title">
                        <strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong>
                        <small>${escapeHtml(bookingKitchenTypeLabel(item.kitchenType))}${cartQuantityLabel ? ` · ${escapeHtml(cartQuantityLabel)}` : ''}</small>
                    </div>
                    <button type="button" class="booking-menu-catalog-remove" ${productId ? `data-menu-catalog-remove="${escapeHtml(productId)}"` : `data-menu-catalog-remove-index="${index}"`} aria-label="Видалити ${escapeHtml(title)}">×</button>
                </div>
                <div class="booking-menu-catalog-cart-controls">
                    ${productId ? `<button type="button" data-menu-catalog-dec="${escapeHtml(productId)}" aria-label="Зменшити ${escapeHtml(title)}">−</button>` : ''}
                    ${quantityControl}
                    ${productId ? `<button type="button" data-menu-catalog-add="${escapeHtml(productId)}" aria-label="Додати ${escapeHtml(title)}">+</button>` : ''}
                    ${priceControl}
                    ${productId ? `<button type="button" class="booking-menu-catalog-note-btn" data-menu-catalog-edit-note="${escapeHtml(productId)}" aria-label="Примітка ${escapeHtml(title)}">✎</button>` : ''}
                </div>
                ${note ? `<div class="booking-menu-catalog-note-preview">${escapeHtml(note)}</div>` : ''}
                ${noteEditor}
                <div class="booking-menu-catalog-cart-subtotal">${escapeHtml(formatPrice(item.subtotal || 0))}</div>
                ${customCakeDecorationWarning ? `<div class="booking-menu-catalog-price-warning">${escapeHtml(customCakeDecorationWarning)}</div>` : ''}
            </div>
        `;
    }).join('');
}

function renderBookingMenuCatalog() {
    const panel = document.getElementById('bookingMenuCatalogPanel');
    const products = getBookingMenuProducts();
    renderBookingMenuCatalogTabs(products);
    if (panel && !panel.hidden) renderBookingMenuCatalogList(products);
    renderBookingMenuCatalogCart();
    renderBookingMenuCatalogInsight();
    updateBookingMenuCatalogSummary();
}

function refreshBookingMenuCatalogAfterPositionChange(options = {}) {
    const panel = document.getElementById('bookingMenuCatalogPanel');
    if (panel && !panel.hidden) {
        if (options.preserveScroll === false) {
            renderBookingMenuCatalogList();
        } else {
            renderBookingMenuCatalogListPreservingScroll();
        }
    }
    renderBookingMenuCatalogCart();
    updateBookingMenuCatalogSummary();
}

function openBookingMenuCatalogForPosition(item = {}) {
    const search = document.getElementById('bookingMenuCatalogSearch');
    if (search) search.value = '';
    if (item.productId) {
        BookingPackageState.catalogFilter = bookingMenuProductCatalogFilter({
            menuSection: item.menuSection,
            menu_section: item.menuSection,
            kitchenType: item.kitchenType,
            type: item.kitchenType
        });
    }
    setBookingMenuCatalogOpen(true);
}

function markBookingPackageChanged() {
    renderBookingMenuPositions();
    syncLegacyBanquetMenuFromPositions(true);
    renderBookingPackageSummary();
    syncBookingWorkspaceMode();
    if (window.BookingForm) BookingForm._dirty = true;
}

function bookingMenuMissingServingTimeCount(positions = getBookingMenuPositions()) {
    return positions.filter(item => !item.servingTime).length;
}

function renderBookingServiceEvents(events = getBookingServiceEvents()) {
    if (!events.length) {
        return '<div class="booking-menu-service-events-empty">Сервісні події ще не додані.</div>';
    }
    return events.map((event, index) => `
        <div class="booking-menu-service-event" data-service-event-index="${index}">
            <div>
                <strong>${escapeHtml(event.title)}</strong>
                <small>${escapeHtml(BOOKING_SERVICE_EVENT_TYPES[event.type] || 'Подія')}${event.time ? ` · ${escapeHtml(event.time)}` : ' · час не вказано'}${event.note ? ` · ${escapeHtml(event.note)}` : ''}</small>
            </div>
            <div class="booking-menu-service-event-actions">
                <input type="time" value="${escapeHtml(event.time || '')}" data-service-event-time="${index}" aria-label="Час події">
                <input type="text" value="${escapeHtml(event.note || '')}" data-service-event-note="${index}" placeholder="Нотатка" aria-label="Нотатка події">
                <button type="button" class="booking-menu-remove-btn" data-service-event-remove="${index}" title="Видалити подію">✕</button>
            </div>
        </div>
    `).join('');
}

function renderBookingMenuPositions(options = {}) {
    const list = document.getElementById('bookingMenuPositionsList');
    const hidden = document.getElementById('bookingMenuPositionsJson');
    const positions = getBookingMenuPositions();
    const serviceEvents = getBookingServiceEvents();
    const shouldRenderCatalog = options.renderCatalog !== false;
    BookingPackageState.menuPositions = positions;
    BookingPackageState.serviceEvents = serviceEvents;
    if (hidden) hidden.value = JSON.stringify(positions);
    if (!list) {
        if (shouldRenderCatalog) renderBookingMenuCatalog();
        return;
    }
    if (!positions.length && !serviceEvents.length) {
        list.innerHTML = '<div class="booking-summary-empty">Меню або сервісні позиції ще не додані.</div>';
    } else {
        const defaultServingTime = getBookingDefaultServingTime();
        const firstServingTime = positions.find(item => item.servingTime)?.servingTime || defaultServingTime || '';
        const missingServingTimes = bookingMenuMissingServingTimeCount(positions);
        list.innerHTML = `
            <div class="booking-menu-serving-toolbar">
                <div class="booking-menu-serving-block booking-menu-serving-block--bulk">
                    <div class="booking-menu-serving-block-head">
                        <span>Час видачі позицій</span>
                    </div>
                    <label class="booking-menu-serving-bulk">
                        <span>Базовий час</span>
                        <input type="time" id="bookingMenuBulkServingTime" value="${escapeHtml(firstServingTime)}">
                    </label>
                    <div class="booking-menu-serving-actions">
                        <button type="button" class="booking-menu-serving-action booking-menu-serving-action--primary" data-menu-serving-apply-selected>Для вибраних</button>
                        <button type="button" class="booking-menu-serving-action" data-menu-serving-copy-all>На всі позиції</button>
                    </div>
                </div>
                <div class="booking-menu-serving-block booking-menu-serving-block--event">
                    <div class="booking-menu-serving-block-head">
                        <span>Окрема подія</span>
                    </div>
                    <label class="booking-menu-service-event-field">
                        <span>Тип</span>
                        <select id="bookingServiceEventType" class="booking-menu-service-event-type" aria-label="Тип події">
                            ${BOOKING_SERVICE_EVENT_CREATE_TYPES.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(BOOKING_SERVICE_EVENT_TYPES[type])}</option>`).join('')}
                        </select>
                    </label>
                    <label class="booking-menu-service-event-field">
                        <span>Час</span>
                        <input type="time" id="bookingServiceEventTime" class="booking-menu-service-event-time" value="${escapeHtml(defaultServingTime || '')}" aria-label="Час події">
                    </label>
                    <button type="button" class="booking-menu-serving-action" data-menu-service-event-add>Додати подію</button>
                </div>
            </div>
            ${missingServingTimes ? `<div class="booking-menu-serving-warning">Не вказано час видачі для ${escapeHtml(String(missingServingTimes))} позицій. Збереження не блокується.</div>` : ''}
            ${positions.map((item, index) => `
                <div class="booking-menu-position-row" data-menu-index="${index}">
                    <div>
                        <div class="booking-menu-position-title"><span class="booking-menu-position-kind">${escapeHtml(bookingKitchenTypeLabel(item.kitchenType))}</span>${escapeHtml(item.title)}</div>
                        <div class="booking-menu-position-meta">${escapeHtml(formatBookingMenuPositionQuantity(item))} × ${escapeHtml(formatPrice(item.unitPrice))} = ${escapeHtml(formatPrice(item.subtotal))}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</div>
                    </div>
                    <label class="booking-menu-serving-picker">
                        <input type="checkbox" data-menu-serving-selected="${index}" aria-label="Вибрати позицію для групового часу">
                        <span>Видати о</span>
                        <input type="time" value="${escapeHtml(item.servingTime || '')}" data-menu-serving-time="${index}">
                    </label>
                    <div class="booking-menu-position-actions">
                        <button type="button" class="booking-menu-edit-btn" data-menu-edit="${index}" title="Редагувати">✎</button>
                        <button type="button" class="booking-menu-remove-btn" data-menu-remove="${index}" title="Видалити">✕</button>
                    </div>
                </div>
            `).join('')}
            <div class="booking-menu-service-events">
                <div class="booking-menu-service-events-title">Події банкету</div>
                ${renderBookingServiceEvents(serviceEvents)}
            </div>
        `;
        list.querySelectorAll('[data-menu-edit]').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = Number(btn.dataset.menuEdit);
                const item = BookingPackageState.menuPositions[index];
                if (!item) return;
                if (item.productId) {
                    openBookingMenuCatalogForPosition(item);
                    return;
                }
                BookingPackageState.editIndex = index;
                const select = document.getElementById('bookingMenuProductSelect');
                const quantity = document.getElementById('bookingMenuQuantity');
                const price = document.getElementById('bookingMenuUnitPrice');
                const note = document.getElementById('bookingMenuNote');
                const addBtn = document.getElementById('bookingMenuAddBtn');
                if (select) select.value = item.productId || '';
                if (quantity) quantity.value = String(item.quantity || 1);
                if (price) price.value = String(item.unitPrice || 0);
                if (note) note.value = item.note || '';
                if (addBtn) addBtn.textContent = 'Зберегти позицію';
                select?.focus();
            });
        });
        list.querySelectorAll('[data-menu-remove]').forEach(btn => {
            btn.addEventListener('click', () => {
                const removeIndex = Number(btn.dataset.menuRemove);
                BookingPackageState.menuPositions.splice(removeIndex, 1);
                if (BookingPackageState.editIndex === removeIndex) BookingPackageState.editIndex = null;
                if (BookingPackageState.editIndex !== null && BookingPackageState.editIndex > removeIndex) {
                    BookingPackageState.editIndex -= 1;
                }
                const addBtn = document.getElementById('bookingMenuAddBtn');
                if (addBtn && BookingPackageState.editIndex === null) addBtn.textContent = '+ Додати позицію';
                markBookingPackageChanged();
            });
        });
        list.querySelectorAll('[data-menu-serving-time]').forEach(input => {
            input.addEventListener('change', () => {
                const index = Number(input.dataset.menuServingTime);
                if (!BookingPackageState.menuPositions[index]) return;
                const value = normalizeBookingServingTime(input.value);
                BookingPackageState.menuPositions[index].servingTime = value;
                BookingPackageState.menuPositions[index].servingGroupId = bookingServingGroupId(value);
                BookingPackageState.menuPositions[index].servingBatchId = BookingPackageState.menuPositions[index].servingGroupId;
                markBookingPackageChanged();
            });
        });
        list.querySelector('[data-menu-serving-apply-selected]')?.addEventListener('click', () => {
            const value = normalizeBookingServingTime(document.getElementById('bookingMenuBulkServingTime')?.value);
            if (!value) {
                showNotification('Вкажіть час видачі', 'error');
                return;
            }
            const selected = Array.from(list.querySelectorAll('[data-menu-serving-selected]:checked'))
                .map(input => Number(input.dataset.menuServingSelected))
                .filter(index => BookingPackageState.menuPositions[index]);
            if (!selected.length) {
                showNotification('Оберіть позиції меню для групового часу', 'error');
                return;
            }
            selected.forEach(index => {
                BookingPackageState.menuPositions[index].servingTime = value;
                BookingPackageState.menuPositions[index].servingGroupId = bookingServingGroupId(value);
                BookingPackageState.menuPositions[index].servingBatchId = BookingPackageState.menuPositions[index].servingGroupId;
            });
            markBookingPackageChanged();
        });
        list.querySelector('[data-menu-serving-copy-all]')?.addEventListener('click', () => {
            const value = normalizeBookingServingTime(document.getElementById('bookingMenuBulkServingTime')?.value)
                || BookingPackageState.menuPositions.find(item => item.servingTime)?.servingTime;
            if (!value) {
                showNotification('Вкажіть або виберіть час видачі', 'error');
                return;
            }
            BookingPackageState.menuPositions.forEach(item => {
                item.servingTime = value;
                item.servingGroupId = bookingServingGroupId(value);
                item.servingBatchId = item.servingGroupId;
            });
            markBookingPackageChanged();
        });
        list.querySelector('[data-menu-service-event-add]')?.addEventListener('click', () => {
            const selectedType = document.getElementById('bookingServiceEventType')?.value || 'food_service';
            const type = BOOKING_SERVICE_EVENT_CREATE_TYPES.includes(selectedType) ? selectedType : 'food_service';
            const time = normalizeBookingServingTime(document.getElementById('bookingServiceEventTime')?.value);
            BookingPackageState.serviceEvents.push(normalizeBookingServiceEvent({
                id: `service-event-${Date.now()}`,
                type,
                title: BOOKING_SERVICE_EVENT_TYPES[type] || 'Подія',
                time
            }, BookingPackageState.serviceEvents.length));
            const timeInput = document.getElementById('bookingServiceEventTime');
            if (timeInput) timeInput.value = '';
            markBookingPackageChanged();
        });
        list.querySelectorAll('[data-service-event-time]').forEach(input => {
            input.addEventListener('change', () => {
                const index = Number(input.dataset.serviceEventTime);
                if (!BookingPackageState.serviceEvents[index]) return;
                BookingPackageState.serviceEvents[index].time = normalizeBookingServingTime(input.value);
                markBookingPackageChanged();
            });
        });
        list.querySelectorAll('[data-service-event-note]').forEach(input => {
            input.addEventListener('change', () => {
                const index = Number(input.dataset.serviceEventNote);
                if (!BookingPackageState.serviceEvents[index]) return;
                BookingPackageState.serviceEvents[index].note = input.value.trim() || null;
                markBookingPackageChanged();
            });
        });
        list.querySelectorAll('[data-service-event-remove]').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = Number(btn.dataset.serviceEventRemove);
                BookingPackageState.serviceEvents.splice(index, 1);
                markBookingPackageChanged();
            });
        });
    }
    if (shouldRenderCatalog) renderBookingMenuCatalog();
}

function syncLegacyBanquetMenuFromPositions(force = false) {
    const textarea = document.getElementById('banquetMenu');
    if (!textarea) return;
    const generated = bookingMenuPositionsToLegacyText();
    if (force || !textarea.value.trim() || textarea.dataset.generated === 'true') {
        textarea.value = generated;
        textarea.dataset.generated = generated ? 'true' : 'false';
    }
}

function addBookingMenuPositionFromForm() {
    const productSelect = document.getElementById('bookingMenuProductSelect');
    const productId = productSelect?.value || '';
    const product = productId ? getBookingMenuProducts().find(p => p.id === productId) : null;
    const title = product?.name || product?.label || productSelect?.selectedOptions?.[0]?.dataset.title || '';
    if (!title) {
        showNotification('Оберіть позицію меню', 'error');
        return;
    }
    const quantity = Math.max(Number(document.getElementById('bookingMenuQuantity')?.value || 1), 0.1);
    const unitPrice = toBookingMoney(document.getElementById('bookingMenuUnitPrice')?.value || product?.price || 0);
    const existingPosition = BookingPackageState.editIndex !== null
        ? BookingPackageState.menuPositions[BookingPackageState.editIndex]
        : null;
    const servingTime = existingPosition
        ? (existingPosition.servingTime || null)
        : getBookingDefaultServingTime();
    const servingGroupId = servingTime
        ? (existingPosition?.servingGroupId || bookingServingGroupId(servingTime))
        : null;
    const position = normalizeBookingMenuPosition({
        id: `menu-${Date.now()}`,
        productId: product?.id || null,
        code: product?.code || null,
        title,
        quantity,
        unitPrice,
        subtotal: quantity * unitPrice,
        note: document.getElementById('bookingMenuNote')?.value || '',
        menuSection: product?.menuSection || null,
        servingUnit: product?.servingUnit || product?.priceUnit || null,
        kitchenType: product ? bookingKitchenType(product) : 'menu',
        servingTime,
        servingGroupId,
        servingBatchId: servingGroupId,
        weightValue: product?.weightValue || null,
        cakeDecoration: product?.cakeDecoration || null,
        source: product ? 'product' : 'custom'
    });
    if (BookingPackageState.editIndex !== null && BookingPackageState.menuPositions[BookingPackageState.editIndex]) {
        BookingPackageState.menuPositions[BookingPackageState.editIndex] = position;
    } else {
        BookingPackageState.menuPositions.push(position);
    }
    BookingPackageState.editIndex = null;
    if (productSelect) productSelect.value = '';
    const qty = document.getElementById('bookingMenuQuantity');
    if (qty) qty.value = '1';
    const price = document.getElementById('bookingMenuUnitPrice');
    if (price) price.value = '';
    const note = document.getElementById('bookingMenuNote');
    if (note) note.value = '';
    const addBtn = document.getElementById('bookingMenuAddBtn');
    if (addBtn) addBtn.textContent = '+ Додати позицію';
    renderBookingMenuPositions();
    syncLegacyBanquetMenuFromPositions(true);
    renderBookingPackageSummary();
    syncBookingWorkspaceMode();
    if (window.BookingForm) BookingForm._dirty = true;
}

function setBookingMenuPositions(positions) {
    BookingPackageState.menuPositions = (Array.isArray(positions) ? positions : [])
        .map((item, index) => normalizeBookingMenuPosition(item, index))
        .filter(Boolean);
    renderBookingMenuPositions();
    syncLegacyBanquetMenuFromPositions(true);
    renderBookingPackageSummary();
    syncBookingWorkspaceMode();
}

function resetBookingPackageWorkspace() {
    BookingPackageState.menuPositions = [];
    BookingPackageState.serviceEvents = [];
    BookingPackageState.editIndex = null;
    BookingPackageState.catalogFilter = 'all';
    BookingPackageState.catalogEditing = null;
    BookingPackageState.catalogInsight = null;
    if (typeof clearAutoFilledBanquetGuestsFromRoom === 'function') clearAutoFilledBanquetGuestsFromRoom();
    ['bookingMenuProductSelect', 'bookingMenuNote', 'bookingMenuUnitPrice', 'bookingMenuPositionsJson', 'banquetMenu', 'banquetGuests', 'banquetAdults', 'banquetTables', 'bookingDepositExpectedAmount', 'bookingDepositDueDate', 'bookingDepositManagerNote'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const depositStatus = document.getElementById('bookingDepositManagerStatus');
    if (depositStatus) depositStatus.value = '';
    resetBookingDepositHydrationState();
    const catalogSearch = document.getElementById('bookingMenuCatalogSearch');
    if (catalogSearch) catalogSearch.value = '';
    setBookingMenuCatalogOpen(false, { skipCommit: true });
    const qty = document.getElementById('bookingMenuQuantity');
    if (qty) qty.value = '1';
    const addBtn = document.getElementById('bookingMenuAddBtn');
    if (addBtn) addBtn.textContent = '+ Додати позицію';
    renderBookingMenuProductOptions();
    renderBookingMenuPositions();
    renderBookingPackageSummary();
    syncBookingWorkspaceMode();
}

function normalizeBookingDepositAmount(value) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const normalized = Number(String(value).replace(/\s+/g, '').replace(',', '.'));
    if (!Number.isFinite(normalized) || normalized < 0) return null;
    return Math.round(normalized);
}

const BOOKING_DEPOSIT_FIELD_IDS = [
    'bookingDepositExpectedAmount',
    'bookingDepositDueDate',
    'bookingDepositManagerStatus',
    'bookingDepositManagerNote'
];

function bookingDepositFieldElements() {
    return BOOKING_DEPOSIT_FIELD_IDS
        .map(id => document.getElementById(id))
        .filter(Boolean);
}

function setBookingDepositFieldsLocked(locked) {
    const disabled = Boolean(locked);
    bookingDepositFieldElements().forEach(el => {
        el.disabled = disabled;
        el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    });
}

function ensureBookingDepositHydrationStatusElement() {
    const section = document.getElementById('bookingDepositSection');
    if (!section) return null;
    let statusEl = document.getElementById('bookingDepositHydrationStatus');
    if (statusEl) return statusEl;

    statusEl = document.createElement('div');
    statusEl.id = 'bookingDepositHydrationStatus';
    statusEl.className = 'booking-menu-serving-warning';
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');
    statusEl.hidden = true;

    const message = document.createElement('span');
    message.id = 'bookingDepositHydrationMessage';
    statusEl.appendChild(message);

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.id = 'bookingDepositRetryBtn';
    retry.className = 'booking-menu-serving-action booking-menu-serving-action--primary';
    retry.textContent = 'Повторити завантаження';
    retry.hidden = true;
    statusEl.appendChild(retry);

    const heading = section.querySelector('.booking-section-heading');
    if (heading?.nextSibling) {
        section.insertBefore(statusEl, heading.nextSibling);
    } else {
        section.prepend(statusEl);
    }
    return statusEl;
}

function renderBookingDepositHydrationStatus(state = BookingDrawerState.depositHydration || {}) {
    const statusEl = ensureBookingDepositHydrationStatusElement();
    if (!statusEl) return;
    const message = statusEl.querySelector('#bookingDepositHydrationMessage');
    const retry = statusEl.querySelector('#bookingDepositRetryBtn');
    const status = String(state.status || 'idle');
    const hasBookingId = Boolean(String(state.bookingId || '').trim());
    const shouldLock = hasBookingId && (status === 'loading' || status === 'failed');
    setBookingDepositFieldsLocked(shouldLock);

    if (!hasBookingId || !['loading', 'failed'].includes(status)) {
        statusEl.hidden = true;
        if (retry) retry.hidden = true;
        return;
    }

    statusEl.hidden = false;
    if (status === 'loading') {
        if (message) message.textContent = 'Завантажуємо завдаток. Поля завдатку тимчасово заблоковані.';
        if (retry) {
            retry.hidden = true;
            retry.disabled = true;
        }
        return;
    }

    if (message) {
        message.textContent = 'Завдаток не завантажився. Поля завдатку заблоковані, інші зміни банкетки можна зберегти без зміни завдатку.';
    }
    if (retry) {
        retry.hidden = false;
        retry.disabled = false;
    }
}

function getBookingDepositFormData() {
    const status = document.getElementById('bookingDepositManagerStatus')?.value || '';
    const expectedAmount = normalizeBookingDepositAmount(document.getElementById('bookingDepositExpectedAmount')?.value);
    const dueDate = document.getElementById('bookingDepositDueDate')?.value || '';
    const managerNote = document.getElementById('bookingDepositManagerNote')?.value?.trim() || '';
    const provided = expectedAmount !== null
        || Boolean(dueDate)
        || Boolean(managerNote)
        || Boolean(status);
    return {
        provided,
        expectedAmount,
        dueDate: dueDate || null,
        managerStatus: status || null,
        managerNote: managerNote || null
    };
}

function bookingDepositFromProjection(source = null) {
    const projection = source?.deposit ? source : (source?.banquetDeposit || source?.bookingDeposit || source?.deposit || null);
    const deposit = projection?.deposit || projection || null;
    if (!deposit || typeof deposit !== 'object') return null;
    const hasOwn = (target, key) => Boolean(target && Object.prototype.hasOwnProperty.call(target, key));
    let managerStatus = 'Очікуємо оплату';
    if (hasOwn(projection, 'managerStatus')) {
        managerStatus = projection.managerStatus || '';
    } else if (hasOwn(deposit, 'managerStatus')) {
        managerStatus = deposit.managerStatus || '';
    } else if (hasOwn(deposit, 'manager_status')) {
        managerStatus = deposit.manager_status || '';
    } else if (hasOwn(projection?.display, 'managerStatus')) {
        managerStatus = projection.display.managerStatus || '';
    }
    return {
        expectedAmount: deposit.expectedAmount ?? deposit.expected_amount ?? deposit.amount ?? projection?.display?.amount ?? null,
        dueDate: deposit.dueDate || deposit.due_date || projection?.display?.dueDate || null,
        managerStatus,
        managerNote: deposit.managerNote || deposit.manager_note || null
    };
}

function setBookingDepositFormData(source = null) {
    const deposit = bookingDepositFromProjection(source) || {};
    const amountInput = document.getElementById('bookingDepositExpectedAmount');
    if (amountInput) amountInput.value = deposit.expectedAmount ?? '';
    const dueInput = document.getElementById('bookingDepositDueDate');
    if (dueInput) dueInput.value = deposit.dueDate ? String(deposit.dueDate).slice(0, 10) : '';
    const statusSelect = document.getElementById('bookingDepositManagerStatus');
    if (statusSelect) statusSelect.value = deposit.managerStatus || '';
    const noteInput = document.getElementById('bookingDepositManagerNote');
    if (noteInput) noteInput.value = deposit.managerNote || '';
    renderBookingPackageSummary();
}

function setBookingDepositHydrationState(bookingId, status, hadDeposit = false, error = null) {
    const state = {
        bookingId: String(bookingId || ''),
        status: String(status || 'idle'),
        hadDeposit: Boolean(hadDeposit),
        error: error ? String(error) : null
    };
    BookingDrawerState.depositHydration = state;
    renderBookingDepositHydrationStatus(state);
    return state;
}

function resetBookingDepositHydrationState() {
    return setBookingDepositHydrationState('', 'idle', false);
}

async function hydrateBookingDepositFromServer(bookingId) {
    const cleanBookingId = String(bookingId || '').trim();
    if (!cleanBookingId || typeof apiGetBanquetDepositByBooking !== 'function') {
        return setBookingDepositHydrationState(cleanBookingId, 'unavailable', false);
    }
    setBookingDepositHydrationState(cleanBookingId, 'loading', false);
    try {
        const projection = await apiGetBanquetDepositByBooking(cleanBookingId);
        if (projection?.success === false) {
            throw new Error(projection.error || 'Deposit projection is unavailable');
        }
        const hadDeposit = Boolean(projection?.deposit);
        setBookingDepositFormData(hadDeposit ? projection : null);
        return setBookingDepositHydrationState(cleanBookingId, 'loaded', hadDeposit);
    } catch (err) {
        setBookingDepositHydrationState(cleanBookingId, 'failed', false, err?.message || err);
        console.warn('Booking deposit hydrate skipped', err);
        return null;
    }
}

function getProgramBasePrice(program) {
    if (!program) return 0;
    const pinataMode = getPinataModeValue();
    if (pinataMode === 'client') return toBookingMoney(document.getElementById('clientPinataServicePrice')?.value || getClientPinataDefaultPrice());
    if (pinataMode === 'none' && isPinataProgram(program)) return 0;
    const kidsCount = Number(resolveBookingChildrenCountSource({ program }).value || 0);
    if (program.perChild && kidsCount > 0) return toBookingMoney(program.price * kidsCount);
    return toBookingMoney(program.price || 0);
}

function getBookingPackageTotals(program) {
    const activityPrograms = getSelectedActivityPrograms();
    const programs = activityPrograms.length > 1 ? activityPrograms : (program ? [program] : []);
    const programBasePrice = programs.length > 1
        ? bookingActivitiesTotalPrice(programs)
        : getProgramBasePrice(program);
    const positions = getBookingMenuPositions();
    const positionsSubtotal = bookingMenuPositionsSubtotal(positions);
    const entryEstimate = getBookingEntryChargeEstimate(positions);
    return {
        programBasePrice,
        positionsSubtotal,
        entryCharge: entryEstimate.entryCharge,
        entrySubtotal: entryEstimate.entrySubtotal,
        warnings: entryEstimate.warnings || [],
        finalTotal: toBookingMoney(programBasePrice + positionsSubtotal + entryEstimate.entrySubtotal),
        menuPositions: positions,
        serviceEvents: getBookingServiceEvents(),
        activityPrograms: programs
    };
}

const BOOKING_SUBMIT_INCOMPLETE_TEXT = 'Показати що заповнити';
const BOOKING_SUBMIT_SAVING_TEXT = 'Збереження...';
const BOOKING_SUBMIT_PREFLIGHT_OVERRIDE_TEXT = 'Зберегти з серверною перевіркою';

function rememberBookingSubmitReadyText(submitBtn) {
    if (!submitBtn) return 'Додати бронювання';
    const currentText = String(submitBtn.textContent || '').trim();
    if (currentText
        && currentText !== BOOKING_SUBMIT_INCOMPLETE_TEXT
        && currentText !== BOOKING_SUBMIT_SAVING_TEXT
        && currentText !== BOOKING_SUBMIT_PREFLIGHT_OVERRIDE_TEXT) {
        submitBtn.dataset.readyText = currentText;
    }
    return submitBtn.dataset.readyText || currentText || 'Додати бронювання';
}

function updateBookingSubmitState() {
    const submitBtn = document.getElementById('bookingSubmitBtn');
    const hint = document.getElementById('bookingSubmitHint');
    if (!submitBtn || !hint) return;
    const validation = getSmartBookingValidationState();
    syncBookingBoundaryWarningUi(validation);
    const readyText = rememberBookingSubmitReadyText(submitBtn);
    const isSaving = Boolean(submitBtn.disabled && String(submitBtn.textContent || '').trim() === BOOKING_SUBMIT_SAVING_TEXT);
    const preflightUnavailable = selectedActivityPreflightUnavailable();
    if (!isSaving) {
        submitBtn.disabled = false;
        submitBtn.setAttribute('aria-disabled', validation.canSubmit ? 'false' : 'true');
        submitBtn.classList.toggle('btn-submit--needs-input', !validation.canSubmit);
        submitBtn.classList.toggle('btn-submit--preflight-warning', validation.canSubmit && preflightUnavailable);
        submitBtn.textContent = validation.canSubmit
            ? (preflightUnavailable ? BOOKING_SUBMIT_PREFLIGHT_OVERRIDE_TEXT : readyText)
            : BOOKING_SUBMIT_INCOMPLETE_TEXT;
    }
    if (BookingDrawerState.validationAttempted) applyBookingValidationInvalidFields(validation);
    if (!validation.canSubmit) {
        hint.textContent = `${validation.error || 'Оберіть кімнату та клієнта.'} Натисніть кнопку — покажу весь список.`;
        return;
    }
    if (preflightUnavailable) {
        hint.textContent = 'Попередню перевірку зайнятих слотів не виконано. Спробуйте ще раз або збережіть повторно — сервер перевірить конфлікти.';
        return;
    }
    if (validation.warnings?.length) {
        hint.textContent = validation.warnings[0];
        return;
    }
    hint.textContent = 'Можна створювати бронювання.';
}

function bookingSummaryActivityName(program = {}, index = 0, total = 1) {
    const base = program.code || program.label || program.name || 'Активність';
    return total > 1 ? `${index + 1}. ${base}` : base;
}

function bookingSummaryActivityDuration(program = {}) {
    const catalogDuration = Number(program.duration || 0) || 0;
    if (!program.isCustom) return catalogDuration;
    const selectedProgramId = document.getElementById('selectedProgram')?.value;
    if (String(selectedProgramId || '') !== String(program.id || '')) return catalogDuration;
    const customDuration = parseInt(document.getElementById('customDuration')?.value || '', 10);
    return Number.isFinite(customDuration) && customDuration > 0 ? customDuration : catalogDuration;
}

function bookingSummaryActivitiesDuration(programs = []) {
    return (Array.isArray(programs) ? programs : [])
        .reduce((sum, program) => sum + bookingSummaryActivityDuration(program), 0);
}

function bookingSummaryRecommendedGroupLabel(value) {
    const label = String(value || '').trim();
    if (!label) return '';
    return /діт|учн/i.test(label) ? label : `${label} дітей`;
}

function bookingSummaryActivityMeta(program = {}, row = {}) {
    const duration = bookingSummaryActivityDuration(program);
    const hosts = Number(program.hosts || 0) || 0;
    const recommendedGroup = bookingSummaryRecommendedGroupLabel(program.kids);
    return [
        program.name && program.name !== program.code && program.name !== program.label ? program.name : '',
        duration ? `${duration} хв` : '',
        row.time ? selectedActivityScheduleLabel(row) : '',
        hosts > 0 ? `ведучих: ${hosts}` : '',
        program.age ? `рекомендований вік: ${program.age}` : '',
        recommendedGroup ? `рекомендована група: ${recommendedGroup}` : '',
        program.perChild ? 'ціна за дитину' : ''
    ].filter(Boolean);
}

function bookingSummaryPinataDesignLabel(number) {
    const value = String(number || '').trim();
    if (!value) return '';
    const choice = currentPinataChoice('design', value);
    if (choice) return pinataChoiceDisplayLabel(choice);
    return `Піньята №${bookingPinataNumberDisplay(value)}`;
}

function bookingSummaryPinataDraft(program = {}) {
    if (!isPinataProgram(program)) return null;
    if (useSelectedActivityPinataSubflow()) return selectedActivityPinataDraft(program);
    const mode = getPinataModeValue();
    const fillerValue = document.getElementById('pinataFillerSelect')?.value || '';
    const clientOwnedFiller = mode === 'park' && isClientPinataFillerChoice(fillerValue);
    return {
        pinataMode: mode,
        pinataNumber: mode !== 'none' ? (document.getElementById('pinataNumber')?.value?.trim() || null) : null,
        pinataFillerNumber: mode !== 'none'
            ? (clientOwnedFiller ? CLIENT_PINATA_FILLER_VALUE : (document.getElementById('pinataFillerNumber')?.value?.trim() || null))
            : null,
        pinataFiller: mode === 'park' && !clientOwnedFiller ? (fillerValue || null) : null,
        clientPinataServicePrice: mode === 'client' ? (document.getElementById('clientPinataServicePrice')?.value || getClientPinataDefaultPrice()) : null,
        clientPinataServiceNote: mode === 'client' ? (document.getElementById('clientPinataServiceNote')?.value?.trim() || null) : null
    };
}

function bookingSummaryPinataDetails(program = {}) {
    const draft = bookingSummaryPinataDraft(program);
    if (!draft || draft.pinataMode === 'none') return [];
    const rows = [];
    if (draft.pinataMode === 'client') {
        rows.push('Клієнтська піньята');
        const design = bookingSummaryPinataDesignLabel(draft.pinataNumber);
        if (design) rows.push(design);
        if (draft.clientPinataServicePrice) rows.push(`Послуга: ${formatPrice(draft.clientPinataServicePrice)}`);
        if (draft.clientPinataServiceNote) rows.push(draft.clientPinataServiceNote);
        return rows;
    }

    rows.push('Піньята парку');
    const design = bookingSummaryPinataDesignLabel(draft.pinataNumber);
    if (design) rows.push(design);
    if (draft.pinataFillerNumber === CLIENT_PINATA_FILLER_VALUE || isClientPinataFillerChoice(draft.pinataFiller)) {
        rows.push(CLIENT_PINATA_FILLER_LABEL);
    } else {
        const filler = pinataFillerNumberLabel(draft.pinataFillerNumber || draft.pinataFiller || '');
        if (filler) rows.push(`Наповнювач: ${filler}`);
    }
    return rows;
}

const BOOKING_MENU_CUSTOM_CAKE_DECORATION_PRODUCT_ID = 'cake_decor_custom';
const BOOKING_MENU_CUSTOM_CAKE_DECORATION_PRICE_HINT = 'ціну потрібно вказати вручну';
const BOOKING_MENU_CUSTOM_CAKE_DECORATION_ZERO_PRICE_WARNING = 'Індивідуальне оформлення має ціну 0 грн. Якщо це не домовленість, вкажіть ціну вручну. Збереження не блокується.';

function bookingMenuIsCustomCakeDecoration(value = {}) {
    const productId = typeof value === 'string'
        ? value
        : (value.productId || value.product_id || value.id || '');
    return String(productId || '') === BOOKING_MENU_CUSTOM_CAKE_DECORATION_PRODUCT_ID;
}

function bookingMenuCustomCakeDecorationPriceHint(productId) {
    return bookingMenuIsCustomCakeDecoration(productId)
        ? BOOKING_MENU_CUSTOM_CAKE_DECORATION_PRICE_HINT
        : '';
}

function bookingMenuCustomCakeDecorationZeroPriceWarning(positions = []) {
    const hasZeroPriceCustomDecoration = (Array.isArray(positions) ? positions : [])
        .some(item => bookingMenuIsCustomCakeDecoration(item) && toBookingMoney(item.unitPrice ?? item.unit_price ?? item.price ?? 0) === 0);
    return hasZeroPriceCustomDecoration
        ? BOOKING_MENU_CUSTOM_CAKE_DECORATION_ZERO_PRICE_WARNING
        : '';
}

function renderBookingSummaryActivityRows(programs = []) {
    const list = Array.isArray(programs) ? programs.filter(Boolean) : [];
    if (!list.length) return '';
    const scheduleRows = getSelectedActivityScheduleRows(list);
    const rowsById = new Map(scheduleRows.map(row => [String(row.programId || row.program?.id || ''), row]));
    return [
        '<div class="booking-summary-section-title">Активності</div>',
        ...list.map((program, index) => {
            const row = rowsById.get(String(program.id || '')) || { program };
            const meta = [
                ...bookingSummaryActivityMeta(program, row),
                ...bookingSummaryPinataDetails(program)
            ];
            const promoAction = renderBookingActivityPromoAction(program, 'summary');
            return `
                <div class="booking-summary-row booking-summary-row--item booking-summary-row--activity">
                    <span class="booking-summary-row-main">
                        <span>${escapeHtml(bookingSummaryActivityName(program, index, list.length))}</span>
                        ${meta.length ? `<small>${escapeHtml(meta.join(' · '))}</small>` : ''}
                    </span>
                    <span class="booking-summary-row-side">
                        <strong>${escapeHtml(formatPrice(bookingActivityPriceValue(program)))}</strong>
                        ${promoAction}
                    </span>
                </div>
            `;
        })
    ].join('');
}

function renderBookingSummaryMenuRows(menuPositions = []) {
    const positions = Array.isArray(menuPositions) ? menuPositions.filter(Boolean) : [];
    if (!positions.length) return '';
    return [
        '<div class="booking-summary-section-title">Меню</div>',
        ...positions.map(item => {
            const meta = [
                formatBookingMenuPositionQuantity(item),
                item.servingTime ? `видати ${item.servingTime}` : '',
                item.note || ''
            ].filter(Boolean);
            return `
                <div class="booking-summary-row booking-summary-row--item booking-summary-row--menu">
                    <span class="booking-summary-row-main">
                        <span>${escapeHtml(item.title || 'Позиція меню')}</span>
                        ${meta.length ? `<small>${escapeHtml(meta.join(' · '))}</small>` : ''}
                    </span>
                    <span class="booking-summary-row-side">
                        <strong>${escapeHtml(formatPrice(item.subtotal || 0))}</strong>
                    </span>
                </div>
            `;
        })
    ].join('');
}

function bookingSummaryRoomLabel(roomSelect, fallbackValue = '') {
    const selectedOption = roomSelect?.selectedOptions?.[0] || null;
    const datasetLabel = String(selectedOption?.dataset?.roomLabel || '').trim();
    if (datasetLabel) return datasetLabel;
    const value = String(fallbackValue || roomSelect?.value || selectedOption?.value || '').trim();
    if (value) return value;
    return selectedOption?.textContent?.trim() || 'не вибрано';
}

function renderBookingPackageSummary() {
    updateBookingContextHeaderSummary();
    const container = document.getElementById('bookingPackageSummary');
    if (!container) return;
    const hasEvent = getBookingWorkspaceHasEvent();
    const programId = hasEvent ? document.getElementById('selectedProgram')?.value : '';
    const program = programId ? getProductsSync().find(p => p.id === programId) : null;
    const customerName = document.getElementById('customerName')?.value?.trim();
    const customerId = document.getElementById('selectedCustomerId')?.value;
    const roomSelect = document.getElementById('roomSelect');
    const roomValue = roomSelect?.value || '';
    const roomLabel = bookingSummaryRoomLabel(roomSelect, roomValue);
    const selectedCustomerName = document.querySelector('#bookingSelectedCustomerCard strong')?.textContent?.trim() || '';
    const resolvedCustomerName = selectedCustomerName || customerName || (customerId ? 'Існуючий клієнт' : 'не вибрано');
    const totals = getBookingPackageTotals(program);
    const roomFirst = isRoomFirstTimelineView();
    const kitchenEnabled = isBookingKitchenEnabled();
    const validation = getSmartBookingValidationState();
    const programSubtotal = hasEvent ? toBookingMoney(totals.programBasePrice) : 0;
    const menuSubtotal = kitchenEnabled ? toBookingMoney(totals.positionsSubtotal) : 0;
    const entrySubtotal = kitchenEnabled ? toBookingMoney(totals.entrySubtotal || 0) : 0;
    const deposit = kitchenEnabled ? getBookingDepositFormData() : null;
    const depositAmount = deposit?.provided ? (deposit.expectedAmount ?? 0) : null;
    const finalTotal = toBookingMoney(programSubtotal + menuSubtotal + entrySubtotal);
    const menuCount = Array.isArray(totals.menuPositions) ? totals.menuPositions.length : 0;
    const activityPrograms = hasEvent && Array.isArray(totals.activityPrograms) ? totals.activityPrograms : [];
    const activityRows = hasEvent ? renderBookingSummaryActivityRows(activityPrograms) : '';
    const activityDuration = bookingSummaryActivitiesDuration(activityPrograms);
    const menuRows = kitchenEnabled ? renderBookingSummaryMenuRows(totals.menuPositions || []) : '';
    const programLabel = program
        ? `${program.code || program.shortLabel || 'ПРО'} · ${program.duration ? `${program.duration} хв` : 'без тривалості'}`
        : (roomFirst ? (menuCount ? `${menuCount} позицій меню / тортів` : 'додайте їжу або торт') : (hasEvent ? 'не вибрано' : 'вимкнено'));
    const programRowLabel = roomFirst ? 'Кухня / меню' : 'Програма';
    const entryCharge = totals.entryCharge || (entrySubtotal > 0 ? { title: 'Вхід', subtotal: entrySubtotal } : null);
    const shouldShowValidationChecklist = !validation.canSubmit || BookingDrawerState.validationAttempted;
    const preflightWarning = renderSelectedActivityPreflightWarning();
    const customCakeDecorationWarning = kitchenEnabled
        ? bookingMenuCustomCakeDecorationZeroPriceWarning(totals.menuPositions || [])
        : '';
    const validationWarningClass = validation.boundaryWarnings?.length
        ? 'booking-summary-note--danger'
        : 'booking-summary-note--warning';

    if (!roomValue && !customerId && !customerName && !document.getElementById('selectedProgram')?.value && menuCount === 0) {
        container.innerHTML = `
            <div class="booking-summary-empty">${roomFirst ? 'Оберіть кімнату, клієнта і додайте їжу або торт — підсумок оновиться автоматично.' : 'Оберіть кімнату, клієнта і програму — підсумок оновиться автоматично.'}</div>
            ${shouldShowValidationChecklist ? renderBookingValidationIssues(validation) : ''}
            ${preflightWarning}
        `;
        bindSelectedActivityPreflightWarningActions(container);
        updateBookingSubmitState();
        return;
    }
    container.innerHTML = `
        <div class="booking-summary-row"><span>Кімната</span><strong>${escapeHtml(roomLabel)}</strong></div>
        <div class="booking-summary-row"><span>Клієнт</span><strong>${escapeHtml(resolvedCustomerName)}</strong></div>
        ${activityRows || menuRows ? '' : `<div class="booking-summary-row"><span>${escapeHtml(programRowLabel)}</span><strong>${escapeHtml(programLabel)}</strong></div>`}
        ${activityRows}
        ${activityPrograms.length > 1 && activityDuration > 0 ? `<div class="booking-summary-row booking-summary-row--subtotal"><span>Сума тривалостей активностей</span><strong>${escapeHtml(`${activityDuration} хв`)}</strong></div>` : ''}
        ${programSubtotal > 0 ? `<div class="booking-summary-row booking-summary-row--subtotal"><span>${escapeHtml(activityPrograms.length > 1 ? 'Активності' : 'Програма / активність')}</span><strong>${escapeHtml(formatPrice(programSubtotal))}</strong></div>` : ''}
        ${menuRows}
        ${kitchenEnabled && (menuSubtotal > 0 || menuCount > 0) ? `<div class="booking-summary-row booking-summary-row--subtotal"><span>Меню</span><strong>${escapeHtml(formatPrice(menuSubtotal))}</strong></div>` : ''}
        ${kitchenEnabled && entrySubtotal > 0 ? `<div class="booking-summary-row booking-summary-row--subtotal"><span>Вхід</span><strong>${escapeHtml(formatBookingPackageEntryAmount(entryCharge))}</strong></div>` : ''}
        ${kitchenEnabled && deposit?.provided ? `<div class="booking-summary-row booking-summary-row--subtotal"><span>Завдаток</span><strong>${escapeHtml(formatPrice(depositAmount))}</strong></div>` : ''}
        <div class="booking-summary-row booking-summary-total"><span>Разом</span><strong>${escapeHtml(formatPrice(finalTotal))}</strong></div>
        ${shouldShowValidationChecklist ? renderBookingValidationIssues(validation) : ''}
        ${preflightWarning}
        ${customCakeDecorationWarning ? `<div class="booking-summary-note booking-summary-note--warning">${escapeHtml(customCakeDecorationWarning)}</div>` : ''}
        ${totals.warnings?.length ? `<div class="booking-summary-note">${escapeHtml(totals.warnings[0].message || totals.warnings[0].code)}</div>` : ''}
        ${validation.warnings?.length ? `<div class="booking-summary-note ${validationWarningClass}">${escapeHtml(validation.warnings[0])}</div>` : ''}
    `;
    bindSelectedActivityPreflightWarningActions(container);
    bindBookingActivityPromoActions(container);
    updateBookingSubmitState();
}

if (typeof window !== 'undefined' && window.BookingPackageRenderer) {
    window.BookingPackageRenderer.renderBookingPackageSummary = renderBookingPackageSummary;
}

function getBookingPackageFromBooking(booking) {
    const extraData = booking?.extraData || booking?.extra_data || {};
    const packageData = booking?.bookingPackage
        || booking?.booking_package
        || extraData?.bookingPackage
        || extraData?.booking_package
        || null;
    if (packageData) {
        const rawMenuPositions = packageData.menuPositions || packageData.menu_positions || [];
        const rawServiceEvents = packageData.serviceEvents || packageData.service_events || [];
        const menuPositions = (Array.isArray(rawMenuPositions) ? rawMenuPositions : [])
            .map((item, index) => normalizeBookingMenuPosition(item, index))
            .filter(Boolean);
        const serviceEvents = (Array.isArray(rawServiceEvents) ? rawServiceEvents : [])
            .map((item, index) => normalizeBookingServiceEvent(item, index))
            .filter(Boolean);
        return {
            ...packageData,
            menuPositions,
            serviceEvents
        };
    }
    const topLevelPositions = booking?.menuPositions || booking?.menu_positions || extraData?.menuPositions || [];
    if (Array.isArray(topLevelPositions) && topLevelPositions.length) {
        const positions = topLevelPositions.map((item, index) => normalizeBookingMenuPosition(item, index)).filter(Boolean);
        const positionsSubtotal = bookingMenuPositionsSubtotal(positions);
        return {
            schemaVersion: 1,
            programBasePrice: toBookingMoney((booking?.price || 0) - positionsSubtotal),
            positionsSubtotal,
            finalTotal: toBookingMoney(booking?.price || positionsSubtotal),
            menuPositions: positions,
            serviceEvents: [],
            source: 'booking_workspace_compat'
        };
    }
    return null;
}

function getBookingWorkspaceFromBooking(booking) {
    return booking?.extraData?.bookingWorkspace
        || booking?.extra_data?.bookingWorkspace
        || booking?.extraData?.booking_workspace
        || booking?.extra_data?.booking_workspace
        || null;
}

function hydrateBookingPackageWorkspace(booking) {
    const bookingPackage = getBookingPackageFromBooking(booking);
    if (typeof clearAutoFilledBanquetGuestsFromRoom === 'function') clearAutoFilledBanquetGuestsFromRoom();
    setBookingServiceEvents(bookingPackage?.serviceEvents || [], { render: false });
    setBookingMenuPositions(bookingPackage?.menuPositions || []);
    setBookingKitchenEnabled(false, { markDirty: false });
    const banquetMenu = document.getElementById('banquetMenu');
    if (banquetMenu) {
        banquetMenu.value = booking?.banquetMenu || bookingMenuPositionsToLegacyText();
        banquetMenu.dataset.generated = bookingPackage?.menuPositions?.length ? 'true' : 'false';
    }
    const guests = document.getElementById('banquetGuests');
    if (guests) guests.value = bookingKitchenChildrenCountFromBooking(booking);
    const adults = document.getElementById('banquetAdults');
    if (adults) adults.value = booking?.banquetAdults || '';
    const tables = document.getElementById('banquetTables');
    if (tables) tables.value = booking?.banquetTables || '';
    setBookingDepositFormData(booking);
    renderBookingPackageSummary();
}

function hydrateBookingWorkspace(booking) {
    const workspace = getBookingWorkspaceFromBooking(booking);
    setBookingWorkspaceHasEvent(true, { markDirty: false });
    resetBookingLeadDetails();
    if (workspace?.leadDetails) setBookingLeadDetails(workspace.leadDetails);
    setBookingLeadDetailsEnabled(false, { markDirty: false });
    renderBookingPackageSummary();
}

function bookingPackageRendererCall(name, args) {
    const root = typeof window !== 'undefined' ? window : globalThis;
    const renderer = root.BookingPackageRenderer;
    const fn = renderer && renderer[name];
    if (typeof fn !== 'function') {
        throw new Error(`BookingPackageRenderer.${name} is not available`);
    }
    return fn.apply(renderer, Array.from(args || []));
}

function bookingServingTimeLabel(value) {
    return bookingPackageRendererCall('bookingServingTimeLabel', arguments);
}

function groupedBookingMenuPositions(positions = []) {
    return bookingPackageRendererCall('groupedBookingMenuPositions', arguments);
}

function renderBookingPackageMenuRows(positions = [], options = {}) {
    return bookingPackageRendererCall('renderBookingPackageMenuRows', arguments);
}

function normalizeBookingPackageEntertainmentRows(rows = []) {
    return bookingPackageRendererCall('normalizeBookingPackageEntertainmentRows', arguments);
}

function renderBookingPackageEntertainmentRows(rows = [], options = {}) {
    return bookingPackageRendererCall('renderBookingPackageEntertainmentRows', arguments);
}

function formatBookingEntryQuantityLabel(quantity) {
    return bookingPackageRendererCall('formatBookingEntryQuantityLabel', arguments);
}

function bookingPackageMoneyValue(value) {
    return bookingPackageRendererCall('bookingPackageMoneyValue', arguments);
}

function bookingPackageEntryChargeFromPackage(bookingPackage = {}) {
    return bookingPackageRendererCall('bookingPackageEntryChargeFromPackage', arguments);
}

function formatBookingPackageEntryAmount(entryCharge = {}) {
    return bookingPackageRendererCall('formatBookingPackageEntryAmount', arguments);
}

function renderBookingPackageEntryRow(bookingPackage = {}) {
    return bookingPackageRendererCall('renderBookingPackageEntryRow', arguments);
}

function bookingPackageBusinessRowsSummary(options = {}) {
    return bookingPackageRendererCall('bookingPackageBusinessRowsSummary', arguments);
}

function renderBookingPackageDetail(booking, options = {}) {
    return bookingPackageRendererCall('renderBookingPackageDetail', arguments);
}

function shouldHideBookingWorkspaceScenarioDetail(booking = {}) {
    const workspace = bookingWorkspaceFromBooking(booking);
    const scenario = String(workspace.scenario || '').trim().toLowerCase();
    if (scenario === 'kitchen_only') return true;

    const programCode = String(booking.programCode || booking.program_code || '').trim().toUpperCase();
    if (programCode === 'KITCHEN') return true;

    const programName = String(booking.programName || booking.program_name || '').trim().toLowerCase();
    return programName === 'kitchen' || programName === 'кухня';
}

function bookingDetailIsKitchenTitleToken(value) {
    const text = String(value || '').trim();
    if (!text) return false;
    return text.toUpperCase() === 'KITCHEN' || text.toLowerCase() === 'кухня';
}

function bookingDetailModalTitle(booking = {}, fallback = 'Бронювання') {
    const label = String(booking.label || '').trim();
    const programCode = String(booking.programCode || booking.program_code || '').trim();
    const programName = String(booking.programName || booking.program_name || '').trim();

    if (shouldHideBookingWorkspaceScenarioDetail(booking)) {
        return [programName, label, booking.room, booking.id]
            .map(value => String(value || '').trim())
            .find(value => value && !bookingDetailIsKitchenTitleToken(value))
            || fallback;
    }

    return [label || programCode, programName].filter(Boolean).join(': ') || fallback;
}

function bookingDetailScenarioText(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return [
            value.label,
            value.name,
            value.title,
            value.value,
            value.text
        ].map(bookingDetailScenarioText).find(Boolean) || '';
    }
    const text = String(value || '').trim();
    if (!text) return '';
    const technical = new Set([
        'event',
        'event_kitchen',
        'kitchen_only',
        'lead_only',
        'closed_slot',
        'подія',
        'подія + кухня',
        'подія+кухня',
        'заявка'
    ]);
    return technical.has(text.toLocaleLowerCase('uk-UA')) ? '' : text;
}

function bookingDetailActivityExplicitScenarioLabel(booking = {}, workspace = null) {
    const extra = bookingDetailTimelineExtraData(booking);
    return [
        workspace?.scenario,
        workspace?.activityScenario,
        workspace?.activity_scenario,
        workspace?.activityTheme,
        workspace?.activity_theme,
        workspace?.theme,
        workspace?.themeName,
        workspace?.theme_name,
        workspace?.scenarioLabel,
        workspace?.scenario_label,
        workspace?.scenarioName,
        workspace?.scenario_name,
        workspace?.gameScenario,
        workspace?.game_scenario,
        workspace?.gameTheme,
        workspace?.game_theme,
        extra.activityScenario,
        extra.activity_scenario,
        extra.activityTheme,
        extra.activity_theme,
        extra.theme,
        extra.themeName,
        extra.theme_name,
        extra.scenarioLabel,
        extra.scenario_label,
        extra.scenarioName,
        extra.scenario_name,
        extra.gameScenario,
        extra.game_scenario,
        extra.gameTheme,
        extra.game_theme
    ].map(bookingDetailScenarioText).find(Boolean) || '';
}

function bookingDetailCategoryScenarioLabel(category) {
    const labels = {
        quest: 'Квест',
        animation: 'Анімація',
        show: 'Шоу',
        photo: 'Фото',
        masterclass: 'Майстер-клас',
        pinata: 'Піньята',
        education: 'Заняття',
        custom: 'Інше'
    };
    return labels[String(category || '').trim().toLowerCase()] || '';
}

function bookingDetailProgramForScenario(booking = {}) {
    const products = typeof getProductsSync === 'function' ? getProductsSync() : [];
    if (!Array.isArray(products) || !products.length) return null;
    const id = String(booking.programId || booking.program_id || '').trim();
    const code = String(booking.programCode || booking.program_code || '').trim();
    const name = String(booking.programName || booking.program_name || '').trim();
    const label = String(booking.label || '').trim();
    return products.find(product => id && String(product.id || '').trim() === id)
        || products.find(product => code && String(product.code || '').trim() === code)
        || products.find(product => name && String(product.name || '').trim() === name)
        || products.find(product => label && String(product.label || '').trim() === label)
        || null;
}

function bookingDetailActivityProductScenarioLabel(booking = {}) {
    const program = bookingDetailProgramForScenario(booking);
    const category = program?.category || booking.category || booking.category_id;
    const productLabel = [
        program?.name,
        booking.programName,
        booking.program_name,
        program?.label,
        booking.label,
        program?.code,
        booking.programCode,
        booking.program_code
    ].map(bookingDetailScenarioText).find(Boolean);
    const categoryLabel = bookingDetailCategoryScenarioLabel(category);
    return productLabel || categoryLabel;
}

function bookingDetailActivityScenarioLabel(booking = {}, workspace = null) {
    if (!bookingDetailIsActivityWithRoomContext(booking)) return '';
    const explicitLabel = bookingDetailActivityExplicitScenarioLabel(booking, workspace);
    const productLabel = bookingDetailActivityProductScenarioLabel(booking);
    const categoryLabel = bookingDetailCategoryScenarioLabel(booking.category || booking.category_id);
    return explicitLabel || productLabel || categoryLabel || 'Активність';
}

function renderBookingWorkspaceDetail(booking) {
    const workspace = getBookingWorkspaceFromBooking(booking);
    const activityScenarioLabel = bookingDetailActivityScenarioLabel(booking, workspace);
    if (!workspace && booking?.programId && !activityScenarioLabel) return '';
    const scenario = workspace?.scenario || (booking?.programId ? 'event' : 'lead_only');
    const meta = getBookingWorkspaceScenarioMeta(scenario);
    const scenarioLabel = activityScenarioLabel || meta.label;
    const scenarioRowHtml = shouldHideBookingWorkspaceScenarioDetail(booking)
        ? ''
        : `<div class="booking-detail-row"><span class="label">Сценарій:</span><span class="value">${escapeHtml(scenarioLabel)}</span></div>`;
    const lead = workspace?.leadDetails || {};
    const leadRows = [
        lead.source ? `<div class="booking-detail-row"><span class="label">Джерело ліда:</span><span class="value">${escapeHtml(lead.source)}</span></div>` : '',
        lead.status ? `<div class="booking-detail-row"><span class="label">Статус ліда:</span><span class="value">${escapeHtml(lead.status)}</span></div>` : '',
        lead.interestDate ? `<div class="booking-detail-row"><span class="label">Бажана дата:</span><span class="value">${escapeHtml(lead.interestDate)}</span></div>` : '',
        lead.childrenInfo ? `<div class="booking-detail-row"><span class="label">Діти / гості:</span><span class="value">${escapeHtml(lead.childrenInfo)}</span></div>` : '',
        lead.budget ? `<div class="booking-detail-row"><span class="label">Бюджет:</span><span class="value">${escapeHtml(lead.budget)}</span></div>` : '',
        lead.notes ? `<div class="booking-detail-row"><span class="label">Нотатки ліда:</span><span class="value">${escapeHtml(lead.notes)}</span></div>` : ''
    ].join('');
    return `
        ${scenarioRowHtml}
        ${leadRows}
    `;
}

function initBookingPackageWorkspace() {
    if (typeof loadBookingRoomResourcesForSelect === 'function') {
        loadBookingRoomResourcesForSelect().catch(error => console.warn('[BookingRooms] initial catalog load failed', error));
    }
    snapshotBookingRoomOptions();
    renderBookingMenuProductOptions();
    syncBookingWorkspaceMode({ markDirty: false });
    document.getElementById('roomSelect')?.addEventListener('change', (e) => {
        if (e.target.value) e.target.setAttribute('aria-invalid', 'false');
        handleBookingRoomSelectionContextChange().catch(error => {
            console.warn('[Booking] Не вдалося підтягнути контекст кімнати', error);
        });
    });
    document.getElementById('bookingMenuProductSelect')?.addEventListener('change', (e) => {
        const product = getBookingMenuProducts().find(p => p.id === e.target.value);
        const price = document.getElementById('bookingMenuUnitPrice');
        if (price) price.value = product ? String(product.price || 0) : '';
    });
    ['bookingTime', 'bookingLine', 'customDuration'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const refreshHosts = () => {
            refreshAnimatorSelectsForCurrentSlot().catch(() => {});
            if (id === 'bookingTime') {
                const firstProgram = getSelectedActivityPrograms()[0];
                if (firstProgram) delete getSelectedActivityScheduleTimes()[String(firstProgram.id)];
                setSelectedActivityScheduleIssues({});
                renderSelectedProgramSummary();
                scheduleSelectedActivityConflictRefresh();
            }
        };
        el.addEventListener('change', refreshHosts);
        el.addEventListener('input', refreshHosts);
    });
    document.getElementById('bookingMenuAddBtn')?.addEventListener('click', addBookingMenuPositionFromForm);
    initBookingMenuCatalogOpenControl();
    document.getElementById('bookingMenuCatalogCloseBtn')?.addEventListener('click', () => setBookingMenuCatalogOpen(false));
    document.getElementById('bookingMenuCatalogDoneBtn')?.addEventListener('click', () => setBookingMenuCatalogOpen(false));
    document.getElementById('bookingMenuCatalogMobileCartBtn')?.addEventListener('click', () => setBookingMenuCatalogCartOpen(true));
    document.getElementById('bookingMenuCatalogCartCloseBtn')?.addEventListener('click', () => setBookingMenuCatalogCartOpen(false));
    document.getElementById('bookingMenuCatalogPanel')?.addEventListener('click', (event) => {
        const mobileCartBackdropClick = event.currentTarget.classList.contains('booking-menu-catalog-cart-open')
            && isBookingMenuCatalogMobileCartLayout()
            && !event.target.closest('#bookingMenuCatalogCart')
            && !event.target.closest('#bookingMenuCatalogMobileCartBtn');
        if (mobileCartBackdropClick) {
            setBookingMenuCatalogCartOpen(false);
            return;
        }
        if (event.target === event.currentTarget) {
            setBookingMenuCatalogOpen(false);
            return;
        }
        const add = event.target.closest('[data-menu-catalog-add]');
        const dec = event.target.closest('[data-menu-catalog-dec]');
        const remove = event.target.closest('[data-menu-catalog-remove]');
        const removeIndex = event.target.closest('[data-menu-catalog-remove-index]');
        const editQuantity = event.target.closest('[data-menu-catalog-edit-quantity]');
        const editPrice = event.target.closest('[data-menu-catalog-edit-price]');
        const editNote = event.target.closest('[data-menu-catalog-edit-note]');
        const clearSearch = event.target.closest('[data-menu-catalog-clear-search]');
        const insightAction = event.target.closest('[data-menu-catalog-insight]');
        const insightClose = event.target.closest('[data-menu-insight-close]');
        const insightCopy = event.target.closest('[data-menu-insight-copy]');
        const insightGenerate = event.target.closest('[data-menu-insight-generate]');
        const insightApprove = event.target.closest('[data-menu-insight-approve]');
        const insightSave = event.target.closest('[data-menu-insight-save]');
        if (event.target.closest('#bookingMenuInsightPanel') && !event.target.closest('.booking-menu-insight-card')) {
            nudgeBookingMenuCatalogInsightCard();
            return;
        }
        if (insightClose) {
            closeBookingMenuCatalogInsight();
            return;
        }
        if (insightCopy) {
            copyBookingMenuCatalogInsightPrompt().catch(() => renderBookingMenuCatalogInsight());
            return;
        }
        if (insightGenerate) {
            generateBookingMenuCatalogInsightDraft();
            return;
        }
        if (insightApprove) {
            approveBookingMenuCatalogInsightPrompt();
            return;
        }
        if (insightSave) {
            saveBookingMenuCatalogInsightDraft();
            return;
        }
        if (insightAction) {
            setBookingMenuCatalogInsight(
                insightAction.dataset.menuCatalogProductId,
                insightAction.dataset.menuCatalogInsight
            );
            return;
        }
        if (clearSearch) {
            const search = document.getElementById('bookingMenuCatalogSearch');
            if (search) search.value = '';
            renderBookingMenuCatalogList();
            search?.focus();
            return;
        }
        if (editQuantity) {
            setBookingMenuCatalogEditing(editQuantity.dataset.menuCatalogEditQuantity, 'quantity', {
                preferCart: Boolean(editQuantity.closest('#bookingMenuCatalogCart'))
            });
            return;
        }
        if (editPrice) {
            setBookingMenuCatalogEditing(editPrice.dataset.menuCatalogEditPrice, 'price', {
                preferCart: Boolean(editPrice.closest('#bookingMenuCatalogCart'))
            });
            return;
        }
        if (editNote) {
            setBookingMenuCatalogEditing(editNote.dataset.menuCatalogEditNote, 'note', {
                preferCart: Boolean(editNote.closest('#bookingMenuCatalogCart'))
            });
            return;
        }
        if (remove) {
            const productId = remove.dataset.menuCatalogRemove;
            commitBookingMenuCatalogPositions(
                getBookingMenuPositions().filter(item => String(item.productId || '') !== String(productId || '')),
                { renderCatalog: false }
            );
            refreshBookingMenuCatalogAfterPositionChange({ preserveScroll: true });
            return;
        }
        if (removeIndex) {
            const index = Number(removeIndex.dataset.menuCatalogRemoveIndex);
            commitBookingMenuCatalogPositions(
                getBookingMenuPositions().filter((_, itemIndex) => itemIndex !== index),
                { renderCatalog: false }
            );
            refreshBookingMenuCatalogAfterPositionChange({ preserveScroll: true });
            return;
        }
        if (add) {
            upsertBookingMenuCatalogProduct(add.dataset.menuCatalogAdd, 1);
            if (!isBookingMenuCatalogMobileCartLayout() || add.closest('#bookingMenuCatalogCart')) {
                setBookingMenuCatalogCartOpen(true);
            }
            return;
        }
        if (dec) upsertBookingMenuCatalogProduct(dec.dataset.menuCatalogDec, -1);
    });
    document.getElementById('bookingMenuCatalogSearch')?.addEventListener('input', () => renderBookingMenuCatalogList());
    document.getElementById('bookingMenuCatalogTabs')?.addEventListener('click', (event) => {
        const tab = event.target.closest('[data-menu-catalog-filter]');
        if (!tab) return;
        BookingPackageState.catalogFilter = tab.dataset.menuCatalogFilter || 'all';
        renderBookingMenuCatalog();
    });
    document.getElementById('bookingMenuCatalogPanel')?.addEventListener('change', (event) => {
        if (event.target.matches('[data-menu-catalog-quantity-input], [data-menu-catalog-price-input], [data-menu-catalog-note-input]')) {
            commitBookingMenuCatalogInlineInput(event.target);
        }
    });
    document.getElementById('bookingMenuCatalogPanel')?.addEventListener('keydown', (event) => {
        if (!event.target.matches('[data-menu-catalog-quantity-input], [data-menu-catalog-price-input], [data-menu-catalog-note-input]')) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            commitBookingMenuCatalogInlineInput(event.target);
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            BookingPackageState.catalogEditing = null;
            renderBookingMenuCatalog();
        }
    });
    window.addEventListener('resize', () => {
        const panel = document.getElementById('bookingMenuCatalogPanel');
        if (!panel || panel.hidden) return;
        setBookingMenuCatalogCartOpen(panel.classList.contains('booking-menu-catalog-cart-open'));
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const panel = document.getElementById('bookingMenuCatalogPanel');
        if (!panel || panel.hidden) return;
        if (event.target?.matches?.('[data-menu-catalog-quantity-input], [data-menu-catalog-price-input], [data-menu-catalog-note-input]')) return;
        event.preventDefault();
        if (BookingPackageState.catalogInsight) {
            closeBookingMenuCatalogInsight();
            return;
        }
        setBookingMenuCatalogOpen(false);
    });
    document.getElementById('maysternyaCloseSlotBtn')?.addEventListener('click', closeMaysternyaTimelineSlot);
    document.getElementById('freeRoomsPanel')?.addEventListener('click', (event) => {
        const chip = event.target.closest('[data-free-room]');
        if (!chip) return;
        const roomValue = chip.dataset.freeRoom || '';
        if (!roomValue) return;
        const room = document.getElementById('roomSelect');
        if (room) {
            ensureTimelineRoomOption(roomValue);
            room.value = roomValue;
            room.setAttribute('aria-invalid', 'false');
            room.dispatchEvent(new Event('change', { bubbles: true }));
        }
        document.getElementById('freeRoomsPanel')?.classList.add('hidden');
    });
    document.getElementById('bookingBanquetGroupSelect')?.addEventListener('change', (event) => {
        const selectedValue = String(event.target.value || '').trim();
        const explicit = BookingDrawerState.explicitBanquetContext;
        if (explicit?.groupId && selectedValue !== String(explicit.groupId)) {
            clearExplicitBookingBanquetContext({
                render: false,
                preserveIntent: !selectedValue
            });
        }
        const auto = BookingDrawerState.autoFilledBanquetFromRoom;
        if (auto?.groupId && selectedValue !== String(auto.groupId)) {
            BookingDrawerState.autoFilledBanquetFromRoom = null;
            BookingDrawerState.roomSelectionBanquetContext = null;
            if (typeof clearAutoFilledBanquetGuestsFromRoom === 'function') clearAutoFilledBanquetGuestsFromRoom();
        }
        BookingDrawerState.selectedBanquetGroupId = selectedValue;
        BookingDrawerState.manualBanquetGroupSelection = Boolean(BookingDrawerState.selectedBanquetGroupId);
        renderBookingBanquetGroupSelector();
        syncBookingGuestArrivalField();
        renderBookingPackageSummary();
        if (window.BookingForm) BookingForm._dirty = true;
    });
    document.getElementById('bookingGuestArrivalTime')?.addEventListener('input', event => {
        const rawValue = String(event.target.value || '').trim();
        BookingDrawerState.arrivalDraft = {
            guestArrivalTime: rawValue,
            source: 'arrival_input'
        };
        renderBookingGuestArrivalValidation('');
        if (window.BookingForm) BookingForm._dirty = true;
    });
    document.addEventListener('click', (event) => {
        const changeBtn = event.target.closest('[data-booking-change-banquet]');
        if (changeBtn) {
            event.preventDefault();
            const section = document.getElementById('bookingBanquetGroupSection');
            const select = document.getElementById('bookingBanquetGroupSelect');
            section?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            select?.focus();
            return;
        }
        const standaloneBtn = event.target.closest('[data-booking-standalone-override]');
        if (!standaloneBtn) return;
        event.preventDefault();
        clearExplicitBookingBanquetContext({ render: false, clearSelection: true });
        BookingDrawerState.roomSelectionBanquetContext = null;
        BookingDrawerState.autoFilledBanquetFromRoom = null;
        BookingDrawerState.selectedBanquetGroupId = '';
        BookingDrawerState.manualBanquetGroupSelection = false;
        BookingDrawerState.activeBanquetIntent = null;
        BookingDrawerState.activeBanquetRoleIntent = null;
        BookingDrawerState.standaloneBookingOverride = true;
        if (typeof clearAutoFilledBanquetGuestsFromRoom === 'function') clearAutoFilledBanquetGuestsFromRoom();
        renderBookingBanquetGroupSelector();
        renderBookingPackageSummary();
        renderBookingCustomerSearchState('Бронювання буде створено окремо, без прив’язки до активного банкету.');
        if (window.BookingForm) BookingForm._dirty = true;
    });
    document.addEventListener('click', (event) => {
        const retryBtn = event.target.closest('#bookingDepositRetryBtn');
        if (!retryBtn) return;
        event.preventDefault();
        const state = BookingDrawerState.depositHydration || {};
        const bookingId = String(state.bookingId || AppState.editingBookingId || '').trim();
        if (!bookingId) return;
        retryBtn.disabled = true;
        hydrateBookingDepositFromServer(bookingId);
    });
    ['roomSelect', 'customerSearch', 'customerName', 'customerChildName', 'selectedProgram', 'bookingPrimaryAnimatorSelect', 'kidsCountInput', 'clientPinataServicePrice', 'pinataMode', 'pinataNumber', 'pinataFillerNumber', 'pinataFillerSelect',
     'secondAnimatorSelect', 'extraHostToggle', 'extraHostAnimatorSelect', 'banquetMenu', 'banquetGuests', 'banquetAdults', 'banquetTables',
     'bookingDepositExpectedAmount', 'bookingDepositDueDate', 'bookingDepositManagerStatus', 'bookingDepositManagerNote',
     'educationLessonTitle', 'educationLessonTeacher', 'educationLessonGroup', 'educationLessonCourse',
     'educationLessonSeriesSize', 'educationLessonRepeatEvery', 'educationLessonType',
     'bookingGroupName', 'bookingNotes', 'bookingLeadSource', 'bookingLeadStatus', 'bookingLeadInterestDate',
     'bookingLeadBudget', 'bookingLeadChildrenInfo', 'bookingLeadNotes'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            if (id === 'educationLessonGroup') syncEducationGroupToBookingGroup();
            if (id === 'banquetGuests' && typeof markBanquetGuestsManualOverride === 'function') markBanquetGuestsManualOverride();
            renderBookingPackageSummary();
            refreshBookingActiveBanquetRoleIntent();
            if (id === 'customerName' || id === 'customerPhone' || id === 'customerInstagram') {
                debouncedBookingDuplicateCheck();
            }
        });
        el.addEventListener('change', () => {
            if (id === 'educationLessonGroup') syncEducationGroupToBookingGroup();
            if (id === 'banquetGuests' && typeof markBanquetGuestsManualOverride === 'function') markBanquetGuestsManualOverride();
            renderBookingPackageSummary();
            refreshBookingActiveBanquetRoleIntent();
            if (id === 'customerName' || id === 'customerPhone' || id === 'customerInstagram') {
                debouncedBookingDuplicateCheck();
            }
        });
    });
    const legacy = document.getElementById('banquetMenu');
    if (legacy) legacy.addEventListener('input', () => {
        legacy.dataset.generated = 'false';
        syncBookingWorkspaceMode();
    });
    renderBookingMenuPositions();
    syncBookingWorkspaceMode();
}

function inferBookingPinataMode(booking, program) {
    const pinataMode = bookingPinataField(booking, 'pinataMode', 'pinata_mode');
    const programId = bookingPinataField(booking, 'programId', 'program_id');
    const clientPinataServicePrice = bookingPinataField(booking, 'clientPinataServicePrice', 'client_pinata_service_price');
    const pinataFillerNumber = bookingPinataField(booking, 'pinataFillerNumber', 'pinata_filler_number');
    const pinataFiller = bookingPinataField(booking, 'pinataFiller', 'pinata_filler');
    if (pinataMode) return pinataMode;
    if (programId === 'pinata_own') return 'client';
    if (clientPinataServicePrice !== undefined && clientPinataServicePrice !== null) return 'client';
    if (isClientPinataFillerNumber(pinataFillerNumber) || isClientPinataFillerChoice(pinataFiller)) return 'park';
    if (pinataFiller) return 'park';
    return isPinataProgram(program) ? 'park' : 'none';
}

function renderPinataDetailRows(booking) {
    const pinataMode = bookingPinataField(booking, 'pinataMode', 'pinata_mode');
    const pinataNumber = bookingPinataNumberValue(booking);
    const pinataFiller = bookingPinataField(booking, 'pinataFiller', 'pinata_filler');
    const pinataFillerNumber = bookingPinataField(booking, 'pinataFillerNumber', 'pinata_filler_number');
    const clientPinataServicePrice = bookingPinataField(booking, 'clientPinataServicePrice', 'client_pinata_service_price');
    const clientPinataServiceNote = bookingPinataField(booking, 'clientPinataServiceNote', 'client_pinata_service_note');
    const clientOwnedFiller = isClientPinataFillerNumber(pinataFillerNumber) || isClientPinataFillerChoice(pinataFiller);
    const numberRows = [
        pinataNumber
            ? `<div class="booking-detail-row"><span class="label">Номер піньяти:</span><span class="value">${escapeHtml(bookingPinataNumberDisplay(pinataNumber))}</span></div>`
            : '',
        clientOwnedFiller
            ? `<div class="booking-detail-row"><span class="label">Наповнювач:</span><span class="value">${escapeHtml(CLIENT_PINATA_FILLER_LABEL)}</span></div>`
            : (pinataFillerNumber
                ? `<div class="booking-detail-row"><span class="label">Номер наповнювача:</span><span class="value">${escapeHtml(pinataFillerNumberLabel(pinataFillerNumber))}</span></div>`
                : '')
    ].join('');

    if (pinataMode === 'client') {
        const note = clientPinataServiceNote
            ? `<div class="booking-detail-row"><span class="label">Нотатка:</span><span class="value">${escapeHtml(clientPinataServiceNote)}</span></div>`
            : '';
        return `<div class="booking-detail-row"><span class="label">Піньята:</span><span class="value">Клієнтська піньята (послуга)${clientPinataServicePrice ? ` - ${escapeHtml(formatPrice(clientPinataServicePrice))}` : ''}</span></div>${numberRows}${note}`;
    }
    if ((pinataMode === 'park' || !pinataMode) && pinataFiller) {
        if (isClientPinataFillerChoice(pinataFiller)) return numberRows;
        return `<div class="booking-detail-row"><span class="label">Піньята парку:</span><span class="value">${escapeHtml(pinataFiller)}</span></div>${numberRows}`;
    }
    if (numberRows) return numberRows;

    if (pinataMode === 'client') {
        const note = clientPinataServiceNote
            ? `<div class="booking-detail-row"><span class="label">Нотатка:</span><span class="value">${escapeHtml(clientPinataServiceNote)}</span></div>`
            : '';
        return `<div class="booking-detail-row"><span class="label">Піньята:</span><span class="value">Клієнтська піньята (послуга)${clientPinataServicePrice ? ` - ${escapeHtml(formatPrice(clientPinataServicePrice))}` : ''}</span></div>${note}`;
    }
    if ((pinataMode === 'park' || !pinataMode) && pinataFiller) {
        if (isClientPinataFillerChoice(pinataFiller)) return '';
        return `<div class="booking-detail-row"><span class="label">Піньята парку:</span><span class="value">${escapeHtml(pinataFiller)}</span></div>`;
    }
    return '';
}

// ==========================================
// ПАНЕЛЬ БРОНЮВАННЯ
// ==========================================

async function initializeRoomFirstBookingSourceContext() {
    if (!isRoomFirstTimelineView() || AppState.editingBookingId) return false;
    if (BookingDrawerState.activeBanquetIntent === 'add_to_existing' && BookingDrawerState.explicitBanquetContext?.groupId) return false;
    const roomName = String(document.getElementById('roomSelect')?.value || '').trim();
    if (!roomName) return false;
    try {
        await handleBookingRoomSelectionContextChange();
        return Boolean(BookingDrawerState.roomSelectionBanquetContext?.sourceBookingId);
    } catch (error) {
        console.warn('[Booking] Room-first source context init failed', error);
        return false;
    }
}

function normalizeExplicitBanquetPrefillCount(value) {
    if (value === undefined || value === null) return '';
    const text = String(value).trim();
    if (!text) return '';
    const number = Number(text);
    if (!Number.isFinite(number) || number < 0) return '';
    return String(Math.round(number * 100) / 100);
}

function normalizeExplicitBanquetPackageSnapshot(input = null) {
    if (!input || typeof input !== 'object') return null;
    const menuSource = input.menuPositions || input.menu_positions || [];
    const eventSource = input.serviceEvents || input.service_events || [];
    const menuPositions = (Array.isArray(menuSource) ? menuSource : [])
        .map((item, index) => normalizeBookingMenuPosition(item, index))
        .filter(Boolean);
    const serviceEvents = (Array.isArray(eventSource) ? eventSource : [])
        .map((item, index) => normalizeBookingServiceEvent(item, index))
        .filter(Boolean);
    const banquetMenu = String(input.banquetMenu || input.banquet_menu || '').trim();
    if (!menuPositions.length && !serviceEvents.length && !banquetMenu) return null;
    return {
        sourceBookingId: input.sourceBookingId || input.source_booking_id || null,
        menuPositions,
        serviceEvents,
        banquetMenu,
        programBasePrice: input.programBasePrice ?? input.program_base_price ?? null,
        positionsSubtotal: input.positionsSubtotal ?? input.positions_subtotal ?? null,
        entryCharge: input.entryCharge || input.entry_charge || null,
        entrySubtotal: input.entrySubtotal ?? input.entry_subtotal ?? null,
        finalTotal: input.finalTotal ?? input.final_total ?? null,
        warnings: Array.isArray(input.warnings) ? input.warnings.map(item => ({ ...item })) : [],
        source: input.source || 'timeline_banquet_context'
    };
}

function normalizeBookingActiveBanquetRoleIntent(value) {
    const role = String(value || '').trim().toLowerCase();
    if (['activity', 'kitchen', 'service', 'manual', 'needs_choice'].includes(role)) return role;
    return '';
}

function activeBanquetPackageHasMenu(packageSnapshot = null) {
    return Array.isArray(packageSnapshot?.menuPositions) && packageSnapshot.menuPositions.length > 0;
}

function activeBanquetPackageHasService(packageSnapshot = null) {
    return Array.isArray(packageSnapshot?.serviceEvents) && packageSnapshot.serviceEvents.length > 0;
}

function resolveBookingActiveBanquetRoleIntent(context = BookingDrawerState.explicitBanquetContext || {}) {
    if (BookingDrawerState.activeBanquetIntent !== 'add_to_existing') return null;
    const programId = typeof getSelectedProgramIdFromUi === 'function' ? getSelectedProgramIdFromUi() : (document.getElementById('selectedProgram')?.value || '');
    if (programId) return 'activity';
    const packageSnapshot = context?.packageSnapshot || BookingDrawerState.explicitBanquetContext?.packageSnapshot || null;
    const hasDraftMenu = getBookingMenuPositions().length > 0 || activeBanquetPackageHasMenu(packageSnapshot);
    const hasDraftService = getBookingServiceEvents().length > 0 || activeBanquetPackageHasService(packageSnapshot);
    if (isBookingKitchenEnabled()) {
        if (hasDraftMenu) return 'kitchen';
        if (hasDraftService) return 'service';
        return 'kitchen';
    }
    const explicitRole = normalizeBookingActiveBanquetRoleIntent(context?.roleIntent || context?.role_intent || BookingDrawerState.activeBanquetRoleIntent);
    if (explicitRole) return explicitRole;
    return 'needs_choice';
}

function refreshBookingActiveBanquetRoleIntent(options = {}) {
    if (BookingDrawerState.activeBanquetIntent !== 'add_to_existing') return null;
    const role = resolveBookingActiveBanquetRoleIntent(BookingDrawerState.explicitBanquetContext || {});
    BookingDrawerState.activeBanquetRoleIntent = role;
    if (options.render !== false) renderBookingBanquetGroupSelector();
    return role;
}

function setExplicitBanquetPrefillValue(id, value, options = {}) {
    const el = document.getElementById(id);
    if (!el) return false;
    const next = String(value ?? '').trim();
    if (!next) return false;
    if (options.onlyIfEmpty !== false && String(el.value || '').trim()) return false;
    el.value = next;
    return true;
}

function applyExplicitBanquetPackagePrefill(context = {}) {
    if (!isBookingKitchenEnabled()) return false;
    const packageSnapshot = context.packageSnapshot || null;
    const menuPositions = Array.isArray(packageSnapshot?.menuPositions) ? packageSnapshot.menuPositions : [];
    const serviceEvents = Array.isArray(packageSnapshot?.serviceEvents) ? packageSnapshot.serviceEvents : [];
    const hadPackage = Boolean(menuPositions.length || serviceEvents.length || packageSnapshot?.banquetMenu);

    setExplicitBanquetPrefillValue('banquetGuests', context.banquetGuests || context.kidsCount, { onlyIfEmpty: true });
    setExplicitBanquetPrefillValue('banquetAdults', context.banquetAdults, { onlyIfEmpty: true });
    setExplicitBanquetPrefillValue('banquetTables', context.banquetTables, { onlyIfEmpty: true });

    if (menuPositions.length && !getBookingMenuPositions().length) {
        BookingPackageState.menuPositions = menuPositions
            .map((item, index) => normalizeBookingMenuPosition(item, index))
            .filter(Boolean);
    }
    if (serviceEvents.length && !getBookingServiceEvents().length) {
        BookingPackageState.serviceEvents = serviceEvents
            .map((item, index) => normalizeBookingServiceEvent(item, index))
            .filter(Boolean);
    }
    const banquetMenu = document.getElementById('banquetMenu');
    if (banquetMenu && !banquetMenu.value.trim()) {
        const legacyMenu = packageSnapshot?.banquetMenu || bookingMenuPositionsToLegacyText(BookingPackageState.menuPositions);
        if (legacyMenu) {
            banquetMenu.value = legacyMenu;
            banquetMenu.dataset.generated = BookingPackageState.menuPositions.length ? 'true' : 'false';
        }
    }
    renderBookingMenuPositions({ renderCatalog: false });
    renderBookingPackageSummary();
    return hadPackage;
}

function applyExplicitBanquetPrefill(context = {}, options = {}) {
    if (!context?.groupId) return false;
    const targetTime = context.targetTime || options.time || '';
    if (targetTime) setExplicitBanquetPrefillValue('bookingTime', targetTime, { onlyIfEmpty: false });
    const targetRoom = context.targetRoom || context.sourceRoom || options.room || '';
    if (targetRoom && isRoomFirstTimelineView()) {
        ensureTimelineRoomOption(targetRoom);
        setExplicitBanquetPrefillValue('roomSelect', targetRoom, { onlyIfEmpty: false });
    }
    setExplicitBanquetPrefillValue('bookingGroupName', context.groupName, { onlyIfEmpty: true });
    applyExplicitBanquetPackagePrefill(context);
    refreshBookingActiveBanquetRoleIntent({ render: false });
    renderBookingBanquetGroupSelector();
    return true;
}

function normalizeExplicitBookingBanquetContext(input = null, options = {}) {
    if (!input || typeof input !== 'object') return null;
    const groupId = String(input.groupId || input.group_id || '').trim();
    if (!groupId) return null;
    const selectedDate = options.date || (typeof AppState !== 'undefined' ? AppState.selectedDate : null) || null;
    const date = String(input.date || (selectedDate ? formatDate(selectedDate) : '') || '').slice(0, 10);
    const sourceBookingId = String(input.sourceBookingId || input.source_booking_id || input.primaryBookingId || input.primary_booking_id || '').trim();
    const primaryBookingId = String(input.primaryBookingId || input.primary_booking_id || sourceBookingId || '').trim();
    const customerId = input.customerId ?? input.customer_id ?? null;
    const customerName = String(input.customerName || input.customer_name || '').trim();
    const targetRoom = String(input.targetRoom || input.target_room || options.room || '').trim();
    const sourceRoom = String(input.room || input.sourceRoom || input.source_room || '').trim();
    const kidsCount = normalizeExplicitBanquetPrefillCount(input.kidsCount ?? input.kids_count);
    const banquetGuests = normalizeExplicitBanquetPrefillCount(input.banquetGuests ?? input.banquet_guests ?? kidsCount);
    const packageSnapshot = normalizeExplicitBanquetPackageSnapshot(input.packageSnapshot || input.package_snapshot || input.bookingPackage || input.booking_package);
    return {
        groupId,
        sourceBookingId: sourceBookingId || primaryBookingId || null,
        primaryBookingId: primaryBookingId || sourceBookingId || null,
        groupName: String(input.groupName || input.group_name || '').trim(),
        customerId: customerId != null && String(customerId).trim() !== '' ? String(customerId).trim() : null,
        customerName,
        businessContext: String(input.businessContext || input.business_context || (typeof timelineBusinessContextValue === 'function' ? timelineBusinessContextValue() : '') || '').trim(),
        date,
        sourceRoom,
        targetRoom,
        sourceTime: String(input.time || input.sourceTime || input.source_time || '').trim(),
        targetTime: String(input.targetTime || input.target_time || options.time || '').trim(),
        targetLineId: String(input.targetLineId || input.target_line_id || options.lineId || '').trim(),
        targetIsDifferentRoom: Boolean(input.targetIsDifferentRoom || input.target_is_different_room),
        kidsCount,
        banquetGuests,
        banquetAdults: normalizeExplicitBanquetPrefillCount(input.banquetAdults ?? input.banquet_adults),
        banquetTables: normalizeExplicitBanquetPrefillCount(input.banquetTables ?? input.banquet_tables),
        menuCount: Number(input.menuCount ?? input.menu_count ?? packageSnapshot?.menuPositions?.length ?? 0) || 0,
        activityCount: Number(input.activityCount ?? input.activity_count ?? 0) || 0,
        packageSnapshot,
        roleIntent: normalizeBookingActiveBanquetRoleIntent(input.roleIntent || input.role_intent),
        source: String(options.contextSource || input.source || 'timeline_empty_cell').trim()
    };
}

function applyExplicitBookingBanquetContext(context = null, options = {}) {
    const normalized = normalizeExplicitBookingBanquetContext(context, options);
    if (!normalized) return null;
    BookingDrawerState.explicitBanquetContext = normalized;
    BookingDrawerState.roomSelectionBanquetContext = {
        ...normalized,
        sourceCustomerId: normalized.customerId,
        sourceCustomerName: normalized.customerName,
        banquetGroupCustomerId: normalized.customerId,
        roomSourceContext: null
    };
    BookingDrawerState.selectedBanquetGroupId = normalized.groupId;
    BookingDrawerState.manualBanquetGroupSelection = false;
    BookingDrawerState.autoFilledBanquetFromRoom = BookingDrawerState.roomSelectionBanquetContext;
    BookingDrawerState.activeBanquetIntent = 'add_to_existing';
    BookingDrawerState.activeBanquetRoleIntent = resolveBookingActiveBanquetRoleIntent(normalized);
    BookingDrawerState.standaloneBookingOverride = false;

    if (normalized.customerId || normalized.customerName) {
        applySelectedCustomerToBookingForm({
            id: normalized.customerId || '',
            name: normalized.customerName || ''
        }, {
            markDirty: false,
            renderSummary: false
        });
    }
    applyExplicitBanquetPrefill(normalized, options);
    renderBookingBanquetGroupSelector();
    return BookingDrawerState.roomSelectionBanquetContext;
}

function clearExplicitBookingBanquetContext(options = {}) {
    BookingDrawerState.explicitBanquetContext = null;
    BookingDrawerState.activeBanquetIntent = options.preserveIntent === true ? 'add_to_existing' : null;
    BookingDrawerState.activeBanquetRoleIntent = null;
    BookingDrawerState.standaloneBookingOverride = false;
    if (options.clearSelection === true) {
        BookingDrawerState.selectedBanquetGroupId = '';
        BookingDrawerState.manualBanquetGroupSelection = false;
    }
    if (options.render !== false) renderBookingBanquetGroupSelector();
}

function normalizeBookingGuestArrivalTime(value) {
    const time = String(value || '').trim();
    return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time) ? time : '';
}

function bookingGuestArrivalFieldRequired() {
    if (AppState.editingBookingId || !isParkTimelineBookingMode()) return false;
    const selectedGroupId = typeof getSelectedBookingBanquetGroupId === 'function'
        ? getSelectedBookingBanquetGroupId()
        : BookingDrawerState.selectedBanquetGroupId;
    if (String(selectedGroupId || '').trim()) return false;
    if (BookingDrawerState.explicitBanquetContext?.mode === 'existing') return false;
    return BookingDrawerState.banquetCreationMode === 'new'
        || BookingDrawerState.explicitBanquetContext?.mode === 'new'
        || isRoomFirstTimelineView();
}

function renderBookingGuestArrivalValidation(message = '') {
    const input = document.getElementById('bookingGuestArrivalTime');
    const error = document.getElementById('bookingGuestArrivalError');
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (!error) return;
    error.textContent = message;
    error.classList.toggle('hidden', !message);
}

function syncBookingGuestArrivalField(options = {}) {
    const section = document.getElementById('bookingGuestArrivalSection');
    const input = document.getElementById('bookingGuestArrivalTime');
    if (!section || !input) return;
    const visible = bookingGuestArrivalFieldRequired();
    section.hidden = !visible;
    section.classList.toggle('hidden', !visible);
    section.setAttribute('aria-hidden', visible ? 'false' : 'true');
    input.required = visible;
    input.setAttribute('aria-required', visible ? 'true' : 'false');
    if (visible && (options.reset === true || !input.value)) {
        input.value = normalizeBookingGuestArrivalTime(BookingDrawerState.arrivalDraft?.guestArrivalTime);
    }
    if (!visible) renderBookingGuestArrivalValidation('');
}

function initializeBookingArrivalDraft(time, context = null) {
    const requestedTime = context?.mode === 'new' ? context.guestArrivalTime : null;
    BookingDrawerState.arrivalDraft = {
        guestArrivalTime: normalizeBookingGuestArrivalTime(requestedTime) || normalizeBookingGuestArrivalTime(time),
        source: requestedTime ? 'banquet_context' : 'timeline_click'
    };
    BookingDrawerState.banquetCreationMode = context?.mode === 'new'
        ? 'new'
        : (context?.mode === 'existing' ? null : (isRoomFirstTimelineView() ? 'new' : null));
    syncBookingGuestArrivalField({ reset: true });
    return BookingDrawerState.arrivalDraft;
}

async function newBanquetContextFromArrivalDraft(options = {}) {
    const arrivalInput = document.getElementById('bookingGuestArrivalTime');
    const arrivalSection = document.getElementById('bookingGuestArrivalSection');
    const visibleArrivalInput = Boolean(arrivalInput && arrivalSection && !arrivalSection.hidden);
    let guestArrivalTime = normalizeBookingGuestArrivalTime(
        (visibleArrivalInput ? arrivalInput.value : '')
        || BookingDrawerState.arrivalDraft?.guestArrivalTime
        || options.defaultTime
    );
    if (options.prompt === true && !visibleArrivalInput) {
        if (typeof promptModal !== 'function') {
            showNotification('Діалог часу приходу недоступний. Оновіть сторінку.', 'error');
            return null;
        }
        const entered = await promptModal('Час приходу гостей (HH:mm)', {
            defaultValue: guestArrivalTime || '',
            inputType: 'time',
            okText: 'Зберегти'
        });
        if (entered === null) return null;
        guestArrivalTime = normalizeBookingGuestArrivalTime(entered);
    }
    if (!guestArrivalTime) {
        renderBookingGuestArrivalValidation('Вкажіть час приходу гостей у форматі HH:mm.');
        if (visibleArrivalInput) arrivalInput.focus();
        showNotification('Вкажіть час приходу гостей у форматі HH:mm.', 'error');
        return null;
    }
    renderBookingGuestArrivalValidation('');
    if (arrivalInput) arrivalInput.value = guestArrivalTime;
    BookingDrawerState.arrivalDraft = { guestArrivalTime, source: options.source || 'booking_create' };
    return { mode: 'new', groupId: null, guestArrivalTime };
}

async function openBookingPanel(time, lineId, options = {}) {
    const existingPanel = document.getElementById('bookingPanel');
    if (existingPanel && !existingPanel.classList.contains('hidden')) {
        const closed = await closeBookingPanel(false);
        if (!closed) return false;
    }
    const panelEl = document.getElementById('bookingPanel');
    panelEl?.classList.toggle('booking-panel--maysternya', isMaysternyaBookingContext());
    panelEl?.classList.toggle('booking-panel--minimal-timeline', isMinimalTimelineBookingMode());
    panelEl?.classList.toggle('booking-panel--education-timeline', isEducationTimelineBookingMode());
    panelEl?.classList.toggle('booking-panel--room-first', isRoomFirstTimelineView());
    const lines = await getLinesForDate(AppState.selectedDate);
    const roomFirst = isRoomFirstTimelineView();
    const requestedLineId = String(lineId || '').trim();
    const line = lines.find(l =>
        String(l.id) === requestedLineId
        || (roomFirst && [
            l.resourceId,
            l.resource_id,
            l.name,
            l.shortName,
            l.short_name
        ].some(value => sameBookingRoom(value, requestedLineId)))
    );
    if (String(lineId || '') === 'afisha') {
        showNotification('Рядок Афіша не створює звичайні бронювання. Додавайте афішні події через сторінку «Афіша» або оберіть лінію аніматора.', 'warning');
        return false;
    }
    if (!line) {
        showNotification('Лінію для бронювання не знайдено. Оновіть таймлайн або оберіть активну лінію аніматора.', 'error');
        return false;
    }
    const explicitBanquetContext = normalizeExplicitBookingBanquetContext(options.banquetContext, {
        contextSource: options.contextSource,
        time,
        lineId,
        room: line?.name || ''
    });
    resetBookingDrawerStateForOpen(options.drawerMode || inferBookingDrawerModeForOpen());
    resetSelectedActivityScheduleState();
    initializeBookingArrivalDraft(time, options.banquetContext);

    // C1: Show date in panel
    const dateDisplay = document.getElementById('selectedDateDisplay');
    if (dateDisplay) {
        const d = AppState.selectedDate;
        dateDisplay.textContent = `${formatDate(d)} (${DAYS[d.getDay()]})`;
    }
    document.getElementById('selectedTimeDisplay').textContent = time;
    document.getElementById('selectedLineDisplay').textContent = line ? line.name : '-';
    document.getElementById('bookingTime').value = time;
    document.getElementById('bookingLine').value = isRoomFirstTimelineView() ? ROOM_FIRST_BANQUET_SERVICE_LINE_ID : lineId;

    // Скинути форму
    document.getElementById('roomSelect').value = '';
    if (isRoomFirstTimelineView()) {
        await loadBookingRoomResourcesForSelect({ selectedRoom: line.name });
        ensureTimelineRoomOption(line.name, {
            resourceId: line.resourceId || line.resource_id || line.id,
            resourceType: line.resourceType || line.resource_type || 'room',
            name: line.name
        });
        document.getElementById('roomSelect').value = line.name;
    }
    document.getElementById('selectedProgram').value = '';
    document.getElementById('bookingNotes').value = '';
    const groupInput = document.getElementById('bookingGroupName');
    if (groupInput) groupInput.value = '';
    document.querySelectorAll('.program-icon').forEach(i => {
        i.classList.remove('selected');
        i.setAttribute('aria-pressed', 'false');
    });
    // v5.49: Reset program search
    const programSearch = document.getElementById('programSearch');
    if (programSearch) { programSearch.value = ''; filterPrograms(); }
    renderProgramCategoryChips();
    renderSelectedProgramSummary(null);
    document.getElementById('hostsWarning')?.classList.add('hidden');
    document.getElementById('customProgramSection')?.classList.add('hidden');
    document.getElementById('secondAnimatorSection')?.classList.add('hidden');
    resetPinataModeFields();
    setBookingWorkspaceHasEvent(true, { markDirty: false });
    setBookingKitchenEnabled(false, { markDirty: false });
    setBookingLeadDetailsEnabled(false, { markDirty: false });

    // Скинути toggle додаткового ведучого
    const extraHostToggle = document.getElementById('extraHostToggle');
    if (extraHostToggle) {
        extraHostToggle.checked = false;
        document.getElementById('extraHostAnimatorSection')?.classList.add('hidden');
    }

    // Скинути костюм
    const costumeSelect = document.getElementById('costumeSelect');
    if (costumeSelect) costumeSelect.value = '';
    if (typeof initializeCostumes === 'function') {
        await initializeCostumes({ refreshWarehouse: true });
    }

    // Скинути статус та к-кість дітей
    const statusRadio = document.querySelector('input[name="bookingStatus"][value="confirmed"]');
    if (statusRadio) statusRadio.checked = true;
    const kidsCountSection = document.getElementById('kidsCountSection');
    if (kidsCountSection) kidsCountSection.classList.add('hidden');
    const kidsCountInput = document.getElementById('kidsCountInput');
    if (kidsCountInput) kidsCountInput.value = '';
    resetEducationLessonFields();

    // Ensure program catalog opens in the full chip/grid mode every time.
    document.querySelectorAll('#programsIcons .category-header').forEach(h => h.style.display = '');
    document.querySelectorAll('#programsIcons .category-grid').forEach(g => g.style.display = '');

    // v15.1: Reset CRM customer section
    clearCustomerFields();
    const customerToggle = document.getElementById('customerDataToggle');
    if (customerToggle) customerToggle.checked = true;
    document.getElementById('customerDataSection')?.classList.remove('hidden');
    resetBookingLeadDetails();
    resetBookingPackageWorkspace();
    applyLeadConversionContextToBookingForm();
    const appliedExplicitBanquetContext = applyExplicitBookingBanquetContext(explicitBanquetContext, {
        contextSource: options.contextSource,
        time,
        lineId,
        room: line?.name || ''
    });
    if (isRoomFirstTimelineView()) {
        if (!appliedExplicitBanquetContext) {
            await prefillRoomFirstCustomerFromRoomLine(line.name, time);
        }
    }
    prepareMaysternyaBookingPanel();
    prepareDisplayModeBookingPanel({ line });
    if (isRoomFirstTimelineView()) {
        syncBookingWorkspaceMode({ markDirty: false });
    }
    updateBookingContextHeaderSummary();
    await refreshBookingRoomAvailabilityForSelectedDate();
    if (!appliedExplicitBanquetContext) {
        await initializeRoomFirstBookingSourceContext();
    }
    syncBookingGuestArrivalField({ reset: true });

    document.getElementById('bookingPanel')?.classList.remove('hidden');
    document.querySelector('.main-content').classList.add('panel-open');
    // v5.33: Lock body scroll on mobile when panel is open
    document.body.classList.add('panel-open');
    // v5.35: Show backdrop overlay on tablet/mobile
    document.getElementById('panelBackdrop')?.classList.remove('hidden');
    const panel = document.getElementById('bookingPanel');
    if (window.UnsafeDismissGuard && panel) window.UnsafeDismissGuard.remember(panel);
    if (window.BookingForm?.markClean) BookingForm.markClean();
    requestBookingEntryPriceRulesPreview();
    return true;
}

// ==========================================
// CRM: CUSTOMER DATA (v15.1)
// ==========================================

function clearCustomerFields() {
    const fields = ['customerSearch', 'customerName', 'customerPhone', 'customerInstagram', 'customerChildName', 'customerChildBirthday'];
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.value = '';
            delete el.dataset.selectedValue;
        }
    });
    const source = document.getElementById('customerSource');
    if (source) {
        source.value = '';
        delete source.dataset.selectedValue;
    }
    const hiddenId = document.getElementById('selectedCustomerId');
    if (hiddenId) hiddenId.value = '';
    document.getElementById('customerSearchResults')?.classList.add('hidden');
    document.getElementById('customerInfo')?.classList.add('hidden');
    renderSelectedCustomerCard(null);
    renderBookingCustomerSearchState('');
    setBookingClientMode('search');
    resetBookingBanquetGroupSelector();
    syncBookingGuestArrivalField();
    const duplicateHint = document.getElementById('bookingCustomerDuplicateHint');
    if (duplicateHint) {
        duplicateHint.classList.add('hidden');
        duplicateHint.innerHTML = '';
    }
}

function rememberSelectedCustomerSnapshot(customer = {}) {
    const primaryChild = bookingCustomerPrimaryChild(customer) || {};
    const values = {
        customerSearch: customer.name || '',
        customerName: customer.name || '',
        customerPhone: customer.phone || '',
        customerInstagram: customer.instagram || '',
        customerChildName: primaryChild.name || customer.childName || '',
        customerChildBirthday: primaryChild.birthday || (customer.childBirthday ? customer.childBirthday.split('T')[0] : ''),
        customerSource: customer.source || ''
    };
    Object.entries(values).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.dataset.selectedValue = value || '';
    });
}

function normalizeBookingCustomerSelection(customer = {}, fallback = {}) {
    const source = customer && typeof customer === 'object' ? customer : {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};
    const id = source.id ?? source.customerId ?? source.customer_id ?? base.id ?? base.customerId ?? base.customer_id ?? '';
    const sourceChildren = bookingCustomerChildrenProjection(source);
    const fallbackChildren = bookingCustomerChildrenProjection(base);
    const children = sourceChildren.length ? sourceChildren : fallbackChildren;
    const primaryChild = children[0] || {};
    const birthday = primaryChild.birthday ?? source.childBirthday ?? source.child_birthday ?? base.childBirthday ?? base.child_birthday ?? '';
    return {
        id,
        name: source.name ?? source.customerName ?? source.customer_name ?? base.name ?? base.customerName ?? base.customer_name ?? '',
        phone: source.phone ?? source.customerPhone ?? source.customer_phone ?? base.phone ?? base.customerPhone ?? base.customer_phone ?? '',
        instagram: source.instagram ?? base.instagram ?? '',
        children,
        childName: primaryChild.name || source.childName || source.child_name || base.childName || base.child_name || '',
        childBirthday: birthday ? String(birthday).split('T')[0] : '',
        source: source.source ?? base.source ?? '',
        notes: source.notes ?? source.customerNotes ?? source.customer_notes ?? base.notes ?? base.customerNotes ?? base.customer_notes ?? '',
        totalBookings: Number(source.totalBookings ?? source.total_bookings ?? base.totalBookings ?? base.total_bookings ?? 0) || 0
    };
}

function applySelectedCustomerToBookingForm(customer = {}, options = {}) {
    const normalized = normalizeBookingCustomerSelection(customer, options.fallback || {});
    const selectedId = document.getElementById('selectedCustomerId');
    if (selectedId && normalized.id) selectedId.value = normalized.id;

    const values = {
        customerName: normalized.name || '',
        customerPhone: normalized.phone || '',
        customerInstagram: normalized.instagram || '',
        customerChildName: normalized.childName || '',
        customerChildBirthday: normalized.childBirthday || '',
        customerSource: normalized.source || '',
        customerSearch: normalized.name || ''
    };
    Object.entries(values).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    });

    rememberSelectedCustomerSnapshot(normalized);
    document.getElementById('customerSearchResults')?.classList.add('hidden');
    const duplicateHint = document.getElementById('bookingCustomerDuplicateHint');
    if (duplicateHint) {
        duplicateHint.classList.add('hidden');
        duplicateHint.innerHTML = '';
    }
    renderSelectedCustomerCard(normalized);
    renderBookingCustomerSearchState('');
    setBookingClientMode('existing');

    const info = document.getElementById('customerInfo');
    const badge = document.getElementById('customerVisitBadge');
    if (badge) badge.textContent = bookingCustomerVisitLabel(normalized.totalBookings) || '0 візитів';
    info?.classList.add('hidden');

    if (options.renderSummary !== false) renderBookingPackageSummary();
    updateBookingContextHeaderSummary();
    scheduleBookingBanquetGroupCandidatesRefresh({
        preselectGroupId: BookingDrawerState.roomSelectionBanquetContext?.groupId || BookingDrawerState.roomBookingAnimationBridge?.groupId || '',
        preserveSelection: true
    });
    if (options.markDirty !== false && window.BookingForm) BookingForm._dirty = true;
    return normalized;
}

function bookingCustomerFallback(booking = {}) {
    const customerId = booking.customerId ?? booking.customer_id ?? booking.customer?.id ?? '';
    if (!customerId) return null;
    return normalizeBookingCustomerSelection({
        id: customerId,
        name: booking.customerName || booking.customer_name || booking.customer?.name || `Клієнт #${customerId}`,
        phone: booking.customerPhone || booking.customer_phone || booking.customer?.phone || '',
        instagram: booking.customerInstagram || booking.customer_instagram || booking.customer?.instagram || '',
        childName: booking.customerChildName || booking.customer_child_name || booking.customer?.childName || '',
        childBirthday: booking.customerChildBirthday || booking.customer_child_birthday || booking.customer?.childBirthday || '',
        source: booking.customerSource || booking.customer_source || booking.customer?.source || ''
    });
}

async function hydrateBookingCustomerSelection(booking = {}, options = {}) {
    const fallback = bookingCustomerFallback(booking);
    if (!fallback) {
        setBookingClientMode('search');
        return null;
    }

    const customerToggle = document.getElementById('customerDataToggle');
    if (customerToggle) customerToggle.checked = true;
    document.getElementById('customerDataSection')?.classList.remove('hidden');

    if (typeof options.isCurrent === 'function' && !options.isCurrent()) return null;
    applySelectedCustomerToBookingForm(fallback, {
        markDirty: false,
        renderSummary: false
    });

    try {
        const customer = await apiGetCustomer(fallback.id);
        if (typeof options.isCurrent === 'function' && !options.isCurrent()) return fallback;
        if (!customer) {
            if (options.renderSummary !== false) renderBookingPackageSummary();
            return fallback;
        }
        return applySelectedCustomerToBookingForm(customer, {
            fallback,
            markDirty: false,
            renderSummary: options.renderSummary !== false
        });
    } catch (error) {
        console.warn('[Booking] Не вдалося підтягнути клієнта бронювання', error);
        if (options.renderSummary !== false) renderBookingPackageSummary();
        return fallback;
    }
}

function sameBookingRoom(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function scoreRoomCustomerSourceBooking(booking = {}, targetTime = '') {
    const targetStart = timeToMinutes(targetTime || '00:00');
    const start = timeToMinutes(booking.time || '00:00');
    const duration = Number(booking.duration || 0) || 0;
    const end = start + duration;
    if (targetStart >= start && targetStart < end) return -10000 + Math.abs(targetStart - start);
    return Math.min(Math.abs(targetStart - start), Math.abs(targetStart - end));
}

async function findRoomFirstCustomerSourceBooking(roomName, time) {
    if (!isRoomFirstTimelineView() || !roomName) return null;
    const bookings = await getBookingsForDate(AppState.selectedDate, { force: true }).catch(error => {
        console.warn('[Booking] Не вдалося знайти клієнта для кімнати', error);
        return [];
    });
    const candidates = (Array.isArray(bookings) ? bookings : [])
        .filter(booking =>
            booking
            && !booking.linkedTo
            && booking.status !== 'cancelled'
            && booking.customerId
            && sameBookingRoom(booking.room, roomName)
        )
        .sort((a, b) => scoreRoomCustomerSourceBooking(a, time) - scoreRoomCustomerSourceBooking(b, time));
    return candidates[0] || null;
}

async function prefillRoomFirstCustomerFromRoomLine(roomName, time) {
    if (!isRoomFirstTimelineView() || AppState.editingBookingId) return null;
    if (document.getElementById('selectedCustomerId')?.value) return null;
    const sourceBooking = await findRoomFirstCustomerSourceBooking(roomName, time);
    if (!sourceBooking) return null;
    const customer = await hydrateBookingCustomerSelection(sourceBooking, { renderSummary: false });
    if (customer?.id) {
        renderBookingCustomerSearchState(`Клієнта підтягнуто з бронювання ${sourceBooking.time} у цій кімнаті. Можна змінити вручну.`);
        renderBookingPackageSummary();
    }
    return customer;
}

function nextBookingRoomSelectionContextToken() {
    BookingDrawerState.roomSelectionContextRequestToken = (BookingDrawerState.roomSelectionContextRequestToken || 0) + 1;
    return BookingDrawerState.roomSelectionContextRequestToken;
}

function isLatestBookingRoomSelectionContextRequest(token) {
    return Number(token) === Number(BookingDrawerState.roomSelectionContextRequestToken || 0);
}

function buildBookingRoomSourceContext(sourceBooking = {}, options = {}) {
    const source = normalizeRoomDayBookingEntry(sourceBooking);
    const sourceBookingId = String(source.id || options.sourceBookingId || '').trim();
    if (!sourceBookingId) return null;
    const sourceRole = options.sourceRole || (roomBookingLooksLikeKitchen(source) ? 'kitchen' : 'activity');
    const sourceMarker = options.source || (sourceRole === 'kitchen' ? 'kitchen_first_activity_bridge' : 'activity_first_kitchen_bridge');
    return {
        generationId: Number(options.generationId ?? BookingDrawerState.roomSelectionContextRequestToken ?? 0) || 0,
        drawerGenerationId: Number(BookingDrawerState.drawerGenerationId || 0) || 0,
        sourceBookingId,
        sourceRole,
        customerId: roomBookingCustomerId(source) ?? null,
        date: String(source.date || bookingBanquetGroupDateValue() || '').slice(0, 10),
        room: source.room || document.getElementById('roomSelect')?.value || null,
        time: source.time || document.getElementById('bookingTime')?.value || '',
        groupId: source.banquetGroupId || options.groupId || null,
        source: sourceMarker
    };
}

function setBookingRoomSourceContext(sourceBooking = {}, options = {}) {
    const context = buildBookingRoomSourceContext(sourceBooking, options);
    BookingDrawerState.roomSourceContext = context;
    return context;
}

function attachBookingRoomSourceContext(context = {}, sourceContext = BookingDrawerState.roomSourceContext) {
    if (!context || !sourceContext) return context;
    return {
        ...context,
        roomSourceContext: sourceContext,
        generationId: sourceContext.generationId,
        sourceRole: sourceContext.sourceRole,
        date: sourceContext.date,
        room: sourceContext.room,
        time: sourceContext.time
    };
}

function bookingRoomSourceContextForValidation(context = {}) {
    return context?.roomSourceContext || BookingDrawerState.roomSourceContext || null;
}

function bookingRoomSourceContextStaleReason(context = {}) {
    const sourceContext = bookingRoomSourceContextForValidation(context);
    if (!sourceContext?.sourceBookingId) return 'missing_source_context';
    if (sourceContext.staleReason || context?.staleReason) return sourceContext.staleReason || context.staleReason;
    if (Number(sourceContext.drawerGenerationId || 0) !== Number(BookingDrawerState.drawerGenerationId || 0)) {
        return 'stale_drawer_generation';
    }
    const currentSourceContext = BookingDrawerState.roomSourceContext;
    if (
        currentSourceContext?.sourceBookingId
        && String(currentSourceContext.sourceBookingId) !== String(sourceContext.sourceBookingId)
    ) {
        return 'stale_source_booking';
    }
    if (
        currentSourceContext?.generationId
        && sourceContext.generationId
        && Number(currentSourceContext.generationId) !== Number(sourceContext.generationId)
    ) {
        return 'stale_source_generation';
    }
    const currentDate = bookingBanquetGroupDateValue();
    if (sourceContext.date && currentDate && String(sourceContext.date).slice(0, 10) !== String(currentDate).slice(0, 10)) {
        return 'stale_source_date';
    }
    const currentRoom = String(document.getElementById('roomSelect')?.value || '').trim();
    if (sourceContext.room && currentRoom && !sameBookingRoom(sourceContext.room, currentRoom)) {
        return 'stale_source_room';
    }
    const selectedCustomerId = bookingBanquetGroupSelectedCustomerId();
    if (sourceContext.customerId && selectedCustomerId && String(sourceContext.customerId) !== String(selectedCustomerId)) {
        return 'stale_source_customer';
    }
    return '';
}

function bookingRoomSourceContextStaleMessage(reason) {
    switch (reason) {
        case 'customer_changed':
        case 'stale_source_customer':
            return 'Клієнт змінився після вибору кімнати. Оберіть кімнату або банкет ще раз.';
        case 'stale_source_room':
            return 'Кімната змінилася після підтягування бронювання. Оберіть кімнату ще раз.';
        case 'stale_source_date':
            return 'Дата змінилася після підтягування бронювання. Закрийте форму й відкрийте бронювання ще раз.';
        case 'stale_drawer_generation':
        case 'stale_source_generation':
        case 'stale_source_booking':
        case 'missing_source_context':
        default:
            return 'Контекст бронювання застарів. Закрийте форму й відкрийте сценарій ще раз.';
    }
}

function clearAutoFilledBanquetFromRoomSelection() {
    if (BookingDrawerState.activeBanquetIntent === 'add_to_existing' && BookingDrawerState.explicitBanquetContext?.groupId) {
        BookingDrawerState.roomSourceContext = null;
        BookingDrawerState.autoFilledCustomerFromRoom = null;
        if (typeof clearAutoFilledBanquetGuestsFromRoom === 'function') clearAutoFilledBanquetGuestsFromRoom();
        renderBookingBanquetGroupSelector();
        return;
    }
    const auto = BookingDrawerState.autoFilledBanquetFromRoom;
    if (auto?.groupId && String(BookingDrawerState.selectedBanquetGroupId || '') === String(auto.groupId)) {
        BookingDrawerState.selectedBanquetGroupId = '';
        BookingDrawerState.manualBanquetGroupSelection = false;
    }
    BookingDrawerState.autoFilledBanquetFromRoom = null;
    BookingDrawerState.roomSourceContext = null;
    BookingDrawerState.roomSelectionBanquetContext = null;
    if (typeof clearAutoFilledBanquetGuestsFromRoom === 'function') clearAutoFilledBanquetGuestsFromRoom();
    renderBookingBanquetGroupSelector();
}

function resetBookingRoomSourceContext(options = {}) {
    if (options.invalidate !== false) nextBookingRoomSelectionContextToken();
    if (BookingDrawerState.activeBanquetIntent === 'add_to_existing' && BookingDrawerState.explicitBanquetContext?.groupId) {
        BookingDrawerState.roomSourceContext = null;
        BookingDrawerState.autoFilledCustomerFromRoom = null;
        if (typeof clearAutoFilledBanquetGuestsFromRoom === 'function') clearAutoFilledBanquetGuestsFromRoom();
        if (options.render === true) renderBookingBanquetGroupSelector();
        return;
    }
    BookingDrawerState.roomSourceContext = null;
    BookingDrawerState.roomSelectionBanquetContext = null;
    BookingDrawerState.autoFilledCustomerFromRoom = null;
    BookingDrawerState.autoFilledBanquetFromRoom = null;
    if (typeof clearAutoFilledBanquetGuestsFromRoom === 'function') clearAutoFilledBanquetGuestsFromRoom();
    if (options.render === true) renderBookingBanquetGroupSelector();
}

function resetBookingRoomSelectionContext(options = {}) {
    resetBookingRoomSourceContext(options);
}

function clearRoomSelectionBanquetContextAfterCustomerChange(options = {}) {
    if (options.invalidate !== false) nextBookingRoomSelectionContextToken();
    if (BookingDrawerState.explicitBanquetContext?.groupId) {
        clearExplicitBookingBanquetContext({ render: false, clearSelection: true, preserveIntent: true });
    }
    const previousRoomContext = BookingDrawerState.roomSelectionBanquetContext;
    const previousSourceContext = BookingDrawerState.roomSourceContext;
    const preserveSourceOnlyMismatchGuard = Boolean(
        previousRoomContext?.sourceBookingId
        && !previousRoomContext.groupId
        && previousSourceContext?.sourceBookingId
    );
    const autoGroupId = BookingDrawerState.autoFilledBanquetFromRoom?.groupId
        || BookingDrawerState.roomSelectionBanquetContext?.groupId
        || '';
    const hadAutoRoomContext = Boolean(
        BookingDrawerState.roomSelectionBanquetContext
        || BookingDrawerState.autoFilledCustomerFromRoom
        || BookingDrawerState.autoFilledBanquetFromRoom
    );
    if (autoGroupId && String(BookingDrawerState.selectedBanquetGroupId || '') === String(autoGroupId)) {
        BookingDrawerState.selectedBanquetGroupId = '';
        BookingDrawerState.manualBanquetGroupSelection = false;
    }
    BookingDrawerState.roomSourceContext = preserveSourceOnlyMismatchGuard
        ? {
            ...previousSourceContext,
            staleReason: 'customer_changed'
        }
        : null;
    BookingDrawerState.roomSelectionBanquetContext = preserveSourceOnlyMismatchGuard
        ? {
            ...previousRoomContext,
            roomSourceContext: BookingDrawerState.roomSourceContext,
            staleReason: 'customer_changed'
        }
        : null;
    BookingDrawerState.autoFilledCustomerFromRoom = null;
    BookingDrawerState.autoFilledBanquetFromRoom = null;
    if (typeof clearAutoFilledBanquetGuestsFromRoom === 'function') clearAutoFilledBanquetGuestsFromRoom();
    if (options.render !== false) renderBookingBanquetGroupSelector();
    return hadAutoRoomContext;
}

function markBookingCustomerSelectionManual(options = {}) {
    return clearRoomSelectionBanquetContextAfterCustomerChange(options);
}

function roomSelectionBanquetContextFromSnapshot(snapshot = {}, sourceBooking = {}) {
    const groupId = banquetGroupIdFromSnapshot(snapshot);
    if (!groupId) return sourceBookingToBanquetContext(sourceBooking);
    const group = snapshot.group || snapshot.banquetGroup || snapshot.banquet_group || {};
    const primary = snapshot.primaryBooking || snapshot.primary_booking || group.primaryBooking || group.primary_booking || {};
    const base = sourceBookingToBanquetContext(sourceBooking);
    return {
        ...base,
        groupId,
        sourceBookingId: group.primaryBookingId || group.primary_booking_id || snapshot.primaryBookingId || snapshot.primary_booking_id || primary.id || base.sourceBookingId,
        groupName: group.groupName || group.group_name || snapshot.groupName || snapshot.group_name || base.groupName,
        sourceRoom: base.sourceRoom || group.room || primary.room || null,
        sourceTime: base.sourceTime || primary.time || '',
        banquetGroupCustomerId: group.customerId ?? group.customer_id ?? base.banquetGroupCustomerId,
        source: 'room_selection_by_booking'
    };
}

async function resolveRoomSelectionBanquetContext(sourceBooking = {}, token = BookingDrawerState.roomSelectionContextRequestToken) {
    const baseContext = sourceBookingToBanquetContext(sourceBooking);
    if (baseContext.groupId) {
        const sourceContext = BookingDrawerState.roomSourceContext;
        if (sourceContext) sourceContext.groupId = baseContext.groupId;
        return attachBookingRoomSourceContext(baseContext, sourceContext);
    }
    const sourceBookingId = String(sourceBooking.id || '').trim();
    if (!sourceBookingId || typeof apiGetBanquetByBooking !== 'function') {
        return attachBookingRoomSourceContext(baseContext);
    }
    const snapshot = await apiGetBanquetByBooking(sourceBookingId);
    if (!isLatestBookingRoomSelectionContextRequest(token)) return null;
    if (snapshot?.success === false) return attachBookingRoomSourceContext(baseContext);
    const context = roomSelectionBanquetContextFromSnapshot(snapshot, sourceBooking);
    const sourceContext = BookingDrawerState.roomSourceContext;
    if (sourceContext && context?.groupId) sourceContext.groupId = context.groupId;
    return attachBookingRoomSourceContext(context, sourceContext);
}

function canAutoFillCustomerFromRoom(sourceBooking = {}) {
    const sourceCustomerId = roomBookingCustomerId(sourceBooking);
    if (!sourceCustomerId) return false;
    const selectedCustomerId = bookingBanquetGroupSelectedCustomerId();
    if (!selectedCustomerId) return true;
    if (String(selectedCustomerId) === String(sourceCustomerId)) return false;
    const auto = BookingDrawerState.autoFilledCustomerFromRoom;
    return Boolean(auto?.customerId && String(auto.customerId) === String(selectedCustomerId));
}

function selectedCustomerAlreadyMatchesRoom(sourceBooking = {}) {
    const sourceCustomerId = roomBookingCustomerId(sourceBooking);
    const selectedCustomerId = bookingBanquetGroupSelectedCustomerId();
    return Boolean(sourceCustomerId && selectedCustomerId && String(sourceCustomerId) === String(selectedCustomerId));
}

function hasManualCustomerConflictWithRoom(sourceBooking = {}) {
    const sourceCustomerId = roomBookingCustomerId(sourceBooking);
    const selectedCustomerId = bookingBanquetGroupSelectedCustomerId();
    if (!sourceCustomerId || !selectedCustomerId || String(sourceCustomerId) === String(selectedCustomerId)) return false;
    const auto = BookingDrawerState.autoFilledCustomerFromRoom;
    return !(auto?.customerId && String(auto.customerId) === String(selectedCustomerId));
}

async function handleBookingRoomSelectionContextChange() {
    const token = nextBookingRoomSelectionContextToken();
    if (!isParkTimelineBookingMode() || AppState.editingBookingId) return;
    if (BookingDrawerState.activeBanquetIntent === 'add_to_existing' && BookingDrawerState.explicitBanquetContext?.groupId) {
        renderBookingBanquetGroupSelector();
        renderBookingPackageSummary();
        return;
    }
    const roomName = String(document.getElementById('roomSelect')?.value || '').trim();
    if (!roomName) {
        clearAutoFilledBanquetFromRoomSelection();
        return;
    }
    const targetTime = document.getElementById('bookingTime')?.value || '';
    let sourceBooking = pickRoomBanquetSourceBooking(roomName, targetTime);
    if (!sourceBooking) {
        sourceBooking = await fetchFreshRoomBanquetSourceBooking(roomName, targetTime);
        if (!isLatestBookingRoomSelectionContextRequest(token)) return;
    }
    if (!sourceBooking) {
        clearAutoFilledBanquetFromRoomSelection();
        return;
    }

    clearAutoFilledBanquetFromRoomSelection();
    const roomSourceContext = setBookingRoomSourceContext(sourceBooking, {
        generationId: token,
        sourceRole: roomBookingLooksLikeKitchen(sourceBooking) ? 'kitchen' : 'activity',
        source: roomBookingLooksLikeKitchen(sourceBooking) ? 'kitchen_first_activity_bridge' : 'activity_first_kitchen_bridge'
    });
    if (hasManualCustomerConflictWithRoom(sourceBooking)) {
        renderBookingCustomerSearchState('Кімната має пов’язане бронювання, але клієнта вже вибрано вручну. Щоб підтягнути клієнта з кімнати, спочатку очистіть вибір.');
        renderBookingPackageSummary();
        return;
    }
    syncAutoFilledBanquetGuestsFromRoom(sourceBooking);
    const immediateBanquetContext = attachBookingRoomSourceContext(sourceBookingToBanquetContext(sourceBooking), roomSourceContext);
    if (immediateBanquetContext.groupId) {
        BookingDrawerState.roomSelectionBanquetContext = immediateBanquetContext;
        BookingDrawerState.selectedBanquetGroupId = immediateBanquetContext.groupId;
        BookingDrawerState.manualBanquetGroupSelection = false;
    }
    const canAutoFillCustomer = canAutoFillCustomerFromRoom(sourceBooking);
    const selectedMatchesSource = selectedCustomerAlreadyMatchesRoom(sourceBooking);
    let hydratedCustomer = null;

    if (canAutoFillCustomer) {
        hydratedCustomer = await hydrateBookingCustomerSelection(sourceBooking, {
            renderSummary: false,
            isCurrent: () => isLatestBookingRoomSelectionContextRequest(token)
        });
        if (!isLatestBookingRoomSelectionContextRequest(token)) return;
        if (hydratedCustomer?.id) {
            BookingDrawerState.autoFilledCustomerFromRoom = {
                customerId: hydratedCustomer.id,
                sourceBookingId: sourceBooking.id,
                room: sourceBooking.room || roomName,
                time: sourceBooking.time || ''
            };
        }
    }

    const banquetContext = await resolveRoomSelectionBanquetContext(sourceBooking, token);
    if (!isLatestBookingRoomSelectionContextRequest(token) || !banquetContext) return;
    BookingDrawerState.roomSelectionBanquetContext = banquetContext;
    if (banquetContext.groupId) {
        BookingDrawerState.autoFilledBanquetFromRoom = banquetContext;
        BookingDrawerState.selectedBanquetGroupId = banquetContext.groupId;
        BookingDrawerState.manualBanquetGroupSelection = false;
        await refreshBookingBanquetGroupCandidates({
            preselectGroupId: banquetContext.groupId,
            preserveSelection: false
        });
        if (!isLatestBookingRoomSelectionContextRequest(token)) return;
        if (!getSelectedBookingBanquetGroupId()) {
            BookingDrawerState.selectedBanquetGroupId = banquetContext.groupId;
            BookingDrawerState.manualBanquetGroupSelection = false;
            renderBookingBanquetGroupSelector();
        }
    } else {
        renderBookingBanquetGroupSelector();
    }

    if (hydratedCustomer?.id || selectedMatchesSource) {
        renderBookingCustomerSearchState(`Клієнта підтягнуто з бронювання ${bookingRoomDayBookingTime(sourceBooking)} у кімнаті ${sourceBooking.room || roomName}.`);
    } else if (roomBookingCustomerId(sourceBooking) && bookingBanquetGroupSelectedCustomerId()) {
        renderBookingCustomerSearchState('Кімната має пов’язане бронювання, але клієнта вже вибрано вручну. Щоб підтягнути клієнта з кімнати, спочатку очистіть вибір.');
    }
    syncBookingGuestArrivalField();
    renderBookingPackageSummary();
}

function clearSelectedCustomerLink() {
    const hadAutoRoomContext = clearRoomSelectionBanquetContextAfterCustomerChange({ render: false });
    const hiddenId = document.getElementById('selectedCustomerId');
    if (hiddenId) hiddenId.value = '';
    ['customerSearch', 'customerName', 'customerPhone', 'customerInstagram', 'customerChildName', 'customerChildBirthday', 'customerSource'].forEach(id => {
        const el = document.getElementById(id);
        if (el) delete el.dataset.selectedValue;
    });
    document.getElementById('customerInfo')?.classList.add('hidden');
    renderSelectedCustomerCard(null);
    const duplicateHint = document.getElementById('bookingCustomerDuplicateHint');
    if (duplicateHint) {
        duplicateHint.classList.add('hidden');
        duplicateHint.innerHTML = '';
    }
    setBookingClientMode('search');
    resetBookingBanquetGroupSelector();
    if (hadAutoRoomContext) {
        BookingDrawerState.activeBanquetIntent = 'add_to_existing';
        BookingDrawerState.standaloneBookingOverride = false;
    }
    updateBookingContextHeaderSummary();
    if (hadAutoRoomContext) renderBookingCustomerSearchState(ROOM_SELECTION_CUSTOMER_CHANGED_MESSAGE);
    return hadAutoRoomContext;
}

function clearSelectedCustomerLinkIfEdited(el) {
    const hiddenId = document.getElementById('selectedCustomerId');
    if (!hiddenId?.value || !el || el.dataset.selectedValue === undefined) return false;
    if (String(el.value || '') !== String(el.dataset.selectedValue || '')) {
        return clearSelectedCustomerLink();
    }
    return false;
}

function leadConversionBookingModeFromContext() {
    const mode = String(AppState.leadConversionContext?.bookingMode || '').trim();
    return mode === 'activity' || mode === 'kitchen_room' ? mode : '';
}

function applyLeadConversionBookingModeToForm() {
    const mode = leadConversionBookingModeFromContext();
    if (!mode || AppState.editingBookingId) return false;
    if (mode === 'activity') {
        setBookingWorkspaceHasEvent(true, { markDirty: false });
        setBookingKitchenEnabled(false, { markDirty: false });
        return true;
    }
    if (mode === 'kitchen_room') {
        setBookingWorkspaceHasEvent(false, { markDirty: false });
        setBookingKitchenEnabled(true, { markDirty: false });
        return true;
    }
    return false;
}

function applyLeadConversionContextToBookingForm() {
    const ctx = AppState.leadConversionContext;
    if (!ctx || !ctx.leadId || AppState.editingBookingId) return;
    const maysternyaMode = isMaysternyaBookingContext();

    const customerToggle = document.getElementById('customerDataToggle');
    if (customerToggle) customerToggle.checked = true;
    document.getElementById('customerDataSection')?.classList.remove('hidden');

    const linkedCustomerId = parseInt(ctx.customerId, 10);
    if (Number.isInteger(linkedCustomerId) && linkedCustomerId > 0) {
        applySelectedCustomerToBookingForm({
            id: linkedCustomerId,
            name: ctx.customerName || `Клієнт #${linkedCustomerId}`,
            phone: ctx.customerPhone || '',
            source: 'lead'
        }, { markDirty: false });
    } else if (ctx.customerName) {
        const nameEl = document.getElementById('customerName');
        const searchEl = document.getElementById('customerSearch');
        if (nameEl && !nameEl.value) nameEl.value = ctx.customerName;
        if (searchEl && !searchEl.value) searchEl.value = ctx.customerName;
    }
    if (ctx.customerPhone) {
        const phoneEl = document.getElementById('customerPhone');
        if (phoneEl && !phoneEl.value) phoneEl.value = ctx.customerPhone;
    }
    const sourceEl = document.getElementById('customerSource');
    if (sourceEl && !sourceEl.value) sourceEl.value = 'lead';
    if (maysternyaMode) {
        const groupEl = document.getElementById('bookingGroupName');
        const topic = ctx.topic || ctx.sessionType || '';
        if (groupEl && !groupEl.value) groupEl.value = (topic || ctx.message || '').slice(0, 160);

        const notesEl = document.getElementById('bookingNotes');
        if (notesEl && !notesEl.value) {
            const noteLines = [
                ctx.message ? `Повідомлення: ${ctx.message}` : null,
                ctx.source ? `Джерело: ${ctx.source}` : null,
                ctx.page ? `Сторінка: ${ctx.page}` : null,
                ctx.sessionType ? `Тип сесії: ${ctx.sessionType}` : null
            ].filter(Boolean);
            notesEl.value = noteLines.join('\n');
        }
    }
    setBookingLeadDetails({
        source: ctx.source || 'lead',
        status: 'warm',
        interestDate: ctx.eventDate || '',
        notes: [
            ctx.customerName ? `Лід #${ctx.leadId}: ${ctx.customerName}` : `Лід #${ctx.leadId}`,
            ctx.topic ? `Тема: ${ctx.topic}` : null,
            ctx.message ? `Повідомлення: ${ctx.message}` : null,
            ctx.page ? `Сторінка: ${ctx.page}` : null
        ].filter(Boolean).join('\n')
    });
    applyLeadConversionBookingModeToForm();
    renderBookingPackageSummary();
}

function clearLeadConversionContextAfterBooking(bookingId) {
    if (!AppState.leadConversionContext) return;
    AppState.leadConversionContext = null;
    const url = new URL(window.location.href);
    url.searchParams.delete('leadId');
    url.searchParams.delete('lead');
    url.searchParams.delete('convert');
    url.searchParams.delete('eventDate');
    url.searchParams.delete('bookingMode');
    url.searchParams.delete('customerId');
    url.searchParams.delete('customerName');
    url.searchParams.delete('customerPhone');
    url.searchParams.delete('topic');
    url.searchParams.delete('message');
    url.searchParams.delete('source');
    url.searchParams.delete('page');
    url.searchParams.delete('sessionType');
    if (bookingId) url.searchParams.set('highlight', bookingId);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
}

function selectCustomerFromSearch(customer) {
    const hadAutoRoomContext = markBookingCustomerSelectionManual({ render: false });
    applySelectedCustomerToBookingForm(customer);
    const clearedMismatchedBanquet = clearSelectedBanquetGroupIfCustomerMismatch();
    if (hadAutoRoomContext || clearedMismatchedBanquet) {
        renderBookingCustomerSearchState(ROOM_SELECTION_CUSTOMER_CHANGED_MESSAGE);
    }
}

function renderCustomerSearchResults(customers, options = {}) {
    const container = document.getElementById('customerSearchResults');
    if (!container) return;
    const list = Array.isArray(customers) ? customers : [];

    if (options.loading) {
        container.innerHTML = '<div class="customer-search-state">Шукаємо клієнтів...</div>';
        container.classList.remove('hidden');
        renderBookingCustomerSearchState('');
        return;
    }

    if (options.error) {
        container.innerHTML = '<div class="customer-search-state is-error">Не вдалося завантажити клієнтів. Спробуйте ще раз.</div>';
        container.classList.remove('hidden');
        renderBookingCustomerSearchState('');
        return;
    }

    if (list.length === 0) {
        if (options.query) {
            container.innerHTML = '<div class="customer-search-state">Клієнтів не знайдено. Натисніть «Новий клієнт», щоб створити картку.</div>';
            container.classList.remove('hidden');
            renderBookingCustomerSearchState('Клієнта не знайдено. Можна створити нового.');
        } else {
            container.classList.add('hidden');
            container.innerHTML = '';
            renderBookingCustomerSearchState('');
        }
        return;
    }

    container.innerHTML = list.map(c => {
        const childDisplay = bookingCustomerChildrenDisplay(c);
        return `
            <div class="customer-search-item" role="button" tabindex="0" data-id="${escapeHtml(String(c.id))}">
                <div class="customer-search-name">${escapeHtml(c.name)}</div>
                <div class="customer-search-meta">
                    ${c.phone ? escapeHtml(c.phone) : ''}
                    ${c.instagram ? ' @' + escapeHtml(c.instagram) : ''}
                    ${childDisplay ? ' · Діти: ' + escapeHtml(childDisplay) : ''}
                    ${c.totalBookings ? ' · ' + c.totalBookings + ' віз.' : ''}
                </div>
            </div>
        `;
    }).join('');
    container.classList.remove('hidden');
    renderBookingCustomerSearchState('');

    // Click handlers
    const pickCustomer = (item) => {
        const id = item.dataset.id;
        const customer = list.find(c => String(c.id) === String(id));
        if (customer) selectCustomerFromSearch(customer);
    };
    container.querySelectorAll('.customer-search-item').forEach(item => {
        item.addEventListener('click', () => pickCustomer(item));
        item.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                pickCustomer(item);
            }
        });
    });
}

function renderBookingCustomerDuplicateHint(customers = []) {
    const hint = document.getElementById('bookingCustomerDuplicateHint');
    if (!hint) return;
    const selectedId = document.getElementById('selectedCustomerId')?.value;
    const matches = (customers || []).filter(c => !selectedId || String(c.id) !== String(selectedId)).slice(0, 3);
    if (!matches.length) {
        hint.classList.add('hidden');
        hint.innerHTML = '';
        return;
    }
    hint.innerHTML = `
        <strong>Можливий дубль клієнта:</strong>
        ${matches.map(c => `<button type="button" class="booking-duplicate-customer-btn" data-id="${escapeHtml(String(c.id))}">${escapeHtml(c.name || 'Клієнт')}${c.phone ? ` · ${escapeHtml(c.phone)}` : ''}${c.instagram ? ` · @${escapeHtml(c.instagram)}` : ''}</button>`).join('')}
    `;
    hint.classList.remove('hidden');
    hint.querySelectorAll('.booking-duplicate-customer-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const customer = matches.find(c => String(c.id) === String(btn.dataset.id));
            if (customer) selectCustomerFromSearch(customer);
        });
    });
}

const debouncedBookingDuplicateCheck = debounce(async () => {
    const selectedId = document.getElementById('selectedCustomerId')?.value;
    if (selectedId) {
        renderBookingCustomerDuplicateHint([]);
        return;
    }
    const candidates = [
        document.getElementById('customerPhone')?.value?.trim(),
        document.getElementById('customerInstagram')?.value?.trim(),
        document.getElementById('customerName')?.value?.trim()
    ].filter(Boolean);
    const query = candidates.find(value => value.length >= 3);
    if (!query) {
        renderBookingCustomerDuplicateHint([]);
        return;
    }
    try {
        const results = await apiSearchCustomers(query);
        renderBookingCustomerDuplicateHint(results);
    } catch {
        renderBookingCustomerDuplicateHint([]);
    }
}, 350);

// Toggle + autocomplete listeners (called once on page load)
function initCustomerCRM() {
    document.getElementById('bookingCreateCustomerBtn')?.addEventListener('click', () => {
        const nextMode = BookingDrawerState.clientMode === 'new' ? 'search' : 'new';
        setBookingClientMode(nextMode, nextMode === 'new' ? { focusNew: true } : { focusSearch: true });
        renderBookingPackageSummary();
    });
    document.getElementById('bookingChangeCustomerBtn')?.addEventListener('click', () => {
        clearSelectedCustomerLink();
        document.getElementById('customerSearch')?.focus();
        renderBookingPackageSummary();
    });
    // Toggle
    document.getElementById('customerDataToggle')?.addEventListener('change', (e) => {
        const section = document.getElementById('customerDataSection');
        if (section) section.classList.toggle('hidden', !e.target.checked);
        if (!e.target.checked) clearCustomerFields();
    });
    // Autocomplete search with debounce
    const debouncedCustomerSearch = debounce(async (q) => {
        const searchEl = document.getElementById('customerSearch');
        renderCustomerSearchResults([], { loading: true });
        try {
            const results = await apiSearchCustomers(q);
            if (searchEl && searchEl.value.trim() !== q) return;
            renderCustomerSearchResults(results, { query: q });
        } catch (err) {
            console.error('Booking customer search error', err);
            renderCustomerSearchResults([], { error: true });
        }
    }, 300);
    document.getElementById('customerSearch')?.addEventListener('input', (e) => {
        const clearedAutoRoomContext = clearSelectedCustomerLinkIfEdited(e.target);
        const q = e.target.value.trim();
        if (q.length < 2) {
            document.getElementById('customerSearchResults')?.classList.add('hidden');
            renderBookingCustomerSearchState(clearedAutoRoomContext ? ROOM_SELECTION_CUSTOMER_CHANGED_MESSAGE : '');
            return;
        }
        setBookingClientMode('search');
        debouncedCustomerSearch(q);
    });
    ['customerName', 'customerPhone', 'customerInstagram', 'customerChildName', 'customerChildBirthday', 'customerSource'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            clearSelectedCustomerLinkIfEdited(el);
            renderBookingPackageSummary();
        });
        el.addEventListener('change', () => {
            clearSelectedCustomerLinkIfEdited(el);
            renderBookingPackageSummary();
        });
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.customer-search-wrap')) {
            document.getElementById('customerSearchResults')?.classList.add('hidden');
        }
    });
}

// v5.18: Show free rooms for selected time/duration
async function showFreeRooms() {
    const date = formatDate(AppState.selectedDate);
    let time = document.getElementById('bookingTime')?.value;
    // v5.19: fallback to selected cell time
    if (!time && AppState.selectedCell) time = AppState.selectedCell.dataset.time;
    const programId = document.getElementById('selectedProgram')?.value;
    const program = programId ? getProductsSync().find(p => p.id === programId) : null;
    const duration = program ? program.duration : 60;

    if (!time) {
        showNotification('Спочатку оберіть час', 'error');
        return;
    }

    const panel = document.getElementById('freeRoomsPanel');
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="loading-spinner">Завантаження...</div>';

    try {
        let freeRoomsPath = window.TimelineBusinessContext?.appendApiContext?.(`/rooms/free/${date}/${time}/${duration}`)
            || `/rooms/free/${date}/${time}/${duration}`;
        const queryParams = [];
        const excludeId = String(AppState.editingBookingId || '').trim();
        if (excludeId) queryParams.push(`excludeId=${encodeURIComponent(excludeId)}`);
        const requestedCapacity = resolveBookingChildrenCountSource().value;
        if (Number.isFinite(requestedCapacity) && requestedCapacity > 0) {
            queryParams.push(`capacity=${encodeURIComponent(String(requestedCapacity))}`);
        }
        if (queryParams.length) {
            const separator = freeRoomsPath.includes('?') ? '&' : '?';
            freeRoomsPath = `${freeRoomsPath}${separator}${queryParams.join('&')}`;
        }
        const response = await fetch(`${API_BASE}${freeRoomsPath}`, {
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return;
        const data = await response.json();
        if (isParkTimelineBookingMode()) {
            renderBookingRoomOptionsForDay(roomDayBookingsFromAvailabilityResponse(data), {
                selectedRoom: document.getElementById('roomSelect')?.value || '',
                occupiedNowRooms: occupiedNowRoomsFromAvailabilityResponse(data)
            });
        }

        if (Array.isArray(data.resources)) {
            const freeResources = data.resources.filter(resource => !resource.occupied && resource.capacityAvailable !== false);
            const occupiedResources = data.resources.filter(resource => resource.occupied);
            const overCapacityResources = data.resources.filter(resource => !resource.occupied && resource.capacityAvailable === false);
            const freeHtml = freeResources.map(resource => {
                const capacity = parseInt(resource.capacity, 10);
                const dayBookings = Array.isArray(resource.dayBookings) ? resource.dayBookings.map(normalizeRoomDayBookingEntry) : [];
                const daySummary = roomDayBookingInlineSummary(dayBookings);
                const capacityLabel = Number.isFinite(capacity) && capacity > 0
                    ? `<small>до ${capacity} місць</small>`
                    : '';
                const dayLabel = daySummary ? `<small>${escapeHtml(daySummary)}</small>` : '';
                return `<button type="button" class="free-room-chip${daySummary ? ' has-day-bookings' : ''}" data-free-room="${escapeHtml(resource.name)}"><span>${escapeHtml(resource.name)}</span>${capacityLabel}${dayLabel}</button>`;
            }).join('');
            const occupiedHtml = occupiedResources.length > 0
                ? occupiedResources.map(resource => `<span class="free-room-chip occupied" aria-disabled="true"><span>${escapeHtml(resource.name)}</span><small>зайнята зараз</small></span>`).join('')
                : '';
            const overCapacityHtml = overCapacityResources.length > 0
                ? `<div class="occupied-rooms">Мала місткість: ${overCapacityResources.map(r => {
                    const capacity = parseInt(r.capacity, 10);
                    return `${escapeHtml(r.name)}${Number.isFinite(capacity) && capacity > 0 ? ` (${capacity})` : ''}`;
                }).join(', ')}</div>`
                : '';
            const emptyFreeText = isParkTimelineBookingMode() ? 'Немає кімнат, вільних у цей час' : 'Немає доступних ресурсів на цей час';
            panel.innerHTML = (freeHtml || `<span class="no-free-rooms">${emptyFreeText}</span>`) + occupiedHtml + overCapacityHtml;
        } else if (Array.isArray(data.rooms)) {
            const freeRoomsHtml = data.rooms.filter(room => !room.occupied).map(room => {
                const dayBookings = Array.isArray(room.dayBookings) ? room.dayBookings.map(normalizeRoomDayBookingEntry) : [];
                const daySummary = roomDayBookingInlineSummary(dayBookings);
                return `<button type="button" class="free-room-chip${daySummary ? ' has-day-bookings' : ''}" data-free-room="${escapeHtml(room.name)}"><span>${escapeHtml(room.name)}</span>${daySummary ? `<small>${escapeHtml(daySummary)}</small>` : ''}</button>`;
            }).join('');
            const occupiedRoomsHtml = data.rooms.filter(room => room.occupied).map(room => {
                const dayBookings = Array.isArray(room.dayBookings) ? room.dayBookings.map(normalizeRoomDayBookingEntry) : [];
                const summary = roomDayBookingInlineSummary(dayBookings) || 'зайнята зараз';
                return `<span class="free-room-chip occupied" aria-disabled="true"><span>${escapeHtml(room.name)}</span><small>${escapeHtml(summary)}</small></span>`;
            }).join('');
            panel.innerHTML = (freeRoomsHtml || '<span class="no-free-rooms">Немає кімнат, вільних у цей час</span>') + occupiedRoomsHtml;
        } else if (data.free && data.free.length > 0) {
            const freeRoomsHtml = data.free.map(room =>
                `<button type="button" class="free-room-chip" data-free-room="${escapeHtml(room)}"><span>${escapeHtml(room)}</span></button>`
            ).join('');
            panel.innerHTML = (freeRoomsHtml || '<span class="no-free-rooms">Немає кімнат, вільних у цей час</span>') +
            (Array.isArray(data.occupied) && data.occupied.length > 0 ? `<div class="occupied-rooms">Зайняті зараз: ${data.occupied.map(r => escapeHtml(r)).join(', ')}</div>` : '');
        } else {
            panel.innerHTML = '<span class="no-free-rooms">Всі кімнати зайняті в цей час</span>';
        }
    } catch (err) {
        panel.innerHTML = '<span class="no-free-rooms">Помилка завантаження</span>';
    }
}

// v33.8.0: Validate certificate code
async function validateCertificate() {
    var code = document.getElementById('certCodeInput')?.value?.trim();
    if (!code) return;
    var resultEl = document.getElementById('certValidationResult');
    if (!resultEl) return;
    resultEl.style.display = 'block';
    resultEl.textContent = '⏳ Перевіряю...';
    resultEl.style.color = '';
    try {
        var resp = await fetch('/api/certificates/validate/' + encodeURIComponent(code), {
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') }
        });
        var data = await resp.json();
        if (data.valid) {
            resultEl.innerHTML = '✅ Сертифікат дійсний: <b>' + escapeHtml(data.certificate.display_value) + '</b> (' + escapeHtml(data.certificate.type_text || '') + ')';
            resultEl.style.color = 'var(--success, green)';
        } else {
            resultEl.textContent = '❌ ' + (data.reason === 'expired' ? 'Прострочений' : data.reason === 'used' ? 'Вже використаний' : data.error || 'Недійсний');
            resultEl.style.color = '#ef4444';
        }
    } catch (e) {
        resultEl.textContent = '❌ Помилка перевірки';
        resultEl.style.color = '#ef4444';
    }
}

// v33.7.0: Open booking chat channel
async function openBookingChat(bookingId) {
    var token = localStorage.getItem('pzp_token');
    var asyncWindow = typeof openAsyncNavigationWindow === 'function'
        ? openAsyncNavigationWindow('Чат бронювання')
        : null;
    try {
        var r = await fetch('/api/chat/booking-channel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ bookingId: bookingId })
        });
        var data = await r.json();
        if (data.success && data.channel) {
            const chatUrl = '/chat.html?channelId=' + encodeURIComponent(data.channel.id);
            if (typeof finishAsyncNavigationWindow === 'function') finishAsyncNavigationWindow(asyncWindow, chatUrl);
            else if (asyncWindow && !asyncWindow.closed) asyncWindow.location.href = chatUrl;
            else if (typeof openSafeNewTab === 'function') openSafeNewTab(chatUrl);
            else window.open(chatUrl, '_blank', 'noopener,noreferrer');
        } else {
            if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(asyncWindow);
            if (typeof showToast === 'function') showToast('Не вдалось відкрити чат', 'error');
        }
    } catch (e) {
        if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(asyncWindow);
        console.error('openBookingChat:', e);
    }
}

async function closeBookingPanel(force = false) {
    const panel = document.getElementById('bookingPanel');
    if (!force && panel && window.UnsafeDismissGuard) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(panel, () => closeBookingPanel(true), {
            force,
            isDirty: () => !!window.BookingForm?.isDirty?.(),
            message: 'Є незбережені зміни в бронюванні. Закрити без збереження?',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись',
            markClean: false
        });
    }
    document.getElementById('bookingPanel')?.classList.add('hidden');
    document.getElementById('bookingPanel')?.classList.remove('booking-panel--maysternya', 'booking-panel--minimal-timeline', 'booking-panel--education-timeline', 'booking-panel--room-first', 'booking-panel--time-overrun');
    document.querySelector('.main-content').classList.remove('panel-open');
    // v5.33: Unlock body scroll
    document.body.classList.remove('panel-open');
    // v5.35: Hide backdrop overlay
    document.getElementById('panelBackdrop')?.classList.add('hidden');
    document.querySelectorAll('.grid-cell.selected').forEach(c => c.classList.remove('selected', 'timeline-selected-overrun'));

    // v5.5: Скинути режим редагування
    if (AppState.editingBookingId) {
        AppState.editingBookingId = null;
        AppState.editingBookingUpdatedAt = null; // Clear optimistic lock
        const panelH3 = document.querySelector('#bookingPanel .panel-header h3');
        const btnSubmit = document.querySelector('#bookingForm .btn-submit');
        if (panelH3) panelH3.textContent = 'Нове бронювання';
        if (btnSubmit) {
            btnSubmit.textContent = 'Додати бронювання';
            btnSubmit.dataset.readyText = 'Додати бронювання';
            delete btnSubmit.dataset.originalText;
        }
    }
    if (!AppState.editingBookingId && !isMaysternyaBookingContext()) {
        const panelH3 = document.querySelector('#bookingPanel .panel-header h3');
        const btnSubmit = document.querySelector('#bookingForm .btn-submit');
        if (panelH3) panelH3.textContent = 'Нове бронювання';
        if (btnSubmit) {
            btnSubmit.textContent = 'Додати бронювання';
            btnSubmit.dataset.readyText = 'Додати бронювання';
            delete btnSubmit.dataset.originalText;
        }
    }
    if (window.BookingForm?.markClean) BookingForm.markClean();
    if (window.UnsafeDismissGuard && panel) window.UnsafeDismissGuard.markClean(panel);
    BookingDrawerState.roomBookingAnimationBridge = null;
    BookingDrawerState.banquetEditContext = null;
    BookingDrawerState.legacyNotesFallback = false;
    BookingDrawerState.legacyGroupNameFallback = false;
    resetSelectedActivityScheduleState();
    resetBookingRoomSelectionContext();
    resetBookingBanquetGroupSelector();
    return true;
}

function resetBookingEditStateForCreate() {
    AppState.editingBookingId = null;
    AppState.editingBookingUpdatedAt = null;
    BookingDrawerState.roomBookingAnimationBridge = null;
    BookingDrawerState.banquetEditContext = null;
    BookingDrawerState.legacyNotesFallback = false;
    BookingDrawerState.legacyGroupNameFallback = false;
    resetSelectedActivityScheduleState();
    resetBookingRoomSelectionContext();
    resetBookingBanquetGroupSelector();
    const panelH3 = document.querySelector('#bookingPanel .panel-header h3');
    const btnSubmit = document.querySelector('#bookingForm .btn-submit');
    if (panelH3) panelH3.textContent = isMaysternyaBookingContext() ? getTimelineBookingPresentation().bookingTitle : 'Нове бронювання';
    if (btnSubmit) {
        btnSubmit.textContent = isMaysternyaBookingContext() ? getTimelineBookingPresentation().submitLabel : 'Додати бронювання';
        btnSubmit.dataset.readyText = btnSubmit.textContent;
        delete btnSubmit.dataset.originalText;
    }
}

let _programIconsHash = null;
const PROGRAM_CATEGORY_FILTERS = [
    { id: 'all', label: 'Усі', categories: [] },
    { id: 'animation', label: 'Анімація', categories: ['animation'] },
    { id: 'wow', label: 'WOW', categories: ['show'] },
    { id: 'quests', label: 'Квести', categories: ['quest'] },
    { id: 'photo', label: 'Фото', categories: ['photo'] },
    { id: 'workshops', label: 'МК', categories: ['masterclass'] },
    { id: 'pinata', label: 'Піньяти', categories: ['pinata'] },
    { id: 'other', label: 'Інше', categories: ['custom'] }
];

function renderProgramCategoryChips() {
    const container = document.getElementById('programCategoryChips');
    if (!container) return;
    container.innerHTML = PROGRAM_CATEGORY_FILTERS.map(filter => `
        <button type="button" class="program-category-chip${BookingDrawerState.selectedProgramCategory === filter.id ? ' is-active' : ''}" data-program-category="${filter.id}">
            ${escapeHtml(filter.label)}
        </button>
    `).join('');
    container.querySelectorAll('[data-program-category]').forEach(btn => {
        btn.addEventListener('click', () => {
            BookingDrawerState.selectedProgramCategory = btn.dataset.programCategory || 'all';
            renderProgramCategoryChips();
            filterPrograms();
        });
    });
}

function bookingMultiActivityEnabled() {
    const editingBanquetGroup = Boolean(
        AppState.editingBookingId
        && BookingDrawerState.banquetEditContext?.groupId
    );
    return isParkTimelineBookingMode()
        && !isMaysternyaBookingContext()
        && !isEducationTimelineBookingMode()
        && (!AppState.editingBookingId || editingBanquetGroup);
}

function bookingActivityScheduleApi() {
    const root = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {});
    const api = root.BookingActivitySchedule
        || (typeof BookingActivitySchedule !== 'undefined' ? BookingActivitySchedule : null);
    if (!api) throw new Error('BookingActivitySchedule helper is not loaded');
    return api;
}

const SELECTED_ACTIVITY_PREFLIGHT_UNAVAILABLE_MESSAGE = 'Не вдалося перевірити зайняті слоти до збереження.';
const SELECTED_ACTIVITY_PREFLIGHT_RETRY_TEXT = 'Спробувати перевірку ще раз';

function selectedActivityPreflightState() {
    if (!BookingDrawerState.selectedActivityPreflight
        || typeof BookingDrawerState.selectedActivityPreflight !== 'object') {
        BookingDrawerState.selectedActivityPreflight = {
            status: 'idle',
            message: '',
            lastError: '',
            failedAt: null,
            overrideUsed: false
        };
    }
    return BookingDrawerState.selectedActivityPreflight;
}

function selectedActivityPreflightUnavailable() {
    return selectedActivityPreflightState().status === 'failed';
}

function setSelectedActivityPreflightUnavailable(err) {
    const state = selectedActivityPreflightState();
    state.status = 'failed';
    state.message = SELECTED_ACTIVITY_PREFLIGHT_UNAVAILABLE_MESSAGE;
    state.lastError = err?.message || String(err || '');
    state.failedAt = new Date().toISOString();
    state.overrideUsed = false;
    return state;
}

function clearSelectedActivityPreflightState(options = {}) {
    const state = selectedActivityPreflightState();
    const changed = state.status !== 'idle'
        || state.message
        || state.lastError
        || state.failedAt
        || state.overrideUsed;
    state.status = 'idle';
    state.message = '';
    state.lastError = '';
    state.failedAt = null;
    state.overrideUsed = false;
    if (changed && options.render) {
        renderBookingPackageSummary();
        updateBookingSubmitState();
    }
}

function renderSelectedActivityPreflightWarning() {
    if (!selectedActivityPreflightUnavailable()) return '';
    const state = selectedActivityPreflightState();
    const message = state.message || SELECTED_ACTIVITY_PREFLIGHT_UNAVAILABLE_MESSAGE;
    return `
        <div class="booking-summary-note booking-summary-note--warning booking-preflight-warning" data-booking-preflight-warning>
            <strong>Попередня перевірка слотів недоступна</strong>
            <span>${escapeHtml(message)} Спробуйте повторити перевірку або натисніть збереження ще раз — тоді конфлікти перевірить сервер.</span>
            <button type="button" class="booking-preflight-retry" data-booking-preflight-retry>${escapeHtml(SELECTED_ACTIVITY_PREFLIGHT_RETRY_TEXT)}</button>
        </div>
    `;
}

function bindSelectedActivityPreflightWarningActions(root = document) {
    root.querySelector?.('[data-booking-preflight-retry]')?.addEventListener('click', retrySelectedActivityPreflightValidation);
}

async function retrySelectedActivityPreflightValidation(event) {
    const button = event?.currentTarget || null;
    const originalText = button?.textContent || SELECTED_ACTIVITY_PREFLIGHT_RETRY_TEXT;
    if (button) {
        button.disabled = true;
        button.textContent = 'Перевіряю...';
    }
    const formData = typeof getBookingFormData === 'function' ? getBookingFormData() : {};
    const excludeId = bookingEditConflictExcludeIds();
    try {
        const ok = await validateSelectedActivityScheduleBeforeSubmit(formData, excludeId, { forceRetry: true });
        if (ok) showNotification('Попередню перевірку слотів виконано.', 'success');
        return ok;
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}

function getSelectedActivityProgramIds() {
    const ids = Array.isArray(BookingDrawerState.selectedActivityProgramIds)
        ? BookingDrawerState.selectedActivityProgramIds.filter(Boolean).map(String)
        : [];
    if (ids.length) return ids;
    const fallback = document.getElementById('selectedProgram')?.value || '';
    return fallback ? [String(fallback)] : [];
}

function getSelectedActivityPrograms() {
    const products = typeof getProductsSync === 'function' ? getProductsSync() : [];
    const byId = new Map(products.map(product => [String(product.id), product]));
    return getSelectedActivityProgramIds()
        .map(id => {
            const product = byId.get(String(id));
            const bookingFields = getSelectedActivityBookingFields()[String(id)] || null;
            const duration = Number(bookingFields?.duration || 0);
            return product && duration > 0 ? { ...product, duration } : product;
        })
        .filter(Boolean);
}

function bookingActivityBasePriceValue(program) {
    if (!program) return 0;
    const kidsCount = Number(resolveBookingChildrenCountSource({ program }).value || 0);
    if (program.perChild && kidsCount > 0) return toBookingMoney(Number(program.price || 0) * kidsCount);
    return toBookingMoney(program.price || 0);
}

function bookingActivityPriceValue(program) {
    if (typeof useSelectedActivityPinataSubflow === 'function'
        && typeof selectedActivityPinataPriceValue === 'function'
        && useSelectedActivityPinataSubflow()
        && isPinataProgram(program)) {
        return selectedActivityPinataPriceValue(program);
    }
    return bookingActivityBasePriceValue(program);
}

function bookingActivityPriceLabel(program) {
    if (!program) return '—';
    const price = bookingActivityPriceValue(program);
    if (program.perChild && !Number(resolveBookingChildrenCountSource({ program }).value || 0)) {
        return `${formatPrice(program.price || 0)}/дит`;
    }
    return formatPrice(price);
}

function bookingActivityPriceChangeDateLabel(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}.${match[2]}` : raw;
}

function bookingActivityNextPriceLabel(program) {
    if (!program || program.nextPrice === null || program.nextPrice === undefined || !program.nextPriceFrom) return '';
    const current = toBookingMoney(program.price || 0);
    const next = toBookingMoney(program.nextPrice || 0);
    if (current === next) return '';
    return `з ${bookingActivityPriceChangeDateLabel(program.nextPriceFrom)} → ${formatPrice(next)}`;
}

const BOOKING_ACTIVITY_KNOWN_CATALOG_URLS = Object.freeze({
    pinata: '/designs#catalog-pinyata'
});

function bookingActivityPromoCleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function bookingActivityPromoTitle(activity = {}) {
    return bookingActivityPromoCleanText(
        activity.name
        || activity.title
        || activity.programName
        || activity.program_name
        || activity.label
        || activity.code
        || 'Активність'
    );
}

function bookingActivityPromoText(activity = {}) {
    return [
        activity.promoDescription,
        activity.promo_description,
        activity.shortDescription,
        activity.short_description,
        activity.description
    ].map(bookingActivityPromoCleanText).find(Boolean) || '';
}

function bookingActivityPromoImageUrl(activity = {}) {
    return bookingActivityPromoCleanText(
        activity.imageUrl
        || activity.image_url
        || activity.photoUrl
        || activity.photo_url
        || activity.coverUrl
        || activity.cover_url
        || activity.thumbnailUrl
        || activity.thumbnail_url
        || activity.iconUrl
        || activity.icon_url
        || ''
    );
}

function bookingActivityCatalogUrlFromId(catalogId) {
    const id = bookingActivityPromoCleanText(catalogId);
    if (!id) return '';
    if (id === 'graduation') return '/designs#catalog-graduation';
    return `/designs#catalog-${encodeURIComponent(id)}`;
}

function bookingActivityPromoCatalogUrl(activity = {}) {
    const directUrl = bookingActivityPromoCleanText(
        activity.catalogUrl
        || activity.catalog_url
        || activity.catalogHref
        || activity.catalog_href
        || activity.promoUrl
        || activity.promo_url
        || activity.marketingUrl
        || activity.marketing_url
        || activity.catalog?.href
        || activity.catalog?.url
    );
    if (directUrl) return directUrl;

    const catalogId = activity.catalogId || activity.catalog_id || activity.catalog?.id;
    const catalogUrl = bookingActivityCatalogUrlFromId(catalogId);
    if (catalogUrl) return catalogUrl;

    if (isPinataProgram(activity)) return BOOKING_ACTIVITY_KNOWN_CATALOG_URLS.pinata;
    return '';
}

function resolveBookingActivityPromoSource(activity = {}) {
    if (!activity || typeof activity !== 'object') return null;
    const url = bookingActivityPromoCatalogUrl(activity);
    const text = bookingActivityPromoText(activity);
    const imageUrl = bookingActivityPromoImageUrl(activity);
    if (!url && !text && !imageUrl) return null;
    return {
        kind: url ? 'catalog' : 'card',
        url,
        title: bookingActivityPromoTitle(activity),
        text,
        imageUrl,
        icon: activity.icon || '',
        productId: activity.id || activity.productId || activity.programId || ''
    };
}

function renderBookingActivityPromoAction(activity = {}, location = 'activity') {
    const source = resolveBookingActivityPromoSource(activity);
    const productId = String(activity.id || activity.productId || activity.programId || '').trim();
    if (!source || !productId) return '';
    const title = source.title || bookingActivityPromoTitle(activity);
    const safeLocation = String(location || 'activity').replace(/[^a-z0-9_-]/gi, '') || 'activity';
    return `<button type="button" class="booking-activity-promo-action booking-activity-promo-action--${escapeHtml(safeLocation)}" data-booking-activity-promo="${escapeHtml(productId)}" aria-label="Відкрити промо: ${escapeHtml(title)}">Промо</button>`;
}

function bookingActivityPromoProductById(productId) {
    const id = String(productId || '').trim();
    if (!id) return null;
    if (typeof findBookingProductById === 'function') {
        const product = findBookingProductById(id);
        if (product) return product;
    }
    const products = typeof getProductsSync === 'function' ? getProductsSync() : [];
    return (Array.isArray(products) ? products : []).find(item => String(item?.id || '') === id) || null;
}

function ensureBookingActivityPromoPanel() {
    let panel = document.getElementById('bookingActivityPromoPanel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'bookingActivityPromoPanel';
    panel.className = 'booking-activity-promo-panel hidden';
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    const host = document.getElementById('bookingPanel') || document.body;
    host.appendChild(panel);
    return panel;
}

function closeBookingActivityPromoPanel(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const panel = document.getElementById('bookingActivityPromoPanel');
    if (!panel) return;
    panel.classList.add('hidden');
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
}

function renderBookingActivityPromoPanel(activity = {}, source = resolveBookingActivityPromoSource(activity)) {
    if (!source) return;
    const panel = ensureBookingActivityPromoPanel();
    const title = source.title || bookingActivityPromoTitle(activity);
    const text = source.text || 'Промо-опис для цієї активності ще не заповнений.';
    const visual = source.imageUrl
        ? `<img src="${escapeHtml(source.imageUrl)}" alt="" loading="lazy" decoding="async">`
        : `<span aria-hidden="true">${escapeHtml(source.icon || activity.icon || '🎯')}</span>`;
    panel.innerHTML = `
        <div class="booking-activity-promo-backdrop" data-booking-activity-promo-close></div>
        <section class="booking-activity-promo-card" role="dialog" aria-modal="false" aria-labelledby="bookingActivityPromoTitle">
            <div class="booking-activity-promo-head">
                <div>
                    <span>Промо</span>
                    <strong id="bookingActivityPromoTitle">${escapeHtml(title)}</strong>
                </div>
                <button type="button" data-booking-activity-promo-close aria-label="Закрити промо">×</button>
            </div>
            <div class="booking-activity-promo-body">
                <div class="booking-activity-promo-visual">${visual}</div>
                <p>${escapeHtml(text)}</p>
            </div>
        </section>
    `;
    panel.classList.remove('hidden');
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    panel.querySelectorAll('[data-booking-activity-promo-close]').forEach(button => {
        button.addEventListener('click', closeBookingActivityPromoPanel);
    });
}

function openBookingActivityPromo(activity = {}, event = null) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const source = resolveBookingActivityPromoSource(activity);
    if (!source) return false;
    if (source.url) {
        if (typeof openSafeNewTab === 'function') openSafeNewTab(source.url);
        else window.open(source.url, '_blank', 'noopener,noreferrer');
        return true;
    }
    renderBookingActivityPromoPanel(activity, source);
    return true;
}

function openBookingActivityPromoById(productId, event = null) {
    const product = bookingActivityPromoProductById(productId);
    return product ? openBookingActivityPromo(product, event) : false;
}

function bindBookingActivityPromoActions(root = document) {
    root.querySelectorAll?.('[data-booking-activity-promo]').forEach(button => {
        if (button.dataset.bookingActivityPromoBound === 'true') return;
        button.dataset.bookingActivityPromoBound = 'true';
        button.addEventListener('click', event => openBookingActivityPromoById(button.dataset.bookingActivityPromo, event));
    });
}

function bookingActivitiesTotalPrice(programs = getSelectedActivityPrograms()) {
    return toBookingMoney(programs.reduce((sum, program) => sum + bookingActivityPriceValue(program), 0));
}

function bookingActivitiesTotalDuration(programs = getSelectedActivityPrograms()) {
    return programs.reduce((sum, program) => sum + (Number(program?.duration || 0) || 0), 0);
}

function getSelectedActivityScheduleTimes() {
    if (!BookingDrawerState.selectedActivityScheduleTimes || typeof BookingDrawerState.selectedActivityScheduleTimes !== 'object') {
        BookingDrawerState.selectedActivityScheduleTimes = {};
    }
    return BookingDrawerState.selectedActivityScheduleTimes;
}

function getSelectedActivityBookingFields() {
    if (!BookingDrawerState.selectedActivityBookingFields
        || typeof BookingDrawerState.selectedActivityBookingFields !== 'object') {
        BookingDrawerState.selectedActivityBookingFields = {};
    }
    return BookingDrawerState.selectedActivityBookingFields;
}

function getSelectedActivityScheduleIssues() {
    if (!BookingDrawerState.selectedActivityScheduleIssues || typeof BookingDrawerState.selectedActivityScheduleIssues !== 'object') {
        BookingDrawerState.selectedActivityScheduleIssues = {};
    }
    return BookingDrawerState.selectedActivityScheduleIssues;
}

function getSelectedActivityPinataFields() {
    if (!BookingDrawerState.selectedActivityPinataFields || typeof BookingDrawerState.selectedActivityPinataFields !== 'object') {
        BookingDrawerState.selectedActivityPinataFields = {};
    }
    return BookingDrawerState.selectedActivityPinataFields;
}

function getSelectedActivitySecondAnimatorFields() {
    if (!BookingDrawerState.selectedActivitySecondAnimatorFields || typeof BookingDrawerState.selectedActivitySecondAnimatorFields !== 'object') {
        BookingDrawerState.selectedActivitySecondAnimatorFields = {};
    }
    return BookingDrawerState.selectedActivitySecondAnimatorFields;
}

function useSelectedActivityPinataSubflow() {
    return bookingMultiActivityEnabled();
}

function selectedActivityRequiresSecondAnimator(program = {}) {
    return Number(program?.hosts || 0) > 1;
}

function selectedActivitySecondAnimatorSelectId(programId) {
    const encoded = encodeURIComponent(String(programId || '')).replace(/[^A-Za-z0-9_-]/g, '_');
    return `activitySecondAnimatorSelect_${encoded || 'activity'}`;
}

function selectedActivityIsPrimary(programId) {
    return String(getSelectedActivityProgramIds()[0] || '') === String(programId || '');
}

function selectedActivitySecondAnimatorState(program = {}) {
    const programId = String(program?.id || '');
    if (!programId || !selectedActivityRequiresSecondAnimator(program)) {
        return { secondAnimator: '', secondAnimatorLineId: null, secondAnimatorLineName: null };
    }
    const fields = getSelectedActivitySecondAnimatorFields();
    if (!fields[programId]) {
        fields[programId] = { secondAnimator: '', secondAnimatorLineId: null, secondAnimatorLineName: null };
    }
    return fields[programId];
}

function selectedActivitySecondAnimatorDraft(program = {}) {
    if (!selectedActivityRequiresSecondAnimator(program)) {
        return { secondAnimator: null, secondAnimatorLineId: null, secondAnimatorLineName: null };
    }
    const programId = String(program?.id || '');
    const state = selectedActivitySecondAnimatorState(program);
    const primarySelectValue = selectedActivityIsPrimary(programId)
        ? (document.getElementById('secondAnimatorSelect')?.value || '')
        : '';
    const selectedName = String(primarySelectValue || state.secondAnimator || '').trim();
    const rowCandidate = selectedAnimatorLineCandidate(selectedActivitySecondAnimatorSelectId(programId), selectedName);
    const primaryCandidate = selectedActivityIsPrimary(programId)
        ? selectedAnimatorLineCandidate('secondAnimatorSelect', selectedName)
        : null;
    const candidate = primaryCandidate || rowCandidate;
    const candidateLineId = candidate?.id && candidate.id !== selectedName ? candidate.id : null;
    return {
        secondAnimator: selectedName || null,
        secondAnimatorLineId: state.secondAnimatorLineId || candidateLineId || null,
        secondAnimatorLineName: state.secondAnimatorLineName || candidate?.name || selectedName || null
    };
}

function selectedActivitySecondAnimatorValidationIssues(program = {}) {
    if (!selectedActivityRequiresSecondAnimator(program)) return [];
    const draft = selectedActivitySecondAnimatorDraft(program);
    const label = program.code || program.name || 'Активність';
    return draft.secondAnimator ? [] : [{
        key: `activity_second_animator_${program.id}`,
        message: `${label}: оберіть другого ведучого.`,
        fields: [`activitySecondAnimator:${program.id}`]
    }];
}

function selectedActivitySecondAnimatorValidationBlockers(formData = {}) {
    if (!formData.hasEvent || !bookingMultiActivityEnabled()) return [];
    const programs = Array.isArray(formData.activityPrograms)
        ? formData.activityPrograms.filter(Boolean)
        : getSelectedActivityPrograms();
    return programs.flatMap(program => selectedActivitySecondAnimatorValidationIssues(program));
}

function selectedActivityPinataDefaultMode(program = {}) {
    if (!isPinataProgram(program)) return 'none';
    return String(program.id || '') === 'pinata_own' ? 'client' : 'park';
}

function selectedActivityPinataState(program = {}) {
    const programId = String(program?.id || '');
    if (!programId || !isPinataProgram(program)) {
        return {
            pinataMode: 'none',
            pinataNumber: '',
            pinataFiller: '',
            pinataFillerNumber: '',
            clientPinataServicePrice: '',
            clientPinataServiceNote: ''
        };
    }
    const fields = getSelectedActivityPinataFields();
    if (!fields[programId]) {
        const mode = selectedActivityPinataDefaultMode(program);
        fields[programId] = {
            pinataMode: mode,
            pinataNumber: '',
            pinataFiller: '',
            pinataFillerNumber: '',
            clientPinataServicePrice: mode === 'client' ? String(getClientPinataDefaultPrice()) : '',
            clientPinataServiceNote: ''
        };
    }
    const state = fields[programId];
    const mode = ['park', 'client'].includes(String(state.pinataMode || '')) ? state.pinataMode : selectedActivityPinataDefaultMode(program);
    state.pinataMode = mode;
    if (mode === 'client' && !String(state.clientPinataServicePrice || '').trim()) {
        state.clientPinataServicePrice = String(getClientPinataDefaultPrice());
    }
    if (mode === 'park' && isClientPinataFillerChoice(state.pinataFiller)) {
        state.pinataFillerNumber = CLIENT_PINATA_FILLER_VALUE;
    }
    return state;
}

function selectedActivityPinataDraft(program = {}) {
    if (!isPinataProgram(program)) {
        return {
            pinataMode: 'none',
            pinataNumber: null,
            pinataFillerNumber: null,
            pinataFiller: null,
            clientPinataServicePrice: null,
            clientPinataServiceNote: null
        };
    }
    const state = selectedActivityPinataState(program);
    const pinataMode = state.pinataMode || selectedActivityPinataDefaultMode(program);
    const clientOwnedFiller = pinataMode === 'park' && isClientPinataFillerChoice(state.pinataFiller);
    const pinataFillerNumber = pinataMode === 'park'
        ? (clientOwnedFiller ? CLIENT_PINATA_FILLER_VALUE : (String(state.pinataFillerNumber || state.pinataFiller || '').trim() || null))
        : (String(state.pinataFillerNumber || '').trim() || null);
    return {
        pinataMode,
        pinataNumber: pinataMode !== 'none' ? (String(state.pinataNumber || '').trim() || null) : null,
        pinataFillerNumber: pinataMode !== 'none' ? pinataFillerNumber : null,
        pinataFiller: pinataMode === 'park' && !clientOwnedFiller ? (String(state.pinataFiller || '').trim() || null) : null,
        clientPinataServicePrice: pinataMode === 'client' ? (String(state.clientPinataServicePrice || '').trim() || getClientPinataDefaultPrice()) : null,
        clientPinataServiceNote: pinataMode === 'client' ? (String(state.clientPinataServiceNote || '').trim() || null) : null
    };
}

function selectedActivityPinataPriceValue(program) {
    if (!isPinataProgram(program)) return bookingActivityBasePriceValue(program);
    const draft = selectedActivityPinataDraft(program);
    if (draft.pinataMode === 'client') return toBookingMoney(draft.clientPinataServicePrice || getClientPinataDefaultPrice());
    if (draft.pinataMode === 'none') return 0;
    return bookingActivityBasePriceValue(program);
}

function selectedActivityPinataLabel(program, fallbackLabel = '') {
    if (!isPinataProgram(program)) return fallbackLabel;
    const draft = selectedActivityPinataDraft(program);
    if (draft.pinataMode === 'client') return 'Клієнтська піньята';
    if (draft.pinataMode === 'park' && draft.pinataFiller) return `Пін+${draft.pinataFiller}`;
    if (draft.pinataMode === 'park' && draft.pinataFillerNumber === CLIENT_PINATA_FILLER_VALUE) return 'Пін+свій';
    return fallbackLabel || program.label || program.code || program.name || 'Піньята';
}

function selectedActivityPinataValidationIssues(program = {}) {
    if (!isPinataProgram(program)) return [];
    const draft = selectedActivityPinataDraft(program);
    const label = program.code || program.name || 'Піньята';
    const issues = [];
    if (!draft.pinataMode || draft.pinataMode === 'none') {
        issues.push({
            key: `activity_pinata_mode_${program.id}`,
            message: `${label}: оберіть тип піньяти.`,
            fields: [`activityPinata:${program.id}:pinataMode`]
        });
    }
    if (draft.pinataMode === 'park') {
        if (!draft.pinataNumber) {
            issues.push({
                key: `activity_pinata_number_${program.id}`,
                message: `${label}: оберіть номер піньяти.`,
                fields: [`activityPinata:${program.id}:pinataNumber`]
            });
        }
        if (program.hasFiller && !draft.pinataFillerNumber) {
            issues.push({
                key: `activity_pinata_filler_${program.id}`,
                message: `${label}: оберіть наповнювач або свій наповнювач клієнта.`,
                fields: [`activityPinata:${program.id}:pinataFiller`]
            });
        }
    }
    if (draft.pinataMode === 'client' && !draft.pinataNumber) {
        issues.push({
            key: `activity_client_pinata_number_${program.id}`,
            message: `${label}: оберіть номер клієнтської піньяти.`,
            fields: [`activityPinata:${program.id}:pinataNumber`]
        });
    }
    return issues;
}

function selectedActivityPinataValidationBlockers(formData = {}) {
    if (!formData.hasEvent || typeof useSelectedActivityPinataSubflow !== 'function' || !useSelectedActivityPinataSubflow()) return [];
    const programs = Array.isArray(formData.activityPrograms)
        ? formData.activityPrograms.filter(Boolean)
        : getSelectedActivityPrograms();
    return programs.flatMap(program => selectedActivityPinataValidationIssues(program));
}

function normalizeSelectedActivityScheduleTime(value) {
    return bookingActivityScheduleApi().normalizeSelectedActivityScheduleTime(value);
}

function selectedActivityScheduleDate() {
    return AppState.selectedDate || document.getElementById('bookingDate')?.value || new Date();
}

function selectedActivityScheduleTimelineConfig() {
    return (typeof CONFIG !== 'undefined' && CONFIG?.TIMELINE) ? CONFIG.TIMELINE : {};
}

function selectedActivityScheduleOptions(options = {}) {
    return {
        date: selectedActivityScheduleDate(),
        timelineConfig: selectedActivityScheduleTimelineConfig(),
        stepMinutes: 15,
        ...options
    };
}

function selectedActivityScheduleWorkday(options = {}) {
    return bookingActivityScheduleApi().resolveSelectedActivityScheduleWorkday(selectedActivityScheduleOptions(options));
}

function selectedActivityScheduleLatestStartMinutes(row = {}) {
    const workday = selectedActivityScheduleWorkday();
    const duration = Number(row.duration || row.program?.duration || 0) || 0;
    if (duration <= 0) return workday.endMinutes;
    return Math.max(workday.startMinutes, workday.endMinutes - duration);
}

function isSelectedActivityScheduleSlotTime(value, row = {}) {
    return bookingActivityScheduleApi().isSelectedActivityScheduleSlotTime(
        value,
        selectedActivityScheduleOptions({ latestStartMinutes: selectedActivityScheduleLatestStartMinutes(row) })
    );
}

function selectedActivityScheduleTimeOptions(row = {}) {
    const api = bookingActivityScheduleApi();
    const current = normalizeSelectedActivityScheduleTime(row.time || '');
    const latestStartMinutes = selectedActivityScheduleLatestStartMinutes(row);
    const options = api.buildSelectedActivityScheduleTimeOptions(
        selectedActivityScheduleOptions({ latestStartMinutes })
    );
    if (current && !options.includes(current)) {
        options.push(current);
        options.sort((a, b) => (api.scheduleTimeToMinutes(a) || 0) - (api.scheduleTimeToMinutes(b) || 0));
    }
    return options;
}

function selectedActivityScheduleTimeOptionsHtml(row = {}) {
    const current = normalizeSelectedActivityScheduleTime(row.time || '');
    const validCurrent = current ? isSelectedActivityScheduleSlotTime(current, row) : false;
    const blankOption = current ? '' : '<option value="">Оберіть час</option>';
    const rows = selectedActivityScheduleTimeOptions(row).map(time => {
        const selected = time === current ? ' selected' : '';
        const suffix = time === current && !validCurrent ? ' · поза сіткою' : '';
        return `<option value="${escapeHtml(time)}"${selected}>${escapeHtml(time + suffix)}</option>`;
    });
    return `${blankOption}${rows.join('')}`;
}

function selectedActivityScheduleBaseTime() {
    return normalizeSelectedActivityScheduleTime(
        document.getElementById('bookingTime')?.value
        || AppState.selectedCell?.dataset?.time
        || ''
    );
}

function pruneSelectedActivityScheduleState(programIds = []) {
    const keep = new Set((programIds || []).map(String));
    const times = getSelectedActivityScheduleTimes();
    Object.keys(times).forEach(id => {
        if (!keep.has(String(id))) delete times[id];
    });
    const issues = getSelectedActivityScheduleIssues();
    Object.keys(issues).forEach(id => {
        if (!keep.has(String(id))) delete issues[id];
    });
    const pinataFields = getSelectedActivityPinataFields();
    Object.keys(pinataFields).forEach(id => {
        if (!keep.has(String(id))) delete pinataFields[id];
    });
    const secondAnimatorFields = getSelectedActivitySecondAnimatorFields();
    Object.keys(secondAnimatorFields).forEach(id => {
        if (!keep.has(String(id))) delete secondAnimatorFields[id];
    });
    clearSelectedActivityPreflightState();
}

function resetSelectedActivityScheduleState(options = {}) {
    BookingDrawerState.selectedActivityBookingFields = {};
    BookingDrawerState.selectedActivityScheduleTimes = {};
    BookingDrawerState.selectedActivityScheduleIssues = {};
    BookingDrawerState.selectedActivityPinataFields = {};
    BookingDrawerState.selectedActivitySecondAnimatorFields = {};
    clearSelectedActivityPreflightState();
    if (options.render) renderSelectedProgramSummary();
}

function getSelectedActivityScheduleRows(programs = getSelectedActivityPrograms()) {
    return bookingActivityScheduleApi().buildSelectedActivityScheduleRows(programs, {
        scheduleTimes: getSelectedActivityScheduleTimes(),
        baseTime: selectedActivityScheduleBaseTime(),
        ...selectedActivityScheduleOptions(),
        durationForProgram: typeof bookingSummaryActivityDuration === 'function'
            ? bookingSummaryActivityDuration
            : undefined
    });
}

function selectedActivityScheduleLabel(row = {}) {
    if (!row.time) return 'час не задано';
    return `${row.time}–${row.endTime || row.time}`;
}

function selectedActivityScheduleExtra(rows = []) {
    return bookingActivityScheduleApi().selectedActivityScheduleExtra(rows);
}

function setSelectedActivityScheduleIssues(issueMap = {}) {
    BookingDrawerState.selectedActivityScheduleIssues = issueMap;
}

function selectedActivityScheduleIssueText(programId) {
    const issue = getSelectedActivityScheduleIssues()[String(programId)];
    if (!issue) return '';
    const messages = Array.isArray(issue.messages) ? issue.messages : [];
    return messages.filter(Boolean).join(' · ');
}

function addSelectedActivityScheduleIssue(issueMap, programId, message, options = {}) {
    const id = String(programId || '');
    if (!id || !message) return;
    if (!issueMap[id]) issueMap[id] = { messages: [], conflictBookingId: null };
    if (!issueMap[id].messages.includes(message)) issueMap[id].messages.push(message);
    if (options.conflictBookingId && !issueMap[id].conflictBookingId) {
        issueMap[id].conflictBookingId = options.conflictBookingId;
    }
}

function setSelectedActivityScheduleTime(programId, value, options = {}) {
    const id = String(programId || '');
    const raw = String(value || '').trim();
    const time = normalizeSelectedActivityScheduleTime(value);
    if (!id) return false;
    const program = getSelectedActivityPrograms().find(item => String(item?.id || '') === id) || null;
    if (time && !isSelectedActivityScheduleSlotTime(time, { program, duration: Number(program?.duration || 0) || 0 })) {
        if (options.notify !== false && typeof showNotification === 'function') {
            const workday = selectedActivityScheduleWorkday();
            showNotification(`Оберіть час у робочих годинах ${workday.start}-${workday.end} з кроком 15 хв.`, 'error');
        }
        return false;
    }
    const scheduleTimes = getSelectedActivityScheduleTimes();
    if (!time) {
        if (raw) return false;
        delete scheduleTimes[id];
    } else {
        scheduleTimes[id] = time;
    }
    const rows = getSelectedActivityScheduleRows();
    const changedRow = rows.find(row => row.programId === id);
    if (changedRow?.index === 0 && changedRow.time) {
        const bookingTime = document.getElementById('bookingTime');
        if (bookingTime) bookingTime.value = changedRow.time;
        const selectedTime = document.getElementById('selectedTimeDisplay');
        if (selectedTime) selectedTime.textContent = changedRow.time;
        refreshAnimatorSelectsForCurrentSlot().catch(() => {});
    }
    setSelectedActivityScheduleIssues({});
    clearSelectedActivityPreflightState();
    renderSelectedProgramSummary();
    renderBookingPackageSummary();
    if (window.BookingForm) BookingForm._dirty = true;
    if (options.validate !== false) scheduleSelectedActivityConflictRefresh();
    return true;
}

function alignSelectedActivityScheduleSequentially(options = {}) {
    BookingDrawerState.selectedActivityScheduleTimes = {};
    BookingDrawerState.selectedActivityScheduleIssues = {};
    clearSelectedActivityPreflightState();
    renderSelectedProgramSummary();
    renderBookingPackageSummary();
    if (window.BookingForm) BookingForm._dirty = true;
    if (options.validate !== false) scheduleSelectedActivityConflictRefresh(0);
}

function updateSelectedProgramCards() {
    const selected = new Set(getSelectedActivityProgramIds().map(String));
    document.querySelectorAll('.program-icon').forEach(icon => {
        const isSelected = selected.has(String(icon.dataset.programId || ''));
        icon.classList.toggle('selected', isSelected);
        icon.classList.toggle('is-primary-activity', isSelected && String(icon.dataset.programId || '') === getSelectedActivityProgramIds()[0]);
        icon.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });
}

function setSelectedActivityPrograms(ids = [], options = {}) {
    const unique = [];
    ids.filter(Boolean).map(String).forEach(id => {
        if (!unique.includes(id)) unique.push(id);
    });
    BookingDrawerState.selectedActivityProgramIds = unique;
    pruneSelectedActivityScheduleState(unique);
    clearSelectedActivityPreflightState();
    const hidden = document.getElementById('selectedProgram');
    if (hidden) hidden.value = unique[0] || '';
    updateSelectedProgramCards();
    if (options.renderSummary !== false) renderSelectedProgramSummary();
    if (options.renderPackage !== false) renderBookingPackageSummary();
    refreshBookingActiveBanquetRoleIntent();
    if (options.markDirty && window.BookingForm) BookingForm._dirty = true;
}

function removeSelectedActivityProgram(programId) {
    const ids = getSelectedActivityProgramIds().filter(id => String(id) !== String(programId));
    setSelectedActivityPrograms(ids, { markDirty: true });
    const primary = getSelectedActivityPrograms()[0] || null;
    syncPrimaryProgramDependentFields(primary);
}

function syncPrimaryProgramDependentFields(program) {
    if (!program) {
        document.getElementById('customProgramSection')?.classList.add('hidden');
        resetPinataModeFields();
        updateBookingSubmitState();
        return;
    }
    if (program.isCustom) {
        document.getElementById('customProgramSection')?.classList.remove('hidden');
    } else {
        document.getElementById('customProgramSection')?.classList.add('hidden');
    }

    if (isPinataProgram(program) && useSelectedActivityPinataSubflow()) {
        resetPinataModeFields();
    } else if (isPinataProgram(program)) {
        const modeSelect = document.getElementById('pinataMode');
        const defaultMode = program.id === 'pinata_own' ? 'client' : 'park';
        if (modeSelect) modeSelect.value = defaultMode;
        syncPinataModeFields(defaultMode);
        if (defaultMode === 'park') _loadPinataStockBadge();
    } else {
        resetPinataModeFields();
    }
    updateBookingSubmitState();
}

function selectedActivityPinataOptionsHtml(choices = [], selectedValue = '', placeholder = 'Оберіть') {
    const selected = pinataNormalizeChoiceValue(selectedValue);
    return [
        `<option value="">${escapeHtml(placeholder)}</option>`,
        ...choices.map(choice => {
            const value = pinataNormalizeChoiceValue(choice.value);
            const label = pinataChoiceDisplayLabel(choice);
            return `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
        })
    ].join('');
}

function renderSelectedActivityPinataSubflow(row = {}) {
    const program = row.program;
    if (!isPinataProgram(program) || !useSelectedActivityPinataSubflow()) return '';
    const state = selectedActivityPinataState(program);
    const mode = state.pinataMode || selectedActivityPinataDefaultMode(program);
    const designChoices = buildPinataDesignChoices();
    const fillerChoices = buildPinataFillerChoices();
    const issues = selectedActivityPinataValidationIssues(program);
    const issueText = issues.map(issue => issue.message).join(' · ');
    const programId = String(program.id || '');

    if (!PinataPickerState.status && !PinataPickerState.promise) {
        loadPinataPickerStatus().then(() => renderSelectedProgramSummary()).catch(() => {});
    }

    return `
        <div class="selected-activity-pinata${issues.length ? ' has-error' : ''}" data-activity-pinata-id="${escapeHtml(programId)}" aria-invalid="${issues.length ? 'true' : 'false'}">
            <div class="selected-activity-pinata-head">
                <strong>Піньята</strong>
                <span>${escapeHtml(mode === 'client' ? 'клієнтська' : 'парк')}</span>
            </div>
            <div class="selected-activity-pinata-grid">
                <label>
                    <span>Тип</span>
                    <select data-activity-pinata-field="pinataMode" data-activity-pinata-id="${escapeHtml(programId)}">
                        <option value="park"${mode === 'park' ? ' selected' : ''}>Піньята парку</option>
                        <option value="client"${mode === 'client' ? ' selected' : ''}>Клієнтська піньята</option>
                    </select>
                </label>
                <label>
                    <span>№ піньяти</span>
                    <select data-activity-pinata-field="pinataNumber" data-activity-pinata-id="${escapeHtml(programId)}">
                        ${selectedActivityPinataOptionsHtml(designChoices, state.pinataNumber, 'Оберіть номер')}
                    </select>
                </label>
                ${mode === 'park' ? `
                    <label>
                        <span>Наповнювач</span>
                        <select data-activity-pinata-field="pinataFiller" data-activity-pinata-id="${escapeHtml(programId)}">
                            ${selectedActivityPinataOptionsHtml(fillerChoices, state.pinataFiller, 'Оберіть наповнювач')}
                        </select>
                    </label>
                ` : `
                    <label>
                        <span>Послуга, ₴</span>
                        <input type="number" min="0" step="50" data-activity-pinata-field="clientPinataServicePrice" data-activity-pinata-id="${escapeHtml(programId)}" value="${escapeHtml(String(state.clientPinataServicePrice || getClientPinataDefaultPrice()))}">
                    </label>
                    <label class="selected-activity-pinata-note">
                        <span>Нотатка</span>
                        <input type="text" maxlength="500" data-activity-pinata-field="clientPinataServiceNote" data-activity-pinata-id="${escapeHtml(programId)}" value="${escapeHtml(state.clientPinataServiceNote || '')}">
                    </label>
                `}
            </div>
            ${issueText ? `<span class="selected-activity-pinata-error">${escapeHtml(issueText)}</span>` : ''}
        </div>
    `;
}

function renderSelectedActivitySecondAnimatorSubflow(row = {}) {
    const program = row.program;
    if (!selectedActivityRequiresSecondAnimator(program)) return '';
    const programId = String(program.id || '');
    const draft = selectedActivitySecondAnimatorDraft(program);
    const issues = selectedActivitySecondAnimatorValidationIssues(program);
    const issueText = issues.map(issue => issue.message).join(' · ');
    const selectId = selectedActivitySecondAnimatorSelectId(programId);
    const currentOption = draft.secondAnimator
        ? `<option value="${escapeHtml(draft.secondAnimator)}"${draft.secondAnimatorLineId ? ` data-line-id="${escapeHtml(draft.secondAnimatorLineId)}"` : ''}${draft.secondAnimatorLineName ? ` data-line-name="${escapeHtml(draft.secondAnimatorLineName)}"` : ''} selected>${escapeHtml(draft.secondAnimatorLineName || draft.secondAnimator)}</option>`
        : '';

    return `
        <div class="selected-activity-second-host${issues.length ? ' has-error' : ''}" data-activity-second-host-id="${escapeHtml(programId)}" aria-invalid="${issues.length ? 'true' : 'false'}">
            <div class="selected-activity-second-host-head">
                <strong>Другий ведучий</strong>
                <span>${escapeHtml(row.time ? selectedActivityScheduleLabel(row) : 'час не задано')}</span>
            </div>
            <label class="selected-activity-second-host-field">
                <span>Ведучий</span>
                <select id="${escapeHtml(selectId)}" data-activity-second-animator-id="${escapeHtml(programId)}">
                    <option value="">Оберіть ведучого</option>
                    ${currentOption}
                </select>
            </label>
            ${issueText ? `<span class="selected-activity-second-host-error">${escapeHtml(issueText)}</span>` : ''}
        </div>
    `;
}

function setSelectedActivitySecondAnimator(programId, value) {
    const id = String(programId || '');
    const program = getSelectedActivityPrograms().find(item => String(item.id) === id) || findBookingProductById(id);
    if (!id || !program || !selectedActivityRequiresSecondAnimator(program)) return;
    const nextValue = String(value || '').trim();
    const state = selectedActivitySecondAnimatorState(program);
    const rowCandidate = selectedAnimatorLineCandidate(selectedActivitySecondAnimatorSelectId(id), nextValue);
    state.secondAnimator = nextValue;
    state.secondAnimatorLineId = rowCandidate?.id || null;
    state.secondAnimatorLineName = rowCandidate?.name || nextValue || null;

    if (selectedActivityIsPrimary(id)) {
        const primarySelect = document.getElementById('secondAnimatorSelect');
        if (primarySelect) primarySelect.value = nextValue;
    }

    setSelectedActivityScheduleIssues({});
    clearSelectedActivityPreflightState();
    renderSelectedProgramSummary();
    renderBookingPackageSummary();
    updateBookingSubmitState();
    if (window.BookingForm) BookingForm._dirty = true;
    scheduleSelectedActivityConflictRefresh();
}

async function populateSelectedActivitySecondAnimatorSelects() {
    const programs = getSelectedActivityPrograms().filter(selectedActivityRequiresSecondAnimator);
    const rowsByProgramId = new Map(getSelectedActivityScheduleRows(getSelectedActivityPrograms())
        .map(row => [String(row.programId), row]));
    for (const program of programs) {
        const programId = String(program.id || '');
        const select = document.getElementById(selectedActivitySecondAnimatorSelectId(programId));
        if (!select) continue;
        const draft = selectedActivitySecondAnimatorDraft(program);
        const row = rowsByProgramId.get(programId) || null;
        const selectedName = draft.secondAnimator || '';
        if (selectedName && !select.value) {
            const option = document.createElement('option');
            option.value = selectedName;
            option.textContent = draft.secondAnimatorLineName || selectedName;
            if (draft.secondAnimatorLineId) option.dataset.lineId = draft.secondAnimatorLineId;
            if (draft.secondAnimatorLineName) option.dataset.lineName = draft.secondAnimatorLineName;
            option.selected = true;
            select.appendChild(option);
        }
        await populateAnimatorSelectById(select.id, 'Оберіть другого ведучого', {
            time: row?.time || '',
            duration: row?.duration || 0
        });
        if (selectedName && select.value !== selectedName) {
            const option = document.createElement('option');
            option.value = selectedName;
            option.textContent = draft.secondAnimatorLineName || selectedName;
            if (draft.secondAnimatorLineId) option.dataset.lineId = draft.secondAnimatorLineId;
            if (draft.secondAnimatorLineName) option.dataset.lineName = draft.secondAnimatorLineName;
            option.selected = true;
            select.appendChild(option);
            select.value = selectedName;
        }
    }
}

function setSelectedActivityPinataField(programId, field, value) {
    const id = String(programId || '');
    const program = getSelectedActivityPrograms().find(item => String(item.id) === id) || findBookingProductById(id);
    if (!id || !program || !isPinataProgram(program)) return;
    const state = selectedActivityPinataState(program);
    const nextValue = String(value || '').trim();
    if (field === 'pinataMode') {
        state.pinataMode = nextValue === 'client' ? 'client' : 'park';
        if (state.pinataMode === 'client') {
            state.pinataFiller = '';
            state.pinataFillerNumber = '';
            if (!state.clientPinataServicePrice) state.clientPinataServicePrice = String(getClientPinataDefaultPrice());
        } else {
            state.clientPinataServicePrice = '';
            state.clientPinataServiceNote = '';
        }
    } else if (field === 'pinataNumber') {
        state.pinataNumber = nextValue;
    } else if (field === 'pinataFiller') {
        state.pinataFiller = nextValue;
        state.pinataFillerNumber = isClientPinataFillerChoice(nextValue) ? CLIENT_PINATA_FILLER_VALUE : nextValue;
    } else if (field === 'clientPinataServicePrice') {
        state.clientPinataServicePrice = nextValue;
    } else if (field === 'clientPinataServiceNote') {
        state.clientPinataServiceNote = nextValue;
    }
    clearSelectedActivityPreflightState();
    renderSelectedProgramSummary();
    renderBookingPackageSummary();
    updateBookingSubmitState();
    if (window.BookingForm) BookingForm._dirty = true;
}

function renderSelectedProgramSummary(program = null) {
    const details = document.getElementById('programDetails');
    const empty = document.getElementById('programDetailsEmpty');
    const list = document.getElementById('selectedActivitiesList');
    if (!details) return;
    const programs = getSelectedActivityPrograms();
    if (programs.length === 0) {
        if (empty) empty.classList.remove('hidden');
        if (list) list.innerHTML = '';
        return;
    }
    if (empty) empty.classList.add('hidden');

    if (list) {
        const scheduleRows = getSelectedActivityScheduleRows(programs);
        const alignButton = programs.length > 1
            ? `<div class="selected-activities-toolbar">
                <button type="button" class="selected-activities-align" data-align-activity-schedule>Вирівняти послідовно</button>
            </div>`
            : '';
        list.innerHTML = `${alignButton}${scheduleRows.map((row, index) => {
            const item = row.program;
            const issueText = selectedActivityScheduleIssueText(item.id);
            const pinataSubflow = renderSelectedActivityPinataSubflow(row);
            const secondHostSubflow = renderSelectedActivitySecondAnimatorSubflow(row);
            const promoAction = renderBookingActivityPromoAction(item, 'selected-activity');
            const activityDuration = bookingSummaryActivityDuration(item);
            return `
            <div class="selected-activity-item${issueText ? ' has-conflict' : ''}" data-selected-activity-id="${escapeHtml(String(item.id))}">
                <span class="selected-activity-order">${index + 1}</span>
                <span class="selected-activity-main">
                    <strong>${escapeHtml(item.code || item.label || item.name || 'Активність')}</strong>
                    <small>${escapeHtml(item.name || item.label || '')}</small>
                    <span class="selected-activity-schedule">${escapeHtml(selectedActivityScheduleLabel(row))}</span>
                    ${issueText ? `<span class="selected-activity-conflict">${escapeHtml(issueText)}</span>` : ''}
                </span>
                <label class="selected-activity-time">
                    <span>Старт</span>
                    <select class="selected-activity-time-input" data-activity-time-id="${escapeHtml(String(item.id))}" aria-label="Час старту ${escapeHtml(item.code || item.name || 'активності')}">
                        ${selectedActivityScheduleTimeOptionsHtml(row)}
                    </select>
                </label>
                <span class="selected-activity-meta">
                    ${activityDuration ? `${escapeHtml(String(activityDuration))} хв · ` : ''}${escapeHtml(bookingActivityPriceLabel(item))}
                </span>
                <span class="selected-activity-actions">
                    ${promoAction}
                    <button type="button" class="selected-activity-remove" data-remove-activity="${escapeHtml(String(item.id))}" aria-label="Прибрати активність ${escapeHtml(item.code || item.name || '')}">×</button>
                </span>
                ${secondHostSubflow}
                ${pinataSubflow}
            </div>
        `;
        }).join('')}`;
        list.querySelector('[data-align-activity-schedule]')?.addEventListener('click', () => alignSelectedActivityScheduleSequentially());
        list.querySelectorAll('[data-activity-time-id]').forEach(input => {
            input.addEventListener('change', () => setSelectedActivityScheduleTime(input.dataset.activityTimeId, input.value));
        });
        list.querySelectorAll('[data-activity-pinata-field][data-activity-pinata-id]').forEach(input => {
            const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
            input.addEventListener(eventName, () => setSelectedActivityPinataField(input.dataset.activityPinataId, input.dataset.activityPinataField, input.value));
        });
        list.querySelectorAll('[data-activity-second-animator-id]').forEach(select => {
            select.addEventListener('change', () => setSelectedActivitySecondAnimator(select.dataset.activitySecondAnimatorId, select.value));
        });
        bindBookingActivityPromoActions(list);
        list.querySelectorAll('[data-remove-activity]').forEach(btn => {
            btn.addEventListener('click', () => removeSelectedActivityProgram(btn.dataset.removeActivity));
        });
        populateSelectedActivitySecondAnimatorSelects().catch(err => {
            console.warn('[Booking] Activity second animator select population failed', err);
        });
    }
}

function programMediaFallbackHtml(fallbackIcon) {
    return `<span class="icon-circle"><span class="icon">${_escB(fallbackIcon || '🎯')}</span></span>`;
}

function fallbackProgramMediaImage(img) {
    const media = img?.closest?.('.program-media--image');
    if (!media || media.classList.contains('program-media--image-failed')) return;
    const fallbackIcon = media.dataset.fallbackIcon || '🎯';
    media.classList.remove('program-media--image');
    media.classList.add('program-media--fallback', 'program-media--image-failed');
    media.dataset.imageState = 'failed';
    media.innerHTML = programMediaFallbackHtml(fallbackIcon);
}

function handleProgramMediaImageError(event) {
    const img = event.target?.closest?.('.program-media img');
    if (!img) return;
    fallbackProgramMediaImage(img);
}

function bindProgramMediaImageFallbacks(container) {
    if (!container || container._programMediaImageFallbackBound) return;
    container.addEventListener('error', handleProgramMediaImageError, true);
    container._programMediaImageFallbackBound = true;
}

async function renderProgramIcons() {
    const container = document.getElementById('programsIcons');
    bindProgramMediaImageFallbacks(container);

    // v7.0: Load products from API (with fallback to PROGRAMS)
    // Don't clear DOM until data is ready — prevents blank flash
    const allProducts = await getProducts();

    // Cache: skip rebuild if products haven't changed
    const hash = allProducts.length + ':' + allProducts
        .map(p => [p.id, p.label, p.name, p.duration, p.price, p.nextPrice, p.nextPriceFrom, p.effectivePriceDate, p.hosts, p.isActive, p.description || '', p.shortDescription || '', p.promoDescription || '', p.imageUrl || p.image_url || '', p.iconUrl || p.icon_url || '', p.catalogUrl || '', p.catalogId || '', p.updatedAt || ''].join('|'))
        .join(',');
    if (hash === _programIconsHash && container.children.length > 0) return;
    _programIconsHash = hash;

    container.innerHTML = '';
    renderProgramCategoryChips();

    CATEGORY_ORDER_BOOKING.forEach(cat => {
        const programs = allProducts.filter(p => p.category === cat);
        if (programs.length === 0) return;

        const header = document.createElement('div');
        header.className = 'category-header';
        header.dataset.category = cat;
        header.textContent = CATEGORY_NAMES_BOOKING[cat] || cat;
        container.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'category-grid';
        grid.dataset.category = cat;
        programs.forEach(p => {
            const shell = document.createElement('div');
            shell.className = 'program-card-shell';
            shell.dataset.programId = String(p.id);
            shell.dataset.category = p.category || '';
            const icon = document.createElement('button');
            icon.type = 'button';
            icon.className = `program-icon ${p.category}`;
            icon.dataset.programId = String(p.id);
            icon.dataset.category = p.category || '';
            icon.dataset.search = [
                p.code,
                p.name,
                p.label,
                p.category,
                p.duration,
                p.price,
                p.age,
                p.kids
            ].filter(Boolean).join(' ').toLowerCase();
            const cardName = (typeof TIMELINE_DISPLAY_MODE !== 'undefined' && TIMELINE_DISPLAY_MODE !== 'park') || IS_MAYSTERNYA_DOLI_TIMELINE
                ? p.name
                : p.code;
            const durationBadge = p.duration > 0
                ? `<span class="program-duration ${p.duration <= 60 ? 'short' : 'long'}">${p.duration}'</span>`
                : '';
            const priceBadge = p.price || p.perChild
                ? `<span class="program-price-badge">${_escB(bookingActivityPriceLabel(p))}</span>`
                : '';
            const nextPriceLabel = bookingActivityNextPriceLabel(p);
            const nextPriceBadge = nextPriceLabel
                ? `<span class="program-next-price-badge">${_escB(nextPriceLabel)}</span>`
                : '';
            const programImageUrl = p.iconUrl || p.icon_url || p.imageUrl || p.image_url || '';
            const programFallbackIcon = p.icon || '🎯';
            const programMedia = programImageUrl
                ? `<span class="program-media program-media--image" data-fallback-icon="${_escB(programFallbackIcon)}"><img src="${_escB(programImageUrl)}" alt="" loading="lazy" decoding="async"></span>`
                : `<span class="program-media program-media--fallback">${programMediaFallbackHtml(programFallbackIcon)}</span>`;
            icon.setAttribute('aria-pressed', 'false');
            icon.setAttribute('aria-label', `Обрати програму ${cardName}${p.duration ? `, ${p.duration} хв` : ''}${p.price ? `, ${bookingActivityPriceLabel(p)}` : ''}${nextPriceLabel ? `, ${nextPriceLabel}` : ''}`);
            icon.innerHTML = `
                <span class="program-card-badges">${priceBadge}${durationBadge}</span>
                ${programMedia}
                <span class="program-card-body">
                    <span class="name">${_escB(cardName)}</span>
                    ${nextPriceBadge}
                </span>
            `;
            icon.addEventListener('click', () => selectProgram(p.id));
            shell.appendChild(icon);
            if (resolveBookingActivityPromoSource(p)) {
                const promoButton = document.createElement('button');
                promoButton.type = 'button';
                promoButton.className = 'booking-activity-promo-action booking-activity-promo-action--program-list';
                promoButton.dataset.bookingActivityPromo = String(p.id);
                promoButton.setAttribute('aria-label', `Відкрити промо: ${bookingActivityPromoTitle(p)}`);
                promoButton.textContent = 'Промо';
                promoButton.addEventListener('click', event => openBookingActivityPromo(p, event));
                shell.appendChild(promoButton);
            }
            grid.appendChild(shell);
        });
        container.appendChild(grid);
    });
    updateSelectedProgramCards();

    // v5.49: Bind search input with debounce
    const searchInput = document.getElementById('programSearch');
    if (searchInput) {
        searchInput.removeEventListener('input', searchInput._debouncedFilter);
        searchInput._debouncedFilter = debounce(filterPrograms, 150);
        searchInput.addEventListener('input', searchInput._debouncedFilter);
    }
}

function filterPrograms() {
    const query = (document.getElementById('programSearch')?.value || '').toLowerCase().trim();
    const selectedCategory = BookingDrawerState.selectedProgramCategory || 'all';
    const categoryFilter = PROGRAM_CATEGORY_FILTERS.find(item => item.id === selectedCategory);
    const icons = document.querySelectorAll('#programsIcons .program-icon');
    const headers = document.querySelectorAll('#programsIcons .category-header');
    const grids = document.querySelectorAll('#programsIcons .category-grid');

    icons.forEach(icon => {
        const match = !query || icon.dataset.search.includes(query);
        const categoryMatch = !categoryFilter || categoryFilter.id === 'all'
            || categoryFilter.categories.includes(icon.dataset.category || '');
        const visible = match && categoryMatch;
        const shell = icon.closest('.program-card-shell');
        if (shell) shell.style.display = visible ? '' : 'none';
        else icon.style.display = visible ? '' : 'none';
    });

    // Hide empty categories
    grids.forEach(grid => {
        const cat = grid.dataset.category;
        const visibleCount = Array.from(grid.querySelectorAll('.program-icon'))
            .filter(icon => icon.style.display !== 'none' && icon.closest('.program-card-shell')?.style.display !== 'none')
            .length;
        const hidden = visibleCount === 0;
        grid.style.display = hidden ? 'none' : '';
        const header = document.querySelector(`.category-header[data-category="${cat}"]`);
        if (header) header.style.display = hidden ? 'none' : '';
    });
}

function selectProgram(programId) {
    let program = findBookingProductById(programId);
    if (!program) return;
    if (!getBookingWorkspaceHasEvent()) setBookingWorkspaceHasEvent(true, { markDirty: true });

    if (bookingMultiActivityEnabled()) {
        const id = String(program.id);
        const currentIds = getSelectedActivityProgramIds();
        const nextIds = currentIds.includes(id)
            ? currentIds.filter(item => item !== id)
            : [...currentIds, id];
        setSelectedActivityPrograms(nextIds, { renderSummary: false, renderPackage: false, markDirty: true });
        program = getSelectedActivityPrograms()[0] || null;
    } else {
        setSelectedActivityPrograms([String(program.id)], { renderSummary: false, renderPackage: false, markDirty: true });
    }
    if (!program) {
        renderSelectedProgramSummary(null);
        syncPrimaryProgramDependentFields(null);
        document.getElementById('hostsWarning')?.classList.add('hidden');
        document.getElementById('secondAnimatorSection')?.classList.add('hidden');
        renderBookingPackageSummary();
        return;
    }

    renderSelectedProgramSummary(program);
    syncPrimaryProgramDependentFields(program);
    if (isRoomFirstTimelineView()) {
        populatePrimaryAnimatorSelect().catch(() => {});
        syncBookingWorkspaceMode({ markDirty: true });
    }

    if (program.hosts > 1) {
        document.getElementById('hostsWarning')?.classList.remove('hidden');
        document.getElementById('secondAnimatorSection')?.classList.remove('hidden');
        populateSecondAnimatorSelect();
    } else {
        document.getElementById('hostsWarning')?.classList.add('hidden');
        document.getElementById('secondAnimatorSection')?.classList.add('hidden');
    }

    const banquetFields = document.getElementById('banquetFields');
    if (banquetFields) {
        const showKitchenFields = isBookingKitchenEnabled() && timelineKitchenEnabled();
        banquetFields.classList.toggle('hidden', !showKitchenFields);
        banquetFields.hidden = !showKitchenFields;
    }
    filterPrograms();

    // К-кість дітей для МК (perChild)
    const kidsCountSection = document.getElementById('kidsCountSection');
    if (kidsCountSection) {
        const kidsLabel = kidsCountSection.querySelector('label');
        if (kidsLabel) kidsLabel.textContent = isEducationTimelineBookingMode() ? 'Кількість учнів' : 'Кількість дітей';
        const childrenCountSource = resolveBookingChildrenCountSource({ program });
        if (shouldShowStandaloneKidsCountInput(program, { standaloneEditable: program.perChild || isEducationTimelineBookingMode() })) {
            kidsCountSection.classList.remove('hidden');
            const kidsInput = document.getElementById('kidsCountInput');
            if (kidsInput) {
                kidsInput.value = childrenCountSource.source === 'legacyBanquetGuests' && childrenCountSource.value
                    ? String(childrenCountSource.value)
                    : '';
                kidsInput.placeholder = isEducationTimelineBookingMode() ? 'Кількість учнів' : '';
                kidsInput.oninput = () => {
                    renderSelectedProgramSummary(program);
                    renderBookingPackageSummary();
                };
            }
        } else {
            kidsCountSection.classList.add('hidden');
            const kidsInput = document.getElementById('kidsCountInput');
            if (kidsInput && isBookingKitchenEnabled()) kidsInput.value = '';
        }
    }

    // v8.3.1: T-shirt sizes section
    const tshirtSection = document.getElementById('tshirtSizesSection');
    if (tshirtSection) {
        if (programId === 'mk_tshirt') {
            tshirtSection.classList.remove('hidden');
            ['XS', 'S', 'M', 'L', 'XL'].forEach(s => {
                const inp = document.getElementById('tshirt' + s);
                if (inp) inp.value = '0';
            });
        } else {
            tshirtSection.classList.add('hidden');
        }
    }

    // v20.7.0: Show age recommendations
    showAgeRecommendations();
    refreshAnimatorSelectsForCurrentSlot().catch(() => {});
    renderBookingMenuProductOptions();
    renderBookingPackageSummary();
}

// v20.7.0: Age-based program recommendations
const AGE_RECOMMENDATIONS = {
    '3-5':  ['Ельза', 'Поні', 'Міньйон'],
    '6-8':  ['Minecraft', 'Monster High', 'Ніндзя'],
    '9-12': ['Squid Game', 'Марвел', 'Рок'],
    '12+':  ['Мафія', 'Рок', 'Марвел'],
};

function showAgeRecommendations() {
    const section = document.getElementById('ageRecommendationsSection');
    if (!section) return;

    const birthdayInput = document.getElementById('customerChildBirthday');
    const birthday = birthdayInput ? birthdayInput.value : null;
    if (!birthday) { section.classList.add('hidden'); return; }

    const age = Math.floor((Date.now() - new Date(birthday).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    if (age < 1 || age > 18) { section.classList.add('hidden'); return; }

    let bracket = null;
    if (age >= 3 && age <= 5) bracket = '3-5';
    else if (age >= 6 && age <= 8) bracket = '6-8';
    else if (age >= 9 && age <= 12) bracket = '9-12';
    else if (age > 12) bracket = '12+';
    if (!bracket) { section.classList.add('hidden'); return; }

    const recs = AGE_RECOMMENDATIONS[bracket];
    const products = typeof getProductsSync === 'function' ? getProductsSync() : [];
    const matching = products.filter(p => recs.some(r => (p.label || p.name || '').toLowerCase().includes(r.toLowerCase())));

    document.getElementById('ageRecoText').textContent = `Вік: ${age} р. → Рекомендовані:`;
    const container = document.getElementById('ageRecoPrograms');
    container.innerHTML = matching.length
        ? matching.map(p => `<button type="button" class="age-reco-btn" onclick="selectProgram(${typeof p.id === 'number' ? p.id : "'" + p.id + "'"})">
            ${_escB(p.icon) || '🎯'} ${_escB(p.label || p.name)}
          </button>`).join('')
        : recs.map(r => `<span class="age-reco-tag">${r}</span>`).join('');

    section.classList.remove('hidden');
}

function initAgeRecoListener() {
    const birthdayInput = document.getElementById('customerChildBirthday');
    if (birthdayInput) {
        birthdayInput.addEventListener('change', showAgeRecommendations);
    }
}

// v20.7.0: Sales scripts quick-access in booking modal
let _cachedScripts = null;

async function initScriptsQuickAccess() {
    const container = document.getElementById('scriptsQuickAccess');
    if (!container) return;
    try {
        const token = localStorage.getItem('pzp_token');
        const resp = await fetch('/api/scripts', { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await resp.json();
        if (!data.success || !data.grouped) return;
        _cachedScripts = data.grouped;
        const categories = Object.keys(data.grouped);
        if (!categories.length) return;

        const tabs = document.getElementById('scriptsTabs');
        tabs.innerHTML = categories.map((cat, i) =>
            `<button type="button" class="scripts-tab-btn${i === 0 ? ' active' : ''}" data-cat="${_escB(cat)}">${_escB(cat)}</button>`
        ).join('');

        tabs.addEventListener('click', (e) => {
            const btn = e.target.closest('.scripts-tab-btn');
            if (!btn) return;
            tabs.querySelectorAll('.scripts-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderScriptCategory(btn.dataset.cat);
        });

        renderScriptCategory(categories[0]);
        container.classList.remove('hidden');
    } catch { /* silent */ }
}

function renderScriptCategory(category) {
    const content = document.getElementById('scriptsContent');
    if (!content || !_cachedScripts || !_cachedScripts[category]) return;
    const scripts = _cachedScripts[category];
    content.innerHTML = scripts.map(s => `
        <div style="margin-bottom:8px">
            ${s.trigger_phrase ? `<div class="scripts-trigger">${_escB(s.trigger_phrase)}</div>` : ''}
            <div style="font-size:12px;line-height:1.5">${_escB(s.response_text)}</div>
            <button type="button" class="scripts-copy-btn" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent.trim());this.textContent='Скопійовано ✓';setTimeout(()=>this.textContent='Копіювати',1500)">Копіювати</button>
        </div>
    `).join('<hr style="border:none;border-top:1px solid var(--gray-200);margin:6px 0">');
    content.classList.add('visible');
}

async function getAnimatorLinesForBookingDate(options = {}) {
    const dateStr = formatDate(AppState.selectedDate);
    if (isRoomFirstTimelineView() || options.forceAnimatorView) {
        const lines = await apiGetLines(dateStr, { timelineView: 'animators', fresh: options.fresh !== false });
        return Array.isArray(lines) ? lines : [];
    }
    return await getLinesForDate(AppState.selectedDate);
}

async function populateAnimatorSelectById(selectId, placeholder, options = {}) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const lines = await getAnimatorLinesForBookingDate();
    const currentLineId = document.getElementById('bookingLine')?.value;
    const currentValue = select.value;
    const candidates = await buildAnimatorLineCandidates(lines, currentLineId);
    const filteredCandidates = await filterAnimatorLineCandidatesForOpenSlot(candidates, {
        selectedName: currentValue,
        selectId,
        time: options.time,
        duration: options.duration
    });

    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;

    filteredCandidates.forEach(line => {
        const option = document.createElement('option');
        option.value = line.name;
        option.textContent = line.label || line.name;
        option.dataset.lineId = line.id;
        option.dataset.lineName = line.name;
        option.dataset.source = line.source || 'timeline_line';
        select.appendChild(option);
    });
    if (currentValue) select.value = currentValue;
}

async function buildAnimatorLineCandidates(lines = [], currentLineId = '') {
    const normalizedCurrentLineId = String(currentLineId || '').trim();
    const currentLine = (lines || []).find(line => String(line.id) === normalizedCurrentLineId);
    const currentName = String(currentLine?.name || '').trim().toLowerCase();
    const byKey = new Map();

    function addCandidate(candidate) {
        const id = String(candidate?.id || candidate?.lineId || candidate?.staffId || '').trim();
        const name = String(candidate?.name || '').trim();
        if (!id || !name) return;
        if (id === normalizedCurrentLineId) return;
        if (currentName && name.toLowerCase() === currentName) return;
        const key = name.toLowerCase();
        if (!byKey.has(key)) byKey.set(key, { ...candidate, id, name });
    }

    (lines || []).forEach(line => addCandidate({
        id: line.id,
        name: line.name,
        color: line.color,
        source: line.source || 'timeline_line'
    }));

    return Array.from(byKey.values()).sort((a, b) => String(a.name).localeCompare(String(b.name), 'uk'));
}

function getAnimatorPickerDuration() {
    const selectedProgramId = document.getElementById('selectedProgram')?.value || '';
    const selectedProgram = selectedProgramId ? getProductsSync().find(p => p.id === selectedProgramId) : null;
    const selectedDuration = Number(selectedProgram?.duration || 0);
    if (selectedDuration > 0) return selectedDuration;
    const customDuration = parseInt(document.getElementById('customDuration')?.value || '', 10);
    return Number.isFinite(customDuration) && customDuration > 0 ? customDuration : 0;
}

function findEditingLinkedBookingIdForLine(bookings = [], lineId) {
    if (!AppState.editingBookingId || !lineId) return null;
    return bookings.find(item =>
        String(item.linkedTo || '') === String(AppState.editingBookingId)
        && String(item.lineId || '') === String(lineId)
    )?.id || null;
}

async function filterAnimatorLineCandidatesForOpenSlot(candidates = [], options = {}) {
    const time = normalizeSelectedActivityScheduleTime(options.time) || document.getElementById('bookingTime')?.value || '';
    const optionDuration = Number(options.duration || 0) || 0;
    const duration = optionDuration > 0 ? optionDuration : getAnimatorPickerDuration();
    if (!time || !duration) return Array.isArray(candidates) ? candidates : [];
    const selectedName = String(options.selectedName || '').trim();
    const bookings = AppState.editingBookingId ? await getBookingsForDate(AppState.selectedDate) : [];
    const filtered = [];

    for (const candidate of (candidates || [])) {
        const preserveSelected = selectedName && String(candidate?.name || '') === selectedName;
        const excludeId = preserveSelected ? findEditingLinkedBookingIdForLine(bookings, candidate.id) : null;
        const conflict = await checkConflicts(candidate.id, time, duration, excludeId);
        if (!conflict.overlap || preserveSelected) filtered.push(candidate);
    }

    return filtered;
}

function selectedAnimatorLineCandidate(selectId, selectedName) {
    const select = document.getElementById(selectId);
    const option = select?.selectedOptions?.[0];
    if (!option || !option.value || option.value !== selectedName) return null;
    return {
        id: option.dataset.lineId || option.value,
        name: option.dataset.lineName || option.value,
        source: option.dataset.source || 'select'
    };
}

function selectedSecondAnimatorLineCandidate(secondAnimator) {
    return secondAnimator
        ? selectedAnimatorLineCandidate('secondAnimatorSelect', secondAnimator)
        : null;
}

async function refreshAnimatorSelectsForCurrentSlot() {
    const secondSectionVisible = !document.getElementById('secondAnimatorSection')?.classList.contains('hidden');
    const extraHostVisible = !!document.getElementById('extraHostToggle')?.checked;
    if (secondSectionVisible) await populateSecondAnimatorSelect();
    if (extraHostVisible) await populateExtraHostAnimatorSelect();
}

async function populateSecondAnimatorSelect() {
    await populateAnimatorSelectById('secondAnimatorSelect', 'Оберіть другого аніматора');
}

async function populateExtraHostAnimatorSelect() {
    await populateAnimatorSelectById('extraHostAnimatorSelect', 'Оберіть аніматора');
}

async function populatePrimaryAnimatorSelect() {
    await populateAnimatorSelectById('bookingPrimaryAnimatorSelect', 'Оберіть аніматора');
}

// v7.9.3: Resolve secondAnimator name when line was renamed
// If the stored name doesn't match any current line, tries to find via linked booking
async function resolveSecondAnimatorSelect(storedName, bookingId) {
    const select = document.getElementById('secondAnimatorSelect');
    if (!select) return;
    select.value = storedName;
    // If the stored name matches an option, we're done
    if (select.value === storedName) return;

    // Name doesn't match — try to resolve via linked booking's line_id
    if (bookingId) {
        const bookings = await getBookingsForDate(AppState.selectedDate);
        const mainBooking = bookings.find(b => b.id === bookingId);
        if (mainBooking) {
            const linked = bookings.find(b => b.linkedTo === bookingId && b.lineId !== mainBooking.lineId);
            if (linked) {
                const lines = await getLinesForDate(AppState.selectedDate);
                const resolvedLine = lines.find(l => l.id === linked.lineId);
                if (resolvedLine) {
                    select.value = resolvedLine.name;
                    if (select.value === resolvedLine.name) return;
                }
            }
        }
    }
    // Couldn't resolve — show warning
    showNotification(`⚠️ Другий аніматор "${storedName}" не знайдений (лінію перейменовано?)`, 'warning');
}

function updateCustomDuration() {
    renderSelectedProgramSummary();
    renderBookingPackageSummary();
}

// ==========================================
// СТВОРЕННЯ БРОНЮВАННЯ
// ==========================================

function normalizeBookingDateKey(value) {
    if (!value) return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDate(value);
    const raw = String(value);
    const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? raw : formatDate(parsed);
}

function findBookingProductById(programId) {
    const id = String(programId || '');
    if (!id) return null;
    return getProductsSync().find(p => String(p.id) === id) || null;
}

function getSelectedProgramIdFromUi() {
    const selectedProgram = document.getElementById('selectedProgram')?.value || '';
    if (selectedProgram) return String(selectedProgram);
    const selectedCard = document.querySelector('#programsIcons .program-icon.selected[data-program-id]');
    return selectedCard?.dataset?.programId ? String(selectedCard.dataset.programId) : '';
}

function getBookingFormData() {
    const maysternyaMode = isMaysternyaBookingContext();
    const presentation = getTimelineBookingPresentation();
    const selectedProgramId = getSelectedProgramIdFromUi();
    const roomFirst = isRoomFirstTimelineView();
    const hasEvent = roomFirst ? false : true;
    const kitchenEnabled = roomFirst && timelineKitchenEnabled();
    const leadDetailsEnabled = false;
    const programId = hasEvent ? selectedProgramId : '';
    const room = document.getElementById('roomSelect')?.value || '';
    const effectiveRoom = room || defaultTimelineBookingRoom(presentation);
    const program = programId ? findBookingProductById(programId) : null;
    const time = document.getElementById('bookingTime')?.value;
    const lineId = roomFirst ? ROOM_FIRST_BANQUET_SERVICE_LINE_ID : document.getElementById('bookingLine')?.value;
    const line = roomFirst
        ? {
            id: lineId,
            resourceId: lineId,
            resourceType: 'service',
            name: 'Банкет / кімната',
            source: 'banquet_service'
        }
        : getBookingLineSnapshot(lineId);

    let duration = program ? program.duration : 0;
    let label = program ? program.label : '';
    if (roomFirst && !program) {
        duration = parseInt(document.getElementById('customDuration')?.value, 10) || 60;
        label = 'Банкет';
    }
    if (isEducationTimelineBookingMode() && !program) {
        duration = parseInt(document.getElementById('customDuration')?.value, 10) || 60;
        label = document.getElementById('educationLessonTitle')?.value?.trim() || 'Заняття';
    }

    if (program && program.isCustom) {
        duration = parseInt(document.getElementById('customDuration')?.value) || 30;
        const customName = document.getElementById('customName')?.value || 'Інше';
        label = `${customName}(${duration})`;
    }

    let pinataMode = 'none';
    let pinataFiller = '';
    let pinataNumber = null;
    let pinataFillerNumber = null;
    let clientPinataServicePrice = null;
    let clientPinataServiceNote = null;
    if (program && isPinataProgram(program) && useSelectedActivityPinataSubflow()) {
        const activityPinata = selectedActivityPinataDraft(program);
        pinataMode = activityPinata.pinataMode;
        pinataNumber = activityPinata.pinataNumber;
        pinataFillerNumber = activityPinata.pinataFillerNumber;
        pinataFiller = activityPinata.pinataFiller || '';
        clientPinataServicePrice = activityPinata.clientPinataServicePrice;
        clientPinataServiceNote = activityPinata.clientPinataServiceNote;
        label = selectedActivityPinataLabel(program, label);
    } else if (program && isPinataProgram(program)) {
        pinataMode = getPinataModeValue();
        const selectedPinataFiller = document.getElementById('pinataFillerSelect')?.value || '';
        const clientOwnedFiller = pinataMode === 'park' && isClientPinataFillerChoice(selectedPinataFiller);
        pinataNumber = pinataMode !== 'none'
            ? (document.getElementById('pinataNumber')?.value?.trim() || null)
            : null;
        pinataFillerNumber = pinataMode !== 'none'
            ? (clientOwnedFiller ? CLIENT_PINATA_FILLER_VALUE : (document.getElementById('pinataFillerNumber')?.value?.trim() || null))
            : null;
        if (program.hasFiller && pinataMode === 'park') {
            pinataFiller = selectedPinataFiller;
            if (clientOwnedFiller) {
                label = 'Пін+свій';
            } else if (pinataFiller) {
                label = `Пін+${pinataFiller}`;
            }
        } else if (pinataMode === 'client') {
            clientPinataServicePrice = document.getElementById('clientPinataServicePrice')?.value || null;
            clientPinataServiceNote = document.getElementById('clientPinataServiceNote')?.value?.trim() || null;
            label = 'Клієнтська піньята';
        }
    }

    const secondAnimatorSectionVisible = !document.getElementById('secondAnimatorSection')?.classList.contains('hidden');
    const secondAnimator = program && (program.hosts > 1 || secondAnimatorSectionVisible)
        ? document.getElementById('secondAnimatorSelect')?.value : null;
    const secondAnimatorCandidate = selectedSecondAnimatorLineCandidate(secondAnimator);

    const packageTotals = getBookingPackageTotals(program);
    const menuPositions = kitchenEnabled ? packageTotals.menuPositions : [];
    const serviceEvents = kitchenEnabled ? packageTotals.serviceEvents : [];
    const childrenCountSource = resolveBookingChildrenCountSource({
        program,
        kitchenEnabled,
        standaloneEditable: hasEvent && bookingProgramUsesStandaloneChildrenInput(program)
    });
    const leadDetails = leadDetailsEnabled ? getBookingLeadDetails() : {};
    const scenario = getBookingWorkspaceScenario({ hasEvent, positions: menuPositions, hasKitchen: kitchenEnabled });
    const commentType = bookingCommentTypeForFormData({ hasEvent, kitchenEnabled, scenario });
    const bookingComment = document.getElementById('bookingNotes')?.value || '';
    const baseFormData = {
        hasEvent, kitchenEnabled, leadDetailsEnabled, scenario, leadDetails,
        programId, room: effectiveRoom, program, time, lineId, lineName: line?.name || '', lineSource: line?.source || '', lineResourceType: line?.resourceType || '', duration, label,
        activityPrograms: hasEvent ? (packageTotals.activityPrograms || (program ? [program] : [])) : [],
        maysternyaMode,
        pinataMode, pinataNumber, pinataFillerNumber, pinataFiller, clientPinataServicePrice, clientPinataServiceNote,
        secondAnimator,
        secondAnimatorLineId: secondAnimatorCandidate?.id || null,
        secondAnimatorLineName: secondAnimatorCandidate?.name || secondAnimator || null,
        menuPositions,
        serviceEvents,
        commentType,
        bookingComments: buildBookingWorkspaceComments(commentType, bookingComment),
        programBasePrice: packageTotals.programBasePrice,
        positionsSubtotal: kitchenEnabled ? packageTotals.positionsSubtotal : 0,
        entryCharge: kitchenEnabled ? packageTotals.entryCharge : null,
        entrySubtotal: kitchenEnabled ? (packageTotals.entrySubtotal || 0) : 0,
        bookingPackageWarnings: kitchenEnabled ? (packageTotals.warnings || []) : [],
        finalTotal: kitchenEnabled ? packageTotals.finalTotal : packageTotals.programBasePrice,
        childrenCountSource,
        kidsCount: childrenCountSource.value || null,
        kitchenChildrenCount: kitchenEnabled ? (childrenCountSource.kitchenValue || null) : null,
        deposit: kitchenEnabled ? getBookingDepositFormData() : null
    };
    baseFormData.educationLesson = getEducationLessonDetails(baseFormData);

    return baseFormData;
}

async function validateBookingConflicts(lineId, time, duration, program, secondAnimator, excludeId = null) {
    invalidateBookingTimelineDateCache(AppState.selectedDate, { lines: false });
    const conflict = await checkConflicts(lineId, time, duration, excludeId);

    if (conflict.overlap) {
        // v43.5.0: Show details + reveal hidden block instead of generic message
        const cw = conflict.conflictWith;
        const detail = cw ? ` (${cw.label || cw.programCode || 'бронювання'} о ${cw.time})` : '';
        showNotification(`❌ Час зайнятий${detail}`, 'error');
        if (cw && cw.id) revealHiddenBooking(cw.id);
        return false;
    }

    if (secondAnimator) {
        const lines = await getAnimatorLinesForBookingDate();
        const secondCandidate = selectedAnimatorLineCandidate('secondAnimatorSelect', secondAnimator);
        const secondLine = lines.find(l => l.name === secondAnimator)
            || lines.find(l => String(l.id) === String(secondCandidate?.id || ''))
            || secondCandidate;
        if (secondLine) {
            // v5.5: При редагуванні виключити linked бронювання цього ж запису
            const allBookings = excludeId ? await getBookingsForDate(AppState.selectedDate) : [];
            const linkedId = Array.isArray(excludeId)
                ? excludeId
                : (allBookings.find(b => String(b.linkedTo || '') === String(excludeId || '') && b.lineId === secondLine.id)?.id || null);
            const secondConflict = await checkConflicts(secondLine.id, time, duration, linkedId);
            if (secondConflict.overlap) {
                const cw2 = secondConflict.conflictWith;
                const detail2 = cw2 ? ` (${cw2.label || cw2.programCode || 'бронювання'} о ${cw2.time})` : '';
                showNotification(`❌ Час зайнятий у ${secondAnimator}${detail2}`, 'error');
                if (cw2 && cw2.id) revealHiddenBooking(cw2.id);
                return false;
            }
        }
    }

    if (conflict.noPause && (!program || program.category !== 'pinata')) {
        showWarning('⚠️ УВАГА! Немає 15-хвилинної паузи між програмами. Це ДУЖЕ НЕБАЖАНО!');
    }

    return true;
}

function normalizeBookingIdentity(value) {
    return value === null || value === undefined ? '' : String(value);
}

function collectDuplicateProgramExclusionIds(bookings, excludeId = null) {
    const excludedIds = new Set();
    const list = Array.isArray(bookings) ? bookings : [];
    const targetIds = (Array.isArray(excludeId) ? excludeId : [excludeId])
        .map(normalizeBookingIdentity)
        .filter(Boolean);
    if (!targetIds.length) return excludedIds;
    const rootIds = new Set();
    targetIds.forEach(targetId => {
        const target = list.find(b => normalizeBookingIdentity(b.id) === targetId);
        const rootId = normalizeBookingIdentity(target?.linkedTo) || targetId;
        excludedIds.add(targetId);
        if (rootId) {
            rootIds.add(rootId);
            excludedIds.add(rootId);
        }
    });

    for (const booking of list) {
        const bookingId = normalizeBookingIdentity(booking?.id);
        if (!bookingId) continue;
        const linkedTo = normalizeBookingIdentity(booking?.linkedTo);
        if (excludedIds.has(bookingId) || excludedIds.has(linkedTo) || rootIds.has(linkedTo)) {
            excludedIds.add(bookingId);
        }
    }

    return excludedIds;
}

function isDuplicateProgramRelevantEdit(bookings, excludeId, programId, time, duration) {
    if (Array.isArray(excludeId)) return true;
    const targetId = normalizeBookingIdentity(excludeId);
    if (!targetId) return true;
    const list = Array.isArray(bookings) ? bookings : [];
    const target = list.find(b => normalizeBookingIdentity(b.id) === targetId);
    if (!target) return true;
    return normalizeBookingIdentity(target.programId) !== normalizeBookingIdentity(programId)
        || normalizeBookingIdentity(target.time) !== normalizeBookingIdentity(time)
        || Number(target.duration || 0) !== Number(duration || 0);
}

async function checkDuplicateProgram(programId, program, time, duration, excludeId = null) {
    if (!programId || !program) return true;
    // v43.10.0: skip duplicate check for animation extras AND custom "Інше" programs.
    // Two custom bookings (e.g. аквагрим + фотозона) share programId='custom' but
    // are conceptually different — must not block each other.
    if (program.category === 'animation' || program.category === 'custom' || program.isCustom || programId === 'anim_extra' || programId === 'custom') return true;

    const allBookings = await getBookingsForDate(AppState.selectedDate);
    if (!isDuplicateProgramRelevantEdit(allBookings, excludeId, programId, time, duration)) return true;
    const excludedBookingIds = collectDuplicateProgramExclusionIds(allBookings, excludeId);
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;

    const duplicate = allBookings.find(b => {
        if (excludedBookingIds.has(normalizeBookingIdentity(b.id))) return false;
        if (normalizeBookingIdentity(b.programId) !== normalizeBookingIdentity(programId)) return false;
        const start = timeToMinutes(b.time);
        const end = start + b.duration;
        return newStart < end && newEnd > start;
    });

    if (duplicate) {
        showNotification(`❌ ${program.name} вже є о ${duplicate.time}`, 'error');
        if (duplicate.id) revealHiddenBooking(duplicate.id);
        return false;
    }
    return true;
}

let _selectedActivityConflictTimer = null;

function selectedActivityScheduleRange(row = {}) {
    return bookingActivityScheduleApi().selectedActivityScheduleRange(row);
}

function selectedActivityScheduleOverlaps(first = {}, second = {}) {
    return bookingActivityScheduleApi().selectedActivityScheduleOverlaps(first, second);
}

function normalizeScheduleBooking(booking = {}) {
    return {
        id: booking.id || booking.bookingId || booking.booking_id || null,
        status: booking.status || '',
        date: String(booking.date || booking.bookingDate || booking.booking_date || '').slice(0, 10),
        time: normalizeSelectedActivityScheduleTime(booking.time || ''),
        duration: Number(booking.duration || 0) || 0,
        lineId: booking.lineId || booking.line_id || null,
        room: String(booking.room || '').trim(),
        programId: booking.programId || booking.program_id || null,
        programCode: booking.programCode || booking.program_code || null,
        programName: booking.programName || booking.program_name || null,
        label: booking.label || null,
        linkedTo: booking.linkedTo || booking.linked_to || null
    };
}

function scheduleBookingLabel(booking = {}) {
    return booking.label || booking.programName || booking.programCode || booking.id || 'бронювання';
}

function selectedActivityDuplicateCheckEnabled(programId, program = {}) {
    if (!programId || !program) return false;
    return !(program.category === 'animation'
        || program.category === 'custom'
        || program.isCustom
        || programId === 'anim_extra'
        || programId === 'custom');
}

function existingScheduleBookingsForValidation(bookings = [], excludeId = null) {
    const excludedIds = collectDuplicateProgramExclusionIds(bookings, excludeId);
    return (bookings || [])
        .map(normalizeScheduleBooking)
        .filter(booking => {
            if (!booking.id || excludedIds.has(normalizeBookingIdentity(booking.id))) return false;
            if (String(booking.status || '').toLowerCase() === 'cancelled') return false;
            return Boolean(booking.time && booking.duration > 0);
        });
}

async function validateSelectedActivitySchedule(formData = {}, options = {}) {
    const programs = Array.isArray(formData.activityPrograms)
        ? formData.activityPrograms.filter(Boolean)
        : getSelectedActivityPrograms();
    if (!bookingMultiActivityEnabled() || programs.length <= 1) {
        setSelectedActivityScheduleIssues({});
        clearSelectedActivityPreflightState();
        return { valid: true, issues: [] };
    }

    const rows = getSelectedActivityScheduleRows(programs);
    const issueMap = {};
    const lineId = formData.lineId || document.getElementById('bookingLine')?.value || '';
    const room = String(formData.room || document.getElementById('roomSelect')?.value || '').trim();
    const date = normalizeBookingDateKey(AppState.selectedDate);
    const allBookings = await getBookingsForDate(AppState.selectedDate, { force: options.force !== false });
    clearSelectedActivityPreflightState();
    const existingBookings = existingScheduleBookingsForValidation(allBookings, options.excludeId || null);
    const workday = selectedActivityScheduleWorkday();

    rows.forEach(row => {
        if (!row.time) {
            addSelectedActivityScheduleIssue(issueMap, row.programId, 'Вкажіть час старту.');
            return;
        }
        if (!isSelectedActivityScheduleSlotTime(row.time, row)) {
            addSelectedActivityScheduleIssue(issueMap, row.programId, `Старт має бути в робочих годинах ${workday.start}-${workday.end} з кроком 15 хв.`);
        }
        if (row.duration <= 0) {
            addSelectedActivityScheduleIssue(issueMap, row.programId, 'Некоректна тривалість.');
        }
        if (Number.isFinite(row.endMinutes) && row.endMinutes > workday.endMinutes) {
            addSelectedActivityScheduleIssue(issueMap, row.programId, `Активність виходить за межі робочого дня (${workday.end}).`);
        }
        if (row.endMinutes > 1440) {
            addSelectedActivityScheduleIssue(issueMap, row.programId, 'Активність виходить за межі дня.');
        }
        if (selectedActivityRequiresSecondAnimator(row.program) && !selectedActivitySecondAnimatorDraft(row.program).secondAnimator) {
            addSelectedActivityScheduleIssue(issueMap, row.programId, 'Оберіть другого ведучого.');
        }
    });

    for (let i = 0; i < rows.length; i += 1) {
        for (let j = i + 1; j < rows.length; j += 1) {
            if (!selectedActivityScheduleOverlaps(rows[i], rows[j])) continue;
            const firstLabel = rows[i].program?.code || rows[i].program?.name || `#${i + 1}`;
            const secondLabel = rows[j].program?.code || rows[j].program?.name || `#${j + 1}`;
            addSelectedActivityScheduleIssue(issueMap, rows[i].programId, `Перетин з ${secondLabel}.`);
            addSelectedActivityScheduleIssue(issueMap, rows[j].programId, `Перетин з ${firstLabel}.`);
            if (normalizeBookingIdentity(rows[i].programId) === normalizeBookingIdentity(rows[j].programId)
                && selectedActivityDuplicateCheckEnabled(rows[i].programId, rows[i].program)) {
                addSelectedActivityScheduleIssue(issueMap, rows[i].programId, 'Дубль програми в обраному наборі.');
                addSelectedActivityScheduleIssue(issueMap, rows[j].programId, 'Дубль програми в обраному наборі.');
            }
        }
    }

    rows.forEach(row => {
        if (!row.time || row.duration <= 0) return;
        const persistedFields = getSelectedActivityBookingFields()[String(row.programId)] || {};
        const candidate = {
            id: `draft-${row.programId}`,
            date,
            time: row.time,
            duration: row.duration,
            lineId: persistedFields.lineId || lineId,
            room,
            programId: row.programId,
            programCode: row.program?.code || null,
            programName: row.program?.name || null
        };
        const lineConflict = existingBookings.find(booking =>
            normalizeBookingIdentity(booking.lineId) === normalizeBookingIdentity(candidate.lineId)
            && selectedActivityScheduleOverlaps(candidate, booking)
        );
        if (lineConflict) {
            addSelectedActivityScheduleIssue(issueMap, row.programId, `Ведучий зайнятий: ${scheduleBookingLabel(lineConflict)} о ${lineConflict.time}.`, {
                conflictBookingId: lineConflict.id
            });
        }

        if (selectedActivityRequiresSecondAnimator(row.program)) {
            const secondDraft = selectedActivitySecondAnimatorDraft(row.program);
            if (secondDraft.secondAnimatorLineId) {
                if (normalizeBookingIdentity(secondDraft.secondAnimatorLineId) === normalizeBookingIdentity(candidate.lineId)) {
                    addSelectedActivityScheduleIssue(issueMap, row.programId, 'Другий ведучий збігається з основним ведучим.');
                }
                const secondLineConflict = existingBookings.find(booking =>
                    normalizeBookingIdentity(booking.lineId) === normalizeBookingIdentity(secondDraft.secondAnimatorLineId)
                    && selectedActivityScheduleOverlaps(candidate, booking)
                );
                if (secondLineConflict) {
                    addSelectedActivityScheduleIssue(issueMap, row.programId, `Другий ведучий зайнятий: ${scheduleBookingLabel(secondLineConflict)} о ${secondLineConflict.time}.`, {
                        conflictBookingId: secondLineConflict.id
                    });
                }
            }
        }

        const roomConflict = room && isOperationalBookingRoomValue(room)
            ? existingBookings.find(booking =>
                normalizeBookingIdentity(booking.room) === normalizeBookingIdentity(room)
                && selectedActivityScheduleOverlaps(candidate, booking)
            )
            : null;
        if (roomConflict) {
            addSelectedActivityScheduleIssue(issueMap, row.programId, `Кімната зайнята: ${scheduleBookingLabel(roomConflict)} о ${roomConflict.time}.`, {
                conflictBookingId: roomConflict.id
            });
        }

        if (selectedActivityDuplicateCheckEnabled(row.programId, row.program)) {
            const duplicate = existingBookings.find(booking =>
                normalizeBookingIdentity(booking.programId) === normalizeBookingIdentity(row.programId)
                && selectedActivityScheduleOverlaps(candidate, booking)
            );
            if (duplicate) {
                addSelectedActivityScheduleIssue(issueMap, row.programId, `Дубль програми: ${scheduleBookingLabel(duplicate)} о ${duplicate.time}.`, {
                    conflictBookingId: duplicate.id
                });
            }
        }
    });

    setSelectedActivityScheduleIssues(issueMap);
    if (options.render !== false) renderSelectedProgramSummary();
    const issues = Object.entries(issueMap).flatMap(([programId, value]) =>
        (value.messages || []).map(message => ({ programId, message, conflictBookingId: value.conflictBookingId || null }))
    );
    return { valid: issues.length === 0, issues };
}

function scheduleSelectedActivityConflictRefresh(delay = 250) {
    clearTimeout(_selectedActivityConflictTimer);
    _selectedActivityConflictTimer = setTimeout(() => {
        const formData = typeof getBookingFormData === 'function' ? getBookingFormData() : {};
        validateSelectedActivitySchedule(formData, {
            render: true,
            force: true,
            excludeId: bookingEditConflictExcludeIds()
        }).catch(err => {
            console.warn('[Booking] Selected activity schedule validation failed', err);
        });
    }, delay);
}

async function validateSelectedActivityScheduleBeforeSubmit(formData = {}, excludeId = null, options = {}) {
    if (selectedActivityPreflightUnavailable() && !options.forceRetry) {
        const state = selectedActivityPreflightState();
        state.overrideUsed = true;
        showNotification('Попередня перевірка слотів недоступна. Продовжую збереження — сервер перевірить конфлікти.', 'warning');
        return true;
    }
    let result;
    try {
        result = await validateSelectedActivitySchedule(formData, { excludeId, render: true, force: true });
    } catch (err) {
        console.warn('[Booking] Selected activity schedule validation unavailable before submit', err);
        setSelectedActivityPreflightUnavailable(err);
        renderSelectedProgramSummary();
        renderBookingPackageSummary();
        updateBookingSubmitState();
        showNotification('Не вдалося виконати попередню перевірку активностей. Спробуйте ще раз або натисніть збереження повторно для серверної перевірки.', 'warning');
        return false;
    }
    if (result.valid) {
        renderBookingPackageSummary();
        updateBookingSubmitState();
        return true;
    }
    clearSelectedActivityPreflightState();
    renderBookingPackageSummary();
    updateBookingSubmitState();
    const first = result.issues[0];
    if (first?.conflictBookingId) revealHiddenBooking(first.conflictBookingId);
    showNotification(first?.message || 'Перевірте часи обраних активностей.', 'error');
    return false;
}

function getBookingWorkspaceIdentityLabel(formData = {}) {
    const customerName = document.getElementById('customerName')?.value?.trim();
    const groupName = document.getElementById('bookingGroupName')?.value?.trim();
    const lead = formData.leadDetails || getBookingLeadDetails();
    const firstPosition = (formData.menuPositions || [])[0];
    return customerName
        || groupName
        || lead.childrenInfo
        || lead.notes
        || firstPosition?.title
        || '';
}

function getNoEventBookingLabel(formData = {}) {
    if (formData.scenario === 'kitchen_only') return 'Кухня';
    if (formData.scenario === 'event_kitchen') return 'Подія+кухня';
    return 'Заявка';
}

function getNoEventProgramName(formData = {}) {
    const identity = getBookingWorkspaceIdentityLabel(formData);
    if (identity) return identity.slice(0, 160);
    if (formData.scenario === 'kitchen_only') return 'Кухонне замовлення';
    return 'Лід / заявка';
}

function buildBookingWorkspaceExtraData(formData = {}) {
    const positions = Array.isArray(formData.menuPositions) ? formData.menuPositions : [];
    const kitchen = {
        itemsCount: positions.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
        menuCount: positions.length,
        cakeCount: positions.filter(item => /торт|cake/i.test(String(item.title || ''))).length,
        serviceEventCount: Array.isArray(formData.serviceEvents) ? formData.serviceEvents.length : 0,
        missingServingTimeCount: bookingMenuMissingServingTimeCount(positions),
        positionsSubtotal: toBookingMoney(formData.positionsSubtotal || 0)
    };
    return {
        schemaVersion: BOOKING_WORKSPACE_SCHEMA_VERSION,
        mode: formData.kitchenEnabled || !formData.hasEvent ? 'room_first_workspace' : (BOOKING_PROGRAM_ONLY_WORKSPACE ? 'event_program_only' : 'workspace'),
        hasEvent: Boolean(formData.hasEvent),
        scenario: formData.scenario || getBookingWorkspaceScenario(formData),
        leadDetails: formData.leadDetails || {},
        comments: normalizeBookingWorkspaceComments(formData.bookingComments || {}),
        kitchen,
        roomFirst: isRoomFirstTimelineView(),
        lesson: formData.educationLesson || null,
        source: 'booking_workspace_v2'
    };
}

function attachActiveBanquetIntentMarker(booking) {
    if (!booking || typeof BookingDrawerState === 'undefined') return booking;
    if (BookingDrawerState.activeBanquetIntent !== 'add_to_existing') return booking;
    if (BookingDrawerState.standaloneBookingOverride) return booking;
    const selectedContext = typeof selectedBookingBanquetGroupContext === 'function'
        ? selectedBookingBanquetGroupContext()
        : null;
    const explicitContext = BookingDrawerState.explicitBanquetContext || {};
    const context = selectedContext || explicitContext || {};
    const groupId = context.groupId || BookingDrawerState.selectedBanquetGroupId || explicitContext.groupId || null;
    const sourceBookingId = context.sourceBookingId || explicitContext.sourceBookingId || explicitContext.primaryBookingId || null;
    const roleIntent = BookingDrawerState.activeBanquetRoleIntent
        || (typeof resolveBookingActiveBanquetRoleIntent === 'function' ? resolveBookingActiveBanquetRoleIntent(context) : null);
    if (!booking.extraData) booking.extraData = {};
    booking.extraData.banquetGroup = {
        ...(booking.extraData.banquetGroup || {}),
        groupId,
        sourceBookingId,
        intent: 'add_to_existing',
        requiresMembership: true,
        roleIntent: roleIntent || null,
        source: booking.extraData.banquetGroup?.source || context.source || 'timeline_empty_cell'
    };
    return booking;
}

function buildBookingObject(formData, program) {
    const isEducationLessonBooking = isEducationTimelineBookingMode() && !!formData.educationLesson;
    const hasCatalogProgram = !!program;
    const hasEvent = !!formData.hasEvent && (hasCatalogProgram || isEducationLessonBooking);
    const costume = hasEvent ? document.getElementById('costumeSelect')?.value : null;
    const statusEl = document.querySelector('input[name="bookingStatus"]:checked');
    const status = statusEl ? statusEl.value : 'confirmed';
    const childrenCountSource = formData.childrenCountSource || resolveBookingChildrenCountSource({
        program,
        kitchenEnabled: formData.kitchenEnabled,
        standaloneEditable: hasEvent && bookingProgramUsesStandaloneChildrenInput(program)
    });
    const kidsCount = childrenCountSource.value || 0;
    const kitchenChildrenCount = formData.kitchenEnabled
        ? (childrenCountSource.kitchenValue || null)
        : null;
    const servicePrice = Number(formData.clientPinataServicePrice || 0);
    const multiActivityPrograms = Array.isArray(formData.activityPrograms) ? formData.activityPrograms.filter(Boolean) : [];
    const isMultiActivityBooking = multiActivityPrograms.length > 1 && bookingMultiActivityEnabled();
    const baseProgramPrice = hasEvent && hasCatalogProgram
        ? (formData.pinataMode === 'client'
            ? servicePrice
            : (formData.pinataMode === 'none' && isPinataProgram(program)
                ? 0
                : (program.perChild && kidsCount > 0 ? program.price * kidsCount : program.price)))
        : 0;
    const finalPrice = isMultiActivityBooking
        ? toBookingMoney(baseProgramPrice)
        : (formData.finalTotal ?? toBookingMoney(baseProgramPrice + (formData.positionsSubtotal || 0)));
    const extraData = buildExtraData(hasCatalogProgram ? formData.programId : null) || {};
    const rawBookingComment = document.getElementById('bookingNotes')?.value || '';
    const shouldPersistLegacyNotes = !isParkTimelineBookingMode()
        || (AppState.editingBookingId && BookingDrawerState.legacyNotesFallback);
    const shouldPersistLegacyGroupName = !isParkTimelineBookingMode()
        || (AppState.editingBookingId && BookingDrawerState.legacyGroupNameFallback);
    const noEventLabel = getNoEventBookingLabel(formData);
    const noEventName = getNoEventProgramName(formData);
    const baseHosts = hasCatalogProgram
        ? Number(program.hosts || 0)
        : (isEducationLessonBooking ? 1 : 0);
    const normalizedHosts = hasEvent && formData.secondAnimator
        ? Math.max(baseHosts, 2)
        : baseHosts;

    const obj = {
        date: formatDate(AppState.selectedDate),
        time: formData.time,
        lineId: formData.lineId,
        lineName: formData.lineName || null,
        programId: hasCatalogProgram ? String(program.id || formData.programId) : null,
        programCode: hasCatalogProgram ? program.code : (isEducationLessonBooking ? 'LESSON' : (formData.scenario === 'kitchen_only' ? 'KITCHEN' : 'LEAD')),
        label: hasEvent ? formData.label : noEventLabel,
        programName: hasCatalogProgram ? (program.isCustom ? (document.getElementById('customName')?.value || 'Інше') : program.name) : (isEducationLessonBooking ? (formData.educationLesson.title || 'Заняття') : noEventName),
        category: hasCatalogProgram ? program.category : (isEducationLessonBooking ? 'education' : 'custom'),
        duration: hasEvent ? formData.duration : (parseInt(formData.duration, 10) || NO_EVENT_TIMELINE_DURATION),
        price: finalPrice,
        hosts: normalizedHosts,
        secondAnimator: hasEvent ? formData.secondAnimator : null,
        secondAnimatorLineId: hasEvent ? (formData.secondAnimatorLineId || null) : null,
        secondAnimatorLineName: hasEvent ? (formData.secondAnimatorLineName || formData.secondAnimator || null) : null,
        pinataMode: hasCatalogProgram ? formData.pinataMode : 'none',
        pinataNumber: hasCatalogProgram && formData.pinataMode !== 'none' ? formData.pinataNumber : null,
        pinataFillerNumber: hasCatalogProgram && formData.pinataMode !== 'none' ? formData.pinataFillerNumber : null,
        pinataFiller: hasCatalogProgram ? formData.pinataFiller : null,
        clientPinataServicePrice: hasCatalogProgram && formData.pinataMode === 'client' ? finalPrice : null,
        clientPinataServiceNote: hasCatalogProgram && formData.pinataMode === 'client' ? formData.clientPinataServiceNote : null,
        costume: costume,
        room: formData.room,
        notes: shouldPersistLegacyNotes ? rawBookingComment : null,
        createdBy: AppState.currentUser ? AppState.currentUser.username : '',
        createdAt: new Date().toISOString(),
        status: status,
        kidsCount: childrenCountSource.value || null,
        groupName: shouldPersistLegacyGroupName ? (document.getElementById('bookingGroupName')?.value.trim() || null) : null,
        programBasePrice: toBookingMoney(baseProgramPrice),
        menuPositions: formData.menuPositions || [],
        serviceEvents: formData.serviceEvents || [],
        extraData,
        paymentMethod: document.getElementById('bookingPaymentMethod')?.value || null
    };

    // v33.3: Include tags in extraData
    const selectedTags = Array.from(document.querySelectorAll('.booking-tag-option.active')).map(t => t.dataset.value);
    if (selectedTags.length > 0) {
        if (!obj.extraData) obj.extraData = {};
        obj.extraData.tags = selectedTags;
    }

    obj.banquetGuests = formData.kitchenEnabled ? kitchenChildrenCount : null;
    obj.banquetAdults = formData.kitchenEnabled ? normalizeBookingCountValue(document.getElementById('banquetAdults')?.value) : null;
    obj.banquetTables = formData.kitchenEnabled ? normalizeBookingCountValue(document.getElementById('banquetTables')?.value) : null;
    obj.banquetMenu = formData.kitchenEnabled
        ? (document.getElementById('banquetMenu')?.value?.trim()
            || bookingMenuPositionsToLegacyText(formData.menuPositions || [])
            || null)
        : null;
    obj.deposit = formData.kitchenEnabled && formData.deposit?.provided
        ? {
            expectedAmount: formData.deposit.expectedAmount,
            dueDate: formData.deposit.dueDate,
            managerStatus: formData.deposit.managerStatus,
            managerNote: formData.deposit.managerNote
        }
        : null;
    obj.banquetDeposit = obj.deposit;

    if (!obj.extraData) obj.extraData = {};
    obj.extraData.bookingPackage = {
        schemaVersion: 2,
        programBasePrice: obj.programBasePrice,
        positionsSubtotal: formData.positionsSubtotal || 0,
        entryCharge: formData.entryCharge || null,
        entrySubtotal: formData.entrySubtotal || 0,
        finalTotal: obj.price,
        menuPositions: formData.menuPositions || [],
        serviceEvents: formData.serviceEvents || [],
        source: 'booking_workspace'
    };
    if (Array.isArray(formData.bookingPackageWarnings) && formData.bookingPackageWarnings.length) {
        obj.extraData.bookingPackage.warnings = formData.bookingPackageWarnings;
    }
    obj.extraData.bookingWorkspace = buildBookingWorkspaceExtraData(formData);
    if (isMultiActivityBooking) {
        const activityIds = multiActivityPrograms.map(item => String(item.id));
        obj.extraData.multiActivity = {
            schemaVersion: 1,
            role: 'primary',
            activityIndex: 1,
            activityCount: activityIds.length,
            activityIds,
            totalDuration: bookingActivitiesTotalDuration(multiActivityPrograms),
            totalPrice: bookingActivitiesTotalPrice(multiActivityPrograms),
            source: 'booking_drawer_multi_activity'
        };
    }
    const timelineLine = getBookingLineSnapshot(formData.lineId) || {
        id: formData.lineId,
        resourceId: formData.lineId,
        resourceType: formData.lineResourceType || (formData.lineSource === 'banquet_service' ? 'service' : null),
        name: formData.lineName,
        source: formData.lineSource
    };
    const timelineIdentity = typeof timelineLineResourceIdentity === 'function'
        ? timelineLineResourceIdentity(timelineLine)
        : {
            resourceId: formData.lineId,
            resourceType: getTimelineBookingPresentation().resourceType || (getTimelineBookingPresentation().mode === 'park' ? 'animator' : 'resource'),
            businessContext: window.TimelineBusinessContext?.current?.()?.apiValue || 'event_genix',
            source: formData.lineSource || 'booking_form'
        };
    obj.resourceId = timelineIdentity.resourceId || formData.lineId;
    obj.resourceType = timelineIdentity.resourceType || null;
    obj.extraData.timelineIdentity = {
        ...timelineIdentity,
        resourceId: obj.resourceId,
        lineId: formData.lineId,
        lineName: formData.lineName || timelineLine?.name || null,
        source: timelineIdentity.source || 'booking_form'
    };

    if (isEducationTimelineBookingMode() && formData.educationLesson) {
        const lesson = {
            ...formData.educationLesson,
            title: (formData.educationLesson.title || obj.programName || obj.label || 'Заняття').slice(0, 160),
            groupName: formData.educationLesson.groupName || obj.groupName || null,
            studentCount: kidsCount || formData.educationLesson.studentCount || null,
            resourceName: formData.educationLesson.resourceName || obj.room || null
        };
        obj.extraData.educationLesson = lesson;
        obj.extraData.bookingWorkspace.lesson = lesson;
        obj.label = lesson.lessonType === 'exam' ? 'Контроль' : 'Заняття';
        obj.programName = lesson.title;
        obj.groupName = lesson.groupName || obj.groupName;
        obj.hosts = 1;
        obj.secondAnimator = null;
        obj.costume = null;
        obj.pinataMode = 'none';
    }

    if (formData.maysternyaMode || isMaysternyaBookingContext()) {
        const contact = getMaysternyaContactSnapshot();
        const leadCtx = AppState.leadConversionContext || {};
        obj.room = defaultTimelineBookingRoom() || MAYSTERNYA_ONLINE_ROOM;
        obj.hosts = hasEvent ? (program.hosts || 1) : 1;
        obj.kidsCount = null;
        obj.costume = null;
        obj.secondAnimator = null;
        obj.banquetGuests = null;
        obj.banquetAdults = null;
        obj.banquetTables = null;
        obj.banquetMenu = null;
        obj.menuPositions = [];
        obj.groupName = contact.topic || obj.groupName || null;
        obj.extraData.maysternyaBooking = {
            mode: 'online_consultation',
            online: true,
            specialistLineId: formData.lineId,
            clientName: contact.customerName || null,
            phone: contact.phone || null,
            instagram: contact.instagram || null,
            topic: contact.topic || null,
            leadId: leadCtx.leadId || null,
            inquirySource: leadCtx.source || null,
            page: leadCtx.page || null,
            message: leadCtx.message || null,
            sessionType: leadCtx.sessionType || null,
            source: 'maysternya_compact_booking'
        };
    }

    // v15.1+: CRM customer is a first-class booking package field.
    const existingId = document.getElementById('selectedCustomerId')?.value;
    if (existingId) {
        obj.customerId = parseInt(existingId, 10);
    } else if (BookingDrawerState.clientMode === 'new') {
        const customer = bookingCustomerPayloadFromDraft();
        if (customer) obj.customer = customer;
    }

    if (!AppState.editingBookingId && AppState.leadConversionContext?.leadId) {
        obj.leadId = AppState.leadConversionContext.leadId;
    }

    // v33.8.0: Certificate code
    const certCode = document.getElementById('certCodeInput')?.value?.trim();
    if (certCode) obj.certificateCode = certCode;

    // Optimistic locking: include updatedAt from the booking being edited
    if (AppState.editingBookingId) {
        obj.updatedAt = AppState.editingBookingUpdatedAt || null;
    }

    attachActiveBanquetIntentMarker(obj);

    return obj;
}

function shouldCreateEducationLessonSeries(booking) {
    const lesson = educationLessonDetailsFromBooking(booking);
    return isEducationTimelineBookingMode()
        && !AppState.editingBookingId
        && lesson
        && Number(lesson.seriesSize || 1) > 1;
}

function ensureMultiActivityGroupName(booking) {
    if (String(booking?.groupName || '').trim()) return booking.groupName;
    const selectedCustomerName = document.querySelector('#bookingSelectedCustomerCard strong')?.textContent?.trim();
    const customerName = selectedCustomerName || document.getElementById('customerName')?.value?.trim();
    const fallback = customerName || 'Банкет';
    return `${fallback} ${formatDate(AppState.selectedDate)} ${booking?.time || ''}`.trim();
}

function buildMultiActivityBookingFromProgram(baseBooking, program, options = {}) {
    if (!program) return null;
    const activityIndex = Number(options.index || 0);
    const activityIds = (options.activityPrograms || []).map(item => String(item.id));
    const persistedFields = getSelectedActivityBookingFields()[String(program.id)] || {};
    const pinataFields = selectedActivityPinataDraft(program);
    const secondAnimatorFields = selectedActivitySecondAnimatorDraft(program);
    const price = bookingActivityPriceValue(program);
    const duration = Number(persistedFields.duration || program.duration || 0) || 30;
    const extraData = buildExtraData(String(program.id)) || {};
    const timelineIdentity = baseBooking.extraData?.timelineIdentity
        ? { ...baseBooking.extraData.timelineIdentity, source: 'multi_activity_booking' }
        : null;
    extraData.bookingPackage = {
        schemaVersion: 1,
        programBasePrice: price,
        positionsSubtotal: 0,
        finalTotal: price,
        menuPositions: [],
        source: 'booking_workspace'
    };
    extraData.bookingWorkspace = {
        ...buildBookingWorkspaceExtraData({}),
        secondAnimator: secondAnimatorFields.secondAnimator || null,
        secondAnimatorLineId: secondAnimatorFields.secondAnimatorLineId || null,
        secondAnimatorLineName: secondAnimatorFields.secondAnimatorLineName || null,
        source: 'booking_workspace_v2'
    };
    extraData.multiActivity = {
        schemaVersion: 1,
        role: 'activity',
        activityIndex: activityIndex + 1,
        activityCount: activityIds.length,
        activityIds,
        primaryProgramId: String(options.primaryProgramId || activityIds[0] || ''),
        totalDuration: bookingActivitiesTotalDuration(options.activityPrograms || []),
        totalPrice: bookingActivitiesTotalPrice(options.activityPrograms || []),
        source: 'booking_drawer_multi_activity'
    };
    if (timelineIdentity) extraData.timelineIdentity = timelineIdentity;

    return {
        bookingId: persistedFields.existingActivityBookingId || undefined,
        date: baseBooking.date,
        time: options.time || baseBooking.time,
        lineId: persistedFields.lineId || baseBooking.lineId,
        lineName: baseBooking.lineName || null,
        resourceId: baseBooking.resourceId || null,
        resourceType: baseBooking.resourceType || null,
        programId: String(program.id),
        programCode: program.code,
        label: selectedActivityPinataLabel(program, program.label || `${program.code || program.name || 'Активність'}(${duration})`),
        programName: program.name || program.label || program.code,
        category: program.category,
        duration,
        price,
        hosts: secondAnimatorFields.secondAnimator
            ? Math.max(Number(program.hosts || 0), 2)
            : Number(program.hosts || 0),
        secondAnimator: secondAnimatorFields.secondAnimator,
        secondAnimatorLineId: secondAnimatorFields.secondAnimatorLineId,
        secondAnimatorLineName: secondAnimatorFields.secondAnimatorLineName,
        pinataMode: pinataFields.pinataMode,
        pinataNumber: pinataFields.pinataNumber,
        pinataFillerNumber: pinataFields.pinataFillerNumber,
        pinataFiller: pinataFields.pinataFiller,
        clientPinataServicePrice: pinataFields.pinataMode === 'client' ? price : null,
        clientPinataServiceNote: pinataFields.clientPinataServiceNote,
        costume: baseBooking.costume || null,
        room: baseBooking.room,
        notes: null,
        createdBy: baseBooking.createdBy,
        status: baseBooking.status,
        kidsCount: program.perChild
            ? (resolveBookingChildrenCountSource({ program, kitchenEnabled: false, standaloneEditable: true }).value || null)
            : (bookingChildrenCountFromBooking(baseBooking) || null),
        groupName: null,
        menuPositions: [],
        extraData,
        paymentMethod: baseBooking.paymentMethod || null,
        customerId: baseBooking.customerId || null,
        banquetGuests: null,
        banquetAdults: null,
        banquetTables: null,
        banquetMenu: null
    };
}

function buildMultiActivityBookings(baseBooking, formData = {}) {
    if (!bookingMultiActivityEnabled()) return [];
    const programs = Array.isArray(formData.activityPrograms)
        ? formData.activityPrograms.filter(Boolean)
        : getSelectedActivityPrograms();
    if (programs.length <= 1) return [];
    const scheduleRows = getSelectedActivityScheduleRows(programs);
    const primaryRow = scheduleRows[0] || null;
    if (primaryRow?.time) baseBooking.time = primaryRow.time;
    baseBooking.groupName = ensureMultiActivityGroupName(baseBooking);
    if (!baseBooking.extraData) baseBooking.extraData = {};
    if (!baseBooking.extraData.multiActivity) {
        baseBooking.extraData.multiActivity = {
            schemaVersion: 1,
            role: 'primary',
            activityIndex: 1,
            activityCount: programs.length,
            activityIds: programs.map(item => String(item.id)),
            totalDuration: bookingActivitiesTotalDuration(programs),
            totalPrice: bookingActivitiesTotalPrice(programs),
            schedule: selectedActivityScheduleExtra(scheduleRows),
            source: 'booking_drawer_multi_activity'
        };
    }
    baseBooking.extraData.multiActivity.schedule = selectedActivityScheduleExtra(scheduleRows);
    baseBooking.extraData.multiActivity.totalDuration = bookingActivitiesTotalDuration(programs);
    baseBooking.extraData.multiActivity.totalPrice = bookingActivitiesTotalPrice(programs);
    return scheduleRows.slice(1).map(row => {
        const program = row.program;
        const booking = buildMultiActivityBookingFromProgram(baseBooking, program, {
            index: row.index,
            time: row.time,
            activityPrograms: programs,
            primaryProgramId: programs[0]?.id
        });
        return booking;
    }).filter(Boolean);
}

function buildMaysternyaClosedSlotBooking() {
    const duration = getMaysternyaSlotCloseDuration();
    const notes = document.getElementById('bookingNotes')?.value?.trim() || '';
    const line = getSelectedTimelineResourceLine();
    const presentation = getTimelineBookingPresentation();
    const resourceName = line?.name || presentation.roomOptionLabel || MAYSTERNYA_CLOSED_ROOM;
    const isMaysternya = isMaysternyaBookingContext();
    const room = isMaysternya ? MAYSTERNYA_CLOSED_ROOM : resourceName;
    const label = isEducationTimelineBookingMode() ? 'Кабінет закрито' : 'Закрито';
    const noteText = notes || (isMaysternya
        ? 'Олександр зайнятий у цей час'
        : `${resourceName} недоступний у цей час`);
    const lineIdentity = typeof timelineLineResourceIdentity === 'function'
        ? timelineLineResourceIdentity(line || { id: document.getElementById('bookingLine')?.value, name: resourceName })
        : {
            resourceId: document.getElementById('bookingLine')?.value || null,
            resourceType: line?.resourceType || presentation.resourceType || null,
            businessContext: window.TimelineBusinessContext?.current?.()?.apiValue || 'event_genix',
            source: isMaysternya ? 'maysternya_quick_close' : 'timeline_resource_quick_close'
        };
    const resourceBlock = {
        mode: 'resource_blackout',
        resourceBlocked: true,
        resourceId: lineIdentity.resourceId || document.getElementById('bookingLine')?.value || null,
        resourceType: lineIdentity.resourceType || line?.resourceType || presentation.resourceType || null,
        resourceName,
        closedDuration: duration,
        source: isMaysternya ? 'maysternya_quick_close' : 'timeline_resource_quick_close'
    };
    return {
        date: formatDate(AppState.selectedDate),
        time: document.getElementById('bookingTime')?.value,
        lineId: document.getElementById('bookingLine')?.value,
        programId: null,
        programCode: 'CLOSED',
        label,
        programName: isEducationTimelineBookingMode() ? 'Кабінет недоступний' : 'Слот закрито',
        category: 'custom',
        duration,
        price: 0,
        hosts: 1,
        secondAnimator: null,
        pinataMode: 'none',
        pinataNumber: null,
        pinataFillerNumber: null,
        pinataFiller: null,
        clientPinataServicePrice: null,
        clientPinataServiceNote: null,
        costume: null,
        room,
        notes: noteText,
        createdBy: AppState.currentUser ? AppState.currentUser.username : '',
        createdAt: new Date().toISOString(),
        status: 'confirmed',
        kidsCount: null,
        groupName: isEducationTimelineBookingMode() ? resourceName : 'Зайнято',
        resourceId: resourceBlock.resourceId,
        resourceType: resourceBlock.resourceType,
        programBasePrice: 0,
        menuPositions: [],
        extraData: {
            timelineIdentity: {
                ...lineIdentity,
                resourceId: resourceBlock.resourceId,
                resourceType: resourceBlock.resourceType,
                lineId: document.getElementById('bookingLine')?.value || null,
                lineName: resourceName,
                source: resourceBlock.source
            },
            timelineResourceBlock: resourceBlock,
            maysternyaBooking: {
                mode: 'closed_slot',
                slotClosed: true,
                online: false,
                closedDuration: duration,
                specialistLineId: document.getElementById('bookingLine')?.value,
                source: isMaysternya ? 'maysternya_quick_close' : 'timeline_resource_quick_close'
            },
            bookingWorkspace: {
                schemaVersion: BOOKING_WORKSPACE_SCHEMA_VERSION,
                hasEvent: false,
                scenario: 'closed_slot',
                leadDetails: {},
                kitchen: { itemsCount: 0, menuCount: 0, cakeCount: 0, positionsSubtotal: 0 },
                source: isMaysternya ? 'maysternya_quick_close' : 'timeline_resource_quick_close'
            }
        },
        skipNotification: true,
        paymentMethod: null,
        banquetGuests: null,
        banquetAdults: null,
        banquetTables: null,
        banquetMenu: null
    };
}

async function closeMaysternyaTimelineSlot() {
    if (!isMaysternyaBookingContext() && !isTimelineResourceBackedBookingMode()) return;
    const btn = document.getElementById('maysternyaCloseSlotBtn');
    if (btn && btn.disabled) return;
    const booking = buildMaysternyaClosedSlotBooking();
    if (!booking.time || !booking.lineId) {
        showNotification(isEducationTimelineBookingMode() ? 'Оберіть час у кабінеті' : 'Оберіть час на ресурсі', 'error');
        return;
    }
    const bookingDateTime = new Date(`${booking.date}T${booking.time}:00`);
    if (bookingDateTime < new Date()) {
        showNotification('Неможливо закрити слот у минулому.', 'error');
        return;
    }
    const valid = await validateBookingConflicts(booking.lineId, booking.time, booking.duration, null, null, null);
    if (!valid) return;

    if (btn) {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent;
        btn.textContent = 'Закриваю...';
    }

    try {
        const result = await apiCreateBooking(booking);
        if (!result || result.success === false) {
            showNotification(result?.error || 'Не вдалось закрити слот', 'error');
            return;
        }
        if (result?.booking?.id) booking.id = result.booking.id;
        else if (result?.id) booking.id = result.id;
        pushUndo('create', [booking]);
        invalidateBookingTimelineDateCache(AppState.selectedDate, { lines: false });
        await closeBookingPanel(true);
        await renderTimeline();
        showNotification('Слот закрито', 'success');
    } catch (error) {
        handleError('Закриття слота', error);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = btn.dataset.originalText || (isEducationTimelineBookingMode() ? 'Закрити кабінет' : 'Закрити слот');
        }
    }
}

function buildExtraData(programId) {
    if (programId === 'mk_tshirt') {
        const sizes = {};
        ['XS', 'S', 'M', 'L', 'XL'].forEach(s => {
            const val = parseInt(document.getElementById('tshirt' + s)?.value) || 0;
            if (val > 0) sizes[s] = val;
        });
        if (Object.keys(sizes).length > 0) return { tshirt_sizes: sizes };
    }
    return null;
}

// v5.7: Build linked bookings array (for transactional create)
async function buildLinkedBookings(booking, program) {
    const linked = [];
    if (!program || booking.duration <= 0) return linked;
    const lines = await getLinesForDate(AppState.selectedDate);

    // Другий ведучий
    if (booking.secondAnimator) {
        const secondCandidate = selectedSecondAnimatorLineCandidate(booking.secondAnimator);
        const secondLine = lines.find(l => l.name === booking.secondAnimator)
            || lines.find(l => String(l.id) === String(booking.secondAnimatorLineId || ''))
            || lines.find(l => String(l.id) === String(secondCandidate?.id || ''))
            || secondCandidate;
        if (secondLine) {
            linked.push({
                date: booking.date, time: booking.time, lineId: secondLine.id,
                lineName: secondLine.name || booking.secondAnimator || null,
                programId: booking.programId, programCode: booking.programCode,
                label: booking.label, programName: booking.programName,
                category: booking.category, duration: booking.duration,
                price: 0, hosts: booking.hosts,
                secondAnimator: booking.secondAnimator,
                pinataFiller: booking.pinataFiller,
                costume: booking.costume, room: booking.room,
                notes: booking.notes, createdBy: booking.createdBy,
                status: booking.status, kidsCount: booking.kidsCount
            });
        }
    }

    // Додатковий ведучий (700 ₴/год)
    const extraHostToggle = document.getElementById('extraHostToggle');
    if (extraHostToggle && extraHostToggle.checked) {
        const extraHostAnimator = document.getElementById('extraHostAnimatorSelect')?.value;
        if (extraHostAnimator) {
            const extraCandidate = selectedAnimatorLineCandidate('extraHostAnimatorSelect', extraHostAnimator);
            const extraLine = lines.find(l => l.name === extraHostAnimator)
                || lines.find(l => String(l.id) === String(extraCandidate?.id || ''))
                || extraCandidate;
            if (extraLine) {
                const extraPrice = Math.round(700 * (booking.duration / 60));
                linked.push({
                    date: booking.date, time: booking.time, lineId: extraLine.id,
                    lineName: extraLine.name || extraHostAnimator || null,
                    programId: 'anim_extra', programCode: '+Вед',
                    label: `+Вед(${booking.duration})`, programName: 'Додатковий ведучий',
                    category: 'animation', duration: booking.duration, price: extraPrice,
                    hosts: 1, room: booking.room, createdBy: booking.createdBy,
                    status: booking.status
                });
            }
        }
    }

    return linked;
}

/**
 * v7.10: Check if the primary/secondary animator is off duty on the booking date.
 * Uses GET /api/staff/schedule/check/:date which returns available/unavailable animators.
 * Shows a warning (non-blocking) if an animator has dayoff/vacation/sick status.
 */
async function checkAnimatorAvailability(lineId, secondAnimatorName) {
    try {
        const dateStr = formatDate(AppState.selectedDate);
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`/api/staff/schedule/check/${dateStr}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!data.success) return;

        const lines = await getLinesForDate(AppState.selectedDate);
        const primaryLine = lines.find(l => l.id === lineId);
        const primaryName = primaryLine?.name;

        // Check primary animator
        if (primaryName) {
            const off = data.unavailable.find(u => u.name === primaryName);
            if (off) {
                showNotification(`⚠️ ${primaryName}: ${STATUS_LABELS_BOOKING[off.status] || off.status} на ${dateStr}`, 'warning');
            }
        }

        // Check second animator
        if (secondAnimatorName) {
            const off = data.unavailable.find(u => u.name === secondAnimatorName);
            if (off) {
                showNotification(`⚠️ ${secondAnimatorName}: ${STATUS_LABELS_BOOKING[off.status] || off.status} на ${dateStr}`, 'warning');
            }
        }
    } catch (err) {
        // Non-critical: don't block booking if check fails
    }
}

const STATUS_LABELS_BOOKING = {
    dayoff: 'вихідний',
    vacation: 'відпустка',
    sick: 'лікарняний'
};

function unlockSubmitBtn() {
    const btn = document.getElementById('bookingSubmitBtn');
    if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.readyText || btn.dataset.originalText || 'Додати бронювання';
        btn.setAttribute('aria-disabled', 'false');
    }
    updateBookingSubmitState();
}

function collectCreatedBookingRecords(createResult) {
    const records = [];
    if (Array.isArray(createResult?.allBookings)) records.push(...createResult.allBookings);
    if (createResult?.booking) records.push(createResult.booking);
    if (createResult?.mainBooking) records.push(createResult.mainBooking);
    if (Array.isArray(createResult?.bookings)) records.push(...createResult.bookings);
    if (Array.isArray(createResult?.linkedBookings)) records.push(...createResult.linkedBookings);
    if (createResult?.id) records.push({ id: createResult.id });
    const seen = new Set();
    return records.filter(record => {
        const id = record?.id || record?.bookingId;
        if (!id || seen.has(String(id))) return false;
        seen.add(String(id));
        return true;
    });
}

function createResultConfirmed(createResult) {
    if (!createResult || createResult.success === false) return false;
    if (createResult.serverVerified === false) return false;
    const records = collectCreatedBookingRecords(createResult);
    if (!records.length) return false;
    return records.every(record => record?.serverVerified !== false);
}

function bookingBlockSelectorId(value) {
    const raw = String(value || '');
    if (!raw) return '';
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(raw);
    return raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function findCreatedBookingBlock(booking = {}) {
    const id = booking?.id || booking?.bookingId;
    const selectorId = bookingBlockSelectorId(id);
    if (!selectorId) return null;
    return document.querySelector(`.booking-block[data-booking-id="${selectorId}"], .mini-booking-block[data-booking-id="${selectorId}"]`);
}

function focusCreatedBookingBlocks(createdBookings = []) {
    const blocks = createdBookings
        .map(findCreatedBookingBlock)
        .filter(Boolean);
    blocks.forEach(block => {
        block.classList.add('booking-block--just-created');
        window.setTimeout(() => block.classList.remove('booking-block--just-created'), 4500);
    });
    const firstVisible = blocks.find(block => !block.classList.contains('status-hidden'));
    if (firstVisible?.scrollIntoView) {
        firstVisible.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
    return {
        expectedCount: createdBookings.filter(item => item?.id || item?.bookingId).length,
        foundCount: blocks.length,
        visibleCount: blocks.filter(block => !block.classList.contains('status-hidden')).length
    };
}

function revealCreatedBookingBlocks(createdBookings = []) {
    let visibility = focusCreatedBookingBlocks(createdBookings);
    if (visibility.foundCount > 0 && visibility.visibleCount === 0 && typeof resetStatusFilter === 'function') {
        resetStatusFilter();
        visibility = focusCreatedBookingBlocks(createdBookings);
    }
    return visibility;
}

function waitForCreatedBookingBlocks(createdBookings = [], timeoutMs = 1200) {
    const expectedIds = createdBookings
        .map(item => item?.id || item?.bookingId)
        .filter(Boolean);
    if (!expectedIds.length) return Promise.resolve(false);
    const startedAt = Date.now();
    return new Promise(resolve => {
        const tick = () => {
            const found = expectedIds.some(id => findCreatedBookingBlock({ id }));
            if (found) return resolve(true);
            if (Date.now() - startedAt >= timeoutMs) return resolve(false);
            window.requestAnimationFrame ? window.requestAnimationFrame(tick) : window.setTimeout(tick, 50);
        };
        tick();
    });
}

function createdBookingIsLeadOnly(booking = {}) {
    const workspace = booking.extraData?.bookingWorkspace
        || booking.extra_data?.bookingWorkspace
        || booking.extraData?.booking_workspace
        || booking.extra_data?.booking_workspace
        || {};
    return !booking.programId && (booking.programCode === 'LEAD' || workspace.scenario === 'lead_only');
}

function createdBookingSuccessMessage(createdBookings = [], seriesCount = 1) {
    if (seriesCount > 1) return `Створено серію занять: ${seriesCount}`;
    const primary = createdBookings[0] || {};
    if (createdBookingIsLeadOnly(primary)) {
        return 'Заявку створено без програми. Для події увімкніть «Подія / програма» і виберіть програму.';
    }
    return 'Бронювання створено!';
}

function createdBookingVisibilityDiagnostics(createdBookings = [], snapshot = null) {
    const expectedDate = formatDate(AppState.selectedDate);
    const expectedContext = window.TimelineBusinessContext?.state?.()?.activeBusinessContext
        || window.TimelineBusinessContext?.current?.()?.apiValue || '';
    const visibleLineIds = snapshot?.lineIds instanceof Set
        ? snapshot.lineIds
        : new Set((AppState.lines || []).flatMap(line => {
            const identity = typeof timelineLineResourceIdentity === 'function'
                ? timelineLineResourceIdentity(line)
                : null;
            return [identity?.resourceId, line?.resourceId, line?.id, line?.lineId].filter(Boolean).map(String);
        }));
    const bookingsById = snapshot?.bookingsById instanceof Map ? snapshot.bookingsById : new Map();
    const missingIds = snapshot?.missingIds instanceof Set ? snapshot.missingIds : new Set();
    return createdBookings.map(booking => {
        const id = booking?.id || booking?.bookingId || '';
        const serverBooking = id ? bookingsById.get(String(id)) : null;
        const source = serverBooking ? { ...booking, ...serverBooking } : booking;
        const reasons = [];
        const date = normalizeBookingDateKey(source?.date);
        const resourceIdentity = typeof timelineBookingResourceIdentity === 'function'
            ? timelineBookingResourceIdentity(source)
            : null;
        const lineId = String(resourceIdentity?.resourceId || source?.resourceId || source?.resource_id || source?.lineId || source?.line_id || '').trim();
        const status = source?.status || booking?.status || '';
        const block = findCreatedBookingBlock(source);
        const projection = createdBookingTimelineProjection(source);

        if (projection?.visible === false) reasons.push(`серверна проекція не бачить запис ${id}`);
        if (projection?.error) reasons.push(`помилка projection: ${projection.error}`);
        if (id && missingIds.has(String(id))) reasons.push(`серверний список дня не повернув запис ${id}`);
        if (date && date !== expectedDate) reasons.push(`дата ${date}`);
        if (source?.businessContext && expectedContext && source.businessContext !== expectedContext) {
            reasons.push(`бізнес ${source.businessContext}`);
        }
        if (!lineId) reasons.push('сервер повернув запис без лінії');
        if (lineId && visibleLineIds.size && !visibleLineIds.has(lineId)) {
            reasons.push(`лінія ${lineId} не відкрита в поточному таймлайні`);
        }
        const time = String(source?.time || '').slice(0, 5);
        const range = AppState.selectedDate ? getTimeRange(new Date(AppState.selectedDate)) : null;
        if (time && range) {
            const minutes = timeToMinutes(time);
            if (minutes < range.start * 60 || minutes >= range.end * 60) {
                reasons.push(`час ${time} поза видимим діапазоном ${range.start}:00-${range.end}:00`);
            }
        }
        if (Number(source?.duration || 0) <= 0) reasons.push('тривалість запису 0 хв');
        const filter = AppState.statusFilter || 'all';
        if (!block && status === 'preliminary' && filter === 'confirmed') reasons.push('попередній запис прихований фільтром "Підтверджені"');
        if (!block && status && status !== 'preliminary' && filter === 'preliminary') reasons.push('підтверджений запис прихований фільтром "Попередні"');
        if (block?.classList?.contains('status-hidden')) reasons.push('запис прихований фільтром статусу');
        if (!block && !reasons.length) reasons.push('DOM-блок не відрендерився після refresh');

        return { id, date, lineId, reasons };
    });
}

function createdBookingTimelineProjection(booking = {}) {
    return booking.timelineProjection
        || booking.timeline_projection
        || booking.timeline_projection_status
        || null;
}

function normalizeCreatedBookingTimelineView(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    return normalized === 'rooms' ? 'rooms' : 'animators';
}

function currentCreatedBookingTimelineView() {
    const current = typeof window !== 'undefined'
        ? window.TimelineView?.current?.()
        : null;
    return normalizeCreatedBookingTimelineView(current || 'animators') || 'animators';
}

function createdBookingProjectionTimelineView(projection = {}) {
    return normalizeCreatedBookingTimelineView(
        projection?.timelineView
        || projection?.timeline_view
        || projection?.view
        || ''
    );
}

function createdBookingDiagnosticSummary(booking = {}) {
    const projection = createdBookingTimelineProjection(booking) || {};
    const resourceIdentity = typeof timelineBookingResourceIdentity === 'function'
        ? timelineBookingResourceIdentity(booking)
        : null;
    return {
        id: booking?.id || booking?.bookingId || null,
        date: normalizeBookingDateKey(projection?.date || booking?.date) || null,
        status: booking?.status || null,
        businessContext: projection?.businessContext
            || projection?.business_context
            || booking?.businessContext
            || booking?.business_context
            || null,
        timelineView: createdBookingProjectionTimelineView(projection) || currentCreatedBookingTimelineView(),
        lineId: String(resourceIdentity?.resourceId || booking?.resourceId || booking?.resource_id || booking?.lineId || booking?.line_id || '').trim() || null
    };
}

function createdBookingProjectionMatchesCurrentSlice(booking = {}, currentDate = formatDate(AppState.selectedDate)) {
    const projection = createdBookingTimelineProjection(booking);
    const expectedContext = window.TimelineBusinessContext?.state?.()?.activeBusinessContext
        || window.TimelineBusinessContext?.current?.()?.apiValue || '';
    const expectedTimelineView = currentCreatedBookingTimelineView();
    const projectedTimelineView = createdBookingProjectionTimelineView(projection);
    const projectedDate = normalizeBookingDateKey(projection?.date || booking.date);
    const projectedContext = projection?.businessContext
        || projection?.business_context
        || booking.businessContext
        || booking.business_context
        || '';
    if (projectedDate && projectedDate !== currentDate) return false;
    if (projectedContext && expectedContext && projectedContext !== expectedContext) return false;
    if (projectedTimelineView && expectedTimelineView && projectedTimelineView !== expectedTimelineView) return false;
    const id = booking?.id || booking?.bookingId;
    const resourceIdentity = typeof timelineBookingResourceIdentity === 'function'
        ? timelineBookingResourceIdentity(booking)
        : null;
    const lineId = String(resourceIdentity?.resourceId || booking?.resourceId || booking?.resource_id || booking?.lineId || booking?.line_id || '').trim();
    return Boolean(id && (lineId || projection?.visible === true));
}

function bookingDetailsFallbackMatchesCurrentSlice(booking = {}, cleanBookingId = '', currentDate = formatDate(AppState.selectedDate)) {
    const id = String(booking?.id || booking?.bookingId || booking?.booking_id || '').trim();
    if (!id || id !== String(cleanBookingId || '').trim()) return false;
    if (createdBookingProjectionMatchesCurrentSlice(booking, currentDate)) return true;

    const projection = createdBookingTimelineProjection(booking);
    const expectedContext = window.TimelineBusinessContext?.state?.()?.activeBusinessContext
        || window.TimelineBusinessContext?.current?.()?.apiValue || '';
    const expectedTimelineView = currentCreatedBookingTimelineView();
    const projectedTimelineView = createdBookingProjectionTimelineView(projection);
    const projectedDate = normalizeBookingDateKey(projection?.date || booking.date);
    const projectedContext = projection?.businessContext
        || projection?.business_context
        || booking.businessContext
        || booking.business_context
        || '';
    if (projectedDate && projectedDate !== currentDate) return false;
    if (projectedContext && expectedContext && projectedContext !== expectedContext) return false;
    if (projectedTimelineView && expectedTimelineView && projectedTimelineView !== expectedTimelineView) return false;

    const matchKeys = typeof timelineBookingMatchKeys === 'function'
        ? timelineBookingMatchKeys(booking)
        : null;
    return Boolean(matchKeys && matchKeys.size > 0);
}

function bookingDetailsOpenFailureCode(detailRecord = {}) {
    const status = Number(detailRecord.status || 0);
    if (detailRecord.offline) return 'TL-BK-OFFLINE';
    if (detailRecord.error === 'apiGetBookingById unavailable') return 'TL-BK-API-MISSING';
    if (status === 400) return 'TL-BK-BAD-ID';
    if (status === 401) return 'TL-BK-AUTH';
    if (status === 403) return 'TL-BK-FORBIDDEN';
    if (status === 404) return 'TL-BK-NOT-FOUND';
    if (status >= 500) return 'TL-BK-SERVER';
    if (detailRecord.source === 'date-cache-miss') return 'TL-BK-CACHE-MISS';
    if (detailRecord.source === 'id-fetch-miss') return 'TL-BK-ID-MISS';
    return 'TL-BK-OPEN-MISS';
}

function bookingDetailsMissingDiagnostic(cleanBookingId, detailRecord = {}, options = {}) {
    return {
        code: bookingDetailsOpenFailureCode(detailRecord),
        bookingId: cleanBookingId,
        source: options.source || 'unknown',
        date: formatDate(AppState.selectedDate),
        timelineView: currentCreatedBookingTimelineView(),
        businessContext: window.TimelineBusinessContext?.state?.()?.activeBusinessContext
            || window.TimelineBusinessContext?.current?.()?.apiValue || null,
        lookupSource: detailRecord.source,
        status: detailRecord.status || null,
        apiCode: detailRecord.code || null,
        offline: detailRecord.offline === true,
        error: detailRecord.error || null
    };
}

function emitBookingDetailsMissingDiagnostic(diagnostic, options = {}) {
    window.__lastBookingDetailsOpenFailure = diagnostic;
    if (typeof options.onMissing === 'function') {
        try {
            options.onMissing(diagnostic);
        } catch (err) {
            console.warn('[booking] Details missing diagnostic callback failed', {
                code: diagnostic?.code || 'TL-BK-DIAGNOSTIC-CALLBACK',
                source: diagnostic?.source || options.source || 'unknown',
                error: err?.message || String(err || '')
            });
        }
    }
}

function createdBookingVisibilityMessage(createdBookings = [], snapshot = null) {
    const primary = createdBookings[0] || {};
    const primaryId = primary?.id || primary?.bookingId || '';
    const primaryServer = primaryId && snapshot?.bookingsById instanceof Map
        ? snapshot.bookingsById.get(String(primaryId))
        : null;
    const source = primaryServer ? { ...primary, ...primaryServer } : primary;
    const expectedDate = formatDate(AppState.selectedDate);
    const expectedContext = window.TimelineBusinessContext?.state?.()?.activeBusinessContext
        || window.TimelineBusinessContext?.current?.()?.apiValue || '';
    const actual = [];
    const primaryDate = normalizeBookingDateKey(source.date);
    if (primaryDate && primaryDate !== expectedDate) actual.push(`дата ${primaryDate}`);
    if (source.businessContext && expectedContext && source.businessContext !== expectedContext) {
        actual.push(`бізнес ${source.businessContext}`);
    }
    if (actual.length) {
        return `Сервер створив запис, але не в поточному зрізі таймлайну: ${actual.join(', ')}. Відкрито ${expectedDate}${expectedContext ? ` / ${expectedContext}` : ''}.`;
    }
    const diagnostics = createdBookingVisibilityDiagnostics(createdBookings, snapshot);
    const reason = diagnostics.flatMap(item => item.reasons || [])[0];
    if (reason) {
        return `Сервер створив запис, але поточний таймлайн його не показав: ${reason}. Перевірте бізнес, дату, фільтр або оберіть правильну лінію.`;
    }
    return 'Сервер створив запис, але поточний таймлайн його не показав. Перевірте бізнес, дату/лінію або оновіть сторінку.';
}

async function refreshCreatedBookingTimelineSnapshot(createdBookings = []) {
    const currentDate = formatDate(AppState.selectedDate);
    const previousCachedBookings = typeof getTimelineCacheEntry === 'function'
        ? getTimelineCacheEntry(AppState.cachedBookings, currentDate)
        : null;
    const preservedBookings = Array.isArray(previousCachedBookings?.data)
        ? previousCachedBookings.data
        : [];
    const createdById = new Map(
        createdBookings
            .map(item => [String(item?.id || item?.bookingId || ''), item])
            .filter(([id]) => Boolean(id))
    );
    const expectedIds = new Set(
        createdBookings
            .filter(item => !item?.date || normalizeBookingDateKey(item.date) === currentDate)
            .map(item => item?.id || item?.bookingId)
            .filter(Boolean)
            .map(String)
    );
    const snapshot = {
        date: currentDate,
        expectedIds,
        lines: [],
        bookings: [],
        bookingsById: new Map(),
        foundIds: new Set(),
        missingIds: new Set(expectedIds),
        projectionRecoveredIds: new Set(),
        lineIds: new Set()
    };
    if (!expectedIds.size) return snapshot;

    invalidateBookingTimelineDateCache(currentDate, { bookings: false });
    const [freshLines, freshBookings] = await Promise.all([
        getLinesForDate(AppState.selectedDate, { force: true }).catch(error => {
            console.error('[Booking] Fresh timeline lines fetch failed after create', error);
            return null;
        }),
        getBookingsForDate(AppState.selectedDate, { force: true }).catch(error => {
            console.error('[Booking] Fresh timeline bookings fetch failed after create', error);
            return null;
        })
    ]);

    if (Array.isArray(freshLines)) {
        snapshot.lines = typeof normalizeTimelineLinesForContext === 'function'
            ? normalizeTimelineLinesForContext(freshLines)
            : freshLines;
        snapshot.lineIds = new Set(snapshot.lines.flatMap(line => {
            const identity = typeof timelineLineResourceIdentity === 'function'
                ? timelineLineResourceIdentity(line)
                : null;
            return [identity?.resourceId, line?.resourceId, line?.id, line?.lineId].filter(Boolean).map(String);
        }));
        AppState.lines = snapshot.lines;
        AppState.linesByDate = AppState.linesByDate || {};
        AppState.linesByDate[currentDate] = snapshot.lines;
        if (typeof setTimelineCacheEntry === 'function') {
            setTimelineCacheEntry(AppState.cachedLines, currentDate, freshLines);
        }
    }

    const mergedBookingsById = new Map();
    preservedBookings.forEach(booking => {
        const id = booking?.id || booking?.bookingId;
        if (!id) return;
        mergedBookingsById.set(String(id), booking);
    });

    if (Array.isArray(freshBookings)) {
        freshBookings.forEach(booking => {
            const id = booking?.id || booking?.bookingId;
            if (!id) return;
            const key = String(id);
            mergedBookingsById.set(key, booking);
            if (expectedIds.has(key)) {
                snapshot.foundIds.add(key);
                snapshot.missingIds.delete(key);
            }
        });
    }

    snapshot.bookings = Array.from(mergedBookingsById.values());
    snapshot.bookings.forEach(booking => {
        const id = booking?.id || booking?.bookingId;
        if (!id) return;
        snapshot.bookingsById.set(String(id), booking);
    });

    Array.from(snapshot.missingIds).forEach(key => {
        const created = createdById.get(key);
        if (!createdBookingProjectionMatchesCurrentSlice(created, currentDate)) return;
        snapshot.bookings.push(created);
        snapshot.bookingsById.set(key, created);
        snapshot.foundIds.add(key);
        snapshot.missingIds.delete(key);
        snapshot.projectionRecoveredIds.add(key);
    });
    if (typeof setTimelineCacheEntry === 'function' && snapshot.bookings.length) {
        setTimelineCacheEntry(AppState.cachedBookings, currentDate, snapshot.bookings);
    }

    return snapshot;
}

function restoreTimelineDateAfterBookingSave(dateKey) {
    const normalizedDate = normalizeBookingDateKey(dateKey);
    if (!normalizedDate) return;
    AppState.selectedDate = new Date(`${normalizedDate}T00:00:00`);
    const timelineDateInput = document.getElementById('timelineDate');
    if (timelineDateInput) timelineDateInput.value = normalizedDate;
    if (typeof setTimelineDateInUrl === 'function') {
        setTimelineDateInUrl(normalizedDate);
    }
}

async function handleBookingSubmit(e) {
    e.preventDefault();

    const submitBtn = document.getElementById('bookingSubmitBtn');
    const selectedDateBeforeSave = normalizeBookingDateKey(AppState.selectedDate);
    const formData = getBookingFormData();
    const validation = window.BookingForm?.validate ? BookingForm.validate() : { valid: true };
    if (!validation.valid) {
        showBookingValidationErrors(validation);
        return;
    }
    if (submitBtn && submitBtn.disabled) return;
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.setAttribute('aria-disabled', 'true');
        submitBtn.dataset.originalText = submitBtn.dataset.readyText || submitBtn.dataset.originalText || submitBtn.textContent;
        submitBtn.dataset.readyText = submitBtn.dataset.originalText;
        submitBtn.textContent = BOOKING_SUBMIT_SAVING_TEXT;
    }

    const invalidMenuPosition = (formData.menuPositions || []).find(item => !item.title || Number(item.quantity) <= 0 || Number(item.unitPrice) < 0);
    if (invalidMenuPosition) {
        showNotification('Перевірте позиції меню: назва, кількість і ціна мають бути коректними', 'error');
        unlockSubmitBtn();
        return;
    }
    const capacityError = timelineResourceCapacityError(formData);
    if (capacityError) {
        showNotification(capacityError, 'error');
        unlockSubmitBtn();
        return;
    }
    syncLegacyBanquetMenuFromPositions();
    if (formData.hasEvent
        && formData.program?.hasFiller
        && formData.pinataMode === 'park'
        && !formData.pinataFiller
        && !isClientPinataFillerNumber(formData.pinataFillerNumber)) {
        showNotification('Оберіть наповнювач для піньяти', 'error'); unlockSubmitBtn(); return;
    }
    // v8.7: Require second animator for multi-host programs
    if (formData.hasEvent && formData.program?.hosts > 1 && !formData.secondAnimator) {
        showNotification('Оберіть другого аніматора — ця програма потребує 2 ведучих', 'error'); unlockSubmitBtn(); return;
    }

    // [FIX] Заборона бронювання в минулому
    if (!AppState.editingBookingId) {
        const pastValidationError = bookingCreatePastValidationError(formData, AppState.selectedDate);
        if (pastValidationError) {
            showNotification(pastValidationError, 'error');
            unlockSubmitBtn();
            return;
        }
    }

    // v7.10: Check if animator is off duty on this date
    if (formData.hasEvent) {
        await checkAnimatorAvailability(formData.lineId, formData.secondAnimator);
    }

    // v5.5: exclude current root; banquet edit excludes the full persisted member set.
    const excludeId = bookingEditConflictExcludeIds();

    if (formData.hasEvent && formData.duration > 0) {
        // Валідація конфліктів
        const valid = await validateBookingConflicts(
            formData.lineId, formData.time, formData.duration,
            formData.program, formData.secondAnimator, excludeId
        );
        if (!valid) { unlockSubmitBtn(); return; }

        // Перевірка дублікатів
        const noDuplicate = await checkDuplicateProgram(
            formData.programId, formData.program, formData.time, formData.duration, excludeId
        );
        if (!noDuplicate) { unlockSubmitBtn(); return; }

        const activityScheduleValid = await validateSelectedActivityScheduleBeforeSubmit(formData, excludeId);
        if (!activityScheduleValid) { unlockSubmitBtn(); return; }
    }

    try {
        const booking = buildBookingObject(formData, formData.program);

        const editingBookingId = AppState.editingBookingId || null;
        let oldBooking = null;
        let shouldUpdateExistingBooking = Boolean(editingBookingId);

        if (editingBookingId) {
            // ===== РЕЖИМ РЕДАГУВАННЯ (v5.5) =====
            booking.id = editingBookingId;

            // Зберегти оригінального автора
            const oldBookings = await getBookingsForDate(AppState.selectedDate, { force: true });
            oldBooking = BookingDrawerState.banquetEditContext?.primaryBooking
                || oldBookings.find(b => b.id === booking.id);
            if (oldBooking) {
                booking.createdBy = oldBooking.createdBy;
                booking.createdAt = oldBooking.createdAt;
                // v8.3.2: Don't restore old extraData — respect user's choice to clear sizes
            } else {
                resetBookingEditStateForCreate();
                delete booking.id;
                shouldUpdateExistingBooking = false;
                showNotification('Попереднє бронювання вже скасоване або недоступне. Створюю нове бронювання.', 'warning');
            }
        }

        if (shouldUpdateExistingBooking) {
            const editPath = typeof resolveBookingEditPath === 'function'
                ? resolveBookingEditPath({
                    editingBookingId: booking.id,
                    banquetEditContext: BookingDrawerState.banquetEditContext
                })
                : { kind: 'single_booking_update', blocked: false };
            if (editPath.blocked) {
                showNotification(editPath.error || 'Контекст редагування банкету неповний. Відкрийте форму ще раз.', 'error');
                unlockSubmitBtn();
                return;
            }
            const banquetEditContext = BookingDrawerState.banquetEditContext;
            if (banquetEditContext?.unresolvedActivityProgramIds?.length) {
                showNotification('Збереження заблоковано: частина активностей банкету відсутня в каталозі.', 'error');
                unlockSubmitBtn();
                return;
            }
            const updateResult = editPath.kind === 'banquet_booking_set'
                ? await apiUpdateBanquetBookingSet(
                    editPath.groupId,
                    buildBanquetBookingSetPayload(booking, formData, banquetEditContext)
                )
                : await apiUpdateBooking(booking.id, booking);
            if (!updateResult || updateResult.success === false) {
                if (updateResult?.code === 'BANQUET_BOOKING_SET_VERSION_CONFLICT') {
                    await handleBanquetBookingSetConflict(updateResult, banquetEditContext);
                    unlockSubmitBtn();
                    return;
                }
                // Optimistic locking: check if it's a version conflict
                if (updateResult?.conflict) {
                    await handleOptimisticLockConflict(updateResult, booking);
                    unlockSubmitBtn();
                    return;
                }
                if (updateResult?.code === 'cancelled_booking_cannot_be_restored' || updateResult?.currentStatus === 'cancelled') {
                    resetBookingEditStateForCreate();
                    showNotification('Це бронювання вже скасоване. Режим редагування скинуто, створіть нове бронювання.', 'warning');
                    unlockSubmitBtn();
                    return;
                }
                showNotification(updateResult?.error || 'Помилка оновлення бронювання', 'error');
                if (updateResult?.conflictBookingId) revealHiddenBooking(updateResult.conflictBookingId);
                unlockSubmitBtn(); return;
            }
            // Update stored updatedAt from server response
            if (editPath.kind === 'banquet_booking_set') {
                AppState.editingBookingUpdatedAt = updateResult?.primaryBooking?.updatedAt || AppState.editingBookingUpdatedAt;
            } else if (updateResult && updateResult.booking) {
                AppState.editingBookingUpdatedAt = updateResult.booking.updatedAt;
            }
            if (editPath.kind !== 'banquet_booking_set') {
                await apiAddHistory('edit', AppState.currentUser?.username, booking);
            }

            // v5.51: Save undo for edit (store old state)
            if (oldBooking) pushUndo('edit', { old: { ...oldBooking }, updated: { ...booking } });

            restoreTimelineDateAfterBookingSave(selectedDateBeforeSave || booking.date);
            invalidateBookingBanquetPreviewFreshness({
                bookingIds: bookingMutationBookingIds(updateResult, [booking.id, oldBooking?.id]),
                groupId: banquetEditContext?.groupId
            });
            invalidateBookingTimelineDateCache(AppState.selectedDate, { lines: false });
            if (editPath.kind === 'banquet_booking_set') {
                const refreshedContext = await refreshBanquetEditContextAfterSave(updateResult, banquetEditContext);
                if (!refreshedContext) {
                    unlockSubmitBtn();
                    return;
                }
                AppState.editingBookingUpdatedAt = refreshedContext.primaryBooking?.updatedAt
                    || AppState.editingBookingUpdatedAt;
            }
            AppState.editingBookingId = null;
            closeBookingPanel(true);
            unlockSubmitBtn();
            await renderTimeline();
            showNotification(editPath.kind === 'banquet_booking_set' ? 'Склад банкету оновлено!' : 'Бронювання оновлено!', 'success');
        } else {
            if (editingBookingId) {
                const pastValidationError = bookingCreatePastValidationError(formData, AppState.selectedDate);
                if (pastValidationError) {
                    showNotification(pastValidationError, 'error');
                    unlockSubmitBtn();
                    return;
                }
            }
            // ===== РЕЖИМ СТВОРЕННЯ (v5.7: transactional with linked) =====
            let createResult;
            const bridgeContext = BookingDrawerState.roomBookingAnimationBridge;
            const selectedBanquetContext = selectedBookingBanquetGroupContext();
            const selectedBanquetContextSource = selectedBanquetContext.source || 'booking_banquet_group_selector';
            const selectedActivityPrograms = (formData.activityPrograms || []).filter(Boolean);
            const activityFirstKitchenBridge = validateActivityFirstKitchenBridge(formData, selectedBanquetContext);
            const kitchenFirstActivityBridge = validateKitchenFirstActivityBridge(formData, selectedBanquetContext);
            const createPath = resolveBookingCreatePath({
                formData,
                selectedBanquetContext,
                selectedActivityPrograms,
                activityFirstKitchenBridge,
                kitchenFirstActivityBridge
            }, BookingDrawerState);

            if (createPath.blocked) {
                showNotification(createPath.error || 'Не вдалося визначити шлях створення бронювання. Перевірте клієнта, кімнату і прив’язку до банкету.', 'error');
                unlockSubmitBtn();
                return;
            }

            if (createPath.kind === 'existing_group_activity') {
                setBookingDrawerMode(BOOKING_DRAWER_MODES.EXISTING_GROUP_ACTIVITY);
                const bridgeGroupId = createPath.groupId;
                const bridgeSourceBookingId = createPath.sourceBookingId;
                const existingActivityContextSource = createPath.reason === 'real_group_activity_from_room_bridge'
                    ? 'room_booking_animation_bridge'
                    : selectedBanquetContextSource;
                attachBanquetGroupContextToBooking(booking, {
                    ...selectedBanquetContext,
                    groupId: bridgeGroupId,
                    sourceBookingId: bridgeSourceBookingId
                }, 'activity', existingActivityContextSource);
                const linked = await buildLinkedBookings(booking, formData.program);
                createResult = await apiCreateBanquetActivityBooking(bridgeGroupId, {
                    sourceBookingId: bridgeSourceBookingId,
                    booking,
                    linkedBookings: linked
                });
            } else if (createPath.kind === 'source_kitchen_to_activity') {
                setBookingDrawerMode(BOOKING_DRAWER_MODES.KITCHEN_FIRST_ACTIVITY_BRIDGE);
                const sourceContext = createPath.context || kitchenFirstActivityBridge.context;
                attachBanquetGroupContextToBooking(booking, sourceContext, 'activity', 'kitchen_first_activity_bridge');
                const linked = await buildLinkedBookings(booking, formData.program);
                const banquetContext = await newBanquetContextFromArrivalDraft({
                    prompt: true,
                    defaultTime: bridgeContext?.sourceTime || booking.time,
                    source: 'kitchen_first_activity_bridge'
                });
                if (!banquetContext) { unlockSubmitBtn(); return; }
                createResult = await apiCreateBanquetActivityBookingFromSource({
                    sourceBookingId: createPath.sourceBookingId,
                    booking,
                    linkedBookings: linked,
                    banquetContext
                });
            } else if (createPath.kind === 'source_activity_to_kitchen') {
                setBookingDrawerMode(BOOKING_DRAWER_MODES.ACTIVITY_FIRST_KITCHEN_BRIDGE);
                const sourceContext = createPath.context || activityFirstKitchenBridge.context;
                attachBanquetGroupContextToBooking(booking, sourceContext, 'kitchen', 'activity_first_kitchen_bridge');
                const banquetContext = await newBanquetContextFromArrivalDraft({
                    prompt: true,
                    defaultTime: sourceContext?.time || booking.time,
                    source: 'activity_first_kitchen_bridge'
                });
                if (!banquetContext) { unlockSubmitBtn(); return; }
                createResult = await apiCreateBanquetMemberBookingFromSource({
                    sourceBookingId: createPath.sourceBookingId,
                    role: 'kitchen',
                    booking,
                    banquetContext
                });
            } else if (shouldCreateEducationLessonSeries(booking)) {
                createResult = await apiCreateEducationLessonSeries(booking);
            } else if (createPath.kind === 'existing_group_member') {
                setBookingDrawerMode(BOOKING_DRAWER_MODES.EXISTING_GROUP_MEMBER);
                attachBanquetGroupContextToBooking(booking, selectedBanquetContext, 'kitchen', selectedBanquetContextSource);
                createResult = await apiCreateBanquetMemberBooking(createPath.groupId, {
                    sourceBookingId: createPath.sourceBookingId || null,
                    role: 'kitchen',
                    booking
                });
            } else {
                const linked = await buildLinkedBookings(booking, formData.program);
                const banquetActivities = buildMultiActivityBookings(booking, formData);
                const finalCreatePath = resolveBookingCreatePath({
                    formData,
                    selectedBanquetContext,
                    selectedActivityPrograms,
                    activityFirstKitchenBridge,
                    kitchenFirstActivityBridge,
                    fullBookingRequired: linked.length > 0 || banquetActivities.length > 0
                }, BookingDrawerState);
                if (finalCreatePath.blocked) {
                    showNotification(finalCreatePath.error || 'Не вдалося визначити безпечний шлях створення бронювання.', 'error');
                    unlockSubmitBtn();
                    return;
                }
                const banquetContext = BookingDrawerState.banquetCreationMode === 'new'
                    ? await newBanquetContextFromArrivalDraft({ source: 'booking_create' })
                    : null;
                if (BookingDrawerState.banquetCreationMode === 'new' && !banquetContext) {
                    unlockSubmitBtn();
                    return;
                }
                if (finalCreatePath.kind === 'full_booking') {
                    createResult = await apiCreateBookingFull(booking, linked, { banquetActivities, banquetContext });
                } else {
                    createResult = await apiCreateBooking(booking, { banquetContext });
                }
            }

            if (createResult && createResult.success === false) {
                if (createResult.conflictBookingId) revealHiddenBooking(createResult.conflictBookingId);
                showNotification(createResult.error || 'Помилка створення бронювання', 'error');
                unlockSubmitBtn(); return;
            }
            if (!createResultConfirmed(createResult)) {
                console.error('Booking create returned no durable booking confirmation', createResult);
                showNotification('Сервер не підтвердив створення бронювання. Таймлайн не оновлено — перевірте поля і спробуйте ще раз.', 'error');
                unlockSubmitBtn(); return;
            }
            // v5.27: API now returns { booking: { id, ... } }
            if (createResult && createResult.booking) {
                booking.id = createResult.booking.id;
            } else if (createResult && createResult.mainBooking) {
                booking.id = createResult.mainBooking.id;
            } else if (createResult && createResult.id) {
                booking.id = createResult.id;
            }
            // History + Telegram handled by server

            const createdRecords = collectCreatedBookingRecords(createResult);
            const createdBookings = createdRecords.length
                ? createdRecords.map(item => ({ ...booking, ...item }))
                : [booking];
            pushUndo('create', createdBookings);
            invalidateBookingBanquetPreviewFreshness({
                bookingIds: bookingMutationBookingIds(createResult, createdBookings.map(item => item?.id || item?.bookingId))
            });

            restoreTimelineDateAfterBookingSave(selectedDateBeforeSave || booking.date);
            const changedDates = new Set(createdBookings.map(item => normalizeBookingDateKey(item.date) || formatDate(AppState.selectedDate)));
            const selectedDateKey = formatDate(AppState.selectedDate);
            changedDates.add(selectedDateKey);
            changedDates.forEach(date => {
                const changedDateKey = normalizeBookingDateKey(date);
                invalidateBookingTimelineDateCache(changedDateKey, {
                    bookings: changedDateKey !== selectedDateKey
                });
            });
            const timelineSnapshot = await refreshCreatedBookingTimelineSnapshot(createdBookings);
            closeBookingPanel(true);
            unlockSubmitBtn();
            clearLeadConversionContextAfterBooking(booking.id);
            await renderTimeline();
            const seriesCount = createResult?.createdCount || createdBookings.length;
            let visibility = revealCreatedBookingBlocks(createdBookings);
            if (visibility.expectedCount > 0 && visibility.visibleCount === 0) {
                const recoveredSnapshot = await refreshCreatedBookingTimelineSnapshot(createdBookings);
                if (recoveredSnapshot.foundIds?.size) {
                    await renderTimeline();
                    visibility = revealCreatedBookingBlocks(createdBookings);
                    timelineSnapshot.bookings = recoveredSnapshot.bookings;
                    timelineSnapshot.bookingsById = recoveredSnapshot.bookingsById;
                    timelineSnapshot.foundIds = recoveredSnapshot.foundIds;
                    timelineSnapshot.missingIds = recoveredSnapshot.missingIds;
                    timelineSnapshot.lines = recoveredSnapshot.lines;
                    timelineSnapshot.lineIds = recoveredSnapshot.lineIds;
                }
            }
            if (visibility.expectedCount > 0 && visibility.visibleCount === 0) {
                console.error('Created booking is not visible after timeline refresh', {
                    createdBookings: createdBookings.map(createdBookingDiagnosticSummary),
                    visibility,
                    diagnostics: createdBookingVisibilityDiagnostics(createdBookings, timelineSnapshot)
                });
                await waitForCreatedBookingBlocks(createdBookings);
                visibility = revealCreatedBookingBlocks(createdBookings);
            }
            if (visibility.expectedCount > 0 && visibility.visibleCount === 0) {
                showNotification(createdBookingVisibilityMessage(createdBookings, timelineSnapshot), 'warning');
            } else {
                showNotification(createdBookingSuccessMessage(createdBookings, seriesCount), 'success');
            }
        }
    } catch (error) {
        handleError('Збереження бронювання', error);
        unlockSubmitBtn();
    }
}

if (typeof window !== 'undefined') window.handleBookingSubmit = handleBookingSubmit;

// ==========================================
// OPTIMISTIC LOCKING CONFLICT HANDLER
// ==========================================

async function handleBanquetBookingSetConflict(result, context = BookingDrawerState.banquetEditContext) {
    const reload = await customConfirm(
        'Склад банкету вже змінив інший користувач. Ваші дані не збережено. Завантажити свіжий склад банкету?',
        'Конфлікт редагування банкету',
        'Завантажити свіжі дані',
        'Залишитись у формі'
    );
    if (!reload) {
        showNotification('Зміни не збережено. Форма залишилась відкритою.', 'warning');
        return false;
    }
    const bookingId = context?.primaryBookingId || context?.anchorBookingId || AppState.editingBookingId;
    if (!bookingId || typeof apiGetBanquetByBooking !== 'function') {
        showNotification('Не вдалося визначити банкет для оновлення. Відкрийте форму ще раз.', 'error');
        return false;
    }
    invalidateBookingBanquetPreviewFreshness({
        bookingIds: context?.allBookingIds || [bookingId],
        groupId: context?.groupId
    });
    invalidateBookingTimelineDateCache(AppState.selectedDate, { lines: false });
    const snapshot = await apiGetBanquetByBooking(bookingId);
    if (!snapshot || snapshot.success === false || !banquetSnapshotHasGroup(snapshot)) {
        showNotification(snapshot?.error || 'Не вдалося завантажити свіжий snapshot банкету.', 'error');
        return false;
    }
    if (window.BookingForm?.markClean) BookingForm.markClean();
    await closeBookingPanel(true);
    await renderTimeline();
    await editBooking(bookingId);
    showNotification('Форму оновлено зі свіжого snapshot банкету.', 'info');
    return true;
}

async function handleOptimisticLockConflict(result, localBooking) {
    const serverData = result.currentData;
    if (!serverData) {
        showNotification('Бронювання було змінено іншим користувачем. Оновіть сторінку.', 'error');
        return;
    }

    // Build a summary of what changed
    const changes = [];
    if (serverData.time !== localBooking.time) changes.push(`Час: ${serverData.time}`);
    if (serverData.room !== localBooking.room) changes.push(`Кімната: ${serverData.room}`);
    if (serverData.status !== localBooking.status) changes.push(`Статус: ${serverData.status}`);
    if (serverData.lineId !== localBooking.lineId) changes.push('Лінія змінена');
    if (serverData.notes !== localBooking.notes) changes.push('Примітки змінені');
    if (serverData.kidsCount !== localBooking.kidsCount) changes.push(`К-сть дітей: ${serverData.kidsCount}`);

    const changesText = changes.length > 0
        ? `\n\nЗміни на сервері:\n${changes.map(c => `  - ${c}`).join('\n')}`
        : '';

    const message = `Бронювання було змінено іншим користувачем.${changesText}\n\nЩо зробити?`;

    // Show custom conflict dialog with two options
    const overwrite = await customConfirm(
        message,
        'Конфлікт редагування',
        'Перезаписати',
        'Оновити дані'
    );

    if (overwrite) {
        // Force overwrite: re-send with current server's updatedAt
        localBooking.updatedAt = serverData.updatedAt;
        const retryResult = await apiUpdateBooking(localBooking.id, localBooking);
        if (retryResult && retryResult.success) {
            invalidateBookingBanquetPreviewFreshness({
                bookingIds: bookingMutationBookingIds(retryResult, [localBooking.id])
            });
            invalidateBookingTimelineDateCache(AppState.selectedDate, { lines: false });
            closeBookingPanel(true);
            await renderTimeline();
            showNotification('Бронювання перезаписано!', 'success');
        } else if (retryResult && retryResult.conflict) {
            // Another conflict happened -- extremely unlikely
            showNotification('Повторний конфлікт. Оновіть сторінку.', 'error');
        } else {
            showNotification(retryResult?.error || 'Помилка збереження', 'error');
        }
    } else {
        // Refresh data: reload bookings and re-open edit form
        invalidateBookingTimelineDateCache(AppState.selectedDate, { lines: false });
        await renderTimeline();
        // Re-open editing with fresh data
        await editBooking(localBooking.id);
        showNotification('Дані оновлено з сервера', 'info');
    }
}

async function checkConflicts(lineId, time, duration, excludeId = null) {
    if (String(lineId || '').trim() === ROOM_FIRST_BANQUET_SERVICE_LINE_ID) {
        return { overlap: false, noPause: false, conflictWith: null };
    }
    const allBookings = isRoomFirstTimelineView()
        ? (await apiGetBookings(formatDate(AppState.selectedDate), { timelineView: 'animators', fresh: true }) || [])
        : await getBookingsForDate(AppState.selectedDate);
    const excludeIds = new Set((Array.isArray(excludeId) ? excludeId : [excludeId])
        .map(normalizeBookingIdentity)
        .filter(Boolean));
    const bookings = allBookings.filter(b => b.lineId === lineId && !excludeIds.has(normalizeBookingIdentity(b.id)));
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;

    let overlap = false;
    let noPause = false;
    let conflictWith = null;

    for (const b of bookings) {
        const start = timeToMinutes(b.time);
        const end = start + b.duration;

        if (newStart < end && newEnd > start) {
            overlap = true;
            conflictWith = b;
            break;
        }

        if (newStart === end || newEnd === start) {
            noPause = true;
        }
        if (newStart > end && newStart < end + CONFIG.MIN_PAUSE) {
            noPause = true;
        }
        if (newEnd > start - CONFIG.MIN_PAUSE && newEnd <= start) {
            noPause = true;
        }
    }

    return { overlap, noPause, conflictWith };
}

function shouldEditBookingInAnimatorView(booking = {}) {
    return isRoomFirstTimelineView()
        && String(booking.lineId || '') !== ROOM_FIRST_BANQUET_SERVICE_LINE_ID
        && Boolean(booking.programId);
}

function canAddAnimationFromRoomBooking(booking = {}) {
    return isRoomFirstTimelineView()
        && String(booking.lineId || '') === ROOM_FIRST_BANQUET_SERVICE_LINE_ID
        && !String(booking.linkedTo || '').trim()
        && Boolean(booking.room);
}

function banquetGroupIdFromSnapshot(snapshot = {}) {
    return snapshot.groupId
        || snapshot.group?.id
        || snapshot.banquetGroup?.groupId
        || snapshot.banquetGroup?.group?.id
        || null;
}

async function openAnimationBookingInAnimatorView(bookingId, action = 'details') {
    showNotification('Перемикаю у «Свята», бо анімація редагується там.', 'info');
    closeAllModals();
    if (window.TimelineView?.set) {
        await window.TimelineView.set('animators');
    } else if (typeof renderTimeline === 'function') {
        await renderTimeline();
    }

    if (action === 'edit') return editBooking(bookingId);
    if (action === 'duplicate') return duplicateBooking(bookingId);
    if (typeof revealHiddenBooking === 'function') revealHiddenBooking(bookingId);
    return showBookingDetails(bookingId);
}

async function openRoomBookingAnimationBridge(bookingId) {
    const bookings = await getBookingsForDate(AppState.selectedDate);
    const sourceBooking = bookings.find(b => String(b.id) === String(bookingId));
    if (!sourceBooking) return;

    showNotification('Перемикаю у «Свята» і підтягую кімнату та клієнта.', 'info');
    const currentGroupSnapshot = typeof apiGetBanquetByBooking === 'function'
        ? await apiGetBanquetByBooking(sourceBooking.id)
        : null;
    const existingGroupId = currentGroupSnapshot?.success === false
        ? null
        : banquetGroupIdFromSnapshot(currentGroupSnapshot || {});
    closeAllModals();
    if (window.TimelineView?.set) {
        await window.TimelineView.set('animators');
    } else if (typeof renderTimeline === 'function') {
        await renderTimeline();
    }

    const lines = await getLinesForDate(AppState.selectedDate);
    const targetLine = (lines || []).find(line =>
        line
        && String(line.id || '') !== ROOM_FIRST_BANQUET_SERVICE_LINE_ID
        && String(line.id || '') !== 'afisha'
    );
    if (!targetLine) {
        showNotification('Немає активної лінії аніматора для програми.', 'error');
        return;
    }

    AppState.editingBookingId = null;
    const opened = await openBookingPanel(sourceBooking.time, targetLine.id, {
        drawerMode: BOOKING_DRAWER_MODES.KITCHEN_FIRST_ACTIVITY_BRIDGE
    });
    if (!opened) return;
    setBookingDrawerMode(BOOKING_DRAWER_MODES.KITCHEN_FIRST_ACTIVITY_BRIDGE);
    const bridgeSourceContext = setBookingRoomSourceContext(sourceBooking, {
        sourceRole: 'kitchen',
        source: 'kitchen_first_activity_bridge',
        groupId: existingGroupId || sourceBooking.banquetGroupId || sourceBooking.banquet_group_id || null
    });
    BookingDrawerState.roomBookingAnimationBridge = {
        groupId: existingGroupId || sourceBooking.banquetGroupId || sourceBooking.banquet_group_id || null,
        sourceBookingId: sourceBooking.id,
        sourceBooking,
        sourceTime: sourceBooking.time || '',
        sourceRoom: sourceBooking.room || null,
        sourceCustomerId: roomBookingCustomerId(sourceBooking),
        sourceCustomerName: sourceBooking.customerName || sourceBooking.customer_name || null,
        roomSourceContext: bridgeSourceContext,
        generationId: bridgeSourceContext?.generationId || null,
        sourceRole: 'kitchen',
        date: bridgeSourceContext?.date || bookingBanquetGroupDateValue(),
        room: bridgeSourceContext?.room || sourceBooking.room || null,
        time: bridgeSourceContext?.time || sourceBooking.time || '',
        source: 'kitchen_first_activity_bridge'
    };
    BookingDrawerState.selectedBanquetGroupId = BookingDrawerState.roomBookingAnimationBridge.groupId || '';

    if (sourceBooking.room) {
        ensureTimelineRoomOption(sourceBooking.room);
        const roomSelect = document.getElementById('roomSelect');
        if (roomSelect) roomSelect.value = sourceBooking.room;
        await refreshBookingRoomAvailabilityForSelectedDate({ selectedRoom: sourceBooking.room });
    }
    const groupInput = document.getElementById('bookingGroupName');
    if (groupInput) groupInput.value = '';
    const notes = document.getElementById('bookingNotes');
    if (notes) notes.value = '';
    syncBookingCommentFieldPresentation(getBookingFormData());
    await hydrateBookingCustomerSelection(sourceBooking, { renderSummary: false });
    await refreshBookingBanquetGroupCandidates({
        preselectGroupId: BookingDrawerState.roomBookingAnimationBridge.groupId || '',
        preserveSelection: false
    });
    renderBookingCustomerSearchState('Клієнта підтягнуто з кімнатної броні. Можна змінити вручну.');
    renderBookingPackageSummary();

    const title = document.querySelector('#bookingPanel .panel-header h3');
    if (title) title.textContent = 'Додати активну програму';
    const submit = document.querySelector('#bookingForm .btn-submit');
    if (submit) submit.textContent = 'Створити програму';
    if (window.BookingForm?.markClean) BookingForm.markClean();
}

// v43.5.0: Reveal a booking that is currently hidden by status filter
// so user can see what's blocking the slot.
function revealHiddenBooking(bookingId) {
    const block = document.querySelector(`.booking-block[data-booking-id="${bookingId}"]`);
    if (!block) return;
    if (block.classList.contains('status-hidden')) {
        block.classList.remove('status-hidden');
        block.classList.add('conflict-flash');
        setTimeout(() => {
            block.classList.remove('conflict-flash');
            applyStatusFilter();
        }, 3000);
    } else {
        block.classList.add('conflict-flash');
        setTimeout(() => block.classList.remove('conflict-flash'), 1500);
    }
}

function findRoomServiceMarkerForBooking(bookingId, groupId = '') {
    const selectorId = bookingBlockSelectorId(bookingId);
    if (!selectorId) return null;
    const directMarker = document.querySelector(`.timeline-room-service-marker[data-booking-id="${selectorId}"]`);
    if (directMarker) return directMarker;
    const bookingIdText = String(bookingId || '').trim();
    const markerByList = Array.from(document.querySelectorAll('.timeline-room-service-marker[data-booking-ids]')).find(marker => {
        const ids = String(marker.dataset.bookingIds || '').split(/\s+/).filter(Boolean);
        return ids.includes(bookingIdText);
    });
    if (markerByList) return markerByList;
    const selectorGroupId = bookingBlockSelectorId(groupId);
    return selectorGroupId
        ? document.querySelector(`.timeline-room-service-marker[data-banquet-room-marker-group="${selectorGroupId}"]`)
        : null;
}

function focusTimelineRevealElement(element) {
    if (!element) return false;
    element.classList.add('booking-block--just-created', 'conflict-flash');
    window.setTimeout(() => element.classList.remove('booking-block--just-created', 'conflict-flash'), 3000);
    if (element.scrollIntoView) {
        element.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
    if (typeof element.focus === 'function') {
        try {
            element.focus({ preventScroll: true });
        } catch {
            element.focus();
        }
    }
    return true;
}

function setTimelineDateForBookingReveal(dateKey) {
    const normalizedDate = normalizeBookingDateKey(dateKey);
    if (!normalizedDate || typeof AppState === 'undefined') return '';
    AppState.selectedDate = new Date(`${normalizedDate}T00:00:00`);
    const timelineDateInput = document.getElementById('timelineDate');
    if (timelineDateInput) timelineDateInput.value = normalizedDate;
    if (typeof setTimelineDateInUrl === 'function') {
        setTimelineDateInUrl(normalizedDate);
    } else if (typeof window !== 'undefined' && typeof window.setTimelineDateInUrl === 'function') {
        window.setTimelineDateInUrl(normalizedDate);
    }
    return normalizedDate;
}

async function showBookingInRoomTimeline(bookingId, dateKey = '') {
    const bookingIdText = String(bookingId || '').trim();
    if (!bookingIdText) return false;
    const normalizedDate = setTimelineDateForBookingReveal(dateKey || (typeof AppState !== 'undefined' ? AppState.selectedDate : ''));
    if (typeof closeAllModals === 'function') {
        await closeAllModals();
    } else {
        document.getElementById('bookingModal')?.classList.add('hidden');
    }

    if (window.TimelineView?.set) {
        await window.TimelineView.set('rooms', { render: typeof renderTimeline === 'function' ? false : true });
    }
    if (typeof renderTimeline === 'function') {
        await renderTimeline();
    }

    await new Promise(resolve => window.setTimeout(resolve, 0));
    let groupId = '';
    if (typeof apiGetBanquetByBooking === 'function') {
        try {
            const snapshot = await apiGetBanquetByBooking(bookingIdText);
            groupId = banquetGroupIdFromSnapshot(snapshot || {}) || '';
        } catch (err) {
            console.warn('Banquet reveal snapshot unavailable:', err);
        }
    }

    const block = findCreatedBookingBlock({ id: bookingIdText });
    if (block) {
        revealHiddenBooking(bookingIdText);
        focusTimelineRevealElement(block);
        if (typeof showNotification === 'function') showNotification('Показую бронювання у вкладці «Кімнати».', 'info');
        return true;
    }

    const marker = findRoomServiceMarkerForBooking(bookingIdText, groupId);
    if (focusTimelineRevealElement(marker)) {
        if (typeof showNotification === 'function') showNotification('Показую сервісний маркер у вкладці «Кімнати».', 'info');
        return true;
    }

    if (typeof showNotification === 'function') {
        showNotification(normalizedDate
            ? 'Перемкнув у «Кімнати», але маркер цієї броні не знайдено. Оновіть таймлайн або перевірте фільтри.'
            : 'Не вдалося визначити дату для показу бронювання в кімнатах.', 'warning');
    }
    return false;
}

window.showBookingInRoomTimeline = showBookingInRoomTimeline;

// ==========================================
// ДЕТАЛІ БРОНЮВАННЯ
// ==========================================

function renderBookingBanquetLinksDetail(booking, allBookings = []) {
    const links = Array.isArray(booking?.bookingLinks)
        ? booking.bookingLinks
        : [
            ...(Array.isArray(booking?.banquetLinks) ? booking.banquetLinks : []),
            ...(Array.isArray(booking?.sharedRoomLinks) ? booking.sharedRoomLinks : [])
        ];
    if (!links.length) return '';
    const byId = new Map((allBookings || []).map(item => [String(item.id), item]));
    const rows = links.map(link => {
        const targetId = String(link.targetId || '');
        const relationType = String(link.relationType || link.relation_type || 'banquet_activity');
        const relationLabel = relationType === 'shared_room_activity' ? 'та сама кімната' : 'банкет';
        const target = byId.get(targetId);
        const targetLabel = target
            ? `${target.time || ''} ${target.label || target.programCode || target.id}`.trim()
            : targetId;
        const unlinkAction = isViewer() ? '' : `
            <button type="button"
                    class="booking-banquet-unlink-btn"
                    onclick="removeBookingBanquetLink('${escapeHtml(String(booking.id))}', '${escapeHtml(targetId)}', '${escapeHtml(relationType)}')">
                Прибрати
            </button>`;
        return `
            <div class="booking-banquet-link-chip booking-banquet-link-chip--${relationType === 'shared_room_activity' ? 'room' : 'banquet'}">
                <span class="booking-banquet-link-mark">↔</span>
                <span class="booking-banquet-link-target">${escapeHtml(targetLabel)}</span>
                <span class="booking-link-chip-badge">${escapeHtml(relationLabel)}</span>
                ${unlinkAction}
            </div>`;
    }).join('');
    return `
        <div class="booking-banquet-links-detail">
            <div class="booking-banquet-links-title">Повʼязані бронювання</div>
            <div class="booking-banquet-links-list">${rows}</div>
        </div>`;
}

function bookingDetailId(booking = {}) {
    return String(booking.id || booking.bookingId || '').trim();
}

function bookingDetailContext(booking = {}) {
    return String(
        booking.businessContext
        || booking.business_context
        || booking.timelineIdentity?.businessContext
        || window.TimelineBusinessContext?.current?.()?.apiValue
        || 'event_genix'
    ).trim();
}

function bookingDetailDate(booking = {}) {
    return String(booking.date || '').slice(0, 10);
}

function bookingDetailCustomerId(booking = {}) {
    const value = booking.customerId ?? booking.customer_id;
    return value == null || value === '' ? null : String(value);
}

function bookingDetailIsRoot(booking = {}) {
    return !String(booking.linkedTo || booking.linked_to || '').trim();
}

function bookingDetailTitle(booking = {}) {
    return [
        booking.time,
        booking.label || booking.programName || booking.programCode || booking.room || booking.id
    ].filter(Boolean).join(' · ');
}

function bookingDetailActivityCommentTitle(booking = {}) {
    return String(
        booking.label
        || booking.programName
        || booking.program_name
        || booking.programCode
        || booking.program_code
        || booking.room
        || booking.id
        || 'Активність'
    ).trim();
}

function bookingDetailStatusLabel(booking = {}) {
    const status = String(booking.status || '').toLowerCase();
    if (status === 'cancelled') return 'Скасовано';
    if (status === 'preliminary') return 'Попереднє';
    if (status === 'closed') return 'Закрито';
    return 'Підтверджене';
}

function bookingDetailRoleLabel(role) {
    const labels = {
        primary: 'Основна',
        kitchen: 'Кухня / меню',
        activity: 'Активність',
        service: 'Сервіс',
        manual: 'Ручний звʼязок',
        technical: 'Технічне linked_to'
    };
    return labels[role] || role || 'Бронювання';
}

function bookingDetailExtraDataObject(booking = {}) {
    const raw = booking.extraData !== undefined && booking.extraData !== null && booking.extraData !== ''
        ? booking.extraData
        : (booking.extra_data || {});
    if (!raw) return {};
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function bookingDetailWorkspaceComments(booking = {}) {
    const extra = bookingDetailExtraDataObject(booking);
    const workspace = extra.bookingWorkspace || extra.booking_workspace || {};
    const comments = workspace?.comments || {};
    return comments && typeof comments === 'object' && !Array.isArray(comments) ? comments : {};
}

function bookingDetailCleanComment(value, maxLength = 2000) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, maxLength) : '';
}

function bookingDetailWorkspaceComment(booking = {}, type = 'internal') {
    if (!['kitchen', 'activity', 'internal'].includes(type)) return '';
    return bookingDetailCleanComment(bookingDetailWorkspaceComments(booking)[type]);
}

function bookingDetailLegacyComment(booking = {}) {
    return bookingDetailCleanComment(booking.notes);
}

function bookingDetailPackagePositionCount(booking = {}) {
    const pkg = getBookingPackageFromBooking(booking);
    return Array.isArray(pkg?.menuPositions) ? pkg.menuPositions.length : 0;
}

function bookingDetailIsKitchenCandidate(booking = {}) {
    return bookingDetailPackagePositionCount(booking) > 0
        || Boolean(String(booking.banquetMenu || booking.banquet_menu || '').trim())
        || booking.banquetGuests != null
        || booking.banquet_guests != null
        || booking.banquetAdults != null
        || booking.banquet_adults != null
        || booking.banquetTables != null
        || booking.banquet_tables != null;
}

function bookingDetailDefaultAttachRole(booking = {}) {
    if (bookingDetailIsKitchenCandidate(booking)) return 'kitchen';
    if (booking.programId || booking.program_id || booking.programName || booking.program_name || Number(booking.price || 0) > 0) return 'activity';
    return 'manual';
}

function bookingDetailIsEntertainmentBooking(booking = {}, role = '') {
    const normalizedRole = String(role || '').trim().toLowerCase();
    if (!booking || typeof booking !== 'object') return false;
    if (bookingDetailIsKitchenCandidate(booking)) return false;
    if (['kitchen', 'service', 'manual', 'technical'].includes(normalizedRole)) return false;
    if (normalizedRole === 'activity') return true;
    return bookingDetailIsActivityWithRoomContext(booking);
}

function bookingDetailEntertainmentMembers(primaryMembers = [], activityMembers = []) {
    const result = [];
    const seen = new Set();
    [...primaryMembers, ...activityMembers].forEach((member, index) => {
        const booking = member?.booking || member;
        const role = member?.role || (member?.isPrimary ? 'primary' : '');
        if (!bookingDetailIsEntertainmentBooking(booking, role)) return;
        const id = bookingDetailId(booking) || `entertainment:${index}`;
        if (seen.has(id)) return;
        seen.add(id);
        result.push({ ...member, booking, role: role || 'activity' });
    });
    return result;
}

function bookingDetailDurationLabel(booking = {}) {
    const duration = Number(booking.duration ?? booking.durationMinutes ?? booking.duration_minutes);
    if (!Number.isFinite(duration) || duration <= 0) return '';
    return `${duration} хв`;
}

function bookingDetailActivityProduct(booking = {}) {
    const programId = String(booking.programId || booking.program_id || '').trim();
    if (!programId || typeof getProductsSync !== 'function') return null;
    const products = getProductsSync();
    if (!Array.isArray(products)) return null;
    return products.find(product => String(product?.id || '').trim() === programId) || null;
}

function bookingDetailActivityPositiveNumber() {
    for (const value of arguments) {
        const number = Number(String(value ?? '').replace(',', '.'));
        if (Number.isFinite(number) && number > 0) return number;
    }
    return 0;
}

function bookingDetailActivityPerChildFlag(booking = {}, product = null) {
    return Boolean(
        booking.perChild
        || booking.per_child
        || booking.isPerChild
        || booking.is_per_child
        || product?.perChild
        || product?.isPerChild
        || product?.is_per_child
    );
}

function bookingDetailActivityExplicitUnitPrice(booking = {}) {
    return bookingDetailActivityPositiveNumber(
        booking.unitPrice,
        booking.unit_price,
        booking.pricePerChild,
        booking.price_per_child
    );
}

function bookingDetailActivityUnitPrice(booking = {}, product = null, subtotal = 0, kidsCount = 0) {
    const explicit = bookingDetailActivityExplicitUnitPrice(booking);
    if (explicit > 0) return bookingPackageMoneyValue(explicit);
    const productPrice = bookingDetailActivityPositiveNumber(product?.price);
    if (bookingDetailActivityPerChildFlag(booking, product) && productPrice > 0) return bookingPackageMoneyValue(productPrice);
    if (bookingDetailActivityPerChildFlag(booking, product) && kidsCount > 0 && subtotal > 0) return bookingPackageMoneyValue(subtotal / kidsCount);
    return bookingPackageMoneyValue(subtotal);
}

function bookingDetailActivityUsesPerChild(booking = {}, product = null, subtotal = 0, kidsCount = 0, unitPrice = 0) {
    if (bookingDetailActivityPerChildFlag(booking, product)) return true;
    const explicit = bookingDetailActivityExplicitUnitPrice(booking);
    if (explicit > 0 && kidsCount > 0 && bookingPackageMoneyValue(unitPrice * kidsCount) === bookingPackageMoneyValue(subtotal)) return true;
    return false;
}

function bookingDetailEntertainmentRowsFromMembers(entertainmentMembers = [], packageBooking = null) {
    const packageBookingId = bookingDetailId(packageBooking);
    const packageData = packageBooking ? getBookingPackageFromBooking(packageBooking) : null;
    const packageProgramBasePrice = bookingPackageMoneyValue(packageData?.programBasePrice ?? packageData?.program_base_price ?? 0);
    return (Array.isArray(entertainmentMembers) ? entertainmentMembers : [])
        .map(member => {
            const booking = member?.booking || member;
            if (!booking) return null;
            const bookingId = bookingDetailId(booking);
            const samePackageBooking = Boolean(bookingId && packageBookingId && bookingId === packageBookingId);
            const subtotal = samePackageBooking && packageProgramBasePrice > 0
                ? packageProgramBasePrice
                : bookingPackageMoneyValue(booking.price ?? booking.amount ?? 0);
            const product = bookingDetailActivityProduct(booking);
            const kidsCount = bookingDetailActivityPositiveNumber(booking.kidsCount, booking.kids_count);
            const unitPrice = bookingDetailActivityUnitPrice(booking, product, subtotal, kidsCount);
            const perChild = bookingDetailActivityUsesPerChild(booking, product, subtotal, kidsCount, unitPrice);
            const quantityLabel = perChild && kidsCount > 0
                ? `${formatBookingMenuQuantityNumber(kidsCount)} дітей`
                : '1 програма';
            const unitPriceLabel = perChild && unitPrice > 0
                ? `${formatPrice(unitPrice)}/дит`
                : formatPrice(subtotal);
            return {
                id: bookingId || bookingDetailTitle(booking),
                bookingId,
                title: bookingDetailActivityCommentTitle(booking),
                time: booking.time || '',
                room: bookingDetailRoomName(booking),
                durationLabel: bookingDetailDurationLabel(booking),
                quantityLabel,
                unitPrice,
                unitPriceLabel,
                subtotal,
                subtotalLabel: formatPrice(subtotal),
                includedInPackage: samePackageBooking
            };
        })
        .filter(Boolean);
}

function bookingDetailTimelineProjection(booking = {}) {
    const projection = booking.timelineProjection || booking.timeline_projection || {};
    return projection && typeof projection === 'object' && !Array.isArray(projection) ? projection : {};
}

function bookingDetailTimelineExtraData(booking = {}) {
    const raw = booking.extraData || booking.extra_data || {};
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function bookingDetailTimelineIdentity(booking = {}) {
    const extra = bookingDetailTimelineExtraData(booking);
    const raw = booking.timelineIdentity
        || booking.timeline_identity
        || extra.timelineIdentity
        || extra.timeline_identity
        || {};
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function bookingDetailLineIdentityValues(booking = {}, identity = bookingDetailTimelineIdentity(booking)) {
    return [
        booking.lineId,
        booking.line_id,
        booking.resourceId,
        booking.resource_id,
        identity.lineId,
        identity.line_id,
        identity.resourceId,
        identity.resource_id
    ].map(value => String(value || '').trim()).filter(Boolean);
}

function bookingDetailFindLineByIdentity(lines = [], identityValues = []) {
    const targets = new Set(identityValues.map(value => String(value || '').trim()).filter(Boolean));
    if (!targets.size) return null;
    return (Array.isArray(lines) ? lines : []).find(line => [
        line?.id,
        line?.lineId,
        line?.line_id,
        line?.resourceId,
        line?.resource_id
    ].some(value => targets.has(String(value || '').trim()))) || null;
}

function bookingDetailPushUniqueName(names, value) {
    const text = String(value || '').trim();
    if (!text) return;
    const key = text.toLocaleLowerCase('uk-UA');
    if (names.some(existing => String(existing || '').trim().toLocaleLowerCase('uk-UA') === key)) return;
    names.push(text);
}

function bookingDetailIsRoomNameFallback(booking = {}, value = '') {
    const text = String(value || '').trim();
    if (!text) return false;
    const key = text.toLocaleLowerCase('uk-UA');
    const roomNames = [
        booking.room,
        booking.roomName,
        booking.room_name,
        bookingDetailRoomName(booking)
    ].map(item => String(item || '').trim().toLocaleLowerCase('uk-UA')).filter(Boolean);
    return roomNames.includes(key);
}

function bookingDetailSecondAnimatorName(booking = {}) {
    const extra = bookingDetailTimelineExtraData(booking);
    const workspace = extra.bookingWorkspace || extra.booking_workspace || {};
    return String(
        booking.secondAnimator
        || booking.second_animator
        || booking.secondAnimatorLineName
        || booking.second_animator_line_name
        || workspace.secondAnimatorLineName
        || workspace.second_animator_line_name
        || workspace.secondAnimator
        || workspace.second_animator
        || ''
    ).trim();
}

async function resolveBookingDetailAnimatorDisplay(booking = {}) {
    const identity = bookingDetailTimelineIdentity(booking);
    const identityValues = bookingDetailLineIdentityValues(booking, identity);
    let animatorLines = [];
    try {
        animatorLines = await getAnimatorLinesForBookingDate({ forceAnimatorView: true, fresh: false });
    } catch (err) {
        console.warn('[BookingDetail] Animator lines unavailable for detail display:', err);
    }

    const primaryLine = bookingDetailFindLineByIdentity(animatorLines, identityValues);
    const names = [];
    bookingDetailPushUniqueName(names, primaryLine?.name || primaryLine?.shortName || primaryLine?.short_name);
    const identityName = identity.resourceName || identity.resource_name || identity.lineName || identity.line_name;
    if (!bookingDetailIsRoomNameFallback(booking, identityName)) {
        bookingDetailPushUniqueName(names, identityName);
    }
    bookingDetailPushUniqueName(names, bookingDetailSecondAnimatorName(booking));
    return names.length ? names.join(' + ') : 'Не вказано';
}

function bookingDetailRoomName(booking = {}) {
    const projection = bookingDetailTimelineProjection(booking);
    return String(
        booking.room
        || booking.roomName
        || booking.room_name
        || projection.resourceName
        || projection.resource_name
        || ''
    ).trim();
}

function bookingDetailBanquetGroupId(booking = {}, banquetSnapshot = null) {
    const extra = bookingDetailTimelineExtraData(booking);
    const banquetGroup = extra.banquetGroup || extra.banquet_group || {};
    return String(
        booking.banquetGroupId
        || booking.banquet_group_id
        || banquetGroup.groupId
        || banquetGroup.group_id
        || banquetSnapshot?.groupId
        || banquetSnapshot?.group?.id
        || banquetSnapshot?.banquetGroup?.groupId
        || banquetSnapshot?.banquetGroup?.group?.id
        || ''
    ).trim();
}

function bookingDetailBanquetGroupLabel(booking = {}, banquetSnapshot = null) {
    const group = banquetSnapshot?.group || banquetSnapshot?.banquetGroup?.group || {};
    const label = String(
        group.groupName
        || group.group_name
        || group.name
        || booking.groupName
        || booking.group_name
        || ''
    ).trim();
    if (label) return label;
    const groupId = bookingDetailBanquetGroupId(booking, banquetSnapshot);
    return groupId ? `#${groupId}` : '';
}

function bookingDetailIsServiceTimelineBooking(booking = {}) {
    const projection = bookingDetailTimelineProjection(booking);
    const displaySurface = String(projection.displaySurface || projection.display_surface || '').trim();
    const serviceLineId = typeof ROOM_FIRST_BANQUET_SERVICE_LINE_ID !== 'undefined'
        ? ROOM_FIRST_BANQUET_SERVICE_LINE_ID
        : 'banquet-service';
    return bookingDetailHasServiceOverview(booking)
        || displaySurface === 'service_marker'
        || displaySurface === 'banquet_preview'
        || String(booking.lineId || booking.line_id || '').trim() === serviceLineId;
}

function bookingDetailIsRoomVisibleKitchenOrService(booking = {}) {
    return bookingDetailIsKitchenCandidate(booking) || bookingDetailIsServiceTimelineBooking(booking);
}

function bookingDetailIsActivityWithRoomContext(booking = {}) {
    if (!bookingDetailRoomName(booking)) return false;
    if (bookingDetailIsRoomVisibleKitchenOrService(booking)) return false;
    return Boolean(
        booking.programId
        || booking.program_id
        || booking.programName
        || booking.program_name
        || booking.programCode
        || booking.program_code
        || booking.label
    );
}

function banquetSnapshotHasGroup(snapshot) {
    return Boolean(snapshot?.groupId || snapshot?.group?.id);
}

function banquetSnapshotPrimaryBooking(snapshot, fallbackBooking = null) {
    if (snapshot?.bookings?.primary) return snapshot.bookings.primary;
    const primaryMember = (snapshot?.members || []).find(member => member.isPrimary);
    return primaryMember?.booking || fallbackBooking;
}

function banquetSnapshotMemberIds(snapshot) {
    return new Set((snapshot?.members || []).map(member => String(member.bookingId || member.booking?.id || '')).filter(Boolean));
}

function bookingDetailHasDepositMarker(booking = {}) {
    const extra = booking.extraData || {};
    const deposit = extra.deposit || extra.banquetDeposit || extra.bookingDeposit || null;
    if (deposit && (deposit.amount || deposit.depositAmount || deposit.paymentMethod || deposit.paymentStatus)) return true;
    if (booking.depositAmount || booking.deposit_amount) return true;
    return false;
}

function bookingDetailPaidAmountValue(booking = {}) {
    const value = booking.paidAmount ?? booking.paid_amount ?? booking.payment?.paidAmount ?? booking.payment?.paid_amount;
    if (value === null || value === undefined || value === '') return null;
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function bookingDetailPaymentStatusValue(booking = {}) {
    return String(booking.paymentStatus || booking.payment_status || booking.payment?.status || '').trim();
}

function bookingDetailDepositContextBookings(anchorBooking = {}, snapshot = null) {
    const rows = [];
    const addBooking = booking => {
        if (!booking) return;
        const bookingId = bookingDetailId(booking);
        const key = bookingId || `row-${rows.length}`;
        if (rows.some(row => row.key === key)) return;
        rows.push({ key, booking });
    };
    addBooking(anchorBooking);
    addBooking(banquetSnapshotPrimaryBooking(snapshot, anchorBooking));
    (snapshot?.members || []).forEach(member => {
        addBooking(member.booking || member);
        (member.technicalChildren || []).forEach(addBooking);
    });
    return rows.map(row => row.booking);
}

function bookingDetailDepositHasCanonicalRecord(projection = null) {
    if (!projection || projection.loading || projection.success === false) return false;
    const status = String(projection.status || projection.state || '').trim();
    return Boolean(projection.deposit || (status && !['missing', 'cancelled'].includes(status)));
}

function bookingDetailCanViewDepositMoney() {
    if (typeof canAccess === 'function') return canAccess('view_revenue');
    return !isViewer();
}

function bookingDetailDepositReceivedDate(deposit = {}) {
    const confirmation = deposit.sourcePayload?.accountantConfirmation || deposit.meta?.accountantConfirmation || {};
    return confirmation.receivedDate || (deposit.verifiedAt ? String(deposit.verifiedAt).slice(0, 10) : '');
}

function bookingDetailDepositDateLabel(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const parsed = Date.parse(text);
    if (Number.isNaN(parsed)) return text;
    return new Date(parsed).toISOString().slice(0, 10);
}

function bookingDetailDepositPaymentLabel(method) {
    const value = String(method || '').trim().toLowerCase();
    if (value === 'cash') return 'Готівка';
    if (value === 'card') return 'Карта';
    return value;
}

function bookingDetailDepositStatusLabel(projection = {}) {
    if (projection?.loading) return 'Завантаження...';
    if (projection?.success === false) return 'Помилка завантаження';
    const status = String(projection?.status || projection?.state || 'missing').trim();
    const labels = {
        missing: 'Не вказано',
        manager_reported: 'Очікує бухгалтера',
        needs_booking_link: 'Потрібна привʼязка бронювання',
        accountant_verified: 'Завдаток підтверджено',
        corrected: 'Виправлено',
        cancelled: 'Не вказано'
    };
    return labels[status] || 'Не вказано';
}

function bookingDetailDepositTone(projection = {}) {
    if (projection?.loading) return 'loading';
    if (projection?.success === false) return 'error';
    const status = String(projection?.status || projection?.state || 'missing').trim();
    if (status === 'accountant_verified' || status === 'corrected') return 'verified';
    if (status === 'manager_reported') return 'pending';
    if (status === 'needs_booking_link') return 'link';
    return 'missing';
}

function bookingDetailDepositWarnings(anchorBooking = {}, snapshot = null, projection = {}) {
    if (projection?.loading || projection?.success === false || bookingDetailDepositHasCanonicalRecord(projection)) return [];
    const contextBookings = bookingDetailDepositContextBookings(anchorBooking, snapshot);
    const hasPaidAmount = contextBookings.some(booking => bookingDetailPaidAmountValue(booking) !== null || bookingDetailPaymentStatusValue(booking));
    const hasLegacyDeposit = contextBookings.some(bookingDetailHasDepositMarker);
    const warnings = [];
    if (hasPaidAmount) warnings.push('paid_amount / payment_status у броні не є завдатком. Статус завдатку береться тільки з підтвердження бухгалтера.');
    if (hasLegacyDeposit) warnings.push('Знайдено старі deposit-поля, але цей статус читається тільки з canonical запису завдатку.');
    return warnings;
}

function bookingBanquetDetailRendererCall(name, args) {
    const root = typeof window !== 'undefined' ? window : globalThis;
    const renderer = root.BookingBanquetDetail;
    const fn = renderer && renderer[name];
    if (typeof fn !== 'function') {
        console.warn(`[BookingBanquetDetail] ${name} is not available`);
        return '';
    }
    return fn.apply(renderer, Array.from(args || []));
}

function renderBanquetDepositStatusSection(anchorBooking = {}, snapshot = null, projection = { loading: true }) {
    return bookingBanquetDetailRendererCall('renderBanquetDepositStatusSection', arguments);
}

function renderBanquetMemberCard(member = {}, roleOverride = null, options = {}) {
    return bookingBanquetDetailRendererCall('renderBanquetMemberCard', arguments);
}

function renderBanquetMemberSection(title, members, emptyText) {
    return bookingBanquetDetailRendererCall('renderBanquetMemberSection', arguments);
}

function renderBanquetWorkSection(title, bodyHtml, modifier = '') {
    return bookingBanquetDetailRendererCall('renderBanquetWorkSection', arguments);
}

function renderBanquetMenuSection(packageBooking, entertainmentMembers = []) {
    return bookingBanquetDetailRendererCall('renderBanquetMenuSection', arguments);
}

function renderBanquetServiceSection(packageBooking, serviceManualMembers = []) {
    return bookingBanquetDetailRendererCall('renderBanquetServiceSection', arguments);
}

function renderBanquetActivitiesSection(activityMembers = []) {
    return bookingBanquetDetailRendererCall('renderBanquetActivitiesSection', arguments);
}

function renderFullBanquetCommentsSection(context = {}) {
    return bookingBanquetDetailRendererCall('renderFullBanquetCommentsSection', arguments);
}

function renderBanquetWarningsSection(warnings = []) {
    return bookingBanquetDetailRendererCall('renderBanquetWarningsSection', arguments);
}

function renderBanquetTechnicalSection(options = {}) {
    return bookingBanquetDetailRendererCall('renderBanquetTechnicalSection', arguments);
}

function renderBanquetCreateAction(anchorBooking = {}) {
    return bookingBanquetDetailRendererCall('renderBanquetCreateAction', arguments);
}

function renderBanquetAttachCandidates(snapshot, anchorBooking = {}, allBookings = []) {
    return bookingBanquetDetailRendererCall('renderBanquetAttachCandidates', arguments);
}

function renderFullBanquetDetail(anchorBooking = {}, allBookings = [], snapshot = null) {
    return bookingBanquetDetailRendererCall('renderFullBanquetDetail', arguments);
}


function banquetWarningText(warning = {}) {
    const code = String(warning.code || '').trim();
    const map = {
        banquet_group_schema_unavailable: 'Схема банкетних груп недоступна, показано доступні legacy-звʼязки.',
        legacy_banquet_links_fallback: 'Показано старі звʼязки booking_banquet_links, бо банкетну групу ще не створено.',
        banquet_group_not_found: 'Ця бронь ще не привʼязана до банкетної групи.',
        primary_booking_missing: 'Основну бронь банкету не визначено.',
        kitchen_booking_missing: 'Кухню / меню для цього банкету не знайдено.',
        hidden_members_omitted: 'Частину бронювань приховано правилами доступу.'
    };
    return map[code] || warning.message || code || '';
}

function bookingDetailPerChildActivityEntryMismatchWarnings(snapshot, anchorBooking = {}) {
    const members = Array.isArray(snapshot?.members) ? snapshot.members : [];
    const primaryMembers = members.filter(member => member.isPrimary);
    const primaryIds = new Set(primaryMembers.map(member => String(member.bookingId || member.booking?.id || '')).filter(Boolean));
    const kitchenMembers = members.filter(member => !primaryIds.has(String(member.bookingId || member.booking?.id || ''))
        && (member.role === 'kitchen' || member.isKitchenCandidate));
    const activityMembers = members.filter(member => !primaryIds.has(String(member.bookingId || member.booking?.id || ''))
        && member.role === 'activity'
        && !member.isKitchenCandidate);
    const packageBooking = banquetPackageBookingFromMembers(anchorBooking, primaryMembers, kitchenMembers, members);
    const packageData = packageBooking ? getBookingPackageFromBooking(packageBooking) : null;
    const entryCharge = bookingPackageEntryChargeFromPackage(packageData);
    const entryQuantity = bookingDetailActivityPositiveNumber(entryCharge?.quantity, packageData?.entryCharge?.quantity, packageData?.entry_charge?.quantity);
    if (!entryQuantity) return [];

    return bookingDetailEntertainmentMembers(primaryMembers, activityMembers)
        .map(member => {
            const booking = member?.booking || member;
            if (!booking) return '';
            const kidsCount = bookingDetailActivityPositiveNumber(booking.kidsCount, booking.kids_count);
            if (!kidsCount || kidsCount === entryQuantity) return '';
            const subtotal = bookingPackageMoneyValue(booking.price ?? booking.amount ?? 0);
            const product = bookingDetailActivityProduct(booking);
            const unitPrice = bookingDetailActivityUnitPrice(booking, product, subtotal, kidsCount);
            if (!bookingDetailActivityUsesPerChild(booking, product, subtotal, kidsCount, unitPrice)) return '';
            return `${bookingDetailActivityCommentTitle(booking)}: ціна відповідає ${formatBookingMenuQuantityNumber(kidsCount)} дітям, але Вхід рахується на ${formatBookingMenuQuantityNumber(entryQuantity)} дітей.`;
        })
        .filter(Boolean);
}

function buildBanquetDetailWarnings(snapshot, anchorBooking = {}) {
    const warnings = [];
    const hasGroupOrLegacy = banquetSnapshotHasGroup(snapshot) || snapshot?.legacyFallback || snapshot?.source === 'legacy_booking_banquet_links';
    for (const warning of (snapshot?.warnings || [])) {
        const message = banquetWarningText(warning);
        if (message) warnings.push(message);
    }
    warnings.push(...bookingDetailPerChildActivityEntryMismatchWarnings(snapshot, anchorBooking));
    const members = snapshot?.members || [];
    for (const member of members) {
        const booking = member.booking || {};
        const status = String(booking.status || '').toLowerCase();
        if (status === 'preliminary') warnings.push(`${bookingDetailTitle(booking)}: бронювання попереднє.`);
        if (status === 'cancelled') warnings.push(`${bookingDetailTitle(booking)}: бронювання скасоване.`);
        for (const child of member.technicalChildren || []) {
            const childStatus = String(child.status || '').toLowerCase();
            if (childStatus === 'preliminary') warnings.push(`${bookingDetailTitle(child)}: технічний linked_to запис попередній.`);
            if (childStatus === 'cancelled') warnings.push(`${bookingDetailTitle(child)}: технічний linked_to запис скасований.`);
        }
    }
    return [...new Set(warnings)].filter(Boolean);
}

function bookingDetailHasMenuOverview(booking = {}) {
    const bookingPackage = getBookingPackageFromBooking(booking);
    const positions = bookingPackage?.menuPositions || [];
    return positions.length > 0
        || Boolean(String(booking.banquetMenu || booking.banquet_menu || '').trim())
        || bookingDetailIsKitchenCandidate(booking);
}

function bookingDetailHasServiceOverview(booking = {}) {
    const bookingPackage = getBookingPackageFromBooking(booking);
    return (bookingPackage?.serviceEvents || []).length > 0;
}

function bookingDetailCanOwnBanquetPackage(booking = {}) {
    return bookingDetailIsRoot(booking)
        && (bookingDetailHasMenuOverview(booking) || bookingDetailHasServiceOverview(booking));
}

function bookingDetailIsPrimaryBanquetMember(booking = {}, banquetSnapshot = null) {
    const bookingId = bookingDetailId(booking);
    if (!bookingId || !Array.isArray(banquetSnapshot?.members)) return false;
    return banquetSnapshot.members.some(member => {
        const memberId = String(member.bookingId || member.booking?.id || '').trim();
        return member.isPrimary && memberId === bookingId;
    });
}

function bookingDetailIsBanquetArrivalMode(booking = {}, banquetSnapshot = null, fullBanquetDetailHtml = '') {
    const category = String(booking.category || '').trim().toLowerCase();
    if (category === 'banquet') return true;
    if (bookingDetailIsActivityWithRoomContext(booking)) return false;
    if (bookingDetailHeaderIsBanquetScheduleMode(booking, banquetSnapshot, fullBanquetDetailHtml)) return true;
    if (bookingDetailIsPrimaryBanquetMember(booking, banquetSnapshot)) return true;
    return Boolean(String(fullBanquetDetailHtml || '').trim() && bookingDetailCanOwnBanquetPackage(booking));
}

function banquetPackageBookingFromMembers(anchorBooking = {}, primaryMembers = [], kitchenMembers = [], members = []) {
    const candidates = [
        ...primaryMembers.map(member => member.booking || member),
        ...kitchenMembers.map(member => member.booking || member),
        ...members.map(member => member.booking || member),
        anchorBooking
    ];
    return candidates.find(booking => booking && bookingDetailCanOwnBanquetPackage(booking)) || null;
}

function bookingDetailHeaderPackageBooking(booking = {}, banquetSnapshot = null) {
    const members = Array.isArray(banquetSnapshot?.members) ? banquetSnapshot.members : [];
    const primaryMembers = members.filter(member => member.isPrimary);
    const primaryIds = new Set(primaryMembers.map(member => String(member.bookingId || member.booking?.id || '')).filter(Boolean));
    const kitchenMembers = members.filter(member => !primaryIds.has(String(member.bookingId || member.booking?.id || ''))
        && (member.role === 'kitchen' || member.isKitchenCandidate));
    return banquetPackageBookingFromMembers(booking, primaryMembers, kitchenMembers, members);
}

function bookingDetailHeaderIsBanquetScheduleMode(booking = {}, banquetSnapshot = null, fullBanquetDetailHtml = '') {
    if (!String(fullBanquetDetailHtml || '').trim() && !banquetSnapshotHasGroup(banquetSnapshot)) return false;
    if (!bookingDetailCanOwnBanquetPackage(booking)) return false;
    const packageBooking = bookingDetailHeaderPackageBooking(booking, banquetSnapshot);
    if (!packageBooking) return false;
    const bookingId = bookingDetailId(booking);
    const packageBookingId = bookingDetailId(packageBooking);
    return !bookingId || !packageBookingId || bookingId === packageBookingId;
}

function bookingDetailHeaderScheduleSummary(packageBooking = {}) {
    const bookingPackage = packageBooking ? getBookingPackageFromBooking(packageBooking) : null;
    if (!bookingPackage) return '';

    const servingTimes = [...new Set(groupedBookingMenuPositions(bookingPackage.menuPositions || [])
        .map(group => group.servingTime)
        .filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
    const servingTimeSet = new Set(servingTimes);

    const serviceEvents = (bookingPackage.serviceEvents || [])
        .filter(event => event && (event.time || event.title || event.type))
        .filter(event => !(event.type === 'food_service' && event.time && servingTimeSet.has(event.time)))
        .map(event => {
            const title = String(event.title || BOOKING_SERVICE_EVENT_TYPES[event.type] || 'Сервіс').trim();
            return {
                time: event.time || '',
                title: title || 'Сервіс'
            };
        })
        .sort((a, b) => `${a.time || '99:99'} ${a.title}`.localeCompare(`${b.time || '99:99'} ${b.title}`));
    const uniqueServiceEvents = [];
    const serviceKeys = new Set();
    serviceEvents.forEach(event => {
        const key = `${event.time}|${event.title}`;
        if (serviceKeys.has(key)) return;
        serviceKeys.add(key);
        uniqueServiceEvents.push(event);
    });

    const rows = [];
    if (servingTimes.length) {
        rows.push(`
            <div class="booking-detail-header-schedule-item">
                <span class="booking-detail-header-schedule-label">Видачі</span>
                <span class="booking-detail-header-schedule-value">${servingTimes.map(time => escapeHtml(time)).join(' · ')}</span>
            </div>
        `);
    }
    if (uniqueServiceEvents.length) {
        rows.push(`
            <div class="booking-detail-header-schedule-item">
                <span class="booking-detail-header-schedule-label">Сервіс</span>
                <span class="booking-detail-header-schedule-value">${uniqueServiceEvents.map(event => `${event.time ? `${escapeHtml(event.time)} ` : ''}${escapeHtml(event.title)}`).join(' · ')}</span>
            </div>
        `);
    }
    if (!rows.length) return '';
    return `
        <div class="booking-detail-header-schedule" aria-label="План банкету">
            ${rows.join('')}
        </div>
    `;
}

function uniqueBanquetCommentSources(entries = []) {
    const result = [];
    const seen = new Set();
    entries.forEach(entry => {
        const booking = entry?.booking || entry;
        if (!booking) return;
        const id = bookingDetailId(booking);
        const key = id || `${entry?.role || 'manual'}:${result.length}`;
        if (seen.has(key)) return;
        seen.add(key);
        result.push({
            booking,
            role: String(entry?.role || 'manual').trim().toLowerCase()
        });
    });
    return result;
}

function fullBanquetDetailCommentItems({ anchorBooking = {}, primaryMembers = [], kitchenMembers = [], activityMembers = [], serviceManualMembers = [], members = [] } = {}) {
    const items = [];
    const seenTexts = new Set();
    const add = (type, label, text, booking) => {
        const clean = bookingDetailCleanComment(text);
        if (!clean) return;
        const key = clean.toLowerCase();
        if (seenTexts.has(key)) return;
        seenTexts.add(key);
        items.push({
            type,
            label,
            text: clean,
            bookingId: bookingDetailId(booking)
        });
    };
    const anchorRole = bookingDetailIsKitchenCandidate(anchorBooking) ? 'kitchen' : 'internal';
    const sources = uniqueBanquetCommentSources([
        ...kitchenMembers.map(member => ({ booking: member.booking || member, role: 'kitchen' })),
        ...activityMembers.map(member => ({ booking: member.booking || member, role: 'activity' })),
        ...primaryMembers.map(member => ({ booking: member.booking || member, role: 'primary' })),
        ...serviceManualMembers.map(member => ({ booking: member.booking || member, role: member.role || 'manual' })),
        ...members.map(member => ({ booking: member.booking || member, role: member.isPrimary ? 'primary' : member.role })),
        { booking: anchorBooking, role: anchorRole }
    ]);

    sources.forEach(({ booking, role }) => {
        const text = role === 'kitchen'
            ? (bookingDetailWorkspaceComment(booking, 'kitchen') || bookingDetailLegacyComment(booking))
            : bookingDetailWorkspaceComment(booking, 'kitchen');
        add('kitchen', 'Кухня', text, booking);
    });
    sources.forEach(({ booking, role }) => {
        const text = role === 'activity'
            ? (bookingDetailWorkspaceComment(booking, 'activity') || bookingDetailLegacyComment(booking))
            : bookingDetailWorkspaceComment(booking, 'activity');
        add('activity', `Активність — ${bookingDetailActivityCommentTitle(booking)}`, text, booking);
    });
    sources.forEach(({ booking, role }) => {
        const text = bookingDetailWorkspaceComment(booking, 'internal')
            || (role === 'kitchen' || role === 'activity' ? '' : bookingDetailLegacyComment(booking));
        add('internal', 'Внутрішній коментар', text, booking);
    });

    return items;
}

function renderEducationLessonDetail(booking) {
    const lesson = educationLessonDetailsFromBooking(booking);
    if (!lesson || Object.keys(lesson).length === 0) return '';
    const rows = [
        lesson.title ? ['Заняття', lesson.title] : null,
        lesson.teacherName ? ['Викладач', lesson.teacherName] : null,
        lesson.groupName || booking.groupName ? ['Група / клас', lesson.groupName || booking.groupName] : null,
        lesson.courseCode ? ['Курс / серія', lesson.courseCode] : null,
        lesson.seriesSize && Number(lesson.seriesSize) > 1 ? ['Серія', `${lesson.seriesIndex || 1}/${lesson.seriesSize}`] : null,
        lesson.seriesSize && Number(lesson.seriesSize) > 1 ? ['Повторення', educationLessonRepeatEveryLabel(lesson.repeatEvery)] : null,
        lesson.resourceName || booking.room ? ['Кабінет', lesson.resourceName || booking.room] : null
    ].filter(Boolean);
    if (!rows.length) return '';
    const seriesActions = lesson.seriesId && Number(lesson.seriesSize || 0) > 1 && canDeleteTimelineBooking()
        ? `<div class="booking-detail-row"><span class="label">Керування серією:</span><span class="value"><button type="button" class="btn-secondary btn-sm" onclick="openEducationSeriesManager('${escapeHtml(String(lesson.seriesId))}', '${escapeHtml(String(booking.id))}')">Відкрити серію</button></span></div>`
        : '';
    return `
        <div class="booking-lesson-detail">
            <div class="booking-lesson-detail-title">Навчальний запис</div>
            ${rows.map(([label, value]) => `<div class="booking-detail-row"><span class="label">${escapeHtml(label)}:</span><span class="value">${escapeHtml(value)}</span></div>`).join('')}
            ${seriesActions}
        </div>`;
}

function bookingSummaryPreviewUrl(booking = {}, banquetSnapshot = null) {
    const summaryBooking = banquetSnapshotPrimaryBooking(banquetSnapshot, booking) || booking;
    const context = summaryBooking.businessContext
        || summaryBooking.business_context
        || booking.businessContext
        || booking.business_context
        || window.TimelineBusinessContext?.current?.()?.apiValue
        || 'event_genix';
    const returnPath = `${window.location.pathname || '/'}${window.location.search || ''}${window.location.hash || ''}`;
    const params = new URLSearchParams({
        id: String(summaryBooking.id || booking.id || ''),
        businessContext: context,
        return: returnPath
    });
    const groupId = banquetSnapshot?.groupId || banquetSnapshot?.group?.id;
    if (groupId) params.set('groupId', String(groupId));
    return `/booking-summary.html?${params.toString()}`;
}

async function loadBanquetDepositStatusForDetails(booking = {}, banquetSnapshot = null) {
    const container = document.getElementById('bookingBanquetDepositStatus');
    if (!container) return;
    const groupId = bookingDetailBanquetGroupId(booking, banquetSnapshot);
    const primaryBooking = banquetSnapshotPrimaryBooking(banquetSnapshot, booking) || booking;
    const primaryBookingId = bookingDetailId(primaryBooking) || bookingDetailId(booking);
    if (!groupId && !primaryBookingId) {
        container.outerHTML = renderBanquetDepositStatusSection(booking, banquetSnapshot, {
            success: false,
            error: 'Не знайдено id бронювання для перевірки завдатку'
        });
        return;
    }
    try {
        const projection = groupId && typeof apiGetBanquetDepositByGroup === 'function'
            ? await apiGetBanquetDepositByGroup(groupId)
            : (typeof apiGetBanquetDepositByBooking === 'function'
                ? await apiGetBanquetDepositByBooking(primaryBookingId)
                : { success: false, error: 'Deposit API unavailable' });
        const latest = document.getElementById('bookingBanquetDepositStatus');
        if (!latest) return;
        const sameGroup = groupId && latest.dataset.groupId === String(groupId);
        const sameBooking = !groupId && latest.dataset.bookingId === String(primaryBookingId || '');
        if (!sameGroup && !sameBooking) return;
        latest.outerHTML = renderBanquetDepositStatusSection(booking, banquetSnapshot, projection || { success: false });
    } catch (err) {
        const latest = document.getElementById('bookingBanquetDepositStatus');
        if (!latest) return;
        latest.outerHTML = renderBanquetDepositStatusSection(booking, banquetSnapshot, {
            success: false,
            error: err?.message || 'Не вдалося завантажити завдаток'
        });
    }
}

function bookingDetailBanquetArrival(banquetSnapshot = null) {
    const raw = banquetSnapshot?.arrival
        || banquetSnapshot?.banquetArrival
        || banquetSnapshot?.group?.arrival
        || banquetSnapshot?.group?.banquetArrival;
    if (!raw || typeof raw !== 'object') return null;
    const time = normalizeBookingGuestArrivalTime(raw.time);
    const date = String(raw.date || '').trim().slice(0, 10);
    if (!time && !date) return null;
    return {
        date: date || null,
        time: time || null,
        groupId: String(banquetSnapshot?.groupId || banquetSnapshot?.group?.id || '').trim() || null,
        updatedAt: raw.updatedAt || raw.updated_at || null
    };
}

function renderBookingCustomerCopyAction(value, label) {
    const encodedValue = encodeURIComponent(String(value ?? ''));
    return `<button type="button" class="customer-action-btn" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" data-booking-customer-copy="${escapeHtml(encodedValue)}">📋</button>`;
}

function bindBookingCustomerCopyActions(container) {
    if (!container || container.dataset.bookingCustomerCopyBound === 'true') return;
    container.dataset.bookingCustomerCopyBound = 'true';
    container.addEventListener('click', async event => {
        const button = event.target?.closest?.('[data-booking-customer-copy]');
        if (!button || !container.contains(button)) return;

        let text = '';
        try {
            text = decodeURIComponent(button.dataset.bookingCustomerCopy || '');
        } catch {
            return;
        }
        if (!text) return;

        try {
            if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
                throw new Error('Clipboard API unavailable');
            }
            await navigator.clipboard.writeText(text);
            button.textContent = '✓';
            setTimeout(() => { button.textContent = '📋'; }, 800);
        } catch {
            if (typeof showNotification === 'function') showNotification('Не вдалося скопіювати', 'error');
        }
    });
}

function bookingDetailSafeRender(section, booking = {}, renderFn, fallback = '') {
    try {
        return renderFn();
    } catch (err) {
        console.warn('[booking] Optional booking detail section failed', {
            section,
            bookingId: bookingDetailId(booking) || null,
            error: err?.message || String(err || '')
        });
        return fallback;
    }
}

async function bookingDetailSafeResolve(section, booking = {}, resolveFn, fallback = '') {
    try {
        return await resolveFn();
    } catch (err) {
        console.warn('[booking] Optional booking detail section failed', {
            section,
            bookingId: bookingDetailId(booking) || null,
            error: err?.message || String(err || '')
        });
        return fallback;
    }
}

async function resolveBookingDetailsRecord(cleanBookingId, options = {}) {
    const currentDateBookings = await getBookingsForDate(AppState.selectedDate);
    const bookings = Array.isArray(currentDateBookings) ? currentDateBookings : [];
    const cachedBooking = bookings.find(b => String(b.id) === cleanBookingId);
    if (cachedBooking) return { booking: cachedBooking, bookings, source: 'date-cache' };
    const fallbackBooking = options.fallbackBooking || options.visibleBooking || null;
    const fallbackMatchesCurrentSlice = bookingDetailsFallbackMatchesCurrentSlice(fallbackBooking, cleanBookingId);

    if (typeof apiGetBookingById !== 'function') {
        if (fallbackMatchesCurrentSlice) {
            return {
                booking: fallbackBooking,
                bookings: [fallbackBooking, ...bookings.filter(b => String(b.id) !== cleanBookingId)],
                source: 'visible-block-fallback',
                error: 'apiGetBookingById unavailable'
            };
        }
        return { booking: null, bookings, source: 'date-cache-miss', error: 'apiGetBookingById unavailable' };
    }

    const response = await apiGetBookingById(cleanBookingId, { fresh: true });
    const fetchedBooking = response?.booking && String(response.booking.id) === cleanBookingId
        ? response.booking
        : null;
    if (!response?.success || !fetchedBooking) {
        if (fallbackMatchesCurrentSlice) {
            return {
                booking: fallbackBooking,
                bookings: [fallbackBooking, ...bookings.filter(b => String(b.id) !== cleanBookingId)],
                source: 'visible-block-fallback',
                status: response?.status || null,
                code: response?.code || null,
                offline: response?.offline === true,
                error: response?.error || 'Booking not found'
            };
        }
        return {
            booking: null,
            bookings,
            source: 'id-fetch-miss',
            status: response?.status || null,
            code: response?.code || null,
            offline: response?.offline === true,
            error: response?.error || 'Booking not found'
        };
    }

    return {
        booking: fetchedBooking,
        bookings: [fetchedBooking, ...bookings.filter(b => String(b.id) !== cleanBookingId)],
        source: 'id-fetch'
    };
}

async function showBookingDetails(bookingId, options = {}) {
    const cleanBookingId = String(bookingId || '').trim();
    if (!cleanBookingId) return false;
    const detailRecord = await resolveBookingDetailsRecord(cleanBookingId, options);
    const { booking, bookings } = detailRecord;
    if (!booking) {
        const diagnostic = bookingDetailsMissingDiagnostic(cleanBookingId, detailRecord, options);
        emitBookingDetailsMissingDiagnostic(diagnostic, options);
        if (options.silentMissing !== true && typeof showNotification === 'function') {
            showNotification(`Не вдалося відкрити бронювання (${diagnostic.code}): запис недоступний або у вас немає прав.`, 'warning');
        }
        console.warn('[booking] Details target not found', {
            code: diagnostic.code,
            bookingId: cleanBookingId,
            source: options.source || 'unknown',
            date: AppState.selectedDate,
            timelineView: currentCreatedBookingTimelineView(),
            businessContext: window.TimelineBusinessContext?.state?.()?.activeBusinessContext
                || window.TimelineBusinessContext?.current?.()?.apiValue || null,
            lookupSource: detailRecord.source,
            status: detailRecord.status || null,
            apiCode: detailRecord.code || null,
            offline: detailRecord.offline === true,
            error: detailRecord.error || null
        });
        return false;
    }

    const endTime = addMinutesToTime(booking.time, booking.duration);
    const bookingDate = new Date(booking.date);
    const lines = await getLinesForDate(bookingDate);
    const line = lines.find(l => l.id === booking.lineId);

    if (isMaysternyaClosedSlotBooking(booking)) {
        const actions = canDeleteTimelineBooking() ? `
            <div class="booking-actions modal-footer-sticky">
                <button onclick="deleteBooking('${escapeHtml(booking.id)}')" class="btn-delete-booking">Відкрити слот</button>
            </div>
        ` : '';
        document.getElementById('bookingDetails').innerHTML = `
            <div class="booking-detail-header booking-detail-header--closed-slot">
                <div>
                    <h3>Слот закрито</h3>
                    <p>${escapeHtml(line ? line.name : 'Олександр')} · ${escapeHtml(booking.time)} - ${escapeHtml(endTime)}</p>
                </div>
            </div>
            <div class="booking-detail-row"><span class="label">Дата:</span><span class="value">${escapeHtml(booking.date)}</span></div>
            <div class="booking-detail-row"><span class="label">Час:</span><span class="value">${escapeHtml(booking.time)} - ${escapeHtml(endTime)}</span></div>
            <div class="booking-detail-row"><span class="label">Спеціаліст:</span><span class="value">${escapeHtml(line ? line.name : '-')}</span></div>
            ${renderBookingCommentDetailRow(booking, { legacyLabel: 'Коментар' })}
            ${actions}
        `;
        document.getElementById('bookingModal')?.classList.remove('hidden');
        return true;
    }

    const program = getProductsSync().find(p => p.id === booking.programId);
    const bookingEventCardRecord = getBookingEventCardRecord(booking, program);
    const lesson = educationLessonDetailsFromBooking(booking);
    const isEducationBooking = Boolean(lesson && Object.keys(lesson).length);
    const roomFirstServiceBooking = canAddAnimationFromRoomBooking(booking);
    const isActivityDetailBooking = bookingDetailIsActivityWithRoomContext(booking);
    const lineRoleLabel = isEducationBooking ? 'Кабінет' : (isActivityDetailBooking ? 'Аніматори' : 'Аніматор');
    const lineDetailValue = isActivityDetailBooking
        ? await bookingDetailSafeResolve('animator-display', booking, () => resolveBookingDetailAnimatorDisplay(booking), 'Не вказано')
        : (line ? line.name : '-');
    const descriptionHtml = program && program.description
        ? `<div class="booking-detail-description"><span class="label">Опис:</span><p>${escapeHtml(program.description)}</p></div>`
        : '';

    let banquetSnapshot = null;
    if (typeof apiGetBanquetByBooking === 'function') {
        try {
            const snapshot = await apiGetBanquetByBooking(booking.id);
            if (snapshot?.success) banquetSnapshot = snapshot;
        } catch (err) {
            console.warn('Banquet detail snapshot unavailable:', err);
        }
    }

    // B2: Per-event invite URL with booking details
    const inviteEndTimeLabel = booking.duration || booking.duration === 0 ? endTime : '';
    const inviteModel = bookingDetailSafeRender('invite-model', booking, () => window.InviteShare?.buildBookingDetailsInviteModel?.({
        booking,
        eventCardRecord: bookingEventCardRecord,
        endTimeLabel: inviteEndTimeLabel,
        banquetSnapshot
    }, window.InviteConfig, window.location.origin, window.EventCards) || buildBookingDetailsInviteModelFallback({
        booking,
        eventCardRecord: bookingEventCardRecord,
        endTimeLabel: inviteEndTimeLabel,
        banquetSnapshot
    }), buildBookingDetailsInviteModelFallback({
        booking,
        eventCardRecord: bookingEventCardRecord,
        endTimeLabel: inviteEndTimeLabel,
        banquetSnapshot
    }));
    const invitePayload = inviteModel.payload;
    const invitePreviewChips = Array.isArray(inviteModel.previewChips) && inviteModel.previewChips.length
        ? inviteModel.previewChips
        : [invitePayload.dateLabel, invitePayload.timeRangeLabel, invitePayload.programLabel, invitePayload.roomLabel].filter(Boolean);
    const inviteUrl = invitePayload.inviteUrl;
    const fullInviteUrl = invitePayload.fullInviteUrl;
    const inviteShortText = invitePayload.shortText;
    const inviteMessengerText = invitePayload.messengerText;
    const inviteInstagramText = invitePayload.instagramText;

    // v7.6.1: Line switch buttons
    const otherLines = lines.filter(l => l.id !== booking.lineId);
    const lineSwitchHtml = !roomFirstServiceBooking && otherLines.length > 0 ? `
        <div class="booking-line-switch">
            <span class="label">Перемістити на лінію:</span>
            <div class="line-switch-buttons">
                ${otherLines.map(l => `<button onclick="switchBookingLine('${escapeHtml(booking.id)}', '${escapeHtml(l.id)}')" style="border-color: ${escapeHtml(l.color)}; color: ${escapeHtml(l.color)}">${escapeHtml(l.name)}</button>`).join('')}
            </div>
        </div>` : '';
    const inviteSectionHtml = roomFirstServiceBooking ? '' : `
        <div class="invite-section" data-share-title="${escapeHtml(invitePayload.shareTitle || 'Event Genix')}" data-share-text="${escapeHtml(inviteMessengerText)}">
            <div class="invite-section-top">
                <div>
                    <div class="invite-section-eyebrow">Доступ і запрошення</div>
                    <div class="invite-section-header">Публічне запрошення для клієнта</div>
                    <div class="invite-section-description">Посилання на запрошення для гостя</div>
                </div>
                <a href="${inviteUrl}" target="_blank" rel="noopener" class="btn-invite-open">Відкрити запрошення</a>
            </div>
            <div class="invite-preview">
                ${invitePreviewChips.map(chip => `<span>${escapeHtml(chip)}</span>`).join('')}
            </div>
            <div class="invite-format-grid" aria-label="Формати запрошення">
                <button onclick="copyInviteLink(this)" class="btn-invite-copy" data-text="${escapeHtml(inviteShortText)}">Короткий текст</button>
                <button onclick="copyInviteLink(this)" class="btn-invite-copy" data-text="${escapeHtml(inviteMessengerText)}">Viber / Telegram</button>
                <button onclick="copyInviteLink(this)" class="btn-invite-copy" data-text="${escapeHtml(inviteInstagramText)}">Instagram</button>
            </div>
            <div class="invite-actions">
                <button onclick="copyInviteLink(this)" class="btn-invite-copy btn-invite-link-copy" data-url="${escapeHtml(fullInviteUrl)}">Копіювати лінк</button>
                ${navigator.share ? '<button onclick="shareInviteLink()" class="btn-invite-share">Поділитися</button>' : ''}
            </div>
        </div>
    `;

    const summaryPreviewHref = bookingDetailSafeRender('summary-preview-url', booking, () => bookingSummaryPreviewUrl(booking, banquetSnapshot), `/booking-summary.html?id=${encodeURIComponent(String(booking.id || ''))}`);
    const secondaryActionHtml = [
        `<button onclick="duplicateBooking('${escapeHtml(booking.id)}')" class="booking-detail-secondary-action">Повторити</button>`,
        `<button onclick="showRecurringModal('${escapeHtml(booking.id)}')" class="booking-detail-secondary-action">Повторюване</button>`,
        `<button onclick="openBookingChat('${escapeHtml(booking.id)}')" class="booking-detail-secondary-action">Чат команди</button>`,
        roomFirstServiceBooking
            ? `<button onclick="openRoomBookingAnimationBridge('${escapeHtml(booking.id)}')" class="booking-detail-secondary-action">Додати активну програму</button>`
            : '',
        shouldEditBookingInAnimatorView(booking)
            ? `<button onclick="openAnimationBookingInAnimatorView('${escapeHtml(booking.id)}', 'details')" class="booking-detail-secondary-action">Відкрити у «Свята»</button>`
            : ''
    ].filter(Boolean).join('');
    const moreActionsHtml = secondaryActionHtml ? `
            <details class="booking-detail-more-actions">
                <summary class="booking-detail-action booking-detail-action--secondary booking-detail-action--more" aria-label="Додаткові дії бронювання">Ще</summary>
                <div class="booking-detail-more-actions__panel">
                    ${secondaryActionHtml}
                </div>
            </details>
        ` : '';
    const dangerZoneHtml = canDeleteTimelineBooking() ? `
        <div class="booking-detail-danger-zone">
            <span class="booking-detail-danger-zone__label">Небезпечна дія</span>
            <button onclick="deleteBooking('${escapeHtml(booking.id)}')" class="booking-detail-danger-action">Видалити</button>
        </div>
    ` : '';
    const timeShiftControlsHtml = `
        <div class="booking-time-shift">
            <span class="label">Перенести час:</span>
            <div class="time-shift-buttons">
                <button onclick="shiftBookingTime('${escapeHtml(booking.id)}', -30)">-30</button>
                <button onclick="shiftBookingTime('${escapeHtml(booking.id)}', -15)">-15</button>
                <button onclick="shiftBookingTime('${escapeHtml(booking.id)}', 15)">+15</button>
                <button onclick="shiftBookingTime('${escapeHtml(booking.id)}', 30)">+30</button>
                <button onclick="shiftBookingTime('${escapeHtml(booking.id)}', 45)">+45</button>
                <button onclick="shiftBookingTime('${escapeHtml(booking.id)}', 60)">+60</button>
            </div>
        </div>
    `;
    const advancedActionsHtml = `
        <details class="booking-detail-advanced-actions">
            <summary class="booking-detail-advanced-actions__summary" aria-label="Показати додаткові операції бронювання">
                <span>Додаткові дії</span>
                <span class="booking-detail-advanced-actions__hint">час і лінія</span>
            </summary>
            <div class="booking-detail-advanced-actions__body">
                ${timeShiftControlsHtml}
                ${lineSwitchHtml}
            </div>
        </details>
    `;
    const editControls = isViewer() ? '' : `
        ${advancedActionsHtml}
        ${inviteSectionHtml}
        ${dangerZoneHtml}
        <div class="booking-actions modal-footer-sticky booking-actions--compact">
            <button onclick="editBooking('${escapeHtml(booking.id)}')" class="booking-detail-action booking-detail-action--primary btn-edit-booking">Редагувати</button>
            <a href="${escapeHtml(summaryPreviewHref)}" class="booking-detail-action booking-detail-action--secondary booking-summary-action">Банкетний лист</a>
            ${moreActionsHtml}
        </div>
    `;

    const bookingDetailIdLabel = booking.id ? String(booking.id) : '----';
    const bookingDetailTimeRange = `${booking.time} - ${endTime}`;
    const bookingDetailTitle = bookingDetailModalTitle(booking, roomFirstServiceBooking ? 'Кімнатна бронь' : 'Бронювання');
    const bookingChildrenCount = bookingKitchenChildrenCountFromBooking(booking);
    const lineDetailHtml = roomFirstServiceBooking ? '' : `
        <div class="booking-detail-row">
            <span class="label">${lineRoleLabel}:</span>
            <span class="value">${escapeHtml(lineDetailValue)}</span>
        </div>
    `;
    const hostsDetailHtml = roomFirstServiceBooking || isActivityDetailBooking ? '' : `
        <div class="booking-detail-row">
            <span class="label">Ведучих:</span>
            <span class="value">${escapeHtml(String(booking.hosts))}${booking.secondAnimator ? ` (+ ${escapeHtml(booking.secondAnimator)})` : ''}</span>
        </div>
    `;
    const animationExtrasHtml = roomFirstServiceBooking ? '' : `
        ${booking.costume ? `<div class="booking-detail-row"><span class="label">Костюм:</span><span class="value">${escapeHtml(booking.costume)}</span></div>` : ''}
        ${bookingDetailSafeRender('pinata-detail-rows', booking, () => renderPinataDetailRows(booking))}
    `;
    const fullBanquetDetailHtml = bookingDetailSafeRender('full-banquet-detail', booking, () => renderFullBanquetDetail(booking, bookings, banquetSnapshot));
    const hasBanquetOverview = Boolean(String(fullBanquetDetailHtml || '').trim());
    const headerPackageBooking = bookingDetailSafeRender('banquet-header-package', booking, () => bookingDetailHeaderPackageBooking(booking, banquetSnapshot), booking);
    const headerScheduleHtml = bookingDetailSafeRender('banquet-header-schedule', booking, () => bookingDetailHeaderScheduleSummary(headerPackageBooking));
    const useBanquetHeaderSchedule = Boolean(String(headerScheduleHtml || '').trim())
        && bookingDetailSafeRender('banquet-header-mode', booking, () => bookingDetailHeaderIsBanquetScheduleMode(booking, banquetSnapshot, fullBanquetDetailHtml), false);
    const isBanquetArrivalMode = bookingDetailSafeRender('banquet-arrival-mode', booking, () => bookingDetailIsBanquetArrivalMode(booking, banquetSnapshot, fullBanquetDetailHtml), false);
    const isActivityDetailMode = isActivityDetailBooking;
    const banquetArrival = bookingDetailSafeRender('banquet-arrival-projection', booking, () => bookingDetailBanquetArrival(banquetSnapshot), null);
    const headerTimeMetaHtml = useBanquetHeaderSchedule
        || isBanquetArrivalMode
        ? ''
        : `<span class="booking-detail-meta-item">${escapeHtml(bookingDetailTimeRange)}</span>`;
    const bookingDetailDateLabel = isBanquetArrivalMode ? 'Дата банкету' : 'Дата';
    const bookingDetailTimeLabel = isActivityDetailMode ? 'Час активності' : (isBanquetArrivalMode ? 'Прихід гостей' : 'Час');
    const bookingDetailDateValue = isBanquetArrivalMode ? (banquetArrival?.date || booking.date || '-') : (booking.date || '-');
    const bookingDetailTimeValue = isBanquetArrivalMode ? (banquetArrival?.time || '-') : bookingDetailTimeRange;
    const customerBlockHtml = booking.customerId
        ? `<div id="bookingCustomerBlock" class="booking-customer-block${hasBanquetOverview ? ' booking-customer-block--priority' : ''}"></div>`
        : '';
    const priorityCustomerBlockHtml = hasBanquetOverview ? customerBlockHtml : '';
    const standardCustomerBlockHtml = hasBanquetOverview ? '' : customerBlockHtml;
    const packageDetailHtml = hasBanquetOverview ? '' : bookingDetailSafeRender('package-detail', booking, () => renderBookingPackageDetail(booking));
    const eventCardImageHtml = bookingDetailSafeRender('event-card-image', booking, () => window.EventCards.renderEventCardImage(bookingEventCardRecord, { modifier: 'booking' }));
    const educationDetailHtml = bookingDetailSafeRender('education-detail', booking, () => renderEducationLessonDetail(booking));
    const workspaceDetailHtml = bookingDetailSafeRender('workspace-detail', booking, () => renderBookingWorkspaceDetail(booking));
    const commentDetailHtml = bookingDetailSafeRender('comment-detail', booking, () => renderBookingCommentDetailRow(booking));

    document.getElementById('bookingDetails').innerHTML = `
        <div class="booking-detail-header booking-detail-header--compact">
            <div class="booking-detail-heading">
                <div class="booking-detail-title-group">
                    <h3 class="booking-detail-title">${escapeHtml(bookingDetailTitle)}</h3>
                    <div class="booking-detail-meta" aria-label="Деталі бронювання">
                        <span class="booking-detail-meta-item">${escapeHtml(booking.room || '-')}</span>
                        <span class="booking-detail-meta-item">${escapeHtml(booking.date || '-')}</span>
                        ${headerTimeMetaHtml}
                        <span class="booking-detail-meta-item">#${escapeHtml(bookingDetailIdLabel)}</span>
                    </div>
                    ${useBanquetHeaderSchedule ? headerScheduleHtml : ''}
                </div>
            </div>
        </div>
        ${eventCardImageHtml}
        ${priorityCustomerBlockHtml}
        <div class="booking-detail-row">
            <span class="label">${escapeHtml(bookingDetailDateLabel)}:</span>
            <span class="value">${escapeHtml(bookingDetailDateValue)}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">${escapeHtml(bookingDetailTimeLabel)}:</span>
            <span class="value">${escapeHtml(bookingDetailTimeValue)}</span>
        </div>
        ${lineDetailHtml}
        ${hostsDetailHtml}
        ${animationExtrasHtml}
        ${educationDetailHtml}
        ${workspaceDetailHtml}
        ${packageDetailHtml}
        ${bookingChildrenCount ? `<div class="booking-detail-row"><span class="label">${isEducationBooking ? 'Учнів' : 'Дітей'}:</span><span class="value">${escapeHtml(String(bookingChildrenCount))}</span></div>` : ''}
        ${booking.banquetAdults ? `<div class="booking-detail-row"><span class="label">Дорослих:</span><span class="value">${escapeHtml(String(booking.banquetAdults))}</span></div>` : ''}
        <div class="booking-detail-row">
            <span class="label">Статус:</span>
            <span class="status-badge status-badge--${booking.status === 'preliminary' ? 'preliminary' : 'confirmed'}">${booking.status === 'preliminary' ? '⏳ Попереднє' : '✅ Підтверджене'}</span>
        </div>
        ${commentDetailHtml}
        ${booking.groupName ? `<div class="booking-detail-row"><span class="label">Група:</span><span class="value">${escapeHtml(booking.groupName)}</span></div>` : ''}
        ${fullBanquetDetailHtml}
        ${standardCustomerBlockHtml}
        ${booking.updatedAt ? `<div class="booking-detail-row"><span class="label">Оновлено:</span><span class="value">${new Date(booking.updatedAt).toLocaleString('uk-UA')}</span></div>` : ''}
        ${descriptionHtml}
        ${canEditTimelineBooking() ? `<div class="status-toggle-section">
            <button class="btn-status-toggle" onclick="changeBookingStatus('${escapeHtml(booking.id)}', '${booking.status === 'preliminary' ? 'confirmed' : 'preliminary'}')">
                ${booking.status === 'preliminary' ? '✅ Підтвердити' : '⏳ Зробити попереднім'}
            </button>
        </div>` : ''}
        ${editControls}
    `;

    document.getElementById('bookingModal')?.classList.remove('hidden');
    loadBanquetDepositStatusForDetails(booking, banquetSnapshot);

    // v24.3.1: Copy buttons on detail rows
    document.querySelectorAll('.detail-copy-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const text = this.closest('[data-copy]')?.dataset.copy;
            if (text) {
                navigator.clipboard.writeText(text);
                this.textContent = '✓';
                setTimeout(() => this.textContent = '📋', 800);
            }
        });
    });

    // v24.3.1: CRM — smart hyperlinks + contextual actions
    if (booking.customerId) {
        apiGetCustomer(booking.customerId).then(customer => {
            const block = document.getElementById('bookingCustomerBlock');
            if (!block || !customer) return;
            const rows = [];
            // Name — clickable link to CRM card
            rows.push(`<div class="customer-row customer-row--name">
                <span class="customer-row-icon">👤</span>
                <a href="/customers#id=${escapeHtml(String(booking.customerId))}" class="customer-link customer-link--crm" title="Відкрити картку клієнта">${escapeHtml(customer.name)}</a>
                <span class="customer-row-actions">
                    ${renderBookingCustomerCopyAction(customer.name, 'Скопіювати імʼя')}
                </span>
            </div>`);
            // Phone — tel: link + copy + TG
            if (customer.phone) {
                const cleanPhone = customer.phone.replace(/[^+\d]/g, '');
                rows.push(`<div class="customer-row customer-row--phone">
                    <span class="customer-row-icon">📞</span>
                    <a href="tel:${escapeHtml(cleanPhone)}" class="customer-link" title="Зателефонувати">${escapeHtml(customer.phone)}</a>
                    <span class="customer-row-actions">
                        ${renderBookingCustomerCopyAction(customer.phone, 'Скопіювати')}
                        <a href="https://t.me/${escapeHtml(cleanPhone)}" target="_blank" rel="noopener" class="customer-action-btn" title="Написати в Telegram">💬</a>
                    </span>
                </div>`);
            }
            // Instagram — link to profile + copy
            if (customer.instagram) {
                const igName = customer.instagram.replace(/^@/, '');
                rows.push(`<div class="customer-row customer-row--ig">
                    <span class="customer-row-icon">📸</span>
                    <a href="https://instagram.com/${escapeHtml(igName)}" target="_blank" rel="noopener" class="customer-link" title="Відкрити Instagram">@${escapeHtml(igName)}</a>
                    <span class="customer-row-actions">
                        ${renderBookingCustomerCopyAction(`@${igName}`, 'Скопіювати')}
                    </span>
                </div>`);
            }
            // Children — canonical list with legacy fallback.
            const children = bookingCustomerChildrenProjection(customer);
            if (children.length) {
                const childText = children
                    .map(child => bookingCustomerChildLine(child))
                    .filter(Boolean)
                    .map(escapeHtml)
                    .join('<br>');
                rows.push(`<div class="customer-row customer-row--child">
                    <span class="customer-row-icon">🎂</span>
                    <span>${childText}</span>
                </div>`);
            }
            // Visit stats
            if (customer.totalBookings) {
                const visits = customer.totalBookings;
                const suffix = visits === 1 ? '' : visits < 5 ? 'и' : 'ів';
                rows.push(`<div class="customer-row customer-row--stats">
                    <span class="customer-row-icon">📊</span>
                    <span>${visits} візит${suffix} · ${formatPrice(customer.totalSpent)}</span>
                </div>`);
            }
            block.innerHTML = `
                <div class="booking-customer-info booking-customer-info--smart">
                    <div class="customer-header">
                        <span>Клієнт</span>
                        <a href="/customers#id=${escapeHtml(String(booking.customerId))}" class="customer-crm-link" title="Відкрити повну картку">Картка →</a>
                    </div>
                    ${rows.join('')}
                </div>`;
            bindBookingCustomerCopyActions(block);
        });
    }
    return true;
}

function selectedBanquetCandidateRole(bookingId) {
    const targetId = String(bookingId || '');
    const select = [...document.querySelectorAll('[data-banquet-candidate-role]')]
        .find(item => String(item.dataset.banquetCandidateRole || '') === targetId);
    return select?.value || 'manual';
}

async function createBanquetGroupFromBookingDetails(bookingId) {
    if (typeof apiCreateBanquetGroup !== 'function') {
        showNotification('Створення банкетної групи недоступне. Оновіть сторінку.', 'error');
        return;
    }
    const sourceId = String(bookingId || '').trim();
    if (!sourceId) return;
    const bookings = await getBookingsForDate(AppState.selectedDate).catch(() => []);
    const source = bookings.find(item => String(item.id) === sourceId) || {};
    if (!bookingDetailIsRoot(source)) {
        showNotification('Банкетну групу можна створити тільки з root-броні.', 'error');
        return;
    }
    if (typeof promptModal !== 'function') {
        showNotification('Діалог часу приходу недоступний. Оновіть сторінку.', 'error');
        return;
    }
    const enteredArrival = await promptModal('Час приходу гостей (HH:mm)', {
        defaultValue: normalizeBookingGuestArrivalTime(source.time),
        inputType: 'time',
        okText: 'Створити банкет'
    });
    if (enteredArrival === null) return;
    const guestArrivalTime = normalizeBookingGuestArrivalTime(enteredArrival);
    if (!guestArrivalTime) {
        showNotification('Вкажіть час приходу гостей у форматі HH:mm.', 'error');
        return;
    }
    const result = await apiCreateBanquetGroup(sourceId, {
        groupName: source.label || source.programName || source.room || null,
        source: 'booking_details',
        meta: { ui: 'booking_details' },
        banquetContext: { mode: 'new', groupId: null, guestArrivalTime }
    });
    if (!result?.success) {
        showNotification(result?.error || 'Не вдалося створити банкетну групу.', 'error');
        return;
    }
    showNotification('Банкетну групу створено. Додайте повʼязані броні вручну.', 'success');
    invalidateBookingTimelineDateCache(AppState.selectedDate, { lines: false });
    await renderTimeline();
    await showBookingDetails(sourceId);
}

async function attachBookingToBanquetGroupFromDetails(groupId, bookingId, anchorBookingId) {
    if (typeof apiAttachBanquetGroupBooking !== 'function') {
        showNotification('Додавання до банкетної групи недоступне. Оновіть сторінку.', 'error');
        return;
    }
    const targetId = String(bookingId || '').trim();
    const cleanGroupId = String(groupId || '').trim();
    if (!targetId || !cleanGroupId) return;
    const role = selectedBanquetCandidateRole(targetId);
    const bookings = await getBookingsForDate(AppState.selectedDate).catch(() => []);
    const target = bookings.find(item => String(item.id) === targetId) || {};
    if (!bookingDetailIsRoot(target)) {
        showNotification('До банкету можна додати тільки root-бронь. Технічні linked_to підтягнуться автоматично.', 'error');
        return;
    }
    const result = await apiAttachBanquetGroupBooking(cleanGroupId, targetId, {
        role,
        label: target.groupName || target.label || target.programName || target.room || null
    });
    if (!result?.success) {
        showNotification(result?.error || 'Не вдалося додати бронь до банкету.', 'error');
        return;
    }
    showNotification('Бронь додано до банкетної групи.', 'success');
    invalidateBookingTimelineDateCache(AppState.selectedDate, { lines: false });
    await renderTimeline();
    await showBookingDetails(anchorBookingId || targetId);
}

window.createBanquetGroupFromBookingDetails = createBanquetGroupFromBookingDetails;
window.attachBookingToBanquetGroupFromDetails = attachBookingToBanquetGroupFromDetails;

// ==========================================
// РЕДАГУВАННЯ БРОНЮВАННЯ (v5.5)
// ==========================================

function banquetEditBookingValue(booking = {}, camelKey, snakeKey) {
    return booking?.[camelKey] ?? booking?.[snakeKey] ?? null;
}

function buildBanquetEditPrimaryPatch(baseBooking, context = BookingDrawerState.banquetEditContext) {
    if (!context?.groupId || context.primaryIsActivity) return baseBooking;
    const primary = context.primaryBooking || {};
    return {
        ...baseBooking,
        id: context.primaryBookingId,
        time: primary.time || baseBooking.time,
        lineId: banquetEditBookingValue(primary, 'lineId', 'line_id'),
        programId: banquetEditBookingValue(primary, 'programId', 'program_id'),
        programCode: banquetEditBookingValue(primary, 'programCode', 'program_code'),
        label: primary.label || baseBooking.label,
        programName: banquetEditBookingValue(primary, 'programName', 'program_name') || baseBooking.programName,
        category: primary.category || baseBooking.category,
        duration: Number(primary.duration || 0) || baseBooking.duration,
        price: Number(primary.price || 0),
        hosts: Number(primary.hosts || 0),
        secondAnimator: banquetEditBookingValue(primary, 'secondAnimator', 'second_animator'),
        pinataMode: banquetEditBookingValue(primary, 'pinataMode', 'pinata_mode') || 'none',
        pinataNumber: banquetEditBookingValue(primary, 'pinataNumber', 'pinata_number'),
        pinataFillerNumber: banquetEditBookingValue(primary, 'pinataFillerNumber', 'pinata_filler_number'),
        pinataFiller: banquetEditBookingValue(primary, 'pinataFiller', 'pinata_filler'),
        clientPinataServicePrice: banquetEditBookingValue(primary, 'clientPinataServicePrice', 'client_pinata_service_price'),
        clientPinataServiceNote: banquetEditBookingValue(primary, 'clientPinataServiceNote', 'client_pinata_service_note')
    };
}

function buildBanquetEditActivityBookings(baseBooking, formData = {}, context = BookingDrawerState.banquetEditContext) {
    if (!context?.groupId) return [];
    const programs = Array.isArray(formData.activityPrograms)
        ? formData.activityPrograms.filter(Boolean)
        : getSelectedActivityPrograms();
    const scheduleRows = getSelectedActivityScheduleRows(programs);
    const desiredRows = context.primaryIsActivity ? scheduleRows.slice(1) : scheduleRows;
    return desiredRows.map(row => buildMultiActivityBookingFromProgram(baseBooking, row.program, {
        index: row.index,
        time: row.time,
        activityPrograms: programs,
        primaryProgramId: context.primaryIsActivity ? programs[0]?.id : null
    })).filter(Boolean);
}

function buildBanquetBookingSetPayload(baseBooking, formData = {}, context = BookingDrawerState.banquetEditContext) {
    const programs = Array.isArray(formData.activityPrograms)
        ? formData.activityPrograms.filter(Boolean)
        : getSelectedActivityPrograms();
    const scheduleRows = getSelectedActivityScheduleRows(programs);
    const adjustedPrimary = { ...baseBooking };
    if (context?.primaryIsActivity && scheduleRows[0]) {
        const primaryFields = getSelectedActivityBookingFields()[String(scheduleRows[0].programId)] || {};
        adjustedPrimary.time = scheduleRows[0].time || adjustedPrimary.time;
        adjustedPrimary.duration = Number(primaryFields.duration || scheduleRows[0].duration || adjustedPrimary.duration);
        adjustedPrimary.lineId = primaryFields.lineId || adjustedPrimary.lineId;
    }
    const primaryPatch = buildBanquetEditPrimaryPatch(adjustedPrimary, context);
    const depositHydration = BookingDrawerState.depositHydration || {};
    const primaryBookingId = String(context?.primaryBookingId || '').trim();
    const depositHydrationMatches = String(depositHydration.bookingId || '') === primaryBookingId;
    const depositCanMutate = depositHydration.status === 'loaded' && depositHydrationMatches;
    const depositWasLoaded = depositHydration.status === 'loaded'
        && depositHydrationMatches;
    if (formData.deposit?.provided && primaryBookingId && !depositCanMutate) {
        delete primaryPatch.deposit;
        delete primaryPatch.banquetDeposit;
    }
    if (!formData.deposit?.provided) {
        if (depositWasLoaded && depositHydration.hadDeposit) {
            primaryPatch.deposit = {
                provided: true,
                expectedAmount: null,
                dueDate: null,
                managerStatus: null,
                managerNote: null
            };
            primaryPatch.banquetDeposit = primaryPatch.deposit;
        } else {
            delete primaryPatch.deposit;
            delete primaryPatch.banquetDeposit;
        }
    }
    return {
        primaryBookingId: context?.primaryBookingId,
        primaryPatch,
        activities: buildBanquetEditActivityBookings(adjustedPrimary, formData, context),
        expectedGroupUpdatedAt: context?.expectedGroupUpdatedAt
    };
}

function banquetEditBookingProgramId(booking = {}) {
    return String(banquetEditBookingValue(booking, 'programId', 'program_id') || '').trim();
}

function banquetEditBookingId(booking = {}) {
    return String(booking?.id || booking?.bookingId || booking?.booking_id || '').trim();
}

function banquetEditSnapshotUpdatedAt(snapshot = {}) {
    return String(
        snapshot?.group?.updatedAt
        || snapshot?.group?.updated_at
        || snapshot?.updatedAt
        || snapshot?.updated_at
        || ''
    ).trim();
}

function createBanquetEditContext(snapshot = {}, anchorBookingId = '') {
    if (!banquetSnapshotHasGroup(snapshot)) return null;
    const primaryBooking = banquetSnapshotPrimaryBooking(snapshot, null);
    const primaryBookingId = banquetEditBookingId(primaryBooking);
    const groupId = String(banquetGroupIdFromSnapshot(snapshot) || '').trim();
    const expectedGroupUpdatedAt = banquetEditSnapshotUpdatedAt(snapshot);
    if (!groupId || !primaryBookingId || !expectedGroupUpdatedAt) return null;
    const activities = Array.isArray(snapshot?.bookings?.activities)
        ? snapshot.bookings.activities.filter(Boolean)
        : [];
    const primaryMember = (snapshot?.members || []).find(member =>
        member?.isPrimary
        || String(member?.role || '').toLowerCase() === 'primary'
        || String(member?.bookingId || member?.booking_id || '') === primaryBookingId
    ) || null;
    const primaryIsActivity = primaryMember?.isActivityCandidate !== undefined
        ? Boolean(primaryMember.isActivityCandidate)
        : (!primaryMember?.isKitchenCandidate && Boolean(banquetEditBookingProgramId(primaryBooking)));
    const allBookingIds = new Set([primaryBookingId]);
    activities.forEach(item => {
        const id = banquetEditBookingId(item);
        if (id) allBookingIds.add(id);
    });
    (snapshot?.members || []).forEach(member => {
        const memberId = String(member?.bookingId || member?.booking_id || banquetEditBookingId(member?.booking || {})).trim();
        if (memberId) allBookingIds.add(memberId);
        (member?.technicalChildren || member?.technical_children || []).forEach(child => {
            const childId = banquetEditBookingId(child);
            if (childId) allBookingIds.add(childId);
        });
    });
    return {
        groupId,
        primaryBookingId,
        expectedGroupUpdatedAt,
        anchorBookingId: String(anchorBookingId || primaryBookingId),
        primaryIsActivity,
        primaryBooking,
        activities,
        allBookingIds: [...allBookingIds],
        snapshot
    };
}

function applyBanquetEditContextSnapshot(snapshot = null, anchorBookingId = '') {
    const context = createBanquetEditContext(snapshot || {}, anchorBookingId);
    if (!context) return null;
    BookingDrawerState.banquetEditContext = context;
    hydrateBanquetEditActivityState(context);
    return context;
}

async function refreshBanquetEditContextAfterSave(updateResult = {}, previousContext = null) {
    const bookingId = previousContext?.primaryBookingId || AppState.editingBookingId;
    const responseContext = applyBanquetEditContextSnapshot(updateResult?.banquetGroup, bookingId);
    if (!bookingId || typeof apiGetBanquetByBooking !== 'function') {
        showNotification('Склад банкету збережено, але свіжий snapshot недоступний. Форма залишилась відкритою.', 'warning');
        return null;
    }
    const snapshot = await apiGetBanquetByBooking(bookingId);
    const freshContext = applyBanquetEditContextSnapshot(snapshot, bookingId);
    if (!snapshot || snapshot.success === false || !freshContext) {
        if (responseContext) {
            BookingDrawerState.banquetEditContext = responseContext;
            hydrateBanquetEditActivityState(responseContext);
            AppState.editingBookingUpdatedAt = responseContext.primaryBooking?.updatedAt
                || AppState.editingBookingUpdatedAt;
        }
        showNotification(
            snapshot?.error
                ? `Склад банкету збережено, але не вдалося перевірити свіжий snapshot: ${snapshot.error}`
                : 'Склад банкету збережено, але свіжий snapshot не підтверджено. Форма залишилась відкритою.',
            'warning'
        );
        return null;
    }
    return freshContext;
}

function hydrateBanquetEditActivityState(context = null) {
    if (!context?.groupId) return;
    const primary = context.primaryBooking || {};
    const rows = [
        ...(context.primaryIsActivity ? [{ booking: primary, isPrimary: true }] : []),
        ...(context.activities || []).map(booking => ({ booking, isPrimary: false }))
    ];
    const programIds = [];
    const bookingFields = {};
    const scheduleTimes = {};
    const pinataFields = {};
    const secondAnimatorFields = {};

    rows.forEach(({ booking, isPrimary }) => {
        const programId = banquetEditBookingProgramId(booking);
        if (!programId || programIds.includes(programId)) return;
        programIds.push(programId);
        const bookingId = banquetEditBookingId(booking);
        const time = String(booking?.time || '').trim();
        const duration = Number(booking?.duration || 0) || 0;
        const lineId = String(banquetEditBookingValue(booking, 'lineId', 'line_id') || '').trim();
        const secondAnimator = String(banquetEditBookingValue(booking, 'secondAnimator', 'second_animator') || '').trim();
        bookingFields[programId] = {
            existingActivityBookingId: isPrimary ? null : (bookingId || null),
            bookingId: bookingId || null,
            isPrimary,
            programId,
            time,
            duration,
            lineId: lineId || null,
            secondAnimator: secondAnimator || null,
            secondAnimatorLineId: banquetEditBookingValue(booking, 'secondAnimatorLineId', 'second_animator_line_id'),
            secondAnimatorLineName: banquetEditBookingValue(booking, 'secondAnimatorLineName', 'second_animator_line_name') || secondAnimator || null
        };
        if (time) scheduleTimes[programId] = time;
        pinataFields[programId] = {
            pinataMode: String(banquetEditBookingValue(booking, 'pinataMode', 'pinata_mode') || 'none'),
            pinataNumber: String(banquetEditBookingValue(booking, 'pinataNumber', 'pinata_number') || ''),
            pinataFiller: String(banquetEditBookingValue(booking, 'pinataFiller', 'pinata_filler') || ''),
            pinataFillerNumber: String(banquetEditBookingValue(booking, 'pinataFillerNumber', 'pinata_filler_number') || ''),
            clientPinataServicePrice: String(banquetEditBookingValue(booking, 'clientPinataServicePrice', 'client_pinata_service_price') ?? ''),
            clientPinataServiceNote: String(banquetEditBookingValue(booking, 'clientPinataServiceNote', 'client_pinata_service_note') || '')
        };
        secondAnimatorFields[programId] = {
            secondAnimator: secondAnimator || '',
            secondAnimatorLineId: bookingFields[programId].secondAnimatorLineId || null,
            secondAnimatorLineName: bookingFields[programId].secondAnimatorLineName || null
        };
    });

    BookingDrawerState.selectedActivityBookingFields = bookingFields;
    BookingDrawerState.selectedActivityScheduleTimes = scheduleTimes;
    BookingDrawerState.selectedActivityScheduleIssues = {};
    BookingDrawerState.selectedActivityPinataFields = pinataFields;
    BookingDrawerState.selectedActivitySecondAnimatorFields = secondAnimatorFields;
    setSelectedActivityPrograms(programIds, { renderSummary: true, renderPackage: true, markDirty: false });
    const resolvedProgramIds = new Set(getSelectedActivityPrograms().map(item => String(item.id)));
    context.unresolvedActivityProgramIds = programIds.filter(programId => !resolvedProgramIds.has(programId));
    syncPrimaryProgramDependentFields(getSelectedActivityPrograms()[0] || null);
    if (context.unresolvedActivityProgramIds.length) {
        showNotification('Деякі активності банкету відсутні в каталозі. Збереження заблоковано, щоб не втратити їх зі складу.', 'error');
    }
}

function bookingEditConflictExcludeIds() {
    const context = BookingDrawerState.banquetEditContext;
    if (context?.groupId && Array.isArray(context.allBookingIds)) return context.allBookingIds;
    return AppState.editingBookingId || null;
}

async function editBooking(bookingId) {
    const bookings = await getBookingsForDate(AppState.selectedDate);
    const anchorBooking = bookings.find(b => b.id === bookingId);
    if (!anchorBooking) return;
    if (shouldEditBookingInAnimatorView(anchorBooking)) {
        return openAnimationBookingInAnimatorView(anchorBooking.id, 'edit');
    }
    const banquetSnapshot = typeof apiGetBanquetByBooking === 'function'
        ? await apiGetBanquetByBooking(anchorBooking.id)
        : null;
    if (banquetSnapshot?.success === false) {
        showNotification(banquetSnapshot.error || 'Не вдалося перевірити склад банкету. Спробуйте відкрити форму ще раз.', 'error');
        return;
    }
    const banquetEditContext = banquetSnapshot?.success !== false
        ? createBanquetEditContext(banquetSnapshot || {}, anchorBooking.id)
        : null;
    if (banquetSnapshotHasGroup(banquetSnapshot) && !banquetEditContext) {
        showNotification('Snapshot банкету неповний: немає primary booking або версії групи. Редагування заблоковано.', 'error');
        return;
    }
    const booking = banquetEditContext?.primaryBooking || anchorBooking;

    closeAllModals();

    // Встановити режим редагування
    AppState.editingBookingId = banquetEditContext?.primaryBookingId || bookingId;
    // Store updatedAt for optimistic locking
    AppState.editingBookingUpdatedAt = booking.updatedAt || null;

    // Відкрити панель з даними бронювання
    const panelLineSource = banquetEditContext && !banquetEditContext.primaryIsActivity ? anchorBooking : booking;
    const panelLineId = isRoomFirstTimelineView()
        ? (panelLineSource.resourceId || panelLineSource.room || panelLineSource.lineId)
        : panelLineSource.lineId;
    await openBookingPanel(booking.time, panelLineId);
    BookingDrawerState.banquetEditContext = banquetEditContext;

    // Змінити заголовок і кнопку
    const editH3 = document.querySelector('#bookingPanel .panel-header h3');
    const editBtn = document.querySelector('#bookingForm .btn-submit');
    if (editH3) editH3.textContent = 'Редагувати бронювання';
    if (editBtn) {
        editBtn.textContent = 'Зберегти зміни';
        editBtn.dataset.readyText = editBtn.textContent;
    }
    hydrateBookingWorkspace(booking);
    const editCommentType = bookingCommentTypeForBooking(booking);
    const editComments = bookingWorkspaceCommentsFromBooking(booking);
    BookingDrawerState.legacyNotesFallback = isParkTimelineBookingMode() && Boolean(booking.notes);
    BookingDrawerState.legacyGroupNameFallback = isParkTimelineBookingMode() && Boolean(booking.groupName);

    // Заповнити форму
    if (booking.room) {
        ensureTimelineRoomOption(booking.room, {
            resourceId: booking.resourceId || booking.resource_id || null,
            resourceType: 'room',
            currentBookingRoom: true,
            disabled: true
        });
    }
    document.getElementById('roomSelect').value = booking.room || '';
    await refreshBookingRoomAvailabilityForSelectedDate({ selectedRoom: booking.room || '', excludeId: bookingId });
    if (typeof ensureCostumeSelectOption === 'function') ensureCostumeSelectOption(booking.costume);
    document.getElementById('costumeSelect').value = booking.costume || '';
    document.getElementById('bookingNotes').value = bookingCommentValueForType(editComments, editCommentType) || booking.notes || '';
    const groupEditInput = document.getElementById('bookingGroupName');
    if (groupEditInput) groupEditInput.value = booking.groupName || '';
    syncBookingCommentFieldPresentation(getBookingFormData());
    hydrateEducationLessonFields(booking);

    // Вибрати програму
    if (booking.programId) {
        selectProgram(booking.programId);

        // Кастомна програма
        const program = getProductsSync().find(p => p.id === booking.programId);
        if (program && program.isCustom) {
            const customName = document.getElementById('customName');
            const customDuration = document.getElementById('customDuration');
            if (customName) customName.value = booking.programName || '';
            if (customDuration) customDuration.value = booking.duration || 30;
        }

        if (program && isPinataProgram(program)) {
            const mode = inferBookingPinataMode(booking, program);
            const modeSelect = document.getElementById('pinataMode');
            if (modeSelect) modeSelect.value = mode;
            syncPinataModeFields(mode);
            const pinataNumberInput = document.getElementById('pinataNumber');
            const pinataFillerNumberInput = document.getElementById('pinataFillerNumber');
            const pinataFillerNumberValue = bookingPinataField(booking, 'pinataFillerNumber', 'pinata_filler_number');
            const pinataFillerValue = bookingPinataField(booking, 'pinataFiller', 'pinata_filler');
            const clientOwnedFiller = isClientPinataFillerNumber(pinataFillerNumberValue) || isClientPinataFillerChoice(pinataFillerValue);
            if (pinataNumberInput) pinataNumberInput.value = bookingPinataNumberValue(booking) || '';
            if (pinataFillerNumberInput) pinataFillerNumberInput.value = clientOwnedFiller ? CLIENT_PINATA_FILLER_LABEL : (pinataFillerNumberValue || '');
            const pinataFillerSelect = document.getElementById('pinataFillerSelect');
            if (mode === 'park' && pinataFillerSelect) {
                pinataFillerSelect.value = clientOwnedFiller ? CLIENT_PINATA_FILLER_VALUE : (pinataFillerValue || '');
                syncPinataClientFillerChoice();
            }
            renderPinataVisualPickers();
            if (mode === 'client') {
                const priceInput = document.getElementById('clientPinataServicePrice');
                const noteInput = document.getElementById('clientPinataServiceNote');
                if (priceInput) priceInput.value = bookingPinataField(booking, 'clientPinataServicePrice', 'client_pinata_service_price') ?? getClientPinataDefaultPrice();
                if (noteInput) noteInput.value = bookingPinataField(booking, 'clientPinataServiceNote', 'client_pinata_service_note') || '';
            }
        }

        // К-кість дітей (МК)
        const bookingChildrenCount = bookingChildrenCountFromBooking(booking);
        if (program && (program.perChild || isEducationTimelineBookingMode()) && bookingChildrenCount) {
            const kidsInput = document.getElementById('kidsCountInput');
            if (kidsInput) {
                kidsInput.value = bookingChildrenCount;
                kidsInput.dispatchEvent(new Event('input'));
            }
        }

        // v8.3.1: T-shirt sizes
        if (booking.programId === 'mk_tshirt' && booking.extraData?.tshirt_sizes) {
            const sizes = booking.extraData.tshirt_sizes;
            ['XS', 'S', 'M', 'L', 'XL'].forEach(s => {
                const inp = document.getElementById('tshirt' + s);
                if (inp) inp.value = sizes[s] || 0;
            });
        }
    }

    if (banquetEditContext) hydrateBanquetEditActivityState(banquetEditContext);

    await hydrateBookingCustomerSelection(booking, { renderSummary: false });
    hydrateBookingPackageWorkspace(booking);
    await hydrateBookingDepositFromServer(booking.id);

    // Статус
    const statusRadio = document.querySelector(`input[name="bookingStatus"][value="${booking.status || 'confirmed'}"]`);
    if (statusRadio) statusRadio.checked = true;

    // Другий аніматор
    if (booking.secondAnimator) {
        await populateSecondAnimatorSelect();
        await resolveSecondAnimatorSelect(booking.secondAnimator, booking.id);
    }

    renderBookingPackageSummary();
    syncBookingCommentFieldPresentation(getBookingFormData());
    if (window.BookingForm?.markClean) BookingForm.markClean();
}

// ==========================================
// DUPLICATE BOOKING (v5.50)
// ==========================================

async function duplicateBooking(bookingId) {
    const bookings = await getBookingsForDate(AppState.selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;
    if (shouldEditBookingInAnimatorView(booking)) {
        return openAnimationBookingInAnimatorView(booking.id, 'duplicate');
    }

    closeAllModals();

    // НЕ встановлюємо editingBookingId — це створення нового
    AppState.editingBookingId = null;
    BookingDrawerState.legacyNotesFallback = false;
    BookingDrawerState.legacyGroupNameFallback = false;

    const panelLineId = isRoomFirstTimelineView() ? (booking.resourceId || booking.room || booking.lineId) : booking.lineId;
    await openBookingPanel(booking.time, panelLineId);

    // Заголовок для дублювання
    const dupH3 = document.querySelector('#bookingPanel .panel-header h3');
    if (dupH3) dupH3.textContent = 'Повторити бронювання';
    const duplicateSubmit = document.querySelector('#bookingForm .btn-submit');
    if (duplicateSubmit) {
        duplicateSubmit.textContent = 'Створити копію';
        duplicateSubmit.dataset.readyText = duplicateSubmit.textContent;
    }
    hydrateBookingWorkspace(booking);

    // Pre-fill форму (ідентично editBooking)
    await loadBookingRoomResourcesForSelect({ selectedRoom: booking.room || '' });
    document.getElementById('roomSelect').value = booking.room || '';
    if (typeof ensureCostumeSelectOption === 'function') ensureCostumeSelectOption(booking.costume);
    document.getElementById('costumeSelect').value = booking.costume || '';
    const duplicateCommentType = bookingCommentTypeForBooking(booking);
    const duplicateComments = bookingWorkspaceCommentsFromBooking(booking);
    document.getElementById('bookingNotes').value = bookingCommentValueForType(duplicateComments, duplicateCommentType) || booking.notes || '';
    const groupInput = document.getElementById('bookingGroupName');
    if (groupInput) groupInput.value = booking.groupName || '';
    syncBookingCommentFieldPresentation(getBookingFormData());
    hydrateEducationLessonFields(booking);

    if (booking.programId) {
        selectProgram(booking.programId);

        const program = getProductsSync().find(p => p.id === booking.programId);
        if (program && program.isCustom) {
            const customName = document.getElementById('customName');
            const customDuration = document.getElementById('customDuration');
            if (customName) customName.value = booking.programName || '';
            if (customDuration) customDuration.value = booking.duration || 30;
        }

        if (program && isPinataProgram(program)) {
            const mode = inferBookingPinataMode(booking, program);
            const modeSelect = document.getElementById('pinataMode');
            if (modeSelect) modeSelect.value = mode;
            syncPinataModeFields(mode);
            const pinataNumberInput = document.getElementById('pinataNumber');
            const pinataFillerNumberInput = document.getElementById('pinataFillerNumber');
            const pinataFillerNumberValue = bookingPinataField(booking, 'pinataFillerNumber', 'pinata_filler_number');
            const pinataFillerValue = bookingPinataField(booking, 'pinataFiller', 'pinata_filler');
            const clientOwnedFiller = isClientPinataFillerNumber(pinataFillerNumberValue) || isClientPinataFillerChoice(pinataFillerValue);
            if (pinataNumberInput) pinataNumberInput.value = bookingPinataNumberValue(booking) || '';
            if (pinataFillerNumberInput) pinataFillerNumberInput.value = clientOwnedFiller ? CLIENT_PINATA_FILLER_LABEL : (pinataFillerNumberValue || '');
            const pinataFillerSelect = document.getElementById('pinataFillerSelect');
            if (mode === 'park' && pinataFillerSelect) {
                pinataFillerSelect.value = clientOwnedFiller ? CLIENT_PINATA_FILLER_VALUE : (pinataFillerValue || '');
                syncPinataClientFillerChoice();
            }
            renderPinataVisualPickers();
            if (mode === 'client') {
                const priceInput = document.getElementById('clientPinataServicePrice');
                const noteInput = document.getElementById('clientPinataServiceNote');
                if (priceInput) priceInput.value = bookingPinataField(booking, 'clientPinataServicePrice', 'client_pinata_service_price') ?? getClientPinataDefaultPrice();
                if (noteInput) noteInput.value = bookingPinataField(booking, 'clientPinataServiceNote', 'client_pinata_service_note') || '';
            }
        }

        const bookingChildrenCount = bookingChildrenCountFromBooking(booking);
        if (program && (program.perChild || isEducationTimelineBookingMode()) && bookingChildrenCount) {
            const kidsInput = document.getElementById('kidsCountInput');
            if (kidsInput) {
                kidsInput.value = bookingChildrenCount;
                kidsInput.dispatchEvent(new Event('input'));
            }
        }

        // v8.3.2: Copy tshirt sizes from extraData
        if (booking.extraData?.tshirt_sizes) {
            ['XS', 'S', 'M', 'L', 'XL'].forEach(s => {
                const input = document.getElementById('tshirt' + s);
                if (input) input.value = booking.extraData.tshirt_sizes[s] || 0;
            });
        }
    }

    await hydrateBookingCustomerSelection(booking, { renderSummary: false });
    hydrateBookingPackageWorkspace(booking);

    const statusRadio = document.querySelector(`input[name="bookingStatus"][value="${booking.status || 'confirmed'}"]`);
    if (statusRadio) statusRadio.checked = true;

    if (booking.secondAnimator) {
        await populateSecondAnimatorSelect();
        await resolveSecondAnimatorSelect(booking.secondAnimator, booking.id);
    }

    renderBookingPackageSummary();
    syncBookingCommentFieldPresentation(getBookingFormData());
    if (window.BookingForm?.markClean) BookingForm.markClean();
    showNotification('Форму заповнено — оберіть час та аніматора', 'info');
}

// ==========================================
// INVITE HELPERS (v5.48)
// ==========================================

function bookingInviteFallbackTime(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return '';
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function bookingInviteFallbackSnapshotArrival(snapshot = {}) {
    const raw = snapshot?.arrival || snapshot?.banquetArrival || snapshot?.group?.arrival || snapshot?.group?.banquetArrival;
    if (!raw || typeof raw !== 'object') return null;
    const time = bookingInviteFallbackTime(raw.time);
    if (!time) return null;
    return {
        time,
        date: String(raw.date || '').trim().slice(0, 10),
        room: String(raw.room || '').trim()
    };
}

function bookingInviteFallbackHasActivityTime(booking = {}, snapshot = null, arrival = null) {
    if (!arrival) return true;
    const bookingId = String(booking.id || booking.bookingId || booking.booking_id || '').trim();
    const member = Array.isArray(snapshot?.members)
        ? snapshot.members.find(item => String(item?.bookingId || item?.booking_id || item?.booking?.id || '').trim() === bookingId)
        : null;
    if (String(member?.role || '').trim() === 'activity') return true;
    const category = String(booking.category || booking.category_id || '').trim().toLowerCase();
    if (['banquet', 'kitchen', 'service', 'graduation'].includes(category)) return false;
    return Boolean(booking.programName || booking.program_name || booking.programId || booking.program_id || booking.label);
}

function buildBookingDetailsInviteModelFallback(input) {
    const booking = input?.booking || {};
    const eventCardRecord = input?.eventCardRecord || booking;
    const inviteCardKeyCandidate = window.EventCards?.resolveEventCardKey?.(eventCardRecord);
    const inviteCardKey = window.EventCards?.EVENT_CARDS?.[inviteCardKeyCandidate]?.key || 'holiday-party';
    const banquetSnapshot = input?.banquetSnapshot || input?.snapshot || input;
    const arrival = bookingInviteFallbackSnapshotArrival(banquetSnapshot);
    const hasActivityTime = bookingInviteFallbackHasActivityTime(booking, banquetSnapshot, arrival);
    const publicData = {
        date: arrival?.date || booking.date,
        time: hasActivityTime ? booking.time : '',
        end: hasActivityTime ? input?.endTimeLabel : '',
        arrival: arrival?.time || '',
        program: booking.programName || booking.label,
        room: arrival?.room || booking.room,
        card: inviteCardKey
    };
    const payload = buildBookingInviteSharePayloadFallback(publicData);
    const previewChips = [
        payload.dateLabel,
        payload.arrivalLabel ? `Прихід гостей ${payload.arrivalLabel}` : '',
        payload.timeRangeLabel,
        payload.programLabel,
        payload.roomLabel
    ].filter(Boolean);
    return {
        cardKey: inviteCardKey,
        publicData,
        payload,
        previewChips
    };
}

function buildBookingInviteSharePayloadFallback(data) {
    const clean = value => String(value || '').trim();
    const safeData = {
        date: clean(data?.date),
        time: clean(data?.time),
        end: clean(data?.end),
        arrival: bookingInviteFallbackTime(data?.arrival),
        program: clean(data?.program),
        room: clean(data?.room),
        card: clean(data?.card)
    };
    const params = new URLSearchParams();
    ['date', 'time', 'end', 'arrival', 'program', 'room', 'card'].forEach(key => {
        if (key === 'arrival' && !safeData[key]) return;
        params.set(key, safeData[key]);
    });
    const inviteUrl = `/invite?${params.toString()}`;
    const fullInviteUrl = `${String(window.location?.origin || '').replace(/\/+$/, '')}${inviteUrl}`;
    const programLabel = safeData.program || 'подію';
    const timeRangeLabel = safeData.time && safeData.end && safeData.time !== safeData.end
        ? `${safeData.time} - ${safeData.end}`
        : safeData.time;
    const arrivalLabel = safeData.arrival;
    const timeLines = arrivalLabel
        ? [
            `Прихід гостей: ${arrivalLabel}`,
            timeRangeLabel && timeRangeLabel !== arrivalLabel ? `Час активності: ${timeRangeLabel}` : ''
        ].filter(Boolean)
        : (timeRangeLabel ? [`Час: ${timeRangeLabel}`] : []);
    const rows = Array.isArray(window.InviteConfig?.location?.rows) ? window.InviteConfig.location.rows : [];
    const addressRow = rows.find(row => clean(row?.label).toLowerCase() === 'адреса');
    const address = clean(addressRow?.value);
    const addressLabel = address ? ` Адреса: ${address}.` : '';
    const shareTitle = clean(window.InviteConfig?.shareTitle) || clean(window.InviteConfig?.brandName) || 'Event Genix';
    const shortTimeText = timeLines.length ? ` ${timeLines.join('. ')}.` : '';
    const shortText = `Запрошуємо на ${programLabel}${safeData.date ? ` ${safeData.date}` : ''}.${shortTimeText}${safeData.room ? ` Кімната: ${safeData.room}.` : ''}${addressLabel} ${fullInviteUrl}`;
    const messengerText = [
        `Вітаємо! Запрошуємо на ${programLabel}.`,
        `Дата: ${safeData.date || '-'}`,
        ...timeLines,
        safeData.room ? `Кімната: ${safeData.room}` : '',
        address ? `Адреса: ${address}` : '',
        `Деталі: ${fullInviteUrl}`
    ].filter(Boolean).join('\n');
    const instagramTime = arrivalLabel
        ? ` · Прихід гостей ${arrivalLabel}${timeRangeLabel && timeRangeLabel !== arrivalLabel ? ` · ${timeRangeLabel}` : ''}`
        : (timeRangeLabel ? ` · ${timeRangeLabel}` : '');
    const instagramText = `${programLabel}${safeData.date ? ` · ${safeData.date}` : ''}${instagramTime}${safeData.room ? ` · ${safeData.room}` : ''}\n${fullInviteUrl}`;

    return {
        inviteUrl,
        fullInviteUrl,
        programLabel,
        roomLabel: safeData.room,
        dateLabel: safeData.date,
        arrivalLabel,
        timeRangeLabel,
        shareTitle,
        address,
        shortText,
        messengerText,
        instagramText
    };
}

function copyInviteLink(btn) {
    const text = btn && (btn.dataset.text || btn.dataset.url) ? (btn.dataset.text || btn.dataset.url) : '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        if (btn) {
            const original = btn.innerHTML;
            btn.innerHTML = '✅ Скопійовано!';
            setTimeout(() => { btn.innerHTML = original; }, 2000);
        }
    }).catch(() => showNotification('Не вдалося скопіювати', 'error'));
}

function shareInviteLink() {
    try {
        const modal = document.getElementById('bookingDetails');
        if (!modal) return;
        const section = modal.querySelector('.invite-section');
        const link = modal.querySelector('.btn-invite-open');
        if (!link) return;
        const url = link.href;
        const title = section?.dataset.shareTitle || window.InviteConfig?.shareTitle || window.InviteConfig?.brandName || 'Event Genix';
        const text = section?.dataset.shareText || window.InviteConfig?.shareFallbackText || 'Запрошуємо на подію!';
        if (navigator.share) {
            navigator.share({ title, text, url }).catch(() => {});
        } else {
            navigator.clipboard.writeText(`${text}\n${url}`).catch(() => showNotification('Не вдалося скопіювати', 'error'));
        }
    } catch (e) {
        showNotification('Поділитися не вдалося', 'error');
    }
}

// ==========================================
// ВИДАЛЕННЯ БРОНЮВАННЯ
// ==========================================

function ensureEducationSeriesModal() {
    let modal = document.getElementById('educationSeriesModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'educationSeriesModal';
    modal.className = 'modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Керування серією занять');
    modal.innerHTML = `
        <div class="modal-content modal-wide">
            <span class="modal-close" onclick="closeEducationSeriesManager()">&times;</span>
            <h3>Серія занять</h3>
            <div id="educationSeriesManagerBody" class="education-series-manager"></div>
        </div>`;
    document.body.appendChild(modal);
    return modal;
}

function closeEducationSeriesManager() {
    document.getElementById('educationSeriesModal')?.classList.add('hidden');
}

function renderEducationSeriesManager(seriesId, referenceBookingId, payload = {}) {
    const body = document.getElementById('educationSeriesManagerBody');
    if (!body) return;
    const bookings = Array.isArray(payload.bookings) ? payload.bookings : [];
    const rows = bookings.map(booking => {
        const lesson = educationLessonDetailsFromBooking(booking);
        const title = lesson.title || booking.programName || booking.label || booking.id;
        const seriesPosition = lesson.seriesIndex && lesson.seriesSize ? `#${lesson.seriesIndex}/${lesson.seriesSize}` : '';
        return `<div class="education-series-row${booking.status === 'cancelled' ? ' is-cancelled' : ''}">
            <div>
                <strong>${escapeHtml(booking.date)} ${escapeHtml(booking.time)} ${escapeHtml(seriesPosition)}</strong>
                <small>${escapeHtml(title)}${lesson.teacherName ? ' · ' + escapeHtml(lesson.teacherName) : ''}${lesson.resourceName || booking.room ? ' · ' + escapeHtml(lesson.resourceName || booking.room) : ''}</small>
            </div>
            <span class="status-badge status-badge--${booking.status === 'preliminary' ? 'preliminary' : 'confirmed'}">${escapeHtml(booking.status || 'confirmed')}</span>
        </div>`;
    }).join('');
    body.innerHTML = `
        <div class="education-series-manager-head">
            <div>
                <strong>${escapeHtml(seriesId)}</strong>
                <p class="digest-hint">Знайдено занять: ${bookings.length}. Скасування працює тільки в активному бізнес-контексті.</p>
            </div>
        </div>
        <div class="education-series-manager-list">${rows || '<div class="empty-state-text">У серії немає активних занять.</div>'}</div>
        <div class="education-series-manager-actions">
            <button type="button" class="btn-secondary" onclick="closeEducationSeriesManager()">Закрити</button>
            <span>
                <button type="button" class="btn-delete-booking" onclick="cancelEducationSeriesFromManager('${escapeHtml(seriesId)}', 'future', '${escapeHtml(String(referenceBookingId || ''))}')">Скасувати майбутні</button>
                <button type="button" class="btn-delete-booking" onclick="cancelEducationSeriesFromManager('${escapeHtml(seriesId)}', 'all', '${escapeHtml(String(referenceBookingId || ''))}')">Скасувати всю серію</button>
            </span>
        </div>`;
}

async function openEducationSeriesManager(seriesId, referenceBookingId = '') {
    const modal = ensureEducationSeriesModal();
    const body = document.getElementById('educationSeriesManagerBody');
    if (body) body.innerHTML = '<div class="loading-spinner">Завантаження серії...</div>';
    modal.classList.remove('hidden');
    const payload = typeof apiGetEducationLessonSeries === 'function'
        ? await apiGetEducationLessonSeries(seriesId)
        : { success: false, error: 'API unavailable', bookings: [] };
    if (!payload.success) {
        if (body) body.innerHTML = `<div class="empty-state-text">${escapeHtml(payload.error || 'Не вдалося завантажити серію')}</div>`;
        return;
    }
    renderEducationSeriesManager(seriesId, referenceBookingId, payload);
}

async function cancelEducationSeriesFromManager(seriesId, scope = 'future', referenceBookingId = '') {
    const text = scope === 'all'
        ? 'Скасувати всю серію занять?'
        : 'Скасувати майбутні заняття цієї серії?';
    const confirmed = await customConfirm(text, 'Керування серією');
    if (!confirmed) return;
    const result = await apiCancelEducationLessonSeries(seriesId, {
        scope,
        referenceBookingId,
        fromDate: formatDate(AppState.selectedDate)
    });
    if (!result?.success) {
        showNotification(result?.error || 'Не вдалося скасувати серію', 'error');
        return;
    }
    (result.bookings || []).forEach(booking => {
        if (booking.date) invalidateBookingTimelineDateCache(booking.date, { lines: false });
    });
    closeEducationSeriesManager();
    await renderTimeline();
    showNotification(`Скасовано занять: ${result.cancelledCount || 0}`, 'success');
}

async function deleteBooking(bookingId) {
    try {
        if (!canDeleteTimelineBooking()) {
            showNotification('Недостатньо прав для видалення бронювання', 'error');
            return;
        }
        const bookings = await getBookingsForDate(AppState.selectedDate, { force: true });
        const booking = bookings.find(b => b.id === bookingId);
        if (!booking) return;

        let mainBookingId = bookingId;
        let allToDelete = [];

        if (booking.linkedTo) {
            mainBookingId = booking.linkedTo;
            const mainBooking = bookings.find(b => b.id === mainBookingId);
            if (mainBooking) {
                allToDelete = bookings.filter(b => b.linkedTo === mainBookingId);
                allToDelete.push(mainBooking);
            } else {
                allToDelete = [booking];
            }
        } else {
            allToDelete = bookings.filter(b => b.linkedTo === bookingId);
            allToDelete.push(booking);
        }

        const othersCount = allToDelete.length - 1;

        const confirmMsg = othersCount > 0
            ? `Видалити це бронювання разом з ${othersCount} повʼязаними?`
            : 'Видалити це бронювання?';

        const confirmed = await customConfirm(confirmMsg, 'Видалення бронювання');
        if (!confirmed) return;

        // v5.7: Single server call — server handles linked deletion, history, Telegram
        const delResult = await apiDeleteBooking(mainBookingId);
        if (!delResult || delResult.success === false) {
            showNotification(delResult?.error || 'Помилка видалення бронювання', 'error');
            return;
        }

        pushUndo('delete', [...allToDelete]);
        invalidateBookingBanquetPreviewFreshness({
            bookingIds: allToDelete.map(item => item?.id).filter(Boolean)
        });
        invalidateBookingTimelineDateCache(AppState.selectedDate, { lines: false });
        closeAllModals();
        await renderTimeline();
        showNotification(othersCount > 0 ? `Видалено ${allToDelete.length} бронювань` : 'Бронювання видалено', 'success');
    } catch (error) {
        handleError('Видалення бронювання', error);
    }
}

// ==========================================
// ПЕРЕНОС ЧАСУ
// ==========================================

async function shiftBookingTime(bookingId, minutes) {
    try {
        const bookings = await getBookingsForDate(AppState.selectedDate, { force: true });
        const booking = bookings.find(b => b.id === bookingId);
        if (!booking) return;

        const newTime = addMinutesToTime(booking.time, minutes);
        const newStart = timeToMinutes(newTime);
        const newEnd = newStart + booking.duration;

        const bookingDate = new Date(booking.date);
        const isWeekend = bookingDate.getDay() === 0 || bookingDate.getDay() === 6;
        const dayStart = isWeekend ? CONFIG.TIMELINE.WEEKEND_START * 60 : CONFIG.TIMELINE.WEEKDAY_START * 60;
        const dayEnd = CONFIG.TIMELINE.WEEKEND_END * 60;

        if (newStart < dayStart || newEnd > dayEnd) {
            showNotification('Час виходить за межі робочого дня!', 'error');
            return;
        }

        const otherBookings = bookings.filter(b => b.lineId === booking.lineId && b.id !== bookingId);
        for (const other of otherBookings) {
            const start = timeToMinutes(other.time);
            const end = start + other.duration;

            if (newStart < end && newEnd > start) {
                const detail = ` ("${other.label || other.programCode || ''}" о ${other.time})`;
                showNotification(`Неможливо перенести — накладка${detail}`, 'error');
                if (other.id) revealHiddenBooking(other.id);
                return;
            }
        }

        // Пов'язані бронювання
        const linkedBookings = bookings.filter(b => b.linkedTo === bookingId);

        for (const linked of linkedBookings) {
            const linkedNewTime = addMinutesToTime(linked.time, minutes);
            const linkedNewStart = timeToMinutes(linkedNewTime);
            const linkedNewEnd = linkedNewStart + linked.duration;

            const linkedOthers = bookings.filter(b => b.lineId === linked.lineId && b.id !== linked.id);
            for (const other of linkedOthers) {
                const start = timeToMinutes(other.time);
                const end = start + other.duration;
                if (linkedNewStart < end && linkedNewEnd > start) {
                    const detail = ` ("${other.label || other.programCode || ''}" о ${other.time})`;
                    showNotification(`Неможливо перенести — накладка у повʼязаного аніматора${detail}`, 'error');
                    if (other.id) revealHiddenBooking(other.id);
                    return;
                }
            }
        }

        const newBooking = { ...booking, time: newTime };
        const shiftResult = await apiUpdateLinkedBookingsAtomic(bookingId, {
            main: { time: newTime },
            linked: linkedBookings.map(linked => ({
                id: linked.id,
                time: addMinutesToTime(linked.time, minutes)
            })),
            historyAction: 'shift',
            historyData: { ...newBooking, shiftMinutes: minutes }
        });
        if (shiftResult && shiftResult.success === false) {
            if (shiftResult.conflict) {
                invalidateBookingTimelineDateCache(AppState.selectedDate, { lines: false });
                closeAllModals();
                await renderTimeline();
                showNotification(shiftResult.error || 'Бронювання змінено іншим користувачем. Оновіть таймлайн.', 'error');
                return;
            }
            showNotification(shiftResult.error || 'Помилка переносу бронювання', 'error');
            if (shiftResult.conflictBookingId) revealHiddenBooking(shiftResult.conflictBookingId);
            return;
        }

        // v5.51: Push undo for shift (stores bookingId, reverse minutes, linked bookings)
        pushUndo('shift', { bookingId, minutes: -minutes, linked: linkedBookings.map(l => l.id) });

        invalidateBookingTimelineDateCache(AppState.selectedDate, { lines: false });
        closeAllModals();
        await renderTimeline();
        const linkedMsg = linkedBookings.length > 0 ? ` (+ ${linkedBookings.length} повʼязаних)` : '';
        showNotification(`Час перенесено на ${minutes > 0 ? '+' : ''}${minutes} хв${linkedMsg}`, 'success');
    } catch (error) {
        handleError('Перенос часу', error);
    }
}

// ==========================================
// ПЕРЕКЛЮЧЕННЯ ЛІНІЇ (v7.6.1)
// ==========================================

async function switchBookingLine(bookingId, targetLineId) {
    try {
        const bookings = await getBookingsForDate(AppState.selectedDate, { force: true });
        const booking = bookings.find(b => b.id === bookingId);
        if (!booking) return;

        if (booking.lineId === targetLineId) return;

        // Перевірка конфліктів на цільовій лінії
        const targetLineBookings = bookings.filter(b => b.lineId === targetLineId && b.id !== bookingId);
        const myStart = timeToMinutes(booking.time);
        const myEnd = myStart + booking.duration;

        for (const other of targetLineBookings) {
            const start = timeToMinutes(other.time);
            const end = start + other.duration;
            if (myStart < end && myEnd > start) {
                showNotification(`Неможливо — накладка з "${other.label || other.programCode}" о ${other.time}`, 'error');
                if (other.id) revealHiddenBooking(other.id);
                return;
            }
        }

        const updated = { ...booking, lineId: targetLineId };
        const result = await apiUpdateBooking(bookingId, updated);
        if (result && result.success === false) {
            if (result.conflict) {
                invalidateBookingTimelineDateCache(AppState.selectedDate, { lines: false });
                closeAllModals();
                await renderTimeline();
                showNotification('Бронювання змінено іншим користувачем. Оновіть таймлайн.', 'error');
                return;
            }
            showNotification(result.error || 'Помилка переключення лінії', 'error');
            if (result.conflictBookingId) revealHiddenBooking(result.conflictBookingId);
            return;
        }

        const lines = await getLinesForDate(AppState.selectedDate);
        const targetLine = lines.find(l => l.id === targetLineId);

        invalidateBookingTimelineDateCache(AppState.selectedDate, { lines: false });
        closeAllModals();
        await renderTimeline();
        showNotification(`Переміщено на: ${targetLine ? targetLine.name : 'іншу лінію'}`, 'success');
    } catch (error) {
        handleError('Переключення лінії', error);
    }
}

// ==========================================
// v30.3: RECURRING BOOKINGS UI
// ==========================================

async function showRecurringModal(bookingId) {
    const bookings = await getBookingsForDate(AppState.selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    document.getElementById('recurringBookingId').value = bookingId;

    // Set default end date to 3 months from now
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 3);
    document.getElementById('recurringEndDate').value = formatDate(endDate);

    // Pre-check current day of week
    const bookingDate = new Date(booking.date);
    const dayOfWeek = bookingDate.getDay();
    document.querySelectorAll('input[name="recurringDay"]').forEach(cb => {
        cb.checked = parseInt(cb.value) === dayOfWeek;
    });

    // Show/hide days section based on pattern
    const patternSel = document.getElementById('recurringPattern');
    const daysSection = document.getElementById('recurringDaysSection');
    function updateDaysVisibility() {
        const pattern = patternSel.value;
        daysSection.style.display = (pattern === 'weekly' || pattern === 'biweekly') ? '' : 'none';
    }
    patternSel.onchange = updateDaysVisibility;
    updateDaysVisibility();

    closeAllModals();
    document.getElementById('recurringModal')?.classList.remove('hidden');
}

// Form submit handler
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('recurringForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            // Prevent double-submit during async request
            if (form._submitting) return;
            form._submitting = true;
            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;
            try {
            const bookingId = document.getElementById('recurringBookingId')?.value;
            const bookings = await getBookingsForDate(AppState.selectedDate);
            const booking = bookings.find(b => b.id === bookingId);
            if (!booking) return;

            const pattern = document.getElementById('recurringPattern')?.value;
            const endDate = document.getElementById('recurringEndDate')?.value;
            const daysOfWeek = Array.from(document.querySelectorAll('input[name="recurringDay"]:checked'))
                .map(cb => parseInt(cb.value));

            const body = {
                pattern,
                daysOfWeek: daysOfWeek.length > 0 ? daysOfWeek : [new Date(booking.date).getDay()],
                startDate: booking.date,
                endDate,
                timeStart: booking.time,
                timeEnd: addMinutesToTime(booking.time, booking.duration),
                lineId: booking.lineId,
                room: booking.room,
                productId: booking.programId,
                productCode: booking.programCode,
                productName: booking.programName,
                duration: booking.duration,
                price: booking.price,
                hosts: booking.hosts,
                secondAnimatorName: booking.secondAnimator || null,
                pinataMode: bookingPinataField(booking, 'pinataMode', 'pinata_mode') || null,
                pinataNumber: bookingPinataNumberValue(booking) || null,
                pinataFillerNumber: bookingPinataField(booking, 'pinataFillerNumber', 'pinata_filler_number') || null,
                pinataFiller: bookingPinataField(booking, 'pinataFiller', 'pinata_filler') || null,
                clientPinataServicePrice: bookingPinataField(booking, 'clientPinataServicePrice', 'client_pinata_service_price') ?? null,
                clientPinataServiceNote: bookingPinataField(booking, 'clientPinataServiceNote', 'client_pinata_service_note') || null,
                costume: booking.costume || null,
                kidsCount: booking.kidsCount || null,
                groupName: recurringLegacyGroupNameForBooking(booking),
                notes: recurringLegacyNotesForBooking(booking),
                extraData: recurringExtraDataForBooking(booking)
            };

            try {
                const res = await fetch('/api/recurring', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    },
                    body: JSON.stringify(body)
                });

                if (res.ok) {
                    const result = await res.json();
                    document.getElementById('recurringModal')?.classList.add('hidden');
                    AppState.cachedBookings = {};
                    await renderTimeline();
                    const count = result.generated || 0;
                    showNotification(`Створено повторюване бронювання (${count} подій)`, 'success');
                } else {
                    const err = await res.json();
                    showNotification(err.error || 'Помилка створення', 'error');
                }
            } catch (error) {
                handleError('Recurring creation', error);
            }
            } finally {
                form._submitting = false;
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }
});

// ==========================================
// v30.3: BULK OPERATIONS
// ==========================================

const BulkOps = {
    selected: new Set(),

    toggle(bookingId) {
        if (this.selected.has(bookingId)) {
            this.selected.delete(bookingId);
        } else {
            this.selected.add(bookingId);
        }
        this.updateUI();
    },

    clear() {
        this.selected.clear();
        this.updateUI();
    },

    updateUI() {
        // Update block highlights
        document.querySelectorAll('.booking-block').forEach(block => {
            const id = block.getAttribute('data-booking-id') || block._bookingId;
            if (id && this.selected.has(id)) {
                block.classList.add('bulk-selected');
            } else {
                block.classList.remove('bulk-selected');
            }
        });

        // Show/hide action bar
        let bar = document.getElementById('bulkActionBar');
        if (this.selected.size > 0) {
            if (!bar) {
                bar = document.createElement('div');
                bar.id = 'bulkActionBar';
                bar.className = 'bulk-action-bar';
                document.body.appendChild(bar);
            }
            const deleteButton = canDeleteTimelineBooking()
                ? '<button onclick="BulkOps.bulkDelete()">🗑 Видалити</button>'
                : '';
            const statusButtons = canEditTimelineBooking()
                ? `<button onclick="BulkOps.bulkStatus('confirmed')">✅ Підтвердити</button>
                <button onclick="BulkOps.bulkStatus('preliminary')">⏳ Попередні</button>`
                : '';
            bar.innerHTML = `
                <span class="bulk-count">${this.selected.size} обрано</span>
                ${deleteButton}
                ${statusButtons}
                <button class="bulk-cancel" onclick="BulkOps.clear()">✕ Скасувати</button>
            `;
        } else if (bar) {
            bar.remove();
        }
    },

    async bulkDelete() {
        if (this._busy) return;
        if (!canDeleteTimelineBooking()) {
            showNotification('Недостатньо прав для видалення бронювань', 'error');
            return;
        }
        if (!await customConfirm(`Видалити ${this.selected.size} бронювань?`)) return;
        if (this._busy) return;
        this._busy = true;
        try {
            const ids = Array.from(this.selected);
            const undoData = [];
            const failures = [];

            for (const id of ids) {
                try {
                    const bookings = await getBookingsForDate(AppState.selectedDate);
                    const b = bookings.find(x => x.id === id);
                    const result = await apiDeleteBooking(id);
                    if (!result || result.success === false) {
                        failures.push(result?.error || `Не вдалося видалити ${id}`);
                        continue;
                    }
                    if (b) undoData.push(b);
                } catch (e) {
                    failures.push(e?.message || `Не вдалося видалити ${id}`);
                }
            }

            if (undoData.length > 0) pushUndo('delete', undoData);
            const successCount = ids.length - failures.length;
            if (successCount > 0) {
                this.clear();
                AppState.cachedBookings = {};
                await renderTimeline();
            }
            if (failures.length > 0) {
                showNotification(`Видалено ${successCount}/${ids.length}. ${failures[0]}`, successCount > 0 ? 'warning' : 'error');
                return;
            }
            showNotification(`Видалено ${ids.length} бронювань`, 'warning');
        } finally {
            this._busy = false;
        }
    },

    async bulkStatus(status) {
        if (this._busy) return;
        if (!canEditTimelineBooking()) {
            showNotification('Недостатньо прав для зміни статусу бронювань', 'error');
            return;
        }
        this._busy = true;
        try {
            const ids = Array.from(this.selected);
            let failed = 0;
            for (const id of ids) {
                try {
                    const bookings = await getBookingsForDate(AppState.selectedDate);
                    const b = bookings.find(x => x.id === id);
                    if (b && status === 'confirmed' && b.status === 'preliminary' && typeof apiConfirmBooking === 'function') {
                        const result = await apiConfirmBooking(id, { source: 'booking_panel' });
                        if (result?.success === false) failed += 1;
                    } else if (b && status === 'preliminary' && b.status !== 'preliminary' && typeof apiMarkBookingPreliminary === 'function') {
                        const result = await apiMarkBookingPreliminary(id, { source: 'booking_panel' });
                        if (result?.success === false) failed += 1;
                    } else if (b && status !== 'confirmed' && status !== 'preliminary') {
                        failed += 1;
                    }
                } catch (e) {
                    failed += 1;
                }
            }

            this.clear();
            AppState.cachedBookings = {};
            await renderTimeline();
            if (failed > 0) {
                showNotification(`Статус змінено не для всіх: ${ids.length - failed}/${ids.length}`, 'warning');
            } else {
                showNotification(`Статус змінено для ${ids.length} бронювань`, 'success');
            }
        } finally {
            this._busy = false;
        }
    }
};

window.BulkOps = BulkOps;

// ─── Pinata Stock Badge (v33.5) ──────────
async function _loadPinataStockBadge() {
    const badge = document.getElementById('pinataStockBadge');
    if (!badge) return;
    try {
        const data = await loadPinataPickerStatus();
        if (!data.success) return;
        const osnovy = data.stock.find(s => s.name.includes('Основи'));
        if (osnovy) {
            badge.textContent = `📦 Основи: ${osnovy.quantity} шт ${osnovy.quantity <= 3 ? '⚠️' : '✅'}`;
            badge.style.display = 'inline-block';
            badge.style.color   = osnovy.quantity <= 3 ? '#ef4444' : 'var(--gray-500)';
        }
    } catch { /* silent */ }
}




