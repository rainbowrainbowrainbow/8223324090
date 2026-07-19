const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
    DEFAULT_TIMELINE_CONTEXT,
    normalizeTimelineContext,
    timelineContextFromRequest,
    canAccessTimelineContext,
    canUseTimelineAction
} = require('../services/timelineContext');
const { ACTION_PERMISSIONS } = require('../middleware/auth');

const ROOT = path.join(__dirname, '..');

test('timeline context defaults internal invalid normalization but fails closed for explicit bad request context', () => {
    assert.equal(normalizeTimelineContext(), DEFAULT_TIMELINE_CONTEXT);
    assert.equal(normalizeTimelineContext('unknown'), DEFAULT_TIMELINE_CONTEXT);
    assert.equal(normalizeTimelineContext('dar'), 'dar');
    assert.equal(normalizeTimelineContext('maysternya_doli'), 'maysternya_doli');
    assert.equal(timelineContextFromRequest({ query: { businessContext: 'unknown' } }), 'unknown');
    assert.equal(canAccessTimelineContext({ role: 'creator', business_contexts: ['event_genix'] }, 'unknown'), false);
});

test('timeline context can be resolved from request query, body, or header', () => {
    assert.equal(timelineContextFromRequest({ query: { businessContext: 'maysternya_doli' } }), 'maysternya_doli');
    assert.equal(timelineContextFromRequest({ body: { business_context: 'maysternya_doli' } }), 'maysternya_doli');
    assert.equal(timelineContextFromRequest({ headers: { 'x-business-context': 'maysternya_doli' } }), 'maysternya_doli');
    assert.equal(timelineContextFromRequest({ query: { businessContext: 'dar' } }), 'dar');
    assert.equal(canAccessTimelineContext({ role: 'creator', business_contexts: ['event_genix', 'dar'] }, 'dar'), true);
    assert.equal(canAccessTimelineContext({ role: 'manager', business_contexts: ['event_genix', 'dar'] }, 'dar'), false);
});

test('timeline API calls do not inherit the global CRM business header', () => {
    const apiCode = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');

    assert.match(apiCode, /function getTimelineAuthHeaders/);
    assert.match(apiCode, /delete headers\['X-Business-Context'\]/);
    assert.match(apiCode, /apiGetBookings[\s\S]*getTimelineAuthHeaders\(false\)/);
    assert.match(apiCode, /apiGetLines[\s\S]*getTimelineAuthHeaders\(false\)/);
    assert.match(apiCode, /apiCreateBooking[\s\S]*getTimelineAuthHeaders\(\)/);
});

test('timeline create API calls include the current timeline view without dropping business context', () => {
    const apiCode = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
    const createBookingStart = apiCode.indexOf('async function apiCreateBooking(');
    const createFullStart = apiCode.indexOf('async function apiCreateBookingFull(');
    const createFullEnd = apiCode.indexOf('async function apiGetBanquetByBooking', createFullStart);
    assert.notEqual(createBookingStart, -1);
    assert.notEqual(createFullStart, -1);
    assert.notEqual(createFullEnd, -1);

    const createBookingBlock = apiCode.slice(createBookingStart, createFullStart);
    const createFullBlock = apiCode.slice(createFullStart, createFullEnd);

    assert.match(apiCode, /function timelineApiUrlWithView\(url, options = \{\}\)[\s\S]*let path = timelineApiUrl\(url, options\)/);
    assert.match(apiCode, /window\.TimelineView\?\.current\?\.\(\)/);
    assert.match(createBookingBlock, /async function apiCreateBooking\(booking, options = \{\}\)/);
    assert.match(createBookingBlock, /timelineApiUrlWithView\('\/bookings', options\)/);
    assert.doesNotMatch(createBookingBlock, /timelineApiUrl\('\/bookings'\)/);
    assert.match(createFullBlock, /timelineApiUrlWithView\('\/bookings\/full', options\)/);
    assert.doesNotMatch(createFullBlock, /timelineApiUrl\('\/bookings\/full'\)/);
});

test('server-hydrated timeline display settings override stale local storage', () => {
    const contextCode = fs.readFileSync(path.join(ROOT, 'js', 'timeline-context.js'), 'utf8');
    const events = [];
    const stored = new Map([
        ['pzp_timeline_display_settings', JSON.stringify({ mode: 'park', parkKitchenMode: 'with_kitchen' })]
    ]);
    class CustomEvent {
        constructor(type, init = {}) {
            this.type = type;
            this.detail = init.detail || null;
        }
    }
    const classList = { toggle() {}, add() {}, remove() {}, contains() { return false; } };
    const sandbox = {
        console,
        URLSearchParams,
        CustomEvent,
        window: {
            location: { pathname: '/', search: '', href: 'https://crm.test/' },
            addEventListener() {},
            dispatchEvent(event) { events.push(event); }
        },
        document: {
            readyState: 'complete',
            body: {
                classList,
                dataset: {},
                setAttribute(name, value) { this[name] = value; }
            },
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener() {}
        },
        localStorage: {
            getItem: key => stored.get(key) || null,
            setItem: (key, value) => stored.set(key, value),
            removeItem: key => stored.delete(key)
        }
    };
    sandbox.window.localStorage = sandbox.localStorage;
    sandbox.window.CustomEvent = CustomEvent;

    vm.runInNewContext(contextCode, sandbox);

    const ctx = sandbox.window.TimelineBusinessContext.CONTEXTS.event_genix;
    assert.equal(sandbox.window.TimelineBusinessContext.displaySettings(ctx).mode, 'park');

    sandbox.window.TimelineBusinessContext.saveDisplaySettings(
        { mode: 'simple', resourceModel: 'specialist' },
        { context: ctx, source: 'server_business_profile', merge: false }
    );
    stored.set('pzp_timeline_display_settings', JSON.stringify({ mode: 'park', parkKitchenMode: 'with_kitchen' }));

    assert.equal(sandbox.window.TimelineBusinessContext.displaySettings(ctx).mode, 'simple');
    assert.equal(events.at(-1).detail.source, 'server_business_profile');
});

test('active timeline display legends include the shift overrun marker', () => {
    const contextCode = fs.readFileSync(path.join(ROOT, 'js', 'timeline-context.js'), 'utf8');
    const sandbox = {
        console,
        URLSearchParams,
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail || null;
            }
        },
        window: {
            location: { pathname: '/', search: '', href: 'https://crm.test/' },
            addEventListener() {},
            dispatchEvent() {}
        },
        document: {
            readyState: 'loading',
            body: {
                classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
                dataset: {},
                setAttribute() {}
            },
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener() {}
        },
        localStorage: {
            getItem: () => null,
            setItem() {},
            removeItem() {}
        }
    };
    sandbox.window.localStorage = sandbox.localStorage;
    sandbox.window.CustomEvent = sandbox.CustomEvent;

    vm.runInNewContext(contextCode, sandbox);

    const modes = sandbox.window.TimelineBusinessContext.DISPLAY_MODES;
    ['simple', 'specialist', 'park', 'education'].forEach(mode => {
        assert.match(modes[mode].legendHtml, /legend-item--time-overrun/);
        assert.match(modes[mode].legendHtml, /dot overrun/);
    });
    assert.doesNotMatch(modes.disabled.legendHtml, /legend-item--time-overrun/);
});

