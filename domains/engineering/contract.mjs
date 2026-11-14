// DRAFT standalone read-only Engineering -> Clean PWA snapshot boundary.
// No calculation engine, persistence, API route, or external dependency.
import {createHash} from 'node:crypto';

export const CONTRACT_VERSION = 'VBOS_ENGINEERING_SNAPSHOT_V2_DRAFT';
const SHA40 = /^[0-9a-f]{40}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ABS_MM = 1_000_000_000;
const LIMITS = Object.freeze({floors: 50, rooms: 1000, vertices: 40_000, zones: 5000});
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 128;
const mm = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_ABS_MM;
const ordinal = value => Number.isSafeInteger(value) && value >= 1;
const assertUnique = (id, path, set, issues) => {
  if (!isId(id)) { issues.push({path, code:'REQUIRED_STABLE_ID'}); return; }
  if (set.has(id)) issues.push({path, code:'DUPLICATE_STABLE_ID'});
  set.add(id);
};

/**
 * Validate a DRAFT read-only engineering geometry projection, not the legacy
 * canonical sheet schema. Never use this as a migration approval or a physical
 * engineering/geometric validity proof. All geometry coordinates are mm.
 */
export function validateEngineeringSnapshot(snapshot) {
  const issues = [];
  const stats = {floors:0, rooms:0, zones:0, vertices:0};
  if (!isRecord(snapshot)) return {ok:false, status:'INVALID_CONTRACT', issues:[{path:'$', code:'OBJECT_REQUIRED'}], stats};
  if (snapshot.contractVersion !== CONTRACT_VERSION) issues.push({path:'contractVersion',code:'UNSUPPORTED_CONTRACT_VERSION'});
  if (snapshot.geometryUnit !== 'MM') issues.push({path:'geometryUnit',code:'EXPECTED_MM'});
  if (!isId(snapshot.engineeringProjectId)) issues.push({path:'engineeringProjectId',code:'REQUIRED_STABLE_ID'});
  const source=snapshot.source;
  if (!isRecord(source)) issues.push({path:'source',code:'SOURCE_REQUIRED'});
  else {
    if (source.system !== 'VBOS_LEGACY_ENGINEERING') issues.push({path:'source.system',code:'SOURCE_SYSTEM_UNSUPPORTED'});
    if (!isId(source.schemaVersion)) issues.push({path:'source.schemaVersion',code:'SCHEMA_VERSION_REQUIRED'});
    if (!SHA40.test(String(source.commitSha || ''))) issues.push({path:'source.commitSha',code:'PINNED_COMMIT_REQUIRED'});
    if (!SHA40.test(String(source.schemaBlobSha || ''))) issues.push({path:'source.schemaBlobSha',code:'PINNED_SCHEMA_BLOB_REQUIRED'});
    if (!ordinal(source.revision)) issues.push({path:'source.revision',code:'REVISION_REQUIRED'});
  }
  if (snapshot.objectLink != null) {
    if (!isRecord(snapshot.objectLink) || snapshot.objectLink.authority !== 'VBOS_CLEAN_POSTGRES' || !UUID.test(String(snapshot.objectLink.objectId||''))) {
      issues.push({path:'objectLink',code:'EXPLICIT_POSTGRES_OBJECT_LINK_REQUIRED'});
    }
  }
  if (!Array.isArray(snapshot.floors) || snapshot.floors.length === 0 || snapshot.floors.length > LIMITS.floors) {
    issues.push({path:'floors',code:'FLOOR_LIST_INVALID'});
  } else {
    const floorIds = new Set(), roomIds = new Set(), zoneIds = new Set();
    stats.floors = snapshot.floors.length;
    const polygon = (vertices,path) => {
      if (!Array.isArray(vertices) || vertices.length < 3 || vertices.length > 10_000) {
        issues.push({path,code:'POLYGON_POINTS_INVALID'}); return;
      }
      stats.vertices += vertices.length;
      for (let i=0;i<vertices.length;i++) {
        const p=vertices[i];
        if (!isRecord(p) || !mm(p.xMm) || !mm(p.yMm)) issues.push({path:`${path}[${i}]`,code:'FINITE_MM_POINT_REQUIRED'});
      }
    };
    for (let fi=0;fi<snapshot.floors.length;fi++) {
      const floor=snapshot.floors[fi], root=`floors[${fi}]`;
      if (!isRecord(floor)) {issues.push({path:root,code:'FLOOR_OBJECT_REQUIRED'});continue;}
      assertUnique(floor.engineeringFloorId,`${root}.engineeringFloorId`,floorIds,issues);
      if (!mm(floor.elevationMm)) issues.push({path:`${root}.elevationMm`,code:'FINITE_MM_REQUIRED'});
      if (!Array.isArray(floor.rooms) || floor.rooms.length>LIMITS.rooms) {issues.push({path:`${root}.rooms`,code:'ROOM_LIST_INVALID'});continue;}
      for (let ri=0;ri<floor.rooms.length;ri++) {
        const room=floor.rooms[ri], base=`${root}.rooms[${ri}]`;
        stats.rooms++;
        if (!isRecord(room)) {issues.push({path:base,code:'ROOM_OBJECT_REQUIRED'});continue;}
        assertUnique(room.engineeringRoomId,`${base}.engineeringRoomId`,roomIds,issues);
        if (!mm(room.ceilingHeightMm) || room.ceilingHeightMm<=0) issues.push({path:`${base}.ceilingHeightMm`,code:'POSITIVE_MM_REQUIRED'});
        polygon(room.boundary,`${base}.boundary`);
        if (room.noHeatZones !== undefined) {
          if (!Array.isArray(room.noHeatZones)) issues.push({path:`${base}.noHeatZones`,code:'ZONE_LIST_INVALID'});
          else for (let zi=0;zi<room.noHeatZones.length;zi++) {
            stats.zones++;
            const zone=room.noHeatZones[zi], zpath=`${base}.noHeatZones[${zi}]`;
            if (!isRecord(zone)) {issues.push({path:zpath,code:'ZONE_OBJECT_REQUIRED'});continue;}
            assertUnique(zone.engineeringExclusionZoneId,`${zpath}.engineeringExclusionZoneId`,zoneIds,issues);
            polygon(zone.boundary,`${zpath}.boundary`);
          }
        }
      }
    }
  }
  if (stats.rooms>LIMITS.rooms || stats.zones>LIMITS.zones || stats.vertices>LIMITS.vertices) issues.push({path:'floors',code:'SNAPSHOT_LIMIT_EXCEEDED'});
  return {ok:issues.length===0,status:issues.length===0?'VALID_CONTRACT':'INVALID_CONTRACT',issues,stats};
}

