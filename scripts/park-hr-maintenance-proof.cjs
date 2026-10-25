'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { TABLES } = require('./prepare-park-hr-ownership-backfill.cjs');
const PROJECT = 'bc28b46c-d4bc-491c-893a-d8401c633668';
const ENVIRONMENT = 'd9f9b984-d54d-4620-a8bf-c48882ad5158';
const SERVICE = '3fb62d4c-2dc2-4701-8e2b-09ce16e188ee';
const BRANCH = 'codex/eventgenix-production';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function requireValue(value, code) { if (!value) throw Object.assign(new Error(code), { code }); }
function instanceOf(snapshot) {
    requireValue(snapshot.id === PROJECT && snapshot.name === 'fortunate-appreciation', 'MAINTENANCE_PROJECT_MISMATCH');
    const environment = snapshot.environments?.edges?.map(e => e.node).find(e => e.id === ENVIRONMENT && e.name === 'production');
    const instance = environment?.serviceInstances?.edges?.map(e => e.node).find(e => e.serviceId === SERVICE && e.serviceName === '8223324090');
    requireValue(instance && instance.environmentId === ENVIRONMENT && instance.source, 'MAINTENANCE_SOURCE_MISMATCH');
    requireValue(!instance.cronSchedule && !instance.nextCronRunAt, 'MAINTENANCE_CRON_WRITER_UNRESOLVED');
    return instance;
}
function sourceFingerprint(source, deployment) {
    const imageDigest = deployment?.meta?.imageDigest;
    requireValue(/^sha256:[a-f0-9]{64}$/.test(imageDigest || ''), 'MAINTENANCE_IMAGE_IDENTITY_REQUIRED');
    return hash({ repo: source.repo ?? null, image: source.image ?? null, branch: source.branch ?? null, imageDigest });
}
function captureMaintenanceIdentity(snapshot, live, expectedSha) {
    const instance = instanceOf(snapshot);
    requireValue(/^[a-f0-9]{40}$/.test(expectedSha || '') && live.commitSha === expectedSha && live.sourceBranch === BRANCH, 'MAINTENANCE_BASE_IDENTITY_MISMATCH');
    if (instance.source.branch != null) requireValue(instance.source.branch === BRANCH, 'MAINTENANCE_SOURCE_MISMATCH');
    const latest = instance.latestDeployment;
    requireValue(latest?.status === 'SUCCESS' && latest.deploymentStopped === false && Array.isArray(instance.activeDeployments) && instance.activeDeployments.length === 1 && instance.activeDeployments.some(d => (typeof d === 'string' ? d : d.id) === latest.id), 'UNSTABLE_PRE_MAINTENANCE_DEPLOYMENT');
    return { deploymentId: latest.id, liveSha: expectedSha, sourceBranch: BRANCH, sourceFingerprint: sourceFingerprint(instance.source, instance.latestDeployment) };
}
function verifyStoppedSnapshot(snapshot, expected) {
    const instance = instanceOf(snapshot);
    // status exposes repo/image, but not always branch. Bind to the complete pre-stop
    // source/image digest fingerprint plus the separately verified live SHA/branch.
    // Manual clean-archive uploads legitimately have null repo/image source fields.
    requireValue(expected.sourceBranch === BRANCH && /^[a-f0-9]{64}$/.test(expected.sourceFingerprint || '') && sourceFingerprint(instance.source, instance.latestDeployment) === expected.sourceFingerprint, 'MAINTENANCE_SOURCE_MISMATCH');
    requireValue(Array.isArray(instance.activeDeployments) && instance.activeDeployments.length === 0, 'APPLICATION_WRITERS_STILL_ACTIVE');
    const latest = instance.latestDeployment;
    requireValue(latest && latest.id === expected.deploymentId && latest.status === 'REMOVED' && latest.deploymentStopped === true, 'EXPECTED_DEPLOYMENT_NOT_REMOVED');
    requireValue(/^[a-f0-9]{40}$/.test(expected.liveSha || ''), 'MAINTENANCE_BASE_SHA_REQUIRED');
    return { projectId: PROJECT, environmentId: ENVIRONMENT, serviceId: SERVICE, removedDeploymentId: latest.id, status: latest.status, sourceBranch: BRANCH, sourceFingerprint: expected.sourceFingerprint };
}
async function fetchRailwayStatus() {
    let executable = 'railway';
    if (process.platform === 'win32') {
        const lookup = await promisify(execFile)('where.exe', ['railway.cmd'], { timeout: 5000, windowsHide: true });
        const binaries = lookup.stdout.split(/\r?\n/).filter(wrapper => wrapper.trim()).map(wrapper => path.join(path.dirname(wrapper.trim()), 'node_modules', '@railway', 'cli', 'bin', 'railway.exe'));
        executable = binaries.find(binary => fs.existsSync(binary));
        requireValue(executable, 'NATIVE_RAILWAY_CLI_NOT_FOUND');
    }
    const { stdout } = await promisify(execFile)(executable, ['status', '--project', PROJECT, '--environment', 'production', '--json'], { timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    return JSON.parse(stdout);
}
function createRailwayStoppedVerifier(expected, options = {}) {
    const fetchStatus = options.fetchStatus || fetchRailwayStatus;
    return async db => {
        const evidence = verifyStoppedSnapshot(await fetchStatus(), expected);
        let otherWritableSessions = null;
        if (db) {
            await db.query('SELECT pg_stat_clear_snapshot()');
            const result = await db.query(`SELECT count(DISTINCT a.pid)::int AS n FROM pg_catalog.pg_stat_activity a
                WHERE a.datname=current_database() AND a.pid<>pg_backend_pid()
                AND (a.usename IS NULL OR a.backend_type IS NULL OR (a.backend_type='client backend'
                AND EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
                    AND has_table_privilege(a.usename,c.oid,'INSERT,UPDATE,DELETE'))))`, [TABLES]);
            otherWritableSessions = result.rows[0].n;
            requireValue(otherWritableSessions === 0, 'OTHER_OWNERSHIP_WRITERS_CONNECTED');
        }
        return { mode: 'SERVICE_STOPPED', allWritersStopped: true, liveSha: expected.liveSha, observedAtUtc: new Date().toISOString(), otherWritableSessions,
            evidenceHash: hash({ ...evidence, otherWritableSessions }) };
    };
}
module.exports = { verifyStoppedSnapshot, createRailwayStoppedVerifier, captureMaintenanceIdentity, fetchRailwayStatus };