test('park timeline keeps add animator control when resource manager is disabled', () => {
    const contextCode = fs.readFileSync(path.join(ROOT, 'js', 'timeline-context.js'), 'utf8');
    const makeElement = () => {
        const classes = new Set();
        return {
            children: [],
            attrs: new Map(),
            title: '',
            querySelector: () => ({ textContent: '' }),
            toggleAttribute(name, force) {
                if (force) this.attrs.set(name, '');
                else this.attrs.delete(name);
            },
            classList: {
                add: name => classes.add(name),
                remove: name => classes.delete(name),
                contains: name => classes.has(name),
                toggle(name, force) {
                    const shouldAdd = force === undefined ? !classes.has(name) : Boolean(force);
                    if (shouldAdd) classes.add(name);
                    else classes.delete(name);
                }
            }
        };
    };
    const addLineBtn = makeElement();
    const sandbox = {
        console,
        URLSearchParams,
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail || null;
            }
        },
        window: {
            location: { pathname: '/', search: '', href: 'https://crm.test/' },
            addEventListener() {},
            dispatchEvent() {}
        },
        document: {
            title: '',
            readyState: 'complete',
            body: {
                classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
                dataset: {},
                setAttribute() {}
            },
            getElementById: id => ({ addLineBtn }[id] || null),
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener() {}
        },
        localStorage: {
            getItem: () => null,
            setItem() {},
            removeItem() {}
        }
    };
    sandbox.window.localStorage = sandbox.localStorage;

    vm.runInNewContext(contextCode, sandbox);

    assert.equal(sandbox.window.TimelineBusinessContext.presentation().mode, 'park');
    assert.equal(sandbox.window.TimelineBusinessContext.presentation().enabledModules.resources, false);
    assert.equal(addLineBtn.classList.contains('hidden'), false);
    assert.equal(addLineBtn.attrs.has('data-timeline-context-hidden'), false);
    assert.equal(sandbox.window.TimelineBusinessContext.presentation().controls.addLine, true);
});

test('Maysternya timeline control contract keeps booking actions visible without Park sales controls', () => {
    const contextCode = fs.readFileSync(path.join(ROOT, 'js', 'timeline-context.js'), 'utf8');
    const makeElement = () => {
        const classes = new Set();
        return {
            children: [],
            attrs: new Map(),
            title: '',
            textContent: '',
            querySelector: () => ({ textContent: '' }),
            toggleAttribute(name, force) {
                if (force) this.attrs.set(name, '');
                else this.attrs.delete(name);
            },
            classList: {
                add: name => classes.add(name),
                remove: name => classes.delete(name),
                contains: name => classes.has(name),
                toggle(name, force) {
                    const shouldAdd = force === undefined ? !classes.has(name) : Boolean(force);
                    if (shouldAdd) classes.add(name);
                    else classes.delete(name);
                }
            }
        };
    };
    const productSalesBtn = makeElement();
    const addLineBtn = makeElement();
    const sandbox = {
        console,
        URLSearchParams,
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail || null;
            }
        },
        window: {
            location: { pathname: '/maysternya-doli', search: '', href: 'https://crm.test/maysternya-doli' },
            addEventListener() {},
            dispatchEvent() {}
        },
        document: {
            title: '',
            readyState: 'complete',
            body: {
                classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
                dataset: {},
                setAttribute() {}
            },
            getElementById: id => ({
                productSalesBtn,
                addLineBtn
            }[id] || null),
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener() {}
        },
        localStorage: {
            getItem: () => null,
            setItem() {},
            removeItem() {}
        }
    };
    sandbox.window.localStorage = sandbox.localStorage;

    vm.runInNewContext(contextCode, sandbox);

    const view = sandbox.window.TimelineBusinessContext.presentation();
    assert.equal(view.mode, 'simple');
    assert.deepEqual(JSON.parse(JSON.stringify(view.controls)), {
        addLine: true,
        productSales: false,
        export: true
    });
    assert.equal(addLineBtn.classList.contains('hidden'), false);
    assert.equal(productSalesBtn.classList.contains('hidden'), true);
});

test('Dar simple timeline opens from URL before the server business profile hydrates', () => {
    const contextCode = fs.readFileSync(path.join(ROOT, 'js', 'timeline-context.js'), 'utf8');
    const sandbox = {
        console,
        URLSearchParams,
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail || null;
            }
        },
        window: {
            location: { pathname: '/', search: '?businessContext=dar', href: 'https://crm.test/?businessContext=dar' },
            addEventListener() {},
            dispatchEvent() {}
        },
        document: {
            title: '',
            readyState: 'complete',
            body: {
                classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
                dataset: {},
                setAttribute() {}
            },
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener() {}
        },
        localStorage: {
            getItem: () => null,
            setItem() {},
            removeItem() {}
        }
    };
    sandbox.window.localStorage = sandbox.localStorage;

    vm.runInNewContext(contextCode, sandbox);

    const ctx = sandbox.window.TimelineBusinessContext.current();
    const view = sandbox.window.TimelineBusinessContext.presentation();
    assert.equal(ctx.key, 'dar');
    assert.equal(ctx.path, '/?businessContext=dar');
    assert.equal(view.mode, 'simple');
    assert.equal(view.timelineEnabled, true);
    assert.equal(view.controls.addLine, true);
    assert.equal(sandbox.window.TimelineBusinessContext.appendApiContext('/api/bookings'), '/api/bookings?businessContext=dar');
});

test('root park timeline does not inherit a hidden global CRM business context', () => {
    const contextCode = fs.readFileSync(path.join(ROOT, 'js', 'timeline-context.js'), 'utf8');
    const sandbox = {
        console,
        URLSearchParams,
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail || null;
            }
        },
        window: {
            location: { pathname: '/', search: '', href: 'https://crm.test/' },
            CrmBusinessContext: {
                current: () => 'dar',
                state: () => ({
                    activeBusinessId: 'dar',
                    source: 'stored_global_context',
                    availableBusinesses: [{ key: 'event_genix' }, { key: 'dar' }]
                })
            },
            addEventListener() {},
            dispatchEvent() {}
        },
        document: {
            title: '',
            readyState: 'complete',
            body: {
                classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
                dataset: {},
                setAttribute() {}
            },
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener() {}
        },
        localStorage: {
            getItem: () => null,
            setItem() {},
            removeItem() {}
        }
    };
    sandbox.window.localStorage = sandbox.localStorage;

    vm.runInNewContext(contextCode, sandbox);

    const ctx = sandbox.window.TimelineBusinessContext.current();
    const state = sandbox.window.TimelineBusinessContext.state();
    assert.equal(ctx.key, 'event_genix');
    assert.equal(ctx.apiValue, 'event_genix');
    assert.equal(state.activeBusinessContext, 'event_genix');
    assert.equal(state.routeBusinessId, 'event_genix');
    assert.equal(state.crmBusinessId, 'dar');
    assert.equal(sandbox.window.TimelineBusinessContext.appendApiContext('/api/bookings/2026-06-08'), '/api/bookings/2026-06-08?businessContext=event_genix');
    const payload = sandbox.window.TimelineBusinessContext.withApiContext({ status: 'confirmed' });
    assert.equal(payload.status, 'confirmed');
    assert.equal(payload.businessContext, 'event_genix');
});

