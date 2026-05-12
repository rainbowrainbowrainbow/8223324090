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
        persistence: 'supabase-preferred-local-fallback',
        routeFile: 'routes/chat.js',
        serviceFile: 'services/chatUploadStorage.js',
        frontendFiles: ['js/chat-page.js'],
        tests: ['tests/chat-upload-storage.test.js', 'tests/chat-upload-route.test.js'],
        remoteBucket: 'chat-uploads',
        envBucket: 'SUPABASE_CHAT_BUCKET',
        reason: 'Chat attachments prefer Supabase Storage; local files are only a legacy fallback when Supabase is unavailable.'
    },
    {
        urlPrefix: '/uploads/sounds',
        localDir: 'uploads/sounds',
        owner: 'sound',
        persistence: 'supabase-preferred-local-fallback',
        routeFile: 'routes/music.js',
        serviceFile: 'services/audioStorage.js',
        frontendFiles: ['js/sound-page.js'],
        tests: ['tests/audio-storage.test.js'],
        remoteBucket: 'audio-library',
        envBucket: 'SUPABASE_AUDIO_BUCKET',
        reason: 'Manual and generated sounds prefer Supabase Storage; local files are retained as a rollout fallback.'
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

const REMOTE_STORAGE_SURFACE = [
    {
        bucket: 'chat-uploads',
        envBucket: 'SUPABASE_CHAT_BUCKET',
        owner: 'chat',
        provider: 'supabase-storage',
        serviceFile: 'services/chatUploadStorage.js',
        routeFiles: ['routes/chat.js'],
        tests: ['tests/chat-upload-storage.test.js', 'tests/chat-upload-route.test.js'],
        localFallback: '/uploads/chat',
        reason: 'Durable chat upload objects with provider, bucket, key, and public URL metadata on messages.'
    },
    {
        bucket: 'audio-library',
        envBucket: 'SUPABASE_AUDIO_BUCKET',
        owner: 'sound',
        provider: 'supabase-storage',
        serviceFile: 'services/audioStorage.js',
        routeFiles: ['routes/music.js'],
        tests: ['tests/audio-storage.test.js'],
        localFallback: '/uploads/sounds',
        reason: 'Durable sound library audio for manual uploads and generated audio.'
    },
    {
        bucket: 'catalog-images',
        envBucket: null,
        owner: 'catalogs',
        provider: 'supabase-storage',
        serviceFile: 'services/imageStorage.js',
        routeFiles: ['routes/catalogs.js'],
        tests: ['tests/image-storage.test.js'],
        localFallback: null,
        reason: 'Permanent catalog image storage for generated item and cover images.'
    }
];

const SUPABASE_CLIENT_SURFACE = {
    file: 'db/supabase.js',
    env: ['SUPABASE_URL', 'SUPABASE_KEY', 'SUPABASE_SECRET_KEY'],
    owner: 'supabase-client',
    reason: 'Shared server-side Supabase client used by storage services and legacy customer fallback code.'
};

module.exports = {
    LOCAL_UPLOAD_SURFACE,
    REMOTE_STORAGE_SURFACE,
    SUPABASE_CLIENT_SURFACE,
    UPLOAD_STATIC_MOUNTS
};
