/**
 * booking.js - панель бронювання, форма, деталі, видалення, перенос часу
 */

function _escB(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// v33.3: Toggle booking tag selection
function toggleBookingTag(el) {
    el.classList.toggle('active');
}

function isPinataProgram(program) {
    return !!program && (program.category === 'pinata' || String(program.id || '').startsWith('pinata'));
}

// Canonical readable labels kept in source for UI/runtime guards:
// Клієнтська піньята (послуга)
// Піньята парку
// Свій наповнювач клієнта

const CLIENT_PINATA_FILLER_VALUE = 'client_filler';
const CLIENT_PINATA_FILLER_LABEL = 'Свій наповнювач клієнта';

const PINATA_PICKER_FALLBACK_DESIGNS = [
    { id: 'P-001', name: 'Кругла піньята', emoji: '🪅', meta: 'Базова форма' },
    { id: 'P-002', name: 'Фігурна піньята', emoji: '⭐', meta: 'PRO форма' },
    { id: 'P-003', name: 'Святкова піньята', emoji: '🎉', meta: 'Каталог' }
];

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

function pinataNumberFromId(prefix, id) {
    const raw = pinataNormalizeChoiceValue(id);
    if (!raw) return '';
    if (/^[A-ZА-ЯІЇЄҐ]+[-\d]/i.test(raw)) return raw;
    if (/^\d+$/.test(raw)) return `${prefix}-${raw.padStart(3, '0')}`;
    return raw;
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
    return `
        <button type="button" class="pinata-choice-card${selected ? ' selected' : ''}" data-pinata-choice="${_escB(choice.value)}" role="option" aria-selected="${selected ? 'true' : 'false'}" aria-pressed="${selected ? 'true' : 'false'}">
            <span class="pinata-choice-thumb">${renderPinataChoiceThumb(choice)}</span>
            <span class="pinata-choice-body">
                <strong>${_escB(choice.title || 'Піньята')}</strong>
                <small>${_escB(choice.meta || 'Каталог')}</small>
            </span>
            <span class="pinata-choice-number">${_escB(choice.number || choice.value || '')}</span>
        </button>
    `;
}

async function loadPinataPickerStatus() {
    if (PinataPickerState.status) return PinataPickerState.status;
    if (PinataPickerState.promise) return PinataPickerState.promise;
    PinataPickerState.promise = (async () => {
        try {
            const token = localStorage.getItem('pzp_token');
            const res = await fetch('/api/warehouse/pinata-status', {
                headers: { 'Authorization': `Bearer ${token}` }
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
        const number = pinataNumberFromId('P', design.pinata_number || design.number || design.code || design.id || (index + 1));
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
    status.textContent = choice ? `${choice.number || choice.value} · ${choice.title}` : 'Оберіть';
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

const BookingDrawerState = {
    clientMode: 'search',
    selectedProgramCategory: 'all',
    selectedActivityProgramIds: [],
    validationAttempted: false,
    roomBookingAnimationBridge: null,
    legacyNotesFallback: false,
    legacyGroupNameFallback: false,
    banquetGroupCandidates: [],
    banquetGroupFallbackCandidates: [],
    banquetGroupCandidatesLoading: false,
    banquetGroupCandidatesKey: '',
    selectedBanquetGroupId: '',
    manualBanquetGroupSelection: false,
    roomSelectionContextRequestToken: 0,
    roomSelectionBanquetContext: null,
    autoFilledCustomerFromRoom: null,
    autoFilledBanquetFromRoom: null,
    autoFilledBanquetGuestsFromRoom: null,
    entryPriceRules: [],
    entryPriceRulesLoaded: false,
    entryPriceRulesLoading: false,
    entryPriceRulesPromise: null,
    entryPriceRulesError: null
};

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
    if (options?.bookings !== false) delete AppState.cachedBookings[key];
    if (options?.lines !== false) delete AppState.cachedLines[key];
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

function normalizeBookingBanquetGroupCandidate(candidate = {}) {
    const primary = candidate.primaryBooking || candidate.primary_booking || {};
    const groupId = candidate.groupId || candidate.group_id || candidate.id || '';
    if (!groupId) return null;
    return {
        groupId: String(groupId),
        groupName: candidate.groupName || candidate.group_name || candidate.name || null,
        primaryBookingId: candidate.primaryBookingId || candidate.primary_booking_id || primary.id || null,
        room: candidate.room || primary.room || null,
        date: String(candidate.date || primary.date || '').slice(0, 10),
        customerId: candidate.customerId ?? candidate.customer_id ?? primary.customerId ?? primary.customer_id ?? null,
        roles: Array.isArray(candidate.roles) ? candidate.roles : [],
        memberCount: Number(candidate.memberCount || candidate.member_count || 0) || 0,
        primaryBooking: primary && typeof primary === 'object' ? primary : null,
        candidateKind: candidate.candidateKind || candidate.candidate_kind || 'customer'
    };
}

function allBookingBanquetGroupCandidates() {
    return [
        ...(BookingDrawerState.banquetGroupCandidates || []),
        ...(BookingDrawerState.banquetGroupFallbackCandidates || [])
    ].filter(Boolean);
}

function bookingBanquetGroupCandidateLabel(candidate = {}) {
    const primary = candidate.primaryBooking || {};
    const name = candidate.groupName || primary.label || primary.programName || 'Банкет';
    const room = candidate.room || primary.room || 'кімната не вказана';
    const date = candidate.date || primary.date || bookingBanquetGroupDateValue();
    const time = primary.time || '';
    return [name, room, [date, time].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
}

function getSelectedBookingBanquetGroupId() {
    const select = document.getElementById('bookingBanquetGroupSelect');
    if (select) return String(select.value || '').trim();
    return String(BookingDrawerState.selectedBanquetGroupId || '').trim();
}

function getSelectedBookingBanquetGroupCandidate(groupId = getSelectedBookingBanquetGroupId()) {
    const cleanGroupId = String(groupId || '').trim();
    if (!cleanGroupId) return null;
    return allBookingBanquetGroupCandidates().find(candidate => String(candidate.groupId) === cleanGroupId) || null;
}

function selectedBookingBanquetGroupContext() {
    const groupId = getSelectedBookingBanquetGroupId();
    const candidate = getSelectedBookingBanquetGroupCandidate(groupId);
    const roomContext = BookingDrawerState.roomSelectionBanquetContext
        && String(BookingDrawerState.roomSelectionBanquetContext.groupId || '') === String(groupId || '')
        ? BookingDrawerState.roomSelectionBanquetContext
        : null;
    return {
        groupId,
        candidate,
        sourceBookingId: candidate?.primaryBookingId || candidate?.primaryBooking?.id || roomContext?.sourceBookingId || null,
        groupName: candidate?.groupName || roomContext?.groupName || null,
        customerId: candidate?.customerId ?? candidate?.primaryBooking?.customerId ?? roomContext?.banquetGroupCustomerId ?? roomContext?.sourceCustomerId ?? null,
        sourceCustomerId: roomContext?.sourceCustomerId ?? null,
        banquetGroupCustomerId: roomContext?.banquetGroupCustomerId ?? candidate?.customerId ?? null,
        source: roomContext ? 'room_selection_auto_banquet_context' : 'booking_banquet_group_selector',
        isRoomSelectionAuto: Boolean(roomContext)
    };
}

function selectedBanquetGroupContextCustomerId(context = {}) {
    const candidate = context.candidate || {};
    return context.customerId
        ?? context.banquetGroupCustomerId
        ?? context.sourceCustomerId
        ?? candidate.customerId
        ?? candidate.primaryBooking?.customerId
        ?? null;
}

function selectedBookingBanquetGroupCustomerMismatch(context = selectedBookingBanquetGroupContext()) {
    if (!context?.groupId) return false;
    const selectedCustomerId = bookingBanquetGroupSelectedCustomerId();
    const banquetCustomerId = selectedBanquetGroupContextCustomerId(context);
    return Boolean(selectedCustomerId && banquetCustomerId && String(selectedCustomerId) !== String(banquetCustomerId));
}

function activityFirstKitchenSelectorContext() {
    const roomContext = BookingDrawerState.roomSelectionBanquetContext;
    if (!roomContext?.sourceBookingId || roomContext.groupId) return null;
    if (!isParkTimelineBookingMode() || !isBookingKitchenEnabled()) return null;
    const sourceBooking = roomContext.sourceBooking || {};
    if (roomBookingIsCancelled(sourceBooking) || roomBookingIsLinkedChild(sourceBooking)) return null;
    const sourceCustomerId = roomContext.sourceCustomerId ?? roomBookingCustomerId(sourceBooking);
    const selectedCustomerId = bookingBanquetGroupSelectedCustomerId();
    if (!sourceCustomerId || !selectedCustomerId || String(sourceCustomerId) !== String(selectedCustomerId)) return null;
    return roomContext;
}

function activityFirstKitchenSelectorOptionLabel(context = {}) {
    const sourceBooking = context.sourceBooking || {};
    const time = bookingRoomDayBookingTime({ time: context.sourceTime || sourceBooking.time });
    return `Створити банкет з активності${time ? ` ${time}` : ''}`;
}

function kitchenFirstActivitySelectorContext() {
    const bridgeContext = BookingDrawerState.roomBookingAnimationBridge;
    if (!bridgeContext?.sourceBookingId || bridgeContext.groupId) return null;
    if (!isParkTimelineBookingMode()) return null;
    const sourceBooking = bridgeContext.sourceBooking || {};
    if (!roomBookingLooksLikeKitchen(sourceBooking)) return null;
    if (roomBookingIsCancelled(sourceBooking) || roomBookingIsLinkedChild(sourceBooking)) return null;
    const sourceCustomerId = bridgeContext.sourceCustomerId ?? roomBookingCustomerId(sourceBooking);
    const selectedCustomerId = bookingBanquetGroupSelectedCustomerId();
    if (!sourceCustomerId || !selectedCustomerId || String(sourceCustomerId) !== String(selectedCustomerId)) return null;
    return {
        ...bridgeContext,
        sourceBooking,
        sourceCustomerId,
        source: 'kitchen_first_activity_bridge'
    };
}

function kitchenFirstActivitySelectorOptionLabel(context = {}) {
    const sourceBooking = context.sourceBooking || {};
    const time = bookingRoomDayBookingTime({ time: context.sourceTime || sourceBooking.time });
    return `Створити банкет з кухні${time ? ` ${time}` : ''}`;
}

function clearSelectedBanquetGroupIfCustomerMismatch() {
    const context = selectedBookingBanquetGroupContext();
    if (!selectedBookingBanquetGroupCustomerMismatch(context)) return false;
    BookingDrawerState.selectedBanquetGroupId = '';
    BookingDrawerState.manualBanquetGroupSelection = false;
    renderBookingBanquetGroupSelector();
    return true;
}

function resetBookingBanquetGroupSelector() {
    BookingDrawerState.banquetGroupCandidates = [];
    BookingDrawerState.banquetGroupFallbackCandidates = [];
    BookingDrawerState.banquetGroupCandidatesLoading = false;
    BookingDrawerState.banquetGroupCandidatesKey = '';
    BookingDrawerState.selectedBanquetGroupId = '';
    BookingDrawerState.manualBanquetGroupSelection = false;
    renderBookingBanquetGroupSelector();
}

function renderBookingBanquetGroupSelector(options = {}) {
    const section = document.getElementById('bookingBanquetGroupSection');
    const select = document.getElementById('bookingBanquetGroupSelect');
    const hint = document.getElementById('bookingBanquetGroupHint');
    if (!section || !select) return;

    const customerId = bookingBanquetGroupSelectedCustomerId();
    const date = bookingBanquetGroupDateValue();
    const visible = isParkTimelineBookingMode() && Boolean(customerId && date);
    section.classList.toggle('hidden', !visible);
    section.hidden = !visible;
    section.setAttribute('aria-hidden', visible ? 'false' : 'true');
    if (!visible) {
        select.innerHTML = '<option value="">Без прив’язки</option>';
        select.value = '';
        if (hint) hint.textContent = 'Оберіть клієнта, щоб побачити його банкети на дату.';
        return;
    }

    const selectedGroupId = String(BookingDrawerState.selectedBanquetGroupId || '').trim();
    const candidates = BookingDrawerState.banquetGroupCandidates || [];
    const fallbackCandidates = BookingDrawerState.banquetGroupFallbackCandidates || [];
    const visibleCandidates = candidates.filter(candidate => candidate.candidateKind === 'customer');
    const selectedKnown = allBookingBanquetGroupCandidates().some(candidate => String(candidate.groupId) === selectedGroupId);
    const sourceOnlyRoomContext = activityFirstKitchenSelectorContext();
    const sourceOnlyKitchenContext = kitchenFirstActivitySelectorContext();
    const sourceOnlyCreateContext = sourceOnlyRoomContext || sourceOnlyKitchenContext;
    const showActivityFirstBanquetCreateOption = Boolean(sourceOnlyRoomContext && !selectedGroupId && !visibleCandidates.length);
    const showKitchenFirstBanquetCreateOption = Boolean(sourceOnlyKitchenContext && !selectedGroupId && !visibleCandidates.length);
    const unlinkedOptionLabel = showActivityFirstBanquetCreateOption
        ? activityFirstKitchenSelectorOptionLabel(sourceOnlyRoomContext)
        : (showKitchenFirstBanquetCreateOption
            ? kitchenFirstActivitySelectorOptionLabel(sourceOnlyKitchenContext)
            : 'Без прив’язки');
    const optionRows = [
        `<option value="">${escapeHtml(unlinkedOptionLabel)}</option>`,
        ...visibleCandidates.map(candidate => `<option value="${escapeHtml(candidate.groupId)}">${escapeHtml(bookingBanquetGroupCandidateLabel(candidate))}</option>`)
    ];
    if (selectedGroupId && !selectedKnown) {
        optionRows.push(`<option value="${escapeHtml(selectedGroupId)}">Вибраний банкет · ${escapeHtml(selectedGroupId)}</option>`);
    }
    select.innerHTML = optionRows.join('');
    select.value = selectedGroupId && optionRows.some(row => row.includes(`value="${escapeHtml(selectedGroupId)}"`)) ? selectedGroupId : '';
    select.disabled = Boolean(BookingDrawerState.banquetGroupCandidatesLoading);

    const selected = getSelectedBookingBanquetGroupCandidate();
    if (hint) {
        const roomContext = BookingDrawerState.autoFilledBanquetFromRoom
            && String(BookingDrawerState.autoFilledBanquetFromRoom.groupId || '') === String(selectedGroupId || '')
            ? BookingDrawerState.autoFilledBanquetFromRoom
            : null;
        if (options.error) {
            hint.textContent = 'Не вдалося завантажити банкети клієнта. Можна залишити без прив’язки.';
        } else if (BookingDrawerState.banquetGroupCandidatesLoading) {
            hint.textContent = 'Завантажуємо банкети клієнта на дату...';
        } else if (roomContext) {
            hint.textContent = `Банкет підтягнуто з кімнати: ${roomSelectionBanquetContextLabel(roomContext)}.`;
        } else if (showActivityFirstBanquetCreateOption) {
            hint.textContent = `Банкет буде створено автоматично з активності ${roomSelectionBanquetContextLabel(sourceOnlyRoomContext)} під час збереження кухні.`;
        } else if (showKitchenFirstBanquetCreateOption) {
            hint.textContent = `Банкет буде створено автоматично з кухні ${roomSelectionBanquetContextLabel(sourceOnlyCreateContext)} під час збереження активності.`;
        } else if (selected) {
            hint.textContent = `Вибрано: ${bookingBanquetGroupCandidateLabel(selected)}`;
        } else if (visibleCandidates.length) {
            hint.textContent = 'Оберіть банкет цього клієнта або залиште без прив’язки.';
        } else if (fallbackCandidates.length) {
            hint.textContent = 'Для цього клієнта банкетів на дату не знайдено. Є групи без клієнта, але вони не підставляються автоматично.';
        } else {
            hint.textContent = 'Банкетів цього клієнта на дату не знайдено.';
        }
    }
}

async function refreshBookingBanquetGroupCandidates(options = {}) {
    const customerId = bookingBanquetGroupSelectedCustomerId();
    const date = bookingBanquetGroupDateValue();
    const preselectGroupId = String(options.preselectGroupId || '').trim();
    if (!isParkTimelineBookingMode() || !customerId || !date || typeof apiGetBanquetCandidates !== 'function') {
        resetBookingBanquetGroupSelector();
        return;
    }

    const key = `${date}:${customerId}`;
    const currentSelected = preselectGroupId || (options.preserveSelection === false ? '' : getSelectedBookingBanquetGroupId());
    BookingDrawerState.selectedBanquetGroupId = currentSelected;
    BookingDrawerState.banquetGroupCandidatesKey = key;
    BookingDrawerState.banquetGroupCandidatesLoading = true;
    renderBookingBanquetGroupSelector();

    const result = await apiGetBanquetCandidates({ date, customerId });
    if (BookingDrawerState.banquetGroupCandidatesKey !== key) return;
    BookingDrawerState.banquetGroupCandidatesLoading = false;
    if (result?.success === false) {
        BookingDrawerState.banquetGroupCandidates = [];
        BookingDrawerState.banquetGroupFallbackCandidates = [];
        renderBookingBanquetGroupSelector({ error: result.error || 'load_failed' });
        return;
    }
    BookingDrawerState.banquetGroupCandidates = (result?.candidates || [])
        .map(normalizeBookingBanquetGroupCandidate)
        .filter(Boolean);
    BookingDrawerState.banquetGroupFallbackCandidates = (result?.fallbackCandidates || [])
        .map(normalizeBookingBanquetGroupCandidate)
        .filter(Boolean);
    const all = allBookingBanquetGroupCandidates();
    const selectedStillExists = all.some(candidate => String(candidate.groupId) === String(BookingDrawerState.selectedBanquetGroupId));
    if (BookingDrawerState.selectedBanquetGroupId && !selectedStillExists) {
        BookingDrawerState.selectedBanquetGroupId = '';
    }
    renderBookingBanquetGroupSelector();
}

function scheduleBookingBanquetGroupCandidatesRefresh(options = {}) {
    refreshBookingBanquetGroupCandidates(options).catch(error => {
        console.warn('[Booking] Не вдалося завантажити банкети клієнта', error);
        BookingDrawerState.banquetGroupCandidatesLoading = false;
        BookingDrawerState.banquetGroupCandidates = [];
        BookingDrawerState.banquetGroupFallbackCandidates = [];
        renderBookingBanquetGroupSelector({ error: true });
    });
}

function attachBanquetGroupContextToBooking(booking, context = {}, role = 'activity', source = 'booking_banquet_group_selector') {
    if (!booking || (!context.groupId && !context.sourceBookingId)) return booking;
    if (!booking.extraData) booking.extraData = {};
    booking.extraData.banquetGroup = {
        ...(booking.extraData.banquetGroup || {}),
        groupId: context.groupId || null,
        sourceBookingId: context.sourceBookingId || null,
        role,
        source
    };
    return booking;
}

function isSelectedBanquetKitchenCreate(formData = {}) {
    return formData.scenario === 'kitchen_only' || (formData.kitchenEnabled && !formData.hasEvent);
}

function isSelectedBanquetActivityCreate(formData = {}) {
    return Boolean(formData.hasEvent && !formData.kitchenEnabled);
}

function selectedBanquetUnsupportedCreateMessage() {
    return 'Прив’язка до банкету працює для кухні або однієї активності. Зніміть прив’язку або створіть бронювання окремо.';
}

function hasUsableSelectedBanquetGroup(context = selectedBookingBanquetGroupContext()) {
    if (!context?.groupId) return false;
    if (context.candidate) return true;
    const roomContext = BookingDrawerState.roomSelectionBanquetContext;
    return Boolean(roomContext?.groupId && String(roomContext.groupId) === String(context.groupId));
}

function activityFirstKitchenSourceContext(context = selectedBookingBanquetGroupContext()) {
    const roomContext = BookingDrawerState.roomSelectionBanquetContext;
    if (roomContext?.sourceBookingId && !roomContext.groupId) return roomContext;
    if (context?.sourceBookingId && !context.groupId) return context;
    return null;
}

function validateActivityFirstKitchenBridge(formData = {}, context = selectedBookingBanquetGroupContext()) {
    if (!isParkTimelineBookingMode() || !isSelectedBanquetKitchenCreate(formData)) return { shouldUse: false };
    if (hasUsableSelectedBanquetGroup(context)) return { shouldUse: false };

    const sourceContext = activityFirstKitchenSourceContext(context);
    if (!sourceContext?.sourceBookingId) return { shouldUse: false };

    const sourceBooking = sourceContext?.sourceBooking || null;
    if (!sourceBooking || !sourceContext.sourceBookingId) {
        return {
            shouldUse: true,
            error: 'Джерело кімнати застаріло. Оберіть кімнату ще раз перед збереженням кухні.'
        };
    }
    if (roomBookingIsCancelled(sourceBooking)) {
        return {
            shouldUse: true,
            error: 'Бронювання-джерело в цій кімнаті вже скасоване. Оберіть кімнату ще раз.'
        };
    }
    if (roomBookingIsLinkedChild(sourceBooking)) {
        return {
            shouldUse: true,
            error: 'Кухню можна прив’язати тільки до основного бронювання, не до технічного дубля. Оберіть кімнату ще раз.'
        };
    }

    const sourceCustomerId = sourceContext.sourceCustomerId ?? roomBookingCustomerId(sourceBooking);
    const selectedCustomerId = bookingBanquetGroupSelectedCustomerId();
    const auto = BookingDrawerState.autoFilledCustomerFromRoom;
    const selectedMatchesSource = Boolean(sourceCustomerId && selectedCustomerId && String(sourceCustomerId) === String(selectedCustomerId));
    const autoFilledMatchesSource = Boolean(
        auto?.customerId &&
        selectedCustomerId &&
        String(auto.customerId) === String(selectedCustomerId) &&
        String(auto.customerId) === String(sourceCustomerId || '') &&
        (!auto.sourceBookingId || String(auto.sourceBookingId) === String(sourceContext.sourceBookingId))
    );
    if (!selectedMatchesSource && !autoFilledMatchesSource) {
        return {
            shouldUse: true,
            error: 'Клієнт кухні не збігається з клієнтом бронювання в кімнаті. Очистіть клієнта або оберіть кімнату ще раз.'
        };
    }

    return {
        shouldUse: true,
        context: sourceContext
    };
}

function validateKitchenFirstActivityBridge(formData = {}, context = selectedBookingBanquetGroupContext()) {
    if (!isParkTimelineBookingMode() || !isSelectedBanquetActivityCreate(formData)) return { shouldUse: false };
    if (hasUsableSelectedBanquetGroup(context)) return { shouldUse: false };

    const bridgeContext = BookingDrawerState.roomBookingAnimationBridge;
    if (!bridgeContext?.sourceBookingId || bridgeContext.groupId) return { shouldUse: false };

    const sourceBooking = bridgeContext.sourceBooking || null;
    if (!sourceBooking || !bridgeContext.sourceBookingId) {
        return {
            shouldUse: true,
            error: 'Джерело кухні застаріло. Відкрийте активність з кімнатної броні ще раз.'
        };
    }
    if (!roomBookingLooksLikeKitchen(sourceBooking)) {
        return {
            shouldUse: true,
            error: 'Бронювання-джерело не схоже на кухню або банкетне замовлення. Оберіть кухонну бронь ще раз.'
        };
    }
    if (roomBookingIsCancelled(sourceBooking)) {
        return {
            shouldUse: true,
            error: 'Кухонне бронювання-джерело вже скасоване. Оберіть іншу бронь.'
        };
    }
    if (roomBookingIsLinkedChild(sourceBooking)) {
        return {
            shouldUse: true,
            error: 'Активність можна прив’язати тільки до основної кухонної броні, не до технічного дубля.'
        };
    }

    const sourceCustomerId = bridgeContext.sourceCustomerId ?? roomBookingCustomerId(sourceBooking);
    const selectedCustomerId = bookingBanquetGroupSelectedCustomerId();
    const selectedMatchesSource = Boolean(sourceCustomerId && selectedCustomerId && String(sourceCustomerId) === String(selectedCustomerId));
    if (!selectedMatchesSource) {
        return {
            shouldUse: true,
            error: 'Клієнт активності не збігається з клієнтом кухонної броні. Оберіть правильного клієнта або відкрийте бронь ще раз.'
        };
    }

    return {
        shouldUse: true,
        context: {
            ...bridgeContext,
            sourceBooking,
            sourceCustomerId,
            source: 'kitchen_first_activity_bridge'
        }
    };
}

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
    room.value = value;
    room.setAttribute('aria-invalid', 'false');
}

function ensureTimelineRoomOption(value) {
    ensureMaysternyaRoomOption(value || getTimelineBookingPresentation().roomOptionLabel || 'Кабінет');
}

const BOOKING_ROOM_FALLBACK_GROUP = '__ungrouped__';
const BOOKING_ROOM_NON_OPERATIONAL_VALUES = new Set(['Інше', 'Other']);
const BookingRoomAvailabilityState = {
    baseGroups: null,
    defaultHint: '',
    occupiedRooms: new Set(),
    occupiedNowRooms: new Set(),
    roomDayBookings: new Map(),
    availableRooms: new Set()
};

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
                    disabled: option.disabled
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
                    disabled: child.disabled
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
    const value = booking.kidsCount ?? booking.kids_count;
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

function pickRoomBanquetSourceBooking(roomName, targetTime = document.getElementById('bookingTime')?.value || '') {
    if (!isParkTimelineBookingMode()) return null;
    const room = String(roomName || document.getElementById('roomSelect')?.value || '').trim();
    if (!room) return null;
    const candidates = selectedRoomDayBookings(room)
        .map(normalizeRoomDayBookingEntry)
        .filter(booking => booking.id && !roomBookingIsCancelled(booking) && !roomBookingIsLinkedChild(booking));
    if (!candidates.length) return null;
    return candidates.sort((a, b) =>
        roomBookingTargetOverlapRank(a, targetTime) - roomBookingTargetOverlapRank(b, targetTime)
        || scoreRoomCustomerSourceBooking(a, targetTime) - scoreRoomCustomerSourceBooking(b, targetTime)
        || Number(roomBookingHasBanquetContext(b)) - Number(roomBookingHasBanquetContext(a))
        || Number(Boolean(roomBookingCustomerId(b))) - Number(Boolean(roomBookingCustomerId(a)))
        || String(a.time || '').localeCompare(String(b.time || ''))
        || String(a.id || '').localeCompare(String(b.id || ''))
    )[0] || null;
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
    const requestedCapacity = parseInt(document.getElementById('kidsCountInput')?.value || '', 10);
    if (Number.isFinite(requestedCapacity) && requestedCapacity > 0) params.push(`capacity=${encodeURIComponent(String(requestedCapacity))}`);
    if (params.length) path += `${path.includes('?') ? '&' : '?'}${params.join('&')}`;
    const response = await fetch(`${API_BASE}${path}`, { headers: getAuthHeaders(false) });
    if (handleAuthError(response)) return null;
    if (!response.ok) throw new Error(`rooms/free ${response.status}`);
    return response.json();
}

async function refreshBookingRoomAvailabilityForSelectedDate(options = {}) {
    if (!isParkTimelineBookingMode()) return;
    snapshotBookingRoomOptions();
    const selectedRoom = String(options.selectedRoom ?? document.getElementById('roomSelect')?.value ?? '').trim();
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
    const banquetGuests = document.getElementById('banquetGuests')?.value?.trim();
    if (banquetGuests) return banquetGuests;
    const kidsCount = document.getElementById('kidsCountInput')?.value?.trim();
    if (kidsCount) return kidsCount;
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
    const kidsCount = parseInt(document.getElementById('kidsCountInput')?.value || formData?.kidsCount || 0, 10);
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
    const nextMode = mode === 'new' ? 'search' : mode;
    BookingDrawerState.clientMode = nextMode;
    const selectedCard = document.getElementById('bookingSelectedCustomerCard');
    const newCustomerForm = document.getElementById('bookingNewCustomerForm');
    const searchState = document.getElementById('bookingCustomerSearchState');
    const changeBtn = document.getElementById('bookingChangeCustomerBtn');
    const modeLabel = document.getElementById('bookingCustomerModeLabel');
    const customerSearch = document.getElementById('customerSearch');
    const hasSelected = Boolean(document.getElementById('selectedCustomerId')?.value);

    if (selectedCard) selectedCard.classList.toggle('hidden', nextMode !== 'existing');
    if (newCustomerForm) {
        newCustomerForm.classList.add('hidden');
        newCustomerForm.hidden = true;
        newCustomerForm.setAttribute('aria-hidden', 'true');
    }
    if (searchState && nextMode !== 'search') {
        searchState.classList.add('hidden');
        searchState.innerHTML = '';
    }
    if (changeBtn) changeBtn.classList.toggle('hidden', !hasSelected);
    if (modeLabel) {
        if (nextMode === 'existing') modeLabel.textContent = 'Прикріплено існуючу картку клієнта.';
        else modeLabel.textContent = 'Знайдіть і виберіть існуючу картку клієнта.';
    }
    if (customerSearch) customerSearch.setAttribute('aria-expanded', nextMode === 'search' ? 'true' : 'false');
    if (options.focusSearch) customerSearch?.focus();
}

function renderSelectedCustomerCard(customer = null) {
    const card = document.getElementById('bookingSelectedCustomerCard');
    if (!card) return;
    if (!customer) {
        card.innerHTML = '';
        card.classList.add('hidden');
        return;
    }
    const name = customer.name || 'Клієнт';
    const phone = customer.phone ? `<small>${escapeHtml(customer.phone)}</small>` : '';
    const instagram = customer.instagram ? `<small>@${escapeHtml(customer.instagram)}</small>` : '';
    const childName = customer.childName ? `<small>Дитина: ${escapeHtml(customer.childName)}</small>` : '';
    card.innerHTML = `
        <strong>${escapeHtml(name)}</strong>
        ${phone}
        ${instagram}
        ${childName}
    `;
    card.classList.remove('hidden');
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

function getSmartBookingValidationState() {
    const formData = getBookingFormData();
    const presentation = window.TimelineBusinessContext?.presentation?.() || { mode: 'park' };
    const roomOptional = isOptionalTimelineRoomBookingMode(presentation);
    const hasDateTime = Boolean(formData?.time) && Boolean(AppState.selectedDate);
    const hasRoom = Boolean(formData?.room);
    const hasSelectedCustomer = Boolean(document.getElementById('selectedCustomerId')?.value);
    const hasClient = hasSelectedCustomer;
    const isEducation = presentation.mode === 'education';
    const lessonTitle = document.getElementById('educationLessonTitle')?.value?.trim() || '';
    const hasProgram = Boolean(formData?.programId) || (isEducation && Boolean(lessonTitle));
    const programRequired = getBookingWorkspaceHasEvent();
    const primaryAnimatorRequired = false;
    const warnings = [];
    const errors = [];
    const invalidFields = [];

    if (!hasDateTime) errors.push('Не вдалося визначити дату або час для бронювання.');
    if (!hasRoom && !roomOptional) {
        errors.push(presentation.mode === 'education' ? 'Оберіть кабінет.' : 'Оберіть кімнату.');
        invalidFields.push('roomSelect');
    }
    if (!hasClient) {
        errors.push('Оберіть існуючого клієнта з пошуку.');
        invalidFields.push('customerSearch');
    }
    if (programRequired && !hasProgram) {
        errors.push(isEducation ? 'Оберіть заняття або вкажіть тему.' : 'Оберіть програму події.');
        invalidFields.push(isEducation ? 'educationLessonTitle' : 'selectedProgram');
    }
    if (primaryAnimatorRequired) {
        errors.push('Оберіть аніматора для активної програми.');
        invalidFields.push('bookingPrimaryAnimatorSelect');
    }
    return {
        valid: errors.length === 0,
        canSubmit: errors.length === 0,
        warnings,
        errors,
        invalidFields,
        error: errors[0] || ''
    };
}

function formatBookingValidationList(validation) {
    const errors = Array.isArray(validation?.errors) && validation.errors.length
        ? validation.errors
        : (validation?.error ? [validation.error] : []);
    return errors.map((error, index) => `${index + 1}. ${error}`).join('\n');
}

function renderBookingValidationIssues(validation) {
    const errors = Array.isArray(validation?.errors) ? validation.errors : [];
    if (!errors.length) return '';
    return `
        <div class="booking-summary-note booking-summary-note--error">
            <strong>Ще треба заповнити:</strong>
            <ul>
                ${errors.map(error => `<li>${escapeHtml(error)}</li>`).join('')}
            </ul>
        </div>
    `;
}

function applyBookingValidationInvalidFields(validation) {
    const fieldIds = [
        'roomSelect',
        'customerSearch',
        'customerName',
        'customerPhone',
        'customerInstagram',
        'selectedProgram',
        'educationLessonTitle',
        'bookingPrimaryAnimatorSelect'
    ];
    const invalid = new Set(validation?.invalidFields || []);
    fieldIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.setAttribute('aria-invalid', invalid.has(id) ? 'true' : 'false');
    });
}

function showBookingValidationErrors(validation) {
    BookingDrawerState.validationAttempted = true;
    applyBookingValidationInvalidFields(validation);
    renderBookingPackageSummary();
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
    if (submit && !AppState.editingBookingId) submit.textContent = 'Записати прийом';

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
    if (submit && !AppState.editingBookingId) submit.textContent = presentation.submitLabel;

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
        studentCount: parseInt(document.getElementById('kidsCountInput')?.value || '0', 10) || null,
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

function bookingKitchenChildrenCountFromBooking(booking = {}) {
    const value = booking?.kidsCount ?? booking?.kids_count ?? booking?.banquetGuests ?? booking?.banquet_guests;
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

function normalizeBookingMenuServingUnitDisplay(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.replace(/^(\d+(?:[,.]\d+)?)\s*(кг|г|гр|мг|л|мл)$/iu, '$1 $2');
}

function isBookingMenuPortionServingUnit(value) {
    const unit = normalizeBookingMenuServingUnitDisplay(value).toLowerCase().replace(/\.$/, '');
    return !unit || BOOKING_MENU_PORTION_UNITS.has(unit);
}

function isBookingMenuPackServingUnit(value) {
    return /^\d+(?:[,.]\d+)?\s*(кг|г|гр|мг|л|мл)$/iu.test(normalizeBookingMenuServingUnitDisplay(value));
}

function formatBookingMenuQuantityWithServingUnit(quantity, servingUnit) {
    const quantityLabel = formatBookingMenuQuantityNumber(quantity);
    const unit = normalizeBookingMenuServingUnitDisplay(servingUnit);
    if (isBookingMenuPortionServingUnit(unit)) return `${quantityLabel} ${bookingMenuPortionWord(quantity)}`;
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
    const values = [
        document.getElementById('banquetGuests')?.value,
        document.getElementById('kidsCountInput')?.value,
        roomSource?.kidsCount,
        roomSource?.kids_count
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

function bookingMenuProductImageUrl(product = {}) {
    const explicitUrl = bookingMenuSafeImageUrl(
        product.imageUrl
        || product.image_url
        || product.photoUrl
        || product.photo_url
        || product.coverUrl
        || product.cover_url
        || product.thumbnailUrl
        || product.thumbnail_url
        || ''
    );
    return explicitUrl || bookingMenuImageManifestUrl(product);
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

const BOOKING_MENU_CATALOG_FALLBACK_IMAGE = '/images/kitchen-menu/fallback-burger-wide.jpg';

function bookingMenuCatalogVisualHtml(product = {}, title = '', modifier = '') {
    const productImageUrl = bookingMenuProductImageUrl(product);
    const imageUrl = productImageUrl || BOOKING_MENU_CATALOG_FALLBACK_IMAGE;
    const usesFallback = !productImageUrl;
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
                ? `<img loading="lazy" decoding="async" src="${escapeHtml(imageUrl)}" alt="" data-menu-catalog-fallback="${usesFallback ? '1' : '0'}" onerror="window.bookingMenuCatalogHandleImageError && window.bookingMenuCatalogHandleImageError(this)">`
                : ''}
            <span aria-hidden="true">${escapeHtml(emoji)}</span>
        </div>
    `;
}

function bookingMenuCatalogHandleImageError(img) {
    const thumb = img?.closest?.('.booking-menu-catalog-thumb');
    if (!img || !thumb) return;
    if (img.dataset.menuCatalogFallback !== '1') {
        img.dataset.menuCatalogFallback = '1';
        img.src = BOOKING_MENU_CATALOG_FALLBACK_IMAGE;
        thumb.classList.add('uses-fallback-image');
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
                            ${note ? `<span class="booking-menu-catalog-note-preview">${escapeHtml(note)}</span>` : ''}
                        </div>
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
    ['bookingMenuProductSelect', 'bookingMenuNote', 'bookingMenuUnitPrice', 'bookingMenuPositionsJson', 'banquetMenu', 'banquetGuests', 'banquetAdults', 'banquetTables'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
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

function getProgramBasePrice(program) {
    if (!program) return 0;
    const pinataMode = getPinataModeValue();
    if (pinataMode === 'client') return toBookingMoney(document.getElementById('clientPinataServicePrice')?.value || getClientPinataDefaultPrice());
    if (pinataMode === 'none' && isPinataProgram(program)) return 0;
    const kidsCount = Number(document.getElementById('kidsCountInput')?.value || 0);
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

function updateBookingSubmitState() {
    const submitBtn = document.getElementById('bookingSubmitBtn');
    const hint = document.getElementById('bookingSubmitHint');
    if (!submitBtn || !hint) return;
    const validation = getSmartBookingValidationState();
    const originalText = submitBtn.dataset.originalText || 'Додати бронювання';
    const isSaving = Boolean(submitBtn.disabled && submitBtn.dataset.originalText && submitBtn.textContent !== originalText);
    if (!isSaving) {
        submitBtn.disabled = false;
        submitBtn.setAttribute('aria-disabled', validation.canSubmit ? 'false' : 'true');
        submitBtn.classList.toggle('btn-submit--needs-input', !validation.canSubmit);
    }
    if (!validation.canSubmit) {
        hint.textContent = `${validation.error || 'Оберіть кімнату та клієнта.'} Натисніть кнопку — покажу весь список.`;
        return;
    }
    if (validation.warnings?.length) {
        hint.textContent = validation.warnings[0];
        return;
    }
    hint.textContent = 'Можна створювати бронювання.';
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
    const roomLabel = roomSelect?.selectedOptions?.[0]?.textContent?.trim() || roomValue || 'не вибрано';
    const selectedCustomerName = document.querySelector('#bookingSelectedCustomerCard strong')?.textContent?.trim() || '';
    const resolvedCustomerName = selectedCustomerName || (customerId ? customerName : '') || (customerId ? 'Існуючий клієнт' : 'не вибрано');
    const totals = getBookingPackageTotals(program);
    const roomFirst = isRoomFirstTimelineView();
    const kitchenEnabled = isBookingKitchenEnabled();
    const validation = getSmartBookingValidationState();
    const programSubtotal = hasEvent ? toBookingMoney(totals.programBasePrice) : 0;
    const menuSubtotal = kitchenEnabled ? toBookingMoney(totals.positionsSubtotal) : 0;
    const entrySubtotal = kitchenEnabled ? toBookingMoney(totals.entrySubtotal || 0) : 0;
    const finalTotal = toBookingMoney(programSubtotal + menuSubtotal + entrySubtotal);
    const menuCount = Array.isArray(totals.menuPositions) ? totals.menuPositions.length : 0;
    const programLabel = program
        ? `${program.code || program.shortLabel || 'ПРО'} · ${program.duration ? `${program.duration} хв` : 'без тривалості'}`
        : (roomFirst ? (menuCount ? `${menuCount} позицій меню / тортів` : 'додайте їжу або торт') : (hasEvent ? 'не вибрано' : 'вимкнено'));
    const programRowLabel = roomFirst ? 'Кухня / меню' : 'Програма';
    const entryCharge = totals.entryCharge || (entrySubtotal > 0 ? { title: 'Вхід', subtotal: entrySubtotal } : null);

    if (!roomValue && !customerId && !customerName && !document.getElementById('selectedProgram')?.value) {
        container.innerHTML = `
            <div class="booking-summary-empty">${roomFirst ? 'Оберіть кімнату, клієнта і додайте їжу або торт — підсумок оновиться автоматично.' : 'Оберіть кімнату, клієнта і програму — підсумок оновиться автоматично.'}</div>
            ${BookingDrawerState.validationAttempted ? renderBookingValidationIssues(validation) : ''}
        `;
        updateBookingSubmitState();
        return;
    }
    container.innerHTML = `
        <div class="booking-summary-row"><span>Кімната</span><strong>${escapeHtml(roomLabel)}</strong></div>
        <div class="booking-summary-row"><span>Клієнт</span><strong>${escapeHtml(resolvedCustomerName)}</strong></div>
        <div class="booking-summary-row"><span>${escapeHtml(programRowLabel)}</span><strong>${escapeHtml(programLabel)}</strong></div>
        ${programSubtotal > 0 ? `<div class="booking-summary-row booking-summary-row--subtotal"><span>Програма / активність</span><strong>${escapeHtml(formatPrice(programSubtotal))}</strong></div>` : ''}
        ${kitchenEnabled && (menuSubtotal > 0 || menuCount > 0) ? `<div class="booking-summary-row booking-summary-row--subtotal"><span>Меню</span><strong>${escapeHtml(formatPrice(menuSubtotal))}</strong></div>` : ''}
        ${kitchenEnabled && entrySubtotal > 0 ? `<div class="booking-summary-row booking-summary-row--subtotal"><span>Вхід</span><strong>${escapeHtml(formatBookingPackageEntryAmount(entryCharge))}</strong></div>` : ''}
        <div class="booking-summary-row booking-summary-total"><span>Разом</span><strong>${escapeHtml(formatPrice(finalTotal))}</strong></div>
        ${BookingDrawerState.validationAttempted ? renderBookingValidationIssues(validation) : ''}
        ${totals.warnings?.length ? `<div class="booking-summary-note">${escapeHtml(totals.warnings[0].message || totals.warnings[0].code)}</div>` : ''}
        ${validation.warnings?.length ? `<div class="booking-summary-note">${escapeHtml(validation.warnings[0])}</div>` : ''}
    `;
    updateBookingSubmitState();
}

function getBookingPackageFromBooking(booking) {
    const extraData = booking?.extraData || booking?.extra_data || {};
    const packageData = booking?.bookingPackage
        || booking?.booking_package
        || extraData?.bookingPackage
        || extraData?.booking_package
        || null;
    if (packageData) {
        const menuPositions = (packageData.menuPositions || packageData.menu_positions || [])
            .map((item, index) => normalizeBookingMenuPosition(item, index))
            .filter(Boolean);
        const serviceEvents = (packageData.serviceEvents || packageData.service_events || [])
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

function bookingServingTimeLabel(value) {
    return value || 'Час видачі не вказано';
}

function groupedBookingMenuPositions(positions = []) {
    const groups = new Map();
    positions.forEach(item => {
        const key = item.servingTime || '__missing__';
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                servingTime: item.servingTime || null,
                items: []
            });
        }
        groups.get(key).items.push(item);
    });
    return Array.from(groups.values()).sort((a, b) => {
        if (!a.servingTime && !b.servingTime) return 0;
        if (!a.servingTime) return 1;
        if (!b.servingTime) return -1;
        return a.servingTime.localeCompare(b.servingTime);
    });
}

function renderBookingPackageMenuRows(positions = []) {
    if (!positions.length) return '';
    return groupedBookingMenuPositions(positions).map(group => `
        <div class="booking-detail-package-serving-group${group.servingTime ? '' : ' booking-detail-package-serving-group--missing'}">
            <div class="booking-detail-package-serving-title">
                <span>${escapeHtml(bookingServingTimeLabel(group.servingTime))}</span>
                <small>${escapeHtml(String(group.items.length))} позицій</small>
            </div>
            <div class="booking-detail-package-table" role="table" aria-label="Позиції меню ${escapeHtml(bookingServingTimeLabel(group.servingTime))}">
                <div class="booking-detail-package-table-head" role="row">
                    <span role="columnheader">Позиція</span>
                    <span role="columnheader">К-сть</span>
                    <span role="columnheader">Ціна</span>
                    <span role="columnheader">Сума</span>
                </div>
            ${group.items.map(item => `
                <div class="booking-detail-package-table-row" role="row">
                    <div class="booking-detail-package-item" role="cell">
                        <span class="booking-menu-position-kind">${escapeHtml(bookingKitchenTypeLabel(item.kitchenType))}</span>${escapeHtml(item.title)}
                        ${item.note || item.servingNote ? `<small>${item.note ? escapeHtml(item.note) : ''}${item.note && item.servingNote ? ' · ' : ''}${item.servingNote ? escapeHtml(item.servingNote) : ''}</small>` : ''}
                    </div>
                    <span role="cell">${escapeHtml(formatBookingMenuPositionQuantity(item))}</span>
                    <span role="cell">${escapeHtml(formatPrice(item.unitPrice || 0))}</span>
                    <strong role="cell">${escapeHtml(formatPrice(item.subtotal || 0))}</strong>
                </div>
            `).join('')}
            </div>
        </div>
    `).join('');
}

function formatBookingEntryQuantityLabel(quantity) {
    const value = Number(quantity);
    if (!Number.isFinite(value) || value <= 0) return '';
    return `${formatBookingMenuQuantityNumber(value)} дітей`;
}

function bookingPackageMoneyValue(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return 0;
    return Math.round(amount * 100) / 100;
}

function bookingPackageEntryChargeFromPackage(bookingPackage = {}) {
    if (!bookingPackage || typeof bookingPackage !== 'object') return null;
    const raw = bookingPackage.entryCharge || bookingPackage.entry_charge || null;
    const entrySubtotal = bookingPackageMoneyValue(
        bookingPackage.entrySubtotal
        ?? bookingPackage.entry_subtotal
        ?? (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw.subtotal ?? raw.entrySubtotal ?? raw.entry_subtotal) : 0)
    );
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const subtotal = bookingPackageMoneyValue(raw.subtotal ?? raw.entrySubtotal ?? raw.entry_subtotal ?? entrySubtotal);
        if (subtotal <= 0) return null;
        return {
            title: raw.title || 'Вхід',
            quantity: raw.quantity ?? raw.qty ?? null,
            unitPrice: raw.unitPrice ?? raw.unit_price ?? null,
            subtotal,
            ruleCode: raw.ruleCode || raw.rule_code || null,
            dateType: raw.dateType || raw.date_type || null,
            fallback: false
        };
    }
    if (entrySubtotal <= 0) return null;
    return {
        title: 'Вхід',
        quantity: null,
        unitPrice: null,
        subtotal: entrySubtotal,
        ruleCode: null,
        dateType: null,
        fallback: true
    };
}

function formatBookingPackageEntryAmount(entryCharge = {}) {
    const subtotal = bookingPackageMoneyValue(entryCharge.subtotal || 0);
    const quantityLabel = formatBookingEntryQuantityLabel(entryCharge.quantity);
    const unitPrice = bookingPackageMoneyValue(entryCharge.unitPrice ?? entryCharge.unit_price ?? 0);
    if (quantityLabel && unitPrice > 0) {
        return `${quantityLabel} × ${formatPrice(unitPrice)} = ${formatPrice(subtotal)}`;
    }
    return formatPrice(subtotal);
}

function renderBookingPackageEntryRow(bookingPackage = {}) {
    const entryCharge = bookingPackageEntryChargeFromPackage(bookingPackage);
    if (!entryCharge) return '';
    const label = formatBookingPackageEntryAmount(entryCharge);
    const details = entryCharge.fallback
        ? 'Деталі кількості та ціни не збережені у пакеті.'
        : label;
    return `
        <div class="booking-detail-package-row booking-detail-package-entry-row">
            <div>${escapeHtml(entryCharge.title || 'Вхід')}<small>${escapeHtml(details)}</small></div>
            <strong>${escapeHtml(formatPrice(entryCharge.subtotal))}</strong>
        </div>
    `;
}

function renderBookingPackageDetail(booking, options = {}) {
    const bookingPackage = getBookingPackageFromBooking(booking);
    const positions = bookingPackage?.menuPositions || [];
    const serviceEvents = bookingPackage?.serviceEvents || [];
    if (!bookingPackage && !booking?.banquetMenu) return '';
    const title = options.title || 'Меню / сервісні позиції';
    const modifier = options.compact ? ' booking-detail-package--compact' : '';
    const includeServiceEvents = options.includeServiceEvents !== false;
    const missingServingTimes = bookingMenuMissingServingTimeCount(positions);
    const rows = positions.length
        ? renderBookingPackageMenuRows(positions)
        : (booking?.banquetMenu ? `<div class="booking-detail-package-row"><div>${escapeHtml(booking.banquetMenu)}</div><strong>—</strong></div>` : '');
    const entryRow = renderBookingPackageEntryRow(bookingPackage);
    const eventRows = includeServiceEvents && serviceEvents.length
        ? `
            <div class="booking-detail-package-subtitle">Подачі / сервіс</div>
            <div class="booking-detail-package-service-list">
            ${serviceEvents.map(event => `
                <div class="booking-detail-package-service-row">
                    <span class="booking-detail-package-service-dot" aria-hidden="true"></span>
                    <div>
                        <strong>${event.time ? `${escapeHtml(event.time)} · ` : ''}${escapeHtml(event.title || BOOKING_SERVICE_EVENT_TYPES[event.type] || 'Подія')}</strong>
                        ${event.note ? `<small>${escapeHtml(event.note)}</small>` : ''}
                    </div>
                </div>
            `).join('')}
            </div>
        `
        : '';
    return `
        <div class="booking-detail-package${modifier}">
            <div class="booking-detail-package-header">${escapeHtml(title)}</div>
            ${missingServingTimes ? `<div class="booking-summary-note">Не вказано час видачі для ${escapeHtml(String(missingServingTimes))} позицій.</div>` : ''}
            ${rows}
            ${entryRow}
            ${eventRows}
            <div class="booking-detail-package-row booking-detail-package-total">
                <div>Разом пакет</div>
                <strong>${escapeHtml(formatPrice(bookingPackage?.finalTotal ?? booking.price ?? 0))}</strong>
            </div>
        </div>
    `;
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

function renderBookingWorkspaceDetail(booking) {
    const workspace = getBookingWorkspaceFromBooking(booking);
    if (!workspace && booking?.programId) return '';
    const scenario = workspace?.scenario || (booking?.programId ? 'event' : 'lead_only');
    const meta = getBookingWorkspaceScenarioMeta(scenario);
    const scenarioRowHtml = shouldHideBookingWorkspaceScenarioDetail(booking)
        ? ''
        : `<div class="booking-detail-row"><span class="label">Сценарій:</span><span class="value">${escapeHtml(meta.label)}</span></div>`;
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
        const refreshHosts = () => refreshAnimatorSelectsForCurrentSlot().catch(() => {});
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
        const auto = BookingDrawerState.autoFilledBanquetFromRoom;
        if (auto?.groupId && String(event.target.value || '') !== String(auto.groupId)) {
            BookingDrawerState.autoFilledBanquetFromRoom = null;
            BookingDrawerState.roomSelectionBanquetContext = null;
            if (typeof clearAutoFilledBanquetGuestsFromRoom === 'function') clearAutoFilledBanquetGuestsFromRoom();
        }
        BookingDrawerState.selectedBanquetGroupId = String(event.target.value || '').trim();
        BookingDrawerState.manualBanquetGroupSelection = Boolean(BookingDrawerState.selectedBanquetGroupId);
        renderBookingBanquetGroupSelector();
        renderBookingPackageSummary();
        if (window.BookingForm) BookingForm._dirty = true;
    });
    ['roomSelect', 'customerSearch', 'customerName', 'customerChildName', 'selectedProgram', 'bookingPrimaryAnimatorSelect', 'kidsCountInput', 'clientPinataServicePrice', 'pinataMode', 'banquetMenu', 'banquetGuests', 'banquetAdults', 'banquetTables',
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
            if (id === 'customerName' || id === 'customerPhone' || id === 'customerInstagram') {
                debouncedBookingDuplicateCheck();
            }
        });
        el.addEventListener('change', () => {
            if (id === 'educationLessonGroup') syncEducationGroupToBookingGroup();
            if (id === 'banquetGuests' && typeof markBanquetGuestsManualOverride === 'function') markBanquetGuestsManualOverride();
            renderBookingPackageSummary();
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
    if (booking?.pinataMode) return booking.pinataMode;
    if (booking?.programId === 'pinata_own') return 'client';
    if (booking?.clientPinataServicePrice !== undefined && booking?.clientPinataServicePrice !== null) return 'client';
    if (isClientPinataFillerNumber(booking?.pinataFillerNumber) || isClientPinataFillerChoice(booking?.pinataFiller)) return 'park';
    if (booking?.pinataFiller) return 'park';
    return isPinataProgram(program) ? 'park' : 'none';
}

function renderPinataDetailRows(booking) {
    const clientOwnedFiller = isClientPinataFillerNumber(booking?.pinataFillerNumber) || isClientPinataFillerChoice(booking?.pinataFiller);
    const numberRows = [
        booking?.pinataNumber
            ? `<div class="booking-detail-row"><span class="label">Номер піньяти:</span><span class="value">${escapeHtml(booking.pinataNumber)}</span></div>`
            : '',
        clientOwnedFiller
            ? `<div class="booking-detail-row"><span class="label">Наповнювач:</span><span class="value">${escapeHtml(CLIENT_PINATA_FILLER_LABEL)}</span></div>`
            : (booking?.pinataFillerNumber
                ? `<div class="booking-detail-row"><span class="label">Номер наповнювача:</span><span class="value">${escapeHtml(pinataFillerNumberLabel(booking.pinataFillerNumber))}</span></div>`
                : '')
    ].join('');

    if (booking?.pinataMode === 'client') {
        const note = booking.clientPinataServiceNote
            ? `<div class="booking-detail-row"><span class="label">Нотатка:</span><span class="value">${escapeHtml(booking.clientPinataServiceNote)}</span></div>`
            : '';
        return `<div class="booking-detail-row"><span class="label">Піньята:</span><span class="value">Клієнтська піньята (послуга)${booking.clientPinataServicePrice ? ` - ${escapeHtml(formatPrice(booking.clientPinataServicePrice))}` : ''}</span></div>${numberRows}${note}`;
    }
    if ((booking?.pinataMode === 'park' || !booking?.pinataMode) && booking?.pinataFiller) {
        if (isClientPinataFillerChoice(booking.pinataFiller)) return numberRows;
        return `<div class="booking-detail-row"><span class="label">Піньята парку:</span><span class="value">${escapeHtml(booking.pinataFiller)}</span></div>${numberRows}`;
    }
    if (numberRows) return numberRows;

    if (booking?.pinataMode === 'client') {
        const note = booking.clientPinataServiceNote
            ? `<div class="booking-detail-row"><span class="label">Нотатка:</span><span class="value">${escapeHtml(booking.clientPinataServiceNote)}</span></div>`
            : '';
        return `<div class="booking-detail-row"><span class="label">Піньята:</span><span class="value">Клієнтська піньята (послуга)${booking.clientPinataServicePrice ? ` - ${escapeHtml(formatPrice(booking.clientPinataServicePrice))}` : ''}</span></div>${note}`;
    }
    if ((booking?.pinataMode === 'park' || !booking?.pinataMode) && booking?.pinataFiller) {
        if (isClientPinataFillerChoice(booking.pinataFiller)) return '';
        return `<div class="booking-detail-row"><span class="label">Піньята парку:</span><span class="value">${escapeHtml(booking.pinataFiller)}</span></div>`;
    }
    return '';
}

// ==========================================
// ПАНЕЛЬ БРОНЮВАННЯ
// ==========================================

async function initializeRoomFirstBookingSourceContext() {
    if (!isRoomFirstTimelineView() || AppState.editingBookingId) return false;
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

async function openBookingPanel(time, lineId) {
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
        ensureTimelineRoomOption(line.name);
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
    BookingDrawerState.selectedProgramCategory = 'all';
    BookingDrawerState.selectedActivityProgramIds = [];
    BookingDrawerState.validationAttempted = false;
    BookingDrawerState.legacyNotesFallback = false;
    BookingDrawerState.legacyGroupNameFallback = false;
    BookingDrawerState.roomBookingAnimationBridge = null;
    resetBookingRoomSelectionContext();
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
    if (isRoomFirstTimelineView()) {
        await prefillRoomFirstCustomerFromRoomLine(line.name, time);
    }
    prepareMaysternyaBookingPanel();
    prepareDisplayModeBookingPanel({ line });
    if (isRoomFirstTimelineView()) {
        syncBookingWorkspaceMode({ markDirty: false });
    }
    updateBookingContextHeaderSummary();
    await refreshBookingRoomAvailabilityForSelectedDate();
    await initializeRoomFirstBookingSourceContext();

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
    const duplicateHint = document.getElementById('bookingCustomerDuplicateHint');
    if (duplicateHint) {
        duplicateHint.classList.add('hidden');
        duplicateHint.innerHTML = '';
    }
}

function rememberSelectedCustomerSnapshot(customer = {}) {
    const values = {
        customerSearch: customer.name || '',
        customerName: customer.name || '',
        customerPhone: customer.phone || '',
        customerInstagram: customer.instagram || '',
        customerChildName: customer.childName || '',
        customerChildBirthday: customer.childBirthday ? customer.childBirthday.split('T')[0] : '',
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
    const birthday = source.childBirthday ?? source.child_birthday ?? base.childBirthday ?? base.child_birthday ?? '';
    return {
        id,
        name: source.name ?? source.customerName ?? source.customer_name ?? base.name ?? base.customerName ?? base.customer_name ?? '',
        phone: source.phone ?? source.customerPhone ?? source.customer_phone ?? base.phone ?? base.customerPhone ?? base.customer_phone ?? '',
        instagram: source.instagram ?? base.instagram ?? '',
        childName: source.childName ?? source.child_name ?? base.childName ?? base.child_name ?? '',
        childBirthday: birthday ? String(birthday).split('T')[0] : '',
        source: source.source ?? base.source ?? '',
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
    if (info && badge && normalized.totalBookings > 0) {
        badge.textContent = `${normalized.totalBookings} візит${normalized.totalBookings === 1 ? '' : normalized.totalBookings < 5 ? 'и' : 'ів'}`;
        info.classList.remove('hidden');
    } else {
        info?.classList.add('hidden');
    }

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

function clearAutoFilledBanquetFromRoomSelection() {
    const auto = BookingDrawerState.autoFilledBanquetFromRoom;
    if (auto?.groupId && String(BookingDrawerState.selectedBanquetGroupId || '') === String(auto.groupId)) {
        BookingDrawerState.selectedBanquetGroupId = '';
        BookingDrawerState.manualBanquetGroupSelection = false;
    }
    BookingDrawerState.autoFilledBanquetFromRoom = null;
    BookingDrawerState.roomSelectionBanquetContext = null;
    if (typeof clearAutoFilledBanquetGuestsFromRoom === 'function') clearAutoFilledBanquetGuestsFromRoom();
    renderBookingBanquetGroupSelector();
}

function resetBookingRoomSelectionContext(options = {}) {
    if (options.invalidate !== false) nextBookingRoomSelectionContextToken();
    BookingDrawerState.roomSelectionBanquetContext = null;
    BookingDrawerState.autoFilledCustomerFromRoom = null;
    BookingDrawerState.autoFilledBanquetFromRoom = null;
    if (typeof clearAutoFilledBanquetGuestsFromRoom === 'function') clearAutoFilledBanquetGuestsFromRoom();
}

function clearRoomSelectionBanquetContextAfterCustomerChange(options = {}) {
    if (options.invalidate !== false) nextBookingRoomSelectionContextToken();
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
    BookingDrawerState.roomSelectionBanquetContext = null;
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
    if (baseContext.groupId) return baseContext;
    const sourceBookingId = String(sourceBooking.id || '').trim();
    if (!sourceBookingId || typeof apiGetBanquetByBooking !== 'function') return baseContext;
    const snapshot = await apiGetBanquetByBooking(sourceBookingId);
    if (!isLatestBookingRoomSelectionContextRequest(token)) return null;
    if (snapshot?.success === false) return baseContext;
    return roomSelectionBanquetContextFromSnapshot(snapshot, sourceBooking);
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
    const roomName = String(document.getElementById('roomSelect')?.value || '').trim();
    if (!roomName) {
        clearAutoFilledBanquetFromRoomSelection();
        return;
    }
    const sourceBooking = pickRoomBanquetSourceBooking(roomName, document.getElementById('bookingTime')?.value || '');
    if (!sourceBooking) {
        clearAutoFilledBanquetFromRoomSelection();
        return;
    }

    clearAutoFilledBanquetFromRoomSelection();
    if (hasManualCustomerConflictWithRoom(sourceBooking)) {
        renderBookingCustomerSearchState('Кімната має пов’язане бронювання, але клієнта вже вибрано вручну. Щоб підтягнути клієнта з кімнати, спочатку очистіть вибір.');
        renderBookingPackageSummary();
        return;
    }
    syncAutoFilledBanquetGuestsFromRoom(sourceBooking);
    const immediateBanquetContext = sourceBookingToBanquetContext(sourceBooking);
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
            container.innerHTML = '<div class="customer-search-state">Клієнтів не знайдено. Можна створити нову картку нижче.</div>';
            container.classList.remove('hidden');
            renderBookingCustomerSearchState('Клієнта не знайдено. Можна створити нового.');
        } else {
            container.classList.add('hidden');
            container.innerHTML = '';
            renderBookingCustomerSearchState('');
        }
        return;
    }

    container.innerHTML = list.map(c => `
        <div class="customer-search-item" role="button" tabindex="0" data-id="${escapeHtml(String(c.id))}">
            <div class="customer-search-name">${escapeHtml(c.name)}</div>
            <div class="customer-search-meta">
                ${c.phone ? escapeHtml(c.phone) : ''}
                ${c.instagram ? ' @' + escapeHtml(c.instagram) : ''}
                ${c.totalBookings ? ' · ' + c.totalBookings + ' віз.' : ''}
            </div>
        </div>
    `).join('');
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
        const requestedCapacity = parseInt(document.getElementById('kidsCountInput')?.value || '', 10);
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
    document.getElementById('bookingPanel')?.classList.remove('booking-panel--maysternya', 'booking-panel--minimal-timeline', 'booking-panel--education-timeline', 'booking-panel--room-first');
    document.querySelector('.main-content').classList.remove('panel-open');
    // v5.33: Unlock body scroll
    document.body.classList.remove('panel-open');
    // v5.35: Hide backdrop overlay
    document.getElementById('panelBackdrop')?.classList.add('hidden');
    document.querySelectorAll('.grid-cell.selected').forEach(c => c.classList.remove('selected'));

    // v5.5: Скинути режим редагування
    if (AppState.editingBookingId) {
        AppState.editingBookingId = null;
        AppState.editingBookingUpdatedAt = null; // Clear optimistic lock
        const panelH3 = document.querySelector('#bookingPanel .panel-header h3');
        const btnSubmit = document.querySelector('#bookingForm .btn-submit');
        if (panelH3) panelH3.textContent = 'Нове бронювання';
        if (btnSubmit) btnSubmit.textContent = 'Додати бронювання';
    }
    if (!AppState.editingBookingId && !isMaysternyaBookingContext()) {
        const panelH3 = document.querySelector('#bookingPanel .panel-header h3');
        const btnSubmit = document.querySelector('#bookingForm .btn-submit');
        if (panelH3) panelH3.textContent = 'Нове бронювання';
        if (btnSubmit) btnSubmit.textContent = 'Додати бронювання';
    }
    if (window.BookingForm?.markClean) BookingForm.markClean();
    if (window.UnsafeDismissGuard && panel) window.UnsafeDismissGuard.markClean(panel);
    BookingDrawerState.roomBookingAnimationBridge = null;
    BookingDrawerState.legacyNotesFallback = false;
    BookingDrawerState.legacyGroupNameFallback = false;
    resetBookingRoomSelectionContext();
    resetBookingBanquetGroupSelector();
    return true;
}

function resetBookingEditStateForCreate() {
    AppState.editingBookingId = null;
    AppState.editingBookingUpdatedAt = null;
    BookingDrawerState.roomBookingAnimationBridge = null;
    BookingDrawerState.legacyNotesFallback = false;
    BookingDrawerState.legacyGroupNameFallback = false;
    resetBookingRoomSelectionContext();
    resetBookingBanquetGroupSelector();
    const panelH3 = document.querySelector('#bookingPanel .panel-header h3');
    const btnSubmit = document.querySelector('#bookingForm .btn-submit');
    if (panelH3) panelH3.textContent = isMaysternyaBookingContext() ? getTimelineBookingPresentation().bookingTitle : 'Нове бронювання';
    if (btnSubmit) {
        btnSubmit.textContent = isMaysternyaBookingContext() ? getTimelineBookingPresentation().submitLabel : 'Додати бронювання';
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
    return isParkTimelineBookingMode()
        && !isMaysternyaBookingContext()
        && !isEducationTimelineBookingMode()
        && !AppState.editingBookingId;
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
        .map(id => byId.get(String(id)))
        .filter(Boolean);
}

function bookingActivityPriceValue(program) {
    if (!program) return 0;
    const kidsCount = Number(document.getElementById('kidsCountInput')?.value || 0);
    if (program.perChild && kidsCount > 0) return toBookingMoney(Number(program.price || 0) * kidsCount);
    return toBookingMoney(program.price || 0);
}

function bookingActivityPriceLabel(program) {
    if (!program) return '—';
    const price = bookingActivityPriceValue(program);
    if (program.perChild && !Number(document.getElementById('kidsCountInput')?.value || 0)) {
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

function bookingActivitiesTotalPrice(programs = getSelectedActivityPrograms()) {
    return toBookingMoney(programs.reduce((sum, program) => sum + bookingActivityPriceValue(program), 0));
}

function bookingActivitiesTotalDuration(programs = getSelectedActivityPrograms()) {
    return programs.reduce((sum, program) => sum + (Number(program?.duration || 0) || 0), 0);
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
    const hidden = document.getElementById('selectedProgram');
    if (hidden) hidden.value = unique[0] || '';
    updateSelectedProgramCards();
    if (options.renderSummary !== false) renderSelectedProgramSummary();
    if (options.renderPackage !== false) renderBookingPackageSummary();
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

    if (isPinataProgram(program)) {
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

function renderSelectedProgramSummary(program = null) {
    const details = document.getElementById('programDetails');
    const empty = document.getElementById('programDetailsEmpty');
    const list = document.getElementById('selectedActivitiesList');
    if (!details) return;
    const programs = getSelectedActivityPrograms();
    const primaryProgram = program || programs[0] || null;
    if (!primaryProgram || programs.length === 0) {
        if (empty) empty.classList.remove('hidden');
        if (list) list.innerHTML = '';
        ['detailDuration', 'detailHosts', 'detailPrice', 'detailAge', 'detailKids'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '—';
        });
        return;
    }
    if (empty) empty.classList.add('hidden');
    const totalDuration = bookingActivitiesTotalDuration(programs);
    const totalPrice = bookingActivitiesTotalPrice(programs);
    const hostsLabel = programs.length > 1
        ? `${Math.max(...programs.map(item => Number(item.hosts || 0)))} макс.`
        : primaryProgram.hosts;
    document.getElementById('detailDuration').textContent = totalDuration > 0 ? `${totalDuration} хв` : '—';
    document.getElementById('detailHosts').textContent = hostsLabel || '—';
    document.getElementById('detailPrice').textContent = formatPrice(totalPrice);

    const ageEl = document.getElementById('detailAge');
    const kidsEl = document.getElementById('detailKids');
    if (ageEl) ageEl.textContent = programs.length === 1 ? (primaryProgram.age || '—') : 'за активностями';
    if (kidsEl) kidsEl.textContent = programs.length === 1 ? (primaryProgram.kids || '—') : 'за активностями';

    if (list) {
        list.innerHTML = programs.map((item, index) => `
            <div class="selected-activity-item" data-selected-activity-id="${escapeHtml(String(item.id))}">
                <span class="selected-activity-order">${index + 1}</span>
                <span class="selected-activity-main">
                    <strong>${escapeHtml(item.code || item.label || item.name || 'Активність')}</strong>
                    <small>${escapeHtml(item.name || item.label || '')}</small>
                </span>
                <span class="selected-activity-meta">${item.duration ? `${escapeHtml(String(item.duration))} хв · ` : ''}${escapeHtml(bookingActivityPriceLabel(item))}</span>
                <button type="button" class="selected-activity-remove" data-remove-activity="${escapeHtml(String(item.id))}" aria-label="Прибрати активність ${escapeHtml(item.code || item.name || '')}">×</button>
            </div>
        `).join('');
        list.querySelectorAll('[data-remove-activity]').forEach(btn => {
            btn.addEventListener('click', () => removeSelectedActivityProgram(btn.dataset.removeActivity));
        });
    }
}

async function renderProgramIcons() {
    const container = document.getElementById('programsIcons');

    // v7.0: Load products from API (with fallback to PROGRAMS)
    // Don't clear DOM until data is ready — prevents blank flash
    const allProducts = await getProducts();

    // Cache: skip rebuild if products haven't changed
    const hash = allProducts.length + ':' + allProducts
        .map(p => [p.id, p.label, p.name, p.duration, p.price, p.nextPrice, p.nextPriceFrom, p.effectivePriceDate, p.hosts, p.isActive, p.updatedAt || ''].join('|'))
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
            icon.setAttribute('aria-pressed', 'false');
            icon.setAttribute('aria-label', `Обрати програму ${cardName}${p.duration ? `, ${p.duration} хв` : ''}${p.price ? `, ${bookingActivityPriceLabel(p)}` : ''}${nextPriceLabel ? `, ${nextPriceLabel}` : ''}`);
            icon.innerHTML = `
                ${durationBadge}
                ${priceBadge}
                <span class="icon-circle"><span class="icon">${_escB(p.icon)}</span></span>
                <span class="name">${_escB(cardName)}</span>
                ${nextPriceBadge}
            `;
            icon.addEventListener('click', () => selectProgram(p.id));
            grid.appendChild(icon);
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
        icon.style.display = match && categoryMatch ? '' : 'none';
    });

    // Hide empty categories
    grids.forEach(grid => {
        const cat = grid.dataset.category;
        const visible = grid.querySelectorAll('.program-icon:not([style*="display: none"])');
        const hidden = visible.length === 0;
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

    const priceText = program.perChild ? `${formatPrice(program.price)}/дит` : formatPrice(program.price);
    document.getElementById('detailDuration').textContent = program.duration > 0 ? `${program.duration} хв` : '—';
    document.getElementById('detailHosts').textContent = program.hosts;
    document.getElementById('detailPrice').textContent = priceText;

    const ageEl = document.getElementById('detailAge');
    const kidsEl = document.getElementById('detailKids');
    if (ageEl) ageEl.textContent = program.age || '—';
    if (kidsEl) kidsEl.textContent = program.kids || '—';

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
        if (program.perChild || isEducationTimelineBookingMode()) {
            kidsCountSection.classList.remove('hidden');
            const kidsInput = document.getElementById('kidsCountInput');
            if (kidsInput) {
                kidsInput.value = '';
                kidsInput.placeholder = isEducationTimelineBookingMode() ? 'Кількість учнів' : '';
                kidsInput.oninput = () => {
                    const count = parseInt(kidsInput.value) || 0;
                    if (program.perChild) {
                        const total = count * program.price;
                        document.getElementById('detailPrice').textContent = count > 0
                            ? `${formatPrice(program.price)} x ${count} = ${formatPrice(total)}`
                            : `${formatPrice(program.price)}/дит`;
                    }
                    renderSelectedProgramSummary(program);
                    renderBookingPackageSummary();
                };
            }
        } else {
            kidsCountSection.classList.add('hidden');
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

async function populateAnimatorSelectById(selectId, placeholder) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const lines = await getAnimatorLinesForBookingDate();
    const currentLineId = document.getElementById('bookingLine')?.value;
    const currentValue = select.value;
    const candidates = await buildAnimatorLineCandidates(lines, currentLineId);
    const filteredCandidates = await filterAnimatorLineCandidatesForOpenSlot(candidates, {
        selectedName: currentValue,
        selectId
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
    const time = document.getElementById('bookingTime')?.value || '';
    const duration = getAnimatorPickerDuration();
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
    const duration = parseInt(document.getElementById('customDuration')?.value) || 30;
    document.getElementById('detailDuration').textContent = `${duration} хв`;
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

    const pinataMode = program && isPinataProgram(program) ? getPinataModeValue() : 'none';
    const selectedPinataFiller = document.getElementById('pinataFillerSelect')?.value || '';
    const clientOwnedFiller = pinataMode === 'park' && isClientPinataFillerChoice(selectedPinataFiller);
    let pinataFiller = '';
    const pinataNumber = pinataMode !== 'none'
        ? (document.getElementById('pinataNumber')?.value?.trim() || null)
        : null;
    const pinataFillerNumber = pinataMode !== 'none'
        ? (clientOwnedFiller ? CLIENT_PINATA_FILLER_VALUE : (document.getElementById('pinataFillerNumber')?.value?.trim() || null))
        : null;
    let clientPinataServicePrice = null;
    let clientPinataServiceNote = null;
    if (program && program.hasFiller && pinataMode === 'park') {
        pinataFiller = selectedPinataFiller;
        if (clientOwnedFiller) {
            label = 'Пін+свій';
        } else if (pinataFiller) {
            label = `Пін+${pinataFiller}`;
        }
    } else if (program && pinataMode === 'client') {
        clientPinataServicePrice = document.getElementById('clientPinataServicePrice')?.value || null;
        clientPinataServiceNote = document.getElementById('clientPinataServiceNote')?.value?.trim() || null;
        label = 'Клієнтська піньята';
    }

    const secondAnimatorSectionVisible = !document.getElementById('secondAnimatorSection')?.classList.contains('hidden');
    const secondAnimator = program && (program.hosts > 1 || secondAnimatorSectionVisible)
        ? document.getElementById('secondAnimatorSelect')?.value : null;
    const secondAnimatorCandidate = selectedSecondAnimatorLineCandidate(secondAnimator);

    const packageTotals = getBookingPackageTotals(program);
    const menuPositions = kitchenEnabled ? packageTotals.menuPositions : [];
    const serviceEvents = kitchenEnabled ? packageTotals.serviceEvents : [];
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
        finalTotal: kitchenEnabled ? packageTotals.finalTotal : packageTotals.programBasePrice
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
            const linkedId = allBookings.find(b => String(b.linkedTo || '') === String(excludeId || '') && b.lineId === secondLine.id)?.id || null;
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
    const targetId = normalizeBookingIdentity(excludeId);
    const excludedIds = new Set();
    if (!targetId) return excludedIds;

    const list = Array.isArray(bookings) ? bookings : [];
    const target = list.find(b => normalizeBookingIdentity(b.id) === targetId);
    const rootId = normalizeBookingIdentity(target?.linkedTo) || targetId;

    excludedIds.add(targetId);
    if (rootId) excludedIds.add(rootId);

    for (const booking of list) {
        const bookingId = normalizeBookingIdentity(booking?.id);
        if (!bookingId) continue;
        const linkedTo = normalizeBookingIdentity(booking?.linkedTo);
        if (bookingId === targetId || bookingId === rootId || linkedTo === targetId || linkedTo === rootId) {
            excludedIds.add(bookingId);
        }
    }

    return excludedIds;
}

function isDuplicateProgramRelevantEdit(bookings, excludeId, programId, time, duration) {
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

function buildBookingObject(formData, program) {
    const isEducationLessonBooking = isEducationTimelineBookingMode() && !!formData.educationLesson;
    const hasCatalogProgram = !!program;
    const hasEvent = !!formData.hasEvent && (hasCatalogProgram || isEducationLessonBooking);
    const costume = hasEvent ? document.getElementById('costumeSelect')?.value : null;
    const statusEl = document.querySelector('input[name="bookingStatus"]:checked');
    const status = statusEl ? statusEl.value : 'confirmed';
    const kidsCountInput = document.getElementById('kidsCountInput');
    const kidsCount = (hasEvent && kidsCountInput && (program?.perChild || isEducationTimelineBookingMode()))
        ? (parseInt(kidsCountInput.value, 10) || 0)
        : 0;
    const kitchenChildrenCount = formData.kitchenEnabled
        ? normalizeBookingCountValue(document.getElementById('banquetGuests')?.value)
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
        kidsCount: kidsCount || kitchenChildrenCount || null,
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
        obj.customerId = parseInt(existingId);
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
    const price = bookingActivityPriceValue(program);
    const duration = Number(program.duration || 0) || 30;
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
        date: baseBooking.date,
        time: options.time || baseBooking.time,
        lineId: baseBooking.lineId,
        lineName: baseBooking.lineName || null,
        resourceId: baseBooking.resourceId || null,
        resourceType: baseBooking.resourceType || null,
        programId: String(program.id),
        programCode: program.code,
        label: program.label || `${program.code || program.name || 'Активність'}(${duration})`,
        programName: program.name || program.label || program.code,
        category: program.category,
        duration,
        price,
        hosts: Number(program.hosts || 0),
        secondAnimator: null,
        secondAnimatorLineId: null,
        secondAnimatorLineName: null,
        pinataMode: 'none',
        pinataNumber: null,
        pinataFillerNumber: null,
        pinataFiller: null,
        clientPinataServicePrice: null,
        clientPinataServiceNote: null,
        costume: baseBooking.costume || null,
        room: baseBooking.room,
        notes: null,
        createdBy: baseBooking.createdBy,
        status: baseBooking.status,
        kidsCount: program.perChild ? (parseInt(document.getElementById('kidsCountInput')?.value, 10) || null) : baseBooking.kidsCount || null,
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
            source: 'booking_drawer_multi_activity'
        };
    }
    let nextTime = addMinutesToTime(baseBooking.time, baseBooking.duration || programs[0]?.duration || 0);
    return programs.slice(1).map((program, offset) => {
        const booking = buildMultiActivityBookingFromProgram(baseBooking, program, {
            index: offset + 1,
            time: nextTime,
            activityPrograms: programs,
            primaryProgramId: programs[0]?.id
        });
        nextTime = addMinutesToTime(nextTime, booking?.duration || program.duration || 0);
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
        if (result && result.success === false) {
            showNotification(result.error || 'Не вдалось закрити слот', 'error');
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
        btn.textContent = btn.dataset.originalText || 'Додати бронювання';
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

function createdBookingProjectionMatchesCurrentSlice(booking = {}, currentDate = formatDate(AppState.selectedDate)) {
    const projection = createdBookingTimelineProjection(booking);
    const expectedContext = window.TimelineBusinessContext?.state?.()?.activeBusinessContext
        || window.TimelineBusinessContext?.current?.()?.apiValue || '';
    const projectedDate = normalizeBookingDateKey(projection?.date || booking.date);
    const projectedContext = projection?.businessContext
        || projection?.business_context
        || booking.businessContext
        || booking.business_context
        || '';
    if (projectedDate && projectedDate !== currentDate) return false;
    if (projectedContext && expectedContext && projectedContext !== expectedContext) return false;
    const id = booking?.id || booking?.bookingId;
    const resourceIdentity = typeof timelineBookingResourceIdentity === 'function'
        ? timelineBookingResourceIdentity(booking)
        : null;
    const lineId = String(resourceIdentity?.resourceId || booking?.resourceId || booking?.resource_id || booking?.lineId || booking?.line_id || '').trim();
    return Boolean(id && (lineId || projection?.visible === true));
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
        submitBtn.dataset.originalText = submitBtn.dataset.originalText || submitBtn.textContent;
        submitBtn.textContent = 'Збереження...';
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
    if (formData.hasEvent && formData.program?.hasFiller && formData.pinataMode === 'park' && !formData.pinataFiller) {
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

    // v5.5: excludeId для режиму редагування
    const excludeId = AppState.editingBookingId || null;

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
            oldBooking = oldBookings.find(b => b.id === booking.id);
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
            const updateResult = await apiUpdateBooking(booking.id, booking);
            if (updateResult && updateResult.success === false) {
                // Optimistic locking: check if it's a version conflict
                if (updateResult.conflict) {
                    await handleOptimisticLockConflict(updateResult, booking);
                    unlockSubmitBtn();
                    return;
                }
                if (updateResult.code === 'cancelled_booking_cannot_be_restored' || updateResult.currentStatus === 'cancelled') {
                    resetBookingEditStateForCreate();
                    showNotification('Це бронювання вже скасоване. Режим редагування скинуто, створіть нове бронювання.', 'warning');
                    unlockSubmitBtn();
                    return;
                }
                showNotification(updateResult.error || 'Помилка оновлення бронювання', 'error');
                if (updateResult.conflictBookingId) revealHiddenBooking(updateResult.conflictBookingId);
                unlockSubmitBtn(); return;
            }
            // Update stored updatedAt from server response
            if (updateResult && updateResult.booking) {
                AppState.editingBookingUpdatedAt = updateResult.booking.updatedAt;
            }
            await apiAddHistory('edit', AppState.currentUser?.username, booking);

            // v5.51: Save undo for edit (store old state)
            if (oldBooking) pushUndo('edit', { old: { ...oldBooking }, updated: { ...booking } });

            AppState.editingBookingId = null;

            restoreTimelineDateAfterBookingSave(selectedDateBeforeSave || booking.date);
            invalidateBookingTimelineDateCache(AppState.selectedDate, { lines: false });
            closeBookingPanel(true);
            unlockSubmitBtn();
            await renderTimeline();
            showNotification('Бронювання оновлено!', 'success');
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

            if (selectedBanquetContext.groupId && selectedBookingBanquetGroupCustomerMismatch(selectedBanquetContext)) {
                showNotification('Клієнт бронювання не збігається з вибраним банкетом. Оберіть правильного клієнта або скиньте прив’язку до банкета.', 'error');
                unlockSubmitBtn();
                return;
            }
            if (activityFirstKitchenBridge.shouldUse && activityFirstKitchenBridge.error) {
                showNotification(activityFirstKitchenBridge.error, 'error');
                unlockSubmitBtn();
                return;
            }
            if (kitchenFirstActivityBridge.shouldUse && kitchenFirstActivityBridge.error) {
                showNotification(kitchenFirstActivityBridge.error, 'error');
                unlockSubmitBtn();
                return;
            }

            if (bridgeContext && selectedBanquetContext.groupId) {
                if (selectedActivityPrograms.length > 1) {
                    showNotification('Для додавання активної програми з кімнатної броні оберіть одну програму. Додаткові програми додавайте окремо.', 'error');
                    unlockSubmitBtn();
                    return;
                }
                const bridgeGroupId = selectedBanquetContext.groupId;
                const bridgeSourceBookingId = selectedBanquetContext.sourceBookingId || bridgeContext.sourceBookingId;
                if (!bridgeGroupId || !bridgeSourceBookingId) {
                    showNotification('Не знайдено банкетну групу для цієї активної програми. Закрийте форму й спробуйте ще раз.', 'error');
                    unlockSubmitBtn();
                    return;
                }
                attachBanquetGroupContextToBooking(booking, {
                    ...selectedBanquetContext,
                    groupId: bridgeGroupId,
                    sourceBookingId: bridgeSourceBookingId
                }, 'activity', 'room_booking_animation_bridge');
                const linked = await buildLinkedBookings(booking, formData.program);
                createResult = await apiCreateBanquetActivityBooking(bridgeGroupId, {
                    sourceBookingId: bridgeSourceBookingId,
                    booking,
                    linkedBookings: linked
                });
            } else if (kitchenFirstActivityBridge.shouldUse) {
                if (selectedActivityPrograms.length > 1) {
                    showNotification('Для додавання активної програми з кухні оберіть одну програму. Додаткові програми додавайте окремо.', 'error');
                    unlockSubmitBtn();
                    return;
                }
                const sourceContext = kitchenFirstActivityBridge.context;
                attachBanquetGroupContextToBooking(booking, sourceContext, 'activity', 'kitchen_first_activity_bridge');
                const linked = await buildLinkedBookings(booking, formData.program);
                createResult = await apiCreateBanquetActivityBookingFromSource({
                    sourceBookingId: sourceContext.sourceBookingId,
                    booking,
                    linkedBookings: linked
                });
            } else if (activityFirstKitchenBridge.shouldUse) {
                const sourceContext = activityFirstKitchenBridge.context;
                attachBanquetGroupContextToBooking(booking, sourceContext, 'kitchen', 'activity_first_kitchen_bridge');
                createResult = await apiCreateBanquetMemberBookingFromSource({
                    sourceBookingId: sourceContext.sourceBookingId,
                    role: 'kitchen',
                    booking
                });
            } else if (shouldCreateEducationLessonSeries(booking)) {
                createResult = await apiCreateEducationLessonSeries(booking);
            } else if (selectedBanquetContext.groupId && isSelectedBanquetKitchenCreate(formData)) {
                attachBanquetGroupContextToBooking(booking, selectedBanquetContext, 'kitchen', selectedBanquetContextSource);
                createResult = await apiCreateBanquetMemberBooking(selectedBanquetContext.groupId, {
                    sourceBookingId: selectedBanquetContext.sourceBookingId || null,
                    role: 'kitchen',
                    booking
                });
            } else if (selectedBanquetContext.groupId && isSelectedBanquetActivityCreate(formData)) {
                if (selectedActivityPrograms.length > 1) {
                    showNotification('Для прив’язки до банкету оберіть одну активність. Додаткові активності додавайте окремо.', 'error');
                    unlockSubmitBtn();
                    return;
                }
                if (!selectedBanquetContext.sourceBookingId) {
                    showNotification('У вибраного банкету немає основної броні для прив’язки активності.', 'error');
                    unlockSubmitBtn();
                    return;
                }
                attachBanquetGroupContextToBooking(booking, selectedBanquetContext, 'activity', selectedBanquetContextSource);
                const linked = await buildLinkedBookings(booking, formData.program);
                createResult = await apiCreateBanquetActivityBooking(selectedBanquetContext.groupId, {
                    sourceBookingId: selectedBanquetContext.sourceBookingId,
                    booking,
                    linkedBookings: linked
                });
            } else if (selectedBanquetContext.groupId) {
                showNotification(selectedBanquetUnsupportedCreateMessage(), 'error');
                unlockSubmitBtn();
                return;
            } else {
                const additionalMultiHostActivity = selectedActivityPrograms
                    .slice(1)
                    .find(programItem => Number(programItem?.hosts || 0) > 1);
                if (additionalMultiHostActivity) {
                    showNotification(`Активність "${additionalMultiHostActivity.name || additionalMultiHostActivity.label || additionalMultiHostActivity.code}" потребує 2 ведучих. Поставте її першою в наборі або створіть окремим бронюванням.`, 'error');
                    unlockSubmitBtn();
                    return;
                }
                const linked = await buildLinkedBookings(booking, formData.program);
                const banquetActivities = buildMultiActivityBookings(booking, formData);
                if (linked.length > 0 || banquetActivities.length > 0) {
                    createResult = await apiCreateBookingFull(booking, linked, { banquetActivities });
                } else {
                    createResult = await apiCreateBooking(booking);
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
                    createdBookings,
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
    const bookings = allBookings.filter(b => b.lineId === lineId && b.id !== excludeId);
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

async function findOrCreateBanquetGroupForSourceBooking(sourceBooking = {}) {
    const sourceBookingId = String(sourceBooking.id || '').trim();
    if (!sourceBookingId) {
        return { success: false, error: 'Немає ID бронювання-джерела для банкетної групи.' };
    }
    const current = typeof apiGetBanquetByBooking === 'function'
        ? await apiGetBanquetByBooking(sourceBookingId)
        : { success: false, error: 'Banquet API недоступний у клієнті.' };
    const existingGroupId = banquetGroupIdFromSnapshot(current);
    if (current?.success !== false && existingGroupId) {
        return { success: true, groupId: existingGroupId, snapshot: current, created: false };
    }

    const created = typeof apiCreateBanquetGroup === 'function'
        ? await apiCreateBanquetGroup(sourceBookingId, {
            groupName: sourceBooking.label || sourceBooking.programName || sourceBooking.programCode || sourceBooking.room || null,
            source: 'room_booking_animation_bridge',
            meta: {
                sourceBookingId,
                source: 'room_booking_animation_bridge'
            }
        })
        : { success: false, error: 'Banquet create API недоступний у клієнті.' };
    if (created?.success === false && created.code === 'BOOKING_ALREADY_IN_GROUP') {
        const refreshed = await apiGetBanquetByBooking(sourceBookingId);
        const refreshedGroupId = banquetGroupIdFromSnapshot(refreshed);
        if (refreshedGroupId) {
            return { success: true, groupId: refreshedGroupId, snapshot: refreshed, created: false };
        }
    }
    if (created?.success === false) {
        return { success: false, error: created.error || 'Не вдалось створити банкетну групу.' };
    }
    const groupId = created.group?.id || created.groupId || null;
    if (!groupId) {
        return { success: false, error: 'Сервер створив банкетну групу без groupId.' };
    }
    return { success: true, groupId, snapshot: created, created: true };
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
    const opened = await openBookingPanel(sourceBooking.time, targetLine.id);
    if (!opened) return;
    BookingDrawerState.roomBookingAnimationBridge = {
        groupId: existingGroupId || sourceBooking.banquetGroupId || sourceBooking.banquet_group_id || null,
        sourceBookingId: sourceBooking.id,
        sourceBooking,
        sourceTime: sourceBooking.time || '',
        sourceRoom: sourceBooking.room || null,
        sourceCustomerId: roomBookingCustomerId(sourceBooking),
        sourceCustomerName: sourceBooking.customerName || sourceBooking.customer_name || null
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

function buildBanquetDetailWarnings(snapshot, anchorBooking = {}) {
    const warnings = [];
    const hasGroupOrLegacy = banquetSnapshotHasGroup(snapshot) || snapshot?.legacyFallback || snapshot?.source === 'legacy_booking_banquet_links';
    for (const warning of (snapshot?.warnings || [])) {
        const message = banquetWarningText(warning);
        if (message) warnings.push(message);
    }
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
    const primary = banquetSnapshotPrimaryBooking(snapshot, anchorBooking);
    if (hasGroupOrLegacy && primary && !bookingDetailHasDepositMarker(primary)) {
        warnings.push('Завдаток не вказано структурно. Перевірте оплату перед друком вижимки.');
    }
    return [...new Set(warnings)].filter(Boolean);
}

function renderBanquetMemberCard(member = {}, roleOverride = null, options = {}) {
    const booking = member.booking || member;
    const bookingId = bookingDetailId(booking);
    if (!bookingId) return '';
    const role = roleOverride || member.role || (member.isPrimary ? 'primary' : 'manual');
    const technicalChildren = member.technicalChildren || [];
    const showTechnicalMeta = Boolean(options.showTechnicalMeta);
    const showRoleBadge = options.showRoleBadge ?? showTechnicalMeta;
    const showPackage = options.showPackage ?? (role === 'kitchen' || bookingDetailIsKitchenCandidate(booking));
    const showTechnicalChildren = options.showTechnicalChildren ?? showTechnicalMeta;
    const packageHtml = showPackage
        ? renderBookingPackageDetail(booking, { title: 'Меню цієї броні', compact: true })
        : '';
    const childrenHtml = showTechnicalChildren && technicalChildren.length ? `
        <div class="booking-banquet-children">
            <div class="booking-banquet-subtitle">Технічні записи</div>
            ${technicalChildren.map(child => `
                <div class="booking-banquet-child">
                    <span>${escapeHtml(bookingDetailTitle(child))}</span>
                    <small>${escapeHtml(bookingDetailStatusLabel(child))}${child.price ? ` · ${escapeHtml(formatPrice(child.price))}` : ''}</small>
                </div>
            `).join('')}
        </div>
    ` : '';
    const metaParts = [
        showTechnicalMeta ? `#${bookingId}` : '',
        booking.room ? booking.room : '',
        booking.customerName ? booking.customerName : ''
    ].filter(Boolean);
    return `
        <div class="booking-banquet-member booking-banquet-member--${escapeHtml(role)}${showTechnicalMeta ? ' booking-banquet-member--technical' : ''}">
            <div class="booking-banquet-member-main">
                <div>
                    <div class="booking-banquet-member-title">${escapeHtml(bookingDetailTitle(booking))}</div>
                    ${metaParts.length ? `<div class="booking-banquet-member-meta">${escapeHtml(metaParts.join(' · '))}</div>` : ''}
                </div>
                <div class="booking-banquet-member-badges">
                    ${showRoleBadge ? `<span class="booking-banquet-role">${escapeHtml(bookingDetailRoleLabel(role))}</span>` : ''}
                    <span class="booking-banquet-status">${escapeHtml(bookingDetailStatusLabel(booking))}</span>
                    ${booking.price ? `<span class="booking-banquet-price">${escapeHtml(formatPrice(booking.price))}</span>` : ''}
                </div>
            </div>
            ${packageHtml}
            ${childrenHtml}
        </div>
    `;
}

function renderBanquetMemberSection(title, members, emptyText) {
    const rows = (members || []).filter(Boolean);
    return `
        <div class="booking-banquet-section">
            <div class="booking-banquet-section-title">${escapeHtml(title)}</div>
            ${rows.length
                ? rows.map(member => renderBanquetMemberCard(member)).join('')
                : `<div class="booking-banquet-empty">${escapeHtml(emptyText)}</div>`}
        </div>
    `;
}

function renderBanquetWorkSection(title, bodyHtml, modifier = '') {
    const content = String(bodyHtml || '').trim();
    if (!content) return '';
    return `
        <div class="booking-banquet-section booking-banquet-section--work${modifier ? ` booking-banquet-section--${escapeHtml(modifier)}` : ''}">
            <div class="booking-banquet-section-title">${escapeHtml(title)}</div>
            ${content}
        </div>
    `;
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

function renderBanquetMenuSection(packageBooking) {
    if (!packageBooking || !bookingDetailHasMenuOverview(packageBooking)) return '';
    return renderBanquetWorkSection(
        'Меню',
        renderBookingPackageDetail(packageBooking, {
            title: 'Меню',
            compact: true,
            includeServiceEvents: false
        }),
        'menu'
    );
}

function renderBanquetServiceSection(packageBooking, serviceManualMembers = []) {
    const bookingPackage = packageBooking ? getBookingPackageFromBooking(packageBooking) : null;
    const serviceEvents = bookingPackage?.serviceEvents || [];
    const eventRows = serviceEvents.map(event => `
        <div class="booking-banquet-service-row booking-banquet-service-row--checklist">
            <span class="booking-banquet-service-check" aria-hidden="true"></span>
            <div class="booking-banquet-service-main">
                <strong>${event.time ? `${escapeHtml(event.time)} · ` : ''}${escapeHtml(event.title || BOOKING_SERVICE_EVENT_TYPES[event.type] || 'Сервіс')}</strong>
                ${event.note ? `<small>${escapeHtml(event.note)}</small>` : ''}
            </div>
        </div>
    `).join('');
    const manualRows = (serviceManualMembers || [])
        .map(member => renderBanquetMemberCard(member, member.role || 'service', {
            showPackage: false,
            showRoleBadge: false,
            showTechnicalMeta: false,
            showTechnicalChildren: false
        }))
        .join('');
    return renderBanquetWorkSection(
        'Подачі / сервіс',
        `${eventRows}${manualRows}`,
        'service'
    );
}

function renderBanquetActivitiesSection(activityMembers = []) {
    const rows = (activityMembers || [])
        .map(member => renderBanquetMemberCard(member, 'activity', {
            showPackage: false,
            showRoleBadge: false,
            showTechnicalMeta: false,
            showTechnicalChildren: false
        }))
        .join('');
    return renderBanquetWorkSection('Активності', rows, 'activities');
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

function renderFullBanquetCommentsSection(context = {}) {
    const comments = fullBanquetDetailCommentItems(context);
    if (!comments.length) return '';
    const rows = comments.map(comment => `
        <div class="booking-banquet-comment-row booking-banquet-comment-row--${escapeHtml(comment.type)}">
            <strong>${escapeHtml(comment.label)}</strong>
            <span>${escapeHtml(comment.text)}</span>
        </div>
    `).join('');
    return renderBanquetWorkSection('Примітки', `<div class="booking-banquet-comments">${rows}</div>`, 'comments');
}

function renderBanquetWarningsSection(warnings = []) {
    const rows = (warnings || [])
        .filter(Boolean)
        .map(message => `<div class="booking-banquet-warning">⚠ ${escapeHtml(message)}</div>`)
        .join('');
    return renderBanquetWorkSection('Попередження', rows, 'warnings');
}

function renderBanquetTechnicalSection({
    snapshot,
    members = [],
    technicalChildren = [],
    controlsHtml = '',
    hasGroup = false,
    isLegacy = false
} = {}) {
    const groupId = snapshot?.group?.id || snapshot?.groupId;
    const source = snapshot?.source || (isLegacy ? 'legacy_booking_banquet_links' : '');
    const memberRows = (members || []).map(member => {
        const booking = member.booking || member;
        const bookingId = bookingDetailId(booking);
        if (!bookingId) return '';
        const role = member.role || (member.isPrimary ? 'primary' : 'manual');
        return `
            <div class="booking-banquet-technical-row">
                <span>${escapeHtml(bookingId)}</span>
                <span>${escapeHtml(bookingDetailRoleLabel(role))}</span>
                <span>${escapeHtml(bookingDetailTitle(booking))}</span>
            </div>
        `;
    }).join('');
    const childRows = (technicalChildren || []).map(child => `
        <div class="booking-banquet-technical-row booking-banquet-technical-row--muted">
            <span>${escapeHtml(bookingDetailId(child) || '-')}</span>
            <span>Технічний запис</span>
            <span>${escapeHtml(bookingDetailTitle(child))}</span>
        </div>
    `).join('');
    const metaRows = [
        groupId ? ['groupId', groupId] : null,
        source ? ['source', source] : null,
        snapshot?.group?.status ? ['status', snapshot.group.status] : null
    ].filter(Boolean).map(([label, value]) => `
        <div class="booking-banquet-technical-meta-row">
            <span>${escapeHtml(label)}</span>
            <code>${escapeHtml(String(value))}</code>
        </div>
    `).join('');
    const body = `${metaRows}${memberRows || childRows ? `<div class="booking-banquet-technical-grid">${memberRows}${childRows}</div>` : ''}${controlsHtml}`;
    if (!body.trim() && !hasGroup) return '';
    return `
        <details class="booking-banquet-technical">
            <summary>Технічне</summary>
            <div class="booking-banquet-technical-body">
                ${body}
            </div>
        </details>
    `;
}

function renderBanquetCreateAction(anchorBooking = {}) {
    if (isViewer() || !bookingDetailIsRoot(anchorBooking)) return '';
    return `
        <div class="booking-banquet-action-row">
            <button type="button"
                    class="btn-secondary btn-sm booking-banquet-create-btn"
                    onclick="createBanquetGroupFromBookingDetails('${escapeHtml(bookingDetailId(anchorBooking))}')">
                Створити банкетну групу
            </button>
            <span>Створення нічого не обʼєднує автоматично. Інші броні додаються вручну.</span>
        </div>
    `;
}

function renderBanquetAttachCandidates(snapshot, anchorBooking = {}, allBookings = []) {
    const groupId = snapshot?.groupId || snapshot?.group?.id;
    if (isViewer() || !groupId) return '';
    const anchorId = bookingDetailId(anchorBooking);
    const anchorContext = bookingDetailContext(anchorBooking);
    const anchorDate = bookingDetailDate(anchorBooking);
    const anchorCustomerId = bookingDetailCustomerId(anchorBooking);
    const memberIds = banquetSnapshotMemberIds(snapshot);
    const candidates = (allBookings || [])
        .filter(candidate => {
            const candidateId = bookingDetailId(candidate);
            if (!candidateId || candidateId === anchorId) return false;
            if (!bookingDetailIsRoot(candidate)) return false;
            if (memberIds.has(candidateId)) return false;
            if (bookingDetailContext(candidate) !== anchorContext) return false;
            if (bookingDetailDate(candidate) !== anchorDate) return false;
            if (String(candidate.status || '').toLowerCase() === 'cancelled') return false;
            return true;
        })
        .sort((a, b) => {
            const aSameCustomer = anchorCustomerId && bookingDetailCustomerId(a) === anchorCustomerId ? 0 : 1;
            const bSameCustomer = anchorCustomerId && bookingDetailCustomerId(b) === anchorCustomerId ? 0 : 1;
            if (aSameCustomer !== bSameCustomer) return aSameCustomer - bSameCustomer;
            return `${a.time || ''}${a.id || ''}`.localeCompare(`${b.time || ''}${b.id || ''}`);
        })
        .slice(0, 12);
    if (!candidates.length) {
        return '';
    }
    return `
        <div class="booking-banquet-candidates">
            <div class="booking-banquet-section-title">Додати бронь до банкету</div>
            <div class="booking-banquet-candidate-hint">Кандидати підібрані тільки за тим самим бізнес-контекстом і датою. Збіг клієнта підсвічено, але менеджер додає бронь вручну.</div>
            ${candidates.map(candidate => {
                const candidateId = bookingDetailId(candidate);
                const defaultRole = bookingDetailDefaultAttachRole(candidate);
                const sameCustomer = anchorCustomerId && bookingDetailCustomerId(candidate) === anchorCustomerId;
                const label = candidate.groupName || candidate.label || candidate.programName || candidate.room || candidateId;
                return `
                    <div class="booking-banquet-candidate">
                        <div class="booking-banquet-candidate-main">
                            <strong>${escapeHtml(bookingDetailTitle(candidate))}</strong>
                            <small>${escapeHtml(label)} · ${escapeHtml(bookingDetailStatusLabel(candidate))}${candidate.price ? ` · ${escapeHtml(formatPrice(candidate.price))}` : ''}</small>
                            <span class="booking-banquet-candidate-badge booking-banquet-candidate-badge--${sameCustomer ? 'match' : 'manual'}">${sameCustomer ? 'той самий клієнт' : 'перевірити клієнта'}</span>
                        </div>
                        <select class="booking-banquet-candidate-role" data-banquet-candidate-role="${escapeHtml(candidateId)}">
                            <option value="kitchen" ${defaultRole === 'kitchen' ? 'selected' : ''}>Кухня</option>
                            <option value="activity" ${defaultRole === 'activity' ? 'selected' : ''}>Активність</option>
                            <option value="service" ${defaultRole === 'service' ? 'selected' : ''}>Сервіс</option>
                            <option value="manual" ${defaultRole === 'manual' ? 'selected' : ''}>Manual</option>
                        </select>
                        <button type="button"
                                class="btn-secondary btn-sm"
                                onclick="attachBookingToBanquetGroupFromDetails('${escapeHtml(String(groupId))}', '${escapeHtml(candidateId)}', '${escapeHtml(anchorId)}')">
                            Додати
                        </button>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function renderFullBanquetDetail(anchorBooking = {}, allBookings = [], snapshot = null) {
    const hasGroup = banquetSnapshotHasGroup(snapshot);
    const isLegacy = snapshot?.legacyFallback || snapshot?.source === 'legacy_booking_banquet_links';
    const isSingle = snapshot?.source === 'single_booking' || !snapshot;
    const members = Array.isArray(snapshot?.members) ? snapshot.members : [];
    const shouldShow = hasGroup
        || isLegacy
        || bookingDetailIsRoot(anchorBooking)
        || bookingDetailIsKitchenCandidate(anchorBooking)
        || members.length > 1;
    if (!shouldShow) return '';

    const primaryMembers = members.filter(member => member.isPrimary);
    const primaryIds = new Set(primaryMembers.map(member => String(member.bookingId)));
    const kitchenMembers = members.filter(member => !primaryIds.has(String(member.bookingId)) && (member.role === 'kitchen' || member.isKitchenCandidate));
    const activityMembers = members.filter(member => !primaryIds.has(String(member.bookingId)) && member.role === 'activity' && !member.isKitchenCandidate);
    const serviceManualMembers = members.filter(member => !primaryIds.has(String(member.bookingId)) && ['service', 'manual'].includes(member.role) && !member.isKitchenCandidate);
    const technicalChildren = members.flatMap(member => (member.technicalChildren || []).map(child => ({ ...child, parentId: member.bookingId })));
    const packageBooking = banquetPackageBookingFromMembers(anchorBooking, primaryMembers, kitchenMembers, members);
    const warnings = buildBanquetDetailWarnings(snapshot, anchorBooking)
        .filter(message => hasGroup || isLegacy || message !== banquetWarningText({ code: 'kitchen_booking_missing' }));
    const sourceLabel = hasGroup
        ? 'Обʼєднано в банкетну групу'
        : (isLegacy ? 'Показано старі звʼязки банкету' : 'Банкетна група ще не створена');
    const groupMeta = hasGroup && snapshot.group
        ? [
            snapshot.group.groupName,
            snapshot.group.date,
            snapshot.group.room,
            snapshot.group.status
        ].filter(Boolean).join(' · ')
        : '';
    const primaryBody = primaryMembers.length
        ? primaryMembers.map(member => renderBanquetMemberCard(member, 'primary', {
            showPackage: false,
            showRoleBadge: false,
            showTechnicalMeta: false,
            showTechnicalChildren: false
        })).join('')
        : (isSingle ? '<div class="booking-banquet-summary-note">Група ще не створена. Ця бронь показана як основа банкету.</div>' : '');
    const technicalControls = [
        !hasGroup ? renderBanquetCreateAction(anchorBooking) : '',
        hasGroup ? renderBanquetAttachCandidates(snapshot, anchorBooking, allBookings) : '',
        !hasGroup ? renderBookingBanquetLinksDetail(anchorBooking, allBookings) : ''
    ].filter(Boolean).join('');
    return `
        <div class="booking-banquet-full-detail">
            <div class="booking-banquet-full-header">
                <div>
                    <div class="booking-banquet-full-title">Банкет</div>
                    <div class="booking-banquet-full-source">${escapeHtml(sourceLabel)}${groupMeta ? ` · ${escapeHtml(groupMeta)}` : ''}</div>
                </div>
                ${hasGroup ? `<span class="booking-banquet-group-pill">Активний</span>` : `<span class="booking-banquet-group-pill booking-banquet-group-pill--muted">${isLegacy ? 'Legacy' : 'Потребує групи'}</span>`}
            </div>
            ${renderBanquetWorkSection('Банкет', primaryBody, 'summary')}
            ${renderBanquetMenuSection(packageBooking)}
            ${renderBanquetServiceSection(packageBooking, serviceManualMembers)}
            ${renderFullBanquetCommentsSection({ anchorBooking, primaryMembers, kitchenMembers, activityMembers, serviceManualMembers, members })}
            ${renderBanquetActivitiesSection(activityMembers)}
            ${renderBanquetWarningsSection(warnings)}
            ${renderBanquetTechnicalSection({
                snapshot,
                members,
                technicalChildren,
                controlsHtml: technicalControls,
                hasGroup,
                isLegacy
            })}
        </div>
    `;
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

async function showBookingDetails(bookingId) {
    const bookings = await getBookingsForDate(AppState.selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

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
        return;
    }

    const program = getProductsSync().find(p => p.id === booking.programId);
    const lesson = educationLessonDetailsFromBooking(booking);
    const isEducationBooking = Boolean(lesson && Object.keys(lesson).length);
    const roomFirstServiceBooking = canAddAnimationFromRoomBooking(booking);
    const lineRoleLabel = isEducationBooking ? 'Кабінет' : 'Аніматор';
    const descriptionHtml = program && program.description
        ? `<div class="booking-detail-description"><span class="label">Опис:</span><p>${escapeHtml(program.description)}</p></div>`
        : '';

    // B2: Per-event invite URL with booking details
    const inviteParams = new URLSearchParams({
        date: booking.date,
        time: booking.time,
        program: booking.programName || booking.label,
        room: booking.room
    });
    const inviteUrl = `/invite?${inviteParams.toString()}`;

    const fullInviteUrl = `${window.location.origin}/invite?${inviteParams.toString()}`;
    const inviteShareText = `Запрошуємо на ${escapeHtml(booking.programName || booking.label)} ${escapeHtml(booking.date)}! Парк Закревського Періоду — вул. Закревського 31/2, 3 поверх`;

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
        <div class="invite-section">
            <div class="invite-section-header">🎉 Запрошення для клієнта</div>
            <div class="invite-preview">
                <span>📅 ${escapeHtml(booking.date)}</span>
                <span>🕐 ${escapeHtml(booking.time)}</span>
                <span>🎪 ${escapeHtml(booking.programName || booking.label)}</span>
                <span>🏠 ${escapeHtml(booking.room)}</span>
            </div>
            <div class="invite-actions">
                <a href="${inviteUrl}" target="_blank" class="btn-invite-open">👁 Відкрити</a>
                <button onclick="copyInviteLink(this)" class="btn-invite-copy" data-url="${escapeHtml(fullInviteUrl)}">📋 Копіювати</button>
                ${navigator.share ? '<button onclick="shareInviteLink()" class="btn-invite-share">📤 Поділитися</button>' : ''}
            </div>
        </div>
    `;

    let banquetSnapshot = null;
    if (typeof apiGetBanquetByBooking === 'function') {
        try {
            const snapshot = await apiGetBanquetByBooking(booking.id);
            if (snapshot?.success) banquetSnapshot = snapshot;
        } catch (err) {
            console.warn('Banquet detail snapshot unavailable:', err);
        }
    }
    const summaryPreviewHref = bookingSummaryPreviewUrl(booking, banquetSnapshot);
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
            <span class="value">${escapeHtml(line ? line.name : '-')}</span>
        </div>
    `;
    const hostsDetailHtml = roomFirstServiceBooking ? '' : `
        <div class="booking-detail-row">
            <span class="label">Ведучих:</span>
            <span class="value">${escapeHtml(String(booking.hosts))}${booking.secondAnimator ? ` (+ ${escapeHtml(booking.secondAnimator)})` : ''}</span>
        </div>
    `;
    const animationExtrasHtml = roomFirstServiceBooking ? '' : `
        ${booking.costume ? `<div class="booking-detail-row"><span class="label">Костюм:</span><span class="value">${escapeHtml(booking.costume)}</span></div>` : ''}
        ${renderPinataDetailRows(booking)}
    `;
    const fullBanquetDetailHtml = renderFullBanquetDetail(booking, bookings, banquetSnapshot);
    const hasBanquetOverview = Boolean(fullBanquetDetailHtml.trim());
    const headerPackageBooking = bookingDetailHeaderPackageBooking(booking, banquetSnapshot);
    const headerScheduleHtml = bookingDetailHeaderScheduleSummary(headerPackageBooking);
    const useBanquetHeaderSchedule = Boolean(headerScheduleHtml.trim())
        && bookingDetailHeaderIsBanquetScheduleMode(booking, banquetSnapshot, fullBanquetDetailHtml);
    const isBanquetArrivalMode = bookingDetailIsBanquetArrivalMode(booking, banquetSnapshot, fullBanquetDetailHtml);
    const headerTimeMetaHtml = useBanquetHeaderSchedule
        || isBanquetArrivalMode
        ? ''
        : `<span class="booking-detail-meta-item">${escapeHtml(bookingDetailTimeRange)}</span>`;
    const bookingDetailDateLabel = isBanquetArrivalMode ? 'Дата банкету' : 'Дата';
    const bookingDetailTimeLabel = isBanquetArrivalMode ? 'Прихід гостей' : 'Час';
    const bookingDetailTimeValue = isBanquetArrivalMode ? (booking.time || '-') : bookingDetailTimeRange;
    const customerBlockHtml = booking.customerId
        ? `<div id="bookingCustomerBlock" class="booking-customer-block${hasBanquetOverview ? ' booking-customer-block--priority' : ''}"></div>`
        : '';
    const priorityCustomerBlockHtml = hasBanquetOverview ? customerBlockHtml : '';
    const standardCustomerBlockHtml = hasBanquetOverview ? '' : customerBlockHtml;
    const packageDetailHtml = hasBanquetOverview ? '' : renderBookingPackageDetail(booking);

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
        ${priorityCustomerBlockHtml}
        <div class="booking-detail-row">
            <span class="label">${escapeHtml(bookingDetailDateLabel)}:</span>
            <span class="value">${escapeHtml(booking.date)}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">${escapeHtml(bookingDetailTimeLabel)}:</span>
            <span class="value">${escapeHtml(bookingDetailTimeValue)}</span>
        </div>
        ${lineDetailHtml}
        ${hostsDetailHtml}
        ${animationExtrasHtml}
        <div class="booking-detail-row">
            <span class="label">Сума:</span>
            <span class="value">${escapeHtml(formatPrice(booking.price))}</span>
        </div>
        ${renderEducationLessonDetail(booking)}
        ${renderBookingWorkspaceDetail(booking)}
        ${packageDetailHtml}
        ${bookingChildrenCount ? `<div class="booking-detail-row"><span class="label">${isEducationBooking ? 'Учнів' : 'Дітей'}:</span><span class="value">${escapeHtml(String(bookingChildrenCount))}</span></div>` : ''}
        ${booking.banquetAdults ? `<div class="booking-detail-row"><span class="label">Дорослих:</span><span class="value">${escapeHtml(String(booking.banquetAdults))}</span></div>` : ''}
        <div class="booking-detail-row">
            <span class="label">Статус:</span>
            <span class="status-badge status-badge--${booking.status === 'preliminary' ? 'preliminary' : 'confirmed'}">${booking.status === 'preliminary' ? '⏳ Попереднє' : '✅ Підтверджене'}</span>
        </div>
        ${renderBookingCommentDetailRow(booking)}
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
                    <button type="button" class="customer-action-btn" title="Скопіювати імʼя" onclick="navigator.clipboard.writeText('${escapeHtml(customer.name)}');this.textContent='✓';setTimeout(()=>this.textContent='📋',800)">📋</button>
                </span>
            </div>`);
            // Phone — tel: link + copy + TG
            if (customer.phone) {
                const cleanPhone = customer.phone.replace(/[^+\d]/g, '');
                rows.push(`<div class="customer-row customer-row--phone">
                    <span class="customer-row-icon">📞</span>
                    <a href="tel:${escapeHtml(cleanPhone)}" class="customer-link" title="Зателефонувати">${escapeHtml(customer.phone)}</a>
                    <span class="customer-row-actions">
                        <button type="button" class="customer-action-btn" title="Скопіювати" onclick="navigator.clipboard.writeText('${escapeHtml(customer.phone)}');this.textContent='✓';setTimeout(()=>this.textContent='📋',800)">📋</button>
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
                        <button type="button" class="customer-action-btn" title="Скопіювати" onclick="navigator.clipboard.writeText('@${escapeHtml(igName)}');this.textContent='✓';setTimeout(()=>this.textContent='📋',800)">📋</button>
                    </span>
                </div>`);
            }
            // Child — birthday + age
            if (customer.childName) {
                let childText = escapeHtml(customer.childName);
                if (customer.childBirthday) {
                    const bd = new Date(customer.childBirthday);
                    const age = Math.floor((new Date() - bd) / (365.25 * 24 * 60 * 60 * 1000));
                    childText += ` <span class="customer-age">${age} р. (${bd.toLocaleDateString('uk-UA')})</span>`;
                }
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
        });
    }
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
    const result = await apiCreateBanquetGroup(sourceId, {
        groupName: source.label || source.programName || source.room || null,
        source: 'booking_details',
        meta: { ui: 'booking_details' }
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

async function editBooking(bookingId) {
    const bookings = await getBookingsForDate(AppState.selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;
    if (shouldEditBookingInAnimatorView(booking)) {
        return openAnimationBookingInAnimatorView(booking.id, 'edit');
    }

    closeAllModals();

    // Встановити режим редагування
    AppState.editingBookingId = bookingId;
    // Store updatedAt for optimistic locking
    AppState.editingBookingUpdatedAt = booking.updatedAt || null;

    // Відкрити панель з даними бронювання
    const panelLineId = isRoomFirstTimelineView() ? (booking.resourceId || booking.room || booking.lineId) : booking.lineId;
    await openBookingPanel(booking.time, panelLineId);

    // Змінити заголовок і кнопку
    const editH3 = document.querySelector('#bookingPanel .panel-header h3');
    const editBtn = document.querySelector('#bookingForm .btn-submit');
    if (editH3) editH3.textContent = 'Редагувати бронювання';
    if (editBtn) editBtn.textContent = 'Зберегти зміни';
    hydrateBookingWorkspace(booking);
    const editCommentType = bookingCommentTypeForBooking(booking);
    const editComments = bookingWorkspaceCommentsFromBooking(booking);
    BookingDrawerState.legacyNotesFallback = isParkTimelineBookingMode() && Boolean(booking.notes);
    BookingDrawerState.legacyGroupNameFallback = isParkTimelineBookingMode() && Boolean(booking.groupName);

    // Заповнити форму
    document.getElementById('roomSelect').value = booking.room || '';
    await refreshBookingRoomAvailabilityForSelectedDate({ selectedRoom: booking.room || '', excludeId: bookingId });
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
            const clientOwnedFiller = isClientPinataFillerNumber(booking.pinataFillerNumber) || isClientPinataFillerChoice(booking.pinataFiller);
            if (pinataNumberInput) pinataNumberInput.value = booking.pinataNumber || '';
            if (pinataFillerNumberInput) pinataFillerNumberInput.value = clientOwnedFiller ? CLIENT_PINATA_FILLER_LABEL : (booking.pinataFillerNumber || '');
            const pinataFillerSelect = document.getElementById('pinataFillerSelect');
            if (mode === 'park' && pinataFillerSelect) {
                pinataFillerSelect.value = clientOwnedFiller ? CLIENT_PINATA_FILLER_VALUE : (booking.pinataFiller || '');
                syncPinataClientFillerChoice();
            }
            renderPinataVisualPickers();
            if (mode === 'client') {
                const priceInput = document.getElementById('clientPinataServicePrice');
                const noteInput = document.getElementById('clientPinataServiceNote');
                if (priceInput) priceInput.value = booking.clientPinataServicePrice ?? getClientPinataDefaultPrice();
                if (noteInput) noteInput.value = booking.clientPinataServiceNote || '';
            }
        }

        // К-кість дітей (МК)
        if (program && (program.perChild || isEducationTimelineBookingMode()) && booking.kidsCount) {
            const kidsInput = document.getElementById('kidsCountInput');
            if (kidsInput) {
                kidsInput.value = booking.kidsCount;
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

    await hydrateBookingCustomerSelection(booking, { renderSummary: false });
    hydrateBookingPackageWorkspace(booking);

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
    document.querySelector('#bookingForm .btn-submit').textContent = 'Створити копію';
    hydrateBookingWorkspace(booking);

    // Pre-fill форму (ідентично editBooking)
    document.getElementById('roomSelect').value = booking.room || '';
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
            const clientOwnedFiller = isClientPinataFillerNumber(booking.pinataFillerNumber) || isClientPinataFillerChoice(booking.pinataFiller);
            if (pinataNumberInput) pinataNumberInput.value = booking.pinataNumber || '';
            if (pinataFillerNumberInput) pinataFillerNumberInput.value = clientOwnedFiller ? CLIENT_PINATA_FILLER_LABEL : (booking.pinataFillerNumber || '');
            const pinataFillerSelect = document.getElementById('pinataFillerSelect');
            if (mode === 'park' && pinataFillerSelect) {
                pinataFillerSelect.value = clientOwnedFiller ? CLIENT_PINATA_FILLER_VALUE : (booking.pinataFiller || '');
                syncPinataClientFillerChoice();
            }
            renderPinataVisualPickers();
            if (mode === 'client') {
                const priceInput = document.getElementById('clientPinataServicePrice');
                const noteInput = document.getElementById('clientPinataServiceNote');
                if (priceInput) priceInput.value = booking.clientPinataServicePrice ?? getClientPinataDefaultPrice();
                if (noteInput) noteInput.value = booking.clientPinataServiceNote || '';
            }
        }

        if (program && (program.perChild || isEducationTimelineBookingMode()) && booking.kidsCount) {
            const kidsInput = document.getElementById('kidsCountInput');
            if (kidsInput) {
                kidsInput.value = booking.kidsCount;
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

function copyInviteLink(btn) {
    const url = btn && btn.dataset.url ? btn.dataset.url : '';
    navigator.clipboard.writeText(url).then(() => {
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
        const preview = modal.querySelector('.invite-preview');
        const link = modal.querySelector('.btn-invite-open');
        if (!link) return;
        const url = link.href;
        const spans = preview ? preview.querySelectorAll('span') : [];
        const text = spans.length > 0
            ? `Запрошуємо! ${Array.from(spans).map(s => s.textContent).join(' | ')} — Парк Закревського Періоду`
            : 'Запрошуємо на свято! Парк Закревського Періоду';
        if (navigator.share) {
            navigator.share({ title: 'Парк Закревського Періоду', text, url }).catch(() => {});
        } else {
            copyInviteLink(url);
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

        pushUndo('delete', [...allToDelete]);

        // v5.7: Single server call — server handles linked deletion, history, Telegram
        const delResult = await apiDeleteBooking(mainBookingId);
        if (delResult && delResult.success === false) {
            showNotification(delResult.error || 'Помилка видалення бронювання', 'error');
            return;
        }

        if (typeof window.invalidateTimelineBanquetSnapshotCache === 'function') {
            window.invalidateTimelineBanquetSnapshotCache({
                bookingIds: allToDelete.map(item => item?.id).filter(Boolean)
            });
        }
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
                pinataMode: booking.pinataMode || null,
                pinataNumber: booking.pinataNumber || null,
                pinataFillerNumber: booking.pinataFillerNumber || null,
                pinataFiller: booking.pinataFiller || null,
                clientPinataServicePrice: booking.clientPinataServicePrice ?? null,
                clientPinataServiceNote: booking.clientPinataServiceNote || null,
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

            for (const id of ids) {
                try {
                    const bookings = await getBookingsForDate(AppState.selectedDate);
                    const b = bookings.find(x => x.id === id);
                    if (b) undoData.push(b);
                    await apiDeleteBooking(id);
                } catch (e) { /* continue */ }
            }

            if (undoData.length > 0) pushUndo('delete', undoData);
            this.clear();
            AppState.cachedBookings = {};
            await renderTimeline();
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




