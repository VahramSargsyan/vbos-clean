import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SOURCE_LOCK,exampleRows,previewSnapshot,previewHtml} from '../public/engineering-preview.mjs';
import {validateEngineeringSnapshot,verifyEngineeringSourceLock} from '../domains/engineering/contract.mjs';

test('real Engineering entity/column shape maps to valid V2 projection',()=>{
 const s=previewSnapshot();
 assert.equal(s.contractVersion,'VBOS_ENGINEERING_SNAPSHOT_V2_DRAFT');
 assert.equal(s.geometryUnit,'MM');
 assert.equal(s.floors.length,2);
 assert.deepEqual(s.floors.map(f=>f.rooms.length),[3,2]);
 assert.equal(s.floors[0].rooms[0].areaMm2,14_000_000);
 assert.equal(validateEngineeringSnapshot(s).ok,true);
 assert.equal(verifyEngineeringSourceLock(s,SOURCE_LOCK).status,'SOURCE_TUPLE_MATCH');
});
test('renders selectable floor and room without writes',()=>{
 const s=previewSnapshot(),a=previewHtml(s),b=previewHtml(s,{floorId:'EFL-2026-0002',roomId:'ERM-2026-0005'});
 assert.match(a,/Инженерия/);
 assert.match(a,/data-eg-floor="EFL-2026-0002"/);
 assert.match(a,/data-eg-room="ERM-2026-0001"/);
 assert.match(b,/data-eg-room="ERM-2026-0005"/);
 assert.doesNotMatch(b,/data-eg-room="ERM-2026-0001"/);
 assert.doesNotMatch(a,/<form|data-act=|fetch\(/);
});
test('same version label with wrong source commit/blob is rejected',()=>{
 const rows=exampleRows();
 assert.throws(()=>previewSnapshot(rows,{...SOURCE_LOCK,schemaBlobSha:'a284f7728e637ed7df6c66a903bb54f738387760'}),/SOURCE_MISMATCH/);
 assert.throws(()=>previewSnapshot(rows,{...SOURCE_LOCK,commitSha:'567a5be66865b9aceba8c1e964a44c2b9be7f499'}),/SOURCE_MISMATCH/);
});
test('wrong parent links and orphan zones fail closed',()=>{
 const rows=exampleRows();
 rows.EngineeringRoomZones[0].engineeringFloorId='EFL-2026-0002';
 assert.throws(()=>previewSnapshot(rows),/ZONE_INVALID/);
 const nozone=exampleRows();nozone.EngineeringRoomZones.pop();
 assert.throws(()=>previewSnapshot(nozone),/ZONE_CARDINALITY/);
});
test('duplicate identifiers and malformed coordinates fail closed',()=>{
 const dup=exampleRows();dup.EngineeringRooms[1].engineeringRoomId=dup.EngineeringRooms[0].engineeringRoomId;
 assert.throws(()=>previewSnapshot(dup),/DUPLICATE_ID/);
 const invalid=exampleRows();invalid.EngineeringRoomZones[0].verticesJson='[{"xMm":0,"yMm":0},{"xMm":12.5,"yMm":0},{"xMm":0,"yMm":1000}]';
 assert.throws(()=>previewSnapshot(invalid),/BAD_POLYGON/);
});
test('user-derived names are safely escaped in HTML and SVG',()=>{
 const s=previewSnapshot();s.projectName='<img src=x onerror=alert(1)>';s.floors[0].rooms[0].name='<svg onload=alert(1)>';
 const html=previewHtml(s);
 assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.match(html,/&lt;svg onload=alert\(1\)&gt;/);
 assert.doesNotMatch(html,/<img src=x|<svg onload/);
});

test('self-intersecting polygon rejected despite positive shoelace area',()=>{
 const rows=exampleRows();
 rows.EngineeringRoomZones[0].verticesJson=JSON.stringify([
  {xMm:0,yMm:0},{xMm:4000,yMm:0},{xMm:0,yMm:4000},
  {xMm:4000,yMm:4000},{xMm:2000,yMm:5000}
 ]);
 assert.throws(()=>previewSnapshot(rows),/SELF_INTERSECTING_POLYGON/);
});
