(function exposeHrAttendanceState(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.HrAttendanceState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
    function isAttendanceRecordOpen(record = {}) {
        return Boolean(record && record.clock_in && !record.clock_out);
    }

    return Object.freeze({ isAttendanceRecordOpen });
}));
