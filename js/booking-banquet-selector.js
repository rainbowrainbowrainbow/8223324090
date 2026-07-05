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
    if (select) {
        const value = String(select.value || '').trim();
        if (value) return value;
        const explicitGroupId = String(BookingDrawerState.explicitBanquetContext?.groupId || '').trim();
        const selectedGroupId = String(BookingDrawerState.selectedBanquetGroupId || '').trim();
        if (explicitGroupId && selectedGroupId && explicitGroupId === selectedGroupId) return selectedGroupId;
        return '';
    }
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
    const explicitContext = BookingDrawerState.explicitBanquetContext
        && groupId
        && String(BookingDrawerState.explicitBanquetContext.groupId || '') === String(groupId || '')
        ? BookingDrawerState.explicitBanquetContext
        : null;
    const realRoomContext = BookingDrawerState.roomSelectionBanquetContext
        && groupId
        && String(BookingDrawerState.roomSelectionBanquetContext.groupId || '') === String(groupId || '')
        ? BookingDrawerState.roomSelectionBanquetContext
        : null;
    const virtualState = !groupId ? bookingBanquetSelectorVirtualState() : null;
    const roomContext = explicitContext || realRoomContext || (virtualState?.valid ? virtualState.context : null);
    return {
        groupId,
        candidate,
        sourceBookingId: candidate?.primaryBookingId || candidate?.primaryBooking?.id || roomContext?.sourceBookingId || null,
        groupName: candidate?.groupName || roomContext?.groupName || null,
        customerId: candidate?.customerId ?? candidate?.primaryBooking?.customerId ?? roomContext?.banquetGroupCustomerId ?? roomContext?.sourceCustomerId ?? null,
        sourceCustomerId: roomContext?.sourceCustomerId ?? null,
        banquetGroupCustomerId: roomContext?.banquetGroupCustomerId ?? candidate?.customerId ?? null,
        source: candidate ? 'booking_banquet_group_selector' : (explicitContext?.source || virtualState?.bridge || (roomContext ? 'room_selection_auto_banquet_context' : 'booking_banquet_group_selector')),
        isExplicitBanquetContext: Boolean(explicitContext),
        isRoomSelectionAuto: Boolean(roomContext),
        isVirtualSourceBridge: Boolean(virtualState?.valid)
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

function activityFirstKitchenSelectorState() {
    const roomContext = BookingDrawerState.roomSelectionBanquetContext;
    if (!roomContext?.sourceBookingId || roomContext.groupId) return null;
    if (!isParkTimelineBookingMode() || !isBookingKitchenEnabled()) return null;
    const sourceBooking = roomContext.sourceBooking || {};
    const base = {
        kind: 'virtual',
        bridge: 'activity_first_kitchen_bridge',
        sourceRole: 'activity',
        targetRole: 'kitchen',
        context: roomContext
    };
    if (!sourceBooking || !roomContext.sourceBookingId) {
        return {
            ...base,
            valid: false,
            error: 'Джерело активності застаріло. Оберіть кімнату ще раз.'
        };
    }
    if (roomBookingIsCancelled(sourceBooking)) {
        return {
            ...base,
            valid: false,
            error: 'Активність у цій кімнаті вже скасована. Оберіть іншу кімнату або оновіть таймлайн.'
        };
    }
    if (roomBookingIsLinkedChild(sourceBooking)) {
        return {
            ...base,
            valid: false,
            error: 'Банкет можна створити тільки з основної активності, не з технічного дубля.'
        };
    }
    const staleReason = bookingRoomSourceContextStaleReason(roomContext);
    if (staleReason) {
        return {
            ...base,
            valid: false,
            error: bookingRoomSourceContextStaleMessage(staleReason)
        };
    }
    const sourceCustomerId = roomContext.sourceCustomerId ?? roomBookingCustomerId(sourceBooking);
    const selectedCustomerId = bookingBanquetGroupSelectedCustomerId();
    if (!sourceCustomerId || !selectedCustomerId || String(sourceCustomerId) !== String(selectedCustomerId)) {
        return {
            ...base,
            valid: false,
            error: 'Клієнт у формі не збігається з клієнтом активності. Оберіть кімнату або клієнта ще раз.'
        };
    }
    return {
        ...base,
        valid: true,
        label: activityFirstKitchenSelectorOptionLabel(roomContext),
        hint: `Банкет буде створено з активності ${roomSelectionBanquetContextLabel(roomContext)} під час збереження кухні.`
    };
}

function activityFirstKitchenSelectorContext() {
    const state = activityFirstKitchenSelectorState();
    return state?.valid ? state.context : null;
}

function activityFirstKitchenSelectorOptionLabel(context = {}) {
    const sourceBooking = context.sourceBooking || {};
    const time = bookingRoomDayBookingTime({ time: context.sourceTime || sourceBooking.time });
    return `Створити банкет з активності${time ? ` ${time}` : ''}`;
}

function kitchenFirstActivitySelectorState() {
    const bridgeContext = BookingDrawerState.roomBookingAnimationBridge;
    if (!bridgeContext?.sourceBookingId || bridgeContext.groupId) return null;
    if (!isParkTimelineBookingMode()) return null;
    const sourceBooking = bridgeContext.sourceBooking || {};
    const sourceCustomerId = bridgeContext.sourceCustomerId ?? roomBookingCustomerId(sourceBooking);
    const context = {
        ...bridgeContext,
        sourceBooking,
        sourceCustomerId,
        source: 'kitchen_first_activity_bridge'
    };
    const base = {
        kind: 'virtual',
        bridge: 'kitchen_first_activity_bridge',
        sourceRole: 'kitchen',
        targetRole: 'activity',
        context
    };
    if (!roomBookingLooksLikeKitchen(sourceBooking)) {
        return {
            ...base,
            valid: false,
            error: 'Джерело не схоже на кухонну бронь. Відкрийте активність з кухонної броні ще раз.'
        };
    }
    if (roomBookingIsCancelled(sourceBooking)) {
        return {
            ...base,
            valid: false,
            error: 'Кухонна бронь уже скасована. Оберіть іншу бронь.'
        };
    }
    if (roomBookingIsLinkedChild(sourceBooking)) {
        return {
            ...base,
            valid: false,
            error: 'Банкет можна створити тільки з основної кухонної броні, не з технічного дубля.'
        };
    }
    const staleReason = bookingRoomSourceContextStaleReason(context);
    if (staleReason) {
        return {
            ...base,
            valid: false,
            error: bookingRoomSourceContextStaleMessage(staleReason)
        };
    }
    const selectedCustomerId = bookingBanquetGroupSelectedCustomerId();
    if (!sourceCustomerId || !selectedCustomerId || String(sourceCustomerId) !== String(selectedCustomerId)) {
        return {
            ...base,
            valid: false,
            error: 'Клієнт у формі не збігається з клієнтом кухонної броні. Оберіть клієнта або відкрийте бронь ще раз.'
        };
    }
    return {
        ...base,
        valid: true,
        label: kitchenFirstActivitySelectorOptionLabel(context),
        hint: `Банкет буде створено з кухні ${roomSelectionBanquetContextLabel(context)} під час збереження активності.`
    };
}

function kitchenFirstActivitySelectorContext() {
    const state = kitchenFirstActivitySelectorState();
    return state?.valid ? state.context : null;
}

function kitchenFirstActivitySelectorOptionLabel(context = {}) {
    const sourceBooking = context.sourceBooking || {};
    const time = bookingRoomDayBookingTime({ time: context.sourceTime || sourceBooking.time });
    return `Створити банкет з кухні${time ? ` ${time}` : ''}`;
}

function bookingBanquetSelectorRealState() {
    const candidates = BookingDrawerState.banquetGroupCandidates || [];
    const fallbackCandidates = BookingDrawerState.banquetGroupFallbackCandidates || [];
    const visibleCandidates = candidates.filter(candidate => candidate.candidateKind === 'customer');
    return {
        kind: 'real',
        candidates,
        visibleCandidates,
        fallbackCandidates,
        hasRealCandidates: visibleCandidates.length > 0
    };
}

function bookingBanquetSelectorVirtualState() {
    const activityState = activityFirstKitchenSelectorState();
    if (activityState) return activityState;
    const kitchenState = kitchenFirstActivitySelectorState();
    if (kitchenState) return kitchenState;
    return null;
}

function bookingBanquetSelectorCanShowVirtual(virtualState, realState, selectedGroupId = '') {
    return Boolean(
        virtualState?.valid
        && !String(selectedGroupId || '').trim()
        && !realState?.hasRealCandidates
    );
}

function bookingBanquetSelectorVirtualInvalidMessage(virtualState, realState, selectedGroupId = '') {
    if (!virtualState || virtualState.valid) return '';
    if (String(selectedGroupId || '').trim()) return '';
    if (realState?.hasRealCandidates) return '';
    return virtualState.error || 'Джерело для автоматичного банкету застаріло. Оберіть кімнату або клієнта ще раз.';
}

function bookingBanquetSelectorSourceMeta() {
    const sourceContext = BookingDrawerState.roomSourceContext
        || BookingDrawerState.roomSelectionBanquetContext?.roomSourceContext
        || BookingDrawerState.roomBookingAnimationBridge?.roomSourceContext
        || null;
    const sourceBookingId = sourceContext?.sourceBookingId
        || BookingDrawerState.roomSelectionBanquetContext?.sourceBookingId
        || BookingDrawerState.roomBookingAnimationBridge?.sourceBookingId
        || '';
    return {
        room: String(document.getElementById('roomSelect')?.value || sourceContext?.room || '').trim(),
        sourceBookingId: String(sourceBookingId || '').trim(),
        drawerMode: normalizeBookingDrawerMode(BookingDrawerState.drawerMode || inferBookingDrawerModeForOpen()),
        contextGeneration: String(sourceContext?.generationId || BookingDrawerState.roomSelectionContextRequestToken || 0)
    };
}

function bookingBanquetGroupCandidatesRefreshKey({ date = '', customerId = '' } = {}) {
    return JSON.stringify({
        date: String(date || '').slice(0, 10),
        customerId: String(customerId || '').trim(),
        ...bookingBanquetSelectorSourceMeta()
    });
}

function clearSelectedBanquetGroupIfCustomerMismatch() {
    const context = selectedBookingBanquetGroupContext();
    if (!selectedBookingBanquetGroupCustomerMismatch(context)) return false;
    BookingDrawerState.selectedBanquetGroupId = '';
    BookingDrawerState.manualBanquetGroupSelection = false;
    renderBookingBanquetGroupSelector();
    return true;
}

function normalizeBookingDrawerMode(mode) {
    const value = String(mode || '').trim();
    return Object.values(BOOKING_DRAWER_MODES).includes(value) ? value : BOOKING_DRAWER_MODES.CREATE_ACTIVITY;
}

function setBookingDrawerMode(mode) {
    BookingDrawerState.drawerMode = normalizeBookingDrawerMode(mode);
    return BookingDrawerState.drawerMode;
}

function inferBookingDrawerModeForOpen() {
    if (AppState.editingBookingId) return BOOKING_DRAWER_MODES.EDIT_BOOKING;
    return isRoomFirstTimelineView() ? BOOKING_DRAWER_MODES.CREATE_KITCHEN : BOOKING_DRAWER_MODES.CREATE_ACTIVITY;
}

function resetBanquetSelectorContext(options = {}) {
    BookingDrawerState.banquetGroupCandidates = [];
    BookingDrawerState.banquetGroupFallbackCandidates = [];
    BookingDrawerState.banquetGroupCandidatesLoading = false;
    BookingDrawerState.banquetGroupCandidatesKey = '';
    BookingDrawerState.selectedBanquetGroupId = '';
    BookingDrawerState.manualBanquetGroupSelection = false;
    BookingDrawerState.explicitBanquetContext = null;
    BookingDrawerState.activeBanquetIntent = null;
    BookingDrawerState.activeBanquetRoleIntent = null;
    BookingDrawerState.standaloneBookingOverride = false;
    if (options.render !== false) renderBookingBanquetGroupSelector();
}

function resetBookingBanquetGroupSelector() {
    resetBanquetSelectorContext();
}

function resetBookingDrawerStateForOpen(mode = inferBookingDrawerModeForOpen()) {
    BookingDrawerState.drawerGenerationId = (Number(BookingDrawerState.drawerGenerationId) || 0) + 1;
    setBookingDrawerMode(mode);
    BookingDrawerState.selectedProgramCategory = 'all';
    BookingDrawerState.selectedActivityProgramIds = [];
    BookingDrawerState.selectedActivityPreflight = {
        status: 'idle',
        message: '',
        lastError: '',
        failedAt: null,
        overrideUsed: false
    };
    BookingDrawerState.validationAttempted = false;
    BookingDrawerState.legacyNotesFallback = false;
    BookingDrawerState.legacyGroupNameFallback = false;
    BookingDrawerState.roomBookingAnimationBridge = null;
    resetBookingRoomSourceContext({ render: false });
    resetBanquetSelectorContext({ render: false });
    return BookingDrawerState.drawerGenerationId;
}

function bookingActiveBanquetContextLabel(context = selectedBookingBanquetGroupContext()) {
    const groupId = String(context?.groupId || BookingDrawerState.explicitBanquetContext?.groupId || '').trim();
    const groupName = context?.groupName || BookingDrawerState.explicitBanquetContext?.groupName || '';
    if (groupName && groupId) return `${groupName} · #${groupId}`;
    if (groupName) return groupName;
    return groupId ? `#${groupId}` : 'банкет не вибрано';
}

function bookingActiveBanquetMetaParts(context = selectedBookingBanquetGroupContext()) {
    const candidate = context?.candidate || {};
    const primary = candidate.primaryBooking || {};
    const explicit = BookingDrawerState.explicitBanquetContext || {};
    return [
        explicit.customerName || explicit.sourceCustomerName || '',
        explicit.targetRoom || explicit.sourceRoom || candidate.room || primary.room || '',
        explicit.date || candidate.date || primary.date || bookingBanquetGroupDateValue() || ''
    ].filter(Boolean);
}

function bookingActiveBanquetRoleIntentLabel(role) {
    switch (String(role || '').trim()) {
        case 'activity':
            return 'Активність';
        case 'kitchen':
            return 'Кухня / меню';
        case 'service':
            return 'Сервіс';
        case 'manual':
            return 'Ручна операція';
        case 'needs_choice':
            return 'Оберіть роль';
        default:
            return '';
    }
}

function bookingActiveBanquetRoleIntentValue() {
    const resolver = typeof resolveBookingActiveBanquetRoleIntent === 'function'
        ? resolveBookingActiveBanquetRoleIntent
        : null;
    const role = resolver
        ? resolver(BookingDrawerState.explicitBanquetContext || {})
        : BookingDrawerState.activeBanquetRoleIntent;
    BookingDrawerState.activeBanquetRoleIntent = role || null;
    return role || '';
}

function renderActiveBanquetContextBanner() {
    const banner = document.getElementById('bookingActiveBanquetContext');
    if (!banner) return;
    const activeIntent = BookingDrawerState.activeBanquetIntent === 'add_to_existing';
    const selectedContext = selectedBookingBanquetGroupContext();
    const hasGroup = Boolean(selectedContext?.groupId);
    const shouldShow = activeIntent || selectedContext?.isExplicitBanquetContext;
    if (!shouldShow) {
        banner.hidden = true;
        banner.classList.add('hidden');
        banner.classList.remove('is-mismatch', 'is-standalone-ready');
        banner.innerHTML = '';
        return;
    }
    const mismatch = hasGroup && selectedBookingBanquetGroupCustomerMismatch(selectedContext);
    const metaParts = bookingActiveBanquetMetaParts(selectedContext);
    const title = hasGroup
        ? `Додається до банкету: ${bookingActiveBanquetContextLabel(selectedContext)}`
        : 'Потрібно вибрати банкет';
    const note = mismatch
        ? 'Клієнт не збігається з вибраним банкетом. Оберіть інший банкет або створіть окремо.'
        : (hasGroup ? 'Нове бронювання буде додано до цієї банкетної групи.' : 'Активний банкетний контекст скинуто. Оберіть банкет або створіть окреме бронювання.');
    const roleIntent = bookingActiveBanquetRoleIntentValue();
    const roleLabel = bookingActiveBanquetRoleIntentLabel(roleIntent);
    banner.classList.toggle('is-mismatch', mismatch || !hasGroup);
    banner.classList.toggle('is-standalone-ready', Boolean(BookingDrawerState.standaloneBookingOverride));
    banner.innerHTML = `
        <div class="booking-active-banquet-context__main">
            <strong>${escapeHtml(title)}</strong>
            ${metaParts.length ? `<span>${metaParts.map(part => escapeHtml(part)).join(' · ')}</span>` : ''}
            ${roleLabel ? `<span class="booking-active-banquet-context__role">Роль: ${escapeHtml(roleLabel)}</span>` : ''}
            <small>${escapeHtml(note)}</small>
        </div>
        <div class="booking-active-banquet-context__actions">
            <button type="button" data-booking-change-banquet>Змінити банкет</button>
            <button type="button" data-booking-standalone-override>Створити окремо</button>
        </div>
    `;
    banner.hidden = false;
    banner.classList.remove('hidden');
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
        renderActiveBanquetContextBanner();
        return;
    }

    const selectedGroupId = String(BookingDrawerState.selectedBanquetGroupId || '').trim();
    const realState = bookingBanquetSelectorRealState();
    const fallbackCandidates = realState.fallbackCandidates;
    const visibleCandidates = realState.visibleCandidates;
    const selectedKnown = allBookingBanquetGroupCandidates().some(candidate => String(candidate.groupId) === selectedGroupId);
    const virtualState = bookingBanquetSelectorVirtualState();
    const showVirtualBanquetCreateOption = bookingBanquetSelectorCanShowVirtual(virtualState, realState, selectedGroupId);
    const virtualInvalidMessage = bookingBanquetSelectorVirtualInvalidMessage(virtualState, realState, selectedGroupId);
    const unlinkedOptionLabel = showVirtualBanquetCreateOption ? virtualState.label : 'Без прив’язки';
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
        } else if (showVirtualBanquetCreateOption) {
            hint.textContent = virtualState.hint;
        } else if (virtualInvalidMessage) {
            hint.textContent = virtualInvalidMessage;
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
    renderActiveBanquetContextBanner();
}

