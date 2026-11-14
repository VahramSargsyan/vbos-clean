/**
 * FINANCE-BATCH2-05 — pure existing FinanceTransaction update preparation.
 * Mirrors FinanceService.js pick()/pickFinanceRelation_ and reuses the
 * independent create normalizer for the same financial calculation rules.
 * NO I/O, timestamp generation, persistence, capital allocation or archiving.
 * Status transitions and linked-capital safety remain separate guarded stages.
 */
import {normalizeFinanceCreate} from './finance-create-normalize.mjs';
import {financeAffectedScopes,financeSummaryFromRows} from './finance-summary-engine.mjs';

export class FinanceUpdateNormalizeError extends Error {
 constructor(code){super(code);this.name='FinanceUpdateNormalizeError';this.code=code;}
}
const fail=code=>{throw new FinanceUpdateNormalizeError(code);};
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const safe=(v,max=100)=>String(v===null||v===undefined?'':v).trim().slice(0,max);
const validID=v=>/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(v);
const trueFlag=value=>value===true||String(value||'').toLowerCase()==='true'||String(value||'')==='1';

/**
 * Input is an already-loaded canonical old row, with full original fields.
 * Partial payloads preserve old values (legacy pick); a cleared relation must
 * be explicitly accompanied by its clear*Relation flag. Changed WorkOrder
 * with inherited incompatible Object/Client fails unless those links are
 * explicitly cleared, just as financeLinkContext_ does in the legacy app.
 */
export function normalizeFinanceUpdate(payload,existing,context={}){
 if(!object(payload))fail('FINANCE_UPDATE_PAYLOAD_INVALID');
 if(!object(existing))fail('FINANCE_UPDATE_EXISTING_REQUIRED');
 const id=safe(existing.financeTransactionId);
 if(!validID(id))fail('FINANCE_UPDATE_EXISTING_ID_INVALID');
 if(safe(payload.financeTransactionId)!==id)
  fail('FINANCE_UPDATE_ID_MISMATCH');
 // Archive/restore are independent lifecycle operations, not implicit edits.
 if(safe(existing.status)!=='active')fail('FINANCE_UPDATE_ARCHIVED_NOT_EDITABLE');
 if(payload.status!==undefined&&safe(payload.status)!=='active')
  fail('FINANCE_UPDATE_STATUS_TRANSITION_OUT_OF_SCOPE');
 // Fail closed on malformed historical input rather than subtracting its
 // original contribution from the wrong scope or with imprecise amounts.
 financeSummaryFromRows([existing]);
 const pick=(field,fallback)=>payload[field]===undefined?
  (existing[field]===undefined?fallback:existing[field]):payload[field];
 const relation=(field,clearFlag)=>{
  if(payload[field]===undefined)return existing[field]===undefined?'':existing[field];
  const value=safe(payload[field]);
  if(value)return value;
  if(existing[field]&&!trueFlag(payload[clearFlag]))return existing[field];
  return '';
 };
 const updateInput={
  operationType:pick('operationType','INCOME'),category:pick('category',undefined),
  incomeRecognition:pick('incomeRecognition',undefined),
  ownerDirection:pick('ownerDirection',''),
  workerId:relation('workerId','clearWorkerRelation'),
  workOrderId:relation('workOrderId','clearWorkOrderRelation'),
  objectId:relation('objectId','clearObjectRelation'),
  clientId:relation('clientId','clearClientRelation'),
  transactionDate:pick('transactionDate',context.todayKey),
  amountOriginal:pick('amountOriginal',''),
  currencyOriginal:pick('currencyOriginal','AMD'),
  fxRate:pick('fxRate',''),fxRateSource:pick('fxRateSource','manual'),
  fxRateDate:pick('fxRateDate',undefined),
  commissionOriginal:pick('commissionOriginal',0),
  counterparty:pick('counterparty',''),notes:pick('notes',''),status:'active'
 };
 // OWNER_TRANSFER implicitly clears WorkOrder/Object/Client in create parity.
 const canonical=normalizeFinanceCreate(updateInput,context);
 const before=Object.freeze({...existing});
 const after=Object.freeze({...existing,...canonical,financeTransactionId:id});
 // This preview does NOT authorize a DB write. A future writer must check
 // the existing FINCAP batch, idempotency, permissions and atomic balances.
 return Object.freeze({
  financeTransactionId:id,canonicalPatch:canonical,before,after,
  affectedScopes:financeAffectedScopes(before,after)
 });
}
