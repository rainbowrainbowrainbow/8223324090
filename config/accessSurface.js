const PUBLIC_STATIC_PAGE_EXCEPTIONS = [
    {
        path: '/invite',
        owner: 'invite',
        reason: 'Invite/onboarding entrypoint must be reachable before a signed-in CRM session.'
    }
];

const EMBEDDED_STATIC_PAGE_EXCEPTIONS = [
    {
        path: '/embed/designs',
        parentPath: '/designs',
        owner: 'designs',
        reason: 'Embedded art-director view served from designs.html; not a standalone sidebar/page-access route.'
    },
    {
        path: '/embed/programs',
        parentPath: '/programs',
        owner: 'programs',
        reason: 'Embedded art-director view served from programs.html; not a standalone sidebar/page-access route.'
    },
    {
        path: '/embed/graduation',
        parentPath: '/graduation',
        owner: 'graduation',
        reason: 'Embedded art-director view served from graduation.html; not a standalone sidebar/page-access route.'
    }
];

const MODAL_PAGE_ACCESS_SURFACES = [
    {
        path: '/settings',
        sidebarHref: '#settings',
        redirectTarget: null,
        owner: 'settings-modal',
        reason: 'Hash-modal surface in index.html; no standalone root HTML file.'
    }
];

const SIDEBAR_PAGE_ROLE_EXCEPTIONS = [
    {
        path: '/',
        owner: 'timeline',
        reason: 'Timeline page access allows all staff except waiter, but the sidebar exposes the link to operations roles only.'
    }
];

const ACCESS_SURFACE_DOC = 'docs/ACCESS_SURFACE.md';

module.exports = {
    PUBLIC_STATIC_PAGE_EXCEPTIONS,
    EMBEDDED_STATIC_PAGE_EXCEPTIONS,
    MODAL_PAGE_ACCESS_SURFACES,
    SIDEBAR_PAGE_ROLE_EXCEPTIONS,
    ACCESS_SURFACE_DOC
};
