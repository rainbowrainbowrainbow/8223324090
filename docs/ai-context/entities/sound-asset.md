# Entity: Sound Asset

## Meaning

A Sound Asset is an audio/project/announcement item used by the Sound module.

## Fields / Properties

Source evidence: primary Sound API `routes/music.js`, legacy compatibility CRUD `routes/sound-library.js`, and `services/audioStorage.js`.

- id
- title/name
- file/storage metadata
- project/library/announcement type
- status/tags where supported

## Related Entities

- May belong to Sound Project.
- May be used for announcements/music delivery.

## Where It Appears

- Sound page.

## Assistant Interpretation

Use active Sound hash/context to know whether the user means project, library asset, or announcement.
For new behavior, prefer `/api/music` because it owns uploads, generated TTS/music, storage metadata, announcements, projects, and music delivery.
