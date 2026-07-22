'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const migrationPath = path.join(repoRoot, 'db', 'migrations', '301_banquet_menu_minimum_price_rules.sql');
const routePath = path.join(repoRoot, 'routes', 'bookings.js');

const {
    BANQUET_MENU_PRICE_RULE_CODES,
    buildBanquetPreorderRuleContract,
    loadBanquetPreorderRuleContract,
    sanitizeBanquetPreorderRuleContract
} = require('../services/banquetPreorderRules');
const {
    buildMinimumSnapshot,
    normalizeBanquetMenuWorkflow
} = require('../services/banquetMenuWorkflow');
const {
    applyBookingPackage,
    applyBookingPackageEntryCharge
} = require('../services/bookingPackage');

test('migration seeds menu minimum price_rules without overwriting existing rows', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /MIGRATION_KIND:\s*seed/);
    assert.match(sql, /SAFETY:/);
    assert.match(sql, /ROLLBACK:/);
    assert.match(sql, /DATA_SCOPE:/);
    assert.match(sql, /INSERT INTO price_rules/i);
    assert.match(sql, /banquet_menu_minimum_room/);
    assert.match(sql, /banquet_menu_minimum_table/);
    assert.match(sql, /banquet_recommended_deposit/);
    assert.match(sql, /ON CONFLICT \(code\) DO NOTHING/i);
    const executableSql = sql
        .split(/\r?\n/)
        .filter(line => !line.trim().startsWith('--'))
        .join('\n');
    assert.doesNotMatch(executableSql, /\bUPDATE\b/i);
    assert.doesNotMatch(executableSql, /\bDELETE\b/i);
    assert.doesNotMatch(executableSql, /\bALTER\b/i);
});

test('banquet preorder rule contract resolves room, table, and deposit from price_rules', async () => {
    const queryable = {
        async query(sql, params) {
            assert.match(sql, /FROM price_rules/);
            assert.deepEqual(params, [[
                BANQUET_MENU_PRICE_RULE_CODES.room,
                BANQUET_MENU_PRICE_RULE_CODES.table,
                BANQUET_MENU_PRICE_RULE_CODES.recommendedDeposit
            ]]);
            return {
                rows: [
                    { code: BANQUET_MENU_PRICE_RULE_CODES.room, value: 4100 },
                    { code: BANQUET_MENU_PRICE_RULE_CODES.table, value: '2600' },
                    { code: BANQUET_MENU_PRICE_RULE_CODES.recommendedDeposit, value: 2100 }
                ]
            };
        }
    };

    const contract = await loadBanquetPreorderRuleContract(queryable);
    assert.equal(contract.menuMinimums.room.requiredMenuMinimum, 4100);
    assert.equal(contract.menuMinimums.table.requiredMenuMinimum, 2600);
    assert.equal(contract.recommendedDeposit.amount, 2100);
});

test('menuWorkflow captures rule snapshot and ignores client audit fields', () => {
    const contract = buildBanquetPreorderRuleContract([
        { code: BANQUET_MENU_PRICE_RULE_CODES.room, value: 4500 },
        { code: BANQUET_MENU_PRICE_RULE_CODES.recommendedDeposit, value: 2200 }
    ]);
    const workflow = normalizeBanquetMenuWorkflow({
        booking: {
            category: 'kitchen',
            room: 'Кімнатка 1',
            menuWorkflow: {
                mode: 'actual',
                selectedAt: '2000-01-01T00:00:00.000Z',
                selectedBy: { id: 'forged', username: 'forged' },
                minimumSnapshot: { minimumAmount: 1 }
            }
        },
        ruleContract: contract,
        actor: { id: 7, username: 'manager' },
        now: '2026-07-22T12:00:00.000Z'
    });

    assert.equal(workflow.schemaVersion, 1);
    assert.equal(workflow.mode, 'actual');
    assert.equal(workflow.status, 'awaiting_actual');
    assert.equal(workflow.selectedAt, '2026-07-22T12:00:00.000Z');
    assert.deepEqual(workflow.selectedBy, { id: '7', username: 'manager' });
    assert.equal(workflow.minimumSnapshot.ruleCode, BANQUET_MENU_PRICE_RULE_CODES.room);
    assert.equal(workflow.minimumSnapshot.minimumAmount, 4500);
    assert.equal(workflow.minimumSnapshot.recommendedDepositAmount, 2200);
});

