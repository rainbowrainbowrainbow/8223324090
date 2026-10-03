'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, 'output/playwright/products-demo');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const description = 'Наявний опис тестового продукту. '.repeat(14);
const products = [
    { id: 'fixture-animation', businessContext: 'event_genix', domain: 'program', category: 'animation', name: 'Тестова анімація', description, price: 100, isPerChild: true, duration: 60, hosts: 1 },
    { id: 'fixture-cake', businessContext: 'event_genix', domain: 'kitchen', kitchenType: 'cake', category: 'cake', name: 'Тестовий торт', description, price: 0, servingUnit: '100 г', iconUrl: '/images/catalogs/graduation/super-party-banner.png' },
    { id: 'fixture-menu', businessContext: 'event_genix', domain: 'kitchen', kitchenType: 'menu', category: 'menu', name: 'Тестова позиція меню', description, price: null, servingUnit: 'порція', menuSection: 'Основні страви', promoDescription: description, ingredients: 'Синтетичний склад', iconUrl: '/missing.png' }
];
products.push(
    { ...products[2], id: 'fixture-menu-full', name: 'Картопля по-селянськи з соусом тартар — довга назва', shortDescription: 'Картопля, соус та зелень.', duration: 0, hosts: 0, isPerChild: false, hasFiller: false, price: 100, weightValue: '150/30 г', code: 'MENU-063', timelineCode: 'ME0063', availabilityStatus: 'active', techCard: 'Тестова техкарта', iconUrl: '/images/menu-fixture.svg', aiCardDraft: { imageStudio: { status: 'ready', imageUrl: '/images/menu-draft.svg' } } },
    { ...products[2], id: 'fixture-menu-empty', name: 'Тестова страва без фото', iconUrl: '' }
);
const menuFixtureSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><rect width="900" height="600" fill="#cbd5e1"/><rect x="5" y="5" width="890" height="590" fill="none" stroke="#0f766e" stroke-width="10"/><ellipse cx="385" cy="335" rx="280" ry="210" fill="white"/><ellipse cx="385" cy="335" rx="230" ry="170" fill="#e2e8f0"/><path d="M220 330L430 160L460 355Z M310 450L540 260L570 435Z M160 290L325 195L320 390Z" fill="#d97706" stroke="#92400e" stroke-width="12"/><circle cx="740" cy="410" r="100" fill="white"/><circle cx="740" cy="410" r="75" fill="#bbf7d0"/></svg>';

