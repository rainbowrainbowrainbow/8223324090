'use strict';

module.exports = [
    {
        name: 'same-group activity over kitchen is allowed',
        candidate: { category: 'animation', banquetGroupId: 'BG-1', banquetGroupRole: 'activity' },
        conflict: { category: 'kitchen', programCode: 'KITCHEN', banquetGroupId: 'BG-1', banquetGroupRole: 'kitchen' },
        expected: 'allow'
    },
    {
        name: 'same-group activity over service is allowed',
        candidate: { category: 'quest', banquetGroupId: 'BG-1', banquetGroupRole: 'activity' },
        conflict: { category: 'banquet', banquetGroupId: 'BG-1', banquetGroupRole: 'service' },
        expected: 'allow'
    },
    {
        name: 'same-group activity over activity is blocked',
        candidate: { category: 'animation', banquetGroupId: 'BG-1', banquetGroupRole: 'activity' },
        conflict: { category: 'quest', banquetGroupId: 'BG-1', banquetGroupRole: 'activity' },
        expected: 'block'
    },
    {
        name: 'unrelated banquet overlap is blocked',
        candidate: { category: 'animation', banquetGroupId: 'BG-1', banquetGroupRole: 'activity' },
        conflict: { category: 'kitchen', programCode: 'KITCHEN', banquetGroupId: 'BG-2', banquetGroupRole: 'kitchen' },
        expected: 'block'
    },
    {
        name: 'cancelled conflict is ignored',
        candidate: { category: 'animation', banquetGroupId: 'BG-1', banquetGroupRole: 'activity' },
        conflict: { category: 'animation', banquetGroupId: 'BG-1', banquetGroupRole: 'activity', status: 'cancelled' },
        expected: 'allow'
    },
    {
        name: 'takeaway does not reserve a physical room',
        candidate: { category: 'animation', banquetGroupId: 'BG-1', banquetGroupRole: 'activity', room: 'room-takeaway' },
        conflict: { category: 'animation', banquetGroupId: 'BG-2', banquetGroupRole: 'activity' },
        expected: 'allow'
    }
];
