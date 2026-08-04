/**
 * Real PostgreSQL smoke for the Checkbox park cashier pilot.
 *
 * Run only through:
 *   npm run test:integration:checkbox-park-cashier-smoke:isolated
 */
'use strict';

const crypto = require('node:crypto');
const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { pool } = require('../../db');
const {
    createAdmissionTicketPaymentOrder,
    confirmPaymentOrder
} = require('../../services/payments/paymentService');
const {
    createServiceIn,
    createServiceOutRequest,
    approveServiceOut,
    createReconciliationRevision,
    closeShift,
    createFullRefund,
    getOperationalReport
} = require('../../services/payments/cashierOperationsService');
const {
    PaymentOutboxWorkerError,
    processPaymentOutboxJobs
} = require('../../services/payments/paymentOutboxWorker');
const { createActionPinHash } = require('../../services/payments/fiscalApprovals');

const enabled = process.env.RUN_CHECKBOX_PARK_CASHIER_SMOKE_INTEGRATION === 'true';
const CRM_PROFILE_KEY = 'event_genix';
const REGISTER_ALIAS = 'middle';
const FISCAL_ACTIONS = Object.freeze([
    'payments.view',
    'payments.create',
    'payments.confirm_received',
    'fiscal.shift.open',
    'fiscal.shift.close',
    'fiscal.service_in',
    'fiscal.service_out.request',
    'fiscal.service_out.approve',
    'fiscal.refund',
    'fiscal.reconcile',
    'fiscal.audit.view'
]);

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_CHECKBOX_PARK_CASHIER_SMOKE_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(process.env.TEST_DATABASE_URL);
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, {
        ...process.env,
        DATABASE_URL: ''
    });
}

function createUserPayload(row) {
    return {
        id: Number(row.id),
        username: row.username,
        name: row.name,
        role: row.role,
        action_allowlist: FISCAL_ACTIONS,
        actionAllowlist: FISCAL_ACTIONS,
        business_contexts: [CRM_PROFILE_KEY],
        businessContexts: [CRM_PROFILE_KEY],
        default_business_context: CRM_PROFILE_KEY,
        defaultBusinessContext: CRM_PROFILE_KEY
    };
}

async function seedUser({ username, name, role, actionPinHash }) {
    const result = await pool.query(
        `INSERT INTO users (
             username, password_hash, name, role, is_active,
             action_allowlist, business_contexts, default_business_context
         )
         VALUES ($1, $2, $3, $4, true, $5::text[], $6::text[], $7)
         RETURNING id, username, name, role`,
        [
            username,
            `smoke-password-hash-${crypto.randomUUID()}`,
            name,
            role,
            FISCAL_ACTIONS,
            [CRM_PROFILE_KEY],
            CRM_PROFILE_KEY
        ]
    );
    return { user: createUserPayload(result.rows[0]), actionPinHash };
}

async function seedFiscalScope({ cashier, approver }) {
    const profile = await pool.query(
        `INSERT INTO fiscal_profiles (
             crm_profile_key, legal_entity_key, legal_entity_name,
             tax_identifier, provider, provider_organization_id, currency, status, settings
         )
         VALUES ($1, $2, $3, $4, 'checkbox', $5, 'UAH', 'active', $6::jsonb)
         RETURNING *`,
        [
            CRM_PROFILE_KEY,
            `fop_park_smoke_${process.pid}`.toLowerCase(),
            'Checkbox Park Smoke FOP',
            `smoke-tax-${process.pid}`,
            `mock-org-${process.pid}`,
            JSON.stringify({ pilot: true, smoke: true })
        ]
    );
    const location = await pool.query(
        `INSERT INTO fiscal_locations (
             fiscal_profile_id, crm_profile_key, location_alias, display_name,
             provider_outlet_id, address_snapshot, status
         )
         VALUES ($1, $2, 'park', 'Park test location', $3, 'Local smoke address', 'active')
         RETURNING *`,
        [profile.rows[0].id, CRM_PROFILE_KEY, `mock-outlet-${process.pid}`]
    );
    const register = await pool.query(
        `INSERT INTO fiscal_registers (
             fiscal_profile_id, fiscal_location_id, crm_profile_key, register_alias,
             display_name, provider, provider_register_id, status, feature_enabled, metadata
         )
         VALUES ($1, $2, $3, $4, 'Middle cash register smoke', 'checkbox', $5, 'active', true, $6::jsonb)
         RETURNING *`,
        [
            profile.rows[0].id,
            location.rows[0].id,
            CRM_PROFILE_KEY,
            REGISTER_ALIAS,
            `mock-register-${process.pid}`,
            JSON.stringify({ integration_owner: 'checkbox-park-smoke' })
        ]
    );

    for (const seeded of [cashier, approver]) {
        await pool.query(
            `INSERT INTO fiscal_cashier_bindings (
                 fiscal_profile_id, fiscal_register_id, fiscal_location_id, crm_profile_key,
                 user_id, provider, provider_cashier_id, provider_cashier_login_ref,
                 status, capability_scope, action_pin_hash, action_pin_set_at, action_pin_updated_by_user_id
             )
             VALUES ($1, $2, $3, $4, $5, 'checkbox', $6, $7, 'active', $8::text[], $9, NOW(), $10)`,
            [
                profile.rows[0].id,
                register.rows[0].id,
                location.rows[0].id,
                CRM_PROFILE_KEY,
                seeded.user.id,
                `mock-cashier-${seeded.user.id}`,
                seeded.user.username,
                FISCAL_ACTIONS,
                seeded.actionPinHash,
                approver.user.id
            ]
        );
    }

    return {
        fiscalProfileId: Number(profile.rows[0].id),
        fiscalLocationId: Number(location.rows[0].id),
        fiscalRegisterId: Number(register.rows[0].id)
    };
}