const menuAspectFixtures = { wide: [900, 600], square: [600, 600], portrait: [600, 900] };
function menuAspectSvg(aspect) {
    const [width, height] = menuAspectFixtures[aspect];
    const size = 80;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"><rect width="100%" height="100%" fill="#cbd5e1"/><ellipse cx="' + width / 2 + '" cy="' + height / 2 + '" rx="' + width * 0.35 + '" ry="' + height * 0.35 + '" fill="white"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="50">' + aspect + '</text>'
        + [[0, 0, '#ff0000'], [width-size, 0, '#00ff00'], [0, height-size, '#0000ff'], [width-size, height-size, '#ff00ff']].map(([x,y,color]) => '<rect x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" fill="' + color + '"/>').join('') + '</svg>';
}

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
window.AppState={currentUser:{id:123456,name:'Fixture operator',username:'fixture',role:new URLSearchParams(location.search).has('editor')?'creator':'animator'}};
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
window.fixtureWrites=[]; window.fixtureFailSave=false; window.fixtureAiRuns=0;
window.apiGetWarehouse=async()=>({items:[]});
window.apiGetProductTechCard=async()=>({success:true,techCard:{mode:'simple',ingredients:[]}});
window.apiGetProduct=async id=>fixtureProducts.find(product=>product.id===id);
window.apiUpdateProduct=async(id,payload)=>{fixtureWrites.push({kind:'update',payload});if(fixtureFailSave)return {success:false,error:'Synthetic save failure'};const index=fixtureProducts.findIndex(product=>product.id===id);fixtureProducts[index]={...fixtureProducts[index],...payload};return {success:true,product:fixtureProducts[index]};};
window.apiUpdateProductTechCard=async(id,payload)=>{fixtureWrites.push({kind:'tech',payload});return {success:true};};
window.apiGenerateProductMenuAiDraft=async()=>{fixtureAiRuns++;return {success:true,aiAvailable:false,reason:'Synthetic fallback',draft:{blocks:{nameDescription:{proposal:{name:'AI fixture',description:'AI fixture description',shortDescription:'AI fixture short'}},allergens:{proposal:{}},ingredients:{proposal:{}},priceCost:{proposal:{}}}}};};
window.apiGetProducts=async()=>fixtureProducts;
window.apiGetBurgerMenuImageBlueprint=async()=>({success:true,blueprint:null});
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
    const common = `${page === 'programs' ? '<script src="/js/ui.js"></script>' : ''}<script src="/fixture-bootstrap.js"></script><script>if(document.documentElement.dataset.theme==='dark')document.body.classList.add('dark-mode');</script><script src="/js/components/sidebar.js"></script>`;
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
        else if (['/images/menu-fixture.svg', '/images/menu-draft.svg'].includes(url.pathname)) { type = 'image/svg+xml'; body = menuFixtureSvg; }
        else if (/^\/images\/menu-aspect-(wide|square|portrait)\.svg$/.test(url.pathname)) { type = 'image/svg+xml'; body = menuAspectSvg(url.pathname.match(/menu-aspect-(\w+)/)[1]); }
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
            await page.locator('[data-id="fixture-menu"] [data-menu-details-open]').click();
            await expect(page.getByRole('dialog', { name: 'Страва: Тестова позиція меню' })).toBeVisible();
            await expect(page.locator('.kitchen-menu-details-dialog [data-photo-status]')).toContainText('Фото не вдалося завантажити');
            await page.keyboard.press('Escape');
            await expect(page.locator('[data-id="fixture-menu"] [data-menu-details-open]')).toBeFocused();
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


