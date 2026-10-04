'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const OWNER = 'EDU-READY-02-v1';
const OWNER_KEY = 'education_ready:dataset:v1';
const FIXED_ANCHOR = '2026-10-03';
const DATABASES = Object.freeze({ demo: 'eventgenix_education_ready_manual', fixed: 'eventgenix_education_ready_fixture_test',
    devices: 'eventgenix_education_ready_devices' });
const TEACHERS = [
    ['Олена Ковальчук', 'Англійська мова'], ['Максим Левченко', 'Робототехніка'],
    ['Ірина Бондар', 'Творчість'], ['Софія Мельник', 'Підготовка до школи']
];
const CHILDREN = ['Марта Романюк', 'Данило Романюк', 'Софія', 'Андрій Кравченко',
    "Мар'яна Савчук", 'Лук’ян Савчук', 'Софія', 'Тимофій Шевченко',
    'Злата Дорошенко', 'Марк Дорошенко', 'Анна Петренко', 'Богдан Петренко',
    'Вікторія Ткаченко', 'Остап Ткаченко', 'Єва Олійник', 'Матвій Олійник',
    'Вероніка Мазур', 'Назар Мазур', 'Аліса Кузьменко', 'Роман Кузьменко',
    'Дарина Мельник', 'Ілля Мельник', 'Мілана Бойко', 'Сергій Бойко'];
const PARENTS = ['Наталія Романюк', 'Олександр Кравченко', 'Оксана Савчук', 'Катерина Шевченко',
    'Дмитро Дорошенко', 'Юлія Петренко', 'Артем Ткаченко', 'Марія Олійник',
    'Валентина Мазур', 'Андрій Кузьменко', 'Тетяна Мельник', 'Олена Бойко'];
const TOPICS = [
    ['Знайомимося англійською', 'Кольори навколо нас', 'Моя сім’я', 'Рахуємо до десяти', 'Слова ввічливості', 'Тварини та їхні голоси', 'Улюблені іграшки', 'Подорож містом'],
    ['Будуємо світлофор', 'Колеса й осі', 'Робот-помічник', 'Міст, який витримує вагу', 'Датчик світла', 'Рух за командою', 'Сортуємо предмети', 'Місто майбутнього'],
    ['Осінній колаж', 'Кольори й відтінки', 'Паперові птахи', 'Ліпимо казкового героя', 'Візерунки з листя', 'Малюємо власну історію', 'Аплікація з природних матеріалів: об’ємна композиція «Осіннє місто»', 'Виставка маленьких митців'],
    ['Лічба та геометричні фігури', 'Звуки й літери', 'Орієнтуємося на аркуші', 'Уважність і пам’ять', 'Порівнюємо величини', 'Складаємо речення', 'Логічні послідовності', 'Читаємо короткі слова']
];

function addDays(date, count) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
    const parsed = new Date(`${date}T00:00:00Z`);
    assert.equal(parsed.toISOString().slice(0, 10), date, 'Invalid anchor date');
    parsed.setUTCDate(parsed.getUTCDate() + count);
    return parsed.toISOString().slice(0, 10);
}
function kyivDate(now = new Date()) {
    const values = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv',
        year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
        .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}
