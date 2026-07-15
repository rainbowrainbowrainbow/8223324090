'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { pool } = require('../db');
const { BACKUP_TABLES, generateBackupSQL } = require('../services/backup');

const ROOT = path.resolve(__dirname, '..');

function read(...parts) {
    return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

function routeBlock(source, method, routePath) {
    const marker = `router.${method}('${routePath}'`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `Missing ${method.toUpperCase()} ${routePath}`);
    const nextRoute = source.indexOf('\nrouter.', start + marker.length);
    return source.slice(start, nextRoute === -1 ? source.length : nextRoute);
}

function namedFunctionBlock(source, functionName) {
    const marker = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`).exec(source);
    assert.ok(marker, `Missing function ${functionName}`);
    const start = marker.index;
    const remainder = source.slice(start + marker[0].length);
    const nextFunction = /\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(remainder);
    return source.slice(start, nextFunction ? start + marker[0].length + nextFunction.index : source.length);
}

function assertInOrder(source, patterns, label) {
    let cursor = 0;
    for (const pattern of patterns) {
        const remainder = source.slice(cursor);
        const relativeIndex = typeof pattern === 'string'
            ? remainder.indexOf(pattern)
            : remainder.search(pattern);
        assert.notEqual(relativeIndex, -1, `${label}: missing or out-of-order ${String(pattern)}`);
        cursor += relativeIndex + 1;
    }
}

test('backup inventory contains staff_checkins exactly once after its staff parent', () => {
    const staffIndex = BACKUP_TABLES.indexOf('staff');
    const checkinsIndex = BACKUP_TABLES.indexOf('staff_checkins');

    assert.ok(staffIndex >= 0, 'staff must remain in backup inventory');
    assert.equal(checkinsIndex, staffIndex + 1, 'staff_checkins must restore immediately after staff');
    assert.equal(BACKUP_TABLES.filter(table => table === 'staff_checkins').length, 1);
});

test('generated backup deletes staff_checkins before staff and inserts staff before staff_checkins', async t => {
    const originalConnect = pool.connect;
    const staffCreatedAt = new Date('2026-07-15T07:45:00.000Z');
    const checkinCreatedAt = new Date('2026-07-15T08:01:02.000Z');
    const checkinAt = new Date('2026-07-15T08:00:00.000Z');
    const checkoutAt = new Date('2026-07-15T17:30:00.000Z');
    const queries = [];

    pool.connect = async () => ({
        async query(sql) {
            const queryText = typeof sql === 'string' ? sql : sql?.text;
            const normalized = String(queryText).replace(/\s+/g, ' ').trim();
            queries.push(normalized);
            if (normalized === 'SELECT * FROM staff') {
                return {
                    rows: [{
                        id: 701,
                        name: 'QA Backup Person',
                        created_at: staffCreatedAt
                    }]
                };
            }
            if (normalized === 'SELECT * FROM staff_checkins') {
                return {
                    rows: [{
                        id: 903,
                        staff_id: 701,
                        date: '2026-07-15',
                        check_in: checkinAt,
                        check_out: checkoutAt,
                        method: 'qa_contract',
                        created_at: checkinCreatedAt
                    }]
                };
            }
            return { rows: [] };
        },
        release() {}
    });
    t.after(() => {
        pool.connect = originalConnect;
    });

    const sql = await generateBackupSQL();
    const deletePhase = sql.slice(
        sql.indexOf('-- === PHASE 1: DELETE'),
        sql.indexOf('-- === PHASE 2: INSERT')
    );
    const insertPhase = sql.slice(sql.indexOf('-- === PHASE 2: INSERT'));

    assertInOrder(deletePhase, [
        'DELETE FROM staff_checkins;',
        'DELETE FROM staff;'
    ], 'backup delete phase');
    assertInOrder(insertPhase, [
        'INSERT INTO staff ',
        'INSERT INTO staff_checkins '
    ], 'backup insert phase');
    assert.match(sql, /INSERT INTO staff_checkins \(id, staff_id, date, check_in, check_out, method, created_at\)/);
    assert.match(sql, /'2026-07-15T08:00:00\.000Z'/);
    assert.match(sql, /'2026-07-15T17:30:00\.000Z'/);
    assert.match(sql, /'2026-07-15T08:01:02\.000Z'/);
    assert.equal(queries.indexOf('SELECT * FROM staff') < queries.indexOf('SELECT * FROM staff_checkins'), true);
});

test('backup routes derive restore whitelist and selectable tables from BACKUP_TABLES', () => {
    const source = read('routes', 'backup.js');

    assert.match(source, /const ALLOWED_TABLES = new Set\(BACKUP_TABLES\)/);
    assert.match(source, /const ATTENDANCE_MAINTENANCE_TABLES = new Set\(\[[\s\S]*'staff_checkins'[\s\S]*\]\)/);
    assert.match(source, /const SELECTIVE_RESTORE_BLOCKED_TABLES = new Set\(\['staff'\]\)/);
    assertInOrder(routeBlock(source, 'post', '/restore'), [
        /prepareRestoreStatements\(sql, targetTables\)/,
        /rejected\.length > 0/,
        /restoreTouchesAttendanceState\(validated, sequenceTables\)/,
        /lockAttendanceWriteMaintenance\(client\)/,
        /executeRestoreStatements\([\s\S]*client,[\s\S]*validated,[\s\S]*sequenceTables/,
        /client\.query\('COMMIT'\)/
    ], 'selective restore');
    assertInOrder(routeBlock(source, 'post', '/restore-encrypted'), [
        /prepareRestoreStatements\(sql, req\.body\.tables\)/,
        /rejected\.length > 0/,
        /restoreTouchesAttendanceState\(statements, sequenceTables\)/,
        /lockAttendanceWriteMaintenance\(client\)/,
        /executeRestoreStatements\([\s\S]*client,[\s\S]*statements,[\s\S]*sequenceTables/,
        /client\.query\('COMMIT'\)/
    ], 'encrypted restore');
    assert.match(routeBlock(source, 'get', '/tables'), /res\.json\(\{ tables: BACKUP_TABLES \}\)/);
});

test('both restore endpoints share inserted-table collection and serial sequence repair', () => {
    const source = read('routes', 'backup.js');

    assertInOrder(namedFunctionBlock(source, 'collectInsertedRestoreTables'), [
        /validateRestoreStatement\(statement\)/,
        /validated\.type === 'INSERT'/,
        /tables\.add\(validated\.table\)/
    ], 'inserted table collection');
    assertInOrder(namedFunctionBlock(source, 'restoreTouchesAttendanceState'), [
        /sequenceTables/,
        /ATTENDANCE_MAINTENANCE_TABLES\.has\(table\)/,
        /statements\.some/
    ], 'attendance maintenance detection');
    assertInOrder(namedFunctionBlock(source, 'executeRestoreStatements'), [
        /collectInsertedRestoreTables\(statements\)/,
        /new Set\(\[\.\.\.tablesWithData, \.\.\.sequenceTables\]\)/,
        /client\.query\(statement\)/,
        /repairRestoredSequences\(client, tablesToRepair\)/
    ], 'shared restore executor');
    assertInOrder(namedFunctionBlock(source, 'repairRestoredSequences'), [
        /safeTableName\(table, BACKUP_TABLES\)/,
        /client\.query\('SAVEPOINT seq_fix'\)/,
        /pg_get_serial_sequence\(\$1, 'id'\)/,
        /\[table\]/,
        /client\.query\('RELEASE SAVEPOINT seq_fix'\)/
    ], 'shared sequence repair');

    assert.match(routeBlock(source, 'post', '/restore'), /executeRestoreStatements\([\s\S]*validated,[\s\S]*sequenceTables/);
    assert.match(routeBlock(source, 'post', '/restore-encrypted'), /executeRestoreStatements\([\s\S]*statements,[\s\S]*sequenceTables/);
});

test('backup restore parser preserves generated comments, quoted semicolons and temporal wire values', () => {
    const routeSource = read('routes', 'backup.js');
    const backupSource = read('services', 'backup.js');

    assertInOrder(namedFunctionBlock(routeSource, 'splitRestoreStatements'), [
        /inLineComment/,
        /inString/,
        /char === "'" && next === "'"/,
        /char === ';'/,
        /Unterminated SQL string literal/
    ], 'restore SQL scanner');
    assertInOrder(namedFunctionBlock(routeSource, 'prepareRestoreStatements'), [
        /splitRestoreStatements\(sql\)/,
        /targetTables !== undefined/,
        /Selective restore tables must be a non-empty array/,
        /ALLOWED_TABLES\.has\(table\)/,
        /SELECTIVE_RESTORE_BLOCKED_TABLES\.has\(table\)/,
        /validateRestoreStatement\(stmt\)/,
        /selectedTables\.has\(result\.table\)/,
        /result\.type === 'SEQUENCE_SYNC'/,
        /sequenceTables\.add\(result\.table\)/
    ], 'shared selective restore preparation');
    assert.match(routeSource, /exact sequence-sync metadata emitted by generateBackupSQL/);
    assert.match(backupSource, /RAW_BACKUP_TEMPORAL_OIDS = new Set\(\[1082, 1114, 1184\]\)/);
    assert.match(backupSource, /types: BACKUP_QUERY_TYPES/);
});

test('large backup JSON is bypassed by the default parser and parsed only after API auth', () => {
    const serverSource = read('server.js');

    assert.match(serverSource, /BACKUP_RESTORE_JSON_LIMIT = '50mb'/);
    assert.match(serverSource, /'\/api\/backup\/restore-encrypted'/);
    assertInOrder(serverSource, [
        /BACKUP_RESTORE_JSON_PATHS\.has\(req\.path\)/,
        /app\.use\(apiVersionRewrite\)/,
        /app\.use\('\/api', apiAuthBoundary\(authenticateToken\)\)/,
        /express\.json\(\{ limit: BACKUP_RESTORE_JSON_LIMIT \}\)/,
        /app\.use\('\/api', businessScopeWriteGuard\)/
    ], 'authenticated large backup parser');
    assert.doesNotMatch(serverSource, /app\.use\('\/api\/backup\/restore', express\.json/);
});
