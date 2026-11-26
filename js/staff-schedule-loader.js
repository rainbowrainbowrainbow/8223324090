(function () {
    'use strict';

    const versionMatch = document.currentScript?.src?.match(/[?&]v=([^&#]+)/);
    const versionSuffix = versionMatch ? `?v=${versionMatch[1]}` : '';
    let staffSchedulePageLoadPromise = null;

    function loadedStaffSchedulePage() {
        const page = window.StaffSchedulePage;
        if (!page || page === lazyStaffSchedulePage) return null;
        if (typeof page.init !== 'function') return null;
        return page;
    }

    function loadScheduleScript(src, readExport) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src + versionSuffix;
            script.async = true;
            script.dataset.staffScheduleModule = 'lazy';
            script.onload = () => {
                const exported = readExport();
                if (exported) {
                    resolve(exported);
                } else {
                    script.remove();
                    reject(new Error(`Staff schedule script loaded without its export: ${src}`));
                }
            };
            script.onerror = () => {
                script.remove();
                reject(new Error(`Failed to load staff schedule script: ${src}`));
            };
            document.head.appendChild(script);
        });
    }

    function loadStaffSchedulePageModule() {
        const loaded = loadedStaffSchedulePage();
        if (loaded) return Promise.resolve(loaded);
        if (staffSchedulePageLoadPromise) return staffSchedulePageLoadPromise;

        const loadPage = () => loadScheduleScript('js/staff-page.js', loadedStaffSchedulePage);
        const readShell = () => window.StaffScheduleShell?.ensure;
        const request = readShell()
            ? loadPage()
            : loadScheduleScript('js/staff-schedule-shell.js', readShell).then(loadPage);
        staffSchedulePageLoadPromise = request.catch(error => {
            staffSchedulePageLoadPromise = null;
            throw error;
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
