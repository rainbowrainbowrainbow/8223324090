'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/programs-page.js'), 'utf8');
const menu = (id = 'burger-1', section = 'Бургери') => ({
    id, code: id, timelineCode: id.endsWith('1') ? 'B1' : 'B2', businessContext: 'event_genix', domain: 'kitchen', kitchenType: 'menu', category: 'menu', sortOrder: 0, isActive: true,
    name: 'Тестовий бургер ' + id, menuSection: section, price: 420, servingUnit: 'порція',
    weightValue: '320 г', ingredients: 'Синтетичний склад', allergens: ['milk'],
    description: 'Повний синтетичний опис', techCard: 'Технологічна карта',
    iconUrl: '/uploads/catalog-images/items/current.jpg'
});
function harness(products = [menu(), menu('burger-2', 'Салати')], role = 'creator') {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'programs.html'), 'utf8'), {
        url: 'http://localhost/programs#kitchen-menu', runScripts: 'outside-only', pretendToBeVisual: true
    });
    const w = dom.window, notifications = [], calls = { products: 0, product: 0 };
    let now=1000000, nextTimer=1;
    const timers=new Map();
    w.Date.now=()=>now;
    w.setTimeout=(callback,delay=0)=>{const id=nextTimer++;timers.set(id,{callback,at:now+delay});return id;};
    w.clearTimeout=id=>timers.delete(id);
    const clock={timers,async advance(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}for(let i=0;i<20;i++)await Promise.resolve();}};
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.scrollTo = () => {};
    w.AppState = { currentUser: { role } };
    w.getUserRole = () => role;
    w.canAccess = () => true;
    w.resolveCapability = () => ({ allowed: true });
    w.CrmBusinessContext = { normalize: value => value || 'event_genix', current: () => 'event_genix',
        scope: () => ({ mode: 'single', activeContext: 'event_genix' }), isReadOnly: () => false };
    w.formatPrice = value => `${value} ₴`;
    w.showNotification = (message, type) => notifications.push({ message, type });
    w.EventCards = { renderEventCardImage: () => '' };
    w.apiGetProducts = async () => { calls.products++; return products; };
    w.apiGetProduct = async id => { calls.product++; return products.find(p => p.id === id); };
    w.apiGetBurgerMenuImageBlueprint = async () => ({ success: true, blueprint: null });
    w.apiGetProductMenuImageStatus = async () => { throw new Error('No real status reads'); };
    vm.runInContext(source.replace("document.addEventListener('DOMContentLoaded', initPage);", ''), dom.getInternalVMContext());
    w.bindProductBlueprintLifecycle();
    w.fixture = products;
    w.eval("allProducts = fixture; activeProductTab='kitchen'; activeKitchenTab='menu'; activeMenuSection='all'; productsLoadState='ready'; renderProducts();");
    const card = id => [...w.document.querySelectorAll('.kitchen-product-card')].find(c => c.dataset.id === id);
    const open = (id, kind = 'photo') => {
        const panel = card(id).querySelector(kind === 'photo' ? '.kitchen-menu-image-disclosure' : '.product-details:not(.kitchen-menu-image-disclosure)');
        if (kind === 'photo') {
            w.openKitchenMenuImageStudio(id, panel.querySelector('[data-menu-image-open]'));
            return panel.querySelector('.kitchen-menu-image-dialog');
        }
        panel.open = true; w.hydrateProductPanel(panel); return panel;
    };
    return { w, dom, calls, clock, notifications, card, open, close: () => {
        w.dispatchEvent(new w.PageTransitionEvent('pagehide')); dom.window.close();
    } };
}

