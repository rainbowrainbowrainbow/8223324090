/**
 * Pure presentation resolver for timeline activity cards.
 */
(function(root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.TimelinePresentation = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    const CATEGORY_CODES = Object.freeze({
        quest: 'КВ',
        animation: 'АН',
        show: 'ШОУ',
        masterclass: 'МК',
        photo: 'ФОТО',
        pinata: 'П',
        custom: 'ІНШ',
        test: 'ІНШ'
    });

    const GENERIC_CATEGORY_CODES = new Set(Object.values(CATEGORY_CODES).map(value => value.toLocaleLowerCase('uk-UA')));

    function cleanText(value) {
        return String(value ?? '').replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function stripDurationText(value) {
        return cleanText(value)
            .replace(/\(\s*\d+\s*(?:хв|хв\.|min|m)?\s*\)/gi, '')
            .replace(/\d+\s*(?:хв\.?|min|m)(?=\s|$)/giu, '')
            .replace(/\s*[:–—-]\s*$/u, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function sliceGraphemes(value, limit) {
        return Array.from(cleanText(value)).slice(0, limit).join('');
    }

    function categoryCodeFor(category, haystack = '') {
        const normalized = cleanText(category).toLowerCase();
        if (CATEGORY_CODES[normalized]) return CATEGORY_CODES[normalized];
        const text = cleanText(haystack).toLocaleLowerCase('uk-UA');
        if (text.includes('квест')) return CATEGORY_CODES.quest;
        if (text.includes('анімац')) return CATEGORY_CODES.animation;
        if (text.includes('майстер')) return CATEGORY_CODES.masterclass;
        if (text.includes('фото')) return CATEGORY_CODES.photo;
        if (text.includes('пін')) return CATEGORY_CODES.pinata;
        if (text.includes('шоу') || text.includes('мафія')) return CATEGORY_CODES.show;
        return CATEGORY_CODES.custom;
    }

    function removeCategoryPrefix(value, categoryCode) {
        let code = stripDurationText(value);
        if (!code) return '';
        const normalized = code.toLocaleLowerCase('uk-UA');
        const normalizedCategory = cleanText(categoryCode).toLocaleLowerCase('uk-UA');
        if (normalizedCategory && normalized === normalizedCategory) return '';
        if (normalizedCategory && normalized.startsWith(`${normalizedCategory} `)) {
            return code.slice(categoryCode.length).trim();
        }
        if (normalizedCategory && normalized.startsWith(`${normalizedCategory}-`)) {
            return code.slice(categoryCode.length + 1).trim();
        }
        if (normalizedCategory === 'мк' && /^мк[^\s-]/iu.test(code)) {
            return code.slice(2).trim();
        }
        if (normalizedCategory === 'кв' && /^кв\s*\d+/iu.test(code)) {
            return code.replace(/^кв\s*/iu, '').trim();
        }
        if (normalizedCategory === 'шоу' && /^шоу\s*/iu.test(code)) {
            return code.replace(/^шоу\s*/iu, '').trim();
        }
        return code;
    }

    function acronymFromName(value, limit = 3) {
        const words = stripDurationText(value)
            .split(/\s+/u)
            .map(word => word.replace(/[^\p{L}\p{N}]+/gu, ''))
            .filter(word => word.length > 1 && !/^(мк|для|та|і|й|на|по|з|із|у|в)$/iu.test(word));
        if (!words.length) return '';
        return sliceGraphemes(words.map(word => Array.from(word)[0]).join('').toLocaleUpperCase('uk-UA'), limit);
    }

    function productCodeFromName(categoryCode, name, fallback = '') {
        const cleanedName = stripDurationText(name);
        const fallbackCode = removeCategoryPrefix(fallback, categoryCode);
        if (categoryCode === 'КВ') {
            const number = (fallbackCode.match(/\d+/u) || cleanedName.match(/\d+/u) || [])[0];
            if (number) return sliceGraphemes(number, 4);
        }
        if (categoryCode === 'АН') {
            const duration = (fallbackCode.match(/\d+/u) || cleanedName.match(/\d+/u) || [])[0];
            if (duration) return sliceGraphemes(duration, 4);
        }
        if (categoryCode === 'ШОУ') {
            return sliceGraphemes(acronymFromName(cleanedName, 3) || cleanedName, 3);
        }
        if (categoryCode === 'МК') {
            return acronymFromName(cleanedName, 3) || sliceGraphemes(cleanedName, 3);
        }
        if (categoryCode === 'ФОТО') return sliceGraphemes(acronymFromName(cleanedName, 3) || cleanedName, 3);
        if (categoryCode === 'П') return sliceGraphemes(fallbackCode || 'PRO', 4);
        return sliceGraphemes(fallbackCode || acronymFromName(cleanedName, 3) || cleanedName || 'Под', 6);
    }

    function pinataHelpers(options = {}) {
        return options.pinataNumbers
            || (typeof window !== 'undefined' && window.PinataNumbers)
            || (typeof globalThis !== 'undefined' && globalThis.PinataNumbers)
            || {};
    }

    function normalizePinataNumber(value, options = {}) {
        return pinataHelpers(options).normalize?.(value) || cleanText(value).replace(/^(?:№|#)\s*/u, '').trim();
    }

    function pinataNumberDisplay(value, options = {}) {
        return pinataHelpers(options).display?.(value) || normalizePinataNumber(value, options);
    }

    function pinataNumberValue(booking, renderBooking, textCandidates, options = {}) {
        return pinataHelpers(options).valueFromBooking?.(booking || {}, { renderBooking, textCandidates }) || '';
    }

    function isPinataActivity(source, booking, haystack, options = {}) {
        if (pinataHelpers(options).isPinataBooking?.(source || booking || {})) return true;
        const category = cleanText(source?.category || booking?.category).toLowerCase();
        return category === 'pinata' || cleanText(haystack).toLocaleLowerCase('uk-UA').includes('пін');
    }

    function composeCompactLabel(categoryCode, productCode) {
        const category = cleanText(categoryCode);
        const product = cleanText(productCode);
        if (!category) return product || 'Подія';
        return product ? `${category} ${product}` : category;
    }

    function resolveTimelineActivityPresentation(booking = {}, renderBooking = null, bookingTitle = '', bookingTitleTail = '', options = {}) {
        const source = renderBooking || booking || {};
        const category = cleanText(source.category || booking?.category).toLowerCase();
        const programCode = cleanText(source.programCode || source.program_code || booking?.programCode || booking?.program_code);
        const label = cleanText(source.label || bookingTitle || booking?.label);
        const rawName = cleanText(source.programName || source.program_name || bookingTitleTail || booking?.programName || booking?.program_name);
        const fullName = stripDurationText(rawName || bookingTitleTail || label || programCode);
        const haystack = `${category} ${programCode} ${label} ${rawName}`;
        const isPinata = isPinataActivity(source, booking, haystack, options);
        const categoryCode = isPinata ? CATEGORY_CODES.pinata : categoryCodeFor(category, haystack);
        const configuredCode = cleanText(source.timelineCode || source.timeline_code || booking?.timelineCode || booking?.timeline_code);
        const strippedConfigured = removeCategoryPrefix(configuredCode, categoryCode);
        const strippedProgram = removeCategoryPrefix(programCode || label, categoryCode);
        const pinataMode = cleanText(source.pinataMode || source.pinata_mode || booking?.pinataMode || booking?.pinata_mode).toLowerCase();
        const pinataNumber = isPinata ? pinataNumberValue(booking, source, [bookingTitle, bookingTitleTail, label, rawName, programCode], options) : '';

        let productCode = strippedConfigured || productCodeFromName(categoryCode, fullName || label, strippedProgram);
        if (isPinata && pinataMode === 'client') {
            productCode = 'КЛ';
        } else if (isPinata && pinataNumber) {
            productCode = normalizePinataNumber(pinataNumber, options);
        }
        productCode = sliceGraphemes(removeCategoryPrefix(productCode, categoryCode), 6);

        if (['КВ', 'МК', 'ШОУ'].includes(categoryCode) && !productCode) {
            productCode = productCodeFromName(categoryCode, fullName || label, strippedProgram || configuredCode);
        }
        if (GENERIC_CATEGORY_CODES.has(productCode.toLocaleLowerCase('uk-UA'))) {
            productCode = productCodeFromName(categoryCode, fullName || label, strippedProgram || configuredCode);
        }
        productCode = sliceGraphemes(productCode || productCodeFromName(categoryCode, fullName || label, strippedProgram || configuredCode), 6);

        const compactLabel = composeCompactLabel(categoryCode, productCode);
        const fullLabel = fullName
            ? `${compactLabel}: ${fullName}`
            : compactLabel;
        const pinataDetail = isPinata
            ? (pinataMode === 'client'
                ? 'Клієнтська піньята'
                : (pinataNumber ? `Піньята парку ${pinataNumberDisplay(pinataNumber, options)}` : 'Піньята парку'))
            : '';

        const time = cleanText(source.time || booking?.time);
        const duration = Number(source.duration || booking?.duration || 0);
        const room = cleanText(source.room || booking?.room);
        const status = cleanText(source.status || booking?.status);
        const linkedTo = cleanText(source.linkedTo || source.linked_to || booking?.linkedTo || booking?.linked_to);
        const detailParts = [
            fullLabel,
            time,
            Number.isFinite(duration) && duration > 0 ? `${duration} хв` : '',
            room,
            status,
            pinataDetail,
            linkedTo ? `Повʼязано з ${linkedTo}` : ''
        ].filter(Boolean);

        return {
            categoryCode,
            productCode,
            fullName,
            compactLabel,
            fullLabel,
            tooltip: detailParts.join(' · '),
            ariaLabel: detailParts.join(' · '),
            pinataDetail,
            code: compactLabel,
            name: fullName,
            fullTitle: fullLabel
        };
    }

    function timelineBookingBlockDensity(width) {
        const safeWidth = Number(width);
        if (!Number.isFinite(safeWidth) || safeWidth < 34) return 'micro';
        if (safeWidth < 72) return 'tiny';
        if (safeWidth < 132) return 'short';
        if (safeWidth < 220) return 'medium';
        return 'wide';
    }

    function estimateTextWidth(value) {
        return Array.from(cleanText(value)).reduce((total, character) => {
            return total + (/\s|[.,:;|]/u.test(character) ? 4 : 9);
        }, 0);
    }

    function timelineActivityBookingBlockDensity(width, baseDensity, presentation, duration) {
        if (baseDensity !== 'medium' && baseDensity !== 'wide') return baseDensity;
        const safeWidth = Number(width);
        const fullTitle = cleanText(presentation?.fullLabel || presentation?.fullTitle || presentation?.compactLabel || presentation?.code);
        if (!Number.isFinite(safeWidth) || !fullTitle) return 'short';
        const safeDuration = Number(duration);
        const durationBadgeWidth = Number.isFinite(safeDuration) && safeDuration > 0
            ? (Array.from(`${safeDuration}хв`).length * 7) + 14
            : 0;
        const availableContentWidth = Math.max(0, safeWidth - 24);
        return estimateTextWidth(fullTitle) + durationBadgeWidth <= availableContentWidth ? baseDensity : 'short';
    }

    return {
        CATEGORY_CODES,
        stripDurationText,
        removeCategoryPrefix,
        resolveTimelineActivityPresentation,
        timelineBookingBlockDensity,
        timelineActivityBookingBlockDensity
    };
});
