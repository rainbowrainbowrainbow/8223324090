'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../js/leads-page.js'),'utf8');

test('Dashboard active and stale lead selections use the same scoped predicate in COUNT and rows',async()=>{
  const {pool}=require('../db');
  const router=require('../routes/leads');
  const handler=router.stack.find(layer=>layer.route?.path==='/'&&layer.route.methods.get).route.stack.at(-1).handle;
  const original=pool.query;
  try {
    for(const businessContext of ['event_genix','dar']) {
      for(const filter of [{lifecycle:'active'},{attention:'stale_contact_48h'},{lifecycle:'active',attention:'stale_contact_48h',pipeline_stage:'new'},{}]) {
        const calls=[];
        pool.query=async(sql,params=[])=>{
          calls.push({sql:String(sql),params:[...params]});
          return /SELECT COUNT\(\*\)::int AS total/.test(sql)?{rows:[{total:1}]}:{rows:[{id:91,pipeline_stage:'new',lead_type:'quality',business_context:businessContext}]};
        };
        const req={query:{...filter,businessContext,lead_type:'quality',limit:'1',offset:'0'},body:{},headers:{'x-business-context':businessContext},
          user:{id:48,userId:48,username:'dashboard-qa',role:'creator',business_contexts:[businessContext],default_business_context:businessContext}};
        const res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
        await handler(req,res);
        assert.equal(res.statusCode,200,JSON.stringify(res.body));
        assert.equal(res.body.pagination.total,1);
        assert.deepEqual(res.body.leads.map(row=>row.id),[91]);
        const queries=calls.filter(call=>/FROM leads l/.test(call.sql));
        assert.equal(queries.length,2,'full COUNT and preview both queried');
        for(const call of queries) {
          assert.ok(call.params.includes(businessContext),'current business bound');
          assert.match(call.sql,/business_context/);
          assert.ok(call.params.includes('quality'),'sales quality filter bound');
          const terminal=call.params.find(value=>Array.isArray(value)&&value.includes('completed'));
          if(filter.lifecycle||filter.attention) {
            assert.deepEqual(terminal,['completed','closed','lost']);
            assert.match(call.sql,/COALESCE\(l\.pipeline_stage, 'new'\) <> ALL\(\$\d+::text\[\]\)/);
          } else assert.equal(terminal,undefined,'ordinary Leads default remains unfiltered by lifecycle');
          if(filter.attention) assert.match(call.sql,/COALESCE\(l\.last_contact_at, l\.created_at\) < NOW\(\) - INTERVAL '48 hours'/);
          if(filter.pipeline_stage) assert.ok(call.params.includes('new'));
        }
      }
    }
  } finally {pool.query=original;}
});

function slice(start,end) {
  const a=source.indexOf(start);const b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,`production functions exist: ${start}`);
  return source.slice(a,b);
}
function harness(url) {
  const dom=new JSDOM('<input id="leadsSearch"><div id="leadsTableBody"></div>',{url,runScripts:'outside-only'});
  const context=dom.getInternalVMContext();const calls=[];
  for(const name of ['syncLeadPresentationUi','syncLeadQueueUi','renderStats','renderTable','renderKanban','syncWorkspaceHighlight','showNotification']) context[name]=()=>{};
  context.leadTypeForCurrentQueue=()=> 'quality';context.leadQueueFromLeadType=()=> 'active';
  context.shouldLoadLeadCustomerFallback=()=>false;context.todayKyiv=()=> '2026-09-14';
  context.loadLeadQueueStats=async()=>({});
  context.apiFetch=async url=>{calls.push(String(url));return {ok:true,json:async()=>({success:true,leads:[{id:91}],pagination:{total:2,limit:1,offset:0,nextOffset:1,hasMore:true}})};};
  vm.runInContext(`
    let currentView='table',currentFilter='',currentTypeFilter='',currentDateFilter='',currentPipelineStage='',currentLeadAttentionFilter='',currentLeadLifecycleFilter='',currentLeadQueue='active';
    let leadsData=[],leadStatsData=null,leadLoadSeq=0,leadCustomerSearchMatches=[],leadCustomerSearchQuery='';
    let leadPagination={total:0,hasMore:false},leadKanbanPagination={};
    const DEFAULT_LEAD_QUEUE='active',LEAD_QUEUE_FILTERS={active:{}},LEAD_VIEW_MODES=new Set(['table','kanban']);
    const PIPELINE_STAGES=[{key:'new'},{key:'completed'}],LEAD_TABLE_PAGE_SIZE=100,LEAD_KANBAN_PAGE_SIZE=100;
    ${slice('async function loadLeads()','async function loadLeadQueueStats()')}
    ${slice('function leadListParams()','function normalizeLeadCount(')}
    ${slice('function applyLeadQueryParams()','function getLeadFilterSummary()')}
    ${slice('function resetLeadFilters()','function leadEmptyHtml()')}
    this.qa={applyLeadQueryParams,syncLeadUrlState,loadLeads,loadMoreLeads,resetLeadFilters,leadListParams};
  `,context);
  return {dom,calls,hooks:context.qa};
}

test('Dashboard Leads initial load, more, URL reload and reset preserve explicit filters',async()=>{
  const initial=harness('https://crm.test/sales-funnel?businessContext=dar&lifecycle=active&attention=stale_contact_48h&pipeline_stage=new&lead_type=quality');
  try {
    initial.hooks.applyLeadQueryParams();await initial.hooks.loadLeads();await initial.hooks.loadMoreLeads();
    assert.equal(initial.calls.length,2);
    for(const raw of initial.calls){const p=new URL(raw,'https://crm.test').searchParams;
      assert.equal(p.get('attention'),'stale_contact_48h');assert.equal(p.get('lifecycle'),'active');
      assert.equal(p.get('pipeline_stage'),'new');assert.equal(p.get('lead_type'),'quality');}
    initial.hooks.syncLeadUrlState({replace:true});
    assert.equal(new URL(initial.dom.window.location.href).searchParams.get('businessContext'),'dar');
    const reloaded=harness(initial.dom.window.location.href);
    try {reloaded.hooks.applyLeadQueryParams();await reloaded.hooks.loadLeads();
      const p=new URL(reloaded.calls[0],'https://crm.test').searchParams;
      assert.equal(p.get('attention'),'stale_contact_48h');assert.equal(p.get('lifecycle'),'active');
      reloaded.hooks.resetLeadFilters();await new Promise(resolve=>setImmediate(resolve));
      assert.equal(reloaded.hooks.leadListParams().has('attention'),false);
      assert.equal(reloaded.hooks.leadListParams().has('lifecycle'),false);
    } finally {reloaded.dom.window.close();}
  } finally {initial.dom.window.close();}
});

test('Dashboard global active drilldown carries no accidental stage or stale-only restriction',async()=>{
  const page=harness('https://crm.test/sales-funnel?lifecycle=active&lead_type=quality');
  try {page.hooks.applyLeadQueryParams();await page.hooks.loadLeads();
    const p=new URL(page.calls[0],'https://crm.test').searchParams;
    assert.equal(p.get('lifecycle'),'active');assert.equal(p.has('attention'),false);assert.equal(p.has('pipeline_stage'),false);
  } finally {page.dom.window.close();}
});
