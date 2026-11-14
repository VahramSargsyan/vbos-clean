// FILE_NAME: EngineeringHeatLossEngine_v0_1_0.js
// FILE_VERSION: v0.1.0
// BUILD_DATE: 2026-09-22
// WORKFLOW_MODE: BUILD_NEW_APP
// PURPOSE: Pure derived-only room heat-loss calculation. No Sheets access, no canonical writes.
// TEST_LEVEL: LOCAL_STRUCTURE_CHECK

const VBOS_ENGINEERING_HEAT_LOSS_V010 = Object.freeze({
  calculationVersion: 'ENGINEERING_HEAT_LOSS_V1',
  maxAreaM2: 100000,
  maxVolumeM3: 1000000,
  maxAbsTemperatureC: 150,
  maxUValueWm2K: 20,
  maxAirChangesPerHour: 50,
  maxReservePct: 200
});

function engineeringHeatLossNumberV010_(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function engineeringHeatLossMissingV010_(missing, key) {
  if (missing.indexOf(key) === -1) missing.push(key);
}

function engineeringHeatLossSurfaceV010_(surface, indoorTempC, missing, invalid) {
  surface = surface || {};
  const key = String(surface.key || surface.elementId || surface.type || 'surface');
  const boundaryType = String(surface.boundaryType || '').toUpperCase();
  if (boundaryType === 'GROUND' || boundaryType === 'GROUND_CONTACT') {
    const validatedGroundHeatLossW = engineeringHeatLossNumberV010_(surface.validatedGroundHeatLossW);
    if (validatedGroundHeatLossW === null) {
      engineeringHeatLossMissingV010_(missing, key + '.validatedGroundHeatLossW');
      return null;
    }
    if (validatedGroundHeatLossW < 0) {
      invalid.push(key + '.validatedGroundHeatLossW');
      return null;
    }
    return {
      key:key,
      elementId:String(surface.elementId || ''),
      type:String(surface.type || 'FLOOR').toUpperCase(),
      areaM2:engineeringHeatLossNumberV010_(surface.areaM2),
      uValueWm2K:null,
      boundaryTempC:null,
      deltaTK:null,
      heatLossW:validatedGroundHeatLossW,
      boundaryType:boundaryType,
      method:'VALIDATED_GROUND_HEAT_TRANSFER'
    };
  }
  const areaM2 = engineeringHeatLossNumberV010_(surface.areaM2);
  const uValue = engineeringHeatLossNumberV010_(surface.uValueWm2K);
  const boundaryTempC = engineeringHeatLossNumberV010_(surface.boundaryTempC);

  if (areaM2 === null) engineeringHeatLossMissingV010_(missing, key + '.areaM2');
  if (uValue === null) engineeringHeatLossMissingV010_(missing, key + '.uValueWm2K');
  if (boundaryTempC === null) engineeringHeatLossMissingV010_(missing, key + '.boundaryTempC');
  if (areaM2 === null || uValue === null || boundaryTempC === null) return null;

  if (areaM2 < 0 || areaM2 > VBOS_ENGINEERING_HEAT_LOSS_V010.maxAreaM2) invalid.push(key + '.areaM2');
  if (uValue < 0 || uValue > VBOS_ENGINEERING_HEAT_LOSS_V010.maxUValueWm2K) invalid.push(key + '.uValueWm2K');
  if (Math.abs(boundaryTempC) > VBOS_ENGINEERING_HEAT_LOSS_V010.maxAbsTemperatureC) invalid.push(key + '.boundaryTempC');
  if (invalid.length) return null;

  const deltaTK = indoorTempC - boundaryTempC;
  return {
    key: key,
    elementId: String(surface.elementId || ''),
    type: String(surface.type || 'SURFACE').toUpperCase(),
    areaM2: areaM2,
    uValueWm2K: uValue,
    boundaryTempC: boundaryTempC,
    deltaTK: deltaTK,
    heatLossW: Math.max(0, areaM2 * uValue * deltaTK),
    boundaryType: String(surface.boundaryType || '')
  };
}

function engineeringHeatLossCalculateV010_(passport) {
  passport = passport || {};
  const missing = Array.isArray(passport.missingInputs) ? passport.missingInputs.slice() : [];
  const warnings = Array.isArray(passport.warnings) ? passport.warnings.slice() : [];
  const assumptions = Array.isArray(passport.assumptions) ? passport.assumptions.slice() : [];
  const invalid = [];

  const indoorTempC = engineeringHeatLossNumberV010_(passport.designConditions && passport.designConditions.indoorTempC);
  const volumeM3 = engineeringHeatLossNumberV010_(passport.geometry && passport.geometry.volumeM3);
  if (indoorTempC === null) engineeringHeatLossMissingV010_(missing, 'designConditions.indoorTempC');
  if (volumeM3 === null) engineeringHeatLossMissingV010_(missing, 'geometry.volumeM3');
  if (indoorTempC !== null && Math.abs(indoorTempC) > VBOS_ENGINEERING_HEAT_LOSS_V010.maxAbsTemperatureC) invalid.push('designConditions.indoorTempC');
  if (volumeM3 !== null && (volumeM3 <= 0 || volumeM3 > VBOS_ENGINEERING_HEAT_LOSS_V010.maxVolumeM3)) invalid.push('geometry.volumeM3');

  const envelope = passport.envelope || {};
  const rawSurfaces = [];
  ['walls', 'windows', 'doors'].forEach(function (name) {
    const list = envelope[name];
    if (Array.isArray(list)) list.forEach(function (item) { if (!item || item.include !== false) rawSurfaces.push(item); });
  });
  if (envelope.floorBoundary && envelope.floorBoundary.include !== false) rawSurfaces.push(envelope.floorBoundary);
  if (envelope.ceilingBoundary && envelope.ceilingBoundary.include !== false) rawSurfaces.push(envelope.ceilingBoundary);

  const breakdown = [];
  if (indoorTempC !== null) {
    rawSurfaces.forEach(function (surface) {
      const beforeInvalid = invalid.length;
      const item = engineeringHeatLossSurfaceV010_(surface, indoorTempC, missing, invalid);
      if (item && invalid.length === beforeInvalid) breakdown.push(item);
    });
  }

  const ach = engineeringHeatLossNumberV010_(passport.airExchange && passport.airExchange.airChangesPerHour);
  const airFactor = engineeringHeatLossNumberV010_(passport.airExchange && passport.airExchange.heatCapacityFactorWhM3K);
  const outsideTempC = engineeringHeatLossNumberV010_(passport.designConditions && passport.designConditions.outdoorTempC);
  if (ach === null) engineeringHeatLossMissingV010_(missing, 'airExchange.airChangesPerHour');
  if (airFactor === null) engineeringHeatLossMissingV010_(missing, 'airExchange.heatCapacityFactorWhM3K');
  if (outsideTempC === null) engineeringHeatLossMissingV010_(missing, 'designConditions.outdoorTempC');
  if (ach !== null && (ach < 0 || ach > VBOS_ENGINEERING_HEAT_LOSS_V010.maxAirChangesPerHour)) invalid.push('airExchange.airChangesPerHour');
  if (airFactor !== null && (airFactor <= 0 || airFactor > 2)) invalid.push('airExchange.heatCapacityFactorWhM3K');
  if (outsideTempC !== null && Math.abs(outsideTempC) > VBOS_ENGINEERING_HEAT_LOSS_V010.maxAbsTemperatureC) invalid.push('designConditions.outdoorTempC');

  if (invalid.length) {
    return {
      roomId: String(passport.roomId || ''),
      status: 'INVALID',
      invalidInputs: invalid,
      missingInputs: missing,
      warnings: warnings,
      assumptions: assumptions,
      calculationVersion: VBOS_ENGINEERING_HEAT_LOSS_V010.calculationVersion
    };
  }

  if (missing.length) {
    return {
      roomId: String(passport.roomId || ''),
      status: 'INCOMPLETE',
      invalidInputs: [],
      missingInputs: missing,
      warnings: warnings,
      assumptions: assumptions,
      calculationVersion: VBOS_ENGINEERING_HEAT_LOSS_V010.calculationVersion
    };
  }

  const transmissionByType = { WALL: 0, WINDOW: 0, DOOR: 0, FLOOR: 0, CEILING: 0, OTHER: 0 };
  let transmissionTotalW = 0;
  breakdown.forEach(function (item) {
    const type = Object.prototype.hasOwnProperty.call(transmissionByType, item.type) ? item.type : 'OTHER';
    transmissionByType[type] += item.heatLossW;
    transmissionTotalW += item.heatLossW;
  });

  const airDeltaTK = Math.max(0, indoorTempC - outsideTempC);
  const airLossW = airFactor * ach * volumeM3 * airDeltaTK;
  const baseHeatLossW = transmissionTotalW + airLossW;

  let reservePct = engineeringHeatLossNumberV010_(passport.reservePct);
  if (reservePct === null) {
    reservePct = 0;
    assumptions.push('NO_DESIGN_RESERVE');
  }
  if (reservePct < 0 || reservePct > VBOS_ENGINEERING_HEAT_LOSS_V010.maxReservePct) {
    return {
      roomId: String(passport.roomId || ''),
      status: 'INVALID',
      invalidInputs: ['reservePct'],
      missingInputs: [],
      warnings: warnings,
      assumptions: assumptions,
      calculationVersion: VBOS_ENGINEERING_HEAT_LOSS_V010.calculationVersion
    };
  }

  const requiredHeatW = baseHeatLossW * (1 + reservePct / 100);
  return {
    roomId: String(passport.roomId || ''),
    status: 'COMPLETE',
    transmission: {
      wallsW: transmissionByType.WALL,
      windowsW: transmissionByType.WINDOW,
      doorsW: transmissionByType.DOOR,
      floorW: transmissionByType.FLOOR,
      ceilingW: transmissionByType.CEILING,
      otherW: transmissionByType.OTHER,
      totalW: transmissionTotalW
    },
    airLossW: airLossW,
    baseHeatLossW: baseHeatLossW,
    reservePct: reservePct,
    requiredHeatW: requiredHeatW,
    elementBreakdown: breakdown,
    invalidInputs: [],
    missingInputs: [],
    warnings: warnings,
    assumptions: assumptions,
    calculationVersion: VBOS_ENGINEERING_HEAT_LOSS_V010.calculationVersion,
    derivedOnly: true,
    canonicalWrites: 0
  };
}

// ESM browser adapter: original source above is unmodified.

export { engineeringHeatLossCalculateV010_ as calculateHeatLoss };
