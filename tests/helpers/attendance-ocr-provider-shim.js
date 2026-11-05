'use strict';
// Isolated actual-app dependency injection. Production code has no mock flag.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
assert.equal(process.env.NODE_ENV,'test');
assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET,'true');
assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER,'true');
assert.equal(process.env.RUN_CRM_ATTENDANCE_ACTUAL_APP,'true');
assert.equal(process.env.KIE_API_KEY,'synthetic-key');
assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.PGHOST));
const original=global.fetch;
global.fetch=(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    if(!['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname))throw Error('External HTTP forbidden in attendance actual-app test');
    return original(input,init);
};
if(path.basename(process.argv[1] || '')==='server.js'){
    const modulePath=require.resolve('../../services/crmAttendanceOcrPreview'),api=require(modulePath),factory=api.createAttendanceOcrPreview;
    let calls=0;
    api.createAttendanceOcrPreview=options=>factory({...options,fetchImpl:async(url,request)=>{
        assert.equal(url,'https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions');
        const body=JSON.parse(request.body);assert.match(body.messages[1].content[1].image_url.url,/^data:image\/png;base64,/);
        const date=body.messages[1].content[0].text.match(/Document date: (\d{4}-\d{2}-\d{2})/)[1];
        const output=process.env.CRM_ATTENDANCE_BROWSER_OUTPUT || path.resolve(__dirname,'../../output/playwright/attendance-ocr-actual-app');
        fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'provider-counter.json'),JSON.stringify({syntheticOnly:true,calls:++calls}));
        if(Buffer.from(body.messages[1].content[1].image_url.url.split(',')[1],'base64').at(-1)===5)throw Error('Synthetic provider timeout after dispatch');
        return Response.json({id:'chatcmpl_synthetic_'+calls,credits_consumed:0,choices:[{finish_reason:'stop',message:{content:JSON.stringify({
            documentType:'attendance_sheet',documentDate:date,dateConfidence:0.99,pageNumber:2,pageCount:3,rows:[
                {sourceRowOrdinal:1,ocrName:'Synthetic OCR Browser Employee',arrivalTime:'10:50',departureTime:'20:15',confidence:0.99,issues:[]},
                {sourceRowOrdinal:2,ocrName:'Synthetic unknown employee',arrivalTime:null,departureTime:null,confidence:0.99,issues:[]}
            ]})}}]});
    }});
}
