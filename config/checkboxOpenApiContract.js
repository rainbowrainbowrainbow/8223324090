'use strict';

// Value-free compatibility projection captured from the public Checkbox OpenAPI.
// It intentionally contains no organization, register, cashier, customer, or secret values.
// Refresh compatibility with: npm run check:checkbox-openapi:official
module.exports = Object.freeze({
    sourceUrl: 'https://api.checkbox.in.ua/api/openapi.json',
    observedAt: '2026-09-03',
    observedVersion: '2.106.4+47dcea49',
    operations: Object.freeze([
        { method: 'post', path: '/api/v1/cashier/signin', responses: ['200', '403', '422'], requestSchema: 'CashierSignIn', successSchema: 'CashierAccessTokenResponseModel' },
        { method: 'post', path: '/api/v1/cashier/signinPinCode', responses: ['200', '403', '422'], requestSchema: 'CashierSignInPinCode', successSchema: 'CashierAccessTokenResponseModel', requiredHeaders: ['X-License-Key'] },
        { method: 'post', path: '/api/v1/cashier/signout', responses: ['205', '422'] },
        { method: 'get', path: '/api/v1/cashier/me', responses: ['200', '422'], successSchema: 'ExtendedCashierModel' },
        { method: 'get', path: '/api/v1/cash-registers/info', responses: ['200', '422'], successSchema: 'CashRegisterDeviceModel', requiredHeaders: ['X-License-Key'] },
        { method: 'get', path: '/api/v1/cashier/check-signature', responses: ['200', '422'], successSchema: 'CashierSignatureStatus' },
        { method: 'get', path: '/api/v1/cashier/tax', responses: ['200', '422'], successArrayItemSchema: 'ExtendedTaxModel' },
        { method: 'get', path: '/api/v1/cashier/shift', responses: ['200', '422'], successSchema: 'ShiftWithCashRegisterModel' },
        { method: 'post', path: '/api/v1/shifts', responses: ['202', '422'], requestSchema: 'CreateShiftPayload', successSchema: 'ShiftWithCashierAndCashRegister', requiredHeaders: ['X-License-Key'] },
        { method: 'get', path: '/api/v1/shifts/{shift_id}', responses: ['200', '422'], successSchema: 'ShiftWithCashierAndCashRegister' },
        { method: 'post', path: '/api/v1/shifts/close', responses: ['202', '422'], requestSchema: 'CloseShiftPayload', successSchema: 'ShiftWithCashierAndCashRegister' },
        { method: 'post', path: '/api/v1/receipts/validate', responses: ['200', '422'], requestSchema: 'ReceiptSellPayload', successAdditionalPropertiesType: 'boolean' },
        { method: 'post', path: '/api/v1/receipts/sell', responses: ['201', '422'], requestSchema: 'ReceiptSellPayload', successSchema: 'ReceiptModel' },
        { method: 'post', path: '/api/v1/receipts/service', responses: ['201', '422'], requestSchema: 'ReceiptServicePayload', successSchema: 'ReceiptModel' },
        { method: 'get', path: '/api/v1/receipts/{receipt_id}', responses: ['200', '422'], successSchema: 'ReceiptOperativeDTO' },
        { method: 'get', path: '/api/v1/receipts/{receipt_id}/pdf', responses: ['200', '422'] },
        { method: 'get', path: '/api/v1/receipts/{receipt_id}/qrcode', responses: ['200', '422'] }
    ]),
    schemas: Object.freeze({
        CashierSignIn: {
            required: ['login', 'password'],
            properties: { login: { type: 'string' }, password: { type: 'string' } }
        },
        CashierSignInPinCode: {
            required: ['pin_code'],
            properties: { pin_code: { type: 'string' } }
        },
        ExtendedCashierModel: {
            required: ['id', 'full_name', 'nin', 'signature_type', 'created_at', 'is_test', 'organization'],
            properties: {
                id: { type: 'string', format: 'uuid' },
                signature_type: { ref: 'SignatureType' },
                permissions: { ref: 'CashierPermissionsModel' },
                certificate_end: { type: 'string', format: 'date-time' },
                is_test: { type: 'boolean' },
                organization: { ref: 'OrganizationReceiptConfigModel' }
            }
        },
        CashierPermissionsModel: {
            properties: {
                sales: { type: 'boolean' },
                cash_payment: { type: 'boolean' },
                card_payment: { type: 'boolean' }
            }
        },
        CashierSignatureStatus: {
            required: ['online', 'type', 'shift_open_possibility'],
            properties: {
                online: { type: 'boolean' },
                type: { ref: 'SignatureType' },
                shift_open_possibility: { type: 'boolean' }
            }
        },
        CashRegisterDeviceModel: {
            required: ['id', 'organization_id', 'fiscal_number', 'created_at', 'address', 'title', 'offline_mode', 'stay_offline', 'has_shift', 'documents_state', 'is_test'],
            properties: {
                id: { type: 'string', format: 'uuid' },
                organization_id: { type: 'string', format: 'uuid' },
                offline_mode: { type: 'boolean' },
                stay_offline: { type: 'boolean' },
                has_shift: { type: 'boolean' },
                documents_state: { ref: 'DocumentsStateModel' },
                is_test: { type: 'boolean' }
            }
        },
        ShiftWithCashRegisterModel: {
            required: ['id', 'serial', 'status', 'created_at', 'taxes', 'cash_register'],
            properties: {
                id: { type: 'string', format: 'uuid' },
                status: { ref: 'ShiftStatus' },
                cash_register: { ref: 'CashRegisterModel' }
            }
        },
        ShiftWithCashierAndCashRegister: {
            required: ['id', 'serial', 'status', 'created_at', 'taxes', 'cash_register', 'cashier'],
            properties: {
                id: { type: 'string', format: 'uuid' },
                status: { ref: 'ShiftStatus' },
                cash_register: { ref: 'CashRegisterModel' },
                cashier: { ref: 'CashierModel' }
            }
        },
        ReceiptSellPayload: {
            required: ['goods'],
            properties: {
                id: { type: 'string', format: 'uuid' },
                goods: { type: 'array', itemRef: 'GoodItemPayload' },
                payments: { type: 'array' },
                context: { type: 'object' }
            }
        },
        GoodItemPayload: {
            required: ['good', 'quantity'],
            properties: { quantity: { type: 'integer' } }
        },
        GoodDetailsPayload: {
            required: ['code', 'name', 'price'],
            properties: {
                code: { type: 'string' },
                name: { type: 'string' },
                price: { type: 'integer' },
                tax: { anyArrayItemTypes: ['integer', 'string'] }
            }
        },
        CashPaymentPayload: {
            required: ['value'],
            properties: { type: { enum: ['CASH'] }, value: { type: 'integer' } }
        },
        CardPaymentPayload: {
            required: ['value'],
            properties: { type: { enum: ['CASHLESS'] }, value: { type: 'integer' } }
        },
        ReceiptOperativeDTO: {
            required: ['id', 'serial', 'type', 'status', 'goods', 'payments', 'total_sum', 'total_payment', 'total_rest', 'taxes', 'created_at', 'shift_id', 'cashier_id', 'cash_register_id', 'organization_id'],
            properties: {
                id: { type: 'string', format: 'uuid' },
                type: { ref: 'ReceiptType' },
                status: { ref: 'ReceiptStatus' },
                total_sum: { type: 'integer' },
                total_payment: { type: 'integer' },
                total_rest: { type: 'integer' },
                shift_id: { type: 'string', format: 'uuid' },
                cashier_id: { type: 'string', format: 'uuid' },
                cash_register_id: { type: 'string', format: 'uuid' },
                organization_id: { type: 'string', format: 'uuid' },
                context: { type: 'object' }
            }
        }
    }),
    enums: Object.freeze({
        SignatureType: ['AGENT', 'UKEY', 'DEPOSITSIGN', 'SMARTSIGN', 'CLOUD_SIGNATURE', 'CLOUD_SIGNATURE_2', 'TEST', 'CLOUD_SIGNATURE_3', 'EXTERNAL_HSM_SIGNATURE'],
        ShiftStatus: ['CREATED', 'OPENING', 'OPENED', 'CLOSING', 'CLOSED'],
        ReceiptStatus: ['CREATED', 'DONE', 'ERROR', 'CANCELLATION', 'CANCELLED'],
        ReceiptType: ['SELL', 'RETURN', 'SERVICE_IN', 'SERVICE_OUT', 'SERVICE_CURRENCY', 'CURRENCY_EXCHANGE', 'PAWNSHOP', 'CASH_WITHDRAWAL'],
        PaymentType: ['CASH', 'CARD', 'CASHLESS']
    }),
    units: Object.freeze({
        quantityScale: 1000,
        goodPrice: 'integer_minor_units_per_quantity_1000',
        paymentValue: 'integer_minor_units',
        receiptTotals: 'integer_minor_units',
        maximumTaxIdsPerGood: 2,
        untaxedGoodsOmitTax: true
    })
});
