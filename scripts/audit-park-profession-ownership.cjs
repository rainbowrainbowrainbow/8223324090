'use strict';
const {Client}=require('pg');
const tables=['hr_professions','hr_profession_checklist_items','hr_staff_profession_checklist_progress','staff_role_assignments','staff','onboarding_progress','onboarding_templates','tasks'];
(async()=>{ const db=new Client({connectionString:process.env.PRODUCTION_READONLY_DATABASE_URL,statement_timeout:10000});
try { if(!process.env.PRODUCTION_READONLY_DATABASE_URL) throw new Error('NO_RO_CONNECTION'); await db.connect(); await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
const identity=(await db.query("SELECT current_user AS role,current_setting('transaction_read_only') AS read_only")).rows[0];
if(identity.role!=='eventgenix_audit_ro'||identity.read_only!=='on')throw new Error('RO_IDENTITY_MISMATCH');
const privileges=(await db.query('SELECT t AS table_name,has_table_privilege(current_user,t,\'SELECT\') AS readable FROM unnest($1::text[]) t',[tables])).rows;
console.log(JSON.stringify({atUtc:new Date().toISOString(),readOnly:true,privileges}));
if(privileges.some(p=>!p.readable))throw new Error('MISSING_SELECT');
const counts={};for(const t of tables) counts[t]=Number((await db.query('SELECT count(*) AS n FROM '+t)).rows[0].n);
const columns=(await db.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1) AND (column_name LIKE '%business%' OR column_name LIKE '%organization%' OR column_name LIKE '%profession%' OR column_name IN ('staff_id','checklist_item_id','item_id','template_id','source_type','source_id')) ORDER BY table_name,column_name",[tables])).rows;
console.log(JSON.stringify({counts,columns}));
const integrity=(await db.query(`SELECT
(SELECT count(*)::int FROM hr_profession_checklist_items i LEFT JOIN hr_professions p ON p.id=i.profession_id WHERE p.id IS NULL) AS item_orphans,
(SELECT count(*)::int FROM hr_staff_profession_checklist_progress x LEFT JOIN staff s ON s.id=x.staff_id LEFT JOIN hr_professions p ON p.key=x.profession_key LEFT JOIN hr_profession_checklist_items i ON i.id=x.checklist_item_id WHERE s.id IS NULL OR p.id IS NULL OR i.id IS NULL OR i.profession_id<>p.id) AS progress_invalid_links,
(SELECT count(*)::int FROM staff_role_assignments a LEFT JOIN staff s ON s.id=a.staff_id LEFT JOIN hr_professions p ON p.key=a.profession_key WHERE s.id IS NULL OR p.id IS NULL) AS assignment_orphans,
(SELECT count(*)::int FROM onboarding_progress o LEFT JOIN staff s ON s.id=o.staff_id LEFT JOIN onboarding_templates t ON t.id=o.template_id LEFT JOIN hr_professions p ON p.key=o.profession_key WHERE s.id IS NULL OR (o.template_id IS NOT NULL AND t.id IS NULL) OR (o.profession_key IS NOT NULL AND p.id IS NULL)) AS onboarding_orphans,
(SELECT count(*)::int FROM tasks t JOIN onboarding_progress o ON t.source_id LIKE o.id::text || ':%' WHERE t.source_type='onboarding' AND t.business_context IS DISTINCT FROM 'event_genix') AS foreign_onboarding_tasks,
(SELECT count(*)::int FROM tasks t JOIN onboarding_progress o ON t.source_id LIKE o.id::text || ':%' WHERE t.source_type='onboarding' AND t.business_context='event_genix') AS park_onboarding_tasks
`)).rows[0];
console.log(JSON.stringify({integrity}));
if(Object.entries(integrity).some(([key,value])=>key!=='park_onboarding_tasks' && value!==0)) throw new Error('OWNERSHIP_LINK_REVIEW_REQUIRED');
const {loadCatalog,loadOnboarding}=require('../services/parkHrProfessionRead');
const captured=[];const capture={query:async(sql,params)=>{captured.push({sql,params});return {rows:sql==='SELECT id, name, department FROM staff WHERE id = $1'?[{id:1}]:[]};}};
await loadCatalog(capture);await loadOnboarding(capture,{staffId:1,kind:'onboarding-processes'},{});
for(const {sql,params} of captured) await db.query('EXPLAIN '+sql,params);
console.log(JSON.stringify({validatedReadQueries:captured.length}));
} catch(e){console.log(JSON.stringify({audit:'HOLD',code:e.code||e.message}));process.exitCode=1;}finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}})();



