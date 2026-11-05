(function () {
    'use strict';
    const key=new URLSearchParams(location.hash.slice(1)).get('uploadKey');
    if(key){window.initAttendanceWorkerUpload(key);return;}
    const retry = document.getElementById('attendanceUploadRetry');
    retry.addEventListener('click', () => {
        if (document.getElementById('attendanceOcrPanel').getAttribute('aria-busy') !== 'true') location.reload();
    });
    // Remove recognized names/hours immediately if another tab logs out or
    // changes the account. The canonical API still verifies every request.
    window.addEventListener('storage', event => {
        if (event.key === null || event.key === CONFIG.STORAGE.CURRENT_USER) {
            window.CrmAttendanceOcrUi.dispose();
            location.reload();
        }
    });
    // Only the existing HR API decides access. This page has no standalone
    // login, token issuance, provider key, or alternate permission policy.
    window.CrmAttendanceOcrUi.init({ canManage: true });
})();
