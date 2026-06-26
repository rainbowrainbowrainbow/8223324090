(function(root) {
    'use strict';

    const visitTips = Object.freeze({
        'holiday-party': Object.freeze([
            Object.freeze({ icon: '⏱', label: 'Коли приходити', value: 'Приходьте за 5-10 хвилин до початку події.' }),
            Object.freeze({ icon: '👟', label: 'Підготовка', value: 'Оберіть зручний одяг для активної програми.' }),
            Object.freeze({ icon: '💬', label: 'Уточнення', value: 'Якщо плани змінились, зв\'яжіться з нами заздалегідь.' })
        ]),
        'show-program': Object.freeze([
            Object.freeze({ icon: '⏱', label: 'Коли приходити', value: 'Приходьте за 5-10 хвилин до початку шоу.' }),
            Object.freeze({ icon: '🎭', label: 'Підготовка', value: 'Залиште дітям трохи простору біля зони програми.' }),
            Object.freeze({ icon: '📸', label: 'Фото', value: 'Якщо плануєте зйомку, підготуйте телефон або камеру заздалегідь.' })
        ]),
        'family-event': Object.freeze([
            Object.freeze({ icon: '⏱', label: 'Коли приходити', value: 'Приходьте трохи раніше, щоб діти спокійно адаптувалися до простору.' }),
            Object.freeze({ icon: '👟', label: 'Підготовка', value: 'Оберіть зручний одяг для дитячої активності.' }),
            Object.freeze({ icon: '💬', label: 'Уточнення', value: 'Якщо у гостей є особливі побажання, зв\'яжіться з нами заздалегідь.' })
        ]),
        workshop: Object.freeze([
            Object.freeze({ icon: '⏱', label: 'Коли приходити', value: 'Приходьте трохи раніше, щоб спокійно підготуватися.' }),
            Object.freeze({ icon: '🎨', label: 'Підготовка', value: 'Одяг має бути зручним для творчої роботи.' }),
            Object.freeze({ icon: '🧺', label: 'Після заняття', value: 'Залиште кілька хвилин після майстер-класу, щоб спокійно зібрати роботу.' })
        ]),
        'private-party': Object.freeze([
            Object.freeze({ icon: '⏱', label: 'Перед візитом', value: 'Перевірте час і кімнату перед приїздом.' }),
            Object.freeze({ icon: '🎭', label: 'Формат', value: 'Налаштуйтеся на камерну програму без зайвого поспіху.' }),
            Object.freeze({ icon: '💬', label: 'Уточнення', value: 'Якщо плани змінились, зв\'яжіться з нами заздалегідь.' })
        ]),
        quest: Object.freeze([
            Object.freeze({ icon: '⏱', label: 'Коли приходити', value: 'Приходьте за 5-10 хвилин для короткого інструктажу.' }),
            Object.freeze({ icon: '🧭', label: 'Підготовка', value: 'Зручний одяг допоможе активно проходити завдання.' }),
            Object.freeze({ icon: '💬', label: 'Уточнення', value: 'Якщо хтось запізнюється, повідомте нас заздалегідь.' })
        ])
    });

    const config = Object.freeze({
        brandName: 'Event Genix',
        shareTitle: 'Парк Закревського Періоду',
        shareFallbackText: 'Запрошуємо на подію!',
        location: Object.freeze({
            title: 'Як нас знайти',
            rows: Object.freeze([
                Object.freeze({ icon: '📍', label: 'Адреса', value: 'вул. Закревського 31/2, 3 поверх' }),
                Object.freeze({ icon: '🚇', label: 'Орієнтир', value: 'м. Лісова / м. Чернігівська' })
            ]),
            mapIcon: '🗺',
            mapLabel: 'Відкрити на карті',
            mapUrl: 'https://maps.google.com/?q=вул.+Закревського+31/2+Київ'
        }),
        visit: Object.freeze({
            title: 'Перед візитом',
            tips: visitTips
        }),
        contact: Object.freeze({
            title: 'Контакти',
            rows: Object.freeze([
                Object.freeze({
                    icon: '📱',
                    label: 'Контакт',
                    value: 'Зв\'яжіться з нами'
                })
            ])
        })
    });

    root.InviteConfig = config;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = config;
    }
})(typeof window !== 'undefined' ? window : globalThis);
