const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { captureOmniWebhookBody, parseProviderJson } = require('../services/omni-webhook-payload');
const modules = new Map();
function mock(name, value) {
  const id=require.resolve(name); if(!modules.has(id)) modules.set(id,require.cache[id]);
  require.cache[id]={id,filename:id,loaded:true,exports:value};
}
function fresh(name) {const id=require.resolve(name);if(!modules.has(id))modules.set(id,require.cache[id]);delete require.cache[id];return require(name);}
afterEach(()=>{for(const [id,value] of modules){if(value)require.cache[id]=value;else delete require.cache[id];}modules.clear();});
const config={viber:{token:'fixture-viber'},facebook:{pageId:'fixture-page',appSecret:'fixture-fb',verifyToken:'fixture-verify'},instagram:{instagramAccountId:'fixture-page',appSecret:'fixture-ig',verifyToken:'fixture-ig-verify'},telegram:{webhookSecret:'fixture-telegram'},sms:{provider:'turbosms',webhookSecret:'fixture-sms'}};
function router(hub, runtime=config, user={id:1,role:'creator',username:'fixture'}) {
  mock('../services/omni-hub',hub);
  mock('../services/omni-accounts',{resolveOmniRuntimeConfig:async channel=>runtime[channel]||{},getOmniAccountStatusesAsync:async()=>[],
    providerDefinition:channel=>({channel}),publicWebhookUrl:(def,options)=>'https://crm.test/api/omni/webhook/'+def.channel+'?business_context='+options.businessContext});
  mock('../services/omni-health',{recordWebhook:async()=>{}});
  mock('../middleware/auth',{authenticateToken:(req,res,next)=>{req.user=user;next();},requireMinRole:()=> (req,res,next)=>next(),requireAction:()=> (req,res,next)=>next()});
  mock('../services/adminAudit',{});mock('../services/omniLeadAssistant',{});
  mock('../services/omni-inbox',{applyMetaReceipt:async()=>[]});
  return fresh('../routes/omnichannel');
}
async function request(t, routes, url, {raw,headers={},method='POST'}={}) {
  const app=express();app.use(express.json({verify:captureOmniWebhookBody}));app.use('/api/omni',routes);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try {
    const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/omni'+url,{method,headers:{'content-type':'application/json',...headers},...(raw===undefined?{}:{body:raw})});
    return {status:r.status,text:await r.text()};
  } finally { await new Promise(resolve=>server.close(resolve)); }
}
function signed(raw, key, meta=false){return (meta?'sha256=':'')+crypto.createHmac('sha256',key).update(raw).digest('hex');}

test('attachment and comment sends require an idempotency key before dispatch', async t => {
  let sends = 0;
  const routes = router({ sendManualMessage: async () => { sends++; return {}; } });
  for (const body of [
    { attachment_id: '12345678-1234-1234-1234-123456789abc' },
    { text: 'Fixture reply', reply_mode: 'public_comment', reply_to_message_id: 1 },
  ]) {
    const response = await request(t, routes, '/conversations/1/send', { raw: JSON.stringify(body) });
    assert.equal(response.status, 400);
  }
  assert.equal(sends, 0);
  assert.equal((await request(t, routes, '/conversations/1/send', { raw: JSON.stringify({ text: 'Legacy text' }) })).status, 200);
  assert.equal(sends, 1);
});

