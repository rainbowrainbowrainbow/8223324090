(function () {
    'use strict';

    const MAX_SELECTED_IMPACTS = 5;

    const GROUPS = Object.freeze([
        { id: 'context', label: 'Контекст' },
        { id: 'activity', label: 'Діяльність' },
        { id: 'outcome', label: 'Результат' },
        { id: 'personal', label: 'Особисте' },
        { id: 'custom', label: 'Мої впливи' }
    ]);

    const ICONS = Object.freeze({
        park: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3 6.3 17.7"/>',
        crm: '<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 9h8M8 13h5M8 17h7"/>',
        hermes: '<path d="m13.5 2-8 12h6l-1 8 8-12h-6z"/>',
        processes: '<path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h8M16 18h4"/><circle cx="16" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="14" cy="18" r="2"/>',
        ai: '<rect x="5" y="7" width="14" height="12" rx="3"/><path d="M9 3h6M12 3v4M8.5 12h.01M15.5 12h.01M9 16h6"/>',
        development: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
        analytics: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
        media: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>',
        marketing: '<path d="m4 13 12-6v10L4 11zM16 10h3a2 2 0 0 1 0 4h-3M6 13l1.5 6h4L10 12"/>',
        team: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M14 15a4.5 4.5 0 0 1 6.5 4"/>',
        strategy: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
        sales: '<circle cx="11" cy="12" r="8"/><circle cx="11" cy="12" r="4"/><path d="m14 9 7-7M16 2h5v5"/>',
        finance: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/>',
        quality: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
        system: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
        speed: '<path d="M14 4c3-1 5-1 6-1 0 1 0 3-1 6l-7 7-4-4zM14 4l6 6M8 12l-4 1-2 3 6 1M12 16l1 6 3-2 1-4"/><circle cx="14.5" cy="8.5" r="1.5"/>',
        brand: '<path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
        security: '<path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6z"/><rect x="9" y="10" width="6" height="5" rx="1"/><path d="M10.5 10V8.5a1.5 1.5 0 0 1 3 0V10"/>',
        health: '<path d="M20 8.5c0 5-8 10-8 10s-8-5-8-10A4.5 4.5 0 0 1 12 5a4.5 4.5 0 0 1 8 3.5z"/>',
        fitness: '<path d="M3 10v4M6 8v8M18 8v8M21 10v4M6 12h12"/>',
        recovery: '<path d="M20 4C11 4 5 8 5 15c0 3 2 5 5 5 7 0 10-7 10-16zM5 19c3-5 7-8 12-11"/>',
        home: '<path d="m3 11 9-7 9 7M5 10v10h14V10M9 20v-6h6v6"/>',
        learning: '<path d="M4 5h6a3 3 0 0 1 3 3v11a3 3 0 0 0-3-3H4zM20 5h-4a3 3 0 0 0-3 3v11a3 3 0 0 1 3-3h4z"/>',
        relationships: '<path d="M12 20S4 15 4 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15 12 20 12 20z"/><path d="M9 11h6"/>',
        hr: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 8h5M18.5 5.5v5"/>',
        legal: '<path d="M12 3v18M7 5h10M5 8l-3 6h6zM19 8l-3 6h6zM7 21h10"/>',
        procurement: '<circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M3 4h2l2 11h11l2-7H6M9 8h8"/>',
        network: '<circle cx="5" cy="12" r="3"/><circle cx="19" cy="6" r="3"/><circle cx="19" cy="18" r="3"/><path d="m8 11 8-4M8 13l8 4"/>',
        creativity: '<path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8zM6 15l.7 1.8 1.8.7-1.8.7L6 20l-.7-1.8-1.8-.7 1.8-.7z"/>',
        travel: '<path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
        community: '<circle cx="12" cy="7" r="3"/><circle cx="5" cy="10" r="2"/><circle cx="19" cy="10" r="2"/><path d="M6 20a6 6 0 0 1 12 0M1.5 19a4 4 0 0 1 5-3.8M22.5 19a4 4 0 0 0-5-3.8"/>',
        balance: '<circle cx="12" cy="12" r="9"/><path d="M12 3a4.5 4.5 0 0 1 0 9 4.5 4.5 0 0 0 0 9M12 7h.01M12 17h.01"/>',
        custom: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/>'
    });

    const META = new Map();
    const register = (group, icon, names) => names.forEach(name => META.set(normalize(name), { group, icon }));

    register('context', 'park', ['Робота: Парк', 'Парк робота']);
    register('context', 'crm', ['Робота: CRM', 'CRM']);
    register('context', 'hermes', ['Робота: Hermes', 'Hermes']);
    register('activity', 'processes', ['Операційка / процеси']);
    register('activity', 'ai', ['Автоматизація / AI']);
    register('activity', 'development', ['Продукт / розробка']);
    register('activity', 'analytics', ['Аналітика / рішення']);
    register('activity', 'media', ['Контент / медіа']);
    register('activity', 'marketing', ['Маркетинг / залучення']);
    register('activity', 'team', ['Команда / делегування', 'Команда і делегування']);
    register('activity', 'strategy', ['Стратегія / пріоритети']);
    register('activity', 'hr', ['Люди / HR']);
    register('activity', 'legal', ['Документи / право']);
    register('activity', 'procurement', ['Закупівлі / постачання']);
    register('activity', 'network', ['Партнерства / нетворкінг']);
    register('outcome', 'sales', ['Продажі / клієнти', 'Дохід і клієнти', 'Гроші / продажі']);
    register('outcome', 'finance', ['Фінанси / облік']);
    register('outcome', 'quality', ['Якість сервісу']);
    register('outcome', 'system', ['Системність', 'Фокус / організація']);
    register('outcome', 'speed', ['Швидкість / ефективність', 'Швидкість роботи']);
    register('outcome', 'brand', ['Бренд / репутація', 'Особистий бренд', 'Репутація / бренд']);
    register('outcome', 'security', ['Ризики / безпека', 'Ризики і безпека']);
    register('personal', 'health', ['Здоровʼя', "Здоров'я", 'Здоровʼя та енергія']);
    register('personal', 'fitness', ['Фізична форма']);
    register('personal', 'recovery', ['Відновлення']);
    register('personal', 'home', ['Побут / комфорт', 'Побут і комфорт']);
    register('personal', 'learning', ['Навчання / розвиток', 'Навчання', 'Навчання / ріст']);
    register('personal', 'relationships', ['Близькі / стосунки', 'Стосунки та сімʼя', "Стосунки та сім'я"]);
    register('personal', 'creativity', ['Творчість / самовираження']);
    register('personal', 'travel', ['Подорожі / враження']);
    register('personal', 'community', ['Спільнота / внесок']);
    register('personal', 'balance', ['Баланс / сенси']);

    const EMOJI_ALIASES = Object.freeze({
        '🎡': 'park', '🗂️': 'crm', '⚡': 'hermes', '⚙️': 'processes', '🤖': 'ai', '💻': 'development',
        '📊': 'analytics', '🎬': 'media', '📣': 'marketing', '👥': 'team', '🧭': 'strategy', '🎯': 'sales',
        '💰': 'finance', '⭐': 'quality', '🧩': 'system', '🚀': 'speed', '🏆': 'brand', '🛡️': 'security',
        '❤️': 'health', '💪': 'fitness', '🌿': 'recovery', '🏠': 'home', '🧠': 'learning', '🤝': 'relationships'
    });

    function normalize(value) {
        return String(value || '').normalize('NFKC').trim().replace(/[\u02BC\u2019\u2018`\u00B4]/g, "'").replace(/\s+/g, ' ').toLocaleLowerCase('uk-UA');
    }

    function metaFor(record = {}) {
        const byName = META.get(normalize(record.name));
        const rawIcon = String(record.icon || '').trim();
        const icon = ICONS[rawIcon] ? rawIcon : (EMOJI_ALIASES[rawIcon] || byName?.icon || 'custom');
        return { group: byName?.group || 'custom', icon };
    }

    function render(record = {}, options = {}) {
        const meta = metaFor(record);
        const size = Number(options.size || 18);
        return `<svg class="my-day-impact-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-my-day-impact-icon="${meta.icon}">${ICONS[meta.icon]}</svg>`;
    }

    function choices() {
        return Object.keys(ICONS).filter(key => key !== 'custom');
    }

    window.MyDayImpactIcons = { GROUPS, MAX_SELECTED_IMPACTS, choices, metaFor, render };
}());
