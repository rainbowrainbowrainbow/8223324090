# Page: Sound

## Route / Location

- Route: `/sound`
- Hash surfaces: `#projects`, `#library`, `#announcements`
- Static file: `sound.html`
- Page controller: `js/sound-page.js`
- Backend route: `routes/sound-library.js`
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

- `routes/sound-library.js`
- `services/audioStorage.js`
- `services/music-delivery.js`
- `db/migrations/114_sound_upgrade.sql`
- `db/migrations/117_sound_module.sql`
- `db/migrations/162_sounds_storage_metadata.sql`

## Related Files

- `sound.html`
- `js/sound-page.js`
- `routes/sound-library.js`

## Assistant Context

On Sound, interpret questions by active hash: projects, library, or announcements.
