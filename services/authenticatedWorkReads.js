'use strict';

const http = require('node:http');
const { REQUIRED_WORK_PAGES } = require('./accountWorkReadiness');

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;

function workReadSpecs(userId, date) {
    return [
        ['/profile', '/api/auth/profile?accessProbe=1', body => Number(body?.user?.id) === userId],
        ['/tasks', '/api/tasks/my-cabinet?planningView=my-day&planningRowLimit=1&completedTodayLimit=1', body => body?.success === true],
        ['/chat', '/api/chat/channels?accessProbe=1', Array.isArray],
        ['/afisha', '/api/afisha', Array.isArray],
        ['/staff', `/api/staff/schedule?from=${date}&to=${date}`, body => body?.success === true && Array.isArray(body.data)],
        ['/training', '/api/training/courses', body => body?.success === true && Array.isArray(body.courses)]
    ];
}

function readOwnApi(port, path, authorization, context) {
    return new Promise(resolve => {
        let settled = false;
        const finish = result => { if (!settled) { settled = true; resolve(result); } };
        // The request's Host, URL, forwarded headers and caller-supplied paths are
        // deliberately irrelevant. Credentials only reach this listening server.
        const request = http.get({ hostname: '127.0.0.1', port, path,
            headers: { authorization, 'x-business-context': context, accept: 'application/json' } }, response => {
            if (response.statusCode !== 200 || !/^application\/json\b/i.test(response.headers['content-type'] || '')) {
                finish({ status: response.statusCode || 0 }); response.destroy(); return;
            }
            let size = 0;
            const parts = [];
            response.on('data', part => {
                size += part.length;
                if (size > MAX_BODY_BYTES) { response.destroy(); finish({ status: 0 }); }
                else parts.push(part);
            });
            response.on('end', () => {
                try { finish({ status: 200, body: JSON.parse(Buffer.concat(parts).toString('utf8')) }); }
                catch { finish({ status: 0 }); }
            });
            response.on('error', () => finish({ status: 0 }));
            response.on('aborted', () => finish({ status: 0 }));
        });
        const deadline = setTimeout(() => { request.destroy(); finish({ status: 0 }); }, TIMEOUT_MS);
        request.on('close', () => clearTimeout(deadline));
        request.on('error', () => finish({ status: 0 }));
    });
}

async function checkAuthenticatedWorkReads(req, { userId, businessContext }) {
    const port = Number(req.socket?.localPort);
    const authorization = req.headers?.authorization;
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^Bearer \S+$/i.test(authorization || '')
        || !Number.isSafeInteger(userId) || userId <= 0 || businessContext !== 'event_genix') {
        throw new TypeError('Authenticated work context required');
    }
    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' });
    const specs = workReadSpecs(userId, date);
    const results = [];
    for (let i = 0; i < specs.length; i += 2) {
        results.push(...await Promise.all(specs.slice(i, i + 2).map(async ([page, path, validate]) => {
            const result = await readOwnApi(port, path, authorization, businessContext);
            const passed = result.status === 200 && validate(result.body);
            // Discard all response bodies; report only the read outcome.
            return { page, passed, probe: 'authenticated_api', status: passed ? 'checked' : 'failed',
                httpStatus: result.status, ...(passed ? {} : { code: 'work_api_read_failed' }) };
        })));
    }
    if (results.length !== REQUIRED_WORK_PAGES.length) throw new Error('Incomplete work reads');
    return results;
}

module.exports = { checkAuthenticatedWorkReads };