test('existing menuWorkflow snapshot remains stable when rules change', () => {
    const previousWorkflow = {
        mode: 'actual',
        status: 'awaiting_actual',
        selectedAt: '2026-07-20T09:00:00.000Z',
        selectedBy: { id: '5', username: 'old-manager' },
        minimumSnapshot: {
            schemaVersion: 1,
            source: 'price_rules',
            capturedAt: '2026-07-20T09:00:00.000Z',
            placeType: 'table',
            ruleCode: BANQUET_MENU_PRICE_RULE_CODES.table,
            minimumAmount: 2500,
            recommendedDepositRuleCode: BANQUET_MENU_PRICE_RULE_CODES.recommendedDeposit,
            recommendedDepositAmount: 2000,
            currency: 'UAH'
        },
        creatorException: { reason: 'approved_by_owner' }
    };
    const contract = buildBanquetPreorderRuleContract([
        { code: BANQUET_MENU_PRICE_RULE_CODES.table, value: 3000 },
        { code: BANQUET_MENU_PRICE_RULE_CODES.recommendedDeposit, value: 2500 }
    ]);

    const workflow = normalizeBanquetMenuWorkflow({
        booking: { category: 'kitchen', room: 'столик біля бару' },
        previousWorkflow,
        ruleContract: contract,
        actor: { id: 9, username: 'new-manager' },
        now: '2026-07-22T12:00:00.000Z'
    });

    assert.equal(workflow.selectedAt, previousWorkflow.selectedAt);
    assert.deepEqual(workflow.selectedBy, previousWorkflow.selectedBy);
    assert.equal(workflow.minimumSnapshot.minimumAmount, 2500);
    assert.deepEqual(workflow.creatorException, previousWorkflow.creatorException);
});

test('menuWorkflow validates modes and keeps finalization for a dedicated endpoint', () => {
    assert.equal(normalizeBanquetMenuWorkflow({ booking: {} }), null);
    assert.throws(
        () => normalizeBanquetMenuWorkflow({ booking: { menuWorkflow: { mode: 'later' } } }),
        /Invalid banquet menu workflow mode/
    );
    assert.throws(
        () => normalizeBanquetMenuWorkflow({ booking: { menuWorkflow: { mode: 'actual', status: 'done' } } }),
        /Invalid actual menu workflow status/
    );
    assert.throws(
        () => normalizeBanquetMenuWorkflow({ booking: { menuWorkflow: { mode: 'actual', status: 'finalized' } } }),
        /canonical finalization endpoint/
    );
});

