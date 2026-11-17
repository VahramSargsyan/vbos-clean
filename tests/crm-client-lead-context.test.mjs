import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const intake=readFileSync(new URL('../crm-lead-intake.mjs',import.meta.url),'utf8');
const begin=source.indexOf('function crmClientLeadContextView(){');
const end=source.indexOf('function crmView(){',begin);
assert.ok(begin>=0&&end>begin);
const fragment=source.slice(begin,end);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
const formField=(name,label,kind='text',required=false,extra='')=>{
 const field=kind==='textarea'?'<textarea name="'+name+'" '+extra+'></textarea>':
  '<input name="'+name+'" type="'+kind+'" '+extra+(required?' required':'')+'>';
 return '<label>'+esc(label)+field+'</label>';
};
function view(client,id=client?.id,archivedLegacyClientIds=[],snapshot=null){
 const ctx=vm.createContext({data:{clients:client?[client]:[],archivedLegacyClientIds},
  crmClientLeadContext:{clientId:id||'missing',clientSnapshot:snapshot},esc,formField});
 vm.runInContext(fragment,ctx,{filename:'crm-client-lead-context.js'});
 return vm.runInContext('crmClientLeadContextView()',ctx);
}

test('Client form reuses exact ID, preloads editable fields and escapes HTML',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const ui=view({id,name:'ИП <Test> "А"',phone:'+374 91 234 567',status:'active'});
 assert.ok(ui.includes('data-crm-client-lead-context="'+id+'"'));
 assert.ok(ui.includes('name="clientId" value="'+id+'"'));
 assert.match(ui,/data-act="lead_create" data-client-lead-form/);
 assert.match(ui,/name="title"[^>]*required/);
 assert.ok(ui.includes('value="ИП &lt;Test&gt; &quot;А&quot;"'));
 assert.ok(ui.includes('value="+374 91 234 567"'));
 assert.doesNotMatch(ui,/<Test>|data-act="client_create"/);
 assert.match(ui,/Объект сейчас не привязывается/);
});

test('Missing, archived and legacy-archived Clients cannot create from contextual form',()=>{
 for(const [client,legacy] of [
  [{id:'a',name:'Archived',status:'archived'},[]],
  [{id:'b',name:'Legacy',status:'active'},['b']],
  [null,[]]
 ]){
  const ui=view(client,client?.id||'missing',legacy);
  assert.match(ui,/role="alert"/);
  assert.match(ui,/data-crm-client-lead-back/);
  assert.doesNotMatch(ui,/data-client-lead-form/);
 }
});

test('Search-only Client beyond first 500 supports contextual Lead and returns to Search',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const snapshot={id,name:'Найденный клиент',phone:'099223344',status:'active'};
 const ui=view(null,id,[],snapshot);
 assert.match(ui,/data-client-lead-form/);
 assert.ok(ui.includes('name="clientId" value="'+id+'"'));
 assert.ok(ui.includes('value="Найденный клиент"'));
 assert.ok(source.includes("tab==='catalog'&&catalog.entity==='clients'?catalog.items.find(client=>client.id===id):null"));
 assert.ok(source.includes("tab=source==='catalog'?'catalog':'clients'"));
 assert.ok(source.includes('clientSnapshot:{id:chosen.id,name:chosen.name,phone:chosen.phone,status:chosen.status}'));
 const denied=view(null,id,[id],snapshot);
 assert.doesNotMatch(denied,/data-client-lead-form/);
});
test('Navigation preserves existing repeat-order shortcut and blocks mismatched Client',()=>{
 for(const marker of ['data-client-new-lead','+ Новое обращение',
  '+ Повторная работа для существующего клиента','data-crm-client-lead-back',
  "new FormData(f).get('clientId')!==crmClientLeadContext.clientId",
  'if(crmClientLeadContext)return crmClientLeadContextView()'])assert.ok(source.includes(marker),marker);
 assert.match(source,/if\(fromClientLead\)\{crmClientLeadContext=null;crmDetailId=null;\}/);
 assert.match(source,/if\(fromClientLead&&out\.item\?\.id\)/);
});

test('Existing CRM02 writer links one Lead to selected Client without new Object',()=>{
 assert.match(server,/if\(type==='lead_create'&&p\.clientId\)return createLeadForExistingClient/);
 assert.match(intake,/INSERT INTO public\.mvp_crm_lead_intakes/);
 assert.match(intake,/selected\.status==='archived'/);
 assert.match(intake,/payload_sha256/);
 assert.match(intake,/ROLLBACK/);
 assert.doesNotMatch(fragment,/fetch\(|pool\.query|\bINSERT\b|\bUPDATE\b|order_create|object_create/);
});

const submitMarker=' const type=f.dataset.act;if(!type)return;';
const submitStart=source.indexOf(submitMarker,source.indexOf("$('#content').addEventListener('submit'"));
const submitEnd=source.indexOf(' await sendAction(type,payload,f);',submitStart);
assert.ok(submitStart>=0&&submitEnd>submitStart,'The real delegated submit handler must be found');
const submitHandlerFragment=source.slice(submitStart,submitEnd+' await sendAction(type,payload,f);'.length);

// Execute the ACTUAL delegated submit handler, not only its form HTML. This
// catches ReferenceError/TDZ errors before network dispatch, missed by UI tests.
async function simulateClientLeadSubmit(formClientId,selectedClientId){
 const sent=[],notices=[];
 const fields={
  clientId:formClientId,title:'Осмотр отопления',contactName:'Клиент',
  phone:'',notes:''
 };
 const f={
  dataset:{act:'lead_create'},
  hasAttribute:name=>name==='data-client-lead-form',
  reportValidity:()=>true
 };
 class TestFormData {
  constructor(form){assert.equal(form,f);}
  get(name){return fields[name]??null;}
  entries(){return Object.entries(fields)[Symbol.iterator]();}
 }
 await vm.runInNewContext('(async()=>{'+submitHandlerFragment+'})()',{
  f,FormData:TestFormData,
  crmClientLeadContext:selectedClientId?{clientId:selectedClientId}:null,
  message:(text,isError)=>notices.push({text,isError}),
  sendAction:async(type,payload,form)=>sent.push({
   type,payload:JSON.parse(JSON.stringify(payload)),exactForm:form===f
  }),
  tab:'crm'
 },{timeout:1500});
 return {sent,notices};
}

test('Actual Client → Lead submit dispatches exactly once with the selected Client ID',async()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const out=await simulateClientLeadSubmit(id,id);
 assert.equal(out.sent.length,1,'Submit must reach sendAction without ReferenceError');
 assert.equal(out.sent[0].type,'lead_create');
 assert.equal(out.sent[0].payload.clientId,id);
 assert.equal(out.sent[0].payload.title,'Осмотр отопления');
 assert.equal(out.sent[0].exactForm,true);
 assert.equal(out.notices.length,0);
});

test('Contextual submit fails closed if Client ID changed or context disappeared',async()=>{
 const a='11111111-1111-4111-8111-111111111111';
 const b='22222222-2222-4222-8222-222222222222';
 for(const [formId,selectedId] of [[b,a],[a,null]]){
  const out=await simulateClientLeadSubmit(formId,selectedId);
  assert.equal(out.sent.length,0,'Stale Client must not reach server');
  assert.equal(out.notices.length,1);
  assert.match(out.notices[0].text,/клиент изменился/i);
  assert.equal(out.notices[0].isError,true);
 }
});
