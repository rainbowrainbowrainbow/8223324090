const THEME_REDIRECT_PAGES = {
    'analytics.html': {
        target: '/finance?mode=insights',
        owner: 'finance'
    }
};

const THEME_STANDALONE_PAGES = {
    'checkin.html': {
        owner: 'checkin',
        reason: 'Camera kiosk surface without the authenticated CRM shell.',
        maxStyleBytes: 6500,
        maxInlineStyleAttrs: 4,
        maxHardColors: 60
    },
    'invite.html': {
        owner: 'invite',
        reason: 'Public invite card that must keep its own printable/shareable shell.',
        maxStyleBytes: 12000,
        maxInlineStyleAttrs: 0,
        maxHardColors: 90
    }
};

const THEME_INLINE_DEBT_BUDGETS = {
    'art-director.html': { owner: 'art-director', maxStyleBytes: 14000, maxInlineStyleAttrs: 34, maxHardColors: 70 },
    'center.html': { owner: 'center', maxStyleBytes: 54000, maxInlineStyleAttrs: 34, maxHardColors: 290 },
    'chat.html': { owner: 'chat', maxStyleBytes: 500, maxInlineStyleAttrs: 70, maxHardColors: 10 },
    'customers.html': { owner: 'customers', maxStyleBytes: 45000, maxInlineStyleAttrs: 31, maxHardColors: 160 },
    'designer.html': { owner: 'designer', maxStyleBytes: 3000, maxInlineStyleAttrs: 36, maxHardColors: 45 },
    'designs.html': { owner: 'designs', maxStyleBytes: 61000, maxInlineStyleAttrs: 167, maxHardColors: 440 },
    'finance.html': { owner: 'finance', maxStyleBytes: 41000, maxInlineStyleAttrs: 74, maxHardColors: 190 },
    'hr.html': { owner: 'hr', maxStyleBytes: 123000, maxInlineStyleAttrs: 32, maxHardColors: 610 },
    'leads.html': { owner: 'leads', maxStyleBytes: 37000, maxInlineStyleAttrs: 8, maxHardColors: 320 },
    'omni.html': { owner: 'omnichannel', maxStyleBytes: 60000, maxInlineStyleAttrs: 19, maxHardColors: 370 },
    'profile.html': { owner: 'profile', maxStyleBytes: 148000, maxInlineStyleAttrs: 4, maxHardColors: 490 },
    'programs.html': { owner: 'programs', maxStyleBytes: 43000, maxInlineStyleAttrs: 18, maxHardColors: 200 },
    'reports.html': { owner: 'reports', maxStyleBytes: 47000, maxInlineStyleAttrs: 8, maxHardColors: 245 },
    'staff.html': { owner: 'staff', maxStyleBytes: 43500, maxInlineStyleAttrs: 36, maxHardColors: 235 },
    'tasks.html': { owner: 'tasks', maxStyleBytes: 65000, maxInlineStyleAttrs: 6, maxHardColors: 415 },
    'warehouse.html': { owner: 'warehouse', maxStyleBytes: 31500, maxInlineStyleAttrs: 72, maxHardColors: 105 }
};

const THEME_CSS_DEBT_BUDGETS = {
    'css/assistant-rail.css': { owner: 'assistant', maxImportant: 0, maxHardColors: 0 },
    'css/assistant-rail-base.css': { owner: 'assistant', maxImportant: 7, maxHardColors: 151 },
    'css/assistant-rail-command.css': { owner: 'assistant', maxImportant: 634, maxHardColors: 201 },
    'css/assistant-rail-dashboard.css': { owner: 'assistant', maxImportant: 209, maxHardColors: 65 },
    'css/assistant-rail-handoff.css': { owner: 'assistant', maxImportant: 255, maxHardColors: 150 },
    'css/assistant-rail-motion.css': { owner: 'assistant', maxImportant: 459, maxHardColors: 147 },
    'css/assistant-rail-panel.css': { owner: 'assistant', maxImportant: 302, maxHardColors: 232 },
    'css/assistant-rail-presence.css': { owner: 'assistant', maxImportant: 199, maxHardColors: 156 },
    'css/assistant-rail-timeline.css': { owner: 'assistant', maxImportant: 292, maxHardColors: 18 },
    'css/assistant-rail-topbar.css': { owner: 'assistant', maxImportant: 497, maxHardColors: 194 },
    'css/sidebar-aurora.css': { owner: 'sidebar', maxImportant: 0, maxHardColors: 0 },
    'css/sidebar-aurora-cockpit.css': { owner: 'sidebar', maxImportant: 77, maxHardColors: 8 },
    'css/sidebar-aurora-compact.css': { owner: 'sidebar', maxImportant: 318, maxHardColors: 73 },
    'css/sidebar-aurora-design-system.css': { owner: 'sidebar', maxImportant: 250, maxHardColors: 105 },
    'css/sidebar-aurora-enterprise.css': { owner: 'sidebar', maxImportant: 753, maxHardColors: 139 },
    'css/sidebar-aurora-identity.css': { owner: 'sidebar', maxImportant: 614, maxHardColors: 331 },
    'css/sidebar-aurora-legacy-shell.css': { owner: 'sidebar', maxImportant: 428, maxHardColors: 93 },
    'css/sidebar-aurora-profile.css': { owner: 'sidebar', maxImportant: 638, maxHardColors: 20 },
    'css/sidebar-aurora-rail.css': { owner: 'sidebar', maxImportant: 78, maxHardColors: 82 },
    'css/sidebar-aurora-rhythm.css': { owner: 'sidebar', maxImportant: 309, maxHardColors: 1 },
    'css/sidebar-aurora-shell.css': { owner: 'sidebar', maxImportant: 110, maxHardColors: 144 },
    'css/sidebar-aurora-today.css': { owner: 'sidebar', maxImportant: 104, maxHardColors: 27 },
    'css/dark-mode.css': { owner: 'theme', maxImportant: 276, maxHardColors: 1340 }
};

module.exports = {
    THEME_REDIRECT_PAGES,
    THEME_STANDALONE_PAGES,
    THEME_INLINE_DEBT_BUDGETS,
    THEME_CSS_DEBT_BUDGETS
};
