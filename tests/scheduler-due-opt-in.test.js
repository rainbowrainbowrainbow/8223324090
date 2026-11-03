'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'services/scheduler.js'),'utf8');
const dbPath=require.resolve('../db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{pool:{}}};
const {guardScheduler,skipSchedulerTracking}=require('../services/schedulerGuard');
const OriginalDate=Date;let now;
function fakeDb(){let row;return{get row(){return row},async query(sql,p){
  if(/WITH claimed AS/.test(sql)){if(row&&row.result==='success')return{rows:[{...row,claim_acquired:false}],rowCount:1};row={last_run_date:p[1],result:'running'};return{rows:[{...row,claim_acquired:true}],rowCount:1}}
  if(/last_run_date = NULL, result = 'skipped'/.test(sql)){row={last_run_date:null,result:'skipped'};return{rows:[{}],rowCount:1}}
  if(/last_run_date = \$3, result = 'success'/.test(sql)){row={last_run_date:p[2],result:'success'};return{rows:[{}],rowCount:1}}
  throw Error('unexpected synthetic guard query');}}}
const cases=[['checkStreakUpdates','23:55'],['checkBirthdayGreetings','09:00'],['checkBirthdayReminders','09:30'],['checkDormantCustomers','10:00'],['checkUpcomingBookings','11:00'],['checkTeamPulseReminder','18:00'],['checkChatDailyDigest','20:00'],['checkStaleCatalogImages','03:00']];
function makeJob(name,enabled){let calls=0,reads=0;const helper=source.match(/function skipNotDueIfEnabled\(jobName\) \{[\s\S]*?\n\}/);const job=source.match(new RegExp('async function '+name+'\\(\\) \\{[\\s\\S]*?\\n\\}'));assert.ok(helper&&job,name);
 const ctx={process:{env:{CRM_SCHEDULER_DUE_JOBS:enabled}},skipSchedulerTracking,getKyivTimeStr:()=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Kyiv',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()),getKyivDateStr:()=> '2026-11-03',getLastSent:async()=>{reads++;return '2026-11-03'},setLastSent:async()=>{throw Error('no writes allowed')},streaksUpdatedToday:null,birthdaySentToday:null,birthdayReminderSentToday:null,dormantSentToday:null,upcomingSentToday:null,pool:{query:async()=>{throw Error('no database allowed')}},require:()=>{throw Error('no provider allowed')},log:{warn:()=>{},info:()=>{},error:e=>{throw Error('unexpected '+e)}}};
 vm.runInNewContext(helper[0],ctx);const fn=vm.runInNewContext('('+job[0]+')',ctx);return{run:async()=>{calls++;return fn()},counts:()=>({calls,reads})};}
for(const [name,time] of cases){test(`${name}: per-job opt-in leaves day unclaimed until due`,async()=>{
  global.Date=class extends OriginalDate{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}};
  try {now=OriginalDate.parse('2026-11-02T22:01:00Z');const job=makeJob(name,name),db=fakeDb(),wrapped=guardScheduler(name,job.run,{dedup:'daily',dbPool:db});await wrapped();assert.equal(db.row.result,'skipped');assert.deepEqual(job.counts(),{calls:1,reads:0});
   now=OriginalDate.parse('2026-11-03T'+time+':00+02:00');await wrapped();assert.deepEqual(job.counts(),{calls:2,reads:1});assert.equal(db.row.result,'success');await wrapped();assert.deepEqual(job.counts(),{calls:2,reads:1});
  }finally{global.Date=OriginalDate}
 });
 test(`${name}: missing or unrelated opt-in preserves legacy behavior`,async()=>{
  global.Date=class extends OriginalDate{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}};
  try {for(const enabled of ['', 'unrelatedJob']){now=OriginalDate.parse('2026-11-02T22:01:00Z');const job=makeJob(name,enabled),db=fakeDb(),wrapped=guardScheduler(name,job.run,{dedup:'daily',dbPool:db});await wrapped();assert.equal(db.row.result,'success');now=OriginalDate.parse('2026-11-03T'+time+':00+02:00');await wrapped();assert.deepEqual(job.counts(),{calls:1,reads:0})}}
  finally{global.Date=OriginalDate}
 });}
