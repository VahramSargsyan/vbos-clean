import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('acceptance is explicit, revisioned, atomic and nonfinancial',()=>{
 const s=read('../estimate-handoff.mjs'),sql=read('../migrations/0024_crm16a_estimate_handoff_TEST_ONLY.sql');
 const app=read('../public/app.js'),server=read('../server.mjs');
 assert.match(s,/p\.confirm!=='ACCEPT_AND_CREATE_OPEN_ORDER'/);
 assert.match(s,/FOR UPDATE/);assert.match(s,/BEGIN/);assert.match(s,/ROLLBACK/);
 assert.match(s,/INSERT INTO public\.mvp_orders/);
 assert.match(s,/source_lead_id/);assert.match(s,/unit_price_amd IS NULL/);
 assert.match(s,/request_key,estimate_id,payload_sha256/);
 assert.doesNotMatch(s,/INSERT INTO public\.mvp_finance|mvp_finance_transactions/i);
 assert.match(sql,/mvp_estimates_status_check/);
 assert.match(sql,/mvp_estimate_handoff_requests/);
 assert.match(app,/data-act="estimate_accept_handoff"/);
 assert.match(server,/if\(type==='estimate_accept_handoff'\)/);
});
