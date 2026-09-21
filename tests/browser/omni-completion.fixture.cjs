const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const artifactDir = path.resolve(process.env.OMNI_BROWSER_ARTIFACT_DIR || path.join(root, 'output', 'playwright', 'omni-completion'));
fs.mkdirSync(artifactDir, { recursive: true });
const layoutOnly = process.env.OMNI_LAYOUT_ONLY === '1';
const nativeZoom = process.env.OMNI_NATIVE_ZOOM === '1';
const FIXED_BROWSER_TIME = '2099-01-01T12:30:00.000Z';
const sanitize = value => String(value || '').replace(/https?:\/\/\S+/g, '[url]');
const gitHead = (() => {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', shell: false });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
})();
const runReport = {
  schemaVersion: 1,
  suite: 'Omni browser regression',
  status: 'running',
  sha: String(process.env.GITHUB_SHA || gitHead || 'unknown'),
  environment: {
    ci: process.env.CI === 'true',
    event: process.env.GITHUB_EVENT_NAME || 'local',
    ref: process.env.GITHUB_REF || 'local',
    os: `${process.platform} ${process.arch}`,
    node: process.version,
    npm: process.env.npm_config_user_agent || 'unknown',
    javascript: true,
    fixtureData: true,
    providerRequests: false
  },
  startedAt: new Date().toISOString(),
  scenarios: null,
  pageErrors: [],
  realWrites: 0,
  trace: layoutOnly ? 'trace.zip' : null
};

