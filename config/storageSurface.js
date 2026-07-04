const UPLOAD_STATIC_MOUNTS = [
    {
        path: '/uploads',
        localDir: 'uploads',
        owner: 'server',
        reason: 'Public static exposure for explicitly documented legacy and fallback upload files.'
    }
];

const LOCAL_UPLOAD_SURFACE = [
    {
        urlPrefix: '/uploads/chat',
        localDir: 'uploads/chat',
        owner: 'chat',
        persistence: 'local-postgres-metadata',
        routeFile: 'routes/chat.js',
        serviceFile: 'services/chatUploadStorage.js',
        frontendFiles: ['js/chat-page.js'],
        tests: ['tests/chat-upload-storage.test.js', 'tests/chat-upload-route.test.js'],
        remoteBucket: null,
        envBucket: null,
        fallbackPolicy: {
            type: 'local-filesystem-primary',
            durableSource: 'chat_messages metadata',
            reviewBeforeDelete: true
        },
        reason: 'Chat attachments are stored under /uploads/chat with file metadata persisted on chat messages in Postgres.'
    },
    {
        urlPrefix: '/uploads/sounds',
        localDir: 'uploads/sounds',
        owner: 'sound',
        persistence: 'local-postgres-metadata',
        routeFile: 'routes/music.js',
        serviceFile: 'services/audioStorage.js',
        frontendFiles: ['js/sound-page.js'],
        tests: ['tests/audio-storage.test.js'],
        remoteBucket: null,
        envBucket: null,
        fallbackPolicy: {
            type: 'local-filesystem-primary',
            durableSource: 'sounds metadata',
            reviewBeforeDelete: true
        },
        reason: 'Manual and generated sounds are stored under /uploads/sounds with metadata persisted in the Postgres sounds table.'
    },
    {
        urlPrefix: '/uploads/profile-avatars',
        localDir: 'uploads/profile-avatars',
        owner: 'profile',
        persistence: 'local-postgres-metadata',
        routeFile: 'routes/auth.js',
        serviceFile: 'services/profileAvatarStorage.js',
        frontendFiles: ['profile.html', 'js/profile-page.js'],
        tests: ['tests/profile-avatar-storage.test.js', 'tests/route-smoke.test.js'],
        remoteBucket: null,
        envBucket: null,
        fallbackPolicy: {
            type: 'postgres-blob-primary-local-legacy',
            durableSource: 'profile_avatar_blobs',
            reviewBeforeDelete: true
        },
        reason: 'New profile avatar uploads write binary content to Postgres profile_avatar_blobs while /uploads/profile-avatars remains the public URL and legacy local fallback.'
    },
    {
        urlPrefix: '/uploads/catalog-images',
        localDir: 'uploads/catalog-images',
        owner: 'catalogs',
        persistence: 'local-postgres-metadata',
        routeFile: 'routes/catalogs.js',
        serviceFile: 'services/imageStorage.js',
        frontendFiles: ['js/art-director-page.js'],
        tests: ['tests/image-storage.test.js'],
        remoteBucket: null,
        envBucket: null,
        fallbackPolicy: {
            type: 'postgres-blob-primary-local-legacy',
            durableSource: 'catalog_image_blobs',
            reviewBeforeDelete: true
        },
        reason: 'New generated catalog images write binary content to Postgres catalog_image_blobs while /uploads/catalog-images remains the public URL and legacy local fallback.'
    },
    {
        urlPrefix: '/uploads/designs',
        localDir: 'uploads/designs',
        owner: 'designs',
        persistence: 'local-postgres-metadata',
        routeFile: 'routes/designs.js',
        serviceFile: 'services/designStorage.js',
        frontendFiles: ['designs.html', 'js/designs-page.js'],
        tests: ['tests/designs.test.js', 'tests/design-storage.test.js'],
        remoteBucket: null,
        envBucket: null,
        fallbackPolicy: {
            type: 'postgres-blob-primary-local-legacy',
            durableSource: 'design_file_blobs',
            reviewBeforeDelete: true
        },
        reason: 'Design board assets are stored in Postgres design_file_blobs; /uploads/designs remains a legacy public preview path and local disk fallback.'
    }
];

const REMOTE_STORAGE_SURFACE = [];

module.exports = {
    LOCAL_UPLOAD_SURFACE,
    REMOTE_STORAGE_SURFACE,
    UPLOAD_STATIC_MOUNTS
};
