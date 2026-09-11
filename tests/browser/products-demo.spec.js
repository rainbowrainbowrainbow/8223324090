'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, 'docs/workstreams/products-demo/evidence');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const description = 'Наявний опис тестового продукту. '.repeat(14);
const products = [
    { id: 'fixture-animation', businessContext: 'event_genix', domain: 'program', category: 'animation', name: 'Тестова анімація', description, price: 100, isPerChild: true, duration: 60, hosts: 1 },
    { id: 'fixture-cake', businessContext: 'event_genix', domain: 'kitchen', kitchenType: 'cake', category: 'cake', name: 'Тестовий торт', description, price: 0, servingUnit: '100 г', iconUrl: '/images/catalogs/graduation/super-party-banner.png' },
    { id: 'fixture-menu', businessContext: 'event_genix', domain: 'kitchen', kitchenType: 'menu', category: 'menu', name: 'Тестова позиція меню', description, price: null, servingUnit: 'порція', menuSection: 'Основні страви', promoDescription: description, ingredients: 'Синтетичний склад', iconUrl: '/missing.png' }
];
const services = [
    { id: 1, name: 'Вхід', category: 'extra', priceType: 'fixed', pricePerChild: 50, entryRule: { 10: 10, 50: 15 }, durationMin: 0 },
    { id: 2, name: 'Анімація', category: 'main', priceType: 'formula', pricePark: 600, durationMin: 60, description },
    { id: 3, name: 'Майстер-клас із довгою назвою для перевірки перенесення', category: 'masterclass', priceType: 'fixed', pricePerChild: 80, durationMin: 30, description }
];
const packages = ['super-party', 'science-party', 'fixture-no-image'].map((slug, i) => ({
    id: i + 1, slug, name: `Тестовий випускний ${i + 1}`, minKids: 7, maxKids: 50,
    totalPerChild: 250, totalDuration: 90, services: services.map(s => ({ serviceId: s.id, serviceName: s.name, durationMin: s.durationMin, pricePerChild: 80 }))
}));

function bootstrap() {
    return `
window.fixtureProducts=${JSON.stringify(products)}; window.fixturePackages=${JSON.stringify(packages)};
window.fixtureServices=${JSON.stringify(services)};
window.AppState={currentUser:{id:123456,name:'Fixture operator',username:'fixture',role:'animator'}};
localStorage.setItem('pzp_current_user', JSON.stringify(AppState.currentUser));
localStorage.setItem('pzp_products_active_tab_park_zakrevsky','kitchen');
window.getUserRole=()=>AppState.currentUser.role;
window.canAccess=()=>true; window.canAccessPage=()=>true;
window.getPermissionLifecycle=()=>({status:'ready'});
window.resolveCapability=()=>({allowed:true});
window.getStoredPreviewRole=()=>null;
window.CrmBusinessContext={normalize:v=>v||'event_genix',current:()=> 'event_genix',scope:()=>({mode:'single',activeContext:'event_genix'}),isReadOnly:()=>false,renderShell:()=>{},initPage:()=> 'event_genix'};
window.getAuthHeaders=()=>({}); window.API_BASE='/api';
window.showNotification=()=>{}; window.initDarkMode=()=>{};
window.apiHasStoredAuthSession=()=>true;
window.apiVerifyToken=async()=>AppState.currentUser;
window.hydrateBusinessOperatingProfile=async()=>{};
window.hydrateActionPermissions=async()=>({});
window.enforceCurrentPageAccess=()=>true;
window.bindLogoutButton=()=>{};
window.formatPrice=v=>new Intl.NumberFormat('uk-UA',{maximumFractionDigits:2}).format(Number(v))+' ₴';
window.apiGetProducts=async()=>fixtureProducts;
window.apiGetProductCatalogs=async()=>[{id:'graduation',title:'Випускні',href:'/designs#catalog-graduation',pageCount:2}];
window.apiCall=async(method,url)=>{if(method!=='GET')throw Error('Fixture forbids mutations'); if(url==='/graduation/services')return fixtureServices;if(url==='/graduation/packages')return fixturePackages;if(url==='/graduation/settings')return {};return [];};
window.apiFetch=async url=>({ok:true,json:async()=>url==='/api/graduation/packages'?fixturePackages:{pages:[{page_number:0,title:'Інший каталог',details:{},items:[]}]}});
window.esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
window.showAuthenticatedPageShell=()=>{document.getElementById('mainApp')?.classList.remove('hidden');Sidebar.markShellReady();};
document.getElementById('loginOverlay')?.remove();
`;
}

