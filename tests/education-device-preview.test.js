'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');
const {DATABASES,assertLocalTarget,buildPlan}=require('../scripts/lib/education-ready-dataset');
const {privateAddress,sameSubnet,allowedWrite,createGateway}=require('../scripts/lib/education-device-gateway');
test('device fixture requires its own exact database and confirmation; fixed runner cannot target it',()=>{
    const env={NODE_ENV:'test',PGHOST:'127.0.0.1',PGPORT:'55469',PGDATABASE:DATABASES.devices,EDU_READY_LOCAL_CONFIRM:'SEED_OWNED_LOCAL_EDUCATION',EDU_READY_DEVICE_LOCAL_CONFIRM:'OWNED_DEVICE_PREVIEW_08C'};
    assert.equal(assertLocalTarget('devices',env).database,DATABASES.devices);
    for(const change of [{PGDATABASE:DATABASES.demo},{PGDATABASE:DATABASES.fixed},{PGHOST:'192.168.1.106'},{EDU_READY_DEVICE_LOCAL_CONFIRM:''},{DATABASE_URL:'forbidden'},{NODE_ENV:'production'}])assert.throws(()=>assertLocalTarget('devices',{...env,...change}));
    assert.throws(()=>assertLocalTarget('fixed',{...env,ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER:'true'}));
    const plan=buildPlan('devices','2026-10-04');assert.equal(plan.lessons.length,38);assert.equal(plan.anchorDate,'2026-10-04');assert.ok(plan.lessons.filter(row=>row.series).every(row=>row.series.id.includes('devices')));
});
test('LAN gateway permits only explicit private IPv4 and its actual subnet',()=>{
    for(const host of ['192.168.1.106','10.10.1.1','172.16.1.2','172.31.1.2'])assert.equal(privateAddress(host),true);
    for(const host of ['0.0.0.0','127.0.0.1','26.149.148.74','169.254.1.111','8.8.8.8','::','172.32.0.1'])assert.equal(privateAddress(host),false);
    assert.equal(sameSubnet('192.168.1.50','192.168.1.106',24),true);assert.equal(sameSubnet('192.168.2.50','192.168.1.106',24),false);assert.equal(sameSubnet('::ffff:192.168.1.50','192.168.1.106',24),false);
    assert.throws(()=>createGateway({host:'0.0.0.0'}));
});
test('device gateway keeps education operations and blocks providers, money, global account writes',()=>{
    for(const [method,path]of [['POST','/api/auth/login'],['POST','/api/education/groups'],['POST','/api/education/groups/'],['PUT','/api/education/attendance/ER02-devices-robots-4'],['PUT','/api/bookings/ER02-devices-robots-4'],['POST','/api/bookings/education-series'],['PUT','/api/business/cabinet']])assert.equal(allowedWrite(method,path),true,path);
    for(const path of ['/api/wallet/daily-login','/api/users','/api/staff','/api/messages','/api/telegram/send','/api/bookings/BK/payment','/api/settings/chat/integrations'])assert.equal(allowedWrite('POST',path),false,path);
    assert.equal(allowedWrite('GET','/api/education/reports'),true);
});
test('a spoofed caller never reaches the upstream even when the gateway is locally exercised',async()=>{
    const stats={};const gateway=createGateway({host:'192.168.1.106',prefix:24,stats});
    await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
    try{const response=await new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port:gateway.address().port,path:'/api/education/groups',headers:{host:'192.168.1.106:3014'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject);});assert.equal(response,403);assert.equal(stats.blocked,1);}finally{await new Promise(resolve=>gateway.close(resolve));}
});
test('a missing device or an emulated PASS never becomes physical acceptance',()=>{
    const {template,evaluate}=require('../scripts/lib/education-device-acceptance');const report=template({anchorDate:'2026-10-04',sourceHashes:{}});
    for(const device of report.devices)for(const item of device.checks)item.status='PASS';
    const result=evaluate(report,()=>{throw new Error('Evidence must not be evaluated for an unconfirmed device');});assert.equal(result.exitCode,2);assert.equal(result.counts.passed,0);assert.equal(result.counts.unverified,42);
});
test('reported hardware with empty evidence is blocked; an observed failure stays nonzero',()=>{
    const {template,evaluate}=require('../scripts/lib/education-device-acceptance');const report=template({anchorDate:'2026-10-04',sourceHashes:{}});Object.assign(report.devices[0],{physicalConfirmed:true,model:'Synthetic validator fixture only',osName:'iOS',browserName:'Safari',osVersion:'test',browserVersion:'test',operator:'test',observedAt:'2026-10-04T09:00:00Z'});report.devices[0].checks[0].status='PASS';
    assert.equal(evaluate(report,()=>{}).checks[0].status,'BLOCKED_EVIDENCE');report.devices[0].checks[0].status='FAIL';report.devices[0].checks[0].actual='Observed synthetic validator failure';assert.equal(evaluate(report,()=>{}).exitCode,1);
});
test('device app subprocess refuses missing ownership confirmation and blocks outbound integrations',()=>{
    const {spawnSync}=require('node:child_process');const {safeEnvironment}=require('../scripts/start-education-ready-preview');const env=safeEnvironment(DATABASES.devices);
    const refused=spawnSync(process.execPath,['-e',"throw new Error('Guard should have refused before this body')"],{env,encoding:'utf8',windowsHide:true});assert.notEqual(refused.status,0);assert.match(refused.stderr,/separate local ownership confirmation/);
    const code="const assert=require('node:assert/strict');assert.throws(()=>fetch('https://example.invalid'),/blocked outbound HTTP/);assert.throws(()=>require('node:net').connect({host:'8.8.8.8',port:443}),/blocked outbound TCP/);console.log('Device outbound hold PASS');";
    const allowed=spawnSync(process.execPath,['-e',code],{env:{...env,EDU_READY_DEVICE_LOCAL_CONFIRM:'OWNED_DEVICE_PREVIEW_08C'},encoding:'utf8',windowsHide:true});assert.equal(allowed.status,0);assert.match(allowed.stdout,/Device outbound hold PASS/);
});
