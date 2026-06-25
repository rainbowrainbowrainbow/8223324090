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
        event: 'holiday-party',
        regular: 'holiday-party',
        photo: 'holiday-party',
        pinata: 'holiday-party',
        quest: 'quest',
        masterclass: 'workshop',
        workshop: 'workshop',
        craft: 'workshop',
        education: 'workshop',
        lesson: 'workshop',
        show: 'show-program',
        animation: 'show-program',
        animator: 'show-program',
        program: 'show-program',
        family: 'family-event',
        graduation: 'family-event',
        trip: 'family-event',
        offsite: 'family-event',
        corporate: 'private-party',
        private: 'private-party',
        vip: 'private-party',
        mafia: 'private-party',
        '\u043c\u0430\u0444\u0456\u044f': 'private-party',
        banquet: 'private-party'
    });

    const KEYWORD_RULES = Object.freeze([
        Object.freeze({
            key: 'quest',
            terms: Object.freeze([
                '\u043a\u04321',
                '\u043a\u04324',
                '\u043a\u04325',
                '\u043a\u04326',
                '\u043a\u04327',
                '\u043a\u04328',
                '\u043a\u04329',
                '\u043a\u043210',
                '\u043a\u043211'
            ])
        }),
        Object.freeze({
            key: 'workshop',
            terms: Object.freeze([
                '\u043c\u043a',
                '\u0437\u0430\u043d\u044f\u0442\u0442\u044f',
                '\u0443\u0440\u043e\u043a',
                '\u043f\u0440\u0430\u043a\u0442\u0438\u043a\u0430',
                'lesson',
                'practice'
            ])
        }),
        Object.freeze({
            key: 'family-event',
            terms: Object.freeze([
                'graduation',
                '\u0432\u0438\u043f\u0443\u0441\u043a\u043d\u0438\u0439',
                '\u0432\u0438\u043f\u0443\u0441\u043a\u043d\u0435',
                'trip',
                '\u0432\u0438\u0457\u0437\u0434',
                'offsite'
            ])
        }),
        Object.freeze({
            key: 'show-program',
            terms: Object.freeze([
                '\u0430\u043d(',
                '\u0430\u043d2',
                '\u0434\u043e\u0434\u0430\u0442\u043a\u043e\u0432\u0438\u0439 \u0432\u0435\u0434\u0443\u0447\u0438\u0439',
                '\u0432\u0435\u0434\u0443\u0447\u0438\u0439',
                '\u0431\u0443\u043b\u044c\u0431\u0430\u0448\u043a\u043e\u0432\u0435 \u0448\u043e\u0443',
                '\u0441\u0443\u0445\u0438\u043c \u043b\u044c\u043e\u0434\u043e\u043c',
                '\u043d\u0435\u043e\u043d'
            ])
        }),
        Object.freeze({
            key: 'holiday-party',
            terms: Object.freeze([
                '\u0434\u0440',
                '\u043f\u0456\u043d\u044c\u044f\u0442\u0430',
                'pinata',
                '\u0444\u043e\u0442\u043e\u0441\u0435\u0441\u0456\u044f',
                '\u0444\u043e\u0442\u043e\u0433\u0440\u0430\u0444'
            ])
        }),
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
            terms: Object.freeze(['приватна вечірка', 'private', 'vip', 'закрита вечірка', 'тематична вечірка', 'корпоратив', 'мафія', 'mafia'])
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

    function escapeHtmlAttribute(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderEventCardImage(event = {}, options = {}) {
        const renderOptions = options && typeof options === 'object' ? options : {};
        const card = getEventCardMeta(event);
        const modifier = String(renderOptions.modifier || '').trim();
        const extraClassName = String(renderOptions.className || '').trim();
        const classNames = ['event-card-visual'];
        if (modifier) classNames.push(`event-card-visual--${modifier}`);
        if (extraClassName) classNames.push(extraClassName);
        const alt = renderOptions.alt || card.alt || 'Р—РѕР±СЂР°Р¶РµРЅРЅСЏ С‚РёРїСѓ Р·Р°С…РѕРґСѓ';
        const loading = renderOptions.loading === 'eager' ? 'eager' : 'lazy';
        const decoding = ['async', 'auto', 'sync'].includes(renderOptions.decoding) ? renderOptions.decoding : 'async';

        return `
        <div class="${escapeHtmlAttribute(classNames.join(' '))}">
            <img src="${escapeHtmlAttribute(card.src)}" alt="${escapeHtmlAttribute(alt)}" loading="${loading}" decoding="${decoding}">
        </div>
    `;
    }

    const api = {
        EVENT_CARD_BASE_PATH,
        EVENT_CARD_FILES,
        EVENT_CARDS,
        getEventCard,
        getEventCardFile,
        getEventCardMeta,
        renderEventCardImage,
        resolveEventCardKey
    };

    root.EventCards = api;
    root.getEventCard = getEventCard;
    root.renderEventCardImage = renderEventCardImage;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
