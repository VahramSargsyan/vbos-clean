import assert from 'node:assert/strict';
import {test} from 'node:test';
import {calculateRoomHeating,calculatorHtml,ENGINE_SOURCE} from '../public/engineering-calculator.mjs';
import {calculateHeatLoss} from '../public/eng-heat-loss-v010.mjs';
import {evaluateRadiatorCandidates} from '../public/eng-radiator-v010.mjs';
const sample=()=>({
 roomName:'Спальня',lengthM:'5',widthM:'4',heightM:'2.5',indoorTempC:'20',outdoorTempC:'-10',
 wallAreaM2:'10',wallU:'0.4',windowAreaM2:'2',windowU:'1.6',doorAreaM2:'0',doorU:'',
 floorType:'HEATED',ceilingType:'HEATED',ach:'0.5',airFactor:'0.34',reservePct:'10',
 ufhStatus:'NONE',radiatorKind:'PANEL',otherW:'0',supplyTempC:'70',returnTempC:'50',
 radiatorNominalW:'1500',radiatorRefDeltaTK:'50',radiatorExponentN:'1.3'
});
test('actual source v0.1.0: surfaces + air + reserve and radiator regime correction',()=>{
 const result=calculateRoomHeating(sample());
 assert.equal(result.status,'COMPLETE');
 assert.equal(result.heatLoss.status,'COMPLETE');
 assert.equal(result.heatLoss.calculationVersion,'ENGINEERING_HEAT_LOSS_V1');
 assert.ok(Math.abs(result.heatLoss.transmission.wallsW-120)<1e-9);
 assert.ok(Math.abs(result.heatLoss.transmission.windowsW-96)<1e-9);
 assert.ok(Math.abs(result.heatLoss.airLossW-255)<1e-9);
 assert.ok(Math.abs(result.heatLoss.requiredHeatW-518.1)<1e-8);
 assert.equal(result.radiatorStatus,'COMPLETE');
 assert.equal(result.radiatorSizing.candidates[0].requiredUnits,1);
 assert.equal(result.radiatorSizing.candidates[0].sizingStatus,'PASS');
 assert.equal(result.heatLoss.canonicalWrites,0);
 assert.equal(result.radiatorSizing.canonicalWrites,0);
});
test('real device count: low-power sectional requires multiple sections',()=>{
 const a=sample();a.radiatorKind='SECTIONAL';a.radiatorNominalW='200';
 const x=calculateRoomHeating(a);
 assert.equal(x.radiatorStatus,'COMPLETE');
 assert.ok(x.radiatorSizing.candidates[0].requiredUnits>=3);
 assert.match(calculatorHtml({values:a,result:x}),/Количество секций/);
});
test('no silent climatic U-value/ground-floor assumption',()=>{
 const a=sample();
 delete a.outdoorTempC;
 assert.equal(calculateRoomHeating(a).status,'INCOMPLETE');
 const b=sample();b.floorType='GROUND';
 const r=calculateRoomHeating(b);
 assert.equal(r.status,'INCOMPLETE');
 assert.ok(r.missingInputs.includes('groundHeatLossW'));
 const c=sample();c.floorType='';
 assert.equal(calculateRoomHeating(c).status,'INCOMPLETE');
});
test('validated ground heat loss accepted, not fabricated',()=>{
 const a=sample();a.floorType='GROUND';a.groundHeatLossW='80';
 const r=calculateRoomHeating(a);
 assert.equal(r.status,'COMPLETE');
 assert.equal(r.heatLoss.transmission.floorW,80);
 assert.ok(Math.abs(r.heatLoss.requiredHeatW-606.1)<1e-8);
});
test('numeric input validation blocks NaN, negative ACH, reversed temperatures',()=>{
 const a=sample();a.wallU='abc';assert.equal(calculateRoomHeating(a).status,'INVALID');
 const b=sample();b.ach='-1';assert.equal(calculateRoomHeating(b).status,'INVALID');
 const c=sample();c.outdoorTempC='25';assert.equal(calculateRoomHeating(c).status,'INVALID');
 const d=sample();d.lengthM='';assert.equal(calculateRoomHeating(d).status,'INCOMPLETE');
});
test('heat-only result without inventing radiator output',()=>{
 const a=sample();delete a.supplyTempC;delete a.returnTempC;delete a.radiatorNominalW;delete a.radiatorRefDeltaTK;delete a.radiatorExponentN;
 const r=calculateRoomHeating(a);
 assert.equal(r.status,'COMPLETE');assert.equal(r.stage,'HEAT_LOSS_ONLY');
 assert.equal(r.radiatorStatus,'INCOMPLETE');
 assert.match(calculatorHtml({values:a,result:r}),/Теплопотери рассчитаны/);
});
test('UFH is explicitly owner supplied, estimated source emits warning',()=>{
 const a=sample();a.ufhStatus='ESTIMATED';a.ufhW='120';
 const r=calculateRoomHeating(a);
 assert.equal(r.radiatorStatus,'COMPLETE');
 assert.ok(Math.abs(r.radiatorSizing.residualLoad.residualRadiatorLoadW-398.1)<1e-8);
 assert.ok(r.radiatorSizing.warnings.includes('UFH_CONTRIBUTION_ESTIMATED'));
});
test('input encoding and no form write endpoints',()=>{
 const a=sample();a.roomName='<img src=x onerror=alert(1)>';
 const html=calculatorHtml({values:a,result:calculateRoomHeating(a)});
 assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.doesNotMatch(html,/<img src=x/);
 assert.match(html,/engineeringCalculationForm/);
 assert.doesNotMatch(html,/data-act=|fetch\(|\/api\/action/);
 assert.equal(ENGINE_SOURCE.heatLoss.blob,'bc66bff2948618aa9f97cfca510cd52cae960b63');
});
test('original engines are callable independently and preserve explicit incomplete statuses',()=>{
 assert.equal(calculateHeatLoss({}).status,'INCOMPLETE');
 assert.equal(evaluateRadiatorCandidates({}).status,'INCOMPLETE');
});

test('cold floor and ceiling use their own explicit boundary temperatures',()=>{
 const a=sample();a.floorType='EXTERIOR';a.floorU='0.8';a.ceilingType='EXTERIOR';a.ceilingU='0.3';
 assert.equal(calculateRoomHeating(a).status,'INCOMPLETE');
 a.floorBoundaryTempC='5';a.ceilingBoundaryTempC='0';
 const r=calculateRoomHeating(a);
 assert.equal(r.status,'COMPLETE');
 assert.ok(Math.abs(r.heatLoss.transmission.floorW-240)<1e-8);
 assert.ok(Math.abs(r.heatLoss.transmission.ceilingW-120)<1e-8);
 assert.ok(Math.abs(r.heatLoss.requiredHeatW-914.1)<1e-8);
});
