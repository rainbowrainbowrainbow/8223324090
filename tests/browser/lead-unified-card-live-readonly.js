#!/usr/bin/env node
'use strict';

// Operator-run, read-only release proof. Never run with fixture credentials or in CI.
// No screenshots, DOM/network traces, response bodies or credential values are persisted.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseSecretAssignments } = require('../../scripts/live-omni-smoke');
const { assertDeploymentMetadata } = require('../../scripts/live-version-smoke');

const TARGET = 'https://8223324090-production.up.railway.app';
const BRANCH = 'codex/eventgenix-production';
const OUTPUT = path.resolve(__dirname, '../../output/playwright/lead-unified-card-live-readonly');
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const AUTH_POSTS = new Set(['/api/auth/login', '/api/auth/refresh']);
class QaError extends Error { constructor(code) { super(code); this.code = code; } }
function check(value, code) { if (!value) throw new QaError(code); }

function parseArgs(args) {
    const keys = new Set(['url', 'expected-sha', 'lead-id', 'conversation-id', 'business-context']);
    const values = {};
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index]?.replace(/^--/, '');
        check(args[index]?.startsWith('--') && keys.has(key) && args[index + 1] && !values[key], 'invalid_arguments');
        values[key] = args[index + 1];
    }
    check(values.url === TARGET, 'target_not_allowlisted');
    check(/^[0-9a-f]{40}$/.test(values['expected-sha'] || ''), 'expected_sha_required');
    for (const key of ['lead-id', 'conversation-id']) {
        check(/^[1-9]\d*$/.test(values[key] || '') && Number.isSafeInteger(Number(values[key])), 'explicit_ids_required');
    }
    check(['event_genix', 'maysternya_doli'].includes(values['business-context']), 'explicit_business_required');
    return { base: TARGET, sha: values['expected-sha'], leadId: Number(values['lead-id']), conversationId: Number(values['conversation-id']), business: values['business-context'] };
}

function requestPolicy(method, rawUrl, config) {
    const url = new URL(rawUrl);
    if (url.origin !== config.base) return 'external_blocked';
    if (method === 'POST' && AUTH_POSTS.has(url.pathname)) return 'auth_allowed';
    if (!SAFE_METHODS.has(method)) return /^\/api\/omni\/conversations\/\d+\/read$/.test(url.pathname) ? 'receipt_blocked' : 'business_write_blocked';
    if (url.pathname.startsWith('/api/omni/')) {
        const exact = `/api/omni/conversations/${config.conversationId}`;
        const allowed = ['/api/omni/conversations', '/api/omni/accounts', '/api/omni/stats', '/api/omni/operators', '/api/omni/quick-replies', `${exact}/context`, `${exact}/messages`];
        if (!allowed.includes(url.pathname)) return 'provider_or_unscoped_read_blocked';
    } else if (/^\/api\/(?:ai|telegram|instagram|facebook|whatsapp|viber|integrations|webhooks)(?:\/|$)/.test(url.pathname)
        || /\/(?:reconcile|sync|export|send|connect|disconnect|analyze|test)(?:\/|$)/.test(url.pathname)) {
        return 'provider_or_unscoped_read_blocked';
    }
    if (/^\/api\/(?:leads|customers|omni)(?:\/|$)/.test(url.pathname)) {
        const context = url.searchParams.get('businessContext') || url.searchParams.get('business_context');
        if (context && context !== config.business) return 'wrong_business_blocked';
    }
    return 'read_allowed';
}

async function getVersion(config) {
    const response = await fetch(`${config.base}/api/version`, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    check(response.ok, 'version_http_failed');
    const value = await response.json();
    try { assertDeploymentMetadata(value, { requireComplete: true, expectedCommit: config.sha, expectedBranch: BRANCH }); }
    catch { throw new QaError('live_sha_or_branch_mismatch'); }
    check(/^\d+\.\d+\.\d+$/.test(value.version || ''), 'version_invalid');
    return { version: value.version, commitSha: config.sha, sourceBranch: BRANCH };
}

async function login(config) {
    const secretFile = path.join(os.homedir(), '.eventgenix', 'codex-crm-secrets.ps1');
    check(fs.existsSync(secretFile), 'qa_credentials_file_missing');
    const values = parseSecretAssignments(fs.readFileSync(secretFile, 'utf8'));
    check(values.LIVE_SMOKE_URL && new URL(values.LIVE_SMOKE_URL).origin === config.base, 'qa_credentials_target_mismatch');
    check(values.LIVE_SMOKE_USER && values.LIVE_SMOKE_PASS, 'qa_credentials_missing');
    const response = await fetch(`${config.base}/api/auth/login`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: values.LIVE_SMOKE_USER, password: values.LIVE_SMOKE_PASS })
    });
    check(response.ok, 'qa_login_failed');
    const data = await response.json();
    const token = data.accessToken || data.token;
    check(typeof token === 'string' && token.length > 20, 'qa_login_token_missing');
    return token;
}

