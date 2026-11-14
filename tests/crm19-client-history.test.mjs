import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {crmInteractionsPage} from '../crm-interactions.mjs';

const legacy=readFileSync(new URL('../../../CrmService.js',import.meta.url),'utf8');
const current=readFileSync(new URL('../crm-interactions.mjs',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

class AppError extends Error{
 constructor(status,message){super(message);this.status=status;}
}
const id='00000000-0000-4000-8000-000000000001';
const iid='00000000-0000-4000-8000-000000000002';
const uuid=s=>{if(!/^[0-9a-f-]{36}$/.test(s))throw new AppError(400,'UUID invalid');return s;};
const make=url=>new URL(url,'http://test.local');
test('legacy primary source merges exact Client/Lead interaction groups with dedup and createdAt descending',()=>{
 for(const symbol of ['function getClientService_','function getRelatedLeadsForClient_','function mergeInteractionHistory_','before_client','repeat_lead','after_client']){
  assert.ok(legacy.includes(symbol),symbol);
 }
 assert.match(legacy,/if \(!id \|\| seen\[id\]\) return/);
 assert.match(legacy,/String\(b\.interactionId \|\| ''\)\.localeCompare/);
});
test('owner API Client merged mode is auth-scoped and query relies ONLY on exact canonical link IDs',async()=>{
 const queries=[];
 const pool={async query(sql,args){queries.push({sql,args});if(sql.startsWith('SELECT id FROM'))return {rowCount:1,rows:[{id}]};
  return {rowCount:1,rows:[{
   id:iid,entity_type:'Lead',lead_id:id,client_id:null,interaction_type:'call',
   contact_on:'2026-11-07',summary:'synthetic',next_action:'',next_action_on:null,
   notes:'',status:'active',created_at:new Date('2026-11-08T07:00:00Z'),
   history_stage:'converted_lead',lead_title:'Synthetic related lead'
  }]};}};
 const r=await crmInteractionsPage({pool,url:make('/api/crm/interactions?entityType=Client&entityId='+id+'&unified=1'),uuid,AppError});
 assert.equal(r.unified,true);assert.equal(r.coverage,'CLEAN_LINKED_INTERACTIONS_ONLY');
 assert.equal(r.historicalGoogleImported,false);
 assert.equal(r.items[0].historyStage,'converted_lead');
 assert.equal(r.items[0].leadTitle,'Synthetic related lead');
 assert.ok(queries[1].sql.includes('public.mvp_crm_lead_client_links'));
 assert.ok(queries[1].sql.includes('public.mvp_crm_lead_intakes'));
 assert.ok(queries[1].sql.includes('GROUP BY lead_id'));
 assert.ok(queries[1].sql.includes('i.lead_id=r.lead_id'));
 assert.ok(queries[1].sql.includes('i.client_id=$1'));
 assert.ok(!/\bphone\b|\bname\b/i.test(queries[1].sql),'no inferred phone/name relation');
 assert.deepEqual(queries[1].args,[id,21]);
 assert.equal(r.items.length,1);
 assert.equal(r.nextCursor,null);
});
test('unified flag fails closed on Lead and on unknown values, and cursor/limit validation preserved',async()=>{
 const pool={async query(){throw Error('must not query for invalid params');}};
 for(const url of [
  '/api/crm/interactions?entityType=Lead&entityId='+id+'&unified=1',
  '/api/crm/interactions?entityType=Client&entityId='+id+'&unified=wrong',
  '/api/crm/interactions?entityType=Client&entityId='+id+'&unified=1&limit=41',
  '/api/crm/interactions?entityType=Client&entityId='+id+'&unified=1&cursor=not-a-cursor'
 ]) await assert.rejects(()=>crmInteractionsPage({pool,url:make(url),uuid,AppError}),e=>e.status===400);
});
test('existing Lead and direct Client history remain unaffected; UI uses unified only for Client',()=>{
 assert.match(current,/unified\?{/);
 assert.match(current,/entityType:scope\.entityType/);
 assert.match(ui,/state\.entityType==='Client'\?'&unified=1':''/);
 assert.match(ui,/Единая история клиента/);
 assert.match(ui,/Исторические Google-взаимодействия ещё не импортированы/);
 assert.match(ui,/converted_lead:'Связанный лид · преобразование'/);
 assert.match(ui,/repeat_lead:'Повторное обращение'/);
 assert.match(ui,/after_client:'Контакт клиента'/);
 assert.match(ui,/crmInteractionView\('Lead',x\.id\)/);
 assert.match(ui,/crmInteractionView\('Client',x\.id\)/);
 assert.match(ui,/data-act="crm_interaction_add"/);
});
