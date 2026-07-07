const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../middleware/auth',
        '../services/booking',
        '../services/bookingVisibility',
        '../services/banquetGroups',
        '../services/banquetDeposits',
        '../routes/banquets',
        '../routes/banquet-deposits'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function mockAuth() {
    const roleAllows = (user, roles) => {
        const values = [user?.role]
            .concat(Array.isArray(user?.roles) ? user.roles : [])
            .concat(Array.isArray(user?.extra_roles) ? user.extra_roles : [])
            .concat(Array.isArray(user?.extraRoles) ? user.extraRoles : [])
            .filter(Boolean);
        return values.includes('creator') || roles.some(role => values.includes(role));
    };
    return {
        authenticateToken: (req, _res, next) => {
            const role = String(req.headers['x-test-role'] || 'manager');
            req.user = {
                id: role === 'accountant' ? 19 : 20,
                username: role,
                name: role,
                role,
                roles: [role],
                business_contexts: ['event_genix'],
                default_business_context: 'event_genix'
            };
            next();
        },
        requireRole: (...roles) => (req, res, next) => {
            if (!roleAllows(req.user, roles)) return res.status(403).json({ error: 'Insufficient permissions' });
            return next();
        }
    };
}

function projection(overrides = {}) {
    return {
        state: 'verified',
        status: 'accountant_verified',
        deposit: {
            id: 10,
            amount: 1500,
            paymentMethod: 'cash',
            status: 'accountant_verified'
        },
        businessContext: 'event_genix',
        bookingId: 'BK-1',
        banquetGroupId: 'BQ-1',
        needsBookingLink: false,
        display: {
            clientName: 'Client One',
            eventDate: '2099-06-23',
            banquetNumber: 'BQ-1',
            amount: 1500,
            paymentMethod: 'cash',
            isVerified: true,
            needsBookingLink: false
        },
        ...overrides
    };
}

