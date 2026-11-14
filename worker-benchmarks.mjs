/* V9F — source-backed observed worker productivity; read-only, never salary or approved norm. */
const round3=x=>Math.round((x+Number.EPSILON)*1000)/1000;
const token=v=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');

export function aggregateWorkerTaskObservations(rows){
 const groups=new Map();
 for(const r of rows){
  if(r.status!=='completed')continue;
  const type=String(r.task_type??'').trim(),unit=String(r.result_unit??'').trim();
  const qty=Number(r.result_qty),mins=Number(r.duration_minutes);
  if(!type||!unit||!Number.isFinite(qty)||qty<=0||!Number.isFinite(mins)||mins<=0)continue;
  const key=token(type)+'|'+encodeURIComponent(token(unit));
  if(!groups.has(key))groups.set(key,{taskType:type,resultUnit:unit,sampleCount:0,totalResult:0,totalMinutes:0,bestPerHour:0});
  const g=groups.get(key);
  g.sampleCount++;
  g.totalResult+=qty;g.totalMinutes+=mins;
  g.bestPerHour=Math.max(g.bestPerHour,qty*60/mins);
 }
 return [...groups.values()].map(g=>({
  taskType:g.taskType,resultUnit:g.resultUnit,sampleCount:g.sampleCount,
  totalResult:round3(g.totalResult),totalMinutes:g.totalMinutes,
  observedPerHour:round3(g.totalResult*60/g.totalMinutes),
  bestPerHour:round3(g.bestPerHour),
  source:'WORKER_HISTORY',status:'OBSERVATION_ONLY'
 })).sort((a,b)=>b.sampleCount-a.sampleCount||a.taskType.localeCompare(b.taskType,'ru')||a.resultUnit.localeCompare(b.resultUnit,'ru'));
}

// The previous equal period is descriptive history, never an approved norm.
export async function workerBenchmarksRead(pool,url,{uuid,safeDate,dayYerevan,AppError}){
 const rawId=url.searchParams.get('workerId');
 if(!rawId)throw new AppError(400,'Выбери исполнителя для наблюдений.');
 const workerId=uuid(rawId);
 const compare=url.searchParams.get('compare')||'';
 if(compare&&compare!=='previous')throw new AppError(400,'Неизвестный режим сравнения периодов.');
 const to=safeDate(url.searchParams.get('to')||dayYerevan());
 const start=new Date(Date.parse(to+'T00:00:00Z')-89*86400000).toISOString().slice(0,10);
 const from=safeDate(url.searchParams.get('from')||start);
 const days=(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000;
 if(!Number.isInteger(days)||days<0||days>365)throw new AppError(400,'Период наблюдений: от 1 до 366 дней.');
 const found=await pool.query('SELECT id FROM public.mvp_workers WHERE id=$1::uuid LIMIT 1',[workerId]);
 if(!found.rows.length)throw new AppError(404,'Исполнитель не найден.');
 const readRows=async(first,last)=>{
  const q=await pool.query("SELECT status,task_type,result_unit,result_qty::text AS result_qty,duration_minutes FROM public.mvp_worker_tasks WHERE worker_id=$1::uuid AND day_date BETWEEN $2::date AND $3::date AND status='completed' AND result_qty>0 AND duration_minutes>0 AND result_unit<>'' ORDER BY day_date DESC,id DESC LIMIT 501",[workerId,first,last]);
  if(q.rows.length>500)throw new AppError(409,'Более 500 подходящих задач в одном из периодов. Сузь период: неполную выборку нельзя сравнивать.');
  return q.rows;
 };
 const rows=await readRows(from,to);
 const items=aggregateWorkerTaskObservations(rows);
 if(items.length>50)throw new AppError(409,'Более 50 видов работ. Сузь период для точного сравнения.');
 let previousFrom=null,previousTo=null,previousSampleCount=0,comparisons=items;
 if(compare==='previous'){
  const fromMs=Date.parse(from+'T00:00:00Z');
  const stamp=ms=>new Date(ms).toISOString().slice(0,10);
  previousTo=stamp(fromMs-86400000);
  previousFrom=stamp(fromMs-(days+1)*86400000);
  const earlier=await readRows(previousFrom,previousTo);
  previousSampleCount=earlier.length;
  const key=b=>token(b.taskType)+'|'+encodeURIComponent(token(b.resultUnit));
  const previousByKey=new Map(aggregateWorkerTaskObservations(earlier).map(b=>[key(b),b]));
  comparisons=items.map(item=>{
   const prev=previousByKey.get(key(item));
   return {...item,previousSampleCount:prev?.sampleCount??0,
    previousObservedPerHour:prev?.observedPerHour??null,
    observedChangePct:prev?round3((item.observedPerHour/prev.observedPerHour-1)*100):null};
  });
 }
 return {source:'CLEAN_WORKER_TASKS_ONLY',status:items.length?'OBSERVED_ONLY':'NO_SAMPLES',
  workerId,from,to,sampleCount:rows.length,items:comparisons,
  compareMode:compare||'none',previousFrom,previousTo,previousSampleCount,
  isApprovedBenchmark:false,isPayrollBasis:false,legacyHistoryImported:false};
}
