const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function readRepoFile(...parts) {
    return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

function createLoaderContext() {
    const appendedScripts = [];
    const context = {
        window: {},
        document: {
            createElement(tagName) {
                assert.equal(tagName, 'script');
                return {
                    dataset: {},
                    async: false,
                    src: '',
                    onload: null,
                    onerror: null
                };
            },
            head: {
                appendChild(script) {
                    appendedScripts.push(script);
                    return script;
                }
            }
        },
        Error
    };
    vm.createContext(context);
    vm.runInContext(readRepoFile('js', 'staff-schedule-loader.js'), context);
    return { context, appendedScripts };
}

test('HR uses lazy staff schedule loader while standalone staff page keeps direct module load', () => {
    const hrHtml = readRepoFile('hr.html');
    const staffHtml = readRepoFile('staff.html');
    const loaderCode = readRepoFile('js', 'staff-schedule-loader.js');

    assert.match(hrHtml, /js\/staff-schedule-loader\.js\?v=0\.81\.112/);
    assert.doesNotMatch(hrHtml, /js\/staff-page\.js\?v=0\.81\.112/);
    assert.match(staffHtml, /js\/staff-page\.js\?v=0\.81\.112/);
    assert.match(loaderCode, /let staffSchedulePageLoadPromise = null/);
    assert.match(loaderCode, /window\.StaffSchedulePage = lazyStaffSchedulePage/);
    assert.match(loaderCode, /window\.loadStaffSchedulePageModule = loadStaffSchedulePageModule/);
});

test('staff schedule lazy loader deduplicates concurrent module loads', async () => {
    const { context, appendedScripts } = createLoaderContext();
    const calls = [];

    const initOne = context.window.StaffSchedulePage.init({ mode: 'hr' });
    const initTwo = context.window.StaffSchedulePage.init({ mode: 'hr' });
    assert.equal(appendedScripts.length, 1);
    assert.match(appendedScripts[0].src, /js\/staff-page\.js\?v=0\.81\.112/);

    context.window.StaffSchedulePage = {
        init(options) {
            calls.push(options);
            return Promise.resolve({ success: true, options });
        },
        isInitialized() {
            return true;
        }
    };
    appendedScripts[0].onload();

    await Promise.all([initOne, initTwo]);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(call => call.mode), ['hr', 'hr']);
    assert.equal(context.window.StaffSchedulePage.isInitialized(), true);
});

test('staff schedule lazy loader clears failed in-flight load so user action can retry', async () => {
    const { context, appendedScripts } = createLoaderContext();

    const failedRefresh = context.window.StaffSchedulePage.refresh();
    assert.equal(appendedScripts.length, 1);
    appendedScripts[0].onerror();
    await assert.rejects(failedRefresh, /Failed to load staff schedule module/);

    const retriedRefresh = context.window.StaffSchedulePage.refresh({ staffId: 42 });
    assert.equal(appendedScripts.length, 2);
    context.window.StaffSchedulePage = {
        init() {
            return Promise.resolve();
        },
        refresh(options) {
            return Promise.resolve({ success: true, options });
        }
    };
    appendedScripts[1].onload();

    assert.deepEqual(await retriedRefresh, { success: true, options: { staffId: 42 } });
});