test('global business switch routes to the matching timeline surface', () => {
    const apiCode = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
    const sidebarCode = fs.readFileSync(path.join(ROOT, 'js', 'components', 'sidebar.js'), 'utf8');
    const uiCode = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
    const contextCode = fs.readFileSync(path.join(ROOT, 'js', 'timeline-context.js'), 'utf8');

    assert.match(apiCode, /timeline: \{ id: 'timeline', label: 'Timeline', paths: \['\/', '\/maysternya-doli'\] \}/);
    assert.match(apiCode, /function crmBusinessContextFromRoute/);
    assert.match(apiCode, /path === '\/maysternya-doli'\) return 'maysternya_doli'/);
    assert.match(apiCode, /function crmBusinessTimelineRoute/);
    assert.match(apiCode, /\?businessContext=\$\{encodeURIComponent\(key\)\}/);
    assert.match(apiCode, /function crmBusinessDestinationForCurrentPage[\s\S]*return crmBusinessTimelineRoute\(key\)/);
    assert.match(apiCode, /function crmBusinessDefaultTimelineRouteForUser/);
    assert.match(apiCode, /defaultTimelineRouteForUser: crmBusinessDefaultTimelineRouteForUser/);
    assert.match(sidebarCode, /item\.href === '\/' && current === 'maysternya_doli'\) return false/);
    assert.match(sidebarCode, /item\.href === '\/maysternya-doli' && current !== 'maysternya_doli'\) return creatorSurface/);
    assert.match(sidebarCode, /function _sidebarHrefForBusinessItem/);
    assert.match(sidebarCode, /\?businessContext=\$\{encodeURIComponent\(current\)\}/);
    assert.doesNotMatch(sidebarCode, /href: '\/maysternya-doli'[\s\S]{0,140}quickAccessOnly: true/);
    assert.match(contextCode, /brandName: 'Майстерня долі'/);
    assert.match(uiCode, /getTimelineExportBrandName/);
    assert.doesNotMatch(uiCode, /Парк Закревського Періоду - Таймлайн/);
});

