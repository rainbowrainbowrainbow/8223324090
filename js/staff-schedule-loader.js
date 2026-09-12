(function () {
    'use strict';

    function staffScheduleModuleSrc() {
        const loaderSrc = document.currentScript?.src || '';
        const versionMatch = loaderSrc.match(/[?&]v=([^&#]+)/);
        const versionSuffix = versionMatch ? `?v=${versionMatch[1]}` : '';
        return `js/staff-page.js${versionSuffix}`;
    }

    const STAFF_SCHEDULE_MODULE_SRC = staffScheduleModuleSrc();
    let staffSchedulePageLoadPromise = null;

    function loadedStaffSchedulePage() {
        const page = window.StaffSchedulePage;
        if (!page || page === lazyStaffSchedulePage) return null;
        if (typeof page.init !== 'function') return null;
        return page;
    }

    function createStaffScheduleScript() {
        const script = document.createElement('script');
        script.src = STAFF_SCHEDULE_MODULE_SRC;
        script.async = true;
        script.dataset.staffScheduleModule = 'lazy';
        return script;
    }

    function loadStaffSchedulePageModule() {
        const loaded = loadedStaffSchedulePage();
        if (loaded) return Promise.resolve(loaded);
        if (staffSchedulePageLoadPromise) return staffSchedulePageLoadPromise;

        staffSchedulePageLoadPromise = new Promise((resolve, reject) => {
            const script = createStaffScheduleScript();
            script.onload = () => {
                const page = loadedStaffSchedulePage();
                if (!page) {
                    staffSchedulePageLoadPromise = null;
                    reject(new Error('Staff schedule module loaded without StaffSchedulePage export'));
                    return;
                }
                resolve(page);
            };
            script.onerror = () => {
                staffSchedulePageLoadPromise = null;
                reject(new Error('Failed to load staff schedule module'));
            };
            document.head.appendChild(script);
        });

        return staffSchedulePageLoadPromise;
    }

    async function callStaffSchedulePage(method, args) {
        const page = await loadStaffSchedulePageModule();
        const fn = page?.[method];
        if (typeof fn !== 'function') {
            throw new Error(`Staff schedule module does not expose ${method}`);
        }
        return fn.apply(page, args);
    }

    const lazyStaffSchedulePage = {
        init(...args) {
            return callStaffSchedulePage('init', args);
        },
        refresh(...args) {
            return callStaffSchedulePage('refresh', args);
        },
        isInitialized() {
            const page = loadedStaffSchedulePage();
            return Boolean(page && typeof page.isInitialized === 'function' && page.isInitialized());
        },
        focusStaff(...args) {
            return callStaffSchedulePage('focusStaff', args);
        },
        openDayPlan(...args) {
            return callStaffSchedulePage('openDayPlan', args);
        },
        renderSchedule(...args) {
            return callStaffSchedulePage('renderSchedule', args);
        }
    };

    if (!loadedStaffSchedulePage()) {
        window.StaffSchedulePage = lazyStaffSchedulePage;
    }
    window.loadStaffSchedulePageModule = loadStaffSchedulePageModule;
})();
