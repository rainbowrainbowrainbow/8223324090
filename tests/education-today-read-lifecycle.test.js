'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function block(file,start,end){const s=fs.readFileSync(path.join(__dirname,'..',file),'utf8'),a=s.indexOf(start),b=s.indexOf(end,a);assert.ok(a>=0&&b>a);return s.slice(a,b);}
const apiSource=block('js/api.js','async function apiGetBookings(','async function apiGetBookingById(');
const timelineSource=block('js/timeline.js','async function getBookingsForDate(','\n}')+'\n}';
const todaySource=block('js/education-schedule.js','    async function load(','    function setView(');
function apiFixture(response={ok:true,json:async()=>[{id:'synthetic'}]}){
 const calls=[],warnings=[];
 const context=vm.createContext({API_BASE:'/api',timelineApiUrlWithView:route=>route,getTimelineAuthHeaders:()=>({Authorization:'synthetic'}),apiNetworkFetch:async(url,options)=>{calls.push({url,options});if(response instanceof Error)throw response;return response;},handleAuthError:()=>false,apiErrorFromPayload:payload=>Object.assign(new Error('controlled API error'),payload),console:{error:(...args)=>warnings.push(args)},Date});
 vm.runInContext(apiSource,context);return {context,calls,warnings};
}
for(const [value,expected] of [[undefined,false],[true,true],[false,false],['true',false]]){
 test('canonical bookings GET keepalive accepts only explicit true: '+String(value),async()=>{
  const f=apiFixture(),signal=new AbortController().signal,rows=await f.context.apiGetBookings('2026-10-03',{keepalive:value,signal});
  assert.equal(f.calls[0].options.keepalive,expected);assert.equal(f.calls[0].options.signal,signal);assert.equal(f.calls[0].url,'/api/bookings/2026-10-03');assert.equal(f.calls[0].options.headers.Authorization,'synthetic');assert.equal(rows[0].id,'synthetic');
 });
}
test('opt-in GET retains abort and HTTP error contracts',async()=>{
 const aborted=Object.assign(new Error('controlled abort'),{name:'AbortError'}),a=apiFixture(aborted);
 await assert.rejects(a.context.apiGetBookings('2026-10-03',{keepalive:true}),{name:'AbortError'});
 const f=apiFixture({ok:false,status:409,json:async()=>({code:'controlled-conflict'})});
 await assert.rejects(f.context.apiGetBookings('2026-10-03',{keepalive:true,throwOnError:true}),error=>error.status===409&&error.code==='controlled-conflict');
 assert.equal(await f.context.apiGetBookings('2026-10-03',{keepalive:true}),null);
});
for(const enabled of [true,false]){
 test('canonical timeline getter preserves scope and cache while forwarding keepalive '+enabled,async()=>{
  const calls=[],cachedWrites=[],signal=new AbortController().signal;
  const context=vm.createContext({timelineDateKey:date=>date,captureTimelineRequestToken:(_date,options)=>({businessContext:'dar',timelineView:'rooms',cacheScope:'dar/rooms',signal:options.signal}),consumeFreshTimelineBookingDate:()=>false,getTimelineCacheEntry:()=>null,AppState:{cachedBookings:{}},CACHE_TTL:60000,apiGetBookings:async(date,options)=>{calls.push({date,options});return [{id:'synthetic'}];},timelineRequestTokenIsCurrent:()=>true,setTimelineCacheEntry:(...args)=>cachedWrites.push(args),Date,console});
  vm.runInContext(timelineSource,context);await context.getBookingsForDate('2026-10-03',{keepalive:enabled,signal});
  assert.equal(calls[0].date,'2026-10-03');assert.equal(calls[0].options.keepalive,enabled);assert.equal(calls[0].options.signal,signal);assert.equal(calls[0].options.businessContext,'dar');assert.equal(calls[0].options.timelineView,'rooms');assert.equal(cachedWrites.length,1);
 });
}
test('visible Today loader opts into unload-safe read through the canonical getter',async()=>{
 let finish,captured;const pending=new Promise(resolve=>{finish=resolve;}),state={loading:false,error:null,bookings:[]};
 const context=vm.createContext({global:{getBookingsForDate:(_date,options)=>{captured=options;return pending;},AbortController,setTimeout:()=>1,clearTimeout:()=>{}},state,generation:0,activeRequest:null,isEducationMode:()=>true,business:()=> 'dar',render:()=>{}});
 vm.runInContext(todaySource,context);const loaded=context.load('2026-10-03',{force:true});
 assert.equal(captured.keepalive,true);assert.equal(captured.throwOnError,true);assert.equal(captured.force,true);assert.ok(captured.signal);assert.equal(state.loading,true);
 finish([{id:'synthetic'}]);await loaded;assert.equal(state.loading,false);assert.equal(state.error,null);assert.equal(state.bookings[0].id,'synthetic');
});
