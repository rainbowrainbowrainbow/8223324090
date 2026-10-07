'use strict';

// Only explicit education metadata may receive the server-validated teacher.
function applyEducationSeriesTeacher(candidates, canonicalLesson, readLesson, writeLesson) {
    if (canonicalLesson?.mode !== 'education_lesson') return;
    for (const candidate of candidates) {
        const lesson = readLesson(candidate);
        if (lesson?.mode !== 'education_lesson') continue;
        writeLesson(candidate, { ...lesson, teacherId: canonicalLesson.teacherId, teacherName: canonicalLesson.teacherName });
    }
}

module.exports = { applyEducationSeriesTeacher };
