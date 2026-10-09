'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../js/timeline-visibility.js'),'utf8');
function fixture() {
 const handlers={},writes=[],statuses=[],state={pageExiting:false,serverLoadPromise:null,serverLoadKey:null,serverLoadController:null,serverSettings:new Map()};let signal,optionsSeen,resolveRead;
 const document={visibilityState:'visible',addEventListener:(name,fn)=>{handlers[name]=fn;}};
 const context=vm.createContext({document,state,Promise,AbortController,fetch:(_,options)=>{signal=options.signal;optionsSeen=options;return new Promise((resolve,reject)=>{resolveRead=resolve;signal?.addEventListener('abort',()=>reject(Object.assign(new Error('Aborted'),{name:'AbortError'})),{once:true});});},hasAuthenticatedTimelineUser:()=>true,visibilityScopeKey:()=> 'dar',storageKey:()=> 'dar',apiUrl:()=>'/api/settings/timeline-visibility',authHeaders:()=>({}),mergeServerRegistry:()=>{},normalizeSettings:x=>x,JSON,console:{warn:()=>{}},localStorage:{setItem:(...args)=>writes.push(args)},setSaveStatus:(...args)=>statuses.push(args),window:{addEventListener:(name,fn)=>{handlers[name]=fn;}}});
 vm.runInContext(source.slice(source.indexOf('    async function loadServerSettings()'),source.indexOf('    function mergeServerRegistry(')),context);
 context.refreshAccess=()=>context.loadServerSettings();
 vm.runInContext(source.slice(source.indexOf("    document.addEventListener('visibilitychange'"),source.indexOf('    window.TimelineVisibility =')),context);
 return {context,state,handlers,writes,statuses,signal:()=>signal,options:()=>optionsSeen,finish:()=>resolveRead({ok:true,json:async()=>({registry:[]})})};
}
test('education optional read may finish after unload without stale state or writes',async()=>{
 const f=fixture(),pending=f.context.loadServerSettings();await Promise.resolve();await Promise.resolve();
 assert.ok(f.signal());assert.equal(f.options().keepalive,true,'Read-only request must survive native WebKit unload');f.handlers.pagehide();assert.equal(f.signal().aborted,false);
 f.finish();assert.equal(await pending,null);assert.equal(f.writes.length,0);assert.equal(f.statuses.length,0);assert.equal(f.state.serverLoadPromise,null);assert.equal(f.state.serverLoadController,null);
});
test('restored visible page can read settings after old unload completed',async()=>{
 const f=fixture(),pending=f.context.loadServerSettings();await Promise.resolve();await Promise.resolve();f.handlers.pagehide();f.finish();await pending;
 f.context.fetch=async()=>({ok:true,json:async()=>({registry:[]})});f.handlers.pageshow({persisted:true});await f.state.serverLoadPromise;assert.equal(f.state.pageExiting,false);assert.equal(f.writes.length,1);
});
