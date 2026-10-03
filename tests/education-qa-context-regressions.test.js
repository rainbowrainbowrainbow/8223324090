'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
async function fixture(module) {
  const dom = new JSDOM(html, { url: 'https://crm.test/?businessContext=dar', runScripts: 'outside-only' });
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  const w = dom.window;
  let selected = 'dar';
  w.API_BASE = '/api';
  w.getAuthHeaders = () => ({});
  w.TimelineBusinessContext = { current: () => ({ apiValue: selected }), presentation: () => ({ mode: 'education' }) };
  w.getBookingsForDate = async () => [];
  const pending = [];
  w.fetch = (url, options = {}) => new Promise((resolve, reject) => pending.push({
    url, method: options.method || 'GET',
    resolve: payload => resolve({ ok: true, json: async () => payload }),
    reject
  }));
  w.eval(fs.readFileSync(require('node:path').join(__dirname, '../js/' + module + '.js'), 'utf8'));
  return {
    w, pending,
    switchContext(next = 'event_genix') {
      selected = next;
      w.dispatchEvent(new w.Event('timeline:business-context-changed'));
    },
    close() { dom.window.close(); }
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const group = (id, name) => ({ id, name, status: 'active', capacity: 3, members: [] });
const journal = (id, title) => ({ booking: { id, date: '2026-10-01', time: '09:00', title, groupName: 'QA' }, members: [], frozen: false, cancelled: false });
const report = title => ({
  summary: { held: 0, cancelled: 0, scheduled: 0, journalsNotStarted: 0, present: 0, absent: 0, excused: 0, unmarked: 0 },
  lessons: [{ date: '2026-10-01', time: '09:00', title, groupName: 'QA', phase: 'scheduled', journalStarted: false }]
});
test('EDU-QA P1: old group list must not replace the selected business list', async () => {
  const f = await fixture('education-groups');
  try {
    const old = f.w.EducationGroups.load();
    f.switchContext();
    const b = f.pending.find(item => item.url.includes('/education/groups?businessContext=event_genix'));
    assert.ok(b, 'business B group request was sent');
    b.resolve({ groups: [{ id: 2, name: 'QA business B', status: 'active' }] });
    await new Promise(resolve => setImmediate(resolve));
    const a = f.pending.find(item => item.url.includes('/education/groups?businessContext=dar'));
    assert.ok(a, 'business A group request was sent');
    a.resolve({ groups: [{ id: 1, name: 'QA business A', status: 'active' }] });
    await old;
    assert.equal(f.w.EducationGroups.state.groups[0].id, 2, 'late Dar response overwrote business B groups');
  } finally { f.close(); }
});
test('EDU-QA P1: pending journal must stay cleared after a business switch', async () => {
  const f = await fixture('education-attendance');
  try {
    const old = f.w.EducationAttendance.openBooking('qa-lesson-a');
    f.switchContext();
    f.pending[0].resolve({ journal: { booking: { id: 'qa-lesson-a', date: '2026-10-01', title: 'QA A' }, members: [], frozen: false, cancelled: false } });
    await old;
    assert.equal(f.w.EducationAttendance.state.journal, null, 'late Dar journal populated business B screen');
  } finally { f.close(); }
});
test('EDU-QA P1: pending report must not repopulate another business screen', async () => {
  const f = await fixture('education-attendance');
  try {
    f.w.document.getElementById('educationReportFrom').value = '2026-10-01';
    f.w.document.getElementById('educationReportTo').value = '2026-10-01';
    const old = f.w.EducationAttendance.runReport();
    f.switchContext();
    f.pending[0].resolve({ report: { summary: { held: 0, cancelled: 0, scheduled: 0, journalsNotStarted: 0, present: 0, absent: 0, excused: 0, unmarked: 0 }, lessons: [] } });
    await old;
    assert.equal(f.w.document.getElementById('educationReportResult').children.length, 0, 'late report restored stale result');
  } finally { f.close(); }
});

test('A to B to A ignores both earlier generations even when replies arrive out of order', async () => {
  const f = await fixture('education-groups');
  try {
    const first = f.w.EducationGroups.load();
    const firstRequest = f.pending.at(-1);
    f.switchContext('event_genix');
    const middleRequest = f.pending.find(item => item.url.includes('businessContext=event_genix'));
    f.switchContext('dar');
    const lastRequest = f.pending.filter(item => item.url.includes('/education/groups?businessContext=dar')).at(-1);
    assert.notEqual(firstRequest, lastRequest);
    lastRequest.resolve({ groups: [group(3, 'Fresh A')] });
    await flush();
    middleRequest.resolve({ groups: [group(2, 'Stale B')] });
    firstRequest.resolve({ groups: [group(1, 'Stale A')] });
    await first;
    await flush();
    assert.deepEqual(f.w.EducationGroups.state.groups.map(item => item.id), [3]);
    assert.match(f.w.document.getElementById('educationGroupsStatus').textContent, /1 груп/);
  } finally { f.close(); }
});

test('quick group selection keeps the newest detail and ignores the older error', async () => {
  const f = await fixture('education-groups');
  try {
    const first = f.w.EducationGroups.showGroup('1');
    const firstRequest = f.pending.at(-1);
    const second = f.w.EducationGroups.showGroup('2');
    const secondRequest = f.pending.at(-1);
    secondRequest.resolve({ group: group(2, 'Selected group') });
    await second;
    firstRequest.resolve({ group: group(1, 'Stale group') });
    await first;
    assert.equal(f.w.EducationGroups.state.current.id, 2);
    assert.equal(f.w.document.getElementById('educationGroupName').value, 'Selected group');
  } finally { f.close(); }
});

test('quick lesson selection and A to B to A keep only the latest journal', async () => {
  const f = await fixture('education-attendance');
  try {
    const first = f.w.EducationAttendance.openBooking('old-a');
    const firstRequest = f.pending.at(-1);
    f.switchContext('event_genix');
    const middle = f.w.EducationAttendance.openBooking('b');
    const middleRequest = f.pending.at(-1);
    f.switchContext('dar');
    const latest = f.w.EducationAttendance.openBooking('new-a');
    const latestRequest = f.pending.at(-1);
    latestRequest.resolve({ journal: journal('new-a', 'Current journal') });
    await latest;
    middleRequest.resolve({ journal: journal('b', 'Stale B') });
    firstRequest.resolve({ journal: journal('old-a', 'Stale A') });
    await Promise.all([first, middle]);
    assert.equal(f.w.EducationAttendance.state.journal.booking.id, 'new-a');
    assert.match(f.w.document.getElementById('educationAttendanceJournal').textContent, /Current journal/);
  } finally { f.close(); }
});

test('newest report wins after A to B to A and stale failure cannot clear it', async () => {
  const f = await fixture('education-attendance');
  try {
    f.w.document.getElementById('educationReportFrom').value = '2026-10-01';
    f.w.document.getElementById('educationReportTo').value = '2026-10-01';
    const first = f.w.EducationAttendance.runReport();
    const firstRequest = f.pending.at(-1);
    f.switchContext('event_genix');
    const middle = f.w.EducationAttendance.runReport();
    const middleRequest = f.pending.at(-1);
    f.switchContext('dar');
    const latest = f.w.EducationAttendance.runReport();
    const latestRequest = f.pending.at(-1);
    latestRequest.resolve({ report: report('Fresh A') });
    await latest;
    middleRequest.resolve({ report: report('Stale B') });
    firstRequest.resolve({ report: report('Stale A') });
    await Promise.all([first, middle]);
    const result = f.w.document.getElementById('educationReportResult').textContent;
    assert.match(result, /Fresh A/);
    assert.doesNotMatch(result, /Stale A|Stale B/);
  } finally { f.close(); }
});

test('group save started in A cannot restore its draft or selection in B', async () => {
  const f = await fixture('education-groups');
  try {
    f.w.document.dispatchEvent(new f.w.Event('DOMContentLoaded'));
    f.w.document.getElementById('educationGroupName').value = 'Private A draft';
    f.w.document.getElementById('educationGroupCapacity').value = '3';
    f.w.document.getElementById('educationLessonGroup').value = 'Private A group';
    f.w.document.getElementById('educationGroupForm').dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true }));
    const save = f.pending.find(item => item.method === 'POST' && item.url.includes('/education/groups'));
    assert.ok(save, 'group save request started');
    f.switchContext('event_genix');
    assert.equal(f.w.document.getElementById('educationGroupName').value, '');
    assert.equal(f.w.document.getElementById('educationLessonGroup').value, '');
    save.resolve({ group: group(1, 'Private A draft') });
    await flush();
    assert.equal(f.w.EducationGroups.state.current, null);
    assert.equal(f.w.document.getElementById('educationGroupsList').value, '');
    assert.equal(f.w.document.getElementById('educationGroupName').value, '');
    assert.doesNotMatch(f.w.document.getElementById('educationGroupsStatus').textContent, /збережено/);
  } finally { f.close(); }
});

