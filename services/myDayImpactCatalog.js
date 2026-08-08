'use strict';

const CANONICAL_MY_DAY_IMPACTS = Object.freeze([
    impact('Робота: Парк', '#10B981', '🎡', 10, 'context', ['парк', 'каса парку', 'атракціони', 'бронювання парку', 'зміна парку']),
    impact('Робота: CRM', '#2563EB', '🗂️', 20, 'context', ['crm', 'ліди', 'клієнтська база', 'воронка продажів']),
    impact('Робота: Hermes', '#8B5CF6', '⚡', 30, 'context', ['hermes', 'worker', 'telegram', 'сповіщення']),

    impact('Операційка / процеси', '#64748B', '⚙️', 110, 'activity', ['операційка', 'процес', 'регламент', 'чекліст', 'порядок виконання']),
    impact('Автоматизація / AI', '#8B5CF6', '🤖', 120, 'activity', ['автоматизація', 'ai', 'ші', 'бот', 'api', 'інтеграція']),
    impact('Продукт / розробка', '#3B82F6', '💻', 130, 'activity', ['код', 'розробка', 'баг', 'тестування', 'технічна доробка', 'продукт']),
    impact('Аналітика / рішення', '#0EA5E9', '📊', 140, 'activity', ['аналітика', 'аналіз', 'звіт', 'метрика', 'дашборд', 'рішення']),
    impact('Контент / медіа', '#EC4899', '🎬', 150, 'activity', ['відео', 'пост', 'стаття', 'фото', 'контент', 'медіа']),
    impact('Маркетинг / залучення', '#F97316', '📣', 160, 'activity', ['маркетинг', 'реклама', 'кампанія', 'просування', 'залучення']),
    impact('Команда / делегування', '#06B6D4', '👥', 170, 'activity', ['команда', 'співробітник', 'делегування', 'управління'], {
        legacyNames: ['Команда і делегування']
    }),
    impact('Стратегія / пріоритети', '#6366F1', '🧭', 180, 'activity', ['стратегія', 'пріоритет', 'планування', 'ціль', 'реліз']),

    impact('Продажі / клієнти', '#22C55E', '🎯', 210, 'outcome', ['продаж', 'клієнт', 'лід', 'угода', 'повторна покупка'], {
        legacyNames: ['Дохід і клієнти']
    }),
    impact('Фінанси / облік', '#16A34A', '💰', 220, 'outcome', ['каса', 'витрати', 'бюджет', 'прибуток', 'маржа', 'облік']),
    impact('Якість сервісу', '#0EA5E9', '⭐', 230, 'outcome', ['якість', 'сервіс', 'скарга', 'клієнтський досвід', 'перевірка якості']),
    impact('Системність', '#6366F1', '🧩', 240, 'outcome', ['системність', 'регулярність', 'стандарт', 'повторюваність', 'дисципліна']),
    impact('Швидкість / ефективність', '#F59E0B', '🚀', 250, 'outcome', ['швидкість', 'ефективність', 'оптимізація', 'продуктивність'], {
        legacyNames: ['Швидкість роботи']
    }),
    impact('Бренд / репутація', '#EC4899', '🏆', 260, 'outcome', ['бренд', 'репутація', 'відгук', 'публічність', 'впізнаваність'], {
        legacyNames: ['Репутація / бренд']
    }),
    impact('Ризики / безпека', '#64748B', '🛡️', 270, 'outcome', ['ризик', 'безпека', 'пожежа', 'інцидент', 'контроль'], {
        legacyNames: ['Ризики і безпека']
    }),

    impact('Здоровʼя', '#EF4444', '❤️', 310, 'personal', ['здоровʼя', 'самопочуття', 'лікар'], {
        legacyNames: ["Здоров'я"]
    }),
    impact('Фізична форма', '#F97316', '💪', 320, 'personal', ['спорт', 'тренування', 'рух', 'фізична форма']),
    impact('Відновлення', '#14B8A6', '🌿', 330, 'personal', ['відпочинок', 'сон', 'пауза', 'відновлення']),
    impact('Побут / комфорт', '#A855F7', '🏠', 340, 'personal', ['побут', 'дім', 'ремонт', 'комфорт', 'домашні справи'], {
        legacyNames: ['Побут і комфорт']
    }),
    impact('Навчання / розвиток', '#3B82F6', '🧠', 350, 'personal', ['навчання', 'курс', 'книга', 'навичка', 'розвиток'], {
        legacyNames: ['Навчання']
    }),
    impact('Близькі / стосунки', '#EC4899', '🤝', 360, 'personal', ['близькі', 'сімʼя', 'стосунки', 'друзі', 'спільний час'])
]);

function impact(name, color, icon, sortOrder, group, hints, options = {}) {
    return Object.freeze({
        name,
        color,
        icon,
        sortOrder,
        group,
        hints: Object.freeze([...hints]),
        legacyNames: Object.freeze([...(options.legacyNames || [])])
    });
}

function normalizeImpactCatalogName(value) {
    return String(value || '')
        .normalize('NFKC')
        .trim()
        .replace(/[\u02BC\u2019\u2018\u0060\u00B4]/g, "'")
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('uk-UA');
}

const GUIDANCE_BY_NAME = new Map();
for (const item of CANONICAL_MY_DAY_IMPACTS) {
    const guidance = Object.freeze({ group: item.group, hints: item.hints });
    for (const name of [item.name, ...item.legacyNames]) {
        GUIDANCE_BY_NAME.set(normalizeImpactCatalogName(name), guidance);
    }
}

function guidanceForImpactName(name) {
    return GUIDANCE_BY_NAME.get(normalizeImpactCatalogName(name)) || null;
}

module.exports = {
    CANONICAL_MY_DAY_IMPACTS,
    guidanceForImpactName,
    normalizeImpactCatalogName
};
