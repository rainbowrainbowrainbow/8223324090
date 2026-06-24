/**
 * Shared event card resolver.
 *
 * Keeps card selection in one place for programs, bookings, leads, and afisha
 * records without requiring backend or schema changes.
 */
(function (root) {
    'use strict';

    const EVENT_CARD_BASE_PATH = '/images/event-cards/';
    const EVENT_CARD_FILES = Object.freeze({
        holidayParty: 'event-card-holiday-party.png',
        showProgram: 'event-card-show-program.png',
        familyEvent: 'event-card-family-event.png',
        workshop: 'event-card-workshop.png',
        privateParty: 'event-card-private-party.png',
        quest: 'event-card-quest.png'
    });

    const EVENT_CARDS = Object.freeze({
        'holiday-party': Object.freeze({
            key: 'holiday-party',
            file: EVENT_CARD_FILES.holidayParty,
            src: `${EVENT_CARD_BASE_PATH}${EVENT_CARD_FILES.holidayParty}`,
            alt: 'Зображення святкового заходу'
        }),
        'show-program': Object.freeze({
            key: 'show-program',
            file: EVENT_CARD_FILES.showProgram,
            src: `${EVENT_CARD_BASE_PATH}${EVENT_CARD_FILES.showProgram}`,
            alt: 'Зображення шоу-програми'
        }),
        'family-event': Object.freeze({
            key: 'family-event',
            file: EVENT_CARD_FILES.familyEvent,
            src: `${EVENT_CARD_BASE_PATH}${EVENT_CARD_FILES.familyEvent}`,
            alt: 'Зображення сімейного заходу'
        }),
        workshop: Object.freeze({
            key: 'workshop',
            file: EVENT_CARD_FILES.workshop,
            src: `${EVENT_CARD_BASE_PATH}${EVENT_CARD_FILES.workshop}`,
            alt: 'Зображення майстер-класу'
        }),
        'private-party': Object.freeze({
            key: 'private-party',
            file: EVENT_CARD_FILES.privateParty,
            src: `${EVENT_CARD_BASE_PATH}${EVENT_CARD_FILES.privateParty}`,
            alt: 'Зображення приватної вечірки'
        }),
        quest: Object.freeze({
            key: 'quest',
            file: EVENT_CARD_FILES.quest,
            src: `${EVENT_CARD_BASE_PATH}${EVENT_CARD_FILES.quest}`,
            alt: 'Зображення квесту'
        })
    });

    const FALLBACK_CARD_KEY = 'holiday-party';

    const DIRECT_FIELD_KEYS = Object.freeze([
        'type',
        'eventType',
        'event_type',
        'category',
        'qualityCategory',
        'quality_category',
        'programName',
        'program_name',
        'programCode',
        'program_code',
        'label',
        'title',
        'name',
        'description',
        'notes',
        'comment',
        'requestTopic',
        'request_topic',
        'topic',
        'sessionType',
        'session_type',
        'serviceType',
        'service_type'
    ]);

    const NESTED_FIELD_KEYS = Object.freeze([
        'extraData',
        'extra_data',
        'bookingPackage',
        'booking_package',
        'inbound'
    ]);

    const CATEGORY_CARD_KEYS = Object.freeze({
        birthday: 'holiday-party',
        photo: 'holiday-party',
        quest: 'quest',
        masterclass: 'workshop',
        workshop: 'workshop',
        craft: 'workshop',
        show: 'show-program',
        animation: 'show-program',
        animator: 'show-program',
        program: 'show-program',
        family: 'family-event',
        corporate: 'private-party',
        private: 'private-party',
        vip: 'private-party',
        banquet: 'private-party'
    });

    const KEYWORD_RULES = Object.freeze([
        Object.freeze({
            key: 'quest',
            terms: Object.freeze(['квест', 'quest', 'детектив', 'пошук скарбів', 'treasure', 'escape'])
        }),
        Object.freeze({
            key: 'workshop',
            terms: Object.freeze(['майстер-клас', 'майстер клас', 'мастер-класс', 'мастер класс', 'workshop', 'craft', 'творчість', 'арт', 'hand-made', 'hand made'])
        }),
        Object.freeze({
            key: 'private-party',
            terms: Object.freeze(['приватна вечірка', 'private', 'vip', 'закрита вечірка', 'тематична вечірка', 'корпоратив'])
        }),
        Object.freeze({
            key: 'family-event',
            terms: Object.freeze(['сімейне', 'сімейний захід', 'family', 'родинне', 'дитяче сімейне'])
        }),
        Object.freeze({
            key: 'show-program',
            terms: Object.freeze(['шоу-програма', 'шоу програма', 'шоу', 'аніматор', 'аніматори', 'анімація', 'вистава', 'program', 'show'])
        }),
        Object.freeze({
            key: 'holiday-party',
            terms: Object.freeze(['день народження', 'свято', 'святкова вечірка', 'party', 'birthday', 'фотозона'])
        })
    ]);

    function normalizeText(value) {
        return String(value ?? '')
            .normalize('NFKC')
            .replace(/[’`´]/g, "'")
            .replace(/[_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLocaleLowerCase('uk-UA');
    }

    function parseJsonObject(value) {
        if (!value || typeof value !== 'string') return null;
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch (err) {
            return null;
        }
    }

    function collectStringValues(source, depth = 0, output = []) {
        if (!source) return output;
        if (typeof source === 'string' || typeof source === 'number') {
            const text = normalizeText(source);
            if (text) output.push(text);
            return output;
        }

        if (depth > 3) return output;

        if (Array.isArray(source)) {
            source.slice(0, 12).forEach(item => collectStringValues(item, depth + 1, output));
            return output;
        }

        if (typeof source !== 'object') return output;

        DIRECT_FIELD_KEYS.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                collectStringValues(source[key], depth + 1, output);
            }
        });

        NESTED_FIELD_KEYS.forEach(key => {
            const value = source[key];
            const nested = parseJsonObject(value) || value;
            if (nested && typeof nested === 'object') {
                collectStringValues(nested, depth + 1, output);
            }
        });

        return output;
    }

    function categoryCardKey(event = {}) {
        const category = normalizeText(
            event.category
            || event.qualityCategory
            || event.quality_category
            || event.type
            || event.eventType
            || event.event_type
        );
        return CATEGORY_CARD_KEYS[category] || '';
    }

    function keywordCardKey(haystack) {
        return KEYWORD_RULES.find(rule => rule.terms.some(term => haystack.includes(normalizeText(term))))?.key || '';
    }

    function resolveEventCardKey(event = {}) {
        const directKey = categoryCardKey(event);
        if (directKey) return directKey;

        const haystack = collectStringValues(event).join(' ');
        if (!haystack) return FALLBACK_CARD_KEY;

        return keywordCardKey(haystack) || FALLBACK_CARD_KEY;
    }

    function getEventCardMeta(event = {}) {
        return EVENT_CARDS[resolveEventCardKey(event)] || EVENT_CARDS[FALLBACK_CARD_KEY];
    }

    function getEventCard(event = {}) {
        return getEventCardMeta(event).src;
    }

    function getEventCardFile(event = {}) {
        return getEventCardMeta(event).file;
    }

    const api = {
        EVENT_CARD_BASE_PATH,
        EVENT_CARD_FILES,
        EVENT_CARDS,
        getEventCard,
        getEventCardFile,
        getEventCardMeta,
        resolveEventCardKey
    };

    root.EventCards = api;
    root.getEventCard = getEventCard;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
