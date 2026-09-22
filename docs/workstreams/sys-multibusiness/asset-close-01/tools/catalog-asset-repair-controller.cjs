'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sha256: stableSha256 } = require('../../../../../services/businessCutover');

const ALLOWED_MODES = new Set(['prepare', 'apply', 'verify', 'rollback']);
const APPROVAL_PREFIX = 'SYS-MB-ASSET-CLOSE-02';

function fail(code, message = code) {
    throw Object.assign(new Error(message), { code });
}

function hashScalar(value) {
    const serialized = value === null ? 'null' : String(value);
    return crypto.createHash('sha256').update(serialized).digest('hex');
}

function loadPayload(filename) {
    if (!filename || !path.isAbsolute(filename)) fail('PRIVATE_MAPPING_PATH_REQUIRED');
    const payload = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (payload?.schemaVersion !== 1 || payload?.mapping?.schemaVersion !== 1) fail('MAPPING_SCHEMA_INVALID');
    if (!/^[a-f0-9]{64}$/.test(String(payload.mappingSha256 || ''))) fail('MAPPING_HASH_INVALID');
    if (stableSha256(payload.mapping) !== payload.mappingSha256) fail('MAPPING_HASH_MISMATCH');
    const mapping = payload.mapping;
    if (mapping.task !== 'SYS-MB-ASSET-CLOSE-01' || mapping.businessContext !== 'event_genix') fail('MAPPING_SCOPE_INVALID');
    if (!Array.isArray(mapping.targets) || mapping.targets.length !== 4 || mapping.targetCount !== 4) fail('TARGET_COUNT_INVALID');
    const identities = new Set();
    for (const target of mapping.targets) {
        if (!target.catalogId || !Number.isInteger(Number(target.pageNumber)) || target.field !== 'image_url') fail('TARGET_INVALID');
        if (target.businessContext !== 'event_genix') fail('TARGET_OWNER_INVALID');
        if (!/^[a-f0-9]{64}$/.test(String(target.currentValueSha256 || ''))) fail('CURRENT_HASH_INVALID');
        if (hashScalar(target.currentValue) !== target.currentValueSha256) fail('CURRENT_HASH_MISMATCH');
        if (target.recommendation?.action !== 'clear_broken_reference'
            || target.recommendation?.replacementValue !== null
            || target.recommendation?.replacementValueSha256 !== hashScalar(null)) fail('RECOMMENDATION_INVALID');
        const identity = `${target.catalogId}:${target.pageNumber}:${target.field}`;
        if (identities.has(identity)) fail('TARGET_DUPLICATE');
        identities.add(identity);
    }
    const sourceFingerprint = stableSha256(mapping.targets.map(target => ({
        catalogId: target.catalogId,
        pageId: target.pageId,
        pageNumber: target.pageNumber,
        field: target.field,
        pageVersion: target.pageVersion,
        currentValueSha256: target.currentValueSha256,
        businessContext: target.businessContext
    })));
    if (sourceFingerprint !== mapping.sourceFingerprintSha256) fail('SOURCE_FINGERPRINT_MISMATCH');
    return payload;
}

function requireApprovedBlock(payload, mode) {
    const approval = payload.approval || {};
    const decisionRef = String(approval.decisionRef || '').trim();
    if (approval.status !== 'APPROVED' || !decisionRef.startsWith(APPROVAL_PREFIX)) fail('OWNER_DECISION_REQUIRED');
    const expected = `${decisionRef}:${payload.mappingSha256}`;
    const envName = mode === 'rollback' ? 'ALLOW_SYS_MB_ASSET_ROLLBACK_BLOCK' : 'ALLOW_SYS_MB_ASSET_REPAIR_BLOCK';
    if (process.env[envName] !== expected) fail('ACTIVE_PRODUCTION_BLOCK_REQUIRED');
}