test('WhatsApp template routes preserve business scope and require an idempotency key', async t => {
  const calls = [];
  const routes = router({
    getWhatsAppTemplatesForConversation: async (...args) => {
      calls.push(['list', ...args]);
      return {
        templates: [{ name: 'follow_up', language: 'uk', status: 'APPROVED' }],
        replyWindow: { open: false },
        conversation: { id: 7, channel: 'whatsapp', businessContext: 'dar' },
      };
    },
    sendWhatsAppTemplateMessage: async (...args) => {
      calls.push(['send', ...args]);
      return { message: { id: 70 }, sendTruth: { status: 'provider_attempted' }, conversation: { id: 7 } };
    },
  });

  const list = await request(t, routes, '/conversations/7/whatsapp-templates?businessContext=dar&refresh=true', { method: 'GET' });
  assert.equal(list.status, 200);
  assert.equal(JSON.parse(list.text).data[0].name, 'follow_up');
  assert.equal(calls[0][2].businessContext, 'dar');
  assert.equal(calls[0][2].refresh, true);

  const missingKey = await request(t, routes, '/conversations/7/whatsapp-template?businessContext=dar', {
    raw: JSON.stringify({ template: { name: 'follow_up', language: 'uk' } }),
  });
  assert.equal(missingKey.status, 400);

  const sent = await request(t, routes, '/conversations/7/whatsapp-template?businessContext=dar', {
    raw: JSON.stringify({
      client_request_id: '0123456789abcdef0123456789abcdef01234567',
      template: { name: 'follow_up', language: 'uk', parameters: { body: { 1: 'Сергій' } } },
    }),
  });
  assert.equal(sent.status, 200);
  assert.equal(JSON.parse(sent.text).sendTruth.status, 'provider_attempted');
  assert.equal(calls[1][1], 7);
  assert.equal(calls[1][2].name, 'follow_up');
  assert.equal(calls[1][4].businessContext, 'dar');
});

test('Viber setup binds both the provider token and callback URL to the selected business', async t => {
  const calls = [];
  mock('../services/omni-viber', { setViberWebhook: async (...args) => { calls.push(args); return { success: true }; } });
  const routes = router({});
  const response = await request(t, routes, '/setup/viber?businessContext=dar', {raw:JSON.stringify({})});
  assert.equal(response.status, 200);
  assert.equal(calls[0][2]?.businessContext, 'dar');
  const target = new URL(calls[0][0]);
  assert.equal(target.searchParams.get('business_context'), 'dar');
  assert.equal(target.searchParams.has('businessContext'), false);
});

for (const channel of ['viber', 'facebook', 'instagram', 'sms']) {
  test(`${channel} inbound reaches its business and a storage failure requests provider retry`, async t => {
    const calls = [];
    let fail = false;
    const routes = router({processInboundMessage:async (...args) => { if(fail) throw Error('fixture storage unavailable'); calls.push(args); }});
    let payload, headers, endpoint;
    if (channel === 'viber') {
      payload = {event:'message',message_token:123,sender:{id:'fixture-customer'},message:{type:'text',text:'Fixture inbound'}};
      endpoint = '/webhook/viber';
    } else if (channel === 'sms') {
      payload = {from:'+380000000001',text:'Fixture inbound',message_id:'fixture-sms'};
      endpoint = '/webhook/sms';
    } else {
      payload = {object:channel === 'facebook'?'page':'instagram',entry:[{id:'fixture-page',messaging:[{sender:{id:'fixture-customer'},message:{mid:'fixture-mid',text:'Fixture inbound'}}]}]};
      endpoint = '/webhook/meta';
    }
    const raw=JSON.stringify(payload);
    headers=channel === 'viber' ? {'x-viber-content-signature':signed(raw,config.viber.token)}
      : channel === 'sms' ? {'x-webhook-secret':config.sms.webhookSecret}
      : {'x-hub-signature-256':signed(raw,config[channel].appSecret,true)};
    assert.equal((await request(t,routes,endpoint+'?businessContext=dar',{raw,headers})).status,200);
    assert.equal(calls.length,1);
    assert.equal(calls[0][0].channel,channel);
    assert.equal(calls[0][0].content,'Fixture inbound');
    assert.equal(calls[0][1].businessContext,'dar');
    fail=true;
    assert.equal((await request(t,routes,endpoint+'?businessContext=dar',{raw,headers})).status,503);
  });
}

