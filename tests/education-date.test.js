'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../js/booking.js'),'utf8');
function context(raw='2030-03-31'){
    const control={value:raw};const selected=new Date('2026-10-03T12:00:00');
    const ctx={Date,Number,String,document:{getElementById:()=>control},AppState:{selectedDate:selected},isEducationTimelineBookingMode:()=>true};vm.createContext(ctx);
    vm.runInContext(source.slice(source.indexOf('function educationLessonDateKey()'),source.indexOf('function educationLessonDurationMinutes()')),ctx);
    return {ctx,control,selected};
}
test('education civil dates validate real calendar days, leap years and Kyiv DST boundaries',()=>{
    const {ctx,control}=context();
    for(const date of ['0001-01-01','2028-02-29','2030-03-31','2030-10-27','2030-12-31','2031-01-01','9999-12-31']){control.value=date;assert.equal(ctx.educationLessonDateKey(),date);}
    for(const date of ['','2030-02-29','2030-02-30','2030-13-01','2030-00-10','0000-01-01','2030-1-01','2030-01-01T00:00:00Z']){control.value=date;assert.equal(ctx.educationLessonDateKey(),'');}
});
test('education form date uses local noon without mutating the viewed timeline; Park keeps its original Date object',()=>{
    const {ctx,control,selected}=context();const result=ctx.bookingFormDate();
    assert.equal(result.getFullYear(),2030);assert.equal(result.getMonth(),2);assert.equal(result.getDate(),31);assert.equal(result.getHours(),12);assert.equal(ctx.AppState.selectedDate,selected);
    ctx.isEducationTimelineBookingMode=()=>false;control.value='2031-01-01';assert.equal(ctx.bookingFormDate(),selected);
});
test('hydration uses canonical lesson date and explains single-member series scope',()=>{
    const elements={educationLessonDate:{value:''},educationLessonDateHint:{textContent:''},educationLessonDuration:{value:''}};
    const ctx={document:{getElementById:id=>elements[id]},isEducationTimelineBookingMode:()=>true,educationLessonDetailsFromBooking:b=>b.extraData.educationLesson};vm.createContext(ctx);
    const start=source.indexOf('function hydrateEducationLessonFields(');vm.runInContext(source.slice(start,source.indexOf('\nfunction ',start+1)),ctx);
    ctx.hydrateEducationLessonFields({date:'2030-12-31',duration:45,extraData:{educationLesson:{seriesId:'synthetic-series'}}});
    assert.equal(elements.educationLessonDate.value,'2030-12-31');assert.equal(elements.educationLessonDuration.value,45);assert.match(elements.educationLessonDateHint.textContent,/лише це заняття/);
});
test('education slot preview queries the form date while Park still queries the original timeline date',async()=>{
    const {ctx,control,selected}=context('2030-11-02');let queried;const states=[];
    Object.assign(ctx,{console,isLatestBookingTimeChangeToken:()=>true,getBookingFormData:()=>({time:'11:30',duration:45,hasEvent:true}),bookingEditConflictExcludeIds:()=>['synthetic-id'],bookingMultiActivityEnabled:()=>false,setSelectedActivityScheduleIssues(){},getBookingsForDate:async date=>{queried=date;return[];},existingScheduleBookingsForValidation:rows=>rows,bookingTimeSingleSlotPreflightIssues:()=>[],setBookingTimePreflightState:status=>states.push(status),renderBookingPackageSummary(){}});
    const start=source.indexOf('async function validateBookingTimeChangePreflight(');vm.runInContext(source.slice(start,source.indexOf('function scheduleBookingTimePreflightRefresh(',start)),ctx);
    await ctx.validateBookingTimeChangePreflight(1);assert.equal(queried.getDate(),2);assert.equal(queried.getMonth(),10);assert.equal(queried.getFullYear(),2030);assert.equal(states.at(-1),'free');assert.equal(ctx.AppState.selectedDate,selected);
    ctx.isEducationTimelineBookingMode=()=>false;control.value='2031-01-01';await ctx.validateBookingTimeChangePreflight(2);assert.equal(queried,selected);
});