const pending = (id = 'burger-1', preparedAt = '2026-10-02T20:00:00Z', taskId = 'fixture-task-1') => ({
    ...menu(id), aiCardDraft: { imageStudio: { status: 'generating', provider: 'kie', preparedAt, taskId } }
});
const completed = (p, status = 'ready') => ({ ...p, name: 'Fixture ' + status, aiCardDraft: { imageStudio: {
    ...p.aiCardDraft.imageStudio, status, taskId: null, imageUrl: status === 'ready' ? '/uploads/draft.jpg' : null
} } });
const deferred = () => { let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve}; };
async function track(h, id='burger-1') { h.open(id); await h.w.resumeKitchenMenuImageTracking(id); await h.clock.advance(0); }

test('absent URL creates no loader or image, and persisted failed generation is separate', () => {
    const p={...completed(pending(),'failed'),iconUrl:''}, h=harness([p]);
    try {
        const media=h.card(p.id).querySelector('.kitchen-product-media');
        assert.equal(media.dataset.photoState,'absent'); assert.equal(media.querySelector('img'),null);
        assert.match(media.textContent,/Фото не задане/); assert.match(h.card(p.id).textContent,/Не вдалося створити AI-чернетку/);
        h.open(p.id); assert.equal(h.w.document.querySelector('[data-menu-image-action="generate"]').disabled,false);
    } finally {h.close();}
});

test('transport loading/ready/error states survive unrelated partial updates and reset for a new URL', () => {
    const h=harness(); try {
        const card=h.card('burger-1'), media=card.querySelector('.kitchen-product-media'), image=media.querySelector('img');
        assert.equal(media.dataset.photoState,'loading'); h.w.productMenuCardHandleImageLoad(image); assert.equal(media.dataset.photoState,'ready');
        h.w.productMenuCardHandleImageError(image); assert.equal(media.dataset.photoState,'error'); assert.match(media.textContent,/не вдалося завантажити/);
        h.w.fixtureUpdate={...menu(),price:999};h.w.eval("updateProductInState(fixtureUpdate);refreshProductCard('burger-1');");
        assert.equal(card.querySelector('.kitchen-product-media'),media); assert.equal(media.dataset.photoState,'error'); assert.equal(image.getAttribute('src'),null);
        h.w.fixtureUpdate={...menu(),iconUrl:'/uploads/new.jpg'};h.w.eval("updateProductInState(fixtureUpdate);refreshProductCard('burger-1');");
        assert.equal(media.dataset.photoState,'loading');assert.equal(media.querySelector('img').getAttribute('src'),'/uploads/new.jpg');
        const photo=h.open('burger-1'), preview=photo.querySelector('[data-photo-state]'), previewImage=preview.querySelector('img');
        h.w.productMenuCardHandleImageError(previewImage);h.w.eval("refreshProductCard('burger-1');");
        assert.equal(preview.dataset.photoState,'error');
    }finally{h.close();}
});

test('pending Kie job is collected automatically once without another paid generation', async () => {
    const p=pending(),h=harness([p]);try{
        let reads=0, paid=0;
        h.w.apiGetProductMenuImageStatus=async()=>{reads++;return{success:true,status:'ready',product:completed(p)}};
        h.w.apiGenerateProductMenuImage=async()=>{paid++;throw Error('Unexpected paid generation')};
        for(let i=0;i<3;i++){h.w.renderProducts();h.open(p.id);h.w.resumePendingKitchenMenuImageJobs();}
        await h.clock.advance(0);
        assert.equal(reads,1);assert.equal(paid,0);assert.equal(h.clock.timers.size,0);
        const panel=h.open(p.id);
        assert.equal(panel.querySelector('[data-menu-image-action="apply"]').disabled,false);
        assert.equal(h.w.eval('allProducts[0].iconUrl'),p.iconUrl);
        assert.equal(h.w.eval('getMenuImageStudioDraft(allProducts[0]).imageUrl'),'/uploads/draft.jpg');
    }finally{h.close();}
});

