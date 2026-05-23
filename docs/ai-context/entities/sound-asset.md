# Entity: Sound Asset

## Meaning

A Sound Asset is an audio/project/announcement item used by the Sound module.

## Fields / Properties

Source evidence: `routes/sound-library.js`, `services/audioStorage.js`.

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
