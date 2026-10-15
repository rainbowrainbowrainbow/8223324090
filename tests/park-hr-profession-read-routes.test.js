'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

const STAFF_ID = 9701;
const PRIVATE = 'SYNTHETIC_PRIVATE_STAFF_FIELD';
const PERSON = {
    id: STAFF_ID, name: 'Synthetic Park Worker', department: 'animators', position: 'Animator',
    phone: '+380000000001', emergency_contact: 'Synthetic Contact', emergency_phone: '+380000000002',
    role_type: 'animator', secondary_professions: ['host'], hire_date: '2024-01-01',
    birth_date: '1990-01-01', address: 'Synthetic address', is_active: true, hourly_rate: 12345,
    rate_unit: 'hour', company_structure_node_id: 1, photo_url: null, notes: 'Synthetic note',
    telegram_id: 'synthetic-id', telegram_username: 'synthetic-user', color: '#22aaaa',
    contract_type: 'parttime', skills: ['hosting'], is_freelance: false, unique_person_key: PRIVATE,
    hr_pool_status: 'core', blacklist_reason: null, blacklisted_at: null,
    termination_date: null, termination_reason: null, termination_recorded_at: null,
    termination_recorded_by: null, has_account: true, has_face_descriptor: true,
    account_user_id: 9001, account_username: PRIVATE, unrelated_secret: PRIVATE
};
const STRUCTURE = {
    structure: PRIVATE, instructions: PRIVATE, updatedBy: PRIVATE, updatedAt: '2026-09-01T00:00:00Z',
    nodes: [{ id: 'park-root', title: 'Park root', description: PRIVATE, meta: PRIVATE,
        parentId: null, lane: 'leadership', tone: 'blue', stack: null, order: 1,
        x: 20, y: 30, displayGroup: 'admin', archived: false, collapsed: false,
        payroll: PRIVATE }]
};

