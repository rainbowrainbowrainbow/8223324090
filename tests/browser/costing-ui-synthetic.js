'use strict';

// Browser flow against actual page/scripts, with an in-memory costing API and no production access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { calculatePlan } = require('../../services/costingCalculator');
const { summarizeTarget } = require('../../services/costingActuals');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/playwright/costing-synthetic');
const html = fs.readFileSync(path.join(root, 'finance.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const definition = { revenueBasis: 'participant', revenueRateMinor: '30000', lines: [
    { code: 'teacher', label: 'Викладач', basis: 'hour', rateMinor: '25000' },
    { code: 'materials', label: 'Матеріали', basis: 'participant', rateMinor: '4000' },
    { code: 'room', label: 'Зала', basis: 'execution', rateMinor: '15000' },
    { code: 'fee', label: 'Комісія', basis: 'percent', percentBps: 500, percentBase: 'revenue' }
] };
const template = { id: '1', name: 'Групове заняття', kind: 'lesson' };
const version = { id: '1', version_number: 1, effective_from: '2026-01-01', definition };
const plans = [];
const groups = [];
const actualSources = [];
const actualEntries = [];
const completionEvents = [];
const requests = [];
const boot = `<script>
window.AppState = {};
window.apiVerifyToken = async () => ({name:'Synthetic QA',role:'creator'});
window.hydrateActionPermissions = async () => ({});
window.canUseAction = () => true;
window.getAuthHeaders = () => ({'Content-Type':'application/json'});
window.handleAuthError = () => false;
window.showAuthenticatedPageShell = () => {
    document.getElementById('mainApp').classList.remove('hidden');
    document.body.classList.add('shell-ready','dark-mode');
};
window.getLegacyBusinessSurfaceAvailability = () => ({available:false,message:'Synthetic isolated fixture'});
window.apiFetchWithAuthRetry = (url,options) => fetch(url,options);
window.escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
document.documentElement.setAttribute('data-theme','dark');
</script><script src="/js/finance-page.js"></script><script src="/js/finance-costing.js"></script>`;

function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
}

