'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { resolveCapability } = require('../services/accountAccessPolicy');
const { businessModuleCatalog, configuredBusinessModuleEnabled } = require('../services/businessModuleRegistry');

const SIDEBAR = fs.readFileSync(path.join(__dirname, '../js/components/sidebar.js'), 'utf8');
const MODULES = ['dashboard', 'timeline', 'tasks', 'customers', 'leads', 'omni', 'programs', 'settings'];

function renderSidebar(t, role, options = {}) {
    const context = options.context === undefined ? 'event_genix' : options.context;
    const status = options.status || (context ? 'ready' : 'selection_required');
    const modules = options.modules || MODULES;
    const membership = { businessContext: context, role, accessMode: 'membership', businessModules: modules };
    const user = {
        id: 101, username: 'sidebar_navigation_fixture', role, roles: [role, ...(options.extraRoles || [])],
        extraRoles: options.extraRoles || [], pageDenylist: options.pageDenylist || [],
        activeBusinessContext: context, activeBusinessMembership: membership,
        membershipMode: 'membership', accessContext: { status },
        businessMembershipAccess: { configured: true, membershipEnabled: true, activeMembership: membership }
    };
    const profile = context && status === 'ready' ? {
        key: context, accessMode: 'membership',
        modules: { source: 'business_registry', enabled: Object.fromEntries(
            businessModuleCatalog(context).map(({ key }) => [key,
                configuredBusinessModuleEnabled({ contextKey: context, modules }, key)])
        ) },
        timeline: { mode: context === 'event_genix' ? 'park' : 'simple', roomTimelineEnabled: true }
    } : null;
    const dom = new JSDOM('<!doctype html><div id="sidebarLinks" class="sidebar-links"></div>', {
        url: 'https://sidebar.test/', runScripts: 'outside-only'
    });
    t.after(() => dom.window.close());
    const window = dom.window;
    window.AppState = { currentUser: user };
    window.RolePreview = {
        getPreviewRole: () => options.previewRole || null,
        getEffectiveRole: () => options.previewRole || role
    };
    window.CrmBusinessContext = {
        current: () => context,
        hasModule: (_context, moduleId) => profile?.modules.enabled[moduleId] === true,
        activeProfile: () => profile,
        profileFor: target => target === context ? profile : null
    };
    window.canAccessPage = page => resolveCapability(options.previewRole
        ? { role: options.previewRole, roles: [options.previewRole] } : user, page, { type: 'page' }).allowed;
    window.requestAnimationFrame = () => 0;
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    vm.runInContext(SIDEBAR, dom.getInternalVMContext(), { filename: 'js/components/sidebar.js' });
    vm.runInContext("Sidebar.render('#sidebarLinks', { refreshOperational: false })", dom.getInternalVMContext());
    const links = selector => [...window.document.querySelectorAll(selector)].map(link => link.getAttribute('href')).sort();
    return {
        all: links('#sidebarLinks a.nav-link'),
        system: links('[data-group-key="system"] a.nav-link'),
        hr: links('[data-group-key="team"] a.nav-link'),
        groups: [...window.document.querySelectorAll('#sidebarLinks [data-group-key]')].map(group => group.dataset.groupKey).sort(),
        user, profile
    };
}

test('primary director renders the same complete business menu as creator after membership cutover', t => {
    const creator = renderSidebar(t, 'creator');
    const director = renderSidebar(t, 'director');
    assert.equal(director.profile.modules.enabled.hr, false, 'fixture reproduces the unmigrated HR module');
    assert.equal(director.profile.modules.enabled.warehouse, false, 'fixture reproduces the disabled System module');
    assert.deepEqual(director.all, creator.all);
    assert.deepEqual(director.groups, creator.groups);
    assert.deepEqual(director.system, creator.system);
    assert.deepEqual(director.hr, creator.hr);
    for (const href of ['/chat', '/guardian-ops', '/center', '/center?tab=tickets', '/timeline-settings', '/warehouse', '/game', '/demo']) {
        assert.ok(director.system.includes(href), `System restores ${href}`);
    }
    for (const href of ['/hr', '/hr#team', '/hr#structure', '/hr#payroll', '/hr#other', '/checkin', '/training']) {
        assert.ok(director.hr.includes(href), `HR restores ${href}`);
    }
    assert.equal(director.user.role, 'director');
    assert.deepEqual(director.user.extraRoles, []);
});

test('canonical explicit page denies still remove a director page and all its hash links', t => {
    const director = renderSidebar(t, 'director', { pageDenylist: ['/hr', '/center', '/warehouse'] });
    assert.ok(!director.all.some(href => href === '/hr' || href.startsWith('/hr#')));
    assert.ok(!director.all.some(href => href === '/center' || href.startsWith('/center?')));
    assert.ok(!director.system.includes('/warehouse'));
    assert.ok(director.system.includes('/guardian-ops'), 'unrelated director navigation remains available');
    assert.ok(director.hr.includes('/training'), 'unrelated HR links remain available');
});

test('lower roles and an extra director role do not inherit primary-director module visibility', t => {
    for (const role of ['senior_manager', 'manager', 'hr', 'animator']) {
        for (const extraRoles of [[], ['director']]) {
            const rendered = renderSidebar(t, role, { extraRoles });
            assert.ok(!rendered.all.includes('/hr'), `${role}/${extraRoles} keeps HR hidden`);
            assert.ok(!rendered.system.includes('/warehouse'), `${role}/${extraRoles} keeps disabled modules hidden`);
            if (resolveCapability(rendered.user, '/programs', { type: 'page' }).allowed) {
                assert.ok(rendered.all.includes('/programs'), 'supported and permitted modules continue to render');
            }
        }
    }
});

test('role preview cannot retain director navigation beyond the preview role business modules', t => {
    const preview = renderSidebar(t, 'director', { previewRole: 'manager' });
    const manager = renderSidebar(t, 'manager');
    assert.deepEqual(preview.all, manager.all);
    assert.ok(!preview.all.includes('/hr'));
    assert.ok(!preview.system.includes('/warehouse'));
});

test('director navigation remains business-scoped and preserves Maysternya restrictions', t => {
    for (const context of ['dar', 'fixture_studio']) {
        const creator = renderSidebar(t, 'creator', { context });
        const director = renderSidebar(t, 'director', { context });
        assert.deepEqual(director.all, creator.all, context);
        assert.ok(!director.all.includes('/maysternya-doli'), 'other businesses do not grant the private MD shell');
    }
    const md = renderSidebar(t, 'director', { context: 'maysternya_doli' });
    assert.ok(!md.all.includes('/hr'));
    assert.ok(!md.all.includes('/warehouse'));
    assert.ok(!md.all.some(href => href === '/' || href.startsWith('/?')), 'MD never adds the Park timeline');
});

test('missing business selection or unavailable access cannot restore director modules', t => {
    for (const options of [{ context: null }, { status: 'unavailable' }, { status: 'selection_required' }]) {
        const rendered = renderSidebar(t, 'director', options);
        assert.ok(!rendered.all.includes('/hr'));
        assert.ok(!rendered.system.includes('/warehouse'));
        assert.ok(!rendered.system.includes('/guardian-ops'));
    }
});
