'use strict';

const multer = require('multer');

function createScheduleOcrHandlers(options = {}) {
    const env = options.env || process.env;
    const schedule = options.schedule || require('./crmScheduleOcr').createScheduleOcr({ env });
    const upload = multer({ storage: multer.memoryStorage(),
        limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 3, fieldSize: 200 } }).single('file');
    const sendError = (res, error) => {
        const known = /^(?:CRM_|HERMES_|LIMIT_)/.test(error.code || '');
        const code = known ? error.code : 'CRM_OCR_FAILED';
        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : error.statusCode || (known ? 400 : 500);
        return res.status(status).json({ success: false, code,
            error: status >= 500 ? 'Розпізнавання потребує перевірки. Не запускайте повторно автоматично.' : code });
    };
    return {
        preview(req, res) {
            if (env.CRM_SCHEDULE_OCR_ENABLED !== 'true') {
                return res.status(503).json({ success: false, code: 'CRM_EXECUTION_DISABLED' });
            }
            upload(req, res, async error => {
                if (error) return sendError(res, error);
                try {
                    if (req.body.businessContext && req.body.businessContext !== 'event_genix') {
                        return res.status(403).json({ success: false, code: 'CRM_OCR_CONTEXT_FORBIDDEN' });
                    }
                    return res.json(await schedule.preview({ file: req.file, documentDate: req.body.documentDate,
                        actor: req.user, businessContext: 'event_genix', confirmed: req.body.confirmed === 'true' }));
                } catch (err) { return sendError(res, err); }
            });
        },
        async apply(req, res) {
            try {
                const { confirmed, ...body } = req.body || {};
                const result = await schedule.apply({ body, actor: req.user, businessContext: 'event_genix', confirmed });
                // Schedule writes have already committed. A failed realtime
                // notification must not report the write as failed or invite replay.
                if (options.afterApply) {
                    try { options.afterApply(result, req.user); }
                    catch { return res.json({ ...result.response, realtimeNotification: 'unavailable' }); }
                }
                return res.json(result.response);
            } catch (err) { return sendError(res, err); }
        }
    };
}

module.exports = { createScheduleOcrHandlers };
