'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{createHash}=require('node:crypto');
module.exports=async function({base,browser,page,db,token,foreignToken,restrictedToken,png,staffId,output,api}){
    await page.goto(base+'/hr#today',{waitUntil:'domcontentloaded'});
    await page.locator('#attendanceUploadLinkCreate').waitFor({state:'attached'});
    await page.locator('#attendanceOcrPanel').evaluate(el=>{el.open=true;});
    await page.locator('#attendanceUploadLinkDate').fill('2026-11-03');
    await page.locator('#attendanceUploadLinkCreate').click();
    await page.waitForFunction(()=>document.querySelector('#attendanceUploadLinkValue').value.includes('#uploadKey='));
    const url=await page.locator('#attendanceUploadLinkValue').inputValue(),key=new URL(url).hash.slice('#uploadKey='.length);
    const linkId=(await db.query('SELECT id,token_hash FROM crm_attendance_upload_links WHERE reviewer_user_id=(SELECT id FROM users WHERE username=$1) ORDER BY created_at DESC LIMIT 1',[process.env.TEST_USER])).rows[0];
    assert.equal(linkId.token_hash,createHash('sha256').update(key).digest('hex'));assert.notEqual(linkId.token_hash,key);
    assert.equal((await api('/api/hr/attendance/ocr/upload-links',restrictedToken,{documentDate:'2026-11-03'})).status,403);
    assert.equal((await api('/api/hr/attendance/ocr/upload-links/'+linkId.id+'/revoke',foreignToken,{})).status,404);
    assert.equal((await api('/api/hr/attendance/ocr/uploads',foreignToken)).body.items.length,0);
    await page.locator('#attendanceOcrPanel').screenshot({path:path.join(output,'hr-worker-links.png'),mask:[page.locator('#attendanceUploadLinkValue')]});
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const worker=await context.newPage(),errors=[];worker.on('pageerror',error=>errors.push(error.message));
    const image=Buffer.concat([png,Buffer.from([1])]);
    async function publicRequest(route,body,extra={}){return fetch(base+'/api/attendance-upload/'+route,{method:body===undefined?'GET':'POST',headers:{'X-Attendance-Upload-Key':key,...extra},...(body===undefined?{}:{body})});}
    function body(bytes){const value=new FormData();value.append('file',new Blob([bytes],{type:'image/png'}),'synthetic.png');value.append('confirmed','true');return value;}
    try{
        assert.equal((await fetch(base+'/api/attendance-upload/status')).status,403);
        assert.equal((await publicRequest('status',undefined,{Origin:'https://foreign.invalid'})).status,403);
        await worker.goto(url,{waitUntil:'domcontentloaded'});
        await worker.waitForFunction(()=>document.querySelector('#workerUploadSend') && !document.querySelector('#workerUploadSend').disabled);
        assert.equal(await worker.evaluate(()=>localStorage.length),0,'No CRM credentials on worker website');
        await worker.locator('#workerUploadFile').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:image});
        await worker.locator('#workerUploadConsent').check();
        await worker.route('**/api/attendance-upload/photo',async route=>{await route.fetch();await route.abort('failed');},{times:1});
        await worker.locator('#workerUploadSend').click();
        await worker.waitForFunction(()=>document.querySelector('#workerUploadStatus').textContent.includes('Не вдалося підтвердити'));
        assert.equal(await worker.locator('#workerUploadSend').isDisabled(),true);
        await worker.locator('#workerUploadRecover').click();
        await worker.waitForFunction(()=>document.querySelector('#workerUploadStatus').textContent.includes('Лист надіслано'));
        assert.doesNotMatch(await worker.locator('body').innerText(),/Synthetic OCR|10:50|20:15/);
        assert.equal((await db.query("SELECT count(*)::int AS n FROM hr_time_records WHERE staff_id=$1 AND record_date='2026-11-03'",[staffId])).rows[0].n,0);
        const repeated=await Promise.all([publicRequest('photo',body(image)),publicRequest('photo',body(image))]);
        for(const response of repeated){assert.equal(response.status,200);const result=await response.json();assert.deepEqual(Object.keys(result).sort(),['status','submissionId']);}
        const hash=createHash('sha256').update(image).digest('hex');
        const submission=(await db.query('SELECT id,preview_id FROM crm_attendance_upload_submissions WHERE link_id=$1 AND image_sha256=$2',[linkId.id,hash])).rows[0];
        assert.equal((await api('/api/hr/attendance/ocr/uploads/'+submission.id+'/recover',foreignToken,{})).status,404);
        assert.equal((await api('/api/hr/attendance/ocr/uploads/'+submission.id+'/recover',token,{})).status,200);
        const photoPath='/api/hr/attendance/ocr/uploads/'+submission.id+'/photo';
        assert.equal((await fetch(base+photoPath)).status,401);
        assert.equal((await fetch(base+photoPath,{headers:{Authorization:'Bearer '+foreignToken}})).status,404);
        const original=await fetch(base+photoPath,{headers:{Authorization:'Bearer '+token}});assert.equal(original.status,200);
        assert.equal(original.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await original.arrayBuffer()),image);
        await page.locator('#attendanceUploadInboxRefresh').click();
        const review=page.locator('#attendanceUploadInbox a').filter({hasText:'Перевірити рядки'});await review.first().waitFor();
        await page.getByRole('button',{name:'Переглянути оригінал фото'}).first().click();
        await page.waitForFunction(()=>document.querySelector('.attendance-upload-photo img')?.naturalWidth>0);
        await page.getByRole('button',{name:'Закрити фото'}).click();
        await review.first().click();await page.locator('#attendanceOcrReview').waitFor({state:'visible'});
        assert.equal(new URL(page.url()).searchParams.get('attendancePreview'),submission.preview_id);
        assert.equal(await page.locator('#attendanceOcrApply').isDisabled(),true);
        await page.locator('#attendanceOcrRows input[data-ordinal="1"]').check();await page.locator('#attendanceOcrApplyConfirm').check();
        await page.locator('#attendanceOcrApply').click();
        await page.waitForFunction(()=>document.querySelector('#attendanceOcrStatus').textContent.includes('Застосовано рядків: 1'));
        assert.equal((await db.query("SELECT total_worked_minutes FROM hr_time_records WHERE staff_id=$1 AND record_date='2026-11-03'",[staffId])).rows[0].total_worked_minutes,565);
        // Two simultaneous submissions of a new image reserve only one slot/call.
        const image2=Buffer.concat([png,Buffer.from([2])]);
        const concurrent=await Promise.all([publicRequest('photo',body(image2)),publicRequest('photo',body(image2))]);
        for(const response of concurrent)assert.equal(response.status,200);
        assert.equal((await publicRequest('photo',body(Buffer.concat([png,Buffer.from([3])])))).status,200);
        const limited=await publicRequest('photo',body(Buffer.concat([png,Buffer.from([4])])));assert.equal(limited.status,429);
        assert.equal((await limited.json()).code,'CRM_UPLOAD_PAGE_LIMIT');
        assert.equal((await db.query('SELECT count(*)::int AS n FROM crm_attendance_upload_submissions WHERE link_id=$1',[linkId.id])).rows[0].n,3);
        assert.ok(await worker.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        await worker.screenshot({path:path.join(output,'worker-mobile-upload.png'),fullPage:true});
        assert.equal((await api('/api/hr/attendance/ocr/upload-links/'+linkId.id+'/revoke',token,{})).status,200);
        assert.equal((await publicRequest('status')).status,403);
        const deniedLink=await api('/api/hr/attendance/ocr/upload-links',token,{documentDate:'2026-11-03'});assert.equal(deniedLink.status,200);
        const deniedKey=new URL('http://local'+deniedLink.body.path).hash.slice('#uploadKey='.length);
        const unknownImage=Buffer.concat([png,Buffer.from([5])]);
        for(let attempt=0;attempt<2;attempt++){
            const unknown=await fetch(base+'/api/attendance-upload/photo',{method:'POST',headers:{'X-Attendance-Upload-Key':deniedKey},body:body(unknownImage)});
            assert.equal(unknown.status,200);assert.equal((await unknown.json()).status,'needs_review');
        }
        const held=(await db.query(`SELECT s.status,e.status AS execution_status FROM crm_attendance_upload_submissions s
            JOIN crm_attendance_upload_links l ON l.id=s.link_id JOIN crm_attendance_ocr_executions e
            ON e.actor_user_id=l.reviewer_user_id AND e.document_date=l.document_date AND e.image_sha256=s.image_sha256
            WHERE l.id=$1`,[deniedLink.body.id])).rows[0];
        assert.deepEqual(held,{status:'unknown',execution_status:'unknown'});
        const owner=(await db.query('SELECT id,session_revoked_at FROM users WHERE username=$1',[process.env.TEST_USER])).rows[0];
        const memberships=(await db.query('SELECT business_id,action_denylist FROM business_memberships WHERE user_id=$1',[owner.id])).rows;
        try{
            await db.query("UPDATE business_memberships SET action_denylist=ARRAY['hr.schedule.manage'] WHERE user_id=$1",[owner.id]);
            assert.equal((await fetch(base+'/api/attendance-upload/status',{headers:{'X-Attendance-Upload-Key':deniedKey}})).status,403);
        }finally{for(const row of memberships)await db.query('UPDATE business_memberships SET action_denylist=$3 WHERE business_id=$1 AND user_id=$2',[row.business_id,owner.id,row.action_denylist]);}
        try{
            await db.query('UPDATE business_memberships SET is_active=false WHERE user_id=$1',[owner.id]);
            assert.equal((await fetch(base+'/api/attendance-upload/status',{headers:{'X-Attendance-Upload-Key':deniedKey}})).status,403);
        }finally{await db.query('UPDATE business_memberships SET is_active=true WHERE user_id=$1',[owner.id]);}
        try{
            await db.query("UPDATE hr_time_records SET business_context='dar' WHERE staff_id=$1",[staffId]);
            assert.equal((await fetch(base+'/api/attendance-upload/status',{headers:{'X-Attendance-Upload-Key':deniedKey}})).status,403);
        }finally{await db.query("UPDATE hr_time_records SET business_context='event_genix' WHERE staff_id=$1",[staffId]);}
        try{
            await db.query('UPDATE users SET session_revoked_at=NOW() WHERE id=$1',[owner.id]);
            assert.equal((await fetch(base+'/api/attendance-upload/status',{headers:{'X-Attendance-Upload-Key':deniedKey}})).status,403);
        }finally{await db.query('UPDATE users SET session_revoked_at=$2 WHERE id=$1',[owner.id,owner.session_revoked_at]);}
        await db.query("UPDATE crm_attendance_upload_links SET created_at=NOW()-INTERVAL '25 hours',expires_at=NOW()-INTERVAL '1 hour' WHERE id=$1",[deniedLink.body.id]);
        assert.equal((await fetch(base+'/api/attendance-upload/status',{headers:{'X-Attendance-Upload-Key':deniedKey}})).status,403);
        await db.query("UPDATE crm_attendance_upload_submissions SET photo_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[submission.id]);
        assert.equal((await fetch(base+photoPath,{headers:{Authorization:'Bearer '+token}})).status,404);
        assert.equal((await api('/api/hr/attendance/ocr/uploads',token)).status,200);
        const retained=(await db.query('SELECT image_bytes,preview_id,status FROM crm_attendance_upload_submissions WHERE id=$1',[submission.id])).rows[0];
        assert.equal(retained.image_bytes,null);assert.equal(retained.status,'ready');assert.equal(retained.preview_id,submission.preview_id);
        assert.deepEqual(errors,[]);
        return {workerLinks:true,workerWithoutCrmLogin:true,uploadOnlyNoStaffDisclosure:true,reviewerInbox:true,privateOriginalPhoto:true,sourcePhotoRetention:true,confirmedReviewerApply:true,quota:true,concurrentDuplicate:true,unknownOutcomeHeldWithoutRetry:true,revocation:true,expiry:true,freshReviewerPermission:true,reviewerSessionRevocation:true};
    }finally{await context.close();}
};