function writeRunReport() {
  runReport.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(artifactDir, 'omni-browser-report.json'), JSON.stringify(runReport, null, 2));
}

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
  let api = null;
  let session;
  if (layoutOnly) {
    session = {
      token: 'omni-browser-fixture-token',
      accessToken: 'omni-browser-fixture-token',
      user: {
        id: 9001,
        username: 'fixture-manager',
        role: 'creator',
        roles: ['creator'],
        name: 'Тестовий менеджер',
        businessContexts: ['event_genix'],
        defaultBusinessContext: 'event_genix',
        activeBusinessContext: 'event_genix',
        accessContext: { status: 'ready' }
      }
    };
  } else {
    const source = fs.readFileSync(path.join(os.homedir(), '.eventgenix/codex-crm-secrets.ps1'), 'utf8');
    const config = {};
    for (const m of source.matchAll(/^\s*\$env:(LIVE_SMOKE_USER|LIVE_SMOKE_PASS)\s*=\s*(['"])(.*?)\2\s*$/gm)) config[m[1]]=m[3];
    api = await request.newContext();
    const login = await api.post(base+'/api/auth/login', {data:{username:config.LIVE_SMOKE_USER,password:config.LIVE_SMOKE_PASS}});
    assert.equal(login.status(),200);
    session = await login.json();
  }
  const fixtureOwner = session.user?.username || 'fixture-manager';
  const fixtureBusinessProfile = {
    activeBusinessId: 'event_genix',
    activeBusinessContext: 'event_genix',
    scope: { mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'], readOnly: false, canWrite: true },
    businesses: [{
      key: 'event_genix',
      id: 'event_genix',
      businessContext: 'event_genix',
      modules: { enabled: { timeline: true, tasks: true, customers: true, leads: true, omni: true, chat: true } }
    }]
  };
  const zoomBrowser = nativeZoom ? await require('./omni-native-zoom.cjs').launch(chromium) : null;
  const browser = zoomBrowser ? null : await chromium.launch(layoutOnly ? {headless:true} : {channel:'chrome',headless:true});
  let context = null;
  let tracingStarted = false;
  try {
    context = zoomBrowser?.context || await browser.newContext({viewport:{width:1440,height:1000}, serviceWorkers:'block'});
    if (layoutOnly) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      tracingStarted = true;
    }
    await context.routeWebSocket('**/*', () => {});
    await context.addInitScript(data => {
      localStorage.setItem('pzp_token',data.token);
      localStorage.setItem('pzp_access_token',data.accessToken||data.token);
      localStorage.setItem('pzp_current_user',JSON.stringify({...data.user,username:data.fixtureOwner,name:'Тестовий менеджер'}));
      localStorage.setItem('pzp_dark_mode','true');
    },{...session,fixtureOwner});
    const layoutMode = layoutOnly || Boolean(zoomBrowser);
    if (layoutMode) {
      await context.addInitScript(fixedTime => {
        const NativeDate = Date;
        const fixedEpoch = NativeDate.parse(fixedTime);
        class FixedDate extends NativeDate {
          constructor(...args) { super(...(args.length ? args : [fixedEpoch])); }
          static now() { return fixedEpoch; }
        }
        Object.setPrototypeOf(FixedDate, NativeDate);
        window.Date = FixedDate;
      }, FIXED_BROWSER_TIME);
    }
    const channels = ['telegram','viber','sms','facebook','instagram','whatsapp'];
    const accounts=channels.map(channel=>({channel,label:channel,status:['telegram','whatsapp'].includes(channel)?'connected':'disconnected',connected:['telegram','whatsapp'].includes(channel),sendCapable:['telegram','whatsapp'].includes(channel),receiveCapable:['telegram','whatsapp'].includes(channel),setupFields:[],supportedActions:['connect','test','recheck'],accountName:'QA fixture'}));
    const conversations=Array.from({length:105},(_,i)=>({
      id:9001+i,
      channel:layoutMode ? channels[i % channels.length] : 'telegram',
      externalId:'fixture-'+i,
      customerName:'Тестовий діалог '+(i+1),
      lastMessage:layoutMode && i === 0
        ? 'Довге останнє повідомлення перевіряє обрізання без розширення рядка розмови'
        : 'Тестовий текст',
      lastMessageAt:'2099-01-01T12:00:00Z',
      businessContext:'event_genix',
      sendCapable:!layoutMode || [0,5].includes(i % channels.length),
      unreadCount:i % 9 === 0 ? 3 : 0,
      meta:{ai_enabled:false},
      status:'open'
    }));
    if (layoutMode) conversations[0].customerName = 'Fedorova Nataliy — довге ім’я клієнта групового діалогу';
    if (layoutMode) {
      const whatsappConversation = conversations.find(conversation => conversation.channel === 'whatsapp');
      whatsappConversation.customerName = 'WhatsApp QA — шаблон після 24 годин';
      whatsappConversation.lastInboundAt = '2098-12-30T08:00:00Z';
      whatsappConversation.whatsappReplyWindow = { open: false, closesAt: '2098-12-31T08:00:00Z', remainingMs: 0 };
    }
    const history=new Map(conversations.map(c=>[c.id,Array.from({length:c.id===9001?105:2},(_,i)=>({id:c.id*1000+i,conversationId:c.id,direction:'inbound',content:'Діалог '+c.id+' повідомлення '+(i+1)+'\nДругий рядок',createdAt:'2099-01-01T12:00:00Z'}))]));
    const telephonyCalls = [
      { callId: 'fixture-call-1', direction: 'incoming', status: 'completed', customerPhone: '+380000000001', companyPhone: '100', agent: { name: 'Олена', group: 'Продажі' }, startedAt: '2099-01-01T10:00:00Z', waitingSeconds: 0, talkSeconds: 63, recording: { available: true }, customer: { id: '42', name: 'Тестовий клієнт' } },
      { callId: 'fixture-call-2', direction: 'outgoing', status: 'answered', customerPhone: '+380000000002', companyPhone: '101', agent: { name: 'Ігор', group: 'Продажі' }, startedAt: '2099-01-01T10:05:00Z', waitingSeconds: 4, talkSeconds: 120, recording: { available: false }, customer: { id: null, name: null } },
    ];
    if (layoutMode) {
      const primaryHistory = history.get(9001);
      primaryHistory[primaryHistory.length - 3] = {
        id: 99001001,
        conversationId: 9001,
        direction: 'inbound',
        content: 'Вкладення з довгою назвою не повинно розширювати історію повідомлень',
        createdAt: '2099-01-01T12:02:00Z',
        meta: { storedAttachments: [{ id: 'fixture-layout-file', filename: 'дуже-довга-назва-вкладення-для-перевірки-адаптивності.pdf', size: 4096 }] }
      };
      primaryHistory[primaryHistory.length - 2] = {
        id: 99001002,
        conversationId: 9001,
        direction: 'outbound',
        content: 'Повідомлення з помилкою доставки',
        deliveryStatus: 'later_failed',
        deliveryError: 'Тестова помилка доставки',
        createdAt: '2099-01-01T12:03:00Z'
      };
      primaryHistory[primaryHistory.length - 1] = {
        id: 99001003,
        conversationId: 9001,
        direction: 'inbound',
        content: 'Останнє дуже довге повідомлення перевіряє перенесення тексту, досяжність кінця історії та збереження позиції після зміни режиму й ширини.\nДругий рядок лишається всередині бульбашки.',
        createdAt: '2099-01-01T12:04:00Z'
      };
    }
    let delayA=false, sendResolve, sendStartedResolve;
    let sendStarted=new Promise(resolve=>{sendStartedResolve=resolve;});
    let conversationFixtureMode = 'normal';
    let pendingConversationRequests = 0;
    const conversationWaiters = [];
    const releaseConversationWaiters = () => {
      while (conversationWaiters.length) conversationWaiters.shift()();
    };
    const mutations=[];
    const unexpectedFixtureRequests=[];
    const attachment = { id: '11111111-1111-4111-8111-111111111111', filename: 'fixture.pdf', size: 12, mime: 'application/pdf', checksum: 'fixture-checksum' };
    await context.exposeFunction('__omniFixtureSetConversationMode', mode => {
      conversationFixtureMode = String(mode || 'normal');
      if (conversationFixtureMode !== 'loading') releaseConversationWaiters();
    });
    await context.exposeFunction('__omniFixtureConversationState', () => ({
      mode: conversationFixtureMode,
      pending: pendingConversationRequests
    }));
    await context.exposeFunction('__omniFixtureUpdateConversation', update => {
      const conversation = conversations.find(item => item.id === Number(update?.id));
      if (conversation) Object.assign(conversation, update);
      return Boolean(conversation);
    });
    await context.route('**/*',async route=>{
      const req=route.request(), url=new URL(req.url());
      if(url.origin!==base) {
        if (layoutMode && ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
        return route.abort();
      }
      const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if (layoutOnly && url.pathname === '/api/auth/verify') return json({ success: true, user: session.user });
      if (layoutOnly && url.pathname === '/api/auth/business-profile') {
        return json({ success: true, user: session.user, businessProfile: fixtureBusinessProfile });
      }
      if (layoutOnly && /^\/api\/bookings\/\d{4}-\d{2}-\d{2}$/.test(url.pathname)) return json([]);
      if (layoutOnly && url.pathname === '/api/dashboard/widgets/currency') return json({ success: true, data: {} });
      if (layoutOnly && url.pathname === '/api/dashboard/alerts') return json({ alerts: [], count: 0 });
      if (layoutOnly && url.pathname === '/api/business/live-counters') {
        return json({
          success: true,
          scope: fixtureBusinessProfile.scope,
          counters: { byBusiness: { event_genix: { leads: { new: 0 } } }, total: { leads: { new: 0 } } }
        });
      }
      if (layoutOnly && url.pathname === '/api/my-day/timer') return json({ success: true, timer: null });
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
          if(p.endsWith('/whatsapp-template')) {
            const body = req.postDataJSON();
            assert.match(body.client_request_id,/^[a-f0-9]{40}$/);
            assert.equal(body.template.name,'appointment_reminder');
            const id = Number(p.split('/')[2]);
            history.get(id).push({id:99000004,conversationId:id,direction:'outbound',content:'Вітаємо, Сергій. Чекаємо о 18:00.',deliveryStatus:'accepted',providerMessageId:'wamid.fixture-template',createdAt:'2099-01-01T12:05:00Z',meta:{whatsappTemplate:{name:'appointment_reminder',language:'uk'},sendTruth:{status:'provider_attempted',providerAccepted:true}}});
            return json({success:true,data:history.get(id).at(-1),sendTruth:{status:'provider_attempted',providerAccepted:true,providerReference:'wamid.fixture-template'},conversation:conversations.find(c=>c.id===id)});
          }
          if(p.endsWith('/send')) {
            assert.match(req.postDataJSON().client_request_id,/^[a-f0-9]{40}$/);
            const body = req.postDataJSON();
            if (layoutMode || body.attachment_id || body.reply_mode) {
              const id = Number(p.split('/')[2]);
              if (body.attachment_id) assert.equal(body.attachment_id, attachment.id);
              history.get(id).push({
                id:99000001,conversationId:id,direction:'outbound',content:body.text,
                deliveryStatus:'accepted',createdAt:'2099-01-01T12:05:00Z',
                meta:body.attachment_id?{attachment}:(body.reply_mode?{commentReply:{mode:body.reply_mode}}:{sendTruth:{status:'provider_attempted',providerAccepted:true}})
              });
              return json({success:true,data:history.get(id).at(-1),sendTruth:{status:'provider_attempted',providerAccepted:true}});
            }
            sendStartedResolve();
            await new Promise(resolve=>{sendResolve=resolve;});
            return json({success:true,sendTruth:{status:'provider_attempted',providerAccepted:true}});
          }
          if(p.endsWith('/recheck')||p.endsWith('/test')) return json({success:false,error:'Тестова помилка перевірки'},500);
          return json({success:false,error:'Тестова помилка закриття'},500);
        }
        if(p==='/operators') return json({success:true,data:[{username:fixtureOwner,label:'Тестовий менеджер'}]});
        if (p === '/telephony/calls') {
          const cursor = url.searchParams.get('cursor');
          const customerNumber = url.searchParams.get('customerNumber');
          const rows = customerNumber ? telephonyCalls.filter(call => call.customerPhone.includes(customerNumber)) : telephonyCalls;
          const page = cursor ? rows.slice(1) : rows.slice(0, 1);
          return json({ success: true, freshness: 'fixture 2099-01-01 12:30', page: { cursor: cursor ? null : (rows.length > 1 ? 'fixture-page-2' : null), complete: !cursor }, data: page });
        }
        if (p === '/telephony/summary') return json({ success: true, completeness: 'complete', data: { total: telephonyCalls.length, incoming: 1, outgoing: 1, missed: 0, averageWaitingSeconds: 2, averageTalkSeconds: 91.5 } });
        if(p==='/accounts') return json({success:true,accounts});
        if(p==='/stats') return json({success:true,data:{total:105,byStatus:{open:105}}});
        if(p==='/quick-replies') return json({success:true,data:[]});
        const templateMatch=p.match(/^\/conversations\/(\d+)\/whatsapp-templates$/);
        if(templateMatch) {
          const id=Number(templateMatch[1]),conversation=conversations.find(c=>c.id===id);
          return json({success:true,data:[{
            id:'fixture-template-1',name:'appointment_reminder',language:'uk',category:'UTILITY',status:'APPROVED',
            header:'Нагадування',body:'Вітаємо, {{customer_name}}. Чекаємо {{1}}.',footer:'EventGenix',
            parameters:{header:[],body:['customer_name','1']},buttons:[{index:0,type:'quick_reply',text:'Підтверджую'}],supported:true,unsupportedReason:null
          }],replyWindow:conversation?.whatsappReplyWindow,conversation});
        }
        if(p==='/conversations') {
          if (conversationFixtureMode === 'loading') {
            pendingConversationRequests++;
            await new Promise(resolve => conversationWaiters.push(resolve));
            pendingConversationRequests--;
          }
          if (conversationFixtureMode === 'error') return json({success:false,error:'Тестова помилка завантаження розмов'},500);
          if (conversationFixtureMode === 'empty') return json({success:true,data:{conversations:[],total:0}});
          const search=url.searchParams.get('search')||'', channel=url.searchParams.get('channel');
          const filtered=conversations.filter(c=>(!channel||c.channel===channel)&&(!search||c.customerName.includes(search))&&(!url.searchParams.get('status')||c.status===url.searchParams.get('status'))&&(url.searchParams.get('mine')!=='true'||c.assignedTo===fixtureOwner));
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
      if (layoutOnly && url.pathname.startsWith('/api/')) {
        unexpectedFixtureRequests.push(`${req.method()} ${url.pathname}`);
        return json({ success: false, error: `Unhandled Omni browser fixture API: ${url.pathname}` }, 404);
      }
      if(!['GET','HEAD'].includes(req.method())) return route.abort();
      const local=new Map([['/omni','omni.html'],['/css/omni-workspace.css','css/omni-workspace.css']]);
      if(local.has(url.pathname)) {
        const file=local.get(url.pathname);
        const content=fs.readFileSync(path.join(root,file),'utf8');
        return route.fulfill({status:200,contentType:file.endsWith('.css')?'text/css':'text/html',body:file.endsWith('.html')?content.replace('// ---- Events ----','window.__omniFixtureRefresh = loadConversations; window.__omniFixtureRefreshAccounts = loadOmniAccounts; window.__omniFixtureDebug = () => ({ currentConvId, selectedDraftKey, input: input.value, draft: selectedDraftKey ? conversationDrafts.get(selectedDraftKey) || null : null, mode: omniMode, mobileView: mobileInboxView }); // ---- Events ----'):content});
      }
      const staticFile = path.resolve(root, '.' + url.pathname);
      if (staticFile.startsWith(root + path.sep) && /\.(?:css|js|png|svg|webp|ico|woff2?)$/i.test(staticFile) && fs.existsSync(staticFile)) {
        return route.fulfill({path:staticFile});
      }
      if (layoutOnly) {
        unexpectedFixtureRequests.push(`${req.method()} ${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>{ errors.push(e.message.slice(0,120)); runReport.pageErrors = errors.slice(); });
    await page.goto(base+'/omni?businessContext=event_genix',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('body.shell-ready .omni-conv-item',{timeout:60000});
    const typography = await page.evaluate(async () => {
      await document.fonts.ready;
      const shell = document.querySelector('.omni-workspace-shell');
      const control = document.querySelector('#omniSearch');
      return {
        status: document.fonts.status,
        interFaces: Array.from(document.fonts)
          .filter(face => face.family.replace(/["']/g, '').toLowerCase() === 'inter')
          .filter(face => face.status === 'loaded')
          .map(face => ({ weight: face.weight, style: face.style, status: face.status })),
        shellFamily: shell ? getComputedStyle(shell).fontFamily : '',
        controlFamily: control ? getComputedStyle(control).fontFamily : ''
      };
    });
    if (layoutMode) {
      assert.equal(typography.status, 'loaded', 'web fonts did not finish loading');
      assert.ok(['400', '600', '700'].every(weight => typography.interFaces.some(face => face.weight === weight)),
        `Inter font faces are unavailable: ${JSON.stringify(typography.interFaces)}`);
      assert.match(typography.shellFamily, /^Inter\b/i, 'Omni does not use the CRM base font');
      assert.match(typography.controlFamily, /^Inter\b/i, 'Omni controls do not inherit the CRM base font');
      runReport.environment.typography = typography;
      runReport.environment.fixedBrowserTime = FIXED_BROWSER_TIME;
      runReport.environment.externalResources = ['fonts.googleapis.com', 'fonts.gstatic.com'];
    }
    if (zoomBrowser) {
      const zoomResults = await zoomBrowser.check(page, artifactDir);
      assert.deepEqual(errors,[]);
      runReport.scenarios = {
        nativeBrowserZoom: true,
        separateTemporaryProfile: true,
        zoomFactors: [1, 1.25, 1.5],
        screens: [[1366, 768], [1024, 600]],
        results: zoomResults
      };
      runReport.status = 'passed';
      return;
    }
    if (layoutOnly) {
      const checks = require('./omni-layout.checks.cjs');
      runReport.scenarios = process.env.OMNI_TELEPHONY_ONLY === '1'
        ? { telephony: await checks.telephony(page, artifactDir) }
        : await checks(page, artifactDir);
      assert.deepEqual(errors,[]);
      runReport.unexpectedFixtureRequests = unexpectedFixtureRequests.slice();
      assert.deepEqual(unexpectedFixtureRequests, [], 'Omni browser fixture attempted an unhandled same-origin request');
      runReport.status = 'passed';
      return;
    }
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
    await page.locator('#omniAssignee').selectOption(fixtureOwner);
    await page.waitForFunction(()=>!document.querySelector('#omniAssignee').disabled);
    await page.locator('#omniConversationStatus').selectOption('pending');
    await page.waitForFunction(()=>!document.querySelector('#omniConversationStatus').disabled);
    await page.locator('[data-omni-view-filter="mine"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.omni-conv-item').length===1);
    await page.locator('[data-omni-view-filter="all"]').click();
    await page.locator('#omniStatusFilters > summary').click();
    await page.locator('#omniStatusSelect').selectOption('closed');
    await page.waitForFunction(()=>document.querySelectorAll('.omni-conv-item').length===0);
    await page.locator('#omniExplainability').getByRole('button',{name:'Очистити',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.omni-conv-item').length===100);
    assert.equal(await page.locator('#omniStatusSelect').inputValue(),'all');
    await select(9002);
    await page.waitForFunction(()=>!document.querySelector('#omniAssignee').disabled);
    assert.equal(await page.locator('#omniAssignee').inputValue(),fixtureOwner);
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
    await page.locator('#omniInput').fill('Перша строка\nДруга строка\nТретя строка\nЧетверта строка');
    const draftHeight = await page.locator('#omniInput').evaluate(el => el.clientHeight);
    await select(9001); await select(9002);
    assert.equal(await page.locator('#omniInput').evaluate(el => el.clientHeight), draftHeight, 'multiline_draft_height_lost');
    await page.locator('#omniInput').fill('');
    const metrics=[];
    for(const [width,height] of [[1440,900],[1024,768],[390,844],[320,640],[390,420]]) {
      await page.setViewportSize({width,height});await page.waitForTimeout(250);
      if (height < 540) await page.locator('#omniInput').focus();
      const measurement=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,textWrap:getComputedStyle(document.querySelector('.omni-msg-content')).whiteSpace}));
      assert.ok(measurement.width<=width+1);assert.equal(measurement.textWrap,'pre-wrap');metrics.push(measurement);
      const bounds = await page.locator('#omniInput').boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height + 1, 'composer_outside_viewport');
      if (await page.locator('.omni-workspace-shell').evaluate(el=>el.classList.contains('omni-narrow'))) {
        const historyBounds = await page.locator('#omniMessages').boundingBox();
        assert.ok(historyBounds.height >= 64, 'history_collapsed');
        assert.ok(await page.locator('#omniMobileBack').isVisible());
      }
      await page.screenshot({path:path.join(artifactDir,'fixture-omni-'+width+'x'+height+'.png'),animations:'disabled'});
    }
    await page.setViewportSize({width:390,height:844});
    await page.locator('#omniInput').scrollIntoViewIfNeeded();
    const composer = await page.locator('#omniInput').boundingBox();
    assert.ok(composer.width >= 200 && composer.y >= 0 && composer.y + composer.height <= 844);
    await page.screenshot({path:path.join(artifactDir,'fixture-omni-mobile-composer.png'),animations:'disabled'});
    await page.locator('#omniMobileBack').click();
    assert.ok(await page.locator('.omni-sidebar').isVisible());
    await select(9002);
    await page.evaluate(()=>{document.body.classList.remove('dark-mode');document.documentElement.classList.remove('dark-mode');document.documentElement.setAttribute('data-theme','light');document.documentElement.style.colorScheme='light';});
    await page.locator('#omniInput').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(artifactDir,'fixture-omni-mobile-light.png'),animations:'disabled'});
    await page.setViewportSize({width:1024,height:600});
    // Browser keyboard events do not prove native zoom in headless Chrome.
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,fixturesOnly:true,realWrites:0,conversationPagination:105,historyPagination:105,draftIsolation:true,staleMessageGuard:true,sendTargetGuard:true,idempotencyKey:true,managerAssignment:true,statusAndMineFilters:true,filterReset:true,failedCloseVisible:true,channelFeedbackVisible:true,mobileComposerReachable:true,mobileBack:true,metrics,browserZoom:"not measured",simulatedMutations:mutations.length}));
  } catch (error) {
    runReport.status = 'failed';
    runReport.error = sanitize(error?.stack || error?.message || error).slice(0, 6000);
    throw error;
  } finally {
    if (layoutOnly && tracingStarted) {
      try {
        await context.tracing.stop({ path: path.join(artifactDir, 'trace.zip') });
      } catch (error) {
        runReport.traceError = sanitize(error?.message || error).slice(0, 500);
      }
    }
    if (layoutOnly) writeRunReport();
    if (zoomBrowser) await zoomBrowser.close(); else await browser.close();
    if (api) await api.dispose();
  }
})().catch(e=>{
  runReport.status = 'failed';
  runReport.error = sanitize(e?.stack || e?.message || e).slice(0, 6000);
  if (layoutOnly) writeRunReport();
  console.log(JSON.stringify({ok:false,error:sanitize(e.message).slice(0,500),stack:sanitize(e.stack).slice(0,1800)}));
  process.exitCode=1;
});