function matchesExpectedBusinessContext(snapshot, expectedBusiness) {
    if (!snapshot || snapshot.runtimeContext !== expectedBusiness || snapshot.bodyContext !== expectedBusiness
        || snapshot.scopeMode !== 'single' || snapshot.scopeContext !== expectedBusiness
        || !Array.isArray(snapshot.selectedContexts) || snapshot.selectedContexts.length !== 1
        || snapshot.selectedContexts[0] !== expectedBusiness || !Array.isArray(snapshot.urlContexts)) return false;
    if (snapshot.urlContexts.length) return snapshot.urlContexts.every(context => context === expectedBusiness);
    return expectedBusiness === 'event_genix' && snapshot.accountDefaultBusinessId === expectedBusiness;
}

async function checkPageBusinessContext(page, config) {
    const snapshot = await page.evaluate(() => {
        const runtime = window.CrmBusinessContext;
        const scope = runtime?.scope?.();
        const resolution = runtime?.resolution?.();
        const params = new URL(location.href).searchParams;
        return {
            urlContexts: [...params.getAll('businessContext'), ...params.getAll('business_context')],
            runtimeContext: runtime?.current?.(), bodyContext: document.body.dataset.crmBusinessContext,
            scopeMode: scope?.mode, scopeContext: scope?.activeContext, selectedContexts: scope?.selectedContexts,
            accountDefaultBusinessId: resolution?.accountDefaultBusinessId
        };
    });
    check(matchesExpectedBusinessContext(snapshot, config.business), 'page_business_context_mismatch');
}

async function waitForLead(page, config) {
    await page.locator('#leadWorkspace.active').waitFor({ state: 'visible' });
    await page.locator('#leadWorkspacePanel-communications .workspace-conversation-row').first().waitFor({ state: 'visible' });
    check(await page.evaluate(({ leadId }) => {
        const url = new URL(location.href);
        return Number(url.searchParams.get('lead')) === leadId && url.searchParams.get('leadTab') === 'communications'
            && document.getElementById('leadWorkspaceTab-communications')?.getAttribute('aria-selected') === 'true';
    }, config), 'lead_workspace_identity_mismatch');
    await checkPageBusinessContext(page, config);
}

async function waitForConversation(page, config) {
    await page.locator('#omniChatAvatar.ch-instagram').waitFor({ state: 'visible' });
    await page.locator('#omniMessages .omni-msg').first().waitFor({ state: 'visible' });
    await page.waitForFunction(id => document.querySelector(`.omni-conv-item.active[data-id="${id}"]`)?.getAttribute('aria-pressed') === 'true', config.conversationId);
    check(await page.evaluate(({ conversationId }) => {
        const url = new URL(location.href);
        return Number(url.searchParams.get('conversation')) === conversationId;
    }, config), 'conversation_identity_mismatch');
    await checkPageBusinessContext(page, config);
}

async function checkLayout(page) {
    await page.evaluate(async () => {
        await document.fonts.ready;
        const animations = document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime));
        await Promise.allSettled(animations.map(animation => animation.finished));
    });
    return page.evaluate(() => {
        const selector = location.pathname === '/omni' ? '.omni-chat' : '#leadWorkspace';
        const bounds = document.querySelector(selector)?.getBoundingClientRect();
        return Boolean(bounds && bounds.width > 0 && bounds.left >= -1 && bounds.right <= innerWidth + 1
            && bounds.top >= -1 && bounds.bottom <= innerHeight + 2 && document.documentElement.scrollWidth <= innerWidth + 1);
    });
}