test('old group save completion cannot release the new business submit guard', async () => {
  const f = await fixture('education-groups');
  try {
    f.w.document.dispatchEvent(new f.w.Event('DOMContentLoaded'));
    const form = f.w.document.getElementById('educationGroupForm');
    const submit = form.querySelector('button[type="submit"]');
    const name = f.w.document.getElementById('educationGroupName');
    const capacity = f.w.document.getElementById('educationGroupCapacity');
    name.value = 'Old A draft';
    capacity.value = '3';
    form.dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true }));
    const oldSave = f.pending.filter(item => item.method === 'POST').at(-1);
    assert.ok(oldSave);
    assert.equal(submit.disabled, true);
    f.switchContext('event_genix');
    assert.equal(submit.disabled, false, 'new business form is usable');
    name.value = 'Current B draft';
    capacity.value = '3';
    form.dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true }));
    const newSave = f.pending.filter(item => item.method === 'POST').at(-1);
    assert.notEqual(newSave, oldSave);
    assert.equal(submit.disabled, true);
    oldSave.resolve({ group: group(1, 'Old A draft') });
    await flush();
    assert.equal(submit.disabled, true, 'old A finally must not release B submit');
    assert.equal(form.getAttribute('aria-busy'), 'true');
    newSave.reject(new Error('Synthetic B failure'));
    await flush();
    assert.equal(submit.disabled, false);
    assert.equal(form.hasAttribute('aria-busy'), false);
    assert.equal(name.value, 'Current B draft');
    assert.match(f.w.document.getElementById('educationGroupsStatus').textContent, /Synthetic B failure/);
  } finally { f.close(); }
});

