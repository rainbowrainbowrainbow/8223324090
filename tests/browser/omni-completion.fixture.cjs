const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const artifactDir = path.join(root, 'output', 'omni-completion-browser');
fs.mkdirSync(artifactDir, { recursive: true });
function playwright() {
  for (const entry of process.env.PATH.split(path.delimiter)) {
    if (!/node_modules[\\/]\.bin$/i.test(entry)) continue;
    const dir = path.join(path.dirname(entry), 'playwright');
    if (fs.existsSync(dir)) return require(dir);
  }
  throw new Error('playwright_missing');
}
(async () => {
  const {chromium, request} = playwright();
  const base = 'https://8223324090-production.up.railway.app';
  const source = fs.readFileSync(path.join(os.homedir(), '.eventgenix/codex-crm-secrets.ps1'), 'utf8');
  const config = {};
  for (const m of source.matchAll(/^\s*\$env:(LIVE_SMOKE_USER|LIVE_SMOKE_PASS)\s*=\s*(['"])(.*?)\2\s*$/gm)) config[m[1]]=m[3];
  const api = await request.newContext();
  const login = await api.post(base+'/api/auth/login', {data:{username:config.LIVE_SMOKE_USER,password:config.LIVE_SMOKE_PASS}});
  assert.equal(login.status(),200);
  const session = await login.json();
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000}, serviceWorkers:'block'});
    await context.addInitScript(data => {
      localStorage.setItem('pzp_token',data.token);
      localStorage.setItem('pzp_access_token',data.accessToken||data.token);
      localStorage.setItem('pzp_current_user',JSON.stringify(data.user));
      localStorage.setItem('pzp_dark_mode','true');
    },session);
    const channels = ['telegram','viber','sms','facebook','instagram'];
    const accounts=channels.map(channel=>({channel,label:channel,status:channel==='telegram'?'connected':'disconnected',connected:channel==='telegram',sendCapable:channel==='telegram',receiveCapable:channel==='telegram',setupFields:[],supportedActions:['connect','test','recheck'],accountName:'QA fixture'}));
    const conversations=Array.from({length:105},(_,i)=>({id:9001+i,channel:'telegram',externalId:'fixture-'+i,customerName:'Тестовий діалог '+(i+1),lastMessage:'Тестовий текст',lastMessageAt:'2099-01-01T12:00:00Z',businessContext:'event_genix',sendCapable:true,meta:{ai_enabled:false},status:'open'}));
    const history=new Map(conversations.map(c=>[c.id,Array.from({length:c.id===9001?105:2},(_,i)=>({id:c.id*1000+i,conversationId:c.id,direction:'inbound',content:'Діалог '+c.id+' повідомлення '+(i+1)+'\nДругий рядок',createdAt:'2099-01-01T12:00:00Z'}))]));
    let delayA=false, sendResolve, sendStartedResolve;
    let sendStarted=new Promise(resolve=>{sendStartedResolve=resolve;});
    const mutations=[];
    const attachment = { id: '11111111-1111-4111-8111-111111111111', filename: 'fixture.pdf', size: 12, mime: 'application/pdf', checksum: 'fixture-checksum' };
    await context.route('**/*',async route=>{
      const req=route.request(), url=new URL(req.url());
      if(url.origin!==base) return route.abort();
      const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(url.pathname.startsWith('/api/omni/')) {
        const p=url.pathname.slice('/api/omni'.length);
        if(req.method()!=='GET') {
          mutations.push({path:p,method:req.method()});
          if(p.endsWith('/read')) { const conv=conversations.find(c=>c.id===Number(p.split('/')[2])); if(conv)conv.unreadCount=0; return json({success:true,data:{unreadCount:0}}); }
          if(req.method()==='PATCH' && /^\/conversations\/\d+$/.test(p)) {
            const body=req.postDataJSON(), conv=conversations.find(c=>c.id===Number(p.split('/')[2]));
            if (body.expected && Object.keys(body.expected).some(field => body.expected[field] !== (field === 'assigned_to' ? conv.assignedTo || null : conv[field]))) return json({ success:false, code:'OMNI_CONVERSATION_CONFLICT', error:'Інший менеджер уже змінив поле.', data:conv },409);
            if(body.assigned_to !== undefined || ['pending','open'].includes(body.status)) { if(body.assigned_to !== undefined)conv.assignedTo=body.assigned_to; if(body.status)conv.status=body.status; return json({success:true,data:conv}); }
          }
          if (p.endsWith('/attachments')) return json({success:true,data:attachment});
          if(p.endsWith('/send')) {
            assert.match(req.postDataJSON().client_request_id,/^[a-f0-9]{40}$/);
            const body = req.postDataJSON();
            if (body.attachment_id || body.reply_mode) {
              const id = Number(p.split('/')[2]);
              if (body.attachment_id) assert.equal(body.attachment_id, attachment.id);
              history.get(id).push({id:99000001,conversationId:id,direction:'outbound',content:body.text,deliveryStatus:'accepted',createdAt:'2099-01-01T12:05:00Z',meta:body.attachment_id?{attachment}:{commentReply:{mode:body.reply_mode}}});
              return json({success:true,sendTruth:{status:'provider_attempted',providerAccepted:true}});
            }
            sendStartedResolve();
            await new Promise(resolve=>{sendResolve=resolve;});
            return json({success:true,sendTruth:{status:'provider_attempted',providerAccepted:true}});
          }
          if(p.endsWith('/recheck')||p.endsWith('/test')) return json({success:false,error:'Тестова помилка перевірки'},500);
          return json({success:false,error:'Тестова помилка закриття'},500);
        }
        if(p==='/operators') return json({success:true,data:[{username:'fixture-manager',label:'Тестовий менеджер'}]});
        if(p==='/accounts') return json({success:true,accounts});
        if(p==='/stats') return json({success:true,data:{total:105,byStatus:{open:105}}});
        if(p==='/quick-replies') return json({success:true,data:[]});
        if(p==='/conversations') {
          const search=url.searchParams.get('search')||'', channel=url.searchParams.get('channel');
          const filtered=conversations.filter(c=>(!channel||c.channel===channel)&&(!search||c.customerName.includes(search))&&(!url.searchParams.get('status')||c.status===url.searchParams.get('status'))&&(url.searchParams.get('mine')!=='true'||c.assignedTo==='fixture-manager'));
          const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||100);
          return json({success:true,data:{conversations:filtered.slice(offset,offset+limit),total:filtered.length}});
        }
        const match=p.match(/^\/conversations\/(\d+)\/(messages|context)$/);
        if(match) {
          const id=Number(match[1]);
          if(match[2]==='context') return json({success:true,data:{conversation:conversations.find(c=>c.id===id),exact:{},links:{}}});
          const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||100),rows=history.get(id)||[];
          const selected=url.searchParams.get('latest')==='true'?rows.slice().reverse().slice(offset,offset+limit).reverse():rows.slice(offset,offset+limit);
          if(id===9001&&delayA) await new Promise(resolve=>setTimeout(resolve,800));
          return json({success:true,data:{messages:selected,total:rows.length}});
        }
        return json({success:true,data:[]});
      }
      if(!['GET','HEAD'].includes(req.method())) return route.abort();
      const local=new Map([['/omni','omni.html'],['/css/omni-workspace.css','css/omni-workspace.css']]);
      if(local.has(url.pathname)) {
        const file=local.get(url.pathname);
        const content=fs.readFileSync(path.join(root,file),'utf8');
        return route.fulfill({status:200,contentType:file.endsWith('.css')?'text/css':'text/html',body:file.endsWith('.html')?content.replace('// ---- Events ----','window.__omniFixtureRefresh = loadConversations; // ---- Events ----'):content});
      }
      return route.continue();
    });
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message.slice(0,120)));
    await page.goto(base+'/omni?businessContext=event_genix',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('body.shell-ready .omni-conv-item',{timeout:60000});
    const select=id=>page.locator('.omni-conv-item[data-id="'+id+'"]').click();
    await page.locator('[data-omni-conversations-more]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.omni-conv-item').length===105);
    await select(9001);
    await page.waitForFunction(()=>document.querySelector('#omniMessages').textContent.includes('повідомлення 105'));
    assert.equal(await page.locator('.omni-msg').count(),100);
    await page.locator('[data-omni-history="older"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.omni-msg').length===105);
    await page.locator('#omniInput').fill('Чернетка діалогу A');
    await select(9002);
    assert.equal(await page.locator('#omniInput').inputValue(),'');
    await page.locator('#omniInput').fill('Чернетка діалогу B');
    await select(9001);
    assert.equal(await page.locator('#omniInput').inputValue(),'Чернетка діалогу A');
    delayA=true;
    await select(9001);await select(9002);
    await page.waitForTimeout(1100);
    assert.ok((await page.locator('#omniMessages').textContent()).includes('Діалог 9002'));
    assert.ok(!(await page.locator('#omniMessages').textContent()).includes('Діалог 9001'));
    delayA=false;
    await select(9001);await page.locator('#omniSendBtn').click();await sendStarted;
    await select(9002);
    assert.equal(await page.locator('#omniInput').inputValue(),'Чернетка діалогу B');
    sendResolve();await page.waitForTimeout(500);
    assert.equal(await page.locator('#omniInput').inputValue(),'Чернетка діалогу B');
    await page.locator('#omniCloseConv').click();await page.waitForTimeout(300);
    assert.ok(await page.locator('#omniChatHeader').isVisible());
    assert.ok((await page.locator('#omniSendTruth').textContent()).includes('Тестова помилка закриття'));
    await page.locator('#omniAssignee').selectOption('fixture-manager');
    await page.waitForFunction(()=>!document.querySelector('#omniAssignee').disabled);
    await page.locator('#omniConversationStatus').selectOption('pending');
    await page.waitForFunction(()=>!document.querySelector('#omniConversationStatus').disabled);
    await page.locator('#omniOnlyMine').check();
    await page.waitForFunction(()=>document.querySelectorAll('.omni-conv-item').length===1);
    await page.locator('#omniOnlyMine').uncheck();
    await page.locator('#omniStatusFilter').selectOption('closed');
    await page.waitForFunction(()=>document.querySelectorAll('.omni-conv-item').length===0);
    await page.locator('#omniConvList').getByRole('button',{name:'Показати всі розмови',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.omni-conv-item').length===100);
    assert.equal(await page.locator('#omniStatusFilter').inputValue(),'');
    await select(9002);
    await page.waitForFunction(()=>!document.querySelector('#omniAssignee').disabled);
    assert.equal(await page.locator('#omniAssignee').inputValue(),'fixture-manager');
    assert.equal(await page.locator('#omniConversationStatus').inputValue(),'pending');
    await page.getByRole('tab',{name:'Канали',exact:true}).click();
    await page.locator('#omniAccountsGrid [data-channel="telegram"][data-account-action="recheck"]').click();
    await page.waitForFunction(()=>document.querySelector('#omniChannelActionFeedback').textContent.includes('Тестова помилка перевірки'));
    const feedback=page.locator('#omniChannelActionFeedback');
    assert.ok(await feedback.isVisible());assert.ok((await feedback.textContent()).includes('Тестова помилка перевірки'));
    await page.getByRole('tab',{name:'Inbox',exact:true}).click();
    await select(9002);
    const second = await context.newPage();
    await second.goto(base+'/omni?businessContext=event_genix',{waitUntil:'domcontentloaded'});
    await second.waitForSelector('body.shell-ready .omni-conv-item',{timeout:60000});
    await second.locator('.omni-conv-item[data-id="9002"]').click();
    await second.waitForFunction(()=>!document.querySelector('#omniConversationStatus').disabled);
    await page.locator('#omniInput').fill('Чернетка двох менеджерів');
    await second.locator('#omniConversationStatus').selectOption('open');
    await second.waitForFunction(()=>!document.querySelector('#omniConversationStatus').disabled);
    await page.evaluate(()=>window.__omniFixtureRefresh());
    assert.equal(await page.locator('#omniConversationStatus').inputValue(),'open');
    assert.equal(await page.locator('#omniInput').inputValue(),'Чернетка двох менеджерів');
    await page.locator('#omniConversationStatus').focus();
    await second.locator('#omniConversationStatus').selectOption('pending');
    await second.waitForFunction(()=>!document.querySelector('#omniConversationStatus').disabled);
    await page.evaluate(()=>window.__omniFixtureRefresh());
    await page.locator('#omniConversationStatus').selectOption('closed');
    await page.waitForFunction(()=>document.querySelector('#omniSendTruth').textContent.includes('Інший менеджер'));
    assert.equal(await page.locator('#omniConversationStatus').inputValue(),'pending');
    await second.close();
    await page.locator('#omniInput').fill('');
    await page.locator('#omniFileInput').setInputFiles({name:'fixture.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-fixture')});
    await page.waitForFunction(()=>document.querySelector('#omniSelectedFile').textContent.includes('fixture.pdf')&&!document.querySelector('#omniSendBtn').disabled);
    await select(9001); assert.equal(await page.locator('#omniSelectedFile').textContent(),'');
    await select(9002); assert.match(await page.locator('#omniSelectedFile').textContent(),/fixture.pdf/);
    await page.locator('#omniSendBtn').click();
    await page.waitForFunction(()=>document.querySelector('#omniMessages').textContent.includes('Завантажити · fixture.pdf'));
    assert.equal(await page.locator('#omniSelectedFile').textContent(),'');
    assert.equal(await page.locator('#omniCancelFile').isVisible(),false);
    const metrics=[];
    for(const width of [1440,390]) {
      await page.setViewportSize({width,height:width===390?844:1000});await page.waitForTimeout(500);
      const measurement=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,textWrap:getComputedStyle(document.querySelector('.omni-msg-content')).whiteSpace}));
      assert.ok(measurement.width<=width+1);assert.equal(measurement.textWrap,'pre-wrap');metrics.push(measurement);
      await page.screenshot({path:path.join(artifactDir,'fixture-omni-'+width+'.png'),mask:[page.locator('#sidebarNav,.header-user')],animations:'disabled'});
    }
    await page.locator('#omniInput').scrollIntoViewIfNeeded();
    const composer = await page.locator('#omniInput').boundingBox();
    assert.ok(composer.width >= 200 && composer.y >= 0 && composer.y + composer.height <= 844);
    await page.screenshot({path:path.join(artifactDir,'fixture-omni-mobile-composer.png'),mask:[page.locator('#sidebarNav,.header-user')],animations:'disabled'});
    await page.locator('#omniBackToList').click();
    assert.ok(await page.locator('.omni-sidebar').isVisible());
    await select(9002);
    await page.evaluate(()=>{document.body.classList.remove('dark-mode');document.documentElement.classList.remove('dark-mode');});
    await page.locator('#omniInput').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(artifactDir,'fixture-omni-mobile-light.png'),mask:[page.locator('#sidebarNav,.header-user')],animations:'disabled'});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,fixturesOnly:true,realWrites:0,conversationPagination:105,historyPagination:105,draftIsolation:true,staleMessageGuard:true,sendTargetGuard:true,idempotencyKey:true,managerAssignment:true,statusAndMineFilters:true,filterReset:true,failedCloseVisible:true,channelFeedbackVisible:true,mobileComposerReachable:true,mobileBack:true,metrics,simulatedMutations:mutations.length}));
  } finally {await browser.close();await api.dispose();}
})().catch(e=>{console.log(JSON.stringify({ok:false,error:e.message.replace(/https?:\/\/\S+/g,'[url]').slice(0,300)}));process.exitCode=1;});
