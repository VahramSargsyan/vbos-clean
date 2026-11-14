/* V9H — owner-reviewed historical proposals, never payroll or auto-scoring. */
import {createHash} from 'node:crypto';

export async function benchmarkProposalsRead(pool,{AppError}){
 const proposals=await pool.query(
  "SELECT p.benchmark_id,p.work_type,p.result_unit,p.benchmark_key,p.source_status,p.source_tag,p.source_updated_at,p.imported_at,p.observed_rate::text AS observed_rate,p.best_observed::text AS best_observed,p.sample_count,p.total_result::text AS total_result,p.total_minutes::text AS total_minutes, a.status AS approval_status,a.approved_rate::text AS approved_rate,a.revision AS approval_revision,a.reason AS approval_reason,a.approved_at,a.revoked_at,a.updated_at AS approval_updated_at "+
  "FROM public.mvp_benchmark_proposals p LEFT JOIN public.mvp_benchmark_approvals a ON a.benchmark_id=p.benchmark_id ORDER BY p.work_type,p.result_unit,p.benchmark_id LIMIT 101"
 );
 if(proposals.rows.length>100)throw new AppError(409,'Более 100 исторических эталонов: нужна постраничная выдача.');
 const recent=await pool.query(
  "SELECT event_id,benchmark_id,action,revision,approved_rate::text AS approved_rate,reason,recorded_at FROM public.mvp_benchmark_approval_events ORDER BY event_id DESC LIMIT 31"
 );
 return {source:'VERIFIED_LEGACY_OWNER_HISTORY_SNAPSHOT',sourceStatus:'PROVISIONAL',isApprovedAutomatically:false,isPayrollBasis:false,
   items:proposals.rows,events:recent.rows.slice(0,30),eventsHasMore:recent.rows.length>30};
}

function rateText(value,AppError){
 const s=String(value??'').trim().replace(',','.');
 if(!/^(?:[0-9]{1,9})(?:\.[0-9]{1,3})?$/.test(s) || Number(s)<=0)
  throw new AppError(400,'Укажи положительный норматив, максимум три знака после запятой.');
 return Number(s).toFixed(3);
}

export async function benchmarkApprovalAction({pool,type,p,key,AppError}){
 if(type!=='benchmark_approve'&&type!=='benchmark_revoke')throw new AppError(404,'Неизвестная операция.');
 const benchmarkId=String(p.benchmarkId??'').trim();
 if(!/^[a-zA-Z0-9_-]{3,80}$/.test(benchmarkId))throw new AppError(400,'Некорректный исторический ID.');
 const revision=Number(p.revision);
 if(!Number.isInteger(revision)||revision<0||revision>2147483646)throw new AppError(400,'Неверная версия норматива.');
 if(p.confirmed!=='yes')throw new AppError(400,'Для решения нужно явное подтверждение владельца.');
 const reason=String(p.reason??'').trim();
 if(reason.length<3||reason.length>1000)throw new AppError(400,'Укажи причину решения (3–1000 символов).');
 const approvedRate=type==='benchmark_approve'?rateText(p.approvedRate,AppError):null;
 const payloadSha=createHash('sha256').update(JSON.stringify({type,benchmarkId,revision,approvedRate,reason})).digest('hex');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  // Lock this immutable proposal before dedup and status checks: concurrent approvals serialize.
  const proposal=await client.query("SELECT benchmark_id FROM public.mvp_benchmark_proposals WHERE benchmark_id=$1 AND source_status='PROVISIONAL' FOR UPDATE",[benchmarkId]);
  if(!proposal.rows.length)throw new AppError(404,'Историческое предложение не найдено.');
  const seen=await client.query('SELECT payload_sha256,response FROM public.mvp_benchmark_approval_events WHERE request_key=$1',[key]);
  if(seen.rows.length){
   if(seen.rows[0].payload_sha256!==payloadSha)throw new AppError(409,'Этот ключ уже использован для другого решения.');
   await client.query('COMMIT');
   return {...seen.rows[0].response,deduplicated:true};
  }
  const current=await client.query('SELECT status,approved_rate,revision FROM public.mvp_benchmark_approvals WHERE benchmark_id=$1 FOR UPDATE',[benchmarkId]);
  const prior=current.rows[0]||null;
  if(Number(prior?.revision??0)!==revision)throw new AppError(409,'Норматив уже изменён. Обнови экран перед новым решением.');
  if(type==='benchmark_revoke' && prior?.status!=='APPROVED')throw new AppError(409,'Отменить можно только действующий утверждённый норматив.');
  if(type==='benchmark_approve' && prior?.status==='APPROVED' && Number(prior.approved_rate)===Number(approvedRate))
   throw new AppError(409,'Этот норматив уже утверждён с таким значением.');
  const nextStatus=type==='benchmark_approve'?'APPROVED':'REVOKED';
  const nextRate=type==='benchmark_approve'?approvedRate:String(prior.approved_rate);
  const q=await client.query(
   "INSERT INTO public.mvp_benchmark_approvals(benchmark_id,status,approved_rate,revision,reason,approved_at,revoked_at,updated_at) "+
   "VALUES($1,$2,$3,1,$4,now(),CASE WHEN $2='REVOKED' THEN now() ELSE NULL END,now()) "+
   "ON CONFLICT(benchmark_id) DO UPDATE SET status=EXCLUDED.status,approved_rate=EXCLUDED.approved_rate,revision=public.mvp_benchmark_approvals.revision+1,"+
   "reason=EXCLUDED.reason,approved_at=CASE WHEN EXCLUDED.status='APPROVED' THEN now() ELSE public.mvp_benchmark_approvals.approved_at END,"+
   "revoked_at=CASE WHEN EXCLUDED.status='REVOKED' THEN now() ELSE NULL END,updated_at=now() "+
   "RETURNING benchmark_id,status,approved_rate::text AS approved_rate,revision,reason,approved_at,revoked_at,updated_at",
   [benchmarkId,nextStatus,nextRate,reason]
  );
  const response={saved:true,item:q.rows[0],isPayrollBasis:false};
  await client.query(
   'INSERT INTO public.mvp_benchmark_approval_events(benchmark_id,request_key,payload_sha256,action,revision,approved_rate,reason,response) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
   [benchmarkId,key,payloadSha,type,q.rows[0].revision,nextRate,reason,JSON.stringify(response)]
  );
  await client.query('COMMIT');
  return response;
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  if(error.code==='23505')throw new AppError(409,'Действие уже обрабатывается. Обнови историю решения.');
  throw error;
 }finally{client.release();}
}
