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
    const staleReason = bookingRoomSourceContextStaleReason(sourceContext);
    if (staleReason) {
        return {
            shouldUse: true,
            error: bookingRoomSourceContextStaleMessage(staleReason)
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
    const staleReason = bookingRoomSourceContextStaleReason(bridgeContext);
    if (staleReason) {
        return {
            shouldUse: true,
            error: bookingRoomSourceContextStaleMessage(staleReason)
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

function bookingCreatePathEndpoint(kind, groupId = '') {
    const safeGroupId = String(groupId || '').trim();
    switch (kind) {
        case 'existing_group_member':
            return safeGroupId ? `/api/banquets/${encodeURIComponent(safeGroupId)}/member-booking` : null;
        case 'existing_group_activity':
            return safeGroupId ? `/api/banquets/${encodeURIComponent(safeGroupId)}/activity-booking` : null;
        case 'source_activity_to_kitchen':
            return '/api/banquets/from-source/member-booking';
        case 'source_kitchen_to_activity':
            return '/api/banquets/from-source/activity-booking';
        case 'full_booking':
            return '/api/bookings/full';
        case 'normal_booking':
        default:
            return '/api/bookings';
    }
}

function buildBookingCreatePath(kind, options = {}) {
    const groupId = options.groupId ? String(options.groupId).trim() : null;
    const sourceBookingId = options.sourceBookingId ? String(options.sourceBookingId).trim() : null;
    return {
        kind,
        endpoint: options.endpoint ?? bookingCreatePathEndpoint(kind, groupId),
        reason: options.reason || kind,
        groupId,
        sourceBookingId,
        blocked: Boolean(options.blocked),
        error: options.error || null,
        context: options.context || null
    };
}

function resolveBookingEditPath(formState = {}) {
    const editingBookingId = String(formState.editingBookingId || '').trim();
    const context = formState.banquetEditContext || null;
    if (!context?.groupId) {
        return {
            kind: 'single_booking_update',
            endpoint: editingBookingId ? `/api/bookings/${encodeURIComponent(editingBookingId)}` : null,
            blocked: !editingBookingId,
            error: editingBookingId ? null : 'Booking ID is required for edit'
        };
    }
    const groupId = String(context.groupId || '').trim();
    const primaryBookingId = String(context.primaryBookingId || '').trim();
    const expectedGroupUpdatedAt = String(context.expectedGroupUpdatedAt || '').trim();
    const missing = [
        !primaryBookingId && 'primaryBookingId',
        !expectedGroupUpdatedAt && 'expectedGroupUpdatedAt'
    ].filter(Boolean);
    return {
        kind: 'banquet_booking_set',
        endpoint: `/api/banquets/${encodeURIComponent(groupId)}/booking-set`,
        groupId,
        primaryBookingId,
        expectedGroupUpdatedAt,
        blocked: missing.length > 0,
        error: missing.length ? `Banquet edit context is incomplete: ${missing.join(', ')}` : null
    };
}

function bookingCreatePathActiveBanquetRole(formData = {}, drawerState = BookingDrawerState) {
    const roleIntent = String(drawerState?.activeBanquetRoleIntent || '').trim().toLowerCase();
    if (isSelectedBanquetActivityCreate(formData) || roleIntent === 'activity') return 'activity';
    if (isSelectedBanquetKitchenCreate(formData) || ['kitchen', 'service', 'manual', 'member'].includes(roleIntent)) return 'member';
    if (roleIntent === 'needs_choice') return 'needs_choice';
    return roleIntent || 'needs_choice';
}

function resolveBookingCreatePath(formState = {}, drawerState = BookingDrawerState) {
    const formData = formState.formData || formState || {};
    const selectedBanquetContext = formState.selectedBanquetContext || selectedBookingBanquetGroupContext();
    const groupId = String(selectedBanquetContext?.groupId || '').trim();
    const isKitchenCreate = isSelectedBanquetKitchenCreate(formData);
    const isActivityCreate = isSelectedBanquetActivityCreate(formData);
    const selectedActivityPrograms = Array.isArray(formState.selectedActivityPrograms)
        ? formState.selectedActivityPrograms.filter(Boolean)
        : (Array.isArray(formData.activityPrograms) ? formData.activityPrograms.filter(Boolean) : []);
    const hasOwnActivityBridge = Object.prototype.hasOwnProperty.call(formState, 'activityFirstKitchenBridge');
    const hasOwnKitchenBridge = Object.prototype.hasOwnProperty.call(formState, 'kitchenFirstActivityBridge');
    const activityFirstKitchenBridge = hasOwnActivityBridge
        ? formState.activityFirstKitchenBridge
        : validateActivityFirstKitchenBridge(formData, selectedBanquetContext);
    const kitchenFirstActivityBridge = hasOwnKitchenBridge
        ? formState.kitchenFirstActivityBridge
        : validateKitchenFirstActivityBridge(formData, selectedBanquetContext);
    const fullBookingRequired = Boolean(
        formState.fullBookingRequired
        || formState.hasLinkedBookings
        || formState.hasBanquetActivities
    );
    const normalKind = fullBookingRequired ? 'full_booking' : 'normal_booking';
    const normalReason = fullBookingRequired ? 'linked_or_multi_activity_booking' : 'no_banquet_context';
    const activeBanquetIntent = drawerState?.activeBanquetIntent === 'add_to_existing';
    const standaloneBookingOverride = Boolean(drawerState?.standaloneBookingOverride);

    const realGroupKind = isKitchenCreate
        ? 'existing_group_member'
        : (isActivityCreate ? 'existing_group_activity' : normalKind);
    const roomBridgeContext = drawerState?.roomBookingAnimationBridge || null;
    const explicitContext = drawerState?.explicitBanquetContext || null;
    const realGroupSourceBookingId = selectedBanquetContext?.sourceBookingId
        || explicitContext?.sourceBookingId
        || explicitContext?.primaryBookingId
        || roomBridgeContext?.sourceBookingId
        || null;

    if (activeBanquetIntent && !standaloneBookingOverride && !groupId) {
        return buildBookingCreatePath('normal_booking', {
            reason: 'active_banquet_context_requires_group',
            blocked: true,
            error: 'Ви почали додавати бронювання до існуючого банкету. Оберіть банкет або натисніть “Створити окремо”.'
        });
    }

    if (activeBanquetIntent && !standaloneBookingOverride && groupId && selectedBookingBanquetGroupCustomerMismatch(selectedBanquetContext)) {
        return buildBookingCreatePath(realGroupKind, {
            groupId,
            sourceBookingId: realGroupSourceBookingId,
            reason: 'customer_mismatch',
            blocked: true,
            error: 'Клієнт бронювання не збігається з вибраним банкетом. Оберіть правильного клієнта або натисніть “Створити окремо”.'
        });
    }

    if (activeBanquetIntent && !standaloneBookingOverride && groupId) {
        const activeRole = bookingCreatePathActiveBanquetRole(formData, drawerState);
        if (!['member', 'activity'].includes(activeRole)) {
            return buildBookingCreatePath('normal_booking', {
                groupId,
                sourceBookingId: realGroupSourceBookingId,
                context: selectedBanquetContext,
                reason: 'active_banquet_context_requires_role',
                blocked: true,
                error: 'Виберіть, що додається до банкету: активність або кухня/сервіс. Звичайне бронювання тут не створюється автоматично.'
            });
        }
        if (!realGroupSourceBookingId) {
            return buildBookingCreatePath(activeRole === 'activity' ? 'existing_group_activity' : 'existing_group_member', {
                groupId,
                context: selectedBanquetContext,
                reason: 'active_banquet_context_requires_source_booking',
                blocked: true,
                error: 'Не знайдено основне бронювання банкету для прив’язки. Закрийте форму, відкрийте банкет ще раз і повторіть дію.'
            });
        }
        if (activeRole === 'activity') {
            if (selectedActivityPrograms.length > 1) {
                return buildBookingCreatePath('existing_group_activity', {
                    groupId,
                    sourceBookingId: realGroupSourceBookingId,
                    context: selectedBanquetContext,
                    reason: 'multiple_activity_programs',
                    blocked: true,
                    error: 'Для прив’язки до банкету оберіть одну активність. Додаткові активності додавайте окремо.'
                });
            }
            return buildBookingCreatePath('existing_group_activity', {
                groupId,
                sourceBookingId: realGroupSourceBookingId,
                context: selectedBanquetContext,
                reason: 'active_banquet_context_activity'
            });
        }
        return buildBookingCreatePath('existing_group_member', {
            groupId,
            sourceBookingId: realGroupSourceBookingId,
            context: selectedBanquetContext,
            reason: 'active_banquet_context_member'
        });
    }

    if (groupId && selectedBookingBanquetGroupCustomerMismatch(selectedBanquetContext)) {
        return buildBookingCreatePath(realGroupKind, {
            groupId,
            sourceBookingId: realGroupSourceBookingId,
            reason: 'customer_mismatch',
            blocked: true,
            error: 'Клієнт бронювання не збігається з вибраним банкетом. Оберіть правильного клієнта або скиньте прив’язку до банкета.'
        });
    }

    if (groupId && isKitchenCreate) {
        return buildBookingCreatePath('existing_group_member', {
            groupId,
            sourceBookingId: realGroupSourceBookingId,
            context: selectedBanquetContext,
            reason: 'real_group_kitchen'
        });
    }

    if (groupId && isActivityCreate) {
        if (selectedActivityPrograms.length > 1) {
            return buildBookingCreatePath('existing_group_activity', {
                groupId,
                sourceBookingId: realGroupSourceBookingId,
                context: selectedBanquetContext,
                reason: 'multiple_activity_programs',
                blocked: true,
                error: roomBridgeContext
                    ? 'Для додавання активної програми з кімнатної броні оберіть одну програму. Додаткові програми додавайте окремо.'
                    : 'Для прив’язки до банкету оберіть одну активність. Додаткові активності додавайте окремо.'
            });
        }
        if (!realGroupSourceBookingId) {
            return buildBookingCreatePath('existing_group_activity', {
                groupId,
                context: selectedBanquetContext,
                reason: 'missing_primary_source_booking',
                blocked: true,
                error: roomBridgeContext
                    ? 'Не знайдено банкетну групу для цієї активної програми. Закрийте форму й спробуйте ще раз.'
                    : 'У вибраного банкету немає основної броні для прив’язки активності.'
            });
        }
        return buildBookingCreatePath('existing_group_activity', {
            groupId,
            sourceBookingId: realGroupSourceBookingId,
            context: selectedBanquetContext,
            reason: roomBridgeContext ? 'real_group_activity_from_room_bridge' : 'real_group_activity'
        });
    }

    if (groupId) {
        return buildBookingCreatePath(normalKind, {
            groupId,
            sourceBookingId: realGroupSourceBookingId,
            reason: 'unsupported_banquet_group_create',
            blocked: true,
            error: selectedBanquetUnsupportedCreateMessage()
        });
    }

    if (kitchenFirstActivityBridge?.shouldUse) {
        const sourceContext = kitchenFirstActivityBridge.context || null;
        if (kitchenFirstActivityBridge.error) {
            return buildBookingCreatePath('source_kitchen_to_activity', {
                sourceBookingId: sourceContext?.sourceBookingId || roomBridgeContext?.sourceBookingId || null,
                context: sourceContext,
                reason: 'source_kitchen_to_activity_invalid',
                blocked: true,
                error: kitchenFirstActivityBridge.error
            });
        }
        if (selectedActivityPrograms.length > 1) {
            return buildBookingCreatePath('source_kitchen_to_activity', {
                sourceBookingId: sourceContext?.sourceBookingId || null,
                context: sourceContext,
                reason: 'multiple_activity_programs',
                blocked: true,
                error: 'Для додавання активної програми з кухні оберіть одну програму. Додаткові програми додавайте окремо.'
            });
        }
        if (!sourceContext?.sourceBookingId) {
            return buildBookingCreatePath('source_kitchen_to_activity', {
                context: sourceContext,
                reason: 'missing_source_booking',
                blocked: true,
                error: 'Джерело кухні застаріло. Відкрийте активність з кімнатної броні ще раз.'
            });
        }
        return buildBookingCreatePath('source_kitchen_to_activity', {
            sourceBookingId: sourceContext?.sourceBookingId || null,
            context: sourceContext,
            reason: 'valid_source_kitchen_to_activity'
        });
    }

    if (activityFirstKitchenBridge?.shouldUse) {
        const sourceContext = activityFirstKitchenBridge.context || activityFirstKitchenSourceContext(selectedBanquetContext);
        if (activityFirstKitchenBridge.error) {
            return buildBookingCreatePath('source_activity_to_kitchen', {
                sourceBookingId: sourceContext?.sourceBookingId || null,
                context: sourceContext,
                reason: 'source_activity_to_kitchen_invalid',
                blocked: true,
                error: activityFirstKitchenBridge.error
            });
        }
        if (!sourceContext?.sourceBookingId) {
            return buildBookingCreatePath('source_activity_to_kitchen', {
                context: sourceContext,
                reason: 'missing_source_booking',
                blocked: true,
                error: 'Джерело кімнати застаріло. Оберіть кімнату ще раз перед збереженням кухні.'
            });
        }
        return buildBookingCreatePath('source_activity_to_kitchen', {
            sourceBookingId: sourceContext?.sourceBookingId || null,
            context: sourceContext,
            reason: 'valid_source_activity_to_kitchen'
        });
    }

    if (activeBanquetIntent && !standaloneBookingOverride) {
        return buildBookingCreatePath('normal_booking', {
            reason: 'active_banquet_context_unresolved_path',
            blocked: true,
            error: 'Активний банкетний контекст не вдалося перетворити на безпечний шлях створення. Натисніть “Створити окремо” або відкрийте банкет знову.'
        });
    }

    return buildBookingCreatePath(normalKind || 'normal_booking', {
        reason: normalReason
    });
}

window.resolveBookingCreatePath = resolveBookingCreatePath;
window.resolveBookingEditPath = resolveBookingEditPath;
