'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'js/components/sidebar.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'js/education-schedule.js'), 'utf8');

function createWorkspace() {
    const elements = {
        educationScheduleTeacherFilter: { value: '', addEventListener() {} },
        educationScheduleCabinetFilter: { value: '', addEventListener() {} },
        educationScheduleGroupFilter: { value: '', addEventListener() {} }
    };
    const document = {
        readyState: 'complete',
        addEventListener() {},
        getElementById(id) { return elements[id] || null; },
        querySelectorAll() { return []; }
    };
    const window = {
        document,
        location: { search: '?educationSchedule=today', href: 'https://crm.test/?educationSchedule=today' },
        history: { replaceState() {} },
        addEventListener() {},
        TimelineBusinessContext: { presentation: () => ({ mode: 'education' }) }
    };
    vm.runInNewContext(source, { window, document, URL, URLSearchParams, Intl, Number, String, Boolean, Array, Map, Set });
    return { workspace: window.EducationScheduleWorkspace, elements };
}

test('education schedule reuses the guarded timeline and existing canonical details path', () => {
    assert.match(sidebar, /educationWorkspace:\s*true/);
    assert.match(sidebar, /profile\?\.timeline\?\.mode === 'education'/);
    assert.match(sidebar, /pageAccess:\s*'\/'/);
    assert.match(html, /id="educationScheduleWorkspace"/);
    assert.match(html, /id="educationTodayPanel"/);
    assert.match(source, /getBookingsForDate\(date, \{ throwOnError: true \}\)/);
    assert.match(source, /showBookingDetails\(card\.dataset\.educationBookingId/);
    assert.doesNotMatch(html, /id="bookingModal"[\s\S]*id="educationBookingModal"/);
});

test('lesson card fields support canonical and legacy education lesson payloads', () => {
    const workspace = createWorkspace().workspace;
    const canonical = workspace.lessonFields({
        id: 7,
        time: '09:30',
        room: 'Кабінет 2',
        extraData: { educationLesson: { mode: 'education_lesson', title: 'Математика', teacherId: 42, teacherName: 'Олена', groupName: 'Початкова', studentCount: 8 } }
    });
    assert.equal(canonical.title, 'Математика');
    assert.equal(canonical.teacherId, '42');
    assert.equal(canonical.teacher, 'Олена');
    assert.equal(canonical.group, 'Початкова');
    assert.equal(canonical.cabinet, 'Кабінет 2');
    assert.equal(canonical.students, 8);

    const legacy = workspace.lessonFields({
        programName: 'Робототехніка',
        extra_data: JSON.stringify({ education_lesson: { title: 'Робототехніка', teacher_name: 'Ігор', group_name: 'Група А', resource_name: 'Зала', student_count: 6 } })
    });
    assert.equal(legacy.title, 'Робототехніка');
    assert.equal(legacy.teacher, 'Ігор');
    assert.equal(legacy.group, 'Група А');
    assert.equal(legacy.cabinet, 'Зала');
    assert.equal(legacy.students, 6);
    assert.equal(workspace.lessonFromBooking({ extraData: {} }), null);
});


test('Today list filters lessons by teacher, cabinet, and stable group ID without changing the source records', () => {
    const { workspace, elements } = createWorkspace();
    const first = { id: 'lesson-1', extraData: { educationLesson: { title: 'Math', teacherId: 7, teacherName: 'Olena', resourceName: 'Room A', groupId: 41 } } };
    const second = { id: 'lesson-2', extraData: { educationLesson: { title: 'Art', teacherId: 8, teacherName: 'Ihor', resourceName: 'Room B', groupId: 42 } } };
    workspace.state.bookings = [first, second];
    assert.deepEqual(Array.from(workspace.visibleLessons(), booking => booking.id), ['lesson-1', 'lesson-2']);
    elements.educationScheduleTeacherFilter.value = '8';
    assert.deepEqual(Array.from(workspace.visibleLessons(), booking => booking.id), ['lesson-2']);
    elements.educationScheduleTeacherFilter.value = '';
    elements.educationScheduleCabinetFilter.value = 'Room A';
    assert.deepEqual(Array.from(workspace.visibleLessons(), booking => booking.id), ['lesson-1']);
    elements.educationScheduleCabinetFilter.value = '';
    elements.educationScheduleGroupFilter.value = '42';
    assert.deepEqual(Array.from(workspace.visibleLessons(), booking => booking.id), ['lesson-2']);
    assert.equal(workspace.state.bookings.length, 2);
});
