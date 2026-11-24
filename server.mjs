import {createServer} from 'node:http';
import {leadConversionAction} from './crm-lead-conversion.mjs';
import {crmWonOrderCreate} from './crm-won-order-handoff.mjs';
import {leadTransferAction} from './crm-lead-transfer.mjs';
import {legacyLeadTransfersPage} from './crm-legacy-transfers.mjs';
import {historicalCrmArchivePage,CrmHistoricalArchiveError} from './crm-historical-archive.mjs';
import {mastersAction,mastersRead} from './crm-masters.mjs';
import {guardedClientAction} from './crm-client-duplicates.mjs';
import {leadVisitRecordAction} from './crm-visit-result.mjs';
import {crmInteractionAction,crmInteractionsPage} from './crm-interactions.mjs';
import {crmLegacyInteractionsForClient} from './crm-legacy-interactions.mjs';
import {clientAssessmentHistoryRead} from './crm-client-assessments.mjs';
import {crmFollowUpsRead} from './crm-followups.mjs';
import {crmLeadSignalsRead,crmLeadSignalsSave} from './crm-lead-signals.mjs';
import {crmScoreHistoryRead,crmScoreHistoryAfterAction} from './crm-score-history.mjs';
import {crmReminderAction,crmLeadStatusAction} from './crm-reminders.mjs';
import {estimateRead,estimateDraftAction} from './estimate-drafts.mjs';
import {estimateAcceptHandoff} from './estimate-handoff.mjs';
import {estimatorCardsRead,estimatorCardAction} from './estimator-cards.mjs';
import {estimatorPricebookRead,estimatorPricebookAction} from './estimator-pricebook.mjs';
import {createLeadForExistingClient} from './crm-lead-intake.mjs';
import {readFileSync} from 'node:fs';
import {randomBytes, createHmac, createHash, timingSafeEqual, scryptSync, randomUUID} from 'node:crypto';
import {ICON_192, ICON_512} from './pwa-icons.mjs';
import {Pool} from 'pg';
import {catalogSearch} from './catalog.mjs';
import {myWorkSnapshot} from './my-work.mjs';
import {dailyA1Read,dailyA1Action} from './daily-a1.mjs';
import {objectPresenceRead,objectPresenceAction} from './object-presence.mjs';
import {ownerActivityRead,ownerActivityAction} from './owner-activity.mjs';
import {scheduleRead,scheduleAction} from './schedule.mjs';
import {scheduleHourlyRead,scheduleHourlyNextSourceRead} from './schedule-hourly.mjs';
import {scheduleConflictSourceRead} from './schedule-conflicts.mjs';
import {capacityRead} from './capacity.mjs';
import {orderScheduleAction,syncWorkOrderScheduleTx} from './order-schedule.mjs';
import {objectCardOrdersRead} from './object-card-orders.mjs';
import {clientPortfolioRead} from './client-portfolio.mjs';
import {orderCardWorklogsRead} from './order-card-worklogs.mjs';
import {workLogFullAction,workLogFullContextRead} from './worklog-full.mjs';
import {objectInteractionAction,objectInteractionsPage} from './object-interactions.mjs';
import {orderInteractionAction,orderInteractionsPage} from './order-interactions.mjs';
import {orderClosePreview} from './order-close-preview.mjs';
import {nativeOrderCloseAction,nativeOrderCloseFactRead} from './native-order-close.mjs';
import {workerAction} from './workers.mjs';
import {workerDayAction,workerDaysRead} from './worker-days.mjs';
import {workerTaskAction,workerTasksRead} from './worker-tasks.mjs';
import {workerBenchmarksRead} from './worker-benchmarks.mjs';
import {benchmarkProposalsRead,benchmarkApprovalAction} from './benchmark-approvals.mjs';
import {historicalOrdersPage,historicalOrderAssessment,historicalFinanceTransactionsPage,historicalFinanceFilterOptions,HistoryOrdersAccessError} from './domains/finance/history-orders-api.mjs';
import {financeOrderResultRead,FinanceOrderResultError} from './domains/finance/finance-order-result.mjs';
import {readNativeFinanceHistory,NativeFinanceHistoryError} from './domains/finance/finance-native-summary-history.mjs';
import {readNativeFinanceEntityResults,NativeFinanceEntityResultsError} from './domains/finance/finance-p4-native-entity-results.mjs';
import {readNativeFinanceTransactionDetail,NativeFinanceTransactionDetailError} from './domains/finance/finance-p3-transaction-detail.mjs';
import {readNativeCapitalOverview,NativeCapitalOverviewError} from './domains/finance/capital-native-overview-history.mjs';
import {financeWorkerOptionsRead,financeWorkerHistoryRead,FinanceWorkerHistoryError} from './domains/finance/finance-worker-history.mjs';
import {financeLegacyWorkersPage,FinanceLegacyReferenceError} from './domains/finance/finance-legacy-reference-search.mjs';
import {financeObjectOptionsRead,financeObjectResultRead,FinanceObjectResultError} from './domains/finance/finance-object-result.mjs';
import {financeCapitalArchiveRead,FinanceCapitalArchiveError} from './domains/finance/finance-capital-archive-api.mjs';
import {readBusinessMonthlyGain,saveBusinessMonthlyGain,BusinessMonthlyGainError} from './domains/finance/business-monthly-gains.mjs';
import {financeReviewRead,financeReviewAction,FinanceReviewError} from './domains/finance/finance-review.mjs';
import {financeReviewAuditRead,FinanceReviewAuditError} from './domains/finance/finance-review-audit.mjs';
import {financeCorrectionRead,financeCorrectionAction,financeCorrectionAuditRead,FinanceCorrectionError} from './domains/finance/finance-corrections.mjs';
import {financeB11OwnerGateway} from './domains/finance/finance-owner-gateway.mjs';
import {postHostedFinanceCapital,NativeFinanceWriterError} from './domains/finance/native-finance-writer.mjs';
import {readNativeFinanceWorkspace,NativeFinanceWorkspaceError} from './domains/finance/native-finance-workspace-read.mjs';
import {readOrderFinancialResult,OrderFinanceResultError} from './domains/finance/finance-native-order-result.mjs';
import {readFinanceOpeningPreview,FinanceOpeningPreviewError} from './domains/finance/finance-opening-readonly.mjs';
import {validateFinanceB15ServerDraft,FinanceB15DraftError} from './domains/finance/finance-draft-server-preview.mjs';
import {financeCsrfForValidatedSession,verifyFinanceCsrfForValidatedSession} from './domains/finance/finance-session-csrf.mjs';
import {financeB12CutoverReadiness,FinanceB12ReadinessError} from './domains/finance/finance-cutover-readiness.mjs';
import {referenceCatalogPage,ReferenceCatalogError} from './service-reference.mjs';

