'use strict';

const CANONICAL_MY_DAY_IMPACTS = Object.freeze([
    impact('Робота: Парк', '#10B981', 'park', 10, 'context', ['парк', 'каса парку', 'атракціони', 'бронювання парку', 'зміна парку'], {
        legacyNames: ['Парк робота']
    }),
    impact('Робота: CRM', '#2563EB', 'crm', 20, 'context', ['crm', 'ліди', 'клієнтська база', 'воронка продажів'], {
        legacyNames: ['CRM']
    }),
    impact('Робота: Hermes', '#8B5CF6', 'hermes', 30, 'context', ['hermes', 'worker', 'telegram', 'сповіщення']),

    impact('Операційка / процеси', '#64748B', 'processes', 110, 'activity', ['операційка', 'процес', 'регламент', 'чекліст', 'порядок виконання']),
    impact('Автоматизація / AI', '#8B5CF6', 'ai', 120, 'activity', ['автоматизація', 'ai', 'ші', 'бот', 'api', 'інтеграція']),
    impact('Продукт / розробка', '#3B82F6', 'development', 130, 'activity', ['код', 'розробка', 'баг', 'тестування', 'технічна доробка', 'продукт']),
    impact('Аналітика / рішення', '#0EA5E9', 'analytics', 140, 'activity', ['аналітика', 'аналіз', 'звіт', 'метрика', 'дашборд', 'рішення']),
    impact('Контент / медіа', '#EC4899', 'media', 150, 'activity', ['відео', 'пост', 'стаття', 'фото', 'контент', 'медіа']),
    impact('Маркетинг / залучення', '#F97316', 'marketing', 160, 'activity', ['маркетинг', 'реклама', 'кампанія', 'просування', 'залучення']),
    impact('Команда / делегування', '#06B6D4', 'team', 170, 'activity', ['команда', 'співробітник', 'делегування', 'управління'], {
        legacyNames: ['Команда і делегування']
    }),
    impact('Стратегія / пріоритети', '#6366F1', 'strategy', 180, 'activity', ['стратегія', 'пріоритет', 'планування', 'ціль', 'реліз']),
    impact('Люди / HR', '#0891B2', 'hr', 190, 'activity', ['hr', 'найм', 'онбординг', 'мотивація', 'персонал', 'команда']),
    impact('Документи / право', '#475569', 'legal', 195, 'activity', ['договір', 'документ', 'право', 'юрист', 'дозвіл', 'політика']),
    impact('Закупівлі / постачання', '#D97706', 'procurement', 197, 'activity', ['закупівля', 'постачання', 'підрядник', 'склад', 'матеріали']),
    impact('Партнерства / нетворкінг', '#7C3AED', 'network', 199, 'activity', ['партнерство', 'нетворкінг', 'контакт', 'колаборація', 'партнер']),

    impact('Продажі / клієнти', '#22C55E', 'sales', 210, 'outcome', ['продаж', 'клієнт', 'лід', 'угода', 'повторна покупка'], {
        legacyNames: ['Дохід і клієнти', 'Гроші / продажі', 'Гроші\\продажі']
    }),
    impact('Фінанси / облік', '#16A34A', 'finance', 220, 'outcome', ['каса', 'витрати', 'бюджет', 'прибуток', 'маржа', 'облік']),
    impact('Якість сервісу', '#0EA5E9', 'quality', 230, 'outcome', ['якість', 'сервіс', 'скарга', 'клієнтський досвід', 'перевірка якості']),
    impact('Системність', '#6366F1', 'system', 240, 'outcome', ['системність', 'регулярність', 'стандарт', 'повторюваність', 'дисципліна'], {
        legacyNames: ['Фокус організація', 'Фокус / організація']
    }),
    impact('Швидкість / ефективність', '#F59E0B', 'speed', 250, 'outcome', ['швидкість', 'ефективність', 'оптимізація', 'продуктивність'], {
        legacyNames: ['Швидкість роботи']
    }),
    impact('Бренд / репутація', '#EC4899', 'brand', 260, 'outcome', ['бренд', 'репутація', 'відгук', 'публічність', 'впізнаваність'], {
        legacyNames: ['Репутація / бренд', 'Особистий бренд']
    }),
    impact('Ризики / безпека', '#64748B', 'security', 270, 'outcome', ['ризик', 'безпека', 'пожежа', 'інцидент', 'контроль'], {
        legacyNames: ['Ризики і безпека']
    }),

    impact('Здоровʼя', '#EF4444', 'health', 310, 'personal', ['здоровʼя', 'самопочуття', 'лікар', 'енергія'], {
        legacyNames: ["Здоров'я", "Здоров'я та енергія", 'Здоровʼя та енергія']
    }),
    impact('Фізична форма', '#F97316', 'fitness', 320, 'personal', ['спорт', 'тренування', 'рух', 'фізична форма']),
    impact('Відновлення', '#14B8A6', 'recovery', 330, 'personal', ['відпочинок', 'сон', 'пауза', 'відновлення']),
    impact('Побут / комфорт', '#A855F7', 'home', 340, 'personal', ['побут', 'дім', 'ремонт', 'комфорт', 'домашні справи'], {
        legacyNames: ['Побут і комфорт']
    }),
    impact('Навчання / розвиток', '#3B82F6', 'learning', 350, 'personal', ['навчання', 'курс', 'книга', 'навичка', 'розвиток'], {
        legacyNames: ['Навчання', 'Навчання / ріст']
    }),
    impact('Близькі / стосунки', '#EC4899', 'relationships', 360, 'personal', ['близькі', 'сімʼя', 'стосунки', 'друзі', 'спільний час'], {
        legacyNames: ["Стосунки та сім'я", 'Стосунки та сімʼя']
    }),
    impact('Творчість / самовираження', '#DB2777', 'creativity', 370, 'personal', ['творчість', 'ідея', 'мистецтво', 'дизайн', 'самовираження']),
    impact('Подорожі / враження', '#0284C7', 'travel', 380, 'personal', ['подорож', 'відпустка', 'враження', 'поїздка', 'нове місце']),
    impact('Спільнота / внесок', '#059669', 'community', 390, 'personal', ['спільнота', 'волонтерство', 'допомога', 'внесок', 'соціальний проєкт']),
    impact('Баланс / сенси', '#7C3AED', 'balance', 400, 'personal', ['баланс', 'сенс', 'цінності', 'рефлексія', 'духовність'])
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
