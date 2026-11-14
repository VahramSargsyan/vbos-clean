import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newDrawing,drawRect,calculateFromDrawing} from '../public/engineering-drawing-geometry.mjs';
import {newFloor,putFloorRoom,removeFloorRoom,calculateFloor,floorSnapshot,importFloor,exportFloor} from '../public/engineering-floor-model.mjs';
import {floorOverviewHtml} from '../public/engineering-floor-ui.mjs';
import {renderDrawing} from '../public/engineering-drawing-ui.mjs';
const floorId='CLEAN-DRAFT-FLOOR-12345678';
function room(id,name,a,b,window=false){
 let d=drawRect(newDrawing('CLEAN-DRAFT-ROOM-'+id,name),{xMm:a[0],yMm:a[1]},{xMm:b[0],yMm:b[1]});
 d.wallThicknessMm=100;
 d.wallRoles=['EXTERIOR','EXTERIOR','EXTERIOR','EXTERIOR']; // shared edges overridden by proven geometry
 d.thermal={heightMm:'2500',indoorTempC:'20',outdoorTempC:'-10',wallU:'0.4',windowU:'1.6',
  airChangesPerHour:'0.5',heatCapacityFactorWhM3K:'0.34',reservePct:'10',
  floorBoundaryType:'HEATED',ceilingBoundaryType:'HEATED'};
 if(window)d.openings=[{edgeIndex:0,openingType:'WINDOW',offsetFromWallStartMm:500,widthMm:2000,heightMm:1000}];
 return d;
}
function connected(){
 let f=newFloor(floorId,'Квартира');
 f=putFloorRoom(f,room('00000001','Спальня',[0,0],[5000,4000],true));
 f=putFloorRoom(f,room('00000002','Кухня',[5000,0],[10000,4000]));
 return f;
}
test('two adjacent real rectangular rooms create one physical shared wall, not duplicate ownership',()=>{
 const floor=connected(),top=floorSnapshot(floor);
 assert.equal(floor.rooms.length,2);
 assert.equal(top.rawWallCount,8);
 assert.equal(top.physicalWallCount,7);
 assert.equal(top.shared.length,1);
 assert.equal(top.snapshot.roomWallLinks.length,8);
 const walls=top.snapshot.walls.filter(w=>w.wallRole==='HEATED_ADJACENT');
 assert.equal(walls.length,1);
 assert.equal(top.snapshot.roomWallLinks.filter(l=>l.engineeringWallId===walls[0].engineeringWallId).length,2);
 assert.equal(top.snapshot.rooms.length,2);
 assert.equal(top.snapshot.openings.length,1);
});
test('whole-floor heat calculation uses original VBOS adapters for both rooms',()=>{
 const f=connected(),r=calculateFloor(f);
 assert.equal(r.status,'COMPLETE',JSON.stringify(r));
 assert.equal(r.completeRooms,2);
 assert.equal(r.roomCount,2);
 assert.equal(r.sharedWalls.length,1);
 assert.ok(Math.abs(r.totalHeatW-1539.2355)<1e-8,'whole-floor load should match pinned legacy HeatLoss output');
 assert.equal(r.roomResults[0].geometry.areaM2,19.11);
 assert.equal(r.roomResults[0].geometry.volumeM3,47.775);
 assert.equal(r.roomResults[0].heatLoss.transmission.wallsW,396);
 assert.equal(r.roomResults[0].heatLoss.transmission.windowsW,96);
 assert.equal(r.roomResults[1].heatLoss.transmission.wallsW,420);
 assert.equal(r.roomResults[0].heatLoss.canonicalWrites,0);
 assert.equal(r.canonicalWrites,0);
});
test('partial shared edges are not falsely joined, and floor heat blocked',()=>{
 let f=newFloor(floorId);
 f=putFloorRoom(f,room('00000001','A',[0,0],[5000,4000]));
 assert.throws(()=>putFloorRoom(f,room('00000002','B',[5000,1000],[10000,5000])),/PARTIAL_SHARED_WALL_UNSUPPORTED_P2/);
});
test('overlapping interiors and disconnected rooms rejected',()=>{
 let f=newFloor(floorId);
 f=putFloorRoom(f,room('00000001','A',[0,0],[5000,4000]));
 assert.throws(()=>putFloorRoom(f,room('00000002','B',[4000,2000],[9000,6000])),/ROOM_INTERIOR_OVERLAP/);
 assert.throws(()=>putFloorRoom(f,room('00000002','B',[7000,0],[12000,4000])),/ROOM_GRAPH_DISCONNECTED/);
});
test('same wall unequal thickness or opening ownership blocks',()=>{
 let f=newFloor(floorId);
 f=putFloorRoom(f,room('00000001','A',[0,0],[5000,4000]));
 const bad=room('00000002','B',[5000,0],[10000,4000]);
 bad.wallThicknessMm=200;
 assert.throws(()=>putFloorRoom(f,bad),/SHARED_WALL_THICKNESS_CONFLICT/);
 const other=room('00000002','B',[5000,0],[10000,4000]);
 other.openings=[{edgeIndex:3,openingType:'WINDOW',offsetFromWallStartMm:500,widthMm:1000,heightMm:1000}];
 assert.throws(()=>putFloorRoom(f,other),/OPENING_ON_SHARED_WALL_UNSUPPORTED_P2/);
});
test('different room temperatures at shared wall require future explicit inter-room transfer model',()=>{
 const f=connected();
 f.rooms[1].thermal.indoorTempC='24';
 assert.equal(calculateFloor(f).status,'INVALID');
 assert.match(calculateFloor(f).errors.join(','),/SHARED_WALL_DIFFERENT_INDOOR_TEMP/);
});
test('unresolved exterior wall classification blocks topology and heat totals',()=>{
 let f=newFloor(floorId),d=room('00000001','A',[0,0],[5000,4000]);
 d.wallRoles[0]='UNKNOWN';
 assert.throws(()=>putFloorRoom(f,d),/EXTERNAL_WALL_ROLE_UNRESOLVED/);
});
test('floor total cannot be advertised when one room thermal inputs missing',()=>{
 const f=connected();
 delete f.rooms[1].thermal.outdoorTempC;
 const r=calculateFloor(f);
 assert.equal(r.status,'INCOMPLETE');
 assert.equal(r.completeRooms,1);
 assert.equal(r.totalHeatW,null);
 assert.equal(r.roomResults[1].status,'INCOMPLETE');
});
test('rooms stay associated with stable independent CLEAN draft IDs and same floor',()=>{
 let f=connected(),view=floorSnapshot(f);
 assert.notEqual(f.rooms[0].projectId,f.rooms[1].projectId);
 assert.equal(view.snapshot.floor.engineeringFloorId,floorId);
 assert.ok(view.snapshot.rooms.every(x=>x.engineeringFloorId===floorId));
 assert.ok(view.snapshot.rooms.every(x=>x.engineeringRoomId.startsWith('CLEAN-DRAFT-')));
 assert.equal(view.snapshot.roomWallLinks.length,8);
});
test('updating an existing room replaces by ID; deleting may not leave disconnected plan',()=>{
 let f=connected();
 const edited={...f.rooms[0],roomName:'Гостиная'};
 f=putFloorRoom(f,edited);
 assert.equal(f.rooms.length,2);
 assert.equal(f.rooms[0].roomName,'Гостиная');
 f=removeFloorRoom(f,edited.roomId);
 assert.equal(f.rooms.length,1);
 assert.equal(f.rooms[0].roomName,'Кухня');
});
test('import/export floor preserves exact drawings and rejects legacy IDs / oversized input',()=>{
 const f=connected(),text=exportFloor(f),imported=importFloor(text);
 assert.deepEqual(imported,f);
 assert.throws(()=>importFloor(JSON.stringify({...f,source:'EngineeringProjects'})),/FLOOR_SOURCE_OR_ID_INVALID/);
 assert.throws(()=>importFloor('x'.repeat(200001)),/FLOOR_IMPORT_SIZE/);
});
test('summary escapes room labels and distinguishes incomplete from complete',()=>{
 const f=connected();f.rooms[0].roomName='<img src=x onerror=alert(1)>';
 const html=floorOverviewHtml(f,f.rooms[0].roomId);
 assert.match(html,/1[\s\u00a0\u202f]?539,24|1539.24/);
 assert.match(html,/&lt;img/);
 assert.doesNotMatch(html,/<img src=/);
 assert.match(html,/data-ef-next/);
 assert.match(html,/data-ef-export/);
 assert.match(html,/data-ef-edit/);
});
test('single-room floor source parity with existing P1 room heat loss',()=>{
 let d=room('00000001','Комната',[0,0],[5000,4000],true);
 let f=putFloorRoom(newFloor(floorId),d);
 const a=calculateFromDrawing(d),b=calculateFloor(f);
 assert.equal(a.status,'COMPLETE');
 assert.equal(b.status,'COMPLETE');
 assert.equal(b.totalHeatW,a.heatLoss.requiredHeatW);
 assert.equal(b.roomResults[0].geometry.areaM2,a.passport.geometry.netFloorAreaM2);
});

test('editor overlays committed neighbor rooms on same grid without HTML injection',()=>{
 const floor=connected(),editing=room('00000003','Новая',[0,4000],[5000,8000]);
 floor.rooms[0].roomName='<svg onload=alert(1)>';
 const html=renderDrawing(editing,null,null,'',floor.rooms);
 assert.match(html,/class="ed-neighbors"/);
 assert.match(html,/class="ed-neighbor"/);
 assert.match(html,/&lt;svg onload=aler/); // label is limited to 16 chars before escaping
 assert.doesNotMatch(html,/<svg onload=/);
 assert.match(html,/data-ed-canvas/);
});