function makeQuote({ fingerprint, totalUah, code, name }) {
    return async () => ({
        legacy: false,
        requiresExplicitConversion: false,
        quoteFingerprint: fingerprint,
        ticketSubtotal: totalUah,
        ticketLines: [{
            ticketTypeCode: code,
            ticketTypeName: name,
            quantity: 1,
            unitPriceUah: totalUah,
            subtotalUah: totalUah,
            tariffVersionId: null
        }]
    });
}

function makeProvider() {
    const receipts = new Map();
    const failedOnce = new Set();
    const failFirstSaleOperations = new Set();
    const calls = {
        sale: 0,
        lookup: 0,
        return: 0,
        service: 0,
        shiftOpen: 0,
        shiftClose: 0
    };

    function receiptFor({ providerOperationId, type, amountMinor }) {
        return {
            id: `mock-${type}-${providerOperationId}`,
            fiscalCode: `FC-${providerOperationId}`.slice(0, 80),
            serial: `SER-${type}`,
            taxUrl: `https://mock.checkbox.local/${type}/${providerOperationId}`,
            pdfUrl: `https://mock.checkbox.local/${type}/${providerOperationId}.pdf`,
            qrUrl: `https://mock.checkbox.local/${type}/${providerOperationId}.qr`,
            status: 'fiscalized',
            totalAmountMinor: String(amountMinor || '0'),
            fiscalizedAt: new Date().toISOString()
        };
    }

    return {
        calls,
        failFirstSaleOperations,
        receipts,
        async lookupReceipt({ providerOperationId }) {
            calls.lookup += 1;
            const receipt = receipts.get(providerOperationId);
            return receipt ? { found: true, receipt } : { found: false };
        },
        async validateSale({ providerOperationId, items }) {
            assert.ok(providerOperationId, 'sale provider operation id is required');
            assert.ok(Array.isArray(items) && items.length === 1, 'sale must include immutable order item snapshot');
        },
        async createSaleReceipt({ providerOperationId, paymentOrder }) {
            calls.sale += 1;
            const receipt = receiptFor({
                providerOperationId,
                type: 'sale',
                amountMinor: paymentOrder.total_amount_minor
            });
            receipts.set(providerOperationId, receipt);
            if (failFirstSaleOperations.has(providerOperationId) && !failedOnce.has(providerOperationId)) {
                failedOnce.add(providerOperationId);
                throw new PaymentOutboxWorkerError(
                    'mock_timeout_after_provider_success',
                    'Mock timeout after provider success',
                    { retryable: true, unknown: true }
                );
            }
            return receipt;
        },
        async createReturnReceipt({ fiscalOperation }) {
            calls.return += 1;
            const receipt = receiptFor({
                providerOperationId: fiscalOperation.provider_operation_id,
                type: 'return',
                amountMinor: fiscalOperation.fiscal_operation_amount_minor
            });
            receipts.set(fiscalOperation.provider_operation_id, receipt);
            return receipt;
        },
        async createServiceReceipt({ fiscalOperation }) {
            calls.service += 1;
            const receipt = receiptFor({
                providerOperationId: fiscalOperation.provider_operation_id,
                type: fiscalOperation.operation_type,
                amountMinor: fiscalOperation.fiscal_operation_amount_minor
            });
            receipts.set(fiscalOperation.provider_operation_id, receipt);
            return receipt;
        },
        async openShift({ fiscalOperation }) {
            calls.shiftOpen += 1;
            return {
                id: `mock-shift-open-${fiscalOperation.provider_operation_id}`,
                status: 'open',
                openedAt: new Date().toISOString()
            };
        },
        async closeShift({ fiscalOperation }) {
            calls.shiftClose += 1;
            return {
                id: `mock-shift-close-${fiscalOperation.provider_operation_id}`,
                status: 'closed',
                closedAt: new Date().toISOString(),
                documentUrl: `https://mock.checkbox.local/z/${fiscalOperation.provider_operation_id}`
            };
        }
    };
}