for(const status of ['ready','failed'])test(`explicit tracking ${status} preserves cards and fields, stops every timer`, async()=>{
    const p=pending(),h=harness([p,menu('burger-2')]);try{
        let calls=0;const first=h.card(p.id),other=h.card('burger-2'),panel=h.open(p.id),input=panel.querySelector('[data-menu-image-url]');input.value='unsaved';
        h.w.apiGetProductMenuImageStatus=async()=>{calls++;return{success:status==='ready',status,product:completed(p,status),code:'menu_image_generation_failed',providerCode:'fixture-fail',providerTaskId:'fixture-task-1'}};
        await track(h);assert.equal(calls,1);assert.equal(h.card(p.id),first);assert.equal(h.card('burger-2'),other);assert.equal(input.value,'unsaved');
        assert.equal(h.clock.timers.size,0);assert.equal(panel.querySelector('[data-menu-image-action="track"]'),null);
        assert.equal(panel.querySelector('[data-menu-image-action="generate"]').disabled,false);
        if(status==='failed')assert.match(panel.textContent,/fixture-fail/);else assert.equal(panel.querySelector('[data-menu-image-action="apply"]').disabled,false);
    }finally{h.close();}
});

test('pending responses and repeated clicks/renders maintain exactly one poll timer',async()=>{
    const p=pending(),h=harness([p]);try{
        let calls=0;h.w.apiGetProductMenuImageStatus=async()=>{calls++;return{success:true,status:'generating',product:p}};
        await track(h);assert.equal(calls,1);assert.equal(h.clock.timers.size,1);
        for(let i=0;i<5;i++){await h.w.resumeKitchenMenuImageTracking(p.id);h.w.renderProducts();h.w.resumePendingKitchenMenuImageJobs();}
        assert.equal(h.clock.timers.size,1);await h.clock.advance(4000);assert.equal(calls,2);assert.equal(h.clock.timers.size,1);
    }finally{h.close();}
});

test('closing the photo dialog keeps tracking and collects the completed draft',async()=>{
    const p=pending(),h=harness([p]);try{
        const response=deferred();let reads=0;
        h.w.apiGetProductMenuImageStatus=async()=>{reads++;return response.promise};
        const dialog=h.open(p.id);await h.clock.advance(0);
        assert.equal(reads,1);h.w.closeKitchenMenuImageStudio(dialog);
        assert.equal(dialog.open,false);
        response.resolve({success:true,status:'ready',product:completed(p)});
        await h.clock.advance(0);
        assert.equal(h.w.eval('getMenuImageStudioDraft(allProducts[0]).status'),'ready');
        assert.equal(h.w.eval('allProducts[0].iconUrl'),p.iconUrl);
        assert.equal(h.clock.timers.size,0);
    }finally{h.close();}
});

for(const transition of ['filter','tab','context','pagehide','visibility','reload','job'])test(`${transition} cancels an in-flight read and ignores its stale result`,async()=>{
    const p=pending(),h=harness([p,menu('burger-2')]);try{
        const response=deferred();let calls=0,signal;
        h.w.apiGetProductMenuImageStatus=async(id,options)=>{calls++;signal=options.signal;return response.promise};
        await track(h);assert.equal(calls,1);const card=h.card(p.id);assert.equal(h.clock.timers.size,1);
        if(transition==='filter')h.w.eval("activeMenuSection='Салати';renderProducts();");
        if(transition==='tab')h.w.eval("activeProductTab='programs';renderProducts();");
        if(transition==='context')h.w.eval("activeBusinessContext='maysternya';renderProducts();");
        if(transition==='pagehide')h.w.dispatchEvent(new h.w.PageTransitionEvent('pagehide'));
        if(transition==='visibility'){Object.defineProperty(h.w.document,'hidden',{configurable:true,get:()=>true});h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));}
        if(transition==='reload')h.w.eval("productsLoadGeneration++;productsLoadState='loading';renderProducts();");
        if(transition==='job'){h.w.nextJob=pending(p.id,'2026-10-02T20:01:00Z','fixture-task-2');h.w.eval('updateProductInState(nextJob);renderProducts();');}
        assert.equal(signal.aborted,true);
        response.resolve({success:true,status:'ready',product:completed(p)});await h.clock.advance(0);
        assert.equal(card.textContent.includes('Fixture ready'),false);assert.equal(h.w.eval("allProducts[0].name"),p.name);
        if(transition==='filter'||transition==='tab'){
            h.w.eval("activeProductTab='kitchen';activeMenuSection='all';renderProducts();");
            await h.clock.advance(0);
            assert.equal(calls,2,'return automatically checks the existing task');
            assert.equal(h.w.eval('allProducts[0].iconUrl'),p.iconUrl);
        }
    }finally{h.close();}
});

