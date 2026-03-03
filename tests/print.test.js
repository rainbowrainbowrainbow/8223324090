/**
 * tests/print.test.js — Print API Tests
 * Run: node --test tests/print.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Print', () => {
    let templateId;
    let jobId;

    it('GET /api/print/templates — list templates', async () => {
        const res = await authRequest('GET', '/api/print/templates');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('POST /api/print/templates — create template', async () => {
        const res = await authRequest('POST', '/api/print/templates', {
            code: 'smoke-' + Date.now(),
            name: 'Smoke Template',
            category: 'certificate',
            format: 'A4',
            dpi: 300
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
        assert.ok(res.data.template);
        templateId = res.data.template.id;
    });

    it('POST /api/print/templates — reject without code', async () => {
        const res = await authRequest('POST', '/api/print/templates', {
            name: 'No Code'
        });
        assert.equal(res.status, 400);
    });

    it('POST /api/print/preflight — validate print job', async () => {
        assert.ok(templateId, 'Need template id');
        const tmpl = await authRequest('GET', '/api/print/templates');
        const template = tmpl.data.find(t => t.id === templateId);
        const res = await authRequest('POST', '/api/print/preflight', {
            template_code: template.code,
            data: {}
        });
        assert.equal(res.status, 200);
        assert.ok(typeof res.data.passed === 'boolean');
        assert.ok(Array.isArray(res.data.checks));
    });

    it('POST /api/print/preflight — reject without template_code', async () => {
        const res = await authRequest('POST', '/api/print/preflight', {
            data: {}
        });
        assert.equal(res.status, 400);
    });

    it('POST /api/print/jobs — create print job', async () => {
        const res = await authRequest('POST', '/api/print/jobs', {
            template_id: templateId,
            data: { title: 'Smoke Print' }
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.job);
        jobId = res.data.job.id;
    });

    it('GET /api/print/jobs — list jobs', async () => {
        const res = await authRequest('GET', '/api/print/jobs');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('PUT /api/print/jobs/:id/status — update job status', async () => {
        assert.ok(jobId, 'Need job id');
        const res = await authRequest('PUT', `/api/print/jobs/${jobId}/status`, {
            status: 'completed'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('GET /api/print/routing — list routing rules', async () => {
        const res = await authRequest('GET', '/api/print/routing');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/print/overview — dashboard', async () => {
        const res = await authRequest('GET', '/api/print/overview');
        assert.equal(res.status, 200);
        assert.ok(res.data.jobs);
        assert.ok(res.data.templates);
    });
});