for (const theme of ['light', 'dark']) test(`Menu viewer: ${theme}, uncropped photos, stable grid and native dialog keyboard`, async ({ page }) => {
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
    const evidence = path.join(ROOT, 'output/playwright/menu-ux01');
    fs.mkdirSync(evidence, { recursive: true });
    for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${baseUrl}/programs?theme=${theme}&width=${width}#kitchen-menu`);
        const card = page.locator('[data-id="fixture-menu-full"]');
        await expect(card).toBeVisible();
        await expect(card.locator('img')).toHaveAttribute('alt', products[3].name);
        await expect(card.locator('[data-photo-state]')).toHaveAttribute('data-photo-state', 'ready');
        await expect(page.locator('[data-id="fixture-menu-empty"] [data-photo-status]')).toHaveText('Фото не задане');
        await expect(card.locator('.kitchen-detail-panel, .kitchen-menu-ai-actions')).toHaveCount(0);
        await card.scrollIntoViewIfNeeded();
        const before = await card.boundingBox();
        const media = await card.locator('.kitchen-product-media').boundingBox();
        expect(media.width / media.height).toBeCloseTo(1.5, 2);
        expect(await card.locator('img').evaluate(img => getComputedStyle(img).objectFit)).toBe('contain');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
        await card.scrollIntoViewIfNeeded();
        if (width !== 768) await page.screenshot({ path: path.join(evidence, `cards-${theme}-${width}.png`), fullPage: true });
        const opener = card.locator('[data-menu-details-open]');
        await opener.focus(); await page.keyboard.press('Enter');
        const details = card.locator('.kitchen-menu-details-dialog');
        await expect(details).toBeVisible();
        await expect(details.getByLabel('Закрити перегляд страви')).toBeFocused();
        await expect(details).toContainText('Тестова техкарта');
        await expect(details).toContainText('MENU-063');
        await expect(details.locator('img')).toHaveAttribute('src', products[3].iconUrl);
        const after = await card.boundingBox();
        expect(after.height).toBeCloseTo(before.height, 1);
        expect(after.width).toBeCloseTo(before.width, 1);
        const bounds = await details.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(await details.evaluate(el => el.scrollWidth <= el.clientWidth + 2)).toBe(true);
        if (width !== 768) await page.screenshot({ path: path.join(evidence, `details-${theme}-${width}.png`) });
        const photoOpener = details.locator('[data-menu-photo-url]');
        await photoOpener.click();
        const photo = page.locator('.kitchen-menu-photo-dialog');
        await expect(photo).toBeVisible();
        await expect(photo.locator('img')).toHaveAttribute('src', products[3].iconUrl);
        await expect(photo.locator('[data-photo-state]')).toHaveAttribute('data-photo-state', 'ready');
        expect(await photo.locator('img').evaluate(img => getComputedStyle(img).objectFit)).toBe('contain');
        if (width !== 768) await page.screenshot({ path: path.join(evidence, `photo-${theme}-${width}.png`) });
        await page.keyboard.press('Escape');
        await expect(photo).not.toBeVisible(); await expect(photoOpener).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(details).not.toBeVisible(); await expect(opener).toBeFocused();
        await opener.click(); await details.getByLabel('Закрити перегляд страви').click();
        await expect(opener).toBeFocused();
        await page.evaluate(() => { AppState.currentUser.role = 'creator'; renderProducts(); });
        await card.locator('[data-menu-image-open]').click();
        const studio = card.locator('.kitchen-menu-image-dialog');
        const previews = studio.locator('.kitchen-menu-image-previews [data-menu-photo-url]');
        await expect(previews).toHaveCount(2);
        for (const index of [0, 1]) {
            await previews.nth(index).click(); await expect(photo).toBeVisible();
            await expect(photo.locator('img')).toHaveAttribute('src', index === 0 ? products[3].iconUrl : products[3].aiCardDraft.imageStudio.imageUrl);
            await page.keyboard.press('Escape'); await expect(previews.nth(index)).toBeFocused();
        }
        await page.keyboard.press('Escape');
        await expect(card.locator('img').first()).toHaveAttribute('src', products[3].iconUrl);
    }
    expect(errors).toEqual([]); expect(writes).toEqual([]);
});

