#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../db');
const {
    cleanupTrustedQaRun,
    createTrustedQaRun,
    registerQaEntity
} = require('../services/trustedQaRuns');

const CREATE_CONFIRMATION = 'CREATE_EXACT_TRUSTED_QA_RUN';
const OPERATOR_ROLES = new Set(['creator', 'director', 'senior_manager']);

function argValue(args, name, fallback = null) {
    const exact = args.find(value => value.startsWith(`${name}=`));
    if (exact) return exact.slice(name.length + 1);
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
        ? args[index + 1]
        : fallback;
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((result, key) => {
        result[key] = stableValue(value[key]);
        return result;
    }, {});
}

function manifestHash(manifest) {
    return crypto.createHash('sha256').update(JSON.stringify(stableValue(manifest))).digest('hex');
}

function readPlan(filePath) {
    if (!filePath) throw new Error('--plan-file is required');
    const parsed = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
    const manifest = {
        schemaVersion: 1,
        sourceCommit: String(parsed.sourceCommit || '').trim(),
        sourceBranch: String(parsed.sourceBranch || '').trim(),
        liveUrl: String(parsed.liveUrl || '').trim(),
        runId: String(parsed.runId || '').trim(),
        businessContext: String(parsed.businessContext || 'event_genix').trim(),
        testAccountId: Number(parsed.testAccountId),
        operatorUserId: Number(parsed.operatorUserId || parsed.testAccountId),
        customerId: Number(parsed.customerId),
        programId: String(parsed.programId || parsed.qaProduct?.id || '').trim(),
        roomResourceId: String(parsed.roomResourceId || '').trim(),
        lineId: String(parsed.lineId || '').trim(),
        timeWindow: parsed.timeWindow || null,
        ttlMinutes: Number(parsed.ttlMinutes),
        maxEntityCount: Number(parsed.maxEntityCount),
        allowedEndpoints: [...new Set((parsed.allowedEndpoints || []).map(String))].sort(),
        expectedEntityTypes: [...new Set((parsed.expectedEntityTypes || []).map(String))].sort(),
        qaProduct: parsed.qaProduct ? stableValue(parsed.qaProduct) : null,
        cleanupPolicy: String(parsed.cleanupPolicy || 'exact_registered_entities_v1')
    };
    if (!manifest.sourceCommit || !manifest.sourceBranch || !manifest.liveUrl || !manifest.runId
        || !Number.isInteger(manifest.testAccountId) || manifest.testAccountId <= 0
        || !Number.isInteger(manifest.operatorUserId) || manifest.operatorUserId <= 0
        || !Number.isInteger(manifest.customerId) || manifest.customerId <= 0
        || !manifest.programId || !manifest.roomResourceId || !manifest.lineId
        || !Number.isInteger(manifest.ttlMinutes) || manifest.ttlMinutes < 1 || manifest.ttlMinutes > 240
        || !Number.isInteger(manifest.maxEntityCount) || manifest.maxEntityCount < 1 || manifest.maxEntityCount > 500
        || !manifest.allowedEndpoints.length || !manifest.expectedEntityTypes.length) {
        throw new Error('Trusted QA plan is incomplete or outside bounded limits');
    }
    const date = String(manifest.timeWindow?.date || '').trim();
    const from = String(manifest.timeWindow?.from || '').trim();
    const to = String(manifest.timeWindow?.to || '').trim();
    const timeMinutes = value => {
        const match = value.match(/^(\d{2}):(\d{2})$/);
        return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
        || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)
        || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
        || !Number.isFinite(timeMinutes(from)) || !Number.isFinite(timeMinutes(to))
        || timeMinutes(from) < 0 || timeMinutes(to) > 1440 || timeMinutes(from) >= timeMinutes(to)) {
        throw new Error('Trusted QA time window is invalid');
    }
    if (manifest.qaProduct?.create === true) {
        const product = manifest.qaProduct;
        if (String(product.id || '').trim() !== manifest.programId
            || !String(product.code || '').trim() || String(product.code).trim().length > 20
            || !String(product.label || '').trim() || String(product.label).trim().length > 100
            || !String(product.category || '').trim() || String(product.category).trim().length > 50
            || !Number.isInteger(Number(product.duration))
            || Number(product.duration) < 1 || Number(product.duration) > 1440) {
            throw new Error('Trusted QA product plan is incompatible with the products schema');
        }
    }
    return manifest;
}

