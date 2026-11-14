import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {scheduleConflictSourceRead} from '../schedule-conflicts.mjs';

class SourceError extends Error{constructor(status,message){super(message);this.status=status;}}
const validDate=v=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)
  throw new SourceError(400,'invalid date');
 return v;
};
const sourceArgs={safeDate:validDate,AppError:SourceError};
const row=(id,from,to,{source='manual',title='План',orderId=null,status='planned'}={})=>({
 id,source_kind:source,status,start_at:from,end_at:to,title,order_id:orderId
});
const first='11111111-1111-4111-8111-111111111111';
const second='22222222-2222-4222-8222-222222222222';
const code=readFileSync(new URL('../public/schedule-conflicts.js',import.meta.url),'utf8');
function isolate(fetcher=async()=>({})){
 const calls=[],ctx={Date,URLSearchParams,console,
  api:async url=>{calls.push(url);return fetcher(url);},
  FormData:class{constructor(form){this.form=form;} entries(){return Object.entries(this.form.data);}},
  document:{createElement:()=>({
   hidden:false,innerHTML:'',textContent:'',dataset:{},
   setAttribute(){},scrollIntoView(){}
  })}
 };
 vm.createContext(ctx);vm.runInContext(code,ctx,{filename:'schedule-conflicts.js'});
 return {ctx,calls,eval:s=>vm.runInContext(s,ctx)};
}
function formState(data){
 const button={dataset:{},disabled:false,textContent:'Создать пункт плана'};
 const form={data:{...data},dataset:{scheduleStatus:'planned'},isConnected:true,panel:null,
  querySelector(selector){
   if(selector==='button[type="submit"]')return button;
   if(selector==='[data-schedule-conflict-alert]')return this.panel;
   return null;
  },
  insertBefore(node){this.panel=node;},
  append(node){this.panel=node;},
  reportValidity:()=>true,
  requestSubmit(){this.submitted=(this.submitted||0)+1;}
 };
 return {form,button};
}
const source=(items=[],startDate='2026-11-10',endDate='2026-11-10')=>({
 version:'LEGACY_CONFLICT_GUARD_V1105_SOURCE',startDate,endDate,
 horizonDate:new Date(Date.parse(endDate+'T00:00:00Z')+14*86400000).toISOString().slice(0,10),
 timezone:'Asia/Yerevan',complete:true,
 source:'mvp_schedule_items+mvp_schedule_order_items+mvp_schedule_lead_items',items
});
const plain=value=>JSON.parse(JSON.stringify(value));
test('source uses one complete canonical overlap query; owner-only route calls this read',async()=>{
 const queries=[],pool={query:async(sql,args)=>{queries.push({sql,args});return {rows:[]};}};
 const result=await scheduleConflictSourceRead(pool,new URL('https://x/api/schedule/conflicts?startDate=2026-11-10&endDate=2026-11-12'),sourceArgs);
 assert.equal(result.version,'LEGACY_CONFLICT_GUARD_V1105_SOURCE');
 assert.equal(result.horizonDate,'2026-11-26');
 assert.equal(result.complete,true);
 assert.deepEqual(queries[0].args,['2026-11-10','2026-11-26']);
 for(const table of ['mvp_schedule_items','mvp_schedule_order_items','mvp_schedule_lead_items'])
  assert.match(queries[0].sql,new RegExp(table));
 assert.match(queries[0].sql,/end_at >/);
 assert.match(queries[0].sql,/LIMIT 2001/);
 await assert.rejects(()=>scheduleConflictSourceRead(pool,new URL('https://x?startDate=2026-11-12&endDate=2026-11-10'),sourceArgs),e=>e.status===400);
 await assert.rejects(()=>scheduleConflictSourceRead(pool,new URL('https://x?startDate=2026-11-10&endDate=2027-03-11'),sourceArgs),e=>e.status===400);
 await assert.rejects(()=>scheduleConflictSourceRead(pool,new URL('https://x?startDate=bad&endDate=2026-11-10'),sourceArgs),e=>e.status===400);
});
test('incomplete / malformed PostgreSQL data fails closed instead of accepting missing conflicts',async()=>{
 const url=new URL('https://x?startDate=2026-11-10&endDate=2026-11-10');
 await assert.rejects(()=>scheduleConflictSourceRead({query:async()=>({rows:Array(2001).fill(
  row(first,'2026-11-10T05:00:00Z','2026-11-10T06:00:00Z'))})},url,sourceArgs),e=>e.status===503);
 await assert.rejects(()=>scheduleConflictSourceRead({query:async()=>({rows:[{...row(first,'bad','also-bad')}]})},url,sourceArgs),e=>e.status===503);
 await assert.rejects(()=>scheduleConflictSourceRead({query:async()=>({rows:[{...row(first,'2026-11-10T05:00:00Z','2026-11-10T06:00:00Z'),id:null}]})},url,sourceArgs),e=>e.status===503);
});
test('legacy overlaps: exact equal boundaries free; intersection, edit-self exclusion and overnight',()=>{
 const {ctx,eval:e}=isolate();
 ctx.items=[
  row(first,'2026-11-10T06:00:00Z','2026-11-10T07:00:00Z',{title:'Занято <script>'}),
  row(second,'2026-11-10T08:00:00Z','2026-11-11T05:00:00Z',{title:'Ночная'})
 ];
 ctx.range={startDate:'2026-11-10',endDate:'2026-11-10',start:630,end:690,
  scheduleItemId:'',workOrderId:'',status:'planned'};
 let conflicts=plain(e('legacyConflictOverlaps(items,range)'));
 assert.equal(conflicts.length,1);
 assert.equal(conflicts[0].start,630);
 assert.equal(conflicts[0].end,660);
 ctx.range.scheduleItemId=first;
 assert.equal(e('legacyConflictOverlaps(items,range).length'),0);
 ctx.range.scheduleItemId='';
 ctx.range.start=660;ctx.range.end=720;
 assert.equal(e('legacyConflictOverlaps(items,range).length'),0,'adjacent at 11:00 is not a conflict');
 ctx.range.startDate='2026-11-11';ctx.range.endDate='2026-11-11';
 ctx.range.start=480;ctx.range.end=520;
 assert.equal(e('legacyConflictOverlaps(items,range).length'),1,'overnight carry');
});
test('legacy Sunday semantics: order-linked proposal and existing order skip Sunday; manual personal remains',()=>{
 const {ctx,eval:e}=isolate();
 ctx.range={startDate:'2026-11-15',endDate:'2026-11-15',start:540,end:600,
  scheduleItemId:'',workOrderId:second,status:'planned'};
 ctx.items=[row(first,'2026-11-15T05:00:00Z','2026-11-15T07:00:00Z')];
 assert.equal(e('legacyConflictOverlaps(items,range).length'),0,'linked proposal skips Sunday');
 ctx.range.workOrderId='';
 assert.equal(e('legacyConflictOverlaps(items,range).length'),1,'unlinked Sunday conflict is possible');
 ctx.items=[row(first,'2026-11-15T05:00:00Z','2026-11-15T07:00:00Z',{source:'work_order',orderId:second})];
 assert.equal(e('legacyConflictOverlaps(items,range).length'),0,'existing order Sunday interval ignored');
});
test('legacy nearest slot: preserve gap before first event, 15-minute round, next 14 days',()=>{
 const {ctx,eval:e}=isolate();
 ctx.items=[row(first,'2026-11-10T08:00:00Z','2026-11-10T09:00:00Z')];
 ctx.range={startDate:'2026-11-10',endDate:'2026-11-10',start:480,end:540,
  scheduleItemId:'',workOrderId:'',status:'planned'};
 assert.deepEqual(plain(e('legacyConflictNearest(items,range)')),
  {date:'2026-11-10',start:480,end:540},'first free hour before 12:00 booking');
 ctx.range.start=727;ctx.range.end=787;
 assert.deepEqual(plain(e('legacyConflictNearest(items,range)')),
  {date:'2026-11-10',start:780,end:840},'12:07 rounds to 12:15, booking blocks until 13:00');
 ctx.range.startDate='2026-11-15';ctx.range.endDate='2026-11-15';
 ctx.range.start=480;ctx.range.end=540;
 assert.deepEqual(plain(e('legacyConflictNearest([],range)')),
  {date:'2026-11-16',start:480,end:540});
});
test('manual save: conflict warning + alternative + explicit override, never automatic write',async()=>{
 const busy=[row(first,'2026-11-10T06:00:00Z','2026-11-10T07:00:00Z',{title:'<script>x</script>'})];
 const {ctx,eval:e,calls}=isolate(async()=>source(busy));
 const {form,button}=formState({revision:'0',startAt:'2026-11-10T10:30',
  endAt:'2026-11-10T11:30',itemType:'Личное',title:'Новая задача',orderId:''});
 ctx.form=form;
 const result=await e('legacyConflictBeforeSave(form,form.data)');
 assert.equal(result,true,'conflict intercepted; writer never called');
 assert.equal(calls.length,1);
 assert.equal(form.panel.hidden,false);
 assert.match(form.panel.innerHTML,/Пересечение по времени · 1/);
 assert.match(form.panel.innerHTML,/Сохранить всё равно/);
 assert.match(form.panel.innerHTML,/Предложить/);
 assert.match(form.panel.innerHTML,/&lt;script&gt;/);
 assert.doesNotMatch(form.panel.innerHTML,/<script>/);
 assert.equal(button.disabled,false);
 assert.equal(button.textContent,'Создать пункт плана');
 assert.equal(e('legacyConflictStates.get(form).approved!==""'),true);
 form.dataset.scheduleConflictBypass='1';
 assert.equal(await e('legacyConflictBeforeSave(form,form.data)'),false);
 assert.equal(calls.length,1,'override uses existing Save without second query');
 assert.equal(form.dataset.scheduleConflictBypass,undefined);
});
test('clean slot, source error and stale changed form do not leak an implicit save',async()=>{
 const {ctx,eval:e}=isolate(async()=>source([]));
 const {form}=formState({revision:'0',startAt:'2026-11-10T09:00',
  endAt:'2026-11-10T10:00',title:'Без конфликта'});
 ctx.form=form;
 assert.equal(await e('legacyConflictBeforeSave(form,form.data)'),false);
 assert.equal(form.panel,null);
 const fail=isolate(async()=>{throw Error('source unavailable');});
 const {form:badForm}=formState(form.data);
 fail.ctx.form=badForm;
 assert.equal(await fail.eval('legacyConflictBeforeSave(form,form.data)'),true);
 assert.match(badForm.panel.innerHTML,/Не удалось проверить пересечения/);
 let release;
 const late=isolate(()=>new Promise(resolve=>{release=resolve;}));
 const {form:lateForm}=formState(form.data);
 late.ctx.form=lateForm;
 const running=late.eval('legacyConflictBeforeSave(form,form.data)');
 lateForm.data.title='Изменено во время проверки';
 release(source([]));
 assert.equal(await running,true,'changed form must not be sent to writer');
 assert.equal(lateForm.querySelector('button[type="submit"]').disabled,false);
});