for (const theme of ['light', 'dark']) test(`Menu editor: ${theme}, modal form, dirty guard and retry on mobile/desktop`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const evidence = path.join(ROOT, 'output/playwright/menu-ux02'); fs.mkdirSync(evidence, { recursive: true });
    for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${baseUrl}/programs?theme=${theme}&editor=1&width=${width}#kitchen-menu`);
        const card = page.locator('[data-id="fixture-menu-full"]'), edit = card.getByRole('button', { name: '✏️ Редагувати', exact: true });
        await edit.scrollIntoViewIfNeeded(); const scroll = await page.evaluate(() => scrollY), before = await card.boundingBox();
        await edit.click();
        const editor = page.locator('#menuProductEditorModal'); await expect(editor).toBeVisible();
        await expect(page.locator('#pf-name')).toBeFocused();
        await expect(editor.locator('[data-menu-editor-retry]')).not.toBeVisible();
        for (const id of ['saveProductBtn','saveProductNextBtn','cancelProductBtn']) await expect(page.locator('#' + id)).toBeInViewport();
        await expect(page.locator('#menuProductEditorModal #productForm')).toHaveCount(1);
        expect(await page.locator('#productForm').count()).toBe(1);
        for (const id of ['pf-duration','pf-hosts','pf-age','pf-kids','pf-perchild','pf-filler','pf-category']) await expect(page.locator('#' + id)).not.toBeVisible();
        expect(await page.locator('#productForm input, #productForm textarea, #productForm select').evaluateAll(fields => fields.every(field => document.querySelectorAll('#' + field.id).length === 1))).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
        const bounds = await page.locator('.menu-product-editor-card').boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(await page.locator('.menu-product-editor-card').evaluate(el => el.scrollWidth <= el.clientWidth + 2)).toBe(true);
        expect((await card.boundingBox()).height).toBeCloseTo(before.height, 1);
        expect(await page.evaluate(() => scrollY)).toBe(scroll);
        await page.screenshot({ path: path.join(evidence, `editor-${theme}-${width}.png`) });
        await page.locator('#pf-name').fill('Незбережена тестова страва');
        await page.keyboard.press('Escape');
        const confirm = page.locator('.confirm-overlay[data-confirm-kind="confirm"]'); await expect(confirm).toBeVisible();
        await confirm.getByRole('button', { name: 'Повернутись', exact: true }).click();
        await expect(editor).toBeVisible(); await expect(page.locator('#pf-name')).toHaveValue('Незбережена тестова страва');
        await page.locator('#cancelProductBtn').click(); await expect(confirm).toBeVisible();
        await confirm.getByRole('button', { name: 'Закрити без збереження', exact: true }).click();
        await expect(editor).not.toBeVisible(); await expect(edit).toBeFocused(); expect(await page.evaluate(() => scrollY)).toBe(scroll);
        expect(await page.evaluate(() => fixtureWrites.length)).toBe(0);
        await edit.click();
        await page.locator('#pf-name').fill('Збережена тестова страва');
        await page.evaluate(() => { fixtureFailSave = true; });
        await page.locator('#saveProductBtn').click();
        await expect(page.locator('#saveProductBtn')).toBeEnabled(); await expect(editor).toBeVisible();
        await expect(page.locator('#pf-name')).toHaveValue('Збережена тестова страва');
        await page.evaluate(() => { fixtureFailSave = false; });
        await page.locator('#saveProductBtn').click(); await expect(editor).not.toBeVisible();
        const payloads = await page.evaluate(() => fixtureWrites.filter(write => write.kind === 'update'));
        expect(payloads).toHaveLength(2); expect(payloads[1].payload.hosts).toBe(0); expect(payloads[1].payload.duration).toBe(0);
        expect(payloads[1].payload.isPerChild).toBe(false); expect(payloads[1].payload.hasFiller).toBe(false);
        expect(payloads[1].payload.timelineCode).toBe('ME0063'); expect(payloads[1].payload.businessContext).toBe('event_genix');
        await expect(card.locator('img').first()).toHaveAttribute('src', products[3].iconUrl);
        await card.getByRole('button', { name: '✏️ Редагувати', exact: true }).click();
        await page.locator('[data-menu-form-group="additional"] summary').click();
        await expect(page.locator('#pf-timeline-code')).toBeVisible(); await expect(page.locator('#pf-tech-card')).toBeVisible();
        await page.locator('button').filter({ hasText: /^AI: опис$/ }).click();
        const ai = page.locator('#productAiReviewModal'); await expect(ai).toBeVisible();
        await page.locator('#productAiReviewCloseBtn').click(); await expect(ai).not.toBeVisible();
        await expect(editor).toBeVisible(); await expect(page.locator('#pf-name')).toHaveValue('Збережена тестова страва');
        expect(await page.evaluate(() => fixtureAiRuns)).toBe(1);
        await page.locator('#cancelProductBtn').click(); await expect(editor).not.toBeVisible();
    }
    expect(errors).toEqual([]);
});


