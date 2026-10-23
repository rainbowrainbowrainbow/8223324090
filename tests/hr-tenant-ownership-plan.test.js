'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {TABLES,REQUIRED_COLUMNS,digest,preparePlan,applyDisposablePlan}=require('../scripts/prepare-park-hr-ownership-backfill.cjs');
const root=path.resolve(__dirname,'..');
function inventory(){return {atUtc:'2026-10-23T00:00:00Z',tables:Object.fromEntries(TABLES.map(table=>{const columns=REQUIRED_COLUMNS[table];const rows=[Object.fromEntries(columns.map(column=>[column,column==='id'?'1':null]))];return [table,{primaryKey:['id'],columns,count:1,rows,fingerprint:digest(rows)}]}))}}
test('HR ownership plan binds the exact six tables, keys and fingerprints',()=>{
 const plan=preparePlan(inventory(),{businessId:2,organizationId:3});assert.deepEqual(Object.keys(plan.tables),TABLES);assert.deepEqual(plan.owner,{businessId:2,organizationId:3});
 for(const table of TABLES)assert.deepEqual(plan.tables[table].ids,['1']);
 for(const mutate of [i=>i.tables.hr_professions.rows.push({id:'2'}),i=>i.tables.onboarding_templates.fingerprint='0'.repeat(64),i=>i.tables.staff_role_assignments.primaryKey=['staff_id']]){const changed=inventory();mutate(changed);assert.throws(()=>preparePlan(changed,{businessId:2,organizationId:3}),/INVENTORY_FINGERPRINT_MISMATCH/)}
 const omitted=inventory();omitted.tables.hr_professions.columns=['id'];assert.throws(()=>preparePlan(omitted,{businessId:2,organizationId:3}),/INVENTORY_STRUCTURAL_FIELDS_REQUIRED/);
 assert.throws(()=>preparePlan(inventory(),{businessId:0,organizationId:3}),/INVALID_OWNER_TARGET/);
});
test('ownership migration only adds nullable metadata, constraints and Park views; no data/role backfill',()=>{
 const sql=fs.readFileSync(path.join(root,'db/migrations/387_hr_park_tenant_ownership_foundation.sql'),'utf8');
 assert.match(sql,/ADD COLUMN IF NOT EXISTS business_id BIGINT, ADD COLUMN IF NOT EXISTS organization_id BIGINT/);
 assert.match(sql,/CHECK \(\(business_id IS NULL\) = \(organization_id IS NULL\)\)/);
 for(const name of ['fk_hr_item_profession_owner','fk_hr_assignment_profession_owner','fk_hr_progress_profession_owner','fk_hr_progress_item_owner','fk_hr_onboarding_template_owner','fk_hr_onboarding_profession_owner'])assert.ok(sql.includes(name));
 assert.match(sql,/WITH CASCADED CHECK OPTION/);assert.match(sql,/security_barrier=true/);
 assert.doesNotMatch(sql,/\b(?:GRANT|REVOKE|DROP TABLE|DROP COLUMN|ALTER ROLE|DISABLE TRIGGER)\b/i);
 assert.doesNotMatch(sql,new RegExp('\\b(?:UPDATE|DELETE FROM|INSERT INTO)\\s+(?:public\\.)?(?:'+TABLES.join('|')+')\\b','i'));
});
test('all scoped HR read/update/delete query sites explicitly use owned namespace',()=>{
 for(const file of ['routes/hr.js','services/parkHrProfessionRead.js','services/professionChecklists.js','services/professions.js','services/hrOnboarding.js','services/accountOnboarding.js']){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  assert.doesNotMatch(source,new RegExp('\\b(?:FROM|JOIN|UPDATE)\\s+(?:'+TABLES.join('|')+')\\b'),file);
  assert.match(source,/hr_owned\./);
 }
 for(const [file,table] of [['services/accountOnboarding.js','staff_role_assignments'],['services/professionChecklists.js','hr_staff_profession_checklist_progress']]){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  assert.ok(source.includes('WHERE '+table+'.business_id = EXCLUDED.business_id'));
  assert.ok(source.includes('AND '+table+'.organization_id = EXCLUDED.organization_id'));
  assert.ok(source.includes('HR_OWNERSHIP_CONFLICT'));
 }
});
test('backfill execution refuses production or unverified clients before connecting',async()=>{
 let connected=false;const pool={connect(){connected=true;throw Error('must not connect')}};
 const plan=preparePlan(inventory(),{businessId:2,organizationId:3});
 await assert.rejects(applyDisposablePlan(pool,plan,{NODE_ENV:'production',REQUIRE_ISOLATED_TEST_TARGET:'true',ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER:'true'}));
 await assert.rejects(applyDisposablePlan(pool,plan,{NODE_ENV:'test',REQUIRE_ISOLATED_TEST_TARGET:'false'}));
 assert.equal(connected,false);
});
test('CLI creates a private plan outside Git and exposes no apply-production command',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eg-hr-owner-plan-'));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const input=path.join(dir,'inventory.json'),registry=path.join(dir,'registry.json'),output=path.join(dir,'plan.json');
 fs.writeFileSync(input,JSON.stringify(inventory()));fs.writeFileSync(registry,JSON.stringify({snapshot:{park:{id:2},organizationId:3}}));
 const script=path.join(root,'scripts/prepare-park-hr-ownership-backfill.cjs');
 const result=spawnSync(process.execPath,[script,'--plan','--inventory',input,'--registry-receipt',registry,'--out',output],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).status,'PREPARED_NOT_APPLIED');assert.ok(!result.stdout.includes('businessId'));
 assert.equal(JSON.parse(fs.readFileSync(output,'utf8')).owner.businessId,2);
 const denied=spawnSync(process.execPath,[script,'--apply-production'],{encoding:'utf8'});assert.notEqual(denied.status,0);assert.match(denied.stderr,/CLI_SUPPORTS_PRIVATE_PLAN_ONLY/);
});