test('sidebar timeline launcher derives zero, one, or two modes from the hydrated business profile', async () => {
    const sidebarCode = fs.readFileSync(path.join(ROOT, 'js', 'components', 'sidebar.js'), 'utf8');
    const sidebarRhythmCss = fs.readFileSync(path.join(ROOT, 'css', 'sidebar-aurora-rhythm.css'), 'utf8');
    const miniLinkStart = sidebarCode.indexOf('function _renderSidebarMiniLink(');
    const miniLinkEnd = sidebarCode.indexOf('function _renderSidebarRailSection(', miniLinkStart);
    assert.notEqual(miniLinkStart, -1);
    assert.notEqual(miniLinkEnd, -1);
    const miniLinkBlock = sidebarCode.slice(miniLinkStart, miniLinkEnd);
    assert.match(miniLinkBlock, /_sidebarNavigationHrefForBusinessItem\(item\)/);
    assert.doesNotMatch(miniLinkBlock, /data-sidebar-timeline-mode/);
    assert.match(sidebarCode, /sidebar\.addEventListener\('click', _handleSidebarTimelineModeClick\)/);
    assert.match(sidebarCode, /sidebar\.addEventListener\('keydown', _handleSidebarTimelineModeKeydown\)/);
    assert.match(sidebarCode, /\[data-sidebar-rail-item\], \[data-sidebar-timeline-mode\]/);
    assert.match(sidebarCode, /const link = e\.target\.closest\([\s\S]*?\[data-sidebar-timeline-mode\][\s\S]*?if \(!link\) return;[\s\S]*?if \(isMobileSidebar\(\)\) setMobileSidebarOpen\(false\);/);
    assert.match(sidebarRhythmCss, /--eg-timeline-launcher-duration:\s*170ms/);
    assert.match(sidebarRhythmCss, /\.sidebar-design-timeline-segment\s*\{[\s\S]*?min-height:\s*38px/);
    assert.match(sidebarRhythmCss, /data-sidebar-timeline-active-mode="rooms"[\s\S]*?translateX\(100%\)/);
    assert.match(sidebarRhythmCss, /@media \(prefers-reduced-motion:\s*reduce\)/);
    assert.match(sidebarRhythmCss, /--eg-sidebar-mobile-w:\s*min\(92vw,\s*336px\)/);
    assert.match(sidebarRhythmCss, /\.sidebar-nav\.collapsed \.sidebar-design-timeline-launcher[\s\S]*?display:\s*none !important/);

    const injectionPoint = /(\r?\n    return \{\r?\n        init,)/;
    assert.match(sidebarCode, injectionPoint);
    const instrumentedCode = sidebarCode.replace(injectionPoint, `
    window.__sidebarTimelineTestApi = {
        availableModes: _getAvailableTimelineModes,
        cardModel: _sidebarTimelineCardModel,
        renderExtraLink: _renderExtraMenuLink,
        handleModeClick: _handleSidebarTimelineModeClick,
        handleModeKeydown: _handleSidebarTimelineModeKeydown,
        syncLauncherState: _syncSidebarTimelineLauncherState
    };$1`);

    const state = {
        context: 'event_genix',
        moduleEnabled: true,
        profiles: {},
        timelineView: 'rooms',
        timelineSetCalls: []
    };
    const assignedHrefs = [];
    const location = {
        origin: 'https://crm.test',
        pathname: '/',
        search: '',
        hash: '',
        href: 'https://crm.test/',
        assign: href => assignedHrefs.push(href)
    };
    const localStorage = {
        getItem: () => null,
        setItem() {},
        removeItem() {}
    };
    const windowListeners = new Map();
    const document = {
        body: null,
        addEventListener() {},
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => []
    };
    const window = {
        location,
        localStorage,
        addEventListener(type, listener) {
            const listeners = windowListeners.get(type) || [];
            listeners.push(listener);
            windowListeners.set(type, listeners);
        },
        dispatchEvent() {},
        TimelineView: {
            current: () => state.timelineView,
            set(mode) {
                state.timelineSetCalls.push(mode);
                state.timelineView = mode;
                return Promise.resolve(mode);
            }
        },
        CrmBusinessContext: {
            current: () => state.context,
            hasModule: () => state.moduleEnabled,
            profileFor: context => state.profiles[context] || null,
            activeProfile: () => state.profiles[state.context] || null
        }
    };
    const sandbox = {
        console,
        URL,
        URLSearchParams,
        location,
        localStorage,
        window,
        document,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval
    };

    vm.runInNewContext(instrumentedCode, sandbox);

    const api = window.__sidebarTimelineTestApi;
    const rootItem = { href: '/', icon: 'calendar', label: 'Таймлайн', access: 'timeline' };
    const maysternyaItem = { href: '/maysternya-doli', icon: 'calendar', label: 'Таймлайн МД', access: 'maysternya_doli' };
    const compact = modes => Array.from(modes, ({ key, label, href }) => ({ key, label, href }));

    state.profiles.event_genix = {
        key: 'event_genix',
        timeline: { mode: 'park', timelineEnabled: true, roomTimelineEnabled: true },
        modules: { enabled: { timeline: true } },
        shell: { timelineEnabled: true }
    };
    assert.deepEqual(compact(api.availableModes(rootItem)), [
        { key: 'animators', label: 'Свята', href: '/?timelineView=animators' },
        { key: 'rooms', label: 'Кімнати', href: '/?timelineView=rooms' }
    ]);
    assert.equal(api.cardModel(rootItem).variant, 'launcher');
    assert.equal(api.cardModel(rootItem).href, '/');
    const launcherHtml = api.renderExtraLink(rootItem, '/', '');
    assert.match(launcherHtml, /^<div class="sidebar-design-timeline-launcher active"/);
    assert.match(launcherHtml, /class="sidebar-design-extra-link sidebar-design-timeline-main active" href="\/"/);
    assert.match(launcherHtml, /data-sidebar-timeline-active-mode="rooms"/);
    assert.match(launcherHtml, /href="\/\?timelineView=animators" data-sidebar-timeline-mode="animators" aria-pressed="false"/);
    assert.match(launcherHtml, /class="sidebar-design-timeline-segment active" href="\/\?timelineView=rooms" data-sidebar-timeline-mode="rooms" aria-pressed="true" aria-current="page"/);
    assert.equal((launcherHtml.match(/sidebar-design-timeline-segment-check/g) || []).length, 2);
    assert.equal((launcherHtml.match(/sidebar-design-timeline-segment-label/g) || []).length, 2);
    assert.doesNotMatch(launcherHtml, /<button\b/i);
    assert.equal((launcherHtml.match(/<a\b/g) || []).length, 3);
    let anchorDepth = 0;
    let maxAnchorDepth = 0;
    (launcherHtml.match(/<\/?a\b[^>]*>/g) || []).forEach(tag => {
        anchorDepth += tag.startsWith('</') ? -1 : 1;
        maxAnchorDepth = Math.max(maxAnchorDepth, anchorDepth);
    });
    assert.equal(anchorDepth, 0);
    assert.equal(maxAnchorDepth, 1);

    const makeModeLink = (mode, href) => ({
        dataset: { sidebarTimelineMode: mode },
        getAttribute: name => name === 'href' ? href : null
    });
    const makeClick = (link, overrides = {}) => ({
        button: 0,
        defaultPrevented: false,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        target: { closest: () => link },
        preventDefault() { this.defaultPrevented = true; },
        ...overrides
    });
    const animatorLink = makeModeLink('animators', '/?timelineView=animators');
    const plainTimelineClick = makeClick(animatorLink);
    assert.equal(api.handleModeClick(plainTimelineClick), true);
    await Promise.resolve();
    assert.equal(plainTimelineClick.defaultPrevented, true);
    assert.deepEqual(state.timelineSetCalls, ['animators']);
    assert.equal(state.timelineView, 'animators');
    assert.deepEqual(assignedHrefs, []);

    const ctrlTimelineClick = makeClick(makeModeLink('rooms', '/?timelineView=rooms'), { ctrlKey: true });
    assert.equal(api.handleModeClick(ctrlTimelineClick), false);
    assert.equal(ctrlTimelineClick.defaultPrevented, false);
    assert.deepEqual(state.timelineSetCalls, ['animators']);

    const middleTimelineClick = makeClick(makeModeLink('rooms', '/?timelineView=rooms'), { button: 1 });
    assert.equal(api.handleModeClick(middleTimelineClick), false);
    assert.equal(middleTimelineClick.defaultPrevented, false);
    assert.deepEqual(state.timelineSetCalls, ['animators']);

    let keyboardClickCount = 0;
    const keyboardLink = { click: () => { keyboardClickCount += 1; } };
    const spaceModeKeydown = {
        key: ' ',
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        target: { closest: () => keyboardLink },
        preventDefault() { this.defaultPrevented = true; }
    };
    assert.equal(api.handleModeKeydown(spaceModeKeydown), true);
    assert.equal(spaceModeKeydown.defaultPrevented, true);
    assert.equal(keyboardClickCount, 1);
    assert.equal(api.handleModeKeydown({ ...spaceModeKeydown, key: 'Enter', defaultPrevented: false }), false);

    location.pathname = '/dashboard';
    const remotePageClick = makeClick(makeModeLink('rooms', '/?timelineView=rooms'));
    assert.equal(api.handleModeClick(remotePageClick), false);
    assert.equal(remotePageClick.defaultPrevented, false);
    assert.deepEqual(state.timelineSetCalls, ['animators']);
    location.pathname = '/';

    const makeClassList = initial => {
        const values = new Set(initial);
        return {
            toggle(name, force) {
                if (force) values.add(name);
                else values.delete(name);
            },
            contains: name => values.has(name)
        };
    };
    const makeSyncLink = mode => {
        const attributes = new Map();
        return {
            dataset: { sidebarTimelineMode: mode },
            classList: makeClassList([]),
            setAttribute: (name, value) => attributes.set(name, value),
            removeAttribute: name => attributes.delete(name),
            getAttribute: name => attributes.get(name)
        };
    };
    const syncedAnimatorLink = makeSyncLink('animators');
    const syncedRoomsLink = makeSyncLink('rooms');
    const launcherNode = {
        dataset: {},
        classList: makeClassList([]),
        querySelectorAll: () => [syncedAnimatorLink, syncedRoomsLink]
    };
    document.querySelectorAll = selector => selector === '[data-sidebar-timeline-launcher]' ? [launcherNode] : [];
    state.timelineView = 'rooms';
    const timelineViewListener = windowListeners.get('timeline:view-changed')?.at(-1);
    assert.equal(typeof timelineViewListener, 'function');
    timelineViewListener({ detail: { view: 'rooms' } });
    assert.equal(launcherNode.dataset.sidebarTimelineActiveMode, 'rooms');
    assert.equal(syncedAnimatorLink.classList.contains('active'), false);
    assert.equal(syncedRoomsLink.classList.contains('active'), true);
    assert.equal(syncedAnimatorLink.getAttribute('aria-pressed'), 'false');
    assert.equal(syncedRoomsLink.getAttribute('aria-pressed'), 'true');
    assert.equal(syncedRoomsLink.getAttribute('aria-current'), 'page');

    state.timelineView = 'animators';
    timelineViewListener({ detail: { view: 'animators' } });
    assert.equal(syncedAnimatorLink.classList.contains('active'), true);
    assert.equal(syncedRoomsLink.classList.contains('active'), false);
    assert.equal(syncedAnimatorLink.getAttribute('aria-pressed'), 'true');
    assert.equal(syncedRoomsLink.getAttribute('aria-pressed'), 'false');
    assert.equal(syncedRoomsLink.getAttribute('aria-current'), undefined);
    document.querySelectorAll = () => [];

    delete state.profiles.event_genix.timeline.roomTimelineEnabled;
    assert.equal(api.availableModes(rootItem).length, 2);

    state.profiles.event_genix.timeline.roomTimelineEnabled = false;
    assert.deepEqual(compact(api.availableModes(rootItem)), [
        { key: 'animators', label: 'Свята', href: '/?timelineView=animators' }
    ]);
    assert.equal(api.cardModel(rootItem).variant, 'single');
    assert.equal(api.cardModel(rootItem).href, '/?timelineView=animators');
    const singleModeHtml = api.renderExtraLink(rootItem, '/', '');
    assert.doesNotMatch(singleModeHtml, /timeline-launcher|timeline-mode-count|data-sidebar-timeline-mode/);
    assert.equal((singleModeHtml.match(/<a\b/g) || []).length, 1);

    state.profiles.event_genix.timeline = { mode: 'simple', timelineEnabled: true };
    assert.equal(api.availableModes(rootItem).length, 1);

    delete state.profiles.event_genix;
    assert.equal(api.availableModes(rootItem).length, 1);
    state.profiles.event_genix = {
        key: 'event_genix',
        timeline: { mode: 'park', timelineEnabled: true, roomTimelineEnabled: true },
        modules: { enabled: { timeline: true } }
    };
    assert.equal(api.availableModes(rootItem).length, 2);

    state.context = 'dar';
    state.profiles.dar = {
        key: 'dar',
        timeline: { mode: 'simple', timelineEnabled: true },
        modules: { enabled: { timeline: true } }
    };
    assert.deepEqual(compact(api.availableModes(rootItem)), [
        { key: 'animators', label: 'Свята', href: '/?businessContext=dar&timelineView=animators' }
    ]);

    state.context = 'maysternya_doli';
    state.profiles.maysternya_doli = {
        key: 'maysternya_doli',
        timeline: { mode: 'simple', timelineEnabled: true },
        modules: { enabled: { timeline: true } }
    };
    assert.deepEqual(compact(api.availableModes(maysternyaItem)), [
        { key: 'animators', label: 'Свята', href: '/maysternya-doli?timelineView=animators' }
    ]);

    state.profiles.maysternya_doli.timeline = { mode: 'disabled', timelineEnabled: false };
    state.moduleEnabled = false;
    assert.deepEqual(compact(api.availableModes(maysternyaItem)), []);
    assert.equal(api.cardModel(maysternyaItem).variant, 'hidden');
    assert.equal(api.renderExtraLink(maysternyaItem, '/maysternya-doli', ''), '');

    state.context = 'event_genix';
    state.profiles.event_genix.timeline = { mode: 'disabled', timelineEnabled: false };
    assert.deepEqual(compact(api.availableModes(rootItem, { role: 'creator' })), [
        { key: 'animators', label: 'Свята', href: '/?timelineView=animators' }
    ]);
});

test('lead conversion routes Maysternya bookings to the Maysternya timeline surface', () => {
    const leadsCode = fs.readFileSync(path.join(ROOT, 'js', 'leads-page.js'), 'utf8');

    assert.match(leadsCode, /function leadTimelineRouteForContext/);
    assert.match(leadsCode, /function leadRecordText/);
    assert.match(leadsCode, /normalized === 'maysternya_doli'[\s\S]*return '\/maysternya-doli'/);
    assert.match(leadsCode, /function leadTimelineHref/);
    assert.match(leadsCode, /businessContext', normalized/);
    assert.match(leadsCode, /function ensureLeadCustomerForBooking/);
    assert.match(leadsCode, /params\.set\('customerId', customer\.id\)/);
    assert.match(leadsCode, /function offerDealCustomerCardFlow/);
    assert.match(leadsCode, /function ensureDealCustomerCardForLead/);
    assert.match(leadsCode, /leadCrmContextHref\('\/customers', \{ open: ensured\.customer\.id \}/);
    assert.match(leadsCode, /okText: 'Відкрити картку'/);
    assert.doesNotMatch(leadsCode, /function offerDealBookingFlow/);
    assert.doesNotMatch(leadsCode, /Створити бронювання на таймлайні зараз/);
    assert.match(leadsCode, /'client_name', 'clientName', 'customerName', 'name'/);
    assert.match(leadsCode, /'phone', 'clientPhone', 'customerPhone', 'contact_phone', 'contactPhone', 'contact', 'whatsapp'/);
    assert.match(leadsCode, /window\.location\.href = leadTimelineHref\(Object\.fromEntries\(params\.entries\(\)\), leadContextFromRecord\(conversionLead\)\)/);
    assert.doesNotMatch(leadsCode, /window\.location\.href = `\/\?\$\{params\.toString\(\)\}`/);
});

test('Maysternya sidebar keeps sales tools visible without Park-only clutter', () => {
    const sidebarCode = fs.readFileSync(path.join(ROOT, 'js', 'components', 'sidebar.js'), 'utf8');

    assert.match(sidebarCode, /function _sidebarUserHasCreator/);
    assert.match(sidebarCode, /Array\.isArray\(user\?\.extraRoles\)/);
    assert.match(sidebarCode, /Array\.isArray\(user\?\.extra_roles\)/);
    assert.match(sidebarCode, /roles\.filter\(Boolean\)\.map\(value => String\(value\)\.trim\(\)\)\.includes\('creator'\)/);
    assert.match(sidebarCode, /if \(!_sidebarUserHasCreator\(user\)\) return false/);
    assert.match(sidebarCode, /const MAYSTERNYA_SIDEBAR_HREFS = new Set/);
    assert.match(sidebarCode, /'\/sales-funnel'/);
    assert.match(sidebarCode, /'\/customers'/);
    assert.match(sidebarCode, /'\/omni#accounts'/);
    assert.match(sidebarCode, /function _isMaysternyaSidebarContext/);
    assert.match(sidebarCode, /if \(_isMaysternyaSidebarContext\(user\) && !_isMaysternyaSidebarHrefAllowed\(item\)\) return false/);
    assert.match(sidebarCode, /item\.href === '\/' && current === 'maysternya_doli'\) return false/);
    assert.match(sidebarCode, /item\.href === '\/maysternya-doli' && current !== 'maysternya_doli'\) return creatorSurface/);
    assert.match(sidebarCode, /if \(creatorSurface && current !== 'maysternya_doli'\) return true/);
});

test('non-creator account lock migration forces Park while director unlock migration restores director contexts', () => {
    const migration = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '256_lock_non_creator_business_contexts.sql'), 'utf8');
    const directorMigration = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '257_director_business_context_access.sql'), 'utf8');

    assert.match(migration, /MIGRATION_KIND: data-fix/);
    assert.match(migration, /business_contexts = ARRAY\['event_genix'\]::text\[\]/);
    assert.match(migration, /default_business_context = 'event_genix'/);
    assert.match(migration, /WHERE COALESCE\(role, ''\) <> 'creator'/);

    assert.match(directorMigration, /MIGRATION_KIND: data-fix/);
    assert.match(directorMigration, /role = 'director'/);
    assert.match(directorMigration, /ARRAY\['event_genix', 'dar', 'maysternya_doli', 'crm'\]::text\[\]/);
});

