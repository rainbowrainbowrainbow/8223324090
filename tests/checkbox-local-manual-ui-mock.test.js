'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const { test } = require('node:test');
const { startCheckboxLocalManualUiMock } = require('../scripts/lib/checkbox-local-manual-ui-mock');

async function reservePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const port = Number(server.address().port);
    await new Promise(resolve => server.close(resolve));
    return port;
}

function context(businessContext) {
    return {
        businessContext,
        token: `token-${businessContext}`,
        licenseKey: `license-${businessContext}`,
        login: `login-${businessContext}`,
        cashierId: 'shared-test-cashier',
        registerId: 'shared-test-register',
        organizationId: 'shared-test-organization',
        safeFiscalNumber: 'LOCAL'
    };
}

test('manual UI mock is loopback-only, test-mode and enforces one physical sequential shift', async () => {
    const port = await reservePort();
    const contexts = { event_genix: context('event_genix'), dar: context('dar') };
    const mock = await startCheckboxLocalManualUiMock({ contexts, port });
    const url = value => `http://127.0.0.1:${port}${value}`;
    const headers = value => ({ Authorization: `Bearer ${contexts[value].token}`, 'Content-Type': 'application/json' });
    try {
        const cashier = await fetch(url('/api/v1/cashier/me'), { headers: headers('event_genix') }).then(response => response.json());
        assert.equal(cashier.is_test, true);
        assert.equal(cashier.signature_type, 'TEST');
        assert.deepEqual(cashier.permissions, { sales: true, cash_payment: true, card_payment: true });

        const register = await fetch(url('/api/v1/cash-registers/info'), {
            headers: { 'X-License-Key': contexts.event_genix.licenseKey }
        }).then(response => response.json());
        assert.equal(register.is_test, true);
        assert.equal(register.has_shift, false);

        const parkOpen = await fetch(url('/api/v1/shifts'), {
            method: 'POST', headers: headers('event_genix'), body: JSON.stringify({ id: 'park-local-shift' })
        });
        assert.equal(parkOpen.status, 202);
        const darCollision = await fetch(url('/api/v1/shifts'), {
            method: 'POST', headers: headers('dar'), body: JSON.stringify({ id: 'dar-local-shift' })
        });
        assert.equal(darCollision.status, 409);
        const parkClose = await fetch(url('/api/v1/shifts/close'), {
            method: 'POST', headers: headers('event_genix'), body: '{}'
        });
        assert.equal(parkClose.status, 202);
        const darOpen = await fetch(url('/api/v1/shifts'), {
            method: 'POST', headers: headers('dar'), body: JSON.stringify({ id: 'dar-local-shift' })
        });
        assert.equal(darOpen.status, 202);
        const darClose = await fetch(url('/api/v1/shifts/close'), {
            method: 'POST', headers: headers('dar'), body: '{}'
        });
        assert.equal(darClose.status, 202);

        assert.equal(mock.state.activeShift, null);
        assert.equal(mock.state.receipts.size, 0);
        assert.equal(mock.state.externalNetwork, false);
    } finally {
        await mock.close();
    }
});
