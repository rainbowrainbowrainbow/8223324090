/**
 * services/taskTemplates.js — Task templates per afisha event type (v7.6)
 */

const TASK_TEMPLATES = {
    event: [
        { title: 'Підготувати реквізит для "{title}"', priority: 'high' },
        { title: 'Перевірити обладнання', priority: 'normal' },
        { title: 'Підготувати зону проведення', priority: 'normal' }
    ],
    birthday: [
        { title: 'Підготувати привітання для {title}', priority: 'high' },
        { title: 'Перевірити подарунок/торт', priority: 'normal' }
    ],
    regular: [
        { title: 'Перевірити готовність до "{title}"', priority: 'normal' }
    ]
};

function generateTasksForEvent(event, createdBy) {
    const templates = TASK_TEMPLATES[event.type] || TASK_TEMPLATES.event;
    return templates.map(tpl => ({
        title: tpl.title.replace('{title}', event.title),
        priority: tpl.priority,
        date: event.date,
        status: 'todo',
        afisha_id: event.id,
        created_by: createdBy
    }));
}

module.exports = { TASK_TEMPLATES, generateTasksForEvent };