async function preflight(client, manifest, { forUpdate = false } = {}) {
    const suffix = forUpdate ? ' FOR UPDATE' : '';
    const user = await client.query(
        `SELECT id, role, COALESCE(is_active, true) AS is_active
           FROM users
          WHERE id = $1${suffix}`,
        [manifest.testAccountId]
    );
    const userRow = user.rows?.[0];
    if (!userRow || !userRow.is_active || !OPERATOR_ROLES.has(String(userRow.role || '').toLowerCase())) {
        throw new Error('Exact trusted QA test account is unavailable or not an operator role');
    }
    if (manifest.operatorUserId !== manifest.testAccountId) {
        throw new Error('This operator CLI requires the exact operator and test account to match');
    }
    const customer = await client.query(
        `SELECT id
           FROM customers
          WHERE id = $1
            AND COALESCE(business_context, 'event_genix') = $2
            AND (LOWER(COALESCE(notes, '')) LIKE '%codex%qa%'
              OR LOWER(COALESCE(notes, '')) LIKE '%smoke%'
              OR LOWER(COALESCE(source, '')) LIKE '%test%')${suffix}`,
        [manifest.customerId, manifest.businessContext]
    );
    if (customer.rowCount !== 1) throw new Error('Exact trusted QA customer evidence is missing');
    const room = await client.query(
        `SELECT resource_id
           FROM timeline_resources
          WHERE business_context = $1
            AND resource_id = $2
            AND type IN ('room', 'takeaway')
            AND is_active = true${suffix}`,
        [manifest.businessContext, manifest.roomResourceId]
    );
    if (room.rowCount !== 1) throw new Error('Exact trusted QA room is unavailable');
    const line = await client.query(
        `SELECT line_id
           FROM lines_by_date
          WHERE business_context = $1
            AND date = $2::date
            AND line_id = $3
            AND (
                from_sheet IS DISTINCT FROM true
                OR EXISTS (
                    SELECT 1
                      FROM staff_schedule ss
                      JOIN staff scheduled_staff ON scheduled_staff.id = ss.staff_id
                     WHERE ss.staff_id::text = lines_by_date.line_id
                       AND LEFT(ss.date::text, 10) = $2
                       AND ss.status IN ('working', 'remote')
                       AND COALESCE(scheduled_staff.is_active, true) = true
                )
            )${suffix}`,
        [manifest.businessContext, manifest.timeWindow.date, manifest.lineId]
    );
    if (line.rowCount !== 1) throw new Error('Exact trusted QA timeline line is unavailable');
    const overlap = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM bookings
          WHERE business_context = $1
            AND date = $2::date
            AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'confirmed')) NOT IN ('cancelled', 'canceled')
            AND (line_id = $3 OR room_resource_id = $4)
            AND time::time < $6::time
            AND (time::time + (COALESCE(duration, 0)::text || ' minutes')::interval) > $5::time`,
        [manifest.businessContext, manifest.timeWindow.date, manifest.lineId, manifest.roomResourceId,
            manifest.timeWindow.from, manifest.timeWindow.to]
    );
    if (Number(overlap.rows?.[0]?.count || 0) > 0) throw new Error('Trusted QA time window is not empty');
    const product = await client.query(
        `SELECT id, is_active,
                EXISTS (SELECT 1 FROM product_stock_requirements psr WHERE psr.product_id::text = products.id::text) AS has_stock
           FROM products
          WHERE id = $1
            AND COALESCE(business_context, 'event_genix') = $2${suffix}`,
        [manifest.programId, manifest.businessContext]
    );
    const productRow = product.rows?.[0] || null;
    if (manifest.qaProduct?.create === true) {
        if (productRow) throw new Error('Exact QA product ID already exists');
    } else if (!productRow || !productRow.is_active || productRow.has_stock) {
        throw new Error('Exact trusted QA product is unavailable, inactive, or has stock requirements');
    }
    const staleRuns = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM trusted_qa_runs
          WHERE state IN ('active', 'cleanup_pending')`
    );
    if (Number(staleRuns.rows?.[0]?.count || 0) > 0) {
        throw new Error('Active or cleanup_pending trusted QA run already exists');
    }
    return {
        accountReady: true,
        customerReady: true,
        roomReady: true,
        lineReady: true,
        timeWindowReady: true,
        productAction: manifest.qaProduct?.create === true ? 'create_registered_qa_product' : 'use_existing_qa_product',
        staleRunCount: 0
    };
}

