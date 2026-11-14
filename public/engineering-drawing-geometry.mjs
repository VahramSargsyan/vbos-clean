// VBOS Clean drawing-to-thermal P1, single real manually drawn orthogonal rectangle.
// Canonical legacy Geometry/Thermal sources are used via pinned ESM adapters.
// Never import this draft into Google Engineering or treat CLEAN-DRAFT IDs as legacy IDs.
import {passportFromFloorSnapshot} from './eng-thermal-snapshot-v010.mjs';
import {netRoomMetrics} from './eng-room-net-v027.mjs';
import {calculateHeatLoss} from './eng-heat-loss-v010.mjs';

export const DRAWING_VERSION='VBOS_CLEAN_RECTANGLE_THERMAL_P1';
export const DRAWING_SOURCE=Object.freeze({
  passport:'2ac2657c9f89957010df5e960514151e9f3575c9',
  geometryNet:'d5eabecc60a82c988ad3b5999980ad0499fc10f7',
  heatLoss:'bc66bff2948618aa9f97cfca510cd52cae960b63'
});
const safeId=x=>typeof x==='string'&&/^CLEAN-DRAFT-[a-zA-Z0-9-]{8,100}$/.test(x);
const isInt=x=>Number.isSafeInteger(x);
const numeric=(value,min,max,name)=>{
 const s=String(value??'').trim().replace(',','.');
 if(!s)throw Error('REQUIRED_'+name);
 const n=Number(s);
 if(!Number.isFinite(n)||n<min||n>max)throw Error('INVALID_'+name);
 return n;
};
const integer=(value,min,max,name)=>{
 const n=numeric(value,min,max,name);
 if(!isInt(n))throw Error('INTEGER_'+name);
 return n;
};
const deep=v=>JSON.parse(JSON.stringify(v));
export function newDrawing(id,roomName=''){
 if(!safeId(id))throw Error('CLEAN_DRAFT_ID_REQUIRED');
 return {
  format:DRAWING_VERSION,source:'CLEAN_PWA_DRAFT_NOT_LEGACY',projectId:id,
  floorId:id+'-F',roomId:id+'-R',name:'Новый план',roomName:String(roomName).slice(0,120),
  corners:null,wallThicknessMm:null,wallRoles:['UNKNOWN','UNKNOWN','UNKNOWN','UNKNOWN'],
  openings:[],thermal:{}
 };
}
export function validateDrawing(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.format!==DRAWING_VERSION||raw.source!=='CLEAN_PWA_DRAFT_NOT_LEGACY'||!safeId(raw.projectId))throw Error('DRAWING_FORMAT_OR_SOURCE_REJECTED');
 const expected=newDrawing(raw.projectId);
 if(raw.floorId!==expected.floorId||raw.roomId!==expected.roomId)throw Error('DRAWING_ID_CONFLICT');
 if(typeof raw.roomName!=='string'||raw.roomName.length>120||typeof raw.name!=='string'||raw.name.length>120)throw Error('DRAWING_LABEL_INVALID');
 if(raw.corners!==null){
  if(!Array.isArray(raw.corners)||raw.corners.length!==2)throw Error('TWO_CORNERS_REQUIRED');
  const [a,b]=raw.corners;
  for(const p of [a,b])if(!p||!isInt(p.xMm)||!isInt(p.yMm)||p.xMm<0||p.xMm>12000||p.yMm<0||p.yMm>12000)throw Error('RECT_MM_INVALID');
  if(Math.abs(a.xMm-b.xMm)<250||Math.abs(a.yMm-b.yMm)<250)throw Error('RECT_TOO_SMALL');
 }
 if(raw.wallThicknessMm!==null)integer(raw.wallThicknessMm,40,600,'wallThicknessMm');
 if(!Array.isArray(raw.wallRoles)||raw.wallRoles.length!==4||raw.wallRoles.some(role=>!['UNKNOWN','EXTERIOR','HEATED_ADJACENT'].includes(role)))throw Error('WALL_ROLE_INVALID');
 if(!Array.isArray(raw.openings)||raw.openings.length>4)throw Error('OPENINGS_LIMIT');
 for(const op of raw.openings){
  if(!op||!isInt(op.edgeIndex)||op.edgeIndex<0||op.edgeIndex>3||!['WINDOW','DOOR'].includes(op.openingType))throw Error('OPENING_TYPE_INVALID');
  integer(op.widthMm,1,10000,'openingWidth');integer(op.heightMm,1,5000,'openingHeight');
  integer(op.offsetFromWallStartMm,0,12000,'openingOffset');
  if(!raw.corners)throw Error('OPENING_WITHOUT_RECT');
  const [a,b]=raw.corners,len=op.edgeIndex%2===0?Math.abs(a.xMm-b.xMm):Math.abs(a.yMm-b.yMm);
  if(op.offsetFromWallStartMm+op.widthMm>len)throw Error('OPENING_EXCEEDS_WALL');
  if(raw.wallRoles[op.edgeIndex]!=='EXTERIOR')throw Error('OPENING_REQUIRES_EXTERIOR_WALL_P1');
 }
 for(let edge=0;edge<4;edge++)if(raw.openings.filter(o=>o.edgeIndex===edge).length>1)throw Error('ONE_OPENING_PER_EDGE_P1');
 if(!raw.thermal||typeof raw.thermal!=='object'||Array.isArray(raw.thermal))throw Error('THERMAL_INPUTS_INVALID');
 for(const [key,v] of Object.entries(raw.thermal))if(![
  'heightMm','indoorTempC','outdoorTempC','wallU','windowU','doorU',
  'airChangesPerHour','heatCapacityFactorWhM3K','reservePct',
  'floorBoundaryType','ceilingBoundaryType','floorU','floorBoundaryTempC',
  'ceilingU','ceilingBoundaryTempC','validatedGroundHeatLossW'
 ].includes(key)||typeof v!=='string'||v.length>80)throw Error('THERMAL_FIELD_INVALID');
 return deep(raw);
}
function rectangle(d){
 if(!d.corners||d.corners.length!==2)throw Error('RECTANGLE_NOT_FINISHED');
 const [a,b]=d.corners,x0=Math.min(a.xMm,b.xMm),x1=Math.max(a.xMm,b.xMm),y0=Math.min(a.yMm,b.yMm),y1=Math.max(a.yMm,b.yMm);
 return [{xMm:x0,yMm:y0},{xMm:x1,yMm:y0},{xMm:x1,yMm:y1},{xMm:x0,yMm:y1}];
}
export function drawRect(draft,a,b){
 const d=validateDrawing(draft);
 d.corners=[{xMm:integer(a.xMm,0,12000,'x'),yMm:integer(a.yMm,0,12000,'y')},{xMm:integer(b.xMm,0,12000,'x'),yMm:integer(b.yMm,0,12000,'y')}];
 d.openings=[];
 d.wallRoles=['UNKNOWN','UNKNOWN','UNKNOWN','UNKNOWN'];
 validateDrawing(d);
 return d;
}
export function drawingGeometry(draft){
 const d=validateDrawing(draft),p=rectangle(d);
 const thickness=integer(d.wallThicknessMm,40,600,'wallThicknessMm');
 const walls=p.map((a,i)=>{
  const b=p[(i+1)%4];
  return {engineeringWallId:d.roomId+'-W'+i,engineeringFloorId:d.floorId,engineeringProjectId:d.projectId,
   startXmm:a.xMm,startYmm:a.yMm,endXmm:b.xMm,endYmm:b.yMm,thicknessMm:thickness,wallRole:d.wallRoles[i],status:'DRAFT'};
 });
 const metrics=netRoomMetrics(p,walls);
 if(!metrics.supported)throw Error('NET_METRICS_'+metrics.reason);
 return {vertices:p,walls,metrics,openingRows:d.openings.map((op,i)=>({
  engineeringOpeningId:d.roomId+'-O'+i,engineeringProjectId:d.projectId,
  engineeringFloorId:d.floorId,engineeringRoomId:d.roomId,
  engineeringWallId:walls[op.edgeIndex].engineeringWallId,openingType:op.openingType,
  widthMm:op.widthMm,heightMm:op.heightMm,offsetFromWallStartMm:op.offsetFromWallStartMm,status:'DRAFT'
 }))};
}
export function calculateFromDrawing(draft){
 const d=validateDrawing(draft);
 if(!d.roomName.trim())return {status:'INCOMPLETE',missingInputs:['roomName']};
 if(d.wallRoles.includes('UNKNOWN'))return {status:'INCOMPLETE',missingInputs:['wallRoles']};
 let geom;
 try{geom=drawingGeometry(d);}catch(e){return {status:'INCOMPLETE',missingInputs:[String(e.message)]};}
 const t=d.thermal||{},missing=[];
 function num(k,min,max,needed=true){
  try{return numeric(t[k],min,max,k);}catch(e){if(needed)missing.push(k);return undefined;}
 }
 const heightMm=num('heightMm',1000,10000);
 const indoor=num('indoorTempC',-60,90),outdoor=num('outdoorTempC',-100,80);
 const wallU=d.wallRoles.includes('EXTERIOR')?num('wallU',0,20):undefined;
 const windowU=d.openings.some(o=>o.openingType==='WINDOW')?num('windowU',0,20):undefined;
 const doorU=d.openings.some(o=>o.openingType==='DOOR')?num('doorU',0,20):undefined;
 const ach=num('airChangesPerHour',0,50),factor=num('heatCapacityFactorWhM3K',0.001,2),reserve=num('reservePct',0,200);
 const floorType=t.floorBoundaryType,ceilType=t.ceilingBoundaryType;
 if(!['HEATED','EXTERIOR','GROUND'].includes(floorType))missing.push('floorBoundaryType');
 if(!['HEATED','EXTERIOR'].includes(ceilType))missing.push('ceilingBoundaryType');
 const floorBoundary=floorType==='HEATED'?{include:false}:
  floorType==='GROUND'?{boundaryType:'GROUND',validatedGroundHeatLossW:num('validatedGroundHeatLossW',0,100000)}:
  {uValueWm2K:num('floorU',0,20),boundaryTempC:num('floorBoundaryTempC',-100,100)};
 const ceilingBoundary=ceilType==='HEATED'?{include:false}:
  {uValueWm2K:num('ceilingU',0,20),boundaryTempC:num('ceilingBoundaryTempC',-100,100)};
 if(missing.length)return {status:'INCOMPLETE',missingInputs:missing,geometry:geom.metrics};
 if(outdoor>=indoor)return {status:'INVALID',invalidInputs:['outdoorTempC'],geometry:geom.metrics};
 // A drawn rectangle produces canonical wall, opening and zone records in mm; IDs belong only to this Clean draft.
 const snapshot={
  floor:{engineeringFloorId:d.floorId,engineeringProjectId:d.projectId,defaultCeilingHeightMm:heightMm,status:'DRAFT',revision:1},
  rooms:[{engineeringRoomId:d.roomId,engineeringFloorId:d.floorId,engineeringProjectId:d.projectId,
    name:d.roomName,ceilingHeightMm:heightMm,status:'DRAFT',revision:1}],
  zones:[{engineeringRoomZoneId:d.roomId+'-Z',engineeringRoomId:d.roomId,engineeringFloorId:d.floorId,
    engineeringProjectId:d.projectId,verticesJson:JSON.stringify(geom.vertices),areaMm2:geom.metrics.areaMm2,
    perimeterMm:geom.metrics.perimeterMm,status:'DRAFT',revision:1}],
  walls:geom.walls,openings:geom.openingRows
 };
 const thermal={
  indoorTempC:indoor,outdoorTempC:outdoor,defaultExteriorWallProfile:{uValueWm2K:wallU},
  defaultWindowProfile:{uValueWm2K:windowU},defaultExteriorDoorProfile:{uValueWm2K:doorU},
  floorBoundary,ceilingBoundary,airChangesPerHour:ach,heatCapacityFactorWhM3K:factor,reservePct:reserve
 };
 const passport=passportFromFloorSnapshot(snapshot,d.roomId,thermal);
 if(!passport.passport)return {...passport,geometry:geom.metrics};
 const heat=calculateHeatLoss(passport.passport);
 return {
  status:heat.status,geometry:geom.metrics,passport:passport.passport,heatLoss:heat,missingInputs:heat.missingInputs||[],
  invalidInputs:heat.invalidInputs||[],source:DRAWING_SOURCE,derivedOnly:true,canonicalWrites:0
 };
}
export function exportDrawing(draft){
 const d=validateDrawing(draft);
 if(!d.corners||d.corners.length!==2)throw Error('RECTANGLE_NOT_FINISHED');
 return JSON.stringify(d,null,2);
}
export function importDrawing(text){
 if(typeof text!=='string'||text.length>25000)throw Error('DRAWING_IMPORT_SIZE');
 return validateDrawing(JSON.parse(text));
}