async function withApp(run) {
    clearModules();
    const calls = {
        confirm: [],
        listAccounting: [],
        patch: [],
        projectionById: [],
        projectionForBooking: [],
        projectionForGroup: [],
        reviewStarted: [],
        verifyAccounting: []
    };

    class BanquetDepositError extends Error {
        constructor(message, options = {}) {
            super(message);
            this.status = options.status || 400;
            this.code = options.code || 'BANQUET_DEPOSIT_ERROR';
        }
    }

    installMock('../middleware/auth', mockAuth());
    installMock('../services/booking', {
        validateDate: value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')),
        validateId: value => /^[A-Za-z0-9_-]+$/.test(String(value || ''))
    });
    installMock('../services/bookingVisibility', {
        canViewBooking: () => true,
        bookingAccessDeniedPayload: () => ({ success: false, error: 'booking-hidden' })
    });
    installMock('../services/banquetGroups', {
        BanquetGroupError: class BanquetGroupError extends Error {},
        attachBookingToBanquetGroup: async () => ({}),
        createActivityBookingFromSourceBooking: async () => ({}),
        createActivityBookingInBanquetGroup: async () => ({}),
        createBanquetGroup: async () => ({}),
        createMemberBookingFromSourceBooking: async () => ({}),
        createMemberBookingInBanquetGroup: async () => ({}),
        detachBookingFromBanquetGroup: async () => ({}),
        loadBanquetGroupCandidates: async () => ({ candidates: [], fallbackCandidates: [] }),
        loadBanquetGroupByBookingId: async () => null,
        loadBanquetGroupById: async ({ groupId }) => ({
            groupId,
            anchorBookingId: 'BK-1',
            group: { id: groupId, primaryBookingId: 'BK-1' },
            members: [{ bookingId: 'BK-1', booking: { id: 'BK-1', business_context: 'event_genix' } }],
            memberships: [],
            warnings: []
        })
    });
    installMock('../services/banquetDeposits', {
        BanquetDepositError,
        resolveDepositContextFromBooking: async ({ bookingId, businessContext }) => ({
            businessContext,
            booking: { id: bookingId, business_context: businessContext },
            bookingId,
            primaryBookingId: bookingId
        }),
        getDepositProjectionForBooking: async args => {
            calls.projectionForBooking.push(args);
            return projection({ bookingId: args.bookingId });
        },
        getDepositProjectionForGroup: async args => {
            calls.projectionForGroup.push(args);
            return projection({ banquetGroupId: args.groupId });
        },
        getDepositProjectionById: async args => {
            calls.projectionById.push(args);
            return projection({ deposit: { id: args.depositId, amount: 1500, paymentMethod: 'cash', status: 'accountant_verified' } });
        },
        listDepositsForAccounting: async args => {
            calls.listAccounting.push(args);
            return { deposits: [projection({ accountingStatus: args.accountingStatus || 'Не перевірено' })] };
        },
        markDepositReviewStarted: async input => {
            calls.reviewStarted.push(input);
            return { changed: true, projection: projection({ accountingStatus: 'На перевірці' }) };
        },
        confirmDeposit: async input => {
            calls.confirm.push(input);
            return { projection: projection() };
        },
        verifyDepositAccounting: async input => {
            calls.verifyAccounting.push(input);
            return { projection: projection({ accountingStatus: input.accountingStatus }) };
        },
        patchDeposit: async input => {
            calls.patch.push(input);
            return { projection: projection({ state: 'pending', status: input.status || 'manager_reported' }) };
        }
    });

    const app = express();
    app.use(express.json());
    app.use('/api/banquets', require('../routes/banquets'));
    app.use('/api/banquet-deposits', require('../routes/banquet-deposits'));

    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const request = async (method, path, body, role = 'accountant') => {
        const res = await fetch(`${baseUrl}${path}`, {
            method,
            headers: {
                'content-type': 'application/json',
                'x-test-role': role
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const text = await res.text();
        return {
            status: res.status,
            data: text ? JSON.parse(text) : null
        };
    };

    try {
        await run({ request, calls });
    } finally {
        await new Promise(resolve => server.close(resolve));
        clearModules();
    }
}

test('GET booking deposit returns canonical projection for visible banquet booking', async () => {
    await withApp(async ({ request, calls }) => {
        const res = await request('GET', '/api/banquets/by-booking/BK-1/deposit?businessContext=event_genix', undefined, 'manager');

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.state, 'verified');
        assert.equal(res.data.deposit.amount, 1500);
        assert.equal(calls.projectionForBooking[0].businessContext, 'event_genix');
    });
});

test('GET group deposit returns canonical projection for visible banquet group', async () => {
    await withApp(async ({ request, calls }) => {
        const res = await request('GET', '/api/banquets/BQ-1/deposit?businessContext=event_genix', undefined, 'manager');

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.banquetGroupId, 'BQ-1');
        assert.equal(calls.projectionForGroup[0].businessContext, 'event_genix');
    });
});

test('GET deposit by id returns canonical projection for accountant task UX', async () => {
    await withApp(async ({ request, calls }) => {
        const res = await request('GET', '/api/banquet-deposits/10?businessContext=event_genix', undefined, 'accountant');

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.deposit.id, 10);
        assert.equal(calls.projectionById.length, 1);
        assert.equal(calls.projectionById[0].businessContext, 'event_genix');
    });
});

test('manager can read accountant deposit by id projection', async () => {
    await withApp(async ({ request, calls }) => {
        const res = await request('GET', '/api/banquet-deposits/10?businessContext=event_genix', undefined, 'manager');

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(calls.projectionById.length, 1);
    });
});

test('non banquet finance viewer cannot read deposit by id', async () => {
    await withApp(async ({ request, calls }) => {
        const res = await request('GET', '/api/banquet-deposits/10?businessContext=event_genix', undefined, 'reception');

        assert.equal(res.status, 403);
        assert.equal(calls.projectionById.length, 0);
    });
});

test('accountant list filters deposits without starting review', async () => {
    await withApp(async ({ request, calls }) => {
        const res = await request('GET', '/api/banquet-deposits?businessContext=event_genix&accountingStatus=%D0%9D%D0%B5%20%D0%BF%D0%B5%D1%80%D0%B5%D0%B2%D1%96%D1%80%D0%B5%D0%BD%D0%BE', undefined, 'accountant');

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(calls.listAccounting.length, 1);
        assert.equal(calls.listAccounting[0].businessContext, 'event_genix');
        assert.equal(calls.listAccounting[0].accountingStatus, 'Не перевірено');
        assert.equal(calls.reviewStarted.length, 0);
    });
});

