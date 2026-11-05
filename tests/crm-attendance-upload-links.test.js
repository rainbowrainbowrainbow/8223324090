'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createAttendanceUploadLinks}=require('../services/crmAttendanceUploadLinks');
const {createAttendanceUploadRouter}=require('../services/crmAttendanceUploadHttp');
test('worker intake is default-off before database/provider use',async()=>{
    let queries=0;const service=createAttendanceUploadLinks({env:{},pool:{query(){queries++;throw Error('Must not query');}}});
    await assert.rejects(service.status({token:'a'.repeat(43)}),{code:'CRM_EXECUTION_DISABLED',statusCode:503});
    assert.deepEqual(await service.inbox({actor:{id:7},businessContext:'event_genix'}),{enabled:false,items:[]});
    await assert.rejects(service.inbox({actor:{id:7},businessContext:'dar'}),{code:'CRM_UPLOAD_LINK_FORBIDDEN',statusCode:403});
    assert.equal(queries,0);
});
test('worker HTTP boundary blocks foreign origins, actor injection and oversized files before paid execution',async()=>{
    let calls=0;const service={status:async()=>({documentDate:'2026-11-03',remainingPages:3}),
        upload:async()=>{calls++;return {status:'submitted_for_review'};},recover:async()=>{calls++;return {};}};
    const app=express();app.use(express.json());app.use('/api',require('../middleware/apiAuthBoundary').apiAuthBoundary((req,res)=>res.sendStatus(401)));app.use('/api/attendance-upload',createAttendanceUploadRouter({service}));
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
    try{
        assert.equal((await fetch(base+'/api/attendance-upload/status',{headers:{Origin:'https://foreign.invalid'}})).status,403);
        const invalid=await fetch(base+'/api/attendance-upload/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actor:{id:1},imageSha256:'a'.repeat(64)})});
        assert.equal(invalid.status,400);
        const body=new FormData();body.append('file',new Blob([Buffer.alloc(4*1024*1024+1)],{type:'image/png'}),'large.png');body.append('confirmed','true');
        const large=await fetch(base+'/api/attendance-upload/photo',{method:'POST',body});assert.equal(large.status,413);
        assert.equal(calls,0);
        assert.equal((await fetch(base+'/api/attendance-upload/apply',{method:'POST'})).status,401);
        assert.equal((await fetch(base+'/api/attendance-upload/photo')).status,401);
        const response=await fetch(base+'/api/attendance-upload/status');assert.equal(response.headers.get('cache-control'),'no-store');
    }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
