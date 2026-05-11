const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

function loadAudioStorageWithSupabase(supabase) {
    const supabasePath = require.resolve('../db/supabase');
    const storagePath = require.resolve('../services/audioStorage');
    const previousSupabase = require.cache[supabasePath];

    delete require.cache[storagePath];
    require.cache[supabasePath] = {
        id: supabasePath,
        filename: supabasePath,
        loaded: true,
        exports: { getSupabase: () => supabase }
    };

    return {
        audioStorage: require('../services/audioStorage'),
        restore() {
            delete require.cache[storagePath];
            if (previousSupabase) {
                require.cache[supabasePath] = previousSupabase;
            } else {
                delete require.cache[supabasePath];
            }
        }
    };
}

describe('audioStorage Supabase metadata', () => {
    it('uploads manual audio buffers with explicit storage metadata', async () => {
        const calls = [];
        const supabase = {
            storage: {
                from(bucket) {
                    return {
                        async upload(storagePath, buffer, options) {
                            calls.push({ bucket, storagePath, buffer, options });
                            return { error: null };
                        },
                        getPublicUrl(storagePath) {
                            return { data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${storagePath}` } };
                        }
                    };
                },
                async createBucket() {
                    throw new Error('bucket should already exist');
                }
            }
        };
        const { audioStorage, restore } = loadAudioStorageWithSupabase(supabase);
        try {
            const uploaded = await audioStorage.uploadAudioBufferWithMetadata(
                Buffer.from('audio-bytes'),
                'manual-test.mp3',
                { contentType: 'audio/mpeg', folder: 'sounds/manual' }
            );

            assert.equal(uploaded.provider, 'supabase');
            assert.equal(uploaded.bucket, 'audio-library');
            assert.equal(uploaded.path, 'sounds/manual/manual-test.mp3');
            assert.equal(uploaded.publicUrl, 'https://example.supabase.co/storage/v1/object/public/audio-library/sounds/manual/manual-test.mp3');
            assert.equal(calls.length, 1);
            assert.equal(calls[0].options.contentType, 'audio/mpeg');
            assert.equal(calls[0].options.upsert, true);
        } finally {
            restore();
        }
    });

    it('returns null without Supabase so callers can keep legacy fallback behavior', async () => {
        const { audioStorage, restore } = loadAudioStorageWithSupabase(null);
        try {
            const uploaded = await audioStorage.uploadAudioBufferWithMetadata(Buffer.from('audio-bytes'), 'manual-test.mp3');
            assert.equal(uploaded, null);
        } finally {
            restore();
        }
    });

    it('deletes Supabase audio objects by storage key', async () => {
        const removed = [];
        const supabase = {
            storage: {
                from(bucket) {
                    return {
                        async remove(paths) {
                            removed.push({ bucket, paths });
                            return { error: null };
                        }
                    };
                }
            }
        };
        const { audioStorage, restore } = loadAudioStorageWithSupabase(supabase);
        try {
            const ok = await audioStorage.removeAudioObject('sounds/manual/manual-test.mp3', 'audio-library');
            assert.equal(ok, true);
            assert.deepEqual(removed, [{ bucket: 'audio-library', paths: ['sounds/manual/manual-test.mp3'] }]);
        } finally {
            restore();
        }
    });
});
