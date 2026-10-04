'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {applyEducationSeriesTeacher: apply}=require('../services/educationSeriesTeacher');
const readLesson=p=>p.extraData?.educationLesson;
const writeLesson=(p,lesson)=>{p.extraData={...p.extraData,educationLesson:lesson};};
test('series teacher normalization touches only explicit education lesson metadata',()=>{
    for(const metadata of [undefined,{mode:'park',teacherId:'park-id',teacherName:'Park'},{teacherId:'legacy',teacherName:'Legacy'}]) {
        const candidates=[{id:'stable',date:'2030-01-01',extraData:metadata?{educationLesson:metadata}:{package:{name:'Park'}}}];
        const before=JSON.stringify(candidates);apply(candidates,{mode:'education_lesson',teacherId:'100',teacherName:'Олена Ковальчук'},readLesson,writeLesson);
        assert.equal(JSON.stringify(candidates),before,'Non-education/legacy candidate must stay unchanged');
    }
    const rows=[{id:'stable',date:'2030-01-01',extraData:{other:'keep',educationLesson:{mode:'education_lesson',teacherId:'100',teacherName:'Spoofed',title:'Знайомство'}}}];
    apply(rows,{mode:'education_lesson',teacherId:'100',teacherName:'Олена Ковальчук'},readLesson,writeLesson);
    assert.equal(rows[0].extraData.educationLesson.teacherName,'Олена Ковальчук');
    assert.equal(rows[0].extraData.other,'keep');assert.equal(rows[0].id,'stable');assert.equal(rows[0].date,'2030-01-01');
});