test('raw-body capture is restricted to Omni webhooks and preserves unsafe numeric IDs without changing message text',()=>{
  const raw=Buffer.from('{ "message_token":4912661846655238145,"text":"4912661846655238145 \\"42\\"" }');
  // A separate valid string fixture keeps escaped strings distinct from numeric tokens.
  const parsed=parseProviderJson('{"id":4912661846655238145,"n":7,"text":"4912661846655238145"}');
  assert.equal(parsed.id,'4912661846655238145');assert.equal(parsed.n,7);assert.equal(parsed.text,'4912661846655238145');
  for(const url of ['/api/omni/webhook/viber','/api/v1/omni/webhook/meta?businessContext=dar']){
    const req={originalUrl:url};captureOmniWebhookBody(req,null,raw);assert.deepEqual(req.omniRawBody,raw);
  }
  const ordinary={originalUrl:'/api/auth/login'};captureOmniWebhookBody(ordinary,null,raw);assert.equal(ordinary.omniRawBody,undefined);
});

test('Viber verifies original whitespace and keeps a full-width message token with business-scoped receipt',async t=>{
  const calls=[];const routes=router({applyProviderLifecycleReceipt:async(...args)=>calls.push(args)});
  const raw='{ "event":"delivered", "message_token":4912661846655238145 }';
  const result=await request(t,routes,'/webhook/viber?businessContext=dar',{raw,headers:{'x-viber-content-signature':signed(raw,config.viber.token)}});
  assert.equal(result.status,200);assert.equal(calls[0][0].providerMessageId,'4912661846655238145');assert.equal(calls[0][1].businessContext,'dar');
  const altered=await request(t,routes,'/webhook/viber',{raw:raw+' ',headers:{'x-viber-content-signature':signed(raw,config.viber.token)}});
  assert.equal(altered.status,403);assert.equal(calls.length,1);
});

test('Meta verifies the stored token and the correct channel secret; service events and echoes do not swallow the next message',async t=>{
  const calls=[];const routes=router({processInboundMessage:async(...args)=>calls.push(args)});
  const challenge=await request(t,routes,'/webhook/meta?hub.mode=subscribe&hub.verify_token=fixture-ig-verify&hub.challenge=42',{method:'GET'});
  assert.equal(challenge.status,200);assert.equal(challenge.text,'42');
  const raw=JSON.stringify({object:'instagram',entry:[{id:'fixture-page',messaging:[{sender:{id:'customer'},read:{watermark:1}},{sender:{id:'page'},message:{is_echo:true,text:'echo'}},{sender:{id:'customer'},message:{mid:'mid1',text:'Hello'}}]}]});
  assert.equal((await request(t,routes,'/webhook/meta',{raw,headers:{'x-hub-signature-256':signed(raw,config.facebook.appSecret,true)}})).status,403);
  assert.equal((await request(t,routes,'/webhook/meta',{raw,headers:{'x-hub-signature-256':signed(raw,config.instagram.appSecret,true)}})).status,200);
  assert.equal(calls.length,1);assert.equal(calls[0][0].content,'Hello');
});

test('failed durable Telegram processing returns a retryable response',async t=>{
  const routes=router({processInboundMessage:async()=>{throw Error('fixture DB unavailable');}});
  const raw=JSON.stringify({message:{message_id:1,chat:{id:1},from:{id:1},text:'fixture'}});
  const r=await request(t,routes,'/webhook/telegram',{raw,headers:{'x-telegram-bot-api-secret-token':'fixture-telegram'}});
  assert.equal(r.status,503);assert.equal(JSON.parse(r.text).ok,false);
});

