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

const ROOT = path.join(__dirname, '..');

test('timeline context defaults invalid or missing values to Event Genix', () => {
    assert.equal(normalizeTimelineContext(), DEFAULT_TIMELINE_CONTEXT);
    assert.equal(normalizeTimelineContext('unknown'), DEFAULT_TIMELINE_CONTEXT);
    assert.equal(normalizeTimelineContext('maysternya_doli'), 'maysternya_doli');
});

test('timeline context can be resolved from request query, body, or header', () => {
    assert.equal(timelineContextFromRequest({ query: { businessContext: 'maysternya_doli' } }), 'maysternya_doli');
    assert.equal(timelineContextFromRequest({ body: { business_context: 'maysternya_doli' } }), 'maysternya_doli');
    assert.equal(timelineContextFromRequest({ headers: { 'x-business-context': 'maysternya_doli' } }), 'maysternya_doli');
});

test('timeline API calls do not inherit the global CRM business header', () => {
    const apiCode = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');

    assert.match(apiCode, /function getTimelineAuthHeaders/);
    assert.match(apiCode, /delete headers\['X-Business-Context'\]/);
    assert.match(apiCode, /apiGetBookings[\s\S]*getTimelineAuthHeaders\(false\)/);
    assert.match(apiCode, /apiGetLines[\s\S]*getTimelineAuthHeaders\(false\)/);
    assert.match(apiCode, /apiCreateBooking[\s\S]*getTimelineAuthHeaders\(\)/);
});

test('global business switch routes to the matching timeline surface', () => {
    const apiCode = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
    const sidebarCode = fs.readFileSync(path.join(ROOT, 'js', 'components', 'sidebar.js'), 'utf8');
    const uiCode = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
    const contextCode = fs.readFileSync(path.join(ROOT, 'js', 'timeline-context.js'), 'utf8');

    assert.match(apiCode, /timeline: \{ id: 'timeline', label: 'Timeline', paths: \['\/', '\/maysternya-doli'\] \}/);
    assert.match(apiCode, /function crmBusinessContextFromRoute/);
    assert.match(apiCode, /path === '\/maysternya-doli'\) return 'maysternya_doli'/);
    assert.match(apiCode, /function crmBusinessDestinationForCurrentPage[\s\S]*return '\/maysternya-doli'/);
    assert.match(sidebarCode, /if \(item\.href === '\/' && current === 'maysternya_doli'\) return false/);
    assert.match(sidebarCode, /if \(item\.href === '\/maysternya-doli' && current !== 'maysternya_doli'\) return false/);
    assert.doesNotMatch(sidebarCode, /href: '\/maysternya-doli'[\s\S]{0,140}quickAccessOnly: true/);
    assert.match(contextCode, /brandName: 'Майстерня Долі'/);
    assert.match(uiCode, /getTimelineExportBrandName/);
    assert.doesNotMatch(uiCode, /Парк Закревського Періоду - Таймлайн/);
});

test('timeline root uses account default instead of stale stored business context', () => {
    const apiCode = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');

    assert.match(apiCode, /const accountDefault = policy\.defaultContext \|\| CRM_BUSINESS_DEFAULT_CONTEXT/);
    assert.match(apiCode, /const preferAccountDefaultOnTimelineRoot = normalizedCrmPath\(\) === '\/' && !fromUrl/);
    assert.match(apiCode, /preferAccountDefaultOnTimelineRoot \? accountDefault : \(stored \|\| accountDefault\)/);

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
    sandbox.AppState.currentUser.defaultBusinessContext = 'maysternya_doli';
    assert.equal(sandbox.window.CrmBusinessContext.current(sandbox.AppState.currentUser), 'maysternya_doli');
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

    assert.match(bookingsRoute, /COALESCE\(b\.business_context, \$2\) = \$2/);
    assert.match(bookingsRoute, /COALESCE\(business_context, \$3\) = \$3/);
    assert.match(linesRoute, /COALESCE\(l\.business_context, \$2\) = \$2/);
});

test('Maysternya Doli access is creator-only', () => {
    assert.equal(canAccessTimelineContext({ role: 'creator' }, 'maysternya_doli'), true);
    assert.equal(canAccessTimelineContext({ role: 'manager', extraRoles: ['creator'] }, 'maysternya_doli'), true);
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
