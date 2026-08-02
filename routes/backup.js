/**
 * Structured database recovery endpoints.
 *
 * Legacy raw-SQL restore is intentionally unsupported. Every write is planned
 * and executed by server-owned parameterized recovery code.
 */
'use strict';

const router = require('express').Router();
const { pool } = require('../db');
const { generateBackupArtifact, sendBackupToTelegram } = require('../services/backup');
const { getKyivDateStr } = require('../services/booking');
const { createLogger } = require('../utils/logger');
const { logAdminAction, logAdminActionStrict } = require('../services/adminAudit');
const { requireAction, requireRole } = require('../middleware/auth');
const { loadBackupCatalog } = require('../services/backupCatalog');
const { isValidRecoveryPassphrase } = require('../services/backupArtifact');
const {
    assertRestoreConfirmation,
    createRestorePlan,
    decryptBackupArtifact,
    encryptBackupArtifact,
    executeRestorePlan,
    validateBackupArtifact
} = require('../services/backupRecovery');
const {
    BACKUP_ARTIFACT_FORMAT,
    BACKUP_EXCLUDED_TABLES,
    FULL_RESTORE_SUPPORTED,
    LEGACY_SQL_RESTORE_SUPPORTED,
    RESTORE_SETS
} = require('../config/backupRestorePolicy');

const log = createLogger('Backup');
const ENCRYPTION_KEY_HEADER = 'x-backup-encryption-key';

// The same role gate is mounted before the large JSON parser in server.js.
// Keep the route-local gate as defense in depth and for direct router tests.
router.use(requireRole('creator', 'director'));
const requireDataExport = requireAction('export_data');
const requireRevenueView = requireAction('view_revenue');
const requireSettingsManagement = requireAction('manage_settings');

function recoveryErrorResponse(res, error, requestId) {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    const code = sanitizedBackupErrorCode(error, 'BACKUP_RECOVERY_FAILED');
    if (status >= 500) log.error('Backup recovery failed', { code });
    else log.warn(`Backup recovery rejected [${code}]`);
    return res.status(status).json({
        error: code,
        requestId: requestId || undefined
    });
}

function sanitizedBackupErrorCode(error, fallback) {
    const value = String(error?.code || '').trim();
    return /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : fallback;
}

async function auditBackupDownload(req, {
    success,
    encrypted,
    artifactId = null,
    sizeBytes = null,
    errorCode = null
}) {
    const details = {
        success: success === true,
        encrypted: encrypted === true,
        formatVersion: BACKUP_ARTIFACT_FORMAT.version
    };
    if (success === true) {
        details.artifactId = /^[a-f0-9]{64}$/.test(String(artifactId || ''))
            ? artifactId
            : null;
        details.sizeBytes = Number.isSafeInteger(sizeBytes) && sizeBytes >= 0
            ? sizeBytes
            : null;
    } else {
        details.errorCode = /^[A-Z][A-Z0-9_]{0,79}$/.test(String(errorCode || ''))
            ? errorCode
            : 'BACKUP_DOWNLOAD_FAILED';
    }

    const auditContext = {
        username: req.user?.username,
        ip: req.ip,
        requestId: req.headers['x-request-id'],
        details
    };
    if (success !== true) {
        await logAdminAction('backup_download', 'backup', auditContext);
        return;
    }

    try {
        await logAdminActionStrict('backup_download', 'backup', auditContext);
    } catch {
        const error = new Error('Backup download requires a durable audit receipt');
        error.code = 'BACKUP_DOWNLOAD_AUDIT_REQUIRED';
        error.statusCode = 503;
        throw error;
    }
}

function getEncryptionPassphrase(req) {
    const value = req.headers[ENCRYPTION_KEY_HEADER] || process.env.BACKUP_ENCRYPTION_KEY;
    return isValidRecoveryPassphrase(value) ? value : null;
}

function setSensitiveDownloadHeaders(res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
}

function createRequestAbortSignal(req, res) {
    const controller = new AbortController();
    const abort = () => {
        if (!controller.signal.aborted) controller.abort();
    };
    const close = () => {
        if (!res.writableEnded) abort();
    };
    req.once('aborted', abort);
    res.once('close', close);
    return {
        signal: controller.signal,
        cleanup() {
            req.removeListener('aborted', abort);
            res.removeListener('close', close);
        }
    };
}

