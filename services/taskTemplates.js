/**
 * services/taskTemplates.js — Task templates per afisha event type (v7.9)
 * Categories: event, purchase, admin, trampoline, personal
 */

const TASK_TEMPLATES = {
    event: [
        { title: 'Підготувати реквізит для "{title}"', priority: 'high', category: 'event' },
        { title: 'Перевірити обладнання для "{title}"', priority: 'normal', category: 'event' },
        { title: 'Підготувати зону проведення', priority: 'normal', category: 'admin' }
    ],
    birthday: [
        { title: 'Підготувати привітання для {title}', priority: 'high', category: 'event' },
        { title: 'Перевірити подарунок/торт', priority: 'normal', category: 'purchase' }
    ],
    regular: [
        { title: 'Перевірити готовність до "{title}"', priority: 'normal', category: 'event' }
    ]
};

// v7.9: Keyword-based extra tasks — auto-detect by event title
const KEYWORD_TASKS = [
    {
        keywords: ['мк', 'майстер', 'футболк', 'пряник', 'слайм', 'мило', 'капкейк', 'кейк', 'піца', 'термо', 'сумок', 'цукер'],
        tasks: [
            { title: '🛒 Закупити матеріали для "{title}"', priority: 'high', category: 'purchase' },
            { title: 'Підготувати робочі місця для МК', priority: 'normal', category: 'admin' }
        ]
    },
    {
        keywords: ['валентин', 'серц', 'кохан', 'love'],
        tasks: [
            { title: '🛒 Закупити декор (серця, кулі, гірлянди)', priority: 'high', category: 'purchase' },
            { title: 'Прикрасити зал до свята', priority: 'normal', category: 'admin' }
        ]
    },
    {
        keywords: ['шоу', 'азот', 'крио', 'тесла', 'наук'],
        tasks: [
            { title: 'Перевірити реагенти/обладнання для шоу', priority: 'high', category: 'event' }
        ]
    },
    {
        keywords: ['батут', 'стриб'],
        tasks: [
            { title: 'Перевірити батутну зону', priority: 'high', category: 'trampoline' }
        ]
    }
];

function generateTasksForEvent(event, createdBy) {
    const templates = TASK_TEMPLATES[event.type] || TASK_TEMPLATES.event;
    const tasks = templates.map(tpl => ({
        title: tpl.title.replace('{title}', event.title),
        priority: tpl.priority,
        category: tpl.category || 'event',
        date: event.date,
        status: 'todo',
        afisha_id: event.id,
        created_by: createdBy
    }));

    // v7.9: Add keyword-based tasks
    const titleLower = event.title.toLowerCase();
    for (const rule of KEYWORD_TASKS) {
        if (rule.keywords.some(kw => titleLower.includes(kw))) {
            for (const tpl of rule.tasks) {
                // Avoid duplicate titles
                const fullTitle = tpl.title.replace('{title}', event.title);
                if (!tasks.some(t => t.title === fullTitle)) {
                    tasks.push({
                        title: fullTitle,
                        priority: tpl.priority,
                        category: tpl.category || 'event',
                        date: event.date,
                        status: 'todo',
                        afisha_id: event.id,
                        created_by: createdBy
                    });
                }
            }
        }
    }

    return tasks;
}

module.exports = { TASK_TEMPLATES, KEYWORD_TASKS, generateTasksForEvent };
