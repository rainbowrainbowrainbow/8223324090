'use strict';
const {describe,it,before,after}=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createAttendanceOcrHandlers}=require('../services/crmAttendanceOcrHttp');
describe('actual attendance OCR HTTP boundary',()=>{
 let server,base,calls,enabled=true;
 const saved={previewId:'11111111-1111-1111-1111-111111111111',previewHash:'a'.repeat(64),documentDate:'2026-09-29',expiresAt:'2099-01-01',rows:[{classification:'ready_for_confirmed_apply'}]};
 before(async()=>{
  calls=[];const env={get CRM_ATTENDANCE_OCR_ENABLED(){return enabled?'true':'false';}};
  const handlers=createAttendanceOcrHandlers({env,resolveContext:req=>req.headers['x-business-context'] || 'event_genix',preview:{
   async preview(value){calls.push(value);return saved;},async getPreview(value){calls.push(value);return saved;},
   async refreshPreview(value){calls.push(value);return saved;},async recoverPreview(value){calls.push(value);return saved;}
  },apply:async value=>{calls.push(value);return {attendanceWrites:1,reused:false};},afterApply:()=>{throw Error('Synthetic notification failure');}});
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:7};next();});
  app.get('/status',handlers.status);app.post('/preview',handlers.preview);app.get('/previews/:previewId',handlers.get);
  app.post('/refresh/:previewId',handlers.refresh);app.post('/recover',handlers.recover);app.post('/apply',handlers.apply);
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
 });
 after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 async function json(route,body,headers={}){const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
 it('reports disabled mode and rejects uploads before parsing or service work',async()=>{
  enabled=false;assert.equal((await json('/status')).body.enabled,false);
  const response=await json('/preview',{});assert.equal(response.status,503);assert.equal(calls.length,0);enabled=true;
 });
 it('rejects foreign context and body actor/context injection',async()=>{
  assert.equal((await json('/status',undefined,{'X-Business-Context':'dar'})).status,403);
  assert.equal((await json('/apply',{actor:{id:999},confirmed:true})).status,400);
  assert.equal((await json('/recover',{businessContext:'event_genix'})).status,400);assert.equal(calls.length,0);
 });
 it('binds saved read/recovery/refresh to server actor and enables only ready preview rows',async()=>{
  const got=await json('/previews/'+saved.previewId);assert.equal(got.body.applyAllowed,true);
  assert.equal(calls.at(-1).actor.id,7);assert.equal(calls.at(-1).businessContext,'event_genix');
  await json('/recover',{imageSha256:'b'.repeat(64),documentDate:'2026-09-29'});
  assert.equal(calls.at(-1).actor.id,7);
  await json('/refresh/'+saved.previewId,{});assert.equal(calls.at(-1).previewId,saved.previewId);
 });
 it('limits multipart memory and rejects additional fields before executing paid work',async()=>{
  const before=calls.length,body=new FormData();body.append('file',new Blob([Buffer.alloc(4*1024*1024+1)],{type:'image/png'}),'oversize.png');
  const response=await fetch(base+'/preview',{method:'POST',body});assert.equal(response.status,413);assert.equal(calls.length,before);
 });
 it('keeps a committed apply successful when its optional notification fails',async()=>{
  const response=await json('/apply',{previewId:saved.previewId,previewHash:saved.previewHash,selectedRowOrdinals:[1],confirmed:true});
  assert.equal(response.status,200);assert.equal(response.body.attendanceWrites,1);assert.equal(response.body.realtimeNotification,'unavailable');assert.equal(calls.at(-1).actor.id,7);
 });
});
