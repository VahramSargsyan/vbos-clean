/**
 * Finance B15 — owner-session-guarded, CSRF-protected SERVER validation only.
 * This module has no money writer and imports no B10/B14 synthetic adapter.
 * Source is B9.1 owner-attested historical OPENING, NOT current live cash.
 * No request receipt, ledger mutation, Google writer or financial cutover.
 */
import {normalizeFinanceCreate} from './finance-create-normalize.mjs';
import {readFinanceOpeningPreview} from './finance-opening-readonly.mjs';

export class FinanceB15DraftError extends Error {
 constructor(status,code){super(code);this.name='FinanceB15DraftError';this.status=status;this.code=code;}
}
const fail=(code,status=400)=>{throw new FinanceB15DraftError(status,code);};
const CATEGORIES=Object.freeze({
 INCOME:Object.freeze(['other','bonus']),
 EXPENSE:Object.freeze(['other','materials','transport','tools','subcontractor','office'])
});
const FINANCE_OPS=new Set(['INCOME','EXPENSE']);
const CAPITAL_OPS=new Set(['FUND_TRANSFER','FUND_SPEND']);
const FIELDS=new Set(['mode','operationType','category','transactionDateKey',
 'amountAMD','notes','fromFundId','toFundId']);
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const AMOUNT=/^(?:[1-9]\d{0,8}(?:\.\d{1,2})?|0\.(?:0[1-9]|[1-9]\d?))$/;
const MONEY=/^-?(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/;
const MICRO=1000000n;
function dateOk(s){
 return typeof s==='string'&&DATE.test(s)&&
  Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
  new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
}
function mic(raw){
 const v=String(raw??'');
 if(!MONEY.test(v))fail('B15_INVALID_SOURCE_MONEY',503);
 const negative=v.startsWith('-'),s=negative?v.slice(1):v;
 const [whole,frac='']=s.split('.');
 const n=BigInt(whole)*MICRO+BigInt(frac.padEnd(6,'0'));
 return negative?-n:n;
}
function dec(n){
 const x=n<0n?-n:n;
 return (n<0n?'-':'')+(x/MICRO).toString()+'.'+(x%MICRO).toString().padStart(6,'0');
}
function assertSource(open){
 if(!open||open.version!=='FINANCE_B13_OPENING_READONLY_V1'||
    open.readonly!==true||open.postingEnabled!==false||open.canSave!==false||
    open.financialWriteAuthority!=='GOOGLE'||open.phase!=='BLOCKED'||
    open.sourceFreezeVerified!==false||open.isCurrentLiveBalance!==false||
    open.asOfDate!=='2026-09-30'||open.historyTransactions!==24||
    !Array.isArray(open.funds)||open.funds.length!==8)
  fail('B15_SOURCE_NOT_READONLY',503);
 if(mic(open.opening?.cashAMD)!==203000000000n||
    mic(open.opening?.profitAMD)!==588000000000n||
    mic(open.opening?.workerPayableAMD)!==0n||
    mic(open.opening?.fundTotalAMD)!==10000000000n)
  fail('B15_SOURCE_OPENING_CHANGED',503);
 const ids=new Set(),codes=new Set();
 let sum=0n;
 for(const f of open.funds){
  if(!/^FND-2026-000[1-8]$/.test(String(f.legacyId||''))||
    ids.has(f.legacyId)||codes.has(f.code)||
    typeof f.code!=='string'||!/^[_A-Z]{3,100}$/.test(f.code))
   fail('B15_FUND_SOURCE_ID_DRIFT',503);
  ids.add(f.legacyId);codes.add(f.code);
  const n=mic(f.openingBalanceAMD);
  if(n<0n)fail('B15_FUND_NEGATIVE_OPENING',503);
  sum+=n;
 }
 if(ids.size!==8||sum!==10000000000n)fail('B15_FUND_RECONCILIATION',503);
}
export function validateFinanceB15Draft(raw,{todayKey,opening}={}){
 assertSource(opening);
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
    Object.keys(raw).some(k=>!FIELDS.has(k)))fail('B15_UNEXPECTED_FIELDS');
 const mode=raw.mode,op=raw.operationType;
 if((mode!=='finance'&&mode!=='capital')||
    (mode==='finance'&&!FINANCE_OPS.has(op))||
    (mode==='capital'&&!CAPITAL_OPS.has(op)))
  fail('B15_OPERATION_UNSUPPORTED');
 const date=raw.transactionDateKey;
 if(!dateOk(todayKey)||!dateOk(date)||
    date<'2026-10-01'||date>todayKey)
  fail('B15_DATE_OUTSIDE_PREVIEW_WINDOW');
 // Enforce two decimal places and a bounded amount, no exponent/rounding.
 if(typeof raw.amountAMD!=='string'||!AMOUNT.test(raw.amountAMD))
  fail('B15_AMOUNT_INVALID');
 const amount=mic(raw.amountAMD);
 if(amount<=0n||amount>999999999000000n)fail('B15_AMOUNT_OUT_OF_RANGE');
 const notes=raw.notes??'';
 if(typeof notes!=='string'||notes.length>300)fail('B15_NOTES_INVALID');
 if(mode==='finance'){
  if(raw.fromFundId!==undefined||raw.toFundId!==undefined)
   fail('B15_FINANCE_CANNOT_USE_FUND_FIELDS');
  if(!CATEGORIES[op].includes(raw.category))
   fail('B15_CATEGORY_REQUIRES_LINKED_CRM_OR_UNSUPPORTED');
  // B2 classification and arithmetic, no guessed Client/Order/Worker links.
  const n=normalizeFinanceCreate({
   operationType:op,category:raw.category,
   transactionDate:date,amountOriginal:raw.amountAMD,
   currencyOriginal:'AMD',commissionOriginal:0,notes
  },{todayKey,references:{}});
  const expected=op==='INCOME'?amount:-amount;
  if(mic(Number(n.amountBase).toFixed(6))!==amount||
     mic(Number(n.cashEffectBase).toFixed(6))!==expected||
     mic(Number(n.profitEffectBase).toFixed(6))!==expected||
     mic(Number(n.workerPayableEffectBase).toFixed(6))!==0n)
   fail('B15_NORMALIZER_PARITY_FAILED',503);
  return Object.freeze({
   version:'FINANCE_B15_SERVER_DRY_RUN_V1',readonly:true,saved:false,
   postingEnabled:false,canSave:false,persistentId:null,
   phase:'BLOCKED',financialWriteAuthority:'GOOGLE',asOfDate:'2026-09-30',
   currentLiveBalance:false,notAnAccountingEntry:true,
   operationType:op,category:raw.category,transactionDateKey:date,
   amountAMD:dec(amount),notes,
   effects:{
    cashDeltaAMD:dec(expected),profitDeltaAMD:dec(expected),
    workerPayableDeltaAMD:'0.000000',fundEffects:[]
   },
   warning:'ILLUSTRATIVE_ONLY_NOT_BOOKED_NOT_CURRENT_BALANCE'
  });
 }
 if(raw.category!==undefined)fail('B15_CAPITAL_CATEGORY_FORBIDDEN');
 const map=new Map(opening.funds.map(f=>[f.legacyId,f]));
 const src=map.get(raw.fromFundId);
 if(!src)fail('B15_SOURCE_FUND_UNKNOWN');
 const srcBalance=mic(src.openingBalanceAMD);
 if(amount>srcBalance)
  fail('B15_EXCEEDS_ATTESTED_OPENING_NOT_LIVE');
 let dest=null;
 if(op==='FUND_TRANSFER'){
  dest=map.get(raw.toFundId);
  if(!dest||dest.legacyId===src.legacyId)
   fail('B15_DESTINATION_FUND_INVALID');
 }else if(raw.toFundId!==undefined&&raw.toFundId!==''){
  fail('B15_SPEND_CANNOT_HAVE_DESTINATION');
 }
 const fundEffects=[{legacyId:src.legacyId,code:src.code,deltaAMD:dec(-amount)}];
 if(dest)fundEffects.push({legacyId:dest.legacyId,code:dest.code,deltaAMD:dec(amount)});
 return Object.freeze({
  version:'FINANCE_B15_SERVER_DRY_RUN_V1',readonly:true,saved:false,
  postingEnabled:false,canSave:false,persistentId:null,
  phase:'BLOCKED',financialWriteAuthority:'GOOGLE',asOfDate:'2026-09-30',
  currentLiveBalance:false,notAnAccountingEntry:true,
  operationType:op,category:null,transactionDateKey:date,
  amountAMD:dec(amount),notes,
  effects:{cashDeltaAMD:'0.000000',profitDeltaAMD:'0.000000',
   workerPayableDeltaAMD:'0.000000',fundEffects},
  warning:'ILLUSTRATIVE_ONLY_NOT_BOOKED_NOT_CURRENT_BALANCE'
 });
}
/**
 * Requires upstream signed owner-session, strict same-origin and HMAC CSRF.
 * The only DB access is B13's REPEATABLE READ READ ONLY proof.
 */
export async function validateFinanceB15ServerDraft(db,raw,{todayKey,
 readOpening=readFinanceOpeningPreview}={}){
 if(!db||typeof db.connect!=='function')fail('B15_DB_REQUIRED',503);
 if(typeof readOpening!=='function')fail('B15_OPENING_READ_REQUIRED',503);
 const opening=await readOpening(db);
 return validateFinanceB15Draft(raw,{todayKey,opening});
}