async function createExactRun(manifest, approvedHash, tokenFile) {
    const expectedHash = manifestHash(manifest);
    if (approvedHash !== expectedHash) throw new Error('Approved trusted QA manifest hash does not match');
    if (!path.isAbsolute(tokenFile || '')) throw new Error('--token-file must be an absolute path outside the repository');
    const resolvedTokenFile = path.resolve(tokenFile);
    const repositoryRoot = path.resolve(__dirname, '..');
    if (resolvedTokenFile.toLowerCase().startsWith(`${repositoryRoot.toLowerCase()}${path.sep}`)) {
        throw new Error('QA token file must not be stored inside the repository');
    }
    const token = crypto.randomBytes(32).toString('base64url');
    fs.writeFileSync(resolvedTokenFile, token, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    const client = await pool.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await preflight(client, manifest, { forUpdate: true });
        const created = await createTrustedQaRun(client, {
            token,
            runId: manifest.runId,
            source: 'trusted_qa',
            businessContext: manifest.businessContext,
            operatorUserId: manifest.operatorUserId,
            requiredOperatorUserId: manifest.operatorUserId,
            requiredUserId: manifest.testAccountId,
            requiredCustomerId: manifest.customerId,
            requiredProgramId: manifest.programId,
            requiredProductId: manifest.programId,
            requiredRoomResourceId: manifest.roomResourceId,
            requiredLineId: manifest.lineId,
            allowedDate: manifest.timeWindow.date,
            allowedStartTime: manifest.timeWindow.from,
            allowedEndTime: manifest.timeWindow.to,
            allowedEndpoints: manifest.allowedEndpoints,
            maxEntityCount: manifest.maxEntityCount,
            ttlMinutes: manifest.ttlMinutes,
            testCustomerMarker: `${manifest.runId}:customer:${manifest.customerId}`
        });
        const qaContext = { trusted: true, run: created.run };
        if (manifest.qaProduct?.create === true) {
            const product = manifest.qaProduct;
            const inserted = await client.query(
                `INSERT INTO products
                    (id, business_context, code, label, name, icon, category, duration, price,
                     hosts, is_per_child, has_filler, is_custom, is_active, sort_order, updated_by)
                 VALUES ($1,$2,$3,$4,$4,'🧪',$5,$6,0,1,false,false,true,true,9999,'trusted_qa_operator')
                 RETURNING id`,
                [manifest.programId, manifest.businessContext, product.code, product.label, product.category, product.duration]
            );
            await registerQaEntity(client, qaContext, 'product', inserted.rows[0].id, {
                businessContext: manifest.businessContext,
                manifestHash: expectedHash,
                cleanupAction: 'deactivate'
            });
        }
        await client.query('COMMIT');
        return {
            created: true,
            runDatabaseId: created.run.id,
            runId: created.run.run_id,
            expiresAt: created.run.expires_at,
            manifestHash: expectedHash,
            tokenFile: resolvedTokenFile
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        try { fs.unlinkSync(resolvedTokenFile); } catch {}
        throw error;
    } finally {
        client.release();
    }
}

async function cleanupExactRun(runDatabaseId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const result = await cleanupTrustedQaRun(client, runDatabaseId, { forUpdate: true });
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function main() {
    const args = process.argv.slice(2);
    const mode = argValue(args, '--mode', 'plan');
    const manifest = readPlan(argValue(args, '--plan-file'));
    const hash = manifestHash(manifest);
    if (mode === 'plan') {
        const client = await pool.connect();
        try {
            await client.query('BEGIN READ ONLY');
            const readiness = await preflight(client, manifest);
            await client.query('ROLLBACK');
            console.log(JSON.stringify({ manifest, manifestHash: hash, readiness }, null, 2));
            return;
        } finally {
            client.release();
        }
    }
    if (mode === 'create') {
        if (argValue(args, '--confirm') !== CREATE_CONFIRMATION) {
            throw new Error(`Create requires --confirm=${CREATE_CONFIRMATION}`);
        }
        const result = await createExactRun(
            manifest,
            argValue(args, '--approved-hash'),
            argValue(args, '--token-file')
        );
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    if (mode === 'cleanup') {
        const runDatabaseId = Number(argValue(args, '--run-db-id'));
        if (!Number.isInteger(runDatabaseId) || runDatabaseId <= 0) throw new Error('--run-db-id is required');
        console.log(JSON.stringify(await cleanupExactRun(runDatabaseId), null, 2));
        return;
    }
    throw new Error(`Unsupported mode: ${mode}`);
}

if (require.main === module) {
    main().catch(error => {
        console.error(JSON.stringify({ success: false, code: error.code || 'TRUSTED_QA_OPERATOR_FAILED', message: error.message }));
        process.exitCode = 1;
    });
}

module.exports = {
    CREATE_CONFIRMATION,
    manifestHash,
    readPlan,
    stableValue
};
