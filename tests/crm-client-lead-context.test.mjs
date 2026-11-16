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
function view(client,id=client?.id,archivedLegacyClientIds=[]){
 const ctx=vm.createContext({data:{clients:client?[client]:[],archivedLegacyClientIds},
  crmClientLeadContext:{clientId:id||'missing'},esc,formField});
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

test('Navigation preserves existing repeat-order shortcut and blocks mismatched Client',()=>{
 for(const marker of ['data-client-new-lead','+ Новое обращение',
  '+ Повторная работа для существующего клиента','data-crm-client-lead-back',
  'crmClientLeadContext={clientId:id}','payload.clientId!==crmClientLeadContext.clientId',
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