test('applyBookingPackage stores menuWorkflow without flooring booking finance total', () => {
    const booking = {
        category: 'kitchen',
        room: 'столик 4',
        price: 1900,
        menuPositions: [
            { id: 'tea', title: 'Чай', quantity: 1, unitPrice: 900, subtotal: 900 },
            { id: 'cake', title: 'Торт', quantity: 1, unitPrice: 1000, subtotal: 1000 }
        ],
        menuWorkflow: { mode: 'actual' }
    };

    applyBookingPackage(booking, {
        banquetPreorderRuleContract: buildBanquetPreorderRuleContract([
            { code: BANQUET_MENU_PRICE_RULE_CODES.table, value: 2500 },
            { code: BANQUET_MENU_PRICE_RULE_CODES.recommendedDeposit, value: 2000 }
        ]),
        actor: { id: 10, username: 'manager' },
        now: '2026-07-22T12:00:00.000Z'
    });

    assert.equal(booking.price, 1900);
    assert.equal(booking.extraData.bookingPackage.finalTotal, 1900);
    assert.equal(booking.extraData.bookingPackage.menuWorkflow.mode, 'actual');
    assert.equal(booking.extraData.bookingPackage.menuWorkflow.minimumSnapshot.minimumAmount, 2500);
    assert.equal(booking.extraData.bookingPackage.banquetPreorderStatus.menuStatus, 'below_minimum');
});
test('applyBookingPackageEntryCharge loads canonical menu rule contract for package rebuilds', async () => {
    const booking = {
        category: 'kitchen',
        room: 'столик 8',
        price: 1900,
        menuPositions: [
            { id: 'tea', title: 'Чай', quantity: 1, unitPrice: 1900, subtotal: 1900 }
        ],
        menuWorkflow: { mode: 'actual' }
    };
    const queryable = {
        async query(sql, params) {
            assert.match(sql, /FROM price_rules/);
            assert.deepEqual(params, [[
                BANQUET_MENU_PRICE_RULE_CODES.room,
                BANQUET_MENU_PRICE_RULE_CODES.table,
                BANQUET_MENU_PRICE_RULE_CODES.recommendedDeposit
            ]]);
            return {
                rows: [
                    { code: BANQUET_MENU_PRICE_RULE_CODES.table, value: 2800 },
                    { code: BANQUET_MENU_PRICE_RULE_CODES.recommendedDeposit, value: 2300 }
                ]
            };
        }
    };

    await applyBookingPackageEntryCharge(queryable, booking, {
        priceRules: [],
        actor: { id: 11, username: 'manager' },
        now: '2026-07-22T12:00:00.000Z'
    });

    assert.equal(booking.price, 1900);
    assert.equal(booking.extraData.bookingPackage.menuWorkflow.minimumSnapshot.minimumAmount, 2800);
    assert.equal(booking.extraData.bookingPackage.banquetPreorderStatus.requiredMenuMinimum, 2800);
    assert.equal(booking.extraData.bookingPackage.banquetPreorderStatus.recommendedDepositAmount, 2300);
});

test('banquet menu rules route is authenticated canonical read endpoint before dynamic booking routes', () => {
    const source = fs.readFileSync(routePath, 'utf8');
    const endpointIndex = source.indexOf("router.get('/banquet-menu-rules'");
    assert.notEqual(endpointIndex, -1);
    assert.ok(source.indexOf('router.use(authenticateToken)') < endpointIndex);
    assert.ok(endpointIndex < source.indexOf("router.get('/detail/:id'"));
    assert.match(source.slice(endpointIndex, endpointIndex + 900), /requireTimelineContext\(req, res, businessContext\)/);
    assert.match(source.slice(endpointIndex, endpointIndex + 900), /requireTimelineAction\(req, res, businessContext, 'view'\)/);
    assert.match(source.slice(endpointIndex, endpointIndex + 900), /loadBanquetPreorderRuleContract\(pool\)/);
    assert.match(source.slice(endpointIndex, endpointIndex + 900), /sanitizeBanquetPreorderRuleContract\(contract\)/);
});

test('sanitized rule contract exposes stable numeric fields only', () => {
    const sanitized = sanitizeBanquetPreorderRuleContract(buildBanquetPreorderRuleContract([
        { code: BANQUET_MENU_PRICE_RULE_CODES.room, value: 4000 },
        { code: BANQUET_MENU_PRICE_RULE_CODES.table, value: 2500 },
        { code: BANQUET_MENU_PRICE_RULE_CODES.recommendedDeposit, value: 2000 }
    ]));
    assert.deepEqual(Object.keys(sanitized.menuMinimums).sort(), ['room', 'table']);
    assert.equal(sanitized.menuMinimums.room.requiredMenuMinimum, 4000);
    assert.equal(sanitized.menuMinimums.table.requiredMenuMinimum, 2500);
    assert.equal(sanitized.recommendedDeposit.amount, 2000);
});

test('buildMinimumSnapshot captures unknown place type without blocking workflow', () => {
    const snapshot = buildMinimumSnapshot({ booking: { category: 'kitchen', room: 'VIP zone' } });
    assert.equal(snapshot.placeType, null);
    assert.equal(snapshot.minimumAmount, null);
    assert.equal(snapshot.recommendedDepositAmount, 2000);
});