async function runRestoreRequest(req, res, artifact) {
    assertRestoreConfirmation(req.headers);
    if (req.body?.sql !== undefined) {
        const error = new Error('Legacy raw SQL restore is disabled');
        error.code = 'BACKUP_RAW_SQL_FORBIDDEN';
        error.statusCode = 400;
        throw error;
    }
    const plan = createRestorePlan(artifact, {
        mode: req.body?.mode,
        restoreSet: req.body?.restoreSet,
        tables: req.body?.tables
    });
    const abortState = createRequestAbortSignal(req, res);
    let client;
    let releaseError = null;
    try {
        client = await pool.connect();
        const result = await executeRestorePlan(client, plan, {
            signal: abortState.signal
        });
        await logAdminAction('backup_restore', 'backup', {
            username: req.user?.username,
            ip: req.ip,
            requestId: req.headers['x-request-id'],
            details: {
                mode: result.mode,
                restoreSet: result.restoreSet,
                artifactId: result.artifactId,
                tableCount: result.tablesRestored.length,
                insertedRows: result.insertedRows,
                verified: result.verified
            }
        });
        return result;
    } catch (error) {
        if (error?.destroyClient) releaseError = error;
        throw error;
    } finally {
        abortState.cleanup();
        client?.release(releaseError || undefined);
    }
}

router.post('/create', requireDataExport, requireRevenueView, async (req, res) => {
    try {
        const result = await sendBackupToTelegram({
            passphrase: getEncryptionPassphrase(req)
        });
        await logAdminAction('backup_create', 'backup', {
            username: req.user?.username,
            ip: req.ip,
            requestId: req.headers['x-request-id'],
            details: { success: result.success, size: result.size, formatVersion: result.formatVersion }
        });
        res.status(result.success ? 200 : 503).json(result);
    } catch (error) {
        await logAdminAction('backup_create', 'backup', {
            username: req.user?.username,
            ip: req.ip,
            requestId: req.headers['x-request-id'],
            details: {
                success: false,
                formatVersion: BACKUP_ARTIFACT_FORMAT.version,
                errorCode: sanitizedBackupErrorCode(error, 'BACKUP_CREATE_FAILED')
            }
        });
        recoveryErrorResponse(res, error, req.headers['x-request-id']);
    }
});

router.get('/download', requireDataExport, requireRevenueView, async (req, res) => {
    try {
        const artifact = await generateBackupArtifact();
        const validated = validateBackupArtifact(artifact);
        const artifactText = JSON.stringify(artifact);
        await auditBackupDownload(req, {
            success: true,
            encrypted: false,
            artifactId: validated.artifactId,
            sizeBytes: Buffer.byteLength(artifactText, 'utf8')
        });
        const dateStr = getKyivDateStr();
        setSensitiveDownloadHeaders(res);
        res.setHeader('Content-Type', 'application/vnd.eventgenix.backup+json');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="eventgenix_${dateStr}.egbackup.json"`
        );
        res.send(artifactText);
    } catch (error) {
        await auditBackupDownload(req, {
            success: false,
            encrypted: false,
            errorCode: sanitizedBackupErrorCode(error, 'BACKUP_DOWNLOAD_FAILED')
        });
        return recoveryErrorResponse(res, error, req.headers['x-request-id']);
    }
});

router.get('/verify', requireSettingsManagement, async (req, res) => {
    try {
        const startedAt = Date.now();
        const artifact = await generateBackupArtifact();
        const validated = validateBackupArtifact(artifact);
        res.json({
            ok: true,
            format: BACKUP_ARTIFACT_FORMAT.name,
            formatVersion: BACKUP_ARTIFACT_FORMAT.version,
            artifactId: validated.artifactId,
            applicationVersion: validated.manifest.applicationVersion,
            generatedAt: validated.manifest.generatedAt,
            schemaFingerprint: validated.manifest.schemaFingerprint,
            migrationHead: validated.manifest.migrationHead,
            tableCount: validated.manifest.tableCount,
            totalRows: validated.manifest.totalRows,
            elapsedMs: Date.now() - startedAt,
            complete: true
        });
    } catch (error) {
        recoveryErrorResponse(res, error, req.headers['x-request-id']);
    }
});

router.get('/download-encrypted', requireDataExport, requireRevenueView, async (req, res) => {
    try {
        const passphrase = getEncryptionPassphrase(req);
        if (!passphrase) {
            await auditBackupDownload(req, {
                success: false,
                encrypted: true,
                errorCode: 'BACKUP_ENCRYPTION_KEY_REQUIRED'
            });
            return res.status(400).json({ error: 'BACKUP_ENCRYPTION_KEY_REQUIRED' });
        }
        const artifact = await generateBackupArtifact();
        const validated = validateBackupArtifact(artifact);
        const envelope = encryptBackupArtifact(artifact, passphrase);
        const envelopeText = JSON.stringify(envelope);
        await auditBackupDownload(req, {
            success: true,
            encrypted: true,
            artifactId: validated.artifactId,
            sizeBytes: Buffer.byteLength(envelopeText, 'utf8')
        });
        const dateStr = getKyivDateStr();
        setSensitiveDownloadHeaders(res);
        res.setHeader('Content-Type', 'application/vnd.eventgenix.backup.encrypted+json');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="eventgenix_${dateStr}.egbackup.enc.json"`
        );
        return res.send(envelopeText);
    } catch (error) {
        await auditBackupDownload(req, {
            success: false,
            encrypted: true,
            errorCode: sanitizedBackupErrorCode(error, 'BACKUP_ENCRYPTED_DOWNLOAD_FAILED')
        });
        return recoveryErrorResponse(res, error, req.headers['x-request-id']);
    }
});

