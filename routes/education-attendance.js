'use strict';

const router = require('express').Router();
const { authenticateToken, requireAction } = require('../middleware/auth');
const { timelineContextFromRequest, requireTimelineContext, requireTimelineAction } = require('../services/timelineContext');
const attendance = require('../services/educationAttendance');
const { createLogger } = require('../utils/logger');

const log = createLogger('EducationAttendance');
router.use(authenticateToken);

function context(req, res, action = 'view') {
    const selected = timelineContextFromRequest(req);
    if (!requireTimelineContext(req, res, selected)) return null;
    if (action !== 'view' && !requireTimelineAction(req, res, selected, action)) return null;
    return selected;
}

function failure(res, error) {
    if (!(error instanceof attendance.EducationAttendanceError)) log.error('Education attendance request failed', error);
    return res.status(error.status || 500).json({
        success: false, error: error.status ? error.message : 'Internal server error'
    });
}

router.get('/reports', async (req, res) => {
    const business = context(req, res);
    if (!business) return;
    try {
        res.json({ success: true, report: await attendance.report(business, req.query) });
    } catch (error) { failure(res, error); }
});

router.get('/attendance/:bookingId', async (req, res) => {
    const business = context(req, res);
    if (!business) return;
    try {
        res.json({ success: true, journal: await attendance.readJournal(business, req.params.bookingId) });
    } catch (error) { failure(res, error); }
});

router.put('/attendance/:bookingId', requireAction('edit_booking'), async (req, res) => {
    const business = context(req, res, 'edit');
    if (!business) return;
    try {
        res.json({ success: true, ...(await attendance.saveJournal(
            business, req.params.bookingId, req.body || {}, req.user?.username
        )) });
    } catch (error) { failure(res, error); }
});

module.exports = router;
