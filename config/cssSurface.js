const CSS_SURFACE_DOC = 'docs/CSS_SURFACE.md';

const CSS_APP_SHELL_PRECACHE = [
    'css/base.css',
    'css/auth.css',
    'css/layout.css',
    'css/sidebar-aurora.css',
    'css/timeline.css',
    'css/panel.css',
    'css/modals.css',
    'css/controls.css',
    'css/features.css',
    'css/dark-mode.css',
    'css/responsive.css'
];

const CSS_SURFACE = [
    {
        file: 'css/achievements.css',
        owner: 'shop',
        category: 'page-scoped',
        status: 'active',
        reason: 'Gamification achievements and shop presentation styles.'
    },
    {
        file: 'css/agents.css',
        owner: 'chat',
        category: 'page-scoped',
        status: 'active',
        reason: 'Chat assistant and agent panel styles.'
    },
    {
        file: 'css/auth.css',
        owner: 'shared-auth',
        category: 'shared',
        status: 'active',
        reason: 'Login and authentication shell styles used by root, dashboard, and sound pages.'
    },
    {
        file: 'css/assistant-rail.css',
        owner: 'shared-crm-assistant',
        category: 'shared',
        status: 'active',
        reason: 'Shared global CRM assistant rail, proactive help panel, voice controls, and dark/mobile states.'
    },
    {
        file: 'css/base.css',
        owner: 'shared-ui',
        category: 'shared',
        status: 'active',
        reason: 'Global variables, reset, typography, and shared primitives.'
    },
    {
        file: 'css/catalog.css',
        owner: 'catalogs',
        category: 'feature-shared',
        status: 'active',
        reason: 'Catalog viewer and print/public catalog styles used by designs and catalog routes.'
    },
    {
        file: 'css/chat.css',
        owner: 'chat',
        category: 'page-scoped-large',
        status: 'active-large',
        reason: 'Main chat page styles; large-file consolidation candidate.'
    },
    {
        file: 'css/content.css',
        owner: 'content',
        category: 'page-scoped',
        status: 'active',
        reason: 'Content matrix page styles.'
    },
    {
        file: 'css/controls.css',
        owner: 'shared-ui',
        category: 'shared',
        status: 'active',
        reason: 'Shared form controls, buttons, and toolbar patterns.'
    },
    {
        file: 'css/copilot.css',
        owner: 'copilot',
        category: 'page-scoped',
        status: 'active',
        reason: 'Sales/copilot workspace styles.'
    },
    {
        file: 'css/dark-mode.css',
        owner: 'shared-ui',
        category: 'shared-large',
        status: 'active-large',
        reason: 'Shared dark-mode overrides across authenticated CRM pages.'
    },
    {
        file: 'css/dashboard.css',
        owner: 'dashboard',
        category: 'page-scoped',
        status: 'active',
        reason: 'Dashboard widget and onboarding styles.'
    },
    {
        file: 'css/entity-card.css',
        owner: 'leads-customers',
        category: 'feature-shared',
        status: 'active',
        reason: 'Shared lead/customer entity workspace card shell and safe visual contract.'
    },
    {
        file: 'css/decision-screen.css',
        owner: 'dashboard',
        category: 'feature-shared',
        status: 'active',
        reason: 'Decision overlay styles mounted from the dashboard page.'
    },
    {
        file: 'css/designs.css',
        owner: 'designs',
        category: 'page-scoped',
        status: 'active',
        reason: 'Design catalog workspace styles.'
    },
    {
        file: 'css/features.css',
        owner: 'timeline',
        category: 'shell-large',
        status: 'active-large',
        reason: 'Root shell feature and modal adjunct styles; large-file consolidation candidate.'
    },
    {
        file: 'css/graduation.css',
        owner: 'graduation',
        category: 'page-scoped-large',
        status: 'active-large',
        reason: 'Graduation event builder and embedded view styles.'
    },
    {
        file: 'css/kleshnya-widget.css',
        owner: 'kleshnya',
        category: 'feature-shared',
        status: 'active',
        reason: 'Root shell Kleshnya widget styles.'
    },
    {
        file: 'css/layout.css',
        owner: 'shared-ui',
        category: 'shared-large',
        status: 'active-large',
        reason: 'Shared layout, sidebar, and content frame styles.'
    },
    {
        file: 'css/sidebar-aurora.css',
        owner: 'shared-ui',
        category: 'shared',
        status: 'active',
        reason: 'Sidebar Aurora visual layer and dual-theme micro-interactions for the shared CRM menu.'
    },
    {
        file: 'css/sidebar-smart-menu.css',
        owner: 'shared-ui',
        category: 'shared',
        status: 'active',
        reason: 'Optional smart sidebar menu customizer styles for compact dashboard shortcuts.'
    },
    {
        file: 'css/minigame.css',
        owner: 'game',
        category: 'page-scoped-large',
        status: 'active-large',
        reason: 'Gamification game styles; large-file consolidation candidate.'
    },
    {
        file: 'css/modals.css',
        owner: 'shared-ui',
        category: 'shared-large',
        status: 'active-large',
        reason: 'Shared modal and profile modal styles across CRM pages.'
    },
    {
        file: 'css/pages.css',
        owner: 'shared-ui',
        category: 'shared',
        status: 'active',
        reason: 'Shared page-level layout helpers for static CRM pages.'
    },
    {
        file: 'css/panel.css',
        owner: 'timeline',
        category: 'shell',
        status: 'active',
        reason: 'Root shell side panel styles.'
    },
    {
        file: 'css/responsive.css',
        owner: 'shared-ui',
        category: 'shared',
        status: 'active',
        reason: 'Shared responsive overrides across authenticated CRM pages.'
    },
    {
        file: 'css/sound.css',
        owner: 'sound',
        category: 'page-scoped',
        status: 'active',
        reason: 'Sound library page styles.'
    },
    {
        file: 'css/timeline.css',
        owner: 'timeline',
        category: 'shell',
        status: 'active',
        reason: 'Root booking timeline styles.'
    },
    {
        file: 'landing/style.css',
        owner: 'landing',
        category: 'landing-scoped-large',
        status: 'active-large',
        reason: 'Public landing site styles outside the authenticated CRM CSS directory.'
    }
];

module.exports = {
    CSS_APP_SHELL_PRECACHE,
    CSS_SURFACE,
    CSS_SURFACE_DOC
};