test('unresolved request has a bounded timeout without treating timeout as generation failure',async()=>{
    const p=pending(),h=harness([p]);try{
        let calls=0,signal;h.w.apiGetProductMenuImageStatus=async(id,options)=>{calls++;signal=options.signal;return new Promise(()=>{})};
        await track(h);await h.clock.advance(15000);assert.equal(signal.aborted,true);assert.equal(h.clock.timers.size,1);
        assert.match(h.open(p.id).textContent,/Повторюємо без запуску нової генерації/);
        await h.clock.advance(4000);assert.equal(calls,2);await h.clock.advance(15000);
        await h.clock.advance(8000);assert.equal(calls,3);await h.clock.advance(15000);
        const panel=h.open(p.id);assert.match(panel.textContent,/Не вдалося перевірити стан після кількох спроб/);
        assert.equal(panel.querySelector('[data-menu-image-action="track"]').disabled,false);
        assert.equal(h.w.eval("getMenuImageStudioDraft(allProducts[0]).status"),'generating');
        assert.equal(h.clock.timers.size,0);
    }finally{h.close();}
});

test('temporary status failure retries only status reads and offers a manual fallback',async()=>{
    const h=harness([pending()]);try{
        let calls=0;h.w.apiGetProductMenuImageStatus=async()=>{calls++;throw new Error('fixture network failure')};await track(h);
        assert.match(h.open('burger-1').textContent,/Повторюємо без запуску нової генерації/);
        await h.clock.advance(4000);await h.clock.advance(8000);
        assert.equal(calls,3);assert.equal(h.clock.timers.size,0);
        assert.match(h.open('burger-1').textContent,/Не вдалося перевірити стан після кількох спроб/);
        assert.ok(h.open('burger-1').querySelector('[data-menu-image-action="track"]'));
    }finally{h.close();}
});

test('response belonging to another job is never applied',async()=>{
    const p=pending(),h=harness([p]);try{
        h.w.apiGetProductMenuImageStatus=async()=>({success:true,status:'ready',product:completed(pending(p.id,'2026-10-02T20:05:00Z','other-job'))});
        await track(h);assert.equal(h.w.eval('allProducts[0].name'),p.name);
        assert.match(h.open(p.id).textContent,/Запізнілий результат не застосовано/);assert.equal(h.clock.timers.size,0);
    }finally{h.close();}
});

test('tracking session budget stops even when requests keep returning pending',async()=>{
    const h=harness([pending()]);try{
        h.w.apiGetProductMenuImageStatus=async()=>({success:true,status:'generating',product:pending()});await track(h);
        await h.clock.advance(16*60*1000);assert.equal(h.clock.timers.size,0);
        assert.match(h.open('burger-1').textContent,/Не вдалося підтвердити результат за відведений час/);
        assert.ok(h.open('burger-1').querySelector('[data-menu-image-action="track"]'));
    }finally{h.close();}
});

test('late generation submission cannot replace a new dataset or start tracking after navigation',async()=>{
    const h=harness();try{
        const response=deferred(),p=menu();h.open(p.id);h.w.apiGenerateProductMenuImage=async()=>response.promise;
        const request=h.w.generateKitchenMenuImage(p.id,h.card(p.id).querySelector('[data-menu-image-action="generate"]'));
        h.w.dispatchEvent(new h.w.PageTransitionEvent('pagehide'));response.resolve({success:true,status:'generating',product:pending()});await request;
        assert.equal(h.w.eval('allProducts[0].name'),p.name);assert.equal(h.clock.timers.size,0);
    }finally{h.close();}
});