test('journal save started in A cannot repaint B or change the new save button state', async () => {
  const f = await fixture('education-attendance');
  try {
    f.w.document.dispatchEvent(new f.w.Event('DOMContentLoaded'));
    const opened = f.w.EducationAttendance.openBooking('lesson-a');
    const read = f.pending.find(item => item.url.includes('/attendance/lesson-a?'));
    read.resolve({ journal: {
      ...journal('lesson-a', 'A lesson'),
      members: [{ child_id: 7, child_name: 'A child', parent_name: 'A parent', status: null }]
    } });
    await opened;
    f.w.document.getElementById('educationAttendanceSave').click();
    const save = f.pending.find(item => item.url.endsWith('/attendance/lesson-a'));
    assert.ok(save, 'attendance save request started');
    assert.equal(f.w.document.getElementById('educationAttendanceSave').disabled, true);
    f.switchContext('event_genix');
    save.resolve({ journal: journal('lesson-a', 'A lesson'), changes: 1 });
    await flush();
    assert.equal(f.w.EducationAttendance.state.journal, null);
    assert.equal(f.w.document.getElementById('educationAttendanceSave').disabled, false);
    assert.equal(f.w.document.getElementById('educationAttendanceSave').hidden, true);
    assert.doesNotMatch(f.w.document.getElementById('educationAttendanceStatus').textContent, /змінено/);
  } finally { f.close(); }
});

test('child search ignores older query results and clears choices on business switch', async () => {
  const f = await fixture('education-groups');
  try {
    f.w.document.dispatchEvent(new f.w.Event('DOMContentLoaded'));
    const input = f.w.document.getElementById('educationChildSearch');
    const button = f.w.document.getElementById('educationChildFind');
    input.value = 'Alice';
    button.click();
    const first = f.pending.find(item => item.url.includes('/children/search?') && item.url.includes('Alice'));
    input.value = 'Bob';
    button.click();
    const second = f.pending.find(item => item.url.includes('/children/search?') && item.url.includes('Bob'));
    assert.ok(first && second);
    second.resolve({ children: [{ id: 2, name: 'Bob' }] });
    await flush();
    first.resolve({ children: [{ id: 1, name: 'Alice' }] });
    await flush();
    assert.match(f.w.document.getElementById('educationChildSelect').textContent, /Bob/);
    assert.doesNotMatch(f.w.document.getElementById('educationChildSelect').textContent, /Alice/);
    f.switchContext('event_genix');
    assert.equal(input.value, '');
    assert.doesNotMatch(f.w.document.getElementById('educationChildSelect').textContent, /Bob/);
  } finally { f.close(); }
});

