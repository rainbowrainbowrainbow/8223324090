'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, 'output/playwright/sys-mb-legacy-containment');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
function source(file, start, end) {
    const code = read(file);
    const first = code.indexOf(start);
    const last = end ? code.indexOf(end, first) : code.length;
    if (first < 0 || last <= first) throw new Error(`Missing source boundary: ${file}`);
    return code.slice(first, last);
}
const helper = source('js/api.js', 'const legacyBusinessSurfaceDenials', 'function getCrmBusinessProfileForContext');
const productFunctions = source('js/programs-page.js', 'async function loadCatalogEntries()', '// PRODUCT FORM');
const templateFunctions = source('js/booking-form.js', '// v30.3: BOOKING TEMPLATES');

function bootstrap(mode = 'membership') {
    return `
window.AppState={currentUser:{id:1001,username:'synthetic.operator',role:'director',accessContext:{status:'ready'}}};
window.fixtureProfile={accessContext:{status:'ready'},membershipMode:${JSON.stringify(mode)},activeBusinessId:'event_genix'};
window.fixtureScope={mode:'single',activeContext:'event_genix',selectedContexts:['event_genix']};
window.getCrmBusinessOperatingProfile=()=>fixtureProfile;window.getCrmBusinessScope=()=>fixtureScope;
window.apiAuthAuthorizationFingerprint=u=>JSON.stringify(u);window.CRM_BUSINESS_SCOPE_SINGLE='single';window.CRM_BUSINESS_DEFAULT_CONTEXT='event_genix';
window.getAuthHeaders=()=>({'X-Business-Context':fixtureScope.activeContext});window.showNotification=()=>{};
window.fixtureSwitch=()=>{fixtureProfile.membershipMode='membership';fixtureProfile.activeBusinessId='dar';fixtureScope.activeContext='dar';fixtureScope.selectedContexts=['dar'];dispatchEvent(new CustomEvent('crmBusinessContextChanged'));};
${helper}
document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'light';
if(document.documentElement.dataset.theme==='dark')document.body.classList.add('dark-mode');
`;
}