function fixtureHtml(page) {
    let html = read(`${page}.html`);
    const gradInit = page === 'graduation' ? [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
        .map(m => m[1]).find(s => s.includes('GradPage.init()')) : '';
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    html = html.replace('</head>', `<script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'light';</script></head>`);
    const common = `<script src="/fixture-bootstrap.js"></script><script>if(document.documentElement.dataset.theme==='dark')document.body.classList.add('dark-mode');</script><script src="/js/components/sidebar.js"></script>`;
    let scripts;
    if (page === 'programs') scripts = `<script src="/js/event-cards.js"></script><script src="/js/programs-page.js"></script><script>Sidebar.init('#sidebarLinks');</script>`;
    if (page === 'designs') scripts = `<script src="/js/designs-page.js"></script><script>Sidebar.init('#sidebarLinks');</script>`;
    if (page === 'graduation') scripts = `<script src="/js/graduation.js"></script><script>${gradInit}</script><script>Sidebar.markShellReady();</script>`;
    return html.replace('</body>', `${common}${scripts}</body>`);
}

let server, baseUrl;
test.beforeAll(async () => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        let body, type = 'text/html; charset=utf-8';
        if (['/programs', '/designs', '/graduation'].includes(url.pathname)) body = fixtureHtml(url.pathname.slice(1));
        else if (url.pathname === '/center') body = '<h1>Fixture destination</h1>';
        else if (url.pathname === '/fixture-parent') body = '<nav><a href="/programs">Parent products</a></nav><iframe title="Graduation" src="/graduation?embedded=1" style="width:100%;height:900px;border:0"></iframe>';
        else if (url.pathname === '/fixture-bootstrap.js') { type = 'application/javascript'; body = bootstrap(); }
        else if (url.pathname.startsWith('/api/')) {
            if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
            type = 'application/json';
            body = JSON.stringify(url.pathname === '/api/graduation/packages' ? packages
                : url.pathname === '/api/designs' ? { items: [], total: 0 }
                : ['/api/designs/collections', '/api/designs/tags'].includes(url.pathname) ? [] : {});
        }
        else {
            const file = path.resolve(ROOT, '.' + url.pathname);
            if (!file.startsWith(ROOT + path.sep) || !/^\/(css|js|images)\//.test(url.pathname) || !/\.(css|js|png|svg|jpg|webp)$/.test(file) || !fs.existsSync(file)) {
                res.writeHead(404); res.end(); return;
            }
            type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
            body = fs.readFileSync(file);
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
    test(`Products and catalog actual markup: ${theme}, three viewport widths`, async ({ page }) => {
        const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
        for (const width of [390, 768, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.goto(`${baseUrl}/programs?theme=${theme}`);
            await expect(page.locator('[data-id="fixture-animation"]')).toBeVisible();
            await page.locator('[data-product-route="#kitchen-cakes"]').click();
            await expect(page.locator('[data-id="fixture-cake"]')).toBeVisible();
            await page.locator('[data-id="fixture-cake"] .product-details summary').click();
            await expect(page.locator('[data-id="fixture-cake"] .product-detail-copy')).toContainText(description);
            const summary = page.locator('[data-id="fixture-cake"] .product-details summary');
            await summary.focus();
            await page.keyboard.press('Enter');
            await expect(page.locator('[data-id="fixture-cake"] details')).not.toHaveAttribute('open');
            await page.keyboard.press('Enter');
            await expect(summary).toBeFocused();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
            await page.screenshot({ path: path.join(EVIDENCE, `products-${theme}-${width}.png`), fullPage: true });
            await page.locator('[data-product-route="#kitchen-menu"]').click();
            await page.locator('[data-id="fixture-menu"] .product-details summary').click();
            await expect(page.locator('[data-id="fixture-menu"] .product-detail-media')).toContainText('Зображення недоступне');
            await page.goto(`${baseUrl}/designs?theme=${theme}#catalog-graduation`);
            await expect(page.locator('#catalogPages')).toContainText('ТЕСТОВИЙ ВИПУСКНИЙ 1');
            await page.locator('#catalogNextBtn').click();
            await expect(page.locator('#catalogPages')).toContainText('ТЕСТОВИЙ ВИПУСКНИЙ 2');
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
            await page.screenshot({ path: path.join(EVIDENCE, `catalog-${theme}-${width}.png`), fullPage: true });
            await page.keyboard.press('ArrowRight');
            await expect(page.locator('#catalogPages')).toContainText('ТЕСТОВИЙ ВИПУСКНИЙ 3');
            await expect(page.locator('.cat-hero-img')).toBeHidden();
            await page.reload();
            await expect(page.locator('#catalogPageIndicator')).toHaveText('1 / 3');
            await page.getByLabel('Закрити каталог', { exact: true }).click();
            await expect(page.locator('#catalogViewer')).toBeHidden();
            await expect(page.locator('#catalogPackageCount')).toHaveText('Пакетів: 3');
        }
        expect(errors).toEqual([]);
    });

    test(`Graduation standalone: ${theme} layout and shared sidebar navigation`, async ({ page }) => {
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        for (const width of [390, 768, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.goto(`${baseUrl}/graduation?theme=${theme}`);
            await expect(page.locator('.grad-controls')).toBeVisible();
            await expect(page.locator('.grad-service-card').first()).toBeVisible();
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
            await page.screenshot({ path: path.join(EVIDENCE, `graduation-${theme}-${width}.png`), fullPage: true });
            await page.locator('.grad-tab[data-tab="packages"]').click();
            await expect(page.locator('#gradContent')).toContainText('Тестовий випускний 2');
            await expect.poll(() => page.locator('.grad-packages-kids-row').evaluate(row => {
                const bounds = row.getBoundingClientRect();
                return [...row.children].filter(el => !el.hidden).every(el => {
                    const child = el.getBoundingClientRect();
                    return child.left >= bounds.left - 1 && child.right <= bounds.right + 1;
                });
            })).toBe(true);
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
            await page.screenshot({ path: path.join(EVIDENCE, `graduation-packages-${theme}-${width}.png`), fullPage: true });
        }
        const productGroup = page.locator('.sidebar-group-header[aria-controls="sidebarGroupItems-product"]');
        if (await productGroup.getAttribute('aria-expanded') !== 'true') await productGroup.click();
        await page.locator('#sidebarLinks a[href="/programs"]').click();
        await expect(page).toHaveURL(`${baseUrl}/programs`);
        await expect(page.locator('[data-id="fixture-animation"]')).toBeVisible();
        await page.goBack();
        await expect(page.locator('.grad-controls')).toBeVisible();
        await page.reload();
        await expect(page.locator('.grad-controls')).toBeVisible();
        await page.locator('.grad-info-btn').first().click();
        await expect(page.locator('#gradInfoModal')).toBeVisible();
        await page.locator('#gradInfoModal .grad-modal-close').click();
        await expect(page.locator('#gradInfoModal')).toBeHidden();
        for (const destination of ['/designs', '/center']) {
            const link = page.locator(`#sidebarLinks a[href="${destination}"]`).first();
            const header = page.locator('.sidebar-group').filter({ has: page.locator(`a[href="${destination}"]`) }).locator('.sidebar-group-header');
            if (await header.count() && await header.getAttribute('aria-expanded') !== 'true') await header.click();
            await link.click();
            await expect(page).toHaveURL(`${baseUrl}${destination}`);
            await page.goBack();
            await expect(page.locator('.grad-controls')).toBeVisible();
        }
        await page.goto(`${baseUrl}/programs?theme=${theme}#catalogs`);
        await page.locator('#catalogsGrid a[href="/graduation"]').click();
        await expect(page.locator('.grad-controls')).toBeVisible();
        await page.goto(`${baseUrl}/fixture-parent`);
        const embedded = page.frameLocator('iframe');
        await expect(embedded.locator('.grad-controls')).toBeVisible();
        await expect(embedded.locator('.sidebar-nav')).toBeHidden();
        await page.getByRole('link', { name: 'Parent products' }).click();
        await expect(page).toHaveURL(`${baseUrl}/programs`);
        expect(errors).toEqual([]);
    });
}
