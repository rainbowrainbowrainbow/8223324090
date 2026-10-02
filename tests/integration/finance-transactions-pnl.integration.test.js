'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const {assertSafeTestDatabaseUrl}=require('../../scripts/test-db-safety');
const {BASE_URL,getToken}=require('../helpers');

test('finance amount and P&L regressions with migrated disposable PostgreSQL and real HTTP',{
 skip:process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER!=='true',timeout:120000
},async t=>{
 const db=assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL,{...process.env,DATABASE_URL:''});
 assert.equal(db.isLocal,true,'finance regressions require loopback PostgreSQL');
 const pool=new Pool({connectionString:db.url.toString(),ssl:false,max:2});
 try{
  await pool.query("UPDATE users SET business_contexts=ARRAY['event_genix','dar'],default_business_context='event_genix' WHERE username=$1",[process.env.TEST_USER]);
  const token=await getToken();
  async function api(method,route,body,context='event_genix'){
   const response=await fetch(BASE_URL+'/api/finance'+route,{method,signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Business-Context':context,Connection:'close'},...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:response.status,body:await response.json()};
  }
  const category=(await pool.query("INSERT INTO finance_categories(name,type,business_context,is_active) VALUES('Synthetic finance income','income','event_genix',true) RETURNING id")).rows[0].id;
  const otherCategory=(await pool.query("INSERT INTO finance_categories(name,type,business_context,is_active) VALUES('Synthetic DAR private category','expense','dar',true) RETURNING id")).rows[0].id;
  let expenseId;
  await t.test('uncategorized expense is permitted and P&L matches journal: 100 minus 40 equals 60',async()=>{
   const inc=await api('POST','/transactions',{type:'income',categoryId:category,amount:100,date:'2099-01-15'});assert.equal(inc.status,201,JSON.stringify(inc.body));
   const exp=await api('POST','/transactions',{type:'expense',amount:40,date:'2099-01-15'});assert.equal(exp.status,201,JSON.stringify(exp.body));expenseId=exp.body.id;
   assert.equal((await pool.query('SELECT category_id FROM finance_transactions WHERE id=$1',[expenseId])).rows[0].category_id,null);
   const journal=await api('GET','/dashboard?from=2099-01-01&to=2099-01-31');const pnl=await api('GET','/report/pnl?year=2099&month=1');
   assert.equal(journal.status,200);assert.equal(pnl.status,200);assert.equal(journal.body.totals.profit,60);assert.equal(pnl.body.summary.grossProfit,60);assert.equal(pnl.body.summary.totalExpenses,40);
   assert.equal(pnl.body.expenses.find(row=>row.name==='Без категорії').total,40);
  });
  await t.test('company, month, recognition date and foreign category labels stay scoped',async()=>{
   await pool.query(`INSERT INTO finance_transactions(business_context,type,category_id,amount,date,recognition_date) VALUES
    ('dar','expense',$2,777,'2099-01-15',NULL),
    ('event_genix','expense',NULL,555,'2099-02-15',NULL),
    ('event_genix','expense',NULL,15,'2099-02-10','2099-01-25'),
    ('event_genix','expense',NULL,999,'2099-01-10','2099-02-25'),
    ('event_genix','expense',$2,7,'2099-01-20',NULL),
    ('event_genix','income',NULL,5,'2099-01-20',NULL),
    ('event_genix','income',$1,80,'2098-12-15',NULL),
    ('event_genix','expense',NULL,20,'2098-12-15',NULL)`,[category,otherCategory]);
   const pnl=await api('GET','/report/pnl?year=2099&month=1');const journal=await api('GET','/dashboard?from=2099-01-01&to=2099-01-31');
   assert.equal(pnl.status,200);assert.equal(journal.status,200);
   assert.equal(pnl.body.summary.totalIncome,105);assert.equal(pnl.body.summary.totalExpenses,62);assert.equal(pnl.body.summary.grossProfit,43);assert.equal(journal.body.totals.profit,43);
   assert.equal(pnl.body.summary.previousIncome,80);assert.equal(pnl.body.summary.previousExpenses,20);assert.equal(pnl.body.summary.previousProfit,60);
   assert.equal(pnl.body.expenses.find(row=>row.name==='Без категорії').total,62);assert.equal(pnl.body.revenue.find(row=>row.name==='Без категорії').total,5);
   assert.ok(!JSON.stringify(pnl.body).includes('Synthetic DAR private category'));
   const dar=await api('GET','/report/pnl?year=2099&month=1',undefined,'dar');assert.equal(dar.status,200);assert.equal(dar.body.summary.totalIncome,0);assert.equal(dar.body.summary.totalExpenses,777);
   const feb=await api('GET','/report/pnl?year=2099&month=2');assert.equal(feb.status,200);assert.equal(feb.body.summary.totalExpenses,1554);assert.equal(feb.body.summary.previousProfit,43);
   const annual=await api('GET','/report/pnl?year=2099');const invalidMonth=await api('GET','/report/pnl?year=2099&month=13');
   assert.equal(annual.status,200);assert.equal(invalidMonth.status,200);assert.equal(annual.body.summary.grossProfit,-1511);assert.equal(annual.body.summary.previousProfit,60);assert.deepEqual(invalidMonth.body,annual.body);
  });
  await t.test('invalid POST and PUT amounts return 400 without changing the ledger',async()=>{
   const baseline=(await pool.query('SELECT id,amount FROM finance_transactions ORDER BY id')).rows;
   for(const amount of [null,'',' ',0,-20,0.5,12.99,'12abc','abc','NaN','Infinity','1e2','0x10','1.0',true,[],{},2147483648]){
    for(const [method,route,body] of [['POST','/transactions',{type:'expense',amount,date:'2099-03-15'}],['PUT','/transactions/'+expenseId,{amount}]]){
     const out=await api(method,route,body);assert.equal(out.status,400,method+' '+JSON.stringify(amount)+' '+JSON.stringify(out.body));assert.equal(out.body.code,'finance_amount_invalid');
    }
   }
   const missing=await api('POST','/transactions',{type:'expense',date:'2099-03-15'});assert.equal(missing.status,400);
   assert.deepEqual((await pool.query('SELECT id,amount FROM finance_transactions ORDER BY id')).rows,baseline);
  });
  await t.test('valid integer strings and partial updates preserve existing client behavior',async()=>{
   const created=await api('POST','/transactions',{type:'expense',amount:' 00100 ',date:'2099-03-15'});assert.equal(created.status,201);assert.equal(created.body.amount,100);
   const id=created.body.id;
   assert.equal((await api('PUT','/transactions/'+id,{amount:'200'})).status,200);
   assert.equal((await pool.query('SELECT amount FROM finance_transactions WHERE id=$1',[id])).rows[0].amount,200);
   assert.equal((await api('PUT','/transactions/'+id,{description:'Synthetic partial update'})).status,200);
   const row=(await pool.query('SELECT amount,description FROM finance_transactions WHERE id=$1',[id])).rows[0];assert.equal(row.amount,200);assert.equal(row.description,'Synthetic partial update');
   assert.equal((await api('PUT','/transactions/'+id,{amount:2147483647})).status,200);
   assert.equal((await pool.query('SELECT amount FROM finance_transactions WHERE id=$1',[id])).rows[0].amount,2147483647);
   assert.equal((await api('PUT','/transactions/'+id,{amount:200})).status,200);
  });
 }finally{await pool.end();}
});
