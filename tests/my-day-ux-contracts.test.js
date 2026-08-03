'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const DAY_LABEL = '\u0414\u0435\u043d\u044c';
const HABITS_LABEL = '\u0417\u0432\u0438\u0447\u043a\u0438';
const CONTRIBUTION_LABEL = '\u0412\u043d\u0435\u0441\u043e\u043a';
const CREATE_HABIT_LABEL = '\u0421\u0442\u0432\u043e\u0440\u0438\u0442\u0438 \u0437\u0432\u0438\u0447\u043a\u0443';
const MARK_HABIT_DONE_LABEL = 'aria-label="\u041f\u043e\u0437\u043d\u0430\u0447\u0438\u0442\u0438 \u0437\u0432\u0438\u0447\u043a\u0443 ${escape(habit.name)} \u0432\u0438\u043a\u043e\u043d\u0430\u043d\u043e\u044e"';
const RANGE_PREFIX = '\u0417\u0430';
const DIRECTIONS_LABEL = '\u041d\u0430\u043f\u0440\u044f\u043c\u0438';

test('My Day tabs use exact canonical labels and ARIA tab contract', () => {
    const habitsUi = read('js/my-day-habits.js');
    const tabMatches = Array.from(habitsUi.matchAll(/data-my-day-life-mode="([^"]+)"[^>]*>([^<]+)<\/button>/g));
    const labels = tabMatches.map(match => match[2]);
    assert.deepEqual(labels, [DAY_LABEL, HABITS_LABEL, CONTRIBUTION_LABEL]);
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
    assert.ok(habitsUi.includes(MARK_HABIT_DONE_LABEL));
    assert.match(habitsUi, /button\.addEventListener\('change'/);
    assert.match(habitsUi, /const checked = button\.checked/);
    assert.match(habitsUi, /\? request\(path, \{ method: 'PUT', body: JSON\.stringify\(\{ state: 'done', value: 1 \}\) \}\)/);
    assert.match(habitsUi, /: request\(path, \{ method: 'DELETE' \}\)/);
    assert.match(habitsUi, /if \(button\) button\.disabled = true/);
    assert.doesNotMatch(habitsUi, /aria-pressed/);
    assert.match(css, /\.my-day-habit-check-label:focus-within/);
});

test('My Day setup surface is internal and not a fourth tab', () => {
    const profile = read('js/profile-page.js');
    const habitsUi = read('js/my-day-habits.js');
    const css = read('css/pages-profile.css');
    assert.match(habitsUi, /surface: 'main'/);
    assert.match(habitsUi, /data-my-day-open-setup>Налаштувати Мій день/);
    assert.match(habitsUi, /function renderSetupSurface\(\)/);
    assert.match(habitsUi, /data-my-day-setup-surface/);
    assert.match(habitsUi, /data-my-day-setup-back/);
    assert.match(habitsUi, /← Назад до Мого дня/);
    assert.match(profile, /state\?\.surface === 'setup'/);
    assert.match(css, /\.my-day-setup-surface/);
    assert.match(css, /\.my-day-life-setup-action/);
    assert.doesNotMatch(habitsUi, /data-my-day-life-mode="setup"/);
});

test('My Day setup catalog edit stays in-page without prompt modal', () => {
    const taxonomyUi = read('js/my-day-classification.js');
    const css = read('css/pages-profile.css');
    assert.match(taxonomyUi, /data-my-day-taxonomy-edit-row/);
    assert.match(taxonomyUi, /my-day-taxonomy-inline-field/);
    assert.match(taxonomyUi, /button type="submit" class="my-day-taxonomy-secondary">Зберегти/);
    assert.doesNotMatch(taxonomyUi, /promptModal|data-my-day-taxonomy-edit="/);
    assert.match(css, /\.my-day-taxonomy-row form/);
    assert.match(css, /\.my-day-taxonomy-secondary/);
});

test('Profile Settings no longer renders My Day management forms', () => {
    const profile = read('js/profile-page.js');
    const start = profile.indexOf('function renderProfileSettingsTab()');
    const end = profile.indexOf('function renderProfileSecurityPanel()', start);
    const settingsRenderer = profile.slice(start, end);
    assert.doesNotMatch(settingsRenderer, /MyDayClassification\?\.renderSettings/);
    assert.doesNotMatch(settingsRenderer, /MyDayHabits\?\.renderSettings/);
    assert.match(settingsRenderer, /renderProfileSecurityPanel\(\)/);
});

test('empty Habits state opens My Day setup and focuses habit create form', () => {
    const habitsUi = read('js/my-day-habits.js');
    assert.ok(habitsUi.includes('data-my-day-habit-open-create>' + CREATE_HABIT_LABEL));
    assert.match(habitsUi, /async function openSettingsCreate\(\)/);
    assert.match(habitsUi, /openSetup\(\{ focusHabitName: true \}\)/);
    assert.doesNotMatch(habitsUi, /switchTab\('settings'\)/);
    assert.match(habitsUi, /function focusHabitCreateForm\(\)/);
    assert.match(habitsUi, /document\.querySelector\('\[data-my-day-habit-create\]'\)/);
    assert.match(habitsUi, /input\[name="name"\]/);
    assert.match(habitsUi, /pendingFocus = 'habit-create'/);
});

test('setup Back restores the previous My Day mode without changing Day or Contribution renderers', () => {
    const profile = read('js/profile-page.js');
    const habitsUi = read('js/my-day-habits.js');
    assert.match(habitsUi, /state\.returnMode = options\.returnMode \|\| currentMode/);
    assert.match(habitsUi, /state\.mode = state\.returnMode === 'habits' \|\| state\.returnMode === 'contribution'/);
    assert.match(habitsUi, /MyDayContribution\?\.cancel\?\.\('setup-open'\)/);
    assert.match(profile, /renderCabinetTaskComposer\(\{ segment: 'personal', mode: 'personal' \}\)/);
    assert.match(profile, /MyDayContribution\?\.renderPanel/);
});

test('empty Contribution keeps selected dates and renders zero total cards', () => {
    const contributionUi = read('js/my-day-contribution.js');
    assert.match(contributionUi, /function emptyContributionData/);
    assert.match(contributionUi, /taskCount: normalizeNumber\(totals\.taskCount\)/);
    assert.match(contributionUi, /taskMinutes: normalizeNumber\(totals\.taskMinutes\)/);
    assert.match(contributionUi, /habitCompletions: normalizeNumber\(totals\.habitCompletions\)/);
    assert.match(contributionUi, /habitMinutes: normalizeNumber\(totals\.habitMinutes\)/);
    assert.match(contributionUi, /my-day-contribution-zero-state/);
    assert.ok(contributionUi.includes(RANGE_PREFIX + ' ${escape(range.from)} \u2014 ${escape(range.to)}'));
    assert.match(contributionUi, /renderTotals\(data\)/);
    assert.ok(contributionUi.includes("renderMatrix('" + DIRECTIONS_LABEL + "'"));
    assert.match(contributionUi, /\$\{status\}\$\{body\}/);
    assert.doesNotMatch(contributionUi, /productivityScore|streak|penalt|gamification/i);
});

test('My Day life system has scoped dark theme surfaces and controls', () => {
    const css = read('css/pages-profile.css');
    assert.match(css, /body\.dark-mode \.profile-page\.profile-work-mode,\s*html\[data-theme="dark"\] body \.profile-page\.profile-work-mode/);
    assert.match(css, /body\.dark-mode \.profile-page\.profile-work-mode \.my-day-life-tabs,\s*html\[data-theme="dark"\] body \.profile-page\.profile-work-mode \.my-day-life-tabs/);
    assert.match(css, /\.my-day-life-tabs button:focus-visible/);
    assert.match(css, /\.my-day-life-tabs button\.is-active/);
    assert.match(css, /\.my-day-contribution-range input[\s\S]*color-scheme:\s*dark/);
    assert.match(css, /::-webkit-calendar-picker-indicator/);
    assert.match(css, /\.my-day-habit-card[\s\S]*\.my-day-contribution-section[\s\S]*background-color:\s*rgba\(30, 41, 59, 0\.84\)/);
    assert.match(css, /\.my-day-contribution-table th[\s\S]*border-top-color/);
    assert.match(css, /--my-day-life-danger:\s*#FCA5A5/);
    assert.match(css, /\.profile-empty-professional\.is-error[\s\S]*color:\s*var\(--my-day-life-danger\)/);
});

test('read-only My Day smoke covers modes, text integrity, dark contrast, and overflow', () => {
    const smoke = read('scripts/live-my-day-smoke.js');
    const expectedLabels = "assert.deepEqual(labels, ['" + DAY_LABEL + "', '" + HABITS_LABEL + "', '" + CONTRIBUTION_LABEL + "']";
    assert.match(smoke, /function assertMyDayLifeModes/);
    assert.ok(smoke.includes(expectedLabels));
    assert.match(smoke, /'\\uFFFD'/);
    assert.match(smoke, /data-my-day-life-mode="\$\{mode\.key\}"/);
    assert.match(smoke, /assertNoHorizontalOverflow\(page, `\$\{label\}: \$\{mode\.name\}`\)/);
    assert.match(smoke, /function assertDarkMyDayLifeTabs/);
    assert.match(smoke, /contrastRatio/);
    assert.match(smoke, /active tab contrast/);
    assert.match(smoke, /#myDayHabitsPanel/);
    assert.match(smoke, /#myDayContributionPanel/);
});