function productHtml() {
    const html = read('programs.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    return html.replace('</body>', `<script>${bootstrap()}
document.getElementById('loginOverlay')?.remove();document.getElementById('mainApp').classList.remove('hidden');document.body.classList.add('shell-ready');document.documentElement.classList.add('shell-ready');
document.querySelectorAll('.product-tab-panel').forEach(el=>el.classList.add('hidden'));document.getElementById('catalogsPanel').classList.remove('hidden');
window.escapeHtml=s=>String(s||'');window.isParkProductsContext=()=>true;window.productBusinessScope=()=>fixtureScope;
window.getPermissionLifecycle=()=>({status:'ready'});window.canAccessPage=()=>true;window.getCatalogStatusLabel=()=> 'Готовий';
window.apiGetProductCatalogs=async()=>({catalogs:[{id:'graduation',title:'Випускні',description:'Синтетичний каталог випускних',href:'/designs#catalog-graduation'},{id:'private',title:'PRIVATE_LEGACY_SENTINEL'}],legacyCatalogs:getLegacyBusinessSurfaceAvailability('catalogs')});
window.apiCall=async()=>[{id:1},{id:2}];
let productCatalogRequest=0,productCatalogs=[],graduationCatalogPackageCount=null,catalogEntriesLoaded=false,productLegacyCatalogAvailability=null,productCatalogContext=null;
${productFunctions}
loadCatalogEntries();</script></body>`);
}

function templatesHtml() {
    return `<!doctype html><html lang="uk"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/dark-mode.css"><style>main{max-width:600px;margin:24px auto;padding:16px}select,textarea{width:100%;margin:12px 0}button{padding:12px;max-width:100%}.hidden{display:none}</style></head><body><main><h1>Шаблони бронювань</h1><button id="fixtureSwitch" type="button">Перемкнути бізнес</button><section id="bookingPanel" class="hidden"><select id="templateSelect" aria-label="Шаблон"></select><button id="saveTemplateBtn" type="button">Зберегти шаблон</button><textarea id="bookingNotes" aria-label="Примітки">Без змін</textarea></section></main><script>${bootstrap('compatibility')}
window.BookingForm={getFormData:()=>({})};window.promptModal=async()=>null;
window.fixtureCalls=[];window.fixtureHold=null;window.fixtureRelease=null;
window.fetch=async(url,options={})=>{fixtureCalls.push({url,method:options.method||'GET'});if(fixtureHold&&(!options.method||options.method==='GET'))return new Promise(resolve=>{fixtureRelease=()=>resolve({ok:true,json:async()=>[{id:1,name:'OLD_PRIVATE_TEMPLATE',notes:'PRIVATE_NOTE'}]});});return {ok:true,json:async()=>[{id:1,name:'Синтетичний шаблон',notes:'Синтетична примітка'}]};};
${templateFunctions}
document.addEventListener('DOMContentLoaded',()=>{document.getElementById('bookingPanel').classList.remove('hidden');document.getElementById('fixtureSwitch').onclick=fixtureSwitch;});
</script></body></html>`;
}

let server;
let baseUrl;
test.beforeAll(async () => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        let body;
        let type = 'text/html; charset=utf-8';
        if (pathname === '/programs') body = productHtml();
        else if (pathname === '/templates') body = templatesHtml();
        else {
            const file = path.resolve(ROOT, '.' + pathname);
            if (!file.startsWith(ROOT + path.sep) || !/^\/(css|images)\//.test(pathname) || !fs.existsSync(file)) {
                res.writeHead(404); res.end(); return;
            }
            body = fs.readFileSync(file); type = file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
        }
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
test.beforeEach(async ({ page }) => {
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

for (const theme of ['light', 'dark']) {
    for (const width of [390, 768, 1440]) {
        test(`legacy unavailable and scoped graduation remain usable: ${theme} ${width}`, async ({ page }) => {
            const errors = []; page.on('pageerror', error => errors.push(error.message));
            await page.setViewportSize({ width, height: 900 });
            await page.goto(`${baseUrl}/programs?theme=${theme}`);
            await expect(page.locator('#catalogsGrid [role="status"]')).toContainText('недоступний');
            await expect(page.locator('#catalogsGrid')).toContainText('Пакетів: 2');
            await expect(page.locator('#catalogsGrid')).not.toContainText('PRIVATE_LEGACY_SENTINEL');
            const constructor = page.locator('#catalogsGrid a[href="/graduation"]');
            await expect(constructor).toBeVisible();
            await constructor.focus(); await expect(constructor).toBeFocused();
            expect(await page.locator('#catalogsGrid').evaluate(el => el.scrollWidth <= el.clientWidth + 2)).toBe(true);
            await page.screenshot({ path: path.join(EVIDENCE, `catalogs-${theme}-${width}.png`), fullPage: true });
            await page.goto(`${baseUrl}/templates?theme=${theme}`);
            await expect(page.locator('#templateSelect')).toBeEnabled();
            await expect(page.locator('#templateSelect option')).toHaveCount(2);
            await page.evaluate(() => { fixtureHold = true; window.pendingTemplateLoad = BookingTemplates.load(); });
            await page.locator('#fixtureSwitch').click();
            await expect(page.locator('#templateSelect')).toBeDisabled();
            await expect(page.locator('#saveTemplateBtn')).toBeDisabled();
            await expect(page.locator('#bookingTemplateAvailability')).toContainText('недоступний');
            await page.evaluate(async () => { fixtureRelease(); await pendingTemplateLoad; });
            await expect(page.locator('#templateSelect option')).toHaveCount(1);
            await expect(page.locator('#bookingNotes')).toHaveValue('Без змін');
            expect(await page.evaluate(() => fixtureCalls.every(call => call.method === 'GET'))).toBe(true);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
            await page.screenshot({ path: path.join(EVIDENCE, `templates-${theme}-${width}.png`), fullPage: true });
            expect(errors).toEqual([]);
        });
    }
}
