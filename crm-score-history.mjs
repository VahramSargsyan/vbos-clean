/**
 * CRM-12A: append-only derived evidence. Canonical Lead / CRM06 / CRM08 writes
 * commit first, history is a best-effort independent observation.
 * Reuses the accepted CRM10A source query and score; never backfills history.
 */
import {createHash} from 'node:crypto';
import {crmLeadSignals,crmLeadSignalRow} from './crm-lead-signals.mjs';

const OBSERVED_TYPES=new Set([
 'crm_signal_save','crm_reminder_save','crm_interaction_add','lead_status','lead_convert'
]);
const HISTORY_LIMIT=12;
const TRACKING_VERSION='CRM_SCORE_HISTORY_V1';
const instant=x=>x==null?null:new Date(x).toISOString();
function affectedLeadId(type,p){
 if(!OBSERVED_TYPES.has(type))return null;
 if(type==='crm_interaction_add')return p.entityType==='Lead'?p.entityId:null;
 if(type==='lead_status')return p.id;
 return p.leadId;
}
export function crmScoreHistoryFingerprint(row,signal){
 const values=[
  'CRM12A_SIGNAL_SIGNATURE_V1',row.id,row.status,
  signal.modelVersion,signal.winScore.score,
  signal.agreementStage,signal.sourceChannel,
  signal.hasNeedSummary,signal.hasBusinessContact,
  instant(row.last_contact_at),row.last_contact_type||null,
  signal.hasNextAction,String(row.next_action||'').trim(),
  signal.hasReminder,instant(row.next_action_at)
 ];
 return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
export function crmScoreHistoryDelta(previous,currentScore){
 if(previous==null||currentScore==null)return null;
 return Number(currentScore)-Number(previous);
}
export async function crmScoreHistoryObserve({pool,leadId,captureSource}){
 if(!OBSERVED_TYPES.has(captureSource))throw Error('CRM12A_UNRECOGNIZED_CAPTURE_SOURCE');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  // Per-Lead lock serializes dedup in concurrent observations without making
  // signature globally unique: A->B->A must remain a legitimate third event.
  const lock=await client.query('SELECT id FROM public.mvp_leads WHERE id=$1 FOR UPDATE',[leadId]);
  if(!lock.rowCount){await client.query('COMMIT');return {status:'SKIPPED_MISSING_LEAD'};}
  const row=await crmLeadSignalRow(client,leadId);
  const signal=crmLeadSignals(row);
  const terminal=['won','lost'].includes(row.status);
  if(!signal.winScore.ready&&!terminal){
   await client.query('COMMIT');return {status:'SKIPPED_UNKNOWN_STAGE'};
  }
  const signature=crmScoreHistoryFingerprint(row,signal);
  const previous=(await client.query(
   'SELECT snapshot_id,signal_signature,score FROM public.mvp_lead_score_snapshots WHERE lead_id=$1 ORDER BY snapshot_id DESC LIMIT 1',
   [leadId])).rows[0];
  if(previous?.signal_signature===signature){
   await client.query('COMMIT');return {status:'UNCHANGED'};
  }
  const prevScore=previous?.score??null;
  const score=signal.winScore.score;
  const delta=crmScoreHistoryDelta(prevScore,score);
  const params=[
   row.id,captureSource,signal.modelVersion,signature,row.revision,row.status,
   score,signal.winScore.band,signal.agreementStage,signal.sourceChannel,
   signal.hasNeedSummary,signal.hasBusinessContact,signal.interactionCoverage,
   row.last_contact_at||null,signal.hasNextAction,signal.hasReminder,
   row.next_action_at||null,prevScore,delta
  ];
  const added=await client.query(`
   INSERT INTO public.mvp_lead_score_snapshots (
    lead_id,capture_source,score_model_version,signal_signature,lead_revision,
    lead_status,score,band,agreement_stage,source_channel,has_need_summary,
    has_business_contact,interaction_coverage,last_contact_at,has_next_action,
    has_reminder,next_action_at,previous_score,score_delta
   ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
   RETURNING snapshot_id`,params);
  await client.query('COMMIT');
  return {status:'APPENDED',snapshotId:added.rows[0].snapshot_id};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
 finally{client.release();}
}
export async function crmScoreHistoryAfterAction({pool,type,p}){
 const leadId=affectedLeadId(type,p);
 if(!leadId)return {status:'NOT_APPLICABLE'};
 try{return await crmScoreHistoryObserve({pool,leadId,captureSource:type});}
 catch(error){
  // Never convert an already-committed CRM mutation into an HTTP failure.
  // A later successful mutation/replay will try to observe the current state.
  console.warn('CRM12A_HISTORY_OBSERVATION_FAILED',String(error.code||error.name||'ERROR'));
  return {status:'FAILED'};
 }
}
export async function crmScoreHistoryRead({pool,leadId}){
 const status=(await pool.query(
  'SELECT schema_version,tracking_since FROM public.mvp_crm_score_history_meta WHERE singleton=true LIMIT 1'
 )).rows[0];
 if(!status||status.schema_version!==TRACKING_VERSION)
  return {ready:false,status:'MIGRATION_NOT_READY',trackingSince:null,items:[]};
 const r=await pool.query(`
  SELECT snapshot_id,lead_id,captured_at,capture_source,score_model_version,
   lead_status,score,band,agreement_stage,source_channel,has_need_summary,
   has_business_contact,has_next_action,has_reminder,previous_score,score_delta
  FROM public.mvp_lead_score_snapshots
  WHERE lead_id=$1 ORDER BY snapshot_id DESC LIMIT $2`,[leadId,HISTORY_LIMIT+1]);
 const all=r.rows,items=all.slice(0,HISTORY_LIMIT);
 const movement=items.find(x=>x.score_delta!==null&&x.score_delta!==0)||null;
 return {
  ready:true,status:'READY',schemaVersion:status.schema_version,
  trackingSince:status.tracking_since,
  hasHistory:items.length>0,hasMore:all.length>HISTORY_LIMIT,
  limit:HISTORY_LIMIT,items,
  latestScoreMovement:movement?{
   at:movement.captured_at,delta:movement.score_delta,
   previousScore:movement.previous_score,score:movement.score
  }:null,
  outcomeReady:items.some(x=>x.lead_status==='won'||x.lead_status==='lost')
 };
}
