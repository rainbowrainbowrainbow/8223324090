'use strict';
const express=require('express'),multer=require('multer');
const {executionError}=require('./crmProviderExecution');
function createAttendanceUploadHandlers(options={}){
    const service=options.service||require('./crmAttendanceUploadLinks').createAttendanceUploadLinks(options);
    const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:4*1024*1024,files:1,fields:1,fieldSize:10}}).single('file');
    function token(req){return req.headers['x-attendance-upload-key'];}
    function fields(body,keys){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!keys.includes(key)))throw executionError('CRM_UPLOAD_FIELDS_INVALID',400);return body;}
    function manager(req){const businessContext=options.resolveContext?options.resolveContext(req):req.businessContext;if(businessContext!=='event_genix'||!Number.isInteger(req.user?.id)||req.user.id<1)throw executionError('CRM_UPLOAD_LINK_FORBIDDEN',403);return {actor:req.user,businessContext:'event_genix'};}
    function error(res,failure){const code=/^(CRM_|LIMIT_)/.test(failure.code||'')?failure.code:'CRM_UPLOAD_FAILED';
        return res.status(code==='LIMIT_FILE_SIZE'?413:failure.statusCode||(code==='CRM_UPLOAD_FAILED'?500:400)).json({success:false,code});}
    async function handle(req,res,work){res.set('Cache-Control','no-store');try{return res.json(await work());}catch(failure){return error(res,failure);}}
    return {
        create:(req,res)=>handle(req,res,()=>service.create({...manager(req),...fields(req.body,['documentDate'])})),
        inbox:(req,res)=>handle(req,res,()=>service.inbox(manager(req))),
        revoke:(req,res)=>handle(req,res,()=>{fields(req.body||{},[]);return service.revoke({...manager(req),linkId:req.params.linkId});}),
        recoverSubmission:(req,res)=>handle(req,res,()=>{fields(req.body||{},[]);return service.recoverSubmission({...manager(req),submissionId:req.params.submissionId});}),
        async photo(req,res){res.set('Cache-Control','no-store');try{
            const result=await service.photo({...manager(req),submissionId:req.params.submissionId});
            return res.set({'Content-Type':result.image_mime,'Content-Disposition':'inline; filename="attendance-sheet"','X-Content-Type-Options':'nosniff'}).send(result.image_bytes);
        }catch(failure){return error(res,failure);}},
        status:(req,res)=>handle(req,res,()=>service.status({token:token(req)})),
        recover:(req,res)=>handle(req,res,()=>service.recover({token:token(req),...fields(req.body,['imageSha256'])})),
        async upload(req,res){
            res.set('Cache-Control','no-store');
            // Verify the scoped bearer and fresh reviewer before buffering a file.
            try{await service.status({token:token(req)});}catch(failure){return error(res,failure);}
            upload(req,res,failure=>{
                if(failure)return error(res,failure);
                return handle(req,res,()=>service.upload({token:token(req),file:req.file,confirmed:fields(req.body,['confirmed']).confirmed==='true'}));
            });
        }
    };
}
function createAttendanceUploadRouter(options={}){
    const router=express.Router(),handlers=createAttendanceUploadHandlers(options);
    router.use((req,res,next)=>{
        res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
        // Exact registered JWT exceptions retain the global API limiter and
        // this route-specific scoped bearer. No permissive cross-origin intake.
        if(req.headers.origin && req.headers.origin!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({success:false,code:'CRM_UPLOAD_ORIGIN_FORBIDDEN'});
        next();
    });
    router.get('/status',handlers.status);
    router.post('/photo',handlers.upload);
    router.post('/recover',handlers.recover);
    return router;
}
module.exports={createAttendanceUploadHandlers,createAttendanceUploadRouter};