async function withActualHrRouter(run) {
    const savedCache = new Map(Object.entries(require.cache));
    const state = { actor: {} };
    const calls = [];
    const sideEffects = [];
    const pool = {
        async connect() { sideEffects.push('connect'); throw new Error('Unexpected write connection'); },
        async query(sql, params = []) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ sql: normalized, params });
            assert.match(normalized, /^(SELECT|WITH)\b/i, 'staff card recovery may only read');
            assert.doesNotMatch(normalized, /staff_profession_rates|training_courses|hourly_rate|completed_by|responsible_user|users|medical|shift_preferences/i);
            if (state.actor.queryFailure) throw new Error('Synthetic database failure');
            let rows = [];
            if (normalized.includes('FROM hr_professions') && normalized.startsWith('SELECT id,')) rows = params.some(p => p === 'missing') ? [] : [{id:1,key:'animator',title:'Animator',department:'show',is_active:true}];
            else if (normalized.includes('FROM hr_profession_checklist_items i')) rows=[{id:1,profession_id:1,item_key:'intro',title:'Introduction',is_active:true,sort_order:0}];
            else if (normalized.includes('FROM staff_role_assignments a JOIN staff s')) rows=params[1] && params[1] !== STAFF_ID ? [] : [{id:1,staff_id:STAFF_ID,profession_key:'animator',status:'active',is_primary:true,name:'Synthetic',is_active:true,profession_title:'Animator',department:'show'}];
            else if (normalized.includes('FROM hr_staff_profession_checklist_progress x')) rows=[{staff_id:STAFF_ID,profession_key:'animator',checklist_item_id:1,completed_at:'2026-01-01'}];
            else if (normalized.startsWith('SELECT id, name, department FROM staff')) rows=params[0]===STAFF_ID?[{id:STAFF_ID,name:'Synthetic',department:'show'}]:[];
            else if (normalized.includes('FROM onboarding_progress o')) rows=[{id:1,staff_id:STAFF_ID,profession_key:'animator',status:'active',items:[],task_total:1}];
            rows=rows.map(row=>({...row, notes:PRIVATE, hourly_rate:12345, username:PRIVATE, medical:PRIVATE}));
            return { rows: structuredClone(rows), rowCount: rows.length };
        }
    };
    let server;
    function installMock(modulePath, exports) {
        const id = require.resolve(modulePath);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    try {
        for (const modulePath of ['../middleware/auth', '../routes/hr']) delete require.cache[require.resolve(modulePath)];
        installMock('../db', { pool });
        installMock('../utils/logger', { createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) });
        for (const name of [
            'websocket', 'accountSecurity', 'accountOnboarding', 'costumeInventory', 'taskExecution',
            'taskPerformancePolicy', 'staffLifecycle', 'hrVacancyPlatformFormatter',
            'hrPayrollPeriod', 'payroll', 'payrollSettlement', 'hrPayrollSchemes', 'hrPayrollProfiles',
            'liveMultiSegmentQa', 'hrStaffDocuments', 'hrStaffMedicalBook', 'hrStaffResources',
            'hrAttendanceDocuments', 'hrAttendanceDocumentsPdf', 'hrAttendanceDocumentAutomation', 'booking'
        ]) {
            installMock(`../services/${name}`, new Proxy({}, {
                get(_target, key) {
                    return () => {
                        sideEffects.push(`${name}.${String(key)}`);
                        throw new Error(`Unexpected service call: ${name}.${String(key)}`);
                    };
                }
            }));
        }
        installMock('../services/hrOnboarding', {
            attachOnboardingAssignments: async rows => rows
        });

        const { applyMembershipAccess, buildMembershipAccess } = require('../services/businessMembership');
        const actualAuth = require('../middleware/auth');
        const authenticateFixture = (req, res, next) => {
            if (state.actor.unauthenticated) return res.status(401).json({ success: false, code: 'auth_required' });
            const context = req.headers['x-business-context'] || 'event_genix';
            const principal = { id: 9101, username: 'synthetic_staff_reader', role: state.actor.role || 'director',
                business_contexts: ['event_genix', 'dar', 'crm'], default_business_context: 'event_genix' };
            const registry = ['event_genix', 'dar', 'crm'].map((key, index) => ({
                business_id: index + 1,
                organization_id: key === 'dar' || state.actor.otherOrganization && key === 'event_genix' ? 2 : 1,
                context_key: key, access_mode: state.actor.compatibility && key === 'event_genix'
                    ? 'compatibility' : 'membership',
                business_status: state.actor.inactive && key === 'event_genix' ? 'inactive' : 'active',
                organization_status: state.actor.inactiveOrganization && key === 'event_genix' ? 'inactive' : 'active'
            }));
            const memberships = registry.filter(row => !(state.actor.revoked && row.context_key === 'event_genix')
                && !(state.actor.compatibility && row.context_key === 'event_genix'))
                .map(row => ({ ...row, organization_id: state.actor.otherOrganization && row.context_key === 'event_genix'
                    ? 1 : row.organization_id, role: principal.role, organization_role: 'member', business_modules: [],
                    is_default: row.context_key === 'event_genix', action_allowlist: state.actor.allow || [],
                    action_denylist: state.actor.deny || [] }));
            req.user = applyMembershipAccess(principal, buildMembershipAccess(principal, memberships, context, registry));
            if (state.actor.staleActiveBusinessId && req.user.activeBusinessMembership) {
                req.user.activeBusinessMembership = { ...req.user.activeBusinessMembership, businessId: 999 };
            }
            return next();
        };
        installMock('../middleware/auth', { ...actualAuth, authenticateToken: authenticateFixture });
        const app = express();
        app.use(express.json());
        app.use('/api/hr', authenticateFixture, require('../routes/hr'));
        server = await new Promise(resolve => {
            const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        async function request(path, options = {}) {
            const response = await fetch(origin + path, {
                method: options.method || 'GET',
                headers: { 'X-Business-Context': options.context || 'event_genix', 'Content-Type': 'application/json', 'X-Business-Scope': options.scope || 'single' }
            });
            const text = await response.text();
            return { status: response.status, body: text ? JSON.parse(text) : null, text };
        }
        await run({ state, calls, request });
        assert.deepEqual(sideEffects, [], 'no write, payroll, account or document service was called');
    } finally {
        if (server) {
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        for (const id of Object.keys(require.cache)) if (!savedCache.has(id)) delete require.cache[id];
        for (const [id, cached] of savedCache) require.cache[id] = cached;
    }
}


const paths=['/checklists/dashboard','/professions/animator/checklist','/professions/animator/staff/'+STAFF_ID+'/checklist','/professions/workspace/animator','/staff/'+STAFF_ID+'/onboarding-assignment','/staff/'+STAFF_ID+'/onboarding-processes'];
test('EG16/17 exact reads on the actual HR Express router', async t => {
 await withActualHrRouter(async({state,calls,request})=>{
  for(const path of paths) await t.test(path,async()=>{
   state.actor={role:'waiter',allow:['hr.staff.view'],deny:['hr.payroll.view','hr.schedule.view']};
   let result=await request('/api/hr'+path);assert.equal(result.status,200,result.text);
   assert.ok(!result.text.includes(PRIVATE));assert.doesNotMatch(result.text,/hourly_rate|username|medical|notes/);
   for(const actor of [{deny:['hr.staff.view']},{revoked:true},{otherOrganization:true},{inactive:true},{inactiveOrganization:true},{staleActiveBusinessId:true}]){
    state.actor=actor;const before=calls.length;result=await request('/api/hr'+path);assert.equal(result.status,403,result.text);assert.equal(calls.length,before);
   }
   state.actor={deny:['hr.payroll.view']};
   for(const options of [{context:'dar'},{scope:'all'},{scope:'multi'}]) {const before=calls.length;result=await request('/api/hr'+path,options);assert.equal(result.status,403,result.text);assert.equal(calls.length,before);}
   state.actor={deny:['hr.payroll.view'],queryFailure:true};result=await request('/api/hr'+path);assert.equal(result.status,500,result.text);
  });
  state.actor={deny:['hr.payroll.view']};
  assert.equal((await request('/api/hr/checklists/dashboard?status=archived')).status,403);
  assert.equal((await request('/api/hr/checklists/dashboard?status=invalid')).status,400);
  for(const path of ['/professions/missing/checklist','/professions/workspace/missing','/professions/animator/staff/999/checklist','/staff/999/onboarding-processes','/staff/999/onboarding-assignment']) assert.equal((await request('/api/hr'+path)).status,404);
  for(const path of ['/staff/'+STAFF_ID+'/role-assignments','/staff/'+STAFF_ID+'/medical-book','/salary','/report/export']) assert.equal((await request('/api/hr'+path)).status,403);
  for(const path of paths) assert.equal((await request('/api/hr'+path,{method:'PUT'})).status,403);
 });
});
