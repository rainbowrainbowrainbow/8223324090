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
const IMPACTS_LABEL = '\u0412\u043f\u043b\u0438\u0432\u0438';

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

test('My Day setup catalog editors are clean one-at-a-time inline surfaces', () => {
    const taxonomyUi = read('js/my-day-classification.js');
    const habitsUi = read('js/my-day-habits.js');
    const css = read('css/pages-profile.css');
    assert.match(habitsUi, /setupEditor: ''/);
    assert.match(habitsUi, /function setSetupEditor\(editor = '', options = \{\}\)/);
    assert.match(taxonomyUi, /data-my-day-taxonomy-open/);
    assert.match(taxonomyUi, /data-my-day-taxonomy-edit-row/);
    assert.match(taxonomyUi, /my-day-catalog-editor/);
    assert.match(taxonomyUi, /my-day-color-choice/);
    assert.match(taxonomyUi, /my-day-icon-choice/);
    assert.doesNotMatch(taxonomyUi, /promptModal/);
    const setupSliceStart = taxonomyUi.indexOf('function renderCatalog');
    const setupSliceEnd = taxonomyUi.indexOf('function bind', setupSliceStart);
    const setupSlice = taxonomyUi.slice(setupSliceStart, setupSliceEnd);
    assert.doesNotMatch(setupSlice, /TaskUI\.openActionMenu/);
    assert.doesNotMatch(setupSlice, /type="color"/);
    assert.doesNotMatch(setupSlice, /my-day-taxonomy-inline-field/);
    assert.match(css, /\.my-day-catalog-editor/);
    assert.match(css, /\.my-day-taxonomy-row-card/);
    assert.match(css, /\.my-day-setup-archive/);
});
test('My Day setup offers a consistent custom SVG icon preset palette for impacts', () => {
    const iconUi = read('js/my-day-impact-icons.js');
    const classificationUi = read('js/my-day-classification.js');
    const profile = read('profile.html');
    const tasks = read('tasks.html');
    const keys = ['park', 'crm', 'hermes', 'processes', 'ai', 'development', 'analytics', 'media', 'marketing', 'team', 'strategy', 'sales', 'finance', 'quality', 'system', 'speed', 'brand', 'security', 'health', 'fitness', 'recovery', 'home', 'learning', 'relationships', 'hr', 'legal', 'procurement', 'network', 'creativity', 'travel', 'community', 'balance'];
    keys.forEach(key => assert.match(iconUi, new RegExp(`\\n\\s{8}${key}:`)));
    assert.match(iconUi, /<svg class="my-day-impact-icon"/);
    assert.match(iconUi, /MAX_SELECTED_IMPACTS = 5/);
    assert.match(classificationUi, /data-my-day-manage-impacts/);
    assert.match(classificationUi, /MyDayHabits\?\.openSetup/);
    assert.match(profile, /js\/my-day-impact-icons\.js/);
    assert.match(tasks, /js\/my-day-impact-icons\.js/);
});


test('My Day explains impacts as the only active classification model', () => {
    const taxonomyUi = read('js/my-day-classification.js');
    const habitsUi = read('js/my-day-habits.js');
    const css = read('css/pages-profile.css');
    const spec = read('docs/MY_DAY_LIFE_SYSTEM_SPEC.md');

    assert.doesNotMatch(habitsUi, /<strong>Напрям<\/strong>/);
    assert.match(habitsUi, /<strong>Вплив<\/strong> — це контекст, тип роботи або результат/);
    assert.doesNotMatch(taxonomyUi, /<strong>Напрям<\/strong>/);
    assert.match(taxonomyUi, /<strong>Вплив<\/strong> — це контекст, тип роботи, результат або особиста сфера/);
    assert.match(taxonomyUi, /Доробити CRM-фічу/);
    assert.match(taxonomyUi, /Підготувати зміну в парку/);
    assert.match(taxonomyUi, /Налаштувати Hermes/);
    assert.match(taxonomyUi, /До \$\{maxImpacts\(\)\} впливів: контекст, діяльність, результат або особиста сфера./);
    assert.doesNotMatch(habitsUi, /Проєкт або сфера звички./);
    assert.match(habitsUi, /До \$\{maxImpacts\(\)\} впливів: контекст, діяльність, результат або особиста сфера./);
    assert.match(css, /\.my-day-taxonomy-guide/);
    assert.match(css, /\.my-day-taxonomy-examples/);
    assert.match(css, /body\.dark-mode \.profile-page\.profile-work-mode \.my-day-taxonomy-guide/);
    assert.match(spec, /impacts-only active UX/);
    assert.doesNotMatch(spec, /direction = where/);
    assert.match(spec, /guidance only; they do\s+not add required validation/);
});

