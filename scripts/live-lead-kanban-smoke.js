#!/usr/bin/env node
'use strict';

/**
 * Write smoke for live/local Kanban lead stage moves.
 *
 * Usage:
 *   LIVE_SMOKE_URL=https://example.up.railway.app \
 *   LIVE_SMOKE_TOKEN=<jwt> \
 *   LIVE_SMOKE_LEAD_ID=123 \
 *   LIVE_SMOKE_CONFIRM_WRITE=yes \
 *   npm run smoke:lead-kanban
 *
 *   LIVE_SMOKE_URL=http://localhost:3000 \
 *   LIVE_SMOKE_USER=codex.qa \
 *   LIVE_SMOKE_PASS=... \
 *   LIVE_SMOKE_LEAD_ID=123 \
 *   npm run smoke:lead-kanban
 */

const PIPELINE_STAGES = Object.freeze([
    'new',
    'contacted',
    'info_sent',
    'deal',
    'deposit_received',
    'waiting',
    'completed',
    'closed',
    'lost'
]);

const MAX_KANBAN_PAGES = 50;
const KANBAN_PAGE_SIZE = 500;
const HIGH_IMPACT_ROUNDTRIP_STAGES = new Set(['deal', 'deposit_received', 'lost']);
const LOW_IMPACT_ADJACENT_TARGETS = Object.freeze({
    new: 'contacted',
    contacted: 'info_sent',
    info_sent: 'contacted',
    deal: 'info_sent',
    deposit_received: 'waiting',
    waiting: 'completed',
    completed: 'closed',
    closed: 'completed',
    lost: 'closed'
});

function skip(message) {
    console.log(`Live lead Kanban smoke skipped: ${message}`);
    process.exit(0);
}

function blocked(message) {
    console.log(`Live lead Kanban smoke blocked: ${message}`);
    process.exit(0);
}

function fail(message) {
    console.error(`Live lead Kanban smoke failed: ${message}`);
    process.exit(1);
}

function readEnv(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (String(value || '').trim()) return String(value).trim();
    }
    return '';
}

function normalizeBase(url) {
    try {
        return new URL(url).origin;
    } catch {
        throw new Error(`invalid LIVE_SMOKE_URL "${url || ''}"`);
    }
}

function isLocalBase(base) {
    try {
        const hostname = new URL(base).hostname.toLowerCase();
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
    } catch {
        return false;
    }
}

function isConfirmed(value) {
    return ['1', 'true', 'yes', 'y', 'write'].includes(String(value || '').trim().toLowerCase());
}

