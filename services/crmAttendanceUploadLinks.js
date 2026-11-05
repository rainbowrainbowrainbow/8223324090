'use strict';
const { randomBytes, randomUUID, createHash }=require('node:crypto');
const { executionError, transaction, requireExecutionEnabled }=require('./crmProviderExecution');
const { validateScheduleImage }=require('./crmScheduleOcr');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const MAX_PAGES=3;
const hash=value=>createHash('sha256').update(value).digest('hex');
function validDate(value){return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
function createAttendanceUploadLinks(options={}) {
    const env=options.env||process.env,pool=options.pool||require('../db').pool;
    const ocr=options.ocr||require('./crmAttendanceOcrPreview').createAttendanceOcrPreview({...options,pool,env});
    const reviewer=options.resolveReviewer||require('./crmAttendanceUploadAccess').resolveUploadReviewer;
    function enabled(){requireExecutionEnabled(env,'CRM_ATTENDANCE_UPLOAD_LINKS_ENABLED');requireExecutionEnabled(env,'CRM_ATTENDANCE_OCR_ENABLED');}
    function manager(input){enabled();if(input.businessContext!=='event_genix'||!Number.isInteger(input.actor?.id)||input.actor.id<1)throw executionError('CRM_UPLOAD_LINK_FORBIDDEN',403);}
    async function load(token,db=pool,lock=false){
        enabled();if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw executionError('CRM_UPLOAD_LINK_UNAVAILABLE',403);
        const row=(await db.query(`SELECT *,document_date::text AS document_date FROM crm_attendance_upload_links
            WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>NOW()${lock?' FOR UPDATE':''}`,[hash(token)])).rows[0];
        if(!row)throw executionError('CRM_UPLOAD_LINK_UNAVAILABLE',403);return row;
    }
    async function context(token){const link=await load(token);return {link,base:await reviewer(link,pool)};}
    const receipt=row=>({submissionId:row.id,status:row.status==='ready'?'submitted_for_review':'needs_review'});
    async function expirePhotos(actorId){
        // Bounded, opportunistic retention of this reviewer's source photos only.
        // Keep OCR receipts, previews, submissions and attendance history intact.
        await pool.query(`UPDATE crm_attendance_upload_submissions SET image_bytes=NULL WHERE id IN (
            SELECT s.id FROM crm_attendance_upload_submissions s JOIN crm_attendance_upload_links l ON l.id=s.link_id
            WHERE l.reviewer_user_id=$1 AND s.image_bytes IS NOT NULL AND s.photo_expires_at<=NOW()
            ORDER BY s.photo_expires_at LIMIT 100)`,[actorId]);
    }
    async function recoverRow(link,base,row){
        if(row.status==='ready')return receipt(row);
        try{
            const saved=await ocr.recoverPreview({...base,documentDate:link.document_date,imageSha256:row.image_sha256});
            await pool.query("UPDATE crm_attendance_upload_submissions SET status='ready',preview_id=$2 WHERE id=$1",[row.id,saved.previewId]);
            return {submissionId:row.id,status:'submitted_for_review'};
        }catch{return receipt(row);}
    }
    return {
        async create(input){
            manager(input);if(!validDate(input.documentDate))throw executionError('CRM_UPLOAD_DATE_INVALID',400);
            const client=await pool.connect();try{return await transaction(client,async()=>{
                // Short per-reviewer lock also serializes link-count limits across replicas.
                const user=(await client.query(`SELECT id,COALESCE(EXTRACT(EPOCH FROM session_revoked_at)*1000,0) AS cutoff
                    FROM users WHERE id=$1 AND is_active IS TRUE FOR UPDATE`,[input.actor.id])).rows[0];
                if(!user)throw executionError('CRM_UPLOAD_LINK_FORBIDDEN',403);
                const count=(await client.query(`SELECT count(*)::int AS n FROM crm_attendance_upload_links
                    WHERE reviewer_user_id=$1 AND created_at>NOW()-INTERVAL '24 hours'`,[user.id])).rows[0].n;
                if(count>=3)throw executionError('CRM_UPLOAD_LINK_LIMIT',429);
                const token=randomBytes(32).toString('base64url'),id=randomUUID();
                const row=(await client.query(`INSERT INTO crm_attendance_upload_links
                    (id,token_hash,reviewer_user_id,business_context,document_date,session_revocation_cutoff,expires_at)
                    VALUES($1,$2,$3,'event_genix',$4,$5,NOW()+INTERVAL '24 hours') RETURNING expires_at`,
                    [id,hash(token),user.id,input.documentDate,user.cutoff])).rows[0];
                return {id,path:'/attendance-upload.html#uploadKey='+token,documentDate:input.documentDate,expiresAt:row.expires_at,maxPages:MAX_PAGES};
            });}finally{client.release();}
        },
        async inbox(input){
            manager(input);
            await expirePhotos(input.actor.id);
            const result=await pool.query(`SELECT l.id,l.document_date::text AS document_date,l.expires_at,l.revoked_at,
                s.id AS submission_id,s.status,s.preview_id,s.created_at AS submitted_at,
                s.image_bytes IS NOT NULL AND s.photo_expires_at>NOW() AS photo_available
                FROM crm_attendance_upload_links l LEFT JOIN crm_attendance_upload_submissions s ON s.link_id=l.id
                WHERE l.reviewer_user_id=$1 AND l.business_context='event_genix'
                ORDER BY l.created_at DESC,s.created_at LIMIT 150`,[input.actor.id]);
            return {items:result.rows};
        },
        async photo(input){
            manager(input);if(!UUID.test(input.submissionId||''))throw executionError('CRM_UPLOAD_NOT_FOUND',404);
            const row=(await pool.query(`SELECT s.image_bytes,s.image_mime FROM crm_attendance_upload_submissions s
                JOIN crm_attendance_upload_links l ON l.id=s.link_id
                WHERE s.id=$1 AND l.reviewer_user_id=$2 AND l.business_context='event_genix'
                AND s.photo_expires_at>NOW() AND s.image_bytes IS NOT NULL`,[input.submissionId,input.actor.id])).rows[0];
            if(!row)throw executionError('CRM_UPLOAD_NOT_FOUND',404);return row;
        },
        async revoke(input){
            manager(input);if(!UUID.test(input.linkId||''))throw executionError('CRM_UPLOAD_LINK_NOT_FOUND',404);
            const result=await pool.query(`UPDATE crm_attendance_upload_links SET revoked_at=COALESCE(revoked_at,NOW())
                WHERE id=$1 AND reviewer_user_id=$2 AND business_context='event_genix' RETURNING id`,[input.linkId,input.actor.id]);
            if(!result.rowCount)throw executionError('CRM_UPLOAD_LINK_NOT_FOUND',404);return {revoked:true};
        },
        async recoverSubmission(input){
            manager(input);if(!UUID.test(input.submissionId||''))throw executionError('CRM_UPLOAD_NOT_FOUND',404);
            const row=(await pool.query(`SELECT s.id,s.status,s.image_sha256,l.document_date::text AS document_date
                FROM crm_attendance_upload_submissions s JOIN crm_attendance_upload_links l ON l.id=s.link_id
                WHERE s.id=$1 AND l.reviewer_user_id=$2 AND l.business_context='event_genix'`,[input.submissionId,input.actor.id])).rows[0];
            if(!row)throw executionError('CRM_UPLOAD_NOT_FOUND',404);
            return recoverRow({document_date:row.document_date},{actor:input.actor,businessContext:'event_genix'},row);
        },
        async status(input){
            const {link}=await context(input.token);
            const count=(await pool.query('SELECT count(*)::int AS n FROM crm_attendance_upload_submissions WHERE link_id=$1',[link.id])).rows[0].n;
            return {documentDate:link.document_date,expiresAt:link.expires_at,remainingPages:MAX_PAGES-count};
        },
        async recover(input){
            const {link,base}=await context(input.token);
            if(!SHA.test(input.imageSha256||''))throw executionError('CRM_UPLOAD_IMAGE_INVALID',400);
            const row=(await pool.query('SELECT id,status,image_sha256 FROM crm_attendance_upload_submissions WHERE link_id=$1 AND image_sha256=$2',[link.id,input.imageSha256])).rows[0];
            if(!row)throw executionError('CRM_UPLOAD_NOT_FOUND',404);return recoverRow(link,base,row);
        },
        async upload(input){
            if(input.confirmed!==true)throw executionError('CRM_EXECUTION_CONFIRMATION_REQUIRED',400);
            const {link,base}=await context(input.token),image=validateScheduleImage(input.file);
            await expirePhotos(base.actor.id);
            const client=await pool.connect();let entry;
            try{entry=await transaction(client,async()=>{
                await load(input.token,client,true);
                const prior=(await client.query('SELECT id,status,image_sha256 FROM crm_attendance_upload_submissions WHERE link_id=$1 AND image_sha256=$2',[link.id,image.sha256])).rows[0];
                if(prior)return {row:prior,created:false};
                const count=(await client.query('SELECT count(*)::int AS n FROM crm_attendance_upload_submissions WHERE link_id=$1',[link.id])).rows[0].n;
                if(count>=MAX_PAGES)throw executionError('CRM_UPLOAD_PAGE_LIMIT',429);
                const row=(await client.query(`INSERT INTO crm_attendance_upload_submissions(id,link_id,image_sha256,image_bytes,image_mime)
                    VALUES($1,$2,$3,$4,$5) RETURNING id,status,image_sha256`,[randomUUID(),link.id,image.sha256,image.bytes,image.mimeType])).rows[0];
                return {row,created:true};
            });}finally{client.release();}
            if(!entry.created)return recoverRow(link,base,entry.row);
            // No transaction or row lock is held across the existing paid executor.
            try{
                const saved=await ocr.preview({...base,file:input.file,documentDate:link.document_date,confirmed:true});
                await pool.query("UPDATE crm_attendance_upload_submissions SET status='ready',preview_id=$2 WHERE id=$1",[entry.row.id,saved.previewId]);
                return {submissionId:entry.row.id,status:'submitted_for_review'};
            }catch{
                await pool.query("UPDATE crm_attendance_upload_submissions SET status='unknown' WHERE id=$1 AND status='reserved'",[entry.row.id]);
                return {submissionId:entry.row.id,status:'needs_review'};
            }
        }
    };
}
module.exports={createAttendanceUploadLinks};