router.post('/restore', requireSettingsManagement, async (req, res) => {
    try {
        if (req.body?.sql !== undefined) {
            return res.status(400).json({ error: 'BACKUP_RAW_SQL_FORBIDDEN' });
        }
        if (!req.body?.artifact) {
            return res.status(400).json({ error: 'BACKUP_ARTIFACT_REQUIRED' });
        }
        const result = await runRestoreRequest(req, res, req.body.artifact);
        if (!res.headersSent) res.json(result);
    } catch (error) {
        if (!res.headersSent) recoveryErrorResponse(res, error, req.headers['x-request-id']);
    }
});

router.post('/restore-encrypted', requireSettingsManagement, async (req, res) => {
    try {
        const passphrase = getEncryptionPassphrase(req);
        if (!passphrase || !req.body?.envelope) {
            return res.status(400).json({ error: 'BACKUP_ENCRYPTED_ARTIFACT_REQUIRED' });
        }
        const artifact = decryptBackupArtifact(req.body.envelope, passphrase);
        const result = await runRestoreRequest(req, res, artifact);
        if (!res.headersSent) res.json(result);
    } catch (error) {
        if (!res.headersSent) recoveryErrorResponse(res, error, req.headers['x-request-id']);
    }
});

router.get('/tables', requireSettingsManagement, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const catalog = await loadBackupCatalog(client, {
            excludedTables: new Set(Object.keys(BACKUP_EXCLUDED_TABLES))
        });
        res.json({
            format: BACKUP_ARTIFACT_FORMAT,
            tables: catalog.tables.map(table => table.name),
            excludedTables: BACKUP_EXCLUDED_TABLES,
            restoreSets: RESTORE_SETS,
            fullRestoreSupported: FULL_RESTORE_SUPPORTED,
            fullRestoreRuntimeEnabled: process.env.BACKUP_FULL_RESTORE_ENABLED === 'true'
                && process.env.BACKUP_RECOVERY_MODE === 'true',
            recoveryMode: process.env.BACKUP_RECOVERY_MODE === 'true',
            outboundHold: process.env.BACKUP_OUTBOUND_HOLD === 'true',
            outboundSideEffectsSuppressed: process.env.BACKUP_RECOVERY_MODE === 'true'
                || process.env.BACKUP_OUTBOUND_HOLD === 'true',
            encryptedDeliveryKeyConfigured: isValidRecoveryPassphrase(
                process.env.BACKUP_ENCRYPTION_KEY
            ),
            legacyRawSqlRestoreSupported: LEGACY_SQL_RESTORE_SUPPORTED
        });
    } catch (error) {
        recoveryErrorResponse(res, error, req.headers['x-request-id']);
    } finally {
        client?.release();
    }
});

module.exports = router;
