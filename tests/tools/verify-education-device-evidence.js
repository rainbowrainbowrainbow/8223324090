'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const assert=require('node:assert/strict');
const {evaluate,PRODUCT_FILES}=require('../../scripts/lib/education-device-acceptance');
const root=path.resolve('output/education-ready/08C');const evidenceRoot=path.join(root,'evidence');let summary;
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
try{
    const report=JSON.parse(fs.readFileSync(path.join(root,'operator-results.json'),'utf8').replace(/^\uFEFF/,''));assert.equal(report.task,'EDU-READY-08C');assert.equal(report.classification,'PHYSICAL_DEVICE_ACCEPTANCE');assert.deepEqual(Object.keys(report.sourceHashes||{}).sort(),[...PRODUCT_FILES].sort(),'Missing exact source evidence');for(const [file,digest]of Object.entries(report.sourceHashes))assert.equal(hash(file),digest,'Stale product source: '+file);
    summary=evaluate(report,(file,device)=>{
        assert.ok(['physical-device-screenshot','physical-device-video','physical-device-audio','operator-observation'].includes(file.kind),'Emulated/unclassified evidence');
        assert.equal(file.device,device.id);assert.ok(Number.isFinite(Date.parse(file.capturedAt)),'Missing capture date');assert.match(file.sha256||'',/^[a-f0-9]{64}$/);
        const target=path.resolve(evidenceRoot,file.path||'');assert.ok(target.startsWith(evidenceRoot+path.sep),'Evidence escapes owned folder');assert.ok(fs.statSync(target).isFile());assert.ok(fs.realpathSync(target).startsWith(fs.realpathSync(evidenceRoot)+path.sep));assert.equal(hash(target),file.sha256,'Evidence hash mismatch');
    });
}catch(error){summary={status:'BLOCKED_EVIDENCE',exitCode:2,error:error.message};}
fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'device-verification.json'),JSON.stringify(summary,null,2));console.log(summary.status+' '+JSON.stringify(summary.counts||{})+'; exit='+summary.exitCode);process.exitCode=summary.exitCode;
