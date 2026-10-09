'use strict';
// Real HTTP/PostgreSQL suites: explicit captured TAP, no mocked results or internal UI claims.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {parseTap}=require('../helpers/education-close-evidence');
const contracts=require('../helpers/education-close-contracts.json');
(async()=>{
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER,'true');
    const suite=process.env.EDU_CLOSE_SUITE,contract=contracts[suite];
    assert.ok(contract?.file.startsWith('tests/integration/'));
    assert.equal(process.env.EDU_CLOSE_PG_FILE,contract.file);
    let transcript='';
    const code=await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,['--test','--test-concurrency=1',contract.file],{env:{...process.env,RUN_EDUCATION_SERIES_INTEGRATION:'true'},windowsHide:true,stdio:['ignore','pipe','pipe']});
        child.once('error',reject);for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{transcript+=String(chunk);process.stdout.write(chunk);});child.once('close',code=>resolve(code??1));
    });
    assert.equal(code,0,'PostgreSQL suite failed');
    const parsed=parseTap(transcript,contract);
    const out=path.resolve(process.env.EDU_READY_OUTPUT);fs.mkdirSync(out,{recursive:true});
    fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({suite,attemptId:process.env.EDU_CLOSE_ATTEMPT_ID,exitCode:0,classification:contract.classification,...parsed},null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
