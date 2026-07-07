(function(root) {
    'use strict';

    const SAFE_INVITE_KEYS = Object.freeze(['date', 'time', 'end', 'arrival', 'program', 'room', 'card']);

    function cleanText(value) {
        return String(value || '').trim();
    }

    function cleanInviteTime(value) {
        const raw = cleanText(value);
        const match = raw.match(/^(\d{1,2}):(\d{2})/);
        if (!match) return '';
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    function buildInviteParams(data) {
        const params = new URLSearchParams();
        SAFE_INVITE_KEYS.forEach((key) => {
            const value = cleanText(data && data[key]);
            if (key === 'arrival' && !value) return;
            params.set(key, value);
        });
        return params;
    }

    function buildInviteUrl(data, origin) {
        const path = `/invite?${buildInviteParams(data).toString()}`;
        const normalizedOrigin = cleanText(origin).replace(/\/+$/, '');
        return normalizedOrigin ? `${normalizedOrigin}${path}` : path;
    }

    function inviteTimeRange(start, end) {
        const startLabel = cleanText(start);
        const endLabel = cleanText(end);
        return startLabel && endLabel && startLabel !== endLabel
            ? `${startLabel} - ${endLabel}`
            : startLabel;
    }

    function inviteTimeDisplayLines(timeRangeLabel, arrivalLabel) {
        if (arrivalLabel) {
            return [
                `Прихід гостей: ${arrivalLabel}`,
                timeRangeLabel && timeRangeLabel !== arrivalLabel ? `Час активності: ${timeRangeLabel}` : ''
            ].filter(Boolean);
        }
        return timeRangeLabel ? [`Час: ${timeRangeLabel}`] : [];
    }

    function inviteConfigRows(rows) {
        return Array.isArray(rows) ? rows.filter(Boolean) : [];
    }

    function inviteAddress(config) {
        const rows = inviteConfigRows(config && config.location && config.location.rows);
        const addressRow = rows.find((row) => cleanText(row.label).toLowerCase() === 'адреса');
        return cleanText(addressRow && addressRow.value);
    }

    function resolveInviteCardKey(record, eventCards) {
        const cardsApi = eventCards || root.EventCards || {};
        const candidate = cardsApi.resolveEventCardKey && cardsApi.resolveEventCardKey(record || {});
        return cardsApi.EVENT_CARDS && cardsApi.EVENT_CARDS[candidate] && cardsApi.EVENT_CARDS[candidate].key
            ? cardsApi.EVENT_CARDS[candidate].key
            : 'holiday-party';
    }

    function buildInviteSharePayload(data, config, origin) {
        const safeData = {};
        SAFE_INVITE_KEYS.forEach((key) => {
            safeData[key] = cleanText(data && data[key]);
        });

        const inviteUrl = buildInviteUrl(safeData);
        const fullInviteUrl = buildInviteUrl(
            safeData,
            origin || (root.location && root.location.origin) || ''
        );
        const programLabel = safeData.program || 'подію';
        const roomLabel = safeData.room;
        const dateLabel = safeData.date;
        const timeLabel = safeData.time;
        const endLabel = safeData.end;
        const arrivalLabel = cleanInviteTime(safeData.arrival);
        safeData.arrival = arrivalLabel;
        const timeRangeLabel = inviteTimeRange(timeLabel, endLabel);
        const timeLines = inviteTimeDisplayLines(timeRangeLabel, arrivalLabel);
        const shareTitle = cleanText(config && config.shareTitle)
            || cleanText(config && config.brandName)
            || 'Event Genix';
        const fallbackText = cleanText(config && config.shareFallbackText) || 'Запрошуємо на подію!';
        const address = inviteAddress(config);

        const addressLabel = address ? ` Адреса: ${address}.` : '';
        const shortTimeText = timeLines.length ? ` ${timeLines.join('. ')}.` : '';
        const shortText = `Запрошуємо на ${programLabel}${dateLabel ? ` ${dateLabel}` : ''}.${shortTimeText}${roomLabel ? ` Кімната: ${roomLabel}.` : ''}${addressLabel} ${fullInviteUrl}`;
        const messengerLines = [
            `Вітаємо! Запрошуємо на ${programLabel}.`,
            `Дата: ${dateLabel || '-'}`,
            ...timeLines,
            roomLabel ? `Кімната: ${roomLabel}` : '',
            address ? `Адреса: ${address}` : '',
            `Деталі: ${fullInviteUrl}`
        ].filter(Boolean);
        const instagramTime = arrivalLabel
            ? ` · Прихід гостей ${arrivalLabel}${timeRangeLabel && timeRangeLabel !== arrivalLabel ? ` · ${timeRangeLabel}` : ''}`
            : (timeRangeLabel ? ` · ${timeRangeLabel}` : '');
        const instagramText = `${programLabel}${dateLabel ? ` · ${dateLabel}` : ''}${instagramTime}${roomLabel ? ` · ${roomLabel}` : ''}\n${fullInviteUrl}`;

        return {
            params: buildInviteParams(safeData),
            inviteUrl,
            fullInviteUrl,
            programLabel,
            roomLabel,
            dateLabel,
            timeLabel,
            endLabel,
            arrivalLabel,
            timeRangeLabel,
            shareTitle,
            fallbackText,
            address,
            shortText,
            messengerText: messengerLines.join('\n'),
            instagramText
        };
    }

    function bookingInviteSnapshotArrival(snapshot) {
        const raw = snapshot?.arrival || snapshot?.banquetArrival || snapshot?.group?.arrival || snapshot?.group?.banquetArrival;
        if (!raw || typeof raw !== 'object') return null;
        const time = cleanInviteTime(raw.time);
        if (!time) return null;
        return {
            time,
            date: cleanText(raw.date).slice(0, 10),
            room: cleanText(raw.room)
        };
    }

    function bookingInviteSnapshotRole(snapshot, booking = {}) {
        const bookingId = cleanText(booking.id || booking.bookingId || booking.booking_id);
        if (!bookingId || !Array.isArray(snapshot?.members)) return '';
        const member = snapshot.members.find(item => {
            return cleanText(item?.bookingId || item?.booking_id || item?.booking?.id || item?.booking?.bookingId) === bookingId;
        });
        return cleanText(member?.role);
    }

    function bookingInviteHasMeaningfulActivityTime(booking = {}, snapshot = null, arrival = null) {
        if (!arrival) return true;
        const role = bookingInviteSnapshotRole(snapshot, booking);
        if (role === 'activity') return true;
        const category = cleanText(booking.category || booking.category_id).toLowerCase();
        if (['banquet', 'kitchen', 'service', 'graduation'].includes(category)) return false;
        return Boolean(booking.programName || booking.program_name || booking.programId || booking.program_id || booking.label);
    }

    function buildBookingDetailsInviteModel(input, config, origin, eventCards) {
        const booking = input && input.booking ? input.booking : {};
        const eventCardRecord = input && input.eventCardRecord ? input.eventCardRecord : booking;
        const banquetSnapshot = input && (input.banquetSnapshot || input.snapshot);
        const arrival = bookingInviteSnapshotArrival(banquetSnapshot) || bookingInviteSnapshotArrival(input);
        const hasActivityTime = bookingInviteHasMeaningfulActivityTime(booking, banquetSnapshot, arrival);
        const cardKey = resolveInviteCardKey(eventCardRecord, eventCards);
        const safeData = {
            date: cleanText(arrival?.date || booking.date),
            time: hasActivityTime ? cleanText(booking.time) : '',
            end: hasActivityTime ? cleanText(input && input.endTimeLabel) : '',
            arrival: cleanText(arrival?.time),
            program: cleanText(booking.programName || booking.label),
            room: cleanText(arrival?.room || booking.room),
            card: cardKey
        };
        const payload = buildInviteSharePayload(safeData, config, origin);
        const previewChips = [
            payload.dateLabel,
            payload.arrivalLabel ? `Прихід гостей ${payload.arrivalLabel}` : '',
            payload.timeRangeLabel,
            payload.programLabel,
            payload.roomLabel
        ].map(cleanText).filter(Boolean);

        return {
            cardKey,
            publicData: safeData,
            payload,
            previewChips
        };
    }

    const api = Object.freeze({
        SAFE_INVITE_KEYS,
        buildInviteParams,
        buildInviteUrl,
        buildInviteSharePayload,
        buildBookingDetailsInviteModel
    });

    root.InviteShare = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
