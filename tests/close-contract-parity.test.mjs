import test from 'node:test';
import assert from 'node:assert/strict';
import {computeLegacyAssessmentScoreV1,compareStoredLegacyAssessment,LEGACY_ASSESSMENT_SCORE_VERSION} from '../close-contract-parity.mjs';

const complete={paymentBehavior:'ON_TIME',communicationQuality:'EASY',scopeChanges:'NONE',workAgain:'YES',acceptance:'NO_REMARKS',satisfaction:'YES'};
test('exact six-factor weighted legacy scoring full 100, low risk',()=>{
 assert.deepEqual(computeLegacyAssessmentScoreV1(complete),{
  score:100,scoreVersion:LEGACY_ASSESSMENT_SCORE_VERSION,riskLabel:'LOW_RISK',
  knownFactors:6,totalFactors:6,scoreComplete:true
 });
});
test('all UNKNOWN returns blank, never zero or an invented rating',()=>{
 assert.deepEqual(computeLegacyAssessmentScoreV1({}),{
  score:'',scoreVersion:LEGACY_ASSESSMENT_SCORE_VERSION,riskLabel:'UNKNOWN',
  knownFactors:0,totalFactors:6,scoreComplete:false
 });
});
test('known-only partial factors are renormalized and risk remains UNKNOWN',()=>{
 const t=computeLegacyAssessmentScoreV1({paymentBehavior:'DELAYED',workAgain:'NO'});
 // 30*55 + 20*0 = 1650, divided by 50 = 33.
 assert.deepEqual({score:t.score,known:t.knownFactors,complete:t.scoreComplete,risk:t.riskLabel},
  {score:33,known:2,complete:false,risk:'UNKNOWN'});
});
test('full medium and high risk thresholds mirror legacy rules',()=>{
 const highRisk=computeLegacyAssessmentScoreV1({paymentBehavior:'PROBLEM',communicationQuality:'CONFLICT',scopeChanges:'MANY',workAgain:'NO',acceptance:'NOT_ACCEPTED_REWORK',satisfaction:'NO'});
 assert.equal(highRisk.score,0);
 assert.equal(highRisk.riskLabel,'HIGH_RISK');
 const medium=computeLegacyAssessmentScoreV1({...complete,paymentBehavior:'DELAYED',scopeChanges:'MANY',workAgain:'YES_WITH_CONDITIONS'});
 assert.equal(medium.score,63);
 assert.equal(medium.riskLabel,'MEDIUM_RISK');
});
test('invalid enum does not silently translate to safe value',()=>{
 assert.throws(()=>computeLegacyAssessmentScoreV1({...complete,paymentBehavior:'PAID'}),/INVALID_LEGACY_ASSESSMENT_FIELD:paymentBehavior/);
 assert.throws(()=>computeLegacyAssessmentScoreV1(null),/ASSESSMENT_FIELDS_REQUIRED/);
 assert.throws(()=>computeLegacyAssessmentScoreV1([]),/ASSESSMENT_FIELDS_REQUIRED/);
});
test('historical stored matches exactly and diagnostic does not mutate',()=>{
 const original=Object.freeze({...complete,score:'100',scoreVersion:'CLIENT_SCORE_V1_100',riskLabel:'LOW_RISK'});
 const z=compareStoredLegacyAssessment(original);
 assert.equal(z.stored,true);assert.equal(z.matched,true);assert.equal(z.calculated.score,100);
 assert.equal(original.score,'100');
});
test('legacy blank with full known factors cannot be backfilled implicitly',()=>{
 const original=Object.freeze({...complete,score:'',scoreVersion:'',riskLabel:''});
 const z=compareStoredLegacyAssessment(original);
 assert.equal(z.stored,false);assert.equal(z.matched,null);
 assert.equal(z.note,'MISSING_STORED_SCORE_DO_NOT_BACKFILL');
 assert.equal(z.calculated.score,100);
 assert.equal(original.score,'');
});
test('historical blank with all unknown fields is not a score of 0',()=>{
 const z=compareStoredLegacyAssessment({score:'',paymentBehavior:'UNKNOWN'});
 assert.equal(z.stored,false);
 assert.equal(z.calculated.score,'');
 assert.equal(z.calculated.riskLabel,'UNKNOWN');
});
test('mismatching stored score/version/risk is flagged rather than overwritten',()=>{
 const base={...complete,score:99,scoreVersion:'CLIENT_SCORE_V1_100',riskLabel:'LOW_RISK'};
 assert.equal(compareStoredLegacyAssessment(base).matched,false);
 assert.equal(compareStoredLegacyAssessment({...base,score:100,scoreVersion:'OTHER'}).matched,false);
 assert.equal(compareStoredLegacyAssessment({...base,score:100,riskLabel:'MEDIUM_RISK'}).matched,false);
 assert.throws(()=>compareStoredLegacyAssessment({...base,score:'foo'}),/INVALID_STORED_LEGACY_SCORE/);
});