async function refreshBookingBanquetGroupCandidates(options = {}) {
    const customerId = bookingBanquetGroupSelectedCustomerId();
    const date = bookingBanquetGroupDateValue();
    const preselectGroupId = String(options.preselectGroupId || '').trim();
    if (!isParkTimelineBookingMode() || !customerId || !date || typeof apiGetBanquetCandidates !== 'function') {
        resetBookingBanquetGroupSelector();
        return;
    }

    const sourceMeta = bookingBanquetSelectorSourceMeta();
    const key = bookingBanquetGroupCandidatesRefreshKey({ date, customerId });
    const currentSelected = preselectGroupId || (options.preserveSelection === false ? '' : getSelectedBookingBanquetGroupId());
    BookingDrawerState.selectedBanquetGroupId = currentSelected;
    BookingDrawerState.banquetGroupCandidatesKey = key;
    BookingDrawerState.banquetGroupCandidatesLoading = true;
    renderBookingBanquetGroupSelector();

    const result = await apiGetBanquetCandidates({
        date,
        customerId,
        room: sourceMeta.room,
        sourceBookingId: sourceMeta.sourceBookingId,
        drawerMode: sourceMeta.drawerMode,
        contextGeneration: sourceMeta.contextGeneration
    });
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
    const selectedIsExplicit = BookingDrawerState.explicitBanquetContext?.groupId
        && String(BookingDrawerState.explicitBanquetContext.groupId) === String(BookingDrawerState.selectedBanquetGroupId || '');
    if (BookingDrawerState.selectedBanquetGroupId && !selectedStillExists && !selectedIsExplicit) {
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
window.getSelectedBookingBanquetGroupId = getSelectedBookingBanquetGroupId;
window.selectedBookingBanquetGroupContext = selectedBookingBanquetGroupContext;
window.selectedBookingBanquetGroupCustomerMismatch = selectedBookingBanquetGroupCustomerMismatch;
window.bookingBanquetSelectorVirtualState = bookingBanquetSelectorVirtualState;
window.renderBookingBanquetGroupSelector = renderBookingBanquetGroupSelector;
window.refreshBookingBanquetGroupCandidates = refreshBookingBanquetGroupCandidates;
window.scheduleBookingBanquetGroupCandidatesRefresh = scheduleBookingBanquetGroupCandidatesRefresh;
window.attachBanquetGroupContextToBooking = attachBanquetGroupContextToBooking;
window.setBookingDrawerMode = setBookingDrawerMode;
window.resetBookingDrawerStateForOpen = resetBookingDrawerStateForOpen;
