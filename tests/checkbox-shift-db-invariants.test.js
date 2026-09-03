const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    buildMutationPlan,
    assertRecoveryActorAuthorized
} = require('../scripts/checkbox-outbox-recovery');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function normalizeSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function extractParenthesizedAfter(source, anchor) {
    const anchorIndex = source.indexOf(anchor);
    assert.notEqual(anchorIndex, -1, `missing SQL anchor: ${anchor}`);
    const openIndex = source.indexOf('(', anchorIndex + anchor.length);
    assert.notEqual(openIndex, -1, `missing opening parenthesis after: ${anchor}`);
    let depth = 0;
    for (let index = openIndex; index < source.length; index += 1) {
        if (source[index] === '(') depth += 1;
        if (source[index] !== ')') continue;
        depth -= 1;
        if (depth === 0) return source.slice(openIndex + 1, index);
    }
    assert.fail(`missing closing parenthesis after: ${anchor}`);
}

function tokenizeSqlPredicate(predicate) {
    const source = normalizeSql(predicate);
    const pattern = /\s*(?:(AND|OR|NOT|IN|IS|NULL)\b|([A-Za-z_][A-Za-z0-9_]*)|('(?:''|[^'])*')|([(),=]))/gy;
    const tokens = [];
    let cursor = 0;
    while (cursor < source.length) {
        pattern.lastIndex = cursor;
        const match = pattern.exec(source);
        assert.ok(match, `unsupported SQL predicate near: ${source.slice(cursor, cursor + 40)}`);
        cursor = pattern.lastIndex;
        if (match[1]) tokens.push({ type: 'keyword', value: match[1] });
        else if (match[2]) tokens.push({ type: 'identifier', value: match[2] });
        else if (match[3]) tokens.push({ type: 'string', value: match[3].slice(1, -1).replace(/''/g, "'") });
        else tokens.push({ type: 'symbol', value: match[4] });
    }
    return tokens;
}

function evaluateSqlPredicate(predicate, row) {
    const tokens = tokenizeSqlPredicate(predicate);
    let cursor = 0;
    const peek = () => tokens[cursor] || null;
    const accept = value => {
        if (peek()?.value !== value) return false;
        cursor += 1;
        return true;
    };
    const consume = value => {
        const token = tokens[cursor];
        assert.ok(token, `expected ${value || 'token'} at end of SQL predicate`);
        if (value) assert.equal(token.value, value);
        cursor += 1;
        return token;
    };
    const parseComparison = () => {
        const column = consume();
        assert.equal(column.type, 'identifier');
        assert.ok(Object.prototype.hasOwnProperty.call(row, column.value), `unexpected SQL column: ${column.value}`);
        const actual = row[column.value];
        if (accept('=')) {
            const expected = consume();
            assert.equal(expected.type, 'string');
            return actual === expected.value;
        }
        if (accept('IN')) {
            consume('(');
            const expected = [];
            do {
                const value = consume();
                assert.equal(value.type, 'string');
                expected.push(value.value);
            } while (accept(','));
            consume(')');
            return expected.includes(actual);
        }
        consume('IS');
        consume('NOT');
        consume('NULL');
        return actual !== null;
    };
    const parsePrimary = () => {
        if (!accept('(')) return parseComparison();
        const value = parseOr();
        consume(')');
        return value;
    };
    const parseNot = () => accept('NOT') ? !parseNot() : parsePrimary();
    const parseAnd = () => {
        let value = parseNot();
        while (accept('AND')) {
            const right = parseNot();
            value = value && right;
        }
        return value;
    };
    function parseOr() {
        let value = parseAnd();
        while (accept('OR')) {
            const right = parseAnd();
            value = value || right;
        }
        return value;
    }
    const result = parseOr();
    assert.equal(cursor, tokens.length, `unexpected trailing SQL token: ${peek()?.value}`);
    return result;
}

