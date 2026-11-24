import test from 'node:test';
import assert from 'node:assert/strict';
import {monthPeriod,currentMonth,financeSnapshot,ownerSnapshot,fieldSnapshot,crmSnapshot,workerSnapshot,unionMinutes,intersectionMinutes} from '../domains/analytics/analytics-a1-model.mjs';
import {readAnalyticsA1,buildAnalyticsTxt} from '../domains/analytics/analytics-a1.mjs';
import {analyticsBody,mountAnalyticsA1} from '../public/analytics-a1-view.mjs';
const period=monthPeriod('2026-11');
const financeRow={month_key:'2026-11',active_count:2,profit_base:'154.000001',earned_base:'250.000000',received_base:'280.000000',economic_expense_base:'96.000000',cash_balance_base:'179.000000'};
const gainsRow={month_key:'2026-11',referral_commission_base:'12.34',purchase_commission_base:'5.67',organization_margin_base:'0',tax_optimization_savings_base:'0',other_business_income_base:'0',total_business_gains_base:'18.01'};
const gate={attested:true,cutover:'2026-10-01',currentCash:'203179.000000'};
const log=(mode='OWNER',a='2026-11-01T05:00:00Z',b='2026-11-01T06:00:00Z')=>({day_date:'2026-11-01',performer_mode:mode,start_at:a,end_at:b,clean_minutes:50,loss_minutes:10,rework_minutes:5,rework_status:'yes',gap_reason:'',points:'2',nodes:null,meters:'4',quantity:'1.5',unit:'м',minutes:50,object_id:'object-private-id',order_id:'order-private-id',object_title:'<script>private-object</script>'});
const activity=(klass,a,b)=>({day_date:'2026-11-01',status:'completed',activity_class:klass,start_at:a,end_at:b});
const task={day_date:'2026-11-01',worker_id:'private-worker-id',worker_name:'private-worker-name',status:'completed',duration_minutes:60,management_minutes:10,rework:true,rework_minutes:5,notes:'PRIVATE_TASK_NOTE'};
const nativeFinance=()=>financeSnapshot(period,[financeRow],[gainsRow],gate);
test('strict YYYY-MM, leap year, Yerevan day boundary and rolling year',()=>{
 assert.equal(currentMonth(new Date('2026-10-31T19:59:59Z')),'2026-10');
 assert.equal(currentMonth(new Date('2026-10-31T20:00:00Z')),'2026-11');
 assert.equal(monthPeriod('2024-02').dateTo,'2024-02-29');
 assert.equal(monthPeriod('2026-12').dateUntil,'2027-01-01');
 assert.equal(monthPeriod('2026-01').rollingKeys[0],'2025-02');
 for(const v of ['2026-00','2026-13','2026-1','2026-11-01',' 2026-11','',null,{}])
  assert.throws(()=>monthPeriod(v),e=>e.status===400);
});
test('exact micro money, native profit not cash, M1 once, missing months not zero',()=>{
 const f=nativeFinance();
 assert.equal(f.month.businessResultBase,'172.010001');
 assert.equal(f.month.financeProfitBase,'154.000001');
 assert.equal(f.month.businessGainsBase,'18.010000');
 assert.equal(f.month.cashFlowBase,'179.000000');
 assert.equal(f.ytd.businessResultBase,null);
 assert.equal(f.ytd.observedComponentsBase,'172.010001');
 assert.equal(f.ytd.coveredMonths,1);
 assert.equal(f.monthlyTrend[0].financeStatus,'PRE_CUTOVER');
 assert.equal(f.currentCashBalanceBase,'203179.000000');
 assert.equal(f.goal.targetAverageMonthlyResultBase,null);
 assert.equal(f.goal.canEdit,false);
 assert.equal(financeSnapshot(period,[financeRow],[],gate).month.businessResultBase,null);
 assert.equal(financeSnapshot(period,[],[gainsRow],gate).month.observedComponentsBase,'18.010000');
 assert.equal(financeSnapshot(period,[financeRow],[gainsRow],{}).month.financeProfitBase,null);
});
test('native CRM conversion events are not a cohort numerator; unconfirmed won withholds ratio',()=>{
 const leads=[{date_key:'2026-11-01',status:'won',source_channel:'referral',agreement_stage:'approved',converted:true},
  {date_key:'2026-11-02',status:'new',source_channel:'referral',converted:false}];
 const crm=crmSnapshot(leads,[{lead_id:'old',date_key:'2026-11-01'},{lead_id:'old',date_key:'2026-11-01'},{lead_id:'new',date_key:'2026-11-02'}],[{lead_id:'x',date_key:'2026-11-01'}]);
 assert.equal(crm.total,2);assert.equal(crm.conversionEvents,2);assert.equal(crm.conversionPercent,50);
 assert.equal(crm.eventsByDay[0].converted,1);assert.equal(crm.lostPeriod,null);
 const partial=crmSnapshot([...leads,{status:'won',converted:false}],[],[]);
 assert.equal(partial.conversionPercent,null);assert.equal(partial.cohortUnconfirmedWon,1);
 assert.equal(crmSnapshot([],[],[]).conversionPercent,null);
});
test('owner interval union, JOINT counted once, worker excluded; active timer not accrued',()=>{
 const l=log(),joint=log('JOINT','2026-11-01T06:00:00Z','2026-11-01T07:00:00Z'),worker=log('WORKER');
 const a=activity('ORGANIZATION','2026-11-01T05:30:00Z','2026-11-01T06:30:00Z');
 const b=activity('BUSINESS_SYSTEM','2026-11-01T06:30:00Z','2026-11-01T07:30:00Z');
 const o=ownerSnapshot([l,joint,worker],[a,b,{...a,status:'active',end_at:null}],[{day_date:'2026-11-01'}]);
 assert.equal(o.fieldTrackedMinutes,120);assert.equal(o.organizationMinutes,60);assert.equal(o.businessSystemMinutes,60);
 assert.equal(o.uniqueMinutes,150);assert.equal(o.overlapMinutes,90);assert.equal(o.activeActivities,1);
 assert.equal(o.days[0].uniqueMinutes,150);assert.equal(o.mixedDayCount,1);
 assert.equal(ownerSnapshot([],[],[]).uniqueMinutes,null);
 assert.equal(unionMinutes([{start:0,end:60000},{start:0,end:60000}]),1);
 assert.equal(intersectionMinutes([{start:0,end:120000},{start:60000,end:180000}],[{start:60000,end:120000}]),1);
});
test('field: no multiplying by worker or presence; losses, gaps, nullable volumes and basic minutes',()=>{
 const l=log(),next={...log('OWNER','2026-11-01T06:30:00Z','2026-11-01T07:30:00Z'),gap_reason:'lunch'};
 const worker=log('WORKER'),basic={day_date:'2026-11-01',performer_mode:null,minutes:15,quantity:null,unit:''};
 const visits=[{status:'closed',start_at:'2026-11-01T05:00:00Z',end_at:'2026-11-01T07:00:00Z'},{status:'closed',start_at:'2026-11-01T06:00:00Z',end_at:'2026-11-01T08:00:00Z'}];
 const f=fieldSnapshot([l,next,worker,basic],visits,[{day_date:'2026-11-01'}],[]);
 assert.equal(f.cleanMinutes,150);assert.equal(f.basicRecordedMinutes,15);assert.equal(f.lossMinutes,30);assert.equal(f.reworkMinutes,15);
 assert.equal(f.presenceMinutes,180);assert.equal(f.loggedWithinPresenceMinutes,120);assert.equal(f.nonWorkPresenceMinutes,60);
 assert.equal(f.reasonedLongGapMinutes,30);assert.equal(f.breakMinutes,30);
 assert.equal(f.nodes,null);assert.equal(f.nodesPerHour,null);
 assert.equal(f.byObject[0].workLogCount,3);assert.equal(f.quantityByUnit[0].value,4.5);
 assert.equal(fieldSnapshot([],[],[],[]).cleanMinutes,null);
});
test('worker tasks count, durations only completed; no invented score',()=>{
 const w=workerSnapshot([task,{...task,status:'active',duration_minutes:null,management_minutes:100}]);
 assert.equal(w.rows[0].taskCount,2);assert.equal(w.rows[0].completedCount,1);assert.equal(w.rows[0].durationMinutes,60);
 assert.equal(w.rows[0].managementMinutes,10);assert.equal(w.rows[0].averageScore,null);
 assert.equal(w.scoreAvailable,false);
});
const snapshot=()=>({version:'CLEAN_ANALYTICS_A1_V1',readonly:true,source:'CLEAN_POSTGRESQL_TEST',period,generatedAt:'2026-11-24T10:00:00Z',
 finance:nativeFinance(),crm:crmSnapshot([],[],[]),field:fieldSnapshot([log()],[],[],[]),owner:ownerSnapshot([log()],[],[]),workers:workerSnapshot([task]),warnings:[{message:'Ограничение данных'}]});
