'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { Pool } = require('pg');
const root = path.resolve(process.env.EDU_READY_RUN_ROOT || 'output/education-ready/08');
assert.ok(root.startsWith(path.resolve('output/education-ready') + path.sep), 'Evidence must remain in education output');
fs.mkdirSync(root,{recursive:true});
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
function files(directory) { return fs.readdirSync(directory,{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(path.join(directory,item.name)):[path.join(directory,item.name)]); }
function sourceHashes() {
    const selected = ['js','css','routes','services','middleware','db','config','lib'].filter(fs.existsSync).flatMap(files)
        .concat(fs.readdirSync('.').filter(file=>/\.(js|html|json)$/.test(file)&&fs.statSync(file).isFile()),['.nvmrc','.node-version'])
        .filter(file=>/\.(js|css|html|json|sql)$/.test(file)||['.nvmrc','.node-version'].includes(file));
    return Object.fromEntries(selected.sort().map(file=>[file.replace(/\\/g,'/'),sha(fs.readFileSync(file))]));
}
function harnessHashes() { return Object.fromEntries(['tests','scripts'].flatMap(files).filter(file=>/\.(js|py|ps1)$/.test(file)).sort().map(file=>[file.replace(/\\/g,'/'),sha(fs.readFileSync(file))])); }
async function retained(database) {
    const pool=new Pool({host:'127.0.0.1',port:55469,user:'postgres',database,ssl:false});
    try {
        const result={database,tables:{}};
        for(const table of ['settings','staff','customers','customer_children','education_groups','education_group_members','education_teacher_memberships','bookings','education_attendance','education_attendance_history']) {
            const exists=(await pool.query('SELECT to_regclass($1) name',[table])).rows[0].name;
            if(!exists){result.tables[table]={absent:true};continue;}
            const rows=(await pool.query(`SELECT to_jsonb(t)::text record FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
            result.tables[table]={count:rows.length,sha256:sha(JSON.stringify(rows))};
        }
        assert.equal(result.tables.bookings.count,39); return result;
    } finally {await pool.end();}
}
const suites=process.argv.slice(2);
assert.ok(suites.length,'Specify exact suites (npm, journey, teachers, groups, lifecycle, date, async, attendance, series, acceptance, navigation, submit, context, mobile-chromium, mobile-webkit, visual, live)');
const secrets=Object.entries(process.env).filter(([key,value])=>/(PASS|TOKEN|SECRET|API_KEY)$/.test(key)&&value?.length>5).map(([,value])=>value);
function redact(text){for(const value of secrets)text=text.split(value).join('[REDACTED]');return text;}
(async()=>{
    const batch=path.join(root,`commands-${new Date().toISOString().replace(/[:.]/g,'-')}.json`), commands=[];
    for(const suite of suites) {
        const stamp=new Date().toISOString(), log=path.join(root,`${suite}-${stamp.replace(/[:.]/g,'-')}.log`);
        const before=sourceHashes(), harness=harnessHashes();
        const proofBefore=await Promise.all(['eventgenix_education_ready_manual','eventgenix_education_ready_devices'].map(retained));
        const record={suite,startedAt:stamp,sourceHashes:before,harnessHashes:harness,retainedBefore:proofBefore,log:path.relative(root,log).replace(/\\/g,'/'),exitCode:null};
        const env={...process.env,EDU_READY_STAGE:'08',EDU_READY_RUN_ROOT:root,EDU_READY_SUITE:suite.replace(/^mobile-.+$/,'mobile').replace(/^journey-.+$/,'journey'),EDU_FINAL_PLAYWRIGHT_MODULE:process.env.EDU_QA_PLAYWRIGHT,EDU_QA_PLAYWRIGHT:path.resolve('tests/helpers/education-ready-final-browser-driver.js')};
        let executable=process.execPath,args=['tests/integration/run-education-ready-design.js'];
        if(suite==='npm'){executable=process.platform==='win32'?'npm.cmd':'npm';args=['test'];}
        if(suite==='live'){args=['tests/browser/education-ready-live-readonly.js'];env.EDU_READY_LIVE_OUTPUT=path.join(root,`live-readonly-${stamp.replace(/[:.]/g,'-')}.json`);}
        if(suite.startsWith('mobile-')){env.EDU_MOBILE_ENGINE=suite.slice(7);env.EDU_MOBILE_PHASE='final';}
        if(suite.startsWith('journey-'))env.EDU_MOBILE_ENGINE=suite.slice(8);
        record.command=suite==='npm'?'npm test':`node ${args.join(' ')} (EDU_READY_SUITE=${env.EDU_READY_SUITE})`;
        record.head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
        const code=await new Promise((resolve,reject)=>{
            const child=spawn(executable,args,{env,stdio:['ignore','pipe','pipe'],shell:suite==='npm'&&process.platform==='win32'});
            const stream=fs.createWriteStream(log); child.stdout.on('data',chunk=>stream.write(redact(String(chunk)))); child.stderr.on('data',chunk=>stream.write(redact(String(chunk))));
            child.on('error',reject);child.on('close',code=>stream.end(()=>resolve(code)));
        });
        record.exitCode=code;record.finishedAt=new Date().toISOString();
        record.sourceUnchanged=JSON.stringify(sourceHashes())===JSON.stringify(before);
        record.harnessUnchanged=JSON.stringify(harnessHashes())===JSON.stringify(harness);
        record.retainedAfter=await Promise.all(['eventgenix_education_ready_manual','eventgenix_education_ready_devices'].map(retained));
        record.retainedUnchanged=JSON.stringify(record.retainedAfter)===JSON.stringify(proofBefore);
        record.status=code===0&&record.sourceUnchanged&&record.harnessUnchanged&&record.retainedUnchanged?'PASS':'FAIL';
        commands.push(record);fs.writeFileSync(batch,JSON.stringify(commands,null,2));console.log(`${suite}: ${record.status}, exit${code}, retained ${record.retainedUnchanged}, source ${record.sourceUnchanged}, harness ${record.harnessUnchanged}`);
        if(record.status!=='PASS')process.exitCode=1;
    }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
