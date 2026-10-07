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
  await t.test('advanced dashboard uses typed dates without losing company, recognition or booking scope',async()=>{
   const empty=await api('GET','/advanced-dashboard');
   assert.equal(empty.status,200,JSON.stringify(empty.body));
   const now=new Date();
   const day=now.toISOString().slice(0,10);
   const prior=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,15)).toISOString().slice(0,10);
   const next=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,15)).toISOString().slice(0,10);
   await pool.query(`INSERT INTO finance_transactions(business_context,type,amount,date,recognition_date) VALUES
    ('event_genix','income',1000,$1,NULL),('event_genix','expense',20,$1,NULL),
    ('event_genix','income',80,$2,$1::date),('event_genix','expense',40,$1,$2::date),
    ('dar','income',700,$1,NULL),('event_genix','income',900,$3,NULL)`,[day,prior,next]);
   await pool.query(`INSERT INTO bookings(id,date,time,line_id,status,price,linked_to,business_context,room,room_resource_id) VALUES
    ('advanced-own',$1,'10:00','fixture','confirmed',200,NULL,'event_genix','Fixture room','fixture-room'),
    ('advanced-zero',$1,'11:00','fixture','confirmed',0,NULL,'event_genix','Fixture room','fixture-room'),
    ('advanced-dar',$1,'12:00','fixture','confirmed',700,NULL,'dar','Fixture room','fixture-room'),
    ('advanced-prior',$2,'13:00','fixture','confirmed',800,NULL,'event_genix','Fixture room','fixture-room'),
    ('advanced-next',$3,'14:00','fixture','confirmed',900,NULL,'event_genix','Fixture room','fixture-room'),
    ('advanced-linked',$1,'15:00','fixture','confirmed',300,'advanced-own','event_genix','Fixture room','fixture-room'),
    ('advanced-cancelled',$1,'16:00','fixture','cancelled',400,NULL,'event_genix','Fixture room','fixture-room')`,[day,prior,next]);
   const own=await api('GET','/advanced-dashboard');
   assert.equal(own.status,200,JSON.stringify(own.body));
   assert.deepEqual(own.body.metrics,{monthIncome:1080,monthExpense:20,monthProfit:1060,bookingsRevenue:200,bookingsCount:2,avgBookingPrice:200,margin:98});
   const dar=await api('GET','/advanced-dashboard',undefined,'dar');
   assert.equal(dar.status,200);assert.equal(dar.body.metrics.monthIncome,700);
   assert.equal(dar.body.metrics.bookingsRevenue,700);assert.equal(dar.body.metrics.bookingsCount,1);
   const malformed=(await pool.query("INSERT INTO finance_transactions(business_context,type,amount,date) VALUES('event_genix','income',1,'fixture-invalid-date') RETURNING id")).rows[0].id;
   const failure=await api('GET','/advanced-dashboard');
   assert.equal(failure.status,500);assert.equal(failure.body.error,'Internal server error');
   assert.equal(failure.body.success,false);assert.equal(typeof failure.body.requestId,'string');
   assert.ok(!JSON.stringify(failure.body).includes('fixture-invalid-date'));
   await pool.query('DELETE FROM finance_transactions WHERE id=$1',[malformed]);
   assert.equal((await api('GET','/advanced-dashboard')).status,200,'retry recovers after the fixture database error');
   await pool.query('DELETE FROM bookings WHERE id LIKE $1',['advanced-%']);
   await pool.query('DELETE FROM finance_transactions');
  });
  await t.test('uncategorized expense is permitted and P&L matches journal: 100 minus 40 equals 60',async()=>{
   const inc=await api('POST','/transactions',{type:'income',categoryId:category,amount:100,date:'2099-01-15'});assert.equal(inc.status,201,JSON.stringify(inc.body));
   const exp=await api('POST','/transactions',{type:'expense',amount:40,date:'2099-01-15'});assert.equal(exp.status,201,JSON.stringify(exp.body));expenseId=exp.body.id;
   assert.equal((await pool.query('SELECT category_id FROM finance_transactions WHERE id=$1',[expenseId])).rows[0].category_id,null);
   const journal=await api('GET','/dashboard?from=2099-01-01&to=2099-01-31');const pnl=await api('GET','/report/pnl?year=2099&month=1');
   assert.equal(journal.status,200);assert.equal(pnl.status,200);assert.equal(journal.body.totals.profit,60);assert.equal(pnl.body.summary.grossProfit,60);assert.equal(pnl.body.summary.totalExpenses,40);
   assert.equal(pnl.body.expenses.find(row=>row.name==='Без категорії').total,40);
   assert.equal(journal.body.expenseByCategory.find(row=>row.name==='Без категорії').total,40);
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
   assert.ok(!JSON.stringify(journal.body).includes('Synthetic DAR private category'));
   assert.equal(journal.body.incomeByCategory.reduce((sum,row)=>sum+row.total,0),105);
   assert.equal(journal.body.expenseByCategory.reduce((sum,row)=>sum+row.total,0),62);
   assert.equal(journal.body.daily.reduce((sum,row)=>sum+row.income,0),105);
   assert.equal(journal.body.daily.reduce((sum,row)=>sum+row.expense,0),1046,'cash flow includes January payments regardless of recognition month');
   assert.equal(journal.body.daily.find(row=>row.date==='2099-01-10').expense,999);
   assert.ok(!journal.body.daily.some(row=>row.date==='2099-01-25'),'January accrual paid in February is excluded from January cash flow');
   const februaryCash=await api('GET','/dashboard?from=2099-02-01&to=2099-02-28');
   assert.equal(februaryCash.status,200);
   assert.equal(februaryCash.body.daily.reduce((sum,row)=>sum+row.expense,0),570);
   assert.equal(februaryCash.body.daily.find(row=>row.date==='2099-02-10').expense,15);
   const dar=await api('GET','/report/pnl?year=2099&month=1',undefined,'dar');assert.equal(dar.status,200);assert.equal(dar.body.summary.totalIncome,0);assert.equal(dar.body.summary.totalExpenses,777);
   const feb=await api('GET','/report/pnl?year=2099&month=2');assert.equal(feb.status,200);assert.equal(feb.body.summary.totalExpenses,1554);assert.equal(feb.body.summary.previousProfit,43);
   const annual=await api('GET','/report/pnl?year=2099');const invalidMonth=await api('GET','/report/pnl?year=2099&month=13');
   assert.equal(annual.status,200);assert.equal(invalidMonth.status,200);assert.equal(annual.body.summary.grossProfit,-1511);assert.equal(annual.body.summary.previousProfit,60);assert.deepEqual(invalidMonth.body,annual.body);
  });
  await t.test('budget retains unplanned and uncategorized actuals with and without a plan', async () => {
   const categories = (await pool.query(`INSERT INTO finance_categories(name,type,business_context,is_active) VALUES
    ('Synthetic planned expense','expense','event_genix',true),
    ('Synthetic archived expense','expense','event_genix',false),
    ('Synthetic plan without actual','expense','event_genix',true) RETURNING id`)).rows;
   const [planned, archived, unused] = categories.map(row => row.id);
   await pool.query(`INSERT INTO finance_transactions(business_context,type,category_id,amount,date,recognition_date) VALUES
    ('event_genix','income',$1,80,'2100-01-15',NULL),
    ('event_genix','income',NULL,20,'2100-01-15',NULL),
    ('event_genix','expense',$2,10,'2100-01-15',NULL),
    ('event_genix','expense',$3,30,'2100-01-15',NULL),
    ('event_genix','expense',$3,40,'2100-02-10','2100-01-25'),
    ('event_genix','expense',NULL,5,'2100-01-15',NULL),
    ('event_genix','expense',$4,7,'2100-01-15',NULL),
    ('event_genix','expense',NULL,999,'2100-01-10','2100-02-25'),
    ('dar','expense',$4,777,'2100-01-15',NULL)`, [category, planned, archived, otherCategory]);
   const noPlan = await api('GET', '/budget/comparison?year=2100&month=1');
   assert.equal(noPlan.status, 200, JSON.stringify(noPlan.body));
   assert.equal(noPlan.body.totals.incomeActual, 100);
   assert.equal(noPlan.body.totals.expenseActual, 92);
   assert.ok(noPlan.body.comparison.every(row => row.hasPlan === false && row.planned === 0 && row.percentUsed === null));
   assert.deepEqual(noPlan.body.comparison.filter(row => row.categoryId === null)
    .map(row => [row.categoryType, row.actual]).sort(), [['expense', 12], ['income', 20]]);
   assert.ok(!JSON.stringify(noPlan.body).includes('Synthetic DAR private category'));
   const archivedActual = noPlan.body.comparison.find(row => row.categoryId === archived);
   assert.equal(archivedActual.categoryName, 'Synthetic archived expense');
   assert.equal(archivedActual.actual, 70);
   assert.equal(archivedActual.transactionCount, 2);
   for (const [categoryId, plannedAmount] of [[planned, 100], [category, 0], [unused, 90]]) {
    const saved = await api('PUT', '/budget', { year: 2100, month: 1, categoryId, plannedAmount });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
   }
   const budget = await api('GET', '/budget/comparison?year=2100&month=1');
   assert.equal(budget.status, 200, JSON.stringify(budget.body));
   assert.deepEqual(budget.body.totals, {
    incomePlanned: 0, incomeActual: 100, expensePlanned: 190, expenseActual: 92,
    profitPlanned: -190, profitActual: 8
   });
   assert.equal(budget.body.comparison.find(row => row.categoryId === planned).percentUsed, 10);
   assert.equal(budget.body.comparison.find(row => row.categoryId === unused).actual, 0);
   const zeroPlan = budget.body.comparison.find(row => row.categoryId === category);
   assert.equal(zeroPlan.hasPlan, true);
   assert.equal(zeroPlan.percentUsed, null);
   const pnl = await api('GET', '/report/pnl?year=2100&month=1');
   assert.equal(pnl.status, 200);
   assert.equal(budget.body.totals.profitActual, pnl.body.summary.grossProfit);
   const dar = await api('GET', '/budget/comparison?year=2100&month=1', undefined, 'dar');
   assert.equal(dar.status, 200);
   assert.equal(dar.body.totals.expenseActual, 777);
   assert.equal(dar.body.totals.expensePlanned, 0);
  });
  await t.test('debt totals cover more than 100 eligible bookings without broadening eligibility', async () => {
   const empty = await api('GET', '/debts');
   assert.equal(empty.status, 200);
   assert.deepEqual(empty.body, { debts: [], totalDebt: 0, count: 0, returnedCount: 0, hasMore: false });
   await pool.query(`INSERT INTO bookings(id,date,time,line_id,status,price,paid_amount,payment_status,business_context,room,room_resource_id)
    SELECT 'debt-fixture-' || n, '2000-01-01', '10:00', 'fixture', 'confirmed', 100, 20, 'partial', 'event_genix', 'Fixture room', 'fixture-room'
    FROM generate_series(1,105) AS n`);
   await pool.query(`INSERT INTO bookings(id,date,time,line_id,status,price,paid_amount,payment_status,linked_to,business_context,room,room_resource_id) VALUES
    ('debt-future','2999-01-01','10:00','fixture','confirmed',900,0,NULL,NULL,'event_genix','Fixture room','fixture-room'),
    ('debt-paid','2000-01-01','10:00','fixture','confirmed',900,900,'paid',NULL,'event_genix','Fixture room','fixture-room'),
    ('debt-status-paid','2000-01-01','10:00','fixture','confirmed',900,0,'paid',NULL,'event_genix','Fixture room','fixture-room'),
    ('debt-zero','2000-01-01','10:00','fixture','confirmed',0,0,NULL,NULL,'event_genix','Fixture room','fixture-room'),
    ('debt-cancelled','2000-01-01','10:00','fixture','cancelled',900,0,NULL,NULL,'event_genix','Fixture room','fixture-room'),
    ('debt-preliminary','2000-01-01','10:00','fixture','preliminary',900,0,NULL,NULL,'event_genix','Fixture room','fixture-room'),
    ('debt-linked','2000-01-01','10:00','fixture','confirmed',900,0,NULL,'debt-fixture-1','event_genix','Fixture room','fixture-room'),
    ('debt-foreign','2000-01-01','10:00','fixture','confirmed',900,0,NULL,NULL,'dar','Fixture room','fixture-room')`);
   const own = await api('GET', '/debts');
   assert.equal(own.status, 200, JSON.stringify(own.body));
   assert.equal(own.body.count, 105);
   assert.equal(own.body.totalDebt, 8400);
   assert.equal(own.body.returnedCount, 100);
   assert.equal(own.body.debts.length, 100);
   assert.equal(own.body.hasMore, true);
   assert.ok(own.body.debts.every(row => row.bookingId.startsWith('debt-fixture-') && row.debtAmount === 80));
   const repeat = await api('GET', '/debts');
   assert.deepEqual(repeat.body.debts.map(row => row.bookingId), own.body.debts.map(row => row.bookingId));
   const dar = await api('GET', '/debts', undefined, 'dar');
   assert.equal(dar.status, 200);
   assert.equal(dar.body.count, 1);
   assert.equal(dar.body.totalDebt, 900);
   assert.equal(dar.body.hasMore, false);
  });
  await t.test('category names are trimmed and system identities cannot be renamed', async () => {
   for (const name of ['', '   ', null, 42, true, [], {}]) {
    assert.equal((await api('POST', '/categories', { name, type: 'expense' })).status, 400);
    assert.equal((await api('PUT', '/categories/' + category, { name })).status, 400);
   }
   const created = await api('POST', '/categories', { name: '  Synthetic editable category  ', type: 'expense' });
   assert.equal(created.status, 201, JSON.stringify(created.body));
   assert.equal(created.body.name, 'Synthetic editable category');
   const renamed = await api('PUT', '/categories/' + created.body.id, { name: '  Synthetic renamed category  ' });
   assert.equal(renamed.status, 200);
   assert.equal((await pool.query('SELECT name FROM finance_categories WHERE id=$1', [created.body.id])).rows[0].name, 'Synthetic renamed category');
   const system = (await pool.query(`INSERT INTO finance_categories(name,type,business_context,is_system)
    VALUES('Synthetic system identity','income','event_genix',true) RETURNING id`)).rows[0].id;
   assert.equal((await api('PUT', '/categories/' + system, { name: 'Changed identity' })).status, 400);
   assert.equal((await api('PUT', '/categories/' + system, { name: ' Synthetic system identity ', icon: 'S' })).status, 200);
   assert.equal((await api('PUT', '/categories/' + system, { color: '#123456' })).status, 200);
   const persisted = (await pool.query('SELECT name,icon,color FROM finance_categories WHERE id=$1', [system])).rows[0];
   assert.deepEqual(persisted, { name: 'Synthetic system identity', icon: 'S', color: '#123456' });
   assert.equal((await api('PUT', '/categories/' + otherCategory, { name: 'Cross-business rename' })).status, 404);
   assert.equal((await pool.query('SELECT name FROM finance_categories WHERE id=$1', [otherCategory])).rows[0].name, 'Synthetic DAR private category');
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
