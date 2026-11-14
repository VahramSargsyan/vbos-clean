// Exact source functions extracted from VBOS EngineeringThermalPassportService v0.1.0,
// Git blob ac4b82ff6b615e4e6c0557284f05039edbb6e6e8. Do not change behaviors independently of source.
function engineeringThermalLengthMFromWallV010_(wall) {
  const x1 = Number(wall.startXmm), y1 = Number(wall.startYmm), x2 = Number(wall.endXmm), y2 = Number(wall.endYmm);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const dx = x2 - x1, dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy) / 1000;
}

function engineeringThermalOpeningAreaM2V010_(opening) {
  const widthMm = Number(opening.widthMm), heightMm = Number(opening.heightMm);
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) return null;
  return widthMm * heightMm / 1000000;
}

function engineeringThermalProfileV010_(map, id, fallback) {
  map = map || {};
  return map[id] || fallback || null;
}

function engineeringThermalBoundarySurfaceV010_(key, type, elementId, areaM2, profile, defaultBoundaryTempC) {
  profile = profile || {};
  return {
    key: key,
    type: type,
    elementId: String(elementId || ''),
    areaM2: areaM2,
    uValueWm2K: profile.uValueWm2K,
    boundaryTempC: profile.boundaryTempC !== undefined ? profile.boundaryTempC : defaultBoundaryTempC,
    boundaryType: String(profile.boundaryType || ''),
    include: profile.include !== false,
    validatedGroundHeatLossW: profile.validatedGroundHeatLossW
  };
}
export {engineeringThermalLengthMFromWallV010_,engineeringThermalOpeningAreaM2V010_,engineeringThermalProfileV010_,engineeringThermalBoundarySurfaceV010_};