async function main() {
    fs.mkdirSync(output, { recursive: true });
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname.startsWith('/api/')) {
            requests.push({ method: req.method, path: url.pathname });
            const endpoint = url.pathname.replace('/api/finance/costing', '');
            if (req.method === 'GET' && endpoint === '/templates') return json(res, 200, { templates: [template] });
            if (req.method === 'GET' && endpoint === '/templates/1') return json(res, 200, { template, versions: [version] });
            if (req.method === 'GET' && endpoint === '/plans') return json(res, 200, { plans });
            if (req.method === 'GET' && endpoint === '/actual/groups') return json(res, 200, { groups });
            if (req.method === 'POST' && endpoint === '/actual/source-links/preview') {
                let body = '';
                for await (const part of req) body += part;
                const payload = JSON.parse(body);
                const attendance = payload.type === 'education_attendance' && payload.sourceId === '11';
                const booking = payload.type === 'booking' && payload.sourceId === 'booking_ui';
                return json(res, 200, { preview: { type: payload.type, sourceId: payload.sourceId,
                    referenceValid: attendance || (booking && payload.expectedAmountMinor === '216000'),
                    verifiedFields: attendance ? ['id', 'business_context'] : booking ? ['id', 'business_context', 'amount'] : [],
                    amountMatches: attendance ? null : booking, canonicalAmountMinor: attendance ? null : '216000',
                    status: 'confirmed', postingAllowed: false,
                    blockers: [attendance ? 'Attendance has no monetary amount' : 'Booking price is not earned revenue'] } });
            }
            if (req.method === 'POST' && endpoint === '/actual/groups') {
                let body = '';
                for await (const part of req) body += part;
                const payload = JSON.parse(body);
                if (groups.some(group => group.members.some(member => payload.members.some(next => String(next.planId) === String(member.planId))))) {
                    return json(res, 409, { error: 'Plan already belongs to an aggregate' });
                }
                const group = { id: String(groups.length + 1), kind: payload.kind, label: payload.label,
                    members: payload.members, revision: 1, history: [{ revision_number: 1, reason: 'Initial composition', members: payload.members }] };
                groups.push(group);
                return json(res, 201, { groupId: group.id });
            }
            const groupRevision = endpoint.match(/^\/actual\/groups\/(\d+)\/revisions$/);
            if (req.method === 'POST' && groupRevision) {
                let body = '';
                for await (const part of req) body += part;
                const payload = JSON.parse(body);
                const group = groups.find(item => item.id === groupRevision[1]);
                if (payload.expectedRevision !== group.revision) return json(res, 409, { error: 'Group composition changed; reload before revising' });
                group.revision += 1;
                group.members = payload.members;
                group.history.push({ revision_number: group.revision, reason: payload.reason, members: payload.members });
                return json(res, 201, { groupId: group.id, revision: group.revision });
            }
            const groupDetail = endpoint.match(/^\/actual\/groups\/(\d+)$/);
            if (req.method === 'GET' && groupDetail) {
                const group = groups.find(item => item.id === groupDetail[1]);
                const revenue = group.members.reduce((total, member) => total + (member.includePlanRevenue
                    ? BigInt(plans.find(plan => plan.id === String(member.planId)).revenue_minor) : 0n), 0n);
                const cost = group.members.reduce((total, member) => total + (member.includePlanDirectCost
                    ? BigInt(plans.find(plan => plan.id === String(member.planId)).direct_cost_minor) : 0n), 0n);
                return json(res, 200, { group, revision: group.revision, history: group.history.map(revision => ({
                    ...revision, members: revision.members.map(member => ({ plan_id: member.planId,
                        include_plan_revenue: member.includePlanRevenue, include_plan_direct_cost: member.includePlanDirectCost }))
                })), members: group.members.map(member => ({ planId: member.planId,
                    include_plan_revenue: member.includePlanRevenue, include_plan_direct_cost: member.includePlanDirectCost })),
                summary: { planned: { revenueMinor: String(revenue), directCostMinor: String(cost),
                    contributionMinor: String(revenue - cost) }, actualComplete: false, actualContributionMinor: null } });
            }
            const actualPlan = endpoint.match(/^\/actual\/plans\/(\d+)(?:\/(sources|completions))?$/);
            const correction = endpoint.match(/^\/actual\/sources\/(\d+)\/correct$/);
            if (actualPlan && req.method === 'GET' && !actualPlan[2]) {
                const target = plans.find(plan => String(plan.id) === actualPlan[1]);
                const watermarks = {};
                actualEntries.forEach(entry => { watermarks[entry.category] = entry.id; });
                return json(res, 200, { target, sources: actualSources,
                    entries: actualEntries, completions: completionEvents,
                    summary: summarizeTarget(target, actualSources, completionEvents, watermarks) });
            }
            if ((actualPlan && req.method === 'POST') || (correction && req.method === 'POST')) {
                let body = '';
                for await (const part of req) body += part;
                const payload = JSON.parse(body);
                if (actualPlan?.[2] === 'sources') {
                    const source = { id: String(actualSources.length + 1), external_id: payload.externalId,
                        economic_role: payload.economicRole, category: payload.category,
                        amount_minor: payload.amountMinor, evidence_state: payload.evidenceState, semantic: payload.semantic };
                    actualSources.push(source);
                    actualEntries.push({ ...source, id: String(actualEntries.length + 1), source_id: source.id, entry_type: 'record' });
                    return json(res, 201, { sourceId: source.id, idempotent: false });
                }
                if (actualPlan?.[2] === 'completions') {
                    const ids = actualEntries.filter(entry => entry.category === payload.category).map(entry => Number(entry.id));
                    completionEvents.push({ id: String(completionEvents.length + 1), category: payload.category,
                        is_complete: payload.isComplete, reason: payload.reason, evidence_entry_id: String(Math.max(0, ...ids)) });
                    return json(res, 201, { completionId: String(completionEvents.length) });
                }
                if (correction) {
                    const source = actualSources.find(item => item.id === correction[1]);
                    const old = { ...source };
                    actualEntries.push({ ...old, id: String(actualEntries.length + 1), source_id: source.id,
                        entry_type: 'reversal', amount_minor: String(-BigInt(old.amount_minor)), reason: payload.reason });
                    Object.assign(source, { amount_minor: payload.amountMinor, evidence_state: payload.evidenceState, semantic: payload.semantic });
                    actualEntries.push({ ...source, id: String(actualEntries.length + 1), source_id: source.id,
                        entry_type: 'record', reason: payload.reason });
                    return json(res, 201, { sourceId: source.id });
                }
            }
            if (req.method === 'POST' && ['/preview', '/plans'].includes(endpoint)) {
                let body = '';
                for await (const part of req) body += part;
                const payload = JSON.parse(body);
                const calculation = calculatePlan(definition, payload.inputs);
                if (endpoint === '/preview') return json(res, 200, { version: { id: '1', number: 1, effectiveFrom: version.effective_from }, calculation });
                assert.equal(payload.expectedVersionId, '1');
                plans.push({ id: String(plans.length + 1), execution_label: payload.executionLabel, execution_date: payload.executionDate,
                    template_name: template.name, version_number: 1, revenue_minor: calculation.revenueMinor,
                    direct_cost_minor: calculation.directCostMinor, contribution_minor: calculation.contributionMinor });
                return json(res, 201, { planId: String(plans.length), versionId: '1', calculation });
            }
            if (req.method === 'GET') {
                if (url.pathname.endsWith('/categories')) return json(res, 200, []);
                return json(res, 200, {});
            }
            return json(res, 405, { error: 'Unexpected synthetic request' });
        }
        if (url.pathname === '/finance') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(html.replace('</body>', `${boot}</body>`));
        }
        const file = path.resolve(root, `.${url.pathname}`);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
        res.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        browser = await chromium.launch({ headless: true,
            executablePath: 'C:\\Users\\Plotva\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe' });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
        await page.goto(`${origin}/finance?tab=costing`);
        await page.locator('#costTemplateSelect option[value="1"]').waitFor({ state: 'attached' });
        await page.locator('#costTemplateSelect').selectOption('1');
        await page.locator('#costExecutionLabel').fill('Урок 12 жовтня');
        await page.locator('#costExecutionDate').fill('2026-10-12');
        await page.locator('#costParticipants').fill('10');
        await page.locator('#costPaidParticipants').fill('8');
        await page.locator('#costHours').fill('2');
        await page.locator('#costDiscountPercent').fill('10');
        await page.locator('#costPreview').click();
        await page.locator('#costPreviewResult').getByText('1 002,00 ₴').waitFor();
        assert.match(await page.locator('#costPreviewResult').innerText(), /46\.39%/);
        await page.locator('#costSavePlan').click();
        await page.locator('#costPlanList').getByText('Урок 12 жовтня').waitFor();
        assert.equal(plans.length, 1);
        await page.locator('#costActualSummary').getByText('Ще не визначено').waitFor();
        await page.locator('#costSourceExternalId').fill('sale_ui');
        await page.locator('#costSourceRole').fill('lesson_sale');
        await page.locator('#costSourceCategory').selectOption('revenue');
        await page.locator('#costSourceAmount').fill('2160');
        await page.locator('#costSourceEvidence').selectOption('confirmed');
        await page.locator('#costAddSource').click();
        await page.locator('#costActualSummary').getByText('2 160,00 ₴').first().waitFor();
        assert.match(await page.locator('#costActualSummary').innerText(), /Ще не визначено/);
        await page.locator('#costSourceExternalId').fill('cost_ui');
        await page.locator('#costSourceRole').fill('lesson_cost');
        await page.locator('#costSourceCategory').selectOption('direct_cost');
        await page.locator('#costSourceAmount').fill('1158');
        await page.locator('#costAddSource').click();
        await page.locator('#costCompletionReason').fill('Synthetic revenue checked');
        await page.locator('#costCompletionConfirmed').check();
        await page.locator('#costCompleteCategory').click();
        await page.locator('#costCompletionCategory').selectOption('direct_cost');
        await page.locator('#costCompletionReason').fill('Synthetic costs checked');
        await page.locator('#costCompletionConfirmed').check();
        await page.locator('#costCompleteCategory').click();
        await page.locator('#costActualSummary').getByText('1 002,00 ₴').last().waitFor();
        await page.locator('#costCorrectionSource').selectOption('2');
        await page.locator('#costCorrectionAmount').fill('1200');
        await page.locator('#costCorrectionReason').fill('Verified corrected cost');
        await page.locator('#costCorrectSource').click();
        await page.locator('#costActualSummary').getByText('Ще не визначено').waitFor();
        assert.match(await page.locator('#costActualHistory').innerText(), /сторно/);
        await page.locator('#costCompletionReason').fill('Corrected cost checked');
        await page.locator('#costCompletionConfirmed').check();
        await page.locator('#costCompleteCategory').click();
        await page.locator('#costActualSummary').getByText('960,00 ₴').last().waitFor();
        await page.locator('#costLinkId').fill('booking_ui');
        await page.locator('#costLinkAmount').fill('2160');
        await page.locator('#costPreviewLink').click();
        await page.locator('#costLinkResult').getByText('Перевірено ID, бізнес і суму').waitFor();
        assert.match(await page.locator('#costLinkResult').innerText(), /не створює фактичного запису/);
        await page.locator('#costLinkType').selectOption('education_attendance');
        await page.locator('#costLinkId').fill('11');
        await page.locator('#costPreviewLink').click();
        await page.locator('#costLinkResult').getByText('Перевірено ID і бізнес; цей запис не містить суми').waitFor();
        assert.doesNotMatch(await page.locator('#costLinkResult').innerText(), /сума збігається/);
        assert.equal(actualSources.length, 2, 'read-only source preview must not add actual evidence');
        await page.locator('#costGroupLabel').fill('Курс синтетичних занять');
        await page.locator('#costGroupMembers [data-plan-id="1"] [data-include-revenue]').check();
        await page.locator('#costGroupMembers [data-plan-id="1"] [data-include-cost]').check();
        await page.locator('#costCreateGroup').click();
        await page.locator('#costGroupSummary').getByText('Курс синтетичних занять').waitFor();
        assert.equal(groups.length, 1);
        assert.match(await page.locator('#costGroupSummary').innerText(), /Ще не визначено/);
        await page.locator('#costGroupEditMembers [data-plan-id="1"] [data-include-cost]').uncheck();
        await page.locator('#costGroupRevisionReason').fill('Витрати обліковуються в іншій групі');
        await page.locator('#costSaveGroupRevision').click();
        await page.locator('#costGroupSummary').getByText('ревізія 2').waitFor();
        assert.equal(groups[0].history.length, 2);
        assert.match(await page.locator('#costGroupHistory').innerText(), /Ревізія 1[\s\S]*Ревізія 2/);
        assert.match(await page.locator('#costGroupHistory').innerText(), /Ревізія 2[\s\S]*без витрат/);
        await page.locator('#costCreateGroup').click();
        await page.locator('#costGroupStatus').getByText('Цей план або ID джерела вже прив’язаний до іншого виконання.').waitFor();
        assert.equal(groups.length, 1);
        await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 820, height: 1180 });
        const tabletBounds = await page.locator('#tabCosting .cost-card').evaluateAll(cards => cards.map(card => {
            const rect = card.getBoundingClientRect();
            return { left: rect.left, right: rect.right };
        }));
        assert.ok(tabletBounds.every(rect => rect.left >= 0 && rect.right <= 821), JSON.stringify(tabletBounds));
        await page.screenshot({ path: path.join(output, 'tablet.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
        assert.ok(await page.locator('#tabCosting').isVisible());
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ passed: true, contributionMinor: plans[0].contribution_minor,
            requests: requests.filter(r => r.path.startsWith('/api/finance/costing')), output }));
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
