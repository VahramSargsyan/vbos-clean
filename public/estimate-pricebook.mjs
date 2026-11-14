/**
 * EST-PRICES-01, pure frozen legacy v1.5.0 price-floor semantics.
 * Economy is base; Standard+/VIP = max(round(base × multiplier, step), floor).
 * Missing owner rule falls back to the frozen legacy ECONOMY reference only.
 * No writes, no implicit financial posting and no material procurement prices.
 */
export const DEFAULT_TARIFF_PROFILES=Object.freeze({
 ECONOM:Object.freeze({tariffCode:'ECONOM',multiplier:1,roundingStep:1,revision:0}),
 STANDARD_PLUS:Object.freeze({tariffCode:'STANDARD_PLUS',multiplier:1.25,roundingStep:1,revision:0}),
 VIP:Object.freeze({tariffCode:'VIP',multiplier:1.5,roundingStep:1,revision:0})
});
const ACTIONS=Object.freeze(['WATER','SEWER','CHASING','FIXTURE_INSTALL']);
export function pricebookProfile(book,tariff){
 const code=String(tariff||'').trim().toUpperCase();
 const fallback=DEFAULT_TARIFF_PROFILES[code];
 if(!fallback)throw Error('EST_PRICE_TARIFF_INVALID');
 const custom=Array.isArray(book?.profiles)?
  book.profiles.find(x=>x.tariffCode===code):null;
 const multiplier=custom?Number(custom.multiplier):fallback.multiplier;
 const step=custom?Number(custom.roundingStep):fallback.roundingStep;
 if(!Number.isFinite(multiplier)||multiplier<=0||multiplier>20||
    !Number.isInteger(step)||step<1||step>100000)
  throw Error('EST_PRICE_PROFILE_INVALID');
 return {tariffCode:code,multiplier:code==='ECONOM'?1:multiplier,roundingStep:step,
  revision:custom?.revision??0};
}
export function pricebookRule(book,actionType,cardKey=''){
 if(!ACTIONS.includes(actionType))throw Error('EST_PRICE_ACTION_INVALID');
 const scopeType=actionType==='FIXTURE_INSTALL'?'CARD_ACTION':'GLOBAL_ACTION';
 const key=scopeType==='CARD_ACTION'?String(cardKey||'').toUpperCase():'';
 return Array.isArray(book?.rules)?
  book.rules.find(r=>r.scopeType===scopeType&&r.actionType===actionType&&
   String(r.cardKey||'').toUpperCase()===key)||null:null;
}
export function resolveEstimatorUnitPrice(book,{actionType,cardKey='',tariff,legacyEconomy=null,
 legacyPriceMode='NOT_CONFIGURED'}){
 const profile=pricebookProfile(book,tariff),rule=pricebookRule(book,actionType,cardKey);
 const configured=rule?.economyBaseAMD!==null&&rule?.economyBaseAMD!==undefined;
 const baseRaw=configured?rule.economyBaseAMD:legacyEconomy;
 const base=baseRaw===null||baseRaw===undefined||baseRaw===''?null:Number(baseRaw);
 if(base===null)return {price:null,configured:false,origin:'UNCONFIGURED',priceMode:'NOT_CONFIGURED',
  floor:null,floorEffective:false,generated:null};
 if(!Number.isSafeInteger(base)||base<0||base>1000000000)
  throw Error('EST_PRICE_BASE_INVALID');
 const generated=profile.tariffCode==='ECONOM'?base:
  Math.round(base*profile.multiplier/profile.roundingStep)*profile.roundingStep;
 const rawFloor=profile.tariffCode==='STANDARD_PLUS'?rule?.standardFloorAMD:
  profile.tariffCode==='VIP'?rule?.vipFloorAMD:null;
 const floor=rawFloor===null||rawFloor===undefined||rawFloor===''?null:Number(rawFloor);
 if(floor!==null&&(!Number.isSafeInteger(floor)||floor<0||floor>1000000000))
  throw Error('EST_PRICE_FLOOR_INVALID');
 const effective=floor===null?generated:Math.max(generated,floor);
 if(!Number.isSafeInteger(effective)||effective>1000000000)
  throw Error('EST_PRICE_TOTAL_INVALID');
 return {price:String(effective),configured,origin:configured?'OWNER_PRICEBOOK':'LEGACY_REFERENCE',
  priceMode:configured?'OWNER_PRICEBOOK':legacyPriceMode,floor,floorEffective:floor!==null&&floor>generated,
  generated:String(generated)};
}