// Exact deterministic fingerprint of the defined projection, for later
// calculated-result provenance. No hashing of freeform or sensitive fields.
// Array order is intentionally significant (room/wall traversal order).
function stableJson(value) {
  if (Array.isArray(value)) return '['+value.map(stableJson).join(',')+']';
  if (isRecord(value)) return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableJson(value[k])).join(',')+'}';
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  throw new TypeError('NON_JSON_CONTRACT_VALUE');
}
export function fingerprintEngineeringSnapshot(snapshot) {
  const validation=validateEngineeringSnapshot(snapshot);
  if (!validation.ok) return {ok:false,status:'INVALID_CONTRACT',issues:validation.issues};
  // Only explicitly modeled fields enter the digest, not names/notes/PII.
  const projection={
    contractVersion:snapshot.contractVersion, geometryUnit:snapshot.geometryUnit,
    engineeringProjectId:snapshot.engineeringProjectId,
    source:{system:snapshot.source.system,schemaVersion:snapshot.source.schemaVersion,
      commitSha:snapshot.source.commitSha.toLowerCase(),schemaBlobSha:snapshot.source.schemaBlobSha.toLowerCase(),revision:snapshot.source.revision},
    objectLink:snapshot.objectLink?{authority:snapshot.objectLink.authority,objectId:snapshot.objectLink.objectId.toLowerCase()}:null,
    floors:snapshot.floors.map(f=>({engineeringFloorId:f.engineeringFloorId,elevationMm:f.elevationMm,
      rooms:f.rooms.map(r=>({engineeringRoomId:r.engineeringRoomId,ceilingHeightMm:r.ceilingHeightMm,
        boundary:r.boundary.map(p=>({xMm:p.xMm,yMm:p.yMm})),
        noHeatZones:(r.noHeatZones||[]).map(z=>({engineeringExclusionZoneId:z.engineeringExclusionZoneId,
          boundary:z.boundary.map(p=>({xMm:p.xMm,yMm:p.yMm}))}))}))}))
  };
  return {ok:true,status:'VALID_CONTRACT',algorithm:'SHA-256',fingerprint:createHash('sha256').update(stableJson(projection)).digest('hex'),
    contractVersion:CONTRACT_VERSION,sourceCommit:projection.source.commitSha,revision:projection.source.revision};
}

/**
 * An independent source-identity gate. The trusted lock must come from
 * verified repository/release evidence, NEVER from the same user/API payload.
 * This only proves tuple equality; it does not prove deployment or user acceptance.
 */
export function verifyEngineeringSourceLock(snapshot, trustedLock) {
  const validation=validateEngineeringSnapshot(snapshot);
  if (!validation.ok) return {ok:false,status:'INVALID_CONTRACT',issues:validation.issues};
  if (!isRecord(trustedLock) ||
      !SHA40.test(String(trustedLock.commitSha || '')) ||
      !SHA40.test(String(trustedLock.schemaBlobSha || '')) ||
      !isId(trustedLock.schemaVersion)) {
    return {ok:false,status:'UNVERIFIED_SOURCE_LOCK',issues:[{path:'trustedLock',code:'EXACT_TRUSTED_SOURCE_REQUIRED'}]};
  }
  const a=snapshot.source, b=trustedLock;
  if (a.commitSha.toLowerCase()!==b.commitSha.toLowerCase() ||
      a.schemaBlobSha.toLowerCase()!==b.schemaBlobSha.toLowerCase() ||
      a.schemaVersion!==b.schemaVersion) {
    return {ok:false,status:'SOURCE_IDENTITY_MISMATCH',issues:[{path:'source',code:'SOURCE_TUPLE_MISMATCH'}]};
  }
  return {ok:true,status:'SOURCE_TUPLE_MATCH',commitSha:a.commitSha.toLowerCase(),
    schemaBlobSha:a.schemaBlobSha.toLowerCase(),schemaVersion:a.schemaVersion,
    runtimeAccepted:false,calculationVerified:false};
}