test.describe('Menu responsive workflow', () => {
    test.use({ hasTouch: true });
    for (const theme of ['light', 'dark']) test(`${theme}: five widths, upload states and visible keyboard area`, async ({ page }) => {
        test.setTimeout(120000);
        const errors = [], externalWrites = [], measurements = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => { if (!['GET','HEAD'].includes(request.method())) externalWrites.push(request.url()); });
        const evidence = path.join(ROOT, 'output/playwright/menu-ux03'); fs.mkdirSync(evidence, { recursive: true });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const settle = () => page.evaluate(() => Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect.getComputedTiming().iterations)).map(animation => animation.finished.catch(() => {}))));
        async function fits(locator, width) {
            const bounds = await locator.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(-1); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
            expect(await locator.evaluate(el => el.scrollWidth <= el.clientWidth + 2)).toBe(true);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
        }
        async function touch(locator) {
            const bounds = await locator.boundingBox(); expect(bounds.width).toBeGreaterThanOrEqual(44); expect(bounds.height).toBeGreaterThanOrEqual(44);
        }
        for (const width of [360, 390, 430, 768, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto(`${baseUrl}/programs?theme=${theme}&editor=1#kitchen-menu`);
            const card = page.locator('[data-id="fixture-menu-full"]'); await expect(card).toBeVisible(); await settle();
            const grid=page.locator('#kitchenGrid'), nav=page.locator('#menuSectionFilter'), select=page.locator('#menuSectionSelect');
            await fits(grid,width); await fits(card,width);
            const gridBox = await grid.boundingBox(), cardBox = await card.boundingBox(), sidebarBox = await page.locator('.sidebar-nav').boundingBox();
            expect(cardBox.width).toBeLessThanOrEqual(gridBox.width+1);
            if (width > 768) expect(gridBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width);
            measurements.push({width,availableContentWidth:gridBox.width,cardWidth:cardBox.width,sidebarWidth:sidebarBox.width,sidebarLeft:sidebarBox.x,sectionFilterHeight:(await nav.boundingBox()).height});
            if (width <= 430) expect(await grid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
            if (width <= 720) {
                await expect(select).toBeVisible(); await touch(select);
                expect((await nav.boundingBox()).height).toBeLessThan(90);
                const choices=await select.locator('option').evaluateAll(options=>options.map(option=>option.value));
                expect(choices).toEqual(await page.evaluate(()=>['all',...getKnownMenuSections()]));
                await select.selectOption('Основні страви'); await expect(select).toHaveValue('Основні страви'); await expect(select).toBeFocused();
                await select.focus(); await select.press('Home'); await select.press('Enter'); await expect(select).toHaveValue('all');
            } else {
                await expect(select).not.toBeVisible(); const chip=nav.getByRole('button',{name:'Основні страви',exact:true});
                await touch(chip); await chip.focus(); await chip.press('Enter'); await expect(card).toBeVisible();
                await nav.getByRole('button',{name:'Усі розділи',exact:true}).click();
            }
            for (const selector of ['[data-menu-details-open]','[data-menu-image-open]','.card-actions button']) {
                for (const target of await card.locator(selector).all()) await touch(target);
            }
            await page.evaluate(()=>scrollTo(0,0)); await settle();
            await page.screenshot({path:path.join(evidence,`catalog-${theme}-${width}.png`),fullPage:true});
            await card.locator('[data-menu-details-open]').click();
            const viewer=card.locator('.kitchen-menu-details-dialog'); await expect(viewer).toBeVisible(); await fits(viewer,width);
            await touch(viewer.getByLabel('Закрити перегляд страви'));
            await page.screenshot({path:path.join(evidence,`viewer-${theme}-${width}.png`)});
            await viewer.locator('.kitchen-menu-photo-open').click(); const photo=page.locator('.kitchen-menu-photo-dialog');
            await fits(photo,width); expect(await photo.locator('img').evaluate(el=>getComputedStyle(el).objectFit)).toBe('contain');
            await photo.getByLabel('Закрити перегляд фото').click(); await page.keyboard.press('Escape');
            await expect(card.locator('[data-menu-details-open]')).toBeFocused();

            await card.getByRole('button',{name:'✏️ Редагувати',exact:true}).click();
            const editor=page.locator('.menu-product-editor-card'); await expect(editor).toBeVisible(); await fits(editor,width);
            await page.locator('#pf-allergens').fill('ДовгийПерелікАлергенів'.repeat(12));
            await page.locator('#pf-allergens').scrollIntoViewIfNeeded(); await fits(editor,width);
            for (const target of await editor.locator('.menu-allergen-chip').all()) await touch(target);
            for (const id of ['saveProductBtn','saveProductNextBtn','cancelProductBtn']) { await expect(page.locator('#'+id)).toBeInViewport(); await touch(page.locator('#'+id)); }
            await page.screenshot({path:path.join(evidence,`editor-${theme}-${width}.png`)});
            if (width <= 430) {
                // Deterministic visualViewport simulation, not proof of a physical phone keyboard.
                await page.evaluate(()=>{
                    Object.defineProperty(window.visualViewport,'height',{configurable:true,value:420});
                    Object.defineProperty(window.visualViewport,'offsetTop',{configurable:true,value:80});
                    window.visualViewport.dispatchEvent(new Event('resize'));
                });
                await page.locator('#pf-short-description').focus(); await page.locator('#pf-short-description').scrollIntoViewIfNeeded();
                const box=await editor.boundingBox(); expect(box.y).toBeGreaterThanOrEqual(80); expect(box.y+box.height).toBeLessThanOrEqual(501);
                for (const id of ['saveProductBtn','saveProductNextBtn','cancelProductBtn']) { const b=await page.locator('#'+id).boundingBox(); expect(b.y+b.height).toBeLessThanOrEqual(501); }
                await page.screenshot({path:path.join(evidence,`keyboard-area-${theme}-${width}.png`)});
                await page.locator('#cancelProductBtn').click();
                await page.locator('.confirm-overlay').getByRole('button',{name:'Закрити без збереження',exact:true}).click();
                await page.evaluate(()=>{delete window.visualViewport.height;delete window.visualViewport.offsetTop;window.visualViewport.dispatchEvent(new Event('resize'));});
            } else {
                await page.locator('#cancelProductBtn').click(); await page.locator('.confirm-overlay').getByRole('button',{name:'Закрити без збереження',exact:true}).click();
            }
            await expect(editor).not.toBeVisible();

            await page.evaluate(()=>{
                window.fixtureMediaRuns=0; window.fixtureManualCalls=[]; window.fixtureManualFail=true;
                window.apiGenerateProductMenuImage=async()=>{fixtureMediaRuns++;throw Error('Paid generation forbidden in geometry fixture');};
                window.apiCreateProductMenuExternalDraft=async(id,payload)=>{
                    fixtureManualCalls.push(payload);
                    if(fixtureManualFail)return {success:false,error:'Не вдалося зберегти фото. '.repeat(10)+'ДовгийКодБезПробілів'.repeat(15)};
                    const product=fixtureProducts.find(p=>p.id===id);
                    product.aiCardDraft={imageStudio:{status:'ready',imageUrl:'/images/menu-draft.svg'}};
                    return {success:true,product};
                };
            });
            await card.locator('[data-menu-image-open]').click(); const studio=card.locator('.kitchen-menu-image-dialog'); await expect(studio).toBeVisible();
            await fits(studio,width); const close=studio.getByLabel('Закрити редактор фото меню'); await touch(close);
            for (const preview of await studio.locator('.kitchen-menu-image-frame').all()) {
                const b=await preview.boundingBox(); expect(b.width/b.height).toBeCloseTo(1.5,2);
                expect(await preview.locator('img').evaluate(el=>getComputedStyle(el).objectFit)).toBe('contain');
            }
            await page.screenshot({path:path.join(evidence,`photo-previews-${theme}-${width}.png`)});
            const url=studio.locator('[data-menu-image-url]'), file=studio.locator('[data-menu-image-file]');
            await url.fill('https://example.invalid/synthetic-photo.png'); await url.press('Enter');
            await expect(studio.locator('[data-menu-image-manual-status]')).toContainText('ДовгийКодБезПробілів');
            await studio.locator('[data-menu-image-manual-status]').scrollIntoViewIfNeeded();
            await fits(studio,width); await expect(close).toBeInViewport();
            await page.screenshot({path:path.join(evidence,`upload-failed-${theme}-${width}.png`)});
            await page.evaluate(()=>{fixtureManualFail=false;}); await studio.locator('[data-menu-image-action="external-draft"]').click();
            await expect(studio.locator('[data-menu-image-manual-status]')).toHaveText('Чернетку збережено.');
            expect(await page.evaluate(()=>fixtureManualCalls.length)).toBe(2);
            await file.setInputFiles({name:'Довга-назва-фото-меню-для-перевірки-ширини.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
            await expect.poll(()=>page.evaluate(()=>fixtureManualCalls.length)).toBe(3);
            await expect(studio.locator('[data-menu-image-manual-status]')).toHaveText('Чернетку збережено.');
            expect(await page.evaluate(()=>fixtureManualCalls[2].imageBase64.startsWith('data:image/png;base64,'))).toBe(true);
            for (const state of ['loading','failed','cooldown','ready']) {
                await page.evaluate(state=>{
                    const id='fixture-menu-full', key=menuImageGenerationKey(getProductApiBusinessContext(),id);
                    const feedback=state==='failed'?{code:'menu_image_generation_failed',providerTaskId:'synthetic-task-'+'ДовгийКод'.repeat(24)}:state==='cooldown'?{code:'menu_image_generation_rate_limited',retryable:true}:null;
                    if(state==='ready')menuImageGenerationState.delete(key);
                    else menuImageGenerationState.set(key,{loadGeneration:productsLoadGeneration,inFlight:state==='loading',feedback,cooldownUntil:state==='cooldown'?Date.now()+60000:0});
                    refreshProductCard(id);syncKitchenMenuImageGenerationUi(key);
                },state);
                await fits(studio,width);
                const generate=studio.locator('[data-menu-image-action="generate"]');
                if(['loading','cooldown'].includes(state))await expect(generate).toBeDisabled();else await expect(generate).toBeEnabled();
                if(state==='failed'||state==='cooldown')await expect(url).toBeEnabled();
                if(state==='failed'||state==='cooldown')await studio.locator('[data-menu-image-generation-status]').scrollIntoViewIfNeeded();
                else await generate.scrollIntoViewIfNeeded();
                await expect(close).toBeInViewport();
                await touch(generate); await touch(url); await touch(file);
                await page.screenshot({path:path.join(evidence,`photo-${state}-${theme}-${width}.png`)});
            }
            if(width<=430) {
                await page.setViewportSize({width,height:480}); await url.focus(); await url.scrollIntoViewIfNeeded();
                await fits(studio,width); await expect(close).toBeInViewport();
                const b=await studio.boundingBox(); expect(b.y+b.height).toBeLessThanOrEqual(481);
                await page.screenshot({path:path.join(evidence,`photo-short-viewport-${theme}-${width}.png`)});
                await close.click(); await page.setViewportSize({width,height:900});
            } else await close.click();
            await expect(card.locator('[data-menu-image-open]')).toBeFocused();
            await expect(card.locator('img').first()).toHaveAttribute('src',products[3].iconUrl);
            expect(await page.evaluate(()=>fixtureMediaRuns)).toBe(0); expect(await page.evaluate(()=>fixtureWrites.length)).toBe(0);
        }
        fs.writeFileSync(path.join(evidence,`geometry-${theme}.json`),JSON.stringify(measurements,null,2));
        expect(errors).toEqual([]); expect(externalWrites).toEqual([]);
    });
});


