import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCapitalP2Filters,readNativeCapitalOverview,NativeCapitalOverviewError,capitalMovementMetadata}
 from '../domains/finance/capital-native-overview-history.mjs';
import {nativeCapitalP2Html,mountNativeCapitalP2}
 from '../domains/finance/capital-native-overview-view.mjs';

const ids=Array.from({length:8},(_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
const move='00000000-0000-4000-8000-000000001001';
const blank=()=>({fundId:'',movementType:'',status:'',dateFrom:'',dateTo:''});
const params=x=>new URLSearchParams(x);
function source(){
 const starts=[1000,2000,2000,2500,0,1500,0,1000],codes=[
  'OPERATING_RESERVE','WARRANTY_RESERVE','MARKETING_SALES','PEOPLE_TRAINING',
  'TOOLS_CREW_KITS','RND_MATERIALS','DIGITAL_AI_VBOS','INFRASTRUCTURE'
 ];
 const funds=ids.map((id,i)=>({
  id,legacyId:'FND-2026-'+String(i+1).padStart(4,'0'),code:codes[i],
  groupType:i<2?'PROTECTIVE':'GROWTH',status:'active',
  openingBase:Number(starts[i]).toFixed(6),balanceBase:Number(starts[i]).toFixed(6),
  nativeDeltaBase:'0.000000',targetBase:i<2?'2000000.000000':'0.000000',
  allocationSharePct:i<2?'0.000000':'20.000000',
  allocatedBase:'0.000000',transferredInBase:'0.000000',
  transferredOutBase:'0.000000',spentBase:'0.000000',
  reversalNetBase:'0.000000',targetReached:false,
  targetProgressPct:i<2?'0.05':null
 }));
 return {version:'CAPITAL_P2_NATIVE_OVERVIEW_V1',
  source:'CLEAN_NATIVE_POST_CUTOVER_ONLY',readonly:true,
  historicalIncluded:false,postingEnabled:true,funds,
  summary:{totalReservedBase:'10000.000000',protectiveBase:'3000.000000',
   growthBase:'7000.000000',openingBase:'10000.000000',nativeDeltaBase:'0.000000'},
  filters:blank(),items:[],hasMore:false,nextCursor:null,historyLimit:20};
}
test('P2 strict native fund, type, status, date and limit filters',()=>{
 const p=parseCapitalP2Filters(params());
 assert.deepEqual(p.filters,blank());assert.equal(p.limit,20);assert.equal(p.cursor,null);
 const x=parseCapitalP2Filters(params({fundId:ids[0],movementType:'TRANSFER',
  status:'reversed',dateFrom:'2026-10-01',dateTo:'2026-11-23',limit:'50'}));
 assert.equal(x.filters.fundId,ids[0]);assert.equal(x.limit,50);
});
test('P2 legacy IDs, invalid movement types/dates, out-of-range size rejected before SQL',()=>{
 for(const x of [
  {fundId:'FND-2026-0001'}, {movementType:'EDIT_FUND'},
  {movementType:'OWNER_ALLOCATION'}, {status:'archived'},
  {dateFrom:'2026-02-30'}, {dateFrom:'2026-11-23',dateTo:'2026-10-01'},
  {limit:'0'},{limit:'51'},{limit:'01'}, {limit:'100'}
 ]){
  assert.throws(()=>parseCapitalP2Filters(params(x)),
   e=>e instanceof NativeCapitalOverviewError&&e.status===400,JSON.stringify(x));
 }
});
test('P2 keyset bound to filters, UTC time and UUID',()=>{
 const key=parseCapitalP2Filters(params({fundId:ids[1]})).key;
 const cursor=Buffer.from(JSON.stringify({k:key,id:move,at:'2026-11-23 10:00:00.123456+00'})).toString('base64url');
 assert.equal(parseCapitalP2Filters(params({fundId:ids[1],cursor})).cursor.id,move);
 for(const x of [{fundId:ids[2],cursor},{cursor:'invalid'},
   {fundId:ids[1],cursor:Buffer.from(JSON.stringify({k:key,id:'OLD_ID',at:'x'})).toString('base64url')}])
  assert.throws(()=>parseCapitalP2Filters(params(x)),
   e=>e instanceof NativeCapitalOverviewError&&e.status===400);
});
test('P2 denies unauthenticated owner before pool connection or signed source',async()=>{
 await assert.rejects(()=>readNativeCapitalOverview({connect(){throw Error('DB_MUST_NOT_CONNECT');}},
  params(),{authorizeOwner:()=>false}),
  e=>e instanceof NativeCapitalOverviewError&&e.status===401);
});
test('P2 renders exactly 3 current group totals, 8 funds, goal/share and no archive money join',()=>{
 const html=nativeCapitalP2Html({data:source(),items:[],filters:blank()});
 for(const token of ['Всего в фондах','Защитные фонды','Фонды роста',
  'Операционный резерв','Гарантийный резерв','Цель','Доля распределения',
  '10','Показать ещё']){ if(token!=='Показать ещё')assert.ok(html.includes(token),token);}
 assert.equal((html.match(/data-capital-p2-fund="/g)||[]).length,8);
 assert.equal((html.match(/class="capital-p2-total"/g)||[]).length,3);
 assert.equal((html.match(/data-capital-p2-action="/g)||[]).length,4);
 assert.doesNotMatch(html,/data-b18-form|\/api\/finance\/post|data-capital-p2-manual-allocation/);
 assert.match(html,/отдельно ниже как архив/);
});
test('P2 safely escapes untrusted movement and fund metadata',()=>{
 const d=source();d.funds[0].code='<img src=x onerror=alert(1)>';
 const item={id:move,date:'2026-11-23',type:'TRANSFER',status:'reversed',
  amountBase:'100.000000',fromCode:'<script>alert(1)</script>',toCode:'WARRANTY_RESERVE',
  effects:[{fundCode:'<img src=x>',deltaBase:'-100.000000'}],
  reversalOf:ids[0]};
 const html=nativeCapitalP2Html({data:d,items:[item],filters:blank()});
 assert.doesNotMatch(html,/<script|<img/);
 assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);
 assert.match(html,/Сторнировано/);
});
test('P2 refuses Google, unauthenticated, incomplete funds as current capital',()=>{
 const base=source();
 for(const data of [
  {...base,source:'VERIFIED_LEGACY_FINANCE_CAPITAL_CLEAN_TEST'},
  {...base,readonly:false},{...base,historicalIncluded:true},
  {...base,postingEnabled:false},{...base,funds:base.funds.slice(0,7)}
 ])assert.throws(()=>nativeCapitalP2Html({data,items:[],filters:blank()}),/CAPITAL_P2_UNVERIFIED_SOURCE/);
});
test('P2 previous GET cannot overwrite newer successful read; in-flight refresh queued',async()=>{
 const pending=[];
 const handlers={};
 const root={innerHTML:'',addEventListener:(k,f)=>{handlers[k]=f;},
  removeEventListener:(k,f)=>{if(handlers[k]===f)delete handlers[k];},
  querySelectorAll:()=>[],querySelector:()=>null};
 const panel=mountNativeCapitalP2(root,{fetchPage:()=>new Promise(resolve=>pending.push(resolve)),
  onAction:()=>true});
 assert.equal(pending.length,1);
 await panel.load();
 assert.equal(pending.length,1);
 pending.shift()(source());
 await new Promise(ok=>setImmediate(ok));
 assert.equal(pending.length,1);
 const d=source();d.summary.totalReservedBase='12000.000000';
 pending.shift()(d);await new Promise(ok=>setImmediate(ok));
 assert.match(root.innerHTML,/12[\s\u00a0\u202f]*000/);
 panel.unmount();assert.equal(handlers.click,undefined);
});
test('P2 history can represent reversals and negative effects without a second writer',()=>{
 const d=source();
 const row={id:move,date:'2026-11-23',type:'REVERSAL',status:'active',
  amountBase:'25.000000',fromCode:'',toCode:'',
  effects:[{fundCode:'MARKETING_SALES',deltaBase:'25.000000'}],
  reversalOf:ids[4]};
 const html=nativeCapitalP2Html({data:d,items:[row],filters:blank()});
 assert.match(html,/Сторно/);assert.match(html,/\+25/);
 assert.match(html,/Сторнирует операцию/);
});


test('P5 original action order, linked investment source and loading gate',()=>{
 const html=nativeCapitalP2Html({data:source(),items:[],filters:blank()});
 assert.match(html,/<button type="button" data-capital-p2-action="allocate" aria-describedby="capital-p5-allocation-note">\+ Распределить капитал/);
 assert.match(nativeCapitalP2Html({loading:true}),/data-capital-p2-action="allocate"[^>]* disabled/);
 assert.match(html,/новую связанную инвестицию/);
 assert.ok(html.indexOf('+ Распределить капитал')<html.indexOf('Переместить между фондами'));
 assert.ok(html.indexOf('Переместить между фондами')<html.indexOf('Расход из фонда'));
 assert.match(html,/Назначение по исходному стандарту/);
 assert.match(html,/15% — операционный резерв, 15% — гарантийный резерв, 70%/);
 assert.equal((html.match(/data-capital-p2-fund="/g)||[]).length,8);
});

 test('P6 history metadata validation, escaping, old record honesty and reverse link',()=>{
 const d=source(),metadata={version:1,purpose:'Сторно: <script>',notes:'<img>',reason:'<script>'};
 assert.deepEqual(capitalMovementMetadata('REVERSAL',metadata),metadata);
 assert.equal(capitalMovementMetadata('SPEND',null),null);
 assert.throws(()=>capitalMovementMetadata('REVERSAL',{...metadata,reason:'wrong'}),/CAPITAL_P6_METADATA_CONTRACT_DRIFT/);
 const row={id:move,date:'2026-11-24',type:'REVERSAL',status:'active',amountBase:'1',effects:[],metadata,reversalOf:ids[0],originalType:'TRANSFER',originalDate:'2026-11-23'};
 const old={...row,type:'TRANSFER',status:'reversed',metadata:null,reversalOf:'',reversedBy:move,reversedDate:'2026-11-24'};
 const html=nativeCapitalP2Html({data:d,items:[row,old]});
 assert.match(html,/Причина сторно: &lt;script&gt;/);assert.match(html,/Комментарий: &lt;img&gt;/);
 assert.match(html,/Сторнировано операцией/);assert.match(html,/не были сохранены/);assert.doesNotMatch(html,/<script|<img/);
 });

 test('P7 eight settings shortcuts, archived and loading guarded',()=>{
 const d=source();d.funds[7].status='archived';
 assert.equal((nativeCapitalP2Html({data:d}).match(/data-capital-p7-settings="/g)||[]).length,7);
 assert.equal((nativeCapitalP2Html({data:d,loading:true}).match(/data-capital-p7-settings="[^"]+" disabled/g)||[]).length,7);
 });
