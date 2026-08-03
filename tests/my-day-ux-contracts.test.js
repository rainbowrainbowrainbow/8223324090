'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('My Day tabs use exact canonical labels and ARIA tab contract', () => {
    const habitsUi = read('js/my-day-habits.js');
    const tabMatches = Array.from(habitsUi.matchAll(/data-my-day-life-mode="([^"]+)"[^>]*>([^<]+)<\/button>/g));
    const labels = tabMatches.map(match => match[2]);
    assert.deepEqual(labels, ['День', 'Звички', 'Внесок']);
    assert.equal(habitsUi.includes('\uFFFD'), false);
    assert.match(habitsUi, /role="tablist"/);
    assert.match(habitsUi, /role="tab"/);
    assert.match(habitsUi, /aria-selected="\$\{state\.mode === 'day'\}"/);
    assert.match(habitsUi, /aria-controls="myDayDayPanel"/);
    assert.match(habitsUi, /aria-controls="myDayHabitsPanel"/);
    assert.match(habitsUi, /aria-controls="myDayContributionPanel"/);
});

test('boolean habit uses native checkbox with idempotent PUT and DELETE undo', () => {
    const habitsUi = read('js/my-day-habits.js');
    const css = read('css/pages-profile.css');
    assert.match(habitsUi, /<input type="checkbox" class="my-day-habit-check"/);
    assert.match(habitsUi, /aria-label="Позначити звичку \$\{escape\(habit\.name\)\} виконаною"/);
    assert.match(habitsUi, /button\.addEventListener\('change'/);
    assert.match(habitsUi, /const checked = button\.checked/);
    assert.match(habitsUi, /\? request\(path, \{ method: 'PUT', body: JSON\.stringify\(\{ state: 'done', value: 1 \}\) \}\)/);
    assert.match(habitsUi, /: request\(path, \{ method: 'DELETE' \}\)/);
    assert.match(habitsUi, /if \(button\) button\.disabled = true/);
    assert.doesNotMatch(habitsUi, /aria-pressed/);
    assert.match(css, /\.my-day-habit-check-label:focus-within/);
});

test('empty Habits state opens existing settings and focuses habit create form', () => {
    const habitsUi = read('js/my-day-habits.js');
    assert.match(habitsUi, /data-my-day-habit-open-create>Створити звичку/);
    assert.match(habitsUi, /async function openSettingsCreate\(\)/);
    assert.match(habitsUi, /window\.switchTab\('settings'\)/);
    assert.match(habitsUi, /function focusHabitCreateForm\(\)/);
    assert.match(habitsUi, /document\.querySelector\('\[data-my-day-habit-create\]'\)/);
    assert.match(habitsUi, /input\[name="name"\]/);
});

test('empty Contribution keeps selected dates and renders zero total cards', () => {
    const contributionUi = read('js/my-day-contribution.js');
    assert.match(contributionUi, /function emptyContributionData/);
    assert.match(contributionUi, /taskCount: normalizeNumber\(totals\.taskCount\)/);
    assert.match(contributionUi, /taskMinutes: normalizeNumber\(totals\.taskMinutes\)/);
    assert.match(contributionUi, /habitCompletions: normalizeNumber\(totals\.habitCompletions\)/);
    assert.match(contributionUi, /habitMinutes: normalizeNumber\(totals\.habitMinutes\)/);
    assert.match(contributionUi, /my-day-contribution-zero-state/);
    assert.match(contributionUi, /За \$\{escape\(range\.from\)\} — \$\{escape\(range\.to\)\}/);
    assert.match(contributionUi, /renderTotals\(data\)/);
    assert.match(contributionUi, /renderMatrix\('Напрями'/);
    assert.match(contributionUi, /\$\{status\}\$\{body\}/);
    assert.doesNotMatch(contributionUi, /productivityScore|streak|penalt|gamification/i);
});

test('read-only My Day smoke covers modes, text integrity, and overflow', () => {
    const smoke = read('scripts/live-my-day-smoke.js');
    assert.match(smoke, /function assertMyDayLifeModes/);
    assert.match(smoke, /assert\.deepEqual\(labels, \['День', 'Звички', 'Внесок'\]/);
    assert.match(smoke, /'\\uFFFD'/);
    assert.match(smoke, /data-my-day-life-mode="\$\{mode\.key\}"/);
    assert.match(smoke, /assertNoHorizontalOverflow\(page, `\$\{label\}: \$\{mode\.name\}`\)/);
    assert.match(smoke, /#myDayHabitsPanel/);
    assert.match(smoke, /#myDayContributionPanel/);
});