function assertLocalTarget(mode, env = process.env) {
    assert.ok(DATABASES[mode], 'Mode must be demo, fixed or devices');
    assert.equal(env.EDU_READY_LOCAL_CONFIRM, 'SEED_OWNED_LOCAL_EDUCATION', 'Explicit local fixture boundary required');
    assert.notEqual(env.NODE_ENV, 'production');
    for (const key of ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID', 'DATABASE_URL', 'PRODUCTION_DATABASE_URL', 'LIVE_DATABASE_URL'])
        assert.ok(!env[key], `${key} must be unset`);
    assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.PGHOST), 'PostgreSQL must be loopback');
    assert.equal(env.PGDATABASE, DATABASES[mode], 'Exact database allowlist mismatch');
    assert.equal(Number(env.PGPORT), 55469, 'This dataset owns only PostgreSQL port55469');
    if (mode === 'fixed') assert.equal(env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    if (mode === 'devices') assert.equal(env.EDU_READY_DEVICE_LOCAL_CONFIRM, 'OWNED_DEVICE_PREVIEW_08C');
    return { host: env.PGHOST, port: Number(env.PGPORT), database: env.PGDATABASE };
}
function roster(plan, groupKey, date) {
    return plan.members.filter(member => member.groupKey === groupKey && member.startDate <= date
        && (!member.endDate || member.endDate >= date)).map(member => member.childKey).sort();
}
function buildPlan(mode, anchor = mode === 'fixed' ? FIXED_ANCHOR : kyivDate()) {
    assert.ok(DATABASES[mode]); addDays(anchor, 0);
    const groups = [
        ['english', 'Англійська: Перші слова', 0, 6, 'active'],
        ['robots', 'Юні винахідники', 1, 8, 'active'],
        ['arts', 'Творча майстерня: об’ємні композиції та історії, які діти створюють власноруч', 2, 8, 'active'],
        ['school', 'Готуємося до школи', 3, 8, 'active'],
        ['empty', 'Розмовний клуб: перші кроки до впевненого спілкування', 0, 6, 'active'],
        ['archive', 'Літня творча майстерня', 2, 8, 'archived'],
        ['secondary', 'Англійська: Перші слова', 0, 4, 'active']
    ].map(([key, name, teacher, capacity, status]) => ({ key, name, teacher, capacity, status,
        context: key === 'secondary' ? 'maysternya_doli' : 'dar' }));
    const children = CHILDREN.map((name, index) => ({ key: `child-${index}`, name, parentKey: `parent-${Math.floor(index / 2)}`, context: 'dar' }));
    children.push({ key: 'second-0', name: 'Марта Романюк', parentKey: 'second-parent', context: 'maysternya_doli' },
        { key: 'second-1', name: 'Данило Романюк', parentKey: 'second-parent', context: 'maysternya_doli' });
    const parents = PARENTS.map((name, index) => ({ key: `parent-${index}`, name, context: 'dar' }));
    parents.push({ key: 'second-parent', name: 'Наталія Романюк', context: 'maysternya_doli' },
        { key: 'control-parent', name: 'Леся Гончар', context: 'event_genix' });
    const members = [];
    for (let group = 0; group < 4; group++) for (let child = group * 6; child < group * 6 + 6; child++)
        members.push({ groupKey: groups[group].key, childKey: `child-${child}`, startDate: addDays(anchor, -90),
            endDate: group === 0 && child === 0 ? addDays(anchor, -10) : null });
    members.push({ groupKey: 'english', childKey: 'child-6', startDate: addDays(anchor, -9), endDate: null });
    for (let child = 18; child < 24; child++) members.push({ groupKey: 'archive', childKey: `child-${child}`,
        startDate: addDays(anchor, -70), endDate: addDays(anchor, -28) });
    for (let child = 0; child < 2; child++) members.push({ groupKey: 'secondary', childKey: `second-${child}`, startDate: addDays(anchor, -90), endDate: null });
    const lessons = [];
    const offsets = [-21, -14, -7, -1, 0, 7, 14, 21];
    for (let g = 0; g < 4; g++) for (let i = 0; i < offsets.length; i++) lessons.push({
        key: `${groups[g].key}-${i}`, context: 'dar', groupKey: groups[g].key, title: TOPICS[g][i],
        date: addDays(anchor, offsets[i]), time: ['09:30', '11:30', '14:00', '16:00'][g],
        duration: i >= 5 ? [45, 60, 90, 30][g] : [30, 45, 60, 90][(g + i) % 4],
        resource: g % 3, cancelled: (g === 0 && i === 7) || (g === 1 && i === 2) || (g === 2 && i === 6),
        series: i >= 5 ? { id: `ELS-READY-${mode}-${g}`, index: i - 4, size: 3, rootDate: addDays(anchor, 7) } : null,
        journal: i < 4 && i !== 1 ? (i === 2 ? 'partial' : i === 3 ? 'mixed' : 'initial') : null
    });
    for (let i = 0; i < 4; i++) lessons.push({ key: `archive-${i}`, context: 'dar', groupKey: 'archive',
        title: ['Малюємо море', 'Паперовий кораблик', 'Літній пейзаж', 'Прощальна виставка'][i],
        date: addDays(anchor, -56 + i * 7), time: '10:00', duration: i % 2 ? 60 : 45,
        resource: 2, cancelled: i === 3, journal: i < 2 ? (i === 0 ? 'all-present' : 'initial') : null });
    for (let i = 0; i < 2; i++) lessons.push({ key: `second-${i}`, context: 'maysternya_doli', groupKey: 'secondary',
        title: i ? 'Знайомимося англійською' : 'Кольори навколо нас', date: addDays(anchor, i ? 7 : -7),
        time: '10:00', duration: 45, resource: 0, cancelled: false, journal: i ? null : 'all-present' });
    for (const lesson of lessons) {
        lesson.childKeys = roster({ members }, lesson.groupKey, lesson.date);
        lesson.marks = !lesson.cancelled && lesson.journal ? lesson.childKeys.map((childKey, index) => ({ childKey,
            status: (lesson.journal === 'all-present' ? Array(6).fill('present')
                : lesson.journal === 'partial' ? ['present', 'present', 'present', null, null, null]
                : lesson.journal === 'mixed' ? ['present', 'absent', 'excused', null, 'present', 'absent']
                : ['present', 'present', 'absent', 'excused', null, 'present'])[index] })) : [];
    }
    return { owner: OWNER, mode, anchorDate: anchor, timezone: 'Europe/Kyiv', teachers: TEACHERS, parents, children, groups, members, lessons };
}
// Independent oracle is generated from the fixture specification, never from product report output.
function expectedReport(plan, context, from, to, groupKey = null, clockDate = plan.anchorDate, clockMinutes = 720) {
    const summary = { held: 0, cancelled: 0, scheduled: 0, journalsNotStarted: 0, present: 0, absent: 0, excused: 0, unmarked: 0 };
    const lessons = plan.lessons.filter(lesson => lesson.context === context && lesson.date >= from && lesson.date <= to
        && (!groupKey || lesson.groupKey === groupKey));
    for (const lesson of lessons) {
        const [hour, minute] = lesson.time.split(':').map(Number);
        const phase = lesson.cancelled ? 'cancelled' : lesson.date < clockDate
            || (lesson.date === clockDate && hour * 60 + minute + lesson.duration <= clockMinutes) ? 'held' : 'scheduled';
        summary[phase]++;
        if (phase !== 'held') continue;
        if (!lesson.marks.length) summary.journalsNotStarted++;
        for (const mark of lesson.marks) summary[mark.status || 'unmarked']++;
    }
    return { context, from, to, groupKey, clock: { date: clockDate, minutes: clockMinutes }, lessonCount: lessons.length, summary };
}
function planHash(plan) { return crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex'); }

async function seedDataset(pool, mode, env = process.env) {
    const target = assertLocalTarget(mode, env);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [OWNER]);
        const identity = (await client.query('SELECT current_database() name, inet_server_port() port')).rows[0];
        assert.equal(identity.name, target.database); assert.equal(identity.port, target.port);
        const previous = (await client.query('SELECT value FROM settings WHERE key=$1', [OWNER_KEY])).rows[0];
        if (previous) {
            const manifest = JSON.parse(previous.value);
            assert.equal(manifest.owner, OWNER); assert.equal(manifest.mode, mode);
            await client.query('COMMIT');
            await preflight(pool, manifest);
            return { manifest, reused: true };
        }
        for (const table of ['customers', 'customer_children', 'education_groups', 'bookings']) {
            const count = (await client.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
            assert.equal(count, 0, `Unowned data found in ${table}; seed refuses to overwrite`);
        }
        const plan = buildPlan(mode);
        const ids = { teachers: [], parents: {}, children: {}, groups: {}, members: [], resources: [], bookings: {}, attendance: [], history: [] };
        // The unchanged startup seeds 30 staff, then historical migrations extend them to97.
        // These are source-generated rows in a fresh owned local DB, not imported business data.
        const bootstrapStaff = (await client.query('SELECT id FROM staff ORDER BY id')).rows.map(row => row.id);
        assert.deepEqual(bootstrapStaff, Array.from({ length: 97 }, (_, index) => index + 1), 'Unknown startup staff set; refusing fixture preparation');
        await client.query(`UPDATE staff SET name='Архівний локальний працівник ' || id::text,
            is_active=false,phone=NULL,emergency_phone=NULL,telegram_username=NULL,telegram_id=NULL,
            unique_person_key='edu_ready_archived_' || id::text WHERE id=ANY($1::int[])`, [bootstrapStaff]);
        const bootstrapContractors = (await client.query('SELECT id FROM contractors ORDER BY id')).rows.map(row => row.id);
        assert.deepEqual(bootstrapContractors, [1], 'Unknown startup contractor set');
        await client.query(`UPDATE contractors SET name='Локальна майстерня матеріалів',phone=NULL,telegram_chat_id=NULL,
            telegram_username=NULL,invite_token=NULL WHERE id=1`);
        for (const [name, subject] of plan.teachers) ids.teachers.push((await client.query(
            "INSERT INTO staff(name,department,position,is_active,color) VALUES ($1,'education',$2,true,$3) RETURNING id",
            [name, subject, ['#3B82F6', '#10B981', '#F97316', '#8B5CF6'][ids.teachers.length]])).rows[0].id);
        // Explicit synthetic ownership; never derive real memberships from historical lessons.
        if ((await client.query("SELECT to_regclass('education_teacher_memberships') AS name")).rows[0].name) {
            ids.teacherMemberships = ids.teachers.map(staffId => ({businessContext:'dar',staffId}));
            ids.teacherMemberships.push({businessContext:'maysternya_doli',staffId:ids.teachers[0]});
            for (const id of ids.teachers) await client.query(
                "INSERT INTO education_teacher_memberships(business_context,staff_id) VALUES ('dar',$1)", [id]);
            await client.query("INSERT INTO education_teacher_memberships(business_context,staff_id) VALUES ('maysternya_doli',$1)",[ids.teachers[0]]);
        }
        for (let i = 0; i < plan.parents.length; i++) {
            const parent = plan.parents[i];
            ids.parents[parent.key] = (await client.query(
                'INSERT INTO customers(business_context,name,source,notes) VALUES ($1,$2,$3,$4) RETURNING id',
                [parent.context, parent.name, 'education_ready_synthetic', 'Вигадана родина для локального тестування; контакти навмисно відсутні.'])).rows[0].id;
        }
        for (let i = 0; i < plan.children.length; i++) {
            const child = plan.children[i];
            ids.children[child.key] = (await client.query(
                `INSERT INTO customer_children(business_context,customer_id,name,birthday,note,source_kind,source_payload,sort_order)
                 VALUES ($1,$2,$3,$4,$5,'education_ready_synthetic',$6,$7) RETURNING id`,
                [child.context, ids.parents[child.parentKey], child.name, `${2018 + i % 3}-05-${String(5 + i % 20).padStart(2, '0')}`,
                    'Вигадана дитина; тестовий набір «Сонячні кроки».', { owner: OWNER, key: child.key }, i % 2])).rows[0].id;
        }
        for (const group of plan.groups) ids.groups[group.key] = (await client.query(
            'INSERT INTO education_groups(business_context,name,teacher_id,capacity,status) VALUES ($1,$2,$3,$4,$5) RETURNING id',
            [group.context, group.name, ids.teachers[group.teacher], group.capacity, group.status])).rows[0].id;
        for (const member of plan.members) {
            const context = plan.groups.find(group => group.key === member.groupKey).context;
            ids.members.push((await client.query(
                'INSERT INTO education_group_members(business_context,group_id,child_id,start_date,end_date) VALUES ($1,$2,$3,$4,$5) RETURNING id',
                [context, ids.groups[member.groupKey], ids.children[member.childKey], member.startDate, member.endDate])).rows[0].id);
        }
        const roomNames = ['Мовний кабінет «Веселка»', 'Лабораторія «Винахідник»', 'Творчий простір «Палітра»'];
        for (const context of ['dar', 'maysternya_doli']) for (let i = 0; i < (context === 'dar' ? 3 : 1); i++)
            ids.resources.push((await client.query(
                `INSERT INTO timeline_resources(business_context,resource_id,type,name,short_name,capacity,color,equipment,sort_order,metadata)
                 VALUES ($1,$2,'cabinet',$3,$4,10,$5,$6,$7,$8)
                 ON CONFLICT (business_context,resource_id) DO UPDATE SET name=EXCLUDED.name,short_name=EXCLUDED.short_name,
                 capacity=EXCLUDED.capacity,color=EXCLUDED.color,equipment=EXCLUDED.equipment,metadata=EXCLUDED.metadata RETURNING id`,
                [context, `edu-cabinet-${i + 1}`, context === 'dar' ? roomNames[i] : 'Мовний кабінет «Обрій»', `Каб. ${i + 1}`,
                    ['#3B82F6', '#10B981', '#F97316'][i], JSON.stringify(['Стіл для спільної роботи', i === 1 ? 'Набори конструкторів' : 'Матеріали для занять']), (i + 1) * 10, { owner: OWNER }])).rows[0].id);
        for (const lesson of plan.lessons) {
            const group = plan.groups.find(group => group.key === lesson.groupKey);
            const id = `ER02-${mode}-${lesson.key}`;
            ids.bookings[lesson.key] = id;
            const educationLesson = { mode: 'education_lesson', title: lesson.title, groupId: Number(ids.groups[group.key]),
                groupName: group.name, teacherId: String(ids.teachers[group.teacher]), teacherName: plan.teachers[group.teacher][0],
                ...(lesson.series ? { seriesId: lesson.series.id, seriesIndex: lesson.series.index, seriesSize: lesson.series.size,
                    repeatEvery: 'weekly', seriesRootDate: lesson.series.rootDate, seriesRootTime: lesson.time, source: 'education_lesson_series' } : {}) };
            await client.query(
                `INSERT INTO bookings(id,business_context,date,time,line_id,room,label,program_name,category,duration,status,extra_data,customer_id,kids_count,hosts,price,created_by,notes)
                 VALUES ($1,$2,$3,$4,$5,$6,'Заняття',$7,'education',$8,$9,$10,$11,$12,1,0,'Локальний адміністратор',$13)`,
                [id, lesson.context, lesson.date, lesson.time, `edu-cabinet-${lesson.resource + 1}`,
                    lesson.context === 'dar' ? roomNames[lesson.resource] : 'Мовний кабінет «Обрій»', lesson.title,
                    lesson.duration, lesson.cancelled ? 'cancelled' : 'confirmed', { educationLesson,
                        bookingWorkspace: { source: 'booking_workspace_v2', lesson: educationLesson }, educationReady: { owner: OWNER, key: lesson.key } },
                    ids.parents[plan.children.find(child => child.key === lesson.childKeys[0])?.parentKey || 'parent-0'],
                    lesson.childKeys.length, lesson.cancelled ? 'Заняття скасовано: викладач бере участь у методичному семінарі.' : 'Вигаданий локальний урок. Повідомлення не надсилати.']);
            for (let index = 0; index < lesson.marks.length; index++) {
                const mark = lesson.marks[index], child = plan.children.find(value => value.key === mark.childKey);
                const parent = plan.parents.find(value => value.key === child.parentKey);
                const corrected = lesson.key === 'english-0' && index === 0;
                const row = (await client.query(
                    `INSERT INTO education_attendance(business_context,booking_id,group_id,child_id,lesson_date,child_name_snapshot,parent_name_snapshot,status,marked_by,marked_at,snapshot_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::varchar(16),$9,CASE WHEN $8::varchar(16) IS NULL THEN NULL ELSE
                     ($10::timestamp AT TIME ZONE 'Europe/Kyiv') + CASE WHEN $11::boolean THEN INTERVAL '5 minutes' ELSE INTERVAL '0 minutes' END END,
                     $10::timestamp AT TIME ZONE 'Europe/Kyiv') RETURNING id`,
                    [lesson.context, id, ids.groups[group.key], ids.children[child.key], lesson.date, child.name, parent.name, mark.status,
                        mark.status ? (corrected ? 'Адміністратор Марія' : 'Викладач Олена') : null, `${lesson.date}T15:00:00`, corrected])).rows[0];
                ids.attendance.push(row.id);
                if (mark.status) {
                    const events = corrected ? [[null, 'absent', 'Викладач Олена'], ['absent', 'present', 'Адміністратор Марія']]
                        : [[null, mark.status, 'Викладач Олена']];
                    for (let event = 0; event < events.length; event++) ids.history.push((await client.query(
                        "INSERT INTO education_attendance_history(business_context,attendance_id,previous_status,new_status,changed_by,changed_at) VALUES ($1,$2,$3,$4,$5,$6::timestamp AT TIME ZONE 'Europe/Kyiv') RETURNING id",
                        [lesson.context, row.id, ...events[event], `${lesson.date}T${event ? '15:05' : '15:00'}:00`])).rows[0].id);
                }
            }
        }
        ids.controlBooking = `ER02-${mode}-park-control`;
        await client.query(`INSERT INTO bookings(id,business_context,date,time,line_id,room,room_resource_id,label,program_name,category,duration,status,extra_data,customer_id,created_by,price)
            VALUES ($1,'event_genix',$2,'18:00','line1','Марвел','room-marvel','Сімейна подія','Святкуємо день народження','birthday',60,'confirmed',$3,$4,'Локальний адміністратор',0)`,
        [ids.controlBooking, plan.anchorDate, { educationReady: { owner: OWNER, control: true } }, ids.parents['control-parent']]);
        const from = addDays(plan.anchorDate, -60), to = addDays(plan.anchorDate, -1);
        const reports = { historical: expectedReport(plan, 'dar', from, to),
            byGroup: Object.fromEntries(plan.groups.filter(group => group.context === 'dar').map(group => [group.key, expectedReport(plan, 'dar', from, to, group.key)])),
            secondary: expectedReport(plan, 'maysternya_doli', from, to),
            nonEducation: expectedReport(plan, 'event_genix', from, addDays(plan.anchorDate, 21)),
            fixedClockFull: expectedReport(plan, 'dar', from, addDays(plan.anchorDate, 21)) };
        const manifest = { owner: OWNER, mode, database: target, seededAt: new Date().toISOString(), anchorDate: plan.anchorDate,
            timezone: plan.timezone, hash: planHash(plan), plan, ids, expectedReports: reports,
            startupIsolation: { staffIds: bootstrapStaff, contractorIds: bootstrapContractors,
                source: 'Unchanged db/index.js + existing migrations in fresh owned database', inactiveAndRenamed: true, contactsCleared: true },
            policy: 'Synthetic SQL fixtures only; no UI repair, no production, no contact delivery; repeat load preserves manual edits' };
        await client.query('INSERT INTO settings(key,value) VALUES ($1,$2)', [OWNER_KEY, JSON.stringify(manifest)]);
        await client.query('COMMIT');
        await preflight(pool, manifest);
        return { manifest, reused: false };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
}

async function preflight(pool, manifest) {
    assert.equal(manifest.owner, OWNER); assert.equal(manifest.hash, planHash(manifest.plan));
    const { plan, ids } = manifest;
    const counts = {};
    if (ids.teacherMemberships) {
        for (const member of ids.teacherMemberships) {
            const row = (await pool.query('SELECT is_active FROM education_teacher_memberships WHERE business_context=$1 AND staff_id=$2',[member.businessContext,member.staffId])).rows[0];
            assert.equal(row?.is_active,true,'Explicit synthetic teacher membership drift');
        }
        counts.education_teacher_memberships = ids.teacherMemberships.length;
    }
    for (const [table, ownedIds] of [['staff', ids.teachers], ['customers', Object.values(ids.parents)],
        ['customer_children', Object.values(ids.children)], ['education_groups', Object.values(ids.groups)],
        ['education_group_members', ids.members], ['timeline_resources', ids.resources],
        ['education_attendance', ids.attendance], ['education_attendance_history', ids.history]]) {
        const query = await pool.query(`SELECT count(*)::int n FROM ${table} WHERE id=ANY($1::bigint[])`, [ownedIds]);
        assert.equal(query.rows[0].n, ownedIds.length, `${table} ownership/count drift`); counts[table] = query.rows[0].n;
    }
    const bookings = (await pool.query('SELECT id,business_context,date,time,duration,status,extra_data FROM bookings WHERE id=ANY($1::text[])',
        [[...Object.values(ids.bookings), ids.controlBooking]])).rows;
    assert.equal(bookings.length, 39);
    for (const lesson of plan.lessons) {
        const row = bookings.find(value => value.id === ids.bookings[lesson.key]);
        assert.equal(row.business_context, lesson.context); assert.equal(row.date, lesson.date);
        assert.equal(row.time, lesson.time); assert.equal(row.duration, lesson.duration);
        assert.equal(row.status, lesson.cancelled ? 'cancelled' : 'confirmed');
        assert.equal(row.extra_data.educationReady.owner, OWNER);
        assert.equal(Number(row.extra_data.educationLesson.groupId), Number(ids.groups[lesson.groupKey]));
        assert.equal(row.extra_data.educationLesson.title, lesson.title);
    }
    const relational = (await pool.query(`SELECT count(*)::int n FROM education_group_members m
        JOIN education_groups g ON g.id=m.group_id JOIN customer_children cc ON cc.id=m.child_id
        JOIN customers c ON c.id=cc.customer_id WHERE m.id=ANY($1::bigint[])
        AND (m.business_context<>g.business_context OR m.business_context<>cc.business_context OR m.business_context<>c.business_context)`, [ids.members])).rows[0].n;
    assert.equal(relational, 0, 'Cross-business relationship detected');
    const teachers = (await pool.query('SELECT id,name,position FROM staff WHERE id=ANY($1::int[]) ORDER BY id', [ids.teachers])).rows;
    assert.deepEqual(teachers.map(row => [row.name, row.position]), plan.teachers);
    const parents = (await pool.query('SELECT id,name,business_context FROM customers WHERE id=ANY($1::int[])', [Object.values(ids.parents)])).rows;
    for (const parent of plan.parents) {
        const row = parents.find(value => value.id === ids.parents[parent.key]);
        assert.equal(row.name, parent.name); assert.equal(row.business_context, parent.context);
    }
    const children = (await pool.query('SELECT id,name,business_context,customer_id FROM customer_children WHERE id=ANY($1::bigint[])', [Object.values(ids.children)])).rows;
    for (const child of plan.children) {
        const row = children.find(value => Number(value.id) === Number(ids.children[child.key]));
        assert.equal(row.name, child.name); assert.equal(row.business_context, child.context); assert.equal(row.customer_id, ids.parents[child.parentKey]);
    }
    const members = (await pool.query('SELECT group_id,child_id,start_date::text,end_date::text FROM education_group_members WHERE id=ANY($1::bigint[])', [ids.members])).rows;
    for (const member of plan.members) assert.ok(members.some(row => Number(row.group_id) === Number(ids.groups[member.groupKey])
        && Number(row.child_id) === Number(ids.children[member.childKey]) && row.start_date === member.startDate && row.end_date === member.endDate), 'Membership date/link drift');
    const attendance = (await pool.query('SELECT booking_id,child_id,status FROM education_attendance WHERE id=ANY($1::bigint[])', [ids.attendance])).rows;
    for (const lesson of plan.lessons) {
        const rows = attendance.filter(row => row.booking_id === ids.bookings[lesson.key]);
        assert.equal(rows.length, lesson.marks.length);
        for (const mark of lesson.marks) assert.equal(rows.find(row => Number(row.child_id) === Number(ids.children[mark.childKey]))?.status, mark.status);
    }
    const range = manifest.expectedReports.historical;
    const sqlSummary = (await pool.query(`WITH lessons AS (
        SELECT b.id,b.status FROM bookings b WHERE business_context='dar' AND date >= $1 AND date <= $2
        AND extra_data->'educationLesson'->>'groupId' IS NOT NULL), totals AS (
        SELECT count(*) FILTER (WHERE status<>'cancelled')::int held,count(*) FILTER (WHERE status='cancelled')::int cancelled,
        count(*) FILTER (WHERE status<>'cancelled' AND NOT EXISTS(SELECT 1 FROM education_attendance a WHERE a.booking_id=lessons.id))::int "journalsNotStarted" FROM lessons)
        SELECT totals.*,0::int scheduled,
        (SELECT count(*)::int FROM education_attendance a JOIN lessons l ON l.id=a.booking_id WHERE l.status<>'cancelled' AND a.status='present') present,
        (SELECT count(*)::int FROM education_attendance a JOIN lessons l ON l.id=a.booking_id WHERE l.status<>'cancelled' AND a.status='absent') absent,
        (SELECT count(*)::int FROM education_attendance a JOIN lessons l ON l.id=a.booking_id WHERE l.status<>'cancelled' AND a.status='excused') excused,
        (SELECT count(*)::int FROM education_attendance a JOIN lessons l ON l.id=a.booking_id WHERE l.status<>'cancelled' AND a.status IS NULL) unmarked FROM totals`, [range.from, range.to])).rows[0];
    assert.deepEqual(sqlSummary, range.summary, 'Independent SQL totals disagree with fixture specification');
    const groupRows = (await pool.query('SELECT id,name,capacity,status,teacher_id FROM education_groups WHERE id=ANY($1::bigint[])', [Object.values(ids.groups)])).rows;
    for (const group of plan.groups) {
        const row = groupRows.find(item => Number(item.id) === Number(ids.groups[group.key]));
        assert.equal(row.name, group.name); assert.equal(row.capacity, group.capacity); assert.equal(row.status, group.status);
        assert.equal(row.teacher_id, ids.teachers[group.teacher]);
        assert.ok(roster(plan, group.key, plan.anchorDate).length <= group.capacity);
    }
    assert.equal(roster(plan, 'empty', plan.anchorDate).length, 0);
    assert.equal(roster(plan, 'english', plan.anchorDate).length, 6);
    assert.equal(roster(plan, 'archive', plan.anchorDate).length, 0);
    assert.equal(bookings.find(row => row.id === ids.controlBooking).extra_data.educationLesson, undefined);
    const activeTeachers = (await pool.query('SELECT id FROM staff WHERE is_active=true ORDER BY id')).rows.map(row => row.id);
    assert.deepEqual(activeTeachers, ids.teachers, 'Only four synthetic teachers may be active');
    const contacts = (await pool.query(`SELECT
        (SELECT count(*)::int FROM staff WHERE phone IS NOT NULL OR emergency_phone IS NOT NULL OR telegram_username IS NOT NULL OR telegram_id IS NOT NULL)
        + (SELECT count(*)::int FROM contractors WHERE phone IS NOT NULL OR telegram_chat_id IS NOT NULL OR telegram_username IS NOT NULL)
        + (SELECT count(*)::int FROM customers WHERE phone IS NOT NULL OR instagram IS NOT NULL) n`)).rows[0].n;
    assert.equal(contacts, 0, 'Local dataset must contain no reachable contact channels');
    return { status: 'PASS', anchorDate: plan.anchorDate, ownedCounts: { ...counts, bookings: bookings.length },
        primary: { teachers: 4, groups: 6, children: 24, representatives: 12, cabinets: 3, lessons: 36 },
        controls: { secondaryGroups: 1, secondaryChildren: 2, secondaryLessons: 2, nonEducationBookings: 1 },
        sqlHistoricalSummary: sqlSummary, relationshipViolations: relational, reachableContacts: contacts, activeTeacherCount: activeTeachers.length };
}

module.exports = { OWNER, OWNER_KEY, DATABASES, FIXED_ANCHOR, assertLocalTarget, addDays, kyivDate, buildPlan,
    roster, expectedReport, seedDataset, preflight };
