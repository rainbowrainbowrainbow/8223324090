'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const contract=require('../services/staffSubstitutionContract');
const enabled=process.env.RUN_SUBSTITUTION_BROWSER==='true';

test('shared substitution form: desktop/mobile clicks, explicit pay choice and safe request replay',{skip:!enabled,timeout:90000},async()=>{
    const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
    const root=path.resolve(__dirname,'..');
    const output=path.join(root,'output','substitution-browser');
    await fs.mkdir(output,{recursive:true});
    const commands=[];
    let loseResponse=true;
    const server=http.createServer(async(req,res)=>{
        const url=new URL(req.url,'http://localhost');
        if(url.pathname==='/') {
            res.setHeader('Content-Type','text/html; charset=utf-8');
            return res.end(`<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
                <link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/modals.css"><link rel="stylesheet" href="/css/responsive.css">
                <body><main style="padding:24px"><h1>Синтетична перевірка підміни</h1><div id="staffSubstitutionActions">
                <button data-substitution-action="create">Людина на заміну</button><button data-substitution-action="list">Підміни</button></div></main>
                <script>window.canUseAction=()=>true;window.escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
                window.apiCall=async(method,url,body)=>{try{return await (await fetch('/fixture'+url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})).json()}catch{return null}};</script>
                <script src="/js/ui.js"></script><script src="/js/staff-substitution.js"></script></body></html>`);
        }
        if(url.pathname.startsWith('/fixture/')) {
            res.setHeader('Content-Type','application/json');
            if(url.pathname.endsWith('/catalog')) return res.end(JSON.stringify({success:true,data:{staff:[{id:2,name:'Синтетична менеджерка'}],professions:[{key:'reception',title:'Адміністратор'}],sources:[{key:'standalone',title:'Окрема робота'}]}}));
            let body='';for await(const chunk of req)body+=chunk;
            const payload=JSON.parse(body||'{}');
            if(url.pathname.endsWith('/preview')) return res.end(JSON.stringify({success:true,data:contract.preview(contract.normalizeInput(payload.input),{blockers:[],commitments:[],evidence:{fixture:true}})}));
            commands.push(payload);
            if(loseResponse){loseResponse=false;res.end('{"success":');return;}
            return res.end(JSON.stringify({success:true,data:{id:'1',state:'active'}}));
        }
        if(!/^\/(css|js)\/[a-z0-9/-]+\.(css|js)$/.test(url.pathname)){res.statusCode=404;return res.end();}
        try{res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':'text/css');res.end(await fs.readFile(path.join(root,url.pathname)));}
        catch{res.statusCode=404;res.end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
    try{
        for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844]]){
            const page=await browser.newPage({viewport:{width,height}});
            page.setDefaultTimeout(12000);
            const errors=[];page.on('pageerror',error=>errors.push(error.message));
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            const active=()=>page.locator('.form-modal-overlay:not(.confirm-exit)');
            await page.getByRole('button',{name:'Людина на заміну',exact:true}).click();
            await active().locator('[data-key="staffId"]').selectOption('2');
            await active().locator('[data-key="professionKey"]').selectOption('reception');
            await active().locator('[data-key="workDate"]').fill('2099-01-13');
            await active().locator('[data-key="workload"]').fill('Синтетична робота адміністратора');
            await active().locator('[data-key="reason"]').fill('Локальна перевірка');
            await page.screenshot({path:path.join(output,`${name}-work.png`),fullPage:true});
            await active().getByRole('button',{name:'Умови оплати',exact:true}).click();
            assert.equal(await active().locator('[data-key="payMode"]').inputValue(),'','pay mode must require an explicit choice');
            await active().locator('[data-key="payUnit"]').selectOption('fixed');
            await active().locator('[data-key="payMode"]').selectOption('additional');
            await active().locator('[data-key="temporaryAdmission"]').selectOption('true');
            await active().locator('[data-key="admissionReason"]').fill('Перевірені навички');
            await page.screenshot({path:path.join(output,`${name}-terms.png`),fullPage:true});
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no page horizontal overflow');
            await active().getByRole('button',{name:'Показати стандартну ставку'}).click();
            await active().locator('[data-key="rate"]').fill('750');
            await active().locator('[data-key="rateReason"]').fill('Разова погоджена сума');
            await active().getByRole('button',{name:'Попередній розрахунок'}).click();
            await page.getByRole('button',{name:'Погоджую наслідки та зберігаю'}).waitFor();
            await page.screenshot({path:path.join(output,`${name}-preview.png`),fullPage:true});
            const before=commands.length;
            await page.getByRole('button',{name:'Погоджую наслідки та зберігаю'}).click();
            await page.waitForFunction(()=>!document.querySelector('[data-substitution-action="create"]').disabled);
            if(name==='desktop'){
                await page.getByRole('button',{name:'Людина на заміну',exact:true}).click();
                await page.getByRole('button',{name:'Повторити запит',exact:true}).click();
                await page.waitForFunction(()=>!document.querySelector('[data-substitution-action="create"]').disabled);
                assert.equal(commands.length,before+2);
                assert.deepEqual(commands.at(-1),commands.at(-2),'lost-response retry preserves request identity and payload');
            }else assert.equal(commands.length,before+1);
            assert.deepEqual(errors,[]);
            assert.equal(await page.locator('[data-substitution-action="create"]').evaluate(el=>document.activeElement===el),true,'focus restored');
            await page.close();
        }
    }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
