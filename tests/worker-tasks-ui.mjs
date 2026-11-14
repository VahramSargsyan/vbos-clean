import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const id='11111111-1111-4111-8111-111111111111';
const worker='22222222-2222-4222-8222-222222222222';
const order='33333333-3333-4333-8333-333333333333';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sandbox={
 data:null,fmt:v=>String(Number(v||0)),esc,
 editText:(name,label,value)=>'<label>'+esc(label)+'<input name="'+esc(name)+'" value="'+esc(value)+'"></label>',
 select:(name,label,options)=>'<label>'+esc(label)+'<select name="'+esc(name)+'">'+options+'</select></label>'
};
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../public/workers.js',import.meta.url),'utf8'),sandbox,{filename:'workers.js'});
const day={id,worker_id:worker,day_date:'2026-11-04',arrival_at:'2026-11-04T08:50',status:'open'};
const links=[{worker_day_id:id,work_order_id:order,status:'active'}];
const data={workers:[],orders:[{id:order,title:'Прокладка труб',status:'active'}],workerTasks:[]};
const view=(d=data,dayRow=day)=>{
 sandbox.data=d;
 return vm.runInContext('workerTaskPanel('+JSON.stringify(dayRow)+','+JSON.stringify(links)+')',sandbox);
};
const initial=view();
assert.match(initial,/data-act="worker_task_start"/);
assert.match(initial,/name="workerDayId"/);
assert.match(initial,/name="orderId"/);
assert.doesNotMatch(initial,/data-act="worker_task_finish"/);
console.log('V9E_WORKER_TASK_UI_START_FORM_PASS');

const active={id:'44444444-4444-4444-8444-444444444444',worker_day_id:id,status:'active',start_at:'2026-11-04T09:00',end_at:'',revision:1,task_type:'WORK_SESSION',notes:''};
const busy=view({...data,workerTasks:[active]});
assert.match(busy,/data-act="worker_task_finish"/);
assert.match(busy,/name="managementMinutes"/);
assert.match(busy,/name="outcome"/);
assert.doesNotMatch(busy,/data-act="worker_task_start"/);
console.log('V9E_WORKER_TASK_UI_FINISH_FORM_AND_ONE_ACTIVE_PASS');

const complete={...active,status:'completed',end_at:'2026-11-04T10:10',duration_minutes:70,task_type:'Прокладка труб',result_qty:'12.5',result_unit:'м',management_minutes:5,outcome:'COMPLETED',problem:false,rework:false};
const history=view({...data,workerTasks:[complete]});
assert.match(history,/Прокладка труб/);
assert.match(history,/12.5/);
assert.match(history,/70 мин/);
assert.doesNotMatch(history,/data-act="worker_task_finish"/);
console.log('V9E_WORKER_TASK_UI_SAVED_RESULT_PASS');

const malicious=view({...data,orders:[{id:order,title:'<img src=x onerror=alert(1)>',status:'active'}]});
assert.match(malicious,/&lt;img src=x onerror=alert\(1\)&gt;/);
assert.doesNotMatch(malicious,/<img src=x/);
console.log('V9E_WORKER_TASK_UI_HTML_ESCAPING_PASS');

const closed=view({...data,workerTasks:[]},{...day,status:'closed'});
assert.doesNotMatch(closed,/data-act="worker_task_start"/);
assert.doesNotMatch(closed,/data-act="worker_task_finish"/);
console.log('V9E_WORKER_TASK_UI_CLOSED_DAY_NO_ACTION_PASS');
