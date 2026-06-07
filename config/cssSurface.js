const CSS_SURFACE_DOC = 'docs/CSS_SURFACE.md';

const CSS_APP_SHELL_PRECACHE = [
    'css/base.css',
    'css/auth.css',
    'css/layout.css',
    'css/sidebar-aurora.css',
    'css/sidebar-aurora-shell.css',
    'css/sidebar-aurora-cockpit.css',
    'css/sidebar-aurora-design-system.css',
    'css/sidebar-aurora-today.css',
    'css/sidebar-aurora-legacy-shell.css',
    'css/sidebar-aurora-compact.css',
    'css/sidebar-aurora-identity.css',
    'css/sidebar-aurora-enterprise.css',
    'css/sidebar-aurora-rail.css',
    'css/sidebar-aurora-rhythm.css',
    'css/sidebar-aurora-profile.css',
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
        reason: 'Aggregate entrypoint for shared CRM assistant rail styles.'
    },
    {
        file: 'css/assistant-rail-base.css',
        owner: 'shared-crm-assistant',
        category: 'shared',
        status: 'active',
        reason: 'Base shared CRM assistant rail, state tokens, ticker, panel, voice controls, and responsive shell styles imported by assistant-rail.css.'
    },
    {
        file: 'css/assistant-rail-command.css',
        owner: 'shared-crm-assistant',
        category: 'shared-large',
        status: 'active-large',
        reason: 'Assistant cockpit, command bar, avatar button, and stable global docking styles imported by assistant-rail.css.'
    },
    {
        file: 'css/assistant-rail-dashboard.css',
        owner: 'shared-crm-assistant',
        category: 'shared',
        status: 'active',
        reason: 'Dashboard-scoped assistant shell repair styles imported by assistant-rail.css.'
    },
    {
        file: 'css/assistant-rail-handoff.css',
        owner: 'shared-crm-assistant',
        category: 'shared-large',
        status: 'active-large',
        reason: 'Legacy Claude Design handoff layers for assistant topbar and embedded panel parity imported by assistant-rail.css.'
    },
    {
        file: 'css/assistant-rail-motion.css',
        owner: 'shared-crm-assistant',
        category: 'shared-large',
        status: 'active-large',
        reason: 'Assistant motion spectrum, expandable stage, product topbar, and geometry guard styles imported by assistant-rail.css.'
    },
    {
        file: 'css/assistant-rail-panel.css',
        owner: 'shared-crm-assistant',
        category: 'shared-large',
        status: 'active-large',
        reason: 'Expanded assistant panel, action cards, teaching runner, voice comfort, and CRM chat bridge styles imported by assistant-rail.css.'
    },
    {
        file: 'css/assistant-rail-presence.css',
        owner: 'shared-crm-assistant',
        category: 'shared-large',
        status: 'active-large',
        reason: 'Assistant presence constellation, compact top assistant, avatar guard, and light window contrast styles imported by assistant-rail.css.'
    },
    {
        file: 'css/assistant-rail-timeline.css',
        owner: 'shared-crm-assistant',
        category: 'shared',
        status: 'active',
        reason: 'Timeline-specific assistant parity and dark composer contrast styles imported by assistant-rail.css.'
    },
    {
        file: 'css/assistant-rail-topbar.css',
        owner: 'shared-crm-assistant',
        category: 'shared-large',
        status: 'active-large',
        reason: 'Assistant top menu docking, readable animated output, full rethink, and mini-window styles imported by assistant-rail.css.'
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
        category: 'page-scoped',
        status: 'active',
        reason: 'Aggregate entrypoint for Team messenger styles.'
    },
    {
        file: 'css/chat-core.css',
        owner: 'chat',
        category: 'page-scoped-large',
        status: 'active-large',
        reason: 'Core Team messenger layout, sidebar, messages, panels, modals, and input styles imported by chat.css.'
    },
    {
        file: 'css/chat-effects.css',
        owner: 'chat',
        category: 'page-scoped-large',
        status: 'active-large',
        reason: 'Chat emoji, reaction, voice, pinned, avatar, and dino effect styles imported by chat.css.'
    },
    {
        file: 'css/chat-guardian.css',
        owner: 'chat',
        category: 'page-scoped',
        status: 'active',
        reason: 'Guardian bot, security panel, analytics, commands, and moderation styles imported by chat.css.'
    },
    {
        file: 'css/chat-modern.css',
        owner: 'chat',
        category: 'page-scoped',
        status: 'active',
        reason: 'Messenger improvement, sound settings, channel management, animated wallpaper, and supplemental chat styles imported by chat.css.'
    },
    {
        file: 'css/chat-omni.css',
        owner: 'chat',
        category: 'page-scoped',
        status: 'active',
        reason: 'Omni workspace rebuild and omnichannel health/account mode styles imported by chat.css.'
    },
    {
        file: 'css/chat-polish.css',
        owner: 'chat',
        category: 'page-scoped',
        status: 'active',
        reason: 'Chat dashboard-surface polish and adjacent override layer imported by chat.css.'
    },
    {
        file: 'css/chat-settings.css',
        owner: 'chat',
        category: 'page-scoped',
        status: 'active',
        reason: 'Chat settings control-plane and AI provider configuration styles imported by chat.css.'
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
        file: 'css/hr-page.css',
        owner: 'hr',
        category: 'page-scoped-large',
        status: 'active-large',
        reason: 'HR workspace styles extracted from hr.html; large-file consolidation candidate.'
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
        reason: 'Sidebar Aurora aggregate entrypoint for shared CRM menu styles.'
    },
    {
        file: 'css/sidebar-aurora-shell.css',
        owner: 'shared-ui',
        category: 'shared-large',
        status: 'active-large',
        reason: 'Sidebar base shell, brand, quick counters, groups, and mobile rail styles imported by sidebar-aurora.css.'
    },
    {
        file: 'css/sidebar-aurora-cockpit.css',
        owner: 'shared-ui',
        category: 'shared',
        status: 'active',
        reason: 'Sidebar AI cockpit, focus deck, navigation group, and mobile base override styles imported by sidebar-aurora.css.'
    },
    {
        file: 'css/sidebar-aurora-design-system.css',
        owner: 'shared-ui',
        category: 'shared-large',
        status: 'active-large',
        reason: 'Sidebar Claude-design system layer, brand shell, design extras, and navigation restyle imported by sidebar-aurora.css.'
    },
    {
        file: 'css/sidebar-aurora-today.css',
        owner: 'shared-ui',
        category: 'shared',
        status: 'active',
        reason: 'Sidebar today dock, quick day menu, extra badges, and related responsive rules imported by sidebar-aurora.css.'
    },
    {
        file: 'css/sidebar-aurora-legacy-shell.css',
        owner: 'shared-ui',
        category: 'shared-large',
        status: 'active-large',
        reason: 'Legacy sidebar shell geometry, logo restoration, collapsed rail, profile typography, and Additional editor styles imported by sidebar-aurora.css.'
    },
    {
        file: 'css/sidebar-aurora-compact.css',
        owner: 'shared-ui',
        category: 'shared-large',
        status: 'active-large',
        reason: 'Compact sidebar density, laptop width, light theme, alert carousel, and collapse button styles imported by sidebar-aurora.css.'
    },
    {
        file: 'css/sidebar-aurora-identity.css',
        owner: 'shared-ui',
        category: 'shared-large',
        status: 'active-large',
        reason: 'Sidebar identity card, status rail, quick access submenu, and profile signal styles imported by sidebar-aurora.css.'
    },
    {
        file: 'css/sidebar-aurora-enterprise.css',
        owner: 'shared-ui',
        category: 'shared-large',
        status: 'active-large',
        reason: 'Enterprise sidebar redesign, passive time widgets, refreshed theme, and role identity styles imported by sidebar-aurora.css.'
    },
    {
        file: 'css/sidebar-aurora-rail.css',
        owner: 'shared-ui',
        category: 'shared',
        status: 'active',
        reason: 'Collapsed sidebar utility rail, contextual flyout, and compact business controls imported by sidebar-aurora.css.'
    },
    {
        file: 'css/sidebar-aurora-rhythm.css',
        owner: 'shared-ui',
        category: 'shared',
        status: 'active',
        reason: 'Sidebar rhythm, spacing, visual density, and nav readability polish imported by sidebar-aurora.css.'
    },
    {
        file: 'css/sidebar-aurora-profile.css',
        owner: 'shared-ui',
        category: 'shared-large',
        status: 'active-large',
        reason: 'Sidebar profile readability, mobile entry reliability, identity meta, and business selector polish imported by sidebar-aurora.css.'
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
        file: 'css/training.css',
        owner: 'training',
        category: 'page-scoped',
        status: 'active',
        reason: 'Training workspace styles for materials, tests, progress, leaderboard, and onboarding.'
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