test('AI TXT legacy structure, UTF-8, explicit field projection and no PII/secret values',()=>{
 const x=buildAnalyticsTxt(snapshot(),{logs:[{...log(),unit:'private-custom-unit',notes:'PRIVATE_NOTE',phone:'PRIVATE_PHONE',address:'PRIVATE_ADDRESS'}],tasks:[task],finance:[{...financeRow,normalized:{notes:'PRIVATE_FINANCE_NOTE'},order_id:'order-private-id'}],leads:[{lead_id:'private-lead-id',contact_name:'PRIVATE_CONTACT',notes:'PRIVATE_LEAD_NOTE',date_key:'2026-11-01',status:'new'}],gains:[{...gainsRow,notes:'PRIVATE_M1_NOTE'}]});
 assert.equal(x.filename,'VBOS_2026-11_AI_EXPORT.txt');assert.match(x.mimeType,/text\/plain.*utf-8/);
 const out=JSON.parse(Buffer.from(x.content,'utf8').toString('utf8'));
 assert.equal(out.exportVersion,'VBOS_HOME_EXPORT_V5_CLEAN_A1');assert.equal(out.monthKey,'2026-11');
 assert.equal(out.datasets.WorkLogs[0].unit,'unit_1');assert.equal(out.datasets.WorkerTasks[0].worker,'worker_1');
 assert.ok(out.analytics.ownerTime);assert.ok(out.derivedKpis.ownerTime);assert.match(x.content,/Ограничение данных/);
 for(const value of ['PRIVATE_','private-object','private-worker','object-private-id','order-private-id','private-custom-unit','private-lead-id','password_hash','normalized'])
  assert.ok(!x.content.includes(value),value+' leaked');
});
test('owner auth rejected before touching pool; malformed period rejects before SQL',async()=>{
 let accessed=false;const pool={connect(){accessed=true;throw Error('unexpected SQL');}};
 await assert.rejects(readAnalyticsA1(pool,'2026-11',{authorizeOwner:()=>false}),e=>e.status===401);
 await assert.rejects(readAnalyticsA1(pool,'2026-13',{authorizeOwner:()=>true}),e=>e.status===400);
 assert.equal(accessed,false);
});
test('original section order, goal disabled, native navigation, escaping and no fake zero',()=>{
 const html=analyticsBody(snapshot());
 const headings=['Цель среднего месяца','Финансы и Business Result','CRM','Производительность · Room Journal','Время владельца / бизнес-время','Работники'];
 let prior=-1;for(const h of headings){const i=html.indexOf('<h2>'+h+'</h2>');assert.ok(i>prior);prior=i;}
 assert.match(html,/disabled aria-describedby="analyticsGoalGate">Изменить цель/);
 assert.match(html,/data-analytics-nav="crm"/);assert.match(html,/Нет данных/);
 assert.ok(!html.includes('<script>private-object'));assert.ok(html.includes('&lt;script&gt;private-object'));
});
test('month switch rejects stale response; preserves selected month and export follows loaded month',async()=>{
 const make=()=>({textContent:'',innerHTML:'',disabled:false,value:'2026-11',listeners:{},addEventListener(k,f){this.listeners[k]=f;},removeEventListener(k){delete this.listeners[k];}});
 const input=make(),form=make(),body=make(),status=make(),btn=make(),root=make();
 form.querySelector=()=>input;root.querySelector=k=>({'[data-analytics-period]':form,'[data-analytics-body]':body,'[data-analytics-status]':status,'[data-analytics-export]':btn})[k];
 const pending=[],calls=[],state={monthKey:'2026-11'};
 const handle=mountAnalyticsA1(root,{state,fetchPage:path=>{calls.push(path);return new Promise(resolve=>pending.push(resolve));},download:async()=>{throw Error('not invoked');},navigate:()=>{}});
 assert.equal(btn.disabled,true);input.value='2026-10';input.listeners.change();
 assert.equal(state.monthKey,'2026-10');assert.match(calls[1],/2026-10/);
 const newer={...snapshot(),period:monthPeriod('2026-10')};pending[1](newer);await Promise.resolve();await Promise.resolve();
 assert.match(status.textContent,/2026-10/);assert.equal(btn.disabled,false);
 pending[0](snapshot());await Promise.resolve();await Promise.resolve();assert.match(status.textContent,/2026-10/);
 input.value='2026-13';input.listeners.change();assert.equal(btn.disabled,true);assert.match(status.textContent,/корректный месяц/);
 handle.unmount();assert.equal(root.listeners.click,undefined);
});