test('task impact chips remove a single impact without opening the editor', () => {
    const taxonomyUi = read('js/my-day-classification.js');
    const profile = read('js/profile-page.js');
    const css = read('css/pages-profile.css');
    const renderStart = taxonomyUi.indexOf('function renderTaskBadges');
    const renderEnd = taxonomyUi.indexOf('async function saveTaskClassification', renderStart);
    const renderSlice = taxonomyUi.slice(renderStart, renderEnd);
    const handlerStart = profile.indexOf('async function handleCabinetTaskActionClick');
    const handlerEnd = profile.indexOf("if (action === 'ai-classification')", handlerStart);
    const handlerSlice = profile.slice(handlerStart, handlerEnd);

    assert.match(renderSlice, /data-cabinet-task-action="remove-impact"/);
    assert.match(renderSlice, /aria-label="\$\{escape\('Прибрати вплив ' \+ name\)\}"/);
    assert.match(renderSlice, /class="my-day-task-chip-remove"/);
    assert.doesNotMatch(renderSlice, /aria-haspopup="dialog"[\s\S]{0,160}data-cabinet-task-action="remove-impact"/);
    assert.match(handlerSlice, /if \(action === 'remove-impact'\) \{[\s\S]*await removeCabinetTaskImpact\(button, taskId\);[\s\S]*return;/);
    assert.match(handlerSlice, /if \(action === 'classification'\) \{/);
    assert.ok(handlerSlice.indexOf("action === 'remove-impact'") < handlerSlice.indexOf("action === 'classification'"));
    assert.match(profile, /const key = String\(taskId\);[\s\S]*cabinetClassificationMutationInFlight\.has\(key\)/);
    assert.match(css, /\.my-day-task-chip-remove/);
    assert.match(css, /\.my-day-task-chip--removable:hover \.my-day-task-chip-remove/);
    assert.match(css, /@media \(max-width: 720px\), \(pointer: coarse\)[\s\S]*\.my-day-task-chip-remove[\s\S]*opacity:\s*1/);
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

test('My Day habit setup uses a compact editor with conditional fields and checkbox impact chips', () => {
    const habitsUi = read('js/my-day-habits.js');
    const css = read('css/pages-profile.css');
    const setupStart = habitsUi.indexOf('function impactCheckboxes');
    const setupEnd = habitsUi.indexOf('async function mutate', setupStart);
    const setupSlice = habitsUi.slice(setupStart, setupEnd);
    assert.match(setupSlice, /my-day-habit-editor/);
    assert.match(setupSlice, /data-my-day-habit-open-editor="habit:create"/);
    assert.match(setupSlice, /input type="checkbox" name="impactIds"/);
    assert.match(setupSlice, /data-my-day-habit-impact-chip/);
    assert.doesNotMatch(setupSlice, /name="directionId"/);
    assert.doesNotMatch(setupSlice, /<select name="impactIds"/);
    assert.doesNotMatch(setupSlice, /multiple/);
    assert.match(setupSlice, /data-my-day-habit-conditional="target"/);
    assert.match(setupSlice, /data-my-day-habit-conditional="weekdays"/);
    assert.match(setupSlice, /data-my-day-habit-conditional="times"/);
    assert.match(habitsUi, /refreshConditionals/);
    assert.match(habitsUi, /refreshImpacts/);
    assert.match(habitsUi, /selected\.length >= maxImpacts\(\)/);
    assert.match(css, /\.my-day-habit-editor-grid/);
    assert.match(css, /\.my-day-impact-chip/);
    assert.match(css, /\.my-day-habit-editor \[hidden\]/);
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
    assert.match(contributionUi, /renderImpactGroups\(data\)/);
    assert.ok(contributionUi.includes("'" + IMPACTS_LABEL + "'"));
    assert.doesNotMatch(contributionUi, /myDayContributionDirectionsTitle/);
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

test('My Day setup redesign keeps mobile, dark mode, and archive UI contracts', () => {
    const taxonomyUi = read('js/my-day-classification.js');
    const habitsUi = read('js/my-day-habits.js');
    const css = read('css/pages-profile.css');
    assert.match(taxonomyUi, /data-my-day-taxonomy-toggle/);
    assert.match(taxonomyUi, /Архів \(/);
    assert.match(habitsUi, /data-my-day-habit-archive/);
    assert.match(habitsUi, /Архів звичок/);
    assert.match(css, /\/\* My Day setup redesign \*\//);
    assert.match(css, /@media \(max-width: 760px\)/);
    assert.match(css, /min-height:\s*40px/);
    assert.match(css, /overflow-x:\s*hidden/);
    assert.match(css, /body\.dark-mode \.profile-page\.profile-work-mode \.my-day-taxonomy-card\.my-day-setup-card/);
    assert.match(css, /html\[data-theme="dark"\] body \.profile-page\.profile-work-mode \.my-day-habit-editor/);
    assert.match(css, /\.my-day-setup-primary:focus-visible/);
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
