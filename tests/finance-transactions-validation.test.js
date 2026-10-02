'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const {MAX_FINANCE_AMOUNT,normalizeFinanceTransactionAmount}=require('../utils/financeAmounts');

test('finance accepts whole hryvnia numbers and decimal integer strings within PostgreSQL INTEGER range',()=>{
 for(const [input,expected] of [[1,1],[100,100],['100',100],[' 00100 ',100],[MAX_FINANCE_AMOUNT,MAX_FINANCE_AMOUNT]]){
  assert.equal(normalizeFinanceTransactionAmount(input),expected);
 }
});
test('finance rejects lossy, malformed, nonnumeric and out-of-range amounts',()=>{
 for(const input of [undefined,null,'',' ',0,-1,0.5,12.99,NaN,Infinity,-Infinity,'12abc','abc','1.0','1e2','0x10','+100','Infinity','NaN',true,false,[],[100],{},MAX_FINANCE_AMOUNT+1,Number.MAX_SAFE_INTEGER]){
  assert.throws(()=>normalizeFinanceTransactionAmount(input),e=>e.status===400&&e.code==='finance_amount_invalid',String(input));
 }
});
function formRuntime(value,editingId=null,error=null){
 const dom=new JSDOM('<button id="saveTransBtn">Save</button><input id="editType" value="expense"><input id="editCategory"><input id="editAmount"><input id="editDate" value="2099-01-15"><input id="editPayment"><input id="editDescription"><div id="modal"></div>');
 dom.window.document.getElementById('editAmount').value=value;
 const calls=[],notifications=[];let closed=false,refreshed=false;
 const context=vm.createContext({document:dom.window.document,financeCanManageTransactions:()=>true,FinState:{editingId},showNotification:(...args)=>notifications.push(args),apiRequest:async(...args)=>{calls.push(args);if(error)throw error;},closeTransModal:async()=>{closed=true;},refreshData:()=>{refreshed=true;}});
 const source=fs.readFileSync(path.join(__dirname,'../js/finance-page.js'),'utf8');
 vm.runInContext(source.slice(source.indexOf('async function saveTransaction()'),source.indexOf('async function deleteTransaction(')),context);
 dom.window.document.getElementById('saveTransBtn').addEventListener('click',()=>{context.pending=context.saveTransaction();});
 return {dom,context,calls,notifications,get closed(){return closed;},get refreshed(){return refreshed;}};
}
test('finance form clicks reject fractions without a request or closing the editor',async()=>{
 for(const value of ['12.99','12abc','0','-2','2147483648','']){
  const f=formRuntime(value);try{f.dom.window.document.getElementById('saveTransBtn').click();await f.context.pending;assert.equal(f.calls.length,0);assert.equal(f.closed,false);assert.match(f.notifications[0][0],/цілу суму/);assert.equal(f.dom.window.document.getElementById('saveTransBtn').disabled,false);}finally{f.dom.window.close();}
 }
});
test('finance valid create/edit clicks keep integer payloads and successful close behavior',async()=>{
 for(const editingId of [null,42]){
  const f=formRuntime(' 100 ',editingId);try{f.dom.window.document.getElementById('saveTransBtn').click();await f.context.pending;assert.equal(f.calls[0][0],editingId?'PUT':'POST');assert.equal(f.calls[0][2].amount,100);assert.equal(f.closed,true);assert.equal(f.refreshed,true);assert.equal(f.dom.window.document.getElementById('saveTransBtn').disabled,false);}finally{f.dom.window.close();}
 }
});
test('finance API validation error keeps the editor open and restores save button',async()=>{
 const error=Object.assign(new Error('Invalid amount'),{code:'finance_amount_invalid'});const f=formRuntime('100',42,error);
 try{f.dom.window.document.getElementById('saveTransBtn').click();await f.context.pending;assert.equal(f.closed,false);assert.equal(f.refreshed,false);assert.match(f.notifications.at(-1)[0],/цілу суму/);assert.equal(f.dom.window.document.getElementById('saveTransBtn').disabled,false);}finally{f.dom.window.close();}
});
