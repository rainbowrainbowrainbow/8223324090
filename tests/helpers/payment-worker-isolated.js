'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const errors = require('../../services/checkbox/errors');

// Preload only the worker with denied DB/provider defaults; never load the app.
function loadIsolatedWorker(clock = { now: Date.now() }, { providerFactory } = {}) {
    const timers = [];
    const wakeups = [];
    const denied = label => () => { throw new Error('Forbidden isolated dependency: ' + label); };
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [clock.now])); }
        static now() { return clock.now; }
    }
    function evaluate(relative, dependencies) {
        const filename = path.join(root, relative);
        const module = { exports: {} };
        const wrapper = vm.runInThisContext('(function(require,module,exports,Date,setTimeout,clearTimeout,process){\n'
            + fs.readFileSync(filename, 'utf8') + '\n})', { filename });
        wrapper(id => {
            assert.ok(Object.hasOwn(dependencies, id), 'Unexpected import: ' + id);
            return dependencies[id];
        }, module, module.exports, ClockDate,
        (callback, delay) => { assert.equal(typeof callback, 'function'); timers.push({ callback, delay }); return { unref() {} }; },
        () => {}, { pid: 1, env: {} });
        return module.exports;
    }
    const policy = evaluate('services/payments/paymentPendingWait.js', {});
    const worker = evaluate('services/payments/paymentOutboxWorker.js', {
        'node:crypto': require('node:crypto'),
        '../../db': { pool: { connect: denied('DB connect'), query: denied('DB query') } },
        '../eventBus': { publishInTransaction: async () => {} },
        '../checkbox/errors': errors,
        '../checkbox/provider': { createCheckboxProviderFactory: providerFactory || denied('provider factory') },
        '../checkbox/config': { isCashierProEnabled: () => false },
        './paymentPendingWait': policy,
        './paymentOutboxWakeup': { requestPaymentOutboxWakeup: value => wakeups.push(value) },
        './closedShiftSaleGuard': {
            CLOSED_SHIFT_PRE_SUBMIT_ERROR_CODE: 'fiscal_shift_closed_before_sale_submission',
            guardPaidPreSubmitSalesForClosedShift: denied('closed-shift mutation')
        }
    });
    return { worker, policy, timers, wakeups };
}

const workerPath = path.join(root, 'services/payments/paymentOutboxWorker.js');
const isolated = new Module(workerPath);
isolated.filename = workerPath;
isolated.loaded = true;
isolated.exports = loadIsolatedWorker().worker;
require.cache[workerPath] = isolated;

module.exports = { loadIsolatedWorker };