test('opening accountant deposit review marks the specific record in review', async () => {
    await withApp(async ({ request, calls }) => {
        const res = await request('POST', '/api/banquet-deposits/10/review-start?businessContext=event_genix', {}, 'accountant');

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.changed, true);
        assert.equal(res.data.accountingStatus, 'На перевірці');
        assert.equal(calls.reviewStarted.length, 1);
        assert.equal(calls.reviewStarted[0].depositId, 10);
        assert.equal(calls.reviewStarted[0].reviewStartedBy, 19);
    });
});

test('manager cannot update accountant deposit review fields', async () => {
    await withApp(async ({ request, calls }) => {
        const res = await request('PATCH', '/api/banquet-deposits/10/accounting?businessContext=event_genix', {
            paidAmount: 1500,
            accountingStatus: 'Підтверджено',
            accountingNote: 'verified'
        }, 'manager');

        assert.equal(res.status, 403);
        assert.equal(calls.verifyAccounting.length, 0);
    });
});

test('accountant accounting update forwards paid amount and final status only', async () => {
    await withApp(async ({ request, calls }) => {
        const res = await request('PATCH', '/api/banquet-deposits/10/accounting?businessContext=event_genix', {
            paidAmount: 1500,
            accountingStatus: 'Підтверджено',
            accountingNote: 'verified'
        }, 'accountant');

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(calls.verifyAccounting.length, 1);
        assert.equal(calls.verifyAccounting[0].businessContext, 'event_genix');
        assert.equal(calls.verifyAccounting[0].paidAmount, 1500);
        assert.equal(calls.verifyAccounting[0].accountingStatus, 'Підтверджено');
        assert.equal(calls.verifyAccounting[0].verifiedBy, 19);
        assert.equal(Object.prototype.hasOwnProperty.call(calls.verifyAccounting[0], 'managerStatus'), false);
    });
});

test('manager cannot confirm banquet deposit', async () => {
    await withApp(async ({ request, calls }) => {
        const res = await request('POST', '/api/banquet-deposits/10/confirm?businessContext=event_genix', {
            clientName: 'Client One',
            receivedDate: '2099-06-22',
            eventDate: '2099-06-23',
            banquetNumber: 'BQ-1',
            amount: 1500,
            paymentMethod: 'cash'
        }, 'manager');

        assert.equal(res.status, 403);
        assert.equal(calls.confirm.length, 0);
    });
});

test('confirm endpoint rejects incomplete accountant confirmation before service call', async () => {
    await withApp(async ({ request, calls }) => {
        const res = await request('POST', '/api/banquet-deposits/10/confirm?businessContext=event_genix', {
            clientName: 'Client One',
            eventDate: '2099-06-23',
            banquetNumber: 'BQ-1',
            amount: 1500,
            paymentMethod: 'cash'
        }, 'accountant');

        assert.equal(res.status, 400);
        assert.equal(res.data.code, 'DEPOSIT_CONFIRMATION_INCOMPLETE');
        assert.equal(res.data.field, 'receivedDate');
        assert.equal(calls.confirm.length, 0);
    });
});

test('accountant confirm forwards required fields and business context', async () => {
    await withApp(async ({ request, calls }) => {
        const res = await request('POST', '/api/banquet-deposits/10/confirm?businessContext=event_genix', {
            clientName: 'Client One',
            receivedDate: '2099-06-22',
            eventDate: '2099-06-23',
            banquetNumber: 'BQ-1',
            amount: 1500,
            paymentMethod: 'card'
        }, 'accountant');

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(calls.confirm.length, 1);
        assert.equal(calls.confirm[0].businessContext, 'event_genix');
        assert.equal(calls.confirm[0].clientNameSnapshot, 'Client One');
        assert.equal(calls.confirm[0].receivedDate, '2099-06-22');
        assert.equal(calls.confirm[0].paymentMethod, 'card');
        assert.equal(Object.prototype.hasOwnProperty.call(calls.confirm[0], 'financeTransactionId'), false);
    });
});

test('director can patch deposit metadata without finance transaction write intent', async () => {
    await withApp(async ({ request, calls }) => {
        const res = await request('PATCH', '/api/banquet-deposits/10?businessContext=event_genix', {
            clientName: 'Updated Client',
            status: 'manager_reported',
            note: 'operator correction'
        }, 'director');

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(calls.patch.length, 1);
        assert.equal(calls.patch[0].businessContext, 'event_genix');
        assert.equal(calls.patch[0].clientNameSnapshot, 'Updated Client');
        assert.equal(Object.prototype.hasOwnProperty.call(calls.patch[0], 'financeTransactionId'), false);
    });
});
