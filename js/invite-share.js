(function(root) {
    'use strict';

    const SAFE_INVITE_KEYS = Object.freeze(['date', 'time', 'end', 'program', 'room', 'card']);

    function cleanText(value) {
        return String(value || '').trim();
    }

    function buildInviteParams(data) {
        const params = new URLSearchParams();
        SAFE_INVITE_KEYS.forEach((key) => {
            params.set(key, cleanText(data && data[key]));
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
        const timeRangeLabel = inviteTimeRange(timeLabel, endLabel);
        const shareTitle = cleanText(config && config.shareTitle)
            || cleanText(config && config.brandName)
            || 'Event Genix';
        const fallbackText = cleanText(config && config.shareFallbackText) || 'Запрошуємо на подію!';
        const address = inviteAddress(config);

        const addressLabel = address ? ` Адреса: ${address}.` : '';
        const shortText = `Запрошуємо на ${programLabel}${dateLabel ? ` ${dateLabel}` : ''}${timeRangeLabel ? ` о ${timeRangeLabel}` : ''}.${roomLabel ? ` Кімната: ${roomLabel}.` : ''}${addressLabel} ${fullInviteUrl}`;
        const messengerLines = [
            `Вітаємо! Запрошуємо на ${programLabel}.`,
            `Дата: ${dateLabel || '-'}`,
            `Час: ${timeRangeLabel || '-'}`,
            roomLabel ? `Кімната: ${roomLabel}` : '',
            address ? `Адреса: ${address}` : '',
            `Деталі: ${fullInviteUrl}`
        ].filter(Boolean);
        const instagramText = `${programLabel}${dateLabel ? ` · ${dateLabel}` : ''}${timeRangeLabel ? ` · ${timeRangeLabel}` : ''}${roomLabel ? ` · ${roomLabel}` : ''}\n${fullInviteUrl}`;

        return {
            params: buildInviteParams(safeData),
            inviteUrl,
            fullInviteUrl,
            programLabel,
            roomLabel,
            dateLabel,
            timeLabel,
            endLabel,
            timeRangeLabel,
            shareTitle,
            fallbackText,
            address,
            shortText,
            messengerText: messengerLines.join('\n'),
            instagramText
        };
    }

    function buildBookingDetailsInviteModel(input, config, origin, eventCards) {
        const booking = input && input.booking ? input.booking : {};
        const eventCardRecord = input && input.eventCardRecord ? input.eventCardRecord : booking;
        const cardKey = resolveInviteCardKey(eventCardRecord, eventCards);
        const safeData = {
            date: cleanText(booking.date),
            time: cleanText(booking.time),
            end: cleanText(input && input.endTimeLabel),
            program: cleanText(booking.programName || booking.label),
            room: cleanText(booking.room),
            card: cardKey
        };
        const payload = buildInviteSharePayload(safeData, config, origin);
        const previewChips = [
            payload.dateLabel,
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