test('read-only role cannot resume a mutating status check',async()=>{
    const h=harness([pending()],'animator');try{
        let calls=0;h.w.apiGetProductMenuImageStatus=async()=>{calls++;return{}};await h.w.resumeKitchenMenuImageTracking('burger-1');await h.clock.advance(60000);
        assert.equal(calls,0);assert.equal(h.card('burger-1').querySelector('[data-menu-image-action="track"]'),null);
    }finally{h.close();}
});

test('cooldown timer is paused with an inactive card and resumes once on return',async()=>{
    const h=harness();try{
        h.open('burger-1');h.w.apiGenerateProductMenuImage=async()=>({success:false,code:'menu_image_generation_rate_limited',retryable:true,retryAfterSeconds:20});
        await h.w.generateKitchenMenuImage('burger-1',h.card('burger-1').querySelector('[data-menu-image-action="generate"]'));
        assert.equal(h.clock.timers.size,1);h.w.eval("activeProductTab='programs';renderProducts();");assert.equal(h.clock.timers.size,0);
        h.w.eval("activeProductTab='kitchen';renderProducts();");assert.equal(h.clock.timers.size,1);
        for(let i=0;i<3;i++)h.w.renderProducts();assert.equal(h.clock.timers.size,1);await h.clock.advance(20010);
        assert.equal(h.clock.timers.size,0);assert.equal(h.card('burger-1').querySelector('[data-menu-image-action="generate"]').disabled,false);
    }finally{h.close();}
});

test('status transport forwards AbortSignal and preserves existing provider diagnostics',async()=>{
    const api=fs.readFileSync(path.join(root,'js/api.js'),'utf8'),start=api.indexOf('async function apiGetProductMenuImageStatus('),end=api.indexOf('\nasync function ',start+10);
    const controller=new AbortController();let signal;
    const context=vm.createContext({API_BASE:'/api',URLSearchParams,getAuthHeaders:()=>({}),handleAuthError:()=>false,
        addProductBusinessContextParam:(params,value)=>params.set('businessContext',value),getProductBusinessContextValue:options=>options.businessContext,
        apiNetworkFetch:async(url,options)=>{signal=options.signal;return{ok:false,json:async()=>({status:'failed',providerCode:'fixture-code',providerTaskId:'fixture-task'})}},console:{error(){throw Error('Unexpected abort logging')}}});
    vm.runInContext(api.slice(start,end),context);const result=await context.apiGetProductMenuImageStatus('fixture',{businessContext:'event_genix',signal:controller.signal});
    assert.equal(signal,controller.signal);assert.equal(result.providerCode,'fixture-code');assert.equal(result.providerTaskId,'fixture-task');
    context.apiNetworkFetch=async()=>{throw Error('Abort fixture')};controller.abort();const cancelled=await context.apiGetProductMenuImageStatus('fixture',{signal:controller.signal});assert.equal(cancelled.aborted,true);
});

test('bfcache return resumes status checks without a second paid request',async()=>{
    const h=harness([pending()]);try{
        let calls=0;h.w.apiGetProductMenuImageStatus=async()=>{calls++;return{success:true,status:'generating',product:pending()}};await track(h);
        h.w.dispatchEvent(new h.w.PageTransitionEvent('pagehide'));h.w.dispatchEvent(new h.w.PageTransitionEvent('pageshow',{persisted:true}));await h.clock.advance(0);
        const panel=h.open('burger-1');assert.equal(panel.querySelector('[data-menu-image-action="track"]'),null);
        assert.match(panel.textContent,/Kie обробляє фото/);assert.equal(calls,2);
    }finally{h.close();}
});
