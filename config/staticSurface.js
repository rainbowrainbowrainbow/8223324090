const ROOT_HTML_SURFACE = [
    {
        file: 'analytics.html',
        canonicalPath: '/analytics',
        owner: 'analytics',
        status: 'canonical-page',
        aliases: ['/analytics'],
        purpose: 'Operational analytics dashboard.'
    },
    {
        file: 'afisha.html',
        canonicalPath: '/afisha',
        owner: 'afisha',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Standalone product page for Afisha events, import/export, recurring templates, and task generation.'
    },
    {
        file: 'booking-summary.html',
        canonicalPath: '/booking-summary.html',
        owner: 'bookings',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Printable banquet summary preview for booking details.'
    },
    {
        file: 'art-director.html',
        canonicalPath: '/art',
        owner: 'art-director',
        status: 'canonical-page',
        aliases: ['/art-director', '/art-director.html'],
        purpose: 'Art director workspace. Legacy art-director URLs redirect to /art.'
    },
    {
        file: 'center.html',
        canonicalPath: '/center',
        owner: 'center',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Entertainment center operations page.'
    },
    {
        file: 'certificates.html',
        canonicalPath: '/certificates',
        owner: 'certificates',
        status: 'canonical-page',
        aliases: ['/certificates/new', '/certificates/batch'],
        purpose: 'Certificate registry plus standalone single and batch creation flows.'
    },
    {
        file: 'chat.html',
        canonicalPath: '/chat',
        owner: 'chat',
        status: 'canonical-page',
        aliases: ['/kleshnya'],
        purpose: 'Team messenger and assistant surface. /kleshnya redirects here.'
    },
    {
        file: 'chat-settings.html',
        canonicalPath: '/chat-settings',
        owner: 'chat',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Dedicated Chat AI, Guardian, and integrations settings page.'
    },
    {
        file: 'timeline-settings.html',
        canonicalPath: '/timeline-settings',
        owner: 'timeline',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Dedicated timeline settings center for visibility, visual presets, and display modes.'
    },
    {
        file: 'checkin.html',
        canonicalPath: '/checkin',
        owner: 'checkin',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Staff check-in page.'
    },
    {
        file: 'content.html',
        canonicalPath: '/content',
        owner: 'content',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Content matrix page.'
    },
    {
        file: 'copilot.html',
        canonicalPath: '/copilot',
        owner: 'copilot',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Sales/copilot workspace.'
    },
    {
        file: 'customers.html',
        canonicalPath: '/customers',
        owner: 'customers',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Customer CRM page.'
    },
    {
        file: 'dashboard.html',
        canonicalPath: '/dashboard',
        owner: 'dashboard',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Authenticated dashboard page.'
    },
    {
        file: 'demo.html',
        canonicalPath: '/demo',
        owner: 'demo',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Demo mode page.'
    },
    {
        file: 'designer.html',
        canonicalPath: '/designer',
        owner: 'designer',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Designer production workspace.'
    },
    {
        file: 'designs.html',
        canonicalPath: '/designs',
        owner: 'designs',
        status: 'canonical-page',
        aliases: ['/embed/designs'],
        purpose: 'Design catalog workspace and embedded art-director view.'
    },
    {
        file: 'hermes-studio.html',
        canonicalPath: '/hermes-studio',
        owner: 'hermes-studio',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Hermes Studio creative material job queue, brief intake, asset review, and human decisions.'
    },
    {
        file: 'finance.html',
        canonicalPath: '/finance',
        owner: 'finance',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Finance operations page.'
    },
    {
        file: 'cashier-payments.html',
        canonicalPath: '/cashier-payments',
        owner: 'payments',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Scoped Checkbox park pilot cashier UI for cash and manual card-terminal payment confirmation.'
    },
    {
        file: 'accounting-deposits.html',
        canonicalPath: '/accounting-deposits',
        owner: 'finance',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Accounting review page for banquet booking deposits.'
    },
    {
        file: 'game.html',
        canonicalPath: '/game',
        owner: 'game',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Gamification game page.'
    },
    {
        file: 'graduation.html',
        canonicalPath: '/graduation',
        owner: 'graduation',
        status: 'canonical-page',
        aliases: ['/embed/graduation'],
        purpose: 'Graduation event builder and embedded art-director view.'
    },
    {
        file: 'guardian-ops.html',
        canonicalPath: '/guardian-ops',
        owner: 'guardian',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Guardian operations console.'
    },
    {
        file: 'hr.html',
        canonicalPath: '/hr',
        owner: 'hr',
        status: 'canonical-page',
        aliases: [],
        purpose: 'HR operations page.'
    },
    {
        file: 'index.html',
        canonicalPath: '/',
        owner: 'timeline',
        status: 'root-shell',
        aliases: ['/maysternya-doli', '*'],
        purpose: 'Main CRM shell, root static entry, and final non-API fallback.'
    },
    {
        file: 'invite.html',
        canonicalPath: '/invite',
        owner: 'invite',
        status: 'public-page',
        aliases: [],
        purpose: 'Invite/onboarding page.'
    },
    {
        file: 'leads.html',
        canonicalPath: '/sales-funnel',
        owner: 'leads',
        status: 'canonical-page',
        aliases: ['/leads'],
        purpose: 'Sales funnel page. /leads redirects to /sales-funnel.'
    },
    {
        file: 'omni.html',
        canonicalPath: '/omni',
        owner: 'omnichannel',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Omnichannel inbox page.'
    },
    {
        file: 'profile.html',
        canonicalPath: '/profile',
        owner: 'profile',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Gamification profile page.'
    },
    {
        file: 'programs.html',
        canonicalPath: '/programs',
        owner: 'programs',
        status: 'canonical-page',
        aliases: ['/embed/programs'],
        purpose: 'Programs catalog page and embedded art-director view.'
    },
    {
        file: 'quiz.html',
        canonicalPath: '/quiz',
        owner: 'quiz',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Quiz page.'
    },
    {
        file: 'report-agent.html',
        canonicalPath: '/report-agent',
        owner: 'reports',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Report agent page.'
    },
    {
        file: 'reports.html',
        canonicalPath: '/reports',
        owner: 'reports',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Reports page.'
    },
    {
        file: 'room.html',
        canonicalPath: '/room',
        owner: 'room',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Room page.'
    },
    {
        file: 'shop.html',
        canonicalPath: '/shop',
        owner: 'shop',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Gamification shop page.'
    },
    {
        file: 'sound.html',
        canonicalPath: '/sound',
        owner: 'sound',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Sound library page.'
    },
    {
        file: 'staff.html',
        canonicalPath: '/staff',
        owner: 'staff',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Staff operations page.'
    },
    {
        file: 'status.html',
        canonicalPath: '/status',
        owner: 'status',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Status page.'
    },
    {
        file: 'tasks.html',
        canonicalPath: '/tasks',
        owner: 'tasks',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Task management page.'
    },
    {
        file: 'training.html',
        canonicalPath: '/training',
        owner: 'training',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Training page.'
    },
    {
        file: 'warehouse.html',
        canonicalPath: '/warehouse',
        owner: 'warehouse',
        status: 'canonical-page',
        aliases: [],
        purpose: 'Warehouse operations page.'
    }
];