async function runWorkerUntilIdle(provider, maxRounds = 12) {
    const results = [];
    for (let i = 0; i < maxRounds; i += 1) {
        const batch = await processPaymentOutboxJobs({
            dbPool: pool,
            provider,
            batchSize: 10,
            lockedBy: `checkbox-park-smoke-${process.pid}`,
            lockExpiryMs: 30_000
        });
        results.push(batch);
        if (batch.claimed === 0) break;
    }
    return results;
}

async function forceRetryNow(operationId) {
    await pool.query(
        `UPDATE payment_outbox_jobs
            SET next_run_at = NOW(), status = 'failed', locked_at = NULL, locked_by = NULL
          WHERE fiscal_operation_id = $1
            AND status = 'failed'`,
        [operationId]
    );
}

async function expectErrorCode(promise, code) {
    let caught = null;
    try {
        await promise;
    } catch (error) {
        caught = error;
    }
    assert.ok(caught, `expected ${code}`);
    assert.equal(caught.code, code);
    return caught;
}

describe('Checkbox park cashier smoke on isolated PostgreSQL', {
    skip: !enabled,
    concurrency: 1
}, () => {
    let cashier;
    let approver;
    let scope;
    let actionPin;
    let provider;

    before(async () => {
        requireIsolatedDatabase();
        actionPin = String(crypto.randomInt(100000, 999999));
        const actionPinHash = await createActionPinHash(actionPin);
        cashier = await seedUser({
            username: `cashier_smoke_${process.pid}`,
            name: 'Checkbox smoke cashier',
            role: 'reception',
            actionPinHash
        });
        approver = await seedUser({
            username: `approver_smoke_${process.pid}`,
            name: 'Checkbox smoke approver',
            role: 'director',
            actionPinHash
        });
        scope = await seedFiscalScope({ cashier, approver });
        provider = makeProvider();
    });

    after(async () => {
        await pool.end().catch(() => {});
    });

    test('cash/card sales, unknown recovery, services, reconciliation, close, and full refund converge without duplicate receipts', async () => {
        const cashOrder = await createAdmissionTicketPaymentOrder({
            dbPool: pool,
            user: cashier.user,
            idempotencyKey: `cash-order-${process.pid}`,
            body: {
                tender: 'cash',
                sourceId: `cash-source-${process.pid}`,
                admissionTicket: { smoke: 'cash' }
            },
            quoteResolver: makeQuote({
                fingerprint: `cash-quote-${process.pid}`,
                totalUah: 120,
                code: 'park_child_day_cash',
                name: 'Park child day pass cash smoke'
            })
        });
        assert.equal(cashOrder.order.totalAmountMinor, '12000');

        const confirmedCash = await confirmPaymentOrder({
            dbPool: pool,
            user: cashier.user,
            orderId: cashOrder.order.id,
            idempotencyKey: `cash-confirm-${process.pid}`,
            body: {
                tender: 'cash',
                confirmedAmountMinor: '12000',
                receivedAmountMinor: '15000'
            }
        });
        assert.ok(confirmedCash.fiscalOperationId);

        const firstSaleCount = await pool.query(
            `SELECT COUNT(*)::integer AS count
               FROM fiscal_operations
              WHERE payment_order_id = $1
                AND operation_type = 'sale'`,
            [cashOrder.order.id]
        );
        assert.equal(firstSaleCount.rows[0].count, 1, 'confirmed payment creates exactly one sale fiscal operation');

        const openedAfterCash = await pool.query(
            `SELECT id, status
               FROM fiscal_shifts
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2`,
            [scope.fiscalProfileId, scope.fiscalRegisterId]
        );
        assert.equal(openedAfterCash.rowCount, 1, 'shift auto-opens once before first sale');
        const shiftId = Number(openedAfterCash.rows[0].id);
        assert.equal(openedAfterCash.rows[0].status, 'open');

        await expectErrorCode(
            closeShift({
                user: approver.user,
                shiftId,
                idempotencyKey: `close-pending-${process.pid}`,
                body: { cashActualMinor: '0', terminalReportTotalMinor: '0' }
            }),
            'shift_close_blocked_pending_unknown'
        );

        await runWorkerUntilIdle(provider);
        assert.equal(provider.calls.shiftOpen, 1);
        assert.equal(provider.calls.sale, 1);

        const fiscalizedCash = await pool.query(
            `SELECT fiscal_status
               FROM payment_orders
              WHERE id = $1`,
            [cashOrder.order.id]
        );
        assert.equal(fiscalizedCash.rows[0].fiscal_status, 'fiscalized');

        const originalReceiptBeforeRefund = await pool.query(
            `SELECT *
               FROM fiscal_receipts
              WHERE payment_order_id = $1
                AND receipt_type = 'sale'
              ORDER BY id
              LIMIT 1`,
            [cashOrder.order.id]
        );
        assert.equal(originalReceiptBeforeRefund.rowCount, 1);
        const originalReceiptSnapshot = JSON.stringify(originalReceiptBeforeRefund.rows[0]);

        const cardOrder = await createAdmissionTicketPaymentOrder({
            dbPool: pool,
            user: cashier.user,
            idempotencyKey: `card-order-${process.pid}`,
            body: {
                tender: 'card_terminal_manual',
                sourceId: `card-source-${process.pid}`,
                admissionTicket: { smoke: 'card' }
            },
            quoteResolver: makeQuote({
                fingerprint: `card-quote-${process.pid}`,
                totalUah: 180,
                code: 'park_child_day_card',
                name: 'Park child day pass card smoke'
            })
        });
        const confirmedCard = await confirmPaymentOrder({
            dbPool: pool,
            user: cashier.user,
            orderId: cardOrder.order.id,
            idempotencyKey: `card-confirm-${process.pid}`,
            body: {
                tender: 'card_terminal_manual',
                confirmedAmountMinor: '18000',
                terminalShowedSuccess: true,
                terminalReference: `terminal-ref-${process.pid}`
            }
        });
        provider.failFirstSaleOperations.add(confirmedCard.providerRequestUuid);

        const shiftOpenCount = await pool.query(
            `SELECT COUNT(*)::integer AS count
               FROM fiscal_operations
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND operation_type = 'shift_open'`,
            [scope.fiscalProfileId, scope.fiscalRegisterId]
        );
        assert.equal(shiftOpenCount.rows[0].count, 1, 'second sale reuses the existing open shift');

        const cardFirstWorker = await processPaymentOutboxJobs({
            dbPool: pool,
            provider,
            batchSize: 10,
            lockedBy: `checkbox-park-smoke-card-${process.pid}`,
            lockExpiryMs: 30_000
        });
        assert.equal(cardFirstWorker.failed, 1, 'mock timeout marks fiscal operation unknown instead of creating another payment');

        const unknownCard = await pool.query(
            `SELECT fiscal_status
               FROM payment_orders
              WHERE id = $1`,
            [cardOrder.order.id]
        );
        assert.equal(unknownCard.rows[0].fiscal_status, 'unknown');
        await expectErrorCode(
            closeShift({
                user: approver.user,
                shiftId,
                idempotencyKey: `close-unknown-${process.pid}`,
                body: { cashActualMinor: '12000', terminalReportTotalMinor: '18000' }
            }),
            'shift_close_blocked_pending_unknown'
        );

        await forceRetryNow(confirmedCard.fiscalOperationId);
        const recovered = await processPaymentOutboxJobs({
            dbPool: pool,
            provider,
            batchSize: 10,
            lockedBy: `checkbox-park-smoke-recovery-${process.pid}`,
            lockExpiryMs: 30_000
        });
        assert.equal(recovered.succeeded, 1);
        assert.equal(recovered.results[0].source, 'lookup', 'unknown recovery uses provider lookup before retrying sale');
        assert.equal(provider.calls.sale, 2, 'provider sale call was not duplicated during lookup recovery');
        assert.equal(provider.calls.lookup >= 1, true);

        await createServiceIn({
            user: cashier.user,
            idempotencyKey: `service-in-${process.pid}`,
            body: {
                fiscalProfileId: scope.fiscalProfileId,
                fiscalLocationId: scope.fiscalLocationId,
                fiscalRegisterId: scope.fiscalRegisterId,
                crmProfileKey: CRM_PROFILE_KEY,
                amountMinor: '5000',
                finalConfirmation: 'Готівку внесено — створити службове внесення'
            }
        });
        await runWorkerUntilIdle(provider);

        const serviceOut = await createServiceOutRequest({
            user: cashier.user,
            idempotencyKey: `service-out-${process.pid}`,
            body: {
                fiscalProfileId: scope.fiscalProfileId,
                fiscalLocationId: scope.fiscalLocationId,
                fiscalRegisterId: scope.fiscalRegisterId,
                crmProfileKey: CRM_PROFILE_KEY,
                amountMinor: '2000',
                reason: 'Cash moved to safe during smoke'
            }
        });
        await expectErrorCode(
            approveServiceOut({
                user: cashier.user,
                operationId: serviceOut.operationId,
                idempotencyKey: `service-out-self-approve-${process.pid}`,
                body: { pin: actionPin }
            }),
            'service_out_distinct_approver_required'
        );
        await approveServiceOut({
            user: approver.user,
            operationId: serviceOut.operationId,
            idempotencyKey: `service-out-approve-${process.pid}`,
            body: { pin: actionPin }
        });
        await runWorkerUntilIdle(provider);
        assert.equal(provider.calls.service, 2, 'service_in and approved service_out are fiscalized');

        const refund = await createFullRefund({
            user: approver.user,
            orderId: cashOrder.order.id,
            idempotencyKey: `refund-cash-${process.pid}`,
            body: {
                reason: 'Full cash refund smoke',
                pin: actionPin
            }
        });
        assert.equal(refund.moneyRefundStatus, 'refunded');
        assert.equal(refund.fiscalRefundStatus, 'pending');
        await runWorkerUntilIdle(provider);
        assert.equal(provider.calls.return, 1);

        const originalReceiptAfterRefund = await pool.query(
            `SELECT *
               FROM fiscal_receipts
              WHERE id = $1`,
            [originalReceiptBeforeRefund.rows[0].id]
        );
        assert.equal(JSON.stringify(originalReceiptAfterRefund.rows[0]), originalReceiptSnapshot, 'full refund must not mutate original sale receipt');

        const receiptCounts = await pool.query(
            `SELECT receipt_type, COUNT(*)::integer AS count
               FROM fiscal_receipts
              WHERE fiscal_profile_id = $1
              GROUP BY receipt_type
              ORDER BY receipt_type`,
            [scope.fiscalProfileId]
        );
        assert.deepEqual(
            Object.fromEntries(receiptCounts.rows.map(row => [row.receipt_type, row.count])),
            { return: 1, sale: 2, service_in: 1, service_out: 1 }
        );

        const reconciliation = await createReconciliationRevision({
            user: approver.user,
            shiftId,
            idempotencyKey: `reconcile-balanced-${process.pid}`,
            body: {
                cashActualMinor: '3000',
                terminalReportTotalMinor: '18000'
            }
        });
        assert.equal(reconciliation.differenceMinor, '0');

        const report = await getOperationalReport({ user: approver.user, shiftId });
        assert.equal(report.officialZReport, false);
        assert.equal(report.checklist.pendingUnknownOperations.length, 0);

        const close = await closeShift({
            user: approver.user,
            shiftId,
            idempotencyKey: `close-balanced-${process.pid}`,
            body: {
                cashActualMinor: '3000',
                terminalReportTotalMinor: '18000'
            }
        });
        assert.equal(close.status, 'closing');
        await runWorkerUntilIdle(provider);
        assert.equal(provider.calls.shiftClose, 1);

        const finalShift = await pool.query('SELECT status FROM fiscal_shifts WHERE id = $1', [shiftId]);
        assert.equal(finalShift.rows[0].status, 'closed');

        const saleOperations = await pool.query(
            `SELECT payment_order_id, COUNT(*)::integer AS count
               FROM fiscal_operations
              WHERE operation_type = 'sale'
                AND payment_order_id = ANY($1::bigint[])
              GROUP BY payment_order_id`,
            [[cashOrder.order.id, cardOrder.order.id]]
        );
        for (const row of saleOperations.rows) {
            assert.equal(row.count, 1, `order ${row.payment_order_id} has exactly one sale operation`);
        }
    });
});
