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
    const index = await fs.readFile(path.join(root, 'index.html'), 'utf8');
    const darActions = index.match(/<div id="staffSubstitutionActions"[^>]+>[\s\S]*?<\/div>/)[0];
    const commands=[];
    let loseResponse=true;
    const server=http.createServer(async(req,res)=>{
        const url=new URL(req.url,'http://localhost');
        if(url.pathname==='/') {
            res.setHeader('Content-Type','text/html; charset=utf-8');
            const dar = url.searchParams.has('dar');
            return res.end(`<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
                <link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/modals.css"><link rel="stylesheet" href="/css/responsive.css"><link rel="stylesheet" href="/css/education-schedule.css">
                <body><main style="padding:24px"><h1>Синтетична перевірка підміни</h1>${dar ? darActions : '<div id="staffSubstitutionActions"><button data-substitution-action="create">Людина на заміну</button><button data-substitution-action="list">Підміни</button></div>'}</main>
                <script>if (${dar}) window.TimelineBusinessContext={current:()=>({apiValue:'dar'}),presentation:()=>({mode:'education'})};
                window.canUseAction=()=>true;window.escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
                window.apiCall=async(method,url,body)=>{try{return await (await fetch('/fixture'+url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})).json()}catch{return null}};</script>
                <script src="/js/ui.js"></script><script src="/js/staff-substitution.js"></script></body></html>`);
        }
        if(url.pathname.startsWith('/fixture/')) {
            res.setHeader('Content-Type','application/json');
            const dar = url.searchParams.get('businessContext') === 'dar';
            if (dar && url.pathname.endsWith('/accruals')) return res.end(JSON.stringify({success:true,
                data:{totalMinor:32550,rows:[{date:'2099-02-10',teacherName:'Синтетична викладачка',lessonId:'DAR-QA',amountMinor:32550}]}}));
            if (dar && url.pathname.endsWith('/catalog')) return res.end(JSON.stringify({success:true,data:{
                staff:[{id:2,name:'Синтетична викладачка'},{id:3,name:'Синтетичний викладач'}],professions:[{key:'teacher',title:'Викладач'}],
                sources:[{key:'education_lesson',title:'Навчальне заняття'}]
            }}));
            if (dar && url.pathname.endsWith('/sources')) return res.end(JSON.stringify({success:true,
                data:[{id:'DAR-QA',title:'10:00 · Синтетичне заняття',startTime:'10:00',endTime:'11:00'}]}));
            if(url.pathname.endsWith('/catalog')) return res.end(JSON.stringify({success:true,data:{
                staff:[{id:2,name:'Синтетична менеджерка'},{id:3,name:'Синтетичний адміністратор'}],
                professions:[{key:'reception',title:'Адміністратор'}],
                sources:[{key:'standalone',title:'Окрема робота'},{key:'hr_shift',title:'Зміна графіка'},{key:'booking',title:'Бронювання Park'}]
            }}));
            if(url.pathname.endsWith('/sources')) {
                const booking = url.searchParams.get('sourceType') === 'booking';
                const source = booking && url.searchParams.get('slotKey') === 'second'
                    ? { id:'BOOK-QA-42',title:'15:00 · Банкетне бронювання №BOOK-QA-42',startTime:'15:00',endTime:'16:00' }
                    : { id:'42',title:'Зміна 09:00–14:00',startTime:'09:00',endTime:'14:00',breakMinutes:0 };
                return res.end(JSON.stringify({success:true,data:[source]}));
            }
            let body='';for await(const chunk of req)body+=chunk;
            const payload=JSON.parse(body||'{}');
            if(url.pathname.endsWith('/preview')) {
                const input = contract.normalizeInput(payload.input);
                const source = input.slotKey === 'partial' ? { partial:true,
                    originalBefore:{plan:{segments:[{shiftStart:'09:00',shiftEnd:'14:00'}]}},replacementBefore:null,
                    originalAfter:{segments:[{shiftStart:'09:00',shiftEnd:'10:00'},{shiftStart:'12:00',shiftEnd:'14:00'}]},
                    replacementAfter:{segments:[{shiftStart:'10:00',shiftEnd:'12:00'}]} } : undefined;
                const payImpact = source ? { original: { amountMinor: 30000 }, replacement: { amountMinor: 20000 } } : null;
                return res.end(JSON.stringify({success:true,data:contract.preview(input,{blockers:[],commitments:[],payImpact,evidence:{source}})}));
            }
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
        for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844],['booking-mobile',390,844]]){
            const page=await browser.newPage({viewport:{width,height}});
            page.setDefaultTimeout(12000);
            const errors=[];page.on('pageerror',error=>errors.push(error.message));
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            const active=()=>page.locator('.form-modal-overlay:not(.confirm-exit)');
            await page.getByRole('button',{name:'Людина на заміну',exact:true}).click();
            await active().locator('[data-key="staffId"]').selectOption('2');
            await active().locator('[data-key="professionKey"]').selectOption('reception');
            if (name === 'mobile') {
                await active().locator('[data-key="originalStaffId"]').selectOption('3');
                await active().locator('[data-key="sourceType"]').selectOption('hr_shift');
                await active().locator('[data-key="shiftScope"]').selectOption('partial');
            } else if (name === 'booking-mobile') {
                await active().locator('[data-key="originalStaffId"]').selectOption('3');
                await active().locator('[data-key="sourceType"]').selectOption('booking');
                await active().locator('[data-key="animatorSlot"]').selectOption('second');
            }
            await active().locator('[data-key="workDate"]').fill('2099-01-13');
            await active().locator('[data-key="workload"]').fill('Синтетична робота адміністратора');
            await active().locator('[data-key="reason"]').fill('Локальна перевірка');
            await page.screenshot({path:path.join(output,`${name}-work.png`),fullPage:true});
            await active().getByRole('button',{name:'Умови оплати',exact:true}).click();
            if (name === 'mobile') {
                await active().locator('[data-key="sourceId"]').selectOption('42');
                await active().getByRole('button',{name:'Умови оплати',exact:true}).click();
                await active().locator('[data-key="startTime"]').fill('10:00');
                await active().locator('[data-key="endTime"]').fill('12:00');
                await active().locator('[data-key="originalTreatment"]').selectOption('transfer_unworked_scope');
            } else if (name === 'booking-mobile') {
                await active().locator('[data-key="sourceId"]').selectOption('BOOK-QA-42');
                await active().getByRole('button',{name:'Умови оплати',exact:true}).click();
                assert.equal(await active().locator('[data-key="startTime"]').inputValue(), '15:00');
                assert.equal(await active().locator('[data-key="endTime"]').inputValue(), '16:00');
                await active().locator('[data-key="originalTreatment"]').selectOption('retain');
            }
            assert.equal(await active().locator('[data-key="payMode"]').inputValue(),'','pay mode must require an explicit choice');
            await active().locator('[data-key="payUnit"]').selectOption('fixed');
            await active().locator('[data-key="payMode"]').selectOption(name === 'desktop' ? 'additional' : 'replace_base');
            await active().locator('[data-key="temporaryAdmission"]').selectOption('true');
            await active().locator('[data-key="admissionReason"]').fill('Перевірені навички');
            await page.screenshot({path:path.join(output,`${name}-terms.png`),fullPage:true});
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no page horizontal overflow');
            await active().getByRole('button',{name:'Показати стандартну ставку'}).click();
            await active().locator('[data-key="rate"]').fill('750');
            await active().locator('[data-key="rateReason"]').fill('Разова погоджена сума');
            await active().getByRole('button',{name:'Попередній розрахунок'}).click();
            await page.getByRole('button',{name:'Погоджую наслідки та зберігаю'}).waitFor();
            if (name === 'mobile') {
                assert.ok(await page.getByText(/У графіку заміненого працівника залишиться: 09:00–10:00, 12:00–14:00/).isVisible());
                assert.ok(await page.getByText(/Було у заміненого: 09:00–14:00/).isVisible());
                assert.ok(await page.getByText(/передається 120 робочих хвилин/).isVisible());
                assert.ok(await page.getByText(/зменшується на 300,00/).isVisible());
                assert.ok(await page.getByText(/200,00.*звичайної погодинної оплати/).isVisible());
            }
            if (name === 'booking-mobile') {
                assert.ok(await page.getByText(/Банкетне бронювання №BOOK-QA-42/).isVisible());
                assert.ok(await page.getByText(/Другий аніматор/).isVisible());
            }
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
            }else {
                assert.equal(commands.length,before+1);
                assert.equal(commands.at(-1).input.slotKey, name === 'mobile' ? 'partial' : 'second');
                if (name === 'booking-mobile') {
                    assert.equal(commands.at(-1).input.sourceId, 'BOOK-QA-42');
                    assert.equal(commands.at(-1).input.payMode, 'replace_base');
                }
            }
            assert.deepEqual(errors,[]);
            assert.equal(await page.locator('[data-substitution-action="create"]').evaluate(el=>document.activeElement===el),true,'focus restored');
            await page.close();
        }
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`http://127.0.0.1:${server.address().port}/?dar`);
        const active = () => page.locator('.form-modal-overlay:not(.confirm-exit)');
        await page.getByRole('button',{name:'Замінити викладача',exact:true}).click();
        await active().locator('[data-key="staffId"]').selectOption('2');
        await active().locator('[data-key="originalStaffId"]').selectOption('3');
        await active().locator('[data-key="workDate"]').fill('2099-02-10');
        await active().locator('[data-key="workload"]').fill('Провести синтетичне заняття');
        await active().locator('[data-key="reason"]').fill('Локальна перевірка');
        await active().getByRole('button',{name:'Умови оплати',exact:true}).click();
        await active().locator('[data-key="sourceId"]').selectOption('DAR-QA');
        await active().getByRole('button',{name:'Умови оплати',exact:true}).click();
        assert.equal(await active().locator('[data-key="startTime"]').inputValue(),'10:00');
        assert.equal(await active().locator('[data-key="endTime"]').inputValue(),'11:00');
        await active().locator('[data-key="payUnit"]').selectOption('hour');
        await page.screenshot({path:path.join(output,'dar-mobile-terms.png'),fullPage:true});
        await active().getByRole('button',{name:'Показати стандартну ставку'}).click();
        await active().locator('[data-key="rate"]').fill('325.50');
        await active().locator('[data-key="rateReason"]').fill('Разова погоджена ставка');
        await active().getByRole('button',{name:'Попередній розрахунок'}).click();
        await page.getByRole('button',{name:'Погоджую наслідки та зберігаю'}).click();
        await page.waitForFunction(()=>!document.querySelector('[data-substitution-action="create"]').disabled);
        assert.equal(commands.at(-1).input.professionKey,'teacher');
        assert.equal(commands.at(-1).input.sourceType,'education_lesson');
        assert.equal(commands.at(-1).input.payMode,'additional');
        await page.getByRole('button',{name:'Нарахування за підміни',exact:true}).click();
        await active().getByRole('button',{name:'Продовжити'}).click();
        await active().getByText(/Синтетична викладачка · заняття №DAR-QA/).waitFor();
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.screenshot({path:path.join(output,'dar-mobile-accruals.png'),fullPage:true});
        await page.close();
    }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
