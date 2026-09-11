'use strict';

async function readSoundProjects(queryable, options = {}) {
    const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : null;
    const limitSql = limit ? ' LIMIT $1' : '';
    const projects = await queryable.query(
        `SELECT * FROM sound_projects ORDER BY created_at DESC${limitSql}`,
        limit ? [limit] : []
    );
    if (projects.rows.length === 0) return [];

    const projectIds = projects.rows.map(project => project.id);
    const tracks = await queryable.query(
        `SELECT s.*, t.project_id AS __sound_project_id
         FROM sounds s
         JOIN sound_project_tracks t ON t.sound_id = s.id
         WHERE t.project_id = ANY($1::int[])
         ORDER BY t.project_id, t.sort_order`,
        [projectIds]
    );
    const tracksByProjectId = new Map(projectIds.map(projectId => [String(projectId), []]));
    for (const row of tracks.rows) {
        const { __sound_project_id: projectId, ...sound } = row;
        const projectTracks = tracksByProjectId.get(String(projectId));
        if (projectTracks) projectTracks.push(sound);
    }

    return projects.rows.map(project => ({
        ...project,
        tracks: tracksByProjectId.get(String(project.id)) || []
    }));
}

module.exports = { readSoundProjects };
