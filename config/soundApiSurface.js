const SOUND_API_SURFACE = Object.freeze({
    primary: {
        mount: '/api/music',
        routeFile: 'routes/music.js',
        owner: 'music',
        compatibilityOnly: false
    },
    legacy: {
        mount: '/api/sound-library',
        routeFile: 'routes/sound-library.js',
        owner: 'sound-library',
        compatibilityOnly: true
    }
});

module.exports = { SOUND_API_SURFACE };
