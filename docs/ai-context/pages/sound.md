# Page: Sound

## Route / Location

- Route: `/sound`
- Hash surfaces: `#projects`, `#library`, `#announcements`
- Static file: `sound.html`
- Page controller: `js/sound-page.js`
- Primary backend route: `routes/music.js` mounted at `/api/music`
- Legacy compatibility route: `routes/sound-library.js` mounted at `/api/sound-library`
- Related navigation items: Product group -> `Звук`, `Бібліотека звуку`, `Оголошення`

## Purpose

Sound is the sound production/library workspace for sound projects, uploaded audio, announcements, and related metadata/storage.

## Primary Entities

- Sound asset
- Sound project
- Announcement
- Audio storage metadata

## Visible UI

- Project/library/announcement views.
- Upload/manage audio controls.

## Available User Actions

- View/manage sound assets and projects.
- Work with announcements.
- Upload or organize sound files where allowed.

## Data Sources

- `routes/music.js`
- `routes/sound-library.js` (legacy compatibility CRUD)
- `services/audioStorage.js`
- `services/music-delivery.js`
- `db/migrations/114_sound_upgrade.sql`
- `db/migrations/117_sound_module.sql`
- `db/migrations/162_sounds_storage_metadata.sql`

## Related Files

- `sound.html`
- `js/sound-page.js`
- `routes/music.js`
- `routes/sound-library.js` (legacy compatibility CRUD)

## Assistant Context

On Sound, interpret questions by active hash: projects, library, or announcements. Prefer `/api/music` behavior for generated TTS/music, uploads, projects, announcements, and storage metadata. Treat `/api/sound-library` as legacy compatibility unless the user explicitly asks about that old route.
