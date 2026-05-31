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

function getClientPinataDefaultPrice() {
    const ownPinata = getProductsSync().find(p => p.id === 'pinata_own');
    return Number(ownPinata?.price || 300);
}

function getPinataModeValue() {
    return document.getElementById('pinataMode')?.value || 'none';
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
}

function resetPinataModeFields() {
    const mode = document.getElementById('pinataMode');
    if (mode) mode.value = 'none';
    const fillerSelect = document.getElementById('pinataFillerSelect');
    if (fillerSelect) fillerSelect.value = '';
    const pinataNumber = document.getElementById('pinataNumber');
    if (pinataNumber) pinataNumber.value = '';
    const pinataFillerNumber = document.getElementById('pinataFillerNumber');
    if (pinataFillerNumber) pinataFillerNumber.value = '';
    const servicePrice = document.getElementById('clientPinataServicePrice');
    if (servicePrice) servicePrice.value = '';
    const serviceNote = document.getElementById('clientPinataServiceNote');
    if (serviceNote) serviceNote.value = '';
    document.getElementById('pinataModeSection')?.classList.add('hidden');
    document.getElementById('pinataSharedFields')?.classList.add('hidden');
    document.getElementById('pinataFillerSection')?.classList.add('hidden');
    document.getElementById('clientPinataServiceFields')?.classList.add('hidden');
}

const BookingPackageState = {
    menuPositions: [],
    editIndex: null
};

const BookingDrawerState = {
    clientMode: 'search',
    selectedProgramCategory: 'all',
    validationAttempted: false
};

const BOOKING_WORKSPACE_SCHEMA_VERSION = 1;
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
        groupLabel: 'Група / банкет',
        notesLabel: 'Примітки',
        customerNameLabel: 'Імʼя клієнта',
        phoneLabel: 'Телефон',
        roomOptionLabel: 'Кімната',
        parkKitchenEnabled: true
    };
}

