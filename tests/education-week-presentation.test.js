'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
function fixture(mode) {
 const source=fs.readFileSync(path.join(__dirname,'../js/timeline.js'),'utf8');
 const start=source.indexOf('function renderMiniLineHtml('),end=source.indexOf('async function renderMultiDayTimeline',start);
 const dom=new JSDOM('<body><input id="timelineDate"></body>'),opened=[];
 const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const ctx=vm.createContext({window:{TimelineBusinessContext:{presentation:()=>({mode})}},document:dom.window.document,AppState:{statusFilter:'all',selectedDate:'2026-10-03'},CONFIG:{TIMELINE:{CELL_MINUTES:15}},Date,escapeHtml,
  timeToMinutes:value=>{const [h,m]=value.split(':').map(Number);return h*60+m;},
  timelineLineResourceIdentity:line=>({resourceId:line.id,resourceType:'manual'}),timelineBookingResourceIdentity:booking=>({resourceId:booking.lineId,resourceType:'manual'}),
  timelineBookingBoundaryStatus:()=>({overrun:false}),bookingCostumeLabel:()=>'',timelineActivityPresentation:booking=>({fullTitle:booking.programName,code:booking.programCode,categoryCode:'other',productCode:'lesson'}),
  timelineBookingBlockDensity:()=> 'compact',timelineCompactLabelRenderModel:()=>({segments:['ІНШ','Заняття'],characterCount:11,tokenCount:2,maxTokenLength:7,layout:'stacked'}),
  setTimelineDateInUrl:date=>opened.push({date}),showBookingDetails:(id,options)=>opened.push({id,trigger:options.triggerEl})});
 vm.runInContext(source.slice(start,end),ctx);return {ctx,dom,opened};
}
function booking() {return {id:'lesson-owned',lineId:'room-owned',time:'11:30',duration:45,date:'2026-10-03',category:'other',status:'confirmed',programCode:'ІНШ',programName:'Заняття',room:'Кабінет 2',extraData:{educationLesson:{mode:'education_lesson',title:'Кольори <осені> & світло',teacherName:'Ірина Бондар',groupName:'Творча майстерня'}}};}
function render(f,b) {f.dom.window.document.body.insertAdjacentHTML('beforeend','<div class="day-section" data-date="2026-10-03">'+f.ctx.renderMiniLineHtml({id:'room-owned',color:'#047857',name:'Кабінет 2'},[b],9,18,30)+'</div>');return f.dom.window.document.querySelector('.mini-booking-block');}
test('education week presents escaped topic and keyboard canonical opening without record mutation',()=>{
 const f=fixture('education'),b=booking(),before=JSON.stringify(b),el=render(f,b);
 assert.equal(el.dataset.bookingId,b.id);assert.equal(el.dataset.resourceId,b.lineId);assert.equal(el.dataset.timelineCategoryCode,'other');assert.equal(el.dataset.timelineProductCode,'lesson');
 assert.equal(el.querySelector('.mini-education-topic').textContent,b.extraData.educationLesson.title);assert.equal(el.querySelector('script'),null);assert.equal(el.tabIndex,0);assert.equal(el.getAttribute('role'),'button');assert.ok(el.getAttribute('aria-label').includes('45 хв'));
 f.ctx.attachMultiDayListeners();for(const key of ['Enter',' '])el.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
 assert.equal(f.opened.filter(row=>row.id===b.id&&row.trigger===el).length,2);assert.equal(JSON.stringify(b),before);f.dom.window.close();
});
test('Park week retains generic activity labels and identity even with old education metadata',()=>{
 const f=fixture('event'),b=booking(),before=JSON.stringify(b),el=render(f,b);
 assert.equal(el.querySelector('.mini-education-topic'),null);assert.deepEqual([...el.querySelectorAll('.timeline-code-token')].map(n=>n.textContent),['ІНШ','Заняття']);assert.equal(el.classList.contains('education-lesson'),false);assert.equal(el.hasAttribute('tabindex'),false);assert.equal(el.hasAttribute('role'),false);
 assert.equal(el.dataset.bookingId,b.id);assert.equal(el.dataset.resourceId,b.lineId);assert.ok(el.getAttribute('aria-label').includes('11:30'));assert.equal(JSON.stringify(b),before);f.dom.window.close();
});

test('week day reuses education loaded range and preserves Park hours', async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../js/timeline.js'),'utf8');
 const code=source.slice(source.indexOf('async function renderDaySectionHtml('),source.indexOf('function renderMiniLineHtml('));
 for(const [mode,expected]of [['education',9],['park',10]]){
  let loaded=false;const ctx=vm.createContext({AppState:{linesByDate:{}},CONFIG:{TIMELINE:{WEEKEND_START:10,WEEKEND_END:20}},DAYS:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],MONTHS_SHORT_UKR:Array(12).fill('month'),
   getLinesForDate:async()=>[],getBookingsForDate:async()=>{loaded=true;return [];},normalizeTimelineLinesForContext:x=>x,normalizeTimelineBookingsForContext:x=>x,formatDate:()=> '2026-10-03',getTimeRange:()=>{assert.equal(loaded,true);return {start:mode==='education'?9:10,end:20};},renderMiniTimeScaleHtml:(start,end)=> '<div data-range-start="'+start+'"></div>'});
  vm.runInContext(code,ctx);const html=await ctx.renderDaySectionHtml(new Date(2026,9,3));assert.ok(html.includes('data-range-start="'+expected+'"'));assert.ok(html.includes(String(expected).padStart(2,'0')+':00-20:00'));
 }
});