test('lesson list ignores the old business response after a switch', async () => {
  const f = await fixture('education-attendance');
  try {
    const pending = [];
    f.w.EducationScheduleWorkspace = {
      state: { activeView: 'attendance' },
      lessonFromBooking: booking => booking.lesson
    };
    f.w.getBookingsForDate = () => new Promise(resolve => pending.push(resolve));
    const old = f.w.EducationAttendance.loadLessons('2026-10-01');
    f.switchContext('event_genix');
    assert.equal(pending.length, 2);
    pending[1]([{ id: 'lesson-b', time: '10:00', lesson: { groupId: 2, title: 'B' } }]);
    await flush();
    pending[0]([{ id: 'lesson-a', time: '09:00', lesson: { groupId: 1, title: 'A' } }]);
    await old;
    assert.deepEqual(f.w.EducationAttendance.state.lessons.map(item => item.id), ['lesson-b']);
    assert.equal(f.w.EducationAttendance.state.loading, false);
  } finally { f.close(); }
});

test('changing lessons while a journal save is pending keeps the new journal usable', async () => {
  const f = await fixture('education-attendance');
  try {
    f.w.document.dispatchEvent(new f.w.Event('DOMContentLoaded'));
    const first = f.w.EducationAttendance.openBooking('lesson-a');
    f.pending.find(item => item.url.includes('/attendance/lesson-a?')).resolve({ journal: {
      ...journal('lesson-a', 'A lesson'),
      members: [{ child_id: 7, child_name: 'Child', parent_name: 'Parent', status: null }]
    } });
    await first;
    f.w.document.getElementById('educationAttendanceSave').click();
    const oldSave = f.pending.find(item => item.method === 'PUT' && item.url.endsWith('/lesson-a'));
    assert.ok(oldSave);
    const next = f.w.EducationAttendance.openBooking('lesson-b');
    assert.equal(f.w.document.getElementById('educationAttendanceJournal').textContent, '');
    f.pending.find(item => item.url.includes('/attendance/lesson-b?')).resolve({ journal: {
      ...journal('lesson-b', 'B lesson'),
      members: [{ child_id: 8, child_name: 'Other child', parent_name: 'Other parent', status: null }]
    } });
    await next;
    oldSave.resolve({ journal: journal('lesson-a', 'A lesson'), changes: 1 });
    await flush();
    assert.equal(f.w.EducationAttendance.state.journal.booking.id, 'lesson-b');
    assert.equal(f.w.document.getElementById('educationAttendanceSave').disabled, false);
    assert.match(f.w.document.getElementById('educationAttendanceJournal').textContent, /B lesson/);
  } finally { f.close(); }
});

test('old request errors cannot replace the new business status or report', async () => {
  const groups = await fixture('education-groups');
  try {
    const old = groups.w.EducationGroups.load();
    const stale = groups.pending.at(-1);
    groups.switchContext('event_genix');
    groups.pending.find(item => item.url.includes('businessContext=event_genix'))
      .resolve({ groups: [group(2, 'Current B')] });
    await flush();
    stale.reject(new Error('stale group failure'));
    await old;
    assert.deepEqual(groups.w.EducationGroups.state.groups.map(item => item.name), ['Current B']);
    assert.doesNotMatch(groups.w.document.getElementById('educationGroupsStatus').textContent, /stale group failure/);
  } finally { groups.close(); }

  const attendance = await fixture('education-attendance');
  try {
    attendance.w.document.getElementById('educationReportFrom').value = '2026-10-01';
    attendance.w.document.getElementById('educationReportTo').value = '2026-10-01';
    const old = attendance.w.EducationAttendance.runReport();
    const stale = attendance.pending.at(-1);
    attendance.switchContext('event_genix');
    stale.reject(new Error('stale report failure'));
    await old;
    assert.equal(attendance.w.document.getElementById('educationReportResult').children.length, 0);
    assert.doesNotMatch(attendance.w.document.getElementById('educationReportStatus').textContent, /stale report failure/);
  } finally { attendance.close(); }
});
