// FILE_NAME: EngineeringRadiatorSizingEngine_v0_1_0.js
// FILE_VERSION: v0.1.0
// BUILD_DATE: 2026-09-22
// WORKFLOW_MODE: BUILD_NEW_APP
// PURPOSE: Pure radiator output correction and room residual-load sizing. No Sheets access, no canonical writes.
// TEST_LEVEL: LOCAL_STRUCTURE_CHECK

const VBOS_ENGINEERING_RADIATOR_V010 = Object.freeze({
  calculationVersion: 'ENGINEERING_RADIATOR_SIZING_V1',
  sourceBasis: 'EN442_MANUFACTURER_DELTA_T_CORRECTION',
  maxOutputW: 100000,
  maxExponentN: 5,
  maxUnits: 100
});

function engineeringRadiatorNumberV010_(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function engineeringRadiatorDeltaTV010_(supplyTempC, returnTempC, roomTempC) {
  const supply = engineeringRadiatorNumberV010_(supplyTempC);
  const ret = engineeringRadiatorNumberV010_(returnTempC);
  const room = engineeringRadiatorNumberV010_(roomTempC);
  if (supply === null || ret === null || room === null) return {status:'INCOMPLETE'};
  if (!(supply > ret && ret > room)) return {status:'INVALID',reason:'TEMPERATURE_ORDER'};

  const numerator = ret - room;
  const denominator = supply - room;
  const c = numerator / denominator;
  let deltaTK;
  let method;
  if (c < 0.7) {
    deltaTK = (supply - ret) / Math.log((supply - room) / (ret - room));
    method = 'LOGARITHMIC';
  } else {
    deltaTK = (supply + ret) / 2 - room;
    method = 'ARITHMETIC';
  }
  if (!Number.isFinite(deltaTK) || deltaTK <= 0) return {status:'INVALID',reason:'DELTA_T'};
  return {status:'COMPLETE',deltaTK:deltaTK,method:method,cRatio:c};
}

function engineeringRadiatorCorrectOutputV010_(candidate, regime) {
  candidate = candidate || {};
  regime = regime || {};
  const catalogueOutputW = engineeringRadiatorNumberV010_(candidate.catalogueOutputW);
  const exponentN = engineeringRadiatorNumberV010_(candidate.exponentN);
  const referenceDeltaTK = engineeringRadiatorNumberV010_(candidate.referenceDeltaTK);
  const delta = engineeringRadiatorDeltaTV010_(regime.supplyTempC, regime.returnTempC, regime.roomTempC);
  const missing=[];
  if (catalogueOutputW === null) missing.push('catalogueOutputW');
  if (exponentN === null) missing.push('exponentN');
  if (referenceDeltaTK === null) missing.push('referenceDeltaTK');
  if (delta.status === 'INCOMPLETE') missing.push('temperatureRegime');
  if (missing.length) return {status:'INCOMPLETE',missingInputs:missing};
  if (delta.status === 'INVALID') return {status:'INVALID',invalidInputs:[delta.reason]};
  if (catalogueOutputW <= 0 || catalogueOutputW > VBOS_ENGINEERING_RADIATOR_V010.maxOutputW) return {status:'INVALID',invalidInputs:['catalogueOutputW']};
  if (exponentN <= 0 || exponentN > VBOS_ENGINEERING_RADIATOR_V010.maxExponentN) return {status:'INVALID',invalidInputs:['exponentN']};
  if (referenceDeltaTK <= 0) return {status:'INVALID',invalidInputs:['referenceDeltaTK']};

  const factor = Math.pow(delta.deltaTK / referenceDeltaTK, exponentN);
  return {
    status:'COMPLETE',
    candidateId:String(candidate.candidateId || ''),
    model:String(candidate.model || ''),
    catalogueOutputW:catalogueOutputW,
    exponentN:exponentN,
    referenceDeltaTK:referenceDeltaTK,
    actualDeltaTK:delta.deltaTK,
    deltaTMethod:delta.method,
    cRatio:delta.cRatio,
    correctionFactor:factor,
    correctedOutputW:catalogueOutputW * factor
  };
}

function engineeringRadiatorResidualLoadV010_(input) {
  input=input||{};
  const requiredHeatW=engineeringRadiatorNumberV010_(input.requiredHeatW);
  const ufhW=engineeringRadiatorNumberV010_(input.ufhContributionW);
  const otherW=engineeringRadiatorNumberV010_(input.otherHeatingContributionW);
  const ufhStatus=String(input.ufhContributionStatus||'').toUpperCase();
  const missing=[];
  if(requiredHeatW===null)missing.push('requiredHeatW');
  if(!ufhStatus)missing.push('ufhContributionStatus');
  if(ufhStatus && ['NONE','ESTIMATED','VALIDATED'].indexOf(ufhStatus)===-1)return {status:'INVALID',invalidInputs:['ufhContributionStatus']};
  if(ufhStatus!=='NONE' && ufhW===null)missing.push('ufhContributionW');
  if(missing.length)return {status:'INCOMPLETE',missingInputs:missing};
  if(requiredHeatW<0)return {status:'INVALID',invalidInputs:['requiredHeatW']};
  const effectiveUfhW=ufhStatus==='NONE'?0:Math.max(0,ufhW);
  const effectiveOtherW=otherW===null?0:Math.max(0,otherW);
  return {
    status:'COMPLETE',
    requiredHeatW:requiredHeatW,
    ufhContributionStatus:ufhStatus,
    ufhContributionW:effectiveUfhW,
    otherHeatingContributionW:effectiveOtherW,
    residualRadiatorLoadW:Math.max(0,requiredHeatW-effectiveUfhW-effectiveOtherW),
    warnings:ufhStatus==='ESTIMATED'?['UFH_CONTRIBUTION_ESTIMATED']:[]
  };
}

function engineeringRadiatorEvaluateCandidatesV010_(input) {
  input=input||{};
  const residual=engineeringRadiatorResidualLoadV010_(input);
  if(residual.status!=='COMPLETE')return Object.assign({calculationVersion:VBOS_ENGINEERING_RADIATOR_V010.calculationVersion},residual);
  const candidates=Array.isArray(input.candidates)?input.candidates:[];
  if(!candidates.length)return {status:'INCOMPLETE',missingInputs:['candidates'],calculationVersion:VBOS_ENGINEERING_RADIATOR_V010.calculationVersion};
  const evaluated=[];
  const invalid=[];
  candidates.forEach(function(candidate,index){
    const corrected=engineeringRadiatorCorrectOutputV010_(candidate,input.regime||{});
    if(corrected.status!=='COMPLETE'){
      invalid.push({candidateId:String(candidate&&candidate.candidateId||index),result:corrected});
      return;
    }
    const perUnit=corrected.correctedOutputW;
    const units=residual.residualRadiatorLoadW<=0?0:Math.ceil(residual.residualRadiatorLoadW/perUnit);
    if(units>VBOS_ENGINEERING_RADIATOR_V010.maxUnits){
      invalid.push({candidateId:corrected.candidateId,result:{status:'INVALID',invalidInputs:['requiredUnits']}});
      return;
    }
    const total=units*perUnit;
    evaluated.push(Object.assign({},corrected,{
      requiredUnits:units,
      totalCorrectedOutputW:total,
      marginW:total-residual.residualRadiatorLoadW,
      marginPct:residual.residualRadiatorLoadW>0?(total/residual.residualRadiatorLoadW-1)*100:0,
      sizingStatus:units===0?'NOT_REQUIRED':(total>=residual.residualRadiatorLoadW?'PASS':'UNDERSIZED')
    }));
  });
  return {
    status:evaluated.length?'COMPLETE':'INVALID',
    residualLoad:residual,
    regime:Object.assign({},input.regime||{}),
    candidates:evaluated,
    invalidCandidates:invalid,
    warnings:residual.warnings||[],
    calculationVersion:VBOS_ENGINEERING_RADIATOR_V010.calculationVersion,
    sourceBasis:VBOS_ENGINEERING_RADIATOR_V010.sourceBasis,
    derivedOnly:true,
    canonicalWrites:0
  };
}

// ESM browser adapter: original source above is unmodified.

export { engineeringRadiatorCorrectOutputV010_ as correctRadiatorOutput, engineeringRadiatorEvaluateCandidatesV010_ as evaluateRadiatorCandidates };
