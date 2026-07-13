/**
 * Shared timeline interaction model.
 *
 * Keep this file free of DOM and network dependencies so drag/resize behavior
 * can be tested without a browser and reused by both timeline contexts.
 */
(function initTimelineInteractionModel(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.TimelineInteractionModel = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function buildTimelineInteractionModel() {
    function own(obj, key) {
        return Object.prototype.hasOwnProperty.call(obj || {}, key);
    }

    function idOf(value) {
        return value === undefined || value === null ? '' : String(value);
    }

    function sameId(a, b) {
        return idOf(a) === idOf(b);
    }

    function sameLine(a, b) {
        return idOf(a) === idOf(b);
    }

    function objectValue(value) {
        if (!value) return {};
        if (typeof value === 'object' && !Array.isArray(value)) return value;
        if (typeof value !== 'string' || !value.trim()) return {};
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }

    function banquetConflictMetadata(booking = {}, fallback = {}) {
        const extra = objectValue(booking.extraData ?? booking.extra_data);
        const group = extra.banquetGroup || extra.banquet_group || booking.banquetGroup || booking.banquet_group || {};
        const workspace = extra.bookingWorkspace || extra.booking_workspace || {};
        const workspaceGroup = workspace.banquetGroup || workspace.banquet_group || {};
        const groupId = idOf(
            booking.banquetGroupId
            || booking.banquet_group_id
            || group.groupId
            || group.group_id
            || group.id
            || workspace.banquetGroupId
            || workspace.banquet_group_id
            || workspaceGroup.groupId
            || workspaceGroup.group_id
            || workspaceGroup.id
            || fallback.banquetGroupId
        ).trim();
        const explicitRole = String(
            booking.banquetGroupRole
            || booking.banquet_group_role
            || group.role
            || workspace.banquetRole
            || workspace.banquet_role
            || fallback.bookingRole
            || ''
        ).trim().toLowerCase();
        const programCode = String(booking.programCode || booking.program_code || '').trim().toUpperCase();
        const category = String(booking.category || booking.category_id || '').trim().toLowerCase();
        const lineId = idOf(booking.lineId || booking.line_id).trim();
        const bookingPackage = extra.bookingPackage || extra.booking_package || {};
        const hasOperationalPackage = (Array.isArray(bookingPackage.menuPositions || bookingPackage.menu_positions)
            && (bookingPackage.menuPositions || bookingPackage.menu_positions).length > 0)
            || (Array.isArray(bookingPackage.serviceEvents || bookingPackage.service_events)
                && (bookingPackage.serviceEvents || bookingPackage.service_events).length > 0);
        let role = ['activity', 'kitchen', 'service', 'manual', 'primary'].includes(explicitRole) ? explicitRole : '';
        if (!role && (programCode === 'KITCHEN' || category === 'kitchen')) role = 'kitchen';
        if (!role && lineId === 'banquet-service') role = 'service';
        if (!role && category === 'banquet' && hasOperationalPackage) role = 'service';
        if (!role && ['animation', 'activity', 'custom', 'quest', 'show', 'masterclass', 'workshop'].includes(category)) role = 'activity';
        const sourceBookingId = idOf(
            group.sourceBookingId
            || group.source_booking_id
            || workspace.sourceBookingId
            || workspace.source_booking_id
            || fallback.sourceBookingId
            || booking.id
        ).trim();
        const potentialBanquet = Boolean(groupId || role || category === 'banquet' || programCode === 'KITCHEN');
        return { groupId, role, sourceBookingId, potentialBanquet };
    }

    function isTakeawayRoom(value) {
        const room = String(value || '').trim().toLowerCase();
        return ['room-takeaway', 'takeaway', 'на виніс', 'на вынос'].includes(room);
    }

    function isOperationalBanquetRole(metadata, booking = {}) {
        if (['kitchen', 'service', 'manual'].includes(metadata.role)) return true;
        if (metadata.role !== 'primary') return false;
        const extra = objectValue(booking.extraData ?? booking.extra_data);
        const bookingPackage = extra.bookingPackage || extra.booking_package || {};
        const hasOperationalPackage = (Array.isArray(bookingPackage.menuPositions || bookingPackage.menu_positions)
            && (bookingPackage.menuPositions || bookingPackage.menu_positions).length > 0)
            || (Array.isArray(bookingPackage.serviceEvents || bookingPackage.service_events)
                && (bookingPackage.serviceEvents || bookingPackage.service_events).length > 0);
        const category = String(booking.category || booking.category_id || '').trim().toLowerCase();
        return category === 'banquet'
            || idOf(booking.lineId || booking.line_id).trim() === 'banquet-service'
            || hasOperationalPackage
            || String(booking.programCode || booking.program_code || '').trim().toUpperCase() === 'KITCHEN';
    }

    function roomOverlapPolicy(candidate, conflict, fallback = {}) {
        if (String(conflict?.status || '').trim().toLowerCase() === 'cancelled') return 'allow';
        if (isTakeawayRoom(candidate?.room) || isTakeawayRoom(conflict?.room)) return 'allow';
        const candidateMeta = banquetConflictMetadata(candidate, fallback);
        const conflictMeta = banquetConflictMetadata(conflict);
        if (candidateMeta.groupId && conflictMeta.groupId && candidateMeta.groupId !== conflictMeta.groupId) return 'block';
        if (candidateMeta.groupId && conflictMeta.groupId) {
            if (!candidateMeta.role || !conflictMeta.role) return 'defer';
            const candidateActivity = candidateMeta.role === 'activity';
            const conflictActivity = conflictMeta.role === 'activity';
            const candidateOperational = isOperationalBanquetRole(candidateMeta, candidate);
            const conflictOperational = isOperationalBanquetRole(conflictMeta, conflict);
            return (candidateActivity && conflictOperational) || (candidateOperational && conflictActivity)
                ? 'allow'
                : 'block';
        }
        if (candidateMeta.potentialBanquet || conflictMeta.potentialBanquet) return 'defer';
        return 'block';
    }

    function uniqueBookings(bookings) {
        const seen = new Set();
        const result = [];
        (bookings || []).forEach(booking => {
            if (!booking || !booking.id) return;
            const id = idOf(booking.id);
            if (seen.has(id)) return;
            seen.add(id);
            result.push(booking);
        });
        return result;
    }

    function timeToMinutesValue(time) {
        const parts = String(time || '00:00').split(':');
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
    }

    function minutesToTimeValue(totalMinutes) {
        const normalized = Math.max(0, Math.min(24 * 60 - 1, Math.round(Number(totalMinutes) || 0)));
        const hours = Math.floor(normalized / 60);
        const minutes = normalized % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    function addMinutesToTimeValue(time, delta) {
        return minutesToTimeValue(timeToMinutesValue(time) + (Number(delta) || 0));
    }

    function savedMainFromResult(saveResult) {
        return saveResult?.booking || null;
    }

    function savedLinkedById(saveResult) {
        const rows = Array.isArray(saveResult?.linkedBookings) ? saveResult.linkedBookings : [];
        return new Map(rows.filter(row => row?.id).map(row => [idOf(row.id), row]));
    }

    function resolveTimelineBookingGroup(actorBooking, allBookings) {
        if (!actorBooking) {
            return {
                actorBooking: null,
                mainBooking: null,
                mainId: '',
                groupBookings: [],
                linkedBookings: [],
                groupBookingIds: new Set()
            };
        }

        const actorId = idOf(actorBooking.id);
        const mainId = idOf(actorBooking.linkedTo || actorBooking.id);
        const sourceBookings = uniqueBookings([...(allBookings || []), actorBooking]);
        const mainBooking = sourceBookings.find(booking => sameId(booking.id, mainId)) || actorBooking;
        const groupBookings = uniqueBookings([
            mainBooking,
            ...sourceBookings.filter(booking => sameId(booking.id, mainId) || sameId(booking.linkedTo, mainId)),
            actorBooking
        ]);
        const linkedBookings = groupBookings.filter(booking => !sameId(booking.id, mainId));
        return {
            actorBooking,
            mainBooking,
            mainId,
            actorId,
            groupBookings,
            linkedBookings,
            groupBookingIds: new Set(groupBookings.map(booking => idOf(booking.id)))
        };
    }

    function buildDragInteractionIntent(input = {}) {
        const state = input.state || input;
        const draggedBooking = input.draggedBooking || state.draggedBooking || state.booking;
        const allBookings = input.allBookings || state.groupBookings || [];
        const group = resolveTimelineBookingGroup(draggedBooking, allBookings);
        const mainBooking = input.mainBooking || state.mainBooking || group.mainBooking || draggedBooking;
        const mainId = idOf(mainBooking?.id || group.mainId);
        const actorId = idOf(draggedBooking?.id);
        const groupBookings = uniqueBookings([mainBooking, ...group.groupBookings]);
        const startMin = Number.isFinite(Number(input.startMin ?? state.startMin))
            ? Number(input.startMin ?? state.startMin)
            : timeToMinutesValue(draggedBooking?.time);
        const targetMin = Number.isFinite(Number(input.currentMin ?? state.currentMin))
            ? Number(input.currentMin ?? state.currentMin)
            : startMin;
        const timeDelta = Number.isFinite(Number(input.timeDelta))
            ? Number(input.timeDelta)
            : targetMin - startMin;
        const targetTime = input.targetTime || minutesToTimeValue(targetMin);
        const startLineId = input.startLineId ?? state.startLineId ?? draggedBooking?.lineId;
        const targetLineId = input.targetLineId ?? state.newLineId ?? draggedBooking?.lineId;
        const lineChanged = own(input, 'lineChanged')
            ? Boolean(input.lineChanged)
            : !sameLine(startLineId, targetLineId);
        const assignmentMode = String(input.assignmentMode || state.assignmentMode || 'line') === 'room' ? 'room' : 'line';
        const startRoom = input.startRoom ?? state.startRoom ?? draggedBooking?.room ?? mainBooking?.room ?? '';
        const targetRoom = input.targetRoom ?? state.newRoom ?? state.targetRoom ?? startRoom;
        const roomChanged = assignmentMode === 'room' && !sameLine(startRoom, targetRoom);
        const draggedIsMain = sameId(actorId, mainId);
        const actorMetadata = banquetConflictMetadata(draggedBooking, {
            banquetGroupId: input.banquetGroupId,
            bookingRole: input.bookingRole,
            sourceBookingId: input.sourceBookingId
        });

        const candidates = groupBookings.map(booking => {
            const isMain = sameId(booking.id, mainId);
            const isDragged = sameId(booking.id, actorId);
            let nextTime = booking.time;
            let nextLineId = booking.lineId;
            let nextRoom = booking.room;

            if (isDragged) {
                nextTime = targetTime;
                if (lineChanged && assignmentMode === 'line') nextLineId = targetLineId;
            } else if (timeDelta !== 0) {
                nextTime = addMinutesToTimeValue(booking.time, timeDelta);
            }
            if (assignmentMode === 'room' && lineChanged) {
                nextRoom = targetRoom;
            }

            return {
                id: booking.id,
                isMain,
                isDragged,
                old: booking,
                next: {
                    ...booking,
                    time: nextTime,
                    lineId: nextLineId,
                    room: nextRoom
                }
            };
        });

        const mainCandidate = candidates.find(candidate => candidate.isMain) || null;
        const linkedCandidates = candidates.filter(candidate => !candidate.isMain);

        return {
            type: 'drag',
            draggedBooking,
            mainBooking,
            mainId,
            actorId,
            draggedIsMain,
            groupBookings,
            linkedBookings: groupBookings.filter(booking => !sameId(booking.id, mainId)),
            groupBookingIds: new Set(groupBookings.map(booking => idOf(booking.id))),
            startMin,
            targetMin,
            timeDelta,
            targetTime,
            startLineId,
            targetLineId,
            lineChanged,
            assignmentMode,
            startRoom,
            targetRoom,
            roomChanged,
            banquetGroupId: actorMetadata.groupId,
            bookingRole: actorMetadata.role,
            sourceBookingId: actorMetadata.sourceBookingId || actorId,
            candidates,
            mainCandidate,
            linkedCandidates
        };
    }

    function buildDragAtomicPayload(intent, historyData = null) {
        const mainPatch = {};
        const linked = [];

        if (intent.assignmentMode === 'room') {
            if (intent.draggedIsMain) {
                mainPatch.time = intent.mainCandidate?.next.time;
                if (intent.roomChanged) mainPatch.room = intent.targetRoom;
            } else if (intent.timeDelta !== 0) {
                mainPatch.time = intent.mainCandidate?.next.time;
            }
        } else if (intent.draggedIsMain) {
            mainPatch.time = intent.mainCandidate?.next.time;
            mainPatch.lineId = intent.mainCandidate?.next.lineId;
        } else if (intent.timeDelta !== 0) {
            mainPatch.time = intent.mainCandidate?.next.time;
        }

        intent.linkedCandidates.forEach(candidate => {
            const patch = {
                id: candidate.id,
                time: candidate.next.time
            };
            if (intent.assignmentMode === 'room' && intent.roomChanged) {
                patch.room = intent.targetRoom;
            } else if (candidate.isDragged && intent.lineChanged) {
                patch.lineId = candidate.next.lineId;
            }
            linked.push(patch);
        });

        return {
            main: mainPatch,
            linked,
            historyAction: 'drag',
            historyData: historyData || {
                bookingId: intent.mainBooking?.id,
                draggedBookingId: intent.draggedBooking?.id,
                mainBookingId: intent.mainBooking?.id,
                shiftMinutes: intent.timeDelta,
                lineSwitched: intent.lineChanged,
                roomSwitched: intent.roomChanged,
                oldLineId: intent.startLineId,
                oldRoom: intent.startRoom,
                oldTime: minutesToTimeValue(intent.startMin)
            }
        };
    }

    function buildDragUndoSnapshot(intent, saveResult = null) {
        const savedMain = savedMainFromResult(saveResult);
        const savedLinked = savedLinkedById(saveResult);
        const mainNext = intent.mainCandidate?.next || intent.mainBooking || {};
        return {
            bookingId: intent.mainBooking?.id,
            draggedBookingId: intent.draggedBooking?.id,
            oldTime: intent.mainBooking?.time,
            oldLineId: intent.mainBooking?.lineId,
            newTime: savedMain?.time || mainNext.time,
            newLineId: savedMain?.lineId || mainNext.lineId,
            timeDelta: -intent.timeDelta,
            ...(intent.assignmentMode === 'room' ? {
                oldRoom: intent.mainBooking?.room,
                newRoom: savedMain?.room || mainNext.room,
                assignmentMode: intent.assignmentMode
            } : {}),
            linked: intent.linkedCandidates.map(candidate => {
                const savedRow = savedLinked.get(idOf(candidate.id));
                return {
                    id: candidate.id,
                    oldTime: candidate.old.time,
                    oldLineId: candidate.old.lineId,
                    newTime: savedRow?.time || candidate.next.time,
                    newLineId: savedRow?.lineId || candidate.next.lineId,
                    ...(intent.assignmentMode === 'room' ? {
                        oldRoom: candidate.old.room,
                        newRoom: savedRow?.room || candidate.next.room
                    } : {})
                };
            })
        };
    }

    function buildDragUndoAtomicPayload(snapshot, currentBooking = null) {
        if (snapshot?.assignmentMode === 'room') {
            return {
                main: {
                    time: snapshot.oldTime,
                    room: snapshot.oldRoom
                },
                linked: (snapshot.linked || []).map(item => ({
                    id: item.id,
                    time: item.oldTime,
                    room: item.oldRoom
                })),
                historyAction: 'undo_drag',
                historyData: {
                    ...(currentBooking || {}),
                    time: snapshot.oldTime,
                    room: snapshot.oldRoom
                }
            };
        }
        return {
            main: {
                time: snapshot.oldTime,
                lineId: snapshot.oldLineId
            },
            linked: (snapshot.linked || []).map(item => ({
                id: item.id,
                time: item.oldTime,
                lineId: item.oldLineId
            })),
            historyAction: 'undo_drag',
            historyData: {
                ...(currentBooking || {}),
                time: snapshot.oldTime,
                lineId: snapshot.oldLineId
            }
        };
    }

    function labelForBooking(booking = {}) {
        return booking.label || booking.programCode || booking.programName || booking.room || (booking.id ? `#${booking.id}` : 'Бронювання');
    }

    function buildDragChangeSet(intent) {
        const lineChanges = (intent.candidates || [])
            .filter(candidate => intent.assignmentMode === 'room'
                ? !sameLine(candidate.old?.room, candidate.next?.room)
                : !sameLine(candidate.old?.lineId, candidate.next?.lineId))
            .map(candidate => ({
                id: candidate.id,
                bookingId: candidate.id,
                bookingLabel: labelForBooking(candidate.old),
                isMain: Boolean(candidate.isMain),
                isDragged: Boolean(candidate.isDragged),
                oldLineId: intent.assignmentMode === 'room' ? (candidate.old?.room ?? null) : (candidate.old?.lineId ?? null),
                newLineId: intent.assignmentMode === 'room' ? (candidate.next?.room ?? null) : (candidate.next?.lineId ?? null)
            }));
        const deltaMinutes = Number(intent.timeDelta || 0);
        return {
            type: 'drag-change-set',
            bookingId: intent.mainBooking?.id || null,
            draggedBookingId: intent.draggedBooking?.id || null,
            primaryLabel: labelForBooking(intent.draggedBooking || intent.mainBooking),
            time: {
                changed: deltaMinutes !== 0,
                deltaMinutes,
                oldTime: intent.draggedBooking?.time || minutesToTimeValue(intent.startMin),
                newTime: intent.targetTime
            },
            line: {
                changed: lineChanges.length > 0,
                changes: lineChanges
            },
            lineChanges,
            changedFields: [
                ...(deltaMinutes !== 0 ? ['time'] : []),
                ...(lineChanges.length > 0 ? [intent.assignmentMode === 'room' ? 'room' : 'line'] : [])
            ]
        };
    }

    function lineNameFromOptions(lineId, options = {}) {
        const id = idOf(lineId);
        if (typeof options.resolveLineName === 'function') {
            const resolved = options.resolveLineName(id);
            if (resolved) return String(resolved);
        }
        const names = options.lineNames || {};
        if (names instanceof Map && names.has(id)) return String(names.get(id));
        if (own(names, id) && names[id]) return String(names[id]);
        return id ? `лінію ${id}` : 'іншу лінію';
    }

    function formatSignedMinutes(delta) {
        const minutes = Number(delta || 0);
        return `${minutes > 0 ? '+' : ''}${minutes}`;
    }

    function uniqueLineChanges(changes = []) {
        const seen = new Set();
        const result = [];
        changes.forEach(change => {
            const key = `${idOf(change.oldLineId)}>${idOf(change.newLineId)}>${idOf(change.bookingId)}`;
            if (seen.has(key)) return;
            seen.add(key);
            result.push(change);
        });
        return result;
    }

    function formatDragChangeSummary(changeSet, options = {}) {
        const primaryLabel = options.primaryLabel || changeSet?.primaryLabel || 'Бронювання';
        const assignmentLabel = options.assignmentLabel || 'лінію';
        const parts = [];

        if (changeSet?.time?.changed) {
            parts.push(`${primaryLabel} перенесено на ${formatSignedMinutes(changeSet.time.deltaMinutes)} хв`);
        } else {
            parts.push(primaryLabel);
        }

        const lineChanges = uniqueLineChanges(changeSet?.lineChanges || changeSet?.line?.changes || []);
        lineChanges.forEach(change => {
            const oldName = lineNameFromOptions(change.oldLineId, options);
            const newName = lineNameFromOptions(change.newLineId, options);
            const labelSuffix = lineChanges.length > 1 && change.bookingLabel
                ? ` ${change.bookingLabel}:`
                : '';
            parts.push(`змінили ${assignmentLabel}${labelSuffix} з ${oldName} на ${newName}`);
        });

        return parts.join(', ');
    }

    function buildResizeInteractionIntent(input = {}) {
        const booking = input.booking;
        const group = resolveTimelineBookingGroup(booking, input.allBookings || []);
        const mainBooking = group.mainBooking || booking;
        const mainId = idOf(mainBooking?.id);
        const newDuration = parseInt(input.newDuration, 10);
        const groupBookings = uniqueBookings([mainBooking, ...group.groupBookings]);
        const assignmentMode = String(input.assignmentMode || 'line') === 'room' ? 'room' : 'line';
        const actorMetadata = banquetConflictMetadata(booking, {
            banquetGroupId: input.banquetGroupId,
            bookingRole: input.bookingRole,
            sourceBookingId: input.sourceBookingId
        });
        const candidates = groupBookings.map(item => ({
            id: item.id,
            isMain: sameId(item.id, mainId),
            isDragged: sameId(item.id, booking?.id),
            old: item,
            next: {
                ...item,
                duration: newDuration
            }
        }));

        return {
            type: 'resize',
            actorBooking: booking,
            mainBooking,
            mainId,
            groupBookings,
            linkedBookings: groupBookings.filter(item => !sameId(item.id, mainId)),
            groupBookingIds: new Set(groupBookings.map(item => idOf(item.id))),
            newDuration,
            assignmentMode,
            targetRoom: input.targetRoom ?? booking?.room ?? mainBooking?.room ?? '',
            banquetGroupId: actorMetadata.groupId,
            bookingRole: actorMetadata.role,
            sourceBookingId: actorMetadata.sourceBookingId || idOf(booking?.id),
            candidates,
            mainCandidate: candidates.find(candidate => candidate.isMain) || null,
            linkedCandidates: candidates.filter(candidate => !candidate.isMain)
        };
    }

    function buildResizeAtomicPayload(intent, historyData = null) {
        return {
            main: { duration: intent.newDuration },
            linked: intent.linkedCandidates.map(candidate => ({
                id: candidate.id,
                duration: intent.newDuration
            })),
            historyAction: 'resize',
            historyData: historyData || {
                bookingId: intent.mainBooking?.id,
                oldDuration: intent.mainBooking?.duration,
                newDuration: intent.newDuration,
                linked: intent.linkedCandidates.map(candidate => candidate.id)
            }
        };
    }

    function buildResizeUndoSnapshot(intent, saveResult = null) {
        const savedMain = savedMainFromResult(saveResult);
        return {
            bookingId: intent.mainBooking?.id,
            oldDuration: intent.mainBooking?.duration,
            newDuration: savedMain?.duration || intent.newDuration,
            linked: intent.linkedCandidates.map(candidate => candidate.id)
        };
    }

    function buildResizeUndoAtomicPayload(snapshot, currentBooking = null) {
        return {
            main: { duration: snapshot.oldDuration },
            linked: (snapshot.linked || []).map(id => ({
                id,
                duration: snapshot.oldDuration
            })),
            historyAction: 'undo_resize',
            historyData: {
                ...(currentBooking || {}),
                duration: snapshot.oldDuration
            }
        };
    }

    function evaluateTimelineCandidateConflicts(intent, allBookings = [], options = {}) {
        const excludeIds = intent.groupBookingIds || new Set();
        const dayStartMin = Number.isFinite(Number(options.dayStartMin)) ? Number(options.dayStartMin) : null;
        const dayEndMin = Number.isFinite(Number(options.dayEndMin)) ? Number(options.dayEndMin) : null;

        let deferredToServer = false;
        const candidates = intent.candidates || [];
        for (const candidate of candidates) {
            const start = timeToMinutesValue(candidate.next.time);
            const end = start + (parseInt(candidate.next.duration, 10) || 0);

            if ((dayStartMin !== null && start < dayStartMin) || (dayEndMin !== null && end > dayEndMin)) {
                return {
                    valid: false,
                    type: 'boundary',
                    candidate,
                    error: 'boundary'
                };
            }

            const blocker = (allBookings || []).find(other => {
                if (!other || excludeIds.has(idOf(other.id))) return false;
                if (String(other.status || '').trim().toLowerCase() === 'cancelled') return false;
                if (intent.assignmentMode === 'room') {
                    if (isTakeawayRoom(candidate.next.room) || isTakeawayRoom(other.room)) return false;
                    if (!sameLine(other.room, candidate.next.room)) return false;
                } else if (!sameLine(other.lineId, candidate.next.lineId)) return false;
                if (candidate.next.date && other.date && String(other.date) !== String(candidate.next.date)) return false;
                const otherStart = timeToMinutesValue(other.time);
                const otherEnd = otherStart + (parseInt(other.duration, 10) || 0);
                if (!(start < otherEnd && end > otherStart)) return false;
                if (intent.assignmentMode !== 'room') return true;
                const policy = roomOverlapPolicy(candidate.next, other, {
                    banquetGroupId: candidate.isDragged ? intent.banquetGroupId : '',
                    bookingRole: candidate.isDragged ? intent.bookingRole : '',
                    sourceBookingId: candidate.isDragged ? intent.sourceBookingId : candidate.id
                });
                if (policy === 'defer') deferredToServer = true;
                return policy === 'block';
            });

            if (blocker) {
                return {
                    valid: false,
                    type: 'overlap',
                    candidate,
                    conflictBooking: blocker,
                    error: 'overlap'
                };
            }
        }

        for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
                const left = candidates[leftIndex];
                const right = candidates[rightIndex];
                if (left.next.date && right.next.date && String(left.next.date) !== String(right.next.date)) continue;
                if (intent.assignmentMode === 'room') {
                    if (isTakeawayRoom(left.next.room) || isTakeawayRoom(right.next.room)) continue;
                    if (!sameLine(left.next.room, right.next.room)) continue;
                } else if (!sameLine(left.next.lineId, right.next.lineId)) continue;
                const leftStart = timeToMinutesValue(left.next.time);
                const leftEnd = leftStart + (parseInt(left.next.duration, 10) || 0);
                const rightStart = timeToMinutesValue(right.next.time);
                const rightEnd = rightStart + (parseInt(right.next.duration, 10) || 0);
                if (!(leftStart < rightEnd && leftEnd > rightStart)) continue;
                if (intent.assignmentMode === 'room') {
                    const policy = roomOverlapPolicy(left.next, right.next);
                    if (policy === 'allow') continue;
                    if (policy === 'defer') {
                        deferredToServer = true;
                        continue;
                    }
                }
                return { valid: false, type: 'overlap', candidate: left, conflictBooking: right.next, error: 'overlap' };
            }
        }

        let pauseWarning = null;
        const minPause = Number(options.minPause || 0);
        if (minPause > 0 && intent.mainCandidate) {
            const candidate = intent.mainCandidate;
            const start = timeToMinutesValue(candidate.next.time);
            const end = start + (parseInt(candidate.next.duration, 10) || 0);
            pauseWarning = (allBookings || []).find(other => {
                if (!other || excludeIds.has(idOf(other.id))) return false;
                if (String(other.status || '').trim().toLowerCase() === 'cancelled') return false;
                if (intent.assignmentMode === 'room') {
                    if (isTakeawayRoom(candidate.next.room) || isTakeawayRoom(other.room)) return false;
                    if (!sameLine(other.room, candidate.next.room)) return false;
                } else if (!sameLine(other.lineId, candidate.next.lineId)) return false;
                const otherStart = timeToMinutesValue(other.time);
                const otherEnd = otherStart + (parseInt(other.duration, 10) || 0);
                const gap = Math.max(otherStart - end, start - otherEnd);
                return gap >= 0 && gap < minPause;
            }) || null;
        }

        return { valid: true, pauseWarning, deferredToServer };
    }

    return {
        timeToMinutesValue,
        minutesToTimeValue,
        addMinutesToTimeValue,
        resolveTimelineBookingGroup,
        buildDragInteractionIntent,
        buildDragAtomicPayload,
        buildDragUndoSnapshot,
        buildDragUndoAtomicPayload,
        buildDragChangeSet,
        formatDragChangeSummary,
        buildResizeInteractionIntent,
        buildResizeAtomicPayload,
        buildResizeUndoSnapshot,
        buildResizeUndoAtomicPayload,
        evaluateTimelineCandidateConflicts,
        banquetConflictMetadata,
        roomOverlapPolicy
    };
});