test('timeline root uses account default instead of stale stored business context', () => {
    const apiCode = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');

    assert.match(apiCode, /const accountDefault = policy\.defaultContext \|\| CRM_BUSINESS_DEFAULT_CONTEXT/);
    assert.match(apiCode, /const timelineEntryDefault = crmBusinessContextSupportsTimeline\(accountDefault\) \? accountDefault : CRM_BUSINESS_DEFAULT_CONTEXT/);
    assert.match(apiCode, /const preferAccountDefaultOnTimelineRoot = normalizedCrmPath\(\) === '\/' && !fromUrl/);
    assert.match(apiCode, /preferAccountDefaultOnTimelineRoot \? timelineEntryDefault : \(stored \|\| accountDefault\)/);

    const stored = new Map([
        ['pzp_crm_business_context', 'maysternya_doli'],
        ['pzp_crm_business_context_user', '42']
    ]);
    const sandbox = {
        console,
        URL,
        URLSearchParams,
        window: {
            location: { pathname: '/', search: '', href: 'https://crm.test/' },
            history: { replaceState() {} },
            dispatchEvent() {},
            addEventListener() {}
        },
        localStorage: {
            getItem: key => stored.get(key) || null,
            setItem: (key, value) => stored.set(key, value),
            removeItem: key => stored.delete(key)
        },
        AppState: {
            currentUser: {
                id: 42,
                role: 'creator',
                businessContexts: ['event_genix', 'maysternya_doli'],
                defaultBusinessContext: 'event_genix'
            }
        }
    };
    sandbox.window.localStorage = sandbox.localStorage;
    vm.runInNewContext(apiCode, sandbox);

    assert.equal(sandbox.window.CrmBusinessContext.current(sandbox.AppState.currentUser), 'event_genix');
    assert.equal(sandbox.window.CrmBusinessContext.defaultTimelineRouteForUser(sandbox.AppState.currentUser), '/');
    sandbox.AppState.currentUser.businessContexts = ['event_genix', 'dar', 'maysternya_doli'];
    sandbox.AppState.currentUser.defaultBusinessContext = 'dar';
    assert.equal(sandbox.window.CrmBusinessContext.current(sandbox.AppState.currentUser), 'dar');
    assert.equal(sandbox.window.CrmBusinessContext.defaultTimelineRouteForUser(sandbox.AppState.currentUser), '/?businessContext=dar');
    sandbox.AppState.currentUser.defaultBusinessContext = 'maysternya_doli';
    assert.equal(sandbox.window.CrmBusinessContext.current(sandbox.AppState.currentUser), 'maysternya_doli');
    assert.equal(sandbox.window.CrmBusinessContext.defaultTimelineRouteForUser(sandbox.AppState.currentUser), '/maysternya-doli');
});