for (const width of [360, 390, 768, 1440]) test('Menu aspect fixtures: ' + width + ', all four corners in card, preview and large photo', async ({ page }) => {
    const evidence = path.join(ROOT, 'output/playwright/menu-ux04');
    fs.mkdirSync(evidence, { recursive: true });
    const writes = [], errors = [];
    page.on('request', request => { if (!['GET','HEAD'].includes(request.method())) writes.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(baseUrl + '/programs?editor=1#kitchen-menu');
    await expect(page.locator('[data-id="fixture-menu-full"]')).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
    for (const [aspect, dimensions] of Object.entries(menuAspectFixtures)) {
        const imageUrl = '/images/menu-aspect-' + aspect + '.svg';
        await page.evaluate(url => {
            const product = fixtureProducts.find(p => p.id === 'fixture-menu-full');
            product.iconUrl = url;
            product.aiCardDraft = { imageStudio: { status: 'ready', imageUrl: url } };
            renderProducts();
        }, imageUrl);
        const card = page.locator('[data-id="fixture-menu-full"]');
        const photo = card.locator('.kitchen-product-media').first();
        await expect(photo.locator('img')).toHaveAttribute('src', imageUrl);
        await expect(photo).toHaveAttribute('data-photo-state','ready');
        expect(await photo.locator('img').evaluate(img => [img.naturalWidth,img.naturalHeight])).toEqual(dimensions);
        await photo.screenshot({ path: path.join(evidence, aspect + '-card-' + width + '.png') });
        await card.locator('[data-menu-details-open]').click();
        const details = card.locator('.kitchen-menu-details-dialog');
        await details.locator('[data-menu-photo-url]').click();
        const large = page.locator('.kitchen-menu-photo-dialog');
        await expect(large.locator('[data-photo-state]')).toHaveAttribute('data-photo-state','ready');
        await large.screenshot({ path: path.join(evidence, aspect + '-large-' + width + '.png') });
        await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
        await card.locator('[data-menu-image-open]').click();
        const studio = card.locator('.kitchen-menu-image-dialog');
        await expect(studio).toBeVisible();
        const frames = studio.locator('.kitchen-menu-image-frame');
        await expect(frames).toHaveCount(2);
        for (const index of [0,1]) {
            await expect(frames.nth(index).locator('img')).toHaveAttribute('src',imageUrl);
            await expect(frames.nth(index)).toHaveAttribute('data-photo-state','ready');
            await frames.nth(index).screenshot({ path:path.join(evidence, aspect + '-' + (index===0?'current':'draft') + '-' + width + '.png') });
        }
        await page.keyboard.press('Escape');
        await expect(card.locator('img').first()).toHaveAttribute('src',imageUrl);
    }
    expect(errors).toEqual([]); expect(writes).toEqual([]);
    expect(await page.evaluate(() => fixtureWrites.length)).toBe(0);
});


test('Menu editor regression: program, cake and Maysternya retain the shared inline form', async ({ page }) => {
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    for(const width of [390,1440]) {
        await page.setViewportSize({width,height:1000});
        await page.goto(baseUrl+'/programs?editor=1&regressionWidth='+width+'#kitchen-menu');
        const menu=page.locator('[data-id="fixture-menu-full"]'); await expect(menu).toBeVisible();
        await menu.getByRole('button',{name:'✏️ Редагувати',exact:true}).click();
        await expect(page.locator('#menuProductEditorModal')).toBeVisible();
        await page.locator('#cancelProductBtn').click();
        await page.evaluate(async()=>{await setProductTab('programs');await openProductForm('fixture-animation');});
        await expect(page.locator('#programsPanel #productForm')).toBeVisible();
        await expect(page.locator('#pf-duration')).toBeVisible(); await expect(page.locator('#pf-duration')).toHaveValue('60');
        await expect(page.locator('#pf-hosts')).toHaveValue('1'); await expect(page.locator('#pf-perchild')).toBeChecked();
        expect(await page.locator('#productForm [data-menu-form-group]').count()).toBe(0);
        await page.evaluate(async()=>{await closeProductForm();await setProductTab('kitchen');await setKitchenTab('cake');await openProductForm('fixture-cake');});
        await expect(page.locator('#kitchenPanel #productForm')).toBeVisible();
        await expect(page.locator('#pf-domain')).toHaveValue('kitchen'); await expect(page.locator('#pf-category')).toHaveValue('cake');
        await expect(page.locator('.cake-decoration-field')).toBeVisible();
        await page.evaluate(async()=>{await closeProductForm();await applyProductBusinessContext('maysternya_doli');await openProductForm();});
        await expect(page.locator('#maysternyaPanel #productForm')).toBeVisible();
        expect(await page.locator('#productForm').count()).toBe(1);
        expect(await page.locator('#productForm [data-menu-form-group]').count()).toBe(0);
        await expect(page.locator('#menuProductEditorModal')).not.toBeVisible();
        await page.locator('#cancelProductBtn').click();
        expect(await page.evaluate(()=>fixtureWrites.length)).toBe(0);
    }
    expect(errors).toEqual([]);
});
