'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../js/booking.js'),'utf8');

function harness() {
 const context={window:{BookingPackageRenderer:{bookingPackageTicketLines:p=>p?.ticketLines||[],bookingPackageEntryChargeFromPackage:p=>p?.entryCharge||null}},getBookingWorkspaceFromBooking:b=>b.workspace,bookingDetailActivityScenarioLabel:()=>null,getBookingWorkspaceScenarioMeta:()=>({label:"Подія"}),shouldHideBookingWorkspaceScenarioDetail:b=>b.workspace?.scenario==='kitchen_only',getBookingPackageFromBooking:b=>b.bookingPackage||null,educationLessonDetailsFromBooking:b=>b.lesson||{},escapeHtml:String,canDeleteTimelineBooking:()=>false,educationLessonRepeatEveryLabel:String};
 vm.createContext(context);
 for(const name of ['renderBookingWorkspaceDetail','educationBookingPackageHasContent','renderEducationLessonDetail']) { const start=source.indexOf('function '+name+'(');const end=source.indexOf(name==='renderBookingWorkspaceDetail'?'function initBookingPackageWorkspace(':name==='educationBookingPackageHasContent'?'function renderEducationLessonDetail(':'function bookingSummaryPreviewUrl(',start+1);assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end),context); }
 return context;
}
test('education card omits only genuinely empty package data',()=>{
 const h=harness();assert.equal(h.educationBookingPackageHasContent({bookingPackage:{schemaVersion:1,finalTotal:0,menuPositions:[],serviceEvents:[]}}),false);
 for(const booking of [{price:350},{banquetMenu:'Фруктова тарілка'},{bookingPackage:{menuPositions:[{title:'Сік',price:0}]}},{bookingPackage:{serviceEvents:[{title:'Перерва'}]}},{bookingPackage:{ticketLines:[{title:'Вхід',price:0}]}},{bookingPackage:{entryCharge:{amount:0}}},{bookingPackage:{finalTotal:250}},{bookingPackage:{programBasePrice:250,finalTotal:0}},{bookingPackage:{notes:'Погоджена послуга'}}])assert.equal(h.educationBookingPackageHasContent(booking),true,JSON.stringify(booking));
});
test('education detail keeps one set of core fields, linked actions and optional standalone topic',()=>{
 const h=harness(),booking={date:'2030-01-10',time:'15:00',duration:45,room:'Майстерня',id:'synthetic',lesson:{title:'Зимові ритми',teacherName:'Віра Савченко',groupName:'Музична майстерня',groupId:7}};
 const html=h.renderEducationLessonDetail(booking,{includeTopic:false});
 assert.ok(!html.includes('Зимові ритми'));for(const label of ['Дата','Початок','Тривалість','Викладач','Група','Кабінет'])assert.equal(html.split(label+':').length-1,1,label);
 assert.ok(html.includes('45 хвилин'));assert.ok(html.includes('data-education-detail-group="7"'));assert.ok(html.includes('data-education-attendance-booking="synthetic"'));
 assert.ok(h.renderEducationLessonDetail(booking).includes('Зимові ритми'));
});

test('education scenario omission is explicit and preserves lead notes and Park defaults',()=>{
 const h=harness(),booking={workspace:{scenario:'event',leadDetails:{source:'Звернення представника',notes:'Матеріали погоджено'}}};
 const park=h.renderBookingWorkspaceDetail(booking),education=h.renderBookingWorkspaceDetail(booking,{hideScenario:true});
 assert.ok(park.includes('Сценарій:'));assert.ok(!education.includes('Сценарій:'));for(const value of ['Звернення представника','Матеріали погоджено']){assert.ok(park.includes(value));assert.ok(education.includes(value));}
 assert.ok(!h.renderBookingWorkspaceDetail({workspace:{scenario:'kitchen_only'}}).includes('Сценарій:'));
});
