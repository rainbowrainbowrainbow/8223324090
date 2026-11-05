'use strict';
const multer = require('multer');
const { executionError } = require('./crmProviderExecution');

function createAttendanceOcrHandlers(options = {}) {
    const env = options.env || process.env;
    const preview = options.preview || require('./crmAttendanceOcrPreview').createAttendanceOcrPreview(options);
    const apply = options.apply || require('./crmAttendanceOcrApply').createAttendanceOcrApply(options);
    const upload = multer({ storage: multer.memoryStorage(), limits: {
        fileSize: 4 * 1024 * 1024, files: 1, fields: 2, fieldSize: 100
    } }).single('file');
    function context(req) {
        const businessContext = options.resolveContext ? options.resolveContext(req) : req.businessContext;
        if (businessContext !== 'event_genix' || !Number.isInteger(req.user?.id) || req.user.id < 1) throw executionError('CRM_ATTENDANCE_OCR_CONTEXT_FORBIDDEN', 403);
        return { businessContext, actor: req.user };
    }
    function fields(body, allowed) {
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw executionError('CRM_ATTENDANCE_OCR_APPLY_INVALID', 400);
        return body;
    }
    function sendError(res, error) {
        const known = /^(?:CRM_|LIMIT_)/.test(error.code || '');
        const code = error.code === '40001' ? 'CRM_ATTENDANCE_OCR_PREVIEW_STALE' : known ? error.code : 'CRM_ATTENDANCE_OCR_FAILED';
        return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : error.code === '40001' ? 409 : known ? error.statusCode || 400 : 500)
            .json({ success: false, code });
    }
    function present(value) {
        return { ...value, applyAllowed: env.CRM_ATTENDANCE_OCR_ENABLED === 'true' && !value.applied && !value.expired
            && value.rows.some(row => row.classification === 'ready_for_confirmed_apply') };
    }
    async function handle(req, res, work) {
        res.set('Cache-Control', 'no-store');
        try { return res.json(await work(context(req))); }
        catch (error) { return sendError(res, error); }
    }
    return {
        status: (req, res) => handle(req,res,async()=>({ enabled: env.CRM_ATTENDANCE_OCR_ENABLED === 'true' })),
        preview(req, res) {
            res.set('Cache-Control', 'no-store');
            try { context(req); } catch (error) { return sendError(res,error); }
            if (env.CRM_ATTENDANCE_OCR_ENABLED !== 'true') return sendError(res,executionError('CRM_EXECUTION_DISABLED',503));
            upload(req,res,error=>{
                if (error) return sendError(res,error);
                return handle(req,res,async base=>{
                    const body=fields(req.body,['documentDate','confirmed']);
                    return present(await preview.preview({ ...base, file:req.file, documentDate:body.documentDate, confirmed:body.confirmed==='true' }));
                });
            });
        },
        get: (req,res)=>handle(req,res,async base=>present(await preview.getPreview({ ...base,previewId:req.params.previewId }))),
        refresh: (req,res)=>handle(req,res,async base=>{
            fields(req.body || {},[]);
            return present(await preview.refreshPreview({ ...base,previewId:req.params.previewId }));
        }),
        recover: (req,res)=>handle(req,res,async base=>{
            const body=fields(req.body,['documentDate','imageSha256']);
            return present(await preview.recoverPreview({ ...base,...body }));
        }),
        apply: (req,res)=>handle(req,res,async base=>{
            const body=fields(req.body,['previewId','previewHash','selectedRowOrdinals','confirmed']);
            const result=await apply({ ...body,...base });
            if (options.afterApply && !result.reused) {
                try { await options.afterApply(result); } catch { return { ...result,realtimeNotification:'unavailable' }; }
            }
            return result;
        })
    };
}
module.exports = { createAttendanceOcrHandlers };