function isParkTimelineBookingMode() {
    return getTimelineBookingPresentation().mode === 'park';
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

function timelineKitchenEnabled() {
    const presentation = getTimelineBookingPresentation();
    return presentation.mode === 'park' && presentation.parkKitchenEnabled !== false;
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

function getSelectedTimelineResourceLine() {
    const dateStr = formatDate(AppState.selectedDate);
    const lineId = document.getElementById('bookingLine')?.value || AppState.selectedLineId;
    const lines = AppState.linesByDate?.[dateStr] || AppState.lines || [];
    return lines.find(line => String(line.id) === String(lineId)) || null;
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
    return !!document.getElementById('bookingHasEventToggle')?.checked;
}

function isBookingKitchenEnabled() {
    return !!document.getElementById('bookingKitchenToggle')?.checked;
}

function hasBookingKitchenDraft() {
    return getBookingMenuPositions().length > 0
        || Boolean(document.getElementById('banquetMenu')?.value?.trim())
        || Boolean(document.getElementById('banquetGuests')?.value?.trim())
        || Boolean(document.getElementById('banquetTables')?.value?.trim());
}

function setBookingKitchenEnabled(enabled, options = {}) {
    const toggle = document.getElementById('bookingKitchenToggle');
    if (toggle) toggle.checked = !!enabled;
    syncBookingWorkspaceMode(options);
}

function isBookingLeadDetailsEnabled() {
    return !!document.getElementById('bookingLeadDetailsToggle')?.checked;
}

function setBookingLeadDetailsEnabled(enabled, options = {}) {
    const toggle = document.getElementById('bookingLeadDetailsToggle');
    if (toggle) toggle.checked = !!enabled;
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
    if (section && hasBookingLeadDetails(getBookingLeadDetails())) {
        section.open = true;
        setBookingLeadDetailsEnabled(true, { markDirty: false });
    }
}

function resetBookingLeadDetails() {
    ['bookingLeadSource', 'bookingLeadStatus', 'bookingLeadInterestDate', 'bookingLeadBudget', 'bookingLeadChildrenInfo', 'bookingLeadNotes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const section = document.getElementById('bookingLeadDetailsSection');
    if (section) section.open = false;
}

function isValidNewBookingClient() {
    const name = document.getElementById('customerName')?.value?.trim() || '';
    const phone = document.getElementById('customerPhone')?.value?.trim() || '';
    const instagram = document.getElementById('customerInstagram')?.value?.trim() || '';
    return Boolean(name) && (Boolean(phone) || Boolean(instagram));
}

function hasAnyNewBookingClientData() {
    return ['customerName', 'customerPhone', 'customerInstagram', 'customerChildName', 'customerChildBirthday']
        .some(id => Boolean(document.getElementById(id)?.value?.trim?.() || document.getElementById(id)?.value || ''));
}

function setBookingClientMode(mode = 'search', options = {}) {
    BookingDrawerState.clientMode = mode;
    const selectedCard = document.getElementById('bookingSelectedCustomerCard');
    const newCustomerForm = document.getElementById('bookingNewCustomerForm');
    const searchState = document.getElementById('bookingCustomerSearchState');
    const createBtn = document.getElementById('bookingCreateCustomerBtn');
    const changeBtn = document.getElementById('bookingChangeCustomerBtn');
    const modeLabel = document.getElementById('bookingCustomerModeLabel');
    const customerSearch = document.getElementById('customerSearch');
    const hasSelected = Boolean(document.getElementById('selectedCustomerId')?.value);

    if (selectedCard) selectedCard.classList.toggle('hidden', mode !== 'existing');
    if (newCustomerForm) newCustomerForm.classList.toggle('hidden', mode !== 'new');
    if (searchState && mode !== 'search') {
        searchState.classList.add('hidden');
        searchState.innerHTML = '';
    }
    if (createBtn) createBtn.textContent = mode === 'new' ? 'Повернутися до пошуку' : '+ Створити нового клієнта';
    if (changeBtn) changeBtn.classList.toggle('hidden', !hasSelected);
    if (modeLabel) {
        if (mode === 'existing') modeLabel.textContent = 'Прикріплено існуючу картку клієнта.';
        else if (mode === 'new') modeLabel.textContent = 'Створюємо нового клієнта тільки якщо пошук не допоміг.';
        else modeLabel.textContent = 'Оберіть клієнта або створіть нового.';
    }
    if (customerSearch) customerSearch.setAttribute('aria-expanded', mode === 'search' ? 'true' : 'false');
    if (options.focusNewForm && mode === 'new') document.getElementById('customerName')?.focus();
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
    const createBtn = document.getElementById('bookingCreateCustomerBtn');
    if (!state) return;
    if (!message) {
        state.classList.add('hidden');
        state.innerHTML = '';
    } else {
        state.textContent = message;
        state.classList.remove('hidden');
    }
    if (createBtn && options.showCreate === false && BookingDrawerState.clientMode !== 'new') {
        createBtn.classList.add('hidden');
    } else if (createBtn) {
        createBtn.classList.remove('hidden');
    }
}

function getSmartBookingValidationState() {
    const formData = getBookingFormData();
    const presentation = window.TimelineBusinessContext?.presentation?.() || { mode: 'park' };
    const isMaysternya = typeof isMaysternyaBookingContext === 'function' && isMaysternyaBookingContext();
    const roomOptional = isMaysternya && presentation.mode === 'simple';
    const hasDateTime = Boolean(formData?.time) && Boolean(AppState.selectedDate);
    const hasRoom = Boolean(formData?.room);
    const hasSelectedCustomer = Boolean(document.getElementById('selectedCustomerId')?.value);
    const hasClient = hasSelectedCustomer || isValidNewBookingClient();
    const isEducation = presentation.mode === 'education';
    const lessonTitle = document.getElementById('educationLessonTitle')?.value?.trim() || '';
    const hasProgram = Boolean(formData?.programId) || (isEducation && Boolean(lessonTitle));
    const programRequired = getBookingWorkspaceHasEvent();
    const warnings = [];
    const errors = [];
    const invalidFields = [];

    if (!hasDateTime) errors.push('Не вдалося визначити дату або час для бронювання.');
    if (!hasRoom && !roomOptional) {
        errors.push(presentation.mode === 'education' ? 'Оберіть кабінет.' : 'Оберіть кімнату.');
        invalidFields.push('roomSelect');
    }
    if (!hasClient) {
        const hasDraftClient = hasAnyNewBookingClientData();
        const draftName = document.getElementById('customerName')?.value?.trim() || '';
        const draftPhone = document.getElementById('customerPhone')?.value?.trim() || '';
        const draftInstagram = document.getElementById('customerInstagram')?.value?.trim() || '';
        if (hasDraftClient || BookingDrawerState.clientMode === 'new') {
            if (!draftName) {
                errors.push('Вкажіть імʼя нового клієнта.');
                invalidFields.push('customerName');
            }
            if (!draftPhone && !draftInstagram) {
                errors.push('Вкажіть телефон або Instagram нового клієнта.');
                invalidFields.push('customerPhone', 'customerInstagram');
            }
        } else {
            errors.push('Оберіть існуючого клієнта або створіть нового: імʼя + телефон чи Instagram.');
            invalidFields.push('customerSearch', 'customerName');
        }
    }
    if (programRequired && !hasProgram) {
        errors.push(isEducation ? 'Оберіть заняття або вкажіть тему.' : 'Увімкнено подію, але програму ще не вибрано.');
        invalidFields.push(isEducation ? 'educationLessonTitle' : 'selectedProgram');
    }
    if (isBookingKitchenEnabled() && !hasBookingKitchenDraft()) {
        warnings.push('Кухня увімкнена, але позиції меню ще не додані.');
    }
    if (getBookingWorkspaceHasEvent() && !hasProgram) {
        warnings.push('Подія увімкнена, але програму ще не вибрано.');
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
        'educationLessonTitle'
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
    const hasEvent = options.hasEvent ?? getBookingWorkspaceHasEvent();
    const positions = options.positions || getBookingMenuPositions();
    const hasKitchen = options.hasKitchen ?? (isBookingKitchenEnabled() && (positions.length > 0 || Boolean(document.getElementById('banquetMenu')?.value?.trim())));
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
    const hasEvent = getBookingWorkspaceHasEvent();
    const hasKitchen = isBookingKitchenEnabled();
    const hasLeadDetails = isBookingLeadDetailsEnabled();
    const eventFields = document.getElementById('bookingEventFields');
    const banquetFields = document.getElementById('banquetFields');
    const leadSection = document.getElementById('bookingLeadDetailsSection');
    const room = document.getElementById('roomSelect');
    const showKitchenFields = hasKitchen && timelineKitchenEnabled();
    if (eventFields) eventFields.classList.toggle('hidden', !hasEvent);
    if (banquetFields) {
        banquetFields.classList.toggle('hidden', !showKitchenFields);
        banquetFields.hidden = !showKitchenFields;
    }
    if (leadSection) leadSection.classList.toggle('hidden', !hasLeadDetails);
    if (room) {
        room.required = true;
        room.setAttribute('aria-required', 'true');
    }
    const selectedProgram = document.getElementById('selectedProgram');
    if (selectedProgram && !hasEvent) selectedProgram.setAttribute('aria-invalid', 'false');
    const scenario = getBookingWorkspaceScenario({ hasEvent, hasKitchen });
    const meta = getBookingWorkspaceScenarioMeta(scenario);
    const chip = document.getElementById('bookingScenarioChip');
    const text = document.getElementById('bookingScenarioText');
    if (chip) chip.textContent = meta.label;
    if (text) text.textContent = meta.text;
    renderBookingPackageSummary();
    updateBookingSubmitState();
    if (options.markDirty && window.BookingForm) BookingForm._dirty = true;
}

function setBookingWorkspaceHasEvent(hasEvent, options = {}) {
    const toggle = document.getElementById('bookingHasEventToggle');
    if (toggle) toggle.checked = !!hasEvent;
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

function bookingKitchenTypeLabel(type) {
    return type === 'cake' ? 'Торт' : 'Меню';
}

function toBookingMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
}

function getBookingMenuProducts() {
    if (!timelineKitchenEnabled()) return [];
    const products = typeof getProductsSync === 'function' ? getProductsSync() : [];
    return products
        .filter(p => {
            const type = bookingKitchenType(p);
            return (p.domain === 'kitchen' && (type === 'menu' || type === 'cake'))
                || p.category === 'menu'
                || p.category === 'cake';
        })
        .filter(p => p.isActive !== false && p.availabilityStatus !== 'hidden' && p.availabilityStatus !== 'sold_out')
        .sort((a, b) => {
            const typeCompare = bookingKitchenType(a).localeCompare(bookingKitchenType(b), 'uk');
            return typeCompare
                || String(a.menuSection || '').localeCompare(String(b.menuSection || ''), 'uk')
                || (a.sortOrder || 0) - (b.sortOrder || 0);
        });
}

function normalizeBookingMenuPosition(raw, index = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const title = String(raw.title || raw.label || raw.name || '').trim();
    if (!title) return null;
    const quantity = Math.max(Number(raw.quantity || raw.qty || 1), 0.1);
    const unitPrice = toBookingMoney(raw.unitPrice ?? raw.unit_price ?? raw.price);
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
        weightValue: raw.weightValue || raw.weight_value || null,
        cakeDecoration: raw.cakeDecoration || raw.cake_decoration || null,
        source: raw.source || (raw.productId || raw.product_id ? 'product' : 'custom')
    };
}

function getBookingMenuPositions() {
    return BookingPackageState.menuPositions.map((item, index) => normalizeBookingMenuPosition(item, index)).filter(Boolean);
}

function bookingMenuPositionsSubtotal(positions = getBookingMenuPositions()) {
    return toBookingMoney(positions.reduce((sum, item) => sum + toBookingMoney(item.subtotal), 0));
}

function bookingMenuPositionsToLegacyText(positions = getBookingMenuPositions()) {
    return positions.map(item => {
        const qty = Number(item.quantity) % 1 === 0 ? String(item.quantity) : String(item.quantity).replace('.', ',');
        const unit = item.servingUnit ? ` ${item.servingUnit}` : '';
        const price = item.unitPrice ? ` x ${item.unitPrice} грн` : '';
        const note = item.note ? ` (${item.note})` : '';
        return `${item.title} - ${qty}${unit}${price}${note}`;
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
}

function renderBookingMenuPositions() {
    const list = document.getElementById('bookingMenuPositionsList');
    const hidden = document.getElementById('bookingMenuPositionsJson');
    const positions = getBookingMenuPositions();
    BookingPackageState.menuPositions = positions;
    if (hidden) hidden.value = JSON.stringify(positions);
    if (!list) return;
    if (!positions.length) {
        list.innerHTML = '<div class="booking-summary-empty">Меню або сервісні позиції ще не додані.</div>';
    } else {
        list.innerHTML = positions.map((item, index) => `
            <div class="booking-menu-position-row" data-menu-index="${index}">
                <div>
                    <div class="booking-menu-position-title"><span class="booking-menu-position-kind">${escapeHtml(bookingKitchenTypeLabel(item.kitchenType))}</span>${escapeHtml(item.title)}</div>
                    <div class="booking-menu-position-meta">${escapeHtml(String(item.quantity))}${item.servingUnit ? ` ${escapeHtml(item.servingUnit)}` : ''} x ${escapeHtml(formatPrice(item.unitPrice))} = ${escapeHtml(formatPrice(item.subtotal))}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</div>
                </div>
                <div class="booking-menu-position-actions">
                    <button type="button" class="booking-menu-edit-btn" data-menu-edit="${index}" title="Редагувати">✎</button>
                    <button type="button" class="booking-menu-remove-btn" data-menu-remove="${index}" title="Видалити">✕</button>
                </div>
            </div>
        `).join('');
        list.querySelectorAll('[data-menu-edit]').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = Number(btn.dataset.menuEdit);
                const item = BookingPackageState.menuPositions[index];
                if (!item) return;
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
                renderBookingMenuPositions();
                syncLegacyBanquetMenuFromPositions(true);
                renderBookingPackageSummary();
                syncBookingWorkspaceMode();
                if (window.BookingForm) BookingForm._dirty = true;
            });
        });
    }
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
    BookingPackageState.editIndex = null;
    ['bookingMenuProductSelect', 'bookingMenuNote', 'bookingMenuUnitPrice', 'bookingMenuPositionsJson', 'banquetMenu', 'banquetGuests', 'banquetTables'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
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
    const programBasePrice = getProgramBasePrice(program);
    const positions = getBookingMenuPositions();
    const positionsSubtotal = bookingMenuPositionsSubtotal(positions);
    return {
        programBasePrice,
        positionsSubtotal,
        finalTotal: toBookingMoney(programBasePrice + positionsSubtotal),
        menuPositions: positions
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
    const resolvedCustomerName = selectedCustomerName || customerName || (customerId ? 'Існуючий клієнт' : 'не вибрано');
    const totals = getBookingPackageTotals(program);
    const validation = getSmartBookingValidationState();
    const kitchenEnabled = isBookingKitchenEnabled();
    const kitchenTotal = kitchenEnabled ? totals.positionsSubtotal : 0;
    const finalTotal = hasEvent || kitchenEnabled ? totals.finalTotal : 0;
    const programLabel = program
        ? `${program.code || program.shortLabel || 'ПРО'} · ${program.duration ? `${program.duration} хв` : 'без тривалості'}${totals.programBasePrice ? ` · ${formatPrice(totals.programBasePrice)}` : ''}`
        : (hasEvent ? 'не вибрано' : 'вимкнено');
    const kitchenLabel = kitchenEnabled
        ? (totals.menuPositions.length
            ? `${totals.menuPositions.length} поз. · ${formatPrice(kitchenTotal)}`
            : 'увімкнено, позицій ще немає')
        : 'вимкнено';

    if (!roomValue && !customerId && !customerName && !hasEvent && !kitchenEnabled) {
        container.innerHTML = `
            <div class="booking-summary-empty">Оберіть кімнату і клієнта — підсумок оновиться автоматично.</div>
            ${BookingDrawerState.validationAttempted ? renderBookingValidationIssues(validation) : ''}
        `;
        updateBookingSubmitState();
        return;
    }
    container.innerHTML = `
        <div class="booking-summary-row"><span>Кімната</span><strong>${escapeHtml(roomLabel)}</strong></div>
        <div class="booking-summary-row"><span>Клієнт</span><strong>${escapeHtml(resolvedCustomerName)}</strong></div>
        <div class="booking-summary-row"><span>Програма</span><strong>${escapeHtml(programLabel)}</strong></div>
        <div class="booking-summary-row"><span>Кухня</span><strong>${escapeHtml(kitchenLabel)}</strong></div>
        <div class="booking-summary-row booking-summary-total"><span>Разом</span><strong>${escapeHtml(formatPrice(finalTotal))}</strong></div>
        ${BookingDrawerState.validationAttempted ? renderBookingValidationIssues(validation) : ''}
        ${validation.warnings?.length ? `<div class="booking-summary-note">${escapeHtml(validation.warnings[0])}</div>` : ''}
    `;
    updateBookingSubmitState();
}

function getBookingPackageFromBooking(booking) {
    return booking?.bookingPackage || booking?.extraData?.bookingPackage || booking?.extra_data?.bookingPackage || null;
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
    setBookingMenuPositions(bookingPackage?.menuPositions || []);
    setBookingKitchenEnabled(Boolean((bookingPackage?.menuPositions || []).length || booking?.banquetMenu || booking?.banquetGuests || booking?.banquetTables), { markDirty: false });
    const banquetMenu = document.getElementById('banquetMenu');
    if (banquetMenu) {
        banquetMenu.value = booking?.banquetMenu || bookingMenuPositionsToLegacyText();
        banquetMenu.dataset.generated = bookingPackage?.menuPositions?.length ? 'true' : 'false';
    }
    const guests = document.getElementById('banquetGuests');
    if (guests) guests.value = booking?.banquetGuests || '';
    const tables = document.getElementById('banquetTables');
    if (tables) tables.value = booking?.banquetTables || '';
    renderBookingPackageSummary();
}

function hydrateBookingWorkspace(booking) {
    const workspace = getBookingWorkspaceFromBooking(booking);
    const hasEvent = workspace
        ? workspace.hasEvent !== false
        : Boolean(booking?.programId || Number(booking?.duration || 0) > 0);
    setBookingWorkspaceHasEvent(hasEvent, { markDirty: false });
    resetBookingLeadDetails();
    if (workspace?.leadDetails) setBookingLeadDetails(workspace.leadDetails);
    setBookingLeadDetailsEnabled(Boolean(workspace?.leadDetails && hasBookingLeadDetails(workspace.leadDetails)), { markDirty: false });
    renderBookingPackageSummary();
}

function renderBookingPackageDetail(booking) {
    const bookingPackage = getBookingPackageFromBooking(booking);
    const positions = bookingPackage?.menuPositions || [];
    if (!bookingPackage && !booking?.banquetMenu) return '';
    const rows = positions.length
        ? positions.map(item => `
            <div class="booking-detail-package-row">
                <div><span class="booking-menu-position-kind">${escapeHtml(bookingKitchenTypeLabel(item.kitchenType))}</span>${escapeHtml(item.title)}<small>${escapeHtml(String(item.quantity))}${item.servingUnit ? ` ${escapeHtml(item.servingUnit)}` : ''} x ${escapeHtml(formatPrice(item.unitPrice || 0))}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</small></div>
                <strong>${escapeHtml(formatPrice(item.subtotal || 0))}</strong>
            </div>
        `).join('')
        : `<div class="booking-detail-package-row"><div>${escapeHtml(booking.banquetMenu || 'Меню не деталізовано')}</div><strong>—</strong></div>`;
    return `
        <div class="booking-detail-package">
            <div class="booking-detail-package-header">Меню / сервісні позиції</div>
            ${rows}
            <div class="booking-detail-package-row booking-detail-package-total">
                <div>Разом пакет</div>
                <strong>${escapeHtml(formatPrice(bookingPackage?.finalTotal ?? booking.price ?? 0))}</strong>
            </div>
        </div>
    `;
}

function renderBookingWorkspaceDetail(booking) {
    const workspace = getBookingWorkspaceFromBooking(booking);
    if (!workspace && booking?.programId) return '';
    const scenario = workspace?.scenario || (booking?.programId ? 'event' : 'lead_only');
    const meta = getBookingWorkspaceScenarioMeta(scenario);
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
        <div class="booking-detail-row"><span class="label">Сценарій:</span><span class="value">${escapeHtml(meta.label)}</span></div>
        ${leadRows}
    `;
}

function initBookingPackageWorkspace() {
    renderBookingMenuProductOptions();
    document.getElementById('bookingHasEventToggle')?.addEventListener('change', () => {
        syncBookingWorkspaceMode({ markDirty: true });
    });
    document.getElementById('bookingKitchenToggle')?.addEventListener('change', () => {
        syncBookingWorkspaceMode({ markDirty: true });
    });
    document.getElementById('bookingLeadDetailsToggle')?.addEventListener('change', () => {
        const section = document.getElementById('bookingLeadDetailsSection');
        if (section && !document.getElementById('bookingLeadDetailsToggle')?.checked) section.open = false;
        syncBookingWorkspaceMode({ markDirty: true });
    });
    document.getElementById('roomSelect')?.addEventListener('change', (e) => {
        if (e.target.value) e.target.setAttribute('aria-invalid', 'false');
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
    ['roomSelect', 'customerName', 'selectedProgram', 'kidsCountInput', 'clientPinataServicePrice', 'pinataMode', 'banquetMenu',
     'educationLessonTitle', 'educationLessonTeacher', 'educationLessonGroup', 'educationLessonCourse',
     'educationLessonSeriesSize', 'educationLessonRepeatEvery', 'educationLessonType',
     'bookingGroupName', 'bookingNotes', 'bookingLeadSource', 'bookingLeadStatus', 'bookingLeadInterestDate',
     'bookingLeadBudget', 'bookingLeadChildrenInfo', 'bookingLeadNotes'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            if (id === 'educationLessonGroup') syncEducationGroupToBookingGroup();
            renderBookingPackageSummary();
            if (id === 'customerName' || id === 'customerPhone' || id === 'customerInstagram') {
                debouncedBookingDuplicateCheck();
            }
        });
        el.addEventListener('change', () => {
            if (id === 'educationLessonGroup') syncEducationGroupToBookingGroup();
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
    if (booking?.pinataFiller) return 'park';
    return isPinataProgram(program) ? 'park' : 'none';
}

function renderPinataDetailRows(booking) {
    const numberRows = [
        booking?.pinataNumber
            ? `<div class="booking-detail-row"><span class="label">Номер піньяти:</span><span class="value">${escapeHtml(booking.pinataNumber)}</span></div>`
            : '',
        booking?.pinataFillerNumber
            ? `<div class="booking-detail-row"><span class="label">Номер наповнювача:</span><span class="value">${escapeHtml(booking.pinataFillerNumber)}</span></div>`
            : ''
    ].join('');

    if (booking?.pinataMode === 'client') {
        const note = booking.clientPinataServiceNote
            ? `<div class="booking-detail-row"><span class="label">Нотатка:</span><span class="value">${escapeHtml(booking.clientPinataServiceNote)}</span></div>`
            : '';
        return `<div class="booking-detail-row"><span class="label">Піньята:</span><span class="value">Клієнтська піньята (послуга)${booking.clientPinataServicePrice ? ` - ${escapeHtml(formatPrice(booking.clientPinataServicePrice))}` : ''}</span></div>${numberRows}${note}`;
    }
    if ((booking?.pinataMode === 'park' || !booking?.pinataMode) && booking?.pinataFiller) {
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
        return `<div class="booking-detail-row"><span class="label">Піньята парку:</span><span class="value">${escapeHtml(booking.pinataFiller)}</span></div>`;
    }
    return '';
}

// ==========================================
// ПАНЕЛЬ БРОНЮВАННЯ
// ==========================================

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
    const lines = await getLinesForDate(AppState.selectedDate);
    const line = lines.find(l => l.id === lineId);

    // C1: Show date in panel
    const dateDisplay = document.getElementById('selectedDateDisplay');
    if (dateDisplay) {
        const d = AppState.selectedDate;
        dateDisplay.textContent = `${formatDate(d)} (${DAYS[d.getDay()]})`;
    }
    document.getElementById('selectedTimeDisplay').textContent = time;
    document.getElementById('selectedLineDisplay').textContent = line ? line.name : '-';
    document.getElementById('bookingTime').value = time;
    document.getElementById('bookingLine').value = lineId;

    // Скинути форму
    document.getElementById('roomSelect').value = '';
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
    BookingDrawerState.validationAttempted = false;
    renderProgramCategoryChips();
    renderSelectedProgramSummary(null);
    document.getElementById('hostsWarning')?.classList.add('hidden');
    document.getElementById('customProgramSection')?.classList.add('hidden');
    document.getElementById('secondAnimatorSection')?.classList.add('hidden');
    resetPinataModeFields();
    setBookingWorkspaceHasEvent(false, { markDirty: false });
    setBookingKitchenEnabled(false, { markDirty: false });
    setBookingLeadDetailsEnabled(Boolean(AppState.leadConversionContext?.leadId), { markDirty: false });

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
    prepareMaysternyaBookingPanel();
    prepareDisplayModeBookingPanel({ line });

    document.getElementById('bookingPanel')?.classList.remove('hidden');
    document.querySelector('.main-content').classList.add('panel-open');
    // v5.33: Lock body scroll on mobile when panel is open
    document.body.classList.add('panel-open');
    // v5.35: Show backdrop overlay on tablet/mobile
    document.getElementById('panelBackdrop')?.classList.remove('hidden');
    const panel = document.getElementById('bookingPanel');
    if (window.UnsafeDismissGuard && panel) window.UnsafeDismissGuard.remember(panel);
    if (window.BookingForm?.markClean) BookingForm.markClean();
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

function clearSelectedCustomerLink() {
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
    setBookingClientMode(hasAnyNewBookingClientData() ? 'new' : 'search');
}

function clearSelectedCustomerLinkIfEdited(el) {
    const hiddenId = document.getElementById('selectedCustomerId');
    if (!hiddenId?.value || !el || el.dataset.selectedValue === undefined) return;
    if (String(el.value || '') !== String(el.dataset.selectedValue || '')) {
        clearSelectedCustomerLink();
    }
}

function applyLeadConversionContextToBookingForm() {
    const ctx = AppState.leadConversionContext;
    if (!ctx || !ctx.leadId || AppState.editingBookingId) return;

    const customerToggle = document.getElementById('customerDataToggle');
    if (customerToggle) customerToggle.checked = true;
    document.getElementById('customerDataSection')?.classList.remove('hidden');

    if (ctx.customerName) {
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
    setBookingLeadDetails({
        source: 'lead',
        status: 'warm',
        interestDate: ctx.eventDate || '',
        notes: ctx.customerName ? `Лід #${ctx.leadId}: ${ctx.customerName}` : `Лід #${ctx.leadId}`
    });
    renderBookingPackageSummary();
}

function clearLeadConversionContextAfterBooking(bookingId) {
    if (!AppState.leadConversionContext) return;
    AppState.leadConversionContext = null;
    const url = new URL(window.location.href);
    url.searchParams.delete('leadId');
    url.searchParams.delete('lead');
    url.searchParams.delete('customerName');
    url.searchParams.delete('customerPhone');
    if (bookingId) url.searchParams.set('highlight', bookingId);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
}

function selectCustomerFromSearch(customer) {
    document.getElementById('selectedCustomerId').value = customer.id;
    document.getElementById('customerName').value = customer.name || '';
    document.getElementById('customerPhone').value = customer.phone || '';
    document.getElementById('customerInstagram').value = customer.instagram || '';
    document.getElementById('customerChildName').value = customer.childName || '';
    document.getElementById('customerChildBirthday').value = customer.childBirthday ? customer.childBirthday.split('T')[0] : '';
    document.getElementById('customerSource').value = customer.source || '';
    document.getElementById('customerSearch').value = customer.name || '';
    rememberSelectedCustomerSnapshot(customer);
    document.getElementById('customerSearchResults')?.classList.add('hidden');
    document.getElementById('bookingCustomerDuplicateHint')?.classList.add('hidden');
    renderSelectedCustomerCard(customer);
    renderBookingCustomerSearchState('');
    setBookingClientMode('existing');

    // Show visit badge
    if (customer.totalBookings > 0) {
        const info = document.getElementById('customerInfo');
        const badge = document.getElementById('customerVisitBadge');
        if (info && badge) {
            badge.textContent = `${customer.totalBookings} візит${customer.totalBookings === 1 ? '' : customer.totalBookings < 5 ? 'и' : 'ів'}`;
            info.classList.remove('hidden');
        }
    }
    renderBookingPackageSummary();
    if (window.BookingForm) BookingForm._dirty = true;
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
    document.getElementById('bookingCreateCustomerBtn')?.addEventListener('click', () => {
        if (BookingDrawerState.clientMode === 'new') {
            setBookingClientMode('search');
            renderBookingCustomerSearchState('');
            return;
        }
        clearSelectedCustomerLink();
        setBookingClientMode('new', { focusNewForm: true });
        renderBookingPackageSummary();
        if (window.BookingForm) BookingForm._dirty = true;
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
        clearSelectedCustomerLinkIfEdited(e.target);
        const q = e.target.value.trim();
        if (q.length < 2) {
            document.getElementById('customerSearchResults')?.classList.add('hidden');
            renderBookingCustomerSearchState('');
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
        const requestedCapacity = parseInt(document.getElementById('kidsCountInput')?.value || '', 10);
        if (Number.isFinite(requestedCapacity) && requestedCapacity > 0) {
            const separator = freeRoomsPath.includes('?') ? '&' : '?';
            freeRoomsPath = `${freeRoomsPath}${separator}capacity=${encodeURIComponent(String(requestedCapacity))}`;
        }
        const response = await fetch(`${API_BASE}${freeRoomsPath}`, {
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return;
        const data = await response.json();

        if (Array.isArray(data.resources)) {
            const freeResources = data.resources.filter(resource => !resource.occupied && resource.capacityAvailable !== false);
            const occupiedResources = data.resources.filter(resource => resource.occupied);
            const overCapacityResources = data.resources.filter(resource => !resource.occupied && resource.capacityAvailable === false);
            const freeHtml = freeResources.map(resource => {
                const capacity = parseInt(resource.capacity, 10);
                const capacityLabel = Number.isFinite(capacity) && capacity > 0
                    ? `<small>до ${capacity} місць</small>`
                    : '';
                return `<button type="button" class="free-room-chip" data-free-room="${escapeHtml(resource.name)}"><span>${escapeHtml(resource.name)}</span>${capacityLabel}</button>`;
            }).join('');
            const occupiedHtml = occupiedResources.length > 0
                ? `<div class="occupied-rooms">Зайняті: ${occupiedResources.map(r => escapeHtml(r.name)).join(', ')}</div>`
                : '';
            const overCapacityHtml = overCapacityResources.length > 0
                ? `<div class="occupied-rooms">Мала місткість: ${overCapacityResources.map(r => {
                    const capacity = parseInt(r.capacity, 10);
                    return `${escapeHtml(r.name)}${Number.isFinite(capacity) && capacity > 0 ? ` (${capacity})` : ''}`;
                }).join(', ')}</div>`
                : '';
            panel.innerHTML = freeHtml || '<span class="no-free-rooms">Немає доступних ресурсів на цей час</span>';
            panel.innerHTML += occupiedHtml + overCapacityHtml;
        } else if (data.free && data.free.length > 0) {
            panel.innerHTML = data.free.map(room =>
                `<button type="button" class="free-room-chip" data-free-room="${escapeHtml(room)}"><span>${escapeHtml(room)}</span></button>`
            ).join('') +
            (data.occupied.length > 0 ? `<div class="occupied-rooms">Зайняті: ${data.occupied.map(r => escapeHtml(r)).join(', ')}</div>` : '');
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
    try {
        var r = await fetch('/api/chat/booking-channel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ bookingId: bookingId })
        });
        var data = await r.json();
        if (data.success && data.channel) {
            const chatUrl = '/chat.html?channelId=' + encodeURIComponent(data.channel.id);
            if (typeof openSafeNewTab === 'function') openSafeNewTab(chatUrl);
            else window.open(chatUrl, '_blank', 'noopener,noreferrer');
        } else {
            if (typeof showToast === 'function') showToast('Не вдалось відкрити чат', 'error');
        }
    } catch (e) { console.error('openBookingChat:', e); }
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
    document.getElementById('bookingPanel')?.classList.remove('booking-panel--maysternya', 'booking-panel--minimal-timeline', 'booking-panel--education-timeline');
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
    return true;
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

function renderSelectedProgramSummary(program = null) {
    const details = document.getElementById('programDetails');
    const empty = document.getElementById('programDetailsEmpty');
    if (!details) return;
    if (!program) {
        if (empty) empty.classList.remove('hidden');
        ['detailDuration', 'detailHosts', 'detailPrice', 'detailAge', 'detailKids'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '—';
        });
        return;
    }
    if (empty) empty.classList.add('hidden');
}

async function renderProgramIcons() {
    const container = document.getElementById('programsIcons');

    // v7.0: Load products from API (with fallback to PROGRAMS)
    // Don't clear DOM until data is ready — prevents blank flash
    const allProducts = await getProducts();

    // Cache: skip rebuild if products haven't changed
    const hash = allProducts.length + ':' + allProducts
        .map(p => [p.id, p.label, p.name, p.duration, p.price, p.hosts, p.isActive, p.updatedAt || ''].join('|'))
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
            icon.dataset.programId = p.id;
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
            icon.setAttribute('aria-pressed', 'false');
            icon.setAttribute('aria-label', `Обрати програму ${cardName}${p.duration ? `, ${p.duration} хв` : ''}`);
            icon.innerHTML = `
                ${durationBadge}
                <span class="icon-circle"><span class="icon">${_escB(p.icon)}</span></span>
                <span class="name">${_escB(cardName)}</span>
            `;
            icon.addEventListener('click', () => selectProgram(p.id));
            grid.appendChild(icon);
        });
        container.appendChild(grid);
    });

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
    const program = getProductsSync().find(p => p.id === programId);
    if (!program) return;
    if (!getBookingWorkspaceHasEvent()) setBookingWorkspaceHasEvent(true, { markDirty: true });

    document.querySelectorAll('.program-icon').forEach(i => {
        i.classList.remove('selected');
        i.setAttribute('aria-pressed', 'false');
    });
    const selectedEl = document.querySelector(`[data-program-id="${programId}"]`);
    if (selectedEl) {
        selectedEl.classList.add('selected');
        selectedEl.setAttribute('aria-pressed', 'true');
    }
    document.getElementById('selectedProgram').value = programId;

    const priceText = program.perChild ? `${formatPrice(program.price)}/дит` : formatPrice(program.price);
    document.getElementById('detailDuration').textContent = program.duration > 0 ? `${program.duration} хв` : '—';
    document.getElementById('detailHosts').textContent = program.hosts;
    document.getElementById('detailPrice').textContent = priceText;

    const ageEl = document.getElementById('detailAge');
    const kidsEl = document.getElementById('detailKids');
    if (ageEl) ageEl.textContent = program.age || '—';
    if (kidsEl) kidsEl.textContent = program.kids || '—';

    renderSelectedProgramSummary(program);

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

async function populateAnimatorSelectById(selectId, placeholder) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const lines = await getLinesForDate(AppState.selectedDate);
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

function getBookingFormData() {
    const maysternyaMode = isMaysternyaBookingContext();
    const selectedProgramId = document.getElementById('selectedProgram')?.value || '';
    const hasExplicitProgram = Boolean(selectedProgramId);
    const hasEvent = maysternyaMode ? true : (getBookingWorkspaceHasEvent() || hasExplicitProgram);
    const kitchenEnabled = isBookingKitchenEnabled();
    const leadDetailsEnabled = isBookingLeadDetailsEnabled();
    const programId = hasEvent ? selectedProgramId : '';
    const room = document.getElementById('roomSelect')?.value || '';
    const effectiveRoom = maysternyaMode ? (room || MAYSTERNYA_ONLINE_ROOM) : room;
    const program = programId ? getProductsSync().find(p => p.id === programId) : null;
    const time = document.getElementById('bookingTime')?.value;
    const lineId = document.getElementById('bookingLine')?.value;

    let duration = program ? program.duration : 0;
    let label = program ? program.label : '';
    if (isEducationTimelineBookingMode() && !program) {
        duration = parseInt(document.getElementById('customDuration')?.value, 10) || 60;
        label = document.getElementById('educationLessonTitle')?.value?.trim() || 'Заняття';
    }

    if (program && program.isCustom) {
        duration = parseInt(document.getElementById('customDuration')?.value) || 30;
        const customName = document.getElementById('customName')?.value || 'Інше';
        label = `${customName}(${duration})`;
    }

    let pinataFiller = '';
    const pinataMode = program && isPinataProgram(program) ? getPinataModeValue() : 'none';
    const pinataNumber = pinataMode !== 'none'
        ? (document.getElementById('pinataNumber')?.value?.trim() || null)
        : null;
    const pinataFillerNumber = pinataMode !== 'none'
        ? (document.getElementById('pinataFillerNumber')?.value?.trim() || null)
        : null;
    let clientPinataServicePrice = null;
    let clientPinataServiceNote = null;
    if (program && program.hasFiller && pinataMode === 'park') {
        pinataFiller = document.getElementById('pinataFillerSelect')?.value;
        if (pinataFiller) label = `Пін+${pinataFiller}`;
    } else if (program && pinataMode === 'client') {
        clientPinataServicePrice = document.getElementById('clientPinataServicePrice')?.value || null;
        clientPinataServiceNote = document.getElementById('clientPinataServiceNote')?.value?.trim() || null;
        label = 'Клієнтська піньята';
    }

    const secondAnimator = program && program.hosts > 1
        ? document.getElementById('secondAnimatorSelect')?.value : null;

    const packageTotals = getBookingPackageTotals(program);
    const menuPositions = kitchenEnabled ? packageTotals.menuPositions : [];
    const leadDetails = leadDetailsEnabled ? getBookingLeadDetails() : {};
    const scenario = getBookingWorkspaceScenario({ hasEvent, positions: menuPositions, hasKitchen: kitchenEnabled });
    const baseFormData = {
        hasEvent, kitchenEnabled, leadDetailsEnabled, scenario, leadDetails,
        programId, room: effectiveRoom, program, time, lineId, duration, label,
        maysternyaMode,
        pinataMode, pinataNumber, pinataFillerNumber, pinataFiller, clientPinataServicePrice, clientPinataServiceNote,
        secondAnimator,
        menuPositions,
        programBasePrice: packageTotals.programBasePrice,
        positionsSubtotal: kitchenEnabled ? packageTotals.positionsSubtotal : 0,
        finalTotal: kitchenEnabled ? packageTotals.finalTotal : packageTotals.programBasePrice
    };
    baseFormData.educationLesson = getEducationLessonDetails(baseFormData);

    return baseFormData;
}

async function validateBookingConflicts(lineId, time, duration, program, secondAnimator, excludeId = null) {
    delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
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
        const lines = await getLinesForDate(AppState.selectedDate);
        const secondCandidate = selectedAnimatorLineCandidate('secondAnimatorSelect', secondAnimator);
        const secondLine = lines.find(l => l.name === secondAnimator)
            || lines.find(l => String(l.id) === String(secondCandidate?.id || ''))
            || secondCandidate;
        if (secondLine) {
            // v5.5: При редагуванні виключити linked бронювання цього ж запису
            const allBookings = excludeId ? await getBookingsForDate(AppState.selectedDate) : [];
            const linkedId = allBookings.find(b => b.linkedTo === excludeId && b.lineId === secondLine.id)?.id || null;
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

async function checkDuplicateProgram(programId, program, time, duration, excludeId = null) {
    if (!programId || !program) return true;
    // v43.10.0: skip duplicate check for animation extras AND custom "Інше" programs.
    // Two custom bookings (e.g. аквагрим + фотозона) share programId='custom' but
    // are conceptually different — must not block each other.
    if (program.category === 'animation' || program.category === 'custom' || program.isCustom || programId === 'anim_extra' || programId === 'custom') return true;

    const allBookings = await getBookingsForDate(AppState.selectedDate);
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;

    const duplicate = allBookings.find(b => {
        if (b.id === excludeId) return false;
        if (b.programId !== programId) return false;
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
    const positions = formData.menuPositions || [];
    return {
        schemaVersion: BOOKING_WORKSPACE_SCHEMA_VERSION,
        hasEvent: !!formData.hasEvent,
        scenario: formData.scenario || getBookingWorkspaceScenario({ hasEvent: !!formData.hasEvent, positions }),
        leadDetails: formData.leadDetails || getBookingLeadDetails(),
        kitchen: {
            itemsCount: positions.length,
            menuCount: positions.filter(item => item.kitchenType !== 'cake').length,
            cakeCount: positions.filter(item => item.kitchenType === 'cake').length,
            positionsSubtotal: formData.positionsSubtotal || 0
        },
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
    const servicePrice = Number(formData.clientPinataServicePrice || 0);
    const baseProgramPrice = hasEvent && hasCatalogProgram
        ? (formData.pinataMode === 'client'
            ? servicePrice
            : (formData.pinataMode === 'none' && isPinataProgram(program)
                ? 0
                : (program.perChild && kidsCount > 0 ? program.price * kidsCount : program.price)))
        : 0;
    const finalPrice = formData.finalTotal ?? toBookingMoney(baseProgramPrice + (formData.positionsSubtotal || 0));
    const extraData = buildExtraData(hasCatalogProgram ? formData.programId : null) || {};
    const noEventLabel = getNoEventBookingLabel(formData);
    const noEventName = getNoEventProgramName(formData);

    const obj = {
        date: formatDate(AppState.selectedDate),
        time: formData.time,
        lineId: formData.lineId,
        programId: hasCatalogProgram ? formData.programId : null,
        programCode: hasCatalogProgram ? program.code : (isEducationLessonBooking ? 'LESSON' : (formData.scenario === 'kitchen_only' ? 'KITCHEN' : 'LEAD')),
        label: hasEvent ? formData.label : noEventLabel,
        programName: hasCatalogProgram ? (program.isCustom ? (document.getElementById('customName')?.value || 'Інше') : program.name) : (isEducationLessonBooking ? (formData.educationLesson.title || 'Заняття') : noEventName),
        category: hasCatalogProgram ? program.category : (isEducationLessonBooking ? 'education' : 'custom'),
        duration: hasEvent ? formData.duration : 0,
        price: finalPrice,
        hosts: hasCatalogProgram ? program.hosts : (isEducationLessonBooking ? 1 : 0),
        secondAnimator: hasEvent ? formData.secondAnimator : null,
        pinataMode: hasCatalogProgram ? formData.pinataMode : 'none',
        pinataNumber: hasCatalogProgram && formData.pinataMode !== 'none' ? formData.pinataNumber : null,
        pinataFillerNumber: hasCatalogProgram && formData.pinataMode !== 'none' ? formData.pinataFillerNumber : null,
        pinataFiller: hasCatalogProgram ? formData.pinataFiller : null,
        clientPinataServicePrice: hasCatalogProgram && formData.pinataMode === 'client' ? finalPrice : null,
        clientPinataServiceNote: hasCatalogProgram && formData.pinataMode === 'client' ? formData.clientPinataServiceNote : null,
        costume: costume,
        room: formData.room,
        notes: document.getElementById('bookingNotes')?.value,
        createdBy: AppState.currentUser ? AppState.currentUser.username : '',
        createdAt: new Date().toISOString(),
        status: status,
        kidsCount: kidsCount || null,
        groupName: document.getElementById('bookingGroupName')?.value.trim() || null,
        programBasePrice: toBookingMoney(baseProgramPrice),
        menuPositions: formData.menuPositions || [],
        extraData,
        skipNotification: document.getElementById('skipNotificationToggle')?.checked || false,
        paymentMethod: document.getElementById('bookingPaymentMethod')?.value || null
    };

    // v33.3: Include tags in extraData
    const selectedTags = Array.from(document.querySelectorAll('.booking-tag-option.active')).map(t => t.dataset.value);
    if (selectedTags.length > 0) {
        if (!obj.extraData) obj.extraData = {};
        obj.extraData.tags = selectedTags;
    }

    obj.banquetGuests = formData.kitchenEnabled ? (parseInt(document.getElementById('banquetGuests')?.value) || null) : null;
    obj.banquetTables = formData.kitchenEnabled ? (parseInt(document.getElementById('banquetTables')?.value) || null) : null;
    obj.banquetMenu = formData.kitchenEnabled
        ? (document.getElementById('banquetMenu')?.value?.trim()
            || bookingMenuPositionsToLegacyText(formData.menuPositions || [])
            || null)
        : null;

    if (!obj.extraData) obj.extraData = {};
    obj.extraData.bookingPackage = {
        schemaVersion: 1,
        programBasePrice: obj.programBasePrice,
        positionsSubtotal: formData.positionsSubtotal || 0,
        finalTotal: obj.price,
        menuPositions: formData.menuPositions || [],
        source: 'booking_workspace'
    };
    obj.extraData.bookingWorkspace = buildBookingWorkspaceExtraData(formData);

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
        obj.room = MAYSTERNYA_ONLINE_ROOM;
        obj.hosts = hasEvent ? (program.hosts || 1) : 1;
        obj.kidsCount = null;
        obj.costume = null;
        obj.secondAnimator = null;
        obj.banquetGuests = null;
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
            source: 'maysternya_compact_booking'
        };
    }

    // v15.1+: CRM customer is a first-class booking package field.
    const existingId = document.getElementById('selectedCustomerId')?.value;
    if (existingId) {
        obj.customerId = parseInt(existingId);
    } else {
        const customerName = document.getElementById('customerName')?.value?.trim();
        if (customerName) {
            obj.customer = {
                name: customerName,
                phone: document.getElementById('customerPhone')?.value?.trim() || null,
                instagram: document.getElementById('customerInstagram')?.value?.trim() || null,
                childName: document.getElementById('customerChildName')?.value?.trim() || null,
                childBirthday: document.getElementById('customerChildBirthday')?.value || null,
                source: document.getElementById('customerSource')?.value || null
            };
        }
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
    const resourceBlock = {
        mode: 'resource_blackout',
        resourceBlocked: true,
        resourceId: document.getElementById('bookingLine')?.value || null,
        resourceType: line?.resourceType || presentation.resourceType || null,
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
        programBasePrice: 0,
        menuPositions: [],
        extraData: {
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
        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
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
    if (program.hosts > 1 && booking.secondAnimator) {
        const secondCandidate = selectedAnimatorLineCandidate('secondAnimatorSelect', booking.secondAnimator);
        const secondLine = lines.find(l => l.name === booking.secondAnimator)
            || lines.find(l => String(l.id) === String(secondCandidate?.id || ''))
            || secondCandidate;
        if (secondLine) {
            linked.push({
                date: booking.date, time: booking.time, lineId: secondLine.id,
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
    return collectCreatedBookingRecords(createResult).length > 0;
}

async function handleBookingSubmit(e) {
    e.preventDefault();

    const submitBtn = document.getElementById('bookingSubmitBtn');
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
        const bookingDateTime = new Date(`${formatDate(AppState.selectedDate)}T${formData.time}:00`);
        if (bookingDateTime < new Date()) {
            showNotification('Неможливо створити бронювання в минулому. Оберіть майбутній час.', 'error');
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

        if (AppState.editingBookingId) {
            // ===== РЕЖИМ РЕДАГУВАННЯ (v5.5) =====
            booking.id = AppState.editingBookingId;

            // Зберегти оригінального автора
            const oldBookings = await getBookingsForDate(AppState.selectedDate);
            const oldBooking = oldBookings.find(b => b.id === booking.id);
            if (oldBooking) {
                booking.createdBy = oldBooking.createdBy;
                booking.createdAt = oldBooking.createdAt;
                // v8.3.2: Don't restore old extraData — respect user's choice to clear sizes
            }

            const updateResult = await apiUpdateBooking(booking.id, booking);
            if (updateResult && updateResult.success === false) {
                // Optimistic locking: check if it's a version conflict
                if (updateResult.conflict) {
                    await handleOptimisticLockConflict(updateResult, booking);
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

            delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
            closeBookingPanel(true);
            unlockSubmitBtn();
            await renderTimeline();
            showNotification('Бронювання оновлено!', 'success');
        } else {
            // ===== РЕЖИМ СТВОРЕННЯ (v5.7: transactional with linked) =====
            let createResult;

            if (shouldCreateEducationLessonSeries(booking)) {
                createResult = await apiCreateEducationLessonSeries(booking);
            } else {
                const linked = await buildLinkedBookings(booking, formData.program);
                if (linked.length > 0) {
                    createResult = await apiCreateBookingFull(booking, linked);
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

            const changedDates = new Set(createdBookings.map(item => item.date || formatDate(AppState.selectedDate)));
            changedDates.add(formatDate(AppState.selectedDate));
            changedDates.forEach(date => { delete AppState.cachedBookings[date]; });
            closeBookingPanel(true);
            unlockSubmitBtn();
            clearLeadConversionContextAfterBooking(booking.id);
            await renderTimeline();
            const seriesCount = createResult?.createdCount || createdBookings.length;
            showNotification(seriesCount > 1 ? `Створено серію занять: ${seriesCount}` : 'Бронювання створено!', 'success');
        }
    } catch (error) {
        handleError('Збереження бронювання', error);
        unlockSubmitBtn();
    }
}

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
            delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
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
        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
        await renderTimeline();
        // Re-open editing with fresh data
        await editBooking(localBooking.id);
        showNotification('Дані оновлено з сервера', 'info');
    }
}

async function checkConflicts(lineId, time, duration, excludeId = null) {
    const allBookings = await getBookingsForDate(AppState.selectedDate);
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

// v8.6.1: Generate unique gradient for each booking based on its ID
function generateBookingHeaderGradient(booking) {
    const str = String(booking.id || '') + (booking.programName || '') + (booking.time || '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    const hue1 = Math.abs(hash % 360);
    const hue2 = (hue1 + 40 + Math.abs((hash >> 8) % 30)) % 360;
    const angle = Math.abs((hash >> 16) % 180);
    return `linear-gradient(${angle}deg, hsl(${hue1}, 70%, 45%), hsl(${hue2}, 65%, 40%))`;
}

// v8.6.1: Category icon mapping
function getCategoryIcon(category) {
    const icons = {
        quest: '🗝️', animation: '🎭', show: '🎪',
        photo: '📸', masterclass: '🎨', pinata: '🪅', custom: '⭐'
    };
    return icons[category] || '📋';
}

function renderBookingBanquetLinksDetail(booking, allBookings = []) {
    const links = Array.isArray(booking?.banquetLinks) ? booking.banquetLinks : [];
    if (!links.length) return '';
    const byId = new Map((allBookings || []).map(item => [String(item.id), item]));
    const rows = links.map(link => {
        const targetId = String(link.targetId || '');
        const target = byId.get(targetId);
        const targetLabel = target
            ? `${target.time || ''} ${target.label || target.programCode || target.id}`.trim()
            : targetId;
        const unlinkAction = isViewer() ? '' : `
            <button type="button"
                    class="booking-banquet-unlink-btn"
                    onclick="removeBookingBanquetLink('${escapeHtml(String(booking.id))}', '${escapeHtml(targetId)}')">
                Прибрати
            </button>`;
        return `
            <div class="booking-banquet-link-chip">
                <span class="booking-banquet-link-mark">в†”</span>
                <span class="booking-banquet-link-target">${escapeHtml(targetLabel)}</span>
                ${unlinkAction}
            </div>`;
    }).join('');
    return `
        <div class="booking-banquet-links-detail">
            <div class="booking-banquet-links-title">Банкетні звʼязки</div>
            <div class="booking-banquet-links-list">${rows}</div>
        </div>`;
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
    const seriesActions = lesson.seriesId && Number(lesson.seriesSize || 0) > 1 && !isViewer()
        ? `<div class="booking-detail-row"><span class="label">Керування серією:</span><span class="value"><button type="button" class="btn-secondary btn-sm" onclick="openEducationSeriesManager('${escapeHtml(String(lesson.seriesId))}', '${escapeHtml(String(booking.id))}')">Відкрити серію</button></span></div>`
        : '';
    return `
        <div class="booking-lesson-detail">
            <div class="booking-lesson-detail-title">Навчальний запис</div>
            ${rows.map(([label, value]) => `<div class="booking-detail-row"><span class="label">${escapeHtml(label)}:</span><span class="value">${escapeHtml(value)}</span></div>`).join('')}
            ${seriesActions}
        </div>`;
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
        const actions = isViewer() ? '' : `
            <div class="booking-actions modal-footer-sticky">
                <button onclick="deleteBooking('${escapeHtml(booking.id)}')" class="btn-delete-booking">Відкрити слот</button>
            </div>
        `;
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
            ${booking.notes ? `<div class="booking-detail-row"><span class="label">Коментар:</span><span class="value">${escapeHtml(booking.notes)}</span></div>` : ''}
            ${actions}
        `;
        document.getElementById('bookingModal')?.classList.remove('hidden');
        return;
    }

    const program = getProductsSync().find(p => p.id === booking.programId);
    const lesson = educationLessonDetailsFromBooking(booking);
    const isEducationBooking = Boolean(lesson && Object.keys(lesson).length);
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
    const lineSwitchHtml = otherLines.length > 0 ? `
        <div class="booking-line-switch">
            <span class="label">Перемістити на лінію:</span>
            <div class="line-switch-buttons">
                ${otherLines.map(l => `<button onclick="switchBookingLine('${escapeHtml(booking.id)}', '${escapeHtml(l.id)}')" style="border-color: ${escapeHtml(l.color)}; color: ${escapeHtml(l.color)}">${escapeHtml(l.name)}</button>`).join('')}
            </div>
        </div>` : '';

    const editControls = isViewer() ? '' : `
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
        ${lineSwitchHtml}
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
        <div class="booking-actions modal-footer-sticky">
            <button onclick="editBooking('${escapeHtml(booking.id)}')" class="btn-edit-booking">✏️ Редагувати</button>
            <button onclick="duplicateBooking('${escapeHtml(booking.id)}')" class="btn-duplicate-booking">📋 Повторити</button>
            <button onclick="showRecurringModal('${escapeHtml(booking.id)}')" class="btn-recurring-booking">🔄 Повторюване</button>
            <button onclick="openBookingChat('${escapeHtml(booking.id)}')" class="btn-secondary btn-sm">💬 Чат команди</button>
            <button onclick="deleteBooking('${escapeHtml(booking.id)}')" class="btn-delete-booking">Видалити</button>
        </div>
    `;

    // v8.6.1: Generate unique header color based on booking ID
    const headerGradient = generateBookingHeaderGradient(booking);
    const categoryIcon = getCategoryIcon(booking.category);
    const uniqueCode = booking.id ? String(booking.id).slice(-4).toUpperCase() : '----';

    document.getElementById('bookingDetails').innerHTML = `
        <div class="booking-detail-header booking-detail-header--unique" style="background:${headerGradient};color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;margin:-20px -20px 16px -20px;">
            <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:28px;">${categoryIcon}</span>
                <div>
                    <h3 style="margin:0;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.3);">${escapeHtml(booking.label || booking.programCode)}: ${escapeHtml(booking.programName)}</h3>
                    <p style="margin:4px 0 0;opacity:0.9;font-size:13px;">${escapeHtml(booking.room)}${booking.category ? ' · ' + escapeHtml(CATEGORY_NAMES[booking.category] || booking.category) : ''} · #${escapeHtml(uniqueCode)}</p>
                </div>
            </div>
        </div>
        <div class="booking-detail-row booking-detail-row--copyable" data-copy="${escapeHtml(booking.date)}">
            <span class="label">Дата:</span>
            <span class="value">${escapeHtml(booking.date)}</span>
            <button type="button" class="detail-copy-btn" title="Скопіювати">📋</button>
        </div>
        <div class="booking-detail-row booking-detail-row--copyable" data-copy="${escapeHtml(booking.time)} - ${escapeHtml(endTime)}">
            <span class="label">Час:</span>
            <span class="value">${escapeHtml(booking.time)} - ${escapeHtml(endTime)}</span>
            <button type="button" class="detail-copy-btn" title="Скопіювати">📋</button>
        </div>
        <div class="booking-detail-row booking-detail-row--copyable" data-copy="${escapeHtml(line ? line.name : '-')}">
            <span class="label">${lineRoleLabel}:</span>
            <span class="value">${escapeHtml(line ? line.name : '-')}</span>
            <button type="button" class="detail-copy-btn" title="Скопіювати">📋</button>
        </div>
        <div class="booking-detail-row">
            <span class="label">Ведучих:</span>
            <span class="value">${escapeHtml(String(booking.hosts))}${booking.secondAnimator ? ` (+ ${escapeHtml(booking.secondAnimator)})` : ''}</span>
        </div>
        ${booking.costume ? `<div class="booking-detail-row"><span class="label">Костюм:</span><span class="value">${escapeHtml(booking.costume)}</span></div>` : ''}
        ${renderPinataDetailRows(booking)}
        <div class="booking-detail-row booking-detail-row--copyable" data-copy="${escapeHtml(formatPrice(booking.price))}">
            <span class="label">Ціна:</span>
            <span class="value">${escapeHtml(formatPrice(booking.price))}</span>
            <button type="button" class="detail-copy-btn" title="Скопіювати">📋</button>
        </div>
        ${renderEducationLessonDetail(booking)}
        ${renderBookingWorkspaceDetail(booking)}
        ${renderBookingPackageDetail(booking)}
        ${booking.kidsCount ? `<div class="booking-detail-row"><span class="label">${isEducationBooking ? 'Учнів' : 'Дітей'}:</span><span class="value">${escapeHtml(String(booking.kidsCount))}</span></div>` : ''}
        <div class="booking-detail-row">
            <span class="label">Статус:</span>
            <span class="status-badge status-badge--${booking.status === 'preliminary' ? 'preliminary' : 'confirmed'}">${booking.status === 'preliminary' ? '⏳ Попереднє' : '✅ Підтверджене'}</span>
        </div>
        ${booking.notes ? `<div class="booking-detail-row booking-detail-row--copyable" data-copy="${escapeHtml(booking.notes)}"><span class="label">Примітки:</span><span class="value">${escapeHtml(booking.notes)}</span><button type="button" class="detail-copy-btn" title="Скопіювати">📋</button></div>` : ''}
        ${booking.groupName ? `<div class="booking-detail-row"><span class="label">Група:</span><span class="value">🎪 ${escapeHtml(booking.groupName)}</span></div>` : ''}
        ${renderBookingBanquetLinksDetail(booking, bookings)}
        <div id="bookingCustomerBlock"></div>
        ${booking.updatedAt ? `<div class="booking-detail-row"><span class="label">Оновлено:</span><span class="value">${new Date(booking.updatedAt).toLocaleString('uk-UA')}</span></div>` : ''}
        <div class="booking-detail-row booking-detail-row--summary" data-copy="${escapeHtml(booking.date)} ${escapeHtml(booking.time)}-${escapeHtml(endTime)} ${escapeHtml(booking.programName)} ${escapeHtml(booking.room)} ${escapeHtml(line ? line.name : '')} ${escapeHtml(formatPrice(booking.price))}">
            <button type="button" class="detail-copy-summary-btn" title="Скопіювати всю інформацію">📋 Скопіювати все</button>
        </div>
        ${descriptionHtml}
        ${!isViewer() ? `<div class="status-toggle-section">
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
    const summaryBtn = document.querySelector('.detail-copy-summary-btn');
    if (summaryBtn) {
        summaryBtn.addEventListener('click', function() {
            const text = this.closest('[data-copy]')?.dataset.copy;
            if (text) {
                navigator.clipboard.writeText(text);
                this.textContent = '✓ Скопійовано';
                setTimeout(() => this.textContent = '📋 Скопіювати все', 800);
            }
        });
    }

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

// ==========================================
// РЕДАГУВАННЯ БРОНЮВАННЯ (v5.5)
// ==========================================

async function editBooking(bookingId) {
    const bookings = await getBookingsForDate(AppState.selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    closeAllModals();

    // Встановити режим редагування
    AppState.editingBookingId = bookingId;
    // Store updatedAt for optimistic locking
    AppState.editingBookingUpdatedAt = booking.updatedAt || null;

    // Відкрити панель з даними бронювання
    await openBookingPanel(booking.time, booking.lineId);

    // Змінити заголовок і кнопку
    const editH3 = document.querySelector('#bookingPanel .panel-header h3');
    const editBtn = document.querySelector('#bookingForm .btn-submit');
    if (editH3) editH3.textContent = 'Редагувати бронювання';
    if (editBtn) editBtn.textContent = 'Зберегти зміни';
    hydrateBookingWorkspace(booking);

    // Заповнити форму
    document.getElementById('roomSelect').value = booking.room || '';
    document.getElementById('costumeSelect').value = booking.costume || '';
    document.getElementById('bookingNotes').value = booking.notes || '';
    const groupEditInput = document.getElementById('bookingGroupName');
    if (groupEditInput) groupEditInput.value = booking.groupName || '';
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
            if (pinataNumberInput) pinataNumberInput.value = booking.pinataNumber || '';
            if (pinataFillerNumberInput) pinataFillerNumberInput.value = booking.pinataFillerNumber || '';
            if (mode === 'park' && booking.pinataFiller) {
                document.getElementById('pinataFillerSelect').value = booking.pinataFiller;
            }
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

    // v15.1: CRM — populate customer data if linked
    if (booking.customerId) {
        const customerToggle = document.getElementById('customerDataToggle');
        if (customerToggle) {
            customerToggle.checked = true;
            document.getElementById('customerDataSection')?.classList.remove('hidden');
        }
        document.getElementById('selectedCustomerId').value = booking.customerId;
        // Load customer data from API
        apiGetCustomer(booking.customerId).then(customer => {
            if (customer) {
                document.getElementById('customerName').value = customer.name || '';
                document.getElementById('customerPhone').value = customer.phone || '';
                document.getElementById('customerInstagram').value = customer.instagram || '';
                document.getElementById('customerChildName').value = customer.childName || '';
                document.getElementById('customerChildBirthday').value = customer.childBirthday ? customer.childBirthday.split('T')[0] : '';
                document.getElementById('customerSource').value = customer.source || '';
                document.getElementById('customerSearch').value = customer.name || '';
                if (customer.totalBookings > 0) {
                    const info = document.getElementById('customerInfo');
                    const badge = document.getElementById('customerVisitBadge');
                    if (info && badge) {
                        badge.textContent = `${customer.totalBookings} візит${customer.totalBookings === 1 ? '' : customer.totalBookings < 5 ? 'и' : 'ів'}`;
                        info.classList.remove('hidden');
                    }
                }
            }
        });
    }
    hydrateBookingPackageWorkspace(booking);

    // Статус
    const statusRadio = document.querySelector(`input[name="bookingStatus"][value="${booking.status || 'confirmed'}"]`);
    if (statusRadio) statusRadio.checked = true;

    // Другий аніматор
    if (booking.secondAnimator) {
        await populateSecondAnimatorSelect();
        await resolveSecondAnimatorSelect(booking.secondAnimator, booking.id);
    }
}

// ==========================================
// DUPLICATE BOOKING (v5.50)
// ==========================================

async function duplicateBooking(bookingId) {
    const bookings = await getBookingsForDate(AppState.selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    closeAllModals();

    // НЕ встановлюємо editingBookingId — це створення нового
    AppState.editingBookingId = null;

    await openBookingPanel(booking.time, booking.lineId);

    // Заголовок для дублювання
    const dupH3 = document.querySelector('#bookingPanel .panel-header h3');
    if (dupH3) dupH3.textContent = 'Повторити бронювання';
    document.querySelector('#bookingForm .btn-submit').textContent = 'Створити копію';
    hydrateBookingWorkspace(booking);

    // Pre-fill форму (ідентично editBooking)
    document.getElementById('roomSelect').value = booking.room || '';
    document.getElementById('costumeSelect').value = booking.costume || '';
    document.getElementById('bookingNotes').value = booking.notes || '';
    const groupInput = document.getElementById('bookingGroupName');
    if (groupInput) groupInput.value = booking.groupName || '';
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
            if (pinataNumberInput) pinataNumberInput.value = booking.pinataNumber || '';
            if (pinataFillerNumberInput) pinataFillerNumberInput.value = booking.pinataFillerNumber || '';
            if (mode === 'park' && booking.pinataFiller) {
                document.getElementById('pinataFillerSelect').value = booking.pinataFiller;
            }
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

    if (booking.customerId) {
        document.getElementById('selectedCustomerId').value = booking.customerId;
        apiGetCustomer(booking.customerId).then(customer => {
            if (!customer) return;
            document.getElementById('customerName').value = customer.name || '';
            document.getElementById('customerPhone').value = customer.phone || '';
            document.getElementById('customerInstagram').value = customer.instagram || '';
            document.getElementById('customerChildName').value = customer.childName || '';
            document.getElementById('customerChildBirthday').value = customer.childBirthday ? customer.childBirthday.split('T')[0] : '';
            document.getElementById('customerSource').value = customer.source || '';
            document.getElementById('customerSearch').value = customer.name || '';
            renderBookingPackageSummary();
        });
    }
    hydrateBookingPackageWorkspace(booking);

    const statusRadio = document.querySelector(`input[name="bookingStatus"][value="${booking.status || 'confirmed'}"]`);
    if (statusRadio) statusRadio.checked = true;

    if (booking.secondAnimator) {
        await populateSecondAnimatorSelect();
        await resolveSecondAnimatorSelect(booking.secondAnimator, booking.id);
    }

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
        if (booking.date) delete AppState.cachedBookings[booking.date];
    });
    closeEducationSeriesManager();
    await renderTimeline();
    showNotification(`Скасовано занять: ${result.cancelledCount || 0}`, 'success');
}

async function deleteBooking(bookingId) {
    try {
        const bookings = await getBookingsForDate(AppState.selectedDate);
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

        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
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
        const bookings = await getBookingsForDate(AppState.selectedDate);
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
                delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
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

        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
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
        const bookings = await getBookingsForDate(AppState.selectedDate);
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
                delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
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

        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
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
                notes: booking.notes || null
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
            bar.innerHTML = `
                <span class="bulk-count">${this.selected.size} обрано</span>
                <button onclick="BulkOps.bulkDelete()">🗑 Видалити</button>
                <button onclick="BulkOps.bulkStatus('confirmed')">✅ Підтвердити</button>
                <button onclick="BulkOps.bulkStatus('preliminary')">⏳ Попередні</button>
                <button class="bulk-cancel" onclick="BulkOps.clear()">✕ Скасувати</button>
            `;
        } else if (bar) {
            bar.remove();
        }
    },

    async bulkDelete() {
        if (this._busy) return;
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
        this._busy = true;
        try {
            const ids = Array.from(this.selected);
            for (const id of ids) {
                try {
                    const bookings = await getBookingsForDate(AppState.selectedDate);
                    const b = bookings.find(x => x.id === id);
                    if (b && status === 'confirmed' && b.status === 'preliminary' && typeof apiConfirmBooking === 'function') {
                        await apiConfirmBooking(id, { source: 'booking_panel' });
                    } else if (b) {
                        await apiUpdateBooking(id, { ...b, status });
                    }
                } catch (e) { /* continue */ }
            }

            this.clear();
            AppState.cachedBookings = {};
            await renderTimeline();
            showNotification(`Статус змінено для ${ids.length} бронювань`, 'success');
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
        const token = localStorage.getItem('pzp_token');
        const res  = await fetch('/api/warehouse/pinata-status', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!data.success) return;
        const osnovy = data.stock.find(s => s.name.includes('Основи'));
        if (osnovy) {
            badge.textContent = `📦 Основи: ${osnovy.quantity} шт ${osnovy.quantity <= 3 ? '⚠️' : '✅'}`;
            badge.style.display = 'inline-block';
            badge.style.color   = osnovy.quantity <= 3 ? '#ef4444' : 'var(--gray-500)';
        }
    } catch { /* silent */ }
}