const isolatedCiDatabase = process.env.NODE_ENV==='test' && process.env.MVP_DATABASE_SSL==='disable';
const pool = new Pool({connectionString:process.env.DATABASE_URL, ssl:isolatedCiDatabase?false:{rejectUnauthorized:false}, max:4, connectionTimeoutMillis:10000, idleTimeoutMillis:10000});
const COOKIE_KEY = process.env.COOKIE_KEY || '';
const CLAIM_TOKEN_SHA256 = process.env.CLAIM_TOKEN_SHA256 || '';
if(!process.env.DATABASE_URL || COOKIE_KEY.length<40 || !/^[0-9a-f]{64}$/.test(CLAIM_TOKEN_SHA256)) throw Error('MVP_REQUIRED_SERVER_SECRETS_MISSING');
const attempts = new Map();
const originPolicy = process.env.ALLOWED_ORIGIN || '';
const files = {
 '/': ['text/html; charset=utf-8',readFileSync(new URL('./public/index.html',import.meta.url))],
 '/app.js': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/app.js',import.meta.url))],
 '/estimate-plumbing.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/estimate-plumbing.mjs',import.meta.url))],
 '/estimate-pricebook.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/estimate-pricebook.mjs',import.meta.url))],
 '/engineering-preview.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/engineering-preview.mjs',import.meta.url))],
 '/engineering-preview.css': ['text/css; charset=utf-8',readFileSync(new URL('./public/engineering-preview.css',import.meta.url))],
 '/engineering-calculator.css': ['text/css; charset=utf-8',readFileSync(new URL('./public/engineering-calculator.css',import.meta.url))],
 '/engineering-calculator.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/engineering-calculator.mjs',import.meta.url))],
 '/eng-thermal-passport-helpers.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/eng-thermal-passport-helpers.mjs',import.meta.url))],
 '/eng-thermal-snapshot-v010.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/eng-thermal-snapshot-v010.mjs',import.meta.url))],
 '/eng-room-net-v027.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/eng-room-net-v027.mjs',import.meta.url))],
 '/engineering-drawing-geometry.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/engineering-drawing-geometry.mjs',import.meta.url))],
 '/engineering-drawing-ui.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/engineering-drawing-ui.mjs',import.meta.url))],
 '/engineering-floor-model.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/engineering-floor-model.mjs',import.meta.url))],
 '/engineering-floor-ui.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/engineering-floor-ui.mjs',import.meta.url))],
 '/engineering-floor.css': ['text/css; charset=utf-8',readFileSync(new URL('./public/engineering-floor.css',import.meta.url))],
 '/engineering-drawing.css': ['text/css; charset=utf-8',readFileSync(new URL('./public/engineering-drawing.css',import.meta.url))],
 '/eng-heat-loss-v010.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/eng-heat-loss-v010.mjs',import.meta.url))],
 '/eng-radiator-v010.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/eng-radiator-v010.mjs',import.meta.url))],
 '/theme.js': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/theme.js',import.meta.url))],
 '/my-work.js': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/my-work.js',import.meta.url))],
 '/workday-legacy-ui.js': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/workday-legacy-ui.js',import.meta.url))],
 '/worklog-full-ui.js': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/worklog-full-ui.js',import.meta.url))],
 '/worklog-drafts.js': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/worklog-drafts.js',import.meta.url))],
 '/presence.js': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/presence.js',import.meta.url))],
 '/owner-activity.js': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/owner-activity.js',import.meta.url))],
 '/schedule.js': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/schedule.js',import.meta.url))],
 '/capacity.js': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/capacity.js',import.meta.url))],
 '/schedule-hourly.js': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/schedule-hourly.js',import.meta.url))],
 '/schedule-conflicts.js': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/schedule-conflicts.js',import.meta.url))],
 '/schedule-overlap.js': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/schedule-overlap.js',import.meta.url))],
 '/schedule-overlap.css': ['text/css; charset=utf-8',readFileSync(new URL('./public/schedule-overlap.css',import.meta.url))],
 '/schedule-conflicts.css': ['text/css; charset=utf-8',readFileSync(new URL('./public/schedule-conflicts.css',import.meta.url))],
 '/schedule-hourly.css': ['text/css; charset=utf-8',readFileSync(new URL('./public/schedule-hourly.css',import.meta.url))],
 '/capacity.css': ['text/css; charset=utf-8',readFileSync(new URL('./public/capacity.css',import.meta.url))],
 '/today-dashboard.js': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/today-dashboard.js',import.meta.url))],
 '/today-dashboard.css': ['text/css; charset=utf-8',readFileSync(new URL('./public/today-dashboard.css',import.meta.url))],
 '/workers.js': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/workers.js',import.meta.url))],
 '/history-orders-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/history-orders-view.mjs',import.meta.url))],
 '/finance-history-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/finance-history-view.mjs',import.meta.url))],
 '/finance-capital-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/finance-capital-view.mjs',import.meta.url))],
 '/finance-opening-preview-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/finance-opening-preview-view.mjs',import.meta.url))],
 '/finance-native-workspace-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/finance-native-workspace-view.mjs',import.meta.url))],
 '/capital-waterfall-plan.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/capital-waterfall-plan.mjs',import.meta.url))],
 '/finance-native-summary-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/finance-native-summary-view.mjs',import.meta.url))],
 '/finance-p4-native-entity-results-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/finance-p4-native-entity-results-view.mjs',import.meta.url))],
 '/finance-p4-native-entity-results.css': ['text/css; charset=utf-8',readFileSync(new URL('./public/finance-p4-native-entity-results.css',import.meta.url))],
 '/finance-p3-transaction-editor-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/finance-p3-transaction-editor-view.mjs',import.meta.url))],
 '/finance-p3-transaction-editor.css': ['text/css; charset=utf-8',readFileSync(new URL('./public/finance-p3-transaction-editor.css',import.meta.url))],
 '/finance-native-summary.css': ['text/css; charset=utf-8',readFileSync(new URL('./public/finance-native-summary.css',import.meta.url))],
 '/capital-native-overview-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/capital-native-overview-view.mjs',import.meta.url))],
 '/capital-native-overview.css': ['text/css; charset=utf-8',readFileSync(new URL('./public/capital-native-overview.css',import.meta.url))],
 '/finance-order-result-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/finance-order-result-view.mjs',import.meta.url))],
 '/finance-worker-history-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/finance-worker-history-view.mjs',import.meta.url))],
 '/finance-object-result-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/finance-object-result-view.mjs',import.meta.url))],
 '/menu-groups.css': ['text/css; charset=utf-8',readFileSync(new URL('./public/menu-groups.css',import.meta.url))],
 '/business-monthly-gains-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/business-monthly-gains-view.mjs',import.meta.url))],
 '/finance-review-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/finance-review-view.mjs',import.meta.url))],
 '/finance-review-audit-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/finance-review-audit-view.mjs',import.meta.url))],
 '/finance-corrections-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/finance-corrections-view.mjs',import.meta.url))],
 '/finance-correction-audit-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./domains/finance/finance-correction-audit-view.mjs',import.meta.url))],
 '/history-orders-view.css': ['text/css; charset=utf-8',readFileSync(new URL('./domains/finance/history-orders-view.css',import.meta.url))],
 '/service-reference-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/service-reference-view.mjs',import.meta.url))],
 '/crm-legacy-transfers-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/crm-legacy-transfers-view.mjs',import.meta.url))],
 '/crm-history-archive-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/crm-history-archive-view.mjs',import.meta.url))],
 '/crm-history-archive.css': ['text/css; charset=utf-8',readFileSync(new URL('./public/crm-history-archive.css',import.meta.url))],
 '/service-reference.css': ['text/css; charset=utf-8',readFileSync(new URL('./public/service-reference.css',import.meta.url))],
 '/order-close-preview-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/order-close-preview-view.mjs',import.meta.url))],
 '/native-close-view.mjs': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/native-order-close-view.mjs',import.meta.url))],
 '/a1.js': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/a1.js',import.meta.url))],
 '/style.css': ['text/css; charset=utf-8',readFileSync(new URL('./public/style.css',import.meta.url))],
 '/manifest.webmanifest': ['application/manifest+json; charset=utf-8',readFileSync(new URL('./public/manifest.webmanifest',import.meta.url))],
 '/sw.js': ['text/javascript; charset=utf-8',readFileSync(new URL('./public/sw.js',import.meta.url))],
 '/icon-192.png':['image/png',ICON_192],
 '/icon-512.png':['image/png',ICON_512]
};
class AppError extends Error {constructor(status,message){super(message);this.status=status;}}
const requireText=(v,max=180)=>{const s=String(v??'').trim();if(!s||s.length>max)throw new AppError(400,'Проверь обязательное поле.');return s;};
const optText=(v,max=2000)=>{const s=String(v??'').trim();if(s.length>max)throw new AppError(400,'Слишком длинный текст.');return s;};
const allow=(v,values)=>{if(!values.includes(v))throw new AppError(400,'Недопустимый статус.');return v;};
const uuid=v=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||'')))throw new AppError(400,'Некорректный идентификатор.');return String(v);};
const maybeUuid=v=>v?uuid(v):null;
const safeDate=v=>{
 const s=String(v??'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new AppError(400,'Укажи корректную дату.');
 const d=new Date(s+'T00:00:00.000Z');
 if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==s)throw new AppError(400,'Укажи корректную дату.');
 return s;
};
const safeRevision=v=>{const n=Number(v);if(!Number.isInteger(n)||n<1||n>2147483647)throw new AppError(400,'Некорректная версия записи.');return n;};
const workFields=p=>{
 const n=Number(p.minutes);
 if(!Number.isInteger(n)||n<1||n>1440)throw new AppError(400,'Время должно быть от 1 до 1440 минут.');
 let quantity=null;
 if(p.quantity!==undefined&&p.quantity!==null&&p.quantity!==''){
  quantity=Number(p.quantity);
  if(!Number.isFinite(quantity)||quantity<0||quantity>99999999999)throw new AppError(400,'Некорректный объём.');
 }
 return {title:requireText(p.title,180),minutes:n,quantity,unit:optText(p.unit,30),notes:optText(p.notes)};
};
const dayYerevan=()=>{const a=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Yerevan',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));return a.year+'-'+a.month+'-'+a.day;};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
const getCookies=req=>Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>x.trim().split('=')).filter(x=>x.length===2));
const signature=s=>createHmac('sha256',COOKIE_KEY).update(s).digest('hex');
function sessionValid(req){
 const parts=String(getCookies(req).vbos_sid||'').split('.');
 if(parts.length!==3)return false;
 const [issued,nonce,mac]=parts;
 if(!/^\d{10,13}$/.test(issued)||!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)||!/^[0-9a-f]{64}$/.test(mac))return false;
 const ts=Number(issued);
 if(ts>Date.now()+60000 || Date.now()-ts>30*86400000)return false;
 const expected=Buffer.from(signature(issued+'.'+nonce),'hex');
 return timingSafeEqual(Buffer.from(mac,'hex'),expected);
}
function cookie(res,req,clear=false){
 const secure=req.headers['x-forwarded-proto']==='https'?' Secure;':'';
 const value=clear?'':(()=>{const value=String(Date.now())+'.'+randomBytes(18).toString('base64url');return value+'.'+signature(value);})();
 res.setHeader('Set-Cookie','vbos_sid='+value+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+(clear?'0':'2592000')+';'+secure);
}
async function readBody(req){
 if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new AppError(415,'Требуется JSON.');
 let text='';
 for await(const c of req){text+=c;if(text.length>25000)throw new AppError(413,'Слишком большой запрос.');}
 try{const o=JSON.parse(text);if(!o||typeof o!=='object'||Array.isArray(o))throw Error('bad');return o;}
 catch{throw new AppError(400,'Некорректные данные.');}
}
function originCheck(req){
 const origin=req.headers.origin;
 const requestedHost=req.headers['x-forwarded-host']||req.headers.host;
 if(!origin||(!originPolicy && new URL(origin).host!==requestedHost) || (originPolicy && origin!==originPolicy))throw new AppError(403,'Запрос отклонён.');
}
function financeStrictSameOrigin(req){
 const origin=req.headers.origin;
 if(typeof origin!=='string')return false;
 if(originPolicy)return origin===originPolicy;
 const host=req.headers['x-forwarded-host']||req.headers.host;
 const protocol=req.headers['x-forwarded-proto']||'http';
 return typeof host==='string'&&['http','https'].includes(protocol)&&
  origin===protocol+'://'+host;
}
async function ownerLogin(){
 const q=await pool.query("SELECT setting_value FROM public.mvp_settings WHERE setting_key='owner_login'");
 return q.rows[0]?.setting_value||null;
}
async function authHash(){
 const q=await pool.query("SELECT setting_value FROM public.mvp_settings WHERE setting_key='password_hash'");
 return q.rows[0]?.setting_value||null;
}
function verifyPassword(value,encoded){
 const [salt,hash]=String(encoded).split(':');
 if(!/^[0-9a-f]{32}$/.test(salt||'')||!/^[0-9a-f]{128}$/.test(hash||''))throw Error('INVALID_PASSWORD_SETUP');
 const derived=scryptSync(String(value),Buffer.from(salt,'hex'),64);
 return timingSafeEqual(derived,Buffer.from(hash,'hex'));
}
function newHash(password){
 const salt=randomBytes(16);return salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex');
}
const limitLogin=req=>{
 const key=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0];
 const now=Date.now(),rec=attempts.get(key)||{at:now,fail:0};
 if(now-rec.at>60000){rec.at=now;rec.fail=0;}
 if(rec.fail>=6)throw new AppError(429,'Слишком много попыток. Попробуй позже.');
 return {key,rec};
};
// Legacy WorkOrder v1.9.2 exact bind: owner-authenticated, indexed read only.
// Never derive a client order from a paginated Calendar or /api/state's first 500 rows.
async function workOrderCapacityContext(url){
 const id=uuid(url.searchParams.get('id'));
 const result=await pool.query(
  'SELECT o.id,o.object_id,o.title,o.status,o.planned_on::text AS planned_on,'+
  ' ob.name AS object_name FROM public.mvp_orders o'+
  ' JOIN public.mvp_objects ob ON ob.id=o.object_id WHERE o.id=$1 LIMIT 1',[id]);
 const row=result.rows[0];
 if(!row)throw new AppError(404,'Заказ или его объект не найден.');
 if(!['open','active'].includes(row.status))throw new AppError(409,'Нельзя планировать завершённый или отменённый заказ.');
 return {version:'WORKORDER_CAPACITY_EXACT_V191_192',source:'MVP_ORDERS_OBJECTS_ID',
  orderId:row.id,objectId:row.object_id,title:row.title,objectName:row.object_name,
  status:row.status,plannedStartDate:row.planned_on||null,bookingReady:false};
}

