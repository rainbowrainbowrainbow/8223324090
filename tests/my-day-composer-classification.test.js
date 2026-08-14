'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function read(file) {
    return fs.readFileSync(path.join(root, file), 'utf8');
}

function loadClassificationUi() {
    const code = read('js/my-day-classification.js');
    const context = {
        console,
        fetch: async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }),
        window: {
            getAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
            escapeHtml: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
            showNotification: () => {}
        },
        document: { getElementById: () => null, querySelectorAll: () => [] },
        FormData
    };
    vm.createContext(context);
    vm.runInContext(code, context);
    return context;
}

function composerBody(source) {
    const match = source.match(/function renderComposerFields\(\) \{([\s\S]*?)function readComposerClassification\(\)/);
    assert.ok(match, 'renderComposerFields body should be discoverable');
    return match[1];
}

test('My Day composer renders only impact chip controls', () => {
    const context = loadClassificationUi();
    const api = context.window.MyDayClassification;
    api.state.impacts = [
        { id: 20, name: 'System', icon: 'S', color: '#2563eb', isActive: true },
        { id: 21, name: 'Health', icon: 'H', color: '#ef4444', isActive: true }
    ];

    const html = api.renderComposerFields();
    const source = read('js/my-day-classification.js');

    assert.match(html, /my-day-composer-classification/);
    assert.match(html, /my-day-composer-impact-chip/);
    assert.match(html, /type="checkbox" name="composerImpactIds"/);
    assert.match(html, /data-my-day-composer-impact-chip/);
    assert.match(html, /data-my-day-impact-filter/);
    assert.match(html, /data-my-day-impact-selection-count>0 \/ 5/);
    assert.match(html, /my-day-impact-group-count/);
    assert.match(html, /2 готових категорій/);
    assert.doesNotMatch(html, /my-day-composer-tag-field|data-my-day-tag-input|cabinetTaskDirection/);
    assert.doesNotMatch(source, /data-my-day-composer-tag-value|renderTagInput|normalizeTags|bindTagInputs/);
    assert.doesNotMatch(composerBody(source), /<select[^>]+multiple/);
});

test('My Day composer payload sends only impactIds', () => {
    const context = loadClassificationUi();
    const api = context.window.MyDayClassification;
    context.document = {
        getElementById: () => null,
        querySelectorAll: selector => selector === '[data-my-day-composer-impact-chip]:checked'
            ? [{ value: '20' }, { value: '21' }, { value: '22' }]
            : []
    };

    const payload = api.readComposerClassification();
    assert.deepEqual(JSON.parse(JSON.stringify(payload)), { impactIds: [20, 21, 22] });
});

test('My Day composer guards max five impacts and preserves create integration', () => {
    const context = loadClassificationUi();
    const api = context.window.MyDayClassification;
    const profile = read('js/profile-page.js');
    context.document = {
        getElementById: () => null,
        querySelectorAll: selector => selector === '[data-my-day-composer-impact-chip]:checked'
            ? [{ value: '20' }, { value: '21' }, { value: '22' }, { value: '23' }, { value: '24' }, { value: '25' }]
            : []
    };

    assert.throws(() => api.readComposerClassification());
    assert.match(profile, /readComposerClassification\?\.\(\)/);
    assert.match(profile, /myDayClassification\?\.impactIds\?\.length/);
    assert.doesNotMatch(profile, /myDayClassification\?\.tags\?\.length/);
    assert.match(profile, /saveTaskClassification\?\.\(verification\.taskId, myDayClassification\)/);
});

test('My Day composer CSS isolates impacts layout without task tag styles', () => {
    const css = read('css/pages-profile.css');
    const iconCss = read('css/my-day-impact-icons.css');
    assert.match(css, /cabinet-task-composer-meta-advanced > \.my-day-composer-classification\s*\{[\s\S]*grid-column:\s*1 \/ -1/);
    assert.match(css, /\.my-day-composer-classification\s*\{[\s\S]*grid-template-columns:\s*1fr/);
    assert.match(css, /\.my-day-composer-impact-grid\s*\{[\s\S]*display:\s*grid/);
    assert.match(iconCss, /\.my-day-impact-group-grid\s*\{[\s\S]*grid-template-columns/);
    assert.match(iconCss, /\.my-day-impact-group-grid \.my-day-impact-chip\s*\{[\s\S]*display:\s*flex !important/);
    assert.match(iconCss, /\.my-day-impact-group-grid \.my-day-impact-chip\[hidden\]\s*\{[\s\S]*display:\s*none !important/);
    assert.match(iconCss, /\.my-day-impact-group\[hidden\]\s*\{[\s\S]*display:\s*none !important/);
    assert.match(iconCss, /\.my-day-impact-toolbar\s*\{[\s\S]*justify-content:\s*space-between/);
    assert.match(iconCss, /@media \(max-width: 680px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(css, /body\.dark-mode \.profile-page\.profile-work-mode \.my-day-composer-classification/);
    assert.doesNotMatch(css, /\.my-day-tag|\.my-day-task-tags|my-day-composer-direction-select/);
});

test('My Day composer chip binder disables unselected impacts after the fifth selection', () => {
    const source = read('js/my-day-classification.js');
    assert.match(source, /data-my-day-composer-impact-chip/);
    assert.match(source, /input\.disabled = atLimit && !input\.checked/);
    assert.match(source, /data-my-day-composer-impact-selected/);
    assert.match(source, /data-my-day-impact-filter/);
    assert.match(source, /chip\.hidden = !matches/);
    assert.match(source, /count\.textContent = `\$\{selectedIds\.length\} \/ \$\{maxImpacts\(\)\}`/);
});

test('My Day task impact chips show every selected impact without an overflow counter', () => {
    const context = loadClassificationUi();
    const api = context.window.MyDayClassification;
    const html = api.renderTaskBadges({
        impacts: [
            { id: 1, name: 'CRM', icon: 'C', color: '#2563eb' },
            { id: 2, name: 'Hermes', icon: 'H', color: '#0f766e' },
            { id: 3, name: 'Парк', icon: 'P', color: '#f59e0b' }
        ]
    }, { taskId: 101 });

    assert.match(html, /CRM/);
    assert.match(html, /Hermes/);
    assert.match(html, /Парк/);
    assert.doesNotMatch(html, /my-day-task-chip--more/);
    assert.doesNotMatch(html, /data-cabinet-task-action="reveal-impact"/);
    assert.doesNotMatch(html, /\shidden(?:\s|>)/);
    assert.match(html, /title="Парк"/);
});

test('My Day task impact chips keep all five allowed impacts visible', () => {
    const context = loadClassificationUi();
    const html = context.window.MyDayClassification.renderTaskBadges({
        impacts: Array.from({ length: 5 }, (_, index) => ({
            id: index + 1,
            name: `Impact ${index + 1}`,
            icon: String(index + 1),
            color: '#2563eb'
        }))
    }, { taskId: 101 });

    assert.equal((html.match(/data-my-day-impact-id="/g) || []).length, 5);
    assert.equal((html.match(/data-cabinet-task-action="classification"/g) || []).length, 6);
    assert.doesNotMatch(html, /my-day-task-chip--more|reveal-impact|\shidden(?:\s|>)/);
});

test('My Day task impact chips open the editor with task and impact ids', () => {
    const context = loadClassificationUi();
    const api = context.window.MyDayClassification;
    const html = api.renderTaskBadges({
        impacts: [
            { id: 1, name: 'CRM', icon: 'C', color: '#2563eb' },
            { id: 2, name: 'Hermes', icon: 'H', color: '#0f766e' },
            { id: 3, name: 'Park', icon: 'P', color: '#f59e0b' }
        ]
    }, { taskId: 101 });

    assert.match(html, /<button type="button" class="my-day-task-chip my-day-task-chip--impact my-day-task-chip--editable/);
    assert.match(html, /data-cabinet-task-action="classification"/);
    assert.doesNotMatch(html, /data-cabinet-task-action="remove-impact"/);
    assert.doesNotMatch(html, /data-cabinet-task-action="reveal-impact"/);
    assert.match(html, /data-task-id="101"/);
    assert.match(html, /data-my-day-impact-id="1"/);
    assert.match(html, /data-my-day-impact-name="CRM"/);
    assert.match(html, /aria-label="Змінити вплив CRM"/);
    assert.match(html, /data-my-day-impact-id="3"/);
    assert.match(html, /my-day-task-chip--add/);
    assert.doesNotMatch(html, /\shidden(?:\s|>)/);
});

test('My Day editable impact chips and task editor have compact responsive CSS states', () => {
    const classification = read('js/my-day-classification.js');
    const css = read('css/pages-profile.css');
    const cabinetCss = read('css/pages-cabinet.css');

    assert.match(classification, /data-my-day-editor-edit-impact/);
    assert.match(classification, /data-my-day-editor-edit-form/);
    assert.match(classification, /method:\s*'PATCH'/);
    assert.match(classification, /\/impacts\/'\s*\+\s*encodeURIComponent\(form\.dataset\.impactId\)/);
    assert.match(css, /\.my-day-task-chip:is\(button\)/);
    assert.match(css, /\.my-day-task-chip:is\(button\)\s*\{[\s\S]*min-height:\s*36px/);
    assert.match(css, /transform:\s*translateY\(-1px\)/);
    assert.match(css, /\.my-day-task-chip--add/);
    assert.match(css, /\.my-day-impact-editor-selected-edit/);
    assert.match(css, /\.my-day-impact-editor-edit-form/);
    assert.match(css, /\.my-day-impact-editor-edit-actions/);
    assert.match(css, /\.task-ui-action-surface--my-day-impacts\.is-popover \.task-ui-action-panel/);
    assert.match(css, /\.my-day-impact-editor-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.my-day-impact-editor-edit-actions,[\s\S]*\.my-day-impact-editor-grid\s*\{[\s\S]*grid-template-columns:\s*1fr/);
    assert.match(css, /\.my-day-task-impact-chips\.is-classification-pending/);
    assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
    assert.match(cabinetCss, /\.cabinet-overdue-triage-row \.my-day-task-chip--editable/);
});

test('Profile My Day shared task handler opens the editor instead of removing chips directly', () => {
    const profile = read('js/profile-page.js');

    assert.match(profile, /action === 'classification' \|\| action === 'remove-impact'/);
    assert.match(profile, /openTaskEditor\?\.\(anchor,\s*findCabinetTask\(taskId\)/);
    assert.match(profile, /cabinetClassificationMutationInFlight/);
    assert.match(profile, /data-cabinet-task-action="classification"/);
    assert.doesNotMatch(profile, /data-cabinet-task-action="reveal-impact"/);
    assert.match(profile, /refreshCabinetTaskClassificationBadges\(taskId,\s*classification\)/);
    assert.match(profile, /renderTaskBadges\?\.\(task\.myDay,\s*\{ taskId \}\)/);
    assert.match(profile, /function bindCabinetTaskActions/);
    assert.match(profile, /aria-label="\$\{escapeHtml\(doneTitle\)\}"/);
});

test('Profile My Day compact cards use stable zones instead of one mixed meta row', () => {
    const profile = read('js/profile-page.js');
    const css = read('css/pages-cabinet.css');
    const timeUi = read('js/my-day-time-tracking.js');

    assert.match(profile, /cabinet-task-zone--header/);
    assert.match(profile, /cabinet-task-zone--facts/);
    assert.match(profile, /cabinet-task-zone--classification/);
    assert.match(profile, /renderCabinetMyDayTimeTrigger/);
    assert.match(profile, /renderCabinetMyDayTimeSummary/);
    assert.match(profile, /cabinet-task-main--my-day/);
    assert.match(profile, /renderTaskTrigger\(task,\s*\{ buttonClassName \}\)/);
    assert.match(profile, /renderTaskSummary\?\.\(task\)/);
    assert.match(profile, /renderCabinetOverdueTriageProgress\(task\)/);
    assert.match(profile, /time-menu/);
    assert.match(timeUi, /data-cabinet-task-action="time-menu"/);
    assert.match(timeUi, /data-my-day-time-menu-action="time-entry"/);
    assert.match(timeUi, /data-my-day-time-menu-action="time-entries"/);
    const compactTimeControls = timeUi.slice(
        timeUi.indexOf('function renderTaskTrigger'),
        timeUi.indexOf('async function addManualEntry')
    );
    assert.match(compactTimeControls, /data-cabinet-task-action="time-menu"/);
    assert.match(compactTimeControls, /Відкрити час задачі/);
    assert.match(compactTimeControls, /cabinet-task-action-timer/);
    assert.doesNotMatch(compactTimeControls, /data-cabinet-task-action="time-entry"/);
    assert.doesNotMatch(compactTimeControls, /data-cabinet-task-action="time-entries"/);
    assert.doesNotMatch(compactTimeControls, /data-cabinet-task-action="timer-start"/);
    assert.match(css, /\.cabinet-task-zone--header/);
    assert.match(css, /-webkit-line-clamp:\s*2/);
    assert.match(css, /\.cabinet-task-card\.is-my-day-compact-card\[data-task-priority\][\s\S]*background:\s*transparent/);
    assert.match(css, /\.cabinet-overdue-triage-row\s*\{[\s\S]*background:\s*transparent/);
});

test('Profile My Day card view mode is localStorage-scoped and has per-card expansion', () => {
    const profile = read('js/profile-page.js');
    const css = read('css/pages-cabinet.css');
    const timeUi = read('js/my-day-time-tracking.js');

    assert.match(profile, /let cabinetMyDayViewMode = 'compact'/);
    assert.match(profile, /CABINET_MY_DAY_VIEW_MODE_OPTIONS/);
    assert.match(profile, /data-cabinet-my-day-view-mode/);
    assert.match(profile, /localStorage\?\.getItem\?\.\(cabinetMyDayViewPreferenceKey\(\)\)/);
    assert.match(profile, /localStorage\?\.setItem\?\.\(cabinetMyDayViewPreferenceKey\(\), cabinetMyDayViewMode\)/);
    assert.match(profile, /TimelineBusinessContext\?\.storageKey/);
    assert.match(profile, /data-cabinet-task-action="toggle-my-day-details"/);
    assert.match(profile, /function renderCabinetMyDayDetailToggle\(taskIdAttr = '', expanded = false/);
    assert.match(profile, /aria-expanded="\$\{expanded \? 'true' : 'false'\}"/);
    assert.match(profile, /showMyDayDetails \? myDaySubtaskSummary : ''/);
    assert.match(timeUi, /options\.detailed === true/);
    assert.match(timeUi, /data-cabinet-task-action="time-menu"/);
    assert.match(timeUi, /const timerAction = active \? 'timer-stop' : 'timer-start'/);
    assert.match(timeUi, /data-my-day-time-menu-action="\$\{timerAction\}"/);
    assert.match(timeUi, /data-my-day-time-menu-action="time-entry"/);
    assert.match(timeUi, /data-my-day-time-menu-action="time-entries"/);
    assert.match(css, /\.cabinet-day-list-toolbar/);
    assert.match(css, /\.cabinet-view-mode-toggle/);
    assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
});