test('canonical business state repairs invalid or unauthorized persisted business context', () => {
    const apiCode = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
    assert.match(apiCode, /function resolveCrmBusinessContextState/);
    assert.match(apiCode, /function clearCrmBusinessContextStorage/);
    assert.match(apiCode, /storageBusinessId/);

    const makeSandbox = (stored, user) => {
        const sandbox = {
            console,
            URL,
            URLSearchParams,
            window: {
                location: { pathname: '/', search: '', href: 'https://crm.test/' },
                history: { replaceState() {} },
                dispatchEvent() {},
                addEventListener() {}
            },
            localStorage: {
                getItem: key => stored.get(key) || null,
                setItem: (key, value) => stored.set(key, value),
                removeItem: key => stored.delete(key)
            },
            AppState: { currentUser: user }
        };
        sandbox.window.localStorage = sandbox.localStorage;
        vm.runInNewContext(apiCode, sandbox);
        return sandbox;
    };

    const invalidStored = new Map([
        ['pzp_crm_business_context', 'ghost_business'],
        ['pzp_crm_business_context_user', '42'],
        ['pzp_crm_business_scope_mode', 'multi'],
        ['pzp_crm_business_scope_contexts', '["event_genix","maysternya_doli"]'],
        ['pzp_products_business_context', 'maysternya_doli']
    ]);
    const creator = {
        id: 42,
        role: 'creator',
        businessContexts: ['event_genix', 'maysternya_doli'],
        defaultBusinessContext: 'event_genix'
    };
    const invalidSandbox = makeSandbox(invalidStored, creator);
    const invalidState = invalidSandbox.window.CrmBusinessContext.state(creator);
    assert.equal(invalidState.activeBusinessId, 'event_genix');
    assert.equal(invalidState.storageBusinessId, null);
    assert.equal(invalidStored.has('pzp_crm_business_context'), false);
    assert.equal(invalidStored.has('pzp_products_business_context'), false);
    assert.equal(invalidStored.has('pzp_crm_business_scope_mode'), false);

    const unauthorizedStored = new Map([
        ['pzp_crm_business_context', 'maysternya_doli'],
        ['pzp_crm_business_context_user', '7']
    ]);
    const singleBusinessUser = {
        id: 7,
        role: 'manager',
        businessContexts: ['event_genix'],
        defaultBusinessContext: 'event_genix'
    };
    const unauthorizedSandbox = makeSandbox(unauthorizedStored, singleBusinessUser);
    const unauthorizedState = unauthorizedSandbox.window.CrmBusinessContext.state(singleBusinessUser);
    assert.equal(unauthorizedState.activeBusinessId, 'event_genix');
    assert.equal(unauthorizedState.storageBusinessId, null);
    assert.equal(unauthorizedStored.has('pzp_crm_business_context'), false);
    assert.equal(unauthorizedStored.has('pzp_crm_business_context_user'), false);

    const preAuthStored = new Map([
        ['pzp_crm_business_context', 'maysternya_doli'],
        ['pzp_crm_business_context_user', '42']
    ]);
    const preAuthSandbox = makeSandbox(preAuthStored, null);
    const preAuthState = preAuthSandbox.window.CrmBusinessContext.state(null);
    assert.equal(preAuthState.storageBusinessId, 'maysternya_doli');
    assert.equal(preAuthStored.get('pzp_crm_business_context'), 'maysternya_doli');
});