async function main(args = process.argv.slice(2)) {
    let browser;
    let stage = 'arguments';
    const report = { schemaVersion: 1, passed: false, screenshotsTaken: false, tracesTaken: false, businessWritesAllowed: false, websocketConnectionsAllowed: false, requests: {}, checks: {} };
    try {
        const config = parseArgs(args);
        report.leadId = config.leadId;
        report.conversationId = config.conversationId;
        report.businessContext = config.business;
        stage = 'version_preflight';
        report.release = await getVersion(config); // Fail closed before login or customer reads.
        stage = 'login';
        const token = await login(config);
        const { chromium } = require('playwright');
        browser = await chromium.launch({ headless: true });
        for (const [label, viewport] of [['desktop', { width: 1366, height: 768 }], ['mobile', { width: 390, height: 844 }]]) {
            const context = await browser.newContext({ viewport, serviceWorkers: 'block', permissions: [], acceptDownloads: false });
            try {
                await context.routeWebSocket('**/*', socket => {
                    report.requests.websocket_blocked = (report.requests.websocket_blocked || 0) + 1;
                    socket.close();
                });
                await context.route('**/*', route => {
                    const request = route.request();
                    const decision = requestPolicy(request.method(), request.url(), config);
                    report.requests[decision] = (report.requests[decision] || 0) + 1;
                    return decision.endsWith('_allowed') ? route.continue() : route.abort('blockedbyclient');
                });
                await context.addInitScript(({ token: accessToken, business }) => {
                    window.__eventGenixLiveQaReadOnly = true;
                    localStorage.setItem('pzp_token', accessToken);
                    localStorage.setItem('pzp_access_token', accessToken);
                    localStorage.setItem('eventgenix_business_context', business);
                }, { token, business: config.business });
                const page = await context.newPage();
                page.setDefaultTimeout(35000);
                page.on('pageerror', () => { report.requests.page_error = (report.requests.page_error || 0) + 1; });
                page.on('response', response => {
                    const url = new URL(response.url());
                    if (url.origin !== config.base || response.request().method() !== 'GET') return;
                    const kind = url.pathname === `/api/leads/${config.leadId}/workspace` ? 'lead_workspace'
                        : url.pathname === `/api/omni/conversations/${config.conversationId}/messages` ? 'conversation_messages'
                            : url.pathname === `/api/omni/conversations/${config.conversationId}/context` ? 'conversation_context' : null;
                    if (!kind || response.status() < 400) return;
                    const key = `${kind}_${[401, 403].includes(response.status()) ? 'access_denied' : 'read_failed'}`;
                    report.requests[key] = (report.requests[key] || 0) + 1;
                });
                const results = report.checks[label] = {};
                stage = `${label}_lead`;
                const leadUrl = new URL('/sales-funnel', config.base);
                leadUrl.search = new URLSearchParams({ lead: String(config.leadId), leadTab: 'communications', businessContext: config.business });
                const response = await page.goto(leadUrl.href, { waitUntil: 'domcontentloaded' });
                check(response?.ok(), 'lead_navigation_or_access_failed');
                await waitForLead(page, config);
                results.leadLoaded = true;
                results.leadLayout = await checkLayout(page);
                check(results.leadLayout, 'lead_layout_failed');
                const link = page.locator('.workspace-hero a').filter({ hasText: 'Відкрити Instagram' });
                check(await link.count() === 1, 'exact_instagram_action_missing');
                const href = new URL(await link.getAttribute('href'), config.base);
                check(href.origin === config.base && href.pathname === '/omni' && Number(href.searchParams.get('conversation')) === config.conversationId
                    && href.searchParams.get('businessContext') === config.business && !href.searchParams.has('search'), 'lead_action_not_exact');
                stage = `${label}_actual_click`;
                await link.click();
                await waitForConversation(page, config);
                results.actualInstagramClick = true;
                results.omniLayout = await checkLayout(page);
                check(results.omniLayout, 'omni_layout_failed');
                stage = `${label}_back_reload`;
                await page.goBack({ waitUntil: 'domcontentloaded' });
                await waitForLead(page, config);
                results.backRestoredLeadAndTab = true;
                await page.reload({ waitUntil: 'domcontentloaded' });
                await waitForLead(page, config);
                results.reloadRestoredLeadAndTab = true;
                stage = `${label}_conflicting_filters`;
                const filtered = new URL(href);
                filtered.searchParams.set('channel', 'telegram');
                filtered.searchParams.set('status', 'closed');
                filtered.searchParams.set('search', 'qa-explicit-link-no-match');
                await page.goto(filtered.href, { waitUntil: 'domcontentloaded' });
                await waitForConversation(page, config);
                results.exactConversationWithConflictingFilters = true;
                await page.reload({ waitUntil: 'domcontentloaded' });
                await waitForConversation(page, config);
                results.filteredConversationSurvivesReload = true;
                await page.goBack({ waitUntil: 'domcontentloaded' });
                await waitForLead(page, config);
                results.filteredBackRestoredLead = true;
            } finally { await context.close(); }
        }
        stage = 'version_postflight';
        await getVersion(config);
        report.checks.sameReleaseAfterQa = true;
        check(!report.requests.business_write_blocked, 'unexpected_business_write_attempt');
        check(!report.requests.wrong_business_blocked, 'wrong_business_request_attempt');
        check(!Object.keys(report.requests).some(key => key.endsWith('_access_denied')), 'required_read_access_denied');
        check(!Object.keys(report.requests).some(key => key.endsWith('_read_failed')), 'critical_read_failed');
        check(!report.requests.page_error, 'browser_page_error');
        report.passed = true;
    } catch (error) {
        report.failure = error instanceof QaError ? error.code : `${stage}_failed`;
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close().catch(() => {});
        fs.mkdirSync(OUTPUT, { recursive: true });
        fs.writeFileSync(path.join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
        process.stdout.write(JSON.stringify(report) + '\n');
    }
    return report;
}

module.exports = { parseArgs, requestPolicy, matchesExpectedBusinessContext };
if (require.main === module) main();
