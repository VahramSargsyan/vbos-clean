import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const id='11111111-1111-4111-8111-111111111111';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sandbox={esc,fmt:x=>String(Number(x||0)),render:()=>{},api:async()=>({}),editText:(name,label,value,kind)=>'<label>'+esc(label)+'<input name="'+esc(name)+'" value="'+esc(value)+'"></label>',data:{workers:[],workerDays:[],orders:[],workerTasks:[]}};
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../public/workers.js',import.meta.url),'utf8'),sandbox,{filename:'workers.js'});
const view=()=>vm.runInContext('workerBenchmarkPanel({id:'+JSON.stringify(id)+'})',sandbox);
assert.match(view(),/data-worker-benchmark-load=/);
assert.match(view(),/не утверждённый норматив/);
assert.match(view(),/не основание для зарплаты/);
vm.runInContext('workerBenchmarkCache['+JSON.stringify(id)+']='+JSON.stringify({loaded:true,payload:{from:'2026-08-07',to:'2026-11-04',sampleCount:2,items:[{taskType:'<img src=x onerror=alert(1)>',resultUnit:'м',sampleCount:2,totalResult:20,totalMinutes:120,observedPerHour:10,bestPerHour:15}]}}),sandbox);
const filled=view();
assert.match(filled,/Средний наблюдаемый темп: 10 м\/час/);
assert.match(filled,/Лучший зафиксированный темп: 15 м\/час/);
assert.match(filled,/&lt;img src=x onerror=alert\(1\)&gt;/);
assert.doesNotMatch(filled,/<img src=x/);
assert.match(filled,/задач: 2/);
console.log('V9F_WORKER_OBSERVATIONS_UI_MEAN_BEST_ESCAPING_PASS');
vm.runInContext('workerBenchmarkCache['+JSON.stringify(id)+']='+JSON.stringify({loaded:true,payload:{from:'2026-08-07',to:'2026-11-04',sampleCount:0,items:[]}}),sandbox);
assert.match(view(),/Это не означает нулевую производительность/);
console.log('V9F_NO_SAMPLES_NOT_ZERO_PRODUCTIVITY_PASS');

vm.runInContext('workerBenchmarkCache['+JSON.stringify(id)+']='+JSON.stringify({loaded:true,payload:{from:'2026-08-07',to:'2026-11-04',sampleCount:1,compareMode:'previous',previousFrom:'2026-05-09',previousTo:'2026-08-06',previousSampleCount:1,items:[{taskType:'Монтаж',resultUnit:'м',sampleCount:1,totalResult:20,totalMinutes:120,observedPerHour:10,bestPerHour:15,previousSampleCount:1,previousObservedPerHour:5,observedChangePct:100}]}}),sandbox);
const withCompare=view();
assert.match(withCompare,/Предыдущий период:/);
assert.ok(withCompare.includes('изменение наблюдаемого темпа: +100%'));
assert.match(withCompare,/Мало замеров:/);
assert.match(withCompare,/не норматив/);
console.log('V9F2_WORKER_PREVIOUS_PERIOD_UI_AND_SMALL_SAMPLE_CAUTION_PASS');

// V9H: historical proposal is distinct from a manually approved norm; escaped, explicit consent.
assert.match(vm.runInContext('benchmarkProposalsPanel()',sandbox),/data-benchmark-proposals-load/);
vm.runInContext('benchmarkProposalState='+JSON.stringify({loaded:true,loading:false,error:'',payload:{
 items:[{benchmark_id:'WBM-CI-001',work_type:'<img onerror=alert(1)>',result_unit:'м',source_status:'PROVISIONAL',source_updated_at:'2026-10-07',observed_rate:'4.000',best_observed:'6.000',sample_count:1,total_result:'4.000',total_minutes:'60.000',approval_status:null,approved_rate:null,approval_revision:null}],
 events:[],eventsHasMore:false}}),sandbox);
const proposalView=vm.runInContext('benchmarkProposalsPanel()',sandbox);
assert.match(proposalView,/ПРЕДЛОЖЕНИЕ|Предложение/);
assert.match(proposalView,/name="confirmed"/);
assert.match(proposalView,/data-act="benchmark_approve"/);
assert.match(proposalView,/не становятся нормативами автоматически/);
assert.match(proposalView,/Мало замеров/);
assert.ok(proposalView.includes('&lt;img onerror=alert(1)&gt;'));
assert.ok(!proposalView.includes('<img onerror='));
vm.runInContext("benchmarkProposalState.payload.items[0].approval_status='APPROVED';benchmarkProposalState.payload.items[0].approved_rate='3.500';benchmarkProposalState.payload.items[0].approval_revision=1;benchmarkProposalState.payload.items[0].approval_reason='<script>bad</script>'",sandbox);
const approvalView=vm.runInContext('benchmarkProposalsPanel()',sandbox);
assert.match(approvalView,/data-act="benchmark_revoke"/);
assert.match(approvalView,/Твой утверждённый норматив/);
assert.ok(approvalView.includes('&lt;script&gt;bad&lt;/script&gt;'));
assert.ok(!approvalView.includes('<script>bad</script>'));
console.log('V9H_PRELIMINARY_VS_APPROVED_OWNER_CONFIRM_REVOKE_ESCAPING_UI_PASS');