function authHeaders(token = '') {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readResponse(res) {
    const text = await res.text();
    try {
        return { text, body: text ? JSON.parse(text) : null };
    } catch {
        return { text, body: null };
    }
}

function responseDetail(body, text) {
    return body?.error || body?.message || body?.code || text || '';
}

async function fetchJson(base, path, options = {}) {
    const res = await fetch(`${base}${path}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...authHeaders(options.token)
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const { body, text } = await readResponse(res);
    if (!res.ok) {
        const detail = responseDetail(body, text);
        const requestId = body?.requestId || body?.request_id || res.headers.get('x-request-id') || '';
        throw new Error(`${path} returned HTTP ${res.status}${detail ? `: ${detail}` : ''}${requestId ? ` requestId=${requestId}` : ''}`);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error(`${path} did not return a JSON object`);
    }
    return body;
}

function extractToken(body = {}) {
    return body.accessToken
        || body.access_token
        || body.token
        || body.jwt
        || body.data?.accessToken
        || body.data?.access_token
        || body.data?.token
        || '';
}

async function login(base) {
    const token = readEnv('LIVE_LEAD_KANBAN_TOKEN', 'LIVE_SMOKE_TOKEN', 'LIVE_SMOKE_BEARER_TOKEN');
    if (token) {
        await fetchJson(base, '/api/auth/verify', { token });
        return { token, user: null, source: 'token' };
    }

    const username = readEnv('LIVE_LEAD_KANBAN_USER', 'LIVE_SMOKE_USER', 'LIVE_SMOKE_USERNAME', 'TEST_USER');
    const password = readEnv('LIVE_LEAD_KANBAN_PASS', 'LIVE_SMOKE_PASS', 'LIVE_SMOKE_PASSWORD', 'TEST_PASS');
    if (!username || !password) {
        skip('provide LIVE_SMOKE_TOKEN or LIVE_SMOKE_USER/LIVE_SMOKE_PASS');
    }

    const body = await fetchJson(base, '/api/auth/login', {
        method: 'POST',
        body: { username, password }
    });
    const accessToken = extractToken(body);
    if (!accessToken) throw new Error('/api/auth/login did not return an access token');
    return {
        token: accessToken,
        user: body.user || null,
        source: 'login'
    };
}

function contextPath(path, businessContext) {
    const url = new URL(path, 'http://local');
    if (businessContext && !url.searchParams.has('businessContext')) {
        url.searchParams.set('businessContext', businessContext);
    }
    return `${url.pathname}${url.search}`;
}

function stageFromLead(lead = {}) {
    const stage = lead.pipeline_stage || lead.pipelineStage || lead.stage || '';
    return PIPELINE_STAGES.includes(stage) ? stage : '';
}

function updatedAtFromLead(lead = {}) {
    return lead.updated_at || lead.updatedAt || lead.version || '';
}

async function readLeadWorkspace(base, token, leadId, businessContext) {
    const body = await fetchJson(base, contextPath(`/api/leads/${encodeURIComponent(leadId)}/workspace`, businessContext), { token });
    if (body.success !== true || !body.workspace?.lead) {
        throw new Error(`/api/leads/${leadId}/workspace did not return { success: true, workspace.lead }`);
    }
    const stage = body.workspace.canonical?.stage || stageFromLead(body.workspace.lead);
    if (!PIPELINE_STAGES.includes(stage)) {
        throw new Error(`/api/leads/${leadId}/workspace returned invalid pipeline stage "${stage || 'missing'}"`);
    }
    const updatedAt = updatedAtFromLead(body.workspace.lead);
    if (!updatedAt) {
        throw new Error(`/api/leads/${leadId}/workspace did not return updated_at/updatedAt`);
    }
    return { lead: body.workspace.lead, stage, updatedAt };
}

function adjacentStage(stage) {
    const target = LOW_IMPACT_ADJACENT_TARGETS[stage];
    if (!target) throw new Error(`unknown pipeline stage "${stage}"`);
    return target;
}

function leadHasBooking(lead = {}) {
    return Boolean(lead.bookingId || lead.booking_id || lead.booking);
}

function assertSafeLeadForRoundtrip(lead, originalStage) {
    if (leadHasBooking(lead) && !isConfirmed(readEnv('LIVE_SMOKE_ALLOW_LINKED_BOOKING'))) {
        blocked(`lead ${lead.id || ''} has a linked booking; use a disposable lead without booking_id or set LIVE_SMOKE_ALLOW_LINKED_BOOKING=yes`);
    }
    if (HIGH_IMPACT_ROUNDTRIP_STAGES.has(originalStage) && !isConfirmed(readEnv('LIVE_SMOKE_ALLOW_HIGH_IMPACT_STAGE'))) {
        blocked(`lead ${lead.id || ''} is in high-impact stage "${originalStage}"; use a simple test lead or set LIVE_SMOKE_ALLOW_HIGH_IMPACT_STAGE=yes`);
    }
}

async function moveLeadStage(base, token, leadId, stage, businessContext, updatedAt) {
    if (!updatedAt) throw new Error(`lead ${leadId} stage move requires updated_at`);
    const body = await fetchJson(base, contextPath(`/api/leads/${encodeURIComponent(leadId)}/stage`, businessContext), {
        method: 'PATCH',
        token,
        body: {
            pipeline_stage: stage,
            updated_at: updatedAt,
            businessContext
        }
    });
    if (body.success !== true || !body.lead) {
        throw new Error(`/api/leads/${leadId}/stage did not return { success: true, lead }`);
    }
    const actualStage = stageFromLead(body.lead);
    if (actualStage !== stage) {
        throw new Error(`/api/leads/${leadId}/stage returned stage "${actualStage || 'missing'}", expected "${stage}"`);
    }
    const nextUpdatedAt = updatedAtFromLead(body.lead);
    if (!nextUpdatedAt) throw new Error(`/api/leads/${leadId}/stage response did not return updated_at/updatedAt`);
    return { ...body, updatedAt: nextUpdatedAt };
}

function kanbanListPath({ businessContext, offset }) {
    const params = new URLSearchParams({
        order: 'kanban',
        limit: String(KANBAN_PAGE_SIZE),
        offset: String(offset)
    });
    if (businessContext) params.set('businessContext', businessContext);
    return `/api/leads?${params.toString()}`;
}

async function findLeadInKanban(base, token, leadId, businessContext) {
    let offset = 0;
    for (let pageIndex = 0; pageIndex < MAX_KANBAN_PAGES; pageIndex += 1) {
        const path = kanbanListPath({ businessContext, offset });
        const body = await fetchJson(base, path, { token });
        if (body.success !== true || !Array.isArray(body.leads)) {
            throw new Error(`${path} did not return { success: true, leads: [] }`);
        }
        const found = body.leads.find(lead => String(lead.id) === String(leadId));
        if (found) return found;
        const pagination = body.pagination || {};
        if (!pagination.hasMore || body.leads.length === 0) return null;
        const nextOffset = Number(pagination.nextOffset);
        offset = Number.isFinite(nextOffset) ? nextOffset : offset + body.leads.length;
    }
    throw new Error(`lead ${leadId} was not found in Kanban after ${MAX_KANBAN_PAGES} pages`);
}

async function assertLeadStageInKanban(base, token, leadId, expectedStage, businessContext) {
    const lead = await findLeadInKanban(base, token, leadId, businessContext);
    if (!lead) throw new Error(`lead ${leadId} was not found in /api/leads?order=kanban`);
    const actualStage = stageFromLead(lead);
    if (actualStage !== expectedStage) {
        throw new Error(`Kanban has lead ${leadId} in stage "${actualStage || 'missing'}", expected "${expectedStage}"`);
    }
    return lead;
}

async function runLiveLeadKanbanSmoke() {
    const target = readEnv('LIVE_SMOKE_URL');
    if (!target) skip('set LIVE_SMOKE_URL');

    const leadId = readEnv('LIVE_SMOKE_LEAD_ID', 'LIVE_LEAD_KANBAN_LEAD_ID');
    if (!/^\d+$/.test(leadId)) skip('set numeric LIVE_SMOKE_LEAD_ID');

    const base = normalizeBase(target);
    const confirmWrite = readEnv('LIVE_SMOKE_CONFIRM_WRITE', 'LIVE_LEAD_KANBAN_CONFIRM_WRITE');
    if (!isLocalBase(base) && !isConfirmed(confirmWrite)) {
        blocked(`set LIVE_SMOKE_CONFIRM_WRITE=yes before mutating ${base}`);
    }

    const businessContext = readEnv('LIVE_SMOKE_BUSINESS_CONTEXT', 'LIVE_LEAD_KANBAN_BUSINESS_CONTEXT') || 'event_genix';
    const session = await login(base);
    const initial = await readLeadWorkspace(base, session.token, leadId, businessContext);
    const originalStage = initial.stage;
    assertSafeLeadForRoundtrip(initial.lead, originalStage);
    const targetStage = adjacentStage(originalStage);

    let movedToTarget = false;
    let restored = originalStage === targetStage;
    try {
        const targetMove = await moveLeadStage(base, session.token, leadId, targetStage, businessContext, initial.updatedAt);
        movedToTarget = true;
        await assertLeadStageInKanban(base, session.token, leadId, targetStage, businessContext);

        await moveLeadStage(base, session.token, leadId, originalStage, businessContext, targetMove.updatedAt);
        restored = true;
        await assertLeadStageInKanban(base, session.token, leadId, originalStage, businessContext);
    } finally {
        if (movedToTarget && !restored) {
            try {
                const latest = await readLeadWorkspace(base, session.token, leadId, businessContext);
                await moveLeadStage(base, session.token, leadId, originalStage, businessContext, latest.updatedAt);
                await assertLeadStageInKanban(base, session.token, leadId, originalStage, businessContext);
                console.log(`Live lead Kanban smoke cleanup OK: restored lead ${leadId} to ${originalStage}`);
            } catch (err) {
                console.error(`Live lead Kanban smoke cleanup failed: lead ${leadId} may still be in ${targetStage}: ${err.message || err}`);
            }
        }
    }

    return {
        base,
        leadId,
        businessContext,
        originalStage,
        targetStage,
        auth: session.user?.username || session.source
    };
}

async function main() {
    const result = await runLiveLeadKanbanSmoke();
    console.log(`Live lead Kanban smoke OK: ${result.base}`);
    console.log(`  OK auth: ${result.auth}`);
    console.log(`  OK lead ${result.leadId}: ${result.originalStage} -> ${result.targetStage} -> ${result.originalStage}`);
    console.log(`  OK businessContext: ${result.businessContext}`);
}

if (require.main === module) {
    main().catch(err => fail(err.message || String(err)));
}

module.exports = {
    runLiveLeadKanbanSmoke
};