test('CRM business aggregate scope hydrates only on aggregate-safe pages', () => {
    const apiCode = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');

    assert.match(apiCode, /const CRM_BUSINESS_AGGREGATE_PAGE_IDS = new Set/);
    assert.match(apiCode, /function resolveCrmBusinessScopeState/);
    assert.match(apiCode, /allowsAggregate: crmBusinessPageAllowsAggregate/);
    assert.match(apiCode, /hasPageBinding: crmBusinessPageHasBinding/);

    const creator = {
        id: 42,
        role: 'creator',
        businessContexts: ['event_genix', 'dar', 'maysternya_doli'],
        defaultBusinessContext: 'event_genix'
    };
    const makeSandbox = (pathname, search, stored = new Map()) => {
        const href = `https://crm.test${pathname}${search || ''}`;
        const sandbox = {
            console,
            URL,
            URLSearchParams,
            window: {
                location: { pathname, search, href, origin: 'https://crm.test' },
                history: { replaceState() {} },
                dispatchEvent() {},
                addEventListener() {}
            },
            document: { body: { dataset: {} }, getElementById: () => null },
            localStorage: {
                getItem: key => stored.get(key) || null,
                setItem: (key, value) => stored.set(key, value),
                removeItem: key => stored.delete(key)
            },
            AppState: { currentUser: creator }
        };
        sandbox.window.localStorage = sandbox.localStorage;
        vm.runInNewContext(apiCode, sandbox);
        return sandbox;
    };

    const allSandbox = makeSandbox('/customers', '?businessScope=all');
    const allScope = allSandbox.window.CrmBusinessContext.scope(creator);
    assert.equal(allScope.mode, 'all');
    assert.equal(allScope.readOnly, true);
    assert.equal(allScope.canWrite, false);
    assert.equal(allSandbox.window.CrmBusinessContext.apiUrl('/api/customers'), '/api/customers?businessScope=all&businessContext=event_genix');
    assert.deepEqual(JSON.parse(JSON.stringify(allSandbox.window.CrmBusinessContext.payload({ page: 1 }))), {
        page: 1,
        businessContext: 'event_genix',
        businessScope: 'all',
        businessContexts: ['event_genix', 'dar', 'maysternya_doli']
    });

    const stored = new Map([
        ['pzp_crm_business_context', 'dar'],
        ['pzp_crm_business_context_user', '42'],
        ['pzp_crm_business_scope_mode', 'multi'],
        ['pzp_crm_business_scope_contexts', '["dar","maysternya_doli"]']
    ]);
    const multiSandbox = makeSandbox('/leads', '', stored);
    const multiScope = multiSandbox.window.CrmBusinessContext.scope(creator);
    assert.equal(multiScope.mode, 'multi');
    assert.deepEqual(JSON.parse(JSON.stringify(multiScope.selectedContexts)), ['dar', 'maysternya_doli']);
    assert.equal(
        multiSandbox.window.CrmBusinessContext.apiUrl('/api/leads'),
        '/api/leads?businessScope=multi&businessContext=dar&businessContexts=dar%2Cmaysternya_doli'
    );

    const timelineSandbox = makeSandbox('/', '?businessScope=all&businessContexts=dar,maysternya_doli');
    const timelineScope = timelineSandbox.window.CrmBusinessContext.scope(creator);
    assert.equal(timelineScope.mode, 'single');
    assert.equal(timelineScope.readOnly, false);
    assert.deepEqual(JSON.parse(JSON.stringify(timelineScope.selectedContexts)), ['event_genix']);
});

test('login starts from account timeline instead of role shell page', () => {
    const authCode = fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8');

    assert.match(authCode, /function getAuthenticatedTimelineStartPage/);
    assert.match(authCode, /getAuthenticatedTimelineStartPage\(data\.user \|\| AppState\.currentUser\)/);
    assert.match(authCode, /const currentRoute = `\$\{currentPath\}\$\{window\.location\.search \|\| ''\}`/);
    assert.match(authCode, /if \(currentRoute !== startPage\)/);
    assert.doesNotMatch(authCode, /const startPage = getRoleStartPage\(data\.user/);
});

test('Oleksandr account default migration keeps only Oleksandr on Maysternya Doli', () => {
    const migration = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '230_timeline_default_business_by_account.sql'), 'utf8');

    assert.match(migration, /classified_users/);
    assert.match(migration, /default_business_context = CASE[\s\S]*WHEN classified_users\.is_oleksandr THEN 'maysternya_doli'/);
    assert.match(migration, /THEN 'event_genix'[\s\S]*ELSE u\.default_business_context/);
    assert.match(migration, /ARRAY\['maysternya_doli'\]::text\[\]/);
});

test('timeline load routes keep legacy default-context rows visible', () => {
    const bookingsRoute = fs.readFileSync(path.join(ROOT, 'routes', 'bookings.js'), 'utf8');
    const linesRoute = fs.readFileSync(path.join(ROOT, 'routes', 'lines.js'), 'utf8');

    assert.match(bookingsRoute, /function bookingContextSql[\s\S]*DEFAULT_TIMELINE_CONTEXT/);
    assert.match(bookingsRoute, /bookingContextSql\('b', '\$2'\)/);
    assert.match(bookingsRoute, /bookingContextSql\('', '\$3'\)/);
    assert.match(linesRoute, /COALESCE\(l\.business_context, '\$\{DEFAULT_TIMELINE_CONTEXT\}'\) = \$2/);
});

test('Maysternya Doli access accepts creator grants only', () => {
    assert.equal(canAccessTimelineContext({ role: 'creator' }, 'maysternya_doli'), true);
    assert.equal(canAccessTimelineContext({ role: 'manager', extraRoles: ['creator'] }, 'maysternya_doli'), true);
    assert.equal(canAccessTimelineContext({ role: 'manager', pageAllowlist: ['/maysternya-doli'] }, 'maysternya_doli'), false);
    assert.equal(canAccessTimelineContext({ role: 'manager' }, 'maysternya_doli'), false);
});

test('Maysternya Doli actions are creator-scoped inside the allowed surface', () => {
    const director = { role: 'director', pageAllowlist: ['/maysternya-doli'] };
    const managerWithCreatorGrant = { role: 'instructor', extraRoles: ['creator'], businessContexts: ['event_genix', 'maysternya_doli'], pageAllowlist: ['/maysternya-doli'] };
    const creator = { role: 'creator' };

    assert.equal(canUseTimelineAction(director, 'maysternya_doli', 'create'), false);
    assert.equal(canUseTimelineAction(director, 'maysternya_doli', 'delete'), false);
    assert.equal(canUseTimelineAction(director, 'maysternya_doli', 'settings'), false);
    assert.equal(canUseTimelineAction(managerWithCreatorGrant, 'maysternya_doli', 'create'), true);
    assert.equal(canUseTimelineAction(managerWithCreatorGrant, 'maysternya_doli', 'edit'), true);
    assert.equal(canUseTimelineAction(creator, 'maysternya_doli', 'delete'), true);
    assert.equal(canUseTimelineAction(creator, 'maysternya_doli', 'sales'), false);
    assert.equal(canUseTimelineAction({ role: 'manager', pageAllowlist: ['/maysternya-doli'] }, 'maysternya_doli', 'settings'), false);
});