async function jsonRequest(base, route, options = {}) {
    const response = await fetch(`${base}${route}`, options);
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) fail(`HTTP_${response.status}`);
    return data;
}

async function login(base) {
    const username = process.env.LIVE_CREATOR_USER;
    const password = process.env.LIVE_CREATOR_PASS;
    if (!username || !password) fail('CREATOR_CREDENTIALS_REQUIRED');
    const data = await jsonRequest(base, '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const token = data.accessToken || data.token;
    if (typeof token !== 'string' || token.length < 20) fail('LOGIN_FAILED');
    return token;
}

function headers(token, withJson = false) {
    return {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'X-Business-Context': 'event_genix',
        ...(withJson ? { 'Content-Type': 'application/json' } : {})
    };
}

async function pageFor(base, token, target) {
    const data = await jsonRequest(base, `/api/catalogs/${encodeURIComponent(target.catalogId)}/pages`, { headers: headers(token) });
    const page = (Array.isArray(data.pages) ? data.pages : []).find(row => Number(row.page_number) === Number(target.pageNumber));
    if (!page) fail('PAGE_NOT_FOUND');
    return page;
}

async function historyFor(base, token, target) {
    const data = await jsonRequest(base,
        `/api/catalogs/${encodeURIComponent(target.catalogId)}/pages/${encodeURIComponent(target.pageNumber)}/history`,
        { headers: headers(token) });
    return Array.isArray(data.history) ? data.history : [];
}

async function preflight(base, token, payload, expectedStage = 'source') {
    const results = [];
    for (const target of payload.mapping.targets) {
        const page = await pageFor(base, token, target);
        if (page.business_context !== 'event_genix' || Number(page.id) !== Number(target.pageId)) fail('PAGE_IDENTITY_DRIFT');
        const expectedValue = expectedStage === 'source' ? target.currentValue : target.recommendation.replacementValue;
        const expectedHash = expectedStage === 'source'
            ? target.currentValueSha256
            : target.recommendation.replacementValueSha256;
        if (hashScalar(page[target.field]) !== expectedHash || page[target.field] !== expectedValue) fail('CURRENT_VALUE_DRIFT');
        if (expectedStage === 'source' && Number(page.version || 1) !== Number(target.pageVersion || 1)) fail('PAGE_VERSION_DRIFT');
        results.push({
            catalogName: target.catalogName,
            pageNumber: target.pageNumber,
            field: target.field,
            valueSha256: expectedHash,
            pageVersion: Number(page.version || 1)
        });
    }
    return results;
}

async function updateTarget(base, token, target, value) {
    await jsonRequest(base,
        `/api/catalogs/${encodeURIComponent(target.catalogId)}/pages/${encodeURIComponent(target.pageNumber)}`,
        {
            method: 'PUT',
            headers: headers(token, true),
            body: JSON.stringify({ [target.field]: value })
        });
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const page = await pageFor(base, token, target);
        if (page[target.field] === value && Number(page.version || 1) >= Number(target.pageVersion || 1) + 1) return page;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    fail('UPDATE_VERIFICATION_TIMEOUT');
}

async function assertTargetStage(base, token, target, stage) {
    const page = await pageFor(base, token, target);
    const expected = stage === 'source' ? target.currentValue : target.recommendation.replacementValue;
    const expectedVersion = stage === 'source' ? Number(target.pageVersion || 1) : Number(target.pageVersion || 1) + 1;
    if (Number(page.id) !== Number(target.pageId) || page.business_context !== 'event_genix'
        || page[target.field] !== expected || Number(page.version || 1) < expectedVersion) fail('TARGET_STAGE_DRIFT');
    if (stage === 'source' && Number(page.version || 1) !== expectedVersion) fail('PAGE_VERSION_DRIFT');
    return page;
}

async function applyAll(base, token, payload) {
    await preflight(base, token, payload, 'source');
    const attempted = [];
    try {
        for (const target of payload.mapping.targets) {
            await assertTargetStage(base, token, target, 'source');
            attempted.push(target);
            await updateTarget(base, token, target, target.recommendation.replacementValue);
        }
    } catch (error) {
        const rollbackFailures = [];
        for (const target of [...attempted].reverse()) {
            try {
                const page = await pageFor(base, token, target);
                if (Number(page.id) !== Number(target.pageId) || page.business_context !== 'event_genix') fail('ROLLBACK_IDENTITY_DRIFT');
                if (page[target.field] === target.currentValue) continue;
                if (page[target.field] !== target.recommendation.replacementValue) fail('ROLLBACK_VALUE_DRIFT');
                await updateTarget(base, token, target, target.rollback.value);
            }
            catch (rollbackError) { rollbackFailures.push({ target, rollbackError }); }
        }
        if (rollbackFailures.length) fail('PARTIAL_APPLY_ROLLBACK_FAILED');
        throw error;
    }
    return attempted;
}

async function verifyApplied(base, token, payload) {
    const results = await preflight(base, token, payload, 'replacement');
    for (const target of payload.mapping.targets) {
        const history = await historyFor(base, token, target);
        if (!history.some(row => row.image_url === target.recommendation.replacementValue
            && Number(row.version || 0) >= Number(target.pageVersion || 1))) fail('HISTORY_EVIDENCE_MISSING');
    }
    return results;
}

async function rollbackAll(base, token, payload) {
    await preflight(base, token, payload, 'replacement');
    for (const target of payload.mapping.targets) await updateTarget(base, token, target, target.rollback.value);
    return preflight(base, token, payload, 'source').catch(error => {
        if (error.code === 'PAGE_VERSION_DRIFT') return payload.mapping.targets.map(target => ({
            catalogName: target.catalogName,
            pageNumber: target.pageNumber,
            field: target.field,
            valueSha256: target.currentValueSha256,
            pageVersion: 'advanced_by_forward_rollback'
        }));
        throw error;
    });
}

async function main() {
    const mode = String(process.argv[2] || '').trim();
    if (!ALLOWED_MODES.has(mode)) fail('MODE_REQUIRED');
    const base = String(process.env.LIVE_SMOKE_URL || '').replace(/\/$/, '');
    if (!base.startsWith('https://')) fail('HTTPS_REQUIRED');
    const payload = loadPayload(process.env.SYS_MB_ASSET_REPAIR_MAPPING);
    const token = await login(base);
    let results;
    if (mode === 'prepare') {
        results = await preflight(base, token, payload, 'source');
    } else if (mode === 'verify') {
        results = await verifyApplied(base, token, payload);
    } else if (mode === 'apply') {
        requireApprovedBlock(payload, mode);
        results = await applyAll(base, token, payload);
    } else {
        requireApprovedBlock(payload, mode);
        results = await rollbackAll(base, token, payload);
    }
    console.log(JSON.stringify({
        status: mode === 'prepare' && payload.approval?.status !== 'APPROVED'
            ? 'HOLD_OWNER_DECISION'
            : `PASS_${mode.toUpperCase()}`,
        mode,
        mappingSha256: payload.mappingSha256,
        sourceFingerprintSha256: payload.mapping.sourceFingerprintSha256,
        targetCount: results.length,
        targets: results.map(row => ({
            catalogName: row.catalogName,
            pageNumber: row.pageNumber,
            field: row.field,
            valueSha256: row.valueSha256,
            pageVersion: row.pageVersion
        }))
    }));
}

if (require.main === module) {
    main().catch(error => {
        console.error(JSON.stringify({
            status: 'FAIL_CATALOG_ASSET_REPAIR_CONTROLLER',
            code: /^[A-Z0-9_]+$/.test(String(error.code || error.message || ''))
                ? (error.code || error.message)
                : 'UNEXPECTED'
        }));
        process.exitCode = 1;
    });
}

module.exports = { hashScalar, loadPayload, preflight };
