'use strict';

function shouldTemplateRunOnDate(tpl, dateStr) {
    if (tpl.date_from && dateStr < tpl.date_from) return false;
    if (tpl.date_to && dateStr > tpl.date_to) return false;
    const dayOfWeek = new Date(dateStr + 'T12:00:00Z').getUTCDay() || 7; // 1=Mon...7=Sun
    switch (tpl.recurrence_pattern) {
        case 'daily': return true;
        case 'weekdays': return dayOfWeek <= 5;
        case 'weekends': return dayOfWeek >= 6;
        case 'weekly': return dayOfWeek === 6;
        case 'custom':
            if (!tpl.recurrence_days) return false;
            return tpl.recurrence_days.split(',').map(d => parseInt(d.trim())).includes(dayOfWeek);
        default: return false;
    }
}

module.exports = { shouldTemplateRunOnDate };
