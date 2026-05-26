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
        const draggedIsMain = sameId(actorId, mainId);

        const candidates = groupBookings.map(booking => {
            const isMain = sameId(booking.id, mainId);
            const isDragged = sameId(booking.id, actorId);
            let nextTime = booking.time;
            let nextLineId = booking.lineId;

            if (isDragged) {
                nextTime = targetTime;
                if (lineChanged) nextLineId = targetLineId;
            } else if (timeDelta !== 0) {
                nextTime = addMinutesToTimeValue(booking.time, timeDelta);
            }

            return {
                id: booking.id,
                isMain,
                isDragged,
                old: booking,
                next: {
                    ...booking,
                    time: nextTime,
                    lineId: nextLineId
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
            candidates,
            mainCandidate,
            linkedCandidates
        };
    }

    function buildDragAtomicPayload(intent, historyData = null) {
        const mainPatch = {};
        const linked = [];

        if (intent.draggedIsMain) {
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
            if (candidate.isDragged && intent.lineChanged) {
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
                oldLineId: intent.startLineId,
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
            linked: intent.linkedCandidates.map(candidate => {
                const savedRow = savedLinked.get(idOf(candidate.id));
                return {
                    id: candidate.id,
                    oldTime: candidate.old.time,
                    oldLineId: candidate.old.lineId,
                    newTime: savedRow?.time || candidate.next.time,
                    newLineId: savedRow?.lineId || candidate.next.lineId
                };
            })
        };
    }

    function buildDragUndoAtomicPayload(snapshot, currentBooking = null) {
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

    function buildResizeInteractionIntent(input = {}) {
        const booking = input.booking;
        const group = resolveTimelineBookingGroup(booking, input.allBookings || []);
        const mainBooking = group.mainBooking || booking;
        const mainId = idOf(mainBooking?.id);
        const newDuration = parseInt(input.newDuration, 10);
        const groupBookings = uniqueBookings([mainBooking, ...group.groupBookings]);
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

        for (const candidate of intent.candidates || []) {
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
                if (other.status === 'cancelled') return false;
                if (!sameLine(other.lineId, candidate.next.lineId)) return false;
                if (candidate.next.date && other.date && String(other.date) !== String(candidate.next.date)) return false;
                const otherStart = timeToMinutesValue(other.time);
                const otherEnd = otherStart + (parseInt(other.duration, 10) || 0);
                return start < otherEnd && end > otherStart;
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

        let pauseWarning = null;
        const minPause = Number(options.minPause || 0);
        if (minPause > 0 && intent.mainCandidate) {
            const candidate = intent.mainCandidate;
            const start = timeToMinutesValue(candidate.next.time);
            const end = start + (parseInt(candidate.next.duration, 10) || 0);
            pauseWarning = (allBookings || []).find(other => {
                if (!other || excludeIds.has(idOf(other.id))) return false;
                if (other.status === 'cancelled') return false;
                if (!sameLine(other.lineId, candidate.next.lineId)) return false;
                const otherStart = timeToMinutesValue(other.time);
                const otherEnd = otherStart + (parseInt(other.duration, 10) || 0);
                const gap = Math.max(otherStart - end, start - otherEnd);
                return gap >= 0 && gap < minPause;
            }) || null;
        }

        return { valid: true, pauseWarning };
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
        buildResizeInteractionIntent,
        buildResizeAtomicPayload,
        buildResizeUndoSnapshot,
        buildResizeUndoAtomicPayload,
        evaluateTimelineCandidateConflicts
    };
});
