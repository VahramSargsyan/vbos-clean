import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const moduleSource=readFileSync(new URL('../estimate-drafts.mjs',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const migration=readFileSync(new URL('../migrations/0016_crm05a_manual_estimate_drafts_TEST_ONLY.sql',import.meta.url),'utf8');

test('exact internal AMD formatter does not use floating point arithmetic',()=>{
 const i=app.indexOf('function estimateAMD(x){'),j=app.indexOf('function estimateCaptureForm(){',i);
 assert.ok(i>=0&&j>i);
 const fmt=x=>runInNewContext(app.slice(i,j)+';estimateAMD('+JSON.stringify(x)+')');
 assert.equal(fmt('4000.000'),'4 000 AMD');
 assert.equal(fmt('1234567.125'),'1 234 567,125 AMD');
 assert.equal(fmt('0.001'),'0,001 AMD');
 assert.equal(fmt('0'),'0 AMD');
 assert.equal(fmt('bad'),'—');
});
test('CRM is the sole editor surface; draft never auto-accepts or creates order',()=>{
 assert.match(app,/data-estimate-open/);
 assert.match(app,/data-act="estimate_create"/);
 assert.match(app,/data-act="estimate_save"/);
 assert.match(app,/data-estimate-add/);
 assert.match(app,/data-estimate-remove/);
 assert.match(app,/data-estimate-retry/);
 assert.match(app,/estimateCaptureForm/);
 assert.match(app,/Не оценено: /);
 assert.match(app,/Итог не окончательный/);
 assert.match(app,/Без НДС, скидок, счёта, отправки клиенту или создания заказа/);
 assert.match(server,/\/api\/estimates/);
 assert.match(server,/estimateDraftAction/);
 assert.match(moduleSource,/priceSource:unitPrice===null\?'UNPRICED':'OWNER_ENTERED'/);
 assert.match(moduleSource,/request_key,action,payload_sha256/);
 assert.match(migration,/status text NOT NULL DEFAULT 'draft' CHECK\(status='draft'\)/);
 assert.doesNotMatch(moduleSource,/INSERT INTO public\.mvp_orders/);
 assert.doesNotMatch(moduleSource,/mvp_finance/);
});
