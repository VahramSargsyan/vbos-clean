// P2 Clean Engineering: connected rectangular rooms on one floor.
// No legacy-ID crosswalk, database writes or invented floor temperatures.
import {validateDrawing,drawingGeometry,DRAWING_SOURCE} from './engineering-drawing-geometry.mjs';
import {passportFromFloorSnapshot} from './eng-thermal-snapshot-v010.mjs';
import {calculateHeatLoss} from './eng-heat-loss-v010.mjs';

export const FLOOR_VERSION='VBOS_CLEAN_CONNECTED_RECT_FLOOR_P2';
const clone=x=>JSON.parse(JSON.stringify(x));
const finite=(value,name,min,max)=>{
 const s=String(value??'').trim().replace(',','.');
 if(!s)throw new Error('REQUIRED_'+name);
 const n=Number(s);
 if(!Number.isFinite(n)||n<min||n>max)throw new Error('INVALID_'+name);
 return n;
};
const eid=x=>typeof x==='string'&&/^CLEAN-DRAFT-[a-zA-Z0-9-]{8,100}$/.test(x);
export function newFloor(floorId,name='Этаж 1'){
 if(!eid(floorId))throw Error('CLEAN_FLOOR_ID_REQUIRED');
 return {format:FLOOR_VERSION,source:'CLEAN_PWA_DRAFT_NOT_LEGACY',floorId,name,rooms:[]};
}
export function validateFloor(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.format!==FLOOR_VERSION||raw.source!=='CLEAN_PWA_DRAFT_NOT_LEGACY'||!eid(raw.floorId))throw Error('FLOOR_SOURCE_OR_ID_INVALID');
 if(typeof raw.name!=='string'||raw.name.length>120||!Array.isArray(raw.rooms)||raw.rooms.length>12)throw Error('FLOOR_STRUCTURE_INVALID');
 const ids=new Set();
 const floor=clone(raw);
 floor.rooms=floor.rooms.map(room=>{
  const d=validateDrawing(room);
  if(ids.has(d.roomId))throw Error('DUPLICATE_ROOM_ID');
  ids.add(d.roomId);
  if(!d.corners||d.corners.length!==2||!d.roomName.trim())throw Error('ROOM_GEOMETRY_OR_NAME_INCOMPLETE');
  drawingGeometry(d); // checks actual mm coordinates and original net room metrics
  return d;
 });
 return floor;
}
function interval(r){
 const [a,b]=r.corners;
 return {x0:Math.min(a.xMm,b.xMm),x1:Math.max(a.xMm,b.xMm),y0:Math.min(a.yMm,b.yMm),y1:Math.max(a.yMm,b.yMm)};
}
function edge(w){
 const a={x:w.startXmm,y:w.startYmm},b={x:w.endXmm,y:w.endYmm};
 const horizontal=a.y===b.y;
 return {horizontal,fixed:horizontal?a.y:a.x,start:Math.min(horizontal?a.x:a.y,horizontal?b.x:b.y),end:Math.max(horizontal?a.x:a.y,horizontal?b.x:b.y)};
}
const lineKey=e=>(e.horizontal?'H':'V')+':'+e.fixed+':'+e.start+':'+e.end;
function crossEdge(a,b){
 if(a.horizontal!==b.horizontal||a.fixed!==b.fixed)return 0;
 return Math.max(0,Math.min(a.end,b.end)-Math.max(a.start,b.start));
}
function actualTopology(floor){
 const items=floor.rooms.map(d=>({draft:d,geometry:drawingGeometry(d),rectangle:interval(d)}));
 for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
  const a=items[i].rectangle,b=items[j].rectangle;
  if(Math.min(a.x1,b.x1)>Math.max(a.x0,b.x0)&&Math.min(a.y1,b.y1)>Math.max(a.y0,b.y0))
   throw Error('ROOM_INTERIOR_OVERLAP');
 }
 const walls=new Map(),linked=new Set(),links=[],adjacency=new Map(items.map(x=>[x.draft.roomId,new Set()]));
 // Reject partial coincident walls. Silently counting their heat losses twice would be wrong.
 for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
  for(const a of items[i].geometry.walls)for(const b of items[j].geometry.walls){
   const A=edge(a),B=edge(b),len=crossEdge(A,B);
   if(len>0&&lineKey(A)!==lineKey(B))throw Error('PARTIAL_SHARED_WALL_UNSUPPORTED_P2');
  }
 }
 for(const it of items){
  it.geometry.walls.forEach((wall,index)=>{
   const key=lineKey(edge(wall));
   if(!walls.has(key))walls.set(key,{wall:{...wall},owners:[]});
   const record=walls.get(key);
   if(record.owners.length>=2)throw Error('TRIPLE_SHARED_WALL');
   if(record.owners.length&&record.wall.thicknessMm!==wall.thicknessMm)throw Error('SHARED_WALL_THICKNESS_CONFLICT');
   record.owners.push({roomId:it.draft.roomId,edgeIndex:index,thermal:it.draft.thermal,role:it.draft.wallRoles[index]});
   it.geometry.walls[index].effectiveId=record.wall.engineeringWallId;
   links.push({engineeringFloorId:floor.floorId,engineeringRoomId:it.draft.roomId,
    engineeringWallId:record.wall.engineeringWallId,status:'DRAFT'});
  });
 }
 const shared=[];
 for(const [key,rec] of walls){
  if(rec.owners.length===2){
   const [a,b]=rec.owners,AR=items.find(x=>x.draft.roomId===a.roomId),BR=items.find(x=>x.draft.roomId===b.roomId);
   if(a.roomId===b.roomId)throw Error('SELF_SHARED_WALL');
   if(AR.draft.openings.some(x=>x.edgeIndex===a.edgeIndex)||BR.draft.openings.some(x=>x.edgeIndex===b.edgeIndex))
    throw Error('OPENING_ON_SHARED_WALL_UNSUPPORTED_P2');
   const ta=String(a.thermal.indoorTempC??'').trim(),tb=String(b.thermal.indoorTempC??'').trim();
   if(ta&&tb&&Math.abs(Number(ta.replace(',','.'))-Number(tb.replace(',','.')))>0.001)
    throw Error('SHARED_WALL_DIFFERENT_INDOOR_TEMP_UNSUPPORTED_P2');
   rec.wall.wallRole='HEATED_ADJACENT';
   adjacency.get(a.roomId).add(b.roomId);adjacency.get(b.roomId).add(a.roomId);
   shared.push({wallId:rec.wall.engineeringWallId,rooms:[a.roomId,b.roomId],lengthMm:rec.wall.endXmm===rec.wall.startXmm?
    Math.abs(rec.wall.endYmm-rec.wall.startYmm):Math.abs(rec.wall.endXmm-rec.wall.startXmm)});
  }else{
   if(rec.owners[0].role==='UNKNOWN')throw Error('EXTERNAL_WALL_ROLE_UNRESOLVED');
   rec.wall.wallRole=rec.owners[0].role;
  }
 }
 if(items.length>1){
  const seen=new Set([items[0].draft.roomId]),stack=[items[0].draft.roomId];
  while(stack.length){const curr=stack.pop();for(const other of adjacency.get(curr))if(!seen.has(other)){seen.add(other);stack.push(other)}}
  if(seen.size!==items.length)throw Error('ROOM_GRAPH_DISCONNECTED');
 }
 const allWalls=[...walls.values()].map(x=>({...x.wall,engineeringFloorId:floor.floorId,engineeringProjectId:floor.floorId}));
 const rooms=items.map(x=>({
  engineeringProjectId:floor.floorId,engineeringFloorId:floor.floorId,engineeringRoomId:x.draft.roomId,
  name:x.draft.roomName,ceilingHeightMm:x.draft.thermal.heightMm||'',status:'DRAFT',revision:1
 }));
 const zones=items.map(x=>({
  engineeringProjectId:floor.floorId,engineeringFloorId:floor.floorId,engineeringRoomId:x.draft.roomId,
  engineeringRoomZoneId:x.draft.roomId+'-Z',verticesJson:JSON.stringify(x.geometry.vertices),
  areaMm2:x.geometry.metrics.areaMm2,perimeterMm:x.geometry.metrics.perimeterMm,status:'DRAFT',revision:1
 }));
 const openings=items.flatMap(x=>x.geometry.openingRows.map(o=>{
  const localIndex=x.geometry.walls.findIndex(w=>w.engineeringWallId===o.engineeringWallId);
  const resolved=x.geometry.walls[localIndex];
  return {...o,engineeringProjectId:floor.floorId,engineeringFloorId:floor.floorId,engineeringWallId:resolved.effectiveId};
 }));
 return {
  snapshot:{floor:{engineeringProjectId:floor.floorId,engineeringFloorId:floor.floorId,defaultCeilingHeightMm:0,status:'DRAFT',revision:1},
   rooms,zones,walls:allWalls,openings,roomWallLinks:links},
  shared,items,rawWallCount:items.length*4,physicalWallCount:allWalls.length
 };
}
export function floorSnapshot(raw){
 const floor=validateFloor(raw);return actualTopology(floor);
}
function thermalFromRoom(d){
 const t=d.thermal,missing=[];
 const required=(key,min,max)=>{
  try{return finite(t[key],key,min,max)}catch{missing.push(key);return undefined}
 };
 const indoor=required('indoorTempC',-60,90),outdoor=required('outdoorTempC',-100,80);
 const ext=d.wallRoles.includes('EXTERIOR');
 // The floor graph may override a manually marked EXTERIOR shared edge. A missing U
 // remains an explicit input, not an implicit zero; no blind normalization.
 const uWall=ext?required('wallU',0,20):undefined;
 const uWindow=d.openings.some(x=>x.openingType==='WINDOW')?required('windowU',0,20):undefined;
 const uDoor=d.openings.some(x=>x.openingType==='DOOR')?required('doorU',0,20):undefined;
 const ach=required('airChangesPerHour',0,50),factor=required('heatCapacityFactorWhM3K',0.0001,2);
 const reserve=required('reservePct',0,200);
 const height=required('heightMm',1000,10000);
 let floorBoundary=null,ceilingBoundary=null;
 if(t.floorBoundaryType==='HEATED')floorBoundary={include:false};
 else if(t.floorBoundaryType==='GROUND')floorBoundary={boundaryType:'GROUND',validatedGroundHeatLossW:required('validatedGroundHeatLossW',0,100000)};
 else if(t.floorBoundaryType==='EXTERIOR')floorBoundary={uValueWm2K:required('floorU',0,20),boundaryTempC:required('floorBoundaryTempC',-100,100)};
 else missing.push('floorBoundaryType');
 if(t.ceilingBoundaryType==='HEATED')ceilingBoundary={include:false};
 else if(t.ceilingBoundaryType==='EXTERIOR')ceilingBoundary={uValueWm2K:required('ceilingU',0,20),boundaryTempC:required('ceilingBoundaryTempC',-100,100)};
 else missing.push('ceilingBoundaryType');
 if(indoor!==undefined&&outdoor!==undefined&&outdoor>=indoor)missing.push('outdoorTempC');
 return {missing,height,inputs:{
  indoorTempC:indoor,outdoorTempC:outdoor,
  defaultExteriorWallProfile:{uValueWm2K:uWall},
  defaultWindowProfile:{uValueWm2K:uWindow},
  defaultExteriorDoorProfile:{uValueWm2K:uDoor},
  floorBoundary,ceilingBoundary,airChangesPerHour:ach,heatCapacityFactorWhM3K:factor,reservePct:reserve
 }};
}
export function calculateFloor(raw){
 let floor,topology;
 try{floor=validateFloor(raw);topology=actualTopology(floor)}
 catch(e){return {status:'INVALID',stage:'FLOOR_TOPOLOGY',errors:[String(e.message)],roomResults:[],totalHeatW:null,derivedOnly:true,canonicalWrites:0}}
 if(!floor.rooms.length)return {status:'INCOMPLETE',stage:'ROOMS',roomResults:[],totalHeatW:null,sharedWalls:[],derivedOnly:true,canonicalWrites:0};
 const roomResults=floor.rooms.map(d=>{
  const th=thermalFromRoom(d);
  if(th.missing.length)return {roomId:d.roomId,roomName:d.roomName,status:'INCOMPLETE',stage:'THERMAL_INPUTS',missingInputs:th.missing};
  const passport=passportFromFloorSnapshot(topology.snapshot,d.roomId,th.inputs);
  if(!passport.passport||passport.status!=='COMPLETE')return {roomId:d.roomId,roomName:d.roomName,status:'INCOMPLETE',stage:'THERMAL_PASSPORT',missingInputs:passport.missingInputs||[],warnings:passport.warnings||[]};
  const heat=calculateHeatLoss(passport.passport);
  return {roomId:d.roomId,roomName:d.roomName,status:heat.status,stage:'HEAT_LOSS',
   heatLoss:heat,passport:passport.passport,geometry:{areaM2:passport.passport.geometry.netFloorAreaM2,volumeM3:passport.passport.geometry.volumeM3},
   missingInputs:heat.missingInputs||[],warnings:heat.warnings||[],derivedOnly:true,canonicalWrites:0};
 });
 const complete=roomResults.every(r=>r.status==='COMPLETE');
 return {status:complete?'COMPLETE':'INCOMPLETE',stage:'WHOLE_FLOOR_HEAT_LOSS',
  floorId:floor.floorId,roomCount:floor.rooms.length,sharedWalls:topology.shared,
  physicalWallCount:topology.physicalWallCount,rawWallCount:topology.rawWallCount,
  roomResults,totalHeatW:complete?roomResults.reduce((sum,r)=>sum+r.heatLoss.requiredHeatW,0):null,
  completeRooms:roomResults.filter(r=>r.status==='COMPLETE').length,
  derivedOnly:true,canonicalWrites:0,source:DRAWING_SOURCE};
}
export function putFloorRoom(raw,room){
 const floor=validateFloor(raw),d=validateDrawing(room);
 if(!d.corners||d.corners.length!==2||!d.roomName.trim())throw Error('ROOM_GEOMETRY_OR_NAME_INCOMPLETE');
 drawingGeometry(d);
 const existing=floor.rooms.findIndex(x=>x.roomId===d.roomId);
 if(existing>=0)floor.rooms[existing]=d;
 else{if(floor.rooms.length>=12)throw Error('ROOM_LIMIT_12');floor.rooms.push(d)}
 actualTopology(floor);return floor;
}
export function removeFloorRoom(raw,roomId){
 const floor=validateFloor(raw),before=floor.rooms.length;
 floor.rooms=floor.rooms.filter(x=>x.roomId!==roomId);
 if(floor.rooms.length===before)throw Error('ROOM_NOT_FOUND');
 actualTopology(floor);return floor;
}
export function exportFloor(raw){
 const floor=validateFloor(raw);if(!floor.rooms.length)throw Error('EMPTY_FLOOR_CANNOT_EXPORT');
 actualTopology(floor);return JSON.stringify(floor,null,2);
}
export function importFloor(input){
 if(typeof input!=='string'||input.length>200000)throw Error('FLOOR_IMPORT_SIZE');
 const floor=validateFloor(JSON.parse(input));actualTopology(floor);return floor;
}
