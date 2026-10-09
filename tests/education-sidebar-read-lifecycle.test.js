'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/components/sidebar.js'), 'utf8');
function deferred() { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; }
function fixture(kind) {
    const reads=[],writes=[],timers=[],warnings=[];
    let scope='dar/operator-a/session-1',exiting=false;
    const widget={hidden:false,classList:{toggle:()=>writes.push('class')}};
    const values=new Map();
    const document={hidden:false,body:{classList:{contains:()=>exiting}},getElementById(id){
        if(id==='focusChipTasks')return widget;
        if(!values.has(id))values.set(id,{set textContent(value){writes.push({id,value});}});
        return values.get(id);
    }};
    const state={taskWidgetTimer:null,timelineSummaryRequestSeq:0,timelineSummaryPromises:new Map(),timelineSummaryCache:new Map()};
    const context=vm.createContext({document,_state:state,_commandState:{},window:{location:{pathname:'/'},CrmBusinessContext:{apiUrl:url=>url}},localStorage:{getItem:()=> 'synthetic'},
        fetch:(url,options)=>{const read=deferred();reads.push({url,options,...read});return read.promise;},
        _isAuthenticatedSidebarRuntimeReady:()=>true,_sidebarRequestScopeKey:()=>scope,
        _sidebarNormalizeTimelineMode:mode=>mode,_sidebarTimelineBuildSummary:record=>record,
        _sidebarTimelineSummaryCacheKey:()=> 'summary',SIDEBAR_TIMELINE_SUMMARY_CACHE_TTL:60000,
        _setSidebarTimelineSummary:record=>{writes.push(record);return record;},_sidebarTimelineSummaryModeUrl:()=>'/api/bookings/2026-10-03',_sidebarAuthHeaders:()=>({}),_sidebarTimelineCountBookings:rows=>rows.length,
        _canSeeSidebarTaskSurface:()=>true,getAuthHeaders:()=>({}),_coalesceSidebarRequest:(_kind,_url,request)=>request(),
        _getCurrentSidebarUser:()=>({id:1,username:'synthetic'}),_sidebarTaskQuickCountsFromCabinet:()=>({completed:1,open:2,overdue:0}),
        _sidebarKyivToday:()=> '2026-10-03',_isSidebarTaskOpen:()=>true,_isSidebarTaskCompletedToday:()=>false,_formatTaskWidgetCount:String,
        _setCommandDescription:()=>writes.push('description'),_setFocusChipOperationalState:()=>writes.push('operational'),_syncFocusDeckAccess:()=>{},
        setTimeout:()=>{timers.push('timer');return 1;},clearTimeout:()=>{},console:{warn:(...args)=>warnings.push(args)},Date,Map,Number,Set,Promise});
    const start=source.indexOf(kind==='summary'?'    async function _fetchSidebarTimelineSummaryMode(':'    async function _refreshTaskMiniWidget(');
    const end=source.indexOf(kind==='summary'?'    async function _fetchSidebarTimelineSummary(':'    async function _refreshFunnelWidget(',start);
    assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end),context);
    return {context,state,document,reads,writes,timers,warnings,setScope:value=>{scope=value;},exit:()=>{exiting=true;},
        start:()=>kind==='summary'?context._fetchSidebarTimelineSummaryMode({date:'2026-10-03',businessContext:'dar'},'rooms'):context._refreshTaskMiniWidget(),
        answer:(index,value)=>reads[index].resolve({ok:true,json:async()=>value})};
}
async function reachFallback(f) {
    const pending=f.start();assert.equal(f.reads[0].options.keepalive,true);
    f.answer(0,null);
    for(let i=0;i<8&&!f.reads[1];i++)await Promise.resolve();
    assert.ok(f.reads[1],'Actual task fallback reached');assert.equal(f.reads[1].options.keepalive,true);
    return {pending};
}
test('sidebar summary optional GET survives navigation and completes current state',async()=>{
    const f=fixture('summary'),pending=f.start();assert.equal(f.reads[0].options.keepalive,true);f.answer(0,[{}]);await pending;
    assert.equal(f.writes.at(-1).status,'ready');assert.equal(f.writes.at(-1).count,1);assert.equal(f.state.timelineSummaryPromises.size,0);
});
for(const transition of ['business','operator','session','unload']){
    test(`sidebar optional summaries ignore ${transition} completion`,async()=>{
        const f=fixture('summary'),pending=f.start(),initial=f.writes.length;
        if(transition==='hidden')f.document.hidden=true;else if(transition==='unload')f.exit();else f.setScope(transition);
        f.answer(0,[{}]);assert.equal(await pending,null);assert.equal(f.writes.length,initial);assert.equal(f.state.timelineSummaryPromises.size,0);
    });
    test(`sidebar task fallback ignores ${transition} completion and does not restart timer`,async()=>{
        const f=fixture('tasks'),{pending}=await reachFallback(f);
        if(transition==='hidden')f.document.hidden=true;else if(transition==='unload')f.exit();else f.setScope(transition);
        f.answer(1,[{owner_user_id:1}]);await pending;assert.equal(f.writes.length,0);assert.equal(f.timers.length,0);
    });
}
test('sidebar stale failed summary neither warns nor renders an error for a new scope',async()=>{
    const f=fixture('summary'),pending=f.start(),initial=f.writes.length;f.setScope('other-business');f.reads[0].reject(new Error('controlled failure'));
    assert.equal(await pending,null);assert.equal(f.warnings.length,0);assert.equal(f.writes.length,initial);
});
test('sidebar current task fallback retains normal counts and refresh timer',async()=>{
    const f=fixture('tasks'),{pending}=await reachFallback(f);f.answer(1,[{owner_user_id:1}]);await pending;
    assert.ok(f.writes.length>0);assert.equal(f.context._commandState.tasksActive,1);assert.equal(f.timers.length,1);
});

test('current summary completes in a background tab without retaining loading',async()=>{
 const f=fixture('summary'),pending=f.start();f.document.hidden=true;f.answer(0,[{}]);await pending;assert.equal(f.writes.at(-1).status,'ready');
});
test('current task counts complete in a background tab and retain polling',async()=>{
 const f=fixture('tasks'),{pending}=await reachFallback(f);f.document.hidden=true;f.answer(1,[{owner_user_id:1}]);await pending;assert.equal(f.context._commandState.tasksActive,1);assert.equal(f.timers.length,1);
});
test('failed optional task read after unload does not restart its timer',async()=>{
 const f=fixture('tasks'),pending=f.start();f.exit();f.reads[0].reject(new Error('controlled late failure'));await pending;assert.equal(f.writes.length,0);assert.equal(f.timers.length,0);
});
