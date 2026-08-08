'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

const MY_DAY_FILES = [
    'docs/MY_DAY_LIFE_SYSTEM_SPEC.md',
    'routes/my-day.js',
    'routes/my-day-habits.js',
    'services/myDayClassificationAi.js',
    'services/myDayTaxonomy.js',
    'services/myDayTimeTracking.js',
    'services/myDayHabits.js',
    'services/myDayContribution.js',
    'js/my-day-classification.js',
    'js/my-day-contribution.js',
    'js/my-day-dependencies.js',
    'js/my-day-habits.js',
    'js/my-day-time-tracking.js'
];

function read(file) {
    return fs.readFileSync(path.join(root, file), 'utf8');
}

const mojibakePatterns = [
    { name: 'UTF-8 replacement character', pattern: /\uFFFD/ },
    { name: 'UTF-8 BOM', pattern: /^\uFEFF/ },
    { name: 'C1 control character', pattern: /[\u0080-\u009F]/ },
    { name: 'double-encoded Cyrillic fragment', pattern: /\u0420\u00A0\u0412|\u0420\u040E|\u0420\u2018\u0420\u00B5\u0420\u00B7|\u043F\u0457\u0405|\u0432\u0402/ },
    { name: 'Windows-1251 decoder artifact', pattern: /[\u0402\u0403\u040B\u040C\u040E\u040F\u0452\u0453\u0459\u045A\u045B\u045C\u045E]/ }
];

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('My Day user-facing files do not contain replacement characters or mojibake fragments', () => {
    for (const file of MY_DAY_FILES) {
        const text = read(file);
        for (const { name, pattern } of mojibakePatterns) {
            assert.doesNotMatch(text, pattern, `${file} contains ${name}`);
        }
    }
});

test('My Day canonical Ukrainian labels are present in shipped code', () => {
    const contribution = read('services/myDayContribution.js');
    const habitsUi = read('js/my-day-habits.js');
    assert.doesNotMatch(contribution, /Без напряму/);
    assert.match(habitsUi, />Внесок<\/button>/);
});

test('My Day backend errors are safe Ukrainian messages', () => {
    const backend = [
        read('routes/my-day.js'),
        read('routes/my-day-habits.js'),
        read('services/myDayClassificationAi.js'),
        read('services/myDayHabits.js'),
        read('services/myDayContribution.js')
    ].join('\n');
    const oldMessages = [
        'Authentication required.',
        'Could not update My Day habits.',
        'from must be before or equal to to.',
        'Contribution range cannot exceed 92 days.',
        'Invalid local date.',
        'Unsupported habit metric.',
        'Paused habit cannot be checked in.'
    ];
    for (const message of oldMessages) assert.doesNotMatch(backend, new RegExp(escapeRegExp(message)));
    assert.match(backend, /Потрібна авторизація/);
    assert.match(backend, /Задачу не знайдено/);
    assert.match(backend, /Період внеску не може перевищувати 92 дні/);
});

test('My Day spec matches the canonical shipped endpoints and schema words', () => {
    const spec = read('docs/MY_DAY_LIFE_SYSTEM_SPEC.md');
    assert.match(spec, /Legacy direction endpoints remain for rollback/);
    assert.match(spec, /PATCH \/api\/my-day\/impacts\/:id[^\n]+`isActive`/);
    assert.match(spec, /There is no separate `GET \/api\/my-day\/tasks\/:taskId\/classification` endpoint\./);
    assert.match(spec, /Task classification is read through the My Cabinet projection\./);
    assert.match(spec, /DELETE \/api\/my-day\/time-entries\/:id/);
    assert.match(spec, /PATCH \/api\/my-day\/habits\/:id[^\n]+`isPaused` and `isArchived`/);
    assert.match(spec, /DELETE \/api\/my-day\/habits\/:habitId\/check-ins\/:localDate/);
    assert.match(spec, /`my_day_time_entries` is a personal ledger/);
    assert.doesNotMatch(spec, /POST \/api\/my-day\/directions\/:id\/archive/);
    assert.doesNotMatch(spec, /POST \/api\/my-day\/impacts\/:id\/archive/);
    assert.doesNotMatch(spec, /POST \/api\/my-day\/time-entries\/:id\/archive/);
    assert.doesNotMatch(spec, /\/api\/my-day\/habits` \| GET, POST; PATCH `\/:habitId`; POST `\/:habitId\/archive`/);
    assert.doesNotMatch(spec, /`status` is `done` or `skipped`/);
});

test('My Day task tags are retired and watchdog labels remain untouched', () => {
    const taxonomy = read('services/myDayTaxonomy.js');
    const projection = read('services/taskCabinetProjection.js');
    const classificationUi = read('js/my-day-classification.js');
    assert.match(taxonomy, /MY_DAY_TAGS_DEPRECATED/);
    assert.doesNotMatch(taxonomy, /normalizeTags|m\.tags|DO UPDATE SET tags/);
    assert.doesNotMatch(projection, /tags: \[\]/);
    assert.doesNotMatch(classificationUi, /data-my-day-task-tags|my-day-task-tag|data-my-day-tag/);
    assert.doesNotMatch(taxonomy, /control_meta|controlMeta|watchdog/);
    assert.doesNotMatch(classificationUi, /control_meta|controlMeta|watchdog/);
});
