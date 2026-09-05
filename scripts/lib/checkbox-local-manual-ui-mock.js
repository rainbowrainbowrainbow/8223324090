'use strict';

const http = require('node:http');

function json(res, status, payload) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

function readJson(req) {
    return new Promise(resolve => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
            catch { resolve({}); }
        });
    });
}

function contextForRequest(req, body, contexts) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const license = String(req.headers['x-license-key'] || '');
    const login = String(body?.login || '');
    return Object.values(contexts).find(context => (
        token === context.token
        || license === context.licenseKey
        || login === context.login
    )) || null;
}

async function startCheckboxLocalManualUiMock({ contexts, port }) {
    const state = {
        receipts: new Map(),
        salePostsByUuid: new Map(),
        activeShift: null,
        closedShifts: new Map(),
        externalNetwork: false
    };
    const server = http.createServer(async (req, res) => {
        const body = await readJson(req);
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
        const context = contextForRequest(req, body, contexts);
        if (pathname === '/api/v1/cashier/signin' && req.method === 'POST') {
            if (!context) return json(res, 401, { error: 'local_qa_auth_failed' });
            return json(res, 200, { access_token: context.token, token_type: 'bearer' });
        }
        if (!context) return json(res, 401, { error: 'local_qa_context_missing' });
        const key = context.businessContext;
        const currentShift = () => state.activeShift?.businessContext === key ? state.activeShift : null;

        if (pathname === '/api/v1/cashier/me' && req.method === 'GET') {
            return json(res, 200, {
                id: context.cashierId,
                organization: { id: context.organizationId },
                blocked: false,
                is_test: true,
                signature_type: 'TEST',
                certificate_end: '2099-01-01T00:00:00.000Z',
                permissions: { sales: true, cash_payment: true, card_payment: true }
            });
        }
        if (pathname === '/api/v1/cash-registers/info' && req.method === 'GET') {
            return json(res, 200, {
                id: context.registerId,
                organization_id: context.organizationId,
                fiscal_number: context.safeFiscalNumber,
                is_test: true,
                offline_mode: false,
                stay_offline: false,
                has_shift: currentShift()?.status === 'OPENED',
                documents_state: { last_receipt_code: null, last_report_code: null }
            });
        }
        if (pathname === '/api/v1/cashier/check-signature' && req.method === 'GET') {
            return json(res, 200, { online: true, type: 'TEST', shift_open_possibility: true });
        }
        if (pathname === '/api/v1/cashier/tax' && req.method === 'GET') return json(res, 200, []);
        if (pathname === '/api/v1/cashier/shift' && req.method === 'GET') {
            const shift = currentShift();
            if (!shift || shift.status === 'CLOSED') return json(res, 404, { error: 'shift_not_open' });
            return json(res, 200, { id: shift.id, status: shift.status, cash_register: { id: context.registerId } });
        }
        if (pathname === '/api/v1/shifts' && req.method === 'POST') {
            if (state.activeShift?.status === 'OPENED') return json(res, 409, { error: 'shift_already_open' });
            const shift = { id: String(body.id || ''), status: 'OPENED', businessContext: key };
            if (!shift.id) return json(res, 422, { error: 'shift_id_required' });
            state.activeShift = shift;
            return json(res, 202, {
                id: shift.id,
                status: shift.status,
                cash_register: { id: context.registerId },
                cashier: { id: context.cashierId }
            });
        }
        const shiftMatch = pathname.match(/^\/api\/v1\/shifts\/([^/]+)$/);
        if (shiftMatch && req.method === 'GET') {
            const requestedId = decodeURIComponent(shiftMatch[1]);
            const shift = state.activeShift?.id === requestedId
                ? state.activeShift
                : state.closedShifts.get(requestedId);
            if (!shift || decodeURIComponent(shiftMatch[1]) !== shift.id) return json(res, 404, { error: 'shift_not_found' });
            return json(res, 200, {
                id: shift.id,
                status: shift.status,
                cash_register: { id: context.registerId },
                cashier: { id: context.cashierId }
            });
        }
        if (pathname === '/api/v1/shifts/close' && req.method === 'POST') {
            const shift = currentShift();
            if (!shift) return json(res, 404, { error: 'shift_not_found' });
            shift.status = 'CLOSED';
            state.closedShifts.set(shift.id, { ...shift });
            state.activeShift = null;
            return json(res, 202, {
                id: shift.id,
                status: shift.status,
                cash_register: { id: context.registerId },
                cashier: { id: context.cashierId }
            });
        }
        if (pathname === '/api/v1/receipts/validate' && req.method === 'POST') return json(res, 200, { valid: true });
        if (pathname === '/api/v1/receipts/sell' && req.method === 'POST') {
            const shift = currentShift();
            if (!shift || shift.status !== 'OPENED') return json(res, 409, { error: 'shift_not_open' });
            const uuid = String(body.id || '');
            if (!uuid) return json(res, 422, { error: 'receipt_id_required' });
            state.salePostsByUuid.set(uuid, Number(state.salePostsByUuid.get(uuid) || 0) + 1);
            const total = (body.goods || []).reduce((sum, item) => sum + BigInt(item.good.price) * BigInt(item.quantity) / 1000n, 0n);
            const paid = BigInt(body.payments?.[0]?.value || total);
            const receipt = {
                id: uuid,
                status: 'DONE',
                type: 'SELL',
                total_sum: total.toString(),
                total_payment: paid.toString(),
                total_rest: body.payments?.[0]?.type === 'CASH' ? (paid - total).toString() : '0',
                cash_register_id: context.registerId,
                cashier_id: context.cashierId,
                shift_id: shift.id,
                organization_id: context.organizationId,
                payments: body.payments || [],
                context: body.context,
                fiscal_code: `LOCAL-MOCK-${state.receipts.size + 1}`,
                serial: state.receipts.size + 1
            };
            state.receipts.set(uuid, receipt);
            return json(res, 201, receipt);
        }
        const receiptMatch = pathname.match(/^\/api\/v1\/receipts\/([^/]+)$/);
        if (receiptMatch && req.method === 'GET') {
            const receipt = state.receipts.get(decodeURIComponent(receiptMatch[1]));
            return receipt ? json(res, 200, receipt) : json(res, 404, { error: 'receipt_not_found' });
        }
        return json(res, 404, { error: 'local_qa_not_found' });
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
    return {
        state,
        close: () => new Promise(resolve => server.close(resolve))
    };
}

module.exports = { startCheckboxLocalManualUiMock };
