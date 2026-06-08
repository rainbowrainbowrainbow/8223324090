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
    const roomLoadBtn = makeElement();
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
            getElementById: id => ({ addLineBtn, roomLoadBtn }[id] || null),
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
    assert.equal(roomLoadBtn.classList.contains('hidden'), true);
    assert.equal(sandbox.window.TimelineBusinessContext.presentation().controls.addLine, true);
    assert.equal(sandbox.window.TimelineBusinessContext.presentation().controls.roomLoad, false);
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
    const newBookingBtn = makeElement();
    const addLineBtn = makeElement();
    const roomLoadBtn = makeElement();
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
                newBookingBtn,
                addLineBtn,
                roomLoadBtn
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
        createBooking: true,
        addLine: true,
        roomLoad: true,
        productSales: false,
        export: true
    });
    assert.equal(newBookingBtn.classList.contains('hidden'), false);
    assert.equal(newBookingBtn.attrs.has('data-timeline-context-hidden'), false);
    assert.equal(addLineBtn.classList.contains('hidden'), false);
    assert.equal(roomLoadBtn.classList.contains('hidden'), false);
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
    assert.equal(view.controls.createBooking, true);
    assert.equal(view.controls.addLine, true);
    assert.equal(sandbox.window.TimelineBusinessContext.appendApiContext('/api/bookings'), '/api/bookings?businessContext=dar');
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

test('lead conversion routes Maysternya bookings to the Maysternya timeline surface', () => {
    const leadsCode = fs.readFileSync(path.join(ROOT, 'js', 'leads-page.js'), 'utf8');

    assert.match(leadsCode, /function leadTimelineRouteForContext/);
    assert.match(leadsCode, /normalized === 'maysternya_doli'[\s\S]*return '\/maysternya-doli'/);
    assert.match(leadsCode, /function leadTimelineHref/);
    assert.match(leadsCode, /businessContext', normalized/);
    assert.match(leadsCode, /window\.location\.href = leadTimelineHref\(Object\.fromEntries\(params\.entries\(\)\), leadContextFromRecord\(lead\)\)/);
    assert.doesNotMatch(leadsCode, /window\.location\.href = `\/\?\$\{params\.toString\(\)\}`/);
});

test('Maysternya sidebar keeps sales tools visible without Park-only clutter', () => {
    const sidebarCode = fs.readFileSync(path.join(ROOT, 'js', 'components', 'sidebar.js'), 'utf8');

    assert.match(sidebarCode, /function _sidebarUserHasCreator/);
    assert.match(sidebarCode, /return String\(user\?\.role \|\| user\?\.account_role \|\| user\?\.accountRole \|\| ''\)\.trim\(\) === 'creator'/);
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

test('Maysternya Doli access is creator-only', () => {
    assert.equal(canAccessTimelineContext({ role: 'creator' }, 'maysternya_doli'), true);
    assert.equal(canAccessTimelineContext({ role: 'manager', extraRoles: ['creator'] }, 'maysternya_doli'), false);
    assert.equal(canAccessTimelineContext({ role: 'manager', pageAllowlist: ['/maysternya-doli'] }, 'maysternya_doli'), false);
    assert.equal(canAccessTimelineContext({ role: 'manager' }, 'maysternya_doli'), false);
});

test('Maysternya Doli actions are creator-scoped inside the allowed surface', () => {
    const director = { role: 'director', pageAllowlist: ['/maysternya-doli'] };
    const managerWithExtraRole = { role: 'instructor', extraRoles: ['director'], pageAllowlist: ['/maysternya-doli'] };
    const creator = { role: 'creator' };

    assert.equal(canUseTimelineAction(director, 'maysternya_doli', 'create'), false);
    assert.equal(canUseTimelineAction(director, 'maysternya_doli', 'delete'), false);
    assert.equal(canUseTimelineAction(director, 'maysternya_doli', 'settings'), false);
    assert.equal(canUseTimelineAction(managerWithExtraRole, 'maysternya_doli', 'edit'), false);
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