test('signed Meta comments, postbacks and quick replies are processed while unknown events remain diagnostic', async t => {
  const calls = []; const diagnostics = [];
  const routes = router({ processInboundMessage: async (...args) => calls.push(args) }, { ...config, facebook: { ...config.facebook, pageId: '12' } });
  mock('../services/omni-health', { recordWebhook: async (...args) => diagnostics.push(args) });
  const raw = JSON.stringify({ object: 'page', entry: [{ id: '12', changes: [
    { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: '12_34', post_id: '12_56', from: { id: '78' }, message: 'Fixture' } },
    { field: 'unsupported_fixture', value: {} },
  ], messaging: [
    { sender: { id: '78' }, timestamp: 123456789, postback: { title: 'Button', payload: 'action' } },
    { sender: { id: '78' }, message: { mid: 'fixture-quick', text: 'Yes', quick_reply: { payload: 'yes' } } },
  ] }] });
  const result = await request(t, routes, '/webhook/meta?businessContext=dar', { raw, headers: { 'x-hub-signature-256': signed(raw, config.facebook.appSecret, true) } });
  assert.equal(result.status, 200); assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call[0].meta.eventType).sort(), ['comment', 'postback', 'quick_reply']);
  assert.ok(calls.every(call => call[1].businessContext === 'dar'));
  assert.equal(diagnostics.at(-1)[2].errorCode, 'unsupported_event');
  const tampered = await request(t, routes, '/webhook/meta', { raw: raw + ' ', headers: { 'x-hub-signature-256': signed(raw, config.facebook.appSecret, true) } });
  assert.equal(tampered.status, 403); assert.equal(calls.length, 3);
});

test('TurboSMS native signature and data envelope reach only the scoped delivery updater',async t=>{
  const calls=[];const routes=router({applyProviderLifecycleReceipt:async(...args)=>calls.push(args)});
  const body={id:'event1',type:'DLR_SMS_API',signature:crypto.createHash('sha1').update('fixture-smsevent1').digest('hex'),data:{message_id:'sms1',status:'DELIVRD'}};
  const r=await request(t,routes,'/webhook/sms?businessContext=dar',{raw:JSON.stringify(body)});
  assert.equal(r.status,200);assert.equal(calls[0][0].providerMessageId,'sms1');assert.equal(calls[0][1].businessContext,'dar');
  body.signature='wrong';assert.equal((await request(t,routes,'/webhook/sms',{raw:JSON.stringify(body)})).status,403);assert.equal(calls.length,1);
});

test('SMS acceptance is not a delivery confirmation and group Telegram replies address the chat',()=>{
  const normalizer=fresh('../services/omni-normalizer');
  for(const status of ['SENT','ACCEPTD','ACCEPTED']) assert.equal(normalizer.classifySmsWebhook({message_id:'sms',status}).receipt.deliveryStatus,'accepted');
  assert.equal(normalizer.classifySmsWebhook({message_id:'sms',status:'DELIVRD'}).receipt.deliveryStatus,'delivered');
  const msg=normalizer.normalizeTelegram({message:{message_id:1,chat:{id:-123,type:'group'},from:{id:99},text:'fixture'}});
  assert.equal(msg.externalId,'-123');
});

test('operators can read channel status while an explicit Omni page denial is enforced',async t=>{
  const allowed=router({},config,{id:7,role:'manager',username:'fixture'});
  assert.equal((await request(t,allowed,'/accounts',{method:'GET'})).status,200);
  const denied=router({},config,{id:7,role:'manager',pageDenylist:['/omni']});
  assert.equal((await request(t,denied,'/accounts',{method:'GET'})).status,403);
});

test('Omni invalidations use the fresh business dispatch boundary without customer content',async()=>{
  const received=[];
  mock('../db',{pool:{}});mock('../services/websocket',{
    broadcastBusinessEvent:async(type,data,options)=>{received.push({type,data,options});return 1;},
    getWSS:()=>{throw new Error('Direct socket access is forbidden');}
  });
  const hub=fresh('../services/omni-hub');
  assert.equal(await hub.notifyCRM('omni:message',{conversation:{id:1,businessContext:'event_genix',customerName:'Private'},message:{conversationId:1,content:'Private text'}}),1);
  assert.deepEqual(received,[{type:'omni:message',data:{businessContext:'event_genix',conversationId:1},options:{businessContext:'event_genix',page:'/omni',envelope:'data'}}]);
  assert.equal(await hub.notifyCRM('omni:message',{message:{content:'No context'}}),0);
  assert.equal(received.length,1);
  assert.equal(hub.generateAndSendAIResponse,undefined);
});
