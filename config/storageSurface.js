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
        tests: ['tests/profile-avatar-storage.test.js'],
        remoteBucket: null,
        envBucket: null,
        reason: 'User profile photos are stored under /uploads/profile-avatars and referenced from user_profiles_ext in Postgres.'
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
        reason: 'Generated catalog images are stored under /uploads/catalog-images and saved as catalog item URLs in Postgres-backed catalogs.'
    },
    {
        urlPrefix: '/uploads/designs',
        localDir: 'uploads/designs',
        owner: 'designs',
        persistence: 'local-only-legacy',
        routeFile: 'routes/designs.js',
        serviceFile: null,
        frontendFiles: ['designs.html', 'js/designs-page.js'],
        tests: ['tests/designs.test.js'],
        remoteBucket: null,
        envBucket: null,
        reason: 'Design board assets still use local disk storage and are a migration candidate before relying on Railway redeploy persistence.'
    }
];

const REMOTE_STORAGE_SURFACE = [];

module.exports = {
    LOCAL_UPLOAD_SURFACE,
    REMOTE_STORAGE_SURFACE,
    UPLOAD_STATIC_MOUNTS
};