async function state(){
 const names=['mvp_leads','mvp_clients','mvp_objects','mvp_orders','mvp_work_days','mvp_sessions','mvp_work_logs'];
 const orders=['updated_at','updated_at','created_at','updated_at','day_date','started_at','day_date'];
 const rows=await Promise.all(names.map((n,i)=>n==='mvp_work_logs'?pool.query(
  'SELECT l.*,l.day_date::text AS day_date,to_jsonb(d) AS detail FROM public.mvp_work_logs l '+
  'LEFT JOIN public.mvp_work_log_details d ON d.work_log_id=l.id ORDER BY l.day_date DESC,l.created_at DESC LIMIT 501'):
  pool.query('SELECT '+(n==='mvp_objects'?'*,xmin::text AS row_version':'*')+' FROM public.'+n+' ORDER BY '+orders[i]+' DESC LIMIT 501')));
 const q=await pool.query('SELECT label,source_date,report FROM public.mvp_legacy_finance_report WHERE id=1');
 const workerSources=['mvp_workers','mvp_worker_order_assignments','mvp_manual_plan_workers','mvp_worker_days','mvp_worker_day_orders','mvp_worker_tasks'];
 const workerOrders=['created_at','assigned_at','assigned_at','day_date','linked_at','created_at'];
 const linked=await Promise.all(workerSources.map((name,i)=>pool.query('SELECT '+(name==='mvp_worker_days'?'w.*,w.day_date::text AS day_date':'w.*')+' FROM public.'+name+' AS w ORDER BY w.'+workerOrders[i]+' DESC,w.id LIMIT 501')));
 const workLogReferences=await pool.query('SELECT service_id,service_name,category,action_code,status FROM public.mvp_services_reference ORDER BY category,service_name,service_id LIMIT 201');
 const crmLinks=await pool.query('SELECT lead_id,client_id,object_id,source_kind,created_at FROM public.mvp_crm_lead_client_links ORDER BY created_at DESC,lead_id LIMIT 501');
 const crmIntakes=await pool.query('SELECT lead_id,client_id,source_kind,created_at FROM public.mvp_crm_lead_intakes ORDER BY created_at DESC,lead_id LIMIT 501');
 const leadTransfers=await pool.query('SELECT id,lead_id,recipient_name,master_id,reason,comment,transferred_at,source_system FROM public.mvp_crm_lead_transfers ORDER BY transferred_at DESC,id DESC LIMIT 501');
 const archivedClients=await pool.query("SELECT target_id FROM public.mvp_legacy_import_map WHERE source_entity='Clients' AND source_payload->>'status'='archived' ORDER BY source_id LIMIT 501");
 const legacyOrders=await pool.query(
  "SELECT target_id,source_payload->>'status' AS source_status FROM public.mvp_legacy_import_map WHERE source_system='Working IP APP / M8C cutover baseline' AND source_entity='WorkOrders' ORDER BY source_id LIMIT 501");
 const result={today:dayYerevan(),
  draftOwnerScope:createHash('sha256').update('vbos-clean:worklog-draft:v1:'+(await ownerLogin())).digest('hex'),
  legacyReport:q.rows[0]||null,
  workLogServiceReferences:workLogReferences.rows.slice(0,200),
  workLogServiceReferencesTruncated:workLogReferences.rows.length>200,
  legacyGoogleOrderIds:legacyOrders.rows.slice(0,500).map(x=>x.target_id),
  legacyGoogleOrderStatusById:Object.fromEntries(legacyOrders.rows.slice(0,500).map(x=>[x.target_id,x.source_status])),
  leadClientLinks:crmLinks.rows.slice(0,500),
  leadIntakes:crmIntakes.rows.slice(0,500),
  leadTransfers:leadTransfers.rows.slice(0,500),
  archivedLegacyClientIds:archivedClients.rows.slice(0,500).map(x=>x.target_id),
  listsTruncated:rows.some(x=>x.rows.length>500)||linked.some(x=>x.rows.length>500)||legacyOrders.rows.length>500||crmLinks.rows.length>500||crmIntakes.rows.length>500||leadTransfers.rows.length>500||archivedClients.rows.length>500};
 for(let i=0;i<names.length;i++)result[['leads','clients','objects','orders','days','sessions','logs'][i]]=rows[i].rows.slice(0,500);
 for(let i=0;i<workerSources.length;i++)result[['workers','workerOrderAssignments','manualPlanWorkers','workerDays','workerDayOrders','workerTasks'][i]]=linked[i].rows.slice(0,500);
 return result;
}
// Bounded, stable keyset: day + creation timestamp + immutable UUID.
async function historyPage(url){
 const limit=Number(url.searchParams.get('limit')||25);
 if(!Number.isInteger(limit)||limit<1||limit>50)throw new AppError(400,'Размер страницы: от 1 до 50.');
 const from=safeDate(url.searchParams.get('from')||dayYerevan());
 const to=safeDate(url.searchParams.get('to')||from);
 if(from>to)throw new AppError(400,'Начальная дата позже конечной.');
 const orderId=url.searchParams.get('orderId')?uuid(url.searchParams.get('orderId')):null;
 let cursor=null;
 const raw=url.searchParams.get('cursor');
 if(raw){
  if(raw.length>400||!/^[A-Za-z0-9_-]+$/.test(raw))throw new AppError(400,'Неверная страница истории.');
  try{
   const parsed=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
   if(!Array.isArray(parsed)||parsed.length!==3)throw Error('bad');
   const date=safeDate(parsed[0]),at=new Date(parsed[1]);
   if(!Number.isFinite(at.getTime())||at.toISOString()!==parsed[1])throw Error('bad');
   cursor=[date,at.toISOString(),uuid(parsed[2])];
  }catch{throw new AppError(400,'Неверная страница истории.');}
 }
 const args=[from,to];
 let where='l.day_date BETWEEN $1::date AND $2::date';
 if(orderId){args.push(orderId);where+=' AND l.order_id=$'+args.length+'::uuid';}
 if(cursor){
  const a=args.length+1;
  args.push(...cursor);
  where+=' AND (l.day_date,l.created_at,l.id)<($'+a+'::date,$'+(a+1)+'::timestamptz,$'+(a+2)+'::uuid)';
 }
 args.push(limit+1);
 const q=await pool.query('SELECT l.*,l.day_date::text AS day_date,o.title AS order_title,to_jsonb(d) AS detail FROM public.mvp_work_logs l '+
  'LEFT JOIN public.mvp_orders o ON o.id=l.order_id '+
  'LEFT JOIN public.mvp_work_log_details d ON d.work_log_id=l.id WHERE '+where+
  ' ORDER BY l.day_date DESC,l.created_at DESC,l.id DESC LIMIT $'+args.length,args);
 const items=q.rows.slice(0,limit),hasMore=q.rows.length>limit,last=items.at(-1);
 const nextCursor=hasMore&&last?Buffer.from(JSON.stringify([String(last.day_date).slice(0,10),new Date(last.created_at).toISOString(),last.id])).toString('base64url'):null;
 return {items,hasMore,nextCursor,limit};
}
// Single atomic action: opening the day, starting a session and activating the order.
async function startWorkFromOrder(p,key) {
 const orderId=uuid(p.orderId);
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const previous=await client.query('SELECT * FROM public.mvp_sessions WHERE request_key=$1',[key]);
  if(previous.rows.length){
   if(previous.rows[0].order_id!==orderId)throw new AppError(409,'Ключ запроса уже использован для другого заказа.');
   await client.query('COMMIT');
   return {saved:true,item:previous.rows[0],deduplicated:true};
  }
  const order=await client.query('SELECT id,title,status FROM public.mvp_orders WHERE id=$1 FOR UPDATE',[orderId]);
  if(!order.rows.length||!['open','active'].includes(order.rows[0].status))
   throw new AppError(409,'Заказ недоступен для начала работы.');
  const ongoing=await client.query('SELECT id FROM public.mvp_sessions WHERE ended_at IS NULL LIMIT 1');
  if(ongoing.rows.length)throw new AppError(409,'Сначала заверши текущий рабочий интервал.');
  const today=dayYerevan();
  await client.query('INSERT INTO public.mvp_work_days(day_date) VALUES($1) ON CONFLICT(day_date) DO NOTHING',[today]);
  const day=await client.query('SELECT id,status FROM public.mvp_work_days WHERE day_date=$1 FOR UPDATE',[today]);
  if(day.rows[0]?.status!=='open')throw new AppError(409,'Сегодняшний рабочий день уже закрыт.');
  const session=await client.query(
   'INSERT INTO public.mvp_sessions(request_key,day_id,order_id,description) VALUES($1,$2,$3,$4) RETURNING *',
   [key,day.rows[0].id,orderId,'Заказ: '+order.rows[0].title]
  );
  // Imported WorkOrders stay Google-owned: starting today's work must not
  // silently advance their order status or overwrite their calendar projection.
  const imported=await client.query(
   "SELECT 1 FROM public.mvp_legacy_import_map WHERE source_system='Working IP APP / M8C cutover baseline' AND source_entity='WorkOrders' AND target_id=$1 LIMIT 1",[orderId]);
  if(!imported.rowCount){
   await client.query("UPDATE public.mvp_orders SET status='active',revision=revision+1,updated_at=now() WHERE id=$1 AND status='open'",[orderId]);
   const activeOrder=await client.query('SELECT * FROM public.mvp_orders WHERE id=$1',[orderId]);
   await syncWorkOrderScheduleTx(client,activeOrder.rows[0]);
  }
  await client.query('COMMIT');
  return {saved:true,item:session.rows[0]};
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{client.release();}
}

/* Close only after serialized visit/session checks; never race with a presence arrival. */
async function closeDaySafely(){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(151106,20261107)');
  const day=await client.query('SELECT id,status FROM public.mvp_work_days WHERE day_date=$1::date FOR UPDATE',[dayYerevan()]);
  if(!day.rows.length||day.rows[0].status!=='open')throw new AppError(409,'Рабочий день уже закрыт или ещё не открыт.');
  if((await client.query('SELECT id FROM public.mvp_sessions WHERE ended_at IS NULL LIMIT 1')).rows.length)
   throw new AppError(409,'Сначала заверши текущий рабочий интервал.');
  if((await client.query("SELECT id FROM public.mvp_object_presence WHERE status='open' LIMIT 1")).rows.length)
   throw new AppError(409,'Сначала отметь уход с текущего объекта.');
  const update=await client.query("UPDATE public.mvp_work_days SET status='closed',closed_at=coalesce(closed_at,now()) WHERE id=$1 AND status='open' RETURNING *",[day.rows[0].id]);
  if(!update.rows.length)throw new AppError(409,'Рабочий день изменён. Обнови экран.');
  await client.query('COMMIT');
  return {saved:true,item:update.rows[0]};
 }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}
 finally{client.release();}
}

