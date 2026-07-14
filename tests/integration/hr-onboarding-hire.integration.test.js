'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('../helpers');

const enabled = process.env.RUN_HR_ONBOARDING_INTEGRATION === 'true';

function requireIsolatedTarget() {
    assert.equal(enabled, true, 'set RUN_HR_ONBOARDING_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
}

async function expectOk(method, path, body, label = path) {
    const response = await authRequest(method, path, body);
    assert.ok(response.status >= 200 && response.status < 300, `${label}: HTTP ${response.status} ${JSON.stringify(response.data)}`);
    assert.equal(response.data?.success, true, `${label}: success=true`);
    return response.data;
}

async function createVacancy(roleType, targetHires, suffix) {
    const data = await expectOk('POST', '/api/hr/vacancies', {
        title: `Disposable ${roleType} ${suffix}`,
        role_type: roleType,
        department: 'qa',
        target_hires: targetHires,
        status: 'open'
    }, `create ${roleType} vacancy`);
    return data.vacancy;
}

async function createApplication(vacancyId, suffix) {
    const data = await expectOk('POST', `/api/hr/vacancies/${vacancyId}/applications`, {
        name: `Disposable Candidate ${suffix}`,
        phone: `+38099${String(Date.now()).slice(-7)}`,
        source: 'other'
    }, 'create application');
    return data.application;
}

describe('PostgreSQL-backed profession onboarding and vacancy hire flow', { skip: !enabled }, () => {
    it('keeps corporate and multiple profession processes independent while headcount closes durably', async () => {
        requireIsolatedTarget();
        const suffix = `${process.pid}-${Date.now()}`;

        const secondOwner = await expectOk('POST', '/api/users', {
            username: `onboarding.owner.${process.pid}`,
            password: `QaOwner-${suffix}!`,
            name: 'Disposable Onboarding Owner',
            role: 'manager'
        }, 'create second onboarding owner');

        const owners = await expectOk('GET', '/api/hr/onboarding/responsible-candidates', undefined, 'load onboarding owners');
        const ownerIds = owners.data.map(row => Number(row.id)).filter(Number.isInteger);
        const secondOwnerId = Number(secondOwner.user?.id);
        const primaryOwnerId = ownerIds.find(id => id !== secondOwnerId);
        assert.ok(primaryOwnerId > 0, 'bootstrap creator is an onboarding owner');
        assert.ok(ownerIds.includes(secondOwnerId), 'second manager is an onboarding owner');

        const professions = await expectOk('GET', '/api/hr/professions', undefined, 'load professions');
        const professionByKey = new Map(professions.data.map(row => [row.key, row]));
        for (const key of ['animator', 'barista', 'cook']) assert.ok(professionByKey.has(key), `${key} profession exists`);

        const animatorVacancy = await createVacancy('animator', 2, suffix);
        const animatorApplication = await createApplication(animatorVacancy.id, `${suffix}-animator`);
        const animatorHire = await expectOk('POST', `/api/hr/applications/${animatorApplication.id}/hire`, {
            hire_mode: 'new_staff',
            department: 'qa',
            start_profession_onboarding: true,
            responsible_user_id: primaryOwnerId
        }, 'hire new animator');
        const staffId = Number(animatorHire.staff_id);
        assert.ok(staffId > 0);
        assert.equal(animatorHire.vacancy_status, 'open');
        assert.equal(animatorHire.vacancy_action, 'kept_open_by_headcount');
        assert.equal(animatorHire.hired_count, 1);
        assert.equal(animatorHire.target_hires, 2);

        const duplicateHire = await authRequest('POST', `/api/hr/applications/${animatorApplication.id}/hire`, {
            hire_mode: 'new_staff',
            start_profession_onboarding: false
        });
        assert.equal(duplicateHire.status, 409);
        assert.equal(duplicateHire.data?.code, 'APPLICATION_ALREADY_HIRED');

        const template = await expectOk('POST', '/api/hr/onboarding/templates', {
            name: `Disposable Corporate ${suffix}`,
            department: 'qa',
            items: [{ id: 'corporate_setup', title: 'Corporate setup' }]
        }, 'create corporate onboarding template');
        await expectOk('POST', '/api/hr/onboarding/start', {
            staff_id: staffId,
            template_id: template.data.id,
            responsible_user_id: primaryOwnerId
        }, 'start corporate onboarding');

        for (const [roleType, ownerId] of [['barista', secondOwnerId], ['cook', primaryOwnerId]]) {
            const vacancy = await createVacancy(roleType, 1, suffix);
            const application = await createApplication(vacancy.id, `${suffix}-${roleType}`);
            const hire = await expectOk('POST', `/api/hr/applications/${application.id}/hire`, {
                hire_mode: 'existing_staff',
                existing_staff_id: staffId,
                start_profession_onboarding: true,
                responsible_user_id: ownerId
            }, `hire existing staff as ${roleType}`);
            assert.equal(Number(hire.staff_id), staffId);
            assert.equal(hire.vacancy_status, 'filled');
            assert.equal(hire.vacancy_action, 'auto_filled_by_headcount');
            assert.equal(hire.hired_count, 1);
        }

        const beforeChecklist = await expectOk('GET', `/api/hr/staff/${staffId}/onboarding-processes`, undefined, 'load onboarding processes');
        const beforeProcesses = [beforeChecklist.data.general, ...beforeChecklist.data.professions, ...beforeChecklist.data.history].filter(Boolean);
        assert.equal(beforeProcesses.length, 4, 'one corporate and three profession processes exist');
        const general = beforeProcesses.find(row => !row.profession_key);
        const animator = beforeProcesses.find(row => row.profession_key === 'animator');
        const barista = beforeProcesses.find(row => row.profession_key === 'barista');
        const cook = beforeProcesses.find(row => row.profession_key === 'cook');
        assert.ok(general && animator && barista && cook);
        assert.equal(Number(animator.responsible_user_id), primaryOwnerId);
        assert.equal(Number(barista.responsible_user_id), secondOwnerId);
        assert.equal(Number(cook.responsible_user_id), primaryOwnerId);

        const repeatStart = await expectOk('POST', '/api/hr/onboarding/start', {
            staff_id: staffId,
            profession_key: 'barista',
            responsible_user_id: secondOwnerId
        }, 'repeat barista onboarding start');
        assert.equal(repeatStart.reused, true);
        assert.equal(Number(repeatStart.progress.id), Number(barista.id));

        const checklistItem = Array.isArray(professionByKey.get('barista').checklist)
            ? professionByKey.get('barista').checklist[0]
            : null;
        const checklistTitle = typeof checklistItem === 'string'
            ? checklistItem
            : (checklistItem?.title || checklistItem?.name || 'Barista checklist item');
        const checklistKey = typeof checklistItem === 'object' && checklistItem
            ? (checklistItem.key || checklistItem.id || 'item_1')
            : 'item_1';
        await expectOk('PUT', `/api/hr/staff/${staffId}/profession-checklist`, {
            profession_key: 'barista',
            checklist_key: checklistKey,
            title: checklistTitle,
            completed: true
        }, 'complete one barista checklist item');

        const afterChecklist = await expectOk('GET', `/api/hr/staff/${staffId}/onboarding-processes`, undefined, 'reload onboarding processes');
        const nextBarista = afterChecklist.data.professions.find(row => row.profession_key === 'barista');
        const nextCook = afterChecklist.data.professions.find(row => row.profession_key === 'cook');
        assert.ok(Number(nextBarista.completed_items) >= 1, 'barista progress advances');
        assert.equal(Number(nextCook.completed_items), Number(cook.completed_items), 'cook progress remains unchanged');
        assert.equal(Number(nextCook.responsible_user_id), primaryOwnerId, 'cook owner remains unchanged');

        const vacancies = await expectOk('GET', '/api/hr/vacancies?status=all', undefined, 'reload vacancies');
        const animatorRow = vacancies.vacancies.find(row => Number(row.id) === Number(animatorVacancy.id));
        assert.equal(Number(animatorRow.target_hires), 2);
        assert.equal(Number(animatorRow.hired_count), 1);
        assert.equal(animatorRow.status, 'open');

        const lifecycle = await expectOk('GET', `/api/hr/staff/${staffId}/lifecycle-checklist`, undefined, 'load lifecycle');
        assert.ok(lifecycle.data?.hiring_application, 'lifecycle exposes durable vacancy source');
    });
});
