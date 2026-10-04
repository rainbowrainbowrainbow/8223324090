'use strict';

// Only the existing report clock input is controlled. Queries/calculation stay real;
// authentication, timers, history timestamps and database NOW() remain untouched.
const assert = require('node:assert/strict');
const { DATABASES, assertLocalTarget } = require('../../scripts/lib/education-ready-dataset');
assertLocalTarget('fixed');
assert.equal(process.env.PGDATABASE, DATABASES.fixed);
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.EDU_READY_REPORT_NOW, '2026-10-03T09:00:00Z');
const attendance = require('../../services/educationAttendance');
const realReport = attendance.report;
attendance.report = (business, options = {}) => realReport(business, { ...options, now: new Date(process.env.EDU_READY_REPORT_NOW) });
