/**
 * tests/vacancies.test.js — HR Vacancies & Applications tests (v38.1.0)
 * Tests vacancy CRUD, applications, and hire flow
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { authRequest } = require('./helpers');

describe('HR Vacancies CRUD', () => {
    let vacancyId;

    it('POST /hr/vacancies — create vacancy', async () => {
        const res = await authRequest('POST', '/api/hr/vacancies', {
            title: 'Test Animator ' + Date.now(),
            role_type: 'animator',
            department: 'animators',
            description: 'Test vacancy for automated tests',
            requirements: 'Experience with children',
            salary_from: 15000,
            salary_to: 25000,
            status: 'open'
        });
        assert.equal(res.status, 200, `Create failed: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.id || res.data.vacancy?.id, 'should return id');
        vacancyId = res.data.id || res.data.vacancy?.id;
    });

    it('GET /hr/vacancies — list vacancies', async () => {
        const res = await authRequest('GET', '/api/hr/vacancies');
        assert.equal(res.status, 200);
        const vacancies = Array.isArray(res.data) ? res.data : res.data.vacancies;
        assert.ok(Array.isArray(vacancies), 'should return array');
        assert.ok(vacancies.length >= 1, 'should have at least 1 vacancy');
    });

    it('PATCH /hr/vacancies/:id — update vacancy', async () => {
        if (!vacancyId) return;
        const res = await authRequest('PATCH', `/api/hr/vacancies/${vacancyId}`, {
            title: 'Updated Animator ' + Date.now(),
            salary_max: 30000
        });
        assert.equal(res.status, 200);
    });

    it('DELETE /hr/vacancies/:id — delete vacancy', async () => {
        // Create one specifically to delete
        const create = await authRequest('POST', '/api/hr/vacancies', {
            title: 'To Delete ' + Date.now(),
            role_type: 'animator',
            department: 'animators'
        });
        assert.equal(create.status, 200);
        const delId = create.data.id || create.data.vacancy?.id;

        const res = await authRequest('DELETE', `/api/hr/vacancies/${delId}`);
        assert.equal(res.status, 200);
    });
});

describe('HR Job Applications', () => {
    let vacancyId;
    let applicationId;

    it('setup — create vacancy for applications', async () => {
        const res = await authRequest('POST', '/api/hr/vacancies', {
            title: 'Vacancy for Apps ' + Date.now(),
            role_type: 'animator',
            department: 'animators',
            status: 'open'
        });
        assert.equal(res.status, 200);
        vacancyId = res.data.id || res.data.vacancy?.id;
        assert.ok(vacancyId, 'should have vacancy id');
    });

    it('POST /hr/vacancies/:id/applications — submit application', async () => {
        if (!vacancyId) return;
        const res = await authRequest('POST', `/api/hr/vacancies/${vacancyId}/applications`, {
            name: 'Тест Кандидат',
            phone: '+380501234567',
            source: 'manual',
            notes: 'I love working with children!'
        });
        assert.equal(res.status, 200, `Apply failed: ${JSON.stringify(res.data)}`);
        applicationId = res.data.application?.id || res.data.id;
        assert.ok(applicationId, 'should return application id');
    });

    it('GET /hr/vacancies/:id/applications — list applications', async () => {
        if (!vacancyId) return;
        const res = await authRequest('GET', `/api/hr/vacancies/${vacancyId}/applications`);
        assert.equal(res.status, 200);
        const apps = Array.isArray(res.data) ? res.data : res.data.applications;
        assert.ok(Array.isArray(apps), 'should return array');
        assert.ok(apps.length >= 1, 'should have at least 1 application');
    });

    it('PATCH /hr/applications/:id — update application status', async () => {
        if (!applicationId) return;
        const res = await authRequest('PATCH', `/api/hr/applications/${applicationId}`, {
            status: 'contacted'
        });
        assert.equal(res.status, 200);
    });

    it('POST /hr/applications/:id/hire — hire candidate', async () => {
        if (!applicationId) return;
        const res = await authRequest('POST', `/api/hr/applications/${applicationId}/hire`, {
            hire_mode: 'new_staff',
            vacancy_action: 'keep_open',
            start_profession_onboarding: false,
            salary: 20000
        });
        assert.ok([200, 201, 409].includes(res.status),
            `Hire returned unexpected status: ${res.status}`);
        if ([200, 201].includes(res.status)) {
            assert.ok(res.data.staff_id, 'hire should return durable staff id');
            assert.equal(res.data.profession_key, 'animator');
            assert.equal(res.data.vacancy_action, 'keep_open');
            const repeated = await authRequest('POST', `/api/hr/applications/${applicationId}/hire`, {
                hire_mode: 'new_staff',
                vacancy_action: 'keep_open',
                start_profession_onboarding: false
            });
            assert.equal(repeated.status, 409, 'the same application must not be hired twice');
        }
    });
});

describe('HR durable vacancy hire contract', () => {
    const routeCode = fs.readFileSync(path.join(__dirname, '..', 'routes', 'hr.js'), 'utf8');
    const pageCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'hr-page.js'), 'utf8');
    const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '290_job_application_staff_profession_link.sql'), 'utf8');
    const backfillMigration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '291_job_application_legacy_link_backfill.sql'), 'utf8');
    const headcountMigration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '292_job_vacancy_headcount.sql'), 'utf8');

    it('links applications to staff, profession, and optional onboarding durably', () => {
        assert.match(migration, /ADD COLUMN IF NOT EXISTS staff_id INTEGER/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS profession_key VARCHAR\(64\)/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS onboarding_progress_id INTEGER/);
        assert.match(routeCode, /FOR UPDATE OF a, v/);
        assert.match(routeCode, /APPLICATION_ALREADY_HIRED/);
        assert.match(routeCode, /application_hired_existing_staff_profession/);
        assert.match(routeCode, /vacancyAction === 'mark_filled'/);
    });

    it('offers explicit new staff and existing staff modes without name matching', () => {
        assert.match(pageCode, /value: 'new_staff'/);
        assert.match(pageCode, /value: 'existing_staff'/);
        assert.match(pageCode, /existing_staff_id/);
        assert.match(pageCode, /value: 'keep_open'/);
        assert.match(pageCode, /value: 'mark_filled'/);
        assert.doesNotMatch(routeCode, /WHERE\s+(?:LOWER\()?s?\.?(?:name|full_name).*a\.name/i);
    });

    it('backfills legacy hires only through an unambiguous phone and assigned profession', () => {
        assert.match(backfillMigration, /status = 'hired'/);
        assert.match(backfillMigration, /staff_id IS NULL/);
        assert.match(backfillMigration, /regexp_replace\(COALESCE\(a\.phone/);
        assert.match(backfillMigration, /HAVING COUNT\(DISTINCT s\.id\) = 1/);
        assert.match(backfillMigration, /staff_role_assignments/);
        assert.doesNotMatch(backfillMigration, /LOWER\([^\n]*(?:name|full_name)/i);
    });

    it('models optional vacancy headcount while retaining the manual MVP fallback', () => {
        assert.match(headcountMigration, /ADD COLUMN IF NOT EXISTS target_hires INTEGER/);
        assert.match(headcountMigration, /target_hires IS NULL OR target_hires > 0/);
        assert.match(routeCode, /COUNT\(\*\)::int AS hired_count/);
        assert.match(routeCode, /kept_open_by_headcount/);
        assert.match(routeCode, /auto_filled_by_headcount/);
        assert.match(pageCode, /\.target_hires/);
        assert.match(pageCode, /target_hires:\s*parseInt\(result\.target_hires\) \|\| null/);
        assert.match(pageCode, /if \(!vacancyHasHeadcount\) payload\.vacancy_action/);
    });

    it('edits vacancy headcount transactionally and reports the recalculated status', () => {
        assert.match(routeCode, /SELECT \* FROM job_vacancies WHERE id = \$1 FOR UPDATE/);
        assert.match(routeCode, /status = 'hired'[\s\S]*staff_id IS NOT NULL/);
        assert.match(routeCode, /auto_filled_by_headcount: autoFilledByHeadcount/);
        assert.match(routeCode, /headcount_reached: headcountReached/);
        assert.match(pageCode, /function editVacancy\(id\)/);
        assert.match(pageCode, /target_hires: rawTarget \? Number\(rawTarget\) : null/);
        assert.match(pageCode, /Вакансію автоматично закрито/);
    });
});
