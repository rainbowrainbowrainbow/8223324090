'use strict';

// Explicit maintenance path used only by the canonical release helper.
// No credentials, DB connection, shutdown operation, or standalone upload CLI.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const ownershipOperator = require('../scripts/park-hr-ownership-operator.cjs');
const { captureMaintenanceIdentity, verifyStoppedSnapshot } = require('../scripts/park-hr-maintenance-proof.cjs');
const TARGET = Object.freeze({ project: 'bc28b46c-d4bc-491c-893a-d8401c633668', environment: 'production', service: '8223324090', branch: 'codex/eventgenix-production', liveUrl: 'https://8223324090-production.up.railway.app', repository: 'rainbowrainbowrainbow/8223324090' });
const sha = value => /^[a-f0-9]{40}$/.test(value || '');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const hash64 = value => /^[a-f0-9]{64}$/.test(value || '');
function check(condition, code) { if (!condition) throw Object.assign(new Error(code), { code }); }
function privatePath(file) {
    check(typeof file === 'string' && file.length > 0, 'MAINTENANCE_PRIVATE_PATH_REQUIRED');
    const resolved = path.join(fs.realpathSync(path.dirname(path.resolve(file))), path.basename(file));
    const root = fs.realpathSync(path.resolve(__dirname, '..'));
    const relative = path.relative(root, resolved);
    check(relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'MAINTENANCE_PRIVATE_FILE_IN_GIT');
    for (let directory = path.dirname(resolved); ; directory = path.dirname(directory)) {
        check(!fs.existsSync(path.join(directory, '.git')), 'MAINTENANCE_PRIVATE_FILE_IN_GIT');
        if (path.dirname(directory) === directory) break;
    }
    if (fs.existsSync(resolved)) check(!fs.lstatSync(resolved).isSymbolicLink(), 'MAINTENANCE_PRIVATE_SYMLINK');
    return resolved;
}
function readPinned(file, expectedHash) {
    check(hash64(expectedHash), 'MAINTENANCE_REVIEWED_HASH_REQUIRED');
    const body = fs.readFileSync(privatePath(file));
    check(hash(body) === expectedHash, 'MAINTENANCE_PRIVATE_HASH_MISMATCH');
    try { return JSON.parse(body.toString('utf8')); }
    catch { throw Object.assign(new Error('MAINTENANCE_PRIVATE_JSON_INVALID'), { code: 'MAINTENANCE_PRIVATE_JSON_INVALID' }); }
}
function writePrivate(file, value) {
    const resolved = privatePath(file); const body = JSON.stringify(value);
    const fd = fs.openSync(resolved, 'wx', 0o600);
    try { fs.writeFileSync(fd, body); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return hash(body);
}
function artifactHash(sourceDir) {
    const root = fs.realpathSync(sourceDir);
    const tempRelative = path.relative(fs.realpathSync(os.tmpdir()), root);
    check(tempRelative && !tempRelative.startsWith('..') && !path.isAbsolute(tempRelative), 'MAINTENANCE_ARTIFACT_OUTSIDE_TEMP');
    const entries = [];
    function walk(directory) {
        for (const name of fs.readdirSync(directory).sort()) {
            const file = path.join(directory, name), stat = fs.lstatSync(file);
            check(!stat.isSymbolicLink(), 'MAINTENANCE_ARTIFACT_SYMLINK');
            if (stat.isDirectory()) walk(file);
            else { check(stat.isFile(), 'MAINTENANCE_ARTIFACT_TYPE'); entries.push([path.relative(root, file).split(path.sep).join('/'), stat.mode & 0o777, hash(fs.readFileSync(file))]); }
        }
    }
    walk(root); check(entries.length > 0, 'MAINTENANCE_EMPTY_ARTIFACT'); return digest(entries);
}
function boundedTime(value, now) {
    const issued = Date.parse(value.createdAtUtc), expires = Date.parse(value.expiresAtUtc);
    check(Number.isFinite(issued) && issued <= now && expires > now && expires - issued <= 30 * 60000, 'MAINTENANCE_EXPIRED_OR_UNBOUNDED');
}
function assertOptions(options) {
    for (const key of ['project', 'environment', 'service', 'branch', 'liveUrl']) check(options[key] === TARGET[key], 'MAINTENANCE_TARGET_MISMATCH');
    check(['prepare', 'forward', 'rollback'].includes(options.maintenanceMode), 'MAINTENANCE_MODE_REQUIRED');
    check(!options.skipRemoteCheck && !options.exportRoot && !options.recoverMissingLiveMetadataCommit && !options.migrateLiveSourceBranchFrom && !options.migrateLiveSourceBranchCommit, 'MAINTENANCE_UNSAFE_OVERRIDE');
    check(typeof options.maintenanceApproval === 'string' && /^[A-Za-z0-9_-]{8,160}$/.test(options.maintenanceApproval), 'MAINTENANCE_APPROVAL_REQUIRED');
}
function assertProofs(proofs, options, now) {
    check(proofs?.approvalRef === options.maintenanceApproval, 'MAINTENANCE_APPROVAL_MISMATCH');
    boundedTime(proofs, now);
    for (const key of ['auditObservedAtUtc', 'inventoryObservedAtUtc']) {
        const observed = Date.parse(proofs[key]);
        check(Number.isFinite(observed) && observed <= now && now - observed <= 30 * 60000, 'MAINTENANCE_OWNERSHIP_PROOFS_STALE');
    }
    for (const key of ['migrationHash', 'auditProofHash', 'planHash', 'databaseFingerprint', 'foundationFingerprint']) check(hash64(proofs[key]), 'MAINTENANCE_OWNERSHIP_PROOFS_REQUIRED');
    return proofs;
}
function latestInstance(snapshot) {
    check(snapshot?.id === TARGET.project && snapshot.name === 'fortunate-appreciation', 'MAINTENANCE_PROJECT_MISMATCH');
    const env = snapshot.environments?.edges?.map(e => e.node).find(e => e.name === TARGET.environment && e.id === 'd9f9b984-d54d-4620-a8bf-c48882ad5158');
    const instance = env?.serviceInstances?.edges?.map(e => e.node).find(e => e.serviceName === TARGET.service && e.serviceId === '3fb62d4c-2dc2-4701-8e2b-09ce16e188ee');
    check(instance && instance.environmentId === env.id && instance.source && !instance.cronSchedule && !instance.nextCronRunAt, 'MAINTENANCE_SOURCE_MISMATCH');
    return instance;
}
function assertWorkflowCi(run, jobs, expectedSha, expectedBranch) {
    check(run?.head_sha === expectedSha && run.head_branch === expectedBranch && run.event === 'push' && run.path === '.github/workflows/ci.yml', 'MAINTENANCE_CI_IDENTITY_MISMATCH');
    check(run.status === 'completed' && run.conclusion === 'success', 'MAINTENANCE_CI_NOT_GREEN');
    check(Array.isArray(jobs) && jobs.length > 0 && jobs.every(job => job.status === 'completed' && job.conclusion === 'success'), 'MAINTENANCE_CI_JOBS_NOT_GREEN');
    for (const name of ['Fast baseline', 'Omni browser regression', 'HR Team browser smoke', 'HR and payroll PostgreSQL integration']) check(jobs.some(job => job.name === name), 'MAINTENANCE_CI_JOB_MISSING');
    return { runId: run.id, attempt: run.run_attempt, sha: expectedSha, branch: expectedBranch, jobs: jobs.length, url: run.html_url };
}
function assertManifest(manifest, options, head, now) {
    check(manifest?.format === 'eventgenix.park-hr-maintenance' && manifest.schemaVersion === 1, 'MAINTENANCE_MANIFEST_INVALID');
    check(digest(manifest.target) === digest(TARGET), 'MAINTENANCE_TARGET_MISMATCH');
    check(manifest.approvalRef === options.maintenanceApproval, 'MAINTENANCE_APPROVAL_MISMATCH');
    boundedTime(manifest, now); assertProofs(manifest.proofs, options, now);
    check(sha(head) && head === manifest.release.sha && sha(manifest.baseline.sha), 'MAINTENANCE_RELEASE_SHA_MISMATCH');
    check(manifest.identity?.liveSha === manifest.baseline.sha && manifest.identity?.sourceBranch === TARGET.branch, 'MAINTENANCE_BASELINE_MISMATCH');
    check(manifest.baseline.live.commitSha === manifest.baseline.sha && manifest.baseline.live.sourceBranch === TARGET.branch && manifest.baseline.live.version === manifest.baseline.version, 'MAINTENANCE_BASELINE_MISMATCH');
    for (const mode of ['forward', 'rollback']) check(manifest.uploadMarkers?.[mode] && privatePath(manifest.uploadMarkers[mode]), 'MAINTENANCE_UPLOAD_MARKERS_REQUIRED');
    for (const artifact of [manifest.release, manifest.baseline]) check(hash64(artifact.artifactHash) && typeof artifact.version === 'string' && artifact.sourceDir, 'MAINTENANCE_ARTIFACT_REQUIRED');
    return manifest;
}
function assertReceipt(receipt, manifest, mode, now) {
    const notApplied = mode === 'rollback' && receipt?.state === 'VERIFIED_NOT_COMMITTED' && receipt.operation === 'READ_ONLY_RECOVERY';
    check(notApplied || (receipt?.state === 'COMMITTED' && receipt.operation === (mode === 'forward' ? 'APPLY' : 'ROLLBACK')), 'MAINTENANCE_COMMITTED_RECEIPT_REQUIRED');
    check(receipt.liveSha === manifest.baseline.sha && receipt.releaseSha === manifest.release.sha && receipt.approvalRef === manifest.approvalRef, 'MAINTENANCE_RECEIPT_SCOPE_MISMATCH');
    for (const key of ['migrationHash', 'auditProofHash', 'planHash', 'databaseFingerprint', 'foundationFingerprint']) check(receipt[key] === manifest.proofs[key], 'MAINTENANCE_RECEIPT_PROOF_MISMATCH');
    const committed = Date.parse(notApplied ? receipt.verifiedAtUtc : receipt.committedAtUtc);
    check(Number.isFinite(committed) && committed <= now && now - committed <= (notApplied ? 60000 : 5 * 60000), 'MAINTENANCE_RECEIPT_STALE');
    check(receipt.writerProof?.mode === 'SERVICE_STOPPED' && hash64(receipt.writerProof.evidenceHash), 'MAINTENANCE_RECEIPT_WRITER_PROOF_REQUIRED');
}
function assertRollbackStopped(snapshot, manifest, forwardAttempt) {
    check(forwardAttempt?.manifestHash === manifest.reviewHash && forwardAttempt.artifactSha === manifest.release.sha && forwardAttempt.mode === 'forward' && sha(forwardAttempt.artifactSha), 'MAINTENANCE_FORWARD_ATTEMPT_MISMATCH');
    if (forwardAttempt.state === 'VALIDATION_FAILED_NO_UPLOAD') { verifyStoppedSnapshot(snapshot, manifest.identity); return; }
    const instance = latestInstance(snapshot), latest = instance.latestDeployment;
    check(Array.isArray(instance.activeDeployments) && instance.activeDeployments.length === 0 && latest?.status === 'REMOVED' && latest.deploymentStopped === true, 'APPLICATION_WRITERS_STILL_ACTIVE');
    check(forwardAttempt.deployment?.id === latest.id && latest.meta?.cliMessage === forwardAttempt.message, 'MAINTENANCE_ROLLBACK_DEPLOYMENT_MISMATCH');
    check(/^sha256:[a-f0-9]{64}$/.test(forwardAttempt.deployment.imageDigest || '') && latest.meta.imageDigest === forwardAttempt.deployment.imageDigest, 'MAINTENANCE_ROLLBACK_IMAGE_MISMATCH');
    check(digest(instance.source) === digest(manifest.source), 'MAINTENANCE_SOURCE_MISMATCH');
}
async function prepare(options, io) {
    assertOptions(options); check(options.maintenanceMode === 'prepare', 'MAINTENANCE_MODE_MISMATCH'); check(!options.dryRun, 'MAINTENANCE_PREPARE_IS_ALREADY_READ_ONLY');
    const now = io.now();
    const proofs = assertProofs(readPinned(options.maintenanceProofs, options.maintenanceProofsSha256), options, now);
    const head = await io.head(), remote = await io.remote();
    check(sha(head) && remote === head, 'MAINTENANCE_REMOTE_DRIFT');
    if (options.commit) check(options.commit === head, 'MAINTENANCE_RELEASE_SHA_MISMATCH');
    const live = await io.live();
    await io.assertForwardSafety(live, head, remote);
    check(live.commitSha !== head, 'MAINTENANCE_NEW_RELEASE_REQUIRED');
    await io.ancestor(live.commitSha, head);
    const snapshot = await io.status();
    const identity = captureMaintenanceIdentity(snapshot, live, live.commitSha);
    const source = latestInstance(snapshot).source;
    const baselinePkg = await io.packageAt(live.commitSha), releasePkg = await io.packageAt(head);
    check(baselinePkg.version === live.version && releasePkg.version === io.localVersion(), 'MAINTENANCE_PACKAGE_VERSION_MISMATCH');
    const releaseCi = await io.ci(head), baselineCi = await io.ci(live.commitSha);
    const artifacts = [];
    try {
        for (const [commit, version] of [[head, releasePkg.version], [live.commitSha, baselinePkg.version]]) {
            const exported = await io.exportArtifact(commit, version);
            artifacts.push({ sha: commit, version, sourceDir: exported.sourceDir, artifactHash: artifactHash(exported.sourceDir) });
        }
        // CI/export can take time. Recapture all pre-stop identity before sealing.
        check(await io.remote() === head, 'MAINTENANCE_REMOTE_DRIFT');
        const finalLive = await io.live();
        check(finalLive.commitSha === live.commitSha && finalLive.sourceBranch === live.sourceBranch && finalLive.version === live.version && finalLive.deploymentMetadata?.complete === true && finalLive.deploymentMetadata?.status === live.deploymentMetadata.status, 'MAINTENANCE_LIVE_CHANGED_DURING_PREPARE');
        check(digest(captureMaintenanceIdentity(await io.status(), finalLive, live.commitSha)) === digest(identity), 'MAINTENANCE_DEPLOYMENT_DRIFT');
        boundedTime(proofs, io.now());
        const manifest = { uploadMarkers: { forward: privatePath(options.maintenanceManifest + '.forward-upload'), rollback: privatePath(options.maintenanceManifest + '.rollback-upload') }, format: 'eventgenix.park-hr-maintenance', schemaVersion: 1, approvalRef: options.maintenanceApproval, createdAtUtc: new Date(now).toISOString(), expiresAtUtc: proofs.expiresAtUtc, target: TARGET, proofs, source, identity,
            release: { ...artifacts[0], ci: releaseCi }, baseline: { ...artifacts[1], live, ci: baselineCi } };
        const manifestHash = writePrivate(options.maintenanceManifest, manifest);
        return { state: 'PREPARED_NO_PRODUCTION_CHANGE', manifestHash, releaseSha: head, rollbackSha: live.commitSha };
    } catch (error) { for (const artifact of artifacts) await io.cleanupArtifact(artifact); throw error; }
}
async function execute(options, io) {
    assertOptions(options); check(['forward', 'rollback'].includes(options.maintenanceMode), 'MAINTENANCE_MODE_MISMATCH');
    const manifest = readPinned(options.maintenanceManifest, options.maintenanceManifestSha256);
    const head = await io.head();
    assertManifest(manifest, options, head, io.now());
    manifest.reviewHash = options.maintenanceManifestSha256;
    if (options.commit) check(options.commit === head, 'MAINTENANCE_RELEASE_SHA_MISMATCH');
    const artifact = options.maintenanceMode === 'rollback' ? manifest.baseline : manifest.release;
    const forwardAttempt = options.maintenanceMode === 'rollback' && options.maintenanceForwardAttempt ? readPinned(options.maintenanceForwardAttempt, options.maintenanceForwardAttemptSha256) : null;
    const readReceipt = () => {
        const raw = readPinned(options.maintenanceReceipt, options.maintenanceReceiptSha256);
        check(typeof raw.body === 'string' && hash(raw.body) === raw.sha256, 'MAINTENANCE_RECEIPT_CORRUPTED');
        return JSON.parse(raw.body);
    };
    const noApplyRecovery = readReceipt().state === 'VERIFIED_NOT_COMMITTED';
    function verifyStopped(state) {
        if (noApplyRecovery) {
            check(options.maintenanceMode === 'rollback' && !fs.existsSync(manifest.uploadMarkers.forward), 'MAINTENANCE_UPLOAD_ALREADY_REQUESTED');
            verifyStoppedSnapshot(state, manifest.identity);
        } else if (options.maintenanceMode === 'rollback') assertRollbackStopped(state, manifest, forwardAttempt);
        else verifyStoppedSnapshot(state, manifest.identity);
    }
    async function gate() {
        assertManifest(manifest, options, await io.head(), io.now());
        check(await io.remote() === manifest.release.sha, 'MAINTENANCE_REMOTE_DRIFT');
        await io.assertForwardSafety(manifest.baseline.live, manifest.release.sha, manifest.release.sha);
        await io.ancestor(manifest.baseline.sha, manifest.release.sha);
        await io.ci(artifact.sha);
        const state = await io.status();
        verifyStopped(state);
        // No fallback from the online path. Even an HTTP 500 is insufficient without
        // the exact stopped deployment proof. A healthy endpoint always blocks offline upload.
        check(await io.liveIsUnavailable() === true, 'MAINTENANCE_LIVE_STILL_REACHABLE');
        const receiptRaw = readPinned(options.maintenanceReceipt, options.maintenanceReceiptSha256);
        // Operator receipts use a checksum envelope; verify it independently before use.
        check(typeof receiptRaw.body === 'string' && hash(receiptRaw.body) === receiptRaw.sha256, 'MAINTENANCE_RECEIPT_CORRUPTED');
        assertReceipt(JSON.parse(receiptRaw.body), manifest, options.maintenanceMode, io.now());
        check(artifactHash(artifact.sourceDir) === artifact.artifactHash, 'MAINTENANCE_ARTIFACT_CHANGED');
        await io.validateArtifact(artifact);
        // Slow CI/artifact validation must not leave a stale ref or stopped-state proof.
        check(await io.head() === manifest.release.sha && await io.remote() === manifest.release.sha, 'MAINTENANCE_REMOTE_DRIFT');
        const finalState = await io.status();
        verifyStopped(finalState);
        check(await io.liveIsUnavailable() === true, 'MAINTENANCE_LIVE_STILL_REACHABLE');
        boundedTime(manifest, io.now()); assertProofs(manifest.proofs, options, io.now());
        assertReceipt(JSON.parse(readPinned(options.maintenanceReceipt, options.maintenanceReceiptSha256).body), manifest, options.maintenanceMode, io.now());
    }
    await gate();
    if (options.dryRun) return { state: 'VALIDATED_NO_UPLOAD', sha: artifact.sha, mode: options.maintenanceMode };
    const message = `Maintenance ${options.maintenanceManifestSha256} ${artifact.sha} ${crypto.randomUUID()}`;
    const attempt = { format: 'eventgenix.maintenance-attempt', mode: options.maintenanceMode, manifestHash: options.maintenanceManifestSha256, artifactSha: artifact.sha, artifactHash: artifact.artifactHash, message, createdAtUtc: new Date(io.now()).toISOString(), state: 'UPLOAD_REQUESTED' };
    // A fresh exclusive attempt file refuses accidental reuse of a failed upload command.
    check(!fs.existsSync(privatePath(options.maintenanceAttempt + '.result')), 'MAINTENANCE_ATTEMPT_RESULT_EXISTS');
    writePrivate(options.maintenanceAttempt, attempt);
    try { await gate(); } // recheck expiry, refs, CI, status, receipt and artifact immediately before upload
    catch (error) { writePrivate(options.maintenanceAttempt + '.result', { ...attempt, state: 'VALIDATION_FAILED_NO_UPLOAD' }); throw error; }
    writePrivate(manifest.uploadMarkers[options.maintenanceMode], { message, manifestHash: options.maintenanceManifestSha256, artifactSha: artifact.sha, requestedAtUtc: new Date(io.now()).toISOString() });
    let uploadError;
    try { await io.upload(artifact, message); }
    catch (error) { uploadError = error; }
    // Always preserve platform evidence before smoke. Never infer a deployment from a truncated history.
    try {
        const deployment = latestInstance(await io.status()).latestDeployment;
        check(deployment?.meta?.cliMessage === message && deployment.id !== manifest.identity.deploymentId, 'MAINTENANCE_UPLOAD_IDENTITY_UNKNOWN');
        attempt.deployment = { id: deployment.id, imageDigest: deployment.meta.imageDigest || null, status: deployment.status };
        attempt.state = uploadError ? 'UPLOAD_ERROR' : 'UPLOADED';
        const resultPath = options.maintenanceAttempt + '.result';
        writePrivate(resultPath, attempt);
    } catch (error) { error.code = error.code || 'MAINTENANCE_UPLOAD_IDENTITY_UNKNOWN'; throw error; }
    if (uploadError) throw uploadError;
    check(await io.remote() === manifest.release.sha, 'MAINTENANCE_REMOTE_DRIFT_AFTER_UPLOAD');
    await io.ci(artifact.sha);
    boundedTime(manifest, io.now());
    await io.smoke(artifact);
    return { state: 'DEPLOYED_SMOKE_VERIFIED', sha: artifact.sha, mode: options.maintenanceMode };
}
async function createNoApplyRecoveryProof(db, plan, manifest, verifyWritersStopped) {
    // Caller supplies an existing audit-role connection. This function cannot issue
    // credentials, grant rights or open a connection; all queries are read-only.
    const mode = (await db.query("SELECT current_user AS role,session_user AS session_role,current_setting('transaction_read_only') AS readonly,current_setting('transaction_isolation') AS isolation")).rows[0];
    check(mode.role === 'eventgenix_audit_ro' && mode.session_role === 'eventgenix_audit_ro' && mode.readonly === 'on' && mode.isolation === 'repeatable read', 'MAINTENANCE_RECOVERY_AUDIT_ROLE_REQUIRED');
    const normalized = ownershipOperator.normalizePlan(plan);
    check(digest(normalized) === manifest.proofs.planHash && ownershipOperator.migrationHash === manifest.proofs.migrationHash, 'MAINTENANCE_RECEIPT_PROOF_MISMATCH');
    const writerProof = await verifyWritersStopped(db);
    const observed = Date.parse(writerProof?.observedAtUtc);
    check(writerProof?.allWritersStopped === true && writerProof.otherWritableSessions === 0 && writerProof.mode === 'SERVICE_STOPPED' && writerProof.liveSha === manifest.baseline.sha && Number.isFinite(observed) && observed <= Date.now() && Date.now() - observed <= 60000 && hash64(writerProof.evidenceHash), 'MAINTENANCE_RECOVERY_WRITERS_NOT_STOPPED');
    const recovery = await ownershipOperator.recoverReceipt(db, { plan: normalized, planHash: manifest.proofs.planHash, migrationHash: manifest.proofs.migrationHash, databaseFingerprint: manifest.proofs.databaseFingerprint, foundationFingerprint: manifest.proofs.foundationFingerprint, foundationBefore: { recorded: false } });
    check(recovery === 'NOT_COMMITTED', 'MAINTENANCE_NO_APPLY_STATE_NOT_PROVEN');
    return { ...manifest.proofs, approvalRef: manifest.approvalRef, operation: 'READ_ONLY_RECOVERY', state: 'VERIFIED_NOT_COMMITTED', liveSha: manifest.baseline.sha, releaseSha: manifest.release.sha, verifiedAtUtc: new Date().toISOString(), writerProof };
}
module.exports = { createNoApplyRecoveryProof, TARGET, digest, readPinned, writePrivate, artifactHash, assertOptions, assertManifest, assertReceipt, assertWorkflowCi, assertRollbackStopped, prepare, execute };
