'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const registry = require('../config/permissionRegistry');
const {
    PAGE_PERMISSION_TEST_CONTRACTS,
    ACTION_PERMISSION_TEST_CONTRACTS
} = require('../config/permissionTestContracts');

const ROOT = path.resolve(__dirname, '..');

function sorted(values = []) {
    return [...values].sort();
}

function activePages() {
    return registry.PAGE_PERMISSIONS.filter(entry => entry.deprecated !== true);
}

function activeActions() {
    return registry.ACTION_PERMISSIONS.filter(entry => entry.deprecated !== true);
}

function assertNonEmptyString(value, label) {
    assert.equal(typeof value, 'string', `${label} must be a string`);
    assert.ok(value.trim(), `${label} must not be empty`);
}

function assertContractShape(contract, type) {
    assert.equal(contract.type, type, `${contract.key}: type drift`);
    assertNonEmptyString(contract.key, `${contract.key}: key`);
    assertNonEmptyString(contract.frontendScenario, `${contract.key}: frontendScenario`);
    assertNonEmptyString(contract.backendScenario, `${contract.key}: backendScenario`);
    assertNonEmptyString(contract.allowExpectation, `${contract.key}: allowExpectation`);
    assertNonEmptyString(contract.denyExpectation, `${contract.key}: denyExpectation`);
    assertNonEmptyString(contract.fixture, `${contract.key}: fixture`);
    assert.equal(typeof contract.mutation, 'boolean', `${contract.key}: mutation flag`);
    assert.equal(typeof contract.responseAssertion, 'object', `${contract.key}: responseAssertion`);
    assert.ok(Object.keys(contract.responseAssertion).length > 0, `${contract.key}: responseAssertion must be executable metadata`);
}

test('every active permission has an executable test contract and no unknown contract keys exist', () => {
    const activePageKeys = activePages().map(entry => entry.key);
    const activeActionKeys = activeActions().map(entry => entry.key);

    assert.deepEqual(
        sorted(Object.keys(PAGE_PERMISSION_TEST_CONTRACTS)),
        sorted(activePageKeys),
        'new, missing, or unknown active page permission test contract'
    );
    assert.deepEqual(
        sorted(Object.keys(ACTION_PERMISSION_TEST_CONTRACTS)),
        sorted(activeActionKeys),
        'new, missing, or unknown active action permission test contract'
    );

    for (const contract of Object.values(PAGE_PERMISSION_TEST_CONTRACTS)) {
        assertContractShape(contract, 'page');
        assert.equal(typeof contract.configurable, 'boolean', `${contract.key}: configurable flag`);
        assertNonEmptyString(contract.canonicalUrl, `${contract.key}: canonicalUrl`);
        assertNonEmptyString(contract.directUrl, `${contract.key}: directUrl`);
    }

    for (const contract of Object.values(ACTION_PERMISSION_TEST_CONTRACTS)) {
        assertContractShape(contract, 'action');
        assert.equal(typeof contract.sensitive, 'boolean', `${contract.key}: sensitive flag`);
        assert.ok(Array.isArray(contract.testFiles), `${contract.key}: testFiles must be an array`);
        assert.ok(contract.testFiles.length > 0, `${contract.key}: active action must name executable tests`);
    }
});

test('active action contracts point at real tests and real server-side enforcement, not frontend-only metadata', () => {
    for (const entry of activeActions()) {
        const contract = ACTION_PERMISSION_TEST_CONTRACTS[entry.key];
        assert.ok(contract, `${entry.key}: missing executable action contract`);

        const hasSpecificBackendEnforcement = entry.backendConsumers.some(consumer => consumer.enforces === true);
        const hasActionApiConsumer = entry.apiConsumers.some(consumer => consumer.enforcement === 'action');
        assert.ok(
            hasSpecificBackendEnforcement || hasActionApiConsumer,
            `${entry.key}: active action must have real backend enforcement metadata`
        );

        for (const relativeFile of contract.testFiles) {
            const filename = path.join(ROOT, relativeFile);
            assert.ok(fs.existsSync(filename), `${entry.key}: missing executable test file ${relativeFile}`);
            assert.ok(fs.statSync(filename).size > 0, `${entry.key}: empty executable test file ${relativeFile}`);
        }

        if (contract.sensitive) {
            assert.ok(
                Number.isInteger(contract.responseAssertion.denyStatus)
                    || String(contract.responseAssertion.denyBody || '').includes('shaped'),
                `${entry.key}: sensitive contract must assert deny status or shaped response`
            );
        }
    }
});

test('deprecated/tombstone capabilities and non-configurable pages cannot leak into public UI/API definitions', () => {
    const publicPageKeys = new Set(registry.getPublicPagePermissionMetadata().map(entry => entry.key));
    for (const entry of registry.PAGE_PERMISSIONS) {
        if (entry.deprecated === true || entry.configurable === false) {
            assert.equal(publicPageKeys.has(entry.key), false, `${entry.key}: must not be a page toggle`);
        }
    }
    for (const key of ['/dashboard', '/profile', '/game', '/quiz', '/room', '/shop']) {
        assert.equal(publicPageKeys.has(key), false, `${key}: personal/universal page must not be configurable`);
        assert.equal(PAGE_PERMISSION_TEST_CONTRACTS[key]?.configurable, false, `${key}: contract must mark non-configurable page`);
    }

    const routesUsers = fs.readFileSync(path.join(ROOT, 'routes', 'users.js'), 'utf8');
    assert.match(routesUsers, /getPublicPagePermissionMetadata/);
    assert.match(routesUsers, /deprecated !== true/);
    assert.doesNotMatch(routesUsers, /cancel_booking['"`]\s*,\s*label/);
    assert.doesNotMatch(routesUsers, /manage_staff['"`]\s*,\s*label/);
});

test('browser access-editor coverage remains split into the required behavior classes', () => {
    const browserSuite = fs.readFileSync(path.join(ROOT, 'tests', 'browser', 'account-access-editor.spec.js'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

    const expectedScripts = [
        'test:browser:account-access:lifecycle',
        'test:browser:account-access:draft',
        'test:browser:account-access:tri-state',
        'test:browser:account-access:backend',
        'test:browser:account-access:mobile'
    ];
    for (const script of expectedScripts) {
        assert.ok(packageJson.scripts[script], `${script}: missing package script`);
        assert.match(workflow, new RegExp(script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${script}: missing CI step`);
    }

    assert.match(browserSuite, /blocks accidental dismissal/);
    assert.match(browserSuite, /dirty draft/);
    assert.match(browserSuite, /supports page inherited to deny/);
    assert.match(browserSuite, /canonicalizes conflicting aliases/);
    assert.match(browserSuite, /fullscreen workspace on mobile/);
});
