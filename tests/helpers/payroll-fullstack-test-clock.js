'use strict';

const rawNow = process.env.PAYROLL_FULLSTACK_TEST_NOW;

if (rawNow) {
    const fixedTime = new Date(rawNow).getTime();
    if (!Number.isFinite(fixedTime)) {
        throw new Error('PAYROLL_FULLSTACK_TEST_NOW must be a valid ISO timestamp');
    }

    const RealDate = Date;

    class FixedDate extends RealDate {
        constructor(...args) {
            if (args.length === 0) {
                super(fixedTime);
                return;
            }
            super(...args);
        }

        static now() {
            return fixedTime;
        }
    }

    FixedDate.UTC = RealDate.UTC;
    FixedDate.parse = RealDate.parse;

    global.Date = FixedDate;
}