const LANDING_SURFACE = [
    {
        file: 'landing/index.html',
        canonicalPath: '/landing',
        owner: 'landing',
        status: 'public-page',
        aliases: [],
        purpose: 'Public landing page.'
    },
    {
        file: 'landing/manager-guide.html',
        canonicalPath: '/landing/manager-guide.html',
        owner: 'landing',
        status: 'public-page',
        aliases: ['/manager-guide', '/manager-guide.html'],
        purpose: 'Public manager guide. Legacy root URLs redirect here.'
    },
    {
        file: 'landing/sales-deck.html',
        canonicalPath: '/landing/sales-deck.html',
        owner: 'landing',
        status: 'public-page',
        aliases: ['/sales-deck', '/sales-deck.html', '/landing/sales-deck'],
        purpose: 'Public sales deck. Legacy root URLs redirect here.'
    }
];

const LEGACY_STATIC_REDIRECTS = [
    { path: '/art-director', target: '/art', owner: 'art-director' },
    { path: '/art-director.html', target: '/art', owner: 'art-director' },
    { path: '/leads', target: '/sales-funnel', owner: 'leads' },
    { path: '/kleshnya', target: '/chat', owner: 'chat' },
    { path: '/manager-guide', target: '/landing/manager-guide.html', owner: 'landing' },
    { path: '/manager-guide.html', target: '/landing/manager-guide.html', owner: 'landing' },
    { path: '/sales-deck', target: '/landing/sales-deck.html', owner: 'landing' },
    { path: '/sales-deck.html', target: '/landing/sales-deck.html', owner: 'landing' }
];

const STATIC_PAGE_EXPOSURE = {
    publicRootFiles: ['invite.html'],
    rootShellFiles: ['index.html'],
    publicLandingFiles: ['landing/index.html', 'landing/manager-guide.html', 'landing/sales-deck.html'],
    embeddedAliases: ['/embed/designs', '/embed/programs', '/embed/graduation'],
    authenticatedRootPolicy: 'All other root HTML pages must be owned by PAGE_ACCESS or an explicit documented exception.'
};

module.exports = {
    ROOT_HTML_SURFACE,
    LANDING_SURFACE,
    LEGACY_STATIC_REDIRECTS,
    STATIC_PAGE_EXPOSURE
};
