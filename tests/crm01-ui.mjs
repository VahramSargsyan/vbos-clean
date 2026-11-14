/* Static source-contract UI smoke; NOT an authenticated Android browser test. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const orders=readFileSync(new URL('../order-schedule.mjs',import.meta.url),'utf8');
const conversion=readFileSync(new URL('../crm-lead-conversion.mjs',import.meta.url),'utf8');
const handoff=readFileSync(new URL('../crm-won-order-handoff.mjs',import.meta.url),'utf8');
assert.match(app,/function crmLeadConversion\(/);
assert.match(app,/data-act="lead_convert"/);
assert.match(app,/data-crm-open-client/);
assert.match(app,/leadClientLinks/);
assert.match(app,/source.*order|Источник заказа/);
assert.match(app,/function crmPhoneKey\(/);
assert.match(app,/data-crm-won-handoff/);
assert.match(app,/data-crm-won-order-open/);
assert.match(app,/function crmWonOrderModalHtml\(/);
assert.match(app,/function crmWonOrderOpen\(/);
assert.match(app,/data-act="crm_won_order_create"/);
assert.match(app,/name="objectMode"/);
assert.match(app,/name="objectName"/);
assert.match(app,/data-crm-won-new/);
assert.match(app,/crmWonOrderOpen\(payload\.leadId\)/);
assert.match(app,/crmWonOrderFeedback\('Не сохранено:/);
assert.match(app,/crmWonOrderClose\(true\)/);
assert.match(app,/data-crm-open-order/);
assert.match(app,/data-act="crm_won_order_create"/);
assert.match(conversion,/CRM01_AGREEMENT/);
assert.match(conversion,/INSERT INTO public\.mvp_crm_interactions/);
assert.match(conversion,/await archiveLeadReminderTx\(client,leadId\)/);
assert.match(server,/if\(type==='lead_convert'\)return leadConversionAction/);
assert.match(server,/if\(type==='crm_won_order_create'\)return crmWonOrderCreate/);
assert.match(handoff,/validateOrderLeadContext\(c,leadId,objectId,AppError\)/);
assert.match(handoff,/syncWorkOrderScheduleTx\(c,order\)/);
assert.match(handoff,/await c\.query\('ROLLBACK'/);
assert.match(handoff,/INSERT INTO public\.mvp_objects/);
assert.match(handoff,/INSERT INTO public\.mvp_orders/);
assert.match(handoff,/mvp_order_schedule_requests/);
assert.match(server,/if\(p\.status==='won'\)throw new AppError\(409/);
assert.match(orders,/await validateOrderLeadContext\(client,sourceLead,objectId,AppError\)/);
assert.doesNotMatch(app,/statusButtons\(x,'lead_status',\['new','contacted','qualified','won'/);

// Real UI rendering smoke with isolated dynamic state: new Client with 0 Objects
// must have a first-class New Object + Order form (not a detour to Client).
const from=app.indexOf('function crmLeadConversion(');
const to=app.indexOf('function leadEdit(',from);
assert.ok(from>0&&to>from);
const fake={
 data:{leads:[{id:'LEAD-1',title:'Монтаж водопровода',contact_name:'Тест',status:'won'}],
  leadClientLinks:[{lead_id:'LEAD-1',client_id:'CLIENT-1',object_id:null}],
  clients:[{id:'CLIENT-1',name:'Клиент'}],objects:[],orders:[],today:'2026-11-12'},
 esc:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
 ids:(kind,id)=>fake.data[kind]?.find(x=>x.id===id)||null,
 label:{open:'Открыт',won:'Успешно'},
 crmPhoneKey:x=>String(x||''),
 option:()=>'<option value="">Новое</option>',
 select:(n)=>'<select name="'+n+'"></select>',
 formField:(n)=>'<input name="'+n+'">',
};
vm.createContext(fake);
vm.runInContext(app.slice(from,to),fake,{filename:'crm-won-handoff-ui.js'});
const empty=vm.runInContext('crmWonOrderModalHtml("LEAD-1")',fake);
assert.match(empty,/data-act="crm_won_order_create"/);
assert.match(empty,/name="objectMode" value="new" checked/);
assert.match(empty,/name="objectName"/);
assert.match(empty,/name="title"[^>]*Монтаж водопровода/);
assert.doesNotMatch(empty,/Сначала открой клиента/);
const won=vm.runInContext('crmLeadConversion(data.leads[0])',fake);
assert.match(won,/data-crm-won-order-open="LEAD-1"/);
fake.data.objects=[{id:'OBJ-1',client_id:'CLIENT-1',name:'Квартира 1'}];
const existing=vm.runInContext('crmWonOrderModalHtml("LEAD-1")',fake);
assert.match(existing,/name="objectMode" value="existing" checked/);
assert.match(existing,/name="objectMode" value="new"/);
assert.match(existing,/OBJ-1/);
fake.data.leadClientLinks[0].object_id='OBJ-1';
const pinned=vm.runInContext('crmWonOrderModalHtml("LEAD-1")',fake);
assert.doesNotMatch(pinned,/name="objectMode" value="new"/);
assert.match(pinned,/Объект уже привязан/);
fake.data.leadClientLinks=[];
fake.data.leads[0].status='new';fake.data.leads[0].revision=1;
const fresh=vm.runInContext('crmLeadConversion(data.leads[0])',fake);
assert.match(fresh,/data-act="lead_convert"/);
assert.match(fresh,/Подтвердить и перейти к заказу/);
console.log('CRM_WON_POST_CONVERSION_MODAL_NEW_AND_EXISTING_OBJECT_UI_VM_PASS');

console.log('CRM01_UI_STATIC_NO_DIRECT_WON_AND_EXPLICIT_CONVERSION_LINK_PASS');
