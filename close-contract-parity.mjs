/* V13b.1 — source-parity diagnostic of legacy ClientAssessment scoring.
 * No imports from runtime, no datastore calls, no close actions or finance authority.
 * Source: main/WorkOrderCloseService.js v1.4.0.42 clientAssessmentScoreV1_().
 * This function is not a historical backfill: never overwrite blank legacy scores.
 */
export const LEGACY_ASSESSMENT_SCORE_VERSION='CLIENT_SCORE_V1_100';
const rules=Object.freeze([
 Object.freeze({field:'paymentBehavior',weight:30,values:Object.freeze({ON_TIME:100,DELAYED:55,PROBLEM:0})}),
 Object.freeze({field:'communicationQuality',weight:20,values:Object.freeze({EASY:100,NORMAL:80,DIFFICULT:40,CONFLICT:0})}),
 Object.freeze({field:'scopeChanges',weight:15,values:Object.freeze({NONE:100,FEW:75,MANY:0})}),
 Object.freeze({field:'workAgain',weight:20,values:Object.freeze({YES:100,YES_WITH_CONDITIONS:55,NO:0})}),
 Object.freeze({field:'acceptance',weight:10,values:Object.freeze({NO_REMARKS:100,MINOR_REMARKS:70,NOT_ACCEPTED_REWORK:0})}),
 Object.freeze({field:'satisfaction',weight:5,values:Object.freeze({YES:100,PARTIAL:60,NO:0})})
]);
export const legacyAssessmentFields=Object.freeze(rules.map(rule=>rule.field));

export function computeLegacyAssessmentScoreV1(assessment={}){
 if(!assessment||typeof assessment!=='object'||Array.isArray(assessment))
   throw new TypeError('ASSESSMENT_FIELDS_REQUIRED');
 let weighted=0,usedWeight=0,known=0;
 for(const rule of rules){
   const code=assessment[rule.field]||'UNKNOWN';
   if(code==='UNKNOWN')continue;
   if(typeof code!=='string'||!Object.hasOwn(rule.values,code))
     throw new RangeError('INVALID_LEGACY_ASSESSMENT_FIELD:'+rule.field);
   weighted+=Number(rule.values[code])*rule.weight;
   usedWeight+=rule.weight;
   known++;
 }
 if(!usedWeight)return Object.freeze({
   score:'',scoreVersion:LEGACY_ASSESSMENT_SCORE_VERSION,
   riskLabel:'UNKNOWN',knownFactors:0,totalFactors:6,scoreComplete:false
 });
 const score=Math.max(0,Math.min(100,Math.round(weighted/usedWeight)));
 const scoreComplete=known===6;
 const riskLabel=scoreComplete?(score>=80?'LOW_RISK':score>=60?'MEDIUM_RISK':'HIGH_RISK'):'UNKNOWN';
 return Object.freeze({
  score,scoreVersion:LEGACY_ASSESSMENT_SCORE_VERSION,
  riskLabel,knownFactors:known,totalFactors:6,scoreComplete
 });
}

/** Compare only existing stored values. Missing historical scores stay missing. */
export function compareStoredLegacyAssessment(assessment){
 const calculated=computeLegacyAssessmentScoreV1(assessment);
 const present=assessment.score!==''&&assessment.score!==null&&assessment.score!==undefined;
 if(!present)return Object.freeze({
   stored:false,matched:null,calculated,
   note:'MISSING_STORED_SCORE_DO_NOT_BACKFILL'
 });
 const number=Number(assessment.score);
 if(!Number.isFinite(number)||String(assessment.score).trim()==='')
   throw new RangeError('INVALID_STORED_LEGACY_SCORE');
 const risk=String(assessment.riskLabel||'UNKNOWN');
 const version=String(assessment.scoreVersion||'');
 return Object.freeze({
  stored:true,matched:calculated.score===number&&risk===calculated.riskLabel&&version===calculated.scoreVersion,
  calculated,note:'STORED_SCORE_PARITY_ONLY'
 });
}
