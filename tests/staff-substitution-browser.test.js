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
    const commandBusinesses=[];
    const journalFilters=[];
    const corrections=[];
    const entry={id:'21',state:'completed',input:{staffId:2,originalStaffId:3,professionKey:'reception',
        sourceType:'hr_shift',workDate:'2099-01-13',workload:'Підмінити адміністратора на рецепції',payUnit:'hour',
        startsAt:'2099-01-13T08:00:00.000Z',endsAt:'2099-01-13T10:00:00.000Z'},
        quote:{rate:{rateMinor:15000},estimateMinor:30000,effects:{replacement:'Додаткова оплата.',original:'Без змін.'}},
        completion:{amountMinor:30000,actualMinutes:120,rate:{rateMinor:15000}}};
    const revisionInput = contract.normalizeInput({ sourceType:'hr_shift', sourceId:42, workDate:'2099-01-14',
        staffId:2, originalStaffId:3, professionKey:'reception', payUnit:'hour', payMode:'additional', originalTreatment:'retain',
        startsAt:'2099-01-14T10:00:00+02:00', endsAt:'2099-01-14T12:00:00+02:00',
        workload:'Синтетична зміна', reason:'Погодження', rateMode:'individual', rate:'150', rateReason:'Погоджена ставка',
        originalPayAmount:'75', replacementPayAmount:'120', payOverrideReason:'Початкові суми' });
    const revisionEntry = { id:'22', state:'active', version:2, input:revisionInput, completion:null,
        quote:contract.preview(revisionInput, { payImpact:{ original:{ amountMinor:30000 } } }) };
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
                data:{totalMinor:45100,rows:[
                    {id:'31',date:'2099-02-10',teacherName:'Синтетична викладачка',lessonId:'DAR-QA',amountMinor:32550},
                    {id:'32',date:'2099-02-10',teacherName:'Синтетична викладачка',lessonId:'DAR-QA-B',amountMinor:12550}
                ]}}));
            if (dar && url.pathname.endsWith('/32/history')) return res.end(JSON.stringify({ success: true, data: {
                substitution: { ...entry, id: '32', input: { ...entry.input, professionKey: 'teacher',
                    sourceType: 'education_lesson', sourceId: 'DAR-QA-B', workDate: '2099-02-10',
                    workload: 'Синтетична підміна другого заняття', startsAt: '2099-02-10T10:00:00Z', endsAt: '2099-02-10T11:00:00Z' },
                    quote: { ...entry.quote, estimateMinor: 12550 },
                    completion: { ...entry.completion, actualMinutes: 60, amountMinor: 12550 } }, events: []
            } }));
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
            if(req.method==='GET' && url.pathname==='/fixture/staff-substitutions') {
                journalFilters.push(Object.fromEntries(url.searchParams));
                const staffId=url.searchParams.get('staffId');
                const matches=!staffId || [entry.input.staffId,entry.input.originalStaffId].includes(Number(staffId));
                if (url.searchParams.get('from') === '2099-01-14') {
                    return res.end(JSON.stringify({success:true,data:[revisionEntry]}));
                }
                return res.end(JSON.stringify({success:true,data:matches?[entry]:[]}));
            }
            if (req.method === 'GET' && url.pathname === '/fixture/staff-substitutions/22/history') {
                return res.end(JSON.stringify({ success:true, data:{ substitution:revisionEntry, events:[] } }));
            }
            if(req.method==='GET' && url.pathname==='/fixture/staff-substitutions/21/history') {
                return res.end(JSON.stringify({success:true,data:{substitution:entry,
                    correctionPayees:[{ role:'replacement', staffId:2, amountMinor:30000, maximumDebitMinor:0 }], corrections,
                    events:[{version:1,action:'create',actor:'synthetic',reason:'Погоджено для перевірки'}]}}));
            }
            if(url.pathname.endsWith('/sources')) {
                const booking = url.searchParams.get('sourceType') === 'booking';
                const source = booking && url.searchParams.get('slotKey') === 'second'
                    ? { id:'BOOK-QA-42',title:'15:00 · Банкетне бронювання №BOOK-QA-42',startTime:'15:00',endTime:'16:00' }
                    : { id:'42',title:'Зміна 09:00–14:00',startTime:'09:00',endTime:'14:00',breakMinutes:0 };
                if (url.searchParams.get('workDate') === '2099-01-21') {
                    Object.assign(source, { title:'Зміна 20:00–04:00', startTime:'20:00', endTime:'04:00', endDate:'2099-01-22' });
                }
                return res.end(JSON.stringify({success:true,data:[source]}));
            }
            let body='';for await(const chunk of req)body+=chunk;
            const payload=JSON.parse(body||'{}');
            if (url.pathname.endsWith('/21/corrections')) {
                assert.equal(payload.correctedAmount, '250.05');
                assert.equal(payload.expectedCorrectionId, null);
                assert.ok(payload.requestKey);
                corrections.push({ id:'78', staffId:2, payee:payload.payee, postingMonth:payload.postingMonth,
                    beforeMinor:30000, afterMinor:25005, deltaMinor:-4995, reason:payload.reason, actor:'synthetic' });
                return res.end(JSON.stringify({ success:true, data:corrections.at(-1) }));
            }
            if(url.pathname.endsWith('/preview')) {
                const input = contract.normalizeInput(payload.input);
                const source = input.slotKey === 'partial' ? { partial:true,
                    originalBefore:{plan:{segments:[{shiftStart:'09:00',shiftEnd:'14:00'}]}},replacementBefore:null,
                    originalAfter:{segments:[{shiftStart:'09:00',shiftEnd:'10:00'},{shiftStart:'12:00',shiftEnd:'14:00'}]},
                    replacementAfter:{segments:[{shiftStart:'10:00',shiftEnd:'12:00'}]} } : undefined;
                if (source && input.workDate === '2099-01-21') {
                    source.originalBefore.plan.segments = [{shiftStart:'20:00',shiftEnd:'04:00'}];
                    source.originalAfter.segments = [{shiftStart:'20:00',shiftEnd:'23:00'}];
                    source.replacementAfter.segments = [{shiftStart:'23:00',shiftEnd:'02:00'}];
                    source.remainder = {date:'2099-01-22',plan:{segments:[{shiftStart:'02:00',shiftEnd:'04:00'}]}};
                }
                const payImpact = source ? { original: { amountMinor: 30000 }, replacement: { amountMinor: 20000 } } : null;
                return res.end(JSON.stringify({success:true,data:contract.preview(input,{blockers:[],commitments:[],payImpact,evidence:{source}})}));
            }
            commands.push(payload);
            commandBusinesses.push(url.searchParams.get('businessContext'));
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
        for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844],['booking-mobile',390,844],['night-mobile',390,844]]){
            const night = name === 'night-mobile';
            const page=await browser.newPage({viewport:{width,height}});
            page.setDefaultTimeout(12000);
            const errors=[];page.on('pageerror',error=>errors.push(error.message));
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            const active=()=>page.locator('.form-modal-overlay:not(.confirm-exit)');
            await page.getByRole('button',{name:'Людина на заміну',exact:true}).click();
            await active().locator('[data-key="staffId"]').selectOption('2');
            await active().locator('[data-key="professionKey"]').selectOption('reception');
            if (name === 'mobile' || night) {
                await active().locator('[data-key="originalStaffId"]').selectOption('3');
                await active().locator('[data-key="sourceType"]').selectOption('hr_shift');
                await active().locator('[data-key="shiftScope"]').selectOption('partial');
            } else if (name === 'booking-mobile') {
                await active().locator('[data-key="originalStaffId"]').selectOption('3');
                await active().locator('[data-key="sourceType"]').selectOption('booking');
                await active().locator('[data-key="animatorSlot"]').selectOption('second');
            }
            await active().locator('[data-key="workDate"]').fill(night ? '2099-01-21' : '2099-01-13');
            await active().locator('[data-key="workload"]').fill('Синтетична робота адміністратора');
            await active().locator('[data-key="reason"]').fill('Локальна перевірка');
            await page.screenshot({path:path.join(output,`${name}-work.png`),fullPage:true});
            await active().getByRole('button',{name:'Умови оплати',exact:true}).click();
            if (name === 'mobile' || night) {
                await active().locator('[data-key="sourceId"]').selectOption('42');
                await active().getByRole('button',{name:'Умови оплати',exact:true}).click();
                await active().locator('[data-key="startTime"]').fill(night ? '23:00' : '10:00');
                await active().locator('[data-key="endTime"]').fill(night ? '02:00' : '12:00');
                if (night) assert.equal(await active().locator('[data-key="endDate"]').inputValue(), '2099-01-22');
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
            if (name === 'mobile') {
                const originalAmount = active().getByLabel('Замінений працівник · зміна до оплати за табелем, грн');
                const replacementAmount = active().getByLabel('Виконавець · оплата підміни, грн');
                assert.equal(await originalAmount.inputValue(), '0.00');
                await originalAmount.fill('120,05');
                await replacementAmount.fill('410,20');
                await active().getByRole('button', { name: 'Попередній розрахунок' }).click();
                const reason = active().getByLabel('Причина ручної зміни оплати');
                assert.equal(await reason.getAttribute('aria-invalid'), 'true');
                assert.equal(await active().getByRole('alert').textContent(), 'Вкажіть причину ручної зміни оплати.');
                await reason.fill('Окремо погоджені суми');
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
                await page.screenshot({path:path.join(output, 'mobile-edit-pay.png'),fullPage:true});
            }
            await active().getByRole('button',{name:'Попередній розрахунок'}).click();
            await page.getByRole('button',{name:'Погоджую наслідки та зберігаю'}).waitFor();
            if (name === 'mobile') {
                assert.ok(await page.getByText(/У графіку заміненого працівника залишиться: 09:00–10:00, 12:00–14:00/).isVisible());
                assert.ok(await page.getByText(/Було у заміненого: 09:00–14:00/).isVisible());
                assert.ok(await page.getByText(/передається 120 робочих хвилин/).isVisible());
                assert.ok(await page.getByText(/зменшується на 300,00/).isVisible());
                assert.ok(await page.getByText(/200,00.*звичайної погодинної оплати/).isVisible());
                assert.ok(await page.getByText(/0,00.*→.*120,05/).isVisible());
                assert.ok(await page.getByText(/750,00.*→.*410,20/).isVisible());
            }
            if (name === 'booking-mobile') {
                assert.ok(await page.getByText(/Банкетне бронювання №BOOK-QA-42/).isVisible());
                assert.ok(await page.getByText(/Другий аніматор/).isVisible());
            }
            if (night) {
                assert.ok(await page.getByText(/2099-01-21 · 20:00–23:00/).isVisible());
                assert.ok(await page.getByText(/Окрема зміна заміненого працівника на 2099-01-22: 02:00–04:00/).isVisible());
                assert.ok(await page.getByText(/2099-01-21 · 23:00–02:00 \(\+1 день\)/).isVisible());
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            }
            await page.screenshot({path:path.join(output,`${name}-preview.png`),fullPage:true});
            const before=commands.length;
            await page.getByRole('button',{name:'Погоджую наслідки та зберігаю'}).click();
            await page.waitForFunction(()=>!document.querySelector('[data-substitution-action="create"]').disabled);
            if(name==='desktop'){
                assert.equal(commands.length, before + 1);
                await page.getByRole('button', { name: 'Людина на заміну', exact: true }).click();
                await page.getByRole('button', { name: 'Повторити запит', exact: true }).waitFor();
                await page.evaluate(() => {
                    document.getElementById('staffSubstitutionActions').dataset.substitutionBusiness = 'dar';
                    window.TimelineBusinessContext = { current: () => ({ apiValue: 'dar' }), presentation: () => ({ mode: 'education' }) };
                    window.dispatchEvent(new Event('timeline:business-context-changed'));
                });
                await page.getByRole('button', { name: 'Повторити запит', exact: true }).click();
                await page.waitForFunction(() => !document.querySelector('[data-substitution-action="create"]').disabled);
                assert.equal(commands.length, before + 1, 'a confirmation opened in Park cannot write after switching to DAR');
                await page.getByRole('button', { name: 'Підміни', exact: true }).click();
                await active().getByLabel('Викладач', { exact: true }).waitFor();
                assert.equal(await page.getByRole('button', { name: 'Повторити запит', exact: true }).count(), 0);
                assert.equal(commands.length, before + 1, 'the Park write is not replayed in DAR');
                await active().getByRole('button', { name: 'Скасувати', exact: true }).click();
                await page.waitForFunction(() => !document.querySelector('[data-substitution-action="list"]').disabled);
                await page.evaluate(() => {
                    delete document.getElementById('staffSubstitutionActions').dataset.substitutionBusiness;
                    window.CrmBusinessContext = { current: () => 'event_genix' };
                    window.dispatchEvent(new Event('crmBusinessContextChanged'));
                });
                await page.getByRole('button',{name:'Людина на заміну',exact:true}).click();
                await page.getByRole('button',{name:'Повторити запит',exact:true}).click();
                await page.waitForFunction(()=>!document.querySelector('[data-substitution-action="create"]').disabled);
                assert.equal(commands.length,before+2);
                assert.deepEqual(commands.at(-1),commands.at(-2),'lost-response retry preserves request identity and payload');
                assert.deepEqual(commandBusinesses.slice(-2), ['event_genix', 'event_genix']);
            }else {
                assert.equal(commands.length,before+1);
                assert.equal(commands.at(-1).input.slotKey, name === 'mobile' || night ? 'partial' : 'second');
                if (night) assert.equal(commands.at(-1).input.endsAt, '2099-01-22T02:00:00+02:00');
                if (name === 'mobile') {
                    assert.equal(commands.at(-1).input.originalPayAmount, '120.05');
                    assert.equal(commands.at(-1).input.replacementPayAmount, '410.20');
                    assert.equal(commands.at(-1).input.payOverrideReason, 'Окремо погоджені суми');
                }
                if (name === 'booking-mobile') {
                    assert.equal(commands.at(-1).input.sourceId, 'BOOK-QA-42');
                    assert.equal(commands.at(-1).input.payMode, 'replace_base');
                }
            }
            assert.deepEqual(errors,[]);
            assert.equal(await page.locator('[data-substitution-action="create"]').evaluate(el=>document.activeElement===el),true,'focus restored');
            await page.close();
        }
        const journal = await browser.newPage({ viewport:{width:390,height:844} });
        await journal.goto(`http://127.0.0.1:${server.address().port}`);
        await journal.evaluate(() => { window.canUseAction = action => action !== 'manage_payroll_accrual'; });
        const journalButton=journal.getByRole('button',{name:'Підміни',exact:true});
        const dialog = journal.getByRole('dialog', { name: 'Підміна #21 · Виконано' });
        const closeButton = dialog.getByRole('button', { name: 'Закрити', exact: true });
        const openHistory = async () => {
            await journalButton.click();
            const form = journal.locator('.form-modal-overlay:not(.confirm-exit)');
            await form.getByLabel('Працівник', { exact: true }).selectOption('3');
            await form.getByLabel(/Від/).fill('2099-01-13');
            await form.getByLabel(/До/).fill('2099-01-13');
            await form.getByRole('button', { name: 'Показати' }).click();
            await form.locator('[data-key="selected"]').selectOption('21');
            await form.getByRole('button', { name: 'Відкрити' }).click();
            await dialog.waitFor({ state: 'visible' });
        };
        await openHistory();
        assert.equal(await dialog.getByRole('button').count(), 1);
        assert.equal(await closeButton.evaluate(button => document.activeElement === button), true);
        const facts=await dialog.locator('.form-modal-note').innerText();
        assert.match(facts,/Кого замінили: Синтетичний адміністратор/);
        assert.match(facts,/Роль: Адміністратор/);
        assert.match(facts,/10:00.*12:00/);
        assert.match(facts,/Зафіксована ставка: 150,00/);
        assert.match(facts,/Факт: 300,00/);
        assert.equal(journalFilters.at(-1).staffId,'3');
        assert.equal(await journal.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await journal.screenshot({path:path.join(output,'park-mobile-substitution-history.png')});
        await journal.keyboard.press('Escape');
        await journal.waitForFunction(()=>document.activeElement?.dataset.substitutionAction==='list');
        await dialog.waitFor({ state: 'detached' });
        await openHistory();
        await closeButton.click();
        await dialog.waitFor({ state: 'detached' });
        await journal.waitForFunction(() => document.activeElement?.dataset.substitutionAction === 'list');

        await journal.evaluate(() => { window.canUseAction = () => true; });
        await openHistory();
        await dialog.getByRole('button', { name:'Коригувати суму' }).click();
        const correctionForm = journal.locator('.form-modal-overlay:not(.confirm-exit)');
        const amount = correctionForm.getByLabel('Виправлена сума, грн');
        const postingMonth = correctionForm.getByLabel(/Місяць нарахування/);
        assert.equal(await amount.inputValue(), '300.00');
        await amount.fill('250,05');
        await postingMonth.fill('2099-13');
        await correctionForm.getByLabel('Причина коригування').fill('Синтетичне уточнення суми');
        await correctionForm.getByRole('button', { name:'Перевірити різницю' }).click();
        assert.equal(await postingMonth.getAttribute('aria-invalid'), 'true');
        assert.ok(await postingMonth.evaluate(input => input === document.activeElement));
        await postingMonth.fill('2099-02');
        await correctionForm.getByRole('button', { name:'Перевірити різницю' }).click();
        const saveCorrection = journal.getByRole('button', { name:'Зберегти коригування' });
        await saveCorrection.waitFor();
        assert.ok(await journal.getByText(/Різниця: -49,95/).isVisible());
        assert.equal(corrections.length, 0);
        await journal.screenshot({ path:path.join(output, 'park-mobile-correction-confirmation.png') });
        await saveCorrection.click();
        await journal.waitForFunction(() => !document.querySelector('[data-substitution-action="list"]').disabled);
        await openHistory();
        assert.match(await dialog.innerText(), /Коригування #78.*2099-02/);
        assert.match(await dialog.innerText(), /250,05.*synthetic: Синтетичне уточнення суми/);
        assert.equal(corrections.length, 1);
        await journal.screenshot({ path:path.join(output, 'park-mobile-correction-history.png') });
        await closeButton.click();
        await journal.waitForFunction(() => !document.querySelector('[data-substitution-action="list"]').disabled);

        await journalButton.click();
        const edit = journal.locator('.form-modal-overlay:not(.confirm-exit)');
        await edit.getByLabel(/Від/).fill('2099-01-14');
        await edit.getByLabel(/До/).fill('2099-01-14');
        await edit.getByRole('button', { name:'Показати' }).click();
        await edit.locator('[data-key="selected"]').selectOption('22');
        await edit.getByRole('button', { name:'Відкрити' }).click();
        await edit.getByRole('combobox', { name:/^Дія/ }).selectOption('revise');
        await edit.getByRole('button', { name:'Продовжити' }).click();
        assert.equal(await edit.locator('[data-key="originalPayAmount"]').inputValue(), '75.00');
        assert.equal(await edit.locator('[data-key="replacementPayAmount"]').inputValue(), '120.00');
        await edit.locator('[data-key="originalPayAmount"]').fill('80');
        await edit.locator('[data-key="replacementPayAmount"]').fill('90');
        await edit.locator('[data-key="reason"]').fill('Уточнили домовленість');
        await edit.getByRole('button', { name:'Попередній розрахунок' }).click();
        const acceptEdit = journal.getByRole('button', { name:'Погоджую зміни' });
        await acceptEdit.waitFor();
        assert.ok(await journal.getByText(/75,00.*→.*80,00/).isVisible());
        assert.ok(await journal.getByText(/120,00.*→.*90,00/).isVisible());
        await acceptEdit.click();
        await journal.waitForFunction(() => !document.querySelector('[data-substitution-action="list"]').disabled);
        assert.equal(commands.at(-1).expectedVersion, 2);
        assert.equal(commands.at(-1).input.originalPayAmount, '80');
        assert.equal(commands.at(-1).input.replacementPayAmount, '90');
        await journal.close();

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
        const report = active().locator('.form-modal-note');
        assert.match(await report.innerText(), /заняття №DAR-QA · підміна №31 · 325,50/);
        assert.match(await report.innerText(), /заняття №DAR-QA-B · підміна №32 · 125,50/);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.screenshot({path:path.join(output,'dar-mobile-accruals.png'),fullPage:true});
        await active().getByRole('combobox', { name: /^Підміна/ }).selectOption('32');
        const historyRequest = page.waitForResponse(response => {
            const url = new URL(response.url());
            return url.pathname.endsWith('/32/history') && url.searchParams.get('businessContext') === 'dar';
        });
        await active().getByRole('button', { name: 'Відкрити підміну' }).click();
        assert.equal((await historyRequest).ok(), true);
        const darHistory = page.getByRole('dialog', { name: 'Підміна #32 · Виконано' });
        await darHistory.getByText(/Синтетична підміна другого заняття/).waitFor();
        assert.match(await darHistory.innerText(), /Факт: 125,50/);
        assert.equal(await darHistory.getByRole('button').count(), 1);
        await darHistory.getByRole('button', { name: 'Закрити' }).click();
        await page.waitForFunction(() => document.activeElement?.dataset.substitutionAction === 'accruals');
        await page.close();
    }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