test('migration 343 fails closed on legacy shift operation conflicts before installing invariants', () => {
    const sql = read('db/migrations/343_checkbox_shift_operation_invariants.sql');

    assert.match(sql, /MIGRATION_KIND:\s*schema/);
    assert.match(sql, /SAFETY:\s*Non-destructive fail-closed Checkbox ledger hardening only/);
    assert.match(sql, /does not backfill or rewrite fiscal data/i);
    assert.match(sql, /LOCK TABLE fiscal_shifts, fiscal_operations, checkbox_readiness_snapshots IN SHARE ROW EXCLUSIVE MODE/);
    assert.match(sql, /operation_type IN \('shift_open', 'shift_close'\)[\s\S]*fiscal_shift_id IS NULL/);
    assert.match(sql, /GROUP BY fiscal_profile_id, fiscal_shift_id, operation_type[\s\S]*HAVING COUNT\(\*\) > 1/);
    assert.match(sql, /invalid fiscal shift open_operation_id exists/);
    assert.match(sql, /invalid fiscal shift close_operation_id exists/);
    assert.match(sql, /duplicate unresolved fiscal shift lifecycle exists for register/);
    assert.match(sql, /FROM fiscal_shifts\s+WHERE NOT \(\s*\(/);
    assert.match(sql, /legacy fiscal shift status\/lifecycle mismatch requires audited reconciliation/);
    assert.match(sql, /chk_fiscal_shifts_status_lifecycle_v343/);
    assert.match(sql, /status IN \('unknown', 'failed', 'blocked'\)[\s\S]*lifecycle_stage IN \('CREATED', 'OPENING', 'OPENED', 'CLOSING'\)/);
    assert.match(sql, /lifecycle_stage IN \('CREATED', 'OPENING'\)[\s\S]*OR provider_shift_id IS NOT NULL/);
});

test('migration 343 and release preflight share the exact inverse of the exhaustive shift lifecycle constraint', () => {
    const migration = read('db/migrations/343_checkbox_shift_operation_invariants.sql');
    const preflight = read('scripts/checkbox-release-db-preflight.js');
    const migrationPrecondition = extractParenthesizedAfter(migration, 'WHERE NOT');
    const migrationConstraint = extractParenthesizedAfter(
        migration,
        'ADD CONSTRAINT chk_fiscal_shifts_status_lifecycle_v343'
    );
    const preflightPrecondition = extractParenthesizedAfter(preflight, 'WHERE NOT');

    assert.match(migration, /FROM fiscal_shifts\s+WHERE NOT \(/);
    assert.match(preflight, /FROM fiscal_shifts\s+WHERE NOT \(/);
    assert.equal(normalizeSql(migrationPrecondition), normalizeSql(migrationConstraint));
    assert.equal(normalizeSql(preflightPrecondition), normalizeSql(migrationConstraint));

    const statuses = ['unknown', 'opening', 'open', 'closing', 'closed', 'failed', 'blocked'];
    const lifecycleStages = ['CREATED', 'OPENING', 'OPENED', 'CLOSING', 'CLOSED'];
    const providerShiftIds = [null, 'provider-shift-id'];
    const allowedStages = {
        unknown: ['CREATED', 'OPENING', 'OPENED', 'CLOSING'],
        opening: ['CREATED', 'OPENING'],
        open: ['OPENED'],
        closing: ['CLOSING'],
        closed: ['CLOSED'],
        failed: ['CREATED', 'OPENING', 'OPENED', 'CLOSING'],
        blocked: ['CREATED', 'OPENING', 'OPENED', 'CLOSING']
    };
    const providerRequiredStages = new Set(['OPENED', 'CLOSING', 'CLOSED']);
    const predicates = [migrationConstraint, migrationPrecondition, preflightPrecondition];
    let validCombinations = 0;
    let invalidCombinations = 0;

    for (const status of statuses) {
        for (const lifecycleStage of lifecycleStages) {
            for (const providerShiftId of providerShiftIds) {
                const row = {
                    status,
                    lifecycle_stage: lifecycleStage,
                    provider_shift_id: providerShiftId
                };
                const expected = allowedStages[status].includes(lifecycleStage)
                    && (!providerRequiredStages.has(lifecycleStage) || providerShiftId !== null);
                for (const predicate of predicates) {
                    assert.equal(
                        evaluateSqlPredicate(predicate, row),
                        expected,
                        `${status}/${lifecycleStage}/${providerShiftId === null ? 'missing-provider-id' : 'provider-id'}`
                    );
                }
                if (expected) validCombinations += 1;
                else invalidCombinations += 1;
            }
        }
    }

    assert.equal(validCombinations, 25);
    assert.equal(invalidCombinations, 45);
    for (const status of ['unknown', 'failed', 'blocked']) {
        for (const providerShiftId of providerShiftIds) {
            assert.equal(evaluateSqlPredicate(migrationConstraint, {
                status,
                lifecycle_stage: 'CLOSED',
                provider_shift_id: providerShiftId
            }), false, `${status}/CLOSED must be rejected regardless of provider shift identity`);
        }
    }
});

test('migration 343 persists every fail-closed runtime readiness shift state', () => {
    const sql = read('db/migrations/343_checkbox_shift_operation_invariants.sql');

    assert.match(sql, /DROP CONSTRAINT IF EXISTS chk_checkbox_readiness_shift_state_v324/);
    assert.match(sql, /ADD CONSTRAINT chk_checkbox_readiness_shift_state_v343/);
    for (const shiftState of [
        'closed',
        'opening',
        'open',
        'closing',
        'unknown',
        'local_stale',
        'external_open'
    ]) {
        assert.match(sql, new RegExp(`'${shiftState}'`));
    }
});

test('migration and runtime retain failed or dead shift-open lifecycle as the one durable register shift', () => {
    const sql = read('db/migrations/343_checkbox_shift_operation_invariants.sql');
    const cashierOperations = read('services/payments/cashierOperationsService.js');
    const readiness = read('services/payments/paymentReadinessService.js');

    assert.match(sql, /uq_fiscal_shifts_one_unresolved_lifecycle_per_register_v343[\s\S]*ON fiscal_shifts \(fiscal_profile_id, fiscal_register_id\)[\s\S]*lifecycle_stage IN \('CREATED', 'OPENING', 'OPENED', 'CLOSING'\)/);
    assert.match(cashierOperations, /UNRESOLVED_SHIFT_LIFECYCLE_STAGES = Object\.freeze\(\['CREATED', 'OPENING', 'OPENED', 'CLOSING'\]\)/);
    assert.match(cashierOperations, /fs\.status = ANY\(\$3::text\[\]\)[\s\S]*OR fs\.lifecycle_stage = ANY\(\$4::text\[\]\)/);
    assert.match(cashierOperations, /\['CREATED', 'OPENING'\]\.includes\(lifecycleStage\)[\s\S]*\['queued', 'claimed', 'running'\]\.includes\(openJobStatus\)/);
    assert.match(cashierOperations, /shift_open_recovery_required/);
    assert.match(cashierOperations, /lifecycleStage === 'CLOSING' \? 'shift_closing'/);
    const localShiftLoader = readiness.slice(
        readiness.indexOf('async function loadLatestLocalShift'),
        readiness.indexOf('function localShiftState')
    );
    assert.match(localShiftLoader, /shift\.status IN \('opening', 'open', 'closing'\)[\s\S]*OR shift\.lifecycle_stage IN \('CREATED', 'OPENING', 'OPENED', 'CLOSING'\)/);
    assert.match(localShiftLoader, /LIMIT 2/);
    assert.match(localShiftLoader, /local_shift_ambiguous/);
});

test('migration 343 permits at most one open and close operation per shift forever', () => {
    const sql = read('db/migrations/343_checkbox_shift_operation_invariants.sql');

    assert.match(sql, /uq_fiscal_operations_one_shift_open_per_shift_forever_v343[\s\S]*ON fiscal_operations \(fiscal_profile_id, fiscal_shift_id\)[\s\S]*operation_type = 'shift_open'/);
    assert.match(sql, /uq_fiscal_operations_one_shift_close_per_shift_forever_v343[\s\S]*ON fiscal_operations \(fiscal_profile_id, fiscal_shift_id\)[\s\S]*operation_type = 'shift_close'/);
    assert.doesNotMatch(sql, /uq_fiscal_operations_one_shift_(?:open|close)_per_shift_forever_v343[\s\S]{0,240}status\s*(?:=|IN)/);
    assert.match(sql, /chk_fiscal_operations_shift_operation_link_v343/);
});

test('migration 343 validates exact operation profile register and shift scope', () => {
    const sql = read('db/migrations/343_checkbox_shift_operation_invariants.sql');

    assert.match(sql, /enforce_fiscal_shift_operation_scope_v343/);
    assert.match(sql, /shift\.id = NEW\.fiscal_shift_id/);
    assert.match(sql, /shift\.fiscal_profile_id = NEW\.fiscal_profile_id/);
    assert.match(sql, /shift\.fiscal_register_id = NEW\.fiscal_register_id/);
    assert.match(sql, /OLD\.operation_type IN \('shift_open', 'shift_close'\)[\s\S]*NEW\.operation_type IS DISTINCT FROM OLD\.operation_type/);
    assert.match(sql, /shift_open\/shift_close operation type and shift scope are immutable/);
    assert.match(sql, /BEFORE INSERT[\s\S]*ON fiscal_operations/);
    assert.match(sql, /BEFORE UPDATE OF fiscal_shift_id, fiscal_profile_id, fiscal_register_id, operation_type/);
});

test('migration 343 makes shift operation pointers semantic and fill-only', () => {
    const sql = read('db/migrations/343_checkbox_shift_operation_invariants.sql');

    assert.match(sql, /prevent_fiscal_shift_operation_link_drift_v343/);
    assert.match(sql, /OLD\.open_operation_id IS NOT NULL[\s\S]*NEW\.open_operation_id IS DISTINCT FROM OLD\.open_operation_id/);
    assert.match(sql, /OLD\.close_operation_id IS NOT NULL[\s\S]*NEW\.close_operation_id IS DISTINCT FROM OLD\.close_operation_id/);
    assert.match(sql, /NEW\.fiscal_profile_id IS DISTINCT FROM OLD\.fiscal_profile_id[\s\S]*NEW\.fiscal_register_id IS DISTINCT FROM OLD\.fiscal_register_id/);
    assert.match(sql, /fiscal shift profile and register scope are immutable/);
    assert.match(sql, /operation\.id = NEW\.open_operation_id[\s\S]*operation\.fiscal_shift_id = NEW\.id[\s\S]*operation\.operation_type = 'shift_open'/);
    assert.match(sql, /operation\.id = NEW\.close_operation_id[\s\S]*operation\.fiscal_shift_id = NEW\.id[\s\S]*operation\.operation_type = 'shift_close'/);
    assert.match(sql, /TG_OP = 'UPDATE'/);
    assert.match(sql, /trg_fiscal_shift_operation_link_insert_v343[\s\S]*BEFORE INSERT[\s\S]*ON fiscal_shifts/);
    assert.match(sql, /BEFORE UPDATE OF fiscal_profile_id, fiscal_register_id, open_operation_id, close_operation_id/);
});

test('runtime writers retain transaction serialization around shift open and both close paths', () => {
    const cashierOperations = read('services/payments/cashierOperationsService.js');
    const readiness = read('services/payments/paymentReadinessService.js');

    assert.match(cashierOperations, /pg_advisory_xact_lock\(\$1, \$2\)/);
    assert.match(cashierOperations, /INSERT INTO fiscal_operations \([\s\S]*'shift_open', 'pending'/);
    assert.match(cashierOperations, /SET open_operation_id = \$2/);

    const proClose = cashierOperations.slice(
        cashierOperations.indexOf('async function closeShift'),
        cashierOperations.indexOf('async function autoCloseShift')
    );
    assert.match(proClose, /loadShiftForUserAction/);
    assert.match(proClose, /'shift_close'/);
    assert.match(proClose, /close_operation_id = \$3/);

    const phaseOneClose = readiness.slice(
        readiness.indexOf('async function requestPhase1ShiftClose'),
        readiness.indexOf('async function runCheckboxReadinessProbeScheduler')
    );
    const phaseOneCloseLock = readiness.slice(
        readiness.indexOf('async function lockAndAuthorizePhase1CloseShift'),
        readiness.indexOf('function phase1CloseOperationIdempotencyKey')
    );
    assert.match(phaseOneClose, /lockAndAuthorizePhase1CloseShift/);
    assert.match(phaseOneCloseLock, /SELECT pg_advisory_xact_lock\(\$1, \$2\)/);
    assert.ok(phaseOneCloseLock.indexOf('lock: false') < phaseOneCloseLock.indexOf('SELECT pg_advisory_xact_lock'));
    assert.ok(phaseOneCloseLock.indexOf('SELECT pg_advisory_xact_lock') < phaseOneCloseLock.indexOf('lock: true'));
    assert.match(phaseOneClose, /'shift_close'/);
    assert.match(phaseOneClose, /close_operation_id = \$2/);
});

test('Phase-1 close blocker query covers every unresolved financial operation, refund and outbox state', () => {
    const blockers = read('services/payments/shiftCloseBlockers.js');

    assert.match(blockers, /po\.payment_status = 'confirmed'[\s\S]*po\.fiscal_status <> 'fiscalized'/);
    assert.match(blockers, /blocking_refunds[\s\S]*money_refund_status[\s\S]*fiscal_refund_status/);
    for (const operationType of ['receipt_return', 'service_receipt', 'shift_open', 'shift_close']) {
        assert.match(blockers, new RegExp(`'${operationType}'`));
    }
    for (const status of ['validation_failed', 'failed', 'unknown', 'blocked', 'dead']) {
        assert.match(blockers, new RegExp(`'${status}'`));
    }
    assert.match(blockers, /LEFT JOIN payment_orders payment_order/);
    assert.match(blockers, /LEFT JOIN payment_refunds refund/);
    assert.match(blockers, /COALESCE\(refund\.fiscal_register_id, refund_order\.fiscal_register_id\) = \$2/);
    assert.match(blockers, /operation\.id IS NULL[\s\S]*payment_order\.id IS NULL[\s\S]*refund\.id IS NULL/);
    assert.doesNotMatch(blockers, /LIMIT\s+100/i);
});

test('recovery CLI rejects shift lookup-only and non-canonical shift lifecycles before DB mutation', () => {
    const shiftOpen = {
        job_type: 'shift_open',
        operation_type: 'shift_open',
        shift_id: 12,
        shift_status: 'failed',
        shift_lifecycle_stage: 'OPENING',
        operation_external_stage: 'shift_lookup',
        operation_status: 'unknown',
        fiscal_status: null,
        provider_operation_id: 'durable-shift-uuid'
    };
    assert.deepEqual(buildMutationPlan(shiftOpen, 'requeue-pre-sell'), {
        targetStage: 'shift_lookup',
        operationStatus: 'pending',
        action: 'requeue_pre_sell'
    });
    assert.throws(
        () => buildMutationPlan(shiftOpen, 'lookup-only'),
        /lookup-only is receipt-only/
    );
    assert.throws(
        () => buildMutationPlan({ ...shiftOpen, shift_lifecycle_stage: 'OPENED' }, 'requeue-pre-sell'),
        /requires CREATED\/OPENING lifecycle/
    );
    assert.throws(
        () => buildMutationPlan({ ...shiftOpen, job_type: 'receipt_status_lookup' }, 'requeue-pre-sell'),
        /matching shift_open operation and job types/
    );

    const shiftClose = {
        ...shiftOpen,
        job_type: 'shift_close',
        operation_type: 'shift_close',
        shift_status: 'failed',
        shift_lifecycle_stage: 'CLOSING',
        operation_external_stage: 'shift_close_lookup',
        provider_shift_id: 'durable-provider-shift-id'
    };
    assert.deepEqual(buildMutationPlan(shiftClose, 'requeue-pre-sell'), {
        targetStage: 'shift_close_lookup',
        operationStatus: 'pending',
        action: 'requeue_pre_sell'
    });
    assert.throws(
        () => buildMutationPlan({ ...shiftClose, provider_shift_id: null }, 'requeue-pre-sell'),
        /shift_close recovery stage is invalid/
    );
});

test('recovery CLI treats any durable post-submit evidence as receipt lookup-only', () => {
    const conflictingSale = {
        job_type: 'receipt_sell',
        operation_type: 'sale',
        job_external_stage: 'auth',
        operation_external_stage: 'auth',
        payload: { external_stage: 'sale_submit' },
        request_snapshot: { external_stage: 'receipt_validation' },
        provider_operation_id: 'durable-receipt-uuid',
        operation_status: 'unknown',
        fiscal_status: 'pending'
    };

    assert.throws(
        () => buildMutationPlan(conflictingSale, 'requeue-pre-sell'),
        /allowed only before sale submit/
    );
    assert.deepEqual(buildMutationPlan(conflictingSale, 'lookup-only'), {
        targetStage: 'receipt_lookup',
        operationStatus: 'unknown',
        action: 'force_lookup_only'
    });

    const conflictingShift = {
        job_type: 'shift_open',
        operation_type: 'shift_open',
        job_external_stage: 'auth',
        operation_external_stage: 'shift_request_maybe_submitted',
        payload: { external_stage: 'auth' },
        request_snapshot: { external_stage: 'auth' },
        shift_id: 12,
        shift_status: 'failed',
        shift_lifecycle_stage: 'OPENING',
        operation_status: 'unknown',
        fiscal_status: null,
        provider_operation_id: 'durable-shift-uuid'
    };
    assert.equal(buildMutationPlan(conflictingShift, 'requeue-pre-sell').targetStage, 'shift_lookup');

    const serviceReceipt = {
        job_type: 'service_receipt',
        operation_type: 'service_out',
        job_external_stage: 'service_submit',
        operation_external_stage: 'service_submit',
        payload: { external_stage: 'service_submit' },
        request_snapshot: { external_stage: 'auth' },
        provider_operation_id: 'durable-service-uuid',
        operation_status: 'unknown',
        fiscal_status: null
    };
    assert.deepEqual(buildMutationPlan(serviceReceipt, 'lookup-only'), {
        targetStage: 'service_lookup',
        operationStatus: 'unknown',
        action: 'force_service_lookup_only'
    });
    assert.throws(
        () => buildMutationPlan(serviceReceipt, 'requeue-pre-sell'),
        /allowed only before sale submit/
    );

    const returnReceipt = {
        ...serviceReceipt,
        job_type: 'receipt_return',
        operation_type: 'return',
        job_external_stage: 'return_submit',
        operation_external_stage: 'return_submit',
        payload: { external_stage: 'return_submit' },
        provider_operation_id: 'durable-return-uuid'
    };
    assert.deepEqual(buildMutationPlan(returnReceipt, 'lookup-only'), {
        targetStage: 'return_lookup',
        operationStatus: 'unknown',
        action: 'force_return_lookup_only'
    });
    assert.throws(
        () => buildMutationPlan(returnReceipt, 'requeue-pre-sell'),
        /allowed only before sale submit/
    );

    assert.deepEqual(buildMutationPlan({
        ...returnReceipt,
        job_external_stage: 'readiness',
        operation_external_stage: 'readiness',
        payload: { external_stage: 'readiness' },
        operation_status: 'failed'
    }, 'requeue-pre-sell'), {
        targetStage: 'readiness',
        operationStatus: 'pending',
        action: 'requeue_pre_return_submit'
    });
});

test('recovery mutation restores canonical shift close and checks every scoped update', () => {
    const recovery = read('scripts/checkbox-outbox-recovery.js');
    assert.match(recovery, /AND fiscal_operation_id = \$4[\s\S]*RETURNING id/);
    assert.match(recovery, /Recovery could not update the exact scoped fiscal operation/);
    assert.match(recovery, /Recovery could not update the exact scoped outbox job/);
    assert.match(recovery, /SET status = 'closing',[\s\S]*lifecycle_stage = 'CLOSING'/);
    assert.match(recovery, /AND close_operation_id = \$4[\s\S]*AND provider_shift_id = \$5/);
    assert.match(recovery, /Shift-close recovery could not restore the exact canonical shift lifecycle/);
});

test('recovery CLI requires active exact incident-manager binding and integration owner', async () => {
    const row = { fiscal_profile_id: 4, fiscal_register_id: 7 };
    const authorized = {
        id: 9,
        role: 'creator',
        extra_roles: [],
        action_allowlist: [],
        action_denylist: [],
        is_active: true,
        capability_scope: ['fiscal.incident.manage'],
        register_metadata: { integration_owner: 9 }
    };
    const client = { query: async () => ({ rows: [authorized] }) };
    assert.equal((await assertRecoveryActorAuthorized(client, row, 9)).id, 9);
    await assert.rejects(
        assertRecoveryActorAuthorized({ query: async () => ({ rows: [{ ...authorized, register_metadata: { integration_owner: 10 } }] }) }, row, 9),
        /exact fiscal register integration owner/
    );
    await assert.rejects(
        assertRecoveryActorAuthorized({ query: async () => ({ rows: [{ ...authorized, capability_scope: [] }] }) }, row, 9),
        /binding does not allow/
    );
    await assert.rejects(
        assertRecoveryActorAuthorized({ query: async () => ({ rows: [{ ...authorized, is_active: false }] }) }, row, 9),
        /not active/
    );
});