async function action(type,p){
 const key=uuid(p.requestKey||randomUUID());
 if(type==='client_create'||type==='client_update')return guardedClientAction({pool,type,p,key,uuid,safeRevision,requireText,optText,allow,AppError});
 if(type==='lead_create'&&p.clientId)return createLeadForExistingClient({pool,p,key,uuid,requireText,optText,AppError});
 if(type==='lead_convert')return leadConversionAction({pool,p,key,uuid,safeRevision,AppError});
 if(type==='crm_won_order_create')return crmWonOrderCreate({pool,p,key,uuid,requireText,optText,safeDate,AppError});
 if(type==='lead_transfer')return leadTransferAction({pool,p,key,uuid,safeRevision,AppError});
 if(type==='crm_master_create'||type==='crm_master_update')return mastersAction({pool,type,p,key,uuid,safeRevision,AppError});
 if(type==='lead_visit_record')return leadVisitRecordAction({pool,p,key,uuid,safeRevision,safeDate,AppError});
 if(type==='crm_interaction_add')return crmInteractionAction({pool,p,key,uuid,safeDate,dayYerevan,AppError});
 if(type==='object_interaction_add')return objectInteractionAction({pool,p,key,uuid,AppError});
 if(type==='order_interaction_add')return orderInteractionAction({pool,p,key,uuid,AppError});
 if(type==='crm_reminder_save')return crmReminderAction({pool,p,key,uuid,safeDate,safeRevision,AppError});
 if(type==='crm_signal_save')return crmLeadSignalsSave({pool,p,key,uuid,safeRevision,AppError});
 if(type==='lead_status')return crmLeadStatusAction({pool,p,uuid,safeRevision,AppError});
 if(['estimate_create','estimate_save'].includes(type))return estimateDraftAction({pool,type,p,key,uuid,safeRevision,AppError});
 if(['estimator_card_save','estimator_card_archive','estimator_card_reset'].includes(type))return estimatorCardAction({pool,type,p,key,AppError});
 if(['estimator_tariff_save','estimator_price_save'].includes(type))return estimatorPricebookAction({pool,type,p,key,AppError});
 if(type==='estimate_accept_handoff')return estimateAcceptHandoff({pool,p,key,uuid,safeRevision,AppError});
 if(type==='work_start_order')return startWorkFromOrder(p,key);
 if(type==='day_close')return closeDaySafely();
 if(['a1_save','a1_complete','a1_reopen'].includes(type))return dailyA1Action({pool,type,p,key,dayYerevan,safeDate,AppError});
 if(['presence_start','presence_stop','presence_update'].includes(type))return objectPresenceAction({pool,type,p,key,dayYerevan,safeDate,uuid,AppError});
 if(['owner_activity_start','owner_activity_stop','owner_activity_update','owner_activity_archive'].includes(type))return ownerActivityAction({pool,type,p,key,dayYerevan,safeDate,uuid,AppError});
 if(['schedule_save','schedule_archive'].includes(type))return scheduleAction({pool,type,p,key,uuid,safeDate,AppError});
 if(['order_create','order_update','order_status'].includes(type))return orderScheduleAction({pool,type,p,key,uuid,maybeUuid,requireText,optText,safeDate,safeRevision,allow,AppError});
 if(type==='close_work_order')return nativeOrderCloseAction({pool,p,key,uuid,safeDate,safeRevision,AppError});
 if(['worker_create','worker_update','worker_assign_order','worker_remove_order'].includes(type))return workerAction({pool,type,p,key,uuid,AppError});
 if(['worker_day_arrive','worker_day_depart','worker_day_correct'].includes(type))return workerDayAction({pool,type,p,key,uuid,safeDate,dayYerevan,AppError});
 if(['worker_task_start','worker_task_finish'].includes(type))return workerTaskAction({pool,type,p,key,uuid,AppError});
 if(['work_log_full_create','work_log_full_update'].includes(type))
  return workLogFullAction({pool,type,p,key,uuid,safeDate,safeRevision,AppError});
 if(['benchmark_approve','benchmark_revoke'].includes(type))return benchmarkApprovalAction({pool,type,p,key,AppError});
 const q=(sql,params)=>pool.query(sql,params);
 let r;
 switch(type){
 case 'lead_create':
   r=await q('INSERT INTO public.mvp_leads(request_key,title,contact_name,phone,notes) VALUES($1,$2,$3,$4,$5) ON CONFLICT(request_key) DO UPDATE SET request_key=EXCLUDED.request_key RETURNING *',[key,requireText(p.title,160),optText(p.contactName,160),optText(p.phone,60),optText(p.notes)]);break;
 case 'lead_update':
    r=await q('UPDATE public.mvp_leads SET title=$3,contact_name=$4,phone=$5,notes=$6,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 AND status<>\'transferred\' RETURNING *',
      [uuid(p.id),safeRevision(p.revision),requireText(p.title,160),optText(p.contactName,160),optText(p.phone,60),optText(p.notes)]);break;
 case 'lead_status':
   if(p.status==='won')throw new AppError(409,'Для статуса «Успешно» используй преобразование лида в клиента.');
   r=await q("UPDATE public.mvp_leads SET status=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 AND status<>'won' RETURNING *",[uuid(p.id),safeRevision(p.revision),allow(p.status,['new','contacted','qualified','lost'])]);break;
 case 'object_update': {
   const token=String(p.rowVersion??'');
   if(!/^\d{1,12}$/.test(token))throw new AppError(400,'Неизвестная версия объекта. Обнови экран.');
   r=await q('UPDATE public.mvp_objects SET name=$3,address=$4,notes=$5,object_type=COALESCE($6,object_type) WHERE id=$1 AND xmin::text=$2 RETURNING *,xmin::text AS row_version',
   [uuid(p.id),token,requireText(p.name,160),optText(p.address,300),optText(p.notes),p.objectType===undefined?null:optText(p.objectType,100)]);break;
 }
 case 'object_create':
   r=await q('INSERT INTO public.mvp_objects(request_key,client_id,name,address,notes,object_type) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(request_key) DO UPDATE SET request_key=EXCLUDED.request_key RETURNING *',[key,uuid(p.clientId),requireText(p.name,160),optText(p.address,300),optText(p.notes),optText(p.objectType,100)]);break;
  case 'day_open':
   r=await q("INSERT INTO public.mvp_work_days(day_date) VALUES($1) ON CONFLICT(day_date) DO UPDATE SET day_date=EXCLUDED.day_date RETURNING *",[dayYerevan()]);break;
 case 'session_start': {
   const d=await q("SELECT id FROM public.mvp_work_days WHERE day_date=$1 AND status='open'",[dayYerevan()]);
   if(!d.rows.length)throw new AppError(409,'Сначала открой рабочий день.');
   r=await q('INSERT INTO public.mvp_sessions(request_key,day_id,order_id,description) VALUES($1,$2,$3,$4) ON CONFLICT(request_key) DO UPDATE SET request_key=EXCLUDED.request_key RETURNING *',[key,d.rows[0].id,maybeUuid(p.orderId),optText(p.description,300)]);break;
 }
 case 'session_stop':
   r=await q('UPDATE public.mvp_sessions SET ended_at=coalesce(ended_at,now()) WHERE id=$1 RETURNING *',[uuid(p.id)]);break;
 case 'log_update': {
   const detail=await q('SELECT 1 FROM public.mvp_work_log_details WHERE work_log_id=$1',[uuid(p.id)]);
   if(detail.rowCount)throw new AppError(409,'Для этой работы используй полную форму с часами и потерями.');
   const f=workFields(p);
   r=await q('UPDATE public.mvp_work_logs SET day_date=$3,order_id=$4,title=$5,minutes=$6,quantity=$7,unit=$8,notes=$9,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING *',
   [uuid(p.id),safeRevision(p.revision),safeDate(p.dayDate),maybeUuid(p.orderId),f.title,f.minutes,f.quantity,f.unit,f.notes]);break;
 }
 case 'log_create': {
   const f=workFields(p);
   r=await q('INSERT INTO public.mvp_work_logs(request_key,day_date,order_id,title,minutes,quantity,unit,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(request_key) DO UPDATE SET request_key=EXCLUDED.request_key RETURNING *',[key,dayYerevan(),maybeUuid(p.orderId),f.title,f.minutes,f.quantity,f.unit,f.notes]);break;
 }
 default:throw new AppError(404,'Неизвестная операция.');
 }
 if(!r?.rows?.length)throw new AppError(409,'Запись изменилась в другой сессии. Обнови экран.');
 return {saved:true,item:r.rows[0]};
}
async function handler(req,res){
 try{
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'");
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&files[pathname]){
   res.writeHead(200,{'Content-Type':files[pathname][0],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   res.end(files[pathname][1]);return;
  }
  if(pathname==='/health'&&req.method==='GET'){await pool.query('SELECT 1');return json(res,200,{ok:true,database:'PostgreSQL',mode:'CLEAN_START',transactionalWriteRollback:'PASS',commit:process.env.RENDER_GIT_COMMIT||'local'});}
  if(pathname==='/api/bootstrap'&&req.method==='GET'){
    return json(res,200,{setupRequired:!(await ownerLogin()),installable:true});
  }
  if(pathname==='/api/setup'&&req.method==='POST'){
    originCheck(req);const check=limitLogin(req),body=await readBody(req);
    const claim=String(body.claimCode||'').trim();
    const digest=createHash('sha256').update(claim).digest();
    if(claim.length<12||!timingSafeEqual(digest,Buffer.from(CLAIM_TOKEN_SHA256,'hex'))){
      check.rec.fail++;attempts.set(check.key,check.rec);throw new AppError(403,'Неверный код активации.');
    }
    const login=String(body.login||'').trim().toLowerCase();
    if(!/^[a-z0-9_.-]{3,48}$/.test(login))throw new AppError(400,'Логин: 3–48 латинских букв, цифр, точек или дефисов.');
    if(typeof body.password!=='string'||body.password.length<10||body.password.length>200)throw new AppError(400,'Пароль: от 10 до 200 символов.');
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(151106,20261103)');
      const existing=await client.query("SELECT 1 FROM public.mvp_settings WHERE setting_key='owner_login'");
      if(existing.rows.length)throw new AppError(409,'Владелец уже зарегистрирован.');
      await client.query("INSERT INTO public.mvp_settings(setting_key,setting_value) VALUES('owner_login',$1),('password_hash',$2)",[login,newHash(body.password)]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally{client.release();}
    attempts.delete(check.key);cookie(res,req);
    return json(res,201,{ok:true,registered:true});
  }
  if(pathname==='/api/login'&&req.method==='POST'){
    originCheck(req);const check=limitLogin(req),body=await readBody(req);
    const account=await ownerLogin();
    if(!account)throw new AppError(428,'Сначала создай учётную запись владельца.');
    const savedHash=await authHash();
    const good=typeof body.login==='string'&&body.login.trim().toLowerCase()===account &&
      typeof body.password==='string'&&body.password.length<=200&&savedHash&&verifyPassword(body.password,savedHash);
    if(!good){check.rec.fail++;attempts.set(check.key,check.rec);throw new AppError(401,'Неправильный пароль.');}
    attempts.delete(check.key);cookie(res,req);return json(res,200,{ok:true});
  }
  if(pathname.startsWith('/api/')){
   if(!sessionValid(req))throw new AppError(401,'Войди в приложение.');
   if(req.method==='POST'&&
      ['/api/finance/native-action-preview','/api/finance/draft-validate','/api/finance/post'].includes(pathname)&&
      !financeStrictSameOrigin(req))
    throw new AppError(403,'FINANCE_B12_ORIGIN_REJECTED');
   if(req.method==='POST')originCheck(req);
   if(pathname==='/api/logout'&&req.method==='POST'){cookie(res,req,true);return json(res,200,{ok:true});}
   // Finance B13: read-only attested stock; inherits the real signed owner session.
   // No monetary action path is added or enabled by this endpoint.
   if(pathname==='/api/finance/opening-preview'&&req.method==='GET'){
    try{return json(res,200,await readFinanceOpeningPreview(pool));}
    catch(error){
     if(error instanceof FinanceOpeningPreviewError)
      throw new AppError(error.status,error.code);
     throw error;
    }
   }
   // Finance B12: same signed owner session as all Clean routes. A session-
   // scoped HMAC CSRF proof is fetchable only after owner authentication.
   if(pathname==='/api/finance/csrf'&&req.method==='GET'){
    const token=financeCsrfForValidatedSession(getCookies(req).vbos_sid,COOKIE_KEY);
    if(!token)throw new AppError(401,'Войди в приложение.');
    return json(res,200,{version:'FINANCE_B12_CSRF_V1',token,financialWriterEnabled:false});
   }
   // B15: owner session, strict origin and CSRF are mandatory on draft POST.
   // Only B13 READ ONLY opening and B2 pure calculations; NO money writer.
   if(pathname==='/api/finance/draft-validate'&&req.method==='POST'){
    if(!verifyFinanceCsrfForValidatedSession(
      req.headers['x-finance-csrf'],getCookies(req).vbos_sid,COOKIE_KEY))
     throw new AppError(403,'FINANCE_B15_CSRF_REJECTED');
    const payload=await readBody(req);
    try{return json(res,200,await validateFinanceB15ServerDraft(pool,payload,{
      todayKey:dayYerevan()
    }));}
    catch(error){
     if(error instanceof FinanceB15DraftError)
      throw new AppError(error.status,error.code);
     if(error instanceof FinanceOpeningPreviewError||['42P01','3F000'].includes(error?.code))
      throw new AppError(503,'FINANCE_B15_SOURCE_UNAVAILABLE');
     throw error;
    }
   }

   // Finance B18: native-only PostgreSQL view, historical Google records are never editable here.
   if(pathname==='/api/finance/native-workspace'&&req.method==='GET'){
    try{return json(res,200,await readNativeFinanceWorkspace(pool,{
     authorizeOwner:()=>sessionValid(req)
    }));}
    catch(error){
     if(error instanceof NativeFinanceWorkspaceError)throw new AppError(error.status,error.code);
     throw error;
    }
   }
   // B23: exact native UUID, canonical PostgreSQL ledger, read-only.
   // Historical legacy WorkOrders and Google Finance are never joined here.
   if(pathname==='/api/finance/order-native-result'&&req.method==='GET'){
    const url=new URL(req.url,'http://localhost');
    try{
     return json(res,200,await readOrderFinancialResult(pool,url.searchParams.get('orderId'),{
      authorizeOwner:()=>sessionValid(req),
      cursor:url.searchParams.get('cursor'),
      limit:20
     }));
    }catch(error){
     if(error instanceof OrderFinanceResultError)throw new AppError(error.status,error.code);
     if(['42P01','3F000','42501'].includes(error?.code))
      throw new AppError(503,'Нативный финансовый реестр заказов недоступен.');
     throw error;
    }
   }
   // Finance P1: owner-authenticated native-only cumulative totals and filtered history.
   // Dates/type/search apply to rows, never to the accumulated scope totals.
   if(pathname==='/api/finance/native-summary-history'&&req.method==='GET'){
    try{
     return json(res,200,await readNativeFinanceHistory(pool,
      new URL(req.url,'http://localhost').searchParams,{authorizeOwner:()=>sessionValid(req)}));
    }catch(error){
     if(error instanceof NativeFinanceHistoryError)
      throw new AppError(error.status,error.code);
     if(error instanceof NativeFinanceWorkspaceError)
      throw new AppError(error.status,error.status===503?'FINANCE_P1_ATTESTED_SOURCE_UNAVAILABLE':error.code);
     if(['42P01','3F000','42501'].includes(error?.code))
      throw new AppError(503,'Нативный финансовый источник недоступен.');
     throw error;
    }
   }
   // Finance P4: signed native-only object/worker aggregate results, READ ONLY.
   if(pathname==='/api/finance/native-entity-results'&&req.method==='GET'){
    try{
     return json(res,200,await readNativeFinanceEntityResults(pool,
      new URL(req.url,'http://localhost').searchParams,
      {authorizeOwner:()=>sessionValid(req)}));
    }catch(error){
     if(error instanceof NativeFinanceEntityResultsError)
      throw new AppError(error.status,error.code);
     if(error instanceof NativeFinanceWorkspaceError)
      throw new AppError(error.status,error.code);
     if(['42P01','3F000','42501'].includes(error?.code))
      throw new AppError(503,'Нативная аналитика объектов/работников недоступна.');
     throw error;
    }
   }
   // Finance P3: owner-attested read of one NEW native transaction only; never a writer.
   if(pathname==='/api/finance/native-transaction-detail'&&req.method==='GET'){
    try{
     return json(res,200,await readNativeFinanceTransactionDetail(pool,
      new URL(req.url,'http://localhost').searchParams.get('id'),
      {authorizeOwner:()=>sessionValid(req)}));
    }catch(error){
     if(error instanceof NativeFinanceTransactionDetailError)
      throw new AppError(error.status,error.code);
     if(error instanceof NativeFinanceWorkspaceError)
      throw new AppError(error.status,error.code);
     if(['42P01','3F000','42501'].includes(error?.code))
      throw new AppError(503,'Нативная финансовая операция недоступна.');
     throw error;
    }
   }
   // Capital P2: owner-attested PostgreSQL fund summary and full movement history.
   // No writer or fund settings are exposed through this GET.
   if(pathname==='/api/capital/native-overview-history'&&req.method==='GET'){
    try{
     return json(res,200,await readNativeCapitalOverview(pool,
      new URL(req.url,'http://localhost').searchParams,{authorizeOwner:()=>sessionValid(req)}));
    }catch(error){
     if(error instanceof NativeCapitalOverviewError)
      throw new AppError(error.status,error.code);
     if(error instanceof NativeFinanceWorkspaceError)
      throw new AppError(error.status,error.status===503?'CAPITAL_P2_ATTESTED_SOURCE_UNAVAILABLE':error.code);
     if(['42P01','3F000','42501'].includes(error?.code))
      throw new AppError(503,'Нативные фонды PostgreSQL сейчас недоступны.');
     throw error;
    }
   }
   // Finance B17: guarded owner-only POST. An absent exact deployment switch
   // refuses the request before parsing money or touching financial tables.
   if(pathname==='/api/finance/post'&&req.method==='POST'){
    if(!verifyFinanceCsrfForValidatedSession(
       req.headers['x-finance-csrf'],getCookies(req).vbos_sid,COOKIE_KEY))
     throw new AppError(403,'FINANCE_B17_CSRF_REJECTED');
    if(process.env.FINANCE_NATIVE_POSTING_ENABLE!=='OWNER_APPROVED_CLEAN_TEST')
     throw new AppError(503,'FINANCE_B17_WRITER_NOT_YET_ENABLED');
    const input=await readBody(req);
    if(!input||typeof input!=='object'||Array.isArray(input)||
       Object.keys(input).some(k=>!['action','requestKey','payload'].includes(k)))
     throw new AppError(400,'FINANCE_B17_UNEXPECTED_REQUEST_FIELDS');
    try{
     const result=await postHostedFinanceCapital(pool,{
      action:input.action,requestKey:input.requestKey,payload:input.payload,
      context:{ownerSessionVerified:true,csrfVerified:true}
     });
     return json(res,200,result);
    }catch(error){
     if(error instanceof NativeFinanceWriterError){
      const status=/B17_|AUTHORITY|GATE|BEFORE_CUTOVER|SNAPSHOT/.test(error.code)?503:
       /REVISION_CONFLICT|IDEMPOTENCY_PAYLOAD_CONFLICT|RACE|STATUS_CONFLICT/.test(error.code)?409:400;
      throw new AppError(status,error.code);
     }
     throw error;
    }
   }
   // B11's verified archive/native preview is now mounted READ-ONLY under
   // the REAL Clean session gate; B10 synthetic posting is NOT mounted.
   if(pathname==='/api/finance/native-ledger-preview'&&req.method==='GET'){
    const response=await financeB11OwnerGateway({
     method:'GET',path:pathname,db:pool,authorizeOwner:()=>sessionValid(req)
    });
    return json(res,response.status,response.body);
   }
   // Read-only owner evidence: a proposed date does not certify a fresh
   // Google as-of freeze or authorize initial balances and native posting.
   if(pathname==='/api/finance/cutover-readiness'&&req.method==='GET'){
    const response=await financeB11OwnerGateway({
     method:'GET',path:'/api/finance/native-ledger-preview',
     db:pool,authorizeOwner:()=>sessionValid(req)
    });
    if(response.status!==200)return json(res,response.status,response.body);
    try{
     const cutover=new URL(req.url,'http://localhost').searchParams.get('cutoverDateKey');
     return json(res,200,financeB12CutoverReadiness(response.body,{
      proposedCutoverDateKey:cutover
     }));
    }catch(error){
     if(error instanceof FinanceB12ReadinessError)
      throw new AppError(error.status,error.code);
     throw error;
    }
   }
   // Global Origin guard + signed owner session + dedicated CSRF for the
   // reserved POST path. REAL money writer remains disabled by code.
   if(pathname==='/api/finance/native-action-preview'&&req.method==='POST'){
    if(!verifyFinanceCsrfForValidatedSession(
     req.headers['x-finance-csrf'],getCookies(req).vbos_sid,COOKIE_KEY))
     throw new AppError(403,'FINANCE_B12_CSRF_REJECTED');
    return json(res,503,{error:'FINANCE_B12_REAL_MONEY_WRITER_DISABLED'});
   }
   if(pathname==='/api/state'&&req.method==='GET')return json(res,200,await state());
   if(pathname==='/api/clients/portfolio'&&req.method==='GET')return json(res,200,await clientPortfolioRead({pool,url:new URL(req.url,'http://localhost'),uuid,AppError}));
   if(pathname==='/api/objects/orders'&&req.method==='GET'){
    const url=new URL(req.url,'http://localhost');
    return json(res,200,await objectCardOrdersRead({pool,objectId:url.searchParams.get('id'),
     cursor:url.searchParams.get('cursor'),uuid,AppError}));
   }
   if(pathname==='/api/objects/interactions'&&req.method==='GET')return json(res,200,await objectInteractionsPage({pool,url:new URL(req.url,'http://localhost'),uuid,AppError}));
   if(pathname==='/api/orders/interactions'&&req.method==='GET')return json(res,200,await orderInteractionsPage({pool,url:new URL(req.url,'http://localhost'),uuid,AppError}));
   if(pathname==='/api/orders/capacity-context'&&req.method==='GET')return json(res,200,await workOrderCapacityContext(new URL(req.url,'http://localhost')));
   if(pathname==='/api/crm/legacy-transfers'&&req.method==='GET')return json(res,200,await legacyLeadTransfersPage({pool,url:new URL(req.url,'http://localhost'),AppError}));
   if(pathname==='/api/crm/masters'&&req.method==='GET')return json(res,200,await mastersRead({pool,url:new URL(req.url,'http://localhost'),AppError}));
   if(pathname==='/api/crm/interactions'&&req.method==='GET')return json(res,200,await crmInteractionsPage({pool,url:new URL(req.url,'http://localhost'),uuid,AppError}));
   if(pathname==='/api/crm/legacy-interactions'&&req.method==='GET')return json(res,200,await crmLegacyInteractionsForClient({pool,clientId:new URL(req.url,'http://localhost').searchParams.get('clientId'),uuid,AppError}));
   if(pathname==='/api/crm/client-assessments'&&req.method==='GET')return json(res,200,await clientAssessmentHistoryRead({pool,clientId:new URL(req.url,'http://localhost').searchParams.get('clientId'),uuid,AppError}));
   if(pathname==='/api/crm/followups'&&req.method==='GET')return json(res,200,await crmFollowUpsRead({pool,url:new URL(req.url,'http://localhost'),dayYerevan,AppError}));
   if(pathname==='/api/crm/lead-signals'&&req.method==='GET'){
    const signals=await crmLeadSignalsRead({pool,url:new URL(req.url,'http://localhost'),uuid,AppError});
    let history;
    try{history=await crmScoreHistoryRead({pool,leadId:signals.signal.leadId});}
    catch(error){
     console.warn('CRM12A_HISTORY_READ_UNAVAILABLE',String(error.code||error.name||'ERROR'));
     history={ready:false,status:'UNAVAILABLE',trackingSince:null,items:[]};
    }
    return json(res,200,{...signals,history});
   }
   if(pathname==='/api/estimates'&&req.method==='GET')return json(res,200,await estimateRead({pool,url:new URL(req.url,'http://localhost'),uuid,AppError}));
   if(pathname==='/api/estimator/cards'&&req.method==='GET')return json(res,200,await estimatorCardsRead({pool,AppError}));
   if(pathname==='/api/estimator/pricebook'&&req.method==='GET')return json(res,200,await estimatorPricebookRead({pool,AppError}));
   if(pathname==='/api/orders/close-preview'&&req.method==='GET')return json(res,200,await orderClosePreview(pool,new URL(req.url,'http://localhost'),{authorizeOwner:()=>sessionValid(req),AppError}));
   if(pathname==='/api/orders/close-fact'&&req.method==='GET')return json(res,200,await nativeOrderCloseFactRead({pool,id:new URL(req.url,'http://localhost').searchParams.get('id'),uuid,AppError}));
   if(pathname==='/api/worker-days'&&req.method==='GET')return json(res,200,await workerDaysRead(pool,new URL(req.url,'http://localhost'),{uuid,safeDate,AppError}));
   if(pathname==='/api/worker-tasks'&&req.method==='GET')return json(res,200,await workerTasksRead(pool,new URL(req.url,'http://localhost'),{uuid,safeDate,AppError}));
    if(pathname==='/api/worker-benchmarks'&&req.method==='GET')return json(res,200,await workerBenchmarksRead(pool,new URL(req.url,'http://localhost'),{uuid,safeDate,dayYerevan,AppError}));
    if(pathname==='/api/benchmark-proposals'&&req.method==='GET')return json(res,200,await benchmarkProposalsRead(pool,{AppError}));
   // Owner-only immutable Google legacy Services/MasterPrices reference; never use as price or wage authority.
   if(pathname==='/api/reference/services'&&req.method==='GET'){
     try{
       return json(res,200,await referenceCatalogPage(pool,new URL(req.url,'http://localhost'),{
         authorizeOwner:()=>sessionValid(req)
       }));
     }catch(error){
       if(error instanceof ReferenceCatalogError)
         throw new AppError(error.status,error.status===503?'Справочник услуг ещё не прошёл проверку источника.':error.code);
       if(error?.code==='42P01'||error?.code==='3F000')
         throw new AppError(503,'Справочник услуг ещё не перенесён в эту TEST-базу.');
       throw error;
     }
   }
   // V13a: owner-only historical ClientAssessment + guarded close evidence, no updates.
   if(pathname==='/api/history/orders/assessment'&&req.method==='GET'){
     try{
       const id=new URL(req.url,'http://localhost').searchParams.get('id')||'';
       const item=await historicalOrderAssessment(pool,id,{
         authorizeOwner:()=>sessionValid(req),
         batchId:'FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1'
       });
       return json(res,200,item);
     }catch(error){
       if(error instanceof HistoryOrdersAccessError)
         throw new AppError(error.status,error.status===503?'Оценка клиента не прошла проверку исторических данных.':error.code);
       if(error?.code==='42P01'||error?.code==='3F000')
         throw new AppError(503,'Исторические оценки ещё не загружены в эту TEST-базу.');
       throw error;
     }
   }
   // CRM historical list: exact reconciled source, owner session, GET only.
   // Preserve original Google IDs; never turn archive into writable CRM or finance.
   if(pathname==='/api/history/crm'&&req.method==='GET'){
    try{
     const page=await historicalCrmArchivePage(pool,new URL(req.url,'http://localhost'),{
      authorizeOwner:()=>sessionValid(req),
      batchId:'FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1'
     });
     return json(res,200,page);
    }catch(error){
     if(error instanceof CrmHistoricalArchiveError||error instanceof HistoryOrdersAccessError)
      throw new AppError(error.status,error.status===503?
       'Историческая CRM не прошла проверку источника.':error.code);
     if(['42P01','3F000','42501'].includes(error?.code))
      throw new AppError(503,'Историческая CRM пока недоступна в TEST.');
     throw error;
    }
   }
   // Immutable old WorkOrder evidence; never mix with mutable WorkLog history or operational orders.
   if(pathname==='/api/history/orders'&&req.method==='GET'){
     try{
       const page=await historicalOrdersPage(pool,new URL(req.url,'http://localhost'),{
         authorizeOwner:()=>sessionValid(req),
         batchId:'FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1'
       });
       return json(res,200,page);
     }catch(error){
       if(error instanceof HistoryOrdersAccessError)
         throw new AppError(error.status,error.status===503?'История заказов не прошла проверку источника.':error.code);
       if(error?.code==='42P01'||error?.code==='3F000')
         throw new AppError(503,'Исторические заказы пока не загружены в эту TEST-базу.');
       throw error;
     }
   }
   // Original legacy Worker and WorkOrder IDs for read-only finance history filters.
   if(pathname==='/api/history/finance/options'&&req.method==='GET'){
     try{
       return json(res,200,await historicalFinanceFilterOptions(pool,{
         authorizeOwner:()=>sessionValid(req),
         batchId:'FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1'
       }));
     }catch(error){
       if(error instanceof HistoryOrdersAccessError)
         throw new AppError(error.status,error.status===503?
           'Справочники фильтров не прошли проверку архивного источника.':error.code);
       if(error?.code==='42P01'||error?.code==='3F000')
         throw new AppError(503,'Справочники финансового архива ещё не загружены в TEST.');
       throw error;
     }
   }
   // V14 immutable source history; not live Finance/Capital or payment status.
   if(pathname==='/api/history/finance'&&req.method==='GET'){
     try{
       const page=await historicalFinanceTransactionsPage(pool,new URL(req.url,'http://localhost'),{
         authorizeOwner:()=>sessionValid(req),
         batchId:'FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1'
       });
       return json(res,200,page);
     }catch(error){
       if(error instanceof HistoryOrdersAccessError)
         throw new AppError(error.status,error.status===503?'История финансов не прошла проверку источника.':error.code);
       if(error?.code==='42P01'||error?.code==='3F000')
         throw new AppError(503,'Исторические финансовые операции пока не загружены в эту TEST-базу.');
       throw error;
     }
   }
   // Reused legacy WorkOrder contribution logic, read-only on frozen legacy evidence.
   if(pathname==='/api/finance/order-result'&&req.method==='GET'){
     try{
       const id=new URL(req.url,'http://localhost').searchParams.get('orderId')||'';
       return json(res,200,await financeOrderResultRead(pool,id,{authorizeOwner:()=>sessionValid(req)}));
     }catch(error){
       if(error instanceof FinanceOrderResultError||error instanceof FinanceCapitalArchiveError)
         throw new AppError(error.status,error.status===503?
           'Финансовый результат заказа не прошёл проверку сохранённого источника.':error.code);
       if(error?.code==='42P01'||error?.code==='3F000')
         throw new AppError(503,'Архивные финансовые данные ещё не загружены в TEST.');
       throw error;
     }
   }
   // Object archive scope and list, reusing the existing owner session and frozen source.
   if(pathname==='/api/finance/object-options'&&req.method==='GET'){
     try{
       return json(res,200,await financeObjectOptionsRead(pool,{authorizeOwner:()=>sessionValid(req)}));
     }catch(error){
       if(error instanceof FinanceObjectResultError||error instanceof FinanceCapitalArchiveError)
         throw new AppError(error.status,error.status===503?
           'Список архивных объектов не прошёл проверку источника.':error.code);
       if(error?.code==='42P01'||error?.code==='3F000')
         throw new AppError(503,'Архивные объекты не загружены в TEST.');
       throw error;
     }
   }
   if(pathname==='/api/finance/object-result'&&req.method==='GET'){
     try{
       const id=new URL(req.url,'http://localhost').searchParams.get('objectId')||'';
       return json(res,200,await financeObjectResultRead(pool,id,{authorizeOwner:()=>sessionValid(req)}));
     }catch(error){
       if(error instanceof FinanceObjectResultError||error instanceof FinanceOrderResultError||
          error instanceof FinanceCapitalArchiveError)
         throw new AppError(error.status,error.status===503?
           'Финансовый итог объекта не прошёл проверку сохранённого источника.':error.code);
       if(error?.code==='42P01'||error?.code==='3F000')
         throw new AppError(503,'Архивные финансовые данные ещё не загружены в TEST.');
       throw error;
     }
   }
   // New isolated TEST-only BusinessMonthlyGains register; no money ledger posting.
   if(pathname==='/api/finance/monthly-gains'&&req.method==='GET'){
     try{
       const key=new URL(req.url,'http://localhost').searchParams.get('monthKey')||'';
       return json(res,200,await readBusinessMonthlyGain(pool,key,{authorizeOwner:()=>sessionValid(req)}));
     }catch(error){
       if(error instanceof BusinessMonthlyGainError)throw new AppError(error.status,error.code);
       if(error?.code==='42P01'||error?.code==='3F000')
        throw new AppError(503,'Месячный TEST-реестр ещё не подготовлен.');
       throw error;
     }
   }
   if(pathname==='/api/finance/monthly-gains'&&req.method==='POST'){
     if(!financeStrictSameOrigin(req))throw new AppError(403,'FINANCE_M1_ORIGIN_REJECTED');
     if(!verifyFinanceCsrfForValidatedSession(req.headers['x-finance-csrf'],getCookies(req).vbos_sid,COOKIE_KEY))
      throw new AppError(403,'FINANCE_M1_CSRF_REJECTED');
     try{
       const payload=await readBody(req);
       return json(res,200,await saveBusinessMonthlyGain(pool,payload,{authorizeOwner:()=>sessionValid(req)}));
     }catch(error){
       if(error instanceof BusinessMonthlyGainError)throw new AppError(error.status,error.code);
       if(error?.code==='42P01'||error?.code==='3F000')
        throw new AppError(503,'Месячный TEST-реестр ещё не подготовлен.');
       if(error?.code==='23505')throw new AppError(409,'Запрос или месяц уже сохранён. Перезагрузи запись.');
       if(error?.code==='23514'||error?.code==='22003')throw new AppError(400,'Недопустимая сумма или месяц.');
       throw error;
     }
   }
   // Finance legacy-form B3: canonical native Worker lookup (read only, not a legacy Finance ID bridge).
   if(pathname==='/api/finance/legacy-workers'&&req.method==='GET'){
    try{
     return json(res,200,await financeLegacyWorkersPage(pool,new URL(req.url,'http://localhost'),
      {authorizeOwner:()=>sessionValid(req)}));
    }catch(error){
     if(error instanceof FinanceLegacyReferenceError)
      throw new AppError(error.status,error.status===503?
       'Справочник исполнителей недоступен: исходные данные не прошли проверку.':error.code);
     throw error;
    }
   }
   // WORKER source scope from immutable original Google Finance; no new payroll writer.
   if(pathname==='/api/finance/worker-options'&&req.method==='GET'){
     try{return json(res,200,await financeWorkerOptionsRead(pool,{authorizeOwner:()=>sessionValid(req)}));}
     catch(error){
       if(error instanceof FinanceWorkerHistoryError||error instanceof FinanceCapitalArchiveError)
        throw new AppError(error.status,error.status===503?
         'Список работников финансового архива не прошёл проверку источника.':error.code);
       if(['42P01','3F000','42501'].includes(error?.code))
        throw new AppError(503,'Работники финансового архива пока не доступны в TEST.');
       throw error;
     }
   }
   if(pathname==='/api/finance/worker-history'&&req.method==='GET'){
     try{
       const id=new URL(req.url,'http://localhost').searchParams.get('workerId')||'';
       return json(res,200,await financeWorkerHistoryRead(pool,id,{authorizeOwner:()=>sessionValid(req)}));
     }catch(error){
       if(error instanceof FinanceWorkerHistoryError||error instanceof FinanceOrderResultError||
          error instanceof FinanceCapitalArchiveError)
        throw new AppError(error.status,error.status===503?
         'Финансовый архив работника не прошёл проверку исходных операций.':error.code);
       if(['42P01','3F000','42501'].includes(error?.code))
        throw new AppError(503,'Финансовый архив работников пока не доступен в TEST.');
       throw error;
     }
   }
   // Frozen source Finance/Capital: same Clean owner session; never a Finance writer.
   if(pathname==='/api/finance/archive'&&req.method==='GET'){
     try{
       return json(res,200,await financeCapitalArchiveRead(pool,{authorizeOwner:()=>sessionValid(req)}));
     }catch(error){
       if(error instanceof FinanceCapitalArchiveError)
         throw new AppError(error.status,error.status===503?'Финансовый архив не прошёл проверку источника.':error.code);
       if(error?.code==='42P01'||error?.code==='3F000')
         throw new AppError(503,'Сохранённый финансовый архив пока недоступен в этой TEST-базе.');
       throw error;
     }
   }
   // An owner-side review overlay only: never modifies frozen money source rows.
   if(pathname==='/api/finance/reviews'&&req.method==='GET'){
     try{return json(res,200,await financeReviewRead(pool,{authorizeOwner:()=>sessionValid(req)}));}
     catch(error){
       if(error instanceof FinanceReviewError||error instanceof FinanceCapitalArchiveError)
         throw new AppError(error.status,error.status===503?'Ручная разборка архива пока недоступна.':error.code);
       if(['42P01','3F000','42501'].includes(error?.code))
         throw new AppError(503,'Таблица пользовательских отметок пока не установлена в TEST.');
       throw error;
     }
   }
   if(pathname==='/api/finance/review'&&req.method==='POST'){
     try{
       const body=await readBody(req);
       return json(res,200,await financeReviewAction(pool,body,{authorizeOwner:()=>sessionValid(req)}));
     }catch(error){
       if(error instanceof FinanceReviewError||error instanceof FinanceCapitalArchiveError)
         throw new AppError(error.status,error.status===503?'Ручная разборка архива пока недоступна.':error.code);
       if(['42P01','3F000','42501'].includes(error?.code))
         throw new AppError(503,'Таблица пользовательских отметок пока не установлена в TEST.');
       throw error;
     }
   }
   // Read-only journal of owner review/archive marks (not financial postings).
   if(pathname==='/api/finance/review-audit'&&req.method==='GET'){
     try{
       return json(res,200,await financeReviewAuditRead(
        pool,new URL(req.url,'http://localhost'),{authorizeOwner:()=>sessionValid(req)}
       ));
     }catch(error){
       if(error instanceof FinanceReviewAuditError||error instanceof FinanceReviewError||
          error instanceof FinanceCapitalArchiveError)
         throw new AppError(error.status,error.status===503?
          'Журнал отметок не прошёл проверку финансового источника.':error.code);
       if(['42P01','3F000','42501'].includes(error?.code))
         throw new AppError(503,'Журнал отметок пока недоступен в TEST.');
       throw error;
     }
   }
   // Owner-only source-preserving label/note overrides. All raw money data remain immutable.
   if(pathname==='/api/finance/corrections'&&req.method==='GET'){
     try{return json(res,200,await financeCorrectionRead(pool,{authorizeOwner:()=>sessionValid(req)}));}
     catch(error){
       if(error instanceof FinanceCorrectionError||error instanceof FinanceReviewError||
          error instanceof FinanceCapitalArchiveError)
         throw new AppError(error.status,error.status===503?'Исправления финансовой истории пока недоступны.':error.code);
       if(['42P01','3F000','42501'].includes(error?.code))
         throw new AppError(503,'Таблица пользовательских исправлений пока не установлена в TEST.');
       throw error;
     }
   }
   if(pathname==='/api/finance/correction'&&req.method==='POST'){
     try{
       const body=await readBody(req);
       return json(res,200,await financeCorrectionAction(pool,body,{authorizeOwner:()=>sessionValid(req)}));
     }catch(error){
       if(error instanceof FinanceCorrectionError||error instanceof FinanceReviewError||
          error instanceof FinanceCapitalArchiveError)
         throw new AppError(error.status,error.status===503?'Исправления финансовой истории пока недоступны.':error.code);
       if(['42P01','3F000','42501'].includes(error?.code))
         throw new AppError(503,'Таблица пользовательских исправлений пока не установлена в TEST.');
       throw error;
     }
   }
   // Historical owner corrections audit is read-only, paginated, and never changes money.
   if(pathname==='/api/finance/correction-audit'&&req.method==='GET'){
     try{
       return json(res,200,await financeCorrectionAuditRead(
         pool,new URL(req.url,'http://localhost'),{authorizeOwner:()=>sessionValid(req)}
       ));
     }catch(error){
       if(error instanceof FinanceCorrectionError||error instanceof FinanceReviewError||
          error instanceof FinanceCapitalArchiveError)
         throw new AppError(error.status,error.status===503?'Журнал исправлений не прошёл проверку источника.':error.code);
       if(['42P01','3F000','42501'].includes(error?.code))
         throw new AppError(503,'Журнал исправлений пока недоступен в TEST.');
       throw error;
     }
   }
   if(pathname==='/api/orders/worklogs'&&req.method==='GET')return json(res,200,await orderCardWorklogsRead({pool,url:new URL(req.url,'http://localhost'),uuid,AppError}));
   if(pathname==='/api/worklogs/full-context'&&req.method==='GET')return json(res,200,
    await workLogFullContextRead({pool,url:new URL(req.url,'http://localhost'),uuid,safeDate,AppError}));
    if(pathname==='/api/history'&&req.method==='GET')return json(res,200,await historyPage(new URL(req.url,'http://localhost')));
    if(pathname==='/api/my-work'&&req.method==='GET'){const u=new URL(req.url,'http://localhost');const selected=u.searchParams.get('orderId');return json(res,200,await myWorkSnapshot(pool,dayYerevan(),selected?uuid(selected):null));}
    if(pathname==='/api/a1'&&req.method==='GET'){const u=new URL(req.url,'http://localhost');const date=safeDate(u.searchParams.get('date')||dayYerevan());return json(res,200,await dailyA1Read(pool,date));}
    if(pathname==='/api/presence'&&req.method==='GET')return json(res,200,await objectPresenceRead(pool,new URL(req.url,'http://localhost'),{dayYerevan,safeDate,uuid,AppError}));
     if(pathname==='/api/owner-activity'&&req.method==='GET')return json(res,200,await ownerActivityRead(pool,new URL(req.url,'http://localhost'),{dayYerevan,safeDate,uuid,AppError}));
    if(pathname==='/api/catalog'&&req.method==='GET')return json(res,200,await catalogSearch(new URL(req.url,'http://localhost'),{pool,AppError,uuid}));
    if(pathname==='/api/schedule'&&req.method==='GET')return json(res,200,await scheduleRead(pool,new URL(req.url,'http://localhost'),{dayYerevan,safeDate,uuid,AppError}));
    if(pathname==='/api/schedule/hourly'&&req.method==='GET')return json(res,200,await scheduleHourlyRead(pool,new URL(req.url,'http://localhost'),{dayYerevan,safeDate,AppError}));
    if(pathname==='/api/schedule/hourly/search'&&req.method==='GET')return json(res,200,await scheduleHourlyNextSourceRead(pool,new URL(req.url,'http://localhost'),{dayYerevan,safeDate,AppError}));
    if(pathname==='/api/schedule/conflicts'&&req.method==='GET')return json(res,200,await scheduleConflictSourceRead(pool,new URL(req.url,'http://localhost'),{safeDate,AppError}));
    if(pathname==='/api/capacity'&&req.method==='GET')return json(res,200,await capacityRead(pool,new URL(req.url,'http://localhost'),{dayYerevan,safeDate,AppError}));
   if(pathname==='/api/export'&&req.method==='GET'){
     const data=await state();if(data.listsTruncated)throw new AppError(409,'Экспорт превышает 500 записей в одном разделе. Нужна постраничная выгрузка.');
      const a1Export=await pool.query('SELECT id,day_date::text AS date,status,goal,reason,outcome,outcome_note,notes,revision,created_at,updated_at FROM public.mvp_daily_a1 ORDER BY day_date DESC LIMIT 501');
      if(a1Export.rows.length>500)throw new AppError(409,'Экспорт A1 превышает 500 записей. Требуется постраничная выгрузка.');
      const visitExport=await pool.query('SELECT id,day_id,day_date::text AS day_date,object_id,order_id,status,arrived_at,departed_at,arrival_recorded_at,departure_recorded_at,notes,revision,created_at,updated_at FROM public.mvp_object_presence ORDER BY day_date DESC,arrived_at DESC LIMIT 501');
      if(visitExport.rows.length>500)throw new AppError(409,'Экспорт посещений превышает 500 записей. Требуется постраничная выгрузка.');
      const ownerExport=await pool.query('SELECT id,day_date::text AS date,status,activity_class,summary,notes,start_at,end_at,duration_minutes,work_day_id,related_entity_type,related_entity_id,parent_activity_id,revision,started_recorded_at,ended_recorded_at,updated_at FROM public.mvp_owner_activities ORDER BY day_date DESC,start_at DESC LIMIT 501');
      if(ownerExport.rows.length>500)throw new AppError(409,'Экспорт бизнес-времени превышает 500 записей. Требуется постраничная выгрузка.');
      const scheduleExport=await pool.query('SELECT id,source_kind,auto_source_key,status,start_at,end_at,schedule_date::text AS schedule_date,object_id,order_id,item_type,title,notes,revision,archived_at,created_at,updated_at FROM public.mvp_schedule_items ORDER BY start_at,id LIMIT 501');
      if(scheduleExport.rows.length>500)throw new AppError(409,'Экспорт плана превышает 500 записей. Требуется постраничная выгрузка.');
      const autoScheduleExport=await pool.query('SELECT id,source_kind,auto_source_key,status,start_at,end_at,schedule_date::text AS schedule_date,object_id,order_id,item_type,title,notes,revision,archived_at,created_at,updated_at FROM public.mvp_schedule_order_items ORDER BY start_at,id LIMIT 501');
      const crmPlanExport=await pool.query('SELECT id,source_kind,auto_source_key,lead_id,status,start_at,end_at,schedule_date::text AS schedule_date,title,notes,revision,archived_at,created_at,updated_at FROM public.mvp_schedule_lead_items ORDER BY start_at,id LIMIT 501');
      const signalRequestsExport=await pool.query('SELECT request_key,action,payload_sha256,lead_id,response,created_at FROM public.mvp_crm_signal_requests ORDER BY created_at DESC,request_key LIMIT 501');
      if(signalRequestsExport.rows.length>500)throw new AppError(409,'Экспорт сигналов CRM превышает 500 записей. Нужна постраничная выгрузка.');
      const scoreHistoryExport=await pool.query('SELECT * FROM public.mvp_lead_score_snapshots ORDER BY snapshot_id DESC LIMIT 501');
      if(scoreHistoryExport.rows.length>500)throw new AppError(409,'Экспорт истории Win Score превышает 500 записей. Нужна постраничная выгрузка.');
      const scoreHistoryMetaExport=await pool.query('SELECT schema_version,tracking_since FROM public.mvp_crm_score_history_meta WHERE singleton=true');
      if(crmPlanExport.rows.length>500)throw new AppError(409,'Экспорт CRM-напоминаний превышает 500 строк. Используй постраничную выгрузку.');
      if(autoScheduleExport.rows.length>500)throw new AppError(409,'Экспорт автоматических планов превышает 500 записей. Требуется постраничная выгрузка.');
     const benchmarkExports=await Promise.all([
      pool.query('SELECT * FROM public.mvp_benchmark_proposals ORDER BY benchmark_id LIMIT 501'),
      pool.query('SELECT * FROM public.mvp_benchmark_approvals ORDER BY benchmark_id LIMIT 501'),
      pool.query('SELECT * FROM public.mvp_benchmark_approval_events ORDER BY event_id DESC LIMIT 501')
     ]);
     if(benchmarkExports.some(x=>x.rows.length>500))throw new AppError(409,'Экспорт нормативов превышает 500 строк в одном разделе.');
     const interactionExport=await pool.query('SELECT * FROM public.mvp_crm_interactions ORDER BY created_at DESC,id DESC LIMIT 501');
      const objectInteractionExport=await pool.query('SELECT * FROM public.mvp_object_interactions ORDER BY created_at DESC,id DESC LIMIT 501');
      const orderInteractionExport=await pool.query('SELECT * FROM public.mvp_order_interactions ORDER BY created_at DESC,id DESC LIMIT 501');
      if(orderInteractionExport.rows.length>500)throw new AppError(409,'Экспорт контактов заказов превышает 500 записей. Требуется постраничная резервная выгрузка.');
      if(objectInteractionExport.rows.length>500)throw new AppError(409,'Экспорт контактов объектов превышает 500 записей. Используй постраничную историю объекта.');
     if(interactionExport.rows.length>500)throw new AppError(409,'Экспорт контактов превышает 500 записей. Используй постраничный журнал.');
     res.setHeader('Content-Disposition','attachment; filename="vbos-mvp-backup-'+dayYerevan()+'.json"');
     return json(res,200,{exportedAt:new Date().toISOString(),...data,a1Records:a1Export.rows,objectPresence:visitExport.rows,ownerActivityRecords:ownerExport.rows,scheduleItems:scheduleExport.rows,scheduleOrderItems:autoScheduleExport.rows,scheduleLeadItems:crmPlanExport.rows,crmSignalRequests:signalRequestsExport.rows,crmScoreHistory:scoreHistoryExport.rows,crmScoreHistoryMeta:scoreHistoryMetaExport.rows,benchmarkProposals:benchmarkExports[0].rows,benchmarkApprovals:benchmarkExports[1].rows,benchmarkApprovalEvents:benchmarkExports[2].rows,crmInteractions:interactionExport.rows,objectInteractions:objectInteractionExport.rows,orderInteractions:orderInteractionExport.rows});
   }
   if(pathname==='/api/action'&&req.method==='POST'){
     const body=await readBody(req),type=String(body.type||''),p=body.payload||{};
     const result=await action(type,p); // canonical commit must precede observer
     const observed=await crmScoreHistoryAfterAction({pool,type,p});
     if(observed.status!=='NOT_APPLICABLE')result.scoreHistoryObservation=observed;
     return json(res,200,result);
   }
   if(pathname==='/api/password'&&req.method==='POST'){
     const body=await readBody(req);
     if(!verifyPassword(body.oldPassword||'',await authHash()))throw new AppError(403,'Неверный текущий пароль.');
     if(typeof body.newPassword!=='string'||body.newPassword.length<10||body.newPassword.length>200)throw new AppError(400,'Новый пароль: минимум 10 символов.');
     await pool.query("INSERT INTO public.mvp_settings(setting_key,setting_value) VALUES('password_hash',$1) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,changed_at=now()",[newHash(body.newPassword)]);
     cookie(res,req,true);return json(res,200,{ok:true,requireLogin:true});
   }
  }
  throw new AppError(404,'Страница не найдена.');
 }catch(err){
  const status=err instanceof AppError?err.status:(err.code==='23503'?400:err.code==='23505'?409:500);
  if(status>=500)console.error('MVP_SERVER_ERROR',String(err.code||err.name||'error'));
  json(res,status,{error:status===500?'Ошибка сервера. Данные не подтверждены.':err.message});
 }
}
// This probe verifies a real persisted-row read inside one transaction, then ROLLBACK.
// It never touches historical databases or leaves synthetic CRM data behind.
async function verifyPostgresWriteReadback(){
 const key=randomUUID();
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const ins=await client.query('INSERT INTO public.mvp_leads(request_key,title) VALUES($1,$2) RETURNING id',[key,'MVP_INTERNAL_PROBE']);
  const check=await client.query('SELECT title FROM public.mvp_leads WHERE id=$1',[ins.rows[0]?.id]);
  if(check.rows.length!==1||check.rows[0].title!=='MVP_INTERNAL_PROBE')throw Error('MVP_POSTGRES_READBACK_FAILED');
 }finally{
  try{await client.query('ROLLBACK');}finally{client.release();}
 }
 const after=await pool.query('SELECT count(*)::int AS n FROM public.mvp_leads WHERE request_key=$1',[key]);
 if(after.rows[0]?.n!==0)throw Error('MVP_POSTGRES_TEST_ROLLBACK_FAILED');
 console.log('MVP_POSTGRES_TRANSACTIONAL_WRITE_READBACK_ROLLBACK_PASS');
}
const port=Number(process.env.PORT||3000);
verifyPostgresWriteReadback().then(()=>createServer((req,res)=>{handler(req,res);}).listen(port,'0.0.0.0',()=>console.log('VBOS CLEAN MVP STARTED',port))).catch(e=>{console.error('MVP_STARTUP_DATABASE_CHECK_FAILED',String(e.code||e.name));process.exit(1);});
