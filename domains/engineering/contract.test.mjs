import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CONTRACT_VERSION,validateEngineeringSnapshot,fingerprintEngineeringSnapshot,verifyEngineeringSourceLock} from './contract.mjs';
const sample=()=>({
  contractVersion:CONTRACT_VERSION,engineeringProjectId:'ENG-2026-0001',geometryUnit:'MM',
  source:{system:'VBOS_LEGACY_ENGINEERING',schemaVersion:'v0.9.1',schemaBlobSha:'49afa9d7a557ec4f493925b9895810dd2085d1f7',commitSha:'0123456789abcdef0123456789abcdef01234567',revision:1},
  objectLink:{authority:'VBOS_CLEAN_POSTGRES',objectId:'123e4567-e89b-42d3-a456-426614174000'},
  floors:[{engineeringFloorId:'EFL-2026-0001',elevationMm:0,
    rooms:[{engineeringRoomId:'ERM-2026-0001',ceilingHeightMm:2800,
      boundary:[{xMm:0,yMm:0},{xMm:4000,yMm:0},{xMm:4000,yMm:5000},{xMm:0,yMm:5000}],
      noHeatZones:[{engineeringExclusionZoneId:'EXC-2026-0001',boundary:[{xMm:0,yMm:0},{xMm:500,yMm:0},{xMm:500,yMm:500}]}]}]}]
});
function contains(result,code){return result.issues.some(x=>x.code===code);}
test('valid geometry projection has stable IDs and explicit millimetre unit',()=>{
 const s=sample(),before=JSON.stringify(s),v=validateEngineeringSnapshot(s);
 assert.equal(v.ok,true);assert.deepEqual(v.stats,{floors:1,rooms:1,zones:1,vertices:7});
 assert.equal(JSON.stringify(s),before);
});
test('fingerprint stable across property order and unrelated labels',()=>{
 const a=sample(),b=sample();b.floors[0].rooms[0].boundary[0]={yMm:0,xMm:0};b.floors[0].rooms[0].name='display only';
 assert.equal(fingerprintEngineeringSnapshot(a).fingerprint,fingerprintEngineeringSnapshot(b).fingerprint);
});
test('fingerprint detects changed geometry and source revision',()=>{
 const a=sample(),b=sample(),c=sample();b.floors[0].rooms[0].boundary[1].xMm=3500;c.source.revision++;
 assert.notEqual(fingerprintEngineeringSnapshot(a).fingerprint,fingerprintEngineeringSnapshot(b).fingerprint);
 assert.notEqual(fingerprintEngineeringSnapshot(a).fingerprint,fingerprintEngineeringSnapshot(c).fingerprint);
});
test('fail closed on cm/metres, not silent geometry conversion',()=>{
 const s=sample();s.geometryUnit='M';assert.equal(contains(validateEngineeringSnapshot(s),'EXPECTED_MM'),true);
});
test('reject missing source SHA and revision',()=>{
 const s=sample();s.source.commitSha='main';s.source.revision=0;
 const v=validateEngineeringSnapshot(s);assert.equal(contains(v,'PINNED_COMMIT_REQUIRED'),true);assert.equal(contains(v,'REVISION_REQUIRED'),true);
});
test('reject duplicated room IDs even across floors',()=>{
 const s=sample();s.floors.push({...structuredClone(s.floors[0]),engineeringFloorId:'EFL-2026-0002'});
 assert.equal(contains(validateEngineeringSnapshot(s),'DUPLICATE_STABLE_ID'),true);
});
test('reject non-finite mm coordinates',()=>{
 const s=sample();s.floors[0].rooms[0].boundary[0].xMm=NaN;
 assert.equal(contains(validateEngineeringSnapshot(s),'FINITE_MM_POINT_REQUIRED'),true);
 assert.equal(fingerprintEngineeringSnapshot(s).ok,false);
});
test('reject out-of-range mm coordinates',()=>{
 const s=sample();s.floors[0].rooms[0].boundary[0].xMm=1e12;
 assert.equal(contains(validateEngineeringSnapshot(s),'FINITE_MM_POINT_REQUIRED'),true);
});
test('reject invalid room height and polygon shape',()=>{
 const s=sample();s.floors[0].rooms[0].ceilingHeightMm=0;s.floors[0].rooms[0].boundary=[];
 const v=validateEngineeringSnapshot(s);assert.equal(contains(v,'POSITIVE_MM_REQUIRED'),true);assert.equal(contains(v,'POLYGON_POINTS_INVALID'),true);
});
test('reject implicit or invalid PWA object link',()=>{
 const s=sample();s.objectLink={authority:'LEGACY_SHEETS',objectId:'some-name'};
 assert.equal(contains(validateEngineeringSnapshot(s),'EXPLICIT_POSTGRES_OBJECT_LINK_REQUIRED'),true);
});
test('optional link may be omitted; legacy and PostgreSQL IDs remain distinct',()=>{
 const s=sample();delete s.objectLink;assert.equal(validateEngineeringSnapshot(s).ok,true);
});
test('non-record input rejected without exception',()=>{
 assert.equal(validateEngineeringSnapshot(null).status,'INVALID_CONTRACT');
});

const exactLock=()=>({schemaVersion:'v0.9.1',schemaBlobSha:'49afa9d7a557ec4f493925b9895810dd2085d1f7',commitSha:'0123456789abcdef0123456789abcdef01234567'});
test('exact source tuple matches a separately supplied trusted lock',()=>{
 const result=verifyEngineeringSourceLock(sample(),exactLock());
 assert.equal(result.ok,true);assert.equal(result.runtimeAccepted,false);assert.equal(result.calculationVerified,false);
});
test('identical version labels with different schema blob hashes fail closed',()=>{
 const s=sample();s.source.schemaBlobSha='a284f7728e637ed7df6c66a903bb54f738387760';
 assert.equal(validateEngineeringSnapshot(s).ok,true);
 const g=verifyEngineeringSourceLock(s,exactLock());
 assert.equal(g.status,'SOURCE_IDENTITY_MISMATCH');
 assert.notEqual(fingerprintEngineeringSnapshot(sample()).fingerprint,fingerprintEngineeringSnapshot(s).fingerprint);
});
test('missing schema blob is invalid, regardless of valid version label',()=>{
 const s=sample();delete s.source.schemaBlobSha;
 assert.equal(contains(validateEngineeringSnapshot(s),'PINNED_SCHEMA_BLOB_REQUIRED'),true);
});
test('schema version mismatch fails even if source commit and blob match',()=>{
 const s=sample();s.source.schemaVersion='v1.0.0';
 assert.equal(verifyEngineeringSourceLock(s,exactLock()).status,'SOURCE_IDENTITY_MISMATCH');
});
test('source commit mismatch fails even if schema name and blob match',()=>{
 const s=sample();s.source.commitSha='567a5be66865b9aceba8c1e964a44c2b9be7f499';
 assert.equal(verifyEngineeringSourceLock(s,exactLock()).status,'SOURCE_IDENTITY_MISMATCH');
});
test('trusted lock must be specified and complete',()=>{
 assert.equal(verifyEngineeringSourceLock(sample(),null).status,'UNVERIFIED_SOURCE_LOCK');
 assert.equal(verifyEngineeringSourceLock(sample(),{schemaVersion:'v0.9.1'}).status,'UNVERIFIED_SOURCE_LOCK');
});