test('park timeline delete action is manager-operational while permanent delete stays guarded', () => {
    const authCode = fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8');
    const contextCode = fs.readFileSync(path.join(ROOT, 'js', 'timeline-context.js'), 'utf8');
    const bookingsRoute = fs.readFileSync(path.join(ROOT, 'routes', 'bookings.js'), 'utf8');
    const accessAuditScript = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-timeline-access.js'), 'utf8');
    const pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
    const operationalRoles = ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'accountant', 'art_director', 'marketer', 'it_specialist', 'hr', 'admin'];

    for (const role of operationalRoles) {
        assert.ok(ACTION_PERMISSIONS.create_booking.includes(role), `${role} can create bookings`);
        assert.ok(ACTION_PERMISSIONS.edit_booking.includes(role), `${role} can edit bookings`);
        assert.ok(ACTION_PERMISSIONS.delete_booking.includes(role), `${role} can soft-delete bookings`);
        assert.equal(canUseTimelineAction({ role }, DEFAULT_TIMELINE_CONTEXT, 'delete'), true, `${role} can delete in default timeline`);
        assert.equal(canUseTimelineAction({ role }, 'park_zakrevsky', 'delete'), true, `${role} can delete in park alias`);
    }
    assert.match(authCode, /delete_booking:\s+_ADMIN_UP/);
    assert.match(contextCode, /delete: \['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'accountant', 'art_director', 'marketer', 'it_specialist', 'hr', 'admin'\]/);
    assert.match(bookingsRoute, /function requirePermanentBookingDelete/);
    assert.match(bookingsRoute, /userHasAnyRole\(req\.user, \['creator', 'director'\]\)/);
    assert.match(bookingsRoute, /if \(permanent && !requirePermanentBookingDelete\(req, res\)\) return/);
    assert.match(pkg, /"audit:timeline-access": "node scripts\/audit-timeline-access\.js"/);
    assert.match(accessAuditScript, /NAMED_ACCOUNT_TERMS/);
    assert.match(accessAuditScript, /dasha/);
    assert.match(accessAuditScript, /vitalina/);
    assert.match(accessAuditScript, /REQUIRE_DB/);
});

test('Oleksandra1 unlock migration grants full visible CRM surface without changing primary role', () => {
    const migration = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '231_unlock_oleksandra1_full_access.sql'), 'utf8');

    assert.match(migration, /lower\(trim\(COALESCE\(username, ''\)\)\) = 'oleksandra1'/);
    assert.match(migration, /extra_roles[\s\S]*ARRAY\['creator'\]::text\[\]/);
    assert.match(migration, /page_allowlist[\s\S]*ARRAY\['\/maysternya-doli'\]::text\[\]/);
    assert.match(migration, /business_contexts = ARRAY\['event_genix', 'dar', 'maysternya_doli', 'crm'\]::text\[\]/);
    assert.match(migration, /default_business_context = 'event_genix'/);
    assert.doesNotMatch(migration, /\brole\s*=/);
    assert.doesNotMatch(migration, /password_hash/);
});

test('Oleksandr Maysternya unlock migration grants creator surface to the actual operator accounts', () => {
    const migration = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '232_unlock_oleksandr_maysternya_full_access.sql'), 'utf8');

    assert.match(migration, /target_users/);
    assert.match(migration, /'oleksandr'/);
    assert.match(migration, /'oleksandra1'/);
    assert.match(migration, /\^\(oleksandr\|oleksandra\|alexandr\|alexandra\|aleksandr\|aleksandra\|alexander\|sasha\)/);
    assert.match(migration, /Олександр\|Олександра/);
    assert.match(migration, /extra_roles[\s\S]*ARRAY\['creator'\]::text\[\]/);
    assert.match(migration, /page_allowlist[\s\S]*ARRAY\['\/maysternya-doli'\]::text\[\]/);
    assert.match(migration, /business_contexts = ARRAY\['event_genix', 'dar', 'maysternya_doli', 'crm'\]::text\[\]/);
    assert.doesNotMatch(migration, /\brole\s*=/);
    assert.doesNotMatch(migration, /password_hash/);
});

test('Oleksandr default reset migration starts operators from the full CRM timeline surface', () => {
    const migration = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '233_reset_oleksandr_default_to_full_crm.sql'), 'utf8');

    assert.match(migration, /target_users/);
    assert.match(migration, /'oleksandr'/);
    assert.match(migration, /'oleksandra1'/);
    assert.match(migration, /extra_roles[\s\S]*ARRAY\['creator'\]::text\[\]/);
    assert.match(migration, /page_allowlist[\s\S]*ARRAY\['\/maysternya-doli'\]::text\[\]/);
    assert.match(migration, /business_contexts = ARRAY\['event_genix', 'dar', 'maysternya_doli', 'crm'\]::text\[\]/);
    assert.match(migration, /default_business_context = 'event_genix'/);
    assert.doesNotMatch(migration, /\brole\s*=/);
    assert.doesNotMatch(migration, /password_hash/);
});

test('current account default migration routes Oleksandr to Maysternya and everyone else to Park', () => {
    const migration = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '234_default_timeline_by_account.sql'), 'utf8');

    assert.match(migration, /target_users/);
    assert.match(migration, /classified_users/);
    assert.match(migration, /'oleksandr'/);
    assert.match(migration, /'oleksandra1'/);
    assert.match(migration, /\^\(oleksandr\|oleksandra\|alexandr\|alexandra\|aleksandr\|aleksandra\|alexander\|sasha\)/);
    assert.match(migration, /extra_roles[\s\S]*ARRAY\['creator'\]::text\[\]/);
    assert.match(migration, /page_allowlist[\s\S]*ARRAY\['\/maysternya-doli'\]::text\[\]/);
    assert.match(migration, /business_contexts = CASE[\s\S]*ARRAY\['event_genix', 'dar', 'maysternya_doli', 'crm'\]::text\[\]/);
    assert.match(migration, /default_business_context = CASE[\s\S]*WHEN classified_users\.is_oleksandr THEN 'maysternya_doli'[\s\S]*THEN 'event_genix'/);
    assert.match(migration, /NOT classified_users\.is_oleksandr/);
    assert.doesNotMatch(migration, /\brole\s*=/);
    assert.doesNotMatch(migration, /password_hash/);